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
import { Tex } from './textures.js';
import { Rand } from '../core/rng.js';
import { clamp, clamp01, lerp, damp, TAU } from '../core/mathx.js';
import { BLOCK } from '../data/eras.js';

const CURB = BLOCK.half + BLOCK.sidewalk;

/* ══════════════════════════ vehicle specs ══════════════════════════ */
/* len/wid/hgt in metres. `cab` is the greenhouse as a fraction of length,
   `cabY` its height, `belt` the beltline height (top of the body sides). */

const SPECS = {
  /* ── 1945: tall, narrow, separate fenders, running boards ── */
  sedan45: { arch: 'car', len: 4.95, wid: 1.8, hgt: 0.92, cab: 0.44, cabY: 0.59, belt: 0.8,
    fenders: 'separate', running: true, wheelR: 0.355, wheelW: 0.16, chrome: 0.5,
    roofRound: 0.9, split: true, visor: true, spare: true, hood: 'long' },
  coupe45: { arch: 'car', len: 4.55, wid: 1.76, hgt: 0.9, cab: 0.34, cabY: 0.55, belt: 0.78,
    fenders: 'separate', running: true, wheelR: 0.35, wheelW: 0.16, chrome: 0.45,
    roofRound: 1.0, split: true, visor: true, hood: 'long' },
  truck45: { arch: 'van', len: 5.3, wid: 1.92, hgt: 2.1, cab: 0.3, cabY: 0.8, belt: 1.0,
    fenders: 'separate', running: true, wheelR: 0.4, wheelW: 0.2, chrome: 0.2, box: true },
  taxi45: { arch: 'car', len: 5.05, wid: 1.82, hgt: 0.96, cab: 0.46, cabY: 0.61, belt: 0.84,
    fenders: 'separate', running: true, wheelR: 0.36, wheelW: 0.17, chrome: 0.5,
    roofRound: 0.85, split: true, taxi: 'roof-light', checker: true, hood: 'long' },
  trolley: { arch: 'trolley', len: 12.5, wid: 2.5, hgt: 3.2 },

  /* ── 1965: long, low, finned, chrome-heavy ── */
  finSedan: { arch: 'car', len: 5.7, wid: 2.02, hgt: 0.7, cab: 0.42, cabY: 0.54, belt: 0.64,
    fenders: 'integrated', wheelR: 0.345, wheelW: 0.2, chrome: 1.0, fins: 0.34,
    roofRound: 0.2, quad: true, twoTone: true, hood: 'flat' },
  wagon65: { arch: 'wagon', len: 5.6, wid: 2.0, hgt: 0.74, cab: 0.56, cabY: 0.55, belt: 0.68,
    fenders: 'integrated', wheelR: 0.345, wheelW: 0.2, chrome: 0.8, fins: 0.14, wood: true },
  muscle65: { arch: 'car', len: 5.05, wid: 1.92, hgt: 0.66, cab: 0.36, cabY: 0.48, belt: 0.6,
    fenders: 'integrated', wheelR: 0.35, wheelW: 0.24, chrome: 0.6, roofRound: 0.15,
    stripe: true, hood: 'scoop' },
  van65: { arch: 'van', len: 4.28, wid: 1.75, hgt: 1.94, cab: 0.9, cabY: 0.86, belt: 0.9,
    fenders: 'integrated', wheelR: 0.33, wheelW: 0.18, chrome: 0.4, forward: true, twoTone: true },
  bus65: { arch: 'bus', len: 11.0, wid: 2.55, hgt: 3.0, chrome: 0.5, windows: 9 },
  taxi65: { arch: 'car', len: 5.45, wid: 1.98, hgt: 0.72, cab: 0.44, cabY: 0.56, belt: 0.66,
    fenders: 'integrated', wheelR: 0.345, wheelW: 0.2, chrome: 0.8, fins: 0.18,
    taxi: 'roof-light', hood: 'flat' },
  scooter65: { arch: 'scooter', len: 1.8, wid: 0.7, hgt: 1.1 },

  /* ── 1985: boxes, flat panels, plastic bumpers ── */
  boxSedan: { arch: 'car', len: 4.7, wid: 1.72, hgt: 0.72, cab: 0.46, cabY: 0.48, belt: 0.68,
    fenders: 'integrated', wheelR: 0.315, wheelW: 0.19, chrome: 0.25, boxy: 1,
    roofRound: 0.02, hood: 'flat', bumper: 'plastic' },
  woodWagon: { arch: 'wagon', len: 5.1, wid: 1.84, hgt: 0.76, cab: 0.58, cabY: 0.52, belt: 0.72,
    fenders: 'integrated', wheelR: 0.325, wheelW: 0.19, chrome: 0.2, boxy: 1, wood: true },
  hatch85: { arch: 'hatch', len: 3.72, wid: 1.58, hgt: 0.7, cab: 0.5, cabY: 0.48, belt: 0.66,
    fenders: 'integrated', wheelR: 0.285, wheelW: 0.17, chrome: 0.1, boxy: 1 },
  pickup85: { arch: 'pickup', len: 5.25, wid: 1.92, hgt: 0.98, cab: 0.34, cabY: 0.62, belt: 0.92,
    fenders: 'integrated', wheelR: 0.385, wheelW: 0.24, chrome: 0.3, boxy: 1, lifted: 0.12 },
  taxi85: { arch: 'car', len: 5.2, wid: 1.86, hgt: 0.76, cab: 0.46, cabY: 0.5, belt: 0.72,
    fenders: 'integrated', wheelR: 0.33, wheelW: 0.2, chrome: 0.3, boxy: 1, taxi: 'roof-sign' },
  van85: { arch: 'van', len: 5.05, wid: 1.9, hgt: 2.02, cab: 0.34, cabY: 0.84, belt: 1.0,
    fenders: 'integrated', wheelR: 0.33, wheelW: 0.2, chrome: 0.15, boxy: 1 },
  delorean: { arch: 'car', len: 4.27, wid: 1.99, hgt: 0.6, cab: 0.38, cabY: 0.42, belt: 0.54,
    fenders: 'integrated', wheelR: 0.3, wheelW: 0.22, chrome: 0.0, wedge: 0.9,
    steel: true, louvre: true, hood: 'wedge' },

  /* ── 2005: tall crossovers, rounded corners, body cladding ── */
  suv05: { arch: 'suv', len: 4.72, wid: 1.86, hgt: 1.06, cab: 0.56, cabY: 0.62, belt: 0.98,
    fenders: 'integrated', wheelR: 0.365, wheelW: 0.22, chrome: 0.3, cladding: true, rails: true },
  sedan05: { arch: 'car', len: 4.72, wid: 1.78, hgt: 0.74, cab: 0.5, cabY: 0.5, belt: 0.7,
    fenders: 'integrated', wheelR: 0.315, wheelW: 0.2, chrome: 0.25, roofRound: 0.35 },
  minivan05: { arch: 'van', len: 5.0, wid: 1.92, hgt: 1.62, cab: 0.72, cabY: 0.72, belt: 0.98,
    fenders: 'integrated', wheelR: 0.33, wheelW: 0.2, chrome: 0.2, glassy: true },
  hybrid05: { arch: 'hatch', len: 4.42, wid: 1.7, hgt: 0.76, cab: 0.62, cabY: 0.52, belt: 0.72,
    fenders: 'integrated', wheelR: 0.3, wheelW: 0.17, chrome: 0.1, kamm: true },
  taxi05: { arch: 'suv', len: 4.85, wid: 1.88, hgt: 1.04, cab: 0.56, cabY: 0.62, belt: 0.96,
    fenders: 'integrated', wheelR: 0.36, wheelW: 0.22, chrome: 0.2, taxi: 'roof-sign', cladding: true },
  bus05: { arch: 'bus', len: 12.0, wid: 2.55, hgt: 3.05, chrome: 0.15, windows: 8, lowFloor: true },
  deliveryVan05: { arch: 'van', len: 5.7, wid: 2.02, hgt: 2.32, cab: 0.3, cabY: 0.84, belt: 1.05,
    fenders: 'integrated', wheelR: 0.355, wheelW: 0.22, chrome: 0.05, box: true },
  moped05: { arch: 'scooter', len: 1.9, wid: 0.7, hgt: 1.12 },

  /* ── 2025: sealed EV faces, big wheels, black trim ── */
  ev25: { arch: 'car', len: 4.7, wid: 1.86, hgt: 0.76, cab: 0.58, cabY: 0.48, belt: 0.72,
    fenders: 'integrated', wheelR: 0.34, wheelW: 0.22, chrome: 0.05, sealed: true,
    lightBar: true, roofRound: 0.42, blackTrim: true },
  crossover25: { arch: 'suv', len: 4.55, wid: 1.84, hgt: 1.0, cab: 0.56, cabY: 0.56, belt: 0.94,
    fenders: 'integrated', wheelR: 0.36, wheelW: 0.23, chrome: 0.05, blackTrim: true, lightBar: true },
  cargoBike: { arch: 'cargobike', len: 2.4, wid: 0.9, hgt: 1.5 },
  escooter: { arch: 'escooter', len: 1.2, wid: 0.5, hgt: 1.2 },
  rideshare25: { arch: 'car', len: 4.78, wid: 1.82, hgt: 0.76, cab: 0.56, cabY: 0.5, belt: 0.72,
    fenders: 'integrated', wheelR: 0.33, wheelW: 0.21, chrome: 0.05, taxi: 'roof-puck', blackTrim: true },
  deliveryVan25: { arch: 'van', len: 5.85, wid: 2.02, hgt: 2.46, cab: 0.28, cabY: 0.84, belt: 1.05,
    fenders: 'integrated', wheelR: 0.355, wheelW: 0.22, chrome: 0.02, box: true, blackTrim: true },
  bus25: { arch: 'bus', len: 12.2, wid: 2.55, hgt: 3.15, chrome: 0.05, windows: 8, lowFloor: true, electric: true },
  angularTruck: { arch: 'car', len: 5.68, wid: 2.03, hgt: 0.92, cab: 0.5, cabY: 0.6, belt: 0.86,
    fenders: 'integrated', wheelR: 0.4, wheelW: 0.26, chrome: 0, steel: true, wedge: 1.0,
    faceted: true, lightBar: true },
  lidarCar: { arch: 'suv', len: 4.68, wid: 1.84, hgt: 1.0, cab: 0.56, cabY: 0.58, belt: 0.94,
    fenders: 'integrated', wheelR: 0.35, wheelW: 0.22, chrome: 0.1, lidar: true, sensors: true },

  /* ── 2055: single-volume pods, no driver, lit skirts ── */
  pod55: { arch: 'pod', len: 4.2, wid: 1.9, hgt: 1.8, wheelR: 0.33, wheelW: 0.2 },
  shuttle55: { arch: 'pod', len: 6.4, wid: 2.2, hgt: 2.42, wheelR: 0.35, wheelW: 0.22, long: true },
  cargoDrone: { arch: 'drone', len: 1.6, wid: 1.6, hgt: 0.7 },
  walkerBot: { arch: 'walker', len: 0.9, wid: 0.7, hgt: 1.4 },
  classicCar: { arch: 'car', len: 5.7, wid: 2.02, hgt: 0.7, cab: 0.42, cabY: 0.54, belt: 0.64,
    fenders: 'integrated', wheelR: 0.345, wheelW: 0.2, chrome: 1.0, fins: 0.34,
    roofRound: 0.2, quad: true, hood: 'flat' },
};

