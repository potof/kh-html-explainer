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

function boundary(entry, x, y, width, height) {
  const classes = `aws-boundary aws-${entry.type}${entry.parent ? ' aws-nested' : ''}`;
  return `<rect class="${classes}" x="${position(x)}" y="${position(y)}" width="${position(width)}" height="${position(height)}"/>`;
}

function boundaryLabel(entry, x, y, escape) {
  return (entry.icon ? iconUse(entry.icon, x, y - 6.5, 13) : '')
    + svgText([entry.name], x + (entry.icon ? 17 : 0), y, 16, 'aws-boundary-name', escape, 'start');
}

function resource(entry, x, y, width, height, lines, escape) {
  const left = x - width / 2;
  return `<rect class="aws-node" x="${position(left)}" y="${position(y - height / 2)}" width="${width}" height="${height}"/>`
    + (entry.icon ? iconUse(entry.icon, left + 7, y - 9, 18) : '')
    + svgText(lines, x + (entry.icon ? 10 : 0), y, 16, 'node-label', escape);
}

function route(path, stroke, index) {
  const modifier = stroke && stroke !== 'normal' ? ' aws-route-' + stroke : '';
  return `<path class="route${modifier}" d="${path}" marker-end="url(#arrow-${index})"/>`;
}

function parallelPipelines({direction, nodes, boundaries, edges, entries}) {
  if (direction !== 'LR' || edges.length < 2 || edges.length > 6 || nodes.length !== edges.length * 2
    || edges.some(([, , caption]) => caption) || new Set(edges.flatMap(edge => edge.slice(0,2))).size !== nodes.length) return;
  const repo = entries.get(entries.get(edges[0][0]).parent);
  const sourceAccount = entries.get(repo?.parent);
  if (!repo || sourceAccount?.type !== 'account' || sourceAccount.parent) return;
  if (!edges.every(([from]) => entries.get(from).parent === repo.key)) return;
  const accounts = edges.map(([,to]) => entries.get(entries.get(to).parent));
  if (accounts.some(account => account?.type !== 'account' || account.parent)) return;
  const uniqueAccounts = new Set(accounts.map(account => account.key));
  if (uniqueAccounts.size !== accounts.length || !uniqueAccounts.has(sourceAccount.key)
    || boundaries.length !== uniqueAccounts.size + 1) return;
  const byBranch = new Map(edges.map(edge => [edge[0], edge]));
  return { repo, sourceAccount, edges: nodes.map(node => byBranch.get(node.key)).filter(Boolean) };
}

function drawParallelPipelines(model, lanes, index, escape) {
  const { repo, sourceAccount, edges } = lanes;
  const backgrounds = [];
  const headings = [];
  const routes = [];
  const cards = [];
  const left = 12;
  const repoLeft = left + 12;
  const textWidth = (name, size) => wrapLabel(name, size, Infinity).width;
  const pipelineWidth = item => Math.max(135, textWidth(item.name, 12) + 38);
  const repoWidth = Math.max(150, textWidth(repo.name, 12) + (repo.icon ? 31 : 14),
    ...edges.map(([from]) => textWidth(model.entries.get(from).name, 14) + 55));
  const localPipeline = edges.map(([,to]) => model.entries.get(to)).find(item => item.parent === sourceAccount.key);
  const localLeft = repoLeft + repoWidth + 33;
  const sourceRight = Math.max(localLeft + pipelineWidth(localPipeline) + 10, left + textWidth(sourceAccount.name, 12) + 20);
  const crossLeft = sourceRight + 24;
  const crossWidth = Math.max(...edges.map(([, to]) => {
    const item = model.entries.get(to);
    return Math.max(pipelineWidth(item) + 22, textWidth(model.entries.get(item.parent).name, 12) + 20);
  }));
  const first = 82;
  const step = 66;
  const bottom = first + step * (edges.length - 1) + 28;
  backgrounds.push(boundary(sourceAccount,left,13,sourceRight-left,bottom-13),
    boundary(repo,repoLeft,43,repoWidth,bottom-51));
  headings.push(boundaryLabel(sourceAccount,left+8,24,escape), boundaryLabel(repo,repoLeft+8,54,escape));
  for (const [row, [from, to, , stroke]] of edges.entries()) {
    const source = model.entries.get(from);
    const target = model.entries.get(to);
    const account = model.entries.get(target.parent);
    const y = first + step * row;
    const local = account.key === sourceAccount.key;
    const destination = local ? localLeft : crossLeft + 11;
    const start = repoLeft + 12;
    const width = repoWidth - 24;
    if (!local) {
      backgrounds.push(boundary(account,crossLeft,y-35,crossWidth,61));
      headings.push(boundaryLabel(account,crossLeft+8,y-24,escape));
    }
    routes.push(route(`M${start+width} ${y}H${destination}`,stroke,index));
    cards.push(resource(source,start+width/2,y,width,30,[source.name],escape));
    const targetWidth = pipelineWidth(target);
    cards.push(resource(target,destination+targetWidth/2,y,targetWidth,30,[target.name],escape));
  }
  return {
    width: crossLeft + crossWidth + 12, height: bottom + 12,
    drawing: [...backgrounds,...routes,...cards,...headings].join(''),
  };
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
  return renderAwsGraph({ ...parse(source, usedIcons), direction: 'TB', legacy: true }, index, escape);
}

