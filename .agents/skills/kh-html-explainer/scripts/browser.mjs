export function initializePage() {
  const themes = document.querySelectorAll('[data-theme-choice]');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  for (const button of themes) {
    button.addEventListener('click', () => {
      const mode = button.dataset.themeChoice;
      document.documentElement.dataset.htmlExplainerMode = mode;
      themeColor?.setAttribute('content', mode === 'dark' ? '#09090b' : '#fafafa');
      for (const choice of themes) choice.setAttribute('aria-pressed', String(choice === button));
    });
  }

  const sizes = [90, 100, 110, 120, 130];
  let selectedSize = sizes.indexOf(100);
  const fontButtons = document.querySelectorAll('[data-font-step]');
  const sizeStatus = document.querySelector('#font-size-status');
  const diagrams = document.querySelectorAll('.diagram .diagram-scroll > svg');
  const article = document.querySelector('article');
  const resizableCards = [...article.querySelectorAll(':scope > section.card:not(.card--references)')];

  function sizeCards() {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const range = document.createRange();
    const widths = resizableCards.map((card) => {
      const body = card.querySelector('.card-body');
      let contentWidth = 0;

      for (const table of body.querySelectorAll('table')) {
        const columns = table.rows[0]?.cells.length ?? 0;
        const columnWidth = 10 * parseFloat(getComputedStyle(table).fontSize);
        contentWidth = Math.max(contentWidth, columns * columnWidth);
      }
      for (const diagram of body.querySelectorAll('svg[viewBox]')) {
        contentWidth = Math.max(contentWidth, Number(diagram.getAttribute('width')) * 0.9);
      }
      for (const code of body.querySelectorAll('pre > code')) {
        range.selectNodeContents(code);
        const width = range.getBoundingClientRect().width + 28;
        contentWidth = Math.max(contentWidth, Math.min(width, 30 * rem));
      }

      const padding = getComputedStyle(body);
      return Math.ceil(contentWidth + parseFloat(padding.paddingLeft) + parseFloat(padding.paddingRight) + 2);
    });
    resizableCards.forEach((card, index) => {
      card.style.setProperty('--preferred-card-width', `${widths[index]}px`);
    });
    article.classList.add('cards-fit');
  }

  function updateFontButtons() {
    for (const control of fontButtons) {
      const next = selectedSize + Number(control.dataset.fontStep);
      control.setAttribute('aria-disabled', String(sizes[next] === undefined));
    }
  }
  for (const button of fontButtons) {
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') === 'true') return;
      selectedSize += Number(button.dataset.fontStep);
      const size = sizes[selectedSize];
      document.documentElement.dataset.htmlExplainerSize = String(size);
      for (const diagram of diagrams) {
        diagram.setAttribute('width', String(diagram.viewBox.baseVal.width * size / 100));
      }
      sizeCards();
      sizeStatus.textContent = `文字サイズ ${size}%`;
      updateFontButtons();
    });
  }
  updateFontButtons();
  sizeCards();

  const cards = [...document.querySelectorAll('article .card')];
  const collect = document.querySelector('#collect-comments');
  const preview = document.querySelector('#agent-instructions');
  const output = document.querySelector('#instructions-text');
  const status = document.querySelector('#comment-status');

  function setPreviewOpen(open) {
    preview.hidden = !open;
    collect.setAttribute('aria-expanded', String(open));
    collect.textContent = open ? '指示文を閉じる' : '指示文を生成';
  }

  function quote(value) {
    return value.split(/\r?\n/).map((line) => `> ${line}`).join('\n');
  }

  function refreshInstructions() {
    const entries = cards.flatMap((card) => {
      const answers = [...card.querySelectorAll('.confirmation-form')].flatMap((confirmation) => {
        const values = [...confirmation.querySelectorAll('[data-confirmation-answer]')]
          .filter((input) => input.tagName === 'TEXTAREA' || input.checked)
          .map((input) => input.value.trim())
          .filter(Boolean);
        if (!values.length) return [];
        const question = confirmation.querySelector('.confirmation-question').textContent;
        return [`確認事項：${question}\n${quote(values.join('\n'))}`];
      });
      const note = card.querySelector('.comment-input').value.trim();
      if (note) answers.push(note);
      for (const input of card.querySelectorAll('.paragraph-note-input')) {
        if (!input.value.trim()) continue;
        const paragraph = input.closest('.paragraph-review').previousElementSibling;
        const text = paragraph.textContent.trim().replace(/\s+/g, ' ');
        answers.push(`段落への注記（原稿 ${paragraph.dataset.sourceLine}行目）\n${quote(text)}\n\n修正メモ\n${quote(input.value.trim())}`);
      }
      if (!answers.length) return [];
      const heading = card.querySelector('.card-header h2');
      const section = heading ? `${card.dataset.panelId} — ${heading.textContent.trim()} (${heading.id})` : '導入・本文';
      return [`## ${section}\n\n${answers.join('\n\n')}`];
    });
    collect.disabled = entries.length === 0;
    output.value = entries.length
      ? [`# ${document.title}\n\n以下の回答、コメント、注記を資料に反映してください。`, ...entries].join('\n\n')
      : '';
    if (!entries.length) setPreviewOpen(false);
    status.textContent = '';
  }

  const reviewToggle = document.querySelector('#toggle-paragraph-review');
  const paragraphs = article.querySelectorAll('p[data-source-line]');
  let addedParagraphControls = false;
  reviewToggle.hidden = paragraphs.length === 0;
  reviewToggle.addEventListener('click', () => {
    const enabled = article.classList.toggle('is-reviewing');
    reviewToggle.setAttribute('aria-pressed', String(enabled));
    if (addedParagraphControls) return;

    for (const paragraph of paragraphs) {
      const control = document.createElement('div');
      control.className = 'paragraph-review';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'paragraph-note-toggle';
      button.textContent = 'この段落に注記';
      button.setAttribute('aria-label', `原稿 ${paragraph.dataset.sourceLine}行目の段落に注記`);
      button.setAttribute('aria-expanded', 'false');
      control.append(button);
      paragraph.after(control);

      let field;
      let input;
      button.addEventListener('click', () => {
        if (!field) {
          field = document.createElement('label');
          field.textContent = '修正メモ';
          field.hidden = true;
          input = document.createElement('textarea');
          input.className = 'paragraph-note-input';
          input.rows = 2;
          field.append(input);
          control.append(field);
          input.addEventListener('input', () => {
            button.classList.toggle('has-comment', Boolean(input.value.trim()));
            refreshInstructions();
          });
        }
        field.hidden = !field.hidden;
        button.setAttribute('aria-expanded', String(!field.hidden));
        if (!field.hidden) input.focus();
      });
    }
    addedParagraphControls = true;
  });

  for (const card of cards) {
    const toggle = card.querySelector('.card-comment-toggle');
    const field = card.querySelector('.card-comment');
    const input = field.querySelector('.comment-input');
    toggle.addEventListener('click', () => {
      const open = field.hidden;
      field.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) input.focus();
    });
    const markDraft = () => toggle.classList.toggle('has-comment', Boolean(input.value.trim()));
    input.addEventListener('input', markDraft);
    markDraft();
  }

  for (const input of document.querySelectorAll('.comment-input, [data-confirmation-answer]')) {
    input.addEventListener('input', refreshInstructions);
  }
  collect.addEventListener('click', () => {
    if (!preview.hidden) {
      setPreviewOpen(false);
      return;
    }
    refreshInstructions();
    if (collect.disabled) return;
    setPreviewOpen(true);
    output.focus({ preventScroll: true });
  });
  document.querySelector('#copy-instructions').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(output.value);
      status.textContent = '指示文をコピーしました。';
    } catch {
      output.focus();
      output.select();
      status.textContent = '選択した指示文をコピーしてください。';
    }
  });

  refreshInstructions();
  document.querySelectorAll('[data-enhanced]').forEach((element) => { element.hidden = false; });
}
