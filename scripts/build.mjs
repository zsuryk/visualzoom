// Build the MV3 extension shell: bundle the ESM content script into a plain
// content-script (Chrome content scripts can't be ES modules) and copy the
// target platform's manifest into place. `npm run build` -> Chrome,
// `npm run build:firefox` -> Firefox.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] === 'firefox' ? 'firefox' : 'chrome';

mkdirSync(resolve(root, 'extension'), { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/content/content-script.js')],
  outfile: resolve(root, 'extension/content-script.js'),
  bundle: true,
  format: 'iife',
  target: ['chrome110'],
  legalComments: 'none',
});

copyFileSync(
  resolve(root, `manifests/${target}.json`),
  resolve(root, 'extension/manifest.json')
);

console.log(`built extension (${target})`);
