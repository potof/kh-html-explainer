import { constants } from 'node:fs';
import { link, mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import catalog from './aws-icon-catalog.json';

const archiveName = `aws-architecture-icons-${catalog.release}.zip`;
const run = promisify(execFile);

function cacheDirectory() {
  const home = homedir();
  const base = process.platform === 'darwin' ? join(home, 'Library', 'Caches') : process.env.XDG_CACHE_HOME || join(home, '.cache');
  return resolve(process.env.HTML_EXPLAINER_CACHE_DIR || join(base, 'html-explainer'));
}

async function readArchive(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== catalog.size) throw new Error('AWS公式アイコンZIPのサイズが一致しません');
    const archive = Buffer.alloc(catalog.size);
    let length = 0;
    while (length < archive.length) {
      const { bytesRead } = await handle.read(archive, length, archive.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const digest = createHash('sha256').update(archive).digest('hex');
    if (length !== catalog.size || digest !== catalog.sha256) throw new Error('AWS公式アイコンZIPのハッシュが一致しません');
    return archive;
  } finally {
    await handle.close();
  }
}

async function loadArchive(directory, offline) {
  const cached = join(directory, archiveName);
  try {
    return await readArchive(cached);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (offline) throw new Error(`AWS公式アイコンZIPがキャッシュにありません (${cached})`, { cause: error });
  }

  await mkdir(directory, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(directory, '.download-'));
  try {
    const downloaded = join(staging, archiveName);
    // curl is only needed for the initial HTTPS download on a cache miss.
    try {
      await run('curl', ['-q', '--proto', '=https', '--fail', '--silent', '--show-error',
        '--max-time', '60', '--max-filesize', String(catalog.size), '--header', 'Accept-Encoding: identity',
        '--output', downloaded, catalog.url]);
    } catch (error) {
      const detail = error.code === 'ENOENT' ? 'curl が見つかりません' : error.stderr?.trim() || error.message;
      throw new Error(`AWS公式アイコンZIPを取得できません: ${detail}`, { cause: error });
    }
    const archive = await readArchive(downloaded);
    try {
      await link(downloaded, cached);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return await readArchive(cached);
    }
    return archive;
  } finally {
    await rm(staging, { force: true, recursive: true });
  }
}

const shapeTags = /^(?:g|path|rect)$/;
const renderAttributes = new Set(['d', 'fill', 'fill-rule', 'clip-rule', 'x', 'y', 'width', 'height', 'stroke', 'stroke-width', 'transform']);
const paint = /^(?:#[\da-f]{3}|#[\da-f]{6}|#[\da-f]{8}|none|white)$/i;

function extractIcon(archive, id, entry) {
  // The offsets identify raw DEFLATE members in the exact archive verified above.
  const compressed = archive.subarray(entry.offset, entry.offset + entry.compressedSize);
  const svg = inflateRawSync(compressed, { maxOutputLength: entry.size }).toString('utf8');
  const root = svg.match(/^\s*(?:<\?xml [^<>]*\?>\s*)?<svg\s+([^<>]+)>([\s\S]*)<\/svg>\s*$/);
  const viewBox = root?.[1].match(/\bviewBox="(-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+)"/)?.[1];
  if (!viewBox) throw new Error(`AWSアイコンのviewBoxが不正です (${id})`);
  const inner = root[2].replace(/<!--[\s\S]*?-->|<title>[^<>]*<\/title>/g, '').trim();
  const tags = /\s*<(\/?)([a-z]+)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>/gy;
  const attributes = /([\w:-]+)="([^"]*)"/g;
  const stack = [];
  let drawing = '';
  let offset = 0;
  // Rebuild a small subset of the pinned assets so no active SVG content can reach the HTML.
  while (offset < inner.length) {
    const match = tags.exec(inner);
    const [, closing, tag, rawAttrs, empty] = match ?? [];
    if (!tag || !shapeTags.test(tag)) throw new Error(`許可していないSVG要素です (${id})`);
    offset = tags.lastIndex;
    if (closing) {
      if (rawAttrs || empty || stack.pop() !== tag) throw new Error(`AWSアイコンのSVG構造が不正です (${id})`);
      drawing += `</${tag}>`;
      continue;
    }
    let safeAttrs = '';
    for (const [, name, value] of rawAttrs.matchAll(attributes)) {
      if (name === 'id') continue;
      if (!renderAttributes.has(name) || !/^[\w\s+.,#()%\-]+$/.test(value) || /url\s*\(/i.test(value)
        || (['fill', 'stroke'].includes(name) && !paint.test(value))) {
        throw new Error(`許可していないSVG属性です (${id})`);
      }
      safeAttrs += ` ${name}="${value}"`;
    }
    if (!empty) stack.push(tag);
    drawing += `<${tag}${safeAttrs}${empty}>`;
  }
  if (stack.length) throw new Error(`AWSアイコンのSVG構造が不正です (${id})`);
  return { viewBox, drawing };
}

export async function loadAwsIcons(ids, offline) {
  if (!ids.size) return new Map();
  const sorted = [...ids].sort();
  const unknown = sorted.filter(id => !Object.hasOwn(catalog.icons, id));
  if (unknown.length) throw new Error(`未登録のAWSアイコンIDです: ${unknown.join(', ')}`);
  const archive = await loadArchive(cacheDirectory(), offline);
  return new Map(sorted.map(id => [id, extractIcon(archive, id, catalog.icons[id])]));
}

export function renderAwsIconSprite(icons) {
  if (!icons.size) return '';
  const symbols = [...icons].map(([id, { viewBox, drawing }]) => {
    return `<symbol id="aws-icon-${id}" viewBox="${viewBox}">${drawing}</symbol>`;
  }).join('');
  return `<svg width="0" height="0" aria-hidden="true"><defs>${symbols}</defs></svg>\n`;
}
