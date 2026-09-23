/**
 * Orchestrator: runs the detectors and assembles the API response.
 *
 * Shape of the pipeline:
 *
 *   supply ─┐
 *   holders ─┼─ (independent, run together)
 *   creation ┘        │
 *                     └─> early window ─> bundlers / snipers
 *                                            │
 *                     top holders ───────────┴─> wallet profiles ─> fresh / clusters
 *                                                                        │
 *                                                                        └─> score
 *
 * Every detector that cannot run sets an `unavailable` reason and drops out of
 * the score instead of contributing a zero.
 */

import { DETECTION, LIMITS } from '../config.ts';
import { HeliusClient } from '../helius.ts';
import { pctOf, round2 } from '../util.ts';
import { findCreation } from './creation.ts';
import { analyzeEarlyWindow } from './early.ts';
import { buildHolderMap, getTopHolders, holdingPctOf } from './holders.ts';
import { isFreshWallet, profileWallets, type WalletProfile } from './wallets.ts';
import { scoreRisk, type FactorInputs } from './score.ts';
import type {
  AnalyzeResponse,
  BundleReport,
  CountAndHolding,
  DevReport,
  FundingCluster,
} from '@scope/shared';

export async function analyzeMint(client: HeliusClient, mint: string): Promise<AnalyzeResponse> {
  const startedAt = Date.now();
  const warnings: string[] = [];

  const supplyInfo = await client.getTokenSupply(mint);
  const supply = BigInt(supplyInfo.amount);
  const decimals = supplyInfo.decimals;

  const [creation, holderMap, topHolders] = await Promise.all([
    findCreation(client, mint),
    buildHolderMap(client, mint),
    getTopHolders(client, mint, supply),
  ]);

  if (creation.truncated) {
    warnings.push(
      `Could not reach this token's first transaction within ${LIMITS.maxSignaturePages} pages of history. Dev, bundler and sniper detection are unavailable.`,
    );
  }
  if (holderMap.truncated) {
    warnings.push(
      `More than ${LIMITS.maxHolderPages * 1000} holders; wallet-set percentages are a lower bound.`,
    );
  }

  const early = await analyzeEarlyWindow(client, mint, creation);
  if (early.truncated) {
    warnings.push(
      `More than ${LIMITS.maxEarlyTransactions} transactions in the launch window; bundler and sniper counts are a lower bound.`,
    );
  }

  // --- Bundlers and snipers -------------------------------------------------
  // Bundlers bought in the creation slot (or within the slot window): that is
  // machine timing, not human. Snipers are the rest of the first N seconds —
  // deliberately disjoint from bundlers so the score cannot count a wallet twice.
  const bundlerSet = new Set<string>();
  const sniperSet = new Set<string>();
  const maxBundleSlot = creation.slot + DETECTION.bundleSlotWindow;

  for (const receipt of early.receipts) {
    if (receipt.slot <= maxBundleSlot) bundlerSet.add(receipt.wallet);
    else if (receipt.secondsAfterCreation <= DETECTION.sniperWindowSeconds) {
      sniperSet.add(receipt.wallet);
    }
  }
  for (const wallet of bundlerSet) sniperSet.delete(wallet);

  // --- Wallets worth the per-wallet RPC cost --------------------------------
  // Holding-weighted: a bundler sitting on 4% of supply matters, one holding
  // dust does not, and we only have budget for LIMITS.maxFreshWalletChecks.
  const interesting = [
    ...new Set([...topHolders.list.map((h) => h.address), ...bundlerSet, ...sniperSet]),
  ]
    .sort((a, b) => Number((holderMap.balances.get(b) ?? 0n) - (holderMap.balances.get(a) ?? 0n)))
    .slice(0, LIMITS.maxFreshWalletChecks);

  const profiles = await profileWallets(client, interesting);
  if (
    bundlerSet.size + sniperSet.size + topHolders.list.length >
    LIMITS.maxFreshWalletChecks
  ) {
    warnings.push(
      `Only the ${LIMITS.maxFreshWalletChecks} largest wallets were checked for age and funding; fresh-wallet and cluster counts are a lower bound.`,
    );
  }

  const now = Math.floor(Date.now() / 1000);

  // --- Reports --------------------------------------------------------------
  const dev = buildDevReport(creation, early.devInitialUiAmount, decimals, holderMap, supply);

  const bundles: BundleReport = creation.found
    ? {
        walletCount: bundlerSet.size,
        holdingPct: holdingPctOf(bundlerSet, holderMap, supply).pct,
        clusters: buildClusters(bundlerSet, profiles, holderMap, supply),
      }
    : { walletCount: 0, holdingPct: 0, clusters: [], unavailable: 'creation-not-found' };

  const snipers: CountAndHolding = creation.found
    ? { count: sniperSet.size, holdingPct: holdingPctOf(sniperSet, holderMap, supply).pct }
    : { count: 0, holdingPct: 0, unavailable: 'creation-not-found' };

  const freshAddresses = interesting.filter((address) => isFreshWallet(profiles.get(address), now));
  const freshWallets: CountAndHolding = {
    count: freshAddresses.length,
    holdingPct: holdingPctOf(freshAddresses, holderMap, supply).pct,
  };

  // --- Score ----------------------------------------------------------------
  const factorInputs: FactorInputs = {
    devHolding: dev.unavailable ? null : dev.holdingPct,
    devSold: dev.unavailable ? null : dev.soldPct,
    bundles: bundles.unavailable ? null : bundles.holdingPct,
    topHolders: topHolders.list.length > 0 ? topHolders.top10Pct : null,
    snipers: snipers.unavailable ? null : snipers.holdingPct,
    freshWallets: freshWallets.holdingPct,
  };
  const { score, level, factors } = scoreRisk(factorInputs);

  const partial =
    warnings.length > 0 || factors.length < Object.keys(factorInputs).length;

  return {
    mint,
    riskScore: score,
    riskLevel: level,
    dev,
    bundles,
    topHolders: {
      top10Pct: topHolders.top10Pct,
      list: topHolders.list,
      excluded: topHolders.excluded,
    },
    snipers,
    freshWallets,
    analyzedAt: new Date().toISOString(),
    warnings,
    factors,
    meta: {
      supply: supply.toString(),
      decimals,
      createdAt: creation.found ? new Date(creation.timestamp * 1000).toISOString() : null,
      creationSignature: creation.signature,
      rpcCalls: client.calls,
      durationMs: Date.now() - startedAt,
      partial,
    },
  };
}

function buildDevReport(
  creation: { found: boolean; dev: string | null },
  devInitialUiAmount: number,
  decimals: number,
  holderMap: { balances: Map<string, bigint> },
  supply: bigint,
): DevReport {
  if (!creation.found || !creation.dev) {
    return { address: null, holdingPct: 0, soldPct: 0, unavailable: 'creation-not-found' };
  }

  const current = holderMap.balances.get(creation.dev) ?? 0n;
  const holdingPct = pctOf(current, supply);

  // The enhanced API gives decimal-adjusted amounts; convert back to base units
  // to compare against the on-chain balance. Safe for realistic supplies
  // (1e9 tokens at 6 decimals is 1e15, inside Number.MAX_SAFE_INTEGER).
  const initial = BigInt(Math.round(devInitialUiAmount * 10 ** decimals));

  if (initial === 0n) {
    // The dev never received an allocation, so "% sold" has no denominator.
    return { address: creation.dev, holdingPct, soldPct: 0, unavailable: 'no-dev-allocation' };
  }

  const sold = initial > current ? initial - current : 0n;
  return { address: creation.dev, holdingPct, soldPct: round2(pctOf(sold, initial)) };
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
