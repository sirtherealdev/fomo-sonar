/** Display helpers. Pure functions, no DOM. */

/** $1.23K / $4.56M / $7.89B, and sub-dollar prices keep their significant digits. */
export function usd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';

  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  if (abs >= 1) return `$${value.toFixed(2)}`;
  if (abs === 0) return '$0';
  // A memecoin price is often 0.0000000123: show it rather than $0.00.
  return `$${value.toPrecision(3)}`;
}

export function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(value < 10 ? 2 : 1)}%`;
}

export function signedPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US');
}

/** 4 leading and 4 trailing characters, which is how every Solana UI does it. */
export function shortAddress(address: string | null | undefined): string {
  if (!address) return '—';
  return address.length <= 12 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}
