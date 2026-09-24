/**
 * Per-chain RPC configuration.
 *
 * Two ways to reach a chain. With an Alchemy key we use `alchemyNetwork`:
 * archive access, generous log ranges, and — the reason it is not optional —
 * the endpoint identifies us by key rather than by IP. Public endpoints
 * throttle Cloudflare's shared egress immediately, so what works from a laptop
 * returns 429 from a Worker.
 *
 * `publicRpcUrl` is the fallback for local development without a key. Its
 * limits are measured, not assumed, and they vary sharply: Base allows 2,000
 * block log queries, Monad 100, and BNB, Arc and Ethereum serve no history at
 * all. Chains are marked `needsKey` when the public endpoint cannot support a
 * real analysis.
 */

import type { ChainId } from '@scope/shared';

export interface EvmChain {
  chainId: number;
  /** Alchemy network id, used when a key is configured. */
  alchemyNetwork: string;
  /** Free public endpoint, for local work without a key. */
  publicRpcUrl: string | null;
  /** True when the public endpoint cannot serve a usable analysis. */
  needsKey: boolean;
  /** Maximum block span accepted by eth_getLogs without a key. */
  maxLogRange: number;
  /**
   * Seconds per block. A starting point only — the launch search measures the
   * real rate per request, because these drift and one published figure was
   * out by a factor of twenty.
   */
  blockTimeSeconds: number;
  /** Requests per second to send when using the public endpoint. */
  requestsPerSecond: number;
}

export const EVM_CHAINS: Partial<Record<ChainId, EvmChain>> = {
  base: {
    chainId: 8453,
    alchemyNetwork: 'base-mainnet',
    publicRpcUrl: 'https://mainnet.base.org',
    needsKey: false,
    maxLogRange: 2000,
    blockTimeSeconds: 2,
    requestsPerSecond: 8,
  },
  bsc: {
    chainId: 56,
    alchemyNetwork: 'bnb-mainnet',
    // Serves current state and refuses every historical request.
    publicRpcUrl: null,
    needsKey: true,
    maxLogRange: 2000,
    blockTimeSeconds: 0.75,
    requestsPerSecond: 3,
  },
  ethereum: {
    chainId: 1,
    alchemyNetwork: 'eth-mainnet',
    publicRpcUrl: null,
    needsKey: true,
    maxLogRange: 2000,
    blockTimeSeconds: 12,
    requestsPerSecond: 3,
  },
  monad: {
    chainId: 143,
    alchemyNetwork: 'monad-mainnet',
    publicRpcUrl: 'https://rpc.monad.xyz',
    needsKey: false,
    maxLogRange: 100,
    blockTimeSeconds: 0.3,
    requestsPerSecond: 5,
  },
  arc: {
    chainId: 5042,
    alchemyNetwork: 'arc-mainnet',
    publicRpcUrl: null,
    needsKey: true,
    maxLogRange: 2000,
    blockTimeSeconds: 1,
    requestsPerSecond: 3,
  },
  robinhood: {
    chainId: 4663,
    alchemyNetwork: 'robinhood-mainnet',
    publicRpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
    needsKey: false,
    maxLogRange: 2000,
    blockTimeSeconds: 0.1,
    requestsPerSecond: 5,
  },
};

/**
 * The endpoint to use for a chain, and how hard to push it.
 *
 * An Alchemy key raises the log range too: 2,000 blocks is a public-endpoint
 * limit, not Alchemy's.
 */
export interface ResolvedEvmChain {
  chainId: number;
  url: string;
  requestsPerSecond: number;
  maxLogRange: number;
  blockTimeSeconds: number;
  /** Whether rebuilding the whole holder set is realistic here. */
  holderReplay: boolean;
  /**
   * Whether this endpoint offers alchemy_getAssetTransfers.
   *
   * Where it does, everything goes through it: eth_getLogs on a free plan
   * accepts a ten-block range, which cannot cover a launch window, let alone
   * a token's history.
   */
  useAssetTransfers: boolean;
}

export function endpointFor(
  chain: EvmChain,
  alchemyKey: string | undefined,
): ResolvedEvmChain | null {
  if (alchemyKey) {
    return {
      chainId: chain.chainId,
      url: `https://${chain.alchemyNetwork}.g.alchemy.com/v2/${alchemyKey}`,
      // The free plan allows 25/s; staying under it leaves room for retries.
      requestsPerSecond: 20,
      // Free-plan eth_getLogs is capped at ten blocks; we use the transfers
      // API instead, so this only matters as a fallback.
      maxLogRange: 10,
      blockTimeSeconds: chain.blockTimeSeconds,
      holderReplay: true,
      useAssetTransfers: true,
    };
  }

  if (!chain.publicRpcUrl || chain.needsKey) return null;
  return {
    chainId: chain.chainId,
    url: chain.publicRpcUrl,
    requestsPerSecond: chain.requestsPerSecond,
    maxLogRange: chain.maxLogRange,
    blockTimeSeconds: chain.blockTimeSeconds,
    // A hundred blocks a query cannot rebuild a holder set of any size.
    holderReplay: chain.maxLogRange >= 1000,
    useAssetTransfers: false,
  };
}

export function evmChain(chain: ChainId): EvmChain | undefined {
  return EVM_CHAINS[chain];
}
