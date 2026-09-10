/**
 * Procedural texturing. Nothing here is downloaded — every pixel is drawn with
 * Canvas2D at load time.
 *
 * The economy trick: surface *detail* (brick coursing, plaster mottle, asphalt
 * grit) is generated once as a grayscale map and shared by every material that
 * needs it; the per-building colour comes from `material.color`, which
 * multiplies the map. So the whole city runs on roughly a dozen detail
 * textures plus one small unique canvas per piece of signage.
 */

import * as THREE from 'three';
import { Rand, Noise2D } from '../core/rng.js';
import { clamp01, lerp } from '../core/mathx.js';

/* ══════════════════════════ canvas plumbing ══════════════════════════ */

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: false });
  ctx.imageSmoothingEnabled = true;
  return { c, ctx };
}

let _maxAniso = 8;
export function setAnisotropy(v) { _maxAniso = v; }

/**
 * Global resolution multiplier for *unique* textures (signs, posters, shop
 * interiors, murals). Six eras of hand-lettered signage adds up fast — at full
 * size it is comfortably over a hundred megabytes of VRAM — so phones render
 * the same artwork at a fraction of the resolution. Shared detail maps (brick,
 * asphalt) are unaffected: there are only a dozen of them.
 */
let _texScale = 1;
export function setTextureScale(s) { _texScale = Math.max(0.25, Math.min(1, s)); }
export function getTextureScale() { return _texScale; }
/** Round to a multiple of 4 so canvas text stays crisp and mips stay clean. */
const TS = (v) => Math.max(16, Math.round(v * _texScale / 4) * 4);

export function toTexture(canvas, opts = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  t.anisotropy = opts.aniso ?? _maxAniso;
  t.colorSpace = opts.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.generateMipmaps = opts.mipmaps !== false;
  t.minFilter = opts.mipmaps === false ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
  t.magFilter = opts.nearest ? THREE.NearestFilter : THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Sobel a grayscale bump canvas into a tangent-space normal map. */
export function bumpToNormal(canvas, strength = 2.0) {
  const w = canvas.width, h = canvas.height;
  const src = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const { c, ctx } = makeCanvas(w, h);
  const out = ctx.createImageData(w, h);
  const at = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      out.data[i] = (nx * 0.5 + 0.5) * 255;
      out.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      out.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

/** Multiply a value-noise field over an existing canvas. */
function noiseOverlay(ctx, w, h, noise, scale, amount, mode = 'multiply', octaves = 3) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = noise.fbm(x / scale, y / scale, octaves);
      const i = (y * w + x) * 4;
      const f = mode === 'multiply' ? (1 - amount + n * amount * 2) : 1;
      const add = mode === 'add' ? (n - 0.5) * amount * 255 : 0;
      d[i] = clamp01((d[i] * f + add) / 255) * 255;
      d[i + 1] = clamp01((d[i + 1] * f + add) / 255) * 255;
      d[i + 2] = clamp01((d[i + 2] * f + add) / 255) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Vertical grime: rain-driven streaks below ledges. */
function grimeStreaks(ctx, w, h, rnd, amount, colour = 'rgba(20,16,12,') {
  const n = Math.round(28 * amount);
  for (let i = 0; i < n; i++) {
    const x = rnd.range(0, w);
    const wdt = rnd.range(1, 9);
    const top = rnd.range(0, h * 0.5);
    const len = rnd.range(h * 0.15, h * 0.9);
    const g = ctx.createLinearGradient(0, top, 0, top + len);
    const a = rnd.range(0.05, 0.24) * amount;
    g.addColorStop(0, colour + a.toFixed(3) + ')');
    g.addColorStop(0.6, colour + (a * 0.5).toFixed(3) + ')');
    g.addColorStop(1, colour + '0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, top, wdt, len);
  }
}

/* ══════════════════════════ detail maps ══════════════════════════ */

const cache = new Map();
const memo = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };

const S = 512;   // detail map resolution

/** Brick coursing. Grayscale — tinted per building by material.color. */
function brickCanvas() {
  const { c, ctx } = makeCanvas(S, S);
  const rnd = new Rand('brick');
  const noise = new Noise2D('brick-n');

  ctx.fillStyle = '#b4b4b4'; ctx.fillRect(0, 0, S, S);       // mortar

  const rows = 22;
  const bh = S / rows;
  const bw = S / 5.5;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * bw * 0.5;
    for (let x = -bw; x < S + bw; x += bw) {
      const px = x + offset + 1.2, py = r * bh + 1.2;
      const pw = bw - 2.4, ph = bh - 2.4;
      // Per-brick value jitter is what stops brick reading as wallpaper.
      const v = 0.78 + rnd.range(-0.16, 0.2);
      const g = Math.round(clamp01(v) * 255);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(px, py, pw, ph);
      // chipped corner
      if (rnd.chance(0.06)) {
        ctx.fillStyle = 'rgba(120,120,120,0.9)';
        const s = rnd.range(2, 5);
        ctx.fillRect(px + (rnd.chance(0.5) ? 0 : pw - s), py + (rnd.chance(0.5) ? 0 : ph - s), s, s);
      }
      // soot along the top edge (bricks catch dirt on the upper arris)
      ctx.fillStyle = 'rgba(90,90,90,0.16)';
      ctx.fillRect(px, py, pw, 1.6);
    }
  }
  noiseOverlay(ctx, S, S, noise, 26, 0.14, 'multiply', 3);
  noiseOverlay(ctx, S, S, noise, 4, 0.06, 'add', 2);
  return c;
}

function brickBumpCanvas() {
  const { c, ctx } = makeCanvas(S, S);
  const rnd = new Rand('brick');   // same stream ⇒ same jitter as the albedo
  ctx.fillStyle = '#2a2a2a'; ctx.fillRect(0, 0, S, S);
  const rows = 22, bh = S / rows, bw = S / 5.5;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * bw * 0.5;
    for (let x = -bw; x < S + bw; x += bw) {
      const px = x + offset + 1.2, py = r * bh + 1.2;
      const pw = bw - 2.4, ph = bh - 2.4;
      const v = 0.78 + rnd.range(-0.16, 0.2);
      const g = Math.round(clamp01(v * 0.4 + 0.6) * 255);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(px, py, pw, ph);
      if (rnd.chance(0.06)) { ctx.fillStyle = '#606060'; const s = rnd.range(2, 5);
        ctx.fillRect(px + (rnd.chance(0.5) ? 0 : pw - s), py + (rnd.chance(0.5) ? 0 : ph - s), s, s); }
      ctx.fillStyle = 'rgba(0,0,0,0.1)'; ctx.fillRect(px, py, pw, 1.6);
    }
  }
  return c;
}

