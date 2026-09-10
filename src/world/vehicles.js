/**
 * Traffic.
 *
 * Vehicles are parametric rather than hand-modelled: one builder takes an
 * archetype plus a dozen proportions (wheelbase, greenhouse fraction, fender
 * treatment, fin height, chrome, roof slope) and produces a 1949 sedan or a
 * 2055 autonomous pod from the same code. Proportion is what dates a car —
 * a 1965 sedan is long, low and wide with a shallow greenhouse; a 2005 SUV is
 * short, tall and slab-sided — so getting the numbers right matters more than
 * getting the details right.
 *
 * The AI drives two concentric rounded-rectangle loops around the block in
 * opposite directions, obeys a shared four-phase traffic signal, and does
 * simple car-following so queues form at red lights and release in a pulse.
 */

import * as THREE from 'three';
import { Bucket } from './geom.js';
import { Rand } from '../core/rng.js';
import { clamp, clamp01, lerp, damp, TAU } from '../core/mathx.js';
import { BLOCK } from '../data/eras.js';

const CURB = BLOCK.half + BLOCK.sidewalk;

/* ══════════════════════════ vehicle specs ══════════════════════════ */
/* len/wid/hgt in metres. `cab` is the greenhouse as a fraction of length,
   `cabY` its height, `belt` the beltline height (top of the body sides). */

const SPECS = {
  /* ── 1945: tall, narrow, separate fenders, running boards ── */
  sedan45: { arch: 'car', len: 4.9, wid: 1.78, hgt: 1.05, cab: 0.44, cabY: 0.72, belt: 0.88,
    fenders: 'separate', running: true, wheelR: 0.42, wheelW: 0.16, chrome: 0.5,
    roofRound: 0.9, split: true, visor: true, spare: true, hood: 'long' },
  coupe45: { arch: 'car', len: 4.5, wid: 1.74, hgt: 1.0, cab: 0.34, cabY: 0.66, belt: 0.86,
    fenders: 'separate', running: true, wheelR: 0.4, wheelW: 0.16, chrome: 0.45,
    roofRound: 1.0, split: true, visor: true, hood: 'long' },
  truck45: { arch: 'van', len: 5.4, wid: 1.95, hgt: 2.05, cab: 0.3, cabY: 0.8, belt: 1.0,
    fenders: 'separate', running: true, wheelR: 0.46, wheelW: 0.2, chrome: 0.2, box: true },
  taxi45: { arch: 'car', len: 5.0, wid: 1.82, hgt: 1.12, cab: 0.46, cabY: 0.82, belt: 0.9,
    fenders: 'separate', running: true, wheelR: 0.42, wheelW: 0.17, chrome: 0.5,
    roofRound: 0.85, split: true, taxi: 'roof-light', checker: true, hood: 'long' },
  trolley: { arch: 'trolley', len: 12.5, wid: 2.5, hgt: 3.2 },

  /* ── 1965: long, low, finned, chrome-heavy ── */
  finSedan: { arch: 'car', len: 5.6, wid: 2.0, hgt: 0.78, cab: 0.42, cabY: 0.62, belt: 0.72,
    fenders: 'integrated', wheelR: 0.36, wheelW: 0.2, chrome: 1.0, fins: 0.34,
    roofRound: 0.2, quad: true, twoTone: true, hood: 'flat' },
  wagon65: { arch: 'wagon', len: 5.7, wid: 2.0, hgt: 0.84, cab: 0.56, cabY: 0.72, belt: 0.76,
    fenders: 'integrated', wheelR: 0.36, wheelW: 0.2, chrome: 0.8, fins: 0.14, wood: true },
  muscle65: { arch: 'car', len: 5.1, wid: 1.94, hgt: 0.72, cab: 0.36, cabY: 0.56, belt: 0.66,
    fenders: 'integrated', wheelR: 0.37, wheelW: 0.24, chrome: 0.6, roofRound: 0.15,
    stripe: true, hood: 'scoop' },
  van65: { arch: 'van', len: 4.5, wid: 1.85, hgt: 1.95, cab: 0.9, cabY: 0.9, belt: 0.9,
    fenders: 'integrated', wheelR: 0.33, wheelW: 0.18, chrome: 0.4, forward: true, twoTone: true },
  bus65: { arch: 'bus', len: 11.0, wid: 2.55, hgt: 3.0, chrome: 0.5, windows: 9 },
  taxi65: { arch: 'car', len: 5.5, wid: 2.0, hgt: 0.8, cab: 0.44, cabY: 0.66, belt: 0.74,
    fenders: 'integrated', wheelR: 0.36, wheelW: 0.2, chrome: 0.8, fins: 0.18,
    taxi: 'roof-light', hood: 'flat' },
  scooter65: { arch: 'scooter', len: 1.8, wid: 0.7, hgt: 1.1 },

  /* ── 1985: boxes, flat panels, plastic bumpers ── */
  boxSedan: { arch: 'car', len: 4.8, wid: 1.76, hgt: 0.82, cab: 0.46, cabY: 0.6, belt: 0.78,
    fenders: 'integrated', wheelR: 0.32, wheelW: 0.19, chrome: 0.25, boxy: 1,
    roofRound: 0.02, hood: 'flat', bumper: 'plastic' },
  woodWagon: { arch: 'wagon', len: 5.2, wid: 1.85, hgt: 0.88, cab: 0.58, cabY: 0.66, belt: 0.8,
    fenders: 'integrated', wheelR: 0.33, wheelW: 0.19, chrome: 0.2, boxy: 1, wood: true },
  hatch85: { arch: 'hatch', len: 3.8, wid: 1.62, hgt: 0.8, cab: 0.5, cabY: 0.58, belt: 0.76,
    fenders: 'integrated', wheelR: 0.29, wheelW: 0.17, chrome: 0.1, boxy: 1 },
  pickup85: { arch: 'pickup', len: 5.3, wid: 1.95, hgt: 1.1, cab: 0.34, cabY: 0.78, belt: 1.0,
    fenders: 'integrated', wheelR: 0.4, wheelW: 0.24, chrome: 0.3, boxy: 1, lifted: 0.12 },
  taxi85: { arch: 'car', len: 5.3, wid: 1.9, hgt: 0.86, cab: 0.46, cabY: 0.64, belt: 0.82,
    fenders: 'integrated', wheelR: 0.34, wheelW: 0.2, chrome: 0.3, boxy: 1, taxi: 'roof-sign' },
  van85: { arch: 'van', len: 5.2, wid: 1.95, hgt: 2.1, cab: 0.34, cabY: 0.86, belt: 1.0,
    fenders: 'integrated', wheelR: 0.34, wheelW: 0.2, chrome: 0.15, boxy: 1 },
  delorean: { arch: 'car', len: 4.27, wid: 1.99, hgt: 0.62, cab: 0.38, cabY: 0.5, belt: 0.56,
    fenders: 'integrated', wheelR: 0.31, wheelW: 0.22, chrome: 0.0, wedge: 0.9,
    steel: true, louvre: true, hood: 'wedge' },

  /* ── 2005: tall crossovers, rounded corners, body cladding ── */
  suv05: { arch: 'suv', len: 4.9, wid: 1.9, hgt: 1.42, cab: 0.56, cabY: 0.78, belt: 1.05,
    fenders: 'integrated', wheelR: 0.37, wheelW: 0.22, chrome: 0.3, cladding: true, rails: true },
  sedan05: { arch: 'car', len: 4.8, wid: 1.8, hgt: 0.8, cab: 0.5, cabY: 0.56, belt: 0.76,
    fenders: 'integrated', wheelR: 0.32, wheelW: 0.2, chrome: 0.25, roofRound: 0.35 },
  minivan05: { arch: 'van', len: 5.1, wid: 1.95, hgt: 1.6, cab: 0.72, cabY: 0.74, belt: 0.98,
    fenders: 'integrated', wheelR: 0.33, wheelW: 0.2, chrome: 0.2, glassy: true },
  hybrid05: { arch: 'hatch', len: 4.4, wid: 1.72, hgt: 0.86, cab: 0.62, cabY: 0.6, belt: 0.8,
    fenders: 'integrated', wheelR: 0.3, wheelW: 0.17, chrome: 0.1, kamm: true },
  taxi05: { arch: 'suv', len: 4.9, wid: 1.9, hgt: 1.4, cab: 0.56, cabY: 0.76, belt: 1.04,
    fenders: 'integrated', wheelR: 0.36, wheelW: 0.22, chrome: 0.2, taxi: 'roof-sign', cladding: true },
  bus05: { arch: 'bus', len: 12.0, wid: 2.55, hgt: 3.1, chrome: 0.15, windows: 8, lowFloor: true },
  deliveryVan05: { arch: 'van', len: 5.8, wid: 2.05, hgt: 2.35, cab: 0.3, cabY: 0.86, belt: 1.05,
    fenders: 'integrated', wheelR: 0.36, wheelW: 0.22, chrome: 0.05, box: true },
  moped05: { arch: 'scooter', len: 1.9, wid: 0.7, hgt: 1.12 },

  /* ── 2025: sealed EV faces, big wheels, black trim ── */
  ev25: { arch: 'car', len: 4.7, wid: 1.86, hgt: 0.84, cab: 0.58, cabY: 0.54, belt: 0.78,
    fenders: 'integrated', wheelR: 0.36, wheelW: 0.22, chrome: 0.05, sealed: true,
    lightBar: true, roofRound: 0.42, blackTrim: true },
  crossover25: { arch: 'suv', len: 4.6, wid: 1.86, hgt: 1.3, cab: 0.56, cabY: 0.66, belt: 1.0,
    fenders: 'integrated', wheelR: 0.38, wheelW: 0.23, chrome: 0.05, blackTrim: true, lightBar: true },
  cargoBike: { arch: 'cargobike', len: 2.4, wid: 0.9, hgt: 1.5 },
  escooter: { arch: 'escooter', len: 1.2, wid: 0.5, hgt: 1.2 },
  rideshare25: { arch: 'car', len: 4.8, wid: 1.84, hgt: 0.84, cab: 0.56, cabY: 0.56, belt: 0.78,
    fenders: 'integrated', wheelR: 0.35, wheelW: 0.21, chrome: 0.05, taxi: 'roof-puck', blackTrim: true },
  deliveryVan25: { arch: 'van', len: 5.9, wid: 2.05, hgt: 2.5, cab: 0.28, cabY: 0.86, belt: 1.05,
    fenders: 'integrated', wheelR: 0.36, wheelW: 0.22, chrome: 0.02, box: true, blackTrim: true },
  bus25: { arch: 'bus', len: 12.2, wid: 2.55, hgt: 3.15, chrome: 0.05, windows: 8, lowFloor: true, electric: true },
  angularTruck: { arch: 'car', len: 5.7, wid: 2.03, hgt: 1.0, cab: 0.5, cabY: 0.6, belt: 0.9,
    fenders: 'integrated', wheelR: 0.42, wheelW: 0.26, chrome: 0, steel: true, wedge: 1.0,
    faceted: true, lightBar: true },
  lidarCar: { arch: 'suv', len: 4.7, wid: 1.86, hgt: 1.3, cab: 0.56, cabY: 0.66, belt: 1.0,
    fenders: 'integrated', wheelR: 0.36, wheelW: 0.22, chrome: 0.1, lidar: true, sensors: true },

  /* ── 2055: single-volume pods, no driver, lit skirts ── */
  pod55: { arch: 'pod', len: 4.2, wid: 1.9, hgt: 1.72, wheelR: 0.34, wheelW: 0.2 },
  shuttle55: { arch: 'pod', len: 6.4, wid: 2.2, hgt: 2.4, wheelR: 0.36, wheelW: 0.22, long: true },
  cargoDrone: { arch: 'drone', len: 1.6, wid: 1.6, hgt: 0.7 },
  walkerBot: { arch: 'walker', len: 0.9, wid: 0.7, hgt: 1.4 },
  classicCar: { arch: 'car', len: 5.6, wid: 2.0, hgt: 0.78, cab: 0.42, cabY: 0.62, belt: 0.72,
    fenders: 'integrated', wheelR: 0.36, wheelW: 0.2, chrome: 1.0, fins: 0.34,
    roofRound: 0.2, quad: true, hood: 'flat' },
};

