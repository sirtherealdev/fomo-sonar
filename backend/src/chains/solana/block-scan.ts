/**
 * Reading a token's launch without walking its history.
 *
 * The problem this solves: RPC returns signatures newest-first, so reaching a
 * token's first transaction means paging backwards through everything it has
 * ever done. Measured on live tokens, a budget of 30,000 signatures buys as
 * little as twelve minutes of lookback — a token that traded for a day is
 * unreachable, and those are exactly the tokens people ask about.
 *
 * So instead of walking backwards, we jump. Given roughly when the token
 * launched, we locate that slot and read the blocks around it directly,
 * keeping only the transactions that touch this mint. Five to thirty block
 * reads, at any age, instead of thousands of sequential pages.
 *
 * Two things make it practical:
 *  - Blocks compress to ~600 KB on the wire, not the ~5 MB they occupy parsed,
 *    so a full launch window is tens of megabytes rather than hundreds.
 *  - `pairCreatedAt` from the market data is exact for launchpad tokens: the
 *    pool is created in the same transaction as the mint. Measured across
 *    known launches, the timestamps matched to the second.
 *
 * The timestamp is a hint, never trusted. We scan slots *before* the estimate
 * too, and if the mint already appears there, the estimate was late and we
 * widen. A launch we cannot prove we found is reported as not found.
 */

import { DETECTION, LIMITS } from '../../config.ts';
import type { EnhancedTransaction, HeliusClient } from './helius.ts';
import { mapWithConcurrency } from '../../util.ts';

export interface BlockScanLaunch {
  signature: string;
  dev: string;
  slot: number;
  /** Unix seconds. */
  timestamp: number;
  /** Signatures touching the mint in the launch window, oldest first. */
  windowSignatures: string[];
  /** Slots covered after the creation slot. */
  slotsCovered: number;
  /** True when the sniper window was wider than we were willing to read. */
  truncated: boolean;
}

/** Solana targets 400ms slots; the real rate drifts, so we measure it. */
const NOMINAL_SLOTS_PER_SECOND = 2.5;

export async function scanLaunchFromBlocks(
  client: HeliusClient,
  mint: string,
  approxTimestamp: number,
): Promise<BlockScanLaunch | null> {
  const anchorSlot = await locateSlot(client, approxTimestamp);
  if (anchorSlot === null) return null;

  /*
   * Walk backwards first and prove the launch is not before our window.
   *
   * If the mint already appears in the earliest slot we read, we started late
   * — everything we would collect is mid-launch trading, not the launch — so
   * we step further back and check again.
   */
  let windowStart = Math.max(0, anchorSlot - LIMITS.blockScanLookbackSlots);
  let provenClean = false;

  for (let attempt = 0; attempt < LIMITS.blockScanWidenAttempts; attempt++) {
    const probe = await scanRange(client, mint, windowStart, anchorSlot);
    const firstHit = probe.find((slot) => slot.signatures.length > 0);

    if (!firstHit) {
      provenClean = true; // Nothing before the anchor: the launch is at or after it.
      break;
    }
    // A hit with quiet slots before it is the mint's first appearance: the launch.
    if (firstHit.slot > windowStart) return readWindow(client, mint, firstHit.slot);

    windowStart = Math.max(0, windowStart - LIMITS.blockScanLookbackSlots);
  }

  /*
   * The mint was already trading in the earliest slot we were willing to read,
   * so we are somewhere inside its life, not at its start. Anything we
   * collected here would be ordinary trading dressed up as a launch — which is
   * exactly the failure that reported a passing trade as the dev wallet. Say
   * we did not find it.
   */
  if (!provenClean) return null;

  /*
   * Now search forward. The timestamp is only a hint — pool creation can be a
   * few seconds off the mint, and slot times are whole seconds — so we scan in
   * chunks and stop at the first slot the mint appears in, rather than reading
   * the whole search range every time.
   */
  const chunk = LIMITS.blockScanLookbackSlots;
  for (let offset = 0; offset < LIMITS.blockScanForwardSearchSlots; offset += chunk) {
    const from = anchorSlot + offset;
    const found = await scanRange(client, mint, from, from + chunk - 1);
    const firstHit = found.find((slot) => slot.signatures.length > 0);
    if (firstHit) return readWindow(client, mint, firstHit.slot);
  }

  // The hint pointed somewhere this token never appears; better to report no
  // launch than to analyse an arbitrary slice of its history as if it were one.
  return null;
}