function stuccoCanvas() {
  const { c, ctx } = makeCanvas(S, S);
  const noise = new Noise2D('stucco');
  ctx.fillStyle = '#e2e2e2'; ctx.fillRect(0, 0, S, S);
  noiseOverlay(ctx, S, S, noise, 3.2, 0.16, 'add', 4);
  noiseOverlay(ctx, S, S, noise, 42, 0.1, 'multiply', 3);
  const rnd = new Rand('stucco-crack');
  // Hairline cracks radiating from random seeds
  ctx.strokeStyle = 'rgba(60,60,60,0.32)';
  for (let i = 0; i < 12; i++) {
    ctx.lineWidth = rnd.range(0.6, 1.6);
    let x = rnd.range(0, S), y = rnd.range(0, S);
    let a = rnd.range(0, Math.PI * 2);
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 24; s++) {
      a += rnd.range(-0.5, 0.5);
      x += Math.cos(a) * rnd.range(3, 11);
      y += Math.sin(a) * rnd.range(3, 11);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return c;
}

function concreteCanvas() {
  const { c, ctx } = makeCanvas(S, S);
  const noise = new Noise2D('concrete');
  const rnd = new Rand('concrete');
  ctx.fillStyle = '#e0e0e0'; ctx.fillRect(0, 0, S, S);
  noiseOverlay(ctx, S, S, noise, 5, 0.11, 'add', 4);
  noiseOverlay(ctx, S, S, noise, 60, 0.12, 'multiply', 2);

  // Control joints — sidewalk slabs, one grid per texture tile.
  ctx.strokeStyle = 'rgba(70,70,70,0.55)';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(0, S / 2); ctx.lineTo(S, S / 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(S / 2, 0); ctx.lineTo(S / 2, S); ctx.stroke();
  ctx.strokeStyle = 'rgba(220,220,220,0.3)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, S / 2 + 2); ctx.lineTo(S, S / 2 + 2); ctx.stroke();

  // Aggregate speckle + the inevitable chewing gum.
  for (let i = 0; i < 2600; i++) {
    const g = rnd.int(120, 190);
    ctx.fillStyle = `rgba(${g},${g},${g},${rnd.range(0.1, 0.4)})`;
    ctx.fillRect(rnd.range(0, S), rnd.range(0, S), rnd.range(0.6, 2.2), rnd.range(0.6, 2.2));
  }
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = `rgba(${rnd.int(70, 110)},${rnd.int(70, 105)},${rnd.int(65, 100)},0.7)`;
    ctx.beginPath();
    ctx.ellipse(rnd.range(0, S), rnd.range(0, S), rnd.range(1.5, 4), rnd.range(1.5, 4), rnd.range(0, 3), 0, 7);
    ctx.fill();
  }
  return c;
}

function asphaltCanvas() {
  const { c, ctx } = makeCanvas(S, S);
  const noise = new Noise2D('asphalt');
  const rnd = new Rand('asphalt');
  ctx.fillStyle = '#dadada'; ctx.fillRect(0, 0, S, S);
  noiseOverlay(ctx, S, S, noise, 2.2, 0.18, 'add', 5);
  // Aggregate
  for (let i = 0; i < 9000; i++) {
    const g = rnd.int(90, 175);
    ctx.fillStyle = `rgba(${g},${g},${g},${rnd.range(0.14, 0.5)})`;
    ctx.fillRect(rnd.range(0, S), rnd.range(0, S), rnd.range(0.7, 2.6), rnd.range(0.7, 2.6));
  }
  // Crack network + tar-sealed repairs (the repairs are darker and glossier)
  ctx.strokeStyle = 'rgba(118,118,118,0.42)';
  for (let i = 0; i < 16; i++) {
    ctx.lineWidth = rnd.range(0.8, 2.2);
    let x = rnd.range(0, S), y = rnd.range(0, S), a = rnd.range(0, 7);
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 18; s++) {
      a += rnd.range(-0.7, 0.7);
      x += Math.cos(a) * rnd.range(6, 20); y += Math.sin(a) * rnd.range(6, 20);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(150,150,150,0.55)';
  for (let i = 0; i < 8; i++) {
    ctx.lineWidth = rnd.range(4, 10);
    ctx.lineCap = 'round';
    let x = rnd.range(0, S), y = rnd.range(0, S), a = rnd.range(0, 7);
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      a += rnd.range(-0.9, 0.9);
      x += Math.cos(a) * rnd.range(14, 40); y += Math.sin(a) * rnd.range(14, 40);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return c;
}

function limestoneCanvas() {
  const { c, ctx } = makeCanvas(S, S);
  const noise = new Noise2D('limestone');
  const rnd = new Rand('limestone');
  ctx.fillStyle = '#e4e4e4'; ctx.fillRect(0, 0, S, S);
  // Ashlar coursing — big, regular blocks
  const rows = 8, bh = S / rows, bw = S / 3;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * bw * 0.5;
    for (let x = -bw; x < S + bw; x += bw) {
      const v = 0.9 + rnd.range(-0.06, 0.06);
      const g = Math.round(clamp01(v) * 255);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(x + off + 1, r * bh + 1, bw - 2, bh - 2);
    }
  }
  noiseOverlay(ctx, S, S, noise, 34, 0.1, 'multiply', 3);
  noiseOverlay(ctx, S, S, noise, 6, 0.07, 'add', 3);
  grimeStreaks(ctx, S, S, rnd, 0.5);
  return c;
}

function panelCanvas() {
  // Porcelain-enamel / aluminium composite: flat with faint fastener grid.
  const { c, ctx } = makeCanvas(S, S);
  const noise = new Noise2D('panel');
  ctx.fillStyle = '#e4e4e4'; ctx.fillRect(0, 0, S, S);
  const step = S / 4;
  ctx.strokeStyle = 'rgba(110,110,110,0.5)'; ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(S, i * step); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(90,90,90,0.55)';
  for (let y = 0; y <= 4; y++) for (let x = 0; x <= 4; x++) {
    ctx.beginPath(); ctx.arc(x * step, y * step, 2.4, 0, 7); ctx.fill();
  }
  noiseOverlay(ctx, S, S, noise, 60, 0.06, 'multiply', 2);
  return c;
}

function woodCanvas() {
  const { c, ctx } = makeCanvas(S, S);
  const noise = new Noise2D('wood');
  const rnd = new Rand('wood');
  ctx.fillStyle = '#d8d0c4'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 240; i++) {
    const y = rnd.range(0, S);
    const g = rnd.int(120, 200);
    ctx.strokeStyle = `rgba(${g},${g - 12},${g - 30},${rnd.range(0.06, 0.24)})`;
    ctx.lineWidth = rnd.range(0.6, 3.2);
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= S; x += 24) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * rnd.range(0.5, 3));
    ctx.stroke();
  }
  // Board seams
  ctx.strokeStyle = 'rgba(60,50,40,0.45)'; ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, i * S / 4); ctx.lineTo(S, i * S / 4); ctx.stroke(); }
  noiseOverlay(ctx, S, S, noise, 22, 0.1, 'multiply', 3);
  return c;
}

function metalCanvas() {
  const { c, ctx } = makeCanvas(S, S);
  const rnd = new Rand('metal');
  const noise = new Noise2D('metal');
  ctx.fillStyle = '#cfcfcf'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 1400; i++) {
    const y = rnd.range(0, S);
    ctx.strokeStyle = `rgba(255,255,255,${rnd.range(0.02, 0.09)})`;
    ctx.lineWidth = rnd.range(0.4, 1.4);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y + rnd.range(-2, 2)); ctx.stroke();
  }
  noiseOverlay(ctx, S, S, noise, 70, 0.07, 'multiply', 2);
  return c;
}

