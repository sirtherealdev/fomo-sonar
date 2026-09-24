/**
 * Per-chain RPC configuration.
 *
 * These are public endpoints, measured rather than assumed — every limit below
 * came from probing the endpoint directly. They differ enough that the adapter
 * has to respect them individually: Base and BNB cap log queries at 2,000
 * blocks, Monad at 100, and no free public Ethereum endpoint would serve
 * historical logs at all.
 *
 * A chain only appears here once its endpoint has been shown to serve
 * historical data. BNB Chain and Arc are absent for that reason: their public
 * endpoints answer the current state happily and refuse every historical
 * request — state with HTTP 403, logs with the same — so a launch cannot be
 * read there at all. They are one endpoint away from working, not one feature.
 *
 * `holderReplay` says whether reconstructing the full holder set from Transfer
 * logs is realistic here. Where it is false the launch is still readable — a
 * ten-second window is a handful of blocks even on Monad — but concentration
 * is only available for tokens young enough to replay inside the budget.
 */

import type { ChainId } from '@scope/shared';

export interface EvmChain {
  chainId: number;
  rpcUrl: string;
  /** Maximum block span accepted by eth_getLogs on this endpoint. */
  maxLogRange: number;
  /**
   * Seconds per block, measured. Only a starting point — the launch search
   * measures the real rate at request time, because these drift and a
   * published figure was once out by a factor of twenty.
   */
  blockTimeSeconds: number;
  /** Whether a full holder reconstruction is practical on this endpoint. */
  holderReplay: boolean;
  /**
   * Requests per second this endpoint tolerates.
   *
   * Measured, not guessed: publicnode-backed endpoints start answering 403 —
   * not 429 — somewhere above a few requests a second, which reads as a
   * permissions error and is really a throttle.
   */
  requestsPerSecond: number;
}

export const EVM_CHAINS: Partial<Record<ChainId, EvmChain>> = {
  base: {
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    maxLogRange: 2000,
    blockTimeSeconds: 2,
    holderReplay: true,
    requestsPerSecond: 8,
  },
  robinhood: {
    chainId: 4663,
    rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
    maxLogRange: 2000,
    blockTimeSeconds: 0.1,
    holderReplay: true,
    requestsPerSecond: 5,
  },
  monad: {
    chainId: 143,
    rpcUrl: 'https://rpc.monad.xyz',
    // Measured: this endpoint rejects anything wider.
    maxLogRange: 100,
    blockTimeSeconds: 0.3,
    holderReplay: false,
    requestsPerSecond: 5,
  },
};

export function evmChain(chain: ChainId): EvmChain | undefined {
  return EVM_CHAINS[chain];
}
