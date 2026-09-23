# SCOPE Scanner

Read-only token risk overlay for [Fomo Web](https://fomo.family). Solana only for now.

The extension detects when you are on a token page, reads the mint address, and
shows on-chain risk data next to it: dev wallet, bundlers, holder concentration,
snipers, fresh wallets, and a combined risk score.

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
/extension   WXT extension (not started yet)
```

## Backend

`GET /analyze/:mint` returns the full report. See
[`shared/src/types.ts`](shared/src/types.ts) for the exact shape.

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
npm run analyze -- <mint>            # readable report
npm run analyze -- <mint> --json     # full response
npm run analyze -- <mintA> <mintB>   # compare several
```

### Run the API locally

```bash
npm run dev:api
curl localhost:8787/analyze/<mint> -H 'origin: https://fomo.family'
```

### Deploy

```bash
cd backend
npx wrangler kv namespace create CACHE   # paste the id into wrangler.toml
npx wrangler secret put HELIUS_API_KEY
npx wrangler deploy
```

## How the detection works

Each detector is one file in `backend/src/analysis/`, commented in place.

| Signal | Definition |
| --- | --- |
| **Dev wallet** | Fee payer of the mint's first transaction. Current holding, and how much of its initial allocation has left the wallet. |
| **Bundlers** | Wallets that received the token in the creation slot or within `bundleSlotWindow` slots — machine timing, not human. Plus funding clusters: bundlers whose first SOL came from the same address. |
| **Top holders** | Top 10 by balance, excluding burn addresses, known programs, and any account owned by a program rather than the System Program (which covers AMM vaults and bonding curves generically). |
| **Snipers** | Buyers inside the first `sniperWindowSeconds`, excluding bundlers so the score cannot count a wallet twice. |
| **Fresh wallets** | Holders with `<= freshWalletMaxTxCount` lifetime transactions, or first seen less than `freshWalletMaxAgeHours` ago. |
| **Risk score** | Weighted sum of the six percentages above, each through a safe→danger ramp. A signal we could not measure is dropped and its weight redistributed — never scored as zero. |

### Known limits

- Finding the creation transaction means paging backwards through the mint's
  signatures, because RPC only returns newest-first. Capped at
  `LIMITS.maxSignaturePages`; past that, dev/bundler/sniper detection reports
  `creation-not-found` rather than guessing.
- Dev "% sold" is measured against the allocation received in the launch
  window, so a dev who accumulated later is not counted.
- Every truncation and every unavailable detector appears in `warnings[]`, and
  `meta.partial` is true whenever the report is incomplete.
- A full analysis costs roughly 20–100 Helius calls (`meta.rpcCalls` reports the
  exact number). That exceeds the 50-subrequest limit on Cloudflare's free plan
  for busy tokens — the paid Workers plan allows 1000.
