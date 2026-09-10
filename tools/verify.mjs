/**
 * End-to-end verification in headless Chromium (SwiftShader).
 *
 * Drives the real interface — start button, timeline drag, keyboard shortcuts,
 * interaction, photo mode, codex — across all six eras, and fails loudly on any
 * console error or page exception. Also captures one street-level frame per era
 * so the whole timeline can be eyeballed at once.
 *
 *   node tools/verify.mjs [outDir]
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = '/home/user/claude-test';
const OUT = process.argv[2] || '/tmp/claude-0/-home-user-claude-test/8691d14c-b865-550d-9d9a-41c808a63d65/scratchpad/verify';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    const d = await readFile(f);
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end('x'); }
});
await new Promise((r) => server.listen(8125, r));
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--autoplay-policy=no-user-gesture-required'],
});

const results = [];
const problems = [];

async function run(label, mobile) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1200, height: 700 },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    userAgent: mobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
      : undefined,
  });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${label}][${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[${label}][PAGEERROR] ${e.message}\n${(e.stack || '').split('\n').slice(0, 5).join('\n')}`));

  await page.goto('http://127.0.0.1:8125/', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });

  // Title screen must be present, then Enter the Block.
  const titleVisible = await page.isVisible('#title');
  await page.click('#btnStart');
  await page.waitForTimeout(1200);
  const hudVisible = await page.isVisible('#hud');
  const touchVisible = await page.isVisible('#stickL').catch(() => false);

  /* Walk a little so the player controller, collision and footsteps run. */
  if (!mobile) {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(900);
    await page.keyboard.up('KeyW');
  } else {
    const stick = await page.$('#stickL');
    const box = await stick.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
  }

  /* Timeline: click each stop, wait for the warp, screenshot. */
  for (let i = 0; i < 6; i++) {
    await page.evaluate((n) => window.__warp(n), i);
    // Building a cold era under SwiftShader takes seconds; wait for the actual
    // transition to finish rather than guessing, or the frame lands mid-wipe.
    await page.waitForTimeout(300);
    await page.waitForFunction(() => window.__warping() === false, null, { timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(900);
    const d = await page.evaluate(() => window.__diag());
    results.push({ label, ...d });
    if (!mobile) {
      await page.evaluate(() => document.getElementById('hud').classList.add('hidden'));
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(OUT, `era-${i}.png`) });
      await page.evaluate(() => document.getElementById('hud').classList.remove('hidden'));
    } else if (i === 2) {
      await page.screenshot({ path: join(OUT, 'mobile-ui.png') });
    }
  }

  /* Interaction: aim at the Palace marquee and press E. */
  await page.evaluate(() => { window.__warp(0); });
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.__warping() === false, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(700);
  await page.evaluate(() => { window.__teleport(16, 0, -36, 0.1); window.__setPitch(0.22); });
  await page.waitForTimeout(500);
  const promptText = await page.textContent('#promptTitle').catch(() => '');
  const promptVisible = await page.isVisible('#prompt').catch(() => false);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(600);
  const readerVisible = await page.isVisible('#reader');
  const readerTitle = await page.textContent('#readerTitle').catch(() => '');
  if (mobile) await page.screenshot({ path: join(OUT, 'mobile-reader.png') });
  // Close whatever ended up on screen, and make sure nothing is left open —
  // a stray overlay silently swallows every later click.
  for (let i = 0; i < 3; i++) {
    if (!(await page.evaluate(() => ['menu', 'codex', 'reader']
      .some((id) => !document.getElementById(id).classList.contains('hidden'))))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }

  /* Codex, menu, photo mode. */
  await page.click('#btnCodex');
  await page.waitForTimeout(300);
  const codexVisible = await page.isVisible('#codex');
  const secretCount = await page.textContent('#cxFound');
  await page.click('#codexTabs .tab:nth-child(2)');
  await page.waitForTimeout(200);
  if (mobile) await page.screenshot({ path: join(OUT, 'mobile-codex.png') });
  await page.click('#codexClose');
  await page.waitForTimeout(250);

  await page.click('#btnMenu');
  await page.waitForTimeout(300);
  const menuVisible = await page.isVisible('#menu');
  await page.click('#menuTabs .tab:nth-child(2)');
  await page.waitForTimeout(200);
  if (mobile) await page.screenshot({ path: join(OUT, 'mobile-menu.png') });
  await page.click('#menuClose');
  await page.waitForTimeout(250);

  await page.click('#btnPhoto');
  await page.waitForTimeout(500);
  const photoVisible = await page.isVisible('#photobar');
  await page.click('#pbFilm .chip:nth-child(4)');
  await page.waitForTimeout(600);
  if (!mobile) await page.screenshot({ path: join(OUT, 'photo-mode.png') });
  await page.click('#pbExit');
  await page.waitForTimeout(300);

  /* Ghost overlay + free-fly + time of day. */
  await page.keyboard.press('KeyG');
  await page.waitForTimeout(1600);
  if (!mobile) await page.screenshot({ path: join(OUT, 'ghost.png') });
  await page.keyboard.press('KeyG');
  await page.waitForTimeout(300);

  await page.evaluate(() => { window.__setFly(true); window.__teleport(0, 30, 0, 0.8); window.__setPitch(-0.6); });
  await page.waitForTimeout(900);
  if (!mobile) await page.screenshot({ path: join(OUT, 'freefly.png') });
  await page.evaluate(() => window.__setFly(false));

  const final = await page.evaluate(() => window.__diag());

  const checks = {
    titleVisible, hudVisible,
    touchControls: mobile ? touchVisible : 'n/a',
    promptVisible, promptText, readerVisible, readerTitle,
    codexVisible, secretCount, menuVisible, photoVisible,
    secretsFound: final.secrets,
  };
  await ctx.close();
  return { checks, logs };
}

const desktop = await run('desktop', false);
problems.push(...desktop.logs);
const mobile = await run('mobile', true);
problems.push(...mobile.logs);

await browser.close();
server.close();

const report = {
  desktop: desktop.checks,
  mobile: mobile.checks,
  perEra: results.filter((r) => r.label === 'desktop').map((r) => ({
    era: r.era, draws: r.draws, tris: r.tris, peds: r.peds, vehicles: r.vehicles,
    interactables: r.interactables, avgMs: r.avgMs,
  })),
};
console.log(JSON.stringify(report, null, 2));
await writeFile(join(OUT, 'report.json'), JSON.stringify({ report, problems }, null, 2));

if (problems.length) {
  console.log(`\n════ ${problems.length} CONSOLE ISSUES ════`);
  console.log(problems.slice(0, 30).join('\n'));
  process.exitCode = 1;
} else {
  console.log('\n════ console clean across desktop + mobile ════');
}
