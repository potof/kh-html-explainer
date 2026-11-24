const paragraph = ['paragraph_open', 'inline', 'paragraph_close'];

function matches(tokens, index, types) {
  return types.every((type, offset) => tokens[index + offset]?.type === type);
}

function endOf(tokens, index) {
  const { level, type } = tokens[index];
  const close = type.replace(/_open$/, '_close');
  for (let position = index + 1; position < tokens.length; position++) {
    if (tokens[position].type === close && tokens[position].level === level) return position;
  }
}

function timelineTable(tokens, inlineText) {
  const rows = [];
  for (const token of tokens) {
    if (token.type === 'tr_open') rows.push([]);
    if (token.type === 'inline') rows.at(-1).push(inlineText(token).trim());
  }
  const headings = rows.shift()?.join('|');
  if (!['日付|出来事', '日付|出来事|補足'].includes(headings) || !rows.length) return;
  if (rows.some(([when, title]) => !when || !title)) return;
  return rows.map(([when, title, note]) => ({ when, title, note: note || undefined }));
}

function confirmation(tokens, inlineText) {
  if (!matches(tokens, 1, paragraph) || tokens[2].content !== '**確認事項**') return;
  let index = 4;
  const paragraphs = [];
  while (matches(tokens, index, paragraph)) {
    paragraphs.push(inlineText(tokens[index + 1]).trim());
    index += 3;
  }
  const [question, next, last] = paragraphs;
  if (!question) return;
  const list = tokens[index].type;
  if (list === 'blockquote_close' && paragraphs.length <= 3 && /^回答[：:]?$/.test(paragraphs.at(-1))
    && paragraphs.length > 1) {
    return { type: 'text', question, hint: last ? next : undefined };
  }
  if (paragraphs.length > 2 || !['ordered_list_open', 'bullet_list_open'].includes(list)) return;
  const multiple = list === 'bullet_list_open';
  const options = [];
  const item = ['list_item_open', ...paragraph, 'list_item_close'];
  index++;
  while (matches(tokens, index, item)) {
    let option = inlineText(tokens[index + 2]).trim();
    if (multiple) {
      if (!/^\[ \]\s+/.test(option)) return;
      option = option.replace(/^\[ \]\s+/, '');
    }
    options.push(option);
    index += item.length;
  }
  if (options.length >= 2 && tokens[index].type === list.replace('_open', '_close')
    && tokens[index + 1].type === 'blockquote_close') {
    return { type: multiple ? 'multiple' : 'single', question, hint: next, options };
  }
}

export function applyMarkdownComponents(state, inlineText) {
  const { tokens, Token } = state;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.level !== 0) continue;
    let end, kind, meta;
    if (token.type === 'blockquote_open') {
      end = endOf(tokens, index);
      meta = confirmation(tokens.slice(index, end + 1), inlineText);
      if (meta) kind = 'confirmation_component';
    } else if (matches(tokens, index, paragraph)) {
      const marker = tokens[index + 1].content;
      if (marker === '**タイムライン**' && tokens[index + 3]?.type === 'table_open') {
        end = endOf(tokens, index + 3);
        const events = timelineTable(tokens.slice(index + 3, end + 1), inlineText);
        if (events) {
          kind = 'timeline_component';
          meta = { title: 'タイムライン', events };
        }
      } else if (marker === '**ディレクトリツリー**' && tokens[index + 3]?.type === 'bullet_list_open') {
        end = endOf(tokens, index + 3);
        const list = tokens.slice(index + 3, end + 1);
        kind = 'tree_component';
        meta = { list };
        for (const { type, children } of list) {
          if (type !== 'inline' || children.length !== 2 || children[0].type !== 'code_inline'
            || children[1].type !== 'text' || !children[1].content.startsWith(' — ')) continue;
          const note = new Token('tree_note_open', 'span', 1);
          note.attrSet('class', 'tree-note');
          children[1].content = children[1].content.slice(3);
          children.splice(1, 0, note);
          children.push(new Token('tree_note_close', 'span', -1));
        }
      }
    }
    if (!kind) continue;
    const component = new Token(kind, '', 0);
    component.map = token.map.slice();
    component.meta = meta;
    tokens.splice(index, end - index + 1, component);
  }
}