/* ══════════════════════════ model builder ══════════════════════════ */

const CHROME = 0xd8dce0;
const GLASSC = 0x9ac0d8;
// Rubber is not black. A tyre in daylight is a dusty dark grey, and at 0x14
// it disappeared into the shadow under the arch — the car read as a body
// floating over two holes with a hubcap in each.
const TYRE = 0x35353a;
const BLACKTRIM = 0x16161a;

/**
 * Vehicles are lofted, not boxed.
 *
 * The body is sampled at ~18 stations along its length; at each station the
 * generator works out a half-width, a roof height and — crucially — a *sill*
 * height that lifts over each axle to cut a real wheel arch. That single trick
 * is most of the difference between "a box with wheels" and something that
 * reads as a car: the arch is the silhouette everyone recognises.
 *
 * On top of the shell: a separately lofted greenhouse with its own pillars, an
 * interior with seats and a driver you can see through the glass, chrome that
 * follows the beltline, lamps that actually emit, and a numberplate.
 */
export function buildVehicle(kind, color, era, mats, rnd) {
  const s = SPECS[kind] || SPECS.sedan05;
  const g = new THREE.Group();
  const body = new Bucket();       // painted shell
  const chrome = new Bucket();     // brightwork
  const dark = new Bucket();       // rubber, plastic, shadow gaps
  const glass = new Bucket();
  const lights = new Bucket();     // emissive
  const inside = new Bucket();     // seats, dash, occupants
  const wheels = [];

  const L = s.len, W = s.wid;
  const wr = s.wheelR ?? 0.34;
  const yBase = wr * 0.60 + (s.lifted ?? 0);
  const axles = axlePositions(s, L);

  switch (s.arch) {
    case 'car': case 'wagon': case 'hatch': case 'suv': case 'pickup':
      loftCar(s, body, chrome, dark, glass, lights, inside, color, era, rnd, yBase, axles);
      break;
    case 'van': loftVan(s, body, chrome, dark, glass, lights, inside, color, era, yBase, axles); break;
    case 'bus': loftBus(s, body, chrome, dark, glass, lights, inside, color, era, axles); break;
    case 'trolley': loftTrolley(body, chrome, dark, glass, lights, inside, color); break;
    case 'scooter': buildScooter(body, chrome, dark, glass, lights, color, era); break;
    case 'escooter': buildEScooter(body, dark, lights, color); break;
    case 'cargobike': buildCargoBike(body, dark, lights, color); break;
    case 'pod': loftPod(s, body, dark, glass, lights, inside, color, era); break;
    case 'drone': buildDrone(body, dark, lights, color); break;
    case 'walker': buildWalker(body, dark, lights, color); break;
    default: break;
  }

  /* ── wheels ─────────────────────────────────────────────────── */
  if (!['drone', 'walker'].includes(s.arch)) {
    const ww = s.wheelW ?? 0.2;
    const single = s.arch === 'scooter' || s.arch === 'escooter' || s.arch === 'cargobike';
    const sides = single ? [0] : [-1, 1];
    const wheelMat = mats.vcol('matte');
    const whitewall = (era.year <= 1965) && (s.chrome ?? 0) > 0.3;
    const spoke = era.year >= 2005 ? 5 : era.year >= 1985 ? 4 : 0;

    for (const ax of axles) {
      for (const side of sides) {
        const wb = new Bucket();
        // Tyre: a carcass plus a slightly narrower shoulder, so the tread band
        // catches light differently from the sidewall.
        wb.cyl(wr, ww, 0, 0, 0, TYRE, { z: Math.PI / 2 }, 20);
        wb.cyl(wr * 0.995, ww * 1.04, 0, 0, 0, 0x2a2a2f, { z: Math.PI / 2 }, 20);
        // Sidewall lettering catches the light and gives the wheel a radius.
        wb.cyl(wr * 0.86, ww * 1.05, 0, 0, 0, 0x44444a, { z: Math.PI / 2 }, 18);
        if (whitewall) wb.cyl(wr * 0.80, ww * 1.06, 0, 0, 0, 0xd8d4cc, { z: Math.PI / 2 }, 18);
        // Rim
        const rimR = wr * (era.year <= 1965 ? 0.56 : 0.66);
        wb.cyl(rimR, ww * 1.02, 0, 0, 0, s.steel ? 0x9aa0a6 : (era.year >= 2005 ? 0x8a9098 : CHROME), { z: Math.PI / 2 }, 14);
        if ((s.chrome ?? 0) > 0.45) {
          wb.cyl(rimR * 0.62, ww * 1.10, 0, 0, 0, CHROME, { z: Math.PI / 2 }, 14);  // hubcap
          wb.cyl(rimR * 0.22, ww * 1.14, 0, 0, 0, 0xb0141a, { z: Math.PI / 2 }, 10);// centre badge
        } else if (spoke) {
          wb.cyl(rimR * 0.30, ww * 1.06, 0, 0, 0, 0x3a3a40, { z: Math.PI / 2 }, 10);
          for (let k = 0; k < spoke; k++) {
            wb.box(rimR * 1.5, 0.055, ww * 0.55, 0, 0, 0, era.year >= 2025 ? 0x2a2a2e : 0x8a9098, { x: k * TAU / spoke });
          }
        } else {
          wb.cyl(rimR * 0.34, ww * 1.06, 0, 0, 0, 0x6a6a70, { z: Math.PI / 2 }, 10);
        }
        // Brake disc peeking through, for anything modern enough to have one
        if (era.year >= 1985) wb.cyl(wr * 0.44, ww * 0.5, 0, 0, 0, 0x5a5a60, { z: Math.PI / 2 }, 12);

        const wm = wb.mesh(wheelMat, { receive: false });
        if (wm) {
          wm.position.set(side * (W / 2 - ww * 0.42), wr, ax);
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
  add(body, mats.vcol('car'));
  add(chrome, mats.vcol('metal'));
  add(dark, mats.vcol('matte'));
  const im = inside.mesh(mats.vcol('matte'), { cast: false, receive: false });
  if (im) g.add(im);
  const gm = glass.mesh(mats.glass(GLASSC, { opacity: era.year >= 1985 ? 0.5 : 0.42, rough: 0.04 }), { cast: false, receive: false });
  if (gm) { gm.renderOrder = 2; g.add(gm); }
  const lm = lights.mesh(mats.emitVcol({ strength: 2.6 }), { cast: false });
  if (lm) g.add(lm);

  /* Headlight beams. Two stretched additive cones lying along the road ahead —
     the single cheapest thing that makes a night street feel occupied. */
  let beams = null;
  if (!['drone', 'walker', 'escooter'].includes(s.arch)) {
    beams = new THREE.Group();
    const beamMat = mats.glow(s.arch === 'pod' ? 0xbfe8ff : era.year <= 1965 ? 0xffe6b4 : 0xf0f6ff,
      { strength: 1.0, tex: Tex.glowWide() });
    const beamLen = 9 + L * 0.6;
    const spread = s.arch === 'scooter' || s.arch === 'cargobike' ? 0 : W * 0.30;
    for (const side of (spread ? [-1, 1] : [0])) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 12, 1, true), beamMat);
      cone.scale.set(1.5, beamLen, 1.5);
      cone.rotation.x = Math.PI / 2;
      cone.position.set(side * spread, yBase + (s.hgt ?? 0.8) * 0.55, L / 2 + beamLen / 2 - 0.2);
      cone.frustumCulled = false;
      beams.add(cone);
    }
    beams.visible = false;
    beams.userData.mat = beamMat;
    g.add(beams);
  }

  g.userData = { kind, spec: s, wheels, wheelR: wr, lights: lm, beams, length: L, width: W };
  return g;
}

function axlePositions(s, L) {
  if (s.arch === 'bus' || s.arch === 'trolley') return [-L * 0.33, L * 0.31];
  if (s.arch === 'scooter' || s.arch === 'escooter') return [-L * 0.36, L * 0.36];
  if (s.arch === 'cargobike') return [-L * 0.34, L * 0.36];
  return [-L * 0.315, L * 0.30];
}

/**
 * Sill height at a station: normally the rocker line, but lifted over each
 * axle along a semicircle to cut the wheel arch.
 */
function sillAt(z, axles, wr, base, archLift) {
  let y = base;
  for (const ax of axles) {
    const d = Math.abs(z - ax);
    const R = wr * 1.34;
    if (d < R) y = Math.max(y, base + Math.sqrt(1 - (d / R) ** 2) * archLift);
  }
  return y;
}

/* ── cars, wagons, hatchbacks, crossovers, pickups ────────────────── */

function loftCar(s, b, c, dk, gl, li, inr, color, era, rnd, yBase, axles) {
  const L = s.len, W = s.wid, H = s.hgt;
  const wr = s.wheelR ?? 0.34;
  const boxy = s.boxy ?? 0;
  const arch = s.arch;
  const belt = s.belt ?? 0.8;
  const archLift = wr * (arch === 'suv' || arch === 'pickup' ? 0.72 : 0.58);

  /* ── main shell ───────────────────────────────────────────── */
  const SEG = 18;
  const segL = L / SEG;
  for (let i = 0; i < SEG; i++) {
    const t = (i + 0.5) / SEG;
    const z = lerp(-L / 2, L / 2, t);
    // Plan taper: pre-war cars pinch hard at the nose and tail; 80s boxes barely do.
    const plan = lerp(1 - 0.20 * (1 - boxy), 1, Math.sin(t * Math.PI) ** 0.42);
    const wid = W * plan;
    // Side profile: a slight rise over the cabin, a drop at the nose.
    const wedge = s.wedge ? lerp(-0.13 * s.wedge, 0.05, t) : 0;
    const top = yBase + H * lerp(0.86, 1.0, Math.sin(t * Math.PI) ** 0.35) + wedge;
    const sill = sillAt(z, axles, wr, yBase - 0.10, archLift);
    const hgt = Math.max(0.06, top - sill);
    b.box(wid, hgt, segL + 0.02, 0, sill + hgt / 2, z, color);
    // Rocker shadow gap
    dk.box(wid * 1.002, 0.05, segL + 0.02, 0, sill + 0.025, z, BLACKTRIM);
  }

  /* Wheel-arch lips */
  for (const side of [-1, 1]) {
    for (const ax of axles) {
      const R = wr * 1.30;
      for (let k = 0; k <= 9; k++) {
        const a = Math.PI * (0.06 + (k / 9) * 0.88);
        const px = side * (W / 2 + 0.012);
        const py = yBase - 0.10 + Math.sin(a) * archLift * 1.02;
        const pz = ax + Math.cos(a) * R * 0.82;
        b.box(0.05, 0.10, 0.20, px, py, pz, s.blackTrim ? BLACKTRIM : color, { x: -a + Math.PI / 2 });
      }
    }
  }

  /* Separate fenders + running boards (pre-war shapes) */
  if (s.fenders === 'separate') {
    for (const side of [-1, 1]) {
      for (const ax of axles) {
        const fr = wr + 0.17;
        for (let i = 0; i < 9; i++) {
          const a = Math.PI * (0.05 + (i / 9) * 0.90);
          b.box(0.30, 0.15, 0.26, side * (W / 2 - 0.01), yBase - 0.12 + Math.sin(a) * fr,
            ax + Math.cos(a) * fr * 0.94, color, { x: -a + Math.PI / 2 });
        }
      }
      if (s.running) {
        b.box(0.32, 0.09, L * 0.34, side * (W / 2 - 0.03), yBase - 0.07, 0, BLACKTRIM);
        c.box(0.34, 0.02, L * 0.33, side * (W / 2 - 0.03), yBase - 0.02, 0, CHROME);
      }
    }
    if (s.spare) {
      c.cyl(wr * 0.92, 0.17, 0, yBase + H * 0.58, -L / 2 - 0.14, TYRE, { z: Math.PI / 2 }, 16);
      c.cyl(wr * 0.5, 0.19, 0, yBase + H * 0.58, -L / 2 - 0.14, CHROME, { z: Math.PI / 2 }, 12);
    }
  }

  /* Beltline crease + two-tone + side spear */
  const beltY = yBase + belt * 0.72;
  if (s.twoTone) b.box(W * 1.006, belt * 0.30, L * 0.86, 0, yBase + belt * 0.88, 0, 0xf0ece0);
  if ((s.chrome ?? 0) > 0.55) {
    c.box(W * 1.008, 0.035, L * 0.80, 0, beltY, L * 0.02, CHROME);          // side spear
    c.box(W * 1.006, 0.022, L * 0.30, 0, beltY - 0.14, -L * 0.22, CHROME);
  } else if (s.blackTrim) {
    dk.box(W * 1.006, 0.05, L * 0.84, 0, yBase + 0.16, 0, BLACKTRIM);        // rocker cladding
  }
  if (s.stripe) {
    b.box(0.24, 0.02, L * 0.94, -0.30, yBase + H + 0.005, 0, 0xf0ece0);
    b.box(0.24, 0.02, L * 0.94, 0.30, yBase + H + 0.005, 0, 0xf0ece0);
  }
  if (s.cladding) dk.box(W * 1.012, 0.26, L * 0.92, 0, yBase + 0.14, 0, 0x3a3a3e);

  /* Door shut-lines: thin dark slots read as panel gaps at any distance. */
  const doorZ = arch === 'pickup' ? [L * 0.06] : [L * 0.06, -L * 0.20];
  for (const side of [-1, 1]) {
    for (const dz of doorZ) {
      dk.box(0.014, H * 0.72, 0.022, side * (W / 2 + 0.004), yBase + H * 0.42, dz, 0x000000);
    }
    // Handle
    c.box(0.028, 0.04, 0.16, side * (W / 2 + 0.02), beltY - 0.10, doorZ[0] - 0.34,
      (s.chrome ?? 0) > 0.3 ? CHROME : BLACKTRIM);
  }

  /* ── greenhouse ───────────────────────────────────────────── */
  const cabL = L * (s.cab ?? 0.45);
  const cabY = s.cabY ?? 0.6;
  const cabZ = arch === 'pickup' ? -L * 0.10 : arch === 'wagon' || arch === 'hatch' ? L * 0.02 : 0;
  const roofRound = s.roofRound ?? 0.3;
  const cabW = W * (0.885 - roofRound * 0.05);
  const cabBase = yBase + H - 0.02;

  const CSEG = 12;
  for (let i = 0; i < CSEG; i++) {
    const t = (i + 0.5) / CSEG;
    const z = cabZ + lerp(-cabL / 2, cabL / 2, t);
    const prof = Math.sin(t * Math.PI) ** (0.20 + roofRound * 0.85);
    const hgt = cabY * lerp(1 - roofRound * 0.55, 1, prof);
    const wdt = cabW * lerp(0.88, 1, Math.sin(t * Math.PI) ** 0.28);
    b.box(wdt, hgt, cabL / CSEG + 0.02, 0, cabBase + hgt / 2, z, color);
  }

  /* Glazing sits inboard of the shell, with pillars painted over it. */
  const glassY = cabBase + cabY * 0.50;
  const glassH = cabY * 0.62;
  gl.box(cabW * 0.995, glassH, cabL * 0.92, 0, glassY, cabZ, 0xffffff);
  gl.box(cabW * 0.86, glassH * 0.96, cabL * 1.0, 0, glassY, cabZ, 0xffffff);

  // A/B/C pillars
  const pillarW = era.year <= 1965 ? 0.075 : 0.10;
  for (const side of [-1, 1]) {
    const px = side * (cabW / 2 - 0.005);
    b.box(pillarW, cabY * 0.9, 0.10, px, cabBase + cabY * 0.5, cabZ + cabL / 2 - 0.07, color, { x: -0.30 });
    b.box(pillarW, cabY * 0.9, 0.10, px, cabBase + cabY * 0.5, cabZ - cabL / 2 + 0.07, color, { x: 0.26 });
    if (arch !== 'hatch') b.box(pillarW * 0.8, cabY * 0.9, 0.07, px, cabBase + cabY * 0.5, cabZ - cabL * 0.06, color);
    // Window surround
    if ((s.chrome ?? 0) > 0.35) {
      c.box(0.02, 0.03, cabL * 0.86, px + side * 0.006, cabBase + cabY * 0.18, cabZ, CHROME);
      c.box(0.02, 0.03, cabL * 0.86, px + side * 0.006, cabBase + cabY * 0.82, cabZ, CHROME);
    } else if (s.blackTrim) {
      dk.box(0.02, 0.03, cabL * 0.86, px + side * 0.006, cabBase + cabY * 0.18, cabZ, BLACKTRIM);
    }
  }
  // Roof panel + drip rails
  b.box(cabW * 0.95, 0.05, cabL * 0.84, 0, cabBase + cabY - 0.02, cabZ, color);
  if (era.year <= 1985) {
    for (const side of [-1, 1]) c.box(0.03, 0.03, cabL * 0.8, side * cabW * 0.46, cabBase + cabY - 0.05, cabZ, (s.chrome ?? 0) > 0.3 ? CHROME : BLACKTRIM);
  }
  if (s.split) c.box(0.045, glassH, 0.05, 0, glassY, cabZ + cabL / 2 - 0.03, CHROME);
  if (s.louvre) for (let i = 0; i < 8; i++) dk.box(cabW * 0.88, 0.02, 0.055, 0, glassY + cabY * 0.28 - i * 0.055, cabZ - cabL / 2 + 0.12, 0x2a2a2e);

  /* ── interior ─────────────────────────────────────────────── */
  const seatCol = era.year <= 1965 ? 0x6a5a4a : era.year <= 1985 ? 0x4a4a52 : 0x2a2a30;
  const cabin = cabBase - 0.10;
  inr.box(cabW * 0.9, 0.06, cabL * 0.8, 0, cabin, cabZ, 0x2a2a2e);              // floor/tunnel
  inr.box(cabW * 0.86, 0.34, 0.16, 0, cabin + 0.19, cabZ + cabL * 0.22, seatCol);   // front seat back
  inr.box(cabW * 0.86, 0.34, 0.16, 0, cabin + 0.19, cabZ - cabL * 0.18, seatCol);   // rear seat back
  inr.box(cabW * 0.86, 0.10, 0.30, 0, cabin + 0.06, cabZ + cabL * 0.10, seatCol);
  inr.box(cabW * 0.9, 0.16, 0.20, 0, cabin + 0.14, cabZ + cabL / 2 - 0.10, 0x1a1a1e); // dash
  // Steering wheel, on whichever side the era drives
  const drvX = -cabW * 0.24;
  inr.cyl(0.14, 0.028, drvX, cabin + 0.30, cabZ + cabL * 0.30, 0x1a1a1e, { x: 1.15 }, 14);
  inr.cyl(0.03, 0.16, drvX, cabin + 0.25, cabZ + cabL * 0.36, 0x2a2a30, { x: 1.15 }, 8);
  if (!s.lidar && era.year < 2055) {
    // A driver: shoulders and a head, enough to read through the glass.
    inr.box(0.34, 0.30, 0.20, drvX, cabin + 0.30, cabZ + cabL * 0.12, era.peds ? 0x3a3a44 : 0x3a3a44);
    inr.sphere(0.105, drvX, cabin + 0.56, cabZ + cabL * 0.10, 0xd8ac84, true);
    if (era.year <= 1955) inr.cyl(0.13, 0.06, drvX, cabin + 0.64, cabZ + cabL * 0.10, 0x2a2620, null, 10);
    if (Math.random() < 0.45) {
      inr.box(0.30, 0.28, 0.18, cabW * 0.22, cabin + 0.29, cabZ + cabL * 0.12, 0x5a4a5a);
      inr.sphere(0.10, cabW * 0.22, cabin + 0.54, cabZ + cabL * 0.10, 0xe8c4a0, true);
    }
  }

  /* ── nose & tail ──────────────────────────────────────────── */
  const noseZ = L / 2, tailZ = -L / 2;
  const bumperY = yBase + (arch === 'suv' || arch === 'pickup' ? 0.24 : 0.16);
  if ((s.chrome ?? 0) > 0.15) {
    c.box(W * 0.96, 0.17, 0.20, 0, bumperY, noseZ + 0.07, CHROME);
    c.box(W * 0.96, 0.15, 0.18, 0, bumperY, tailZ - 0.07, CHROME);
    if ((s.chrome ?? 0) > 0.6) {
      for (const side of [-1, 1]) {
        c.cyl(0.115, 0.30, side * W * 0.30, bumperY + 0.03, noseZ + 0.11, CHROME, { z: Math.PI / 2 }, 12);
        c.box(0.10, 0.26, 0.18, side * W * 0.22, bumperY + 0.10, noseZ + 0.08, CHROME);  // overriders
      }
    }
  } else if (s.bumper === 'plastic') {
    dk.box(W * 0.99, 0.32, 0.22, 0, bumperY + 0.03, noseZ + 0.05, 0x3a3a3e);
    dk.box(W * 0.99, 0.30, 0.20, 0, bumperY + 0.03, tailZ - 0.05, 0x3a3a3e);
  } else {
    b.box(W * 0.995, 0.36, 0.16, 0, bumperY + 0.05, noseZ + 0.02, s.blackTrim ? BLACKTRIM : color);
    b.box(W * 0.995, 0.34, 0.16, 0, bumperY + 0.05, tailZ - 0.02, s.blackTrim ? BLACKTRIM : color);
  }

  /* Grille */
  if (!s.sealed) {
    const gw = W * ((s.chrome ?? 0) > 0.6 ? 0.74 : 0.52);
    const gh = H * ((s.chrome ?? 0) > 0.6 ? 0.50 : 0.30);
    const gy = yBase + H * 0.52;
    dk.box(gw, gh, 0.06, 0, gy, noseZ + 0.015, 0x101014);
    const bars = (s.chrome ?? 0) > 0.6 ? 8 : 4;
    for (let i = 0; i < bars; i++) {
      c.box(gw * 0.95, gh / bars * 0.42, 0.09, 0, gy - gh / 2 + (i + 0.5) * gh / bars, noseZ + 0.045,
        (s.chrome ?? 0) > 0.3 ? CHROME : 0x4a4a50);
    }
    if ((s.chrome ?? 0) > 0.5) c.box(gw + 0.08, gh + 0.07, 0.05, 0, gy, noseZ + 0.02, CHROME);
    // Badge
    c.cyl(0.05, 0.03, 0, gy + gh * 0.62, noseZ + 0.06, CHROME, { x: Math.PI / 2 }, 10);
  } else {
    dk.box(W * 0.72, H * 0.22, 0.05, 0, yBase + H * 0.56, noseZ + 0.02, BLACKTRIM);
    dk.box(W * 0.44, 0.09, 0.06, 0, yBase + 0.30, noseZ + 0.03, BLACKTRIM);   // cooling slot
  }
  if (s.hood === 'scoop') b.box(W * 0.36, 0.10, L * 0.14, 0, yBase + H + 0.04, L * 0.26, color);

  /* Lamps */
  const lampY = yBase + H * ((s.chrome ?? 0) > 0.6 ? 0.72 : 0.62);
  if (s.lightBar) {
    li.box(W * 0.88, 0.075, 0.05, 0, lampY, noseZ + 0.035, 0xf2f6ff);
    li.box(W * 0.88, 0.075, 0.05, 0, lampY, tailZ - 0.035, 0xff3524);
    dk.box(W * 0.90, 0.13, 0.03, 0, lampY, noseZ + 0.02, BLACKTRIM);
  } else if (s.quad) {
    for (const side of [-1, 1]) for (const o of [-0.155, 0.155]) {
      c.cyl(0.115, 0.09, side * W * 0.33 + o * side, lampY, noseZ + 0.015, CHROME, { x: Math.PI / 2 }, 12);
      li.cyl(0.092, 0.06, side * W * 0.33 + o * side, lampY, noseZ + 0.055, 0xfff6dc, { x: Math.PI / 2 }, 12);
    }
  } else if (s.fenders === 'separate') {
    for (const side of [-1, 1]) {
      c.sphere(0.145, side * W * 0.37, yBase + H * 0.92, noseZ - L * 0.07, CHROME);
      li.cyl(0.115, 0.05, side * W * 0.37, yBase + H * 0.92, noseZ - L * 0.07 + 0.10, 0xfff6dc, { x: Math.PI / 2 }, 12);
      c.rod(side * W * 0.37, yBase + H * 0.80, noseZ - L * 0.07, side * W * 0.30, yBase + H * 0.55, noseZ - L * 0.10, 0.018, CHROME);
    }
  } else {
    for (const side of [-1, 1]) {
      dk.box(0.46, 0.17, 0.05, side * W * 0.30, lampY, noseZ + 0.012, BLACKTRIM);
      li.box(0.42, 0.13, 0.05, side * W * 0.30, lampY, noseZ + 0.035, 0xf2f6ff);
      li.box(0.11, 0.09, 0.05, side * W * 0.30 + side * 0.16, lampY, noseZ + 0.038, 0xffa028);  // indicator
    }
  }
  for (const side of [-1, 1]) {
    const tw = s.boxy ? 0.32 : 0.38, th = s.boxy ? 0.22 : 0.15;
    dk.box(tw + 0.04, th + 0.04, 0.04, side * W * 0.32, lampY, tailZ - 0.012, BLACKTRIM);
    li.box(tw, th, 0.045, side * W * 0.32, lampY, tailZ - 0.035, 0xff3524);
    li.box(tw * 0.3, th * 0.5, 0.046, side * W * 0.32 - side * tw * 0.32, lampY, tailZ - 0.037, 0xffb040);
  }

  /* Numberplate */
  const plateY = yBase + (arch === 'suv' ? 0.30 : 0.20);
  li.box(0.34, 0.11, 0.02, 0, plateY, noseZ + 0.10, 0xdedad0);
  li.box(0.34, 0.11, 0.02, 0, plateY, tailZ - 0.10, 0xdedad0);

  /* Exhaust */
  if (era.year < 2025) {
    c.cyl(0.035, 0.16, W * 0.26, yBase - 0.02, tailZ - 0.05, 0x9a9aa0, { x: Math.PI / 2 }, 8);
    if ((s.chrome ?? 0) > 0.5) c.cyl(0.05, 0.10, W * 0.26, yBase - 0.02, tailZ - 0.11, CHROME, { x: Math.PI / 2 }, 10);
  }

  /* Mirrors */
  for (const side of [-1, 1]) {
    const mx = side * (W / 2 + 0.02);
    const my = cabBase + cabY * 0.34;
    const mz = cabZ + cabL * 0.34;
    if (s.fenders === 'separate') {
      c.rod(mx, my, mz, mx + side * 0.12, my + 0.06, mz, 0.014, CHROME);
      c.cyl(0.055, 0.02, mx + side * 0.15, my + 0.06, mz, CHROME, { z: Math.PI / 2 }, 10);
    } else {
      dk.rod(mx, my, mz, mx + side * 0.09, my, mz, 0.02, s.blackTrim ? BLACKTRIM : color);
      b.box(0.10, 0.09, 0.16, mx + side * 0.13, my, mz, s.blackTrim ? BLACKTRIM : color);
      gl.box(0.03, 0.075, 0.14, mx + side * 0.175, my, mz, 0xffffff);
    }
  }

  /* Wipers */
  if (era.year >= 1945) {
    for (const side of [-1, 1]) {
      dk.rod(side * 0.16, cabBase + 0.02, cabZ + cabL * 0.46, side * 0.30, cabBase + cabY * 0.34, cabZ + cabL * 0.30, 0.011, 0x24242a);
    }
  }

  /* Body-specific extras */
  if (arch === 'pickup') {
    const bedZ = -L * 0.24, bedL = L * 0.42;
    b.box(W, 0.66, 0.09, 0, yBase + H + 0.30, bedZ - bedL / 2, color);
    for (const side of [-1, 1]) b.box(0.09, 0.66, bedL, side * (W / 2 - 0.045), yBase + H + 0.30, bedZ, color);
    dk.box(W * 0.9, 0.05, bedL * 0.94, 0, yBase + H + 0.02, bedZ, 0x2a2a2e);
    for (let i = 0; i < 5; i++) dk.box(W * 0.86, 0.03, 0.04, 0, yBase + H + 0.05, bedZ - bedL / 2 + (i + 0.5) * bedL / 5, 0x1a1a1e);
  }
  if (arch === 'wagon' || arch === 'hatch') {
    const rearL = arch === 'wagon' ? L * 0.24 : L * 0.16;
    b.box(cabW, cabY * 0.92, rearL, 0, cabBase + cabY * 0.46, cabZ - cabL / 2 - rearL / 2 + 0.04, color);
    gl.box(cabW * 0.94, cabY * 0.52, rearL * 0.9, 0, cabBase + cabY * 0.52, cabZ - cabL / 2 - rearL / 2 + 0.04, 0xffffff);
    if (s.wood) {
      b.box(W * 1.008, 0.52, L * 0.48, 0, yBase + H * 0.56, -L * 0.10, 0x8a6a3a);
      b.box(W * 1.012, 0.44, L * 0.44, 0, yBase + H * 0.56, -L * 0.10, 0xc8a878);
      dk.box(W * 1.014, 0.03, L * 0.44, 0, yBase + H * 0.78, -L * 0.10, 0x6a4a26);
      dk.box(W * 1.014, 0.03, L * 0.44, 0, yBase + H * 0.34, -L * 0.10, 0x6a4a26);
    }
  }
  if (s.rails) {
    for (const side of [-1, 1]) c.box(0.05, 0.07, L * 0.46, side * cabW * 0.40, cabBase + cabY + 0.05, cabZ - L * 0.02, 0x8a9098);
  }

  /* Taxi identity */
  if (s.taxi === 'roof-light') {
    c.box(0.52, 0.17, 0.26, 0, cabBase + cabY + 0.09, cabZ + cabL * 0.20, CHROME);
    li.box(0.46, 0.13, 0.22, 0, cabBase + cabY + 0.09, cabZ + cabL * 0.20, 0xfff0c0);
  } else if (s.taxi === 'roof-sign') {
    b.box(0.92, 0.24, 0.19, 0, cabBase + cabY + 0.11, cabZ, 0xf0c020);
    li.box(0.88, 0.19, 0.03, 0, cabBase + cabY + 0.11, cabZ + 0.10, 0xf0c020);
    dk.box(0.30, 0.10, 0.02, 0, cabBase + cabY + 0.11, cabZ + 0.11, 0x2a2a2e);
  } else if (s.taxi === 'roof-puck') {
    dk.box(0.36, 0.13, 0.26, 0, cabBase + cabY + 0.07, cabZ, 0x1a1a1e);
    li.box(0.32, 0.09, 0.02, 0, cabBase + cabY + 0.07, cabZ + 0.14, 0x56d0e0);
  }
  if (s.checker) {
    // The checkerband along the beltline — the single most recognisable taxi cue.
    const n = 16;
    for (let i = 0; i < n; i++) {
      const z = -L * 0.36 + i * (L * 0.72 / n);
      for (const side of [-1, 1]) {
        dk.box(0.012, 0.11, L * 0.72 / n, side * (W / 2 + 0.006), beltY + (i % 2 ? 0.055 : -0.055), z, 0x1a1a1e);
      }
    }
  }

  /* Fins */
  if (s.fins) {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const t = i / 6;
        const fh = s.fins * (0.25 + t * 0.75);
        b.box(0.11, fh, L * 0.05, side * (W / 2 - 0.05), yBase + H + fh / 2 - 0.02, -L * 0.20 - t * L * 0.26, color);
      }
      c.box(0.13, 0.09, L * 0.22, side * (W / 2 - 0.045), yBase + H + s.fins * 0.88, -L * 0.35, CHROME);
      li.box(0.09, 0.16, 0.05, side * (W / 2 - 0.05), yBase + H + s.fins * 0.55, -L * 0.455, 0xff3524);
    }
  }

  /* Sensors */
  if (s.lidar) {
    dk.cyl(0.15, 0.19, 0, cabBase + cabY + 0.15, cabZ, 0x2a2a2e, null, 14);
    li.cyl(0.155, 0.055, 0, cabBase + cabY + 0.15, cabZ, 0x56d0e0, null, 14);
    dk.cyl(0.05, 0.10, 0, cabBase + cabY + 0.30, cabZ, 0x3a3a40, null, 8);
    for (const side of [-1, 1]) {
      dk.box(0.11, 0.11, 0.11, side * W * 0.43, yBase + H * 0.9, noseZ - 0.12, 0x2a2a2e);
      li.box(0.05, 0.05, 0.02, side * W * 0.43, yBase + H * 0.9, noseZ - 0.06, 0x9fe870);
    }
  }
  if (s.faceted) {
    // Hard creases instead of curves: a single chamfer band down each flank.
    for (const side of [-1, 1]) dk.box(0.02, 0.06, L * 0.90, side * (W / 2 + 0.005), yBase + H * 0.72, 0, 0x9aa0a6);
  }
}

