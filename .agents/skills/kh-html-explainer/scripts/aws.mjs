import { readIconLabel, iconUse } from './icon-markup.mjs';
import dagre from '@dagrejs/dagre';
import { check, label } from './component-input.mjs';
import { diagramFigure, svgText, wrapLabel } from './diagram.mjs';

const boundaryTypes = new Set(['organization', 'account', 'ou', 'vpc', 'az', 'subnet', 'task', 'service']);
const id = '[a-z][a-z0-9_]{0,31}';
const scopePattern = new RegExp(`^scope ([a-z]+) (${id}) (.+)$`);
const nodePattern = new RegExp(`^node (${id}) (.+)$`);
const edgePattern = new RegExp(`^(${id}) -> (${id})(?: (.+))?$`);
const graphId = id => `aws:${id}`;
const position = value => Number(value.toFixed(1));

function diagramLabel(value, fontSize) {
  const lines = value.split(' | ');
  const width = Math.max(...lines.map(line => wrapLabel(line, fontSize, Infinity).width));
  return { width, lines };
}

function parse(source, usedIcons) {
  check(Buffer.byteLength(source) <= 16384, 'AWS 図は16 KiBまでです');
  const lines = source.trimEnd().split('\n');
  const titleLine = lines.shift()?.match(/^title: (.+)$/)?.[1];
  check(titleLine, 'title: を指定してください');
  const { name: title, icon: titleIcon } = readIconLabel(titleLine, usedIcons);
  check(label(title, 100), 'title: は100文字までです');
  const parents = [];
  const entries = new Map();
  const edges = [];
  const pairs = new Set();

  for (const [row, line] of lines.entries()) {
    if (!line.trim()) continue;
    const [indent] = line.match(/^ */);
    const level = indent.length / 2;
    const text = line.slice(indent.length);
    const connection = text.match(edgePattern);
    if (connection) {
      const [, from, to, caption] = connection;
      const pair = `${from}:${to}`;
      check(level === 0 && from !== to && !pairs.has(pair) && edges.length < 64
        && (!caption || label(caption, 24)), `AWS 図 ${row + 2}行目の接続が不正です`);
      pairs.add(pair);
      edges.push([from, to, caption]);
      continue;
    }

    const scope = text.match(scopePattern);
    const node = text.match(nodePattern);
    check(scope || node, `AWS 図 ${row + 2}行目の宣言が不正です`);
    const [type, key, itemLabel] = scope ? scope.slice(1) : ['node', ...node.slice(1)];
    const { name, icon } = readIconLabel(itemLabel, usedIcons);
    check((!scope || boundaryTypes.has(type)) && label(name, 36) && Number.isInteger(level)
      && level <= parents.length && level <= 5 && !entries.has(key) && entries.size < 32,
    `AWS 図 ${row + 2}行目の所属またはラベルが不正です`);
    parents.length = level;
    entries.set(key, { key, name, type, icon, parent: parents.at(-1) });
    if (scope) parents.push(key);
  }

  const nodes = [...entries.values()].filter(item => item.type === 'node');
  const boundaries = [...entries.values()].filter(item => item.type !== 'node');
  const parentsWithChildren = new Set([...entries.values()].map(item => item.parent));
  check(nodes.length > 0 && boundaries.every(item => parentsWithChildren.has(item.key)),
    'ノードと、空でない境界を宣言してください');
  check(edges.every(([from, to]) => entries.get(from)?.type === 'node' && entries.get(to)?.type === 'node'),
    '接続には宣言済みのノードを指定してください');
  return { title, titleIcon, nodes, boundaries, edges, entries };
}

