import dagre from '@dagrejs/dagre';
import { captionIcon } from './icon-markup.mjs';
import { check, label, parseInput, record } from './component-input.mjs';

const idPattern = /^[a-z][a-z0-9_-]{0,31}$/i;
export function validateGraph({ title, direction = 'TB', nodes, edges }) {
  check(label(title, 100), 'title は1〜100文字の1行テキストにしてください');
  check(['TB', 'LR'].includes(direction), 'direction は TB または LR を指定してください');
  check(Array.isArray(nodes) && nodes.length >= 1 && nodes.length <= 32, 'nodes は1〜32件です');
  check(Array.isArray(edges) && edges.length <= 64, 'edges は0〜64件です');

  const ids = new Set();
  for (const node of nodes) {
    check(record(node, ['id', 'label']) && typeof node.id === 'string'
      && idPattern.test(node.id) && label(node.label, 60), 'ノードの id または label が不正です');
    check(!ids.has(node.id), `ノード ID が重複しています (${node.id})`);
    ids.add(node.id);
  }

  const pairs = new Set();
  for (const edge of edges) {
    check(Array.isArray(edge) && (edge.length === 2 || edge.length === 3)
      && ids.has(edge[0]) && ids.has(edge[1])
      && (edge.length === 2 || label(edge[2], 24)), '矢印の始点、終点、またはラベルが不正です');
    const key = edge.slice(0, 2).join(':');
    check(!pairs.has(key), `矢印が重複しています (${key})`);
    pairs.add(key);
  }
  return { title, direction, nodes, edges };
}

const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });

const nodeLineHeight = 18;
const edgeLineHeight = 16;

export function wrapLabel(value, fontSize, limit) {
  const lines = [];
  let line = '';
  let width = 0;
  let widest = 0;
  for (const { segment } of segmenter.segment(value)) {
    const size = fontSize * (/^[\x20-\x7e]$/.test(segment) ? 0.9 : 1.15);
    if (width + size > limit) {
      lines.push(line);
      widest = Math.max(widest, width);
      line = '';
      width = 0;
    }
    line += segment;
    width += size;
  }
  lines.push(line);
  return { lines, width: Math.ceil(Math.max(widest, width)) };
}

const graphId = (id) => `node:${id}`;
const coord = (number) => Number(number.toFixed(2));

export function svgText(lines, x, y, lineHeight, className, escape, anchor = 'middle') {
  const start = y - (lines.length - 1) * lineHeight / 2;
  const spans = lines.map((line, i) =>
    `<tspan x="${coord(x)}" y="${coord(start + i * lineHeight)}">${escape(line)}</tspan>`).join('');
  return `<text class="${className}" dominant-baseline="central" text-anchor="${anchor}">${spans}</text>`;
}

export function renderDiagram(source, index, escape) {
  const spec = parseInput(source, ['title', 'direction', 'nodes', 'edges']);
  return renderGraph(validateGraph(spec), index, escape);
}

