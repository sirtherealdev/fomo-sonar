/**
 * Reading an ERC-20's own state.
 *
 * Four things, three of which are a plain `eth_call`. The fourth — what powers
 * the deployer still holds — has no standard, so it is read from the deployed
 * bytecode by looking for the function selectors that grant them. That is a
 * heuristic and is labelled as one: a contract can hide these behind a proxy
 * or name them something else, so a clean result here means "we found none",
 * not "there are none".
 */

import type { EvmClient } from './rpc.ts';
import { hexToBigInt, hexToNumber, ZERO_ADDRESS } from './helpers.ts';

/** Function selectors, the first four bytes of keccak256 of the signature. */
const SELECTOR = {
  totalSupply: '0x18160ddd',
  decimals: '0x313ce567',
  owner: '0x8da5cb5b',
  balanceOf: '0x70a08231',
} as const;

/** Selectors whose presence in the bytecode means the power exists. */
const POWER_SELECTORS = {
  // mint(address,uint256) and mint(uint256)
  mint: ['40c10f19', 'a0712d68'],
  // pause(), setPaused(bool), blacklist(address), setBlacklist(address,bool)
  freeze: ['8456cb59', '16c38b3c', 'f9f92be4', '0ecb93c0'],
} as const;

export interface EvmToken {
  supply: bigint;
  decimals: number;
  /** Zero address or absent means ownership was renounced. */
  owner: string | null;
  canMintMore: boolean;
  canFreeze: boolean;
}

export async function readToken(client: EvmClient, token: string): Promise<EvmToken> {
  const [supplyHex, decimalsHex, code] = await Promise.all([
    client.call(token, SELECTOR.totalSupply),
    client.call(token, SELECTOR.decimals),
    client.codeAt(token, 'latest'),
  ]);

  // owner() is not part of ERC-20 and reverts on plenty of tokens.
  const ownerHex = await client.call(token, SELECTOR.owner).catch(() => '0x');
  const owner = ownerHex.length >= 42 ? `0x${ownerHex.slice(-40)}`.toLowerCase() : null;
  const renounced = owner === null || owner === ZERO_ADDRESS;

  const bytecode = code.toLowerCase();
  const has = (selectors: readonly string[]): boolean =>
    selectors.some((s) => bytecode.includes(s));

  return {
    supply: hexToBigInt(supplyHex),
    decimals: decimalsHex === '0x' ? 18 : hexToNumber(decimalsHex),
    owner: renounced ? null : owner,
    // A power nobody holds is not a power: both need an un-renounced owner.
    canMintMore: !renounced && has(POWER_SELECTORS.mint),
    canFreeze: !renounced && has(POWER_SELECTORS.freeze),
  };
}
