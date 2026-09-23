/**
 * The panel.
 *
 * Rendered into a *closed* shadow root attached to a custom element, so Fomo's
 * CSS cannot reach in and ours cannot leak out. The host page can neither read
 * nor restyle what is inside.
 *
 * Two rules this file follows without exception:
 *
 *  1. Never `innerHTML` with data. Token names, symbols and addresses come
 *     from third-party indexes and are therefore untrusted strings. Everything
 *     dynamic goes in through `textContent`, so a token called
 *     `<img onerror=...>` is displayed, not executed.
 *  2. Never touch the host page. The panel appends one element to
 *     documentElement and mutates nothing else. Drag listeners live on our own
 *     element and are removed when the drag ends.
 */

import { PANEL } from './config';
import { PANEL_STYLES } from './panel.styles';
import { count, pct, shortAddress } from './format';
import { loadPanelState, savePanelState, type PanelState } from './storage';
import type { AnalyzeResult } from './api';
import type { AnalyzeResponse, CountAndHolding } from '@scope/shared';

export interface Panel {
  showLoading(label: string): void;
  showResult(result: AnalyzeResult): void;
  hide(): void;
  destroy(): void;
}

export async function createPanel(): Promise<Panel> {
  const state = await loadPanelState();

  const host = document.createElement('scope-scanner-panel');
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = PANEL_STYLES;

  const panel = el('div', 'panel');
  panel.style.setProperty('--panel-width', `${PANEL.width}px`);

  const header = el('div', 'header');
  const brand = el('span', 'brand', 'SCOPE');
  const ticker = el('span', 'ticker');
  const pill = el('span', 'pill muted', '—');
  const toggle = document.createElement('button');
  toggle.className = 'toggle';
  toggle.type = 'button';
  toggle.textContent = state.collapsed ? '+' : '–';
  toggle.setAttribute('aria-label', state.collapsed ? 'Expand' : 'Collapse');

  header.append(brand, ticker, el('span', 'spacer'), pill, toggle);

  const body = el('div', 'body');
  panel.append(header, body);
  shadow.append(style, panel);

  applyPosition(host, state);
  if (state.collapsed) panel.classList.add('collapsed');
  host.style.display = 'none';
  document.documentElement.append(host);

  toggle.addEventListener('click', () => {
    state.collapsed = !state.collapsed;
    panel.classList.toggle('collapsed', state.collapsed);
    toggle.textContent = state.collapsed ? '+' : '–';
    toggle.setAttribute('aria-label', state.collapsed ? 'Expand' : 'Collapse');
    void savePanelState(state);
  });

  const stopDragging = makeDraggable(header, host, state);

  return {
    showLoading(label: string): void {
      host.style.display = '';
      ticker.textContent = label;
      setPill(pill, 'muted', 'scanning');
      render(body, skeleton());
    },

    showResult(result: AnalyzeResult): void {
      host.style.display = '';

      if (result.status === 'unsupported') {
        setPill(pill, 'muted', result.chain);
        render(body, notice(`Risk analysis for ${result.chain} is not available yet.`));
        return;
      }

      if (result.status === 'error') {
        setPill(pill, 'muted', '—');
        render(body, notice("Can't analyse this token."));
        return;
      }

      const data = result.data;
      ticker.textContent = data.token.symbol ?? shortAddress(data.mint);
      setPill(pill, data.riskLevel, data.riskLevel);
      render(body, report(data));
    },

    hide(): void {
      host.style.display = 'none';
    },

    destroy(): void {
      stopDragging();
      host.remove();
    },
  };
}

// --- Rendering ---------------------------------------------------------------

/**
 * Deliberately no price, market cap, liquidity or volume.
 *
 * Fomo prints all four in its own header, a couple of centimetres above this
 * panel. Repeating them would spend half the width on numbers the reader can
 * already see, and the only reason to install this is the half Fomo does not
 * show. The backend still returns the market block; the panel just ignores it.
 */
