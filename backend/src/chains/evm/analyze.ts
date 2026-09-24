/**
 * EVM orchestrator.
 *
 * Mirrors the Solana pipeline — same response, same scoring, same phased
 * delivery — over completely different primitives: blocks instead of slots,
 * Transfer logs instead of parsed transactions, and a nonce instead of a
 * signature history.
 *
 * Two signals are not available here yet and say so rather than reporting
 * zero. Insider detection and funding clusters both need to know where a
 * wallet's first funds came from, which on EVM means tracing internal calls —
 * a different and much heavier lookup than Solana's first-signature trick.
 */

import { DETECTION, LIMITS } from '../../config.ts';
import { fetchMarket } from '../../market.ts';
import { scoreRisk, type FactorInputs } from '../../scoring.ts';
import { mapWithConcurrency, pctOf, round2 } from '../../util.ts';
import type { ResolvedEvmChain } from './chains.ts';
import { buildEvmHolders, evmHoldingPct, type EvmHolders } from './holders.ts';
import { locateLaunchBlock, readEvmLaunch, type EvmLaunch } from './launch.ts';
import { readToken } from './token.ts';
import type { EvmClient } from './rpc.ts';
import type {
  AnalyzeResponse,
  BundleReport,
  ChainId,
  CountAndHolding,
  DevReport,
  SecurityInfo,
  TokenInfo,
  Unavailable,
} from '@scope/shared';

export async function analyzeEvmToken(
  client: EvmClient,
  chain: ResolvedEvmChain,
  chainId: ChainId,
  address: string,
  onPartial?: ((partial: AnalyzeResponse) => void) | undefined,
): Promise<AnalyzeResponse> {
  const startedAt = Date.now();
  const token = address.toLowerCase();

  const marketResult = await fetchMarket(chainId, token);
  const erc20 = await readToken(client, token);
  const supply = erc20.supply;

  const security: SecurityInfo = {
    canMintMore: erc20.canMintMore,
    canFreeze: erc20.canFreeze,
    // Solana's permanent delegate and transfer hooks have no ERC-20 analogue
    // we can detect reliably, so we do not claim either way.
    canSeize: false,
    hasTransferHook: false,
    transferTaxPct: 0,
    taxCanChange: erc20.owner !== null,
    controller: erc20.owner,
    detail: describeEvmControls(erc20.owner, erc20.canMintMore, erc20.canFreeze),
  };

  const tokenInfo: TokenInfo = {
    name: marketResult.token.name ?? null,
    symbol: marketResult.token.symbol ?? null,
    imageUrl: marketResult.token.imageUrl ?? null,
    websites: marketResult.token.websites ?? [],
    socials: marketResult.token.socials ?? [],
  };

  const build = (
    launch: EvmLaunch | null,
    holders: EvmHolders | null,
    profiles: Map<string, number> | null,
    phase: 'partial' | 'final',
  ): AnalyzeResponse => {
    const warnings: string[] = [];
    /*
     * "Still measuring" versus "measured and absent" depends on the phase, not
     * on whether we happen to hold a launch yet. Getting this backwards left
     * the panel saying "checking..." forever on a token whose launch we had
     * already given up on.
     */
    const missing = (): Unavailable => (phase === 'final' ? 'creation-not-found' : 'pending');

    if (!marketResult.market) {
      warnings.push('No DEX pool found for this token, so price and liquidity are unavailable.');
    }
    if (holders && !holders.complete) {
      warnings.push(
        `This token has more transfer history than we can replay on a public ${chainId} node, so holder concentration is a lower bound.`,
      );
    }
    if (!chain.holderReplay) {
      warnings.push(
        `Public ${chainId} nodes cap log queries at ${chain.maxLogRange} blocks, so holder data is limited to recent history.`,
      );
    }

    const balances = holders?.balances ?? new Map<string, bigint>();

    const devReport: DevReport = launch
      ? buildEvmDevReport(launch, erc20.decimals, balances, supply)
      : { address: null, holdingPct: 0, soldPct: 0, unavailable: missing() };

    const boughtPctOf = (wallets: Iterable<string>): number => {
      let ui = 0;
      for (const wallet of wallets) ui += launch?.bought[wallet] ?? 0;
      return pctOf(BigInt(Math.round(ui * 10 ** erc20.decimals)), supply);
    };

    const bundles: BundleReport = launch
      ? {
          walletCount: launch.bundlers.length,
          holdingPct: evmHoldingPct(launch.bundlers, balances, supply),
          boughtPct: boughtPctOf(launch.bundlers),
          // Clusters need funding origins, which EVM does not give cheaply.
          clusters: [],
        }
      : {
          walletCount: 0,
          holdingPct: 0,
          boughtPct: 0,
          clusters: [],
          unavailable: missing(),
        };

    const snipers: CountAndHolding = launch
      ? {
          count: launch.snipers.length,
          holdingPct: evmHoldingPct(launch.snipers, balances, supply),
          boughtPct: boughtPctOf(launch.snipers),
        }
      : { count: 0, holdingPct: 0, boughtPct: null, unavailable: missing() };

    const freshAddresses = profiles
      ? [...profiles.entries()]
          .filter(([, nonce]) => nonce <= DETECTION.freshWalletMaxTxCount)
          .map(([address]) => address)
      : [];

    const freshWallets: CountAndHolding = profiles
      ? {
          count: freshAddresses.length,
          holdingPct: evmHoldingPct(freshAddresses, balances, supply),
          boughtPct: null,
        }
      : { count: 0, holdingPct: 0, boughtPct: null, unavailable: 'pending' };

    const factorInputs: FactorInputs = {
      devHolding: devReport.unavailable ? null : devReport.holdingPct,
      devSold: devReport.unavailable ? null : devReport.soldPct,
      bundles: bundles.unavailable ? null : Math.max(bundles.holdingPct, bundles.boughtPct),
      topHolders: holders && holders.top.length > 0 ? holders.top10Pct : null,
      snipers: snipers.unavailable ? null : Math.max(snipers.holdingPct, snipers.boughtPct ?? 0),
      freshWallets: freshWallets.unavailable ? null : freshWallets.holdingPct,
      insiders: null, // Needs funding origins; see the file header.
      authorities: evmControlRisk(security),
    };
    const { score, level, factors, floor, coverage } = scoreRisk(factorInputs);

    return {
      mint: token,
      chain: chainId,
      phase,
      coverage,
      token: tokenInfo,
      market: marketResult.market,
      security,
      holderCount: holders?.holderCount ?? 0,
      riskScore: score,
      riskLevel: level,
      dev: devReport,
      bundles,
      topHolders: {
        top10Pct: holders?.top10Pct ?? 0,
        list: holders?.top ?? [],
        excluded: holders?.excluded ?? [],
      },
      snipers,
      freshWallets,
      insiders: { count: 0, holdingPct: 0, boughtPct: null, unavailable: 'not-supported-on-chain' },
      analyzedAt: new Date().toISOString(),
      warnings,
      factors,
      scoreFloor: floor,
      meta: {
        supply: supply.toString(),
        decimals: erc20.decimals,
        createdAt: launch ? new Date(launch.timestamp * 1000).toISOString() : null,
        creationSignature: launch?.txHash ?? null,
        launchSource: launch ? 'history' : null,
        rpcCalls: client.calls,
        durationMs: Date.now() - startedAt,
        partial: phase === 'partial',
      },
    };
  };

  // Phase 1: what the contract says about itself. Four calls, under a second.
  onPartial?.(build(null, null, null, 'partial'));

  const hint = marketResult.market?.firstPairCreatedAt
    ? Math.floor(new Date(marketResult.market.firstPairCreatedAt).getTime() / 1000)
    : null;

  const deploymentBlock = await locateLaunchBlock(client, chain, token, hint);
  if (deploymentBlock === null) return build(null, null, null, 'final');

  const launch = await readEvmLaunch(client, chain, token, deploymentBlock, erc20.decimals);
  const holders = await buildEvmHolders(client, chain, token, deploymentBlock, supply);
  onPartial?.(build(launch, holders, null, 'partial'));

  // Phase 3: one nonce lookup per notable wallet — EVM's cheapest signal.
  const notable = [
    ...new Set([
      ...holders.top.map((h) => h.address),
      ...(launch?.bundlers ?? []),
      ...(launch?.snipers ?? []),
    ]),
  ]
    .filter((wallet) => wallet !== launch?.dev)
    .slice(0, LIMITS.maxFreshWalletChecks);

  const nonces = await mapWithConcurrency(notable, LIMITS.concurrency, async (wallet) => {
    const nonce = await client.transactionCount(wallet).catch(() => Number.MAX_SAFE_INTEGER);
    return [wallet, nonce] as const;
  });

  return build(launch, holders, new Map(nonces), 'final');
}

