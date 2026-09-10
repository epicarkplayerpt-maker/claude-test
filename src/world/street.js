/**
 * The street: carriageway, sidewalks, kerbs, markings, and every piece of
 * furniture standing on them.
 *
 * Street furniture is the most reliable era tell there is. You can date a
 * photograph from the lamp head alone — a fluted iron post with a glass globe
 * is not a sodium cobra head is not a flat LED panel — so each era gets its own
 * vocabulary of lamps, boxes, meters, bins and bollards, and the props are what
 * sell the transition as much as the buildings do.
 */

import * as THREE from 'three';
import { Bucket, quad } from './geom.js';
import { Tex } from './textures.js';
import {
  toTexture, roadMarkTexture, signTexture, posterTexture, billboardTexture, graffitiTexture,
} from './textures.js';
import { BLOCK, LAMP } from '../data/eras.js';
import { Rand } from '../core/rng.js';
import { lerp, TAU } from '../core/mathx.js';

const HALF = BLOCK.half;                    // 30 — building line
const CURB = HALF + BLOCK.sidewalk;         // 34.2 — kerb line
const ROADOUT = CURB + BLOCK.road;          // 47.2 — far kerb
const FARWALK = ROADOUT + BLOCK.farWalk;    // 51.2 — far building line
const WORLD = 96;

/* ══════════════════════════ ground & road ══════════════════════════ */

export function buildStreet(era, eraIdx, ctx) {
  const { mats } = ctx;
  const rnd = new Rand(`street:${era.year}`);
  const out = { group: new THREE.Group(), interactables: [], lights: [], animated: [], blockers: [], glows: [], pools: [] };
  out.group.name = `street@${era.year}`;

  /* Carriageway — one big plane; the block and sidewalks sit on top. */
  const road = quad(WORLD * 2, WORLD * 2, 0, 0, 0,
    mats.asphalt(era.palette.road, { repeat: [WORLD / 2.2, WORLD / 2.2], wet: era.road.wet }));
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;
  out.group.add(road);

  /* Sidewalks: the ring around the block, and the far side of both streets. */
  const walkMat = mats.concrete(era.palette.walk, { repeat: [1, 1] });
  const addWalk = (cx, cz, w, d) => {
    const m = quad(w, d, 0, 0, 0, mats.concrete(era.palette.walk, { repeat: [w / 2.4, d / 2.4] }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(cx, BLOCK.curbHeight, cz);
    m.receiveShadow = true;
    out.group.add(m);
  };
  // Ring (four slabs, overlapping at the corners — invisible under the kerb)
  addWalk(0, -(HALF + CURB) / 2, CURB * 2, BLOCK.sidewalk);
  addWalk(0, (HALF + CURB) / 2, CURB * 2, BLOCK.sidewalk);
  addWalk(-(HALF + CURB) / 2, 0, BLOCK.sidewalk, CURB * 2);
  addWalk((HALF + CURB) / 2, 0, BLOCK.sidewalk, CURB * 2);
  // Far sides
  addWalk(0, -(ROADOUT + FARWALK) / 2, WORLD * 2, BLOCK.farWalk);
  addWalk(0, (ROADOUT + FARWALK) / 2, WORLD * 2, BLOCK.farWalk);
  addWalk(-(ROADOUT + FARWALK) / 2, 0, BLOCK.farWalk, WORLD * 2);
  addWalk((ROADOUT + FARWALK) / 2, 0, BLOCK.farWalk, WORLD * 2);

  /* Kerbs */
  const kerb = new Bucket();
  const kerbCol = era.palette.stone?.[1] ?? 0x9a9484;
  const kh = BLOCK.curbHeight, kt = 0.3;
  for (const s of [-1, 1]) {
    kerb.box(CURB * 2, kh, kt, 0, kh / 2, s * (CURB - kt / 2), kerbCol);
    kerb.box(kt, kh, CURB * 2, s * (CURB - kt / 2), kh / 2, 0, kerbCol);
    kerb.box(WORLD * 2, kh, kt, 0, kh / 2, s * (ROADOUT + kt / 2), kerbCol);
    kerb.box(kt, kh, WORLD * 2, s * (ROADOUT + kt / 2), kh / 2, 0, kerbCol);
  }
  // Kerb-cut ramps at the four corners (post-1990 accessibility retrofit)
  if (eraIdx >= 3) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      kerb.box(2.2, kh + 0.02, 2.2, sx * (CURB - 1.4), kh / 2 - 0.03, sz * (CURB - 1.4),
        eraIdx >= 4 ? 0xc8a838 : 0xb0aca0, { x: sz * 0.06, z: -sx * 0.06 });
    }
  }
  const km = kerb.mesh(mats.vcol('rough'), { name: 'kerbs' });
  if (km) out.group.add(km);

  /* Lane markings */
  if (era.road.markings !== 'none') {
    const tex = toTexture(roadMarkTexture(era.road.markings, { wear: era.road.wear }), {
      repeat: [1, WORLD / 6],
    });
    const mat = mats.printed(tex, { transparent: true, rough: 0.9 });
    mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
    // One centre-line strip per carriageway: two north–south, two east–west.
    for (const s of [-1, 1]) {
      const ns = quad(3.2, WORLD * 2, 0, 0, 0, mat);
      ns.rotation.x = -Math.PI / 2;
      ns.position.set(s * (CURB + BLOCK.road / 2), 0.012, 0);
      out.group.add(ns);

      const ew = quad(3.2, WORLD * 2, 0, 0, 0, mat);
      ew.rotation.x = -Math.PI / 2;
      ew.rotation.z = Math.PI / 2;
      ew.position.set(0, 0.012, s * (CURB + BLOCK.road / 2));
      out.group.add(ew);
    }
  }

  /* Crosswalks */
  buildCrosswalks(out, ctx, era, eraIdx);

  /* Bike lane */
  if (era.road.bikeLane) {
    const laneMat = mats.paint(era.road.bikeLaneColor ?? 0x2a7a4a, { rough: 0.94 });
    laneMat.polygonOffset = true; laneMat.polygonOffsetFactor = -3; laneMat.polygonOffsetUnits = -3;
    for (const s of [-1, 1]) {
      const m = quad(1.7, WORLD * 2, 0, 0, 0, laneMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(s * (CURB + 1.4), 0.014, 0);
      out.group.add(m);
    }
  }

  /* Trolley tracks — real rails in 1945, ghost seams afterwards. */
  if (era.road.trolleyTracks) buildTrolleyTracks(out, ctx, era, eraIdx);

  /* Manholes, drains, patches */
  const util = new Bucket();
  for (let i = 0; i < 10; i++) {
    const onX = rnd.chance(0.5);
    const a = rnd.range(-WORLD * 0.7, WORLD * 0.7);
    const b = rnd.pick([CURB + 3, CURB + 9, -(CURB + 3), -(CURB + 9)]);
    const x = onX ? a : b, z = onX ? b : a;
    util.cyl(0.42, 0.05, x, 0.025, z, 0x3a3a3c, null, 12);
    util.cyl(0.36, 0.03, x, 0.05, z, 0x4a4640, null, 12);
  }
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) {
    const t = (i + 0.5) / 5 - 0.5;
    util.box(0.85, 0.1, 0.4, t * CURB * 1.8, 0.06, s * (CURB - 0.18), 0x3a3a3c);
    util.box(0.4, 0.1, 0.85, s * (CURB - 0.18), 0.06, t * CURB * 1.8, 0x3a3a3c);
  }
  const um = util.mesh(mats.vcol('metal'), { cast: false });
  if (um) out.group.add(um);

  /* Steam from a manhole — 1985's signature */
  if (era.road.steamManhole) {
    out.animated.push({ kind: 'steam', pos: new THREE.Vector3(CURB + 6, 0.1, -8) });
  }
  if (era.road.inductionPads) {
    const pads = new Bucket();
    for (let i = 0; i < 6; i++) {
      const z = -WORLD * 0.5 + i * (WORLD / 6);
      pads.cyl(1.1, 0.04, CURB + BLOCK.road * 0.25, 0.035, z, 0x2a4a4a, null, 16);
      pads.cyl(0.9, 0.02, CURB + BLOCK.road * 0.25, 0.06, z, 0x56d0e0, null, 16);
    }
    const pm = pads.mesh(mats.emitVcol({ strength: 0.9 }), { cast: false });
    if (pm) out.group.add(pm);
  }

  /* Backdrop across both streets */
  buildBackdrop(out, ctx, era, eraIdx, rnd);

  /* Furniture */
  buildProps(out, ctx, era, eraIdx, rnd);

  /* Night glow: halos at every emitter and pools of light on the pavement.
     One additive draw call each, faded in by the day/night cycle. */
  buildNightGlow(out, ctx, era, eraIdx);

  return out;
}

function buildNightGlow(out, ctx, era, eraIdx) {
  const { mats } = ctx;
  if (!out.glows.length && !out.pools.length) return;

  const halos = new THREE.Group();
  const haloMat = mats.glow(0xffffff, { strength: 1.0, tex: Tex.glow() });
  const haloGeo = new THREE.PlaneGeometry(1, 1);
  for (const g of out.glows) {
    const m = new THREE.Mesh(haloGeo, haloMat);
    m.position.set(g.x, g.y, g.z);
    m.scale.setScalar(g.r * 2.4);
    m.userData.billboard = true;
    m.material = haloMat;
    halos.add(m);
    // Tint per lamp by baking the colour into a per-mesh material clone only
    // when it actually differs — most eras use one lamp colour throughout.
  }
  halos.userData.mat = haloMat;
  haloMat.color.set(era.lamp ? LAMP[era.lamp].color : 0xffe0b0).multiplyScalar(1.0);
  out.group.add(halos);
  out.nightGlow = halos;

  const pools = new Bucket();
  for (const p of out.pools) {
    // A flat disc of light on the pavement, offset just above it.
    pools.plane(p.r * 2.2, p.r * 2.2, p.x, BLOCK.curbHeight + 0.02, p.z, 0xffffff, { x: -Math.PI / 2 });
  }
  const poolGeo = pools.build();
  if (poolGeo) {
    const poolMat = mats.glow(era.lamp ? LAMP[era.lamp].color : 0xffe0b0, { strength: 0.55, tex: Tex.glow() });
    const pm = new THREE.Mesh(poolGeo, poolMat);
    pm.renderOrder = 5;
    pm.frustumCulled = false;
    out.group.add(pm);
    out.nightPools = pm;
  }
}