/* ── vans and box bodies ─────────────────────────────────────────── */

function loftVan(s, b, c, dk, gl, li, inr, color, era, yBase, axles) {
  const L = s.len, W = s.wid, H = s.hgt;
  const wr = s.wheelR ?? 0.34;
  const y0 = yBase - 0.06;
  const cabL = s.forward ? L * 0.95 : L * (s.cab ?? 0.35);
  const cabZ = s.forward ? 0 : L / 2 - cabL / 2;
  const archLift = wr * 0.5;

  const SEG = 14, segL = L / SEG;
  for (let i = 0; i < SEG; i++) {
    const t = (i + 0.5) / SEG;
    const z = lerp(-L / 2, L / 2, t);
    const plan = s.box ? 1 : lerp(0.94, 1, Math.sin(t * Math.PI) ** 0.5);
    const roofDrop = s.box ? 0 : Math.max(0, (t - 0.78)) * 1.2;
    const top = H - roofDrop * 0.5;
    const sill = sillAt(z, axles, wr, y0, archLift);
    b.box(W * plan, Math.max(0.1, top - sill), segL + 0.02, 0, sill + (top - sill) / 2, z, color);
    dk.box(W * plan * 1.002, 0.05, segL + 0.02, 0, sill + 0.025, z, BLACKTRIM);
  }
  if (s.box) {
    // A box van's cab is a separate, lower volume with a step to the body.
    b.box(W * 0.98, (H - y0) * 0.70, cabL, 0, y0 + (H - y0) * 0.35, cabZ, color);
    dk.box(W * 1.004, 0.06, L * 0.88, 0, y0 + (H - y0) * 0.62, -L * 0.05, BLACKTRIM);
    for (let i = 0; i < 7; i++) dk.box(W * 1.004, (H - y0) * 0.86, 0.02, 0, y0 + (H - y0) * 0.5, -L / 2 + 0.30 + i * (L * 0.66 / 7), 0x00000018);
    // Rear roller door
    dk.box(W * 0.92, (H - y0) * 0.8, 0.04, 0, y0 + (H - y0) * 0.42, -L / 2 - 0.01, 0x9a9aa0);
  }

  /* Glazing + interior */
  const wsY = y0 + (H - y0) * (s.box ? 0.50 : 0.66);
  gl.box(W * 0.90, (H - y0) * 0.28, 0.06, 0, wsY, L / 2 + 0.004, 0xffffff);
  for (const side of [-1, 1]) {
    gl.box(0.05, (H - y0) * 0.24, cabL * 0.62, side * (W / 2 + 0.004), wsY, cabZ, 0xffffff);
    dk.box(0.06, 0.03, cabL * 0.64, side * (W / 2 + 0.008), wsY - (H - y0) * 0.13, cabZ, BLACKTRIM);
  }
  inr.box(W * 0.84, 0.34, 0.16, 0, wsY - 0.30, cabZ - cabL * 0.10, 0x3a3a42);
  inr.box(0.32, 0.28, 0.18, -W * 0.22, wsY - 0.22, cabZ, 0x3a3a44);
  inr.sphere(0.10, -W * 0.22, wsY + 0.02, cabZ - 0.02, 0xd8ac84, true);
  inr.cyl(0.13, 0.026, -W * 0.22, wsY - 0.14, cabZ + cabL * 0.24, 0x1a1a1e, { x: 1.2 }, 12);

  /* Lamps, bumper, plate, mirrors */
  const lampY = y0 + (H - y0) * (s.box ? 0.26 : 0.40);
  dk.box(W * 0.99, 0.30, 0.18, 0, y0 + 0.16, L / 2 + 0.05, (s.chrome ?? 0) > 0.3 ? CHROME : 0x3a3a3e);
  for (const side of [-1, 1]) {
    dk.box(0.38, 0.20, 0.05, side * W * 0.32, lampY, L / 2 + 0.02, BLACKTRIM);
    li.box(0.34, 0.16, 0.05, side * W * 0.32, lampY, L / 2 + 0.045, 0xf2f6ff);
    li.box(0.22, 0.42, 0.05, side * W * 0.36, y0 + (H - y0) * 0.52, -L / 2 - 0.03, 0xff3524);
    dk.rod(side * (W / 2 + 0.02), wsY + 0.10, L / 2 - 0.34, side * (W / 2 + 0.14), wsY + 0.06, L / 2 - 0.34, 0.02, 0x2a2a2e);
    b.box(0.10, 0.24, 0.14, side * (W / 2 + 0.20), wsY + 0.04, L / 2 - 0.34, 0x2a2a2e);
  }
  li.box(0.34, 0.11, 0.02, 0, y0 + 0.24, -L / 2 - 0.06, 0xdedad0);

  if (s.forward) {
    c.box(0.05, (H - y0) * 0.28, 0.08, 0, wsY, L / 2 + 0.02, CHROME);
    c.cyl(0.26, 0.05, 0, y0 + (H - y0) * 0.40, L / 2 + 0.03, CHROME, { x: Math.PI / 2 }, 16);
    c.box(W * 0.88, 0.04, 0.06, 0, y0 + (H - y0) * 0.60, L / 2 + 0.02, CHROME);
  }
  if (s.twoTone) b.box(W * 1.006, (H - y0) * 0.40, L * 0.96, 0, y0 + (H - y0) * 0.80, 0, 0xf0ece0);
  if (s.blackTrim) dk.box(W * 1.006, 0.22, L * 0.94, 0, y0 + 0.20, 0, BLACKTRIM);
}

