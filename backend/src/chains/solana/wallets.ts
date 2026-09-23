/**
 * Per-wallet profiling: age, activity, and where its first SOL came from.
 *
 * This is the most expensive part of an analysis (one RPC call per wallet), so
 * it runs once over a capped, holding-weighted set of wallets and both the
 * fresh-wallet detector and the funding-cluster detector read from its result.
 *
 * The trick that keeps it cheap: we ask for only freshWalletMaxTxCount + 1
 * signatures. If fewer come back, that IS the wallet's entire history — we get
 * the exact transaction count and the first-ever transaction in one call. If
 * the page comes back full, the wallet is busier than our threshold, which is
 * all we needed to know, and it is not fresh.
 */

import { DETECTION, LIMITS } from '../../config.ts';
import type { EnhancedTransaction, HeliusClient } from './helius.ts';
import { chunk, mapWithConcurrency } from '../../util.ts';

export interface WalletProfile {
  address: string;
  /** Exact count when knowsFullHistory, otherwise "more than the threshold". */
  txCount: number;
  knowsFullHistory: boolean;
  /** Unix seconds of the wallet's first transaction, when known. */
  firstTxAt: number | null;
  firstSignature: string | null;
  /** Address that sent this wallet its first SOL, when known. */
  funder: string | null;
}

export async function profileWallets(
  client: HeliusClient,
  wallets: readonly string[],
): Promise<Map<string, WalletProfile>> {
  const limit = DETECTION.freshWalletMaxTxCount + 1;

  const profiles = await mapWithConcurrency(wallets, LIMITS.concurrency, async (address) => {
    const signatures = await client.getSignatures(address, undefined, limit);
    const knowsFullHistory = signatures.length < limit;
    const oldest = signatures[signatures.length - 1];

    const profile: WalletProfile = {
      address,
      txCount: signatures.length,
      knowsFullHistory,
      firstTxAt: knowsFullHistory ? (oldest?.blockTime ?? null) : null,
      firstSignature: knowsFullHistory ? (oldest?.signature ?? null) : null,
      funder: null,
    };
    return profile;
  });

  await attachFunders(client, profiles);

  return new Map(profiles.map((p) => [p.address, p]));
}

/**
 * Parse each wallet's first transaction to find who funded it. Batched 100 at a
 * time, so this adds one or two calls no matter how many wallets we profiled.
 */
async function attachFunders(client: HeliusClient, profiles: WalletProfile[]): Promise<void> {
  const bySignature = new Map<string, WalletProfile[]>();
  for (const profile of profiles) {
    if (!profile.firstSignature) continue;
    const bucket = bySignature.get(profile.firstSignature) ?? [];
    bucket.push(profile);
    bySignature.set(profile.firstSignature, bucket);
  }

  for (const batch of chunk([...bySignature.keys()], 100)) {
    const parsed = await client.parsedTransactions(batch);
    for (const tx of parsed) {
      for (const profile of bySignature.get(tx.signature) ?? []) {
        profile.funder = findFunder(tx, profile.address);
      }
    }
  }
}

/** First inbound SOL transfer wins; fall back to whoever paid the fee. */
function findFunder(tx: EnhancedTransaction, wallet: string): string | null {
  for (const transfer of tx.nativeTransfers) {
    if (transfer.toUserAccount !== wallet) continue;
    if (!transfer.fromUserAccount || transfer.fromUserAccount === wallet) continue;
    return transfer.fromUserAccount;
  }
  return tx.feePayer && tx.feePayer !== wallet ? tx.feePayer : null;
}

/**
 * Fresh = barely used, or brand new. Either is enough on its own: a wallet
 * created an hour ago is fresh even if it has been busy, and a wallet with
 * three lifetime transactions is fresh even if it was created last year.
 */
export function isFreshWallet(profile: WalletProfile | undefined, now: number): boolean {
  if (!profile) return false;
  if (profile.knowsFullHistory && profile.txCount <= DETECTION.freshWalletMaxTxCount) return true;
  if (profile.firstTxAt === null) return false;
  const ageHours = (now - profile.firstTxAt) / 3600;
  return ageHours <= DETECTION.freshWalletMaxAgeHours;
}
