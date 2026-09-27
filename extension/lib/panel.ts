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
import { sonarMark } from './marks';
import { bubbleMapUrl } from './bubblemaps';
import { count, pct, shortAddress } from './format';
import { loadPanelState, savePanelState, type PanelState } from './storage';
import type { AnalyzeResult } from './api';
import type { AnalyzeResponse, CountAndHolding } from '@sonar/shared';

export interface Panel {
  showLoading(label: string): void;
  showResult(result: AnalyzeResult): void;
  hide(): void;
  destroy(): void;
}

export async function createPanel(): Promise<Panel> {
  const state = await loadPanelState();

  const host = document.createElement('fomo-sonar-panel');
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = PANEL_STYLES;

  const panel = el('div', 'panel');
  panel.style.setProperty('--panel-width', `${PANEL.width}px`);

  const header = el('div', 'header');
  const brand = el('span', 'brand', 'SONAR');
  const ticker = el('span', 'ticker');
  const pill = el('span', 'pill muted', '—');
  const toggle = document.createElement('button');
  toggle.className = 'toggle';
  toggle.type = 'button';
  toggle.textContent = state.collapsed ? '+' : '–';
  toggle.setAttribute('aria-label', state.collapsed ? 'Expand' : 'Collapse');

  header.append(sonarMark(), brand, ticker, el('span', 'spacer'), pill, toggle);

  const body = el('div', 'body');
  panel.append(header, body);
  shadow.append(style, panel);

  applyPosition(host, state);
  if (state.collapsed) panel.classList.add('collapsed');
  host.style.display = 'none';
  document.documentElement.append(host);

  toggle.addEventListener('click', () => {
    const before = topOf();
    state.collapsed = !state.collapsed;
    panel.classList.toggle('collapsed', state.collapsed);
    toggle.textContent = state.collapsed ? '+' : '–';
    toggle.setAttribute('aria-label', state.collapsed ? 'Expand' : 'Collapse');
    settle(before);
    void savePanelState(state);
  });

  const stopDragging = makeDraggable(header, host, state);

  const topOf = (): number | null =>
    host.style.display === 'none' ? null : host.getBoundingClientRect().top;

  /**
   * Put the panel back inside the window after anything that could have moved
   * it out, and keep its header where the reader left it.
   *
   * The offsets are measured from the bottom edge, so a change in height moves
   * the top: collapsing dropped the header to where the panel's foot had been,
   * and each pass of results landing shoved it upward. Either way the one part
   * you are looking at — and the only part you can drag — jumped.
   *
   * Callers pass the header's position from *before* they changed anything;
   * the bottom offset is then recomputed to put it back there.
   */
  let settleQueued = false;
  const settle = (keepTop: number | null = null): void => {
    if (settleQueued) return;
    settleQueued = true;
    requestAnimationFrame(() => {
      settleQueued = false;
      if (host.style.display === 'none') return;

      if (keepTop !== null) {
        const height = host.getBoundingClientRect().height;
        state.bottom = window.innerHeight - height - keepTop;
      }
      clampToViewport(host, state);
      applyPosition(host, state);
    });
  };

  // A resize only re-clamps; there is no height change to compensate for.
  const onResize = (): void => settle();
  window.addEventListener('resize', onResize, { passive: true });

  return {
    showLoading(label: string): void {
      const before = topOf();
      host.style.display = '';
      ticker.textContent = label;
      setPill(pill, 'muted', 'scanning');
      render(body, skeleton());
      settle(before);
    },

    showResult(result: AnalyzeResult): void {
      const before = topOf();
      host.style.display = '';

      if (result.status === 'unsupported') {
        setPill(pill, 'muted', result.chain);
        render(body, notice(`Risk analysis for ${result.chain} is not available yet.`));
        settle(before);
        return;
      }

      if (result.status === 'error') {
        setPill(pill, 'muted', '—');
        render(body, notice("Can't analyse this token."));
        settle(before);
        return;
      }

      const data = result.data;
      ticker.textContent = data.token.symbol ?? shortAddress(data.mint);
      setPill(pill, data.riskLevel, data.riskLevel);
      render(body, report(data));
      settle(before);
    },

    hide(): void {
      host.style.display = 'none';
    },

    destroy(): void {
      stopDragging();
      window.removeEventListener('resize', onResize);
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

  nodes.push(footer(data));
  return nodes;
}

/** The actual wallets behind the concentration number. */
/**
 * Top holders, spelled out: who holds what, with a bar per row.
 *
 * A single stacked bar showed the shape but hid the wallets, and bubbles sized
 * by holding collapse into identical circles whenever a token is evenly spread.
 * A row each keeps the address and the figure readable, and the bar — scaled to
 * the largest holder, not to the whole supply — makes the differences between
 * them visible even when every number starts with a 2.
 */
function topHolderList(data: AnalyzeResponse): HTMLElement | null {
  const list = data.topHolders.list.slice(0, 8);
  const largest = list[0];
  if (!largest) return null;

  const wrap = el('div', 'block');

  const held = data.topHolders.list.reduce((sum, h) => sum + h.pct, 0);
  const head = el('div', 'block-head');
  head.append(
    el('div', 'block-title', 'Top holders'),
    el('div', 'block-aside', `${count(data.topHolders.list.length)} hold ${pct(held)}`),
  );

  // Their map is the better tool for looking at how these wallets connect;
  // opening in a new tab so a click never takes the reader off the trade.
  const mapUrl = bubbleMapUrl(data.chain, data.mint);
  if (mapUrl) {
    const link = document.createElement('a');
    link.className = 'maplink';
    link.href = mapUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'bubble map';
    link.title = 'Open this token on Bubblemaps';
    head.append(link);
  }

  wrap.append(head);

  const rows = el('div', 'holders');
  list.forEach((holder, i) => {
    const line = el('div', `hrow${holder.highActivity ? ' flagged' : ''}`);

    const track = el('span', 'hbar');
    const fill = el('span', holder === largest ? 'hfill top' : 'hfill');
    fill.style.width = `${Math.max(3, (holder.pct / largest.pct) * 100)}%`;
    track.append(fill);

    line.append(
      el('span', 'hrank', `#${i + 1}`),
      el('span', 'haddr', shortAddress(holder.address)),
      track,
      el('span', 'hpct', pct(holder.pct)),
    );
    // The full address stays one hover away rather than eating the row.
    line.title = `${holder.address}\n${pct(holder.pct)} of supply${holder.highActivity ? ' · high activity, may be an exchange' : ''}`;
    rows.append(line);
  });
  wrap.append(rows);

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
    wrap.append(
      dial(0, 'unknown', '?', 'unknown'),
      el('div', 'caption', `Only ${Math.round(data.coverage)}% of this token could be measured, so no score is given.`),
    );
    return wrap;
  }

  // No caption under the dial. The rows below already name every factor and
  // show its figure, so a line restating the largest one was repeating what
  // the reader is about to look at anyway.
  wrap.append(dial(data.riskScore, data.riskLevel, String(data.riskScore), data.riskLevel));
  return wrap;
}

/**
 * The ring is one stroke; the score is how much of it is drawn.
 *
 * The empty middle carries the reading rather than a caption underneath: what
 * it measures, the number, and where that number falls. Stacked inside the
 * gauge they read as one object instead of three stray lines.
 */
function dial(value: number, level: string, label: string, verdict: string): HTMLElement {
  const R = 42;
  const C = 2 * Math.PI * R;
  const shown = Math.max(0, Math.min(100, value));

  const svg = svgEl('svg');
  svg.setAttribute('viewBox', '0 0 96 96');

  const track = svgEl('circle');
  track.setAttribute('class', 'track');
  const fill = svgEl('circle');
  fill.setAttribute('class', `fill ${level}`);
  fill.setAttribute('stroke-dasharray', String(C));
  fill.setAttribute('stroke-dashoffset', String(C * (1 - shown / 100)));

  for (const c of [track, fill]) {
    c.setAttribute('cx', '48');
    c.setAttribute('cy', '48');
    c.setAttribute('r', String(R));
  }
  svg.append(track, fill);

  const mid = el('div', `mid ${level}`);
  mid.append(
    el('span', 'mid-cap', 'RISK'),
    el('span', 'mid-num', label),
    el('span', `mid-verdict ${level}`, verdict.toUpperCase()),
  );

  const wrap = el('div', 'dial');
  wrap.append(svg, mid);
  return wrap;
}

function svgEl(name: string): SVGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', name);
}