function buildCrosswalks(out, ctx, era, eraIdx) {
  const { mats } = ctx;
  const kind = era.road.crosswalk;
  if (!kind) return;
  const b = new Bucket();
  const wear = era.road.wear;
  const paint = 0xe8e4d0;
  const stripeW = kind === 'continental' ? 0.6 : 0.42;
  const gap = kind === 'continental' ? 1.0 : 0.7;
  const span = BLOCK.road;
  const n = Math.floor(span / (stripeW + gap));

  const place = (cx, cz, along) => {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      const o = t * span;
      if (along === 'x') b.box(stripeW, 0.02, 3.2, cx + o, 0.02, cz, paint);
      else b.box(3.2, 0.02, stripeW, cx, 0.02, cz + o, paint);
    }
    if (kind !== 'continental' && kind !== 'lit') {
      // Ladder crosswalks have long side rails.
      if (along === 'x') { b.box(span, 0.02, 0.16, cx, 0.02, cz - 1.5, paint); b.box(span, 0.02, 0.16, cx, 0.02, cz + 1.5, paint); }
      else { b.box(0.16, 0.02, span, cx - 1.5, 0.02, cz, paint); b.box(0.16, 0.02, span, cx + 1.5, 0.02, cz, paint); }
    }
  };

  for (const s of [-1, 1]) {
    place(0, s * (CURB + span / 2), 'x');
    place(s * (CURB + span / 2), 0, 'z');
  }

  const m = b.mesh(kind === 'lit'
    ? mats.emitVcol({ strength: 1.1 })
    : mats.vcol('rough'), { cast: false });
  if (m) {
    m.material.transparent = true;
    m.material.opacity = 1 - wear * 0.55;
    m.material.polygonOffset = true;
    m.material.polygonOffsetFactor = -4;
    m.material.polygonOffsetUnits = -4;
    out.group.add(m);
  }
}

function buildTrolleyTracks(out, ctx, era, eraIdx) {
  const { mats } = ctx;
  const b = new Bucket();
  const real = era.road.trolleyTracks === true;
  const heritage = era.road.trolleyTracks === 'heritage';
  const railCol = real ? 0x6a6058 : heritage ? 0x8a8478 : 0x3a3a3a;
  const gauge = 1.44;
  for (const s of [-1, 1]) {
    const cz = s * (CURB + BLOCK.road * 0.28);
    for (const r of [-gauge / 2, gauge / 2]) {
      b.box(WORLD * 2, real ? 0.06 : 0.02, 0.08, 0, real ? 0.05 : 0.025, cz + r, railCol);
    }
    if (real) {
      for (let i = 0; i < 80; i++) {
        const x = -WORLD + i * (WORLD * 2 / 80);
        b.box(0.22, 0.03, gauge + 0.5, x, 0.03, cz, 0x4a3a2c);
      }
    }
  }
  const m = b.mesh(mats.vcol(real ? 'metal' : 'rough'), { cast: false });
  if (m) {
    m.material.polygonOffset = true; m.material.polygonOffsetFactor = -2; m.material.polygonOffsetUnits = -2;
    out.group.add(m);
  }

  /* Overhead wire + poles (1945 only) */
  if (real) {
    const p = new Bucket();
    for (let i = -3; i <= 3; i++) {
      const x = i * 22;
      const z = CURB + 0.9;
      p.cylOn(0.09, 8.2, x, BLOCK.curbHeight, z, 0x3a4038, null, 8);
      p.rod(x, 8.0, z, x, 7.7, z - 4.2, 0.04, 0x3a4038);
      if (i < 3) p.rod(x, 7.7, z - 4.2, x + 22, 7.7, z - 4.2, 0.015, 0x2a2a2a);
      out.blockers.push({ x, z, r: 0.3 });
    }
    const pm = p.mesh(mats.vcol('metal'));
    if (pm) out.group.add(pm);
  }
}

/* ══════════════════════════ backdrop ══════════════════════════ */

function buildBackdrop(out, ctx, era, eraIdx, rnd) {
  const { mats } = ctx;
  const bucket = new Bucket();
  const glassB = new Bucket();
  const litB = new Bucket();

  const styles = eraIdx <= 1 ? ['brick', 'brick', 'stone']
    : eraIdx === 2 ? ['brick', 'brick', 'panel']
    : eraIdx === 3 ? ['brick', 'panel', 'glass']
    : eraIdx === 4 ? ['brick', 'panel', 'glass', 'timber']
    : ['bio', 'panel', 'glass', 'bio'];

  const rows = [
    { axis: 'z', side: -1 }, { axis: 'z', side: 1 },
    { axis: 'x', side: -1 }, { axis: 'x', side: 1 },
  ];

  for (const row of rows) {
    let p = -WORLD;
    while (p < WORLD) {
      const w = rnd.range(9, 20);
      const d = rnd.range(14, 22);
      const floors = rnd.int(eraIdx >= 3 ? 3 : 2, eraIdx >= 3 ? 9 : 6);
      const h = 4.4 + (floors - 1) * 3.3;
      const style = rnd.pick(styles);
      const col = style === 'brick' ? rnd.pick(era.palette.brick)
        : style === 'stone' ? rnd.pick(era.palette.stone)
        : style === 'glass' ? era.palette.glass
        : rnd.pick(era.palette.panel || era.palette.brick);

      const cx = row.axis === 'z' ? p + w / 2 : row.side * (FARWALK + d / 2);
      const cz = row.axis === 'z' ? row.side * (FARWALK + d / 2) : p + w / 2;
      const sx = row.axis === 'z' ? w : d;
      const sz = row.axis === 'z' ? d : w;

      bucket.box(sx, h, sz, cx, h / 2, cz, col);
      // Cornice: a two-step overhang rather than one flat cap, which is the
      // difference between a row of buildings and a row of boxes.
      const capCol = rnd.pick(era.palette.stone);
      bucket.box(sx + 0.55, 0.38, sz + 0.55, cx, h + 0.19, cz, capCol);
      bucket.box(sx + 0.30, 0.34, sz + 0.30, cx, h + 0.55, cz, capCol);
      bucket.box(sx + 0.10, 0.55, sz + 0.10, cx, h + 1.0, cz, col);          // parapet wall
      // Taller blocks step back, the way a zoning envelope makes them.
      if (floors >= 7) {
        const setH = rnd.range(3.2, 7.0);
        bucket.box(sx * 0.66, setH, sz * 0.66, cx, h + 1.2 + setH / 2, cz, col);
        bucket.box(sx * 0.66 + 0.4, 0.3, sz * 0.66 + 0.4, cx, h + 1.35 + setH, cz, capCol);
      }

      /* A ground floor that is not a blank wall: a dark recessed shop band
         with a fascia over it, and on about half of them an awning. */
      const inN = row.axis === 'z' ? -row.side : 0;
      const inX = row.axis === 'x' ? -row.side : 0;
      const fz = cz + (row.axis === 'z' ? inN * (d / 2 + 0.05) : 0);
      const fx = cx + (row.axis === 'x' ? inX * (d / 2 + 0.05) : 0);
      const across = row.axis === 'z' ? [w * 0.9, 0.12] : [0.12, w * 0.9];
      bucket.box(across[0], 2.5, across[1], fx, 1.35, fz, 0x241f1c);
      bucket.box(across[0], 0.85, across[1] + 0.12, fx, 3.9, fz, rnd.pick(era.palette.paint || era.palette.stone));
      if (rnd.chance(0.45)) {
        const proj = 1.1;
        bucket.box(row.axis === 'z' ? w * 0.7 : proj, 0.10, row.axis === 'z' ? proj : w * 0.7,
          fx + (row.axis === 'x' ? inX * proj / 2 : 0), 3.15,
          fz + (row.axis === 'z' ? inN * proj / 2 : 0),
          rnd.pick(era.palette.paint || [0x8a3a2a]));
      }
      if (rnd.chance(era.windowLit * 1.1 + 0.2)) {
        litB.box(across[0] * 0.9, 1.5, across[1] + 0.1, fx, 1.7, fz + (row.axis === 'z' ? inN * 0.04 : 0),
          rnd.pick(era.curtains || [0xffd8a0]));
      }

      /* Window grid on the two faces that can be seen. */
      const faceW = row.axis === 'z' ? w : d;
      const bays = Math.max(2, Math.round(faceW / 2.6));
      const inward = row.axis === 'z' ? -row.side : 0;
      const inwardX = row.axis === 'x' ? -row.side : 0;
      for (let f = 0; f < floors - 1; f++) {
        for (let i = 0; i < bays; i++) {
          const t = (i + 0.5) / bays - 0.5;
          const wy = 4.4 + f * 3.3 + 1.7;
          const wx = row.axis === 'z' ? cx + t * faceW : cx + inwardX * (d / 2 + 0.06);
          const wz = row.axis === 'z' ? cz + inward * (d / 2 + 0.06) : cz + t * faceW;
          const ww = 1.2, wh = 1.7;
          const rotY = row.axis === 'z' ? 0 : Math.PI / 2;
          glassB.box(row.axis === 'z' ? ww : 0.06, wh, row.axis === 'z' ? 0.06 : ww, wx, wy, wz, 0xffffff);
          if (rnd.chance(era.windowLit * 1.25)) {
            litB.box(row.axis === 'z' ? ww : 0.06, wh, row.axis === 'z' ? 0.06 : ww,
              wx + (row.axis === 'x' ? inwardX * 0.03 : 0),
              wy, wz + (row.axis === 'z' ? inward * 0.03 : 0),
              rnd.pick(era.curtains || [0xffd8a0]));
          }
        }
      }

      /* Rooftop silhouette clutter reads as skyline even at this distance. */
      if (rnd.chance(0.5)) bucket.box(2.0, 1.2, 1.6, cx + rnd.range(-w / 4, w / 4), h + 0.9, cz + rnd.range(-d / 4, d / 4), 0xb0b4b0);
      if (eraIdx <= 2 && rnd.chance(0.3)) {
        const tx = cx + rnd.range(-w / 4, w / 4), tz = cz + rnd.range(-d / 4, d / 4);
        bucket.taper(1.3, 1.4, 3.0, tx, h + 2.2, tz, 0x6a5340, 10);
        for (let i = 0; i < 4; i++) bucket.rod(tx + Math.cos(i * 1.57) * 1.1, h, tz + Math.sin(i * 1.57) * 1.1, tx + Math.cos(i * 1.57) * 0.9, h + 2.2, tz + Math.sin(i * 1.57) * 0.9, 0.07, 0x4a3f34);
      }
      if (eraIdx >= 4 && rnd.chance(0.55)) {
        for (let s = 0; s < 4; s++) bucket.box(2.2, 0.06, 1.4, cx + rnd.range(-w / 3, w / 3), h + 0.7, cz + rnd.range(-d / 3, d / 3), 0x1a2a3a, { x: -0.34 });
      }

      p += w + rnd.range(0.4, 2.2);
    }
  }

  /* ── The rest of the city ─────────────────────────────────────
     A ring of towers well beyond the near row, drawn flat-shaded and never
     approachable. They exist to put a horizon behind the block: without them
     every wide shot ends in sky two hundred metres out, and the place reads
     as four streets on a table. */
  {
    const far = WORLD + 34;
    for (let i = 0; i < 78; i++) {
      const a = (i / 78) * TAU + rnd.range(-0.02, 0.02);
      const r = far + rnd.range(0, 130);
      const hh = rnd.range(18, 34) + (eraIdx >= 3 ? rnd.range(0, 62) : rnd.range(0, 22));
      const bw = rnd.range(12, 30);
      // Aerial perspective: the far ones wash toward the sky colour.
      const fade = Math.min(0.72, (r - far) / 200);
      const base = new THREE.Color(rnd.pick(era.palette.brick));
      base.lerp(new THREE.Color(era.sky.horizon ?? era.sky.top ?? 0xb8c8d8), 0.30 + fade);
      const tx = Math.cos(a) * r, tz = Math.sin(a) * r;
      bucket.box(bw, hh, bw * rnd.range(0.7, 1.3), tx, hh / 2, tz, base.getHex(), { y: a });
      if (rnd.chance(0.4)) {
        bucket.box(bw * 0.5, rnd.range(4, 14), bw * 0.5, tx, hh + 4, tz, base.getHex(), { y: a });
      }
      if (eraIdx >= 3 && rnd.chance(0.3)) {
        litB.box(bw * 0.08, bw * 0.08, bw * 0.08, tx, hh + rnd.range(1, 6), tz, 0xff4a3a);
      }
    }
  }

  const m = bucket.mesh(mats.vcol('matte'), { name: 'backdrop' });
  if (m) out.group.add(m);
  const gm = glassB.mesh(mats.glass(era.palette.glass, { opacity: 0.5, rough: 0.1 }), { cast: false, receive: false });
  if (gm) out.group.add(gm);
  const lm = litB.mesh(mats.emitVcol({ strength: 0.8 }), { cast: false, receive: false });
  if (lm) out.group.add(lm);

  /* One big rooftop billboard across the street — era advertising, front and centre. */
  const bb = new Bucket();
  const bx = -18, bz = -(FARWALK + 16);
  const bh = 26;
  bb.rod(bx - 5, bh - 8, bz, bx - 5, bh + 3, bz, 0.16, 0x5a5a5a);
  bb.rod(bx + 5, bh - 8, bz, bx + 5, bh + 3, bz, 0.16, 0x5a5a5a);
  bb.box(13.5, 6.6, 0.3, bx, bh, bz + 0.2, 0x2a2a2e);
  const bbm = bb.mesh(mats.vcol('metal'));
  if (bbm) out.group.add(bbm);

  const adTex = toTexture(billboardTexture(era.ads.board, {
    tone: era.ads.tone, bg: rnd.pick(era.palette.paint || [0x2a4a6a]),
    accent: era.accent, seed: 'board' + era.year,
  }), { clamp: true });
  const adMat = eraIdx >= 4
    ? mats.emissive(adTex, { color: 0xffffff, strength: eraIdx === 5 ? 2.4 : 1.3, transparent: false })
    : mats.printed(adTex);
  const ad = quad(13, 6.2, bx, bh, bz + 0.4, adMat);
  out.group.add(ad);
  if (eraIdx >= 4) {
    out.lights.push({ pos: new THREE.Vector3(bx, bh - 3, bz + 5), color: era.accent, intensity: 17.6, distance: 26, key: 'billboard' });
    out.animated.push({ kind: 'billboard', mesh: ad, era });
  } else if (eraIdx >= 1) {
    // Floodlights on a painted board
    const fb = new Bucket();
    for (const s of [-1, 1]) {
      fb.rod(bx + s * 4, bh - 3.6, bz + 0.4, bx + s * 4, bh - 3.4, bz + 1.6, 0.07, 0x3a3a3a);
      fb.cone(0.28, 0.4, bx + s * 4, bh - 3.2, bz + 1.7, 0x3a3a3a, { x: -1.1 });
    }
    const fm = fb.mesh(mats.vcol('metal'));
    if (fm) out.group.add(fm);
    out.lights.push({ pos: new THREE.Vector3(bx, bh - 2, bz + 3), color: 0xfff0d0, intensity: 12.8, distance: 20, key: 'billboardflood' });
  }
}

