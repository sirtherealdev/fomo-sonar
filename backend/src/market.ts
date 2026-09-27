/**
 * Market data from DexScreener.
 *
 * Separate from helius.ts because it is a different trust level: a free public
 * API, no key, and entirely optional. If it is slow, rate-limited or down, the
 * risk analysis still returns — `market` is simply null. Nothing here can fail
 * an analysis.
 *
 * DexScreener is used rather than a Helius price feed because one call gives
 * price, market cap, liquidity, volume, per-window price change and buy/sell
 * counts, which is the whole headline strip.
 */

import type { ChainId, MarketInfo, TokenInfo } from '@sonar/shared';

const TOKENS_URL = 'https://api.dexscreener.com/latest/dex/tokens';
const ORDERS_URL = 'https://api.dexscreener.com/orders/v1';

/** Give up quickly: market data is a nice-to-have, the risk report is not. */
const TIMEOUT_MS = 4000;

interface DexPair {
  chainId: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  txns?: Record<string, { buys?: number; sells?: number }>;
  volume?: Record<string, number>;
  priceChange?: Record<string, number>;
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: { url?: string }[];
    socials?: { type?: string; url?: string }[];
  };
}

export interface MarketResult {
  market: MarketInfo | null;
  /** Name/symbol/image/socials, when the pair carries them. */
  token: Partial<TokenInfo>;
}

export async function fetchMarket(chain: ChainId, mint: string): Promise<MarketResult> {
  const [pairs, paidOrder] = await Promise.all([fetchPairs(mint), fetchDexPaid(chain, mint)]);

  // A token can trade in several pools. The deepest one is the honest quote.
  const solanaPairs = pairs.filter((p) => p.chainId === chain);
  const pair = [...solanaPairs].sort(
    (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
  )[0];

  if (!pair) return { market: null, token: {} };

  // The oldest pool is the launch; the deepest one may have come much later.
  const earliest = solanaPairs.reduce<number | null>(
    (oldest, p) =>
      p.pairCreatedAt && (oldest === null || p.pairCreatedAt < oldest) ? p.pairCreatedAt : oldest,
    null,
  );

  const market: MarketInfo = {
    priceUsd: toNumber(pair.priceUsd),
    marketCapUsd: pair.marketCap ?? null,
    fdvUsd: pair.fdv ?? null,
    liquidityUsd: pair.liquidity?.usd ?? null,
    volume24hUsd: pair.volume?.['h24'] ?? null,
    priceChange: {
      m5: pair.priceChange?.['m5'] ?? null,
      h1: pair.priceChange?.['h1'] ?? null,
      h6: pair.priceChange?.['h6'] ?? null,
      h24: pair.priceChange?.['h24'] ?? null,
    },
    txns24h: pair.txns?.['h24']
      ? { buys: pair.txns['h24'].buys ?? 0, sells: pair.txns['h24'].sells ?? 0 }
      : null,
    dexId: pair.dexId ?? null,
    pairAddress: pair.pairAddress ?? null,
    pairCreatedAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : null,
    firstPairCreatedAt: earliest ? new Date(earliest).toISOString() : null,
    dexPaid: dexPaid(paidOrder),
    source: 'dexscreener',
  };

  const token: Partial<TokenInfo> = {
    name: pair.baseToken?.name ?? null,
    symbol: pair.baseToken?.symbol ?? null,
    imageUrl: pair.info?.imageUrl ?? null,
    websites: (pair.info?.websites ?? []).flatMap((w) => (w.url ? [w.url] : [])),
    socials: (pair.info?.socials ?? []).flatMap((s) =>
      s.url ? [{ type: s.type ?? 'link', url: s.url }] : [],
    ),
  };

  return { market, token };
}

async function fetchPairs(mint: string): Promise<DexPair[]> {
  const json = await getJson<{ pairs?: DexPair[] | null }>(`${TOKENS_URL}/${mint}`);
  return json?.pairs ?? [];
}

/**
 * "Dex Paid": did anyone actually pay DexScreener for an Enhanced Token Info
 * order. Not a safety guarantee — it only says someone spent money on
 * presentation, which is still a useful "is this a five-minute throwaway"
 * signal.
 *
 * Only the orders endpoint decides this. An earlier version also treated the
 * presence of socials or a website on the pair as proof of payment, which was
 * wrong: launchpads and community submissions attach those to plenty of
 * tokens nobody ever paid for, so the flag fired on tokens whose profile had
 * merely been filled in. If the orders endpoint cannot be reached we return
 * null and the panel shows nothing, rather than guessing.
 */
function dexPaid(paidOrder: boolean | null): boolean | null {
  return paidOrder;
}

/** Orders endpoint only: approved tokenProfile purchases. */
async function fetchDexPaid(chain: ChainId, mint: string): Promise<boolean | null> {
  type Order = { type?: string; status?: string };
  // The endpoint has returned both a bare array and { orders: [...] } in the
  // wild, so accept either rather than trusting the documented shape.
  const body = await getJson<Order[] | { orders?: Order[] }>(`${ORDERS_URL}/${chain}/${mint}`);
  if (!body) return null;

  const orders = Array.isArray(body) ? body : (body.orders ?? []);
  if (!Array.isArray(orders)) return null;

  return orders.some((o) => o.type === 'tokenProfile' && o.status === 'approved');
}

/** Any failure returns null. Market data never throws into the analysis. */
async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
