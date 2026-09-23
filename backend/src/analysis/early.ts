/**
 * The early window: who received tokens right after the mint was created.
 *
 * This single pass feeds both bundler and sniper detection. We pull the parsed
 * form of every transaction in the window (Helius decodes the swap for us, so
 * we do not need a per-AMM IDL) and record each wallet that ended up holding
 * the mint.
 *
 * "Buyer" here means "received the token", which also covers airdrops and
 * transfers. That is deliberate for v1 — a wallet handed 5% of supply in the
 * first slot is exactly as interesting as one that bought it.
 */

import { DETECTION, LIMITS } from '../config.ts';
import type { EnhancedTransaction, HeliusClient, SignatureInfo } from '../helius.ts';
import { chunk } from '../util.ts';
import { isBurnAddress, knownProgramName } from '../known-accounts.ts';
import type { CreationResult } from './creation.ts';

export interface EarlyReceipt {
  wallet: string;
  slot: number;
  /** Unix seconds. */
  timestamp: number;
  /** Seconds after the creation transaction. */
  secondsAfterCreation: number;
  /** Decimal-adjusted amount received in this transaction. */
  uiAmount: number;
  signature: string;
}

export interface EarlyWindow {
  receipts: EarlyReceipt[];
  /** Decimal-adjusted tokens the dev received in the creation transaction and the window. */
  devInitialUiAmount: number;
  /** True when the window contained more transactions than we were willing to fetch. */
  truncated: boolean;
}

export async function analyzeEarlyWindow(
  client: HeliusClient,
  mint: string,
  creation: CreationResult,
): Promise<EarlyWindow> {
  if (!creation.found) return { receipts: [], devInitialUiAmount: 0, truncated: false };

  // The window is the wider of the two detectors' needs: same-slot bundling and
  // the first N seconds. Signatures are already oldest-first.
  const maxSlot = creation.slot + DETECTION.bundleSlotWindow;
  const maxTime = creation.timestamp + DETECTION.sniperWindowSeconds;

  const inWindow = creation.signatures.filter((sig) => inEarlyWindow(sig, maxSlot, maxTime));
  const truncated = inWindow.length > LIMITS.maxEarlyTransactions;
  const selected = inWindow.slice(0, LIMITS.maxEarlyTransactions);

  const batches = chunk(
    selected.map((s) => s.signature),
    100,
  );

  const parsed: EnhancedTransaction[] = [];
  // Sequential: these batches are large and Helius rate-limits them harder.
  for (const batch of batches) {
    parsed.push(...(await client.parsedTransactions(batch)));
  }

  const receipts: EarlyReceipt[] = [];
  let devInitialUiAmount = 0;

  for (const tx of parsed) {
    if (tx.transactionError) continue;

    for (const transfer of tx.tokenTransfers) {
      if (transfer.mint !== mint) continue;

      const wallet = transfer.toUserAccount;
      if (!wallet) continue;
      if (wallet === transfer.fromUserAccount) continue;
      if (isBurnAddress(wallet) || knownProgramName(wallet)) continue;

      if (wallet === creation.dev) {
        devInitialUiAmount += transfer.tokenAmount;
        continue; // The dev is reported separately, never as a bundler or sniper.
      }

      receipts.push({
        wallet,
        slot: tx.slot,
        timestamp: tx.timestamp,
        secondsAfterCreation: tx.timestamp - creation.timestamp,
        uiAmount: transfer.tokenAmount,
        signature: tx.signature,
      });
    }
  }

  return { receipts, devInitialUiAmount, truncated };
}

/**
 * A transaction counts as "early" if it is inside either window. blockTime can
 * be null on old snapshots, in which case the slot decides.
 */
function inEarlyWindow(sig: SignatureInfo, maxSlot: number, maxTime: number): boolean {
  if (sig.err) return false;
  if (sig.slot <= maxSlot) return true;
  return sig.blockTime !== null && sig.blockTime <= maxTime;
}
