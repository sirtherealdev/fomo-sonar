/**
 * SCOPE Scanner API — Cloudflare Worker.
 *
 *   GET /analyze/:chain/:address
 *   GET /analyze/:address          (Solana, kept for the original clients)
 *
 * The Worker exists for exactly one reason: it holds the data-provider keys so
 * the extension does not have to. It stores nothing about users, sets no
 * cookies, and the only thing it ever receives is a public token address.
 */

import { Hono } from 'hono';
import { CACHE } from './config.ts';
import { HeliusError } from './chains/solana/helius.ts';
import { getAdapter, implementedChains, supportedChains } from './chains/registry.ts';
import { ChainNotSupportedError, UnknownChainError } from './chains/types.ts';
import type { AnalyzeResponse, ApiError } from '@scope/shared';

interface Env {
  /** Solana. */
  HELIUS_API_KEY: string;
  /** EVM chains. */
  EVM_RPC_URL?: string;
  /** Optional: the Worker runs without it, just uncached. */
  CACHE?: KVNamespace;
}

const app = new Hono<{ Bindings: Env }>();

/**
 * CORS: the content script's fetch carries the Fomo page origin; the
 * extension's own pages carry a chrome-extension:// origin. Nothing else needs
 * access, so nothing else gets it.
 */
const ALLOWED_ORIGINS = new Set(['https://fomo.family', 'https://www.fomo.family']);

app.use('*', async (c, next) => {
  const origin = c.req.header('origin');
  const allowed =
    origin !== undefined &&
    (ALLOWED_ORIGINS.has(origin) || origin.startsWith('chrome-extension://'));

  if (c.req.method === 'OPTIONS') {
    return allowed ? corsResponse(origin) : new Response(null, { status: 403 });
  }

  await next();

  if (allowed && origin) {
    c.res.headers.set('access-control-allow-origin', origin);
    c.res.headers.set('vary', 'origin');
  }
});

app.get('/health', (c) =>
  c.json({ ok: true, chains: supportedChains(), implemented: implementedChains() }),
);

app.get('/analyze/:chain/:address', (c) => analyze(c.env, c.executionCtx, c.req.param('chain'), c.req.param('address')));

// Original single-argument form. Solana was the only chain when it shipped.
app.get('/analyze/:address', (c) => analyze(c.env, c.executionCtx, 'solana', c.req.param('address')));

async function analyze(
  env: Env,
  // Only waitUntil is used; typing it structurally avoids the generic mismatch
  // between Hono's ExecutionContext and the workers-types one.
  ctx: { waitUntil(promise: Promise<unknown>): void },
  chain: string,
  address: string,
): Promise<Response> {
  let adapter;
  try {
    adapter = getAdapter(chain);
  } catch (err) {
    if (err instanceof UnknownChainError) {
      return json<ApiError>(
        { error: 'unknown_chain', message: `Supported chains: ${supportedChains().join(', ')}.` },
        400,
      );
    }
    throw err;
  }

  if (!adapter.isValidAddress(address)) {
    return json<ApiError>(
      { error: 'invalid_address', message: `Not a valid ${chain} token address.` },
      400,
    );
  }

  const cacheKey = `analyze:v2:${chain}:${address}`;
  const cached = await env.CACHE?.get(cacheKey);
  if (cached) {
    const body = JSON.parse(cached) as AnalyzeResponse;
    body.meta.cached = true;
    return json(body, 200);
  }

  try {
    const result = await adapter.analyze(address, {
      HELIUS_API_KEY: env.HELIUS_API_KEY,
      EVM_RPC_URL: env.EVM_RPC_URL,
    });

    ctx.waitUntil(
      env.CACHE?.put(cacheKey, JSON.stringify(result), {
        expirationTtl: Math.max(60, CACHE.ttlSeconds),
      }) ?? Promise.resolve(),
    );

    return json(result, 200);
  } catch (err) {
    if (err instanceof ChainNotSupportedError) {
      return json<ApiError>(
        { error: 'chain_not_implemented', message: `${chain} analysis is not available yet.` },
        501,
      );
    }
    if (err instanceof HeliusError) {
      console.error('provider error', { chain, address, message: err.message, status: err.status });
      return json<ApiError>(
        { error: 'upstream_error', message: 'On-chain data is temporarily unavailable.' },
        502,
      );
    }
    console.error('analysis failed', { chain, address, error: String(err) });
    return json<ApiError>({ error: 'analysis_failed', message: 'Could not analyse this token.' }, 500);
  }
}

app.notFound((c) => c.json<ApiError>({ error: 'not_found', message: 'No such endpoint.' }, 404));

function json<T>(body: T, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${CACHE.ttlSeconds}`,
    },
  });
}

function corsResponse(origin: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      vary: 'origin',
    },
  });
}

export default app;
