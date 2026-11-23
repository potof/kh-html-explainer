import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { build } from 'esbuild';

const skill = '.agents/skills/kh-html-explainer';
const { metafile } = await build({
  entryPoints: [`${skill}/scripts/render.mjs`],
  outfile: `${skill}/dist/render.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  loader: { '.css': 'text' },
  minify: true,
  metafile: true,
});

const roots = new Set();
for (const file of Object.keys(metafile.inputs)) {
  const match = file.match(/^node_modules\/(?:@[^/]+\/)?[^/]+/);
  if (match) roots.add(match[0]);
}

const licenses = await Promise.all([...roots].sort().map(async (root) => {
  const { name, version } = JSON.parse(await readFile(`${root}/package.json`, 'utf8'));
  const file = (await readdir(root)).find((entry) => /^license(?:[.-]|$)/i.test(entry));
  if (!file) throw new Error(`Missing license for ${name} (in ${dirname(root)})`);
  const license = await readFile(`${root}/${file}`, 'utf8');
  return `${name} ${version}\n${license.trim()}\n`;
}));
await writeFile(`${skill}/dist/THIRD_PARTY_NOTICES.txt`, licenses.join('\n'));
