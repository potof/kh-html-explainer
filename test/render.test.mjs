import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

const cli = fileURLToPath(new URL('../.agents/skills/kh-html-explainer/dist/render.mjs', import.meta.url));
const sample = readFileSync(new URL('../examples/http-cache-validation.md', import.meta.url));
const chromiumTests = { skip: process.env.KH_HTML_EXPLAINER_TEST_MERMAID !== '1' && 'enable with KH_HTML_EXPLAINER_TEST_MERMAID=1' };

function fixture(t, content) {
  const dir = mkdtempSync(join(tmpdir(), 'html-explainer-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'source.md');
  writeFileSync(input, content);
  const run = (name = 'page.html', flags = []) =>
    spawnSync(process.execPath, [cli, ...flags, input, join(dir, name)], { encoding: 'utf8' });
  return { dir, run };
}

test('renders both directions, the table, and a deterministic standalone document', chromiumTests, (t) => {
  const { dir, run } = fixture(t, sample);
  assert.equal(run().status, 0);
  assert.equal(run('again.html').status, 0);
  const html = readFileSync(join(dir, 'page.html'), 'utf8');
  assert.equal(html, readFileSync(join(dir, 'again.html'), 'utf8'));
  assert.match(html, /<html lang="ja" data-html-explainer-mode="light">/);
  assert.match(html, /<meta name="color-scheme" content="only light">/);
  assert.match(html, /color-scheme:\s*only light/);
  assert.doesNotMatch(html, /prefers-color-scheme/);
  assert.doesNotMatch(html, /<nav\b/);
  assert.match(html, /data-theme-choice="light" aria-pressed="true"/);
  assert.match(html, /id="collect-comments" aria-controls="agent-instructions" aria-expanded="false" disabled/);
  assert.equal((html.match(/<fieldset class="confirmation confirmation-form"/g) ?? []).length, 3);
  assert.match(html, /type="radio" name="confirmation-1"/);
  assert.match(html, /type="checkbox" name="confirmation-2"/);
  assert.match(html, /<textarea data-confirmation-answer/);
  assert.match(html, /href="#references"/);
  assert.match(html, /class="card card--references" data-panel-id="F" aria-labelledby="section-6" id="references"/);
  assert.equal((html.split('id="references"')[0].match(/class="reference-url"/g) ?? []).length, 0);
  assert.equal((html.match(/class="comment-input"/g) ?? []).length, 7);
  assert.match(html, /<div class="card card--intro">\s*<div class="card-body"><button[^>]*aria-controls="comment-intro"/);
  assert.equal((html.match(/class="card-comment-toggle"/g) ?? []).length, 7);
  assert.match(html, /aria-controls="comment-section-1" aria-expanded="false" aria-label="カードAにコメントを追加"/);
  assert.match(html, /id="comment-section-1" class="card-comment" hidden/);
  assert.deepEqual([...html.matchAll(/data-panel-id="([A-Z]+)"/g)].map((match) => match[1]), ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.match(html, /aria-labelledby="section-1">\s*<header class="card-header"><span class="card-id">A<\/span>\s*<h2 id="section-1">/);
  assert.match(html, /class="card card--table" data-panel-id="B"/);
  assert.match(html, /class="card card--wide" data-panel-id="C"/);
  assert.match(html, /<th scope="col">要件/);
  assert.match(html, /<pre><code class="language-http">/);
  assert.match(html, /<pre><code class="language-sh">/);
  assert.equal((html.match(/<svg[^>]* role="img"/g) ?? []).length, 2);
  assert.match(html, /marker-end="url\(#mermaid-2-\d+\)"/);
  const style = html.match(/<style>([\s\S]+?)<\/style>/)[1];
  const hash = createHash('sha256').update(style).digest('base64');
  assert.ok(html.includes(`style-src 'sha256-${hash}'`));
  const script = html.match(/<script>([\s\S]+?)<\/script>/)[1];
  const scriptHash = createHash('sha256').update(script).digest('base64');
  assert.ok(html.includes(`script-src 'sha256-${scriptHash}'`));
  assert.equal(run().status, 1);
  assert.equal(readFileSync(join(dir, 'page.html'), 'utf8'), html);
});

test('renders a sequence and a nested directory tree with inert labels', (t) => {
  const { dir, run } = fixture(t, [
    '## 処理順', '', '```sequence', 'title: <iframe>', 'participants: 利用者, API',
    '利用者 -> API: <script>入力</script>', 'API -> API: 検証', 'API --> 利用者: 完了', '```',
    '', '## ディレクトリ', '', '```tree', 'root/', '  src/', '    index.mjs | <img src=x>',
    '  README.md', '```',
  ].join('\n'));

  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(join(dir, 'page.html'), 'utf8');
  assert.match(html, /class="card card--wide" data-panel-id="A"/);
  assert.match(html, /<figure class="diagram sequence">/);
  assert.match(html, /class="route sequence-reply"[^>]*marker-end="url\(#arrow-1\)"/);
  assert.equal((html.match(/<path class="sequence-lifeline"/g) ?? []).length, 2);
  assert.match(html, /<code>src\/<\/code><ul><li><code>index\.mjs<\/code>/);
  assert.match(html, /class="tree-note">&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<(?:img|iframe)\b|<script>入力/);
});

test('renders AWS boundaries without an icon cache and honors offline cache misses', (t) => {
  const source = [
    '## AWS', '', '```aws', 'title: 構成', 'node client 利用者',
    'scope vpc app アプリ VPC', '  node server <img src=x>', 'client -> server HTTPS', '```', '',
  ].join('\n');
  const { dir } = fixture(t, source);
  const input = join(dir, 'source.md');
  const output = join(dir, 'page.html');
  const cache = join(dir, 'cache');
  const run = (...options) => spawnSync(process.execPath, [cli, ...options, input, output], {
    encoding: 'utf8', env: { ...process.env, HTML_EXPLAINER_CACHE_DIR: cache },
  });
  const noIcon = run();
  assert.equal(noIcon.status, 0, noIcon.stderr);
  const html = readFileSync(output, 'utf8');
  assert.match(html, /class="card card--aws"/);
  assert.match(html, /class="aws-boundary aws-vpc"/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.equal(existsSync(cache), false);

  rmSync(output);
  writeFileSync(input, source.replace('node server ', 'node server @aws:ecs '));
  const missing = run('--offline');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /AWS公式アイコンZIPがキャッシュにありません/);
  assert.equal(existsSync(cache) || existsSync(output), false);

  writeFileSync(input, source.replace('node server ', 'node server @aws:unknown '));
  const unknown = run();
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /未登録のAWSアイコンIDです: unknown/);
  assert.equal(existsSync(cache) || existsSync(output), false);
});

test('renders state, ER, charts, and timeline locally with escaped data', (t) => {
  const specs = [
    ['state', {
      title: '<iframe>状態', initial: 'draft', final: ['done'],
      states: [{ id: 'draft', label: '下書き' }, { id: 'done', label: '完了' }],
      transitions: [['draft', 'done', '承認']],
    }],
    ['er', {
      title: 'ER', entities: [
        { id: 'a', label: '親', fields: [['id', 'uuid', 'PK']] },
        { id: 'b', label: '子', fields: [['parent_id', 'uuid', 'FK']] },
      ],
      relations: [['a', 'b', '1', '0..*']],
    }],
    ['chart', { title: '棒', type: 'bar', unit: 'ms', values: [['<img src=x>', -12], ['次', 0]] }],
    ['chart', { title: '線', type: 'line', values: [['初回', 0], ['次回', 0]] }],
    ['timeline', { title: '経過', events: [{ when: '1日目', title: '準備', note: '<script>準備</script>' }] }],
  ];
  const source = specs.map(([kind, spec]) => [`## ${kind}`, '', '```' + kind, JSON.stringify(spec), '```'].join('\n')).join('\n\n');
  const { dir, run } = fixture(t, source);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(join(dir, 'page.html'), 'utf8');
  assert.match(html, /下書き（開始）/);
  assert.match(html, /完了（終了）/);
  assert.match(html, /class="entity-fields"/);
  assert.match(html, />0\.\.\*<\/tspan>/);
  assert.match(html, /class="chart-bar"/);
  assert.match(html, /class="chart-line"/);
  assert.match(html, /class="chart-values"/);
  assert.match(html, /class="timeline-when">1日目/);
  assert.doesNotMatch(html, /<(?:iframe|img)\b|<script>準備|x="NaN"|y="NaN"/);
});

test('warns about long prose and ordered steps while generating unchanged HTML', (t) => {
  const long = '設定'.repeat(25) + '。';
  const step = '操作'.repeat(19) + '。';
  const paragraph = '短い文です。'.repeat(7);
  const citation = 'https://example.invalid/' + '参照'.repeat(45);
  const source = [
    '# ' + long, '', long, '', '1. ' + step, '', paragraph, '', `参照 ${citation}`, '',
    '| 項目 |', '| --- |', `| ${long} |`, '',
    '```text', long, '```', '', '## 参考リンク', '', '1. ' + long, '',
  ].join('\n');
  const { dir, run } = fixture(t, source);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), join(dir, 'page.html'));
  assert.deepEqual(result.stderr.trim().split('\n').map((warning) => warning.split('。')[0]), [
    '警告 Markdown 3行目 [文の長さ] 51文字（目安45文字）',
    '警告 Markdown 5行目 [文の長さ] 39文字（目安35文字）',
    '警告 Markdown 7行目 [段落の長さ] 7文（目安6文）',
  ]);
  assert.ok(readFileSync(join(dir, 'page.html'), 'utf8').includes(`<p data-source-line="3">${long}</p>`));
});