/* ══════════════════════════ model builder ══════════════════════════ */

const CHROME = 0xd8dce0;
const GLASSC = 0x9ac0d8;
const TYRE = 0x14141a;

export function buildVehicle(kind, color, era, mats, rnd) {
  const s = SPECS[kind] || SPECS.sedan05;
  const g = new THREE.Group();
  const body = new Bucket();
  const chrome = new Bucket();
  const glass = new Bucket();
  const lights = new Bucket();
  const wheels = [];

  const L = s.len, W = s.wid;
  const yBase = (s.wheelR ?? 0.34) * 0.62 + (s.lifted ?? 0);

  switch (s.arch) {
    case 'car': case 'wagon': case 'hatch': case 'suv': case 'pickup':
      buildCarBody(s, body, chrome, glass, lights, color, era, rnd, yBase);
      break;
    case 'van': buildVanBody(s, body, chrome, glass, lights, color, yBase); break;
    case 'bus': buildBusBody(s, body, chrome, glass, lights, color, era, yBase); break;
    case 'trolley': buildTrolleyBody(body, chrome, glass, lights, color, yBase); break;
    case 'scooter': buildScooter(body, chrome, glass, color, yBase); break;
    case 'escooter': buildEScooter(body, lights, color); break;
    case 'cargobike': buildCargoBike(body, lights, color); break;
    case 'pod': buildPod(s, body, glass, lights, color, era); break;
    case 'drone': buildDrone(body, lights, color); break;
    case 'walker': buildWalker(body, lights, color); break;
    default: break;
  }

  /* Wheels — separate objects so they can spin. */
  if (!['drone', 'walker'].includes(s.arch)) {
    const wr = s.wheelR ?? 0.34, ww = s.wheelW ?? 0.2;
    const axles = s.arch === 'bus' || s.arch === 'trolley'
      ? [[-L * 0.32, 0], [L * 0.3, 0]]
      : s.arch === 'scooter' || s.arch === 'escooter'
        ? [[-L * 0.36, 0], [L * 0.36, 0]]
        : [[-L * 0.31, 0], [L * 0.3, 0]];
    const half = s.arch === 'scooter' || s.arch === 'escooter' || s.arch === 'cargobike' ? [0] : [-1, 1];
    const wheelMat = mats.vcol('matte');
    for (const [ax] of axles) {
      for (const side of half) {
        const wb = new Bucket();
        wb.cyl(wr, ww, 0, 0, 0, TYRE, { z: Math.PI / 2 }, 16);
        wb.cyl(wr * 0.58, ww + 0.015, 0, 0, 0, s.steel ? 0x9aa0a6 : (era.year >= 2005 ? 0x8a9098 : CHROME), { z: Math.PI / 2 }, 12);
        if ((s.chrome ?? 0) > 0.4) wb.cyl(wr * 0.3, ww + 0.03, 0, 0, 0, CHROME, { z: Math.PI / 2 }, 10);
        else for (let k = 0; k < 5; k++) {
          const a = k * TAU / 5;
          wb.box(wr * 0.9, 0.06, ww * 0.6, 0, 0, 0, era.year >= 2025 ? 0x2a2a2e : 0x6a6a70, { x: a });
        }
        const wm = wb.mesh(wheelMat, { receive: false });
        if (wm) {
          wm.position.set(side * (W / 2 - ww * 0.45), wr, ax);
          g.add(wm);
          wheels.push(wm);
        }
      }
    }
  }

  const add = (bucket, mat, cast = true) => {
    const m = bucket.mesh(mat, { cast, receive: true });
    if (m) g.add(m);
    return m;
  };
  add(body, mats.vcol('gloss'));
  add(chrome, mats.vcol('metal'));
  const gm = glass.mesh(mats.glass(GLASSC, { opacity: 0.46, rough: 0.05 }), { cast: false, receive: false });
  if (gm) g.add(gm);
  const lm = lights.mesh(mats.emitVcol({ strength: 2.6 }), { cast: false });
  if (lm) g.add(lm);

  g.userData = { kind, spec: s, wheels, wheelR: s.wheelR ?? 0.34, lights: lm, length: L, width: W };
  return g;
}

