/**
 * Holder balances, rebuilt from Transfer logs.
 *
 * EVM has no "list every holder" call — the only record of who owns what is
 * the log of every transfer since the token was deployed. So we replay them
 * and net each address out.
 *
 * That is affordable for a token launched recently, which is what a launchpad
 * trades, and steadily less so as the history grows. The query budget below
 * bounds it: past that we report the holder set as partial rather than
 * publishing a concentration number computed from half the transfers, which
 * would be wrong in the flattering direction.
 */

import { DETECTION, LIMITS } from '../../config.ts';
import { pctOf } from '../../util.ts';
import type { ResolvedEvmChain } from './chains.ts';
import { hexToBigInt, hexToNumber, topicToAddress, ZERO_ADDRESS } from './helpers.ts';
import { transfersInRange } from './launch.ts';
import { assetTransfers } from './transfers.ts';
import type { EvmClient } from './rpc.ts';
import type { ExcludedAccount, HolderEntry } from '@sonar/shared';

export interface EvmHolders {
  balances: Map<string, bigint>;
  holderCount: number;
  /** False when the query budget ran out before the whole history was read. */
  complete: boolean;
  top: HolderEntry[];
  excluded: ExcludedAccount[];
  top10Pct: number;
}

/** Burn destinations. Tokens sent here are gone, and are not concentration. */
const BURN_ADDRESSES = new Set([ZERO_ADDRESS, '0x000000000000000000000000000000000000dead']);

export async function buildEvmHolders(
  client: EvmClient,
  chain: ResolvedEvmChain,
  token: string,
  fromBlock: number,
  supply: bigint,
): Promise<EvmHolders> {
  const balances = new Map<string, bigint>();
  const add = (address: string, delta: bigint): void => {
    const next = (balances.get(address) ?? 0n) + delta;
    if (next <= 0n) balances.delete(address);
    else balances.set(address, next);
  };

  /*
   * Two ways to read the same history. The transfers API pages through the
   * whole thing; eth_getLogs is the fallback for endpoints without it, and its
   * block-range limit is what bounds how far back we can see there.
   */
  let complete: boolean;

  if (chain.useAssetTransfers) {
    const result = await assetTransfers(client, token, {
      fromBlock: `0x${fromBlock.toString(16)}`,
      maxPages: LIMITS.evmMaxTransferPages,
    });
    complete = result.complete;

    for (const t of result.transfers) {
      const raw = t.rawContract.value ? hexToBigInt(t.rawContract.value) : 0n;
      if (raw === 0n) continue;
      const from = t.from.toLowerCase();
      const to = (t.to ?? ZERO_ADDRESS).toLowerCase();

      if (from !== ZERO_ADDRESS) add(from, -raw);
      if (to !== ZERO_ADDRESS) add(to, raw);
    }
  } else {
    const latest = await client.blockNumber();
    const result = await transfersInRange(
      client,
      chain,
      token,
      fromBlock,
      latest,
      LIMITS.evmMaxLogQueries,
    );
    complete = result.complete;

    for (const log of result.logs) {
      const from = topicToAddress(log.topics[1] ?? '');
      const to = topicToAddress(log.topics[2] ?? '');
      const amount = hexToBigInt(log.data);
      if (amount === 0n) continue;

      if (from !== ZERO_ADDRESS) add(from, -amount);
      if (to !== ZERO_ADDRESS) add(to, amount);
    }
  }

  // Burn addresses are excluded outright: nobody holds those tokens.
  const excluded: ExcludedAccount[] = [];
  for (const burn of BURN_ADDRESSES) {
    const held = balances.get(burn);
    if (held && held > 0n) {
      excluded.push({ address: burn, pct: pctOf(held, supply), reason: 'burn' });
      balances.delete(burn);
    }
  }

  /*
   * The token's own contract and the pools it trades in are not people either.
   * Without a pool registry we cannot name them all, so the contract itself is
   * excluded by address and the rest are labelled by the caller if known.
   */
  const self = token.toLowerCase();
  const selfHeld = balances.get(self);
  if (selfHeld && selfHeld > 0n) {
    excluded.push({ address: self, pct: pctOf(selfHeld, supply), reason: 'known-program' });
    balances.delete(self);
  }

  /*
   * A holder with bytecode is a contract, not a person: the pool the token
   * trades in, a staking vault, a bridge. This is the EVM twin of the Solana
   * test for accounts owned by a program rather than the System Program, and
   * it matters just as much — without it the liquidity pool reads as one
   * wallet holding half the supply, and every healthy token looks rugged.
   *
   * We only check the candidates for the top list, so it costs at most a
   * handful of calls.
   */
  const ranked = [...balances.entries()].sort((a, b) =>
    b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0,
  );

  const top: HolderEntry[] = [];
  for (const [address, amount] of ranked) {
    if (top.length >= DETECTION.topHolderCount) break;

    const isContract = (await client.codeAt(address, 'latest')) !== '0x';
    const pct = pctOf(amount, supply);

    if (isContract) {
      excluded.push({ address, pct, reason: 'liquidity-pool' });
      balances.delete(address);
      continue;
    }

    top.push({ address, amount: amount.toString(), pct, txCount: null, highActivity: false });
  }

  const top10Pct = Math.round(top.reduce((sum, h) => sum + h.pct, 0) * 100) / 100;

  return { balances, holderCount: balances.size, complete, top, excluded, top10Pct };
}

/** Combined holding of a set of wallets, as a share of total supply. */
export function evmHoldingPct(
  wallets: Iterable<string>,
  balances: Map<string, bigint>,
  supply: bigint,
): number {
  let amount = 0n;
  for (const wallet of wallets) amount += balances.get(wallet.toLowerCase()) ?? 0n;
  return pctOf(amount, supply);
}

export { hexToNumber };