/* ══════════════════════════ street furniture ══════════════════════════ */

/**
 * Positions along the block's sidewalk, expressed as (side, t) where t runs
 * 0→1 along that side. Returns world x/z plus the outward normal, so a prop can
 * be faced toward the road or the buildings.
 */
function walkPoint(side, t, inset) {
  const a = lerp(-CURB + 2.5, CURB - 2.5, t);
  const o = CURB - inset;
  switch (side) {
    case 'N': return { x: a, z: -o, nx: 0, nz: -1, rot: 0 };
    case 'S': return { x: a, z: o, nx: 0, nz: 1, rot: Math.PI };
    case 'E': return { x: o, z: a, nx: 1, nz: 0, rot: -Math.PI / 2 };
    default: return { x: -o, z: a, nx: -1, nz: 0, rot: Math.PI / 2 };
  }
}


/**
 * What is actually underfoot.
 *
 * A pavement is never a blank slab. It is a century of other trades cutting
 * into it and patching it back: a water valve, a coal hole nobody has opened
 * since the boiler went, a telephone pull-box, a tree pit, the ghost of a
 * kerb crossing, and whatever was dropped this afternoon. This is the layer
 * that stops a street reading as an architectural model, and because it is
 * all flat plates it costs almost nothing.
 */
function buildPavementDetail(b, emit, era, eraIdx, rnd, out) {
  const Y = BLOCK.curbHeight;
  const sides = ['N', 'S', 'E', 'W'];
  const iron = [0x4a463e, 0x3e3a34, 0x55504a][eraIdx % 3];
  const patch = [0x5a564e, 0x4e4a44, 0x6a655c];

  /* ── Ironwork: covers, valve plates, coal holes, pull-boxes ──── */
  for (const side of sides) {
    for (let i = 0; i < 9; i++) {
      const t = (i + rnd.range(0.18, 0.82)) / 9;
      const inset = rnd.range(0.5, BLOCK.sidewalk - 0.6);
      const p = walkPoint(side, t, inset);
      const roll = rnd.range(0, 1);

      if (roll < 0.26) {
        // Round cast-iron cover with a raised waffle pattern.
        const r = rnd.range(0.28, 0.36);
        b.cylOn(r + 0.035, 0.02, p.x, Y - 0.005, p.z, 0x3a3630, null, 16);
        b.cylOn(r, 0.028, p.x, Y, p.z, iron, null, 16);
        for (let g = 0; g < 3; g++) {
          const rr = r * (0.32 + g * 0.28);
          for (let k = 0; k < 6 + g * 4; k++) {
            const a = (k / (6 + g * 4)) * TAU + g * 0.3;
            b.box(0.05, 0.008, 0.05, p.x + Math.cos(a) * rr, Y + 0.03, p.z + Math.sin(a) * rr,
              0x5a544a, { y: a });
          }
        }
      } else if (roll < 0.42) {
        // Square valve or stopcock plate, set flush, usually skewed.
        const w = rnd.range(0.16, 0.26);
        const a = rnd.range(-0.14, 0.14);
        b.box(w + 0.06, 0.016, w + 0.06, p.x, Y + 0.002, p.z, 0x3a3630, { y: a });
        b.box(w, 0.022, w, p.x, Y + 0.008, p.z, iron, { y: a });
        b.box(w * 0.5, 0.006, 0.02, p.x, Y + 0.02, p.z, 0x6a655c, { y: a });
      } else if (roll < 0.52 && eraIdx <= 2) {
        // Coal hole: two hinged leaves, worn smooth, bolted shut by 1965.
        b.box(0.62, 0.02, 0.9, p.x, Y + 0.004, p.z, 0x2e2a26, { y: p.rot });
        for (const sgn of [-1, 1]) {
          b.box(0.27, 0.03, 0.84, p.x + Math.cos(p.rot) * sgn * 0.155, Y + 0.014,
            p.z - Math.sin(p.rot) * sgn * 0.155, iron, { y: p.rot });
        }
        b.cylOn(0.035, 0.016, p.x, Y + 0.03, p.z, 0x6a655c, null, 8);
      } else if (roll < 0.60) {
        // Telecom pull-box — the lid legend changes with the decade.
        b.box(0.46, 0.02, 0.34, p.x, Y + 0.004, p.z, 0x3a3630, { y: p.rot });
        b.box(0.40, 0.026, 0.28, p.x, Y + 0.012, p.z, patch[eraIdx % 3], { y: p.rot });
        b.box(0.22, 0.006, 0.05, p.x, Y + 0.026, p.z, 0x8a8478, { y: p.rot });
      } else if (roll < 0.74) {
        // A patch where somebody dug and filled: different mix, wrong colour,
        // hard edge. Every real pavement is half patches.
        const w = rnd.range(0.7, 1.9), d = rnd.range(0.6, 1.3);
        b.box(w, 0.014, d, p.x, Y + 0.001, p.z, patch[rnd.int(0, 2)], { y: rnd.range(-0.1, 0.1) });
      }
    }
  }

  /* ── Chalk, in the decades when children played in the street ── */
  if (eraIdx <= 1) {
    const p = walkPoint(rnd.pick(sides), rnd.range(0.3, 0.7), 2.1);
    const chalk = 0xd8d0c0;
    for (let k = 0; k < 8; k++) {
      const w = k % 3 === 2 ? 0.62 : 0.32;
      b.box(w, 0.004, 0.3, p.x + Math.cos(p.rot) * 0, Y + 0.012 + 0.001,
        p.z + (k - 4) * 0.34, chalk, { y: p.rot });
      b.box(w - 0.06, 0.005, 0.24, p.x, Y + 0.014, p.z + (k - 4) * 0.34, 0xb8ae9c, { y: p.rot });
    }
  }

  /* ── Litter: what this decade drops ───────────────────────────── */
  const LITTER = {
    0: [[0xe4e0d4, 0.030, 0.008, 0.014], [0xd8c8a0, 0.05, 0.01, 0.03], [0x8a7a5c, 0.09, 0.004, 0.07]],
    1: [[0xe4e0d4, 0.030, 0.008, 0.014], [0xc83a2a, 0.026, 0.004, 0.026], [0x2a6a8a, 0.11, 0.004, 0.08]],
    2: [[0xd8d4c8, 0.028, 0.008, 0.014], [0xe8c840, 0.028, 0.004, 0.028], [0xc03a6a, 0.13, 0.004, 0.09]],
    3: [[0xf0efe8, 0.055, 0.045, 0.055], [0x8a8a90, 0.03, 0.003, 0.03], [0xd8d8d8, 0.10, 0.004, 0.07]],
    4: [[0x6a4a30, 0.058, 0.05, 0.058], [0x2a8a5a, 0.03, 0.004, 0.03], [0xf0f0f0, 0.09, 0.004, 0.06]],
    5: [[0x9fd8c0, 0.05, 0.035, 0.05], [0x8adcff, 0.02, 0.004, 0.02], [0xd8e8e0, 0.07, 0.003, 0.05]],
  }[eraIdx];
  const litterN = eraIdx === 2 ? 90 : eraIdx === 5 ? 22 : eraIdx === 4 ? 34 : 58;
  for (let i = 0; i < litterN; i++) {
    const side = rnd.pick(sides);
    const p = walkPoint(side, rnd.range(0.03, 0.97), rnd.range(0.25, BLOCK.sidewalk - 0.35));
    const [col, w, h, d] = rnd.pick(LITTER);
    b.box(w, h, d, p.x + rnd.range(-0.2, 0.2), Y + h / 2 + 0.004, p.z + rnd.range(-0.2, 0.2),
      col, { y: rnd.range(0, TAU), x: rnd.chance(0.3) ? rnd.range(-0.4, 0.4) : 0 });
  }

  /* ── Gum. Nobody removes gum. ─────────────────────────────────── */
  for (let i = 0; i < (eraIdx >= 2 && eraIdx <= 4 ? 70 : 30); i++) {
    const p = walkPoint(rnd.pick(sides), rnd.range(0.02, 0.98), rnd.range(0.3, BLOCK.sidewalk - 0.4));
    b.cylOn(rnd.range(0.018, 0.036), 0.003, p.x + rnd.range(-0.25, 0.25), Y + 0.002,
      p.z + rnd.range(-0.25, 0.25), rnd.pick([0x2e2a26, 0x3a3630, 0x46423a]), null, 6);
  }

  /* ── Where somebody feeds the birds ───────────────────────────
     The flock is not scattered evenly around the block; it is thickest here,
     and has been for eighty years, because at about half past two somebody
     comes out and empties a paper bag onto this square of pavement. */
  {
    const p = walkPoint('N', 0.31, 2.6);
    for (let i = 0; i < 120; i++) {
      const a = rnd.range(0, TAU), r = Math.sqrt(rnd.range(0, 1)) * 0.72;
      b.box(0.016, 0.008, 0.016, p.x + Math.cos(a) * r, Y + 0.006, p.z + Math.sin(a) * r,
        rnd.pick([0xd8c890, 0xc8b478, 0xe0d4a8, 0x9a8a5c]), { y: rnd.range(0, TAU) });
    }
    // The bag, folded flat and weighted with a stone, waiting for tomorrow.
    b.box(0.16, 0.02, 0.22, p.x + 0.9, Y + 0.012, p.z - 0.4, 0xc8b490, { y: 0.4 });
    b.sphere(0.05, p.x + 0.9, Y + 0.04, p.z - 0.4, 0x6a655c, true);
    out.interactables.push({
      id: 'secret:feeder', secret: true,
      pos: new THREE.Vector3(p.x, BLOCK.curbHeight + 0.4, p.z), radius: 2.6,
      title: 'Half past two', sub: 'Seed on the pavement', kind: 'secret',
      body: [{ type: 'p', text: [
        'Millet and cracked corn, thrown in an arc from a paper bag, still in the shape of the throw.',
        'It was Mrs Prazak from 1946 until she died, then her son, then a woman from the third floor who never gave her name, then the man who runs the shop on the corner — whichever shop that is this decade. None of them has ever met the one before. Each of them started because the birds were already waiting.',
      ].join(' ') }],
      foot: `Vine Street · ${era.year}`,
    });
  }

  /* ── Studs: the 2055 pavement knows where everyone is ─────────── */
  if (eraIdx === 5) {
    for (const side of sides) {
      for (let i = 0; i < 22; i++) {
        const p = walkPoint(side, (i + 0.5) / 22, 0.42);
        emit.cylOn(0.028, 0.006, p.x, Y + 0.004, p.z, 0x3ad8c0, null, 8);
      }
    }
  }
}