export function renderAws(source, index, escape, usedIcons) {
  const { title, titleIcon, nodes, boundaries, edges, entries } = parse(source, usedIcons);
  const graph = new dagre.graphlib.Graph({ compound: true })
    .setGraph({ rankdir: 'TB', nodesep: 26, edgesep: 12, ranksep: boundaries.length ? 39 : 24, marginx: 14, marginy: 13 });
  for (const { key, parent } of boundaries) {
    graph.setNode(graphId(key), {});
    if (parent) graph.setParent(graphId(key), graphId(parent));
  }
  for (const { key, name, icon, parent } of nodes) {
    const { width, lines } = diagramLabel(name, 14);
    graph.setNode(graphId(key), { width: Math.max(width + (icon ? 48 : 24), 132), height: 14 + 16 * lines.length, lines });
    if (parent) graph.setParent(graphId(key), graphId(parent));
  }
  for (const [from, to, caption] of edges) {
    const { lines, width } = caption ? diagramLabel(caption, 12) : { lines: [], width: 0 };
    graph.setEdge(graphId(from), graphId(to), { lines, width: caption ? width + 10 : 0, height: lines.length * 15 });
  }
  dagre.layout(graph);

  const paths = edges.map(([from, to]) => graph.edge(graphId(from), graphId(to)).points);
  const outlines = [];
  const names = [];
  for (const { key, type, name, icon } of boundaries) {
    const { x, y, width, height } = graph.node(graphId(key));
    const left = x - width / 2;
    const top = y - height / 2;
    const header = top + 9.5;
    const iconWidth = icon ? 17 : 0;
    const nameWidth = wrapLabel(name, 12, Infinity).width + iconWidth;
    const offset = 7;
    const crossings = paths.flatMap(points => points.slice(1).flatMap((point, i) => {
      const previous = points[i];
      if (Math.min(previous.y, point.y) > header + 6 || Math.max(previous.y, point.y) < header - 6) return [];
      const ratio = point.y === previous.y ? 0.5 : Math.max(0, Math.min(1, (header - previous.y) / (point.y - previous.y)));
      return [previous.x + ratio * (point.x - previous.x)];
    }));
    const start = left + offset;
    const end = left + width - offset - nameWidth;
    const candidates = [start, ...crossings.map(crossing => crossing + 8).sort((a, b) => a - b)];
    const textX = candidates.find(candidate => candidate >= start && candidate <= end &&
      crossings.every(crossing => crossing < candidate - 4 || crossing > candidate + nameWidth + 4)) ?? start;
    outlines.push(`<rect class="aws-boundary aws-${type}" x="${position(left)}" y="${position(top)}" width="${position(width)}" height="${position(height)}"/>`);
    if (icon) names.push(iconUse(icon, textX, header - 6.5, 13));
    names.push(`<text class="aws-boundary-name" x="${position(textX + iconWidth)}" y="${position(header)}" dominant-baseline="central">${escape(name)}</text>`);
  }

  const routes = paths.map(points => {
    const path = points.map(({ x, y }, i) => `${i ? 'L' : 'M'}${position(x)} ${position(y)}`).join(' ');
    return `<path class="route" d="${path}" marker-end="url(#arrow-${index})"/>`;
  });
  const resources = nodes.map(({ key, icon }) => {
    const { x, y, width, height, lines } = graph.node(graphId(key));
    return `<rect class="aws-node" x="${position(x - width / 2)}" y="${position(y - height / 2)}" width="${width}" height="${height}"/>`
      + (icon ? iconUse(icon, x - width / 2 + 8, y - 10, 20) : '')
      + svgText(lines, x + (icon ? 12 : 0), y, 16, 'node-label', escape);
  });
  const captions = edges.flatMap(([from, to, caption]) => {
    if (!caption) return [];
    const { x, y, lines } = graph.edge(graphId(from), graphId(to));
    return [svgText(lines, x, y, 15, 'edge-label', escape)];
  });

  const relationships = [...boundaries, ...nodes].filter(item => item.parent)
    .map(item => `${entries.get(item.parent).name}に${item.name.replaceAll(' | ', ' ')}が所属`);
  const connections = edges.map(([from, to, caption]) =>
    `${entries.get(from).name.replaceAll(' | ', ' ')} → ${entries.get(to).name.replaceAll(' | ', ' ')}${caption ? `（${caption}）` : ''}`);
  const { width, height } = graph.graph();
  return diagramFigure({
    title, titleIcon, index, width, height, description: [...relationships, ...connections].join('。'),
    drawing: [...outlines, ...routes, ...resources, ...names, ...captions].join(''),
  }, escape);
}