test('renders inclusive Gantt dates, milestones, and adaptive calendar ticks', (t) => {
  const { dir, run } = fixture(t, [
    '## 短期', '', '```gantt', 'title: 検証計画',
    '2028-02-28 | 2028-03-01 | テスト <img src=x>',
    '2028-03-02 | 2028-03-02 | 反映作業',
    '2028-02-29 | 承認', '```', '', '## 長期', '', '```gantt',
    '2026-09-24 | 2027-03-18 | 移行', '```', '',
  ].join('\n'));
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(join(dir, 'page.html'), 'utf8');
  assert.match(html, /検証計画（2028-02-28〜2028-03-02）/);
  assert.match(html, /class="gantt-bar" x="172" y="[^"]+" width="412\.5"/);
  assert.match(html, /class="gantt-bar" x="584\.5" y="[^"]+" width="137\.5"/);
  assert.equal((html.match(/class="gantt-milestone"/g) ?? []).length, 1);
  assert.match(html, />2\/29<\/tspan>/);
  assert.match(html, />2027\/1<\/tspan>/);
  assert.match(html, /datetime="2028-02-29">2028-02-29<\/time>（マイルストーン）/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<img\b/);
});

test('rejects invalid calendar dates and reversed Gantt tasks', (t) => {
  for (const [row, message] of [
    ['2027-02-29 | 承認', /実在する YYYY-MM-DD/],
    ['2027-03-05 | 2027-03-04 | 切り替え', /終了日を開始日以降/],
  ]) {
    const { dir, run } = fixture(t, ['```gantt', row, '```', ''].join('\n'));
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
    assert.equal(existsSync(join(dir, 'page.html')), false);
  }
});

