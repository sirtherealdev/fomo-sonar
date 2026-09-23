# SCOPE Scanner

Read-only token risk overlay for [Fomo Web](https://fomo.family).

Fomo supports seven chains — Solana, Base, BNB Chain, Monad, Robinhood Chain,
Arc and Ethereum. Six of those are EVM, so the backend needs two adapters, not
seven implementations. **Solana is implemented; the EVM adapter is a stub.**

The extension detects when you are on a token page, reads the mint address, and
shows the numbers you would otherwise open a second terminal for: price, market
cap, liquidity, holders, authority checks — plus the risk breakdown underneath
it (dev wallet, bundlers, insiders, snipers, fresh wallets, concentration).

## Trust rules

These are constraints on the code, not aspirations. They are why the extension
is auditable in an afternoon:

- **Read-only.** Never touches the wallet, never triggers a trade, never clicks
  or submits anything on the Fomo page.
- **No session data.** No cookies, no localStorage, no sessionStorage, no Fomo
  private APIs.
- **One input.** The token mint address, from the URL (or the DOM if needed).
- **Minimal permissions.** Host access to `https://fomo.family/*` and our own
  API domain. No `<all_urls>`, `tabs`, `cookies`, or `webRequest`.
- **No remote code.** No `eval`, no dynamically loaded scripts.
- **No keys in the extension.** Helius is only ever called from the backend.

## Layout

```
/shared      API response types, shared by both sides
/backend     Cloudflare Worker (Hono) + CLI validation harness
/extension   WXT extension (MV3, content script)
```

## Backend

```
GET /analyze/:chain/:address    # base, bsc, monad, robinhood, arc, ethereum -> 501 for now
GET /analyze/:address           # Solana, the original single-argument form
GET /health                     # which chains exist, and which are implemented
```

See [`shared/src/types.ts`](shared/src/types.ts) for the exact response shape.

Chain-specific code lives in `backend/src/chains/<chain>/` behind the
[`ChainAdapter`](backend/src/chains/types.ts) interface. Adding a chain is one
line in [`registry.ts`](backend/src/chains/registry.ts); nothing outside an
adapter branches on a chain id. What EVM needs, signal by signal, is written
down in [`chains/evm/index.ts`](backend/src/chains/evm/index.ts).

All thresholds and scoring weights live in
[`backend/src/config.ts`](backend/src/config.ts) — nothing tunable is hidden
anywhere else.

### Setup

```bash
npm install
cp backend/.dev.vars.example backend/.dev.vars   # then paste your Helius key
```

### Validate the detection logic

The CLI runs the same code the Worker runs, without deploying anything:

```bash
npm run analyze -- <address>                  # readable report (Solana)
npm run analyze -- <address> --json           # full response
npm run analyze -- <a> <b>                    # compare several
npm run analyze -- <address> --chain=base     # other chains, once implemented
```

### Run the API locally

```bash
npm run dev:api
curl localhost:8787/analyze/solana/<address> -H 'origin: https://fomo.family'
```

### Deploy

```bash
cd backend
npx wrangler kv namespace create CACHE   # paste the id into wrangler.toml
npx wrangler secret put HELIUS_API_KEY
npx wrangler deploy
```

## Extension

```bash
npm run dev:ext                 # loads an unpacked build with hot reload
npm test -w @scope/extension    # address/chain detection tests
```

The panel lives in a **closed** shadow root: Fomo's CSS cannot reach in, ours
cannot leak out, and the host page can neither read nor restyle it. It is
draggable by its header and remembers where you left it.

Token names and symbols come from third-party indexes, so everything dynamic is
written with `textContent` and never `innerHTML` — a token called
`<img onerror=...>` is displayed, not executed.

The generated manifest is deliberately tiny — this is the whole of it:

```json
{
  "manifest_version": 3,
  "permissions": ["storage"],
  "content_scripts": [{ "matches": ["https://fomo.family/*"], "run_at": "document_idle" }]
}
```

`storage` holds the panel position and collapsed state. It cannot be
localStorage: on a Fomo page that *is* Fomo's localStorage, which we promised
never to touch. There are no `host_permissions` — the content script's own
match covers the page, and the backend is reached over ordinary CORS.

Two implementation notes that are load-bearing for the trust story:

- **No monkey-patching.** Fomo is an SPA, and the usual way to follow its
  navigation is to wrap `history.pushState`. That object is shared with the
  page, so we poll `location.href` instead
  ([navigation.ts](extension/lib/navigation.ts)). Invisible to the page, and
  it cannot break trading.
- **Reading the mint is URL-first** ([mint.ts](extension/lib/mint.ts)). Only
  when the route does not carry the address do we fall back to read-only DOM
  queries over outbound explorer links.

## How the detection works

Each detector is one file in `backend/src/analysis/`, commented in place.

| Signal | Definition |
| --- | --- |
| **Dev wallet** | Fee payer of the mint's first transaction. Current holding, and how much of its initial allocation has left the wallet. |
| **Bundlers** | Wallets that received the token in the creation slot or within `bundleSlotWindow` slots — machine timing, not human. Reported as both what they took at launch and what they still hold, and scored on the worse of the two: a bundler that already dumped is evidence of a bundled launch, not of a clean one. Plus funding clusters: bundlers whose first SOL came from the same address. |
| **Top holders** | Top 10 by balance, excluding burn addresses, known programs, and any account owned by a program rather than the System Program (which covers AMM vaults and bonding curves generically). Large positions held by very busy wallets are *labelled* as likely exchange or protocol accounts, never silently removed — see below. |
| **Snipers** | Buyers inside the first `sniperWindowSeconds`, excluding bundlers so the score cannot count a wallet twice. |
| **Fresh wallets** | Holders with `<= freshWalletMaxTxCount` lifetime transactions, or first seen less than `freshWalletMaxAgeHours` ago. |
| **Insiders** | Notable wallets whose first SOL came from the dev, plus the dev's own funder when it also holds. One hop only — deeper graph walks mostly find exchange hot wallets. |
| **Authorities** | Can anyone still mint more supply or freeze balances? On Solana that is the mint and freeze authorities; on EVM it is an un-renounced owner. The panel sees one chain-neutral answer. |
| **Risk score** | Weighted sum of the percentages above, each through a safe→danger ramp, plus per-signal **critical floors**: if one signal is severe enough on its own, the score cannot fall below its floor. Without that, a weighted sum over eight factors averages one catastrophic signal into a reassuring "medium". A signal we could not measure is dropped and its weight redistributed — never scored as zero. |

### Headline data

Alongside the risk breakdown, `/analyze/:mint` returns what a trading terminal
would show up top:

| Field | Source |
| --- | --- |
| Name, symbol, image, socials, website | DexScreener pair info, falling back to Helius DAS |
| Price, market cap, FDV, liquidity, 24h volume | DexScreener, deepest Solana pool |
| Price change 5m / 1h / 6h / 24h, 24h buys vs sells | DexScreener |
| DEX, pair address, pair age, "dex paid" | DexScreener |
| Holder count | Our own holder map |
| Mint / freeze authority | The mint account itself |

DexScreener needs no API key and is called only from the backend. It is
strictly best-effort: if it is slow or down, `market` comes back `null` and the
risk report is unaffected.

### Exchange and protocol wallets

The structural pool test (an account owned by a program rather than the System
Program is a PDA, not a person) catches AMM vaults and bonding curves
generically. It does not catch infrastructure that runs on ordinary keypairs —
exchange hot wallets, market makers, launchpad treasuries — which look exactly
like one whale holding most of the supply.

We label these rather than exclude them: a holder that is both very busy and
holding a large share is marked `highActivity`, and the report carries a
warning saying so. Excluding them would silently reshape the concentration
number on a guess we cannot prove from chain data.

Both halves of the test matter. Activity alone labelled five ordinary 2–3%
holders on a real token, because an active memecoin trader has thousands of
transactions — a label that fires that often teaches people to ignore it.

### Known limits

- Finding the creation transaction means paging backwards through the mint's
  signatures, because RPC only returns newest-first. Capped at
  `LIMITS.maxSignaturePages`; past that, dev/bundler/sniper detection reports
  `creation-not-found` rather than guessing.
- Dev "% sold" is measured against the allocation received in the launch
  window, so a dev who accumulated later is not counted.
- Every truncation and every unavailable detector appears in `warnings[]`, and
  `meta.partial` is true whenever the report is incomplete.
- **LP burned is not implemented yet.** Reading it means decoding each AMM's
  pool layout to find the LP mint, and a wrong number here is worse than a
  missing one. It is the next headline field worth adding.
- A full analysis costs roughly 20–100 Helius calls (`meta.rpcCalls` reports the
  exact number). That exceeds the 50-subrequest limit on Cloudflare's free plan
  for busy tokens — the paid Workers plan allows 1000.
