/**
 * All of the panel's CSS, scoped inside a closed shadow root.
 *
 * Two directions of isolation, both required:
 *  - Fomo's stylesheets cannot reach in, so a Fomo deploy cannot deform us.
 *  - Nothing here leaks out, so we cannot deform Fomo. There is not a single
 *    global selector below; every rule starts inside the shadow root.
 */
export const PANEL_STYLES = `
:host {
  all: initial;
  position: fixed;
  z-index: 2147483000;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color-scheme: dark;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

.panel {
  width: var(--panel-width, 320px);
  background: #0e1014;
  border: 1px solid #23262e;
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, .55);
  color: #e7e9ee;
  font-size: 12px;
  line-height: 1.45;
  overflow: hidden;
}

/* The drag handle. cursor:grab tells the user it moves before they try. */
.header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 10px;
  background: #14171d;
  border-bottom: 1px solid #23262e;
  cursor: grab;
  user-select: none;
}
.header.dragging { cursor: grabbing; }

.brand { font-size: 11px; font-weight: 700; letter-spacing: .09em; color: #8b93a5; }
.ticker { font-weight: 600; color: #e7e9ee; margin-left: 1px; }
.spacer { flex: 1; }

.pill {
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .04em;
  text-transform: uppercase;
}
.pill.low    { background: rgba(46, 160, 94, .16);  color: #4ade80; }
.pill.medium { background: rgba(217, 160, 40, .16); color: #fbbf24; }
.pill.high   { background: rgba(220, 68, 68, .16);  color: #f87171; }
.pill.muted  { background: #1c2028; color: #8b93a5; }
.pill.unknown { background: #1c2028; color: #8b93a5; }

.toggle {
  all: unset;
  cursor: pointer;
  color: #8b93a5;
  font-size: 13px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 4px;
}
.toggle:hover { color: #e7e9ee; background: #1c2028; }
.toggle:focus-visible { outline: 2px solid #3b82f6; }

/*
 * The panel grew tall enough to run off a short viewport, so the body scrolls
 * inside itself rather than pushing past the edge of the screen. The header
 * stays put, so it can always be grabbed and dragged.
 */
.body {
  padding: 12px;
  display: grid;
  gap: 11px;
  max-height: min(70vh, 520px);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.panel.collapsed .body { display: none; }

.body::-webkit-scrollbar { width: 6px; }
.body::-webkit-scrollbar-thumb { background: #2a2f3a; border-radius: 3px; }
.body::-webkit-scrollbar-track { background: transparent; }

/* Detail blocks: the wallets behind the numbers. */
.block { display: grid; gap: 3px; }
.block-title {
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: #767e91;
  margin-bottom: 1px;
}
.holder { display: flex; align-items: baseline; gap: 7px; }
.holder .mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: #a7aebe;
}
.holder .figure { margin-left: auto; font-weight: 600; font-variant-numeric: tabular-nums; }
.holder .sub { color: #767e91; font-size: 10.5px; }
.tag {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(217, 160, 40, .14);
  color: #d9a028;
}
.note { font-size: 9.5px; color: #5f6676; }

.divider { height: 1px; background: #1e222a; }

/*
 * Risk score as a dial rather than a number beside a bar.
 *
 * The bar version put four competing elements on one line and the eye had
 * nowhere to land first. One ring, one number, one sentence underneath.
 */
.score { display: grid; justify-items: center; gap: 8px; padding: 4px 0 2px; }
.dial { position: relative; width: 96px; height: 96px; }
.dial svg { width: 100%; height: 100%; transform: rotate(-90deg); display: block; }
.dial circle { fill: none; stroke-width: 6; stroke-linecap: round; }
.dial .track { stroke: #1e222a; }
.dial .fill { transition: stroke-dashoffset .8s cubic-bezier(.22,1,.36,1); }
.dial .fill.low    { stroke: #4ade80; }
.dial .fill.medium { stroke: #fbbf24; }
.dial .fill.high   { stroke: #f87171; }
.dial .mid {
  position: absolute; inset: 0;
  display: grid; place-content: center; justify-items: center;
  gap: 1px;
  line-height: 1;
}
.dial .mid-cap {
  font-size: 8px; letter-spacing: .16em; color: #5f6676; font-weight: 600;
}
.dial .mid-num {
  font-size: 30px; font-weight: 700; font-variant-numeric: tabular-nums;
}
.dial .mid-verdict { font-size: 8.5px; letter-spacing: .13em; font-weight: 700; }
.dial .mid.low     .mid-num { color: #4ade80; }
.dial .mid.medium  .mid-num { color: #fbbf24; }
.dial .mid.high    .mid-num { color: #f87171; }
.dial .mid.unknown .mid-num { color: #5f6676; font-size: 26px; }
.mid-verdict.low     { color: #4ade80; }
.mid-verdict.medium  { color: #fbbf24; }
.mid-verdict.high    { color: #f87171; }
.mid-verdict.unknown { color: #5f6676; }
.score .caption { font-size: 10.5px; color: #767e91; text-align: center; max-width: 30ch; }

/*
 * Signal rows: a dot carrying the colour, the name, the figure. Anything
 * further goes on a second line in the corner, so a long qualifier can never
 * push the figure out of alignment or wrap into the next row.
 */
.rows { display: grid; gap: 2px; }
.row {
  display: grid;
  grid-template-columns: 7px 1fr auto;
  align-items: center;
  column-gap: 9px; row-gap: 1px;
  padding: 5px 0;
}
.row + .row { border-top: 1px solid #191c23; }
.row .dot { width: 7px; height: 7px; border-radius: 50%; background: #2a2f3a; }
.row .dot.low    { background: #4ade80; }
.row .dot.medium { background: #fbbf24; }
.row .dot.high   { background: #f87171; }
.row .name { color: #a7aebe; }
.row .figure { font-weight: 600; font-variant-numeric: tabular-nums; }
.row .figure.low    { color: #6ee7a0; }
.row .figure.medium { color: #fbbf24; }
.row .figure.high   { color: #f87171; }
.row .sub {
  grid-column: 2 / 4;
  justify-self: end;
  color: #6b7284;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.row.unknown .figure { color: #767e91; font-weight: 500; }

/*
 * Top holders, one row each: rank, address, a bar, the figure. The bar is
 * scaled to the largest holder rather than to the whole supply, so on an
 * evenly spread token the rows still differ visibly from one another.
 */
.block-head { display: flex; align-items: baseline; gap: 8px; }
.block-head .block-aside { margin-left: auto; }
.block-aside {
  margin-left: auto;
  font-size: 9.5px;
  color: #767e91;
  font-variant-numeric: tabular-nums;
}
/* Reads as a link without borrowing the page's link colour. */
.maplink {
  font-size: 9.5px;
  color: #8b93a5;
  text-decoration: none;
  border-bottom: 1px dotted #3a4150;
  padding-bottom: 1px;
}
.maplink::after { content: " ↗"; }
.maplink:hover { color: #d9a028; border-bottom-color: #8a6a1a; }

.holders { display: grid; gap: 1px; margin-top: 4px; }
.hrow {
  display: grid;
  grid-template-columns: 17px 62px 1fr 42px;
  align-items: center;
  gap: 7px;
  padding: 3px 3px;
  border-radius: 4px;
}
.hrow:hover { background: #14171d; }
.hrank { font-size: 9px; color: #5f6676; font-variant-numeric: tabular-nums; }
.haddr {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  color: #a7aebe;
}
.hbar { height: 5px; border-radius: 999px; background: #191d24; overflow: hidden; }
.hfill { display: block; height: 100%; border-radius: 999px; background: #39414f; }
.hfill.top { background: #d9a028; }
.hrow.flagged .hfill { background: #b4494c; }
.hrow.flagged .haddr { color: #e08a8c; }
.hpct {
  text-align: right;
  font-size: 10.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.flags { display: flex; flex-wrap: wrap; gap: 5px; }
.flag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 5px;
  background: #1c2028;
  color: #a7aebe;
}
.flag.danger { background: rgba(220, 68, 68, .14); color: #f87171; }
.flag.safe   { background: rgba(46, 160, 94, .13); color: #6ee7a0; }

.footer {
  font-size: 9.5px;
  color: #5f6676;
  display: flex;
  align-items: center;
  gap: 8px;
  font-variant-numeric: tabular-nums;
}
.footer > span:last-child { margin-left: auto; }

/* Quiet, but not hidden: the counts above it are floors, not totals. */
.caveat {
  color: #9a7c28;
  border-bottom: 1px dotted #6b5719;
  cursor: help;
}
.caveat::before { content: "!"; font-weight: 700; margin-right: 3px; }

/* Loading, error and unsupported states share this block. */
.notice { padding: 4px 0; color: #8b93a5; font-size: 11.5px; }

.skeleton { display: grid; gap: 7px; }
.skeleton .line { height: 9px; border-radius: 4px; background: #1a1e26; }
.skeleton .line.short { width: 45%; }
.skeleton .line.medium { width: 72%; }
@media (prefers-reduced-motion: no-preference) {
  .skeleton .line { animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
}
`;