test('renders Mermaid Gantt sections, statuses and dependencies with day boundaries', (t) => {
  const { dir, run } = fixture(t, [
    '## 工程', '', '```mermaid', '%% 原稿のコメント', 'gantt', 'title 公開計画',
    'dateFormat YYYY-MM-DD', 'axisFormat %m/%d', 'section 準備 <img src=x>',
    '確認 :done, review, 2026-11-26, 2026-11-27',
    '実装 :active, build, after review, 1w',
    '切り戻し :backout, 2026-11-28, 1d',
    'テスト :crit, test, after build backout, 1d',
    '備え :monitor, 2026-12-01, until release',
    'section 公開', '公開 :milestone, release, after test, 0d',
    '監視 :1d', '```', '', '```mermaid', 'pie', '"監視" : 1', '```', '',
  ].join('\n'));
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(join(dir, 'page.html'), 'utf8');
  assert.match(html, /class="card card--wide"/);
  assert.match(html, /公開計画（2026-11-26〜2026-12-06）/);
  assert.match(html, /class="gantt-bar gantt-done" x="172"[^>]*width="55"/);
  assert.match(html, /class="gantt-bar gantt-active"/);
  assert.match(html, /class="gantt-bar gantt-crit"/);
  assert.equal((html.match(/class="gantt-section-band"/g) ?? []).length, 2);
  assert.match(html, /確認（2026-11-26〜2026-11-27、完了）/);
  assert.match(html, /テスト（2026-12-04〜2026-12-05、重要）/);
  assert.match(html, /備え（2026-12-01〜2026-12-05）/);
  assert.match(html, /公開（マイルストーン、2026-12-05）/);
  assert.match(html, /監視（2026-12-05〜2026-12-06）/);
  assert.match(html, />11\/26<\/tspan>/);
  assert.match(html, /準備 &lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<img\b/);
  assert.match(html, /class="language-mermaid">pie/);
});