function buildProps(out, ctx, era, eraIdx, rnd) {
  const { mats } = ctx;
  const b = new Bucket();
  const emit = new Bucket();
  const glass = new Bucket();
  const set = new Set(era.props);
  const lampSpec = LAMP[era.lamp];

  /* ── Street lamps: one every 16 m, alternating sides ───────────── */
  const lampT = [0.12, 0.38, 0.62, 0.88];
  for (const side of ['N', 'S', 'E', 'W']) {
    for (const t of lampT) {
      const p = walkPoint(side, t, 0.9);
      buildLamp(b, emit, glass, p, lampSpec, era, out, eraIdx);
      out.blockers.push({ x: p.x, z: p.z, r: 0.28 });
    }
  }

  /* ── Everything else, placed on a seeded schedule ─────────────── */
  const slots = [];
  for (const side of ['N', 'S', 'E', 'W']) {
    for (let i = 0; i < 14; i++) slots.push({ side, t: (i + 0.5) / 14 });
  }
  rnd.shuffle(slots);

  const wanted = era.props.filter((p) => !['fireEscape', 'waterTower', 'acWindow', 'neonSign', 'graffiti', 'securityGrate', 'scaffold', 'crane', 'sidewalkShed', 'greenWall', 'solarRoof', 'greenRoof', 'plywood', 'chainlink', 'coalHatch', 'awningCrank', 'clothesline', 'qrPoster', 'fallout', 'acRooftop', 'cellAntenna', 'droneDock', 'waterReclaim'].includes(p));

  let si = 0;
  const take = () => slots[(si++) % slots.length];

  for (const kind of wanted) {
    const count = PROP_COUNT[kind] ?? 2;
    for (let i = 0; i < count; i++) {
      const s = take();
      const inset = PROP_INSET[kind] ?? 1.2;
      const p = walkPoint(s.side, s.t + rnd.range(-0.02, 0.02), inset);
      buildProp(kind, b, emit, glass, p, era, eraIdx, rnd, out, ctx, i);
    }
  }

  /* Ironwork, hatches and the day's litter */
  buildPavementDetail(b, emit, era, eraIdx, rnd, out);

  /* Alley dressing */
  buildAlley(b, emit, out, ctx, era, eraIdx, rnd);

  const m = b.mesh(mats.vcol('matte'), { name: 'props' });
  if (m) out.group.add(m);
  const em = emit.mesh(mats.emitVcol({ strength: 2.4 }), { cast: false });
  if (em) out.group.add(em);
  const gm = glass.mesh(mats.glass(0xc8d8e0, { opacity: 0.34, rough: 0.1 }), { cast: false, receive: false });
  if (gm) out.group.add(gm);
}

const PROP_COUNT = {
  hydrantSquat: 2, hydrantModern: 2, hydrantHeritage: 2,
  mailboxIron: 1, mailboxUSPS: 2, newsstand: 1, newsRack: 3, newsRackTabloid: 3, newsRackFree: 3,
  ashcan: 4, trashCan65: 4, trashCan85: 4, trashCan05: 4, trashCan25: 4,
  parkingMeterEarly: 4, parkingMeterChrome: 8, meterKiosk: 2,
  phoneBoothWood: 1, phoneBoothGlass: 2, payphoneShell: 2, payphoneStub: 1,
  busShelter65: 1, busShelter85: 1, busShelterAd: 1, busShelterLED: 1,
  cigMachine: 1, plantersRound: 3, planterBox: 3, planterLarge: 3, hydroPlanter: 4,
  dumpster: 2, steamManhole: 1, milkCrate: 3, bikeChained: 3, bikeRack: 2, bikeRackHoop: 3,
  recycleBin: 2, recycleTrio: 2, escooterCorral: 1, parklet: 1, littleLibrary: 1,
  evCharger: 2, bollard: 6, bollardHolo: 6, securityCam: 3, deliveryRobot: 1,
  cleanBot: 1, droneDock: 1, eInkSign: 2, solarCanopy: 1, benchGlow: 2,
  inductionPad: 0, airPylon: 2, mistArch: 1, heritagePlaque: 1, seedLibrary: 1,
  sandwichBoard: 2, trafficCone: 4, barberPole: 0, milkTruck: 0, holoAd: 3,
  bench: 3, treeStreet: 4,
};
const PROP_INSET = {
  parkingMeterEarly: 0.7, parkingMeterChrome: 0.7, meterKiosk: 0.8,
  hydrantSquat: 0.8, hydrantModern: 0.8, hydrantHeritage: 0.8,
  bollard: 0.5, bollardHolo: 0.5, trafficCone: 0.4,
  busShelter65: 1.6, busShelter85: 1.6, busShelterAd: 1.6, busShelterLED: 1.6,
  newsstand: 1.8, parklet: -1.6, escooterCorral: 0.8, solarCanopy: 2.0,
  sandwichBoard: 2.9, dumpster: 3.0, milkCrate: 3.2, securityCam: 3.6,
};

