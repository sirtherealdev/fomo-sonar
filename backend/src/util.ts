/** Small shared helpers. No network, no state. */

/** Run `fn` over `items` with a fixed number of requests in flight. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index] as T, index);
    }
  });

  await Promise.all(workers);
  return results;
}

/** Share of `total` as a 0..100 percentage, rounded to 2dp. Safe on bigint and 0. */
export function pctOf(amount: bigint, total: bigint): number {
  if (total === 0n) return 0;
  // Scale before dividing so integer division does not floor the answer away.
  const scaled = (amount * 1_000_000n) / total;
  return round2(Number(scaled) / 10_000);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Split an array into chunks of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** A base58 Solana address is 32 bytes, which encodes to 32-44 characters. */
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidMint(value: string): boolean {
  return BASE58_ADDRESS.test(value);
}
