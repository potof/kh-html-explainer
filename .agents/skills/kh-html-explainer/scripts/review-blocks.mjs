import { check, label, parseInput } from './component-input.mjs';

const calloutKinds = new Map([
  ['key', '要点'],
  ['note', '補足'],
  ['warning', '警告'],
]);

export function renderCallout(source, escape) {
  const { kind, title, text } = parseInput(source, ['kind', 'title', 'text']);
  check(calloutKinds.has(kind), 'kind は key、note、warning のいずれかです');
  check(label(title, 100) && label(text, 600), 'title は100文字、text は600文字までの1行テキストです');
  return `<aside class="callout callout--${kind}">
<div class="callout-heading"><span class="callout-kind">${calloutKinds.get(kind)}</span><strong>${escape(title)}</strong></div>
<p>${escape(text)}</p>
</aside>\n`;
}

export function renderDiff(source, escape) {
  let inHunk = false;
  const lines = source.replace(/\n$/, '').split('\n');
  const rows = lines.map((line, index) => {
    const hunk = line.startsWith('@@ ');
    const header = line.startsWith('diff --git ');
    if (header) inHunk = false;
    if (hunk) inHunk = true;

    const fileHeader = !inHunk && ((line.startsWith('--- ') && lines[index + 1]?.startsWith('+++ '))
      || (line.startsWith('+++ ') && lines[index - 1]?.startsWith('--- ')));
    let kind = 'context';
    if (header || hunk || fileHeader || line.startsWith('\\ No newline')) kind = 'header';
    else if (line.startsWith('+')) kind = 'added';
    else if (line.startsWith('-')) kind = 'removed';
    else if (line.startsWith('~ ')) kind = 'changed';

    return `<span class="diff-row diff-${kind}">${escape(line)}</span>`;
  });
  return `<pre class="change-diff" tabindex="0" aria-label="差分"><code class="language-diff">${rows.join('\n')}${source.endsWith('\n') ? '\n' : ''}</code></pre>\n`;
}