function buildEvmDevReport(
  launch: EvmLaunch,
  decimals: number,
  balances: Map<string, bigint>,
  supply: bigint,
): DevReport {
  const current = balances.get(launch.dev) ?? 0n;
  const holdingPct = pctOf(current, supply);
  const initial = BigInt(Math.round(launch.devInitialUiAmount * 10 ** decimals));

  if (initial === 0n) {
    return { address: launch.dev, holdingPct, soldPct: 0, unavailable: 'no-dev-allocation' };
  }

  const sold = initial > current ? initial - current : 0n;
  return { address: launch.dev, holdingPct, soldPct: round2(pctOf(sold, initial)) };
}

/** Same idea as Solana's: the worst single power decides, not the sum. */
function evmControlRisk(security: SecurityInfo): number {
  return Math.max(
    security.canMintMore ? 100 : 0,
    security.canFreeze ? 50 : 0,
    // Ownership alone is not a power, but it is what keeps the others alive.
    security.controller ? 35 : 0,
  );
}

function describeEvmControls(owner: string | null, canMint: boolean, canFreeze: boolean): string {
  if (!owner) return 'Ownership is renounced, so the contract cannot be changed.';

  const powers: string[] = [];
  if (canMint) powers.push('mint new supply');
  if (canFreeze) powers.push('pause or blacklist transfers');

  return powers.length > 0
    ? `Ownership is not renounced, and the contract can ${powers.join(' and ')}.`
    : 'Ownership is not renounced; no mint or pause function was found in the bytecode.';
}