/* ── buses ───────────────────────────────────────────────────────── */

function loftBus(s, b, c, dk, gl, li, inr, color, era, axles) {
  const L = s.len, W = s.wid, H = s.hgt;
  const y0 = s.lowFloor ? 0.30 : 0.46;
  const SEG = 16, segL = L / SEG;
  for (let i = 0; i < SEG; i++) {
    const t = (i + 0.5) / SEG;
    const z = lerp(-L / 2, L / 2, t);
    const plan = lerp(0.93, 1, Math.sin(t * Math.PI) ** 0.35);
    const top = H - Math.max(0, Math.abs(t - 0.5) * 2 - 0.82) * 0.5;
    b.box(W * plan, top - y0, segL + 0.02, 0, y0 + (top - y0) / 2, z, color);
  }
  b.box(W * 1.01, 0.16, L * 0.99, 0, H - 0.10, 0, s.electric ? 0x2a6a5a : 0xd8dce0);
  dk.box(W * 1.012, 0.34, L * 0.99, 0, y0 + 0.12, 0, 0x2a2a30);
  c.box(W * 1.012, 0.05, L * 0.98, 0, y0 + 0.62, 0, era.year <= 1965 ? CHROME : 0x9a9aa0);

  const n = s.windows ?? 8;
  const winY = y0 + (H - y0) * 0.66;
  const winH = (H - y0) * 0.42;
  for (let i = 0; i < n; i++) {
    const z = -L / 2 + (i + 0.5) * (L / n);
    for (const side of [-1, 1]) {
      gl.box(0.05, winH, L / n - 0.20, side * (W / 2 + 0.004), winY, z, 0xffffff);
      dk.box(0.055, winH + 0.06, 0.10, side * (W / 2 + 0.006), winY, z + (L / n) / 2 - 0.10, 0x2a2a30);
    }
    // A few passengers
    if (i % 2 === 0) {
      inr.box(0.30, 0.28, 0.18, -W * 0.22, winY - 0.10, z, 0x4a4a56);
      inr.sphere(0.10, -W * 0.22, winY + 0.14, z, 0xd8ac84, true);
    }
  }
  gl.box(W * 0.90, (H - y0) * 0.44, 0.06, 0, winY - 0.02, L / 2 + 0.004, 0xffffff);
  gl.box(W * 0.90, (H - y0) * 0.38, 0.06, 0, winY, -L / 2 - 0.004, 0xffffff);
  inr.box(0.34, 0.30, 0.18, -W * 0.24, winY - 0.16, L / 2 - 0.5, 0x3a3a44);
  inr.sphere(0.105, -W * 0.24, winY + 0.10, L / 2 - 0.5, 0xd8ac84, true);
  inr.cyl(0.15, 0.026, -W * 0.24, winY - 0.10, L / 2 - 0.22, 0x1a1a1e, { x: 1.2 }, 12);

  for (const dz of [L * 0.34, -L * 0.10]) {
    dk.box(0.06, (H - y0) * 0.88, 1.12, W / 2 + 0.012, y0 + (H - y0) * 0.44, dz, 0x24343c);
    dk.box(0.07, 0.04, 1.14, W / 2 + 0.016, y0 + (H - y0) * 0.44, dz, 0x9a9aa0);
  }
  li.box(W * 0.62, 0.26, 0.03, 0, H - 0.32, L / 2 + 0.03, era.year >= 2005 ? 0xe8a020 : 0xf0e8c0);
  for (const side of [-1, 1]) {
    li.box(0.42, 0.26, 0.05, side * W * 0.30, y0 + 0.36, L / 2 + 0.03, 0xf2f6ff);
    li.box(0.32, 0.32, 0.05, side * W * 0.32, y0 + 0.46, -L / 2 - 0.03, 0xff3524);
    dk.rod(side * (W / 2 + 0.02), winY + 0.16, L / 2 - 0.2, side * (W / 2 + 0.16), winY + 0.10, L / 2 - 0.2, 0.022, 0x2a2a30);
    b.box(0.10, 0.26, 0.14, side * (W / 2 + 0.22), winY + 0.08, L / 2 - 0.2, 0x2a2a30);
  }
  if (s.electric) for (let i = 0; i < 4; i++) dk.box(1.5, 0.32, 1.4, (i % 2 - 0.5) * 1.2, H + 0.14, -L / 4 + i * 1.6, 0x3a4a4a);
}