function buildCarBody(s, b, c, gl, li, color, era, rnd, yBase) {
  const L = s.len, W = s.wid, H = s.hgt;
  const belt = s.belt ?? 0.8;
  const y0 = yBase;
  const boxy = s.boxy ?? 0;
  const arch = s.arch;

  /* Lower body: a stack of tapered slabs so the section isn't a plain box. */
  const seg = 9;
  for (let i = 0; i < seg; i++) {
    const t = (i + 0.5) / seg;
    const zc = lerp(-L / 2, L / 2, t);
    // Plan taper: narrower at nose and tail on older cars, near-parallel on boxes.
    const taper = lerp(1 - 0.16 * (1 - boxy), 1, Math.sin(t * Math.PI) ** 0.5);
    const wid = W * taper;
    // Side profile: rise over the wheels for integrated fenders.
    const hgt = H * lerp(0.86, 1, Math.sin(t * Math.PI) ** 0.4);
    const drop = s.wedge ? lerp(-0.1 * s.wedge, 0.04, t) : 0;
    b.box(wid, hgt, L / seg + 0.02, 0, y0 + hgt / 2 + drop, zc, color);
  }
  // Belt-line crease
  b.box(W * 1.004, 0.03, L * 0.9, 0, y0 + belt * 0.72, 0, s.twoTone ? 0xffffff : color);
  if (s.twoTone) b.box(W * 1.006, belt * 0.3, L * 0.86, 0, y0 + belt * 0.86, 0, 0xf0ece0);
  if (s.stripe) { b.box(0.22, H * 0.02 + 0.02, L * 0.96, -0.3, y0 + H + 0.005, 0, 0xf0ece0); b.box(0.22, H * 0.02 + 0.02, L * 0.96, 0.3, y0 + H + 0.005, 0, 0xf0ece0); }

  /* Separate fenders + running boards (pre-war shapes) */
  if (s.fenders === 'separate') {
    for (const side of [-1, 1]) {
      for (const az of [-L * 0.31, L * 0.3]) {
        const fr = (s.wheelR ?? 0.4) + 0.16;
        for (let i = 0; i < 7; i++) {
          const a = Math.PI * (0.08 + i / 8 * 0.84);
          b.box(0.26, 0.14, 0.28, side * (W / 2 - 0.02), y0 - 0.1 + Math.sin(a) * fr, az + Math.cos(a) * fr * 0.95, color, { x: -a + Math.PI / 2 });
        }
      }
      if (s.running) b.box(0.3, 0.08, L * 0.34, side * (W / 2 - 0.05), y0 - 0.06, 0, 0x2a2a2e);
    }
    if (s.spare) c.cyl((s.wheelR ?? 0.4) * 0.9, 0.16, 0, y0 + H * 0.6, -L / 2 - 0.12, TYRE, { z: Math.PI / 2 }, 14);
  } else {
    // Integrated fenders: subtle arch lips
    for (const side of [-1, 1]) for (const az of [-L * 0.31, L * 0.3]) {
      b.box(0.06, 0.1, (s.wheelR ?? 0.34) * 2.2, side * (W / 2 + 0.01), y0 + (s.wheelR ?? 0.34) * 0.9, az, s.blackTrim ? 0x1a1a1e : color);
    }
  }

  /* Greenhouse */
  const cabL = L * (s.cab ?? 0.45);
  const cabY = s.cabY ?? 0.6;
  const cabZ = arch === 'pickup' ? -L * 0.1 : arch === 'wagon' || arch === 'hatch' ? L * 0.02 : L * 0.0;
  const roofRound = s.roofRound ?? 0.3;
  const cabW = W * (0.88 - roofRound * 0.06);

  if (arch !== 'pickup' || true) {
    const cSeg = 7;
    for (let i = 0; i < cSeg; i++) {
      const t = (i + 0.5) / cSeg;
      const zc = cabZ + lerp(-cabL / 2, cabL / 2, t);
      // Roofline: rounded on pre-war cars, flat on 80s boxes, fast on the wedge.
      const prof = Math.sin(t * Math.PI) ** (0.22 + roofRound * 0.9);
      const h = cabY * lerp(1 - roofRound * 0.5, 1, prof);
      const wdt = cabW * lerp(0.9, 1, Math.sin(t * Math.PI) ** 0.3);
      b.box(wdt, h, cabL / cSeg + 0.02, 0, y0 + s.hgt + h / 2 - 0.02, zc, color);
    }
    // Glazing
    const gy = y0 + s.hgt + cabY * 0.52;
    gl.box(cabW * 0.99, cabY * 0.6, cabL * 0.9, 0, gy, cabZ, 0xffffff);
    // Pillars
    b.box(cabW * 1.005, cabY * 0.16, 0.1, 0, y0 + s.hgt + cabY * 0.9, cabZ - cabL / 2 + 0.06, color);
    b.box(cabW * 1.005, cabY * 0.16, 0.1, 0, y0 + s.hgt + cabY * 0.9, cabZ + cabL / 2 - 0.06, color);
    if (s.split) c.box(0.05, cabY * 0.6, 0.06, 0, gy, cabZ + cabL / 2 - 0.02, CHROME);
    if (s.louvre) for (let i = 0; i < 7; i++) c.box(cabW * 0.9, 0.02, 0.06, 0, gy + cabY * 0.28 - i * 0.06, cabZ - cabL / 2 + 0.12, 0x2a2a2e);
    // Roof
    b.box(cabW * 0.96, 0.05, cabL * 0.86, 0, y0 + s.hgt + cabY - 0.02, cabZ, color);
  }

  if (arch === 'pickup') {
    // Bed walls behind the cab
    const bedZ = L * 0.26, bedL = L * 0.4;
    b.box(W, 0.62, 0.08, 0, y0 + s.hgt + 0.3, bedZ + bedL / 2, color);
    for (const side of [-1, 1]) b.box(0.08, 0.62, bedL, side * (W / 2 - 0.04), y0 + s.hgt + 0.3, bedZ, color);
  }
  if (arch === 'wagon') {
    b.box(cabW, cabY * 0.9, L * 0.22, 0, y0 + s.hgt + cabY * 0.45, -L * 0.3, color);
    gl.box(cabW * 0.96, cabY * 0.5, L * 0.2, 0, y0 + s.hgt + cabY * 0.5, -L * 0.3, 0xffffff);
    if (s.wood) {
      b.box(W * 1.004, 0.5, L * 0.5, 0, y0 + s.hgt * 0.55, -L * 0.12, 0x9a7a4a);
      b.box(W * 1.008, 0.42, L * 0.46, 0, y0 + s.hgt * 0.55, -L * 0.12, 0xc8a878);
    }
    if (s.rails) for (const side of [-1, 1]) c.box(0.05, 0.06, L * 0.5, side * cabW * 0.4, y0 + s.hgt + cabY + 0.04, cabZ, 0x8a9098);
  }
  if (s.rails && arch === 'suv') {
    for (const side of [-1, 1]) c.box(0.05, 0.06, L * 0.5, side * cabW * 0.38, y0 + s.hgt + cabY + 0.04, cabZ, 0x8a9098);
  }
  if (s.cladding) {
    b.box(W * 1.01, 0.24, L * 0.94, 0, y0 + 0.16, 0, 0x3a3a3e);
  }

  /* Nose and tail */
  const noseZ = L / 2, tailZ = -L / 2;
  if (s.chrome > 0.15) {
    c.box(W * 0.94, 0.16, 0.16, 0, y0 + 0.18, noseZ + 0.06, CHROME);          // bumper
    c.box(W * 0.94, 0.14, 0.14, 0, y0 + 0.18, tailZ - 0.06, CHROME);
    if (s.chrome > 0.6) {
      for (const side of [-1, 1]) c.cyl(0.12, 0.3, side * W * 0.3, y0 + 0.2, noseZ + 0.1, CHROME, { z: Math.PI / 2 }, 10);
    }
  } else if (s.bumper === 'plastic') {
    b.box(W * 0.98, 0.3, 0.2, 0, y0 + 0.2, noseZ + 0.05, 0x3a3a3e);
    b.box(W * 0.98, 0.28, 0.18, 0, y0 + 0.2, tailZ - 0.05, 0x3a3a3e);
  } else if (s.blackTrim) {
    b.box(W * 0.99, 0.34, 0.14, 0, y0 + 0.22, noseZ + 0.02, 0x1a1a1e);
    b.box(W * 0.99, 0.32, 0.14, 0, y0 + 0.22, tailZ - 0.02, 0x1a1a1e);
  }

  /* Grille */
  if (!s.sealed) {
    const gw = W * (s.chrome > 0.6 ? 0.72 : 0.5), gh = s.hgt * (s.chrome > 0.6 ? 0.5 : 0.3);
    c.box(gw, gh, 0.08, 0, y0 + s.hgt * 0.52, noseZ + 0.02, s.chrome > 0.3 ? CHROME : 0x2a2a2e);
    const bars = s.chrome > 0.6 ? 7 : 4;
    for (let i = 0; i < bars; i++) {
      c.box(gw * 0.94, gh / bars * 0.4, 0.1, 0, y0 + s.hgt * 0.52 - gh / 2 + (i + 0.5) * gh / bars, noseZ + 0.05, s.chrome > 0.3 ? 0x8a8e92 : 0x1a1a1e);
    }
  } else {
    b.box(W * 0.7, s.hgt * 0.24, 0.06, 0, y0 + s.hgt * 0.55, noseZ + 0.02, 0x1a1a1e);
  }

  /* Lamps */
  const lampY = y0 + s.hgt * (s.chrome > 0.6 ? 0.72 : 0.62);
  if (s.lightBar) {
    li.box(W * 0.86, 0.07, 0.05, 0, lampY, noseZ + 0.04, 0xf0f4ff);
    li.box(W * 0.86, 0.07, 0.05, 0, lampY, tailZ - 0.04, 0xff3a2a);
  } else if (s.quad) {
    for (const side of [-1, 1]) for (const o of [-0.16, 0.16]) {
      c.cyl(0.11, 0.08, side * W * 0.34 + o * side, lampY, noseZ + 0.02, CHROME, { x: Math.PI / 2 }, 10);
      li.cyl(0.09, 0.06, side * W * 0.34 + o * side, lampY, noseZ + 0.05, 0xfff4d8, { x: Math.PI / 2 }, 10);
    }
  } else {
    for (const side of [-1, 1]) {
      if (s.fenders === 'separate') {
        c.sphere(0.14, side * W * 0.36, y0 + s.hgt * 0.9, noseZ - L * 0.06, CHROME);
        li.sphere(0.11, side * W * 0.36, y0 + s.hgt * 0.9, noseZ - L * 0.06 + 0.06, 0xfff4d8, true);
      } else {
        li.box(0.42, 0.14, 0.06, side * W * 0.3, lampY, noseZ + 0.03, 0xf0f4ff);
      }
    }
  }
  for (const side of [-1, 1]) {
    li.box(s.boxy ? 0.3 : 0.36, s.boxy ? 0.2 : 0.14, 0.05, side * W * 0.32, lampY, tailZ - 0.03, 0xff3a2a);
  }

  /* Taxi identity */
  if (s.taxi === 'roof-light') {
    c.box(0.5, 0.16, 0.24, 0, y0 + s.hgt + (s.cabY ?? 0.6) + 0.08, cabZ + cabL * 0.2, CHROME);
    li.box(0.44, 0.12, 0.2, 0, y0 + s.hgt + (s.cabY ?? 0.6) + 0.08, cabZ + cabL * 0.2, 0xfff0c0);
  } else if (s.taxi === 'roof-sign') {
    b.box(0.9, 0.22, 0.18, 0, y0 + s.hgt + (s.cabY ?? 0.6) + 0.1, cabZ, 0xf0c020);
    li.box(0.86, 0.18, 0.02, 0, y0 + s.hgt + (s.cabY ?? 0.6) + 0.1, cabZ + 0.1, 0xf0c020);
  } else if (s.taxi === 'roof-puck') {
    b.box(0.34, 0.12, 0.24, 0, y0 + s.hgt + (s.cabY ?? 0.6) + 0.06, cabZ, 0x1a1a1e);
    li.box(0.3, 0.08, 0.02, 0, y0 + s.hgt + (s.cabY ?? 0.6) + 0.06, cabZ + 0.13, 0x56d0e0);
  }
  if (s.checker) {
    for (let i = 0; i < 14; i++) {
      b.box(0.16, 0.1, 0.16, (i % 2 ? W / 2 : -W / 2) + 0.005, y0 + 0.52 + (i % 2) * 0.1, -L / 2 + 0.3 + Math.floor(i / 2) * 0.4, i % 2 ? 0x1a1a1e : 0x1a1a1e);
    }
  }

  /* Fins */
  if (s.fins) {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        b.box(0.1, s.fins * (0.3 + t * 0.7), L * 0.06, side * (W / 2 - 0.06), y0 + s.hgt + s.fins * (0.3 + t * 0.7) / 2 - 0.02, -L * 0.22 - t * L * 0.24, color);
      }
      c.box(0.12, 0.1, L * 0.2, side * (W / 2 - 0.05), y0 + s.hgt + s.fins * 0.9, -L * 0.34, CHROME);
    }
  }

  /* Sensors */
  if (s.lidar) {
    b.cyl(0.14, 0.18, 0, y0 + s.hgt + (s.cabY ?? 0.6) + 0.14, cabZ, 0x2a2a2e, null, 12);
    li.cyl(0.145, 0.05, 0, y0 + s.hgt + (s.cabY ?? 0.6) + 0.14, cabZ, 0x56d0e0, null, 12);
    for (const side of [-1, 1]) b.box(0.1, 0.1, 0.1, side * W * 0.42, y0 + s.hgt * 0.9, noseZ - 0.1, 0x2a2a2e);
  }

  /* Mirrors + door lines */
  for (const side of [-1, 1]) {
    b.box(0.16, 0.1, 0.08, side * (W / 2 + 0.08), y0 + s.hgt + (s.cabY ?? 0.6) * 0.4, cabZ + cabL * 0.36, s.blackTrim ? 0x1a1a1e : color);
    b.box(0.02, (s.hgt) * 0.8, 0.02, side * (W / 2 + 0.005), y0 + s.hgt * 0.5, cabZ, 0x000000);
  }
}