function signals(data: AnalyzeResponse): HTMLElement {
  const rows = el('div', 'rows');

  rows.append(
    row(
      'Dev wallet',
      data.dev.unavailable ? null : pct(data.dev.holdingPct),
      data.dev.unavailable ? unavailableText(data.dev.unavailable) : `${pct(data.dev.soldPct)} sold`,
      data.dev.unavailable === 'pending',
      data.dev.unavailable ? null : tone(data.dev.holdingPct),
    ),
    // Bundlers and snipers report the worse of "holds now" and "took at launch":
    // wallets that already sold their launch allocation must not read as clean.
    launchRow('Bundlers', data.bundles.holdingPct, data.bundles.boughtPct, data.bundles.walletCount, data.bundles.unavailable),
    row('Top 10 holders', pct(data.topHolders.top10Pct), topHolderNote(data), false, tone(data.topHolders.top10Pct)),
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
    unavailable ? null : tone(value.holdingPct),
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

  const worst = Math.max(holdingPct, bought);
  return row(name, pct(worst), sub, false, tone(worst));
}

function topHolderNote(data: AnalyzeResponse): string {
  const flagged = data.topHolders.list.filter((h) => h.highActivity).length;
  if (flagged > 0) return `incl. ${flagged} high-activity`;
  return 'excl. pools';
}

function row(
  name: string,
  figure: string | null,
  sub: string,
  pending = false,
  level: RowLevel = null,
): HTMLElement {
  const wrap = el('div', figure === null ? 'row unknown' : 'row');
  // A row still being measured says so, rather than claiming it is unknowable.
  const placeholder = pending ? '…' : 'unknown';
  const tone = figure === null ? '' : (level ?? '');

  wrap.append(
    el('span', `dot ${tone}`.trim()),
    el('span', 'name', name),
    el('span', `figure ${tone}`.trim(), figure ?? placeholder),
  );
  if (sub) wrap.append(el('span', 'sub', sub));
  return wrap;
}

type RowLevel = 'low' | 'medium' | 'high' | null;

/**
 * The dot's colour, from the share of supply a signal accounts for.
 *
 * Deliberately coarse and shared by every row: a reader scanning the column
 * should be able to tell "fine / watch / bad" without reading a single number,
 * and a per-signal scale would make that impossible.
 */
function tone(pctValue: number | null): RowLevel {
  if (pctValue === null) return null;
  if (pctValue >= 20) return 'high';
  if (pctValue >= 5) return 'medium';
  return 'low';
}

function securityFlags(data: AnalyzeResponse): HTMLElement | null {
  const wrap = el('div', 'flags');

  /*
   * Dangers first, and only name the safe states that are worth confirming.
   * A wall of green "revoked" chips trains people to stop reading the row,
   * which is the row most worth reading.
   */
  if (data.security.canSeize) wrap.append(flag('Can seize tokens', false));
  if (data.security.hasTransferHook) wrap.append(flag('Transfer hook', false));
  if (data.security.transferTaxPct > 0) {
    wrap.append(flag(`${data.security.transferTaxPct}% tax`, false));
  }
  if (data.security.taxCanChange && data.security.transferTaxPct === 0) {
    wrap.append(flag('Tax can be added', false));
  }

  wrap.append(
    flag(data.security.canMintMore ? 'Can mint more' : 'Mint revoked', !data.security.canMintMore),
    flag(data.security.canFreeze ? 'Can freeze' : 'Freeze revoked', !data.security.canFreeze),
  );

  return wrap;
}


function footer(data: AnalyzeResponse): HTMLElement {
  const wrap = el('div', 'footer');
  const age = tokenAge(data.meta.createdAt);

  /*
   * "Dex paid" sits here rather than with the security chips.
   *
   * Those answer one question — what can still be done to this token — and a
   * grey chip about who paid DexScreener for a profile answered a different
   * one, so it read as the odd item in the row and wrapped onto a line of its
   * own. It is a fact about the listing, which is what this line is for.
   */
  const facts = [`${count(data.holderCount)} holders`];
  if (age) facts.push(`${age} old`);
  if (data.market?.dexPaid === true) facts.push('dex paid');

  wrap.append(el('span', '', facts.join(' · ')));

  /*
   * Where the caveats went.
   *
   * Spelled out, three of them filled a third of the panel and got skipped for
   * being a wall of yellow. They still matter: every one of them means a count
   * is a floor rather than a total, so a clean-looking row could be hiding more.
   * One mark keeps that disclosed without spending the space, and the full
   * text is a hover away.
   */
  if (data.warnings.length > 0) {
    const mark = el('span', 'caveat', 'lower bound');
    mark.title = data.warnings.join('\n\n');
    wrap.append(mark);
  }

  wrap.append(el('span', '', data.meta.cached ? 'cached' : `${data.meta.durationMs} ms`));
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
    state.right = startRight - (event.clientX - startX);
    state.bottom = startBottom - (event.clientY - startY);
    clampToViewport(host, state);
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

/**
 * Keep the whole panel on screen, not just its anchor point.
 *
 * The offsets are measured from the right and bottom edges, so the limit is the
 * viewport minus the panel's own size. Bounding the anchor alone let `right`
 * grow until the panel hung off the left edge and `bottom` until its header sat
 * above the top of the window — at which point there was nothing left to drag
 * it back by.
 *
 * Re-run whenever the window resizes or the panel's height changes: a position
 * saved in a wide window is off-screen in a narrow one, and the panel grows
 * upward as results arrive.
 */
function clampToViewport(host: HTMLElement, state: PanelState): void {
  const box = host.getBoundingClientRect();
  const width = box.width || PANEL.width;
  const height = box.height || 0;

  // On a viewport too small to hold the panel, favour the top-left corner
  // being visible: the header lives there and it is the only way to move it.
  const maxRight = Math.max(PANEL.margin, window.innerWidth - width - PANEL.margin);
  const maxBottom = Math.max(PANEL.margin, window.innerHeight - height - PANEL.margin);

  state.right = clamp(state.right, PANEL.margin, maxRight);
  state.bottom = clamp(state.bottom, PANEL.margin, maxBottom);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
