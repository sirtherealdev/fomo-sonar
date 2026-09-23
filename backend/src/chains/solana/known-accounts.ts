/**
 * Accounts that must never be counted as "holders".
 *
 * Two mechanisms, because a hardcoded list always goes stale:
 *
 *  1. This explicit list, for burn addresses and program IDs we can name.
 *  2. A structural check in holders.ts: if a holder's account is not owned by
 *     the System Program, it is a PDA — an AMM vault, a bonding curve, a
 *     staking escrow — and not a person. That catches AMMs we have never heard
 *     of, which is most of them on any given week.
 */

export const SYSTEM_PROGRAM = '11111111111111111111111111111111';

/** Tokens sent here are provably unrecoverable. */
export const BURN_ADDRESSES = new Set<string>([
  '1nc1nerator11111111111111111111111111111111',
  SYSTEM_PROGRAM,
]);

/** Programs whose PDAs hold liquidity. Used for labelling, not for correctness. */
export const KNOWN_PROGRAMS = new Map<string, string>([
  ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'SPL Token'],
  ['TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 'SPL Token-2022'],
  ['ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'Associated Token Account'],
  ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', 'Pump.fun'],
  ['pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', 'Pump.fun AMM'],
  ['675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', 'Raydium AMM v4'],
  ['5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', 'Raydium AMM authority'],
  ['CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', 'Raydium CLMM'],
  ['CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C', 'Raydium CPMM'],
  ['LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', 'Meteora DLMM'],
  ['Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB', 'Meteora Pools'],
  ['whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', 'Orca Whirlpool'],
  ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', 'Jupiter Aggregator v6'],
]);

export function isBurnAddress(address: string): boolean {
  return BURN_ADDRESSES.has(address);
}

export function knownProgramName(address: string): string | undefined {
  return KNOWN_PROGRAMS.get(address);
}
