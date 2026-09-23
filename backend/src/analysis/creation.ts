/**
 * Finding the mint's creation transaction.
 *
 * Solana's RPC only returns signatures newest-first, so the only way to reach
 * a mint's first transaction is to page backwards until the history runs out.
 * For a token launched hours ago that is one or two calls. For a months-old
 * high-volume token it can be hundreds, so we cap it (LIMITS.maxSignaturePages)
 * and report "creation-not-found" instead of guessing — every downstream
 * detector that needs a t-zero degrades rather than inventing one.
 */

import { LIMITS } from '../config.ts';
import type { HeliusClient, SignatureInfo } from '../helius.ts';

export interface CreationResult {
  found: boolean;
  signature: string | null;
  /** Fee payer of the creation transaction: the dev wallet. */
  dev: string | null;
  slot: number;
  /** Unix seconds. */
  timestamp: number;
  /** Full signature history, oldest first. Empty when truncated. */
  signatures: SignatureInfo[];
  /** True when we hit the page cap before reaching the start of history. */
  truncated: boolean;
}

const NOT_FOUND: CreationResult = {
  found: false,
  signature: null,
  dev: null,
  slot: 0,
  timestamp: 0,
  signatures: [],
  truncated: true,
};

export async function findCreation(client: HeliusClient, mint: string): Promise<CreationResult> {
  const pages: SignatureInfo[] = [];
  let before: string | undefined;
  let reachedStart = false;

  for (let page = 0; page < LIMITS.maxSignaturePages; page++) {
    const batch = await client.getSignatures(mint, before);
    pages.push(...batch);

    // A short page means we have reached the beginning of this mint's history.
    if (batch.length < 1000) {
      reachedStart = true;
      break;
    }
    before = batch[batch.length - 1]?.signature;
    if (!before) {
      reachedStart = true;
      break;
    }
  }

  if (!reachedStart || pages.length === 0) return NOT_FOUND;

  // Oldest first, so index 0 is the mint creation.
  const signatures = pages.reverse();
  const creation = signatures[0];
  if (!creation) return NOT_FOUND;

  const [parsed] = await client.parsedTransactions([creation.signature]);
  if (!parsed) {
    return { ...NOT_FOUND, signatures, truncated: false };
  }

  return {
    found: true,
    signature: creation.signature,
    dev: parsed.feePayer,
    slot: parsed.slot || creation.slot,
    timestamp: parsed.timestamp || creation.blockTime || 0,
    signatures,
    truncated: false,
  };
}
