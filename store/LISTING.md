# Chrome Web Store listing copy

Everything here is text; the icons and screenshots are the only parts waiting
on the visual design.

---

## Name

SCOPE Scanner

## Short description (132 characters max)

See who is really holding a token — bundlers, snipers, dev wallet and holder
concentration — without leaving Fomo.

## Category

Developer Tools

## Detailed description

SCOPE Scanner adds a risk panel to token pages on Fomo Web. It answers the
question you actually have before you buy: who got in first, who is still
holding, and can anyone change the rules after you do.

**What it shows**

- **Dev wallet** — what the creator holds now, and how much of its initial
  allocation it has already sold.
- **Bundlers** — wallets that bought in the same block or slot as the launch.
  That is machine timing, not people reacting. Reported as both what they took
  and what they still hold, because a bundler that already dumped is evidence
  of a bundled launch, not of a clean one.
- **Funding clusters** — when one address paid for a dozen wallets that all
  bought at the same instant.
- **Snipers** — buyers inside the first seconds.
- **Holder concentration** — the top ten real wallets, with liquidity pools,
  burn addresses and program accounts excluded, because counting a pool as a
  holder makes every healthy token look rugged.
- **Fresh wallets** — holders created hours ago or with almost no history.
- **Token controls** — whether anyone can still mint new supply, freeze your
  balance, take tokens out of any wallet, or change the transfer tax.

**What it will not do**

It is read-only, and deliberately narrow. It never touches your wallet, never
reads your session, never clicks anything on the page, and never sees any site
but Fomo. The only permission it asks for is `storage`, used to remember where
you dragged the panel.

When it cannot measure something, it says so rather than showing a reassuring
zero — a token whose launch is unreadable is reported as unknown, not as safe.

The source is public. The permission list is three lines, and you can read it.

**Supported chains**

Solana, Base, BNB Chain, Ethereum, Monad, Arc and Robinhood Chain.

---

## Permission justifications

Chrome asks for these individually at submission.

**`storage`**
Stores the panel's position and whether the user collapsed it. Nothing else is
stored, and nothing is transmitted. The page's own `localStorage` is not used
because on a Fomo page that storage belongs to Fomo, and the extension does not
touch it.

**Host permission `https://fomo.family/*`**
The content script only runs on Fomo Web token pages, which is the only place
the panel makes sense. No other site is matched, and no broad host permission
is requested.

**Remote code**
None. The extension loads no external scripts and uses no `eval`. Everything
that runs is in the uploaded package.

**Data usage disclosures**
The extension does not collect personally identifiable information, health
information, financial or payment information, authentication information,
personal communications, location, web history, or user activity. It reads a
public token address from the page URL in order to look up public blockchain
data about that token.

---

## Screenshots

Three, 1280x800, in `store/screenshots/`. Each shows a different thing the
panel is for, rather than three views of the same report:

| file | shows |
| --- | --- |
| `risky.png` | a bundled launch — the signals, the funding clusters behind them, and a seizure delegate |
| `clean.png` | concentration with pools excluded, and a launch with nothing to flag |
| `unknown.png` | a token whose launch cannot be read, reported as unknown rather than as safe |

They use illustrative token data, not a verdict on any real token. Regenerate
with `extension/.preview/shot.html` after the visual design lands.

## Assets still needed

- [ ] Final icon set (16, 32, 48, 128 px) — placeholders in `extension/public/icon`
- [ ] Screenshots reshot on the final design
- [ ] Optional promotional tile, 440x280
- [ ] Privacy policy hosted at a public URL — text in `store/PRIVACY.md`
