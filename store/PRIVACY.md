# SCOPE Scanner — Privacy Policy

_Last updated: 2026-09-25_

SCOPE Scanner does not collect, store, sell or share personal information.

## What the extension reads

One thing: the **token contract address** of the page you are looking at, taken
from the URL of a Fomo Web token page, or — only if the URL does not carry it —
from links already visible on that page.

That address is public information about a token, not about you.

## What the extension never touches

These are constraints on the code, not promises about intent. The extension:

- never reads cookies, `localStorage`, `sessionStorage`, or any Fomo session data
- never interacts with your wallet, and cannot approve, sign or send anything
- never clicks, types into, or submits anything on the page
- never reads pages other than `https://fomo.family/*` — it is not permitted to
- contains no analytics, no tracking, no advertising identifiers
- loads no remote code and uses no `eval`

The extension requests a single Chrome permission, `storage`, and uses it for
exactly one thing: remembering where you dragged the panel and whether you
collapsed it. That is stored on your own device and is never transmitted.

## What is sent over the network

One request, to our own backend:

```
GET https://scope-scanner-api.phillipk0.workers.dev/analyze/<chain>/<address>
```

It carries the chain name and the public token address, and nothing else — no
cookies, no credentials, no identifiers, no wallet address, no page contents.
The request is made with `credentials: 'omit'`.

Our backend forwards that address to public blockchain data providers
(Helius for Solana, Alchemy for EVM chains, DexScreener for market data) to
read public on-chain information about the token. It stores the analysis
result, keyed by token address, so that the next person to look at the same
token gets an answer faster. Nothing in that cache identifies a person.

Our server logs contain what any web server's logs contain — an IP address and
the requested path — and are used only to keep the service running and to stop
abuse. They are not used to build profiles and are not shared.

## Your data rights

We hold no personal data about you, so there is nothing to export or delete.
Removing the extension removes the panel position stored on your device.

## Changes

If this policy changes, the updated version will be published here and the
"last updated" date above will change.

## Contact

Open an issue on the project repository.
