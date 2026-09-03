// Bundles the offline single player mode into ONE self contained HTML file
// (no imports, no external CSS/JS, no network) that can be opened from disk,
// mailed around or published as an artifact.
//
//   node scripts/build-solo.mjs  ->  dist/liberty-solo.html

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist', 'liberty-solo.html');

// Dependency order matters: plain concatenation, so every module must come
// after the things it uses at load time.
const MODULES = [
  'shared/constants.js',
  'shared/util.js',
  'shared/city.js',
  'shared/physics.js',
  'shared/world.js',
  'public/js/render.js',
  'public/js/hud.js',
  'public/js/input.js',
  'public/js/audio.js',
  'public/js/controls.js',
  'public/js/solo.js'
];

function stripModuleSyntax(src, file) {
  return src
    .replace(/^import[\s\S]*?;[ \t]*$/gm, '')          // drop import statements
    .replace(/^export\s+(const|let|function|class)/gm, '$1')
    .replace(/^export\s*\{[^}]*\}\s*;?[ \t]*$/gm, '')  // drop re-export lists
    .trim() + `\n// --- end ${file} ---\n`;
}

const js = MODULES.map(f => stripModuleSyntax(fs.readFileSync(path.join(ROOT, f), 'utf8'), f)).join('\n');
const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public/solo.html'), 'utf8');

const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/i);
if (!bodyMatch) throw new Error('public/solo.html: <body> not found');
const markup = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, '').trim();

// Artifact friendly fragment: title + style + markup + one inline script.
// No doctype/html/head/body – the host wraps it.
const out = `<title>Liberty Solo</title>
<style>
${css}
</style>

${markup}

<script>
(function () {
'use strict';
${js}
})();
</script>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
console.log(`wrote ${path.relative(ROOT, OUT)} (${(out.length / 1024).toFixed(0)} KB)`);
