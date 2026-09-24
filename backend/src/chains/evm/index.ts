/**
 * EVM adapter — Base, BNB Chain, Ethereum, Monad.
 *
 * Implemented for the chains in chains.ts that have a usable public endpoint.
 * Ethereum is absent: no free public node would serve the historical logs
 * this needs, so it reports as unsupported rather than as an empty report.
 *
 * What each signal maps to on EVM:
 *
 *  - dev wallet      contract creation transaction's `from`
 *  - dev holding     balanceOf(deployer)
 *  - dev sold        deployer's outbound Transfer logs vs its initial balance
 *  - bundlers        buyers in the same block as the liquidity-add transaction
 *  - snipers         buyers within N seconds, by block timestamp
 *  - fresh wallets   eth_getTransactionCount — the nonce IS the exact tx count,
 *                    one call per wallet and cheaper than the Solana equivalent
 *  - funding source  first inbound transfer to the wallet (needs an indexer)
 *  - holders         replayed from Transfer logs since the deploy block; there
 *                    is no "all holders" RPC the way Solana's DAS provides one
 *  - security        un-renounced owner() plus the presence of a mint or pause
 *                    function, instead of mint/freeze authorities
 *
 * The one genuinely harder part than Solana is the holder set: it has to be
 * reconstructed from logs, which bounds how far back we can see.
 *
 * Insiders and funding clusters are not implemented. Both need a wallet's
 * first funding source, which on Solana is one signature lookup and on EVM
 * means tracing internal calls.
 */

import type { AnalyzeResponse, ChainFamily, ChainId } from '@scope/shared';
import { ChainNotSupportedError, type AdapterEnv, type ChainAdapter } from '../types.ts';
import { endpointFor, evmChain } from './chains.ts';
import { EvmClient } from './rpc.ts';
import { analyzeEvmToken } from './analyze.ts';

/** 20 bytes of hex. Checksum is not validated: we only ever read, never send. */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function createEvmAdapter(chain: ChainId): ChainAdapter {
  return {
    chain,
    family: 'evm' satisfies ChainFamily,

    isValidAddress(address: string): boolean {
      return EVM_ADDRESS.test(address);
    },

    analyze(
      address: string,
      env: AdapterEnv,
      onPartial?: ((partial: AnalyzeResponse) => void) | undefined,
    ): Promise<AnalyzeResponse> {
      const config = evmChain(chain);
      if (!config) return Promise.reject(new ChainNotSupportedError(chain));

      /*
       * Without a key, a chain is only supported if its public endpoint can
       * actually serve an analysis. Better to say "not yet" than to return a
       * report with its most useful half missing.
       */
      const endpoint = endpointFor(config, env.ALCHEMY_API_KEY);
      if (!endpoint) return Promise.reject(new ChainNotSupportedError(chain));

      // A per-request client keeps meta.rpcCalls per analysis rather than
      // cumulative across the Worker's lifetime.
      const client = new EvmClient(endpoint.url, endpoint.requestsPerSecond);
      return analyzeEvmToken(client, endpoint, chain, address, onPartial);
    },
  };
}