function buildLamp(b, emit, glass, p, spec, era, out, eraIdx) {
  const { x, z, rot } = p;
  const h = spec.height;
  const y0 = BLOCK.curbHeight;
  const inward = { x: -p.nx, z: -p.nz };

  switch (spec.pole) {
    case 'fluted':
      b.taper(0.09, 0.16, h * 0.9, x, y0, z, 0x2e3a34, 10);
      b.cylOn(0.22, 0.4, x, y0, z, 0x2e3a34, null, 10);
      b.cyl(0.2, 0.14, x, y0 + h * 0.9, z, 0x2e3a34, null, 10);
      b.sphere(0.32, x, y0 + h * 0.9 + 0.34, z, 0xf0e8d0);
      emit.sphere(0.26, x, y0 + h * 0.9 + 0.34, z, 0xfff0c8);
      b.rod(x - 0.34, y0 + h * 0.78, z, x + 0.34, y0 + h * 0.78, z, 0.03, 0x2e3a34);
      break;
    case 'steel':
      b.taper(0.1, 0.15, h, x, y0, z, 0x4a4e4a, 8);
      b.rod(x, y0 + h, z, x + inward.x * 2.2, y0 + h + 0.55, z + inward.z * 2.2, 0.075, 0x4a4e4a);
      b.box(0.72, 0.26, 0.48, x + inward.x * 2.5, y0 + h + 0.4, z + inward.z * 2.5, 0x5a5e5a, { y: rot });
      emit.box(0.6, 0.06, 0.38, x + inward.x * 2.5, y0 + h + 0.27, z + inward.z * 2.5, spec.color, { y: rot });
      break;
    case 'tapered':
      b.taper(0.08, 0.14, h, x, y0, z, 0x3a3e42, 8);
      b.rod(x, y0 + h, z, x + inward.x * 1.8, y0 + h + 0.1, z + inward.z * 1.8, 0.06, 0x3a3e42);
      b.box(0.62, 0.12, 0.34, x + inward.x * 2.0, y0 + h + 0.04, z + inward.z * 2.0, 0x3a3e42, { y: rot });
      emit.box(0.54, 0.04, 0.28, x + inward.x * 2.0, y0 + h - 0.03, z + inward.z * 2.0, spec.color, { y: rot });
      break;
    default:
      b.taper(0.06, 0.1, h, x, y0, z, 0x2a3a3e, 8);
      b.box(0.3, 0.1, 0.3, x, y0 + h + 0.05, z, 0x2a3a3e);
      emit.box(0.26, 0.04, 0.26, x, y0 + h - 0.01, z, spec.color);
      // 2055: a soft ring of light down the pole
      emit.cyl(0.062, h * 0.7, x, y0 + h * 0.45, z, spec.color, null, 8);
  }

  const lampX = x + inward.x * (spec.pole === 'fluted' ? 0 : 2.0);
  const lampZ = z + inward.z * (spec.pole === 'fluted' ? 0 : 2.0);
  out.lights.push({
    pos: new THREE.Vector3(lampX, y0 + h - 0.2, lampZ),
    color: spec.color, intensity: spec.intensity * 34, distance: h * 3.4,
    key: `lamp:${x.toFixed(0)}:${z.toFixed(0)}`, night: true,
  });
  out.glows.push({ x: lampX, y: y0 + h - 0.12, z: lampZ, r: 2.6 * spec.intensity, color: spec.color, kind: 'halo' });
  out.pools.push({ x: lampX, z: lampZ, r: h * 0.95, color: spec.color, strength: spec.intensity });

  // Wire from a lamp to the building line in the older eras.
  if (eraIdx === 0) b.rod(x, y0 + h * 0.86, z, x - p.nx * 3.4, y0 + h * 0.86 + 0.6, z - p.nz * 3.4, 0.012, 0x2a2a2a);
}

