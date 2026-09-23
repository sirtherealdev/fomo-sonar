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

import type { AnalyzeResponse, ChainFamily, ChainId } from '@scope/shared';

export interface AdapterEnv {
  /** Solana. Undefined on deployments that do not analyse Solana. */
  HELIUS_API_KEY?: string | undefined;
  /** EVM chains. */
  EVM_RPC_URL?: string | undefined;
}

export interface ChainAdapter {
  readonly chain: ChainId;
  readonly family: ChainFamily;

  /** Is this string a plausible token address on this chain? Cheap, no network. */
  isValidAddress(address: string): boolean;

  /** Produce the full report. Throws ChainNotSupportedError if not implemented yet. */
  analyze(address: string, env: AdapterEnv): Promise<AnalyzeResponse>;
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
