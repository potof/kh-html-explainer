import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withOfflineChromium } from './mermaid-chromium.mjs';
import { inspectDiagrams, exportDiagrams } from './mermaid-svg.mjs';
import { awsFlowchartFromMermaid } from './aws-flowchart.mjs';
import { teamFlowchartFromMermaid } from './team-flowchart.mjs';

export function mermaidKind(source) {
  const first = source.split('\n').map(line => line.trim()).find(line => line && !line.startsWith('%%'));
  const syntax = first?.match(/^[\w-]+(?=\s|;|$)/)?.[0];
  switch (syntax) {
    case 'flowchart': case 'graph': return 'flowchart';
    case 'sequenceDiagram': return 'sequence';
    case 'stateDiagram': case 'stateDiagram-v2': return 'state';
    case 'erDiagram': return 'er';
    case 'xychart': case 'xychart-beta': return 'xychart';
  }
}

function replaceSetting(source, from, to) {
  if (source.split(from).length !== 2) throw new Error('固定版MermaidのELK設定に一致しません');
  return source.replace(from, to);
}

async function readRuntime() {
  let file;
  try {
    const override = process.env.KH_HTML_EXPLAINER_MERMAID_DIR;
    if (override) file = join(override, 'dist', 'mermaid.js');
    else {
      let entry;
      try {
        entry = fileURLToPath(import.meta.resolve('mermaid'));
      } catch (error) {
        if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
        entry = createRequire(resolve('package.json')).resolve('mermaid');
      }
      file = join(entry, '..', 'mermaid.js');
    }
    const { version } = JSON.parse(await readFile(join(file, '..', '..', 'package.json'), 'utf8'));
    if (version !== '12.3.0') throw new Error('Mermaid 12.3.0 が必要です');
    const source = await readFile(file, 'utf8');

    // This ELK version does not take flowchart spacing options into account for nested groups.
    let compact = replaceSetting(source, 'SUBGRAPH_PADDING = 24;', 'SUBGRAPH_PADDING = 10;');
    compact = replaceSetting(compact, 'DEFAULT_SUBGRAPH_SPACING_BASE_VALUE = 24;', 'DEFAULT_SUBGRAPH_SPACING_BASE_VALUE = 13;');
    compact = replaceSetting(compact, 'DEFAULT_SUBGRAPH_NODE_SPACING = 50;', 'DEFAULT_SUBGRAPH_NODE_SPACING = 26;');
    compact = replaceSetting(compact, '"elk.direction": "DOWN",\n        "spacing.baseValue": 40,',
      '"elk.direction": "DOWN",\n        "spacing.baseValue": 18,');
    const from = compact.indexOf('function buildSubgraphLayoutOptions(');
    const to = compact.indexOf('function findCyclicEntryNodes(', from);
    if (from === -1 || to === -1) throw new Error('固定版Mermaidのサブグラフ設定に一致しません');
    let subgraph = compact.slice(from, to);
    subgraph = replaceSetting(subgraph, '"elk.layered.spacing.edgeNodeBetweenLayers": 30,', '"elk.layered.spacing.edgeNodeBetweenLayers": 22,');
    subgraph = replaceSetting(subgraph, '"elk.spacing.edgeEdge": 20,', '"elk.spacing.edgeEdge": 15,');
    return compact.slice(0, from) + subgraph + compact.slice(to);
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND' && error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ENOENT') throw error;
    throw new Error('Mermaidが見つかりません。Skillのリポジトリで npm ci --ignore-scripts を実行してください', { cause: error });
  }
}

const settings = {
  startOnLoad: false, securityLevel: 'strict', deterministicIds: true, deterministicIDSeed: 'kh-aws',
  layout: 'elk', htmlLabels: false, theme: 'base',
  themeVariables: {
    fontFamily: '"Noto Sans CJK JP", "Noto Sans JP", "Hiragino Sans", sans-serif',
    fontSize: '14px', primaryColor: '#fff', primaryBorderColor: '#d4d4d8', primaryTextColor: '#27272a',
    textColor: '#27272a', lineColor: '#666671', clusterBkg: '#fafafa', clusterBorder: '#aaaab4',
    edgeLabelBackground: '#fff',
  },
  flowchart: { htmlLabels: false, useMaxWidth: false, curve: 'linear', nodeSpacing: 22, rankSpacing: 36, padding: 6 },
  sequence: { mirrorActors: false, diagramMarginX: 12, diagramMarginY: 10, actorMargin: 37, width: 83, height: 32,
    boxMargin: 6, boxTextMargin: 4, noteMargin: 6, messageMargin: 24, bottomMarginAdj: 4,
    actorFontSize: 13, messageFontSize: 12, noteFontSize: 12, showSequenceNumbers: true },
  state: { diagramPadding: 8, padding: 5, nodeSpacing: 20, rankSpacing: 25, minNodeWidth: 0 },
  er: { diagramPadding: 8, entityPadding: 6, minEntityWidth: 64, minEntityHeight: 34, nodeSpacing: 24, rankSpacing: 32 },
  xyChart: { width: 356, height: 170, showTitle: false,
    xAxis: { labelFontSize: 12, titleFontSize: 12, labelPadding: 4 },
    yAxis: { labelFontSize: 12, titleFontSize: 12, labelPadding: 4 } },
};

export function validateMermaidSource(source) {
  if (Buffer.byteLength(source) > 16 * 1024) throw new Error('Mermaid図は1件あたり16 KiBまでです');
  if (/%%\s*\{|(?:^|;)\s*(?:click|link|links)\s+/im.test(source)) throw new Error('Mermaid図には設定ディレクティブやクリック操作を指定できません');
}

export async function renderMermaid(jobs, loadIcons) {
  if (!jobs.length) return [];
  const runtime = await readRuntime();
  return withOfflineChromium(async evaluate => {
    // Separate evaluations keep raw Markdown out of the trusted Mermaid script.
    await evaluate(runtime + '\n;void 0');
    await evaluate(`void mermaid.initialize(${JSON.stringify(settings)})`);
    const parsed = await evaluate(`(${inspectDiagrams.toString()})(${JSON.stringify(jobs)})`);
    const native = [];
    const boxed = [];
    const ids = new Set();
    for (const job of parsed) {
      for (const id of Object.values(job.icons)) ids.add(id);
      const team = teamFlowchartFromMermaid(job);
      if (team) {
        boxed.push({ index: job.index, team });
        continue;
      }
      const aws = awsFlowchartFromMermaid(job);
      if (!aws) {
        native.push(job);
        continue;
      }
      boxed.push({ index: job.index, aws });
      for (const { icon } of aws.entries.values()) if (icon) ids.add(icon);
    }
    const icons = await loadIcons(ids);
    if (!native.length) return boxed;
    const nativeIds = new Set(native.flatMap(job => Object.values(job.icons)));
    const pack = Object.fromEntries([...nativeIds].map(id => {
      const { viewBox, drawing } = icons.get(id);
      const [left, top, width, height] = viewBox.split(' ').map(Number);
      return [id, { left, top, width, height, body: drawing }];
    }));
    const standard = await evaluate(`(${exportDiagrams.toString()})(${JSON.stringify(native)},${JSON.stringify(pack)},${JSON.stringify(settings)})`);
    return [...boxed, ...standard];
  });
}
