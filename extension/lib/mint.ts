/**
 * Working out which token the user is looking at.
 *
 * This is the only thing the extension reads from the page, and it is read in
 * the narrowest way that works:
 *
 *  1. The URL. Preferred — it is unambiguous and needs no DOM access at all.
 *  2. Explorer links in the DOM. Fallback for routes that carry an internal id
 *     instead of the mint. A token page almost always links out to Solscan /
 *     Birdeye / DexScreener, and those links contain the real mint.
 *
 * Nothing else is touched. No cookies, no storage, no page state, no network
 * calls the page did not already make.
 */

/** 32 bytes of base58: 32-44 characters, no 0/O/I/l. */
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_ANYWHERE = /[1-9A-HJ-NP-Za-km-z]{32,44}/;

/**
 * Fomo token-page URL shapes.
 *
 * TODO(confirm): these are candidates until we have seen a real Fomo token
 * page. The list is ordered; the first pattern whose capture group is a valid
 * address wins. Adding a shape means adding one line here and nothing else.
 */
const URL_PATTERNS: readonly RegExp[] = [
  /\/token\/(?:[a-z]+\/)?([1-9A-HJ-NP-Za-km-z]{32,44})/i,
  /\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44})/i,
  /\/t\/([1-9A-HJ-NP-Za-km-z]{32,44})/i,
  /\/trade\/([1-9A-HJ-NP-Za-km-z]{32,44})/i,
];

/** Hosts whose links reliably carry a mint address in a known path position. */
const EXPLORER_PATTERNS: readonly RegExp[] = [
  /solscan\.io\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})/i,
  /birdeye\.so\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})/i,
  /dexscreener\.com\/solana\/([1-9A-HJ-NP-Za-km-z]{32,44})/i,
  /pump\.fun\/(?:coin\/)?([1-9A-HJ-NP-Za-km-z]{32,44})/i,
  /solana\.fm\/address\/([1-9A-HJ-NP-Za-km-z]{32,44})/i,
];

export function isValidAddress(value: string): boolean {
  return BASE58_ADDRESS.test(value);
}

/** Mint from the URL, or null if this is not a token page. */
export function mintFromUrl(url: string): string | null {
  for (const pattern of URL_PATTERNS) {
    const mint = pattern.exec(url)?.[1];
    if (mint && isValidAddress(mint)) return mint;
  }

  // Some apps carry the address in a query parameter instead of the path.
  try {
    for (const value of new URL(url).searchParams.values()) {
      if (isValidAddress(value)) return value;
    }
  } catch {
    // Malformed URL: nothing to read, and definitely nothing to throw over.
  }

  return null;
}

/**
 * Mint from outbound explorer links on the page. Read-only: one querySelectorAll
 * over anchors, no mutation, no listeners left behind.
 */
export function mintFromDom(root: ParentNode = document): string | null {
  const anchors = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'));

  for (const anchor of anchors) {
    const href = anchor.getAttribute('href');
    if (!href) continue;

    for (const pattern of EXPLORER_PATTERNS) {
      const mint = pattern.exec(href)?.[1];
      if (mint && isValidAddress(mint)) return mint;
    }
  }

  return null;
}

/**
 * Last resort: an element that exists purely to show or copy the contract
 * address. Matched by attribute rather than by class name, because class names
 * are generated and change on every Fomo deploy.
 */
export function mintFromCopyTarget(root: ParentNode = document): string | null {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>('[data-address], [data-mint], [data-token-address], [data-copy]'),
  );

  for (const element of candidates) {
    const values = [
      element.getAttribute('data-address'),
      element.getAttribute('data-mint'),
      element.getAttribute('data-token-address'),
      element.getAttribute('data-copy'),
      element.textContent,
    ];

    for (const value of values) {
      if (!value) continue;
      const match = BASE58_ANYWHERE.exec(value.trim())?.[0];
      if (match && isValidAddress(match)) return match;
    }
  }

  return null;
}

/** URL first, then the DOM fallbacks. Null means "not a token page". */
export function detectMint(url: string = location.href): string | null {
  return mintFromUrl(url) ?? mintFromDom() ?? mintFromCopyTarget();
}
