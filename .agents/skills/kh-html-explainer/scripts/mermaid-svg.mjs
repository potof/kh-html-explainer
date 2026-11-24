// These functions are serialized for Chromium. Keep their dependencies inside each function.
export async function inspectDiagrams(jobs) {
  const types = { flowchart: ['flowchart-v2'], sequence: ['sequence'], state: ['stateDiagram', 'stateDiagram-v2'],
    er: ['er'], xychart: ['xychart'] };
  const captions = { flowchart: 'フローチャート', sequence: 'シーケンス図', state: '状態遷移図', er: 'ER図', xychart: '数値グラフ' };
  const parsed = [];
  for (const job of jobs) {
    try {
      const { db, type } = await mermaid.mermaidAPI.getDiagramFromText(job.source);
      if (!types[job.kind].includes(type)) throw new Error('不明なMermaid図です');
      const icons = Object.create(null);
      const nodes = job.kind === 'flowchart' ? [...db.getVertices().values()] : [];
      for (const vertex of nodes) {
        if (vertex.img || vertex.link || vertex.haveCallback) throw new Error('図には画像URLやクリック操作を指定できません');
        if (!vertex.icon) continue;
        if (!/^aws:[a-z0-9-]+$/.test(vertex.icon)) throw new Error('アイコンは aws:サービスID の形式で指定してください');
        icons[vertex.domId] = vertex.icon.slice(4);
      }
      const title = db.getAccTitle?.() || db.getDiagramTitle?.() || captions[job.kind];
      const description = db.getAccDescription?.();
      const groups = job.kind === 'flowchart' ? db.getSubGraphs() : [];
      const groupIds = new Set(groups.map(group => group.id));
      const plainNodes = nodes.filter(node => !groupIds.has(node.id));
      const edges = job.kind === 'flowchart' ? db.getEdges() : [];
      const flow = job.kind === 'flowchart' ? {
        direction: db.getDirection(),
        groups: groups.map(({ id, title, nodes }) => ({ id, name: title, members: nodes })),
        nodes: plainNodes.map(({ id, text, domId }) => ({ id, name: text, icon: icons[domId] })),
        edges: edges.map(({ start, end, text, stroke }) => [start, end, text, stroke]),
        simple: !db.getClasses().size && !edges.defaultStyle && !edges.defaultInterpolate
          && groups.every(group => !group.dir && !group.classes.length && group.labelType !== 'markdown')
          && plainNodes.every(node => !node.classes.length && !node.styles.length
            && (!node.type || ['square', 'rect'].includes(node.type))
            && !node.form && (node.icon || node.labelType !== 'markdown'))
          && edges.every(edge => edge.type === 'arrow_point' && ['normal', 'dotted', 'thick'].includes(edge.stroke)
            && !edge.style?.length && !edge.interpolate && !edge.animate && !edge.animation
            && !edge.classes.length && edge.length === 1 && edge.labelType !== 'markdown'),
      } : undefined;
      const chart = job.kind === 'xychart' ? db.getXYChartData() : undefined;
      const plots = chart?.plots.map(({ title, type, data }) => ({ title, type, data }));
      parsed.push({ ...job, title, description, icons, flow, grouped: groups.length > 0, plots, unit: chart?.yAxis.title });
    } catch (error) {
      throw new Error(`Markdown ${job.line}行目のMermaid図: ${error.message.split('\n')[0]}`);
    }
  }
  return parsed;
}

