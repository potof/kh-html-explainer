import { check, label } from './component-input.mjs';

export const dayMillis = 86_400_000;
const idPattern = /^[a-z0-9_][a-z0-9_-]{0,63}$/i;
const taskTags = new Set(['done', 'active', 'crit', 'milestone']);
const weekday = ['日', '月', '火', '水', '木', '金', '土'];

export const utcDate = day => new Date(day * dayMillis);
export const isoDate = day => utcDate(day).toISOString().slice(0, 10);

function parseDay(value, context) {
  const millis = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(value) : NaN;
  check(Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value,
    context + 'の日付は実在する YYYY-MM-DD を指定してください');
  return millis / dayMillis;
}

function assertCount(tasks) {
  check(tasks.length >= 1 && tasks.length <= 24, '作業とマイルストーンは合計1〜24件です');
}

function parseLegacy(rows) {
  const title = rows[0]?.startsWith('title:') ? rows.shift().slice(6).trim() : 'ガントチャート';
  check(label(title, 100), 'title は1〜100文字の1行テキストにしてください');
  assertCount(rows);
  const tasks = rows.map((row, index) => {
    const fields = row.split('|').map(field => field.trim());
    const context = '日程' + (index + 1);
    check(fields.length === 2 || fields.length === 3,
      context + 'は「開始日 | 終了日 | 作業名」または「日付 | マイルストーン名」の形式で指定してください');
    const name = fields.at(-1);
    check(label(name, 60), context + 'の名前は1〜60文字の1行テキストにしてください');
    const start = parseDay(fields[0], context);
    const marker = fields.length === 2 ? start + 0.5 : undefined;
    const end = marker === undefined ? parseDay(fields[1], context) : start;
    check(start <= end, context + 'の終了日を開始日以降にしてください');
    return { name, start, end, finish: end + 1, marker, tags: new Set() };
  });
  return { title, tasks };
}

function axisLabeler(format) {
  const tokens = /%%|%-?[YymdewaA]/g;
  check(label(format, 24) && !format.replace(tokens, '').includes('%'),
    'axisFormat には %Y、%y、%m、%d、%e、%w、%a、%A、%% を指定できます');
  return (day) => {
    const date = utcDate(day);
    const year = String(date.getUTCFullYear()).padStart(4, '0');
    const month = String(date.getUTCMonth() + 1);
    const dateNumber = String(date.getUTCDate());
    const dayOfWeek = date.getUTCDay();
    const values = { Y: year, y: year.slice(-2), m: month.padStart(2, '0'), d: dateNumber.padStart(2, '0'),
      e: dateNumber.padStart(2, ' '), w: String(dayOfWeek), a: weekday[dayOfWeek], A: weekday[dayOfWeek] + '曜日' };
    return format.replace(tokens, token => {
      if (token === '%%') return '%';
      const value = values[token.at(-1)];
      return token[1] === '-' ? value.trim().replace(/^0+(?=\d)/, '') : value;
    });
  };
}

function parseTask(line, context, section) {
  const colon = line.indexOf(':');
  check(colon > 0, context + 'は「タスク名 : タグ, ID, 開始, 終了」の形式で指定してください');
  const name = line.slice(0, colon).trim();
  check(label(name, 60), context + 'の名前は1〜60文字の1行テキストにしてください');
  const fields = line.slice(colon + 1).split(',').map(field => field.trim());
  const tags = new Set();
  while (taskTags.has(fields[0])) tags.add(fields.shift());
  check(fields.length >= 1 && fields.length <= 3 && fields.every(Boolean),
    context + 'のメタデータは終了、開始・終了、またはID・開始・終了を指定してください');
  const id = fields.length === 3 ? fields.shift() : undefined;
  check(id === undefined || idPattern.test(id), context + 'のタスクIDが不正です');
  const [startSpec, endSpec] = fields.length === 1 ? [undefined, fields[0]] : fields;
  return { name, id, context, section, tags, startSpec, endSpec };
}

function resolveTasks(specs) {
  const byId = new Map();
  const resolved = new Map();
  const pending = new Set();
  for (const [index, { id, context }] of specs.entries()) {
    if (id === undefined) continue;
    check(!byId.has(id), context + 'のタスクIDが重複しています');
    byId.set(id, index);
  }
  function target(id, context) {
    check(byId.has(id), context + 'に未定義の依存タスクIDがあります');
    return resolve(byId.get(id));
  }
  function resolve(index) {
    if (resolved.has(index)) return resolved.get(index);
    const { name, context, section, tags, startSpec, endSpec } = specs[index];
    check(!pending.has(index), context + 'のタスク依存が循環しています');
    pending.add(index);

    let start;
    if (!startSpec) {
      check(index > 0, '最初のタスクには明示的な開始日か依存先が必要です');
      start = resolve(index - 1).finish;
    } else if (/^after\s/.test(startSpec)) {
      const ids = startSpec.split(/\s+/).slice(1);
      start = Math.max(...ids.map(id => target(id, context).finish));
    } else {
      start = parseDay(startSpec, context);
    }

    const duration = endSpec.match(/^(\d+)([dw])$/);
    let finish;
    if (duration) {
      finish = start + Number(duration[1]) * (duration[2] === 'w' ? 7 : 1);
      check(Number.isSafeInteger(finish) && /^\d{4}-/.test(utcDate(finish).toJSON() ?? ''),
        context + 'の終了日は4桁の年で表せる範囲を指定してください');
    } else if (/^until\s/.test(endSpec)) {
      finish = target(endSpec.slice(5).trim(), context).start;
    } else {
      finish = parseDay(endSpec, context);
    }
    check(start <= finish, context + 'の終了日を開始日以降にしてください');
    const marker = tags.has('milestone') ? (start + finish) / 2 : undefined;
    const task = { name, section, tags, start, end: finish, finish, marker };
    resolved.set(index, task);
    pending.delete(index);
    return task;
  }
  return specs.map((_, index) => resolve(index));
}

function parseMermaid(lines) {
  let title = 'ガントチャート';
  let formatAxis;
  let section;
  const specs = [];
  for (const [index, line] of lines.entries()) {
    if (!line) continue;
    const context = 'ガントブロック' + (index + 1) + '行目';
    check(!line.startsWith('%%{'), context + 'のMermaid設定指令は使用できません');
    if (line.startsWith('%%') || line === 'gantt') continue;
    const command = line.match(/^(title|dateFormat|axisFormat|section)\s+(.+)$/);
    if (command) {
      const [, keyword, value] = command;
      if (keyword === 'title') {
        check(label(value, 100), 'title は1〜100文字の1行テキストにしてください');
        title = value;
      } else if (keyword === 'dateFormat') {
        check(value === 'YYYY-MM-DD', 'dateFormat には YYYY-MM-DD を指定してください');
      } else if (keyword === 'axisFormat') {
        formatAxis = axisLabeler(value);
      } else {
        check(label(value, 60), 'section は1〜60文字の1行テキストにしてください');
        section = { name: value };
      }
      continue;
    }
    specs.push(parseTask(line, context, section));
  }
  assertCount(specs);
  return { title, tasks: resolveTasks(specs), formatAxis };
}

export function isMermaidGantt(source) {
  return source.split('\n').map(line => line.trim()).find(line => line && !line.startsWith('%%')) === 'gantt';
}

export function parseGantt(source) {
  check(Buffer.byteLength(source) <= 16_384, '入力は16 KiBまでです');
  const lines = source.split('\n').map(line => line.trim());
  return isMermaidGantt(source) ? parseMermaid(lines) : parseLegacy(lines.filter(Boolean));
}
