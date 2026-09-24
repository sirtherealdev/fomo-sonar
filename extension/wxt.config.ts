import { defineConfig } from 'wxt';

/**
 * Permissions are the whole trust story of this extension, so they get an
 * explicit comment each:
 *
 *  - permissions: ['storage'] — remembers the panel's position and collapsed
 *    state. We cannot use localStorage for this: on a Fomo page that IS Fomo's
 *    localStorage, and we promised never to touch it.
 *
 *  - No host_permissions. The content script's own `matches` grants what it
 *    needs on fomo.family, and the backend is reached with ordinary CORS
 *    (the Worker allow-lists the Fomo origin). Nothing else is required.
 *
 *  - Explicitly absent: <all_urls>, tabs, cookies, webRequest, scripting.
 */
export default defineConfig({
  manifest: {
    // The Store listing takes its title from here. 'for Fomo' rather than
    // 'Fomo' on purpose: it states the relationship without implying that
    // Fomo published it, which is what store review looks for.
    name: 'SONAR — Risk Scanner for Fomo',
    description: 'Read-only token risk overlay for Fomo Web. Reads the token address, nothing else.',
    permissions: ['storage'],
    // Placeholder marks from public/icon — replace before submitting.
    icons: {
      16: '/icon/16.png',
      32: '/icon/32.png',
      48: '/icon/48.png',
      128: '/icon/128.png',
    },
  },
});