test('rejects Mermaid flowchart directives and clicks without writing an output', (t) => {
  for (const line of ['%%{init: {"theme":"dark"}}%%', 'click A "https://example.com"']) {
    const { dir, run } = fixture(t, ['```mermaid', 'flowchart TB', 'A --> B', line, '```', ''].join('\n'));
    const result = run('page.html', ['--offline']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Markdown 1行目の図: Mermaid図には設定ディレクティブやクリック操作を指定できません/);
    assert.equal(existsSync(join(dir, 'page.html')), false);
  }
});

test('pre-renders Mermaid flowcharts offline with static, distinct SVG references', chromiumTests, (t) => {
  const { dir, run } = fixture(t, [
    '## 構成', '', '```mermaid', '%% グループ', 'flowchart TB', 'accTitle: 構成図',
    'accDescr: VPCの中での処理', 'subgraph network["アプリ VPC"]', '  subgraph zone["AZ A"]',
    '    B{確認}', '  end', 'end', 'A[要求] -->|HTTPS| B', '```', '',
    '```mermaid', 'graph LR', 'A[入力] -.-> B[出力]', '```', '',
  ].join('\n'));
  const result = run('page.html', ['--offline']);
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(join(dir, 'page.html'), 'utf8');
  assert.equal((html.match(/<figure class="diagram mermaid-flowchart"/g) ?? []).length, 2);
  assert.match(html, /<figcaption id="diagram-1">構成図<\/figcaption>/);
  assert.match(html, /<desc id="mermaid-1-description">VPCの中での処理<\/desc>/);
  assert.match(html, /class="cluster mermaid-outer-boundary"/);
  assert.match(html, /class="cluster mermaid-sub-boundary"/);
  assert.match(html, /marker-end="url\(#mermaid-1-\d+\)"/);
  assert.match(html, /marker-end="url\(#mermaid-2-\d+\)"/);
  assert.doesNotMatch(html, /<foreignObject|<filter\b|<script[^>]*src=|<!--mermaid-/);
  const again = run('again.html', ['--offline']);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(readFileSync(join(dir, 'again.html'), 'utf8'), html);
});

test('rejects external images in Mermaid flowcharts', chromiumTests, (t) => {
  const { dir, run } = fixture(t, [
    '```mermaid', 'flowchart TB', 'A@{ img: "https://example.com/image.svg", label: "画像" }', '```', '',
  ].join('\n'));
  const result = run('page.html', ['--offline']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Markdown 1行目のMermaid図: 図には画像URLやクリック操作を指定できません/);
  assert.equal(existsSync(join(dir, 'page.html')), false);
});

test('rejects missing and circular Mermaid Gantt dependencies', (t) => {
  for (const [rows, message] of [
    [['開始 :start, after unknown, 1d'], /未定義の依存タスクID/],
    [['開始 :start, after next, 1d', '次 :next, after start, 1d'], /依存が循環/],
  ]) {
    const { dir, run } = fixture(t, ['```mermaid', 'gantt', ...rows, '```', ''].join('\n'));
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
    assert.equal(existsSync(join(dir, 'page.html')), false);
  }
});

test('renders delayed Mermaid Gantt tasks and keeps completed rows filled', (t) => {
  const { dir, run } = fixture(t, [
    '```mermaid', 'gantt', '%% delayed: finished',
    '承認 :done, finished, 2026-11-26, 1d',
    '進行中の作業 :active, current, after finished, 1d',
    '遅れた作業（遅延） :crit, active, late, after current, 1d',
    '%% delayed: current', '```', '',
  ].join('\n'));
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(join(dir, 'page.html'), 'utf8');
  assert.equal((html.match(/<rect class="gantt-done-row"/g) ?? []).length, 1);
  assert.match(html, /<tr class="gantt-done-row"><th scope="row">承認/);
  assert.match(html, /class="gantt-bar gantt-done"/);
  assert.match(html, /class="gantt-bar gantt-active"/);
  assert.match(html, /class="gantt-bar gantt-delayed gantt-crit"/);
  assert.match(html, /class="gantt-status-text gantt-delayed">（遅延・重要）/);
  assert.match(html, /承認（2026-11-26〜2026-11-27、完了）/);
});