function buildVanBody(s, b, c, gl, li, color, yBase) {
  const L = s.len, W = s.wid, H = s.hgt;
  const y0 = yBase;
  const cabL = s.forward ? L * 0.95 : L * (s.cab ?? 0.35);
  const cabZ = s.forward ? 0 : L / 2 - cabL / 2;

  b.box(W, H - y0, L * (s.box ? 0.98 : 1.0), 0, y0 + (H - y0) / 2, s.box ? -L * 0.01 : 0, color);
  if (s.box) {
    // Cutaway cab and a squarer body
    b.box(W * 0.98, (H - y0) * 0.72, cabL, 0, y0 + (H - y0) * 0.36, cabZ, color);
    b.box(W * 1.005, 0.06, L * 0.9, 0, y0 + (H - y0) * 0.62, -L * 0.04, 0x1a1a1e);
    for (let i = 0; i < 6; i++) b.box(W * 1.002, (H - y0) * 0.9, 0.03, 0, y0 + (H - y0) / 2, -L / 2 + 0.3 + i * (L * 0.7 / 6), 0x00000011);
  }
  gl.box(W * 0.92, (H - y0) * 0.3, 0.06, 0, y0 + (H - y0) * 0.66, L / 2 + 0.005, 0xffffff);
  for (const side of [-1, 1]) gl.box(0.05, (H - y0) * 0.26, cabL * 0.7, side * (W / 2 + 0.005), y0 + (H - y0) * 0.64, cabZ, 0xffffff);

  b.box(W * 0.98, 0.28, 0.16, 0, y0 + 0.16, L / 2 + 0.05, s.chrome > 0.3 ? 0xd8dce0 : 0x3a3a3e);
  for (const side of [-1, 1]) {
    li.box(0.34, 0.18, 0.05, side * W * 0.32, y0 + (H - y0) * 0.4, L / 2 + 0.04, 0xf0f4ff);
    li.box(0.22, 0.4, 0.05, side * W * 0.36, y0 + (H - y0) * 0.55, -L / 2 - 0.04, 0xff3a2a);
    b.box(0.16, 0.1, 0.08, side * (W / 2 + 0.09), y0 + (H - y0) * 0.62, L / 2 - 0.3, 0x2a2a2e);
  }
  if (s.forward) {
    // Split screen and a big round badge — the 1965 microbus read
    c.box(0.05, (H - y0) * 0.3, 0.08, 0, y0 + (H - y0) * 0.66, L / 2 + 0.02, 0xd8dce0);
    c.cyl(0.24, 0.05, 0, y0 + (H - y0) * 0.42, L / 2 + 0.03, 0xd8dce0, { x: Math.PI / 2 }, 14);
  }
  if (s.twoTone) b.box(W * 1.004, (H - y0) * 0.42, L * 0.98, 0, y0 + (H - y0) * 0.79, 0, 0xf0ece0);
}

