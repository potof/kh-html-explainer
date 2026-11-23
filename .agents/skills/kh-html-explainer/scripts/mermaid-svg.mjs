// These functions are serialized for Chromium. Keep their dependencies inside each function.
export async function inspectFlowcharts(jobs) {
  const parsed = [];
  for (const job of jobs) {
    try {
      const { db, type } = await mermaid.mermaidAPI.getDiagramFromText(job.source);
      if (type !== 'flowchart-v2') throw new Error('flowchart または graph を指定してください');
      const icons = Object.create(null);
      for (const vertex of db.getVertices().values()) {
        if (vertex.img || vertex.link || vertex.haveCallback) throw new Error('図には画像URLやクリック操作を指定できません');
        if (!vertex.icon) continue;
        if (!/^aws:[a-z0-9-]+$/.test(vertex.icon)) throw new Error('アイコンは aws:サービスID の形式で指定してください');
        icons[vertex.domId] = vertex.icon.slice(4);
      }
      const title = db.getAccTitle() || db.getDiagramTitle() || 'フローチャート';
      const description = db.getAccDescription();
      parsed.push({ ...job, title, description, icons });
    } catch (error) {
      throw new Error(`Markdown ${job.line}行目のMermaid図: ${error.message.split('\n')[0]}`);
    }
  }
  return parsed;
}

export async function exportFlowcharts(jobs, icons) {
  if (Object.keys(icons).length) mermaid.registerIconPacks([{ name: 'aws', icons: { prefix: 'aws', icons } }]);
  await document.fonts.ready;
  const svgNS = 'http://www.w3.org/2000/svg';
  const tags = new Set('svg g rect circle ellipse line path polygon polyline defs text tspan title desc marker clipPath'.split(' '));
  const attributes = new Set(('class cx cy dx dy d fill fill-rule clip-rule font-style font-weight height marker-end marker-mid marker-start '
    + 'markerHeight markerUnits markerWidth orient points r refX refY rx ry stroke stroke-width stroke-dasharray stroke-dashoffset '
    + 'stroke-linecap stroke-linejoin dominant-baseline text-anchor transform viewBox width x x1 x2 y y1 y2 clip-path opacity').split(' '));
  const noContent = new Set(['style', 'filter', 'linearGradient', 'stop', 'animate']);
  const result = [];

  for (const { source, index, line, title, description, icons: nodeIcons } of jobs) {
    try {
      const prefix = `mermaid-${index}`;
      const rendered = await mermaid.render(prefix, source);
      const raw = new DOMParser().parseFromString(rendered.svg, 'image/svg+xml');
      if (raw.doctype || raw.documentElement.namespaceURI !== svgNS || raw.documentElement.localName !== 'svg'
        || raw.querySelector('parsererror')) throw new Error('SVGの構造が不正です');

      const size = raw.documentElement.getAttribute('viewBox')?.trim().split(/\s+/).map(Number);
      if (size?.length !== 4 || !size.every(Number.isFinite) || size[2] <= 0 || size[3] <= 0) throw new Error('図の寸法が不正です');
      const safe = document.implementation.createDocument(svgNS, 'svg');
      const ids = new Map();
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
        for (const name of ['stroke-width', 'stroke-dasharray', 'stroke-dashoffset']) {
          const value = from.style?.getPropertyValue(name).trim();
          if (value && /^[\d,.\s-]+$/.test(value)) to.setAttribute(name, value);
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
      result.push({ index, title, svg: new XMLSerializer().serializeToString(root) });
    } catch (error) {
      throw new Error(`Markdown ${line}行目のMermaid図: ${error.message.split('\n')[0]}`);
    }
  }
  return result;
}
