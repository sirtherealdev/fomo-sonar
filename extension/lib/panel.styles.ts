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
  width: var(--panel-width, 300px);
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
  gap: 8px;
  padding: 9px 10px;
  background: #14171d;
  border-bottom: 1px solid #23262e;
  cursor: grab;
  user-select: none;
}
.header.dragging { cursor: grabbing; }

.brand { font-size: 11px; font-weight: 700; letter-spacing: .09em; color: #8b93a5; }
.ticker { font-weight: 600; color: #e7e9ee; margin-left: 2px; }
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
  padding: 10px;
  display: grid;
  gap: 10px;
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

/* Risk score. */
.score { display: flex; align-items: center; gap: 10px; }
.score .number { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
.score .number.low    { color: #4ade80; }
.score .number.medium { color: #fbbf24; }
.score .number.high   { color: #f87171; }
.score .number.unknown { color: #5f6676; }
.score .meta { flex: 1; display: grid; gap: 4px; }
.bar { height: 4px; border-radius: 999px; background: #1e222a; overflow: hidden; }
.bar > span { display: block; height: 100%; border-radius: 999px; }
.bar > span.low    { background: #4ade80; }
.bar > span.medium { background: #fbbf24; }
.bar > span.high   { background: #f87171; }
.score .caption { font-size: 10px; color: #767e91; }

/* Signal rows. */
.rows { display: grid; gap: 5px; }
.row { display: flex; align-items: baseline; gap: 8px; }
.row .name { color: #a7aebe; flex: 1; }
.row .figure { font-weight: 600; font-variant-numeric: tabular-nums; }
.row .sub { color: #767e91; font-size: 10.5px; font-variant-numeric: tabular-nums; }
.row.unknown .figure { color: #767e91; font-weight: 500; }

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
/* Neutral: true information that is not a safety claim. */
.flag.neutral { background: #1c2028; color: #a7aebe; }

.warnings { display: grid; gap: 3px; }
.warning { font-size: 10px; color: #c9a227; display: flex; gap: 5px; }
.warning::before { content: "!"; font-weight: 700; }

.footer {
  font-size: 9.5px;
  color: #5f6676;
  display: flex;
  justify-content: space-between;
  font-variant-numeric: tabular-nums;
}

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
