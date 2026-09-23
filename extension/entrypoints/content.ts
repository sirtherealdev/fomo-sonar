/**
 * SCOPE Scanner content script.
 *
 * Detects which token the user is looking at — including after in-app
 * navigation — asks our backend about it, and renders the result in a closed
 * shadow root.
 *
 * What this script does to the host page: appends one custom element to
 * <html>, and nothing else. It reads `location.href`, and when that is not
 * enough, runs read-only queries over anchors and a few data attributes. It
 * adds no listeners to Fomo's elements, patches no globals, reads no storage
 * of Fomo's, and never interacts with the wallet.
 */

import { analyze } from '../lib/api';
import { detectToken, type TokenRef } from '../lib/mint';
import { createPanel, type Panel } from '../lib/panel';
import { watchUrl } from '../lib/navigation';

/**
 * After an in-app navigation the URL changes before the new page has rendered.
 * When the URL alone does not carry the address we re-check on this schedule
 * (milliseconds after the URL changed) and stop at the first hit.
 */
const DOM_RETRY_DELAYS_MS = [0, 250, 600, 1200, 2000];

export default defineContentScript({
  matches: ['https://fomo.family/*'],
  runAt: 'document_idle',

  async main() {
    let panel: Panel | null = null;
    let current: TokenRef | null = null;
    // Bumped on every navigation, so a slow request from the previous token
    // cannot paint its result over the page the user is now looking at.
    let generation = 0;
    let inFlight: AbortController | null = null;

    watchUrl((url) => {
      const thisGeneration = ++generation;
      inFlight?.abort();

      void (async () => {
        const token = await resolveToken(url, () => generation === thisGeneration);
        if (generation !== thisGeneration) return;

        if (!token) {
          current = null;
          panel?.hide();
          return;
        }

        // Same token, already on screen: leave it alone rather than reflowing.
        if (token.address === current?.address && token.chain === current.chain) return;
        current = token;

        // The panel is created on the first token page, not on every Fomo page.
        panel ??= await createPanel();
        if (generation !== thisGeneration) return;
        panel.showLoading(shortLabel(token.address));

        inFlight = new AbortController();
        const shown = panel;

        // Two results arrive: a partial within a few seconds, then the
        // complete one. Each repaints the panel in place.
        await analyze(token.chain, token.address, inFlight.signal, (result) => {
          if (generation !== thisGeneration) return;
          // An aborted request means the user already moved on.
          if (result.status === 'error' && result.message === 'cancelled') return;
          shown.showResult(result);
        });
      })();
    });
  },
});

/** Try the URL, then the DOM, backing off until the page has rendered. */
async function resolveToken(url: string, isCurrent: () => boolean): Promise<TokenRef | null> {
  for (const delay of DOM_RETRY_DELAYS_MS) {
    if (delay > 0) await sleep(delay);
    if (!isCurrent()) return null;

    const token = detectToken(url);
    if (token) return token;
  }
  return null;
}

function shortLabel(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
