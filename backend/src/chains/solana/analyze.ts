/**
 * Orchestrator: runs the detectors and assembles the API response.
 *
 * Shape of the pipeline:
 *
 *   mint account (supply, decimals, authorities)
 *        │
 *        ├─ holders ─────────────┐
 *        ├─ top holders ─────────┤
 *        ├─ DAS metadata ────────┤   (independent, run together)
 *        ├─ market (DexScreener) ┤
 *        └─ creation ────────────┤
 *                 │              │
 *                 └─> early window ─> bundlers / snipers
 *                                        │
 *                        top holders ────┴─> wallet profiles ─> fresh / insiders / clusters
 *                                                                        │
 *                                                                        └─> score
 *
 * Every detector that cannot run sets an `unavailable` reason and drops out of
 * the score instead of contributing a zero. Market data is best-effort and can
 * be null without affecting anything else.
 */

import { DETECTION, LIMITS } from '../../config.ts';
import { HeliusClient } from './helius.ts';
import { fetchMarket } from '../../market.ts';
import { pctOf, round2 } from '../../util.ts';
import { findCreation, type CreationResult } from './creation.ts';
import { analyzeEarlyWindow, readEarlyWindow } from './early.ts';
import { scanLaunchFromBlocks } from './block-scan.ts';
import { buildHolderMap, getTopHolders, holdingPctOf } from './holders.ts';
import { isFreshWallet, profileWallets, type WalletProfile } from './wallets.ts';
import { scoreRisk, type FactorInputs } from '../../scoring.ts';
import type { LaunchCache, StoredLaunch } from '../types.ts';
import type {
  AnalyzeResponse,
  BundleReport,
  CountAndHolding,
  DevReport,
  FundingCluster,
  SecurityInfo,
  TokenInfo,
  Unavailable,
} from '@scope/shared';