function report(data: AnalyzeResponse): Node[] {
  const nodes: Node[] = [score(data), el('div', 'divider'), signals(data)];

  const holders = topHolderList(data);
  if (holders) nodes.push(el('div', 'divider'), holders);

  const clusters = fundingClusters(data);
  if (clusters) nodes.push(el('div', 'divider'), clusters);

  const flags = securityFlags(data);
  if (flags) nodes.push(flags);

  if (data.warnings.length > 0) nodes.push(warnings(data.warnings));

  nodes.push(footer(data));
  return nodes;
}

/** The actual wallets behind the concentration number. */
function topHolderList(data: AnalyzeResponse): HTMLElement | null {
  if (data.topHolders.list.length === 0) return null;

  const wrap = el('div', 'block');
  wrap.append(el('div', 'block-title', 'Top holders'));

  for (const holder of data.topHolders.list.slice(0, 5)) {
    const line = el('div', 'holder');
    line.append(el('span', 'mono', shortAddress(holder.address)), el('span', 'figure', pct(holder.pct)));
    if (holder.highActivity) line.append(el('span', 'tag', 'exchange?'));
    wrap.append(line);
  }

  if (data.topHolders.excluded.length > 0) {
    wrap.append(
      el('div', 'note', `${data.topHolders.excluded.length} pool or program account(s) excluded`),
    );
  }

  return wrap;
}

/**
 * Who paid for the bundlers. One address funding a dozen wallets that all
 * bought in the same slot is the clearest bundling evidence there is, and it
 * is the one thing here that no other panel on the page can tell you.
 */
function fundingClusters(data: AnalyzeResponse): HTMLElement | null {
  if (data.bundles.clusters.length === 0) return null;

  const wrap = el('div', 'block');
  wrap.append(el('div', 'block-title', 'Funding clusters'));

  for (const cluster of data.bundles.clusters.slice(0, 3)) {
    const line = el('div', 'holder');
    line.append(
      el('span', 'mono', shortAddress(cluster.funder)),
      el('span', 'sub', `${count(cluster.wallets.length)} wallets`),
      el('span', 'figure', pct(cluster.holdingPct)),
    );
    wrap.append(line);
  }

  return wrap;
}

function score(data: AnalyzeResponse): HTMLElement {
  const wrap = el('div', 'score');

  // Withhold the number too, not just the label: a reader takes "12" as a
  // verdict no matter what the caption underneath says.
  if (data.riskLevel === 'unknown') {
    const meta = el('div', 'meta');
    meta.append(
      el('div', 'caption', `Only ${Math.round(data.coverage)}% of the risk signals could be measured for this token.`),
    );
    wrap.append(el('div', 'number unknown', '?'), meta);
    return wrap;
  }

  const number = el('div', `number ${data.riskLevel}`, String(data.riskScore));

  const bar = el('div', 'bar');
  const fill = el('span', data.riskLevel);
  fill.style.width = `${Math.max(2, Math.min(100, data.riskScore))}%`;
  bar.append(fill);

  const meta = el('div', 'meta');
  // Naming the reason turns a number into something actionable. A forced floor
  // is always the reason when there is one: it is what set the score.
  const top = [...data.factors].sort((a, b) => b.points - a.points)[0];
  const reason = data.scoreFloor
    ? `${factorLabel(data.scoreFloor.key)} alone`
    : top
      ? `driven by ${factorLabel(top.key)}`
      : 'risk score';
  // Say so while the wallet-level signals are still landing, so a score that
  // moves a moment later does not look like the panel changing its mind.
  const caption = data.phase === 'partial' ? `${reason} · still checking wallets` : reason;
  meta.append(bar, el('div', 'caption', caption));

  wrap.append(number, meta);
  return wrap;
}

