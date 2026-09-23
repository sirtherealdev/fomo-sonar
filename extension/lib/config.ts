/** Where the backend lives. The extension never talks to anything else. */
export const API_BASE = import.meta.env.DEV
  ? 'http://localhost:8787'
  : // TODO(deploy): replace with the deployed Worker domain before shipping.
    'https://api.scope-scanner.workers.dev';

/** Panel geometry defaults, used until the user drags it somewhere else. */
export const PANEL = {
  width: 300,
  margin: 16,
  storageKey: 'panel-state',
} as const;