function rustCanvas() {
  const { c, ctx } = makeCanvas(256, 256);
  const noise = new Noise2D('rust');
  const img = ctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const n = noise.fbm(x / 22, y / 22, 4);
    const m = noise.fbm(x / 6 + 40, y / 6, 3);
    const a = clamp01((n * 1.4 - 0.5) * 2) * clamp01(m * 1.4);
    const i = (y * 256 + x) * 4;
    img.data[i] = 150 + m * 70; img.data[i + 1] = 70 + m * 50; img.data[i + 2] = 34 + m * 26;
    img.data[i + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function grimeCanvas() {
  const { c, ctx } = makeCanvas(256, 256);
  ctx.clearRect(0, 0, 256, 256);
  const rnd = new Rand('grime');
  grimeStreaks(ctx, 256, 256, rnd, 1.0, 'rgba(24,20,16,');
  const noise = new Noise2D('grime-n');
  const img = ctx.getImageData(0, 0, 256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4;
    const n = noise.fbm(x / 30, y / 30, 3);
    img.data[i + 3] = Math.min(255, img.data[i + 3] + clamp01(n - 0.45) * 220);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* ══════════════════════════ public detail API ══════════════════════════ */

export const Tex = {
  brick: () => memo('brick', () => toTexture(brickCanvas(), { repeat: [1, 1] })),
  brickNormal: () => memo('brickN', () => toTexture(bumpToNormal(brickBumpCanvas(), 2.2), { data: true })),
  stucco: () => memo('stucco', () => toTexture(stuccoCanvas())),
  stuccoNormal: () => memo('stuccoN', () => toTexture(bumpToNormal(stuccoCanvas(), 1.1), { data: true })),
  concrete: () => memo('conc', () => toTexture(concreteCanvas())),
  concreteNormal: () => memo('concN', () => toTexture(bumpToNormal(concreteCanvas(), 0.9), { data: true })),
  asphalt: () => memo('asph', () => toTexture(asphaltCanvas())),
  asphaltNormal: () => memo('asphN', () => toTexture(bumpToNormal(asphaltCanvas(), 1.4), { data: true })),
  limestone: () => memo('lime', () => toTexture(limestoneCanvas())),
  limestoneNormal: () => memo('limeN', () => toTexture(bumpToNormal(limestoneCanvas(), 1.3), { data: true })),
  panel: () => memo('panel', () => toTexture(panelCanvas())),
  panelNormal: () => memo('panelN', () => toTexture(bumpToNormal(panelCanvas(), 1.6), { data: true })),
  wood: () => memo('wood', () => toTexture(woodCanvas())),
  metal: () => memo('metal', () => toTexture(metalCanvas())),
  rust: () => memo('rust', () => toTexture(rustCanvas(), { clamp: true })),
  grime: () => memo('grime', () => toTexture(grimeCanvas(), { clamp: true })),
};

/* ══════════════════════════ typography ══════════════════════════ */

const FONTS = {
  serif: 'Georgia, "Times New Roman", "Liberation Serif", serif',
  slab: '"Rockwell", Georgia, "Liberation Serif", serif',
  condensed: '"Arial Narrow", "Helvetica Neue Condensed", Impact, sans-serif',
  impact: 'Impact, "Arial Black", "Helvetica Neue", sans-serif',
  sans: '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif',
  grotesk: '"Inter", "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  script: '"Snell Roundhand", "Brush Script MT", cursive',
};

/** Fit text to a width by shrinking the font until it measures under it. */
function fitText(ctx, text, font, maxW, startPx, minPx = 8) {
  let px = startPx;
  do {
    ctx.font = `${px}px ${font}`;
    if (ctx.measureText(text).width <= maxW) break;
    px -= 1;
  } while (px > minPx);
  return px;
}

function tracked(ctx, text, x, y, spacing, align = 'center') {
  let total = 0;
  for (const ch of text) total += ctx.measureText(ch).width + spacing;
  total -= spacing;
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
  return total;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function glowText(ctx, text, x, y, color, blur, passes = 3) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.fillStyle = color;
  for (let i = passes; i > 0; i--) {
    ctx.shadowBlur = blur * i / passes * 2;
    ctx.fillText(text, x, y);
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.85;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/* ══════════════════════════ signage generators ══════════════════════════ */

const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);

/**
 * The main storefront fascia sign. `style` selects an era vocabulary:
 * goldleaf (1945), painted (1945), plastic (1965), googie (1965),
 * neonBox / handpainted (1985), ledScroll / plasticLit / vinylBanner (2005),
 * minimal / led (2025), eInk / holo (2055).
 */
export function signTexture(opts) {
  const {
    text = 'SHOP', sub = '', style = 'painted',
    fg = 0xffffff, bg = 0x202020, accent = 0xd8b04a,
    w = 1024, h = 256, condition = 0.2, seed = text,
  } = opts;

  const { c, ctx } = makeCanvas(TS(w), TS(h));
  const sx = TS(w) / w, sy = TS(h) / h;
  ctx.scale(sx, sy);
  const rnd = new Rand('sign:' + seed);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const cy = sub ? h * 0.42 : h * 0.5;

  const paintBg = (fill) => { ctx.fillStyle = fill; ctx.fillRect(0, 0, w, h); };
  const wear = () => {
    if (condition <= 0.02) return;
    ctx.globalAlpha = Math.min(0.8, condition * 0.85);
    ctx.drawImage(grimeCanvas(), 0, 0, w, h);
    ctx.globalAlpha = 1;
    // Flaked paint
    const n = Math.round(condition * 90);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = `rgba(${rnd.int(30, 70)},${rnd.int(28, 64)},${rnd.int(24, 58)},${rnd.range(0.1, 0.5)})`;
      ctx.beginPath();
      ctx.ellipse(rnd.range(0, w), rnd.range(0, h), rnd.range(2, 14), rnd.range(2, 9), rnd.range(0, 3), 0, 7);
      ctx.fill();
    }
  };

  switch (style) {
    case 'goldleaf': {
      // Gold leaf on glass: dark ground, ornate serif, thin drop shadow.
      paintBg('rgba(12,10,8,0.94)');
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(0, 0, w, 6); ctx.fillRect(0, h - 6, w, 6);
      const px = fitText(ctx, text, FONTS.serif, w * 0.86, h * 0.42);
      ctx.font = `${px}px ${FONTS.serif}`;
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillText(text, w / 2 + 3, cy + 3);
      const g = ctx.createLinearGradient(0, cy - px / 2, 0, cy + px / 2);
      g.addColorStop(0, '#f8e39a'); g.addColorStop(0.42, hex(accent));
      g.addColorStop(0.55, '#fff4c8'); g.addColorStop(1, '#a87824');
      ctx.fillStyle = g;
      ctx.fillText(text, w / 2, cy);
      ctx.strokeStyle = 'rgba(60,40,10,0.7)'; ctx.lineWidth = 1.4;
      ctx.strokeText(text, w / 2, cy);
      if (sub) {
        ctx.font = `${Math.round(px * 0.26)}px ${FONTS.serif}`;
        ctx.fillStyle = '#e8d8a8';
        tracked(ctx, sub, w / 2, h * 0.78, px * 0.05);
      }
      break;
    }
    case 'painted': {
      paintBg(hex(bg));
      // Hand-painted board: slight baseline wobble and a keyline border.
      ctx.strokeStyle = hex(accent); ctx.lineWidth = 6;
      ctx.strokeRect(10, 10, w - 20, h - 20);
      ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 2;
      ctx.strokeRect(20, 20, w - 40, h - 40);
      const px = fitText(ctx, text, FONTS.slab, w * 0.82, h * 0.44);
      ctx.font = `${px}px ${FONTS.slab}`;
      ctx.save();
      ctx.translate(w / 2, cy);
      ctx.rotate(rnd.range(-0.006, 0.006));
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillText(text, 3, 4);
      ctx.fillStyle = hex(fg); ctx.fillText(text, 0, 0);
      ctx.restore();
      if (sub) {
        ctx.font = `${Math.round(px * 0.24)}px ${FONTS.sans}`;
        ctx.fillStyle = hex(accent);
        tracked(ctx, sub, w / 2, h * 0.79, px * 0.045);
      }
      break;
    }
    case 'plastic': {
      // Backlit acrylic box: even glow, hard-edged sans, colour bar.
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#f2f2ee'); g.addColorStop(1, '#dcdcd4');
      paintBg(g);
      ctx.fillStyle = hex(accent); ctx.fillRect(0, h - 22, w, 22);
      ctx.fillStyle = hex(accent); ctx.fillRect(0, 0, w, 10);
      const px = fitText(ctx, text, FONTS.impact, w * 0.86, h * 0.52);
      ctx.font = `${px}px ${FONTS.impact}`;
      ctx.fillStyle = hex(fg);
      ctx.fillText(text, w / 2, cy);
      if (sub) {
        ctx.font = `${Math.round(px * 0.2)}px ${FONTS.sans}`;
        ctx.fillStyle = '#3a3a3a';
        tracked(ctx, sub, w / 2, h * 0.8, px * 0.03);
      }
      break;
    }
    case 'googie': {
      // Angled parallelogram plate, starbursts, atomic optimism.
      paintBg('rgba(0,0,0,0)');
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(w * 0.04, h * 0.1); ctx.lineTo(w * 0.98, h * 0.02);
      ctx.lineTo(w * 0.94, h * 0.94); ctx.lineTo(w * 0.02, h * 0.86);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, hex(bg)); g.addColorStop(1, '#1a1a22');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = hex(accent); ctx.lineWidth = 7; ctx.stroke();
      ctx.clip();
      const px = fitText(ctx, text, FONTS.impact, w * 0.74, h * 0.5);
      ctx.font = `${px}px ${FONTS.impact}`;
      ctx.save();
      ctx.translate(w / 2, cy); ctx.transform(1, -0.055, -0.12, 1, 0, 0);
      glowText(ctx, text, 0, 0, hex(fg), 22, 3);
      ctx.restore();
      // starbursts
      for (let i = 0; i < 3; i++) {
        const sx = rnd.range(w * 0.1, w * 0.9), sy = rnd.range(h * 0.15, h * 0.85), r = rnd.range(10, 22);
        ctx.strokeStyle = hex(accent); ctx.lineWidth = 2.5;
        for (let a = 0; a < 4; a++) {
          const ang = a * Math.PI / 4;
          ctx.beginPath();
          ctx.moveTo(sx - Math.cos(ang) * r, sy - Math.sin(ang) * r);
          ctx.lineTo(sx + Math.cos(ang) * r, sy + Math.sin(ang) * r);
          ctx.stroke();
        }
      }
      ctx.restore();
      if (sub) {
        ctx.font = `${Math.round(h * 0.1)}px ${FONTS.sans}`;
        ctx.fillStyle = hex(accent);
        tracked(ctx, sub, w / 2, h * 0.93, 2);
      }
      break;
    }
    case 'neonBox': {
      paintBg('#0a0a10');
      ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 4;
      ctx.strokeRect(8, 8, w - 16, h - 16);
      const px = fitText(ctx, text, FONTS.impact, w * 0.84, h * 0.55);
      ctx.font = `${px}px ${FONTS.impact}`;
      glowText(ctx, text, w / 2, cy, hex(fg), 30, 4);
      if (sub) {
        ctx.font = `${Math.round(px * 0.22)}px ${FONTS.sans}`;
        glowText(ctx, sub, w / 2, h * 0.82, hex(accent), 14, 2);
      }
      break;
    }
    case 'handpainted': {
      paintBg(hex(bg));
      ctx.save();
      const px = fitText(ctx, text, FONTS.impact, w * 0.8, h * 0.5);
      ctx.font = `${px}px ${FONTS.impact}`;
      ctx.translate(w / 2, cy); ctx.rotate(rnd.range(-0.02, 0.02));
      ctx.lineWidth = px * 0.1; ctx.strokeStyle = '#0a0a10';
      ctx.strokeText(text, 0, 0);
      ctx.fillStyle = hex(fg); ctx.fillText(text, 0, 0);
      ctx.restore();
      if (sub) {
        ctx.font = `${Math.round(px * 0.2)}px ${FONTS.impact}`;
        ctx.fillStyle = hex(accent);
        tracked(ctx, sub, w / 2, h * 0.82, 1);
      }
      break;
    }
    case 'plasticLit': {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, hex(bg)); g.addColorStop(1, '#101014');
      paintBg(g);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 5;
      ctx.strokeRect(6, 6, w - 12, h - 12);
      const px = fitText(ctx, text, FONTS.impact, w * 0.86, h * 0.5);
      ctx.font = `${px}px ${FONTS.impact}`;
      glowText(ctx, text, w / 2, cy, hex(fg), 16, 2);
      if (sub) {
        ctx.font = `${Math.round(px * 0.2)}px ${FONTS.sans}`;
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        tracked(ctx, sub, w / 2, h * 0.81, 1.5);
      }
      break;
    }
    case 'vinylBanner': {
      paintBg(hex(bg));
      // Grommets + a sag along the top edge
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(w * (0.08 + i * 0.168), 18, 7, 0, 7); ctx.fill(); }
      const px = fitText(ctx, text, FONTS.impact, w * 0.86, h * 0.44);
      ctx.font = `${px}px ${FONTS.impact}`;
      ctx.fillStyle = hex(fg);
      ctx.fillText(text, w / 2, cy + 6);
      if (sub) {
        ctx.font = `${Math.round(px * 0.24)}px ${FONTS.sans}`;
        ctx.fillStyle = hex(accent);
        tracked(ctx, sub, w / 2, h * 0.82, 1.2);
      }
      break;
    }
    case 'ledScroll': {
      paintBg('#050508');
      // Dot-matrix grid; the sign module animates the offset.
      const dot = 6, gap = 2;
      const cols = Math.floor(w / (dot + gap)), rows = Math.floor(h / (dot + gap));
      ctx.font = `${Math.floor(rows * 0.62) * (dot + gap)}px ${FONTS.impact}`;
      const off = makeCanvas(w, h);
      off.ctx.fillStyle = '#fff';
      off.ctx.textAlign = 'center'; off.ctx.textBaseline = 'middle';
      off.ctx.font = ctx.font;
      off.ctx.fillText(text, w / 2, h / 2);
      const src = off.ctx.getImageData(0, 0, w, h).data;
      for (let r = 0; r < rows; r++) for (let cIdx = 0; cIdx < cols; cIdx++) {
        const px = cIdx * (dot + gap) + dot / 2, py = r * (dot + gap) + dot / 2;
        const on = src[((py | 0) * w + (px | 0)) * 4 + 3] > 100;
        ctx.fillStyle = on ? hex(fg) : 'rgba(255,255,255,0.035)';
        if (on) { ctx.shadowColor = hex(fg); ctx.shadowBlur = 8; }
        ctx.beginPath(); ctx.arc(px, py, dot / 2, 0, 7); ctx.fill();
        ctx.shadowBlur = 0;
      }
      break;
    }
    case 'minimal': {
      paintBg(hex(bg));
      const px = fitText(ctx, text, FONTS.grotesk, w * 0.72, h * 0.32);
      ctx.font = `600 ${px}px ${FONTS.grotesk}`;
      ctx.fillStyle = hex(fg);
      tracked(ctx, text, w / 2, cy, px * 0.14);
      if (sub) {
        ctx.font = `400 ${Math.round(px * 0.28)}px ${FONTS.grotesk}`;
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        tracked(ctx, sub, w / 2, h * 0.8, px * 0.07);
      }
      break;
    }
    case 'led': {
      paintBg('#07090c');
      const px = fitText(ctx, text, FONTS.grotesk, w * 0.78, h * 0.4);
      ctx.font = `700 ${px}px ${FONTS.grotesk}`;
      glowText(ctx, text, w / 2, cy, hex(fg), 24, 3);
      if (sub) {
        ctx.font = `400 ${Math.round(px * 0.22)}px ${FONTS.grotesk}`;
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        tracked(ctx, sub, w / 2, h * 0.82, 2);
      }
      break;
    }
    case 'eInk': {
      paintBg('#dcdcd2');
      ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(0, 0, w, h);
      const px = fitText(ctx, text, FONTS.grotesk, w * 0.8, h * 0.34);
      ctx.font = `600 ${px}px ${FONTS.grotesk}`;
      ctx.fillStyle = '#161a18';
      tracked(ctx, text, w / 2, cy, px * 0.1);
      ctx.strokeStyle = 'rgba(20,24,22,0.35)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(w * 0.2, h * 0.62); ctx.lineTo(w * 0.8, h * 0.62); ctx.stroke();
      if (sub) {
        ctx.font = `400 ${Math.round(px * 0.26)}px ${FONTS.mono}`;
        ctx.fillStyle = 'rgba(20,26,24,0.72)';
        tracked(ctx, sub, w / 2, h * 0.8, 1.5);
      }
      break;
    }
    case 'holo': {
      paintBg('rgba(0,0,0,0)');
      const px = fitText(ctx, text, FONTS.grotesk, w * 0.8, h * 0.42);
      ctx.font = `300 ${px}px ${FONTS.grotesk}`;
      // Spectral separation: three offset passes.
      ctx.globalCompositeOperation = 'lighter';
      const cols = ['#ff3ec8', '#3ee0ff', '#9fe870'];
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.shadowColor = cols[i]; ctx.shadowBlur = 26;
        ctx.fillStyle = cols[i];
        ctx.globalAlpha = 0.55;
        tracked(ctx, text, w / 2 + (i - 1) * 4, cy + (i - 1) * 1.5, px * 0.12);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 14;
      tracked(ctx, text, w / 2, cy, px * 0.12);
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = 'source-over';
      // Scanlines
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1.6);
      if (sub) {
        ctx.font = `300 ${Math.round(px * 0.24)}px ${FONTS.mono}`;
        ctx.fillStyle = 'rgba(160,240,255,0.8)';
        tracked(ctx, sub, w / 2, h * 0.83, 2);
      }
      break;
    }
    case 'corporate': {
      paintBg(hex(bg));
      const px = fitText(ctx, text, FONTS.serif, w * 0.8, h * 0.38);
      ctx.font = `${px}px ${FONTS.serif}`;
      ctx.fillStyle = hex(fg);
      tracked(ctx, text, w / 2, cy, px * 0.06);
      ctx.strokeStyle = hex(accent); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(w * 0.3, h * 0.68); ctx.lineTo(w * 0.7, h * 0.68); ctx.stroke();
      if (sub) {
        ctx.font = `${Math.round(px * 0.24)}px ${FONTS.sans}`;
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        tracked(ctx, sub, w / 2, h * 0.83, 1.5);
      }
      break;
    }
    case 'carved': {
      // Incised limestone lettering: bevelled highlight above, shadow below.
      paintBg('rgba(0,0,0,0)');
      const px = fitText(ctx, text, FONTS.serif, w * 0.88, h * 0.46);
      ctx.font = `${px}px ${FONTS.serif}`;
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      tracked(ctx, text, w / 2 + 2, cy + 2.5, px * 0.09);
      ctx.fillStyle = 'rgba(30,26,20,0.72)';
      tracked(ctx, text, w / 2 - 1.5, cy - 1.5, px * 0.09);
      ctx.fillStyle = 'rgba(120,112,96,0.5)';
      tracked(ctx, text, w / 2, cy, px * 0.09);
      break;
    }
    case 'aluminium': {
      paintBg('rgba(0,0,0,0)');
      const px = fitText(ctx, text, FONTS.sans, w * 0.86, h * 0.44);
      ctx.font = `${px}px ${FONTS.sans}`;
      const g = ctx.createLinearGradient(0, cy - px / 2, 0, cy + px / 2);
      g.addColorStop(0, '#f4f6f8'); g.addColorStop(0.5, '#9aa2aa'); g.addColorStop(1, '#e0e4e8');
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      tracked(ctx, text, w / 2 + 3, cy + 4, px * 0.08);
      ctx.fillStyle = g;
      tracked(ctx, text, w / 2, cy, px * 0.08);
      if (sub) {
        ctx.font = `${Math.round(px * 0.24)}px ${FONTS.sans}`;
        ctx.fillStyle = 'rgba(220,228,236,0.8)';
        tracked(ctx, sub, w / 2, h * 0.83, 1.5);
      }
      break;
    }
    case 'developer': {
      paintBg('#f2f0ea');
      ctx.fillStyle = hex(bg); ctx.fillRect(0, 0, w, h * 0.34);
      const px = fitText(ctx, text, FONTS.serif, w * 0.8, h * 0.22);
      ctx.font = `${px}px ${FONTS.serif}`;
      ctx.fillStyle = '#ffffff';
      tracked(ctx, text, w / 2, h * 0.17, px * 0.1);
      ctx.font = `${Math.round(px * 0.62)}px ${FONTS.sans}`;
      ctx.fillStyle = '#2a3038';
      ctx.fillText(sub || 'NOW LEASING', w / 2, h * 0.58);
      ctx.font = `${Math.round(px * 0.4)}px ${FONTS.sans}`;
      ctx.fillStyle = '#6a7280';
      ctx.fillText('MODEL UNIT OPEN DAILY 11–6', w / 2, h * 0.82);
      break;
    }
    case 'forLease': {
      paintBg('#ffffff');
      ctx.strokeStyle = hex(fg); ctx.lineWidth = 10; ctx.strokeRect(12, 12, w - 24, h - 24);
      const px = fitText(ctx, 'FOR LEASE', FONTS.impact, w * 0.78, h * 0.42);
      ctx.font = `${px}px ${FONTS.impact}`;
      ctx.fillStyle = hex(fg);
      ctx.fillText('FOR LEASE', w / 2, h * 0.4);
      ctx.font = `${Math.round(px * 0.26)}px ${FONTS.sans}`;
      ctx.fillStyle = '#2a2a2e';
      ctx.fillText(sub || '', w / 2, h * 0.72);
      ctx.fillText('(555) 0142', w / 2, h * 0.88);
      break;
    }
    default: {
      paintBg(hex(bg));
      const px = fitText(ctx, text, FONTS.sans, w * 0.85, h * 0.45);
      ctx.font = `${px}px ${FONTS.sans}`;
      ctx.fillStyle = hex(fg);
      ctx.fillText(text, w / 2, cy);
    }
  }

  wear();
  return c;
}