/* ── the 1945 trolley ────────────────────────────────────────────── */

function loftTrolley(b, c, dk, gl, li, inr, color) {
  const L = 12.5, W = 2.5, H = 3.2, y0 = 0.52;
  const SEG = 14, segL = L / SEG;
  for (let i = 0; i < SEG; i++) {
    const t = (i + 0.5) / SEG;
    const z = lerp(-L / 2, L / 2, t);
    const plan = lerp(0.90, 1, Math.sin(t * Math.PI) ** 0.3);
    b.box(W * plan, H - y0 - 0.42, segL + 0.02, 0, y0 + (H - y0 - 0.42) / 2, z, color);
  }
  // Clerestory roof: the raised centre strip with its own little windows.
  b.box(W * 0.99, 0.30, L * 0.99, 0, H - 0.52, 0, 0xd8d0b8);
  b.box(W * 0.58, 0.36, L * 0.90, 0, H - 0.20, 0, 0xd8d0b8);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 10; i++) {
      const z = -L / 2 + (i + 0.5) * (L / 10);
      gl.box(0.05, 1.02, L / 10 - 0.24, side * (W / 2 + 0.004), y0 + 1.34, z, 0xffffff);
      gl.box(0.05, 0.24, L / 10 - 0.32, side * W * 0.29, H - 0.22, z, 0xffffff);
      dk.box(0.06, 1.10, 0.10, side * (W / 2 + 0.006), y0 + 1.34, z + (L / 10) / 2 - 0.12, 0x4a2a20);
      if (i % 3 === 0) {
        inr.box(0.30, 0.28, 0.18, side * W * 0.22, y0 + 1.20, z, 0x3a3a44);
        inr.sphere(0.10, side * W * 0.22, y0 + 1.44, z, 0xe8c4a0, true);
      }
    }
  }
  c.box(W * 1.012, 0.13, L, 0, y0 + 1.96, 0, 0xc8a850);
  c.box(W * 1.012, 0.10, L, 0, y0 + 0.74, 0, 0xc8a850);
  dk.box(W * 0.92, 0.52, 0.32, 0, 0.34, L / 2 + 0.18, 0x3a3a3a, { x: 0.5 });
  for (let i = 0; i < 6; i++) dk.box(W * 0.9, 0.05, 0.05, 0, 0.14 + i * 0.07, L / 2 + 0.24 - i * 0.03, 0x2a2a2a);
  li.cyl(0.17, 0.10, 0, y0 + 1.92, L / 2 + 0.06, 0xfff0c8, { x: Math.PI / 2 }, 12);
  li.box(0.74, 0.26, 0.04, 0, y0 + 2.14, L / 2 + 0.04, 0xf0e8c0);
  li.box(0.30, 0.24, 0.04, 0, y0 + 0.70, -L / 2 - 0.03, 0xff3524);
  // Trolley pole and its spring base
  dk.cyl(0.16, 0.14, 0, H + 0.04, -L * 0.20, 0x3a3a3a, null, 10);
  dk.rod(0, H + 0.06, -L * 0.20, 0, H + 1.62, -L * 0.44, 0.048, 0x3a3a3a);
  dk.box(0.52, 0.07, 0.07, 0, H + 1.62, -L * 0.44, 0x8a6a3a);
  dk.cyl(0.07, 0.14, 0, H + 1.70, -L * 0.44, 0x6a5a3a, { z: Math.PI / 2 }, 8);
}