function buildProp(kind, b, emit, glass, p, era, eraIdx, rnd, out, ctx, index) {
  const { x, z, rot } = p;
  const y = BLOCK.curbHeight;
  const R = { y: rot };
  const inward = { x: -p.nx, z: -p.nz };
  const block = (r) => out.blockers.push({ x, z, r });

  switch (kind) {
    /* ── hydrants ────────────────────────────────────────────── */
    case 'hydrantSquat':
      b.cylOn(0.2, 0.62, x, y, z, 0xb03a2a, null, 10);
      b.sphere(0.2, x, y + 0.66, z, 0xb03a2a);
      b.cyl(0.11, 0.24, x, y + 0.36, z, 0xb03a2a, { z: Math.PI / 2 }, 8);
      b.cyl(0.09, 0.34, x, y + 0.36, z, 0xb03a2a, { x: Math.PI / 2 }, 8);
      block(0.28); break;
    case 'hydrantModern': case 'hydrantHeritage': {
      const col = kind === 'hydrantHeritage' ? 0x7a8a80 : 0xd8b820;
      b.cylOn(0.16, 0.82, x, y, z, col, null, 10);
      b.cylOn(0.24, 0.1, x, y, z, col, null, 10);
      b.sphere(0.17, x, y + 0.86, z, col);
      b.cyl(0.1, 0.3, x, y + 0.5, z, col, { z: Math.PI / 2 }, 8);
      block(0.26); break;
    }

    /* ── mail & news ─────────────────────────────────────────── */
    case 'mailboxIron':
      b.cylOn(0.3, 1.0, x, y, z, 0x2a4a3a, null, 12);
      b.sphere(0.3, x, y + 1.0, z, 0x2a4a3a);
      b.box(0.4, 0.14, 0.06, x, y + 0.86, z + 0.3, 0x1a2a24, R);
      b.cylOn(0.06, 0.2, x, y, z, 0x2a2a2a, null, 6);
      block(0.36); break;
    case 'mailboxUSPS':
      b.boxOn(0.72, 1.15, 0.58, x, y, z, eraIdx >= 3 ? 0x2a4a8a : 0x1a3a7a, R);
      b.cyl(0.29, 0.72, x, y + 1.15, z, eraIdx >= 3 ? 0x2a4a8a : 0x1a3a7a, { z: Math.PI / 2, y: rot }, 12);
      b.box(0.5, 0.2, 0.08, x + inward.x * 0.3, y + 1.2, z + inward.z * 0.3, 0x14284a, R);
      b.boxOn(0.14, 0.28, 0.14, x - 0.2, y, z, 0x2a2a2a);
      b.boxOn(0.14, 0.28, 0.14, x + 0.2, y, z, 0x2a2a2a);
      block(0.42); break;
    case 'newsstand': {
      const w = 2.6, d = 1.5, h = 2.4;
      b.boxOn(w, h, d, x, y, z, 0x4a5a4a, R);
      b.box(w + 0.5, 0.12, d + 0.7, x, y + h, z, 0x3a4a3a, R);
      b.box(w - 0.3, 1.0, 0.08, x + inward.x * (d / 2), y + 1.4, z + inward.z * (d / 2), 0x1a1a1a, R);
      for (let i = 0; i < 8; i++) {
        b.box(0.3, 0.4, 0.02, x + inward.x * (d / 2 + 0.06) + (i % 4 - 1.5) * 0.36 * Math.abs(inward.z),
          y + 1.6 - Math.floor(i / 4) * 0.46,
          z + inward.z * (d / 2 + 0.06) + (i % 4 - 1.5) * 0.36 * Math.abs(inward.x), 0xd8d0c0, R);
      }
      out.blockers.push({ x, z, r: 1.5 });
      out.interactables.push({
        id: `newsstand:${era.year}`, pos: new THREE.Vector3(x + inward.x * 1.6, 1.5, z + inward.z * 1.6), radius: 2.6,
        title: 'Newsstand', sub: 'Read the headlines', kind: 'read',
        body: [
          { type: 'sign', text: era.year === 1945 ? 'JAPAN SIGNS\nTROOPS HOME BY CHRISTMAS\nSTEEL STRIKE LOOMS' : 'PAPERS · CANDY · SMOKES' },
          { type: 'p', text: 'Three editions a day and a man who has read all of them.' },
        ],
        foot: `5th & Vine · ${era.year}`,
      });
      break;
    }
    case 'newsRack': case 'newsRackTabloid': case 'newsRackFree': {
      const cols = kind === 'newsRackFree' ? [0x2a6a4a, 0xd8302a, 0x2a4a8a] : kind === 'newsRackTabloid' ? [0xd8302a, 0x2a2a6a] : [0x2a4a3a, 0x6a2a2a];
      const col = cols[index % cols.length];
      b.boxOn(0.5, 1.15, 0.42, x, y, z, col, R);
      b.box(0.42, 0.42, 0.05, x + inward.x * 0.22, y + 0.86, z + inward.z * 0.22, 0x1a1a1e, R);
      b.box(0.5, 0.1, 0.46, x, y + 1.2, z, col, R);
      b.boxOn(0.08, 0.3, 0.08, x, y, z, 0x3a3a3a);
      block(0.3); break;
    }

    /* ── bins ────────────────────────────────────────────────── */
    case 'ashcan':
      b.taper(0.28, 0.24, 0.85, x, y, z, 0x4a4a44, 12);
      b.cyl(0.3, 0.06, x, y + 0.88, z, 0x3a3a34, null, 12);
      block(0.32); break;
    case 'trashCan65': case 'trashCan85':
      b.taper(0.3, 0.26, 0.95, x, y, z, kind === 'trashCan65' ? 0x2e7a5a : 0x3a4a3a, 10);
      for (let i = 0; i < 8; i++) b.cyl(0.02, 0.9, x + Math.cos(i * 0.79) * 0.29, y + 0.47, z + Math.sin(i * 0.79) * 0.29, 0x2a2a2a, null, 6);
      block(0.34); break;
    case 'trashCan05': case 'trashCan25': case 'recycleBin': case 'recycleTrio': {
      const cols = kind === 'recycleTrio' ? [0x2a6a4a, 0x2a4a8a, 0x6a6a2a] : [0x2a3a3a];
      for (let i = 0; i < cols.length; i++) {
        const ox = (i - (cols.length - 1) / 2) * 0.75;
        b.boxOn(0.66, 1.05, 0.6, x + ox * Math.abs(inward.z), y, z + ox * Math.abs(inward.x), cols[i], R);
        b.box(0.7, 0.1, 0.64, x + ox * Math.abs(inward.z), y + 1.08, z + ox * Math.abs(inward.x), 0x1a2a2a, R);
        b.box(0.4, 0.1, 0.3, x + ox * Math.abs(inward.z), y + 1.16, z + ox * Math.abs(inward.x), 0x0a1a1a, R);
      }
      block(cols.length * 0.4); break;
    }

    /* ── meters ──────────────────────────────────────────────── */
    case 'parkingMeterEarly': case 'parkingMeterChrome': {
      const chrome = kind === 'parkingMeterChrome';
      b.cylOn(0.05, 1.25, x, y, z, chrome ? 0xb8bcc0 : 0x4a4a44, null, 8);
      b.boxOn(0.22, 0.36, 0.18, x, y + 1.25, z, chrome ? 0xd8dce0 : 0x3a3a34, R);
      b.box(0.16, 0.16, 0.04, x + inward.x * 0.1, y + 1.5, z + inward.z * 0.1, 0xf0ece0, R);
      if (chrome) b.box(0.24, 0.06, 0.2, x, y + 1.62, z, 0xd8dce0, R);
      block(0.14); break;
    }
    case 'meterKiosk':
      b.boxOn(0.4, 1.5, 0.34, x, y, z, 0x3a4a52, R);
      b.box(0.36, 0.28, 0.06, x + inward.x * 0.18, y + 1.2, z + inward.z * 0.18, 0x1a2a2a, R);
      emit.box(0.28, 0.2, 0.02, x + inward.x * 0.21, y + 1.2, z + inward.z * 0.21, 0x4a8a6a, R);
      b.box(0.44, 0.12, 0.4, x, y + 1.56, z, 0x2a3a42, R);
      block(0.28); break;

    /* ── telephony ───────────────────────────────────────────── */
    case 'phoneBoothWood': case 'phoneBoothGlass': {
      const woodBooth = kind === 'phoneBoothWood';
      const col = woodBooth ? 0x5a4030 : 0xd8dce0;
      const h = 2.3, w = 0.95;
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        b.boxOn(0.1, h, 0.1, x + ox * w / 2, y, z + oz * w / 2, col);
      }
      b.box(w + 0.16, 0.16, w + 0.16, x, y + h + 0.05, z, woodBooth ? 0x4a3a28 : 0xc03a2a);
      glass.box(w - 0.05, h - 0.5, w - 0.05, x, y + h / 2 + 0.25, z, 0xffffff);
      if (!woodBooth) emit.box(w - 0.2, 0.06, w - 0.2, x, y + h - 0.06, z, 0xf0f4ff);
      b.box(0.36, 0.5, 0.14, x - inward.x * (w / 2 - 0.1), y + 1.35, z - inward.z * (w / 2 - 0.1), 0x2a2a2e, R);
      out.blockers.push({ x, z, r: 0.8 });
      out.interactables.push({
        id: `phone:${era.year}`, pos: new THREE.Vector3(x + inward.x * 1.1, 1.4, z + inward.z * 1.1), radius: 2.0,
        title: woodBooth ? 'Telephone booth' : 'Pay phone', sub: 'Pick up', kind: 'read',
        body: [{ type: 'p', text: woodBooth
          ? 'Oak, a folding door, a shelf with a directory chained to it, and a bakelite handset warm from the last call. Five cents.'
          : 'Aluminium and glass, a bank of coin slots and a dial tone loud enough to hear over a bus. Ten cents.' }],
        foot: `5th & Vine · ${era.year}`,
      });
      break;
    }
    case 'payphoneShell':
      b.boxOn(0.66, 2.0, 0.3, x, y, z, 0x3a4450, R);
      b.box(0.74, 0.4, 0.5, x, y + 2.1, z, 0x2a3440, R);
      b.box(0.34, 0.6, 0.16, x + inward.x * 0.15, y + 1.35, z + inward.z * 0.15, 0x1a1a1e, R);
      emit.box(0.5, 0.18, 0.02, x + inward.x * 0.16, y + 1.95, z + inward.z * 0.16, 0x3a7ad8, R);
      block(0.36); break;
    case 'payphoneStub':
      b.boxOn(0.4, 1.3, 0.22, x, y, z, 0x6a7480, R);
      b.box(0.3, 0.4, 0.1, x + inward.x * 0.12, y + 1.1, z + inward.z * 0.12, 0x2a2a2e, R);
      block(0.24); break;

    /* ── transit ─────────────────────────────────────────────── */
    case 'busShelter65': case 'busShelter85': case 'busShelterAd': case 'busShelterLED': {
      const w = 4.2, d = 1.5, h = 2.5;
      const frame = kind === 'busShelter65' ? 0xd8dce0 : kind === 'busShelter85' ? 0x3a4a3a : kind === 'busShelterAd' ? 0x6a7480 : 0x2a3a3e;
      const along = { x: Math.abs(inward.z), z: Math.abs(inward.x) };
      for (const s of [-1, 1]) {
        b.boxOn(0.12, h, 0.12, x + s * (w / 2) * along.x, y, z + s * (w / 2) * along.z, frame);
        b.boxOn(0.12, h, 0.12, x + s * (w / 2) * along.x - inward.x * d, y, z + s * (w / 2) * along.z - inward.z * d, frame);
      }
      b.box(w + 0.4, 0.12, d + 0.5, x - inward.x * d / 2, y + h + 0.05, z - inward.z * d / 2, frame, R);
      glass.box(w * along.x + 0.1 * along.z, h - 0.6, w * along.z + 0.1 * along.x, x - inward.x * d, y + h / 2 + 0.3, z - inward.z * d, 0xffffff);
      b.box(1.9 * along.x + 0.14 * along.z, 0.5, 1.9 * along.z + 0.14 * along.x, x - inward.x * d / 2, y + 0.5, z - inward.z * d / 2, frame, R);
      // Backlit ad panel on the end
      if (kind === 'busShelterAd' || kind === 'busShelterLED') {
        const ex = x + (w / 2 + 0.1) * along.x, ez = z + (w / 2 + 0.1) * along.z;
        b.box(0.1 * along.x + 1.3 * along.z, 1.9, 0.1 * along.z + 1.3 * along.x, ex, y + 1.4, ez, frame);
        emit.box(0.02 * along.x + 1.1 * along.z, 1.7, 0.02 * along.z + 1.1 * along.x, ex + inward.x * 0.07, y + 1.4, ez + inward.z * 0.07, 0xe8e8f0);
        out.lights.push({ pos: new THREE.Vector3(ex, y + 1.4, ez), color: 0xd8e8ff, intensity: 9.6, distance: 6, key: `shelter${index}`, night: true });
      }
      if (kind === 'busShelterLED') emit.box(w - 0.4, 0.06, 0.1, x - inward.x * (d - 0.1), y + h - 0.1, z - inward.z * (d - 0.1), 0xdcecff, R);
      out.blockers.push({ x: x - inward.x * d / 2, z: z - inward.z * d / 2, r: 1.6 });
      break;
    }

    /* ── plants ──────────────────────────────────────────────── */
    case 'plantersRound': case 'planterBox': case 'planterLarge': case 'hydroPlanter': {
      const big = kind === 'planterLarge' || kind === 'hydroPlanter';
      const col = kind === 'plantersRound' ? 0xb8b0a0 : kind === 'hydroPlanter' ? 0x3a5a52 : 0x6a5a48;
      if (kind === 'plantersRound') b.taper(0.5, 0.42, 0.7, x, y, z, col, 12);
      else b.boxOn(big ? 1.5 : 1.1, big ? 0.75 : 0.6, big ? 0.9 : 0.8, x, y, z, col, R);
      const n = big ? 9 : 5;
      for (let i = 0; i < n; i++) {
        b.sphere(rnd.range(0.16, 0.34), x + rnd.range(-0.5, 0.5), y + (big ? 0.9 : 0.78), z + rnd.range(-0.35, 0.35),
          rnd.pick(era.palette.bio || [0x4a7a3a, 0x5a8a42, 0x3a6a30]), true);
      }
      if (kind === 'hydroPlanter') emit.box(1.2, 0.04, 0.06, x, y + 0.72, z + 0.42, 0x9fe870, R);
      block(big ? 0.8 : 0.6); break;
    }
    case 'treeStreet': {
      const th = eraIdx >= 4 ? 6.5 : 4.6;
      b.taper(0.11, 0.2, th * 0.5, x, y, z, 0x4a3a2c, 8);
      for (let i = 0; i < 18; i++) {
        b.sphere(rnd.range(0.5, 0.95), x + rnd.range(-1.3, 1.3), y + th * 0.55 + rnd.range(0, 1.6), z + rnd.range(-1.3, 1.3),
          rnd.pick(eraIdx === 0 ? [0x7a7a3a, 0x8a7a32] : [0x3a6a34, 0x4a7a3a]), true);
      }
      b.box(1.5, 0.06, 1.5, x, y + 0.02, z, 0x3a2a1c);
      for (let i = 0; i < 4; i++) b.box(1.5, 0.14, 0.09, x, y + 0.1, z + (i - 1.5) * 0.45, 0x4a4a44);
      block(0.35); break;
    }

    /* ── alley & service ─────────────────────────────────────── */
    case 'dumpster':
      b.boxOn(2.2, 1.25, 1.2, x, y, z, rnd.pick([0x2a5a3a, 0x3a4a5a, 0x5a3a3a]), R);
      b.box(2.3, 0.1, 1.3, x, y + 1.3, z, 0x2a3a2a, { y: rot, x: -0.12 });
      b.cyl(0.12, 0.1, x - 0.9, y + 0.12, z + 0.5, 0x2a2a2a, { z: Math.PI / 2 }, 8);
      b.cyl(0.12, 0.1, x + 0.9, y + 0.12, z + 0.5, 0x2a2a2a, { z: Math.PI / 2 }, 8);
      out.blockers.push({ x, z, r: 1.3 }); break;
    case 'milkCrate':
      for (let i = 0; i < rnd.int(2, 4); i++) {
        b.boxOn(0.42, 0.3, 0.42, x + rnd.range(-0.3, 0.3), y + i * 0.3, z + rnd.range(-0.3, 0.3),
          rnd.pick([0xd83a3a, 0x2a5a8a, 0xe8c040]), { y: rnd.range(0, 3) });
      }
      break;
    case 'trafficCone':
      b.cone(0.19, 0.62, x, y + 0.31, z, 0xe8663a);
      b.box(0.42, 0.04, 0.42, x, y + 0.02, z, 0x2a2a2e);
      b.cyl(0.15, 0.1, x, y + 0.4, z, 0xf0f0f0, null, 8);
      break;

    /* ── bikes & micromobility ───────────────────────────────── */
    case 'bikeChained': buildBike(b, x, z, y, rot + rnd.range(-0.4, 0.4), rnd, eraIdx); block(0.5); break;
    case 'bikeRack': case 'bikeRackHoop': {
      const n = kind === 'bikeRackHoop' ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const ox = (i - (n - 1) / 2) * 1.1;
        const bx = x + ox * Math.abs(inward.z), bz = z + ox * Math.abs(inward.x);
        b.rod(bx - 0.4 * Math.abs(inward.z), y, bz - 0.4 * Math.abs(inward.x), bx - 0.4 * Math.abs(inward.z), y + 0.85, bz - 0.4 * Math.abs(inward.x), 0.04, 0x4a5a52);
        b.rod(bx + 0.4 * Math.abs(inward.z), y, bz + 0.4 * Math.abs(inward.x), bx + 0.4 * Math.abs(inward.z), y + 0.85, bz + 0.4 * Math.abs(inward.x), 0.04, 0x4a5a52);
        b.rod(bx - 0.4 * Math.abs(inward.z), y + 0.85, bz - 0.4 * Math.abs(inward.x), bx + 0.4 * Math.abs(inward.z), y + 0.85, bz + 0.4 * Math.abs(inward.x), 0.04, 0x4a5a52);
        if (rnd.chance(0.6)) buildBike(b, bx, bz, y, rot + Math.PI / 2, rnd, eraIdx);
      }
      block(0.9); break;
    }
    case 'escooterCorral': {
      b.box(3.4, 0.02, 1.6, x, y + 0.02, z, 0xe8c040, R);
      for (let i = 0; i < 4; i++) {
        const ox = (i - 1.5) * 0.8;
        const sx = x + ox * Math.abs(inward.z), sz = z + ox * Math.abs(inward.x);
        b.cyl(0.1, 0.06, sx - 0.3, y + 0.06, sz, 0x2a2a2e, { z: Math.PI / 2 }, 8);
        b.cyl(0.1, 0.06, sx + 0.3, y + 0.06, sz, 0x2a2a2e, { z: Math.PI / 2 }, 8);
        b.box(0.7, 0.06, 0.18, sx, y + 0.12, sz, 0x3a3a3e, R);
        b.rod(sx - 0.24, y + 0.12, sz, sx - 0.3, y + 1.05, sz, 0.03, 0x8a8a90);
        b.box(0.44, 0.05, 0.05, sx - 0.3, y + 1.05, sz, 0x2a2a2e, R);
        emit.box(0.1, 0.04, 0.04, sx - 0.3, y + 1.0, sz, 0xe8c040, R);
      }
      out.blockers.push({ x, z, r: 1.4 }); break;
    }

    /* ── 2025 & 2055 ─────────────────────────────────────────── */
    case 'evCharger':
      b.boxOn(0.42, 1.5, 0.3, x, y, z, 0x2a3a3a, R);
      emit.box(0.3, 0.24, 0.02, x + inward.x * 0.16, y + 1.15, z + inward.z * 0.16, 0x7fd6a0, R);
      b.rod(x + 0.2, y + 1.2, z, x + 0.35, y + 0.5, z + 0.2, 0.035, 0x1a1a1e);
      block(0.28); break;
    case 'bollard':
      b.cylOn(0.09, 0.95, x, y, z, 0x3a3a3e, null, 10);
      b.sphere(0.1, x, y + 0.95, z, 0x3a3a3e, true);
      b.cyl(0.1, 0.06, x, y + 0.78, z, 0xd8d8d4, null, 10);
      block(0.14); break;
    case 'bollardHolo':
      b.cylOn(0.08, 0.8, x, y, z, 0x2a3a3e, null, 10);
      emit.cyl(0.085, 0.12, x, y + 0.72, z, 0x56d0e0, null, 10);
      emit.cyl(0.06, 0.5, x, y + 1.2, z, 0x56d0e0, null, 8);
      block(0.14); break;
    case 'securityCam': {
      const h = 3.4;
      b.cylOn(0.05, h, x, y, z, 0x8a8a8a, null, 6);
      b.rod(x, y + h, z, x + inward.x * 0.5, y + h, z + inward.z * 0.5, 0.04, 0x8a8a8a);
      b.box(0.18, 0.14, 0.34, x + inward.x * 0.62, y + h - 0.06, z + inward.z * 0.62, 0xd8d8d4, R);
      emit.sphere(0.02, x + inward.x * 0.78, y + h - 0.06, z + inward.z * 0.78, 0xff2a2a, true);
      block(0.1); break;
    }
    case 'deliveryRobot':
      b.boxOn(0.7, 0.55, 1.0, x, y + 0.16, z, 0xd8d8d4, R);
      b.box(0.6, 0.16, 0.8, x, y + 0.8, z, 0x2a3a4a, R);
      for (const [ox, oz] of [[-0.32, -0.36], [0.32, -0.36], [-0.32, 0.36], [0.32, 0.36]]) {
        b.cyl(0.16, 0.09, x + ox, y + 0.16, z + oz, 0x1a1a1e, { z: Math.PI / 2 }, 10);
      }
      emit.box(0.4, 0.05, 0.03, x + inward.x * 0.5, y + 0.6, z + inward.z * 0.5, 0xe8a24a, R);
      b.rod(x, y + 0.86, z, x, y + 1.3, z, 0.015, 0xe8663a);
      out.animated.push({ kind: 'sidewalkBot', pos: new THREE.Vector3(x, y, z), rot });
      block(0.6); break;
    case 'cleanBot':
      b.cylOn(0.42, 0.34, x, y, z, 0x8a9a9a, null, 12);
      b.cyl(0.36, 0.1, x, y + 0.4, z, 0x3a4a4a, null, 12);
      emit.cyl(0.38, 0.03, x, y + 0.36, z, 0x56d0e0, null, 12);
      out.animated.push({ kind: 'cleanBot', pos: new THREE.Vector3(x, y, z) });
      break;
    case 'airPylon':
      b.taper(0.14, 0.3, 4.2, x, y, z, 0x8a9a9a, 8);
      b.box(0.5, 0.7, 0.24, x, y + 4.4, z, 0x3a4a4a, R);
      emit.box(0.3, 0.4, 0.02, x + inward.x * 0.14, y + 4.4, z + inward.z * 0.14, 0x9fe870, R);
      out.interactables.push({
        id: `airpylon:${index}`, pos: new THREE.Vector3(x + inward.x * 1.2, 1.6, z + inward.z * 1.2), radius: 2.2,
        title: 'Air quality pylon', sub: 'Read', kind: 'read',
        body: [
          { type: 'sign', text: 'PM2.5  8 µg/m³\nO₃      31 ppb\nTEMP    29.4 °C\nSTATUS  GOOD' },
          { type: 'p', text: 'One of eleven thousand across the city, all reporting to the same public ledger. The number on this one has not been above 20 since 2049.' },
        ],
        foot: `5th & Vine · ${era.year}`,
      });
      block(0.3); break;
    case 'mistArch': {
      const w = 3.4;
      for (const s of [-1, 1]) b.cylOn(0.11, 3.0, x + s * w / 2 * Math.abs(inward.z), y, z + s * w / 2 * Math.abs(inward.x), 0xa8b0ac, null, 8);
      b.box(w * Math.abs(inward.z) + 0.24, 0.2, w * Math.abs(inward.x) + 0.24, x, y + 3.1, z, 0xa8b0ac, R);
      emit.box(w * 0.9 * Math.abs(inward.z) + 0.06, 0.05, w * 0.9 * Math.abs(inward.x) + 0.06, x, y + 2.96, z, 0x56d0e0, R);
      out.animated.push({ kind: 'mist', pos: new THREE.Vector3(x, y + 2.9, z) });
      break;
    }
    case 'solarCanopy': {
      const w = 6.0;
      for (const s of [-1, 1]) b.cylOn(0.13, 3.4, x + s * w / 2 * Math.abs(inward.z), y, z + s * w / 2 * Math.abs(inward.x), 0x5a6a6a, null, 8);
      b.box(w * Math.abs(inward.z) + 2.2 * Math.abs(inward.x), 0.14, w * Math.abs(inward.x) + 2.2 * Math.abs(inward.z), x, y + 3.5, z, 0x1a2a3a, R);
      emit.box(w * 0.9 * Math.abs(inward.z), 0.04, w * 0.9 * Math.abs(inward.x), x, y + 3.4, z, 0xffe6bd, R);
      out.lights.push({ pos: new THREE.Vector3(x, y + 3.2, z), color: 0xffe6bd, intensity: 16.0, distance: 9, key: `canopy${index}`, night: true });
      break;
    }
    case 'benchGlow': buildStreetBench(b, emit, x, z, y, rot, true); block(1.0); break;
    case 'bench': buildStreetBench(b, emit, x, z, y, rot, false); block(1.0); break;
    case 'eInkSign': {
      b.cylOn(0.07, 2.1, x, y, z, 0x5a6a6a, null, 8);
      b.box(0.9 * Math.abs(inward.z) + 0.08 * Math.abs(inward.x), 1.1, 0.9 * Math.abs(inward.x) + 0.08 * Math.abs(inward.z), x, y + 2.3, z, 0x3a4a4a, R);
      const t = toTexture(signTexture({
        text: rnd.pick(era.ads.posters), style: 'eInk', w: 384, h: 470, seed: 'eink' + index + era.year,
      }), { clamp: true });
      const face = quad(0.8, 1.0, x + inward.x * 0.06, y + 2.3, z + inward.z * 0.06, ctx.mats.printed(t));
      face.rotation.y = rot + Math.PI;
      out.group.add(face);
      block(0.24); break;
    }
    case 'holoAd': {
      const t = toTexture(signTexture({
        text: rnd.pick(era.ads.wall), style: 'holo', w: 512, h: 256, seed: 'holo' + index + era.year,
      }), { clamp: true });
      const m = quad(2.6, 1.3, x + inward.x * 0.5, 3.6, z + inward.z * 0.5,
        ctx.mats.holo(t, { color: rnd.pick(era.palette.holo || [0x56d0e0]), strength: 1.8 }));
      m.rotation.y = rot + Math.PI;
      out.group.add(m);
      out.animated.push({ kind: 'holoAd', mesh: m, seed: rnd.f() });
      out.lights.push({ pos: new THREE.Vector3(x, 3.6, z), color: 0x56d0e0, intensity: 11.2, distance: 8, key: `holo${index}`, night: true });
      break;
    }
    case 'seedLibrary':
      b.boxOn(0.9, 1.3, 0.5, x, y, z, 0x3a5a4a, R);
      b.box(0.94, 0.1, 0.56, x, y + 1.35, z, 0x2a4a3a, R);
      for (let i = 0; i < 6; i++) {
        b.box(0.24, 0.12, 0.04, x + ((i % 3) - 1) * 0.27 * Math.abs(inward.z), y + 1.0 - Math.floor(i / 3) * 0.28, z + ((i % 3) - 1) * 0.27 * Math.abs(inward.x) + inward.z * 0.26, 0xd8d0b0, R);
      }
      out.interactables.push({
        id: 'secret:seeds', secret: true,
        pos: new THREE.Vector3(x + inward.x * 1.2, 1.2, z + inward.z * 1.2), radius: 2.0,
        title: 'Seed library', sub: 'Open the drawers', kind: 'secret',
        body: [
          { type: 'p', text: 'Forty small paper envelopes, hand-labelled. Tomato, bean, chard, a marigold nobody can identify.' },
          { type: 'quote', text: '“Cabbage — from the 1945 beds. Kept going by the Marconi family, then the Kims, then whoever wanted it. Please keep it going.”' },
        ],
        foot: `The Grove · ${era.year}`,
      });
      block(0.5); break;
    case 'heritagePlaque':
      b.cylOn(0.06, 1.2, x, y, z, 0x5a6a6a, null, 8);
      b.box(0.7, 0.5, 0.05, x, y + 1.4, z, 0x8a7a4a, { y: rot, x: -0.5 });
      out.interactables.push({
        id: 'plaque:block', pos: new THREE.Vector3(x + inward.x * 1.1, 1.3, z + inward.z * 1.1), radius: 2.0,
        title: 'Heritage marker', sub: 'Read', kind: 'read',
        body: [
          { type: 'sign', text: '5TH & VINE\nHERITAGE BLOCK\nDESIGNATED 2044' },
          { type: 'p', text: 'Eight buildings, one open lot, one hundred and ten years of continuous occupation. Not preserved as a museum — the designation explicitly permits change, and requires only that the change be legible.' },
        ],
        foot: `5th & Vine · ${era.year}`,
      });
      block(0.2); break;

    /* ── era one-offs ────────────────────────────────────────── */
    case 'cigMachine':
      b.boxOn(0.7, 1.7, 0.4, x, y, z, 0xd83a3a, R);
      b.box(0.6, 0.5, 0.06, x + inward.x * 0.2, y + 1.3, z + inward.z * 0.2, 0xf0ece0, R);
      for (let i = 0; i < 5; i++) b.box(0.08, 0.08, 0.05, x + ((i - 2) * 0.12) * Math.abs(inward.z), y + 0.8, z + ((i - 2) * 0.12) * Math.abs(inward.x) + inward.z * 0.21, 0x2a2a2e, R);
      block(0.4); break;
    case 'sandwichBoard': {
      const t = toTexture(posterTexture(rnd.pick(era.ads.posters).split(' ').slice(0, 3), {
        w: 256, h: 340, tone: era.ads.tone, seed: 'sw' + index + era.year,
      }), { clamp: true });
      for (const s of [-1, 1]) {
        const face = quad(0.62, 0.85, x + inward.x * 0.16 * s, y + 0.52, z + inward.z * 0.16 * s, ctx.mats.printed(t));
        face.rotation.y = rot + (s > 0 ? Math.PI : 0);
        face.rotation.x = s * 0.14;
        out.group.add(face);
      }
      b.rod(x - 0.3, y, z, x - 0.3, y + 0.95, z, 0.02, 0x4a3a2a);
      block(0.4); break;
    }
    case 'parklet': {
      const w = 6.5, d = 2.6;
      b.box(w * Math.abs(inward.z) + d * Math.abs(inward.x), 0.16, w * Math.abs(inward.x) + d * Math.abs(inward.z), x, y - 0.02, z, 0x8a7a5c, R);
      for (let i = 0; i < 3; i++) {
        const ox = (i - 1) * 2.0;
        const tx = x + ox * Math.abs(inward.z), tz = z + ox * Math.abs(inward.x);
        b.cylOn(0.06, 0.72, tx, y + 0.08, tz, 0x2a2a2e, null, 8);
        b.cyl(0.42, 0.06, tx, y + 0.82, tz, 0x3a3a3e, null, 12);
        for (const s of [-1, 1]) {
          b.boxOn(0.4, 0.42, 0.4, tx + s * 0.7 * Math.abs(inward.x) + s * 0.0, y + 0.08, tz + s * 0.7 * Math.abs(inward.z), 0x4a4a4e);
          b.box(0.4, 0.42, 0.06, tx + s * 0.7 * Math.abs(inward.x), y + 0.7, tz + s * 0.7 * Math.abs(inward.z), 0x4a4a4e);
        }
      }
      for (let i = 0; i < 4; i++) {
        const ox = (i - 1.5) * 1.7;
        b.boxOn(0.6, 0.7, 0.6, x + ox * Math.abs(inward.z) - inward.x * 1.1, y + 0.08, z + ox * Math.abs(inward.x) - inward.z * 1.1, 0x5a4a3a);
        for (let k = 0; k < 4; k++) b.sphere(0.22, x + ox * Math.abs(inward.z) - inward.x * 1.1 + rnd.range(-0.2, 0.2), y + 0.86, z + ox * Math.abs(inward.x) - inward.z * 1.1 + rnd.range(-0.2, 0.2), 0x4a7a3a, true);
      }
      // Festoon lights
      for (let i = 0; i < 9; i++) {
        const t2 = i / 8;
        const lx = x + (t2 - 0.5) * w * Math.abs(inward.z), lz = z + (t2 - 0.5) * w * Math.abs(inward.x);
        emit.sphere(0.055, lx, y + 2.4 - Math.sin(t2 * Math.PI) * 0.3, lz, 0xffd8a0, true);
      }
      out.blockers.push({ x, z, r: 2.4 });
      break;
    }
    case 'littleLibrary': break;   // built with the pocket park
    case 'graffiti': case 'steamManhole': break;
    default: break;
  }
}