function signals(data: AnalyzeResponse): HTMLElement {
  const rows = el('div', 'rows');

  rows.append(
    row(
      'Dev wallet',
      data.dev.unavailable ? null : pct(data.dev.holdingPct),
      data.dev.unavailable ? unavailableText(data.dev.unavailable) : `${pct(data.dev.soldPct)} sold`,
      data.dev.unavailable === 'pending',
    ),
    // Bundlers and snipers report the worse of "holds now" and "took at launch":
    // wallets that already sold their launch allocation must not read as clean.
    launchRow('Bundlers', data.bundles.holdingPct, data.bundles.boughtPct, data.bundles.walletCount, data.bundles.unavailable),
    row('Top 10 holders', pct(data.topHolders.top10Pct), topHolderNote(data)),
    launchRow('Snipers', data.snipers.holdingPct, data.snipers.boughtPct, data.snipers.count, data.snipers.unavailable),
    countRow('Insiders', data.insiders, `${count(data.insiders.count)} wallets`),
    countRow('Fresh wallets', data.freshWallets, `${count(data.freshWallets.count)} wallets`),
  );

  return rows;
}

function countRow(
  name: string,
  value: CountAndHolding | { holdingPct: number; unavailable?: string | undefined },
  sub: string,
): HTMLElement {
  const unavailable = 'unavailable' in value ? value.unavailable : undefined;
  return row(
    name,
    unavailable ? null : pct(value.holdingPct),
    unavailable ? unavailableText(unavailable) : sub,
    unavailable === 'pending',
  );
}

/**
 * A launch-window signal. The headline figure is the worse of what the wallets
 * hold now and what they took at launch, because a bundler that has already
 * dumped is evidence of a bundled launch, not evidence of a clean one.
 */
function launchRow(
  name: string,
  holdingPct: number,
  boughtPct: number | null,
  wallets: number,
  unavailable: string | undefined,
): HTMLElement {
  if (unavailable) return row(name, null, unavailableText(unavailable));

  const bought = boughtPct ?? 0;
  const sub =
    bought > holdingPct + 0.5
      ? `${count(wallets)} wallets · took ${pct(bought)}, sold most`
      : `${count(wallets)} wallets`;

  return row(name, pct(Math.max(holdingPct, bought)), sub);
}

function topHolderNote(data: AnalyzeResponse): string {
  const flagged = data.topHolders.list.filter((h) => h.highActivity).length;
  if (flagged > 0) return `incl. ${flagged} high-activity`;
  return 'excl. pools';
}

function row(name: string, figure: string | null, sub: string, pending = false): HTMLElement {
  const wrap = el('div', figure === null ? 'row unknown' : 'row');
  // A row still being measured says so, rather than claiming it is unknowable.
  const placeholder = pending ? '…' : 'unknown';
  wrap.append(el('span', 'name', name), el('span', 'figure', figure ?? placeholder), el('span', 'sub', sub));
  return wrap;
}

function securityFlags(data: AnalyzeResponse): HTMLElement | null {
  const wrap = el('div', 'flags');

  wrap.append(
    flag(data.security.canMintMore ? 'Can mint more' : 'Mint revoked', !data.security.canMintMore),
    flag(data.security.canFreeze ? 'Can freeze' : 'Freeze revoked', !data.security.canFreeze),
  );

  // Neutral on purpose: paying for a DexScreener profile says someone spent
  // money on presentation, not that the token is safe. Green would lie.
  if (data.market?.dexPaid === true) wrap.append(neutralFlag('Dex paid'));

  return wrap;
}

function warnings(messages: string[]): HTMLElement {
  const wrap = el('div', 'warnings');
  // Cap the list: five caveats in a 300px panel is a wall, not information.
  for (const message of messages.slice(0, 3)) wrap.append(el('div', 'warning', message));
  return wrap;
}

function footer(data: AnalyzeResponse): HTMLElement {
  const wrap = el('div', 'footer');
  const age = tokenAge(data.meta.createdAt);
  wrap.append(
    el('span', '', age ? `${count(data.holderCount)} holders · ${age} old` : `${count(data.holderCount)} holders`),
    el('span', '', data.meta.cached ? 'cached' : `${data.meta.durationMs} ms`),
  );
  return wrap;
}

