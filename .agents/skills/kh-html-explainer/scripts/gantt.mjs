import { parseGantt, dayMillis, utcDate, isoDate } from './gantt-input.mjs';
import { diagramFigure, svgText, wrapLabel } from './diagram.mjs';

const width = 756;
const left = 172;
const right = 722;
const header = 34;

function axisTicks(start, end) {
  const days = end - start + 1;
  const ticks = [];
  if (days <= 84) {
    const step = days <= 14 ? 1 : 7;
    const offset = step === 1 ? 0 : (8 - utcDate(start).getUTCDay()) % 7;
    for (let day = start + offset; day <= end; day += step) {
      const date = utcDate(day);
      ticks.push({ day, labelDay: day + (step === 1 ? 0.5 : 0), text: `${date.getUTCMonth() + 1}/${date.getUTCDate()}` });
    }
    return ticks;
  }

  const step = days <= 366 ? 1 : days <= 1096 ? 3 : 12 * Math.ceil(days / 3652);
  const date = utcDate(start);
  const startYear = date.getUTCFullYear();
  const month = date.getUTCMonth();
  date.setUTCDate(1);
  date.setUTCMonth(month - month % step);
  for (let day = date.valueOf() / dayMillis; day <= end; day = date.setUTCMonth(date.getUTCMonth() + step) / dayMillis) {
    if (day < start) continue;
    const year = date.getUTCFullYear();
    const monthName = `${date.getUTCMonth() + 1}月`;
    const text = step >= 12 ? `${year}年` : (step > 1 || (year !== startYear && date.getUTCMonth() === 0))
      ? `${year}/${date.getUTCMonth() + 1}` : monthName;
    ticks.push({ day, labelDay: day, text });
  }
  return ticks;
}

const progressLabels = { done: '完了', delayed: '遅延', active: '進行中' };

function statusText(task) {
  return [progressLabels[task.progress], task.tags.has('crit') ? '重要' : ''].filter(Boolean).join('・');
}

function taskShape(task, x, y) {
  const classes = (task.progress ? ' gantt-' + task.progress : '') + (task.tags.has('crit') ? ' gantt-crit' : '');
  if (task.marker !== undefined) {
    return `<path class="gantt-milestone${classes}" d="M${x(task.marker)} ${y - 7}l7 7 -7 7 -7 -7Z"/>`;
  }
  const barX = x(task.start);
  const barWidth = Math.max(1, Number((x(task.finish) - barX).toFixed(2)));
  return `<rect class="gantt-bar${classes}" x="${Math.min(barX, right - 1)}" y="${y - 5}" width="${barWidth}" height="10"/>`;
}

function tickLabels(ticks, formatAxis, x, finish, escape) {
  let lastEdge = -Infinity;
  const labels = [];
  for (const tick of ticks) {
    const format = formatAxis ? formatAxis(tick.day) : tick.text;
    const requestedCenter = x(Math.min(formatAxis ? tick.day : tick.labelDay, finish));
    const estimatedWidth = /^[\x20-\x7e]+$/.test(format) ? format.length * 7
      : wrapLabel(format, 12, Infinity).width;
    const halfWidth = estimatedWidth / 2;
    const center = Math.min(requestedCenter, width - halfWidth - 4);
    if (formatAxis && center - halfWidth < lastEdge + 6) continue;
    labels.push(svgText([format], center, 19, 14, 'gantt-tick', escape));
    lastEdge = center + halfWidth;
  }
  return labels.join('');
}

function taskDates(task, time) {
  return task.marker === undefined
    ? time(isoDate(task.start)) + '〜<wbr>' + time(isoDate(task.end))
    : time(isoDate(Math.floor(task.marker))) + '（マイルストーン）';
}

