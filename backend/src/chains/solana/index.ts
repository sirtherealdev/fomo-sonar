/** Solana adapter: wires the Solana analysis behind the chain-agnostic interface. */

import { HeliusClient } from './helius.ts';
import { analyzeMint } from './analyze.ts';
import type { AnalyzeResponse, ChainFamily, ChainId } from '@scope/shared';
import type { AdapterEnv, ChainAdapter } from '../types.ts';

/** 32 bytes of base58: 32-44 characters, excluding 0, O, I and l. */
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const solanaAdapter: ChainAdapter = {
  chain: 'solana' satisfies ChainId,
  family: 'svm' satisfies ChainFamily,

  isValidAddress(address: string): boolean {
    return BASE58_ADDRESS.test(address);
  },

  analyze(address: string, env: AdapterEnv): Promise<AnalyzeResponse> {
    // Constructing the client here (not at module scope) keeps meta.rpcCalls
    // per-request rather than cumulative across the Worker's lifetime.
    return analyzeMint(new HeliusClient(env.HELIUS_API_KEY ?? ''), address, env.launchCache);
  },
};