function buildStreetBench(b, emit, x, z, y, rot, glow) {
  const R = { y: rot };
  b.box(1.9, 0.09, 0.52, x, y + 0.44, z, glow ? 0x3a4a44 : 0x6a5a3a, R);
  b.box(1.9, 0.46, 0.08, x - Math.sin(rot) * 0.24, y + 0.72, z - Math.cos(rot) * 0.24, glow ? 0x3a4a44 : 0x6a5a3a, R);
  for (const s of [-1, 1]) {
    b.box(0.09, 0.44, 0.48, x + Math.cos(rot) * s * 0.82, y + 0.22, z - Math.sin(rot) * s * 0.82, 0x3a3a3e, R);
  }
  if (glow) emit.box(1.7, 0.04, 0.06, x, y + 0.38, z + 0.26, 0x56d0e0, R);
}

function buildBike(b, x, z, y, rot, rnd, eraIdx) {
  const R = { y: rot };
  const col = rnd.pick(eraIdx <= 1 ? [0x2a2a2e, 0x1a3a2a, 0x6a2a2a] : [0xd83a3a, 0x2a5a8a, 0x2a2a2e, 0xe8c040]);
  const wr = 0.34;
  b.cyl(wr, 0.04, x - Math.cos(rot) * 0.52, y + wr, z + Math.sin(rot) * 0.52, 0x1a1a1e, { z: Math.PI / 2, y: rot }, 14);
  b.cyl(wr, 0.04, x + Math.cos(rot) * 0.52, y + wr, z - Math.sin(rot) * 0.52, 0x1a1a1e, { z: Math.PI / 2, y: rot }, 14);
  b.rod(x - Math.cos(rot) * 0.5, y + wr, z + Math.sin(rot) * 0.5, x + Math.cos(rot) * 0.2, y + wr + 0.32, z - Math.sin(rot) * 0.2, 0.022, col);
  b.rod(x + Math.cos(rot) * 0.5, y + wr, z - Math.sin(rot) * 0.5, x + Math.cos(rot) * 0.18, y + wr + 0.44, z - Math.sin(rot) * 0.18, 0.022, col);
  b.rod(x - Math.cos(rot) * 0.1, y + wr + 0.1, z + Math.sin(rot) * 0.1, x - Math.cos(rot) * 0.16, y + wr + 0.5, z + Math.sin(rot) * 0.16, 0.022, col);
  b.box(0.22, 0.06, 0.1, x - Math.cos(rot) * 0.16, y + wr + 0.52, z + Math.sin(rot) * 0.16, 0x1a1a1e, R);
  b.box(0.06, 0.05, 0.44, x + Math.cos(rot) * 0.2, y + wr + 0.5, z - Math.sin(rot) * 0.2, 0x1a1a1e, R);
}