function dateTable(tasks, escape) {
  const time = date => `<time datetime="${date}">${date}</time>`;
  const details = tasks.map(task => {
    const status = statusText(task);
    const delayClass = task.progress === 'delayed' ? ' gantt-delayed' : '';
    const note = status ? ` <small class="gantt-status-text${delayClass}">（${status}）</small>` : '';
    const rowClass = task.progress === 'done' ? ' class="gantt-done-row"' : '';
    return `<tr${rowClass}><th scope="row">${escape(task.name)}${note}</th><td>${taskDates(task, time)}</td></tr>`;
  }).join('');
  return '<details class="chart-values"><summary>日程一覧</summary><table><thead><tr><th scope="col">作業・節目</th>'
    + `<th scope="col">日程</th></tr></thead><tbody>${details}</tbody></table></details>`;
}

export function renderGantt(source, index, escape) {
  const { title, tasks: parsedTasks, formatAxis } = parseGantt(source);
  const tasks = parsedTasks.map(task => ({
    ...task, progress: Object.keys(progressLabels).find(tag => task.tags.has(tag)),
  }));
  const start = Math.min(...tasks.map(task => task.start));
  const end = Math.max(...tasks.map(task => task.end));
  const finish = Math.max(start + 1, ...tasks.map(task => task.finish));
  const x = day => Number((left + (day - start) * (right - left) / (finish - start)).toFixed(2));
  const rowLines = [`M14 ${header}H${right}`];
  const rows = [];
  const bands = [];
  const doneRows = [];
  let bottom = header;
  let section;

  for (const task of tasks) {
    if (task.section && task.section !== section) {
      section = task.section;
      const { lines } = wrapLabel(section.name, 12, right - 40);
      const height = 12 + lines.length * 15;
      bands.push(`<rect class="gantt-section-band" x="14" y="${bottom}" width="${right - 14}" height="${height}"/>`);
      rows.push(svgText(lines, 23, bottom + height / 2, 15, 'gantt-section-label', escape, 'start'));
      bottom += height;
    }

    const { lines } = wrapLabel(task.name, 13, left - 36);
    const status = statusText(task);
    const nameHeight = lines.length * 16;
    const statusHeight = status ? 13 : 0;
    const rowHeight = Math.max(32, 14 + nameHeight + statusHeight);
    const y = bottom + rowHeight / 2;
    if (task.progress === 'done') {
      doneRows.push(`<rect class="gantt-done-row" x="14" y="${bottom}" width="${right - 14}" height="${rowHeight}"/>`);
    }
    rows.push(svgText(lines, 23, y - statusHeight / 2, 16, 'gantt-label', escape, 'start') + taskShape(task, x, y));
    if (status) {
      const statusClass = task.progress === 'delayed' ? 'gantt-status gantt-delayed' : 'gantt-status';
      rows.push(svgText([status], 23, y + nameHeight / 2, 13, statusClass, escape, 'start'));
    }
    bottom += rowHeight;
    rowLines.push(`M14 ${bottom}H${right}`);
  }

  const ticks = axisTicks(start, end);
  const grid = ticks.filter(tick => tick.day > start && tick.day < finish)
    .map(tick => `M${x(tick.day)} ${header}V${bottom}`);
  const axis = `<path class="gantt-grid" d="${[...rowLines, `M${left} ${header}V${bottom}`,
    `M${right} ${header}V${bottom}`, ...grid].join(' ')}"/>`;
  const description = tasks.map(task => {
    const dates = task.marker === undefined ? isoDate(task.start) + '〜' + isoDate(task.end)
      : 'マイルストーン、' + isoDate(Math.floor(task.marker));
    const status = statusText(task);
    return `${task.name}（${dates}${status ? '、' + status : ''}）`;
  }).join('。');

  const figure = diagramFigure({
    title: `${title}（${isoDate(start)}〜${isoDate(end)}）`, index, figureClass: 'gantt', width,
    height: bottom + 12, description,
    drawing: doneRows.join('') + axis + bands.join('') + tickLabels(ticks, formatAxis, x, finish, escape) + rows.join(''),
  }, escape);
  return figure.replace('</figure>', `${dateTable(tasks, escape)}</figure>`);
}