test('renders callouts, marked changes, and annotated paragraph anchors safely', (t) => {
  const source = [
    '## レビュー', '', '対象になる段落。', '',
    '```callout', JSON.stringify({ kind: 'warning', title: '<script>', text: '<img src=x>公開前に確認' }), '```',
    '', '```diff', '--- a/old.txt', '+++ b/new.txt', '@@ -1 +1 @@', '- old', '+ <iframe src=x>', '~ 条件を更新', '```',
  ].join('\n');
  const { dir, run } = fixture(t, source);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(join(dir, 'page.html'), 'utf8');
  assert.match(html, /<p data-source-line="3">対象になる段落。<\/p>/);
  assert.match(html, /id="toggle-paragraph-review" aria-pressed="false" hidden/);
  assert.match(html, /class="callout callout--warning"/);
  assert.match(html, /class="diff-row diff-header"><span class="diff-line-content">\+\+\+ b\/new\.txt/);
  assert.match(html, /class="diff-row diff-added"><span class="diff-line-marker">\+<\/span><span class="diff-line-content"> &lt;iframe src=x&gt;/);
  assert.match(html, /class="diff-row diff-removed"><span class="diff-line-marker">-<\/span><span class="diff-line-content"> old/);
  assert.match(html, /class="diff-row diff-changed"><span class="diff-line-marker">~<\/span><span class="diff-line-content"> 条件を更新/);
  assert.doesNotMatch(html, /<(?:iframe|img)\b|<script><\/strong>/);
});

test('renders opt-in Markdown sections with the original components and leaves ordinary blocks alone', (t) => {
  const source = [
    '## 表とツリー', '', '| 日付 | 出来事 |', '| --- | --- |', '| 1日目 | 通常の表 |', '',
    '**タイムライン**', '', '| 日付 | 出来事 | 補足 |', '| --- | --- | --- |', '| 2日目 | 検証 | <img src=x> |', '',
    '**タイムライン**', '', '| 時刻 | 予定 |', '| --- | --- |', '| 10:00 | 見学 |', '',
    '| 時刻 | 予定 |', '| --- | --- |', '| 12:00 | 昼食 |', '',
    '- 通常の項目', '', '**ディレクトリツリー**', '', '- `src/`', '  - `index.mjs` — 変換入口', '',
    '> **警告 — 停止条件**', '>', '> 失敗時は止める。', '',
    '> **確認事項**', '>', '> どちらにしますか？', '>', '> 1. A', '> 2. B', '',
    '> **確認事項**', '>', '> どれを調べますか？', '>', '> - [ ] A', '> - [ ] B', '',
    '> **確認事項**', '>', '> 理由は何ですか？', '>', '> 回答：', '',
    '> **確認事項** 手作業で確かめる。',
  ].join('\n');
  const { dir, run } = fixture(t, source);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(join(dir, 'page.html'), 'utf8');
  assert.equal((html.match(/<figure class="timeline">/g) ?? []).length, 2);
  assert.match(html, /<span class="timeline-when">10:00<\/span><strong>見学<\/strong>/);
  assert.match(html, /<td>通常の表<\/td>/);
  assert.match(html, /<td>12:00<\/td>\s*<td>昼食<\/td>/);
  assert.equal((html.match(/class="directory-tree"/g) ?? []).length, 1);
  assert.match(html, /<ul>\s*<li>通常の項目<\/li>/);
  assert.match(html, /<code>index.mjs<\/code><span class="tree-note">変換入口<\/span>/);
  assert.match(html, /<blockquote class="callout callout--warning">/);
  assert.match(html, /<blockquote class="confirmation">/);
  assert.match(html, /type="radio" name="confirmation-1"/);
  assert.match(html, /type="checkbox" name="confirmation-2"/);
  assert.match(html, /type="checkbox" name="confirmation-2" value="A"><span class="confirmation-indicator" aria-hidden="true"><\/span><span>A<\/span>/);
  assert.match(html, /<textarea data-confirmation-answer/);
  assert.doesNotMatch(html, /<img\b/);
});

test('renders Mermaid sequences with numbers, state and ER diagrams, and a chart with its data', chromiumTests, (t) => {
  const source = readFileSync(new URL('../examples/portable-components.md', import.meta.url));
  const { dir, run } = fixture(t, source);
  const result = run('page.html', ['--offline']);
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(join(dir, 'page.html'), 'utf8');
  for (const kind of ['sequence', 'state', 'er', 'xychart']) {
    assert.match(html, new RegExp(`class="diagram mermaid-${kind}"`));
  }
  assert.equal((html.match(/class="sequence-number-disc"/g) ?? []).length, 4);
  assert.match(html, /class="sequenceNumber">4<\/text>/);
  assert.match(html, /<summary>数値一覧<\/summary>[\s\S]+<td>20<\/td>/);
  assert.doesNotMatch(html, /<filter\b|<foreignObject\b|<script[^>]*src=|<!--mermaid-/);
  const repeat = run('repeat.html', ['--offline']);
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.equal(readFileSync(join(dir, 'repeat.html'), 'utf8'), html);
});

