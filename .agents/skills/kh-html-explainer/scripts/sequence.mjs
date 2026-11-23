import { diagramFigure, svgText, wrapLabel } from './diagram.mjs';
import { readIconLabel, iconUse } from './icon-markup.mjs';

const lineControls = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

function validText(value, limit) {
  return value && [...value].length <= limit && !lineControls.test(value);
}

function parseSequence(source, usedIcons) {
  if (Buffer.byteLength(source) > 16_384) throw new Error('入力は16 KiBまでです');
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  const title = lines[0]?.match(/^title:\s*(.*)$/)?.[1];
  if (title !== undefined) {
    if (!validText(title, 100)) throw new Error('title は100文字までの1行テキストにしてください');
    lines.shift();
  }

  const participantList = lines.shift()?.match(/^participants:\s*(.+)$/)?.[1];
  const entries = participantList?.split(',').map(entry => readIconLabel(entry.trim(), usedIcons)) ?? [];
  const participants = entries.map(({ name }) => name);
  const icons = new Map(entries.filter(({ icon }) => icon).map(({ name, icon }) => [name, icon]));
  if (participants.length < 2 || participants.length > 8 || new Set(participants).size !== participants.length
    || participants.some((name) => !validText(name, 32) || /:|->/.test(name))) {
    throw new Error('participants: に重複しない名前を2〜8件、カンマ区切りで指定してください');
  }
  if (lines.length < 1 || lines.length > 32) throw new Error('メッセージは1〜32件です');

  const messages = lines.map((line, index) => {
    const match = line.match(/^(.+?)\s+(-->|->)\s+([^:]+):\s*(.*)$/);
    if (!match) throw new Error(`メッセージ${index + 1}は「送信元 -> 受信先: 内容」の形式にしてください`);
    const [, from, arrow, target, label] = match;
    const to = target.trim();
    if (!participants.includes(from) || !participants.includes(to)) {
      throw new Error(`メッセージ${index + 1}の送信元または受信先が未定義です`);
    }
    if (!validText(label, 90)) throw new Error(`メッセージ${index + 1}の内容は90文字までです`);
    return { from, to, reply: arrow === '-->', label };
  });

  return { title: title ?? 'シーケンス図', participants, messages, icons };
}

export function renderSequence(source, index, escape, usedIcons) {
  const { title, participants, messages, icons } = parseSequence(source, usedIcons);
  const spacing = 160;
  const centers = new Map(participants.map((name, position) => [name, 76 + position * spacing]));
  const names = participants.map(name => wrapLabel(name, 14, icons.has(name) ? 104 : 116).lines);
  const headerHeight = 20 + 18 * Math.max(...names.map((lines) => lines.length));
  const start = 12 + headerHeight;
  const last = centers.get(participants.at(-1));
  const marker = `url(#arrow-${index})`;
  let width = last + 76;
  let y = start + 14;

  const arrows = messages.map(({ from, to, reply, label }, position) => {
    const x1 = centers.get(from);
    const x2 = centers.get(to);
    const self = from === to;
    const limit = self ? 108 : Math.min(Math.abs(x2 - x1) - 18, 240);
    const { lines } = wrapLabel(`${position + 1}. ${label}`, 12, limit);
    const center = self ? x1 + 61 : (x1 + x2) / 2;
    const labelY = y + (lines.length - 1) * 8;
    const arrowY = y + lines.length * 16;
    const path = self
      ? `M${x1} ${arrowY}h54v16H${x1 + 2}`
      : `M${x1} ${arrowY}H${x2 - Math.sign(x2 - x1) * 2}`;
    if (self) width = Math.max(width, x1 + 129);
    y = arrowY + (self ? 34 : 22);
    return `<path class="route${reply ? ' sequence-reply' : ''}" d="${path}" marker-end="${marker}"/>`
      + svgText(lines, center, labelY, 16, 'edge-label', escape);
  });
  const lifelines = participants.map((name, position) => {
    const x = centers.get(name);
    const icon = icons.get(name);
    return `<path class="sequence-lifeline" d="M${x} ${start}V${y - 5}"/>`
      + `<rect x="${x - 64}" y="12" width="128" height="${headerHeight}" rx="6"/>`
      + (icon ? iconUse(icon, x - 56, 12 + headerHeight / 2 - 10, 20) : '')
      + svgText(names[position], x + (icon ? 16 : 0), 12 + headerHeight / 2, 18, 'node-label', escape);
  });

  const description = messages.map(({ from, to, reply, label }, position) =>
    `${position + 1}. ${from} → ${to}（${reply ? '応答、' : ''}${label}）`).join('。');
  return diagramFigure({ title, index, width, height: y, description, drawing: lifelines.join('') + arrows.join('') }, escape);
}