/** A painted brick "ghost sign" — a wall advert fading back into the mortar. */
export function ghostSignTexture(text, opts = {}) {
  const { w = 512, h = 512, fade = 0.5, color = 0xd8d0c0, seed = text } = opts;
  const { c, ctx } = makeCanvas(TS(w), TS(h));
  ctx.scale(TS(w) / w, TS(h) / h);
  const rnd = new Rand('ghost:' + seed);
  const words = text.split(/\s+/);
  const lines = [];
  let line = [];
  for (const word of words) {
    line.push(word);
    if (line.join(' ').length > 11) { lines.push(line.join(' ')); line = []; }
  }
  if (line.length) lines.push(line.join(' '));

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lh = h / (lines.length + 1.2);
  lines.forEach((ln, i) => {
    const px = fitText(ctx, ln, FONTS.impact, w * 0.88, lh * 0.86);
    ctx.font = `${px}px ${FONTS.impact}`;
    ctx.fillStyle = hex(color);
    ctx.globalAlpha = (1 - fade) * rnd.range(0.72, 1.0);
    tracked(ctx, ln, w / 2, lh * (i + 0.9), px * 0.05);
  });
  ctx.globalAlpha = 1;

  // Erode: punch out mortar lines and random flakes so the paint sits *in* the
  // brick rather than on top of it.
  ctx.globalCompositeOperation = 'destination-out';
  const rows = 22, bh = h / rows, bw = w / 5.5;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  for (let r = 0; r <= rows; r++) ctx.fillRect(0, r * bh - 1.2, w, 2.4);
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * bw * 0.5;
    for (let x = -bw; x < w + bw; x += bw) ctx.fillRect(x + off - 1.2, r * bh, 2.4, bh);
  }
  // Pixel work must use the real backing-store size, not the pre-scale
  // dimensions the drawing above was authored in.
  const pw = c.width, ph = c.height, k = pw / w;
  const noise = new Noise2D('ghost-erode:' + seed);
  const img = ctx.getImageData(0, 0, pw, ph);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const n = noise.fbm(x / (18 * k), y / (18 * k), 4);
    const i = (y * pw + x) * 4;
    if (n < 0.3 + fade * 0.42) img.data[i + 3] = Math.max(0, img.data[i + 3] - (0.3 + fade * 0.42 - n) * 900);
  }
  ctx.putImageData(img, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

/** Spray-can graffiti: a tag, a fill, an outline and some overspray. */
export function graffitiTexture(tag = 'KAI', opts = {}) {
  const { w = 512, h = 256, colors = [0xff2d95, 0x00e5ff, 0xffe500], seed = tag } = opts;
  const { c, ctx } = makeCanvas(TS(w), TS(h));
  ctx.scale(TS(w) / w, TS(h) / h);
  const rnd = new Rand('graf:' + seed);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  const px = fitText(ctx, tag, FONTS.impact, w * 0.8, h * 0.66);
  ctx.font = `${px}px ${FONTS.impact}`;

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(rnd.range(-0.09, 0.09));
  ctx.transform(1, 0, -0.22, 1, 0, 0);

  // overspray halo
  ctx.shadowColor = hex(rnd.pick(colors)); ctx.shadowBlur = 34;
  ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillText(tag, 0, 0);

  ctx.lineWidth = px * 0.15; ctx.strokeStyle = '#0a0a10';
  ctx.shadowBlur = 0;
  ctx.strokeText(tag, 0, 0);
  const g = ctx.createLinearGradient(0, -px / 2, 0, px / 2);
  g.addColorStop(0, hex(colors[0])); g.addColorStop(1, hex(colors[1] ?? colors[0]));
  ctx.fillStyle = g;
  ctx.fillText(tag, 0, 0);
  ctx.lineWidth = px * 0.04; ctx.strokeStyle = hex(colors[2] ?? 0xffffff);
  ctx.strokeText(tag, 0, 0);
  ctx.restore();

  // drips
  for (let i = 0; i < 9; i++) {
    const x = rnd.range(w * 0.18, w * 0.82);
    const y = rnd.range(h * 0.5, h * 0.72);
    ctx.fillStyle = hex(rnd.pick(colors));
    ctx.globalAlpha = rnd.range(0.5, 0.9);
    ctx.fillRect(x, y, rnd.range(1.5, 4), rnd.range(8, 46));
    ctx.beginPath(); ctx.arc(x + 1.5, y + rnd.range(10, 48), rnd.range(2, 4), 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // speckle overspray
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = hex(rnd.pick(colors));
    ctx.globalAlpha = rnd.range(0.03, 0.18);
    ctx.fillRect(rnd.range(0, w), rnd.range(0, h), rnd.range(0.6, 2), rnd.range(0.6, 2));
  }
  ctx.globalAlpha = 1;
  return c;
}

/** Poster / flyer sheets pasted onto a hoarding. */
export function posterTexture(lines, opts = {}) {
  const { w = 384, h = 512, bg = 0xf0e8d8, fg = 0x1a1a1e, accent = 0xd83a2a, tone = 'letterpress', seed = String(lines) } = opts;
  const { c, ctx } = makeCanvas(TS(w), TS(h));
  ctx.scale(TS(w) / w, TS(h) / h);
  const rnd = new Rand('poster:' + seed);
  ctx.fillStyle = hex(bg); ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  const font = tone === 'letterpress' ? FONTS.slab
    : tone === 'offset' ? FONTS.impact
    : tone === 'screenprint' ? FONTS.impact
    : tone === 'digital' ? FONTS.sans
    : tone === 'holo' ? FONTS.mono : FONTS.grotesk;

  if (tone === 'letterpress' || tone === 'offset') {
    ctx.strokeStyle = hex(fg); ctx.lineWidth = 5;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.lineWidth = 1.5; ctx.strokeRect(24, 24, w - 48, h - 48);
  }
  if (tone === 'holo') {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0d2a30'); g.addColorStop(1, '#1a1030');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }

  const arr = Array.isArray(lines) ? lines : [lines];
  const slotH = (h - 80) / arr.length;
  arr.forEach((ln, i) => {
    const big = i === 0 || ln.length < 12;
    const px = fitText(ctx, ln, font, w * 0.8, big ? slotH * 0.6 : slotH * 0.32);
    ctx.font = `${px}px ${font}`;
    ctx.fillStyle = i === 0 ? hex(accent) : hex(fg);
    if (tone === 'holo') { ctx.shadowColor = hex(accent); ctx.shadowBlur = 16; ctx.fillStyle = i === 0 ? hex(accent) : '#bfe8f0'; }
    tracked(ctx, ln, w / 2, 44 + slotH * (i + 0.5), px * 0.04);
    ctx.shadowBlur = 0;
  });

  // Ink misregistration for old print, JPEG-flat for new.
  if (tone === 'letterpress' || tone === 'screenprint') {
    // Ink misregistration: re-draw the sheet a hair off-register. Done with the
    // transform reset so the copy lands 1:1 on the backing store.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.1;
    ctx.drawImage(c, rnd.range(-2, 2), rnd.range(-2, 2));
    ctx.restore();
  }
  // paste wrinkles + torn corner
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  for (let i = 0; i < 5; i++) {
    ctx.lineWidth = rnd.range(0.6, 2);
    ctx.beginPath(); ctx.moveTo(rnd.range(0, w), 0);
    ctx.lineTo(rnd.range(0, w), h); ctx.stroke();
  }
  return c;
}

/** Theatre marquee panel: changeable letters on a lit board. */
export function marqueeTexture(lines, opts = {}) {
  const { w = 1024, h = 320, bg = 0x12100e, fg = 0xffffff, accent = 0xd83a2a,
          style = 'bulb', condition = 0.1, seed = String(lines) } = opts;
  const { c, ctx } = makeCanvas(TS(w), TS(h));
  ctx.scale(TS(w) / w, TS(h) / h);
  const rnd = new Rand('marquee:' + seed);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#f4efe2'); g.addColorStop(0.5, '#e8e2d2'); g.addColorStop(1, '#cfc8b6');
  ctx.fillStyle = style === 'holo' ? '#05080c' : g;
  ctx.fillRect(0, 0, w, h);

  const arr = Array.isArray(lines) ? lines : [lines];
  const slotH = h / (arr.length + 0.4);
  arr.forEach((ln, i) => {
    const px = fitText(ctx, ln, FONTS.impact, w * 0.9, slotH * 0.74);
    ctx.font = `${px}px ${FONTS.impact}`;
    const y = slotH * (i + 0.7);
    if (style === 'holo') {
      ctx.shadowColor = hex(accent); ctx.shadowBlur = 24;
      ctx.fillStyle = i === 0 ? '#ffffff' : hex(accent);
      tracked(ctx, ln, w / 2, y, px * 0.06);
      ctx.shadowBlur = 0;
    } else {
      // Plastic changeable letters sit slightly crooked and cast a shadow.
      ctx.save();
      ctx.translate(w / 2, y);
      ctx.rotate(rnd.range(-0.004, 0.004));
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      tracked(ctx, ln, 2, 3, px * 0.06);
      ctx.fillStyle = i === 0 ? hex(accent) : '#1a1a1e';
      tracked(ctx, ln, 0, 0, px * 0.06);
      ctx.restore();
    }
  });

  if (style === 'bulb') {
    // Bulb border, with a proportion burnt out.
    const dead = condition * 0.6;
    const n = 46;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const on = !rnd.chance(dead);
      const pts = [
        [t * w, 12], [t * w, h - 12], [12, t * h], [w - 12, t * h],
      ];
      for (const [bx, by] of pts) {
        ctx.beginPath();
        ctx.fillStyle = on ? '#fff3cf' : '#6a6458';
        if (on) { ctx.shadowColor = '#ffdc90'; ctx.shadowBlur = 14; }
        ctx.arc(bx, by, 5, 0, 7); ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  }

  if (condition > 0.3) {
    ctx.globalAlpha = Math.min(0.6, condition * 0.6);
    ctx.drawImage(grimeCanvas(), 0, 0, w, h);
    ctx.globalAlpha = 1;
  }
  return c;
}

/**
 * A painted backdrop for a shop interior: the thing you see through the glass.
 * Cheaper and more characterful than modelling every shelf.
 */
export function interiorTexture(kind, opts = {}) {
  const { w = 768, h = 384, seed = kind } = opts;
  const { c, ctx } = makeCanvas(TS(w), TS(h));
  ctx.scale(TS(w) / w, TS(h) / h);
  const rnd = new Rand('interior:' + kind + seed);
  const bgFor = {
    apothecary: '#3a2c20', sundries: '#e0dcd0', bodega: '#2a2218', produce: '#3a3226',
    supermarket: '#dcd8cc', barber: '#2e2a26', bowling: '#1e2430', arcade: '#0a0a14',
    records: '#241c1c', television: '#1a1e24', cybercafe: '#161a20', phones: '#101418',
    dvds: '#141820', pho: '#2a1e18', coffee: '#241c16', refill: '#232a22',
    climbing: '#20242a', dispensary: '#141a16', printmeal: '#0e1a18', farm: '#0c1a12',
    repair: '#12181c', spa: '#180f1a', cashwindow: '#1a1a1e', gym: '#12161c',
    fivedime: '#2a2620', default: '#1c1c22',
  };
  ctx.fillStyle = bgFor[kind] || bgFor.default;
  ctx.fillRect(0, 0, w, h);

  const shelf = (y, hgt, color, count, jitter = 0.5) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, y + hgt, w, 6);
    for (let i = 0; i < count; i++) {
      const bw = w / count * rnd.range(0.4, 0.92);
      const bx = (i + 0.5) * (w / count) - bw / 2 + rnd.range(-6, 6) * jitter;
      const bh = hgt * rnd.range(0.5, 1);
      ctx.fillStyle = `hsl(${rnd.int(0, 360)} ${rnd.int(10, 55)}% ${rnd.int(28, 72)}%)`;
      ctx.fillRect(bx, y + hgt - bh, bw, bh);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(bx, y + hgt - bh, bw, bh * 0.18);
    }
  };

  switch (kind) {
    case 'apothecary':
      for (let r = 0; r < 4; r++) shelf(24 + r * 84, 62, '#6a4a30', 14, 0.3);
      ctx.fillStyle = '#c8b088'; ctx.fillRect(0, h - 70, w, 70);       // marble counter
      ctx.fillStyle = '#8a2a2a';
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(70 + i * 150, h - 40, 16, 0, 7); ctx.fill(); }
      break;
    case 'arcade': {
      // Cabinet silhouettes with glowing screens
      for (let i = 0; i < 7; i++) {
        const x = 20 + i * (w - 40) / 7;
        const cw = (w - 40) / 7 - 12;
        ctx.fillStyle = '#141420'; ctx.fillRect(x, 60, cw, h - 60);
        const hue = rnd.int(0, 360);
        ctx.fillStyle = `hsl(${hue} 90% 55%)`;
        ctx.shadowColor = `hsl(${hue} 100% 60%)`; ctx.shadowBlur = 30;
        ctx.fillRect(x + 6, 84, cw - 12, 60);
        ctx.shadowBlur = 0;
        ctx.fillStyle = `hsl(${(hue + 60) % 360} 90% 60%)`;
        ctx.fillRect(x + 4, 62, cw - 8, 14);
      }
      break;
    }
    case 'television': {
      for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) {
        const x = 30 + i * (w - 60) / 4, y = 26 + r * 118;
        ctx.fillStyle = '#2a2620'; ctx.fillRect(x, y, (w - 60) / 4 - 16, 96);
        ctx.fillStyle = `hsl(${rnd.int(180, 220)} 30% ${rnd.int(45, 75)}%)`;
        ctx.shadowColor = '#a8d0ff'; ctx.shadowBlur = 18;
        ctx.fillRect(x + 8, y + 8, (w - 60) / 4 - 32, 70);
        ctx.shadowBlur = 0;
        for (let s = 0; s < 70; s += 3) { ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(x + 8, y + 8 + s, (w - 60) / 4 - 32, 1.4); }
      }
      break;
    }
    case 'records': {
      for (let r = 0; r < 3; r++) {
        ctx.fillStyle = '#3a2a22'; ctx.fillRect(0, 40 + r * 110, w, 96);
        for (let i = 0; i < 30; i++) {
          ctx.fillStyle = `hsl(${rnd.int(0, 360)} ${rnd.int(30, 80)}% ${rnd.int(30, 60)}%)`;
          ctx.fillRect(8 + i * 25, 44 + r * 110, 21, 88);
        }
      }
      break;
    }
    case 'cybercafe': {
      for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) {
        const x = 18 + i * (w - 36) / 6, y = 40 + r * 108;
        ctx.fillStyle = '#d8d4c8'; ctx.fillRect(x, y, 62, 50);          // CRT
        ctx.fillStyle = '#2a5a8a';
        ctx.shadowColor = '#5a9ad8'; ctx.shadowBlur = 16;
        ctx.fillRect(x + 6, y + 6, 50, 36);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#c8c4b8'; ctx.fillRect(x, y + 56, 62, 10);     // keyboard
      }
      break;
    }
    case 'farm': {
      for (let r = 0; r < 5; r++) {
        const y = 20 + r * 72;
        ctx.fillStyle = '#1a2a20'; ctx.fillRect(0, y, w, 8);
        ctx.fillStyle = '#ff5aa0'; ctx.globalAlpha = 0.5;
        ctx.fillRect(0, y + 8, w, 3);
        ctx.globalAlpha = 1;
        for (let i = 0; i < 26; i++) {
          ctx.fillStyle = `hsl(${rnd.int(85, 130)} ${rnd.int(45, 75)}% ${rnd.int(28, 52)}%)`;
          ctx.beginPath();
          ctx.ellipse(14 + i * 29, y + 34, rnd.range(9, 15), rnd.range(14, 24), 0, 0, 7);
          ctx.fill();
        }
      }
      break;
    }
    case 'printmeal': case 'spa': case 'repair': {
      const glow = kind === 'spa' ? '#e864c8' : kind === 'repair' ? '#56d0e0' : '#9fe870';
      for (let i = 0; i < 5; i++) {
        const x = 30 + i * (w - 60) / 5;
        ctx.fillStyle = '#1a2226'; ctx.fillRect(x, 60, (w - 60) / 5 - 18, h - 110);
        ctx.fillStyle = glow; ctx.shadowColor = glow; ctx.shadowBlur = 24;
        ctx.fillRect(x + 8, 78, (w - 60) / 5 - 34, 6);
        ctx.fillRect(x + 8, h - 78, (w - 60) / 5 - 34, 4);
        ctx.shadowBlur = 0;
      }
      break;
    }
    case 'produce': case 'supermarket': case 'refill': {
      for (let r = 0; r < 4; r++) shelf(20 + r * 86, 64, '#4a3a2a', kind === 'refill' ? 8 : 16, 0.4);
      break;
    }
    case 'phones': case 'dvds': case 'fivedime': case 'dispensary': case 'sundries': {
      for (let r = 0; r < 5; r++) shelf(14 + r * 70, 52, '#3a3a40', 12, 0.25);
      break;
    }
    case 'bowling': {
      ctx.fillStyle = '#c8a878';
      for (let i = 0; i < 5; i++) ctx.fillRect(20 + i * 150, 60, 108, h - 60);
      ctx.fillStyle = '#f0ece0';
      for (let i = 0; i < 5; i++) for (let p = 0; p < 6; p++) {
        ctx.beginPath();
        ctx.ellipse(40 + i * 150 + (p % 3) * 28, 100 + Math.floor(p / 3) * 26, 6, 12, 0, 0, 7);
        ctx.fill();
      }
      break;
    }
    case 'climbing': {
      ctx.fillStyle = '#2a3038'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = `hsl(${rnd.int(0, 360)} 70% 55%)`;
        ctx.beginPath();
        ctx.ellipse(rnd.range(0, w), rnd.range(0, h), rnd.range(5, 12), rnd.range(5, 12), 0, 0, 7);
        ctx.fill();
      }
      break;
    }
    case 'barber': {
      ctx.fillStyle = '#5a4a3a'; ctx.fillRect(0, h - 120, w, 120);
      for (let i = 0; i < 2; i++) {
        ctx.fillStyle = '#2a2420';
        ctx.fillRect(120 + i * 340, h - 210, 120, 96);
        ctx.fillStyle = '#8a2a2a'; ctx.fillRect(126 + i * 340, h - 204, 108, 60);
      }
      ctx.fillStyle = '#c8d8e0';                     // mirror
      ctx.fillRect(40, 40, w - 80, 120);
      break;
    }
    case 'coffee': case 'pho': {
      ctx.fillStyle = '#3a2a20'; ctx.fillRect(0, h - 110, w, 110);
      ctx.fillStyle = '#8a8a90'; ctx.fillRect(w * 0.5 - 80, h - 190, 160, 82);  // machine
      for (let r = 0; r < 3; r++) shelf(20 + r * 60, 42, '#4a3a2a', 10, 0.3);
      break;
    }
    case 'cashwindow': {
      ctx.fillStyle = '#101014'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(180,220,255,0.12)'; ctx.fillRect(w * 0.2, 40, w * 0.6, h - 90);
      ctx.fillStyle = '#39ff6a'; ctx.shadowColor = '#39ff6a'; ctx.shadowBlur = 20;
      ctx.font = `48px ${FONTS.mono}`; ctx.textAlign = 'center';
      ctx.fillText('CASH', w / 2, h / 2);
      ctx.shadowBlur = 0;
      break;
    }
    default:
      for (let r = 0; r < 4; r++) shelf(24 + r * 84, 60, '#3a3a40', 12, 0.4);
  }

  // Everything gets a soft ceiling-light gradient and reflection haze.
  const lg = ctx.createLinearGradient(0, 0, 0, h);
  lg.addColorStop(0, 'rgba(255,240,210,0.24)');
  lg.addColorStop(0.4, 'rgba(255,240,210,0.03)');
  lg.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = lg; ctx.fillRect(0, 0, w, h);
  return c;
}

