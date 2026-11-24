function text(value, max) {
  return typeof value === 'string' && value.trim() && [...value].length <= max
    && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value);
}

export function renderConfirmation(source, index, escape) {
  if (Buffer.byteLength(source) > 8192) throw new Error('確認事項の入力は8 KiBまでです');
  const spec = JSON.parse(source);
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)
    || Object.keys(spec).some((key) => !['question', 'type', 'options', 'hint'].includes(key))) {
    throw new Error('確認事項のフィールドが不正です');
  }
  return renderConfirmationSpec(spec, index, escape);
}

export function renderConfirmationSpec({ question, type, options, hint }, index, escape) {
  if (!text(question, 160) || (hint !== undefined && !text(hint, 240))) {
    throw new Error('question は160文字、hint は240文字までの1行テキストにしてください');
  }
  if (!['single', 'multiple', 'text'].includes(type)) {
    throw new Error('type は single、multiple、text のいずれかを指定してください');
  }
  if (type === 'text') {
    if (options !== undefined) throw new Error('text の場合は options を指定しないでください');
  } else if (!Array.isArray(options) || options.length < 2 || options.length > 8
    || !options.every((option) => text(option, 100)) || new Set(options.map((option) => option.trim())).size !== options.length) {
    throw new Error('options は100文字までの一意な選択肢を2〜8件指定してください');
  }

  const id = `confirmation-${index}`;
  const description = hint ? ` aria-describedby="${id}-hint"` : '';
  const inputs = type === 'text'
    ? `<label>回答<textarea data-confirmation-answer rows="2" maxlength="2000"${description}></textarea></label>`
    : options.map((option) =>
      `<label class="confirmation-choice"><input data-confirmation-answer type="${type === 'single' ? 'radio' : 'checkbox'}" name="${id}" value="${escape(option.trim())}"><span class="confirmation-indicator" aria-hidden="true"></span><span>${escape(option.trim())}</span></label>`
    ).join('\n');
  return `<fieldset class="confirmation confirmation-form"${description}>
<legend><span class="confirmation-tag">確認事項</span><span class="confirmation-question">${escape(question.trim())}</span></legend>
${hint ? `<p class="confirmation-hint" id="${id}-hint">${escape(hint.trim())}</p>` : ''}
${inputs}
</fieldset>\n`;
}
