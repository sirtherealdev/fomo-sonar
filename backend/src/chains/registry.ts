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

/**
 * Chains we can actually analyse right now.
 *
 * Ethereum, BNB Chain and Arc are deliberately absent. The EVM adapter runs
 * them fine; their free public endpoints will not serve historical state or
 * logs, and a launch cannot be read without one of those. A clear "not yet"
 * beats a report with its most useful half missing.
 */
export function implementedChains(): ChainId[] {
  return ['solana', 'base', 'monad', 'robinhood'];
}