function buildBusBody(s, b, c, gl, li, color, era, yBase) {
  const L = s.len, W = s.wid, H = s.hgt;
  const y0 = s.lowFloor ? 0.32 : 0.5;
  b.box(W, H - y0, L, 0, y0 + (H - y0) / 2, 0, color);
  b.box(W * 1.01, 0.14, L * 0.99, 0, H - 0.1, 0, s.electric ? 0x2a6a5a : 0xd8dce0);
  b.box(W * 1.01, 0.3, L * 0.99, 0, y0 + 0.1, 0, 0x3a3a3e);
  // Window band
  const n = s.windows ?? 8;
  for (let i = 0; i < n; i++) {
    const z = -L / 2 + (i + 0.5) * (L / n);
    for (const side of [-1, 1]) gl.box(0.05, (H - y0) * 0.42, L / n - 0.18, side * (W / 2 + 0.005), y0 + (H - y0) * 0.66, z, 0xffffff);
  }
  gl.box(W * 0.9, (H - y0) * 0.44, 0.06, 0, y0 + (H - y0) * 0.64, L / 2 + 0.005, 0xffffff);
  gl.box(W * 0.9, (H - y0) * 0.38, 0.06, 0, y0 + (H - y0) * 0.66, -L / 2 - 0.005, 0xffffff);
  // Doors
  for (const dz of [L * 0.34, -L * 0.1]) {
    b.box(0.06, (H - y0) * 0.86, 1.1, W / 2 + 0.01, y0 + (H - y0) * 0.44, dz, 0x2a3a3e);
  }
  // Destination sign
  li.box(W * 0.6, 0.24, 0.03, 0, H - 0.34, L / 2 + 0.03, era.year >= 2005 ? 0xe8a020 : 0xf0e8c0);
  for (const side of [-1, 1]) {
    li.box(0.4, 0.24, 0.05, side * W * 0.3, y0 + 0.4, L / 2 + 0.03, 0xf0f4ff);
    li.box(0.3, 0.3, 0.05, side * W * 0.32, y0 + 0.5, -L / 2 - 0.03, 0xff3a2a);
  }
  if (s.electric) for (let i = 0; i < 4; i++) b.box(1.4, 0.3, 1.4, (i % 2 - 0.5) * 1.2, H + 0.15, -L / 4 + i * 1.6, 0x3a4a4a);
}