/* ── two-wheelers ────────────────────────────────────────────────── */

function buildScooter(b, c, dk, gl, li, color, era) {
  const y0 = 0.16;
  b.box(0.44, 0.40, 1.02, 0, y0 + 0.42, -0.10, color);
  b.box(0.46, 0.20, 0.60, 0, y0 + 0.24, -0.44, color);      // rear body
  b.box(0.32, 0.26, 0.52, 0, y0 + 0.20, 0.40, color);       // leg shield base
  b.box(0.42, 0.60, 0.12, 0, y0 + 0.50, 0.56, color);       // leg shield
  dk.box(0.46, 0.05, 0.52, 0, y0 + 0.10, 0.10, 0x2a2a2e);   // floorboard
  c.rod(0, y0 + 0.62, 0.56, 0, y0 + 0.98, 0.50, 0.030, 0xa8acb0);
  c.box(0.58, 0.04, 0.05, 0, y0 + 0.98, 0.50, 0x2a2a2e);
  for (const side of [-1, 1]) c.cyl(0.028, 0.10, side * 0.27, y0 + 0.98, 0.50, 0x1a1a1e, { z: Math.PI / 2 }, 8);
  c.cyl(0.10, 0.06, 0, y0 + 0.80, 0.62, CHROME, { x: Math.PI / 2 }, 12);
  li.cyl(0.075, 0.03, 0, y0 + 0.80, 0.66, 0xfff0c8, { x: Math.PI / 2 }, 12);
  b.box(0.30, 0.14, 0.34, 0, y0 + 0.66, -0.42, 0x2a2320);   // seat
  b.box(0.26, 0.10, 0.24, 0, y0 + 0.70, -0.70, 0x2a2320);   // pillion
  li.box(0.10, 0.09, 0.03, 0, y0 + 0.52, -0.86, 0xff3524);
  c.cyl(0.045, 0.34, 0.16, y0 + 0.16, -0.52, 0x9a9aa0, { x: Math.PI / 2 }, 8);
  // Rider
  b.box(0.30, 0.36, 0.20, 0, y0 + 0.92, -0.34, 0x3a3a4a);
  b.sphere(0.115, 0, y0 + 1.20, -0.36, era.year <= 1965 ? 0xd8d4cc : 0x2a2a30, true);
}

