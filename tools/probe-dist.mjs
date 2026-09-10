/**
 * Boot the single-file build the way the artifact host will: one document,
 * no sibling files on the server, so anything that still reaches for
 * ./src/... or ./vendor/... shows up as a 404 rather than silently working.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const FILE = process.argv[2] || '/home/user/claude-test/dist/index.html';
const doc = await readFile(FILE);
const misses = [];
const server = createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(doc);
  } else { misses.push(req.url); res.writeHead(404); res.end('x'); }
});
await new Promise((r) => server.listen(8127, r));

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const pg = await b.newPage({ viewport: { width: 1200, height: 700 } });
const logs = [];
pg.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
pg.on('pageerror', (e) => logs.push(`[PAGEERROR] ${e.message}\n${(e.stack || '').split('\n').slice(0, 5).join('\n')}`));

await pg.goto('http://127.0.0.1:8127/', { waitUntil: 'load', timeout: 90000 });
try { await pg.waitForFunction(() => window.__ready === true, null, { timeout: 180000 }); }
catch { logs.push('[TIMEOUT] __ready never set'); }
await pg.click('#btnStart');
await pg.waitForTimeout(2000);
await pg.evaluate(() => window.__warp(2));
await pg.waitForTimeout(500);
await pg.waitForFunction(() => window.__warping() === false, null, { timeout: 120000 }).catch(() => {});
await pg.waitForTimeout(1200);
await pg.evaluate(() => document.getElementById('hud').classList.add('hidden'));
await pg.screenshot({ path: FILE.replace(/[^/]+$/, 'dist-boot.png') });
console.log('diag:', JSON.stringify(await pg.evaluate(() => window.__diag())));
console.log('404s:', misses.length ? misses.join(', ') : 'none');
console.log('console:', logs.length ? '\n' + logs.slice(0, 20).join('\n') : 'clean');
await b.close(); server.close();
if (logs.length || misses.length) process.exitCode = 1;
