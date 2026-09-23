/**
 * SCOPE Scanner API — Cloudflare Worker.
 *
 * One public endpoint: GET /analyze/:mint.
 *
 * The Worker exists for exactly one reason: it holds the Helius key so the
 * extension does not have to. It stores nothing about users, sets no cookies,
 * and the only thing it ever receives is a public mint address.
 */

import { Hono } from 'hono';
import { CACHE } from './config.ts';
import { HeliusClient, HeliusError } from './helius.ts';
import { analyzeMint } from './analysis/index.ts';
import { isValidMint } from './util.ts';
import type { AnalyzeResponse, ApiError } from '@scope/shared';

interface Env {
  HELIUS_API_KEY: string;
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
    origin !== undefined && (ALLOWED_ORIGINS.has(origin) || origin.startsWith('chrome-extension://'));

  if (c.req.method === 'OPTIONS') {
    return allowed ? corsResponse(origin) : new Response(null, { status: 403 });
  }

  await next();

  if (allowed && origin) {
    c.res.headers.set('access-control-allow-origin', origin);
    c.res.headers.set('vary', 'origin');
  }
});

app.get('/health', (c) => c.json({ ok: true }));

app.get('/analyze/:mint', async (c) => {
  const mint = c.req.param('mint');

  if (!isValidMint(mint)) {
    return c.json<ApiError>({ error: 'invalid_mint', message: 'Not a Solana address.' }, 400);
  }

  const cacheKey = `analyze:v1:${mint}`;
  const cached = await c.env.CACHE?.get(cacheKey);
  if (cached) {
    const body = JSON.parse(cached) as AnalyzeResponse;
    body.meta.cached = true;
    return c.json(body, 200, { 'cache-control': `public, max-age=${CACHE.ttlSeconds}` });
  }

  try {
    const client = new HeliusClient(c.env.HELIUS_API_KEY);
    const result = await analyzeMint(client, mint);

    // Cache after responding would be nicer, but KV writes are cheap and this
    // keeps the code obvious. waitUntil avoids blocking the response.
    c.executionCtx.waitUntil(
      c.env.CACHE?.put(cacheKey, JSON.stringify(result), {
        expirationTtl: Math.max(60, CACHE.ttlSeconds),
      }) ?? Promise.resolve(),
    );

    return c.json(result, 200, { 'cache-control': `public, max-age=${CACHE.ttlSeconds}` });
  } catch (err) {
    if (err instanceof HeliusError) {
      console.error('helius error', { mint, message: err.message, status: err.status });
      return c.json<ApiError>(
        { error: 'upstream_error', message: 'On-chain data is temporarily unavailable.' },
        502,
      );
    }
    console.error('analysis failed', { mint, error: String(err) });
    return c.json<ApiError>(
      { error: 'analysis_failed', message: 'Could not analyse this token.' },
      500,
    );
  }
});

app.notFound((c) => c.json<ApiError>({ error: 'not_found', message: 'No such endpoint.' }, 404));

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
