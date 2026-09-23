/**
 * EVM adapter — Base, BNB Chain, Ethereum, Monad.
 *
 * Not implemented yet. This file exists so the shape of the work is explicit
 * rather than hidden in a ticket, and so adding a chain is a registry entry
 * instead of a refactor.
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
 * reconstructed from logs or bought from an indexer.
 */

import type { ChainFamily, ChainId } from '@scope/shared';
import { ChainNotSupportedError, type AdapterEnv, type ChainAdapter } from '../types.ts';

/** 20 bytes of hex. Checksum is not validated: we only ever read, never send. */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function createEvmAdapter(chain: ChainId): ChainAdapter {
  return {
    chain,
    family: 'evm' satisfies ChainFamily,

    isValidAddress(address: string): boolean {
      return EVM_ADDRESS.test(address);
    },

    analyze(_address: string, _env: AdapterEnv): Promise<never> {
      return Promise.reject(new ChainNotSupportedError(chain));
    },
  };
}