/** Read the launch window starting at the slot the mint first appears in. */
async function readWindow(
  client: HeliusClient,
  mint: string,
  creationSlot: number,
): Promise<BlockScanLaunch | null> {
  // The sniper window in slots, capped by what we are willing to download.
  const wanted = Math.ceil(DETECTION.sniperWindowSeconds * NOMINAL_SLOTS_PER_SECOND);
  const covered = Math.min(wanted, LIMITS.blockScanMaxBlocks);

  const slots = await scanRange(client, mint, creationSlot, creationSlot + covered);
  const windowSignatures = slots.flatMap((slot) => slot.signatures);
  const first = windowSignatures[0];
  if (!first) return null;

  const [creation] = await client.parsedTransactions([first]);
  if (!creation) return null;

  return {
    signature: creation.signature,
    dev: devFromCreation(creation, mint),
    slot: creation.slot || creationSlot,
    timestamp: creation.timestamp,
    windowSignatures,
    slotsCovered: covered,
    truncated: covered < wanted,
  };
}

/**
 * Who the dev is, from the creation transaction.
 *
 * The wallet that received the initial allocation, not simply whoever paid the
 * fee: launches are sometimes submitted by a relayer, and then the fee payer
 * is a service, not the person holding the supply. Falls back to the fee payer
 * when nothing was allocated in the creation itself.
 */
function devFromCreation(creation: EnhancedTransaction, mint: string): string {
  let best: { wallet: string; amount: number } | null = null;

  for (const transfer of creation.tokenTransfers) {
    if (transfer.mint !== mint) continue;
    const wallet = transfer.toUserAccount;
    if (!wallet || wallet === transfer.fromUserAccount) continue;
    if (!best || transfer.tokenAmount > best.amount) best = { wallet, amount: transfer.tokenAmount };
  }

  return best?.wallet ?? creation.feePayer;
}

interface SlotHits {
  slot: number;
  signatures: string[];
}

/**
 * Signatures touching `mint` in each slot of the range, oldest slot first.
 *
 * Blocks are fetched a few at a time: enough to hide the round trips, few
 * enough that only a handful are held in memory at once.
 */
async function scanRange(
  client: HeliusClient,
  mint: string,
  fromSlot: number,
  toSlot: number,
): Promise<SlotHits[]> {
  const slots = Array.from({ length: toSlot - fromSlot + 1 }, (_, i) => fromSlot + i);

  const hits = await mapWithConcurrency(slots, LIMITS.blockScanConcurrency, async (slot) => {
    const signatures = await client.getBlockSignaturesTouching(slot, mint);
    return { slot, signatures } satisfies SlotHits;
  });

  return hits.sort((a, b) => a.slot - b.slot);
}

/**
 * The first slot at or after a given moment.
 *
 * Interpolation alone is not accurate enough: measured against a real launch
 * it landed 51 slots — about twenty seconds — early, which is enough to miss
 * the launch entirely with a narrow scan window. So interpolation only picks a
 * starting point, and a bracketed binary search closes the last few seconds
 * exactly.
 */
async function locateSlot(client: HeliusClient, timestamp: number): Promise<number | null> {
  const currentSlot = await client.rpc<number>('getSlot', []);
  const currentTime = await blockTimeNear(client, currentSlot - 4);
  if (currentTime === null || timestamp >= currentTime) return currentSlot;

  // Measure the real slot rate over a long baseline rather than assuming 400ms.
  const baselineSlot = Math.max(1, currentSlot - 1_000_000);
  const baselineTime = await blockTimeNear(client, baselineSlot);
  const slotsPerSecond =
    baselineTime !== null && currentTime > baselineTime
      ? (currentSlot - baselineSlot) / (currentTime - baselineTime)
      : NOMINAL_SLOTS_PER_SECOND;

  const guess = Math.round(currentSlot - (currentTime - timestamp) * slotsPerSecond);

  // Bracket the answer, widening until the target is provably inside.
  let low = Math.max(1, guess - 2_000);
  let high = Math.min(currentSlot, guess + 2_000);

  for (let i = 0; i < LIMITS.blockScanBracketAttempts; i++) {
    const lowTime = await blockTimeNear(client, low);
    if (lowTime === null) return null;
    if (lowTime <= timestamp) break;
    high = low;
    low = Math.max(1, low - 20_000);
  }

  for (let i = 0; i < LIMITS.blockScanBracketAttempts; i++) {
    const highTime = await blockTimeNear(client, high);
    if (highTime === null) return null;
    if (highTime >= timestamp) break;
    low = high;
    high = Math.min(currentSlot, high + 20_000);
  }

  // Narrow to the first slot whose block time reaches the target.
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    const midTime = await blockTimeNear(client, mid);
    if (midTime === null) return null;
    if (midTime < timestamp) low = mid;
    else high = mid;
  }

  return high;
}

/**
 * getBlockTime for a slot, or the nearest slot after it that has a block.
 * Skipped slots are normal on Solana and simply have no block time.
 */
async function blockTimeNear(client: HeliusClient, slot: number): Promise<number | null> {
  for (let offset = 0; offset < 12; offset++) {
    try {
      const time = await client.rpc<number | null>('getBlockTime', [slot + offset]);
      if (typeof time === 'number') return time;
    } catch {
      // Skipped or unavailable slot: step forward and try the next one.
    }
  }
  return null;
}