/** A digital billboard frame: flat colour blocks + big type, era-flavoured. */
export function billboardTexture(text, opts = {}) {
  const { w = 1024, h = 512, tone = 'offset', bg = 0x1a2a4a, fg = 0xffffff, accent = 0xe8663a, seed = text } = opts;
  const { c, ctx } = makeCanvas(TS(w), TS(h));
  ctx.scale(TS(w) / w, TS(h) / h);
  const rnd = new Rand('bill:' + seed);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  if (tone === 'holo') {
    const g = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w * 0.7);
    g.addColorStop(0, '#123448'); g.addColorStop(1, '#05080c');
    ctx.fillStyle = g;
  } else {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, hex(bg));
    g.addColorStop(1, hex(accent));
    ctx.fillStyle = g;
  }
  ctx.fillRect(0, 0, w, h);

  // A big abstract product shape so it doesn't read as pure typography.
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.ellipse(rnd.range(0, w), rnd.range(0, h), rnd.range(60, 260), rnd.range(60, 200), rnd.range(0, 3), 0, 7);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const font = tone === 'letterpress' ? FONTS.slab : tone === 'holo' ? FONTS.mono
    : tone === 'flat' ? FONTS.grotesk : FONTS.impact;
  const words = String(text).split(' · ');
  const slot = h / (words.length + 0.5);
  words.forEach((ln, i) => {
    const px = fitText(ctx, ln, font, w * 0.86, slot * 0.8);
    ctx.font = `${px}px ${font}`;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillText(ln, w / 2 + 4, slot * (i + 0.75) + 5);
    ctx.fillStyle = i === 0 ? hex(fg) : 'rgba(255,255,255,0.82)';
    if (tone === 'holo') { ctx.shadowColor = '#56d0e0'; ctx.shadowBlur = 24; }
    ctx.fillText(ln, w / 2, slot * (i + 0.75));
    ctx.shadowBlur = 0;
  });
  return c;
}