export function renderGraph({ title, direction, nodes, edges, details = new Map(), multiplicity = new Map(), arrows = true }, index, escape) {
  const graph = new dagre.graphlib.Graph()
    .setGraph({ rankdir: direction, nodesep: 20, ranksep: 26, marginx: 12, marginy: 12 });
  for (const node of nodes) {
    const title = wrapLabel(node.label, 14, 156);
    const fields = (details.get(node.id) ?? []).map((value) => wrapLabel(value, 12, 240));
    const fieldLines = fields.flatMap((field) => field.lines);
    const width = Math.max(88, title.width + 20, ...fields.map((field) => field.width + 20));
    const height = 14 + title.lines.length * nodeLineHeight
      + (fieldLines.length ? 10 + fieldLines.length * edgeLineHeight : 0);
    graph.setNode(graphId(node.id), { width, height, lines: title.lines, fieldLines });
  }
  for (const [from, to, caption] of edges) {
    const { lines, width } = caption ? wrapLabel(caption, 12, 112) : { lines: [], width: 0 };
    graph.setEdge(graphId(from), graphId(to), { lines, width: caption ? width + 8 : 0, height: lines.length * edgeLineHeight });
  }

  dagre.layout(graph);
  const { width, height } = graph.graph();
  const marker = `arrow-${index}`;
  const paths = edges.map(([from, to]) => {
    const { points } = graph.edge(graphId(from), graphId(to));
    const path = points.map(({ x, y }, i) => `${i ? 'L' : 'M'}${coord(x)} ${coord(y)}`).join(' ');
    const end = arrows ? ` marker-end="url(#${marker})"` : '';
    return `<path class="route" d="${path}"${end}/>`;
  }).join('');

  const boxes = nodes.map(({ id }) => {
    const { x, y, width, height, lines, fieldLines } = graph.node(graphId(id));
    const top = y - height / 2;
    const left = x - width / 2;
    const headingHeight = 14 + lines.length * nodeLineHeight;
    const box = `<rect x="${coord(left)}" y="${coord(top)}" width="${width}" height="${height}" rx="6"/>`
      + svgText(lines, x, top + headingHeight / 2, nodeLineHeight, 'node-label', escape);
    if (!fieldLines.length) return box;
    const divider = top + headingHeight;
    return box + `<path class="entity-divider" d="M${coord(left)} ${coord(divider)}h${width}"/>`
      + svgText(fieldLines, x, divider + 4 + fieldLines.length * edgeLineHeight / 2, edgeLineHeight, 'entity-fields', escape);
  }).join('');

  const captions = edges.map(([from, to, caption]) => {
    if (!caption) return '';
    const { lines, x, y, points } = graph.edge(graphId(from), graphId(to));
    const ends = multiplicity.get(`${from}:${to}`);
    if (ends) {
      const anchors = [points, [...points].reverse()];
      return ends.map((value, position) => {
        const [start, next] = anchors[position];
        const dx = next.x - start.x;
        const dy = next.y - start.y;
        const length = Math.hypot(dx, dy) || 1;
        const distance = Math.min(14, length / 2);
        return svgText([value], start.x + (dx * distance - dy * 10) / length,
          start.y + (dy * distance + dx * 10) / length, edgeLineHeight, 'edge-label', escape);
      }).join('');
    }
    return svgText(lines, x, y, edgeLineHeight, 'edge-label', escape);
  }).join('');

  const nodeLabels = new Map(nodes.map(({ id, label }) => [id, label]));
  const relationships = edges.map(([from, to, caption]) =>
    `${nodeLabels.get(from)} ${arrows ? '→' : '—'} ${nodeLabels.get(to)}${caption ? `（${caption}）` : ''}`);
  const nodeDescriptions = nodes.map(({ id, label }) =>
    details.has(id) ? `${label}（${details.get(id).join('、')}）` : label);
  const description = [...relationships, `ノード一覧: ${nodeDescriptions.join('、')}`].join('。');

  return diagramFigure({ title, index, width, height, description, drawing: paths + boxes + captions }, escape);
}

export function diagramFigure({ title, titleIcon, index, width, height, description, drawing, figureClass }, escape) {
  const marker = `arrow-${index}`;
  return `<figure class="diagram${figureClass ? ` ${figureClass}` : ''}">
<figcaption id="diagram-${index}">${titleIcon ? captionIcon(titleIcon) : ''}${escape(title)}</figcaption>
<div class="scroll diagram-scroll" tabindex="0" role="region" aria-labelledby="diagram-${index}">
<svg xmlns="http://www.w3.org/2000/svg" width="${coord(width)}" height="${coord(height)}" viewBox="0 0 ${coord(width)} ${coord(height)}" role="img" aria-labelledby="diagram-${index}" aria-describedby="description-${index}">
<desc id="description-${index}">${escape(description)}</desc>
<defs><marker id="${marker}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path class="arrowhead" d="M0 0 L8 4 L0 8 Z"/></marker></defs>
${drawing}
</svg></div></figure>\n`;
}
