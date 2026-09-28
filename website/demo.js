/*
 * The panel demo.
 *
 * Runs the three passes the extension runs, at roughly the pace it runs them,
 * then moves on to a different token. Cycling matters: a panel frozen on one
 * red score reads as a picture, and it would also misrepresent what the tool
 * usually finds — most tokens are not bundled, and the panel says so.
 *
 * Rows stay on "···" until their pass lands. The real panel never prints a
 * zero for something it has not measured, and neither does this one.
 */
(function () {
  const panel = document.getElementById('panel');
  if (!panel) return;

  const C = 351.9;              // circumference of the dial at r=56
  const SETTLE = 4700;          // when the score is committed
  const NEXT = 9600;            // when the next token starts

  /* Three tokens, so the demo shows the whole range rather than one verdict. */
  const TOKENS = [
    {
      sym: 'EXMPL', score: 84, level: 'high',
      footer: '412 holders · 4h old',
      rows: [
        { at: 1, k: 'Top 10 holders', v: '39.7%', c: 'warn', d: 'excl. pools' },
        { at: 2, k: 'Dev wallet', v: '100%', c: 'bad', d: 'sold · 0.00% held' },
        { at: 2, k: 'Bundlers', v: '41.2%', c: 'bad', d: '11 wallets' },
        { at: 2, k: 'Snipers', v: '27.5%', c: 'warn', d: '23 wallets · first 10s' },
        { at: 3, k: 'Insiders', v: '5.10%', c: 'warn', d: '4 wallets' },
        { at: 3, k: 'Fresh wallets', v: '11.2%', c: 'warn', d: '14 wallets' },
      ],
      holders: [['3btG…vy5N', 3.28], ['5q13…e9VQ', 2.65], ['5B52…vyxG', 2.57],
                ['8pLw…v1ER', 2.06], ['HbCx…kwft', 1.81], ['ENjb…VCCV', 1.65]],
      held: 20.4,
      note: '1 pool or program account(s) excluded',
      chips: [['Can seize tokens', 0], ['5% transfer tax', 0], ['Mint revoked', 1], ['Freeze revoked', 1]],
      caveat: true,
    },
    {
      sym: 'CORE', score: 46, level: 'med',
      footer: '1,908 holders · 6d old',
      rows: [
        { at: 1, k: 'Top 10 holders', v: '24.8%', c: 'warn', d: 'excl. pools' },
        { at: 2, k: 'Dev wallet', v: '18.6%', c: 'warn', d: 'held · 31% sold' },
        { at: 2, k: 'Bundlers', v: '9.40%', c: 'warn', d: '3 wallets' },
        { at: 2, k: 'Snipers', v: '12.1%', c: 'warn', d: '8 wallets · first 10s' },
        { at: 3, k: 'Insiders', v: '0.00%', c: 'ok', d: 'none found' },
        { at: 3, k: 'Fresh wallets', v: '4.30%', c: 'ok', d: '5 wallets' },
      ],
      holders: [['9kTa…mP2f', 6.80], ['Ax4Q…7yDl', 4.20], ['2vRn…Ku9s', 3.10],
                ['Ld8W…qF3x', 2.90], ['7hGe…zM1b', 2.60], ['Cq5T…Rn4v', 2.40]],
      held: 24.8,
      note: '2 pools or program account(s) excluded',
      chips: [['Mint revoked', 1], ['Freeze revoked', 1], ['No transfer tax', 1]],
      caveat: false,
    },
    {
      sym: 'VANE', score: 11, level: 'low',
      footer: '6,240 holders · 3w old',
      rows: [
        { at: 1, k: 'Top 10 holders', v: '14.2%', c: 'ok', d: 'excl. pools' },
        { at: 2, k: 'Dev wallet', v: '4.10%', c: 'ok', d: 'held · nothing sold' },
        { at: 2, k: 'Bundlers', v: '0.00%', c: 'ok', d: 'none found' },
        { at: 2, k: 'Snipers', v: '2.30%', c: 'ok', d: '2 wallets · first 10s' },
        { at: 3, k: 'Insiders', v: '0.00%', c: 'ok', d: 'none found' },
        { at: 3, k: 'Fresh wallets', v: '1.10%', c: 'ok', d: '2 wallets' },
      ],
      holders: [['H3pV…V2hJ', 3.40], ['HRqL…CaL7', 2.60], ['Eo4U…dhzM', 1.90],
                ['4nSb…Wt6c', 1.60], ['Jm2X…pQ8r', 1.40], ['Zt7K…vB5n', 1.20]],
      held: 14.2,
      note: '1 pool or program account(s) excluded',
      chips: [['Mint revoked', 1], ['Freeze revoked', 1], ['No transfer tax', 1], ['Cannot seize', 1]],
      caveat: false,
    },
  ];

  const STEPS = [
    { at: 1, t: 1000, ms: 420 },
    { at: 2, t: 2400, ms: 1640 },
    { at: 3, t: 3900, ms: 5410 },
  ];

  const $ = sel => panel.querySelector(sel);
  const phases = [...document.querySelectorAll('.phases li')];
  const dial = $('.d-fill');
  const num = $('.p-num');
  const pill = $('.p-pill');
  const verdict = $('.d-verdict');
  const ms = $('.p-ms');

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let timers = [];
  let at = 0;
  let rows = [];

  const clear = () => { timers.forEach(clearTimeout); timers = []; };
  const after = (d, fn) => timers.push(setTimeout(fn, d));
  const el = (tag, cls, txt) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };

  /* Build the panel's contents for one token, every value still hidden. */
  function mount(tk) {
    $('.p-sym').textContent = tk.sym;
    $('.p-note').textContent = tk.note;
    $('.p-aside').textContent = tk.held.toFixed(1) + '% of supply';

    // The footer carries the extension's own "counts are floors" marker.
    const foot = $('.p-holders-count');
    foot.textContent = '';
    foot.append(document.createTextNode(tk.footer + (tk.caveat ? ' · ' : '')));
    if (tk.caveat) {
      const mark = el('span', 'caveat', 'lower bound');
      mark.title = 'More than 500 transactions in the launch window; bundler and sniper counts are a lower bound.';
      foot.append(mark);
    }

    const list = $('.p-rows');
    list.textContent = '';
    rows = tk.rows.map(r => {
      const row = el('div', 'p-row');
      row.dataset.at = r.at;
      row.append(el('u'), el('span', null, r.k), el('b', r.c, r.v), el('i', null, r.d));
      list.append(row);
      return row;
    });

    const holderList = $('.p-holders');
    holderList.textContent = '';
    const largest = tk.holders[0][1];
    tk.holders.forEach(([addr, pct], i) => {
      const row = el('div', 'hrow');
      const track = el('span', 'hbar');
      const fill = el('span', i === 0 ? 'hfill top' : 'hfill');
      // Scaled to the largest holder, not to the supply: on an evenly spread
      // token, bars against the supply would all be invisible slivers.
      fill.style.width = Math.max(3, (pct / largest) * 100) + '%';
      track.append(fill);
      row.append(el('span', 'hrank', '#' + (i + 1)), el('span', 'haddr', addr),
                 track, el('span', 'hpct', pct.toFixed(2) + '%'));
      holderList.append(row);
    });

    const chips = $('.p-chips');
    chips.textContent = '';
    tk.chips.forEach(([label, ok]) => chips.append(el('span', ok ? 'c-ok' : 'c-bad', label)));

  }

  function reset() {
    rows.forEach(r => r.classList.remove('in'));
    panel.querySelectorAll('.p-block').forEach(b => b.classList.remove('in'));
    pill.textContent = 'scanning';
    pill.className = 'p-pill';
    verdict.textContent = '—';
    verdict.className = 'd-verdict';
    num.textContent = '—';
    num.className = 'p-num';
    dial.className = 'd-fill';
    dial.style.strokeDashoffset = C;
    ms.textContent = '0 ms';
  }

  function land(step) {
    phases.forEach(p => p.classList.toggle('on', +p.dataset.p === step.at));
    rows.filter(r => +r.dataset.at === step.at).forEach(r => r.classList.add('in'));
    panel.querySelectorAll('.p-block[data-at="' + step.at + '"]').forEach(b => b.classList.add('in'));
    ms.textContent = step.ms.toLocaleString() + ' ms';
  }

  function settle(tk) {
    phases.forEach(p => p.classList.remove('on'));
    const label = tk.level === 'med' ? 'medium' : tk.level;
    pill.textContent = label;
    pill.className = 'p-pill ' + tk.level;
    verdict.textContent = label.toUpperCase();
    verdict.className = 'd-verdict ' + tk.level;
    num.className = 'p-num ' + tk.level;
    dial.className = 'd-fill ' + tk.level;
    dial.style.strokeDashoffset = C * (1 - tk.score / 100);

    // Counted up rather than dropped in, so the score reads as something that
    // was worked out.
    let v = 0;
    const tick = () => {
      v += Math.max(1, Math.round((tk.score - v) * 0.18));
      if (v >= tk.score) { num.textContent = String(tk.score); return; }
      num.textContent = String(v);
      timers.push(setTimeout(tick, 26));
    };
    tick();
  }

  function run() {
    clear();
    const tk = TOKENS[at % TOKENS.length];
    at++;
    mount(tk);
    reset();

    if (reduced) {
      // No sequence: show the finished panel, which is the useful state.
      rows.forEach(r => r.classList.add('in'));
      panel.querySelectorAll('.p-block').forEach(b => b.classList.add('in'));
      ms.textContent = '5,410 ms';
      settle(tk);
      num.textContent = String(tk.score);
      return;
    }

    STEPS.forEach(step => after(step.t, () => land(step)));
    after(SETTLE, () => settle(tk));
    after(NEXT, run);
  }

  new IntersectionObserver(entries => {
    entries.forEach(e => (e.isIntersecting ? run() : clear()));
  }, { threshold: 0.35 }).observe(panel);
})();
