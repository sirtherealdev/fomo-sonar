/**
 * The mark drawn in the panel header.
 *
 * Built node by node rather than from SVG strings. The panel's rule is that
 * nothing is ever assigned as markup — token names and symbols come from the
 * chain and are attacker-controlled — and keeping one construction path for
 * everything means a reviewer never has to work out which strings were safe.
 *
 * It also ships inline rather than as an extension file, so the manifest keeps
 * no `web_accessible_resources` entry. A panel that exposes nothing to the
 * page is easier to justify than one that exposes an icon.
 */

type Shape = {
  tag: 'path' | 'circle';
  attrs: Record<string, string>;
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function draw(shapes: Shape[], size: number, viewBox = '0 0 24 24'): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.style.display = 'block';
  svg.style.flex = 'none';

  for (const shape of shapes) {
    const node = document.createElementNS(SVG_NS, shape.tag);
    for (const [name, value] of Object.entries(shape.attrs)) node.setAttribute(name, value);
    svg.append(node);
  }
  return svg;
}

/** Ours: a funding cluster reduced to three bubbles and the links between them. */
export function sonarMark(size = 15): SVGElement {
  const A = '#d9a028';
  return draw(
    [
      { tag: 'path', attrs: { d: 'M8.2 14.4 17 8.6M8.2 14.4 16.2 18.6M17 8.6 16.2 18.6', stroke: A, 'stroke-width': '1.3', opacity: '.6', fill: 'none' } },
      { tag: 'circle', attrs: { cx: '7.8', cy: '14.6', r: '5', fill: A } },
      { tag: 'circle', attrs: { cx: '17.2', cy: '8.2', r: '3.1', fill: A } },
      { tag: 'circle', attrs: { cx: '16.3', cy: '18.7', r: '2', fill: A } },
    ],
    size,
  );
}
