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
import { ChainNotSupportedError, UnknownChainError, type LaunchCache, type StoredLaunch } from './chains/types.ts';
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

  const cacheKey = `analyze:v3:${chain}:${address}`;
  const cached = await env.CACHE?.get(cacheKey);
  if (cached) {
    const body = JSON.parse(cached) as AnalyzeResponse;
    body.meta.cached = true;
    return new Response(`${JSON.stringify(body)}\n`, {
      status: 200,
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': `public, max-age=${CACHE.ttlSeconds}`,
      },
    });
  }

  const adapterEnv = {
    HELIUS_API_KEY: env.HELIUS_API_KEY,
    EVM_RPC_URL: env.EVM_RPC_URL,
    launchCache: launchCacheFrom(env.CACHE),
  };

  /*
   * Streamed as newline-delimited JSON so the panel can render the cheap
   * signals immediately instead of staring at a skeleton for fifteen seconds.
   *
   * One request, one set of upstream calls: splitting this into two endpoints
   * would have meant paying Helius twice for the work the two phases share.
   *
   * The first object is the partial, the last is complete. A client that does
   * not care can read to the end and keep only the final line.
   */
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const line = (body: unknown): Promise<void> =>
    writer.write(encoder.encode(`${JSON.stringify(body)}\n`));

  /*
   * Race the first partial against the analysis finishing or failing.
   *
   * Once a response body starts streaming its status code is fixed, so
   * anything that can fail fast — an unimplemented chain, a bad key — has to
   * fail before the first byte goes out. Only a failure *after* the partial
   * has to be reported in-band, and by then the reader already has most of
   * the report.
   */
  let announcePartial: (partial: AnalyzeResponse) => void = () => {};
  const firstPartial = new Promise<AnalyzeResponse>((resolve) => {
    announcePartial = resolve;
  });

  const work = adapter.analyze(address, adapterEnv, announcePartial);
  // An unhandled rejection here would be fatal; the race below owns the error.
  work.catch(() => {});

  const started = await Promise.race([
    firstPartial.then((partial) => ({ kind: 'partial' as const, partial })),
    work.then(
      (result) => ({ kind: 'done' as const, result }),
      (error: unknown) => ({ kind: 'error' as const, error }),
    ),
  ]);

  if (started.kind === 'error') return errorResponse(started.error, chain, address);

  ctx.waitUntil(
    (async () => {
      try {
        if (started.kind === 'partial') await line(started.partial);
        const result = started.kind === 'done' ? started.result : await work;
        await line(result);

        await env.CACHE?.put(cacheKey, JSON.stringify(result), {
          expirationTtl: Math.max(60, CACHE.ttlSeconds),
        });
      } catch (err) {
        console.error('analysis failed mid-stream', { chain, address, error: String(err) });
        // The reader already has the partial; tell it the rest is not coming.
        await line({ error: 'analysis_failed', message: 'Could not finish this analysis.' });
      } finally {
        await writer.close();
      }
    })(),
  );

  return new Response(readable, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': `public, max-age=${CACHE.ttlSeconds}`,
    },
  });
}

function errorResponse(err: unknown, chain: string, address: string): Response {
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

app.notFound((c) => c.json<ApiError>({ error: 'not_found', message: 'No such endpoint.' }, 404));

/**
 * Launch facts, stored forever.
 *
 * Deliberately never expires: what happened at a token's launch is history,
 * and re-deriving it costs dozens of calls — or is impossible once the token's
 * history has outrun our signature cap. The first lookup of a young token
 * preserves its launch for every lookup after it.
 *
 * Shares the KV namespace with the response cache, under its own key prefix.
 */
function launchCacheFrom(kv: KVNamespace | undefined): LaunchCache | undefined {
  if (!kv) return undefined;

  const key = (chain: string, address: string): string => `launch:v2:${chain}:${address}`;

  return {
    async get(chain, address) {
      const stored = await kv.get(key(chain, address));
      return stored ? (JSON.parse(stored) as StoredLaunch) : null;
    },
    async put(chain, address, value) {
      await kv.put(key(chain, address), JSON.stringify(value));
    },
  };
}

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