/**
 * Opaque window pane: a baked sky reflection.
 *
 * Upper-floor windows read as mirrors from the street, and an environment map
 * of a bare sky reflects as a flat wash — so the *shape* of the reflection is
 * painted in: bright sky across the top, the dark mass of the building
 * opposite across the bottom, a hard diagonal where the two meet, and the
 * grime and squeegee streaks that stop it looking like chrome.
 */
export function paneTexture(opts = {}) {
  const { w = 128, h = 160, dirt = 0.3, seed = 'pane', horizon = 0.42 } = opts;
  const { c, ctx } = makeCanvas(TS(w), TS(h));
  ctx.scale(TS(w) / w, TS(h) / h);
  const rnd = new Rand('pane:' + seed);

  const g = ctx.createLinearGradient(w * 0.15, 0, w * 0.85, h);
  g.addColorStop(0, '#dce8f6');
  g.addColorStop(horizon * 0.55, '#8fa6bb');
  g.addColorStop(horizon, '#3d4956');
  g.addColorStop(horizon + 0.06, '#1d232a');
  g.addColorStop(1, '#12161b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // The reflected cornice line of the building opposite.
  ctx.fillStyle = 'rgba(70,84,98,0.45)';
  ctx.fillRect(0, h * (horizon + 0.16), w, h * 0.05);
  // A couple of reflected lit windows.
  for (let i = 0; i < 3; i++) {
    if (!rnd.chance(0.5)) continue;
    ctx.fillStyle = `rgba(200,210,225,${rnd.range(0.1, 0.26)})`;
    ctx.fillRect(rnd.range(0, w * 0.8), h * (horizon + rnd.range(0.2, 0.5)), w * 0.16, h * 0.09);
  }
  // Squeegee streaks and grime in the corners.
  ctx.strokeStyle = `rgba(255,255,255,${0.05 + dirt * 0.08})`;
  for (let i = 0; i < 10; i++) {
    ctx.lineWidth = rnd.range(1, 5);
    const x = rnd.range(0, w);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + rnd.range(-8, 8), h); ctx.stroke();
  }
  ctx.globalAlpha = dirt * 0.55;
  ctx.drawImage(grimeCanvas(), 0, 0, w, h);
  ctx.globalAlpha = 1;
  return c;
}

