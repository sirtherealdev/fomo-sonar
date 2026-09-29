/*
 * The hero bubble map.
 *
 * Every wallet is a node with a home position it is sprung to. The cursor
 * pushes nodes away from itself, so moving across the hero pulls the map apart
 * and it settles back once you leave — the same gesture as prodding a molecule
 * model. The amber group is the point being made: six wallets funded by one
 * address, drawn brighter than everything around them.
 *
 * No library. Roughly fifty nodes, so the cost is a few hundred microseconds a
 * frame; it stops entirely when the hero scrolls out of view.
 */
(function () {
  const canvas = document.getElementById('bubbles');
  if (!canvas || !canvas.getContext) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.getContext('2d');

  const AMBER = [251, 191, 36];
  const GREY = [168, 188, 214];

  let w = 0, h = 0, dpr = 1;
  let nodes = [], links = [];
  const pointer = { x: -9999, y: -9999, active: false };

  /* Layout is in fractions of the hero box so it survives any viewport. */
  function build() {
    nodes = [];
    links = [];

    // A scattered field of ordinary holders, biased to the right so the
    // headline on the left keeps a quiet background.
    const scatter = [
      [.08, .22, 6], [.14, .62, 11], [.19, .38, 4], [.25, .80, 7],
      [.28, .16, 9], [.33, .52, 15], [.36, .88, 5], [.41, .29, 8],
      [.44, .68, 6], [.48, .12, 12], [.52, .45, 22], [.55, .77, 9],
      [.58, .24, 5], [.62, .58, 7], [.66, .90, 11], [.70, .18, 6],
      [.74, .70, 14], [.78, .35, 5], [.82, .85, 8], [.86, .50, 18],
      [.90, .20, 7], [.93, .74, 10], [.97, .42, 6], [.21, .05, 5],
      [.45, .95, 6], [.68, .04, 4], [.88, .06, 9], [.12, .92, 8],
      [.05, .48, 5], [.99, .60, 7],
    ];
    scatter.forEach(([fx, fy, r]) => nodes.push(make(fx, fy, r, false)));

    // Links between ordinary holders: sparse and faint, just enough that the
    // field reads as a map rather than as confetti.
    [[0, 2], [2, 4], [1, 3], [3, 5], [4, 7], [7, 10], [10, 13], [6, 8],
     [8, 11], [11, 14], [13, 16], [16, 19], [19, 21], [17, 20], [20, 22],
     [12, 15], [15, 18], [9, 12], [23, 4], [24, 14], [26, 20], [28, 1]]
      .forEach(([a, b]) => links.push({ a, b, amber: false }));

    // The cluster: six wallets in a tight knot, all paid by one bigger node.
    const funder = nodes.length;
    nodes.push(make(.755, .70, 30, true));
    const ring = [
      [.700, .38, 15], [.762, .31, 14], [.822, .38, 15],
      [.690, .52, 13], [.758, .48, 16], [.830, .53, 14],
    ].map(([fx, fy, r]) => { nodes.push(make(fx, fy, r, true)); return nodes.length - 1; });

    ring.forEach(i => links.push({ a: funder, b: i, amber: true }));
    ring.forEach((i, k) => links.push({ a: i, b: ring[(k + 1) % ring.length], amber: true }));
  }

  function make(fx, fy, r, amber) {
    return { fx, fy, r, amber, x: 0, y: 0, vx: 0, vy: 0, hx: 0, hy: 0 };
  }

  function resize() {
    const box = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = box.width; h = box.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /*
     * On a phone the copy runs the full width, so a map spread over the whole
     * hero sits underneath the headline and the two fight. Compressing it into
     * the upper half puts the picture above the words instead of behind them.
     */
    const narrow = w < 760;
    const squeeze = narrow ? 0.44 : 1;

    // Scale radii with the short edge so the map keeps its proportions.
    const k = Math.min(w / 1440, 1.3) * 1.75 * (narrow ? 0.8 : 1);
    nodes.forEach(n => {
      n.hx = n.fx * w;
      n.hy = n.fy * h * squeeze;
      n.rr = n.r * Math.max(k, .58);
      if (!n.x) { n.x = n.hx; n.y = n.hy; }
    });
  }

  function step() {
    const reach = Math.max(w, h) * 0.17;

    for (const n of nodes) {
      // Spring home.
      n.vx += (n.hx - n.x) * 0.014;
      n.vy += (n.hy - n.y) * 0.014;

      if (pointer.active) {
        const dx = n.x - pointer.x, dy = n.y - pointer.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < reach) {
          // Falls off smoothly, and bigger bubbles shove less.
          const force = (1 - d / reach) ** 2 * 5.2 * (18 / (n.rr + 14));
          n.vx += (dx / d) * force;
          n.vy += (dy / d) * force;
        }
      }

      n.vx *= 0.86;
      n.vy *= 0.86;
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  function draw() {
    ctx.clearRect(0, 0, w, h);

    for (const l of links) {
      const a = nodes[l.a], b = nodes[l.b];
      const stretch = Math.hypot(a.x - a.hx, a.y - a.hy) + Math.hypot(b.x - b.hx, b.y - b.hy);
      // A link brightens as it is pulled, which is what makes the map feel
      // like it is being disturbed rather than merely animated.
      const lift = Math.min(stretch / 120, 1);
      ctx.strokeStyle = l.amber
        ? rgba(AMBER, 0.42 + lift * 0.45)
        : rgba(GREY, 0.11 + lift * 0.2);
      ctx.lineWidth = l.amber ? 1.5 : 0.85;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    for (const n of nodes) {
      const c = n.amber ? AMBER : GREY;
      const r = n.rr;

      if (n.amber) {
        ctx.shadowColor = rgba(AMBER, 0.95);
        ctx.shadowBlur = r * 2.1;
      }

      // Glass: bright at the rim, hollow in the middle, lit from upper left.
      const g = ctx.createRadialGradient(
        n.x - r * 0.34, n.y - r * 0.4, r * 0.06,
        n.x, n.y, r
      );
      if (n.amber) {
        g.addColorStop(0, rgba(AMBER, 1));
        g.addColorStop(0.42, rgba(AMBER, 0.5));
        g.addColorStop(0.82, rgba(AMBER, 0.3));
        g.addColorStop(1, rgba(AMBER, 0.85));
      } else {
        g.addColorStop(0, rgba(GREY, 0.30));
        g.addColorStop(0.55, rgba(GREY, 0.07));
        g.addColorStop(0.88, rgba(GREY, 0.05));
        g.addColorStop(1, rgba(GREY, 0.30));
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = n.amber ? rgba(AMBER, 0.75) : rgba(GREY, 0.3);
      ctx.lineWidth = n.amber ? 1.1 : 0.9;
      ctx.stroke();

      // The specular pin is what makes a circle read as glass.
      const s1 = ctx.createRadialGradient(
        n.x - r * 0.38, n.y - r * 0.44, 0,
        n.x - r * 0.38, n.y - r * 0.44, r * 0.42
      );
      s1.addColorStop(0, n.amber ? 'rgba(255,240,200,.95)' : 'rgba(226,238,255,.5)');
      s1.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = s1;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  let running = false;
  function frame() {
    if (!running) return;
    step();
    draw();
    requestAnimationFrame(frame);
  }

  build();
  resize();
  draw();

  if (!reduced) {
    // Only run while the hero is actually on screen.
    new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting && !running) { running = true; requestAnimationFrame(frame); }
        else if (!e.isIntersecting) { running = false; }
      });
    }, { threshold: 0 }).observe(canvas);

    const hero = canvas.parentElement;
    hero.addEventListener('pointermove', e => {
      const box = canvas.getBoundingClientRect();
      pointer.x = e.clientX - box.left;
      pointer.y = e.clientY - box.top;
      pointer.active = true;
    });
    hero.addEventListener('pointerleave', () => { pointer.active = false; });
  }

  addEventListener('resize', () => { resize(); draw(); }, { passive: true });
})();
