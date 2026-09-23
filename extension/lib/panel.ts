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
import { count, pct, shortAddress, signedPct, usd } from './format';
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

function report(data: AnalyzeResponse): Node[] {
  const nodes: Node[] = [];

  if (data.market) nodes.push(headline(data), el('div', 'divider'));
  nodes.push(score(data), el('div', 'divider'), signals(data));

  const flags = securityFlags(data);
  if (flags) nodes.push(flags);

  if (data.warnings.length > 0) nodes.push(warnings(data.warnings));

  nodes.push(footer(data));
  return nodes;
}

function headline(data: AnalyzeResponse): HTMLElement {
  const market = data.market;
  const wrap = el('div', 'headline');
  const change = market?.priceChange.h24 ?? null;

  wrap.append(
    stat('Price', usd(market?.priceUsd)),
    stat('24h', signedPct(change), change === null ? '' : change >= 0 ? 'up' : 'down'),
    stat('Market cap', usd(market?.marketCapUsd ?? market?.fdvUsd)),
    stat('Liquidity', usd(market?.liquidityUsd)),
  );
  return wrap;
}

function score(data: AnalyzeResponse): HTMLElement {
  const wrap = el('div', 'score');
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
  meta.append(bar, el('div', 'caption', reason));

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
  return row(name, unavailable ? null : pct(value.holdingPct), unavailable ? unavailableText(unavailable) : sub);
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

function row(name: string, figure: string | null, sub: string): HTMLElement {
  const wrap = el('div', figure === null ? 'row unknown' : 'row');
  wrap.append(el('span', 'name', name), el('span', 'figure', figure ?? 'unknown'), el('span', 'sub', sub));
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
  wrap.append(
    el('span', '', `${count(data.holderCount)} holders`),
    el('span', '', data.meta.cached ? 'cached' : `${data.meta.durationMs} ms`),
  );
  return wrap;
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
  let startTop = state.top;

  const onPointerMove = (event: PointerEvent): void => {
    // Right-anchored, so rightwards pointer movement *decreases* the offset.
    state.right = clamp(startRight - (event.clientX - startX), 0, window.innerWidth - 60);
    state.top = clamp(startTop + (event.clientY - startY), 0, window.innerHeight - 40);
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
    startTop = state.top;

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
  host.style.top = `${state.top}px`;
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
  };
  return reasons[reason] ?? 'unavailable';
}