test('labels cards after Z without changing heading anchors', (t) => {
  const source = Array.from({ length: 28 }, (_, index) => `## 見出し ${index + 1}\n\n本文`).join('\n\n');
  const { dir, run } = fixture(t, source);
  assert.equal(run().status, 0);
  const html = readFileSync(join(dir, 'page.html'), 'utf8');
  assert.match(html, /data-panel-id="Z" aria-labelledby="section-26"/);
  assert.match(html, /data-panel-id="P27" aria-labelledby="section-27"/);
  assert.match(html, /data-panel-id="P28" aria-labelledby="section-28"/);
});

test('keeps untrusted Markdown and diagram labels inert', (t) => {
  const diagram = {
    title: '<img src=https://example.invalid/s>',
    nodes: [{ id: 'constructor', label: '</text><script>alert(1)</script>' }],
    edges: [['constructor', 'constructor']],
  };
  const { dir, run } = fixture(t, [
    '# <script>alert(1)</script>', '',
    '<iframe src="https://example.invalid/"></iframe>', '',
    '![外部画像](https://example.invalid/a) [参照](https://example.invalid/b) [危険](javascript:alert(1))',
    '', '```diagram', JSON.stringify(diagram), '```',
    '', '```confirm', JSON.stringify({
      type: 'single', question: '<img src=https://example.invalid>',
      options: ['" autofocus onfocus="alert(1)', '<iframe>'],
    }), '```',
  ].join('\n'));
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(join(dir, 'page.html'), 'utf8');
  assert.doesNotMatch(html, /<(?:iframe|img|link)\b|\b(?:src|href)\s*=\s*["'](?:https?:|javascript:)/i);
  assert.equal((html.match(/<script\b/g) ?? []).length, 1);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /class="image-alt">外部画像/);
  assert.match(html, /class="reference-url">\(https:\/\/example.invalid\/b\)/);
  assert.match(html, /value="&quot; autofocus onfocus=&quot;alert\(1\)"/);
  assert.match(html, /marker-end="url\(#arrow-1\)"/);
});

for (const [name, content, message] of [
  ['malformed diagram', '# A\n\n```diagram\n{\n```', /3行目の図/],
  ['invalid confirmation options', '```confirm\n{"type":"single","question":"どれ？","options":["A","A"]}\n```', /確認事項: options/],
  ['invalid callout kind', '```callout\n{"kind":"other","title":"要点","text":"内容"}\n```', /kind は/],
  ['unknown sequence participant', '```sequence\nparticipants: A, B\nA -> C: 入力\n```', /送信元または受信先が未定義/],
  ['skipped tree level', '```tree\nroot/\n    file.md\n```', /階層が不正/],
  ['invalid state start', '```state\n{"title":"状態","initial":"b","states":[{"id":"a","label":"A"}],"transitions":[]}\n```', /initial は定義済み/],
  ['unknown ER entity', '```er\n{"title":"ER","entities":[{"id":"a","label":"A","fields":[["id","uuid"]]}],"relations":[["a","b","1","0..*"]]}\n```', /矢印の始点/],
  ['non-numeric chart value', '```chart\n{"title":"棒","type":"bar","values":[["A","12"]]}\n```', /values は/],
  ['unexpected timeline field', '```timeline\n{"title":"工程","events":[{"when":"1日目","title":"準備","url":"https://example.invalid"}]}\n```', /events に日時/],
  ['missing endpoint', '```diagram\n{"title":"図","nodes":[{"id":"a","label":"A"}],"edges":[["a","b"]]}\n```', /矢印の始点/],
  ['non-UTF-8 source', Buffer.from([0xff]), /utf-8/i],
  ['oversized source', Buffer.alloc(1024 * 1024 + 1, 65), /1 MiB/],
  ['empty source', ' \n', /空の文書/],
]) {
  test(`rejects ${name} before creating output`, (t) => {
    const { dir, run } = fixture(t, content);
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
    assert.equal(existsSync(join(dir, 'page.html')), false);
  });
}
