/**
 * Which chains this deployment can analyse.
 *
 * Adding a chain is one line here. Nothing else in the codebase branches on a
 * chain id — if you find yourself writing `if (chain === ...)` outside an
 * adapter, the abstraction has sprung a leak.
 */

import type { ChainId } from '@sonar/shared';
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
 * Chains we can actually analyse, which depends on what is configured.
 *
 * With an Alchemy key, every EVM chain works. Without one, only those whose
 * free public endpoint serves history: BNB Chain, Arc and Ethereum will not,
 * and a launch cannot be read without it. A clear "not yet" beats a report
 * with its most useful half missing.
 */
export function implementedChains(hasEvmKey: boolean): ChainId[] {
  return hasEvmKey
    ? ['solana', 'base', 'bsc', 'ethereum', 'monad', 'arc', 'robinhood']
    : ['solana', 'base', 'monad', 'robinhood'];
}
