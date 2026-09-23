/**
 * Watching for navigation inside a single-page app.
 *
 * Fomo changes the URL without a page load, so a content script that runs once
 * sees the first token page and then goes blind.
 *
 * We deliberately do NOT monkey-patch history.pushState / replaceState. The
 * History object is shared with the page, and rewriting the host app's
 * navigation primitives is exactly the class of thing a wallet-adjacent
 * extension must never do — one bug there breaks trading for the user. Polling
 * `location.href` is invisible to the page, costs nothing measurable, and
 * cannot break anything.
 */

const POLL_INTERVAL_MS = 400;

export type UrlListener = (url: string) => void;

/** Calls `onChange` immediately, then whenever the URL changes. Returns a stop function. */
export function watchUrl(onChange: UrlListener): () => void {
  let current = location.href;
  onChange(current);

  const check = (): void => {
    if (location.href === current) return;
    current = location.href;
    onChange(current);
  };

  const timer = setInterval(check, POLL_INTERVAL_MS);
  // popstate catches back/forward instantly instead of up to one poll late.
  window.addEventListener('popstate', check);

  return () => {
    clearInterval(timer);
    window.removeEventListener('popstate', check);
  };
}
