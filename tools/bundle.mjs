/**
 * Single-file build.
 *
 * The project runs unbundled — ES modules, an import map, a vendored three.js,
 * no build step — because that is the nicest thing to work on. But a *playable
 * link* has to be one self-contained HTML file: the artifact host serves a
 * single document, and the scene's whole premise is that it downloads nothing.
 *
 * So this walks the module graph with esbuild, inlines the stylesheet, folds
 * the whole thing into the existing index.html, and writes dist/index.html.
 * No CDN, no import map, no second request.
 *
 *   node tools/bundle.mjs [outFile] [--artifact]
 *
 * `--artifact` emits body content only (plus <title> and <style>), because the
 * artifact host supplies its own document skeleton.
 */

import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const ROOT = '/home/user/claude-test';
const ARTIFACT = process.argv.includes('--artifact');
const OUT = process.argv.filter((a) => !a.startsWith('--'))[2] || join(ROOT, 'dist/index.html');

/* Resolve the import map's two bare specifiers to the vendored copies. */
const importMapPlugin = {
  name: 'importmap',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: join(ROOT, 'vendor/three/three.module.js') }));
    b.onResolve({ filter: /^three\/addons\// }, (args) => ({
      path: join(ROOT, 'vendor/three', args.path.replace(/^three\//, '')),
    }));
  },
};

const result = await build({
  entryPoints: [join(ROOT, 'src/main.js')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  write: false,
  plugins: [importMapPlugin],
  logLevel: 'info',
});

const js = result.outputFiles[0].text;
const css = await readFile(join(ROOT, 'styles/main.css'), 'utf8');
let html = await readFile(join(ROOT, 'index.html'), 'utf8');

/* Strip the import map, the stylesheet link and the module entry, then inline. */
html = html
  .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '')
  .replace(/<link[^>]+href="\.?\/?styles\/main\.css"[^>]*>\s*/, () => `<style>\n${css}\n</style>\n`)
  .replace(/<link[^>]+rel="manifest"[^>]*>\s*/, '')
  .replace(/<script\b[^>]*src="[^"]*main\.js"[^>]*><\/script>/,
    () => `<script type="module">\n${js}\n</script>`);

if (html.includes('main.js')) throw new Error('entry script tag was not replaced — check index.html');
if (html.includes('main.css')) throw new Error('stylesheet link was not replaced — check index.html');

if (ARTIFACT) {
  /* The host wraps the file in its own <!doctype>/<head>/<body>, so hand it the
     body's contents with the title and stylesheet moved to the front. */
  // The gallery wants a name, not a name plus an explainer, so keep the part
  // before the em dash: "THE BLOCK", not "THE BLOCK — Six Decades on One Corner".
  const full = (html.match(/<title>([\s\S]*?)<\/title>/) || [, 'THE BLOCK'])[1];
  const title = full.split('—')[0].trim() || full.trim();
  const style = (html.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [, ''])[1];
  if (!body.trim()) throw new Error('could not extract <body>');
  html = `<title>${title}</title>\n${style}\n${body}`;
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log(`${OUT}  ${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB${ARTIFACT ? '  (artifact body)' : ''}`);