export async function analyzeMint(
  client: HeliusClient,
  mint: string,
  cache?: LaunchCache | undefined,
  onPartial?: ((partial: AnalyzeResponse) => void) | undefined,
): Promise<AnalyzeResponse> {
  const startedAt = Date.now();
  const baseWarnings: string[] = [];

  // Supply, decimals and both authorities in one call.
  const mintAccount = await client.getMintAccount(mint);
  const supply = BigInt(mintAccount.supply);
  const decimals = mintAccount.decimals;

  // Launch facts are immutable, so a hit here skips the most expensive part of
  // the analysis entirely — and is the only way we can read the launch of a
  // token whose history has already outrun our signature cap.
  const cachedLaunch = await cache?.get('solana', mint).catch(() => null);

  /*
   * The launch hint has to be fetched before the history walk so the walk can
   * tell whether it is worth starting. Market data is a separate service and
   * costs us no Helius quota, so this ordering is free.
   */
  const marketResult = await fetchMarket('solana', mint);
  const launchHint = marketResult.market?.firstPairCreatedAt
    ? Math.floor(new Date(marketResult.market.firstPairCreatedAt).getTime() / 1000)
    : null;

  const [creation, holderMap, topHolders, metadata] = await Promise.all([
    cachedLaunch ? null : findCreation(client, mint, launchHint),
    buildHolderMap(client, mint),
    getTopHolders(client, mint, supply),
    client.getAssetMetadata(mint),
  ]);


  if (holderMap.truncated) {
    baseWarnings.push(
      `More than ${LIMITS.maxHolderPages * 1000} holders; wallet-set percentages are a lower bound.`,
    );
  }
  if (!marketResult.market) {
    baseWarnings.push('No DEX pool found for this token, so price and liquidity are unavailable.');
  }

  /*
   * "Can anyone change the rules on me after I buy?"
   *
   * On Solana that is the two mint authorities plus the Token-2022 extensions,
   * all of which arrive in the single getAccountInfo we already made. The
   * extensions are the sharper end: a permanent delegate can take tokens out
   * of any wallet, and a transfer hook runs code we have not read on every
   * transfer.
   */
  const security: SecurityInfo = {
    canMintMore: mintAccount.mintAuthority !== null,
    canFreeze: mintAccount.freezeAuthority !== null,
    canSeize: mintAccount.permanentDelegate !== null,
    hasTransferHook: mintAccount.transferHookProgram !== null,
    transferTaxPct: round2(mintAccount.transferFeeBasisPoints / 100),
    taxCanChange:
      mintAccount.transferFeeAuthority !== null && mintAccount.transferFeeBasisPoints >= 0,
    controller:
      mintAccount.permanentDelegate ??
      mintAccount.mintAuthority ??
      mintAccount.freezeAuthority,
    detail: describeControls(mintAccount),
  };

  // DexScreener carries the socials and the image the token actually ships
  // with; DAS is the fallback for a token too new to have a pool.
  const token: TokenInfo = {
    name: marketResult.token.name ?? metadata.name,
    symbol: marketResult.token.symbol ?? metadata.symbol,
    imageUrl: marketResult.token.imageUrl ?? metadata.imageUrl,
    websites: marketResult.token.websites ?? [],
    socials: marketResult.token.socials ?? [],
  };

  /*
   * Three phases, because the work is wildly unequal.
   *
   * Holders, concentration and the authority checks are ready in a couple of
   * seconds. Reading the launch can take thirty when the history has to be
   * scanned block by block. Per-wallet profiling costs more calls than
   * everything else combined. Emitting a report after each means the panel
   * shows a real score almost immediately and fills in rather than waiting for
   * the slowest part.
   */
  type LaunchState = { status: 'pending' } | { status: 'ready'; launch: StoredLaunch | null };

  const build = (
    launchState: LaunchState,
    profiles: Map<string, WalletProfile> | null,
  ): AnalyzeResponse => {
    const launch = launchState.status === 'ready' ? launchState.launch : null;
    const launchPending = launchState.status === 'pending';
    const phase = launchState.status === 'ready' && profiles ? 'final' : 'partial';
    const warnings = [...baseWarnings];
    const now = Math.floor(Date.now() / 1000);

    if (!launchPending) {
      if (!launch) {
        warnings.push(
          'This token has traded too much to reach its launch, and we could not locate it from market data either. Dev, bundler and sniper detection are unavailable.',
        );
      } else if (launch.source === 'block-scan') {
        warnings.push(
          'Launch read by scanning the blocks around it, because the token has too much history to walk back through.',
        );
      }
      if (launch?.truncated) {
        warnings.push(
          `More than ${LIMITS.maxEarlyTransactions} transactions in the launch window; bundler and sniper counts are a lower bound.`,
        );
      }
    }

    const bundlerSet = new Set<string>(launch?.bundlers ?? []);
    const sniperSet = new Set<string>(launch?.snipers ?? []);
    const dev = launch?.dev ?? null;

    const candidates = [
      ...new Set([...topHolders.list.map((h) => h.address), ...bundlerSet, ...sniperSet]),
    ].filter((wallet) => wallet !== dev);

    if (profiles && candidates.length > LIMITS.maxFreshWalletChecks) {
      warnings.push(
        `Only the ${LIMITS.maxFreshWalletChecks} largest of ${candidates.length} notable wallets were checked for age and funding; fresh-wallet and insider counts are a lower bound.`,
      );
    }

    /** Nothing measured yet, versus measured and genuinely absent. */
    const missing = (): Unavailable => (launchPending ? 'pending' : 'creation-not-found');

    const devReport: DevReport = launch
      ? buildDevReport(launch, decimals, holderMap, supply)
      : { address: null, holdingPct: 0, soldPct: 0, unavailable: missing() };

    // How much of the supply a wallet set took at launch, whatever it holds now.
    const boughtPctOf = (wallets: Iterable<string>): number => {
      let ui = 0;
      for (const wallet of wallets) ui += launch?.bought[wallet] ?? 0;
      return pctOf(BigInt(Math.round(ui * 10 ** decimals)), supply);
    };

    const bundles: BundleReport = launch
      ? {
          walletCount: bundlerSet.size,
          holdingPct: holdingPctOf(bundlerSet, holderMap, supply).pct,
          boughtPct: boughtPctOf(bundlerSet),
          // Clusters need funding data, which only the profiling pass has.
          clusters: profiles ? buildClusters(bundlerSet, profiles, holderMap, supply) : [],
        }
      : { walletCount: 0, holdingPct: 0, boughtPct: 0, clusters: [], unavailable: missing() };

    const snipers: CountAndHolding = launch
      ? {
          count: sniperSet.size,
          holdingPct: holdingPctOf(sniperSet, holderMap, supply).pct,
          boughtPct: boughtPctOf(sniperSet),
        }
      : { count: 0, holdingPct: 0, boughtPct: null, unavailable: missing() };

    // The dev is reported on its own line, never folded into the fresh count.
    const rankedWallets = candidates.filter((wallet) => wallet !== dev);
    const freshAddresses = profiles
      ? rankedWallets.filter((address) => isFreshWallet(profiles.get(address), now))
      : [];

    const freshWallets: CountAndHolding = profiles
      ? {
          count: freshAddresses.length,
          holdingPct: holdingPctOf(freshAddresses, holderMap, supply).pct,
          boughtPct: null,
        }
      : { count: 0, holdingPct: 0, boughtPct: null, unavailable: 'pending' };

    const insiders: CountAndHolding = profiles
      ? findInsiders(dev, rankedWallets, profiles, holderMap, supply)
      : { count: 0, holdingPct: 0, boughtPct: null, unavailable: 'pending' };

    // Label top holders that look like infrastructure rather than people.
    const labelledHolders = topHolders.list.map((holder) => {
      const profile = profiles?.get(holder.address);
      const txCount = profile?.knowsFullHistory === true ? profile.txCount : null;
      // Busy AND big. Either one on its own says nothing useful.
      const highActivity =
        profile !== undefined &&
        !profile.knowsFullHistory &&
        holder.pct >= DETECTION.highActivityMinPct;
      return { ...holder, txCount, highActivity };
    });

    const flaggedHolder = labelledHolders.find((h) => h.highActivity);
    if (flaggedHolder) {
      warnings.push(
        `${flaggedHolder.pct.toFixed(1)}% is held by a wallet with over ${LIMITS.walletHistoryPageSize} transactions — likely an exchange or protocol wallet, not a single holder.`,
      );
    }

    const factorInputs: FactorInputs = {
      /*
       * These two fail independently. A dev that took no allocation still has
       * a measurable current holding — zero — and "% of an allocation sold"
       * is the only part with no denominator. Dropping both together threw
       * away a good signal and pushed coverage under the threshold, so a
       * perfectly readable token reported as unknown.
       */
      devHolding: devReport.address === null ? null : devReport.holdingPct,
      devSold: devReport.unavailable ? null : devReport.soldPct,
      // Bundlers who already sold did their damage: a launch where same-slot
      // wallets took half the supply is bundled whether or not they still hold it.
      bundles: bundles.unavailable ? null : Math.max(bundles.holdingPct, bundles.boughtPct),
      topHolders: topHolders.list.length > 0 ? topHolders.top10Pct : null,
      snipers: snipers.unavailable ? null : Math.max(snipers.holdingPct, snipers.boughtPct ?? 0),
      freshWallets: freshWallets.unavailable ? null : freshWallets.holdingPct,
      insiders: insiders.unavailable ? null : insiders.holdingPct,
      authorities: authorityRisk(security),
    };
    const { score, level, factors, floor, coverage } = scoreRisk(factorInputs);

    return {
      mint,
      chain: 'solana',
      phase,
      coverage,
      token,
      market: marketResult.market,
      security,
      holderCount: holderMap.holderCount,
      riskScore: score,
      riskLevel: level,
      dev: devReport,
      bundles,
      topHolders: {
        top10Pct: topHolders.top10Pct,
        list: labelledHolders,
        excluded: topHolders.excluded,
      },
      snipers,
      freshWallets,
      insiders,
      analyzedAt: new Date().toISOString(),
      warnings,
      factors,
      scoreFloor: floor,
      meta: {
        supply: supply.toString(),
        decimals,
        createdAt: launch ? new Date(launch.timestamp * 1000).toISOString() : null,
        creationSignature: launch?.signature ?? null,
        launchSource: launch?.source ?? null,
        rpcCalls: client.calls,
        durationMs: Date.now() - startedAt,
        partial: warnings.length > 0 || factors.length < Object.keys(factorInputs).length,
      },
    };
  };

  // Phase 1: concentration and authorities, ready in a couple of seconds.
  onPartial?.(build({ status: 'pending' }, null));

  // Phase 2: the launch — cheap when the history is short, slow when it has to
  // be scanned block by block, which is exactly why it is not in phase 1.
  const launch = cachedLaunch ?? (await readLaunch(client, mint, creation, launchHint));
  if (launch && !cachedLaunch) {
    // Fire and forget: a cache write must never delay or fail a response.
    void cache?.put('solana', mint, launch).catch(() => {});
  }
  const launchState: LaunchState = { status: 'ready', launch };
  onPartial?.(build(launchState, null));

  // Phase 3: per-wallet profiling, which costs more calls than the rest together.
  const dev = launch?.dev ?? null;
  const ranked = [
    ...new Set([
      ...topHolders.list.map((h) => h.address),
      ...(launch?.bundlers ?? []),
      ...(launch?.snipers ?? []),
    ]),
  ]
    .filter((wallet) => wallet !== dev)
    .sort((a, b) => Number((holderMap.balances.get(b) ?? 0n) - (holderMap.balances.get(a) ?? 0n)))
    .slice(0, LIMITS.maxFreshWalletChecks - (dev ? 1 : 0));

  // The dev always gets profiled, whatever it holds: insider detection needs to
  // know who funded it.
  const interesting = dev ? [dev, ...ranked] : ranked;

  return build(launchState, await profileWallets(client, interesting));
}