function buildAlley(b, emit, out, ctx, era, eraIdx, rnd) {
  const ax = 7.5, z0 = 12, z1 = 29;
  // Fire escapes on both alley walls, a puddle, and whatever the decade leaves out.
  for (const [wx, dir] of [[5.1, 1], [9.9, -1]]) {
    for (let f = 0; f < 3; f++) {
      const y = 4.6 + f * 3.35;
      for (let i = 0; i < 3; i++) {
        const z = z0 + 3 + i * 5;
        b.box(0.06, 0.06, 1.6, wx + dir * 0.8, y, z, 0x2e2a26);
        b.rod(wx, y, z, wx + dir * 1.5, y, z, 0.03, 0x2e2a26);
      }
    }
    // Downpipe
    b.cylOn(0.09, 13, wx + dir * 0.14, 0.2, z0 + 2, 0x4a4640, null, 8);
  }
  if (eraIdx >= 1 && eraIdx <= 3) {
    for (let i = 0; i < 3; i++) {
      const z = z0 + 3 + i * 5.5;
      b.boxOn(2.0, 1.2, 1.1, ax + rnd.range(-0.6, 0.6), 0, z, rnd.pick([0x2a5a3a, 0x3a4a5a]), { y: rnd.range(-0.2, 0.2) });
    }
  }
  if (eraIdx >= 4) {
    for (let i = 0; i < 4; i++) {
      b.boxOn(0.8, 1.2, 0.7, ax + (i % 2 ? 1.4 : -1.4), 0, z0 + 4 + i * 4, [0x2a6a4a, 0x2a4a8a, 0x6a6a2a, 0x3a3a3e][i]);
    }
  }
  // A single bare bulb over a service door — the alley's only light source.
  const by = 3.1;
  b.box(0.9, 1.9, 0.1, 5.15, 0.95, z0 + 8, 0x2a2a2e);
  b.rod(5.1, by, z0 + 8, 5.5, by, z0 + 8, 0.03, 0x2a2a2a);
  emit.sphere(0.09, 5.55, by, z0 + 8, eraIdx >= 4 ? 0xdcecff : 0xffd8a0, true);
  out.lights.push({
    pos: new THREE.Vector3(5.6, by, z0 + 8),
    color: eraIdx >= 4 ? 0xdcecff : 0xffd8a0, intensity: 20.8, distance: 9, key: 'alley', night: true,
  });

  // The tag. Painted in 1985, covered in 2005, restored in 2055.
  const tagState = eraIdx === 2 ? 'fresh' : eraIdx === 3 ? 'painted-over' : eraIdx >= 4 ? 'restored' : null;
  if (tagState) {
    const { mats } = ctx;
    const c = graffitiTexture('KAI', {
      colors: tagState === 'painted-over' ? [0x8a8a86, 0x9a9a96, 0xaaaaa6] : [0xff2d95, 0x00e5ff, 0xffe500],
      seed: 'kai85',
    });
    const t = toTexture(c, { clamp: true });
    const m = quad(3.2, 1.6, 0, 0, 0, mats.printed(t, { transparent: true }));
    m.position.set(9.85, 2.4, z0 + 6);
    m.rotation.y = -Math.PI / 2;
    m.material.opacity = tagState === 'painted-over' ? 0.16 : 1;
    m.material.transparent = true;
    out.group.add(m);
    out.interactables.push({
      id: 'secret:tag', secret: true,
      pos: new THREE.Vector3(8.6, 1.8, z0 + 6), radius: 2.6,
      title: tagState === 'painted-over' ? 'Something under the paint' : 'KAI ’85', sub: 'Look closer', kind: 'secret',
      body: tagState === 'fresh' ? [
        { type: 'p', text: 'Fresh. The drips are still tacky. Whoever did it stood on a milk crate — you can see where it sank into the asphalt.' },
      ] : tagState === 'painted-over' ? [
        { type: 'p', text: 'The landlord painted the alley wall grey in 1998 and again in 2003. Both times, within a year, the letters came back through — spray paint and wall paint dry at different rates, and the wall remembers.' },
      ] : [
        { type: 'p', text: 'Restored in 2044 as part of the heritage designation, from a photograph somebody’s father took of somebody else’s car.' },
        { type: 'quote', text: '“We could not find out who KAI was. We restored it anyway. The block decided that not knowing was part of it.”' },
      ],
      foot: `The alley · ${era.year}`,
    });
  }
}

export { CURB, ROADOUT, FARWALK, HALF, walkPoint };
