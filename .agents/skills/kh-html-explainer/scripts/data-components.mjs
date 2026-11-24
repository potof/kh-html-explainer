import { check, label, parseInput, record } from './component-input.mjs';
import { diagramFigure, svgText, wrapLabel } from './diagram.mjs';

export function renderTimeline(source, escape) {
  return renderTimelineEvents(parseInput(source, ['title', 'events']), escape);
}

export function renderTimelineEvents({ title, events }, escape) {
  check(label(title, 100), 'title は100文字までの1行テキストです');
  check(Array.isArray(events) && events.length >= 1 && events.length <= 24, 'events は1〜24件です');
  const items = events.map((event) => {
    check(record(event, ['when', 'title', 'note']) && label(event.when, 40) && label(event.title, 80)
      && (event.note === undefined || label(event.note, 200)), 'events に日時、見出し、任意の補足を指定してください');
    return `<li><span class="timeline-when">${escape(event.when)}</span><strong>${escape(event.title)}</strong>`
      + (event.note ? `<p>${escape(event.note)}</p>` : '') + '</li>';
  });
  return `<figure class="timeline"><figcaption>${escape(title)}</figcaption><ol>${items.join('')}</ol></figure>\n`;
}

export function chartValues(plots, unit, escape) {
  const sections = plots.map(({ title, type, data }, index) => {
    const rows = data.map(([name, value]) => `<tr><th scope="row">${escape(String(name))}</th><td>${escape(String(value))}</td></tr>`).join('');
    const caption = plots.length > 1 ? `<caption>${escape(title || `${type === 'bar' ? '棒' : '折れ線'} ${index + 1}`)}</caption>` : '';
    return `<table>${caption}<thead><tr><th scope="col">項目</th><th scope="col">${escape(unit || '値')}</th></tr></thead><tbody>${rows}</tbody></table>`;
  });
  return `<details class="chart-values"><summary>数値一覧</summary>${sections.join('\n')}</details>`;
}

function numberText(value) {
  return Number(value.toPrecision(8)).toString();
}

export function renderChart(source, index, escape) {
  const { title, type, values, unit } = parseInput(source, ['title', 'type', 'values', 'unit']);
  check(label(title, 100), 'title は100文字までの1行テキストです');
  check(['bar', 'line'].includes(type), 'type は bar または line です');
  check(unit === undefined || label(unit, 24), 'unit は24文字までの1行テキストです');
  const minimum = type === 'line' ? 2 : 1;
  check(Array.isArray(values) && values.length >= minimum && values.length <= 24, `values は${minimum}〜24件です`);
  check(values.every((item) => Array.isArray(item) && item.length === 2 && label(item[0], 32)
    && Number.isFinite(item[1]) && Math.abs(item[1]) <= 1e9), 'values は [ラベル, ±10億以内の数値] の配列です');

  const numbers = values.map(([, value]) => value);
  const low = Math.min(...numbers, 0);
  const high = Math.max(...numbers, 0) || (low === 0 ? 1 : 0);
  const fullTitle = unit ? `${title}（${unit}）` : title;
  const result = type === 'bar' ? barChart(values, low, high, escape) : lineChart(values, low, high, escape);
  const description = values.map(([name, value]) => `${name}: ${value}${unit ?? ''}`).join('。');
  const figure = diagramFigure({ title: fullTitle, index, description, ...result }, escape);
  return figure.replace('</figure>', () => `${chartValues([{ data: values }], unit, escape)}</figure>`);
}

function barChart(values, low, high, escape) {
  const width = 600;
  const x = (value) => Math.round(192 + ((value - low) / (high - low)) * 334);
  const zero = x(0);
  let y = 12;
  const bars = values.map(([name, value]) => {
    const { lines } = wrapLabel(name, 12, 159);
    const row = Math.max(lines.length * 15 + 8, 26);
    const end = x(value);
    const center = y + row / 2;
    y += row;
    return svgText(lines, 92, center, 15, 'chart-text', escape)
      + `<rect class="chart-bar" x="${Math.min(zero, end)}" y="${center - 6}" width="${Math.abs(end - zero)}" height="12"/>`
      + svgText([numberText(value)], 561, center, 15, 'chart-text', escape);
  });
  return { width, height: y + 12, drawing: `<path class="chart-axis" d="M${zero} 9V${y}"/>` + bars.join('') };
}

function lineChart(values, low, high, escape) {
  const width = Math.max(500, 110 + 92 * (values.length - 1));
  const height = 240;
  const coordX = (index) => Math.round(91 + (width - 147) * index / (values.length - 1));
  const coordY = (value) => Math.round(22 + ((high - value) / (high - low)) * 142);
  const points = values.map(([, value], index) => [coordX(index), coordY(value)]);
  const ticks = [high, (high + low) / 2, low].map((value) => {
    const y = coordY(value);
    return `<path class="chart-axis" d="M82 ${y}H${width - 38}"/>`
      + svgText([numberText(value)], 42, y, 14, 'chart-text', escape);
  });
  const markers = values.map(([name], index) => {
    const [x, y] = points[index];
    const label = wrapLabel(name, 12, 84).lines;
    const lines = label.length > 3 ? [...label.slice(0, 2), label[2] + '…'] : label;
    return `<circle class="chart-point" cx="${x}" cy="${y}" r="3.5"/>`
      + svgText(lines, x, 190 + (lines.length - 1) * 7.5, 15, 'chart-text', escape);
  });
  const line = `<polyline class="chart-line" points="${points.map((point) => point.join(',')).join(' ')}"/>`;
  return { width, height, drawing: ticks.join('') + line + markers.join('') };
}