/** Compact age: 4m, 7h, 6d. Null when we never found the launch. */
function tokenAge(createdAt: string | null): string | null {
  if (!createdAt) return null;
  const ms = Date.now() - new Date(createdAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;

  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function skeleton(): Node[] {
  const wrap = el('div', 'skeleton');
  for (const size of ['', 'medium', 'short', 'medium', 'short']) {
    wrap.append(el('div', `line ${size}`.trim()));
  }
  return [wrap];
}

function notice(message: string): Node[] {
  return [el('div', 'notice', message)];
}

// --- Dragging ----------------------------------------------------------------

/**
 * Drag by the header. Listeners are attached to our own element on pointerdown
 * and released on pointerup, so between drags the page carries none of ours.
 */
function makeDraggable(handle: HTMLElement, host: HTMLElement, state: PanelState): () => void {
  let startX = 0;
  let startY = 0;
  let startRight = state.right;
  let startBottom = state.bottom;

  const onPointerMove = (event: PointerEvent): void => {
    // Anchored to the right and bottom edges, so moving the pointer right or
    // down *decreases* the offsets.
    state.right = clamp(startRight - (event.clientX - startX), 0, window.innerWidth - 60);
    state.bottom = clamp(startBottom - (event.clientY - startY), 0, window.innerHeight - 40);
    applyPosition(host, state);
  };

  const onPointerUp = (event: PointerEvent): void => {
    handle.classList.remove('dragging');
    handle.releasePointerCapture(event.pointerId);
    handle.removeEventListener('pointermove', onPointerMove);
    handle.removeEventListener('pointerup', onPointerUp);
    void savePanelState(state);
  };

  const onPointerDown = (event: PointerEvent): void => {
    // Ignore the collapse button and anything but the primary button.
    if (event.button !== 0 || (event.target as HTMLElement).closest('.toggle')) return;

    startX = event.clientX;
    startY = event.clientY;
    startRight = state.right;
    startBottom = state.bottom;

    handle.classList.add('dragging');
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    event.preventDefault(); // Our own element: stops text selection while dragging.
  };

  handle.addEventListener('pointerdown', onPointerDown);
  return () => handle.removeEventListener('pointerdown', onPointerDown);
}

// --- DOM helpers -------------------------------------------------------------

function el(tag: string, className = '', text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  // textContent, never innerHTML: this data is third-party and untrusted.
  if (text !== undefined) node.textContent = text;
  return node;
}

function stat(label: string, value: string, valueClass = ''): HTMLElement {
  const wrap = el('div', 'stat');
  wrap.append(el('span', 'label', label), el('span', `value ${valueClass}`.trim(), value));
  return wrap;
}

function flag(text: string, safe: boolean): HTMLElement {
  return el('span', `flag ${safe ? 'safe' : 'danger'}`, text);
}

function neutralFlag(text: string): HTMLElement {
  return el('span', 'flag neutral', text);
}

function setPill(pill: HTMLElement, level: string, text: string): void {
  pill.className = `pill ${level}`;
  pill.textContent = text;
}

function render(container: HTMLElement, nodes: Node[]): void {
  container.replaceChildren(...nodes);
}

function applyPosition(host: HTMLElement, state: PanelState): void {
  host.style.right = `${state.right}px`;
  host.style.bottom = `${state.bottom}px`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function factorLabel(key: string): string {
  const labels: Record<string, string> = {
    devHolding: 'dev holding',
    devSold: 'dev selling',
    bundles: 'bundled wallets',
    topHolders: 'holder concentration',
    snipers: 'snipers',
    freshWallets: 'fresh wallets',
    insiders: 'insider wallets',
    authorities: 'live token authorities',
  };
  return labels[key] ?? key;
}

function unavailableText(reason: string): string {
  const reasons: Record<string, string> = {
    'creation-not-found': 'launch not found',
    'no-early-trades': 'no launch trades',
    'no-dev-allocation': 'no dev allocation',
    'holder-set-partial': 'partial holder data',
    'no-market-data': 'no market data',
    'not-supported-on-chain': 'not supported here',
    pending: 'checking…',
  };
  return reasons[reason] ?? 'unavailable';
}
