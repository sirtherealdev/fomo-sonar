/**
 * A file-backed launch cache for the CLI.
 *
 * The Worker uses Workers KV for this; the CLI uses a JSON file so local runs
 * behave the same way — and so validating a token twice does not re-walk its
 * entire signature history.
 */

import { readFile, writeFile } from 'node:fs/promises';
import type { LaunchCache, StoredLaunch } from '../src/chains/types.ts';

const FILE = new URL('../.launch-cache.json', import.meta.url);

type Store = Record<string, StoredLaunch>;

async function read(): Promise<Store> {
  try {
    return JSON.parse(await readFile(FILE, 'utf8')) as Store;
  } catch {
    return {}; // No cache file yet, or it is unreadable. Either way: start empty.
  }
}

export const fileLaunchCache: LaunchCache = {
  async get(chain, address) {
    return (await read())[`${chain}:${address}`] ?? null;
  },
  async put(chain, address, value) {
    const store = await read();
    store[`${chain}:${address}`] = value;
    await writeFile(FILE, JSON.stringify(store, null, 2));
  },
};