export function renderAwsGraph(model, index, escape) {
  const { title, titleIcon, nodes, boundaries, edges, entries, direction, legacy } = model;
  const readableName = value => legacy ? value.replaceAll(' | ', ' ') : value;
  const relationships = [...boundaries, ...nodes].filter(item => item.parent)
    .map(item => `${entries.get(item.parent).name}に${readableName(item.name)}が所属`);
  const connections = edges.map(([from, to, caption]) =>
    `${readableName(entries.get(from).name)} → ${readableName(entries.get(to).name)}${caption ? `（${caption}）` : ''}`);
  const view = { title, titleIcon, index, figureClass: 'aws-boxed',
    description: model.description || [...relationships, ...connections].join('。') };
  const lanes = parallelPipelines(model);
  if (lanes) return diagramFigure({ ...view, ...drawParallelPipelines(model,lanes,index,escape) }, escape);
  const graph = new dagre.graphlib.Graph({ compound: true })
    .setGraph({ rankdir: direction, nodesep: 26, edgesep: 12, ranksep: legacy ? (boundaries.length ? 39 : 24) : (boundaries.length ? 28 : 18), marginx: 14, marginy: 13 });
  for (const { key, parent } of boundaries) {
    graph.setNode(graphId(key), {});
    if (parent) graph.setParent(graphId(key), graphId(parent));
  }
  for (const { key, name, icon, parent } of nodes) {
    const { width, lines } = legacy ? diagramLabel(name, 14) : wrapLabel(name, 14, 175);
    graph.setNode(graphId(key), {
      width: Math.max(width + (icon ? 42 : 24), legacy ? 132 : 92), height: 14 + 16 * lines.length, lines,
    });
    if (parent) graph.setParent(graphId(key), graphId(parent));
  }
  for (const [from, to, caption] of edges) {
    const { lines, width } = caption ? (legacy ? diagramLabel(caption, 12) : wrapLabel(caption, 12, 110)) : { lines: [], width: 0 };
    graph.setEdge(graphId(from), graphId(to), { lines, width: caption ? width + 10 : 0, height: lines.length * 15 });
  }
  dagre.layout(graph);

  const paths = edges.map(([from, to]) => graph.edge(graphId(from), graphId(to)).points);
  const outlines = [];
  const names = [];
  for (const entry of boundaries) {
    const { key, name, icon } = entry;
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
    outlines.push(boundary(entry,left,top,width,height));
    names.push(boundaryLabel(entry,textX,header,escape));
  }

  const routes = paths.map((points, i) => {
    const path = points.map(({ x, y }, i) => `${i ? 'L' : 'M'}${position(x)} ${position(y)}`).join(' ');
    return route(path, edges[i][3], index);
  });
  const resources = nodes.map(entry => {
    const { x, y, width, height, lines } = graph.node(graphId(entry.key));
    return resource(entry,x,y,width,height,lines,escape);
  });
  const captions = edges.flatMap(([from, to, caption]) => {
    if (!caption) return [];
    const { x, y, lines } = graph.edge(graphId(from), graphId(to));
    return [svgText(lines, x, y, 15, 'edge-label', escape)];
  });

  const { width, height } = graph.graph();
  return diagramFigure({
    ...view, width, height,
    drawing: [...outlines, ...routes, ...resources, ...names, ...captions].join(''),
  }, escape);
}