/**
 * Work out what happened at the launch, from chain data.
 *
 * Bundlers bought in the creation slot (or within the slot window): that is
 * machine timing, not human. Snipers are the rest of the first N seconds —
 * deliberately disjoint from bundlers, so the score cannot count one wallet
 * twice under two headings.
 *
 * Returns null when we could not find the token's creation, which is the one
 * thing everything here depends on.
 */
async function readLaunch(
  client: HeliusClient,
  mint: string,
  creation: CreationResult | null,
  launchHint: number | null,
): Promise<StoredLaunch | null> {
  if (creation?.found && creation.dev) {
    return buildLaunch(
      creation.signature ?? '',
      creation.dev,
      creation.slot,
      creation.timestamp,
      await analyzeEarlyWindow(client, mint, creation),
      'history',
    );
  }

  /*
   * History was too long to walk back to the launch. Jump to it instead: the
   * market data tells us roughly when the pool was created, which for a
   * launchpad token is the same transaction as the mint, and we read the
   * blocks there directly. This is the only path that works on a token that
   * has already traded heavily.
   */
  if (launchHint === null) return null;

  const scan = await scanLaunchFromBlocks(client, mint, launchHint);
  if (!scan) return null;

  const early = await readEarlyWindow(
    client,
    mint,
    { dev: scan.dev, slot: scan.slot, timestamp: scan.timestamp },
    scan.windowSignatures,
  );

  return buildLaunch(
    scan.signature,
    scan.dev,
    scan.slot,
    scan.timestamp,
    { ...early, truncated: early.truncated || scan.truncated },
    'block-scan',
  );
}