/** Window glass: a baked reflection gradient + dirt, alpha-blended over the view. */
export function glassTexture(opts = {}) {
  const { w = 256, h = 256, dirt = 0.3, tint = 0x2a3038, seed = 'glass' } = opts;
  const { c, ctx } = makeCanvas(TS(w), TS(h));
  ctx.scale(TS(w) / w, TS(h) / h);
  const rnd = new Rand('glass:' + seed);
  const g = ctx.createLinearGradient(0, 0, w * 0.7, h);
  g.addColorStop(0, 'rgba(255,255,255,0.42)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.08)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.02)');
  g.addColorStop(1, 'rgba(255,255,255,0.16)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // Streaks from a squeegee that missed
  ctx.strokeStyle = `rgba(220,220,210,${0.05 + dirt * 0.16})`;
  for (let i = 0; i < 14; i++) {
    ctx.lineWidth = rnd.range(2, 9);
    ctx.beginPath();
    const x = rnd.range(0, w);
    ctx.moveTo(x, 0); ctx.lineTo(x + rnd.range(-16, 16), h); ctx.stroke();
  }
  ctx.globalAlpha = dirt * 0.7;
  ctx.drawImage(grimeCanvas(), 0, 0, w, h);
  ctx.globalAlpha = 1;
  return c;
}

/** Road markings drawn onto a strip texture that tiles along the carriageway. */
export function roadMarkTexture(kind, opts = {}) {
  const { w = 256, h = 1024, wear = 0.3 } = opts;
  const { c, ctx } = makeCanvas(w, h);
  const rnd = new Rand('mark:' + kind);
  ctx.clearRect(0, 0, w, h);
  const paint = (x, y, pw, ph, col = '#e8e4d0') => {
    ctx.fillStyle = col;
    ctx.globalAlpha = 1 - wear * rnd.range(0.2, 0.8);
    ctx.fillRect(x, y, pw, ph);
    ctx.globalAlpha = 1;
  };
  switch (kind) {
    case 'white-dash':
      for (let y = 0; y < h; y += 128) paint(w / 2 - 6, y, 12, 76);
      break;
    case 'yellow-double':
      for (let y = 0; y < h; y += 8) { paint(w / 2 - 16, y, 10, 6, '#d8b02a'); paint(w / 2 + 6, y, 10, 6, '#d8b02a'); }
      break;
    case 'smart-lane':
      for (let y = 0; y < h; y += 64) paint(w / 2 - 3, y, 6, 40, '#56d0e0');
      break;
    default: break;
  }
  return c;
}

/** Clears the memo cache (used on era rebuilds that change detail maps). */
export function clearTextureCache() {
  for (const t of cache.values()) t?.dispose?.();
  cache.clear();
}

export { FONTS, hex, roundRect, fitText, tracked, glowText };