export async function exportDiagrams(jobs, icons, settings) {
  if (Object.keys(icons).length) mermaid.registerIconPacks([{ name: 'aws', icons: { prefix: 'aws', icons } }]);
  await document.fonts.ready;
  const svgNS = 'http://www.w3.org/2000/svg';
  const tags = new Set('svg g rect circle ellipse line path polygon polyline defs text tspan title desc marker clipPath symbol use'.split(' '));
  const attributes = new Set(('class cx cy dx dy d fill fill-rule clip-rule font-style font-weight height marker-end marker-mid marker-start '
    + 'markerHeight markerUnits markerWidth orient points r refX refY rx ry stroke stroke-width stroke-dasharray stroke-dashoffset '
    + 'stroke-linecap stroke-linejoin dominant-baseline alignment-baseline text-anchor transform viewBox width x x1 x2 y y1 y2 clip-path opacity font-size').split(' '));
  const noContent = new Set(['style', 'filter', 'linearGradient', 'stop', 'animate']);
  const result = [];

  for (const { source, index, line, title, description, icons: nodeIcons, kind, grouped, plots, unit } of jobs) {
    try {
      const prefix = `mermaid-${index}`;
      mermaid.initialize(grouped ? settings : {
        ...settings,
        layout: 'dagre',
        look: 'classic',
        handDrawnSeed: 1,
        flowchart: { ...settings.flowchart, nodeSpacing: 20, rankSpacing: 26, diagramPadding: 8, minNodeWidth: 0 },
      });
      const rendered = await mermaid.render(prefix, source);
      const raw = new DOMParser().parseFromString(rendered.svg, 'image/svg+xml');
      if (raw.doctype || raw.documentElement.namespaceURI !== svgNS || raw.documentElement.localName !== 'svg'
        || raw.querySelector('parsererror')) throw new Error('SVGの構造が不正です');

      const size = raw.documentElement.getAttribute('viewBox')?.trim().split(/\s+/).map(Number);
      if (size?.length !== 4 || !size.every(Number.isFinite) || size[2] <= 0 || size[3] <= 0) throw new Error('図の寸法が不正です');
      const safe = document.implementation.createDocument(svgNS, 'svg');
      const ids = new Map();
      const symbols = new Set([...raw.querySelectorAll('use')].map(child =>
        (child.getAttribute('href') ?? child.getAttribute('xlink:href'))?.slice(1)));
      for (const node of raw.querySelectorAll('[id]')) {
        if (tags.has(node.localName)) ids.set(node.id, `${prefix}-${ids.size}`);
      }
      const iconNodes = new Map();
      for (const [domId, icon] of Object.entries(nodeIcons)) {
        const image = raw.getElementById(`${prefix}-${domId}`)?.querySelector('svg');
        if (!image) throw new Error(`AWSアイコンを配置できません (aws:${icon})`);
        iconNodes.set(image, icon);
      }
      function copy(from, to) {
        if (ids.has(from.id)) to.setAttribute('id', ids.get(from.id));
        for (const { name, value } of from.attributes) {
          if (from.localName === 'use' && (name === 'href' || name === 'xlink:href')) {
            if (/^#[^#()]+$/.test(value) && ids.has(value.slice(1))) to.setAttribute('href', '#' + ids.get(value.slice(1)));
            continue;
          }
          if (!attributes.has(name)) continue;
          if (name.startsWith('marker-') || name === 'clip-path') {
            const ref = /^url\(#([^()]+)\)$/.exec(value)?.[1];
            if (ids.has(ref)) to.setAttribute(name, `url(#${ids.get(ref)})`);
          } else if (name === 'fill' || name === 'stroke') {
            if (/^(?:[a-z]+|#[a-f\d]{3,8})$/i.test(value)) to.setAttribute(name, value);
          } else {
            to.setAttribute(name, value);
          }
        }
        for (const name of ['stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'font-size']) {
          const value = from.style?.getPropertyValue(name).trim();
          if (value && /^[\d,.\s-]+(?:px)?$/.test(value)) to.setAttribute(name, value);
        }
        const label = from.matches('.cluster') && from.querySelector(':scope > .cluster-label')?.textContent;
        if (label && (/^AZ(?:\s|$)/i.test(label) || /\bOU\b/i.test(label))) to.classList.add('mermaid-sub-boundary');
        if (label && (/^AWS Organizations/i.test(label) || /\bVPC\b/i.test(label))) to.classList.add('mermaid-outer-boundary');

        for (const child of from.childNodes) {
          if (child.nodeType === Node.TEXT_NODE && to.matches('text, tspan, title, desc')) {
            to.append(safe.createTextNode(child.textContent));
          }
          if (child.nodeType !== Node.ELEMENT_NODE || noContent.has(child.localName)) continue;
          if (child.namespaceURI !== svgNS || !tags.has(child.localName)) throw new Error(`SVG要素 ${child.localName} は利用できません`);
          if (child.localName === 'symbol' && !symbols.has(child.id)) continue;
          if (kind === 'sequence' && child.matches('text.sequenceNumber')) {
            const x = Number(child.getAttribute('x'));
            const y = Number(child.getAttribute('y'));
            if (Number.isFinite(x) && Number.isFinite(y)) {
              const disc = safe.createElementNS(svgNS, 'circle');
              disc.setAttribute('class', 'sequence-number-disc');
              disc.setAttribute('cx', String(x));
              disc.setAttribute('cy', String(y - 4));
              disc.setAttribute('r', child.textContent.length > 2 ? '9' : '7');
              to.append(disc);
            }
          }
          if (iconNodes.has(child)) {
            const reference = safe.createElementNS(svgNS, 'use');
            reference.setAttribute('href', '#aws-icon-' + iconNodes.get(child));
            reference.setAttribute('aria-hidden', 'true');
            for (const dimension of ['x', 'y', 'width', 'height']) {
              if (child.hasAttribute(dimension)) reference.setAttribute(dimension, child.getAttribute(dimension));
            }
            to.append(reference);
            continue;
          }
          const element = safe.createElementNS(svgNS, child.localName);
          copy(child, element);
          to.append(element);
        }
      }
      const root = safe.documentElement;
      copy(raw.documentElement, root);
      root.setAttribute('role', 'img');
      root.setAttribute('aria-labelledby', `diagram-${index}`);
      root.setAttribute('width', String(Math.ceil(size[2])));
      root.setAttribute('height', String(Math.ceil(size[3])));
      if (description) {
        const desc = safe.createElementNS(svgNS, 'desc');
        desc.id = `${prefix}-description`;
        desc.textContent = description;
        root.prepend(desc);
        root.setAttribute('aria-describedby', desc.id);
      }
      result.push({ index, title, kind, plots, unit, svg: new XMLSerializer().serializeToString(root) });
    } catch (error) {
      throw new Error(`Markdown ${line}行目のMermaid図: ${error.message.split('\n')[0]}`);
    }
  }
  return result;
}