function buildEScooter(b, dk, li, color) {
  dk.box(0.22, 0.06, 0.90, 0, 0.15, 0, 0x2a2a2e);
  b.box(0.20, 0.04, 0.86, 0, 0.18, 0, color);
  dk.rod(0, 0.17, 0.40, 0, 1.16, 0.36, 0.032, 0x8a8e92);
  dk.box(0.50, 0.05, 0.06, 0, 1.16, 0.36, 0x2a2a2e);
  for (const side of [-1, 1]) dk.cyl(0.024, 0.10, side * 0.22, 1.16, 0.36, 0x1a1a1e, { z: Math.PI / 2 }, 8);
  b.box(0.16, 0.20, 0.10, 0, 1.02, 0.36, color);
  li.box(0.09, 0.05, 0.04, 0, 1.08, 0.40, 0xf2f6ff);
  li.box(0.07, 0.035, 0.03, 0, 0.22, -0.44, 0xff3524);
  dk.box(0.30, 0.05, 0.30, 0, 0.13, -0.12, 0x1a1a1e);
}

function buildCargoBike(b, dk, li, color) {
  b.box(0.72, 0.58, 0.92, 0, 0.74, 0.48, color);
  dk.box(0.74, 0.07, 0.94, 0, 1.05, 0.48, 0x2a2a2e);
  dk.box(0.66, 0.30, 0.02, 0, 0.80, 0.95, 0xf0ece0);        // side panel for a logo
  dk.rod(0, 0.52, 0.10, 0, 1.06, -0.66, 0.034, 0x2a2a2e);
  dk.rod(0, 1.06, -0.66, 0, 0.30, -0.34, 0.030, 0x2a2a2e);
  dk.box(0.52, 0.05, 0.05, 0, 1.10, -0.62, 0x2a2a2e);
  dk.box(0.18, 0.10, 0.32, 0, 0.90, -0.48, 0x1a1a1e);       // saddle
  dk.cyl(0.11, 0.03, 0, 0.30, -0.30, 0x2a2a2e, { z: Math.PI / 2 }, 12);
  dk.box(0.06, 0.20, 0.05, 0.13, 0.22, -0.30, 0x1a1a1e);
  li.box(0.11, 0.05, 0.04, 0, 0.92, 1.00, 0xf2f6ff);
  li.box(0.08, 0.04, 0.03, 0, 0.62, -0.82, 0xff3524);
  // Rider standing on the pedals
  b.box(0.30, 0.40, 0.20, 0, 1.24, -0.44, 0x2a3a4a);
  b.sphere(0.115, 0, 1.54, -0.46, 0x2a2a30, true);
}