function buildTrolleyBody(b, c, gl, li, color, yBase) {
  const L = 12.5, W = 2.5, H = 3.2, y0 = 0.55;
  b.box(W, H - y0 - 0.4, L, 0, y0 + (H - y0 - 0.4) / 2, 0, color);
  // Clerestory roof
  b.box(W * 0.98, 0.28, L * 0.99, 0, H - 0.5, 0, 0xd8d0b8);
  b.box(W * 0.6, 0.34, L * 0.9, 0, H - 0.2, 0, 0xd8d0b8);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const z = -L / 2 + (i + 0.5) * (L / 9);
      gl.box(0.05, 1.0, L / 9 - 0.22, side * (W / 2 + 0.005), y0 + 1.35, z, 0xffffff);
      gl.box(0.05, 0.24, L / 9 - 0.3, side * (W * 0.3), H - 0.22, z, 0xffffff);
    }
  }
  c.box(W * 1.01, 0.12, L, 0, y0 + 1.95, 0, 0xc8a850);
  c.box(W * 1.01, 0.1, L, 0, y0 + 0.75, 0, 0xc8a850);
  // Cowcatcher, poles, trolley arm
  b.box(W * 0.9, 0.5, 0.3, 0, 0.35, L / 2 + 0.16, 0x3a3a3a, { x: 0.5 });
  li.cyl(0.16, 0.1, 0, y0 + 1.9, L / 2 + 0.06, 0xfff0c8, { x: Math.PI / 2 }, 10);
  li.box(0.7, 0.24, 0.04, 0, y0 + 2.1, L / 2 + 0.04, 0xf0e8c0);
  b.rod(0, H - 0.05, -L * 0.2, 0, H + 1.5, -L * 0.42, 0.05, 0x3a3a3a);
  b.box(0.5, 0.06, 0.06, 0, H + 1.5, -L * 0.42, 0x8a6a3a);
}

function buildScooter(b, c, gl, color, yBase) {
  const y0 = 0.16;
  b.box(0.42, 0.38, 1.0, 0, y0 + 0.42, -0.1, color);
  b.box(0.3, 0.24, 0.5, 0, y0 + 0.2, 0.4, color);
  b.box(0.44, 0.06, 0.5, 0, y0 + 0.1, 0.1, 0x2a2a2e);
  b.rod(0, y0 + 0.6, 0.55, 0, y0 + 0.95, 0.5, 0.035, 0x8a8e92);
  b.box(0.56, 0.04, 0.05, 0, y0 + 0.95, 0.5, 0x2a2a2e);
  b.box(0.4, 0.3, 0.06, 0, y0 + 0.68, 0.62, color);
  c.cyl(0.1, 0.06, 0, y0 + 0.78, 0.66, 0xd8dce0, { x: Math.PI / 2 }, 10);
  b.box(0.34, 0.1, 0.34, 0, y0 + 0.62, -0.5, 0x2a2a2e);
}

function buildEScooter(b, li, color) {
  b.box(0.2, 0.05, 0.85, 0, 0.14, 0, color);
  b.rod(0, 0.16, 0.4, 0, 1.15, 0.36, 0.03, 0x8a8e92);
  b.box(0.48, 0.04, 0.05, 0, 1.15, 0.36, 0x2a2a2e);
  li.box(0.08, 0.04, 0.04, 0, 1.08, 0.4, 0xf0f4ff);
  li.box(0.06, 0.03, 0.03, 0, 0.2, -0.42, 0xff3a2a);
}

function buildCargoBike(b, li, color) {
  b.box(0.7, 0.55, 0.9, 0, 0.72, 0.5, color);
  b.box(0.72, 0.06, 0.92, 0, 1.02, 0.5, 0x2a2a2e);
  b.rod(0, 0.5, 0.1, 0, 1.05, -0.65, 0.035, 0x2a2a2e);
  b.box(0.5, 0.05, 0.05, 0, 1.08, -0.62, 0x2a2a2e);
  b.box(0.16, 0.1, 0.3, 0, 0.86, -0.5, 0x1a1a1e);
  li.box(0.1, 0.05, 0.04, 0, 0.9, 0.98, 0xf0f4ff);
  li.box(0.08, 0.04, 0.03, 0, 0.6, -0.8, 0xff3a2a);
}

