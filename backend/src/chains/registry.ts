/**
 * Which chains this deployment can analyse.
 *
 * Adding a chain is one line here. Nothing else in the codebase branches on a
 * chain id — if you find yourself writing `if (chain === ...)` outside an
 * adapter, the abstraction has sprung a leak.
 */

import type { ChainId } from '@scope/shared';
import { solanaAdapter } from './solana/index.ts';
import { createEvmAdapter } from './evm/index.ts';
import { UnknownChainError, type ChainAdapter } from './types.ts';

/** The chains Fomo's own network switcher offers, and nothing else. */
const ADAPTERS: Record<ChainId, ChainAdapter> = {
  solana: solanaAdapter,
  base: createEvmAdapter('base'),
  bsc: createEvmAdapter('bsc'),
  monad: createEvmAdapter('monad'),
  robinhood: createEvmAdapter('robinhood'),
  arc: createEvmAdapter('arc'),
  ethereum: createEvmAdapter('ethereum'),
};

export function getAdapter(chain: string): ChainAdapter {
  const adapter = ADAPTERS[chain as ChainId];
  if (!adapter) throw new UnknownChainError(chain);
  return adapter;
}

export function supportedChains(): ChainId[] {
  return Object.keys(ADAPTERS) as ChainId[];
}

/** Chains whose adapter is actually implemented, for /health and the extension. */
export function implementedChains(): ChainId[] {
  return ['solana'];
}