/** Turn a launch window into the record we store and report. */
function buildLaunch(
  signature: string,
  dev: string,
  slot: number,
  timestamp: number,
  early: Awaited<ReturnType<typeof analyzeEarlyWindow>>,
  source: StoredLaunch['source'],
): StoredLaunch {

  const bundlers = new Set<string>();
  const snipers = new Set<string>();
  const maxBundleSlot = slot + DETECTION.bundleSlotWindow;

  for (const receipt of early.receipts) {
    if (receipt.slot <= maxBundleSlot) bundlers.add(receipt.wallet);
    else if (receipt.secondsAfterCreation <= DETECTION.sniperWindowSeconds) {
      snipers.add(receipt.wallet);
    }
  }
  for (const wallet of bundlers) snipers.delete(wallet);

  return {
    signature,
    dev,
    slot,
    timestamp,
    devInitialUiAmount: early.devInitialUiAmount,
    bundlers: [...bundlers],
    snipers: [...snipers],
    bought: Object.fromEntries(early.boughtByWallet),
    truncated: early.truncated,
    source,
  };
}

/**
 * Authority risk as a 0..100 input to the score.
 *
 * A live mint authority is the single most consequential flag on this list:
 * the supply you are looking at is not final and can be diluted at will. A
 * live freeze authority is milder but still means your balance can be locked.
 */
function authorityRisk(security: SecurityInfo): number {
  /*
   * The worst single power wins rather than summing: two ways to lose your
   * position is not meaningfully worse than one, and averaging them would let
   * a token with a seizure delegate look moderate.
   */
  return Math.max(
    security.canMintMore ? 100 : 0,
    security.canSeize ? 100 : 0,
    security.hasTransferHook ? 80 : 0,
    // A changeable tax is a tax of any size the authority likes, later.
    security.taxCanChange ? 70 : 0,
    // 12.5% and above scores as badly as it gets on tax alone.
    Math.min(100, security.transferTaxPct * 8),
    security.canFreeze ? 50 : 0,
  );
}

