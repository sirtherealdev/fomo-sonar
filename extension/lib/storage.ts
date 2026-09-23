/**
 * Where the panel sits, and whether it is folded up.
 *
 * chrome.storage.local, never localStorage: on a Fomo page `localStorage` is
 * *Fomo's* localStorage, and we promised never to read or write it. This is
 * also the only reason the extension asks for the `storage` permission.
 *
 * Every call is failure-tolerant. A panel that forgets its position is a minor
 * annoyance; a panel that throws on a storage hiccup and breaks the page is not.
 */

import { browser } from 'wxt/browser';
import { PANEL } from './config';

export interface PanelState {
  /** Distance from the viewport's right and top edges, in pixels. */
  right: number;
  top: number;
  collapsed: boolean;
}

const DEFAULT_STATE: PanelState = {
  right: PANEL.margin,
  top: PANEL.margin,
  collapsed: false,
};

export async function loadPanelState(): Promise<PanelState> {
  try {
    const stored = await browser.storage.local.get(PANEL.storageKey);
    const value = stored[PANEL.storageKey] as Partial<PanelState> | undefined;
    if (!value) return { ...DEFAULT_STATE };

    return {
      right: numberOr(value.right, DEFAULT_STATE.right),
      top: numberOr(value.top, DEFAULT_STATE.top),
      collapsed: value.collapsed === true,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function savePanelState(state: PanelState): Promise<void> {
  try {
    await browser.storage.local.set({ [PANEL.storageKey]: state });
  } catch {
    // Storage is unavailable; the panel simply will not remember its position.
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
