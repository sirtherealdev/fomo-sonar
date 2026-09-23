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
import { analyzeEarlyWindow } from './early.ts';
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
} from '@scope/shared';

export async function analyzeMint(
  client: HeliusClient,
  mint: string,
  cache?: LaunchCache | undefined,
): Promise<AnalyzeResponse> {
  const startedAt = Date.now();
  const warnings: string[] = [];

  // Supply, decimals and both authorities in one call.
  const mintAccount = await client.getMintAccount(mint);
  const supply = BigInt(mintAccount.supply);
  const decimals = mintAccount.decimals;

  // Launch facts are immutable, so a hit here skips the most expensive part of
  // the analysis entirely — and is the only way we can read the launch of a
  // token whose history has already outrun our signature cap.
  const cachedLaunch = await cache?.get('solana', mint).catch(() => null);

  const [creation, holderMap, topHolders, metadata, marketResult] = await Promise.all([
    cachedLaunch ? null : findCreation(client, mint),
    buildHolderMap(client, mint),
    getTopHolders(client, mint, supply),
    client.getAssetMetadata(mint),
    fetchMarket('solana', mint),
  ]);

  if (creation?.truncated) {
    warnings.push(
      `This token has more than ${LIMITS.maxSignaturePages * 1000} transactions, so we could not reach its first one. Dev, bundler and sniper detection are unavailable.`,
    );
  }
  if (holderMap.truncated) {
    warnings.push(
      `More than ${LIMITS.maxHolderPages * 1000} holders; wallet-set percentages are a lower bound.`,
    );
  }
  if (!marketResult.market) {
    warnings.push('No DEX pool found for this token, so price and liquidity are unavailable.');
  }

  const launch = cachedLaunch ?? (await readLaunch(client, mint, creation));

  if (launch && !cachedLaunch) {
    // Fire and forget: a cache write must never delay or fail a response.
    void cache?.put('solana', mint, launch).catch(() => {});
  }
  if (launch?.truncated) {
    warnings.push(
      `More than ${LIMITS.maxEarlyTransactions} transactions in the launch window; bundler and sniper counts are a lower bound.`,
    );
  }

  const bundlerSet = new Set<string>(launch?.bundlers ?? []);
  const sniperSet = new Set<string>(launch?.snipers ?? []);

  // --- Wallets worth the per-wallet RPC cost --------------------------------
  // Holding-weighted: a bundler sitting on 4% of supply matters, one holding
  // dust does not, and we only have budget for LIMITS.maxFreshWalletChecks.
  const dev = launch?.dev ?? null;
  const candidates = [
    ...new Set([...topHolders.list.map((h) => h.address), ...bundlerSet, ...sniperSet]),
  ].filter((wallet) => wallet !== dev);

  const ranked = candidates
    .sort((a, b) => Number((holderMap.balances.get(b) ?? 0n) - (holderMap.balances.get(a) ?? 0n)))
    .slice(0, LIMITS.maxFreshWalletChecks - (dev ? 1 : 0));

  // The dev always gets profiled, whatever it holds: insider detection needs to
  // know who funded it.
  const interesting = dev ? [dev, ...ranked] : ranked;

  const profiles = await profileWallets(client, interesting);
  if (candidates.length > LIMITS.maxFreshWalletChecks) {
    warnings.push(
      `Only the ${LIMITS.maxFreshWalletChecks} largest of ${candidates.length} notable wallets were checked for age and funding; fresh-wallet and insider counts are a lower bound.`,
    );
  }

  const now = Math.floor(Date.now() / 1000);

  // --- Reports --------------------------------------------------------------
  const devReport = buildDevReport(launch, decimals, holderMap, supply);

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
        clusters: buildClusters(bundlerSet, profiles, holderMap, supply),
      }
    : {
        walletCount: 0,
        holdingPct: 0,
        boughtPct: 0,
        clusters: [],
        unavailable: 'creation-not-found',
      };

  const snipers: CountAndHolding = launch
    ? {
        count: sniperSet.size,
        holdingPct: holdingPctOf(sniperSet, holderMap, supply).pct,
        boughtPct: boughtPctOf(sniperSet),
      }
    : { count: 0, holdingPct: 0, boughtPct: null, unavailable: 'creation-not-found' };

  // The dev is reported on its own line, never folded into the fresh-wallet count.
  const freshAddresses = ranked.filter((address) => isFreshWallet(profiles.get(address), now));
  const freshWallets: CountAndHolding = {
    count: freshAddresses.length,
    holdingPct: holdingPctOf(freshAddresses, holderMap, supply).pct,
    boughtPct: null,
  };

  const insiders = findInsiders(dev, ranked, profiles, holderMap, supply);

  // Label top holders that look like infrastructure rather than people.
  const labelledHolders = topHolders.list.map((holder) => {
    const profile = profiles.get(holder.address);
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

  // On Solana the question "can anyone change the rules" is answered by the
  // two authorities on the mint account. Both null is the safe state.
  const security: SecurityInfo = {
    canMintMore: mintAccount.mintAuthority !== null,
    canFreeze: mintAccount.freezeAuthority !== null,
    controller: mintAccount.mintAuthority ?? mintAccount.freezeAuthority,
    detail: describeAuthorities(mintAccount.mintAuthority, mintAccount.freezeAuthority),
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

  // --- Score ----------------------------------------------------------------
  const factorInputs: FactorInputs = {
    devHolding: devReport.unavailable ? null : devReport.holdingPct,
    devSold: devReport.unavailable ? null : devReport.soldPct,
    // Bundlers who already sold did their damage: a launch where same-slot
    // wallets took half the supply is bundled whether or not they still hold it.
    bundles: bundles.unavailable ? null : Math.max(bundles.holdingPct, bundles.boughtPct),
    topHolders: topHolders.list.length > 0 ? topHolders.top10Pct : null,
    snipers: snipers.unavailable ? null : Math.max(snipers.holdingPct, snipers.boughtPct ?? 0),
    freshWallets: freshWallets.holdingPct,
    insiders: insiders.unavailable ? null : insiders.holdingPct,
    authorities: authorityRisk(security),
  };
  const { score, level, factors, floor, coverage } = scoreRisk(factorInputs);

  const partial = warnings.length > 0 || factors.length < Object.keys(factorInputs).length;

  return {
    mint,
    chain: 'solana',
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
      rpcCalls: client.calls,
      durationMs: Date.now() - startedAt,
      partial,
    },
  };
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
): Promise<StoredLaunch | null> {
  if (!creation?.found || !creation.dev) return null;

  const early = await analyzeEarlyWindow(client, mint, creation);

  const bundlers = new Set<string>();
  const snipers = new Set<string>();
  const maxBundleSlot = creation.slot + DETECTION.bundleSlotWindow;

  for (const receipt of early.receipts) {
    if (receipt.slot <= maxBundleSlot) bundlers.add(receipt.wallet);
    else if (receipt.secondsAfterCreation <= DETECTION.sniperWindowSeconds) {
      snipers.add(receipt.wallet);
    }
  }
  for (const wallet of bundlers) snipers.delete(wallet);

  return {
    signature: creation.signature ?? '',
    dev: creation.dev,
    slot: creation.slot,
    timestamp: creation.timestamp,
    devInitialUiAmount: early.devInitialUiAmount,
    bundlers: [...bundlers],
    snipers: [...snipers],
    bought: Object.fromEntries(early.boughtByWallet),
    truncated: early.truncated,
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
  if (security.canMintMore) return 100;
  if (security.canFreeze) return 50;
  return 0;
}

function describeAuthorities(mintAuthority: string | null, freezeAuthority: string | null): string {
  if (mintAuthority && freezeAuthority) return 'Mint and freeze authority are both still live.';
  if (mintAuthority) return 'Mint authority is still live: supply can be increased.';
  if (freezeAuthority) return 'Freeze authority is still live: balances can be frozen.';
  return 'Mint and freeze authority are both revoked.';
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
