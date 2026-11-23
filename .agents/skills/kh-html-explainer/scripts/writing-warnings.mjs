const sentences = new Intl.Segmenter('ja', { granularity: 'sentence' });
const words = new Intl.Segmenter('en', { granularity: 'word' });
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const textOrNumber = /[\p{L}\p{N}]/u;
const address = /(?:https?:\/\/|mailto:)[^\s<>]+/gi;

function prose(inline) {
  return inline.children.map((token) => {
    if (token.type === 'text') return token.content;
    return ['code_inline', 'image', 'softbreak', 'hardbreak'].includes(token.type) ? ' ' : '';
  }).join('').replace(address, ' ').trim();
}

function sentenceLength(sentence, isStep) {
  if (cjk.test(sentence)) {
    return { length: [...sentence.replace(/\s/gu, '')].length, limit: isStep ? 35 : 45, unit: '文字' };
  }
  let length = 0;
  for (const { isWordLike } of words.segment(sentence)) {
    if (isWordLike) length++;
  }
  return { length, limit: isStep ? 20 : 25, unit: '語' };
}

export function writingWarnings(tokens) {
  const warnings = [];
  const lists = [];
  let inReferences = false;
  for (const [index, token] of tokens.entries()) {
    if (token.type === 'ordered_list_open' || token.type === 'bullet_list_open') {
      lists.push(token.type === 'ordered_list_open');
    } else if (token.type === 'ordered_list_close' || token.type === 'bullet_list_close') {
      lists.pop();
    }
    if (token.type === 'heading_open' && token.level === 0 && token.tag === 'h2') {
      inReferences = prose(tokens[index + 1]) === '参考リンク';
    }
    if (inReferences || token.type !== 'paragraph_open') continue;

    const position = `Markdown ${token.map[0] + 1}行目`;
    const text = prose(tokens[index + 1]);
    let count = 0;
    let longest;
    for (const { segment } of sentences.segment(text)) {
      if (!textOrNumber.test(segment)) continue;
      count++;
      const measure = sentenceLength(segment, lists.at(-1));
      if (measure.length > measure.limit && (!longest || measure.length / measure.limit > longest.length / longest.limit)) {
        longest = measure;
      }
    }
    if (longest) {
      const { length, limit, unit } = longest;
      warnings.push(`${position} [文の長さ] ${length}${unit}（目安${limit}${unit}）。文を分けるか、重複を削ってください。`);
    }
    if (count > 6) {
      warnings.push(`${position} [段落の長さ] ${count}文（目安6文）。話題ごとに段落を分けてください。`);
    }
  }
  return warnings;
}