function buildPod(s, b, gl, li, color, era) {
  const L = s.len, W = s.wid, H = s.hgt, y0 = 0.22;
  const seg = 10;
  for (let i = 0; i < seg; i++) {
    const t = (i + 0.5) / seg;
    const z = lerp(-L / 2, L / 2, t);
    const prof = Math.sin(t * Math.PI) ** 0.28;
    b.box(W * lerp(0.86, 1, prof), (H - y0) * lerp(0.6, 1, prof), L / seg + 0.02, 0, y0 + (H - y0) * lerp(0.6, 1, prof) / 2, z, color);
  }
  // A single wrap-around window band — no A-pillars, no driver.
  gl.box(W * 1.002, (H - y0) * 0.44, L * 0.86, 0, y0 + (H - y0) * 0.66, 0, 0xffffff);
  gl.box(W * 0.9, (H - y0) * 0.5, L * 1.002, 0, y0 + (H - y0) * 0.64, 0, 0xffffff);
  b.box(W * 0.96, 0.1, L * 0.9, 0, H - 0.04, 0, 0xd8dcd8);
  li.box(W * 0.7, 0.05, 0.04, 0, y0 + (H - y0) * 0.3, L / 2 + 0.02, 0x9fe8ff);
  li.box(W * 0.7, 0.05, 0.04, 0, y0 + (H - y0) * 0.3, -L / 2 - 0.02, 0xff5a6a);
  li.box(W * 0.98, 0.03, L * 0.9, 0, y0 - 0.02, 0, 0x56d0e0);        // underglow skirt
  if (s.long) for (const dz of [L * 0.2, -L * 0.2]) b.box(0.05, (H - y0) * 0.8, 1.2, W / 2 + 0.01, y0 + (H - y0) * 0.45, dz, 0x2a4a4a);
  b.cyl(0.1, 0.14, 0, H + 0.06, L * 0.2, 0x3a4a4a, null, 10);
  li.cyl(0.105, 0.04, 0, H + 0.06, L * 0.2, 0x56d0e0, null, 10);
}

function buildDrone(b, li, color) {
  b.box(0.7, 0.28, 1.0, 0, 0, 0, color);
  b.box(0.5, 0.4, 0.5, 0, -0.3, 0, 0x8a9a9a);
  for (const [ox, oz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
    b.rod(0, 0, 0, ox, 0.06, oz, 0.03, 0x5a6a6a);
    b.cyl(0.36, 0.03, ox, 0.1, oz, 0x3a4a4a, null, 14);
    li.cyl(0.37, 0.015, ox, 0.13, oz, 0x56d0e0, null, 14);
  }
  li.box(0.3, 0.03, 0.03, 0, -0.14, 0.5, 0x9fe870);
}

function buildWalker(b, li, color) {
  b.box(0.5, 0.6, 0.4, 0, 1.0, 0, color);
  b.box(0.36, 0.22, 0.3, 0, 1.42, 0, 0x2a3a3e);
  li.box(0.24, 0.05, 0.02, 0, 1.44, 0.16, 0x56d0e0);
  for (const side of [-1, 1]) {
    b.rod(side * 0.18, 0.72, 0, side * 0.26, 0.4, 0.1, 0.055, 0x8a9a9a);
    b.rod(side * 0.26, 0.4, 0.1, side * 0.2, 0.05, -0.05, 0.045, 0x8a9a9a);
    b.box(0.16, 0.06, 0.3, side * 0.2, 0.04, -0.02, 0x3a4a4a);
  }
  b.box(0.42, 0.4, 0.3, 0, 1.05, -0.3, 0x6a7a7a);
}

/* ══════════════════════════ traffic AI ══════════════════════════ */

/** A rounded-rectangle loop with arc-length parameterisation. */
function makeRing(radius, dir, corner = 6.5) {
  const pts = [];
  const R = radius, c = corner;
  const arc = (cx, cz, a0, a1) => {
    for (let i = 0; i <= 6; i++) {
      const a = lerp(a0, a1, i / 6);
      pts.push({ x: cx + Math.cos(a) * c, z: cz + Math.sin(a) * c });
    }
  };
  pts.push({ x: -R + c, z: -R });
  pts.push({ x: R - c, z: -R });
  arc(R - c, -R + c, -Math.PI / 2, 0);
  pts.push({ x: R, z: R - c });
  arc(R - c, R - c, 0, Math.PI / 2);
  pts.push({ x: -R + c, z: R });
  arc(-R + c, R - c, Math.PI / 2, Math.PI);
  pts.push({ x: -R, z: -R + c });
  arc(-R + c, -R + c, Math.PI, Math.PI * 1.5);
  if (dir < 0) pts.reverse();

  const cum = [0];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    total += Math.hypot(b.x - a.x, b.z - a.z);
    cum.push(total);
  }
  return { pts, cum, total, radius: R, dir };
}

function ringAt(ring, d) {
  const { pts, cum, total } = ring;
  d = ((d % total) + total) % total;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
  const a = pts[lo], b = pts[(lo + 1) % pts.length];
  const seg = cum[lo + 1] - cum[lo] || 1;
  const f = (d - cum[lo]) / seg;
  return {
    x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f),
    heading: Math.atan2(b.x - a.x, b.z - a.z),
  };
}

/**
 * Signal phases. NS-green lets traffic move along the ring's north/south
 * (vertical, ±x sides) legs; EW-green lets the east/west legs run.
 */
export class Signals {
  constructor() {
    this.t = 0;
    this.phase = 'ns-green';
    this.durations = { 'ns-green': 13, 'ns-amber': 2.6, 'ew-green': 13, 'ew-amber': 2.6 };
    this.order = ['ns-green', 'ns-amber', 'ew-green', 'ew-amber'];
    this.i = 0;
  }
  update(dt) {
    this.t += dt;
    const d = this.durations[this.phase];
    if (this.t >= d) {
      this.t -= d;
      this.i = (this.i + 1) % this.order.length;
      this.phase = this.order[this.i];
    }
  }
  /** Can a vehicle whose heading is mostly along X (true) proceed? */
  canGo(alongX) {
    if (alongX) return this.phase === 'ew-green';
    return this.phase === 'ns-green';
  }
  /** Is the pedestrian crossing parallel to X walkable? */
  walk(alongX) {
    // Pedestrians cross with the parallel traffic, minus the amber.
    return alongX ? this.phase === 'ew-green' : this.phase === 'ns-green';
  }
  get timeLeft() { return Math.max(0, this.durations[this.phase] - this.t); }
}

export class Traffic {
  constructor(scene, mats, quality) {
    this.scene = scene;
    this.mats = mats;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'traffic';
    scene.add(this.group);

    this.rings = [
      // Kerbside parking occupies CURB+1.9 (±1 m of body), so the near lane
      // starts outside that; the far lane keeps a full lane's clearance.
      makeRing(CURB + 4.7, +1),                 // near lane, clockwise
      makeRing(CURB + BLOCK.road - 3.1, -1),    // far lane, anticlockwise
    ];
    this.vehicles = [];
    this.parked = [];
    this.signals = new Signals();
    this.era = null;
  }

