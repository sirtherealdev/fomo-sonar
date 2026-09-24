/**
 * Where the backend lives. The extension never talks to anything else.
 *
 * Set WXT_API_BASE in extension/.env to point a build at your deployment:
 *
 *   WXT_API_BASE=https://sonar-api.you.workers.dev
 *
 * Without it, a development build talks to the local Worker and a production
 * build has nowhere to go — which is deliberate. A wrong URL baked into a
 * shipped extension is worse than a build that refuses to guess.
 */
const CONFIGURED = import.meta.env.WXT_API_BASE as string | undefined;

export const API_BASE = CONFIGURED ?? (import.meta.env.DEV ? 'http://localhost:8787' : '');

/** Panel geometry defaults, used until the user drags it somewhere else. */
export const PANEL = {
  width: 300,
  margin: 16,
  storageKey: 'panel-state-v2',
} as const;