/* ── 2055 pods ───────────────────────────────────────────────────── */

function loftPod(s, b, dk, gl, li, inr, color, era) {
  const L = s.len, W = s.wid, H = s.hgt, y0 = 0.20;
  const SEG = 16, segL = L / SEG;
  for (let i = 0; i < SEG; i++) {
    const t = (i + 0.5) / SEG;
    const z = lerp(-L / 2, L / 2, t);
    // A single continuous volume — no bonnet, no boot, symmetrical front to back.
    const prof = Math.sin(t * Math.PI) ** 0.24;
    const wid = W * lerp(0.82, 1, prof);
    const top = y0 + (H - y0) * lerp(0.52, 1, prof);
    b.box(wid, top - y0, segL + 0.02, 0, y0 + (top - y0) / 2, z, color);
  }
  // Wrap-around glazing band, uninterrupted by pillars.
  gl.box(W * 1.004, (H - y0) * 0.42, L * 0.88, 0, y0 + (H - y0) * 0.66, 0, 0xffffff);
  gl.box(W * 0.88, (H - y0) * 0.48, L * 1.004, 0, y0 + (H - y0) * 0.64, 0, 0xffffff);
  b.box(W * 0.94, 0.10, L * 0.88, 0, H - 0.04, 0, 0xd8dcd8);
  dk.box(W * 1.006, 0.06, L * 0.92, 0, y0 + (H - y0) * 0.44, 0, 0x1a2a2e);

  // Facing bench seats and passengers — nobody is driving.
  inr.box(W * 0.80, 0.30, 0.14, 0, y0 + 0.44, L * 0.20, 0x2a3a3e);
  inr.box(W * 0.80, 0.30, 0.14, 0, y0 + 0.44, -L * 0.20, 0x2a3a3e);
  for (const [px, pz] of [[-W * 0.20, L * 0.10], [W * 0.20, -L * 0.10]]) {
    inr.box(0.30, 0.30, 0.20, px, y0 + 0.52, pz, 0x3a4a52);
    inr.sphere(0.105, px, y0 + 0.80, pz, 0xd8ac84, true);
  }

  li.box(W * 0.72, 0.055, 0.045, 0, y0 + (H - y0) * 0.30, L / 2 + 0.02, 0x9fe8ff);
  li.box(W * 0.72, 0.055, 0.045, 0, y0 + (H - y0) * 0.30, -L / 2 - 0.02, 0xff5a6a);
  li.box(W * 0.98, 0.035, L * 0.90, 0, y0 - 0.02, 0, 0x56d0e0);          // underglow skirt
  li.box(0.30, 0.05, 0.03, 0, y0 + (H - y0) * 0.86, L / 2 + 0.015, 0xd8dcd8);  // status strip
  if (s.long) for (const dz of [L * 0.20, -L * 0.20]) dk.box(0.05, (H - y0) * 0.80, 1.22, W / 2 + 0.012, y0 + (H - y0) * 0.45, dz, 0x2a4a4a);
  dk.cyl(0.11, 0.15, 0, H + 0.06, L * 0.20, 0x3a4a4a, null, 12);
  li.cyl(0.115, 0.045, 0, H + 0.06, L * 0.20, 0x56d0e0, null, 12);
  for (const side of [-1, 1]) {
    dk.box(0.07, 0.07, 0.07, side * W * 0.44, y0 + (H - y0) * 0.80, L / 2 - 0.10, 0x2a3a3e);
    li.box(0.03, 0.03, 0.02, side * W * 0.44, y0 + (H - y0) * 0.80, L / 2 - 0.06, 0x9fe870);
  }
}

/* ── drones and walkers ──────────────────────────────────────────── */

function buildDrone(b, dk, li, color) {
  b.box(0.74, 0.30, 1.04, 0, 0, 0, color);
  b.box(0.54, 0.44, 0.54, 0, -0.32, 0, 0x8a9a9a);
  dk.box(0.40, 0.06, 0.40, 0, -0.55, 0, 0x3a4a4a);
  for (const [ox, oz] of [[-0.72, -0.72], [0.72, -0.72], [-0.72, 0.72], [0.72, 0.72]]) {
    dk.rod(0, 0, 0, ox, 0.07, oz, 0.032, 0x5a6a6a);
    dk.cyl(0.38, 0.035, ox, 0.11, oz, 0x3a4a4a, null, 16);
    dk.cyl(0.06, 0.10, ox, 0.13, oz, 0x2a3a3a, null, 8);
    li.cyl(0.39, 0.016, ox, 0.14, oz, 0x56d0e0, null, 16);
  }
  li.box(0.32, 0.035, 0.035, 0, -0.15, 0.52, 0x9fe870);
  li.box(0.32, 0.035, 0.035, 0, -0.15, -0.52, 0xff5a6a);
}

function buildWalker(b, dk, li, color) {
  b.box(0.52, 0.62, 0.42, 0, 1.02, 0, color);
  dk.box(0.38, 0.24, 0.32, 0, 1.44, 0, 0x2a3a3e);
  li.box(0.26, 0.055, 0.02, 0, 1.46, 0.17, 0x56d0e0);
  dk.box(0.44, 0.42, 0.32, 0, 1.06, -0.32, 0x6a7a7a);      // cargo box
  dk.box(0.46, 0.05, 0.34, 0, 1.29, -0.32, 0x3a4a4a);
  for (const side of [-1, 1]) {
    dk.rod(side * 0.19, 0.74, 0, side * 0.27, 0.42, 0.10, 0.058, 0x8a9a9a);
    dk.rod(side * 0.27, 0.42, 0.10, side * 0.21, 0.06, -0.05, 0.046, 0x8a9a9a);
    dk.box(0.17, 0.07, 0.32, side * 0.21, 0.04, -0.02, 0x3a4a4a);
    dk.sphere(0.07, side * 0.19, 0.74, 0, 0x5a6a6a, true);
    dk.sphere(0.055, side * 0.27, 0.42, 0.10, 0x5a6a6a, true);
  }
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
    const n = Math.round(15 * era.vehicles.density * densityScale);

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
      if (model.userData.beams) model.userData.beams.visible = false;
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

  update(dt, camPos, audio, daylight = 1) {
    this.signals.update(dt);
    const night = clamp01(1.15 - daylight * 1.5);
    if (this._night === undefined) this._night = night;
    this._night = damp(this._night, night, 3, dt);
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

        // Lamps burn brighter after dark, and the beams switch on with them.
        const beams = v.model.userData.beams;
        if (beams) {
          beams.visible = this._night > 0.05;
          if (beams.visible) beams.userData.mat.opacity = this._night * 0.16;
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