  /** Rebuild the fleet for an era. Old models are disposed. */
  populate(era, eraIdx, densityScale = 1) {
    this.clear();
    this.era = era;
    const rnd = new Rand(`traffic:${era.year}`);
    const types = era.vehicles.types;
    const weights = types.map((t) => t.w);
    const n = Math.round(10 * era.vehicles.density * densityScale);

    for (let i = 0; i < n; i++) {
      const spec = rnd.weighted(types, weights);
      const color = rnd.pick(spec.colors);
      const model = buildVehicle(spec.kind, color, era, this.mats, rnd);
      model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
      const ringIdx = rnd.int(0, 1);
      const ring = this.rings[ringIdx];
      const v = {
        model, ring, ringIdx, spec,
        s: (i / n) * ring.total + rnd.range(-6, 6),
        speed: era.vehicles.speed * rnd.range(0.82, 1.14) * (spec.kind.includes('bus') || spec.kind === 'trolley' ? 0.8 : 1),
        cur: 0, len: model.userData.length + 1.6,
        wheelSpin: 0, secret: spec.secret || null,
        stopped: false, brake: 0, hornCd: rnd.range(4, 40),
      };
      this.group.add(model);
      this.vehicles.push(v);
    }
    for (const ring of this.rings) { /* keep sorted per ring for car-following */ }
    this._sort();

    /* Parked cars along the kerb (and in the 1985 lot). */
    this._populateParked(era, eraIdx, rnd, densityScale);
  }

  _populateParked(era, eraIdx, rnd, densityScale) {
    const types = era.vehicles.types.filter((t) => !['trolley', 'cargoDrone', 'walkerBot', 'escooter'].includes(t.kind));
    if (!types.length) return;
    const weights = types.map((t) => t.w);
    const spots = [];
    for (const side of ['N', 'S', 'E', 'W']) {
      for (let i = 0; i < 5; i++) {
        const t = (i + 0.5) / 5;
        const a = lerp(-CURB + 8, CURB - 8, t);
        const o = CURB + 1.9;
        if (side === 'N') spots.push({ x: a, z: -o, rot: Math.PI / 2 });
        else if (side === 'S') spots.push({ x: a, z: o, rot: Math.PI / 2 });
        else if (side === 'E') spots.push({ x: o, z: a, rot: 0 });
        else spots.push({ x: -o, z: a, rot: 0 });
      }
    }
    if (era.lots?.lot?.parkedCars) {
      for (let i = 0; i < era.lots.lot.parkedCars; i++) {
        spots.push({ x: -24 + (i % 3) * 2.8, z: 14 + Math.floor(i / 3) * 5.5, rot: 0, lot: true });
      }
    }
    rnd.shuffle(spots);
    const count = Math.round(spots.length * 0.55 * densityScale);
    for (let i = 0; i < count; i++) {
      const spot = spots[i];
      const spec = rnd.weighted(types, weights);
      const model = buildVehicle(spec.kind, rnd.pick(spec.colors), era, this.mats, rnd);
      model.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
      model.position.set(spot.x, 0, spot.z);
      model.rotation.y = spot.rot + rnd.range(-0.03, 0.03);
      this.group.add(model);
      this.parked.push({ model, secret: spec.secret || null });
    }
  }

  _sort() {
    for (let r = 0; r < this.rings.length; r++) {
      const list = this.vehicles.filter((v) => v.ringIdx === r).sort((a, b) => a.s - b.s);
      this.rings[r].order = list;
    }
  }

  /** Distance from `s` to the next stop line on this ring, or Infinity. */
  _distToStopLine(ring, s, alongX) {
    // Stop lines sit just before each corner arc. Four per ring.
    const quarter = ring.total / 4;
    const idx = Math.floor(s / quarter);
    const next = (idx + 1) * quarter - 4.5;
    let d = next - s;
    if (d < 0) d += ring.total;
    return d;
  }

  update(dt, camPos, audio) {
    this.signals.update(dt);
    if (!this.vehicles.length) return;

    for (let r = 0; r < this.rings.length; r++) {
      const ring = this.rings[r];
      const order = ring.order || [];
      for (let i = 0; i < order.length; i++) {
        const v = order[i];
        const ahead = order[(i + 1) % order.length];
        let gap = Infinity;
        if (ahead && ahead !== v) {
          gap = ahead.s - v.s;
          if (gap < 0) gap += ring.total;
          gap -= v.len;
        }

        const p = ringAt(ring, v.s);
        // Which leg is this? Legs at |z| ≈ radius run along X.
        const alongX = Math.abs(Math.abs(p.z) - ring.radius) < 5.0;
        const dStop = this._distToStopLine(ring, v.s, alongX);
        const mustStop = !this.signals.canGo(alongX) && dStop < 22;

        let target = v.speed;
        if (mustStop) {
          // Smooth deceleration curve into the stop line.
          target = Math.min(target, Math.max(0, (dStop - 1.5) * 0.72));
        }
        if (gap < 14) target = Math.min(target, Math.max(0, (gap - 3.2) * 0.85));

        const accel = target > v.cur ? 4.2 : 9.0;
        v.brake = target < v.cur - 0.6 ? 1 : damp(v.brake, 0, 6, dt);
        v.cur = v.cur + clamp(target - v.cur, -accel * dt, accel * dt);
        v.s += v.cur * dt;
        v.stopped = v.cur < 0.4;

        const q = ringAt(ring, v.s);
        v.model.position.set(q.x, 0, q.z);
        v.model.rotation.y = q.heading + Math.PI;

        // Wheels
        v.wheelSpin += (v.cur / (v.model.userData.wheelR || 0.34)) * dt;
        for (const w of v.model.userData.wheels) w.rotation.x = -v.wheelSpin;

        // Brake lights
        if (v.model.userData.lights) {
          v.model.userData.lights.material.emissiveIntensity = 2.4 + v.brake * 3.2;
        }

        // Occasional horn when queued behind a stopped car
        v.hornCd -= dt;
        if (audio && v.hornCd <= 0 && v.stopped && gap < 8 && Math.random() < 0.02) {
          audio.horn(this.era?.vehicles.horn || 'beep', v.model.position, camPos);
          v.hornCd = 12 + Math.random() * 40;
        }
      }
    }

    // Re-sort occasionally so car-following stays correct after overtakes at 0.
    this._sortTimer = (this._sortTimer || 0) - dt;
    if (this._sortTimer <= 0) { this._sortTimer = 2; this._sort(); }
  }

  /** Nearest moving vehicle to a point — used for engine audio panning. */
  nearest(pos) {
    let best = null, bd = Infinity;
    for (const v of this.vehicles) {
      const d = v.model.position.distanceToSquared(pos);
      if (d < bd) { bd = d; best = v; }
    }
    return best ? { v: best, dist: Math.sqrt(bd) } : null;
  }

  /** Secret vehicles (the stainless coupe, the preserved classic) for the codex. */
  secretsNear(pos, radius = 7) {
    const found = [];
    for (const v of [...this.vehicles, ...this.parked]) {
      if (!v.secret) continue;
      const p = v.model.position;
      if (p.distanceTo(pos) < radius) found.push(v);
    }
    return found;
  }

  clear() {
    for (const v of [...this.vehicles, ...this.parked]) {
      this.group.remove(v.model);
      v.model.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    }
    this.vehicles.length = 0;
    this.parked.length = 0;
  }

  setVisible(v) { this.group.visible = v; }
  dispose() { this.clear(); this.scene.remove(this.group); }
}

export { SPECS, makeRing, ringAt };