/** Plain English for whatever powers are still live. */
function describeControls(mint: {
  mintAuthority: string | null;
  freezeAuthority: string | null;
  permanentDelegate: string | null;
  transferHookProgram: string | null;
  transferFeeBasisPoints: number;
  transferFeeAuthority: string | null;
}): string {
  const live: string[] = [];

  if (mint.permanentDelegate) live.push('a permanent delegate can move tokens out of any wallet');
  if (mint.mintAuthority) live.push('mint authority is live, so supply can be increased');
  if (mint.transferHookProgram) live.push('every transfer runs a third-party program');
  if (mint.transferFeeBasisPoints > 0) {
    const pct = round2(mint.transferFeeBasisPoints / 100);
    live.push(
      mint.transferFeeAuthority
        ? `${pct}% transfer tax, and an authority can change it`
        : `${pct}% transfer tax`,
    );
  } else if (mint.transferFeeAuthority) {
    live.push('no transfer tax today, but an authority can add one');
  }
  if (mint.freezeAuthority) live.push('freeze authority is live, so balances can be frozen');

  if (live.length === 0) return 'No mint, freeze, seizure or tax powers remain.';
  return `${live[0]!.charAt(0).toUpperCase()}${live[0]!.slice(1)}${live.length > 1 ? `; ${live.slice(1).join('; ')}` : ''}.`;
}

function buildDevReport(
  launch: StoredLaunch | null,
  decimals: number,
  holderMap: { balances: Map<string, bigint> },
  supply: bigint,
): DevReport {
  if (!launch) {
    return { address: null, holdingPct: 0, soldPct: 0, unavailable: 'creation-not-found' };
  }

  const current = holderMap.balances.get(launch.dev) ?? 0n;
  const holdingPct = pctOf(current, supply);

  // The enhanced API gives decimal-adjusted amounts; convert back to base units
  // to compare against the on-chain balance. Safe for realistic supplies
  // (1e9 tokens at 6 decimals is 1e15, inside Number.MAX_SAFE_INTEGER).
  const initial = BigInt(Math.round(launch.devInitialUiAmount * 10 ** decimals));

  if (initial === 0n) {
    // The dev never received an allocation, so "% sold" has no denominator.
    return { address: launch.dev, holdingPct, soldPct: 0, unavailable: 'no-dev-allocation' };
  }

  const sold = initial > current ? initial - current : 0n;
  return { address: launch.dev, holdingPct, soldPct: round2(pctOf(sold, initial)) };
}

/**
 * Insiders: notable wallets whose first SOL came from the dev, plus the wallet
 * that funded the dev if it also holds the token. One hop only — deeper graph
 * walking costs an RPC call per wallet per hop and quickly finds nothing but
 * exchange hot wallets.
 */
function findInsiders(
  dev: string | null,
  wallets: readonly string[],
  profiles: Map<string, WalletProfile>,
  holderMap: { balances: Map<string, bigint> },
  supply: bigint,
): CountAndHolding {
  if (!dev) return { count: 0, holdingPct: 0, boughtPct: null, unavailable: 'creation-not-found' };

  const insiders = new Set<string>();

  for (const wallet of wallets) {
    if (wallet === dev) continue;
    if (profiles.get(wallet)?.funder === dev) insiders.add(wallet);
  }

  const devFunder = profiles.get(dev)?.funder;
  if (devFunder && devFunder !== dev && (holderMap.balances.get(devFunder) ?? 0n) > 0n) {
    insiders.add(devFunder);
  }

  return {
    count: insiders.size,
    holdingPct: holdingPctOf(insiders, holderMap, supply).pct,
    boughtPct: null,
  };
}

/**
 * Funding clusters: bundler wallets whose first SOL came from the same address.
 * One funder paying for a dozen wallets that all bought in the same slot is the
 * clearest bundling signal there is.
 */
function buildClusters(
  bundlers: Set<string>,
  profiles: Map<string, WalletProfile>,
  holderMap: { balances: Map<string, bigint> },
  supply: bigint,
): FundingCluster[] {
  const byFunder = new Map<string, string[]>();

  for (const wallet of bundlers) {
    const funder = profiles.get(wallet)?.funder;
    if (!funder) continue;
    const bucket = byFunder.get(funder) ?? [];
    bucket.push(wallet);
    byFunder.set(funder, bucket);
  }

  return [...byFunder.entries()]
    .filter(([, wallets]) => wallets.length >= DETECTION.minClusterSize)
    .map(([funder, wallets]) => ({
      funder,
      wallets,
      holdingPct: holdingPctOf(wallets, holderMap, supply).pct,
    }))
    .sort((a, b) => b.holdingPct - a.holdingPct);
}
