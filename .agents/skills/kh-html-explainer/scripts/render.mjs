import { constants } from 'node:fs';
import { link, lstat, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import MarkdownIt from 'markdown-it';
import { initializePage } from './browser.mjs';
import { renderConfirmation, renderConfirmationSpec } from './confirmation.mjs';
import { renderDiagram } from './diagram.mjs';
import { renderAws, renderAwsGraph } from './aws.mjs';
import { loadAwsIcons, renderAwsIconSprite } from './aws-icons.mjs';
import { renderEr, renderState } from './models.mjs';
import { chartValues, renderChart, renderTimeline, renderTimelineEvents } from './data-components.mjs';
import { renderGantt } from './gantt.mjs';
import { isMermaidGantt } from './gantt-input.mjs';
import { mermaidKind, renderMermaid, validateMermaidSource } from './mermaid.mjs';
import { renderTeamFlowchart } from './team-flowchart.mjs';
import { renderSequence } from './sequence.mjs';
import { renderTree } from './tree.mjs';
import { renderCallout, renderDiff } from './review-blocks.mjs';
import { applyMarkdownComponents } from './markdown-components.mjs';
import { writingWarnings } from './writing-warnings.mjs';
import css from './theme.css';

const maxBytes = 1024 * 1024;
const markdown = new MarkdownIt({ html: false, linkify: false, maxNesting: 100 });
const { escapeHtml: escape } = markdown.utils;

function inlineText(token) {
  return token.children.map((child) => child.type.endsWith('break') ? ' ' : child.content).join('');
}

markdown.core.ruler.push('explainer_components', state => {
  state.env.warnings = writingWarnings(state.tokens);
  applyMarkdownComponents(state, inlineText);
});

markdown.renderer.rules.image = (tokens, index) => {
  const alt = inlineText(tokens[index]);
  return alt ? `<span class="image-alt">${escape(alt)}</span>` : '';
};

markdown.renderer.rules.link_open = (tokens, index) => {
  const href = tokens[index].attrGet('href');
  if (/^#(?:top|references|section-[1-9][0-9]*)$/.test(href)) return `<a href="${href}">`;
  return '<span class="reference">';
};

markdown.renderer.rules.link_close = (tokens, index) => {
  let start = index - 1;
  while (tokens[start].type !== 'link_open') start--;
  const href = tokens[start].attrGet('href');
  if (/^#(?:top|references|section-[1-9][0-9]*)$/.test(href)) return '</a>';
  if (/^https?:\/\//i.test(href) && tokens[index - 1].content !== href) {
    return `</span> <small class="reference-url">(${escape(href)})</small>`;
  }
  return '</span>';
};

markdown.renderer.rules.table_open = () =>
  '<div class="scroll table-scroll" tabindex="0" role="region" aria-label="表">\n<table>\n';
markdown.renderer.rules.table_close = () => '</table>\n</div>\n';
for (const type of ['th_open', 'td_open']) {
  markdown.renderer.rules[type] = (tokens, index, options, env, renderer) => {
    const token = tokens[index];
    const alignment = token.attrGet('style')?.match(/^text-align:(left|right|center)$/)?.[1];
    token.attrs = alignment ? [['class', `align-${alignment}`]] : null;
    if (type === 'th_open') token.attrSet('scope', 'col');
    return renderer.renderToken(tokens, index, options);
  };
}

markdown.renderer.rules.blockquote_open = (tokens, index, options, env, renderer) => {
  const first = tokens[index + 2]?.content;
  const callout = /^\*\*(警告|要点|補足)(?=\*\*|[\s：:—])/.exec(first)?.[1];
  if (callout) {
    const kinds = { 警告: 'warning', 要点: 'key', 補足: 'note' };
    tokens[index].attrSet('class', 'callout callout--' + kinds[callout]);
  } else if (/^\*\*確認事項\*\*(?:[\s：:]|$)/.test(first)) {
    tokens[index].attrSet('class', 'confirmation');
  }
  return renderer.renderToken(tokens, index, options);
};

markdown.renderer.rules.tree_component = (tokens, index, options, env, renderer) =>
  `<div class="directory-tree" role="region" aria-label="ディレクトリツリー">\n${renderer.render(tokens[index].meta.list, options, env)}</div>\n`;
markdown.renderer.rules.timeline_component = (tokens, index) => renderTimelineEvents(tokens[index].meta, escape);

function confirmationAt(token, env, renderForm) {
  try {
    if (env.confirmationCount === 32) throw new Error('確認事項は文書あたり32件までです');
    return renderForm(++env.confirmationCount);
  } catch (error) {
    throw new Error(`Markdown ${token.map[0] + 1}行目の確認事項: ${error.message}`, { cause: error });
  }
}
markdown.renderer.rules.confirmation_component = (tokens, index, options, env) =>
  confirmationAt(tokens[index], env, id => renderConfirmationSpec(tokens[index].meta, id, escape));

markdown.renderer.rules.paragraph_open = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  if (!token.hidden) token.attrSet('data-source-line', String(token.map[0] + 1));
  return renderer.renderToken(tokens, index, options);
};

const graphicRenderers = new Map([
  ['diagram', renderDiagram], ['aws', renderAws], ['sequence', renderSequence], ['state', renderState],
  ['er', renderEr], ['chart', renderChart], ['gantt', renderGantt],
]);
const blockRenderers = new Map([
  ['tree', renderTree], ['timeline', renderTimeline], ['callout', renderCallout], ['diff', renderDiff],
]);
const defaultFence = markdown.renderer.rules.fence;
function fenceType(token) {
  const info = token.info.trim();
  if (info === 'mermaid') {
    if (isMermaidGantt(token.content)) return 'gantt';
  }
  return info;
}

markdown.renderer.rules.fence = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  const type = fenceType(token);
  if (type === 'confirm') {
    return confirmationAt(token, env, id => renderConfirmation(token.content, id, escape));
  }
  const renderBlock = blockRenderers.get(type);
  if (renderBlock) {
    try {
      return renderBlock(token.content, escape);
    } catch (error) {
      throw new Error(`Markdown ${token.map[0] + 1}行目の ${type}: ${error.message}`, { cause: error });
    }
  }
  const renderGraphic = graphicRenderers.get(type);
  const kind = type === 'mermaid' ? mermaidKind(token.content) : undefined;
  if (!renderGraphic && !kind) return defaultFence(tokens, index, options, env, renderer);
  try {
    if (env.diagramCount === 16) throw new Error('図は文書あたり16件までです');
    const diagramIndex = ++env.diagramCount;
    if (kind) {
      validateMermaidSource(token.content);
      env.mermaid.push({ source: token.content, kind, index: diagramIndex, line: token.map[0] + 1 });
      return `<!--mermaid-${diagramIndex}-->\n`;
    }
    return renderGraphic(token.content, diagramIndex, escape, env.awsIcons);
  } catch (error) {
    throw new Error(`Markdown ${token.map[0] + 1}行目の図: ${error.message}`, { cause: error });
  }
};

const hash = (content) => createHash('sha256').update(content, 'utf8').digest('base64');
const script = `(${initializePage.toString()})();`;
const csp = `default-src 'none'; style-src 'sha256-${hash(css)}'; script-src 'sha256-${hash(script)}'; base-uri 'none'; form-action 'none'`;

function commentButton(id, label) {
  return `<button type="button" class="card-comment-toggle" aria-controls="comment-${id}" aria-expanded="false" aria-label="${label}にコメントを追加" title="コメントを追加" data-enhanced hidden>
<svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5 4h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8l-4 2v-2a2 2 0 0 1-1-2V6a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
</button>`;
}

function commentField(id) {
  return `<div id="comment-${id}" class="card-comment" hidden>
<label>AI Agentへの指示<textarea class="comment-input" rows="3"></textarea></label>
</div>\n`;
}

async function render(source, offline) {
  if (!source.trim() || source.includes('\0')) throw new Error('空の文書と NUL 文字は使用できません');
  const env = { diagramCount: 0, confirmationCount: 0, awsIcons: new Set(), mermaid: [] };
  const tokens = markdown.parse(source, env);
  const { warnings } = env;
  const heading = tokens[0]?.tag === 'h1' && tokens[1]?.type === 'inline' ? tokens.splice(0, 3)[1] : null;
  const title = (heading && inlineText(heading).trim()) || '技術資料';
  const sections = [];
  for (const [index, token] of tokens.entries()) {
    if (token.type !== 'heading_open' || token.level !== 0 || token.tag !== 'h2') continue;
    const id = `section-${sections.length + 1}`;
    token.attrSet('id', id);
    sections.push({ id, index });
  }

  const renderBlocks = (blocks) => markdown.renderer.render(blocks, markdown.options, env);
  const intro = tokens.slice(0, sections[0]?.index ?? tokens.length);
  const introduction = intro.length ? `<div class="card card--intro">
<div class="card-body">${commentButton('intro', '導入')}${renderBlocks(intro)}${commentField('intro')}</div>
</div>\n` : '';
  const cards = sections.map(({ id, index }, position) => {
    const end = sections[position + 1]?.index ?? tokens.length;
    const panelId = position < 26 ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[position] : `P${position + 1}`;
    const body = tokens.slice(index + 3, end);
    const hasTable = body.some((token) => token.type === 'table_open');
    const hasAwsDiagram = body.some(token => token.type === 'fence'
      && (token.info.trim() === 'aws' || (token.info.trim() === 'sequence' && /^\s*participants:[^\n]*@aws:/m.test(token.content))));
    const hasWideDiagram = body.some((token) => {
      if (token.type !== 'fence') return false;
      const type = fenceType(token);
      return ['sequence', 'er', 'chart', 'gantt'].includes(type)
        || (type === 'mermaid' && mermaidKind(token.content) !== undefined)
        || (['diagram', 'state'].includes(type) && /"direction"\s*:\s*"LR"/.test(token.content));
    });
    const isReferences = position === sections.length - 1 && inlineText(tokens[index + 1]).trim() === '参考リンク';
    const widthClass = isReferences ? ' card--references'
      : hasAwsDiagram ? ' card--aws' : hasWideDiagram ? ' card--wide' : hasTable ? ' card--table' : '';
    const anchor = isReferences ? ' id="references"' : '';
    return `<section class="card${widthClass}" data-panel-id="${panelId}" aria-labelledby="${id}"${anchor}>
<header class="card-header"><span class="card-id">${panelId}</span>
${renderBlocks(tokens.slice(index, index + 3))}${commentButton(id, `カード${panelId}`)}</header>
<div class="card-body">${renderBlocks(body)}${commentField(id)}</div>
</section>\n`;
  });

  let icons;
  const diagrams = await renderMermaid(env.mermaid, async ids => {
    icons = await loadAwsIcons(new Set([...env.awsIcons, ...ids]), offline);
    return icons;
  });
  const sprite = renderAwsIconSprite(icons ?? await loadAwsIcons(env.awsIcons, offline));
  const figures = new Map(diagrams.map(({ index, aws, team, title, kind, svg, plots, unit }) => {
    if (team) return [index, renderTeamFlowchart(team, index, escape)];
    if (aws) return [index, renderAwsGraph(aws, index, escape)];
    return [index, `<figure class="diagram mermaid-${kind}">
<figcaption id="diagram-${index}">${escape(title)}</figcaption>
<div class="scroll diagram-scroll" tabindex="0" role="region" aria-labelledby="diagram-${index}">${svg}</div>
${plots?.length ? chartValues(plots, unit, escape) : ''}</figure>`];
  }));
  const article = (introduction + cards.join('')).replace(/<!--mermaid-(\d+)-->/g, (_, id) => figures.get(Number(id)));
  const html = `<!doctype html>
<html lang="ja" data-html-explainer-mode="light">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="only light">
<meta name="theme-color" content="#fafafa">
<meta name="format-detection" content="telephone=no">
<title>${escape(title)}</title>
<style>${css}</style>
</head>
<body>
${sprite}<main id="top" class="sheet">
<header class="document-header">
<h1>${escape(title)}</h1>
<div class="document-tools" data-enhanced hidden>
<div class="tool-group theme-switch" role="group" aria-label="表示テーマ">
<button type="button" data-theme-choice="light" aria-pressed="true">ライト</button>
<button type="button" data-theme-choice="dark" aria-pressed="false">ダーク</button>
</div>
<div class="tool-group" role="group" aria-label="文字サイズ">
<button type="button" data-font-step="-1" aria-label="文字を小さく">A−</button>
<button type="button" data-font-step="1" aria-label="文字を大きく">A＋</button>
<span class="visually-hidden" id="font-size-status" role="status"></span>
</div>
<button type="button" id="toggle-paragraph-review" aria-pressed="false" hidden>段落に注記</button>
<button type="button" id="collect-comments" aria-controls="agent-instructions" aria-expanded="false" disabled>指示文を生成</button>
</div>
</header>
<div class="card instructions" id="agent-instructions" hidden>
<label>AI Agent向け指示文<textarea id="instructions-text" rows="6" readonly></textarea></label>
<button type="button" id="copy-instructions">指示文をコピー</button>
<span id="comment-status" role="status"></span>
</div>
<article>
${article}</article>
</main>
<script>${script}</script>
</body>
</html>
`;
  return { html, warnings };
}

async function readSource(input) {
  const handle = await open(input, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('入力は通常のファイルを指定してください');
    if (stat.size > maxBytes) throw new Error('入力は1 MiBまでです');
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > maxBytes) throw new Error('入力は1 MiBまでです');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
  } finally {
    await handle.close();
  }
}

async function main(args) {
  const usage = '使い方: node render.mjs [--offline] INPUT.md OUTPUT.html';
  if (args.length === 1 && args[0] === '--help') return console.log(usage);
  const offline = args[0] === '--offline';
  const paths = offline ? args.slice(1) : args;
  const [input, output] = paths;
  if (paths.length !== 2 || extname(input).toLowerCase() !== '.md'
    || extname(output).toLowerCase() !== '.html') throw new Error(usage);

  const destination = resolve(output);
  const alreadyExists = await lstat(destination).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (alreadyExists) throw new Error('出力先が既に存在します。別のファイル名を指定してください');
  const temporary = await mkdtemp(join(dirname(destination), '.explainer-'));
  let warnings;
  try {
    const result = await render(await readSource(input), offline);
    warnings = result.warnings;
    const staged = join(temporary, 'document.html');
    await writeFile(staged, result.html, { flag: 'wx', mode: 0o600 });
    await link(staged, destination);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('出力先が既に存在します。別のファイル名を指定してください');
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  for (const warning of warnings.slice(0, 20)) console.error(`警告 ${warning}`);
  if (warnings.length > 20) console.error(`警告 ほか${warnings.length - 20}件`);
  console.log(destination);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
