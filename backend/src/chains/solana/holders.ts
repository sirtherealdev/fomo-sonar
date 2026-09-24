/**
 * Holder distribution.
 *
 * Two different questions, answered two different ways:
 *
 *  1. "What does an arbitrary set of wallets hold?" (dev, bundlers, snipers,
 *     fresh wallets) — answered from a full holder map built with Helius DAS
 *     getTokenAccounts, one pass, ~1 call per 1000 holders. Without this we
 *     would need an RPC call per wallet.
 *
 *  2. "Who are the top 10 holders?" — answered with getTokenLargestAccounts,
 *     which is exact and cheap. The holder map is not sorted, so we do not
 *     use it for this.
 *
 * Both exclude non-people. The structural test is the important one: a holder
 * whose account is not owned by the System Program is a PDA — an AMM vault, a
 * bonding curve, an escrow — and counting it as concentration would flag every
 * healthy token as high risk.
 */

import { DETECTION, LIMITS } from '../../config.ts';
import type { HeliusClient } from './helius.ts';
import { isBurnAddress, knownProgramName, SYSTEM_PROGRAM } from './known-accounts.ts';
import { pctOf } from '../../util.ts';
import type { ExcludedAccount, HolderEntry } from '@sonar/shared';

export interface HolderMap {
  /** wallet -> balance in base units. Zero balances are not included. */
  balances: Map<string, bigint>;
  /** True when pagination hit its cap, so the map is a subset of real holders. */
  truncated: boolean;
  holderCount: number;
}

export interface TopHolders {
  list: HolderEntry[];
  excluded: ExcludedAccount[];
  top10Pct: number;
}

export async function buildHolderMap(client: HeliusClient, mint: string): Promise<HolderMap> {
  const balances = new Map<string, bigint>();
  let truncated = true;

  for (let page = 1; page <= LIMITS.maxHolderPages; page++) {
    const accounts = await client.getTokenAccountsPage(mint, page);

    for (const account of accounts) {
      const amount = toBigInt(account.amount);
      if (amount === 0n) continue;
      // A wallet can own several token accounts for the same mint.
      balances.set(account.owner, (balances.get(account.owner) ?? 0n) + amount);
    }

    if (accounts.length < 1000) {
      truncated = false;
      break;
    }
  }

  return { balances, truncated, holderCount: balances.size };
}

/** Combined holding of a set of wallets, as a share of total supply. */
export function holdingPctOf(
  wallets: Iterable<string>,
  map: Pick<HolderMap, 'balances'>,
  supply: bigint,
): { amount: bigint; pct: number } {
  let amount = 0n;
  for (const wallet of wallets) amount += map.balances.get(wallet) ?? 0n;
  return { amount, pct: pctOf(amount, supply) };
}

export async function getTopHolders(
  client: HeliusClient,
  mint: string,
  supply: bigint,
): Promise<TopHolders> {
  const largest = await client.getTokenLargestAccounts(mint);
  if (largest.length === 0) return { list: [], excluded: [], top10Pct: 0 };

  // Token account -> owning wallet.
  const owners = await client.getTokenAccountOwners(largest.map((a) => a.address));

  // Wallet -> is it a plain wallet or a program-controlled PDA?
  const candidates = owners.filter((o): o is string => o !== null);
  const uniqueOwners = [...new Set(candidates)];
  const accountInfos = await client.getAccountOwners(uniqueOwners);
  const ownerProgram = new Map<string, string | null>();
  uniqueOwners.forEach((wallet, i) => {
    ownerProgram.set(wallet, accountInfos[i]?.owner ?? null);
  });

  const list: HolderEntry[] = [];
  const excluded: ExcludedAccount[] = [];

  for (let i = 0; i < largest.length; i++) {
    const account = largest[i];
    const wallet = owners[i];
    if (!account || !wallet) continue;

    const amount = toBigInt(account.amount);
    if (amount === 0n) continue;
    const pct = pctOf(amount, supply);

    const reason = exclusionReason(wallet, ownerProgram.get(wallet) ?? null);
    if (reason) {
      excluded.push({ address: wallet, pct, reason });
      continue;
    }

    // txCount and highActivity are filled in later, once wallets are profiled.
    list.push({ address: wallet, amount: amount.toString(), pct, txCount: null, highActivity: false });
  }

  const top = list.slice(0, DETECTION.topHolderCount);
  const top10Pct = Math.round(top.reduce((sum, h) => sum + h.pct, 0) * 100) / 100;

  return { list: top, excluded, top10Pct };
}

function exclusionReason(
  wallet: string,
  owningProgram: string | null,
): ExcludedAccount['reason'] | null {
  if (isBurnAddress(wallet)) return 'burn';
  if (knownProgramName(wallet)) return 'known-program';
  // Account does not exist on chain yet (no lamports): treat as a plain wallet.
  if (owningProgram === null) return null;
  if (owningProgram === SYSTEM_PROGRAM) return null;
  // Anything else is a PDA. Name it a pool when its program is one we know.
  return knownProgramName(owningProgram) ? 'liquidity-pool' : 'program-owned';
}

function toBigInt(amount: number | string): bigint {
  if (typeof amount === 'string') return BigInt(amount);
  return BigInt(Math.trunc(amount));
}
