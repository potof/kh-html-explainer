import { label } from './component-input.mjs';
import { diagramFigure, svgText, wrapLabel } from './diagram.mjs';

export function teamFlowchartFromMermaid({ title, description, flow }) {
  if (!/(?:体制図|組織図)/.test(title) || !flow?.plain || flow.direction !== 'LR') return;
  const { groups, edges } = flow;
  if (groups.length < 2 || groups.length > 4 || flow.nodes.length > 32 || edges.length > 32) return;
  const nodes = new Map();
  for (const { id, name, icon } of flow.nodes) {
    if (typeof name !== 'string') return;
    const lines = name.split(/<br\s*\/?>/i).map(line => line.trim());
    if (icon || nodes.has(id) || lines.length > 2 || !lines.every(line => label(line, 55) && !/[<>]/.test(line))) return;
    nodes.set(id, { lines, children: [] });
  }

  for (const [lane, group] of groups.entries()) {
    if (!label(group.name, 55) || (group.direction && !['TB', 'TD'].includes(group.direction)) || !group.members.length) return;
    for (const id of group.members) {
      const node = nodes.get(id);
      if (!node || node.lane !== undefined) return;
      node.lane = lane;
    }
  }
  if ([...nodes.values()].some(node => node.lane === undefined)) return;

  const cross = new Map();
  for (const [from, to, caption, stroke] of edges) {
    const source = nodes.get(from);
    const target = nodes.get(to);
    if (!source || !target || source === target || caption?.trim() || !['normal', 'dotted'].includes(stroke)) return;
    if (source.lane === target.lane) {
      if (target.parent) return;
      target.parent = { source, stroke };
      source.children.push(target);
    } else {
      const gutter = Math.min(source.lane, target.lane);
      if (Math.abs(source.lane - target.lane) !== 1 || cross.has(gutter)) return;
      cross.set(gutter, { source, target, stroke });
    }
  }

  const lanes = [];
  for (const [lane, group] of groups.entries()) {
    const members = group.members.map(id => nodes.get(id));
    const roots = members.filter(node => !node.parent);
    if (roots.length !== 1) return;
    const rows = [];
    function visit(node, depth) {
      (rows[depth] ??= []).push(node);
      for (const child of node.children) visit(child, depth + 1);
    }
    visit(roots[0], 0);
    if (rows.flat().length !== members.length) return;
    lanes.push({ lane, name: group.name, rows });
  }
  const describe = node => `${groups[node.lane].name}の${node.lines.join(' ')}`;
  return { title, description: description || edges.map(([from, to]) =>
    `${describe(nodes.get(from))} → ${describe(nodes.get(to))}`).join('。'), lanes, cross };
}

