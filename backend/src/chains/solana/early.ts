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

import { DETECTION, LIMITS } from '../../config.ts';
import type { EnhancedTransaction, HeliusClient, SignatureInfo } from './helius.ts';
import { chunk } from '../../util.ts';
import { isBurnAddress, knownProgramName } from './known-accounts.ts';
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
  /**
   * wallet -> decimal-adjusted tokens *net* taken during the launch window.
   *
   * Net, not gross: tokens cycle between wallets while a launch is happening,
   * and counting every inbound transfer made a set of bundlers appear to have
   * bought 126% of the supply. Subtracting what a wallet sent back keeps the
   * total bounded by what actually left the pool.
   */
  boughtByWallet: Map<string, number>;
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
  if (!creation.found || !creation.dev) {
    return { receipts: [], boughtByWallet: new Map(), devInitialUiAmount: 0, truncated: false };
  }

  // The window is the wider of the two detectors' needs: same-slot bundling and
  // the first N seconds. Signatures are already oldest-first.
  const maxSlot = creation.slot + DETECTION.bundleSlotWindow;
  const maxTime = creation.timestamp + DETECTION.sniperWindowSeconds;
  const inWindow = creation.signatures.filter((sig) => inEarlyWindow(sig, maxSlot, maxTime));

  return readEarlyWindow(
    client,
    mint,
    { dev: creation.dev, slot: creation.slot, timestamp: creation.timestamp },
    inWindow.map((sig) => sig.signature),
  );
}

/**
 * Derive the launch participants from a list of signatures.
 *
 * Shared by both ways of finding a launch — walking the token's history, and
 * scanning the blocks around its creation — so the two can never disagree
 * about who counts as a bundler.
 */
export async function readEarlyWindow(
  client: HeliusClient,
  mint: string,
  creation: { dev: string; slot: number; timestamp: number },
  signatures: readonly string[],
): Promise<EarlyWindow> {
  const truncated = signatures.length > LIMITS.maxEarlyTransactions;
  const selected = signatures.slice(0, LIMITS.maxEarlyTransactions);

  const batches = chunk(selected, 100);

  const parsed: EnhancedTransaction[] = [];
  // Sequential: these batches are large and Helius rate-limits them harder.
  for (const batch of batches) {
    parsed.push(...(await client.parsedTransactions(batch)));
  }

  const receipts: EarlyReceipt[] = [];
  const boughtByWallet = new Map<string, number>();
  let devInitialUiAmount = 0;

  for (const tx of parsed) {
    if (tx.transactionError) continue;

    for (const transfer of tx.tokenTransfers) {
      if (transfer.mint !== mint) continue;

      // Anything this wallet sent back out during the window offsets what it took.
      const sender = transfer.fromUserAccount;
      if (sender && sender !== transfer.toUserAccount && !isBurnAddress(sender)) {
        boughtByWallet.set(sender, (boughtByWallet.get(sender) ?? 0) - transfer.tokenAmount);
      }

      const wallet = transfer.toUserAccount;
      if (!wallet) continue;
      if (wallet === transfer.fromUserAccount) continue;
      if (isBurnAddress(wallet) || knownProgramName(wallet)) continue;

      boughtByWallet.set(wallet, (boughtByWallet.get(wallet) ?? 0) + transfer.tokenAmount);

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

  // A wallet that sent out more than it took nets negative; clamp so it reads
  // as "took nothing", never as a negative contribution to someone's total.
  for (const [wallet, amount] of boughtByWallet) {
    if (amount <= 0) boughtByWallet.delete(wallet);
  }

  return { receipts, boughtByWallet, devInitialUiAmount, truncated };
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
