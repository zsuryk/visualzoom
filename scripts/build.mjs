// Build the MV3 extension shell: bundle the ESM sources (content script,
// popup, options page) into plain scripts and copy the target platform's
// manifest into place. Chrome content scripts can't be ES modules; the popup
// and options pages are bundled the same way so both share the settings
// store. `npm run build` -> Chrome, `npm run build:firefox` -> Firefox.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] === 'firefox' ? 'firefox' : 'chrome';

mkdirSync(resolve(root, 'extension'), { recursive: true });

const entryPoints = [
  resolve(root, 'src/content/content-script.js'),
  resolve(root, 'src/extension/popup.js'),
  resolve(root, 'src/extension/options.js'),
];
const outfiles = [
  resolve(root, 'extension/content-script.js'),
  resolve(root, 'extension/popup.js'),
  resolve(root, 'extension/options.js'),
];

await Promise.all(
  entryPoints.map((entryPoint, i) =>
    build({
      entryPoints: [entryPoint],
      outfile: outfiles[i],
      bundle: true,
      format: 'iife',
      target: ['chrome110'],
      legalComments: 'none',
      define: {
        __BROWSER__: JSON.stringify(target),
      },
    })
  )
);

copyFileSync(
  resolve(root, `manifests/${target}.json`),
  resolve(root, 'extension/manifest.json')
);

console.log(`built extension (${target})`);
