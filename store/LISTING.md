# Chrome Web Store listing copy

Everything here is text; the icons are the only part waiting
on the visual design.

---

## Name

SONAR

## Short description (132 characters max)

See who is really holding a token — bundlers, snipers, dev wallet and holder
concentration — without leaving Fomo.

## Category

Developer Tools

## Detailed description

SONAR adds a risk panel to token pages on Fomo Web. It answers the
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

It covers seven of the chains Fomo Web supports, and the rest are being added.

---

## Do not list the chains by name

The first submission was rejected under "Spam and Placement in the Store" for
excessive keywords, quoting exactly this line:

> Solana, Base, BNB Chain, Ethereum, Monad, Arc and Robinhood Chain.

Seven brand names in a row reads as keyword stuffing to the automated check,
however factual it is. Name the chains on the website, not in the listing.

The replacement used to read "every chain Fomo Web supports", which was not
true: Fomo lists at least twelve and SONAR reads seven of them. It now says
"seven of the chains Fomo Web supports" — no brand names, and accurate.
Update the count here whenever an adapter lands.

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

Two, 1280x800, in `store/screenshots/`:

  * `01-on-the-page.jpg` — the whole Fomo token page with the panel open on it,
    which is the thing being sold: an overlay, not another tab.
  * `02-the-panel.jpg` — the panel itself, close enough to read every row.

Both are crops of one real capture, not mock-ups. The earlier three were
rendered illustrations, and an illustration cannot sit under a description
claiming the panel reads the launch transaction — it shows nothing of the kind.

Identifying details are pixelated with `scripts/redact.py`: the account's
picture, balances and positions, other traders' and clans' names, the token's
own name, and the holder addresses. No figure is altered. A real ticker beside
a HIGH dial would be a public accusation about somebody's project, which is
not ours to make in a Store listing.

## Assets still needed

- [x] Icon set (16, 32, 48, 128 px) — the logo mark, generated in the commit that added it
- [x] Screenshots reshot on the final design (real capture, 2026-09-28)
- [ ] Optional promotional tile, 440x280
- [x] Privacy policy at https://sonar-site-3zh.pages.dev/privacy (source: `store/PRIVACY.md`)