export function renderTeamFlowchart({ title, description, lanes, cross }, index, escape) {
  const margin = 8;
  const gutter = 36;
  const lanePadding = 10;
  const cardWidth = 104;
  const cardGap = 14;
  const rowGap = 24;
  const lineHeight = 15;
  const widestRow = Math.max(...lanes.flatMap(lane => lane.rows.map(row => row.length)));
  const laneWidth = 2 * lanePadding + widestRow * cardWidth + (widestRow - 1) * cardGap;
  const headings = lanes.map(({ name }) => wrapLabel(name, 12, laneWidth - 2 * lanePadding).lines);
  const contentTop = margin + 13 + Math.max(...headings.map(lines => lines.length)) * lineHeight;
  const laneLeft = lane => margin + lane * (laneWidth + gutter);
  const boxes = new Map();
  const rowHeights = [];
  for (const lane of lanes) {
    for (const [depth, row] of lane.rows.entries()) {
      for (const [column, node] of row.entries()) {
        const [role, name] = node.lines;
        const roleLines = wrapLabel(role, 13, cardWidth - 18).lines;
        const nameLines = name ? wrapLabel(name, 12, cardWidth - 18).lines : [];
        const height = Math.max(40, 10 + (roleLines.length + nameLines.length) * lineHeight);
        const x = laneLeft(lane.lane) + lanePadding + column * (cardWidth + cardGap);
        boxes.set(node, { x, depth, column, roleLines, nameLines });
        rowHeights[depth] = Math.max(rowHeights[depth] ?? 0, height);
      }
    }
  }
  let rowTop = contentTop;
  const rowTops = rowHeights.map(height => {
    const top = rowTop;
    rowTop += height + rowGap;
    return top;
  });
  for (const box of boxes.values()) {
    box.y = rowTops[box.depth];
    box.height = rowHeights[box.depth];
  }

  const laneHeight = rowTop - rowGap - margin + lanePadding;
  const boundaries = lanes.map(({ lane }) =>
    `<rect class="team-lane" x="${laneLeft(lane)}" y="${margin}" width="${laneWidth}" height="${laneHeight}"/>`
    + svgText(headings[lane], laneLeft(lane) + lanePadding, margin + 14 + (headings[lane].length - 1) * lineHeight / 2,
      lineHeight, 'team-lane-title', escape, 'start')).join('');
  const arrow = (path, stroke, className = '') => `<path class="route${stroke === 'dotted' ? ' team-dotted' : ''}${className}" d="${path}" marker-end="url(#arrow-${index})"/>`;
  const routes = [...boxes].filter(([node]) => node.parent).map(([node, to]) => {
    const { source, stroke } = node.parent;
    const from = boxes.get(source);
    const fromX = from.x + cardWidth / 2;
    const toX = to.x + cardWidth / 2;
    const fromBottom = from.y + from.height;
    if (fromX === toX) return arrow(`M${fromX} ${fromBottom}V${to.y}`, stroke);
    // A common horizontal branch is readable only when this row has one parent with children.
    const parents = lanes[node.lane].rows[from.depth].filter(parent => parent.children.length);
    const branch = parents.length === 1 ? `V${fromBottom + rowGap / 2}H${toX}`
      : `V${fromBottom + 4}L${toX} ${to.y - 7}`;
    return arrow(`M${fromX} ${fromBottom}${branch}V${to.y}`, stroke);
  });

  function sidePort(node, onRight) {
    const { x, y, height, column, depth } = boxes.get(node);
    const edgeColumn = onRight ? lanes[node.lane].rows[depth].length - 1 : 0;
    const sideX = x + (onRight ? cardWidth : 0);
    const sideY = y + height - 11;
    if (column === edgeColumn) return { x: sideX, y: sideY, channelY: sideY };
    // Run below the row to reach an interior card without going through its neighbours.
    return { x: sideX, y: sideY, channelY: y + height + 4, bendX: sideX + (onRight ? cardGap / 2 : -cardGap / 2) };
  }
  for (const [gapIndex, { source, target, stroke }] of cross) {
    const toRight = source.lane < target.lane;
    const from = sidePort(source, toRight);
    const to = sidePort(target, !toRight);
    const gutterX = laneLeft(gapIndex) + laneWidth + gutter / 2;
    const start = from.bendX === undefined ? '' : `H${from.bendX}V${from.channelY}`;
    const middle = from.channelY === to.channelY ? '' : `H${gutterX}V${to.channelY}`;
    const end = to.bendX === undefined ? '' : `H${to.bendX}V${to.y}`;
    routes.push(arrow(`M${from.x} ${from.y}${start}${middle}${end}H${to.x}`, stroke, ' team-cross'));
  }
  const cards = [...boxes.values()].map(({ x, y, height, roleLines, nameLines }) => {
    const top = y + (height - (roleLines.length + nameLines.length) * lineHeight) / 2 + lineHeight / 2;
    return `<rect class="team-card" x="${x}" y="${y}" width="${cardWidth}" height="${height}"/>`
      + svgText(roleLines, x + 9, top + (roleLines.length - 1) * lineHeight / 2, lineHeight, 'team-role', escape, 'start')
      + (nameLines.length ? svgText(nameLines, x + 9,
        top + (roleLines.length + (nameLines.length - 1) / 2) * lineHeight, lineHeight, 'team-name', escape, 'start') : '');
  }).join('');
  return diagramFigure({ title, index, description, figureClass: 'team-flowchart',
    width: laneLeft(lanes.length - 1) + laneWidth + margin, height: margin * 2 + laneHeight,
    drawing: boundaries + routes.join('') + cards }, escape);
}
