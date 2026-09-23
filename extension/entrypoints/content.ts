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

import { detectMint } from '../lib/mint';
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

    let currentMint: string | null = null;
    // Bumped on every navigation so a slow retry chain from the previous page
    // cannot report its mint after the user has already moved on.
    let generation = 0;

    watchUrl((url) => {
      const thisGeneration = ++generation;

      void resolveMint(url, () => generation === thisGeneration).then((mint) => {
        if (generation !== thisGeneration) return;
        if (mint === currentMint) return;

        currentMint = mint;
        if (mint) log('token page:', mint, '·', url);
        else log('not a token page:', url);
      });
    });
  },
});

/** Try the URL, then the DOM, backing off until the page has rendered. */
async function resolveMint(url: string, isCurrent: () => boolean): Promise<string | null> {
  for (const delay of DOM_RETRY_DELAYS_MS) {
    if (delay > 0) await sleep(delay);
    if (!isCurrent()) return null;

    const mint = detectMint(url);
    if (mint) return mint;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
