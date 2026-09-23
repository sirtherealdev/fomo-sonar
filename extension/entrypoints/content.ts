/**
 * SCOPE Scanner content script.
 *
 * Step 2 scope: detect which token the user is looking at, including after
 * in-app navigation, and log it. No UI and no network calls yet — those land
 * in step 3, on top of exactly this detection.
 *
 * What this script does to the host page: nothing. It reads `location.href`,
 * and if that is not enough, it runs read-only queries over anchors and a few
 * data attributes. It adds no listeners to Fomo's elements, patches no globals,
 * and mutates no DOM.
 */

import { detectToken, type TokenRef } from '../lib/mint';
import { watchUrl } from '../lib/navigation';

/**
 * After an in-app navigation the URL changes before the new page has rendered.
 * When the URL alone does not carry the mint we re-check on this schedule
 * (milliseconds after the URL changed) and stop at the first hit.
 */
const DOM_RETRY_DELAYS_MS = [0, 250, 600, 1200, 2000];

const log = (...args: unknown[]): void => console.info('[scope]', ...args);

export default defineContentScript({
  matches: ['https://fomo.family/*'],
  runAt: 'document_idle',

  main() {
    log('active');

    let current: TokenRef | null = null;
    // Bumped on every navigation so a slow retry chain from the previous page
    // cannot report its mint after the user has already moved on.
    let generation = 0;

    watchUrl((url) => {
      const thisGeneration = ++generation;

      void resolveToken(url, () => generation === thisGeneration).then((token) => {
        if (generation !== thisGeneration) return;
        if (token?.address === current?.address && token?.chain === current?.chain) return;

        current = token;
        if (token) log(`token page: ${token.chain}:${token.address}`, '·', url);
        else log('not a token page:', url);
      });
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
