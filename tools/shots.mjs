/**
 * Headless capture harness.
 *
 * Serves the project, loads it in the pinned Chromium (SwiftShader — slow but
 * pixel-accurate), then drives the debug hooks in main.js to photograph the
 * block from a set of viewpoints in a set of eras. Used to eyeball the scene
 * without a GPU.
 *
 *   node tools/shots.mjs [outDir] [eras] [shots]
 *     eras   comma list of era indices, default 0
 *     shots  comma list of shot names, default all
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = '/home/user/claude-test';
const OUT = process.argv[2] || '/tmp/claude-0/-home-user-claude-test/8691d14c-b865-550d-9d9a-41c808a63d65/scratchpad/shots';
const ERAS = (process.argv[3] || '0').split(',').map(Number);
const ONLY = process.argv[4] ? process.argv[4].split(',') : null;

/* name: [x, y, z, yaw, pitch] — yaw 0 looks toward +Z (north face of the block) */
const SHOTS = {
  palace:   [16, 0, -44, 0.10, 0.16],
  northrow: [-2, 0, -46, 0.00, 0.10],
  necorner: [42, 0, -42, -0.72, 0.12],
  eastrow:  [44, 0, 0, -1.5708, 0.06],
  secorner: [42, 0, 42, -2.4, 0.12],
  southrow: [-2, 0, 46, 3.1416, 0.08],
  cornerlot: [-44, 0, 24, 1.35, 0.10],
  westrow:  [-44, 0, -2, 1.5708, 0.06],
  alley:    [7.5, 0, 40, 3.1416, 0.10],
  street:   [0, 0, 40, 3.1416, -0.02],
  aerial:   [-52, 46, -52, 0.72, -0.52],
  // Close on the shop windows — this is where the interiors live.
  shopdrug:   [-2, 0, -33.4, 0.0, 0.03],
  shoparcade: [-2.5, 0, 33.4, 3.1416, 0.03],
  shopdime:   [33.4, 0, 0, -1.5708, 0.03],
  shopgrocer: [-33.4, 0, -1, 1.5708, 0.03],
  // Down the kerb line — where the flock gathers.
  kerb:       [30, 0, -36, -0.55, -0.08],
  kerb2:      [-14, 0, -33.0, 1.25, -0.10],
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nope'); }
});
await new Promise((r) => server.listen(8123, r));
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 700 }, deviceScaleFactor: 1 });

const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[PAGEERROR] ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));

await page.goto('http://127.0.0.1:8123/', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
// Enter the scene, then strip the chrome so the frames are pure render.
await page.click('#btnStart');
await page.waitForTimeout(1200);
await page.evaluate(() => {
  for (const id of ['hud', 'title', 'touch', 'rotatehint']) document.getElementById(id)?.classList.add('hidden');
});

const names = ONLY || Object.keys(SHOTS);
for (const eraIdx of ERAS) {
  await page.evaluate(async (i) => { await window.__setEra(i); }, eraIdx);
  await page.waitForTimeout(2800);
  await page.evaluate(() => {
    for (const id of ['hud', 'title', 'touch', 'rotatehint']) document.getElementById(id)?.classList.add('hidden');
  });
  for (const name of names) {
    const s = SHOTS[name];
    if (!s) continue;
    await page.evaluate(([x, y, z, yaw, pitch, fly]) => {
      window.__setFly?.(fly);
      window.__teleport(x, y, z, yaw);
      window.__setPitch?.(pitch);
    }, [...s, s[1] > 5]);
    await page.waitForTimeout(1600);
    await page.screenshot({ path: join(OUT, `${eraIdx}-${name}.png`) });
  }
}

const diag = await page.evaluate(() => window.__diag());
console.log(JSON.stringify(diag, null, 2));
await writeFile(join(OUT, 'console.txt'), logs.join('\n'));
console.log(logs.length ? `\n--- ${logs.length} console issues ---\n` + logs.slice(0, 25).join('\n') : '\n--- console clean ---');

await browser.close();
server.close();
