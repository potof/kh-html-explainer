export function renderTree(source, escape) {
  if (Buffer.byteLength(source) > 16_384) throw new Error('入力は16 KiBまでです');
  const lines = source.split('\n').filter((line) => line.trim());
  if (lines.length < 1 || lines.length > 128) throw new Error('項目は1〜128件です');

  const roots = [];
  const levels = [roots];
  for (const [index, line] of lines.entries()) {
    const indent = line.match(/^ */)[0].length;
    const depth = indent / 2;
    if (indent % 2 || depth > 12 || depth >= levels.length || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(line)) {
      throw new Error(`項目${index + 1}の階層が不正です。半角空白2個で一階層を表してください`);
    }
    const [name, ...rest] = line.trim().split(' | ');
    const note = rest.join(' | ').trim();
    if (!name.trim() || [...name].length > 100 || [...note].length > 120) {
      throw new Error(`項目${index + 1}は名前100文字、説明120文字までです`);
    }
    const node = { name: name.trim(), note, children: [] };
    levels[depth].push(node);
    levels.length = depth + 1;
    levels.push(node.children);
  }

  function list(nodes) {
    return `<ul>${nodes.map(({ name, note, children }) =>
      `<li><code>${escape(name)}</code>${note ? ` <span class="tree-note">${escape(note)}</span>` : ''}`
      + (children.length ? list(children) : '') + '</li>').join('')}</ul>`;
  }
  return `<div class="directory-tree" role="region" aria-label="ディレクトリツリー">${list(roots)}</div>\n`;
}
