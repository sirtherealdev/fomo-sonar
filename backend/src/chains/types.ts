/**
 * The seam between "what SCOPE reports" and "how a given chain answers it".
 *
 * Everything above this line is chain-agnostic: the response shape, the risk
 * scoring, the panel. Everything below it is one adapter per chain family,
 * because Solana and EVM share almost no primitives — slots vs blocks, SPL
 * mint accounts vs ERC-20 contracts, mint authority vs an un-renounced owner.
 *
 * Adding a chain means writing one adapter and registering it. Nothing else
 * in the codebase should ever branch on a chain id.
 */

import type { AnalyzeResponse, ChainFamily, ChainId } from '@sonar/shared';

/**
 * What happened at a token's launch never changes, so once we have paid to
 * work it out we should never pay again. Current holdings are recomputed on
 * every request — those are the part that moves.
 *
 * This exists because of a hard limit: RPC only returns signatures
 * newest-first, so reaching a token's first transaction means paging backwards
 * through its entire history. An active token outruns any sane page cap within
 * about a day, and dev, bundler and sniper detection go dark with it.
 *
 * A permanent cache turns that from a wall into a race we usually win: Fomo is
 * a launchpad, most tokens are looked at while they are young, and the first
 * person to open one locks the answer in for everyone after them.
 */
export interface StoredLaunch {
  signature: string;
  dev: string;
  slot: number;
  /** Unix seconds. */
  timestamp: number;
  /** Decimal-adjusted tokens the dev received at launch. */
  devInitialUiAmount: number;
  /** Wallets that bought in the creation slot window. */
  bundlers: string[];
  /** Wallets that bought within the sniper window, excluding bundlers. */
  snipers: string[];
  /** wallet -> decimal-adjusted tokens taken during the launch window. */
  bought: Record<string, number>;
  /** True when the launch window held more transactions than we fetched. */
  truncated: boolean;
  /**
   * How we found this launch. 'history' means we walked the token's signatures
   * back to its first transaction; 'block-scan' means the history was too long
   * and we jumped to the launch slot and read the blocks there instead.
   */
  source: 'history' | 'block-scan';
}

export interface LaunchCache {
  get(chain: ChainId, address: string): Promise<StoredLaunch | null>;
  put(chain: ChainId, address: string, value: StoredLaunch): Promise<void>;
}

export interface AdapterEnv {
  /** Solana. Undefined on deployments that do not analyse Solana. */
  HELIUS_API_KEY?: string | undefined;
  /** EVM chains, all six of them, through one Alchemy key. */
  ALCHEMY_API_KEY?: string | undefined;
  /** Optional: without it every analysis re-walks history from scratch. */
  launchCache?: LaunchCache | undefined;
}

export interface ChainAdapter {
  readonly chain: ChainId;
  readonly family: ChainFamily;

  /** Is this string a plausible token address on this chain? Cheap, no network. */
  isValidAddress(address: string): boolean;

  /**
   * Produce the full report. Throws ChainNotSupportedError if not implemented.
   *
   * `onPartial` is called once, as soon as everything that does not need
   * per-wallet lookups is ready — an adapter may skip it, and a caller may
   * ignore it. It always resolves to the complete report regardless.
   */
  analyze(
    address: string,
    env: AdapterEnv,
    onPartial?: ((partial: AnalyzeResponse) => void) | undefined,
  ): Promise<AnalyzeResponse>;
}

/** Thrown by an adapter that exists but cannot analyse yet. Maps to HTTP 501. */
export class ChainNotSupportedError extends Error {
  constructor(readonly chain: ChainId) {
    super(`Analysis for ${chain} is not implemented yet.`);
    this.name = 'ChainNotSupportedError';
  }
}

/** Thrown when the caller asks for a chain we have no adapter for. Maps to 400. */
export class UnknownChainError extends Error {
  constructor(chain: string) {
    super(`Unknown chain: ${chain}`);
    this.name = 'UnknownChainError';
  }
}
