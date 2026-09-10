/**
 * Procedural building generator.
 *
 * Each lot is described once in `eras.js` and rebuilt from scratch for every
 * decade. The generator's job is to make a 1945 brick walk-up and a 2055
 * bio-retrofit of *the same building* — same footprint, same floor heights,
 * same window rhythm — so that when the time-warp sweeps through, the mass
 * stays put and only the skin, the signage and the tenancy change.
 */

import * as THREE from 'three';
import { Bucket, quad, facadeGroup, localToWorld, faceNormal } from './geom.js';
import { buildInterior } from './interiors.js';
import {
  signTexture, marqueeTexture, ghostSignTexture, graffitiTexture,
  interiorTexture, posterTexture, glassTexture, toTexture, billboardTexture, paneTexture,
} from './textures.js';
import { Rand } from '../core/rng.js';
import { clamp01, lerp } from '../core/mathx.js';

const GROUND_H = 4.5;
const FLOOR_H = 3.35;
const PARAPET = 1.1;

/** Which sides of each lot see daylight (block edge, alley, or the open lot). */
const EXPOSED = {
  palace: ['N', 'E'],
  drug: ['N'],
  hotel: ['N', 'W'],
  grocer: ['W'],
  arcade: ['S', 'W', 'E'],
  bank: ['S', 'E', 'W'],
  dime: ['E'],
};

export const buildingHeight = (lot) => GROUND_H + Math.max(0, (lot.floors - 1)) * FLOOR_H;

/* ══════════════════════════ entry point ══════════════════════════ */

export function buildLot(lot, era, eraIdx, ctx) {
  const rnd = new Rand(`lot:${lot.id}:${era.year}`);
  const out = {
    group: new THREE.Group(),
    interactables: [],
    lights: [],      // { pos, color, intensity, distance } candidates for the light budget
    animated: [],    // { kind, obj, ... } updated each frame
  };
  out.group.name = `${lot.id}@${era.year}`;

  if (lot.open) { buildOpenLot(lot, era, eraIdx, ctx, rnd, out); return out; }

  const H = buildingHeight(lot);
  buildMass(lot, era, ctx, rnd, out, H);

  const exposed = EXPOSED[lot.id] || [lot.face];
  for (const face of exposed) {
    const isFront = face === lot.face;
    const fg = facadeGroup(face, lot);
    const W = fg.userData.width;
    buildFacade(fg, W, H, lot, era, eraIdx, ctx, rnd, out, isFront, face);
    out.group.add(fg);
  }

  buildRoof(lot, era, ctx, rnd, out, H);
  return out;
}

/* ══════════════════════════ mass & walls ══════════════════════════ */

function wallMaterial(style, color, mats, w, h, condition) {
  const rx = Math.max(1, w / 1.85), ry = Math.max(1, h / 1.85);
  switch (style) {
    case 'limestone': case 'civic': case 'modernised':
      return mats.limestone(color, { repeat: [Math.max(1, w / 4.2), Math.max(1, h / 4.2)] });
    case 'terracotta': case 'restored':
      return mats.stucco(color, { repeat: [Math.max(1, w / 3.0), Math.max(1, h / 3.0)], rough: 0.72 });
    case 'panel': case 'refaced': case 'googie':
      return mats.panel(color, { repeat: [Math.max(1, w / 2.6), Math.max(1, h / 2.6)], rough: 0.36 + condition * 0.4 });
    case 'timber':
      return mats.wood(color, { repeat: [Math.max(1, w / 2.4), Math.max(1, h / 2.4)] });
    case 'bio': case 'bioRetrofit':
      return mats.panel(color, { repeat: [Math.max(1, w / 3.2), Math.max(1, h / 3.2)], rough: 0.62, metal: 0.05 });
    case 'brickClean':
      return mats.brick(color, { repeat: [rx, ry], condition: 0.05 });
    default:
      return mats.brick(color, { repeat: [rx, ry], condition });
  }
}

function buildMass(lot, era, ctx, rnd, out, H) {
  const { mats } = ctx;
  const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
  const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
  const cond = lot.condition ?? 0.2;
  const exposed = new Set(EXPOSED[lot.id] || [lot.face]);

  const sides = [
    { face: 'N', w, x: cx, z: lot.z0, rotY: Math.PI },
    { face: 'S', w, x: cx, z: lot.z1, rotY: 0 },
    { face: 'E', w: d, x: lot.x1, z: cz, rotY: Math.PI / 2 },
    { face: 'W', w: d, x: lot.x0, z: cz, rotY: -Math.PI / 2 },
  ];

  const partyWall = mats.paint(0x2a2622, { rough: 0.98 });

  for (const s of sides) {
    const isOpen = exposed.has(s.face);
    const mat = isOpen
      ? wallMaterial(lot.style, lot.facade ?? 0x8a4634, mats, s.w, H + PARAPET, cond)
      : partyWall;
    // The shopfront is recessed *into* the wall, so the front elevation's wall
    // has to start above the ground floor or it simply covers the windows.
    const y0 = s.face === lot.face ? GROUND_H : 0;
    const hh = H + PARAPET - y0;
    const m = quad(s.w, hh, 0, 0, 0, mat);
    m.geometry.translate(0, y0 + hh / 2, 0);
    m.position.set(s.x, 0, s.z);
    m.rotation.y = s.rotY;
    m.castShadow = true; m.receiveShadow = true;
    out.group.add(m);

    // Close the shopfront's back and sides so the block is never see-through.
    if (y0 > 0) {
      const back = quad(s.w, y0, 0, 0, 0, partyWall);
      back.geometry.translate(0, y0 / 2, 0);
      back.position.set(
        s.x + (s.face === 'N' ? 0 : s.face === 'S' ? 0 : s.face === 'E' ? -3.4 : 3.4),
        0,
        s.z + (s.face === 'N' ? 3.4 : s.face === 'S' ? -3.4 : 0)
      );
      back.rotation.y = s.rotY;
      back.receiveShadow = true;
      out.group.add(back);
    }
  }

  // Roof deck
  const roof = quad(w, d, 0, 0, 0, mats.concrete(era.palette.roof, { repeat: [w / 3, d / 3] }));
  roof.rotation.x = -Math.PI / 2;
  roof.position.set(cx, H, cz);
  roof.receiveShadow = true;
  out.group.add(roof);

  // Parapet ring
  const b = new Bucket();
  const t = 0.34, p = PARAPET;
  const cap = era.palette.stone?.[0] ?? 0xa8a090;
  b.box(w, p, t, 0, H + p / 2, -d / 2 + t / 2, cap);
  b.box(w, p, t, 0, H + p / 2, d / 2 - t / 2, cap);
  b.box(t, p, d - t * 2, -w / 2 + t / 2, H + p / 2, 0, cap);
  b.box(t, p, d - t * 2, w / 2 - t / 2, H + p / 2, 0, cap);
  const pm = b.mesh(mats.vcol('rough'), { name: 'parapet' });
  if (pm) { pm.position.set(cx, 0, cz); out.group.add(pm); }
}

/* ══════════════════════════ facade ══════════════════════════ */

function buildFacade(fg, W, H, lot, era, eraIdx, ctx, rnd, out, isFront, face) {
  const { mats } = ctx;
  const detail = new Bucket();
  const trim = lot.trim ?? 0x3a3630;

  /* ── Ground floor ─────────────────────────────────────────────── */
  if (isFront) {
    buildStorefront(fg, detail, W, lot, era, eraIdx, ctx, rnd, out, face);
  } else {
    // Side elevations get a blank base with a service door and maybe a vent.
    detail.box(W, GROUND_H, 0.12, 0, GROUND_H / 2, 0.06, lot.facade ?? 0x8a4634);
    const dx = rnd.range(-W / 2 + 2, W / 2 - 2);
    detail.box(1.1, 2.3, 0.16, dx, 1.15, 0.14, 0x2a2a2e);
    detail.box(1.24, 0.14, 0.3, dx, 2.42, 0.2, trim);
    if (rnd.chance(0.6)) {
      detail.box(0.7, 0.7, 0.3, rnd.range(-W / 2 + 1.5, W / 2 - 1.5), 3.4, 0.2, 0x4a4a48);
    }
  }

  /* ── Upper floors ─────────────────────────────────────────────── */
  const floors = Math.max(0, lot.floors - 1);
  if (floors > 0) {
    buildWindowGrid(fg, detail, W, lot, era, eraIdx, ctx, rnd, out, isFront, face, floors);
  }

  /* ── Banding: water table, string courses, quoins ─────────────── */
  buildBanding(detail, W, H, lot, era, eraIdx, rnd, isFront, Math.max(1, lot.floors - 1));

  /* ── Cornice ──────────────────────────────────────────────────── */
  buildCornice(detail, W, H, lot.cornice || 'clipped', era, trim);

  /* ── Attachments ──────────────────────────────────────────────── */
  if (lot.fireEscape && isFront) buildFireEscape(detail, W, lot, era, rnd);
  if (lot.scaffold) buildScaffold(fg, detail, W, H, ctx, rnd);
  if (lot.columns && isFront) buildColumns(detail, W, lot, era, ctx);
  if (lot.greenWall) buildGreenWall(fg, detail, W, H, lot, era, ctx, rnd, out);
  if (lot.louvres) buildLouvres(detail, W, H, era, rnd);
  if (lot.pods) buildPods(detail, W, H, era, rnd);
  if (lot.acUnits) buildWindowACs(detail, W, lot, rnd);

  /* ── Painted wall advertising ─────────────────────────────────── */
  if (!isFront && lot.wallAd && lot.wallAd !== 'MURAL' && lot.wallAd !== 'HOLO') {
    const adH = Math.min(H * 0.5, 9);
    const adW = Math.min(W * 0.82, 13);
    const canvas = ghostSignTexture(lot.wallAd, {
      fade: lot.wallAdFaded ?? 0.25, color: era.palette.stone?.[2] ?? 0xd8d0c0,
      seed: lot.id + era.year,
    });
    const m = quad(adW, adH, 0, H * 0.52, 0.07, mats.printed(
      toTexture(canvas, { clamp: true }), { transparent: true, rough: 0.96 }
    ));
    fg.add(m);
    out.interactables.push({
      id: `wallad:${lot.id}:${era.year}`,
      pos: localToWorld(face, lot, 0, 4.5, 2.4),
      radius: 3.4, title: 'Painted wall sign', sub: 'Read',
      kind: 'read',
      body: [
        { type: 'sign', text: lot.wallAd },
        { type: 'p', text: lot.story || '' },
      ],
      foot: `${lot.addr} · ${era.year}`,
    });
  }

  if (!isFront && lot.mural) buildMural(fg, W, H, lot, era, ctx, rnd, out, face);
  if (lot.graffiti) buildGraffiti(fg, W, ctx, rnd, era);

  /* ── Commit ───────────────────────────────────────────────────── */
  const dm = detail.mesh(mats.vcol('matte'), { name: 'detail' });
  if (dm) fg.add(dm);
}

/* ══════════════════════════ storefront ══════════════════════════ */

function buildStorefront(fg, b, W, lot, era, eraIdx, ctx, rnd, out, face) {
  const { mats } = ctx;
  // Two extra buckets just for what is behind the glass: matte fittings that
  // still take a little self-illumination, and the screens/tubes/grow-lights
  // that have to punch through at night.
  const inter = new Bucket();
  const glow = new Bucket();
  const trim = lot.trim ?? 0x3a3630;
  const cond = lot.condition ?? 0.2;
  const recess = 0.55;
  const signBandY = 3.62, signBandH = GROUND_H - signBandY;

  const pil = 0.52;
  const openW = W - pil * 2;

  /* Pilasters + bulkhead + head beam */
  b.box(pil, GROUND_H, 0.34, -W / 2 + pil / 2, GROUND_H / 2, 0.17, trim);
  b.box(pil, GROUND_H, 0.34, W / 2 - pil / 2, GROUND_H / 2, 0.17, trim);
  b.box(W, signBandH, 0.4, 0, signBandY + signBandH / 2, 0.2, lot.facade ?? 0x8a4634);
  b.box(W, 0.22, 0.5, 0, signBandY, 0.25, trim);

  /* The shop is recessed; a soffit and floor close the reveal. */
  b.box(openW, 0.2, recess, 0, signBandY - 0.1, -recess / 2, trim);
  b.box(openW, 0.16, recess, 0, 0.08, -recess / 2, 0x6a6660);

  /* Bulkhead (the panelled kick below the glass) */
  const bulk = eraIdx <= 1 ? 0.78 : eraIdx <= 3 ? 0.52 : 0.34;
  b.box(openW, bulk, 0.2, 0, bulk / 2, -recess + 0.1, trim);
  const panels = Math.max(2, Math.round(openW / 1.3));
  for (let i = 0; i < panels; i++) {
    const px = -openW / 2 + (i + 0.5) * (openW / panels);
    // Sunk panel, a shade off the surrounding trim — pure white here blows out
    // in every era and reads as a light box rather than as painted timber.
    b.box(openW / panels - 0.16, bulk - 0.2, 0.06, px, bulk / 2, -recess + 0.22, tintUp(trim, 0.34), null);
  }

  /* Door: a leaf, a frame and a handle. Position varies by lot. */
  const doorX = rnd.pick([-openW / 2 + 1.0, openW / 2 - 1.0, 0]);
  const doorW = 1.16, doorH = 2.42;
  b.box(doorW + 0.2, doorH + 0.16, 0.14, doorX, (doorH + 0.16) / 2, -recess + 0.07, trim);
  b.box(doorW, doorH, 0.08, doorX, doorH / 2, -recess + 0.02, eraIdx <= 1 ? 0x4a3a2a : 0x2a2a2e);
  b.cyl(0.03, 0.34, doorX + doorW / 2 - 0.16, 1.06, -recess + 0.09, 0xc8b070, { x: Math.PI / 2 });

  /* ── The mosaic threshold ─────────────────────────────────────
     A terrazzo doorway with the first tenant's name set into it. Six
     businesses have traded over the top of it and not one of them has had the
     heart, or the budget, to take it up. */
  if (lot.id === 'dime') {
    const tw = doorW + 0.9, td = recess - 0.06;
    const tz = -recess / 2;
    b.box(tw, 0.03, td, doorX, 0.155, tz, 0xd8d0bc);
    // Border key pattern.
    for (let i = 0; i < Math.round(tw / 0.09); i++) {
      const px = doorX - tw / 2 + 0.045 + i * 0.09;
      b.box(0.06, 0.012, 0.06, px, 0.172, tz - td / 2 + 0.08, i % 2 ? 0x2a4a3a : 0xb8ac94);
      b.box(0.06, 0.012, 0.06, px, 0.172, tz + td / 2 - 0.08, i % 2 ? 0x2a4a3a : 0xb8ac94);
    }
    // The name, as blocks of tesserae rather than letters — it reads as
    // lettering at a distance and as tile up close, which is the truth of it.
    const word = [3, 2, 3, 2, 4, 3, 2, 2];   // W O O L T O N S
    let cx2 = doorX - (word.length * 0.17) / 2;
    for (const wdt of word) {
      for (let k = 0; k < wdt; k++) {
        b.box(0.035, 0.014, 0.10, cx2 + k * 0.042 - wdt * 0.021, 0.174, tz, 0x2a4a3a);
      }
      cx2 += 0.17;
    }
    if (eraIdx >= 2) {
      // Later tenants laid vinyl or carpet up to it and stopped.
      b.box(tw, 0.012, 0.16, doorX, 0.178, tz - td / 2 + 0.02,
        [0, 0, 0x6a2a2a, 0x2a3a4a, 0x3a3a3e, 0x2e4a44][eraIdx]);
    }
    out.interactables.push({
      id: 'secret:threshold', secret: true,
      pos: localToWorld(face, lot, doorX, 0.5, 1.1), radius: 2.4,
      title: 'The threshold', sub: 'Look down', kind: 'secret',
      body: [
        { type: 'sign', text: 'WOOLTON’S' },
        { type: 'p', text: eraIdx === 0
          ? 'Terrazzo, laid 1931, green tesserae on a cream ground. Woolton’s has been gone eight years; the doorway has not caught up.'
          : eraIdx === 5
          ? 'Everything above this doorway has been replaced twice. The floor you are standing on was laid by a man named Sorrentino in the spring of 1931 and has never once been taken up.'
          : 'Every tenant since has laid their own floor up to the edge of it and stopped. Nobody has ever been willing to be the one who removed it.' },
      ],
      foot: `${lot.addr} · ${era.year}`,
    });
  }

  /* ── The cornerstone ──────────────────────────────────────────── */
  if (lot.id === 'hotel') {
    const sx = -W / 2 + pil / 2;
    const stoneCol = era.palette.stone?.[0] ?? 0xbfae94;
    b.box(0.62, 0.44, 0.06, sx, 1.42, 0.36, stoneCol);
    for (let i = 0; i < 4; i++) b.box(0.34 - i * 0.03, 0.035, 0.02, sx, 1.56 - i * 0.09, 0.40, 0x5a5248);
    out.interactables.push({
      id: 'secret:cornerstone', secret: true,
      pos: localToWorld(face, lot, sx, 1.42, 1.4), radius: 2.4,
      title: 'The cornerstone', sub: 'Read', kind: 'secret',
      body: [
        { type: 'sign', text: 'ERECTED\nA · D · 1901\nJ. VERNON' },
        { type: 'p', text: 'Josiah Vernon put his own name on the corner of a building he intended his grandchildren to run. They sold it in 1954 to a chain that painted over the lettering upstairs and left the stone, because taking out a cornerstone means taking out the corner.' },
      ],
      foot: `${lot.addr} · ${era.year}`,
    });
  }

  /* Glazing: display windows either side of the door. */
  const glassY0 = bulk, glassY1 = eraIdx <= 1 ? 2.92 : 3.18;
  const bays = [];
  if (doorX < -0.1) bays.push([doorX + doorW / 2 + 0.16, openW / 2]);
  else if (doorX > 0.1) bays.push([-openW / 2, doorX - doorW / 2 - 0.16]);
  else { bays.push([-openW / 2, doorX - doorW / 2 - 0.16]); bays.push([doorX + doorW / 2 + 0.16, openW / 2]); }

  const glassMat = mats.glass(era.palette.glass, {
    opacity: 0.16 + (era.palette.glassTint ?? 0.1) * 0.5 + cond * 0.12,
    rough: 0.04 + cond * 0.2,
  });
  const reflectTex = toTexture(glassTexture({ dirt: cond, seed: lot.id + era.year }), { clamp: true });
  const reflectMat = mats.holo(reflectTex, { color: 0xa8bcd0, strength: 0.42 });

  const boarded = lot.windows === 'boarded' || lot.vacant;
  const frosted = lot.windows === 'frosted';

  for (const [gx0, gx1] of bays) {
    const gw = gx1 - gx0;
    if (gw < 0.4) continue;
    const gcx = (gx0 + gx1) / 2, gh = glassY1 - glassY0;

    if (boarded) {
      b.box(gw, gh, 0.1, gcx, (glassY0 + glassY1) / 2, -recess + 0.06, 0x8a7a5c);
      for (let i = 0; i < 4; i++) {
        b.box(gw, 0.03, 0.14, gcx, glassY0 + gh * (i + 0.5) / 4, -recess + 0.13, 0x6a5a44);
      }
      continue;
    }

    /* Shallow interior box with a painted backdrop. */
    const depth = 2.6;
    const kind = lot.display || 'default';
    const interTex = toTexture(interiorTexture(kind, { seed: lot.id + era.year }), { clamp: true });
    const back = quad(gw, gh + 0.9, gcx, glassY0 + (gh + 0.9) / 2 - 0.4, -recess - depth,
      mats.litSign(interTex, { strength: eraIdx === 2 || eraIdx === 5 ? 1.05 : 0.6, rough: 0.9 }));
    fg.add(back);

    b.box(gw, 0.1, depth, gcx, glassY0 - 0.05, -recess - depth / 2, 0x4a4a4a);          // floor
    b.box(gw, 0.1, depth, gcx, glassY1 + 0.1, -recess - depth / 2, 0x2a2a2a);            // ceiling
    b.box(0.1, gh, depth, gx0, (glassY0 + glassY1) / 2, -recess - depth / 2, 0x3a3a3a);
    b.box(0.1, gh, depth, gx1, (glassY0 + glassY1) / 2, -recess - depth / 2, 0x3a3a3a);

    /* Actual fittings in the front two metres: counters, racks, cabinets,
       whatever this trade looked like in this decade. */
    buildInterior(lot.display || 'default', inter, glow, {
      x0: gx0 + 0.12, x1: gx1 - 0.12,
      y0: glassY0, y1: glassY1,
      z0: -recess - depth + 0.14, z1: -recess - 0.16,
    }, era, rnd);

    /* Interior ceiling light — makes the shop glow after dark. */
    const lightCol = lot.glowInterior ?? (eraIdx <= 1 ? 0xffe0b0 : eraIdx === 2 ? 0xd8f0ff : 0xf4f8ff);
    const strip = quad(gw * 0.8, 0.24, gcx, glassY1 + 0.02, -recess - depth * 0.5,
      mats.emissive(null, { color: lightCol, strength: 1.5, transparent: false }));
    strip.rotation.x = Math.PI / 2;
    fg.add(strip);
    out.lights.push({
      pos: localToWorld(face, lot, gcx, glassY1 - 0.4, -recess - depth * 0.4),
      color: lightCol, intensity: 25.6, distance: 9, key: `shop:${lot.id}`,
    });

    /* The glass itself, plus a mullion grid on older shopfronts. */
    if (frosted) {
      /* Privacy film goes on as a band across the lower two-thirds, not over
         the whole window — which is both what a licensed shop actually does
         and the difference between a storefront and a blank cream panel. */
      const filmH = gh * 0.62;
      const film = quad(gw, filmH, gcx, glassY0 + filmH / 2, -recess + 0.02,
        mats.glass(0xdce8ec, { opacity: 0.72, rough: 0.62 }));
      film.renderOrder = 3;
      fg.add(film);
      const clear = quad(gw, gh - filmH, gcx, glassY0 + filmH + (gh - filmH) / 2, -recess + 0.02, glassMat);
      clear.renderOrder = 3;
      fg.add(clear);
      b.box(gw, 0.035, 0.05, gcx, glassY0 + filmH, -recess + 0.04, trim);   // film edge
    } else {
      const g = quad(gw, gh, gcx, (glassY0 + glassY1) / 2, -recess + 0.02, glassMat);
      g.renderOrder = 3;
      fg.add(g);
    }
    // A separate additive pass carries the reflection so the transparent pane
    // never multiplies the shop interior toward black.
    const refl = quad(gw, gh, gcx, (glassY0 + glassY1) / 2, -recess + 0.035, reflectMat);
    refl.renderOrder = 4;
    fg.add(refl);
    if (eraIdx <= 1) {
      const nm = Math.max(1, Math.round(gw / 1.5));
      for (let i = 1; i < nm; i++) {
        b.box(0.07, gh, 0.09, gx0 + i * (gw / nm), (glassY0 + glassY1) / 2, -recess + 0.05, trim);
      }
    }
    if (lot.grate || (lot.bars && !boarded)) buildGrate(b, gx0, gx1, glassY0, glassY1, -recess + 0.16, lot.grate === 'half');
  }

  /* Transom lights above the display glass (pre-1970 shopfronts) */
  if (eraIdx <= 1) {
    const ty0 = glassY1 + 0.1, th = signBandY - 0.34 - ty0;
    if (th > 0.24) {
      const tg = quad(openW, th, 0, ty0 + th / 2, -recess + 0.02,
        mats.glass(0xd8c8a0, { opacity: 0.42, rough: 0.32 }));
      fg.add(tg);
      const nt = Math.max(2, Math.round(openW / 1.1));
      for (let i = 1; i < nt; i++) b.box(0.06, th, 0.08, -openW / 2 + i * (openW / nt), ty0 + th / 2, -recess + 0.05, trim);
    }
  }

  /* ── Awning ───────────────────────────────────────────────────── */
  if (lot.awning) buildAwning(fg, b, W, lot, era, ctx, rnd);

  /* ── Signage ──────────────────────────────────────────────────── */
  buildSignage(fg, b, W, lot, era, eraIdx, ctx, rnd, out, face, signBandY, signBandH);

  /* ── Shop-specific dressing ───────────────────────────────────── */
  if (lot.barberPole) {
    const px = -W / 2 + pil + 0.4;
    b.cyl(0.13, 1.0, px, 2.3, 0.28, 0xf0f0f0, null, 12);
    b.cyl(0.16, 0.16, px, 2.86, 0.28, 0xc8c8cc, null, 12);
    b.cyl(0.16, 0.16, px, 1.74, 0.28, 0xc8c8cc, null, 12);
    out.animated.push({ kind: 'barberPole', pos: localToWorld(face, lot, px, 2.3, 0.28) });
  }
  if (lot.atm || lot.atmVestibule) {
    const ax = W / 2 - 2.2;
    b.box(1.3, 2.5, 0.5, ax, 1.25, 0.26, 0x9aa0a6);
    const scr = quad(0.7, 0.5, ax, 1.72, 0.52,
      mats.emissive(null, { color: lot.atmGlow ?? 0x39ff6a, strength: 2.6, transparent: false }));
    fg.add(scr);
    out.lights.push({
      pos: localToWorld(face, lot, ax, 1.7, 1.0),
      color: lot.atmGlow ?? 0x39ff6a, intensity: 11.2, distance: 5, key: `atm:${lot.id}`,
    });
    out.interactables.push({
      id: `atm:${lot.id}:${era.year}`,
      pos: localToWorld(face, lot, ax, 1.6, 1.5), radius: 2.2,
      title: era.year === 1985 ? '24-Hour Cash Machine' : 'ATM', sub: 'Use',
      kind: 'read',
      body: [{ type: 'p', text: era.year === 1985
        ? 'A beige box in a stainless surround, lit from inside. It dispenses twenties and nothing else, and the queue outside it on a Friday night is the newest thing on this street.'
        : 'Four languages, two fee disclosures and a camera you can see yourself in.' }],
      foot: `${lot.addr} · ${era.year}`,
    });
  }
  if (lot.qr) {
    b.box(0.34, 0.34, 0.03, W / 2 - 1.2, 1.5, 0.36, 0xf0f0f0);
    b.box(0.24, 0.24, 0.02, W / 2 - 1.2, 1.5, 0.38, 0x1a1a1e);
  }
  if (lot.ghostKitchen) {
    // Four delivery-app decals in the window of a "closed" storefront.
    for (let i = 0; i < 4; i++) {
      b.box(0.42, 0.42, 0.02, -1.9 + i * 1.26, 2.4, -recess + 0.04,
        [0xe8663a, 0x2ea8b4, 0x7fd6a0, 0xe8c040][i]);
    }
  }

  /* Storefront is always readable — this is the block's narration. */
  out.interactables.push({
    id: `shop:${lot.id}:${era.year}`,
    pos: localToWorld(face, lot, 0, 1.6, 2.0),
    radius: 3.6,
    title: lot.shop || lot.label,
    sub: lot.sub || lot.addr,
    kind: 'read', place: lot.id,
    body: [
      { type: 'sign', text: (lot.shop || '') + (lot.sub ? '\n' + lot.sub : '') },
      { type: 'p', text: lot.story || '', lede: true },
    ],
    foot: `${lot.addr} · ${era.year} · ${era.name}`,
  });

  /* Commit the shop interior. Neither bucket casts — nothing inside a display
     window has any business throwing a shadow onto the pavement. */
  const im = inter.mesh(mats.vcolLit({ fill: eraIdx <= 1 ? 0.30 : 0.36 }), { cast: false, name: 'interior' });
  if (im) fg.add(im);
  const gm = glow.mesh(mats.emitVcol({ strength: 1.25 }), { cast: false, receive: false, name: 'interiorGlow' });
  if (gm) fg.add(gm);
}

/** Lift a packed colour toward white by `k` — sunk panels, highlights, wear. */
function tintUp(hex, k) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, bl = hex & 255;
  const m = (v) => Math.round(v + (255 - v) * k);
  return (m(r) << 16) | (m(g) << 8) | m(bl);
}

function buildGrate(b, x0, x1, y0, y1, z, half) {
  const w = x1 - x0, y1b = half ? y0 + (y1 - y0) * 0.55 : y1;
  const n = Math.max(3, Math.round(w / 0.16));
  for (let i = 0; i <= n; i++) b.box(0.035, y1b - y0, 0.035, x0 + i * (w / n), (y0 + y1b) / 2, z, 0x4a4a50);
  const rows = Math.max(2, Math.round((y1b - y0) / 0.36));
  for (let r = 0; r <= rows; r++) b.box(w, 0.035, 0.035, (x0 + x1) / 2, y0 + r * ((y1b - y0) / rows), z, 0x4a4a50);
  b.box(w + 0.16, 0.16, 0.16, (x0 + x1) / 2, y1b + 0.1, z, 0x3a3a40);
}

function buildAwning(fg, b, W, lot, era, ctx, rnd) {
  const { mats } = ctx;
  const y = 3.5, proj = 1.65, drop = 0.62;
  const aw = W - 1.0;
  const col = lot.awning;

  // Sloped fabric — a thin box tilted so it reads as canvas on a frame.
  const ang = Math.atan2(drop, proj);
  b.box(aw, 0.06, Math.hypot(proj, drop), 0, y - drop / 2, proj / 2, col, { x: -ang });
  // Valance with a scalloped edge approximated by short segments.
  const scallops = Math.max(4, Math.round(aw / 0.55));
  for (let i = 0; i < scallops; i++) {
    const sx = -aw / 2 + (i + 0.5) * (aw / scallops);
    b.box(aw / scallops - 0.04, 0.34, 0.05, sx, y - drop - 0.15, proj, col);
    b.cyl(0.075, aw / scallops - 0.06, sx, y - drop - 0.32, proj, col, { z: Math.PI / 2 }, 6);
  }
  // Stripes
  if (lot.awningStripe) {
    const n = Math.max(3, Math.round(aw / 0.72));
    for (let i = 0; i < n; i += 2) {
      const sx = -aw / 2 + (i + 0.5) * (aw / n);
      b.box(aw / n * 0.9, 0.062, Math.hypot(proj, drop) * 0.98, sx, y - drop / 2 + 0.005, proj / 2,
        lot.awningStripe, { x: -ang });
    }
  }
  // Frame arms
  for (const sx of [-aw / 2 + 0.15, 0, aw / 2 - 0.15]) {
    b.rod(sx, y, 0.1, sx, y - drop, proj, 0.035, 0x4a4642);
    b.rod(sx, y, 0.1, sx, y - drop + 0.42, proj * 0.55, 0.028, 0x4a4642);
  }
}

/* ══════════════════════════ signage ══════════════════════════ */

function buildSignage(fg, b, W, lot, era, eraIdx, ctx, rnd, out, face, bandY, bandH) {
  const { mats } = ctx;
  const style = lot.signType || 'painted';
  const cond = lot.condition ?? 0.2;

  /* ── Marquee (the Palace, all six decades) ─────────────────────── */
  if (style.startsWith('marquee')) {
    buildMarquee(fg, b, W, lot, era, eraIdx, ctx, rnd, out, face);
  } else {
    /* Fascia sign on the band above the shopfront. */
    const sw = Math.min(W - 1.1, 12), sh = Math.min(bandH - 0.4, 1.5);
    const canvas = signTexture({
      text: lot.shop || lot.label, sub: lot.sub || '', style,
      fg: lot.signColor ?? 0xffffff, bg: lot.facade ?? 0x1a1a1e,
      accent: lot.trim ?? 0xd8b04a,
      w: 1024, h: Math.round(1024 * sh / sw), condition: cond,
      seed: lot.id + era.year,
    });
    const tex = toTexture(canvas, { clamp: true });
    const lit = ['plastic', 'plasticLit', 'neonBox', 'ledScroll', 'led', 'holo', 'googie'].includes(style);
    const mat = lit
      ? mats.litSign(tex, { strength: style === 'neonBox' ? 1.5 : 0.72 })
      : mats.printed(tex, { rough: style === 'goldleaf' ? 0.28 : 0.86 });
    const sign = quad(sw, sh, 0, bandY + bandH * 0.52, 0.42, mat);
    fg.add(sign);
    // Box depth so the sign isn't a decal
    b.box(sw + 0.12, sh + 0.12, 0.2, 0, bandY + bandH * 0.52, 0.32, 0x1a1a1e);

    if (lit) {
      out.lights.push({
        pos: localToWorld(face, lot, 0, bandY + bandH * 0.5, 1.6),
        color: lot.signColor ?? 0xffffff, intensity: 12.8, distance: 8, key: `sign:${lot.id}`,
      });
    }
    if (style === 'ledScroll') out.animated.push({ kind: 'ledScroll', mesh: sign, tex });
    if (style === 'holo' || style === 'eInk') out.animated.push({ kind: 'flicker', mesh: sign, amount: 0.06 });

    /* Gooseneck lamps over painted/gold-leaf signs. */
    if (!lit && eraIdx <= 1) {
      for (const gx of [-sw / 3, sw / 3]) {
        b.rod(gx, bandY + bandH - 0.1, 0.3, gx, bandY + bandH + 0.34, 0.34, 0.035, 0x3a3630);
        b.rod(gx, bandY + bandH + 0.34, 0.34, gx, bandY + bandH + 0.24, 0.92, 0.035, 0x3a3630);
        b.cone(0.19, 0.24, gx, bandY + bandH + 0.14, 0.98, 0x3a3630, { x: Math.PI });
        b.sphere(0.075, gx, bandY + bandH + 0.04, 0.98, 0xfff0c8, true);
      }
    }
  }

  /* ── Neon tube sign ───────────────────────────────────────────── */
  if (lot.neon) {
    buildNeon(fg, b, W, lot, era, ctx, rnd, out, face);
  }

  /* ── Vertical blade sign ──────────────────────────────────────── */
  if (style.startsWith('vertical')) {
    buildBlade(fg, b, W, lot, era, ctx, rnd, out, face, lot.shop.split(' ')[0]);
  }

  /* ── Small dressing: posters, for-lease bills, beer signs ─────── */
  if (lot.posters) {
    for (let i = 0; i < Math.min(lot.posters, 12); i++) {
      const px = rnd.range(-W / 2 + 1.2, W / 2 - 1.2);
      const py = rnd.range(1.0, 2.7);
      const pc = posterTexture(rnd.pick(era.ads.posters).split(' ').slice(0, 4),
        { w: 192, h: 256, tone: era.ads.tone, seed: lot.id + i + era.year,
          bg: rnd.pick([0xf0e8d8, 0xe8d8c0, 0x2a2a3a, 0xd83a3a]),
          accent: rnd.pick([0xd83a2a, 0x2a4a8a, 0xffe500]) });
      const m = quad(0.46, 0.62, px, py, 0.44, mats.printed(toTexture(pc, { clamp: true })));
      m.rotation.z = rnd.range(-0.06, 0.06);
      fg.add(m);
    }
  }
  if (lot.beerNeon) {
    const nx = W / 2 - 2.4;
    const t = toTexture(signTexture({ text: 'BEER', style: 'neonBox', fg: 0xff2d95, w: 256, h: 128, seed: 'beer' }), { clamp: true });
    fg.add(quad(0.9, 0.45, nx, 2.5, -0.5, mats.emissive(t, { color: 0xffffff, strength: 3.4, transparent: false })));
    out.lights.push({ pos: localToWorld(face, lot, nx, 2.5, 0.6), color: 0xff2d95, intensity: 9.6, distance: 5, key: `beer:${lot.id}` });
  }
  if (lot.wifiSign) {
    const t = toTexture(signTexture({ text: 'FREE WI-FI', style: 'plasticLit', fg: 0x5aa8d8, bg: 0x102030, w: 512, h: 128, seed: 'wifi' }), { clamp: true });
    fg.add(quad(1.3, 0.34, W / 2 - 2.2, 3.0, 0.44, mats.emissive(t, { color: 0xffffff, strength: 1.6, transparent: false })));
  }
  if (lot.banner) {
    const t = toTexture(signTexture({ text: lot.banner, style: 'vinylBanner', fg: 0xffffff, bg: 0x2a4a6a, accent: 0xe8c040, w: 1024, h: 200, seed: 'banner' }), { clamp: true });
    fg.add(quad(Math.min(W - 2, 9), 1.75, 0, GROUND_H + 2.2, 0.34, mats.printed(t)));
  }
  if (lot.heritage) {
    const px = -W / 2 + 1.0;
    b.box(0.46, 0.62, 0.05, px, 1.75, 0.4, 0x6a5a3a);
    out.interactables.push({
      id: `plaque:${lot.id}:${era.year}`,
      pos: localToWorld(face, lot, px, 1.7, 1.2), radius: 2.0,
      title: 'Heritage plaque', sub: 'Read', kind: 'read',
      body: [
        { type: 'sign', text: 'THE PALACE THEATRE\n1927\n\nDESIGNATED LANDMARK' },
        { type: 'p', text: 'Terracotta facade by an architect who built four of these and is remembered for none of them. Clad over in 1958, uncovered in 2017, and largely intact underneath — the aluminium that hid it also protected it.' },
      ],
      foot: `${lot.addr} · ${era.year}`,
    });
  }
}

function buildMarquee(fg, b, W, lot, era, eraIdx, ctx, rnd, out, face) {
  const { mats } = ctx;
  const mw = Math.min(W - 0.6, 15);
  const proj = 3.0, y0 = 4.6, mh = 2.5;
  const broken = lot.signType === 'marqueeBroken';
  const holo = lot.signType === 'marqueeHolo';
  const dead = lot.bulbsDead ?? 0;

  /* Box */
  b.box(mw, 0.34, proj, 0, y0 + mh, proj / 2, lot.trim ?? 0x2a2a2e);
  b.box(mw, 0.3, proj, 0, y0, proj / 2, lot.trim ?? 0x2a2a2e);
  b.box(mw, mh, 0.16, 0, y0 + mh / 2, 0.08, 0x1a1a1e);
  // Undersides get a warm reflector so the pavement below glows.
  b.box(mw - 0.5, 0.06, proj - 0.4, 0, y0 + 0.19, proj / 2, 0xf0e0c0);

  /* Three lettered faces: front + two returns. */
  const lines = lot.marqueeText || ['NOW SHOWING'];
  const style = holo ? 'holo' : lot.bulbs > 0 ? 'bulb' : 'plain';
  const front = toTexture(marqueeTexture(lines, {
    w: 1024, h: Math.round(1024 * mh / mw), style,
    accent: lot.bladeColor ?? 0xd83a2a, condition: lot.condition ?? 0.1,
    seed: lot.id + era.year,
  }), { clamp: true });
  const side = toTexture(marqueeTexture([lines[0]], {
    w: 512, h: Math.round(512 * mh / proj), style,
    accent: lot.bladeColor ?? 0xd83a2a, condition: lot.condition ?? 0.1,
    seed: lot.id + era.year + 's',
  }), { clamp: true });

  const strength = holo ? 1.9 : broken ? 0.28 : 0.62;
  const fm = holo
    ? mats.emissive(front, { color: 0xffffff, strength, transparent: false })
    : mats.litSign(front, { strength });
  const sm = holo
    ? mats.emissive(side, { color: 0xffffff, strength, transparent: false })
    : mats.litSign(side, { strength });
  const faceMesh = quad(mw, mh, 0, y0 + mh / 2, proj + 0.02, fm);
  const l = quad(proj, mh, -mw / 2 - 0.01, y0 + mh / 2, proj / 2, sm, { rotY: -Math.PI / 2 });
  const r = quad(proj, mh, mw / 2 + 0.01, y0 + mh / 2, proj / 2, sm, { rotY: Math.PI / 2 });
  fg.add(faceMesh); fg.add(l); fg.add(r);

  if (lot.marqueeCycles) out.animated.push({ kind: 'marqueeCycle', mats: [fm, sm], lines, lot, era });
  if (broken) out.animated.push({ kind: 'flicker', mesh: faceMesh, amount: 0.5, mat: fm });

  /* Bulb border */
  if (lot.bulbs > 0) {
    const bulbs = new Bucket();
    const per = Math.round(lot.bulbs / 3);
    const place = (x, y, z) => bulbs.sphere(0.075, x, y, z, 0xfff0c8, true);
    for (let i = 0; i < per; i++) {
      const t = (i + 0.5) / per;
      if (!rnd.chance(dead)) place(-mw / 2 + t * mw, y0 + 0.14, proj + 0.06);
      if (!rnd.chance(dead)) place(-mw / 2 + t * mw, y0 + mh - 0.1, proj + 0.06);
    }
    for (let i = 0; i < Math.round(per / 3); i++) {
      const t = (i + 0.5) / Math.round(per / 3);
      if (!rnd.chance(dead)) { place(-mw / 2 - 0.02, y0 + 0.2 + t * (mh - 0.4), proj * t + 0.2); place(mw / 2 + 0.02, y0 + 0.2 + t * (mh - 0.4), proj * t + 0.2); }
    }
    const bm = bulbs.mesh(mats.emitVcol({ strength: 3.4 }), { cast: false });
    if (bm) { fg.add(bm); out.animated.push({ kind: 'bulbChase', mesh: bm }); }

    /* ── The dead bulb ─────────────────────────────────────────────
       Fourth from the left on the bottom rail. It is out in 1945 and it is
       still out in 2055, through two full rewires and a restoration, because
       every electrician who has ever stood on that ladder has assumed the
       last one meant it. */
    const deadT = (3 + 0.5) / per;
    const dx = -mw / 2 + deadT * mw, dy = y0 + 0.14, dz = proj + 0.06;
    const dark = new Bucket();
    dark.sphere(0.078, dx, dy, dz, 0x4a4238, true);
    dark.cyl(0.032, 0.05, dx, dy - 0.09, dz, 0x8a8078, null, 8);
    const dm = dark.mesh(mats.vcol('matte'), { cast: false });
    if (dm) fg.add(dm);
    out.interactables.push({
      id: 'secret:deadbulb', secret: true,
      pos: localToWorld(face, lot, dx, dy, dz + 0.6), radius: 3.2,
      title: 'One bulb', sub: 'Count along the bottom rail', kind: 'secret',
      body: [{ type: 'p', text: 'Fourth from the left, bottom rail. Out. It is out in every photograph of this building anyone has ever taken, including the ones from the week it opened, which means it was out on opening night and nobody replaced it then either.' }],
      foot: `500 Vine · ${era.year}`,
    });
  }

  out.lights.push({
    pos: localToWorld(face, lot, 0, y0 - 0.4, proj * 0.8),
    color: holo ? 0x56d0e0 : 0xffd8a0, intensity: broken ? 2.0 : 5.5, distance: 16, key: 'marquee',
  });

  /* Vertical blade above the marquee */
  if (lot.blade) buildBlade(fg, b, W, lot, era, ctx, rnd, out, face, lot.blade, y0 + mh + 0.3);

  out.interactables.push({
    id: `marquee:${era.year}`,
    pos: localToWorld(face, lot, 0, 2.0, 4.2), radius: 4.4,
    title: 'The Palace marquee', sub: lines[0], kind: 'read', place: 'palace',
    body: [
      { type: 'sign', text: lines.join('\n') },
      { type: 'p', text: lot.story || '', lede: true },
    ],
    foot: `500 Vine · ${era.year}`,
  });
}

function buildBlade(fg, b, W, lot, era, ctx, rnd, out, face, word, baseY = GROUND_H + 0.6) {
  const { mats } = ctx;
  const letters = String(word).slice(0, 8).split('');
  const cell = 1.05;
  const h = letters.length * cell + 0.6;
  const bw = 1.35, proj = 1.25;
  const x = W / 2 - 2.0;
  const dead = lot.bladeBroken || lot.bladeDead;

  b.box(bw, h, proj, x, baseY + h / 2, proj / 2, 0x2a2a2e);
  b.rod(x, baseY + h * 0.9, 0.1, x, baseY + h * 0.75, proj, 0.05, 0x3a3a40);
  b.rod(x, baseY + 0.2, 0.1, x, baseY + 0.35, proj, 0.05, 0x3a3a40);

  // Vertical text: draw each letter as its own quad so it stacks properly.
  letters.forEach((ch, i) => {
    const t = toTexture(signTexture({
      text: ch, style: dead && rnd.chance(0.4) ? 'painted' : 'neonBox',
      fg: lot.bladeColor ?? 0xe8503a, bg: 0x0a0a10, w: 128, h: 128,
      seed: 'bl' + ch + i + era.year,
    }), { clamp: true });
    const y = baseY + h - 0.5 - i * cell;
    const on = !(dead && rnd.chance(0.4));
    const m = on
      ? mats.emissive(t, { color: 0xffffff, strength: 2.8, transparent: false })
      : mats.printed(t);
    fg.add(quad(cell * 0.86, cell * 0.86, x, y, proj + 0.03, m));
    fg.add(quad(cell * 0.86, cell * 0.86, x, y, -0.03, m, { rotY: Math.PI }));
  });

  if (!dead) {
    out.lights.push({
      pos: localToWorld(face, lot, x, baseY + h / 2, proj + 1.2),
      color: lot.bladeColor ?? 0xe8503a, intensity: 19.2, distance: 12, key: `blade:${lot.id}`,
    });
  }
}

function buildNeon(fg, b, W, lot, era, ctx, rnd, out, face) {
  const { mats } = ctx;
  const word = lot.neon;
  const col = lot.neonColor ?? 0xff2d95;
  const y = 2.85, z = 0.62;
  const x = rnd.chance(0.5) ? -W / 2 + 2.4 : W / 2 - 2.4;

  const tex = toTexture(signTexture({
    text: word, style: 'neonBox', fg: col, w: 512, h: 160, seed: 'neon' + word + era.year,
  }), { clamp: true });
  const cw = Math.min(2.6, 0.42 * word.length + 0.6);
  const m = quad(cw, cw * 160 / 512, x, y, z, mats.emissive(tex, { color: 0xffffff, strength: 3.2, transparent: false }));
  fg.add(m);
  b.box(cw + 0.12, cw * 160 / 512 + 0.12, 0.14, x, y, z - 0.09, 0x14141a);

  out.lights.push({ pos: localToWorld(face, lot, x, y, z + 1.4), color: col, intensity: 17.6, distance: 8, key: `neon:${lot.id}` });
  out.animated.push({ kind: 'neonBuzz', mesh: m, seed: rnd.f() });
}

function buildMural(fg, W, H, lot, era, ctx, rnd, out, face) {
  const { mats } = ctx;
  const mw = Math.min(W * 0.9, 17), mh = Math.min(H * 0.62, 11);
  const c = document.createElement('canvas');
  c.width = 1024; c.height = Math.round(1024 * mh / mw);
  const g = c.getContext('2d');
  const pal = era.palette.mural || [0xe8663a, 0x2ea8b4, 0xe8c040];
  g.fillStyle = '#1a1a20'; g.fillRect(0, 0, c.width, c.height);
  // Six overlapping arches — one per era of the block, oldest at the left.
  for (let i = 0; i < 6; i++) {
    const x = (i + 0.5) * c.width / 6;
    g.fillStyle = `#${pal[i % pal.length].toString(16).padStart(6, '0')}`;
    g.globalAlpha = 0.78;
    g.beginPath();
    g.moveTo(x - c.width / 11, c.height);
    g.lineTo(x - c.width / 11, c.height * (0.62 - i * 0.07));
    g.arc(x, c.height * (0.62 - i * 0.07), c.width / 11, Math.PI, 0);
    g.lineTo(x + c.width / 11, c.height);
    g.fill();
  }
  g.globalAlpha = 1;
  g.fillStyle = '#f0ece0';
  g.font = `bold ${Math.round(c.height * 0.09)}px Impact, sans-serif`;
  g.textAlign = 'center';
  g.fillText(lot.muralText || 'THE CORNER · 1945–2025', c.width / 2, c.height * 0.94);
  const m = quad(mw, mh, 0, mh / 2 + 1.4, 0.06, mats.printed(toTexture(c, { clamp: true })));
  fg.add(m);
  out.interactables.push({
    id: `mural:${lot.id}:${era.year}`,
    pos: localToWorld(face, lot, 0, 2.0, 3.0), radius: 4.0,
    title: 'Mural', sub: lot.muralText || 'The Corner', kind: 'read',
    body: [{ type: 'p', text: 'Six arches, one for each version of this corner anybody living can remember. Painted over four weekends by a crew who worked from photographs and from an eighty-eight-year-old’s description of a soda fountain.' }],
    foot: `${lot.addr} · ${era.year}`,
  });
}

function buildGraffiti(fg, W, ctx, rnd, era) {
  const { mats } = ctx;
  const n = rnd.int(1, 3);
  const tags = ['KAI', 'ZEPH', 'ROMA', 'TK1', 'SEEN'];
  for (let i = 0; i < n; i++) {
    const c = graffitiTexture(rnd.pick(tags), {
      colors: rnd.shuffle((era.palette.neon || [0xff2d95, 0x00e5ff, 0xffe500]).slice()),
      seed: 'g' + i + era.year,
    });
    const w = rnd.range(1.6, 3.4);
    const m = quad(w, w * 0.5, rnd.range(-W / 2 + 1.6, W / 2 - 1.6), rnd.range(1.0, 2.6), 0.36,
      mats.printed(toTexture(c, { clamp: true }), { transparent: true }));
    m.rotation.z = rnd.range(-0.05, 0.05);
    fg.add(m);
  }
}

/* ══════════════════════════ windows ══════════════════════════ */

/* ══════════════════════ facade ornament ══════════════════════ */

/** Styles built out of laid units, and so entitled to arches and quoins. */
const MASONRY = new Set(['brick', 'brickClean', 'limestone', 'civic', 'terracotta', 'restored', 'modernised']);

/**
 * Radial voussoirs over a window head, with a keystone at the crown.
 *
 * An opening in a masonry wall has to carry the wall above it, and the way it
 * does that — a flat stone lintel, a shallow segmental arch of rubbed brick, a
 * full semicircle with a carved key — is the most legible single clue to when
 * a building went up. Painting it on would be flat; these are real wedges.
 */
function archHead(b, x, y, r, z, col, { span = Math.PI, n = 9, depth = 0.26, rise = 0.28 } = {}) {
  if (n % 2 === 0) n += 1;                          // keeps a block on the crown
  for (let i = 0; i < n; i++) {
    const a = -span / 2 + (i + 0.5) * (span / n);
    const isKey = Math.abs(a) < 1e-6;
    const bw = (span * r) / n * 1.06;
    const hh = isKey ? rise * 1.55 : rise;
    b.box(bw * (isKey ? 1.3 : 1), hh, depth,
      x + Math.sin(a) * (r + hh / 2), y + Math.cos(a) * (r + hh / 2), z, col, { z: -a });
  }
}

/** A stepped corbel — carries a projecting sill, a balcony or a cornice. */
function corbel(b, x, y, z, col, s = 1) {
  b.box(0.15 * s, 0.10 * s, 0.30 * s, x, y, z + 0.05 * s, col);
  b.box(0.13 * s, 0.10 * s, 0.22 * s, x, y - 0.10 * s, z + 0.01 * s, col);
  b.box(0.11 * s, 0.09 * s, 0.14 * s, x, y - 0.19 * s, z - 0.03 * s, col);
}

/**
 * The horizontal and vertical bands that tie an elevation together: a water
 * table where the shopfront stops, a string course at every floor line, and
 * quoins running up the exposed corners.
 */
function buildBanding(b, W, H, lot, era, eraIdx, rnd, isFront, floors) {
  const style = lot.style || 'brick';
  const stone = era.palette.stone?.[0] ?? 0xa8a090;
  const stone2 = era.palette.stone?.[1] ?? 0x9a9280;
  const masonry = MASONRY.has(style);
  if (!masonry) {
    // A curtain-walled or panelled building gets a spandrel band instead —
    // the horizontal strip of solid panel between one floor's glass and the
    // next, which is what actually reads from the street on a 1965 refacing.
    for (let f = 1; f <= floors; f++) {
      const y = GROUND_H + f * FLOOR_H - 0.42;
      b.box(W - 0.3, 0.16, 0.1, 0, y, 0.06, lot.trim ?? 0x3a3630);
    }
    return;
  }

  /* Water table: the shopfront stops, the masonry starts, and there is always
     a projecting course marking the join. */
  b.box(W, 0.2, 0.26, 0, GROUND_H + 0.06, 0.13, stone);
  b.prism([[-W / 2, 0], [W / 2, 0], [W / 2, -0.16], [-W / 2, -0.16]], 0.26, 0, GROUND_H - 0.06, 0.13, stone2);

  /* String courses between the upper floors. */
  for (let f = 1; f < floors; f++) {
    const y = GROUND_H + f * FLOOR_H - 0.1;
    b.box(W, 0.13, 0.17, 0, y, 0.09, stone2);
    if (style === 'brick' || style === 'brickClean') {
      // Dentil course: a row of headers set proud, one brick in three.
      for (let i = 0; i < Math.round(W / 0.42); i++) {
        b.box(0.13, 0.11, 0.1, -W / 2 + 0.21 + i * 0.42, y + 0.12, 0.06, stone2);
      }
    }
  }

  /* Quoins up the exposed corners of a corner lot. */
  if (lot.corner && isFront && (style === 'limestone' || style === 'civic' || style === 'terracotta' || style === 'restored')) {
    const top = H - 0.5;
    for (const sx of [-1, 1]) {
      let y = GROUND_H;
      let big = true;
      while (y < top) {
        const qh = 0.42;
        const qw = big ? 0.62 : 0.4;
        b.box(qw, qh - 0.04, 0.14, sx * (W / 2 - qw / 2), y + qh / 2, 0.07, big ? stone : stone2);
        y += qh; big = !big;
      }
    }
  }
}

function buildWindowGrid(fg, b, W, lot, era, eraIdx, ctx, rnd, out, isFront, face, floors) {
  const { mats } = ctx;
  const kind = lot.windows || 'sash';
  if (kind === 'sealed') {
    // Refaced cinema: the upper windows were bricked/panelled over in 1958.
    b.box(W - 0.6, floors * FLOOR_H - 0.6, 0.12, 0, GROUND_H + (floors * FLOOR_H) / 2 - 0.3, 0.08,
      lot.panelColor ?? lot.facade ?? 0xd8d4c8);
    for (let i = 0; i < floors; i++) {
      b.box(W - 0.6, 0.1, 0.18, 0, GROUND_H + i * FLOOR_H + 0.2, 0.12, lot.trim ?? 0x2a2a2e);
    }
    return;
  }

  const trim = lot.trim ?? 0x3a3630;
  const bayW = kind === 'picture' || kind === 'blackFrame' || kind === 'oled' ? 3.3 : 2.55;
  const bays = Math.max(1, Math.round((W - 1.6) / bayW));
  const step = (W - 1.6) / bays;

  const wide = kind === 'picture' || kind === 'blackFrame' || kind === 'oled' || kind === 'growTube';
  const ww = wide ? step * 0.78 : Math.min(1.22, step * 0.5);
  const wh = wide ? 2.05 : kind === 'tall-arched' ? 2.5 : 1.85;
  const inset = 0.2;

  /* Upper-floor panes are opaque and mirror-like rather than transparent.
     From the street you cannot see into a lit room through daylight glass —
     you see the sky in it — and a reflective pane also spares us drawing an
     interior for eighty windows. Lit windows swap the pane for an emissive one. */
  const paneTex = toTexture(paneTexture({
    dirt: (lot.condition ?? 0.2) * 0.9, seed: lot.id + era.year,
    horizon: kind === 'tall-arched' ? 0.52 : 0.42,
  }), { clamp: true });
  const glassMat = mats.pane(era.palette.glass === 0x2a3038 ? 0xb8c4d0 : 0xc0ccd8, {
    map: paneTex, rough: 0.05 + (lot.condition ?? 0.2) * 0.16,
  });

  // Vertex-coloured so each pane takes its own curtain colour.
  const litMat = mats.emitVcol({ strength: 0.9 });
  const litFrac = era.windowLit * (isFront ? 1 : 0.7);

  /* Which head this elevation gets. Masonry lots built before the war have
     arched or segmental openings; a 1965 refacing has a flat lintel and means
     it. `lot.arched` lets the data override either way. */
  const masonry = MASONRY.has(lot.style || 'brick');
  const arched = lot.arched ?? (kind === 'tall-arched');
  const segmental = !arched && masonry && (lot.segmental ?? (eraIdx <= 1 && !wide));
  const brackets = masonry && (lot.corbels ?? (eraIdx <= 1 || lot.style === 'restored'));
  // A semicircular head is a stone or terracotta feature and reads pale; a
  // segmental head is gauged brick from the same batch as the wall, so it is
  // barely a shade off it. Making both of them limestone was what turned the
  // brick elevations into a row of white scallops.
  const archCol = arched
    ? (era.palette.stone?.[0] ?? 0xbfae94)
    : tintUp(lot.facade ?? 0x8a4634, 0.16);

  const glassBucket = [];
  const litBucket = new Bucket();
  const boardFrac = lot.boarded ?? 0;
  const boardFrom = lot.boardedFrom ?? 99;

  for (let f = 0; f < floors; f++) {
    const y = GROUND_H + f * FLOOR_H + FLOOR_H * 0.52;
    for (let i = 0; i < bays; i++) {
      const x = -W / 2 + 0.8 + (i + 0.5) * step;
      const boarded = f + 1 >= boardFrom || rnd.chance(boardFrac);

      /* Reveal: the wall is thick, so the glass sits back from the face.
         The architrave is a *frame*, not a slab — a filled panel here reads as
         a painted rectangle instead of an opening, which is the single most
         common way procedural facades look fake. */
      const aw = 0.17;
      b.box(ww + 0.34 + aw * 2, aw, 0.12, x, y + wh / 2 + aw / 2 + 0.17, 0.06, trim);
      b.box(ww + 0.34 + aw * 2, aw, 0.12, x, y - wh / 2 - aw / 2 - 0.17, 0.06, trim);
      b.box(aw, wh + 0.34, 0.12, x - ww / 2 - 0.17 - aw / 2, y, 0.06, trim);
      b.box(aw, wh + 0.34, 0.12, x + ww / 2 + 0.17 + aw / 2, y, 0.06, trim);

      b.box(ww + 0.14, 0.1, inset, x, y - wh / 2 - 0.12, -inset / 2, trim);  // sill under
      b.box(ww + 0.34, 0.16, 0.28, x, y - wh / 2 - 0.2, 0.12, era.palette.stone?.[1] ?? 0x9a9280);

      /* How the opening is headed. A projecting stone sill wants something
         under it, and the wall above wants either a lintel or an arch — which
         of those it is dates the building more precisely than anything else on
         the elevation. */
      if (arched) {
        // Full semicircle: gauged voussoirs and a carved keystone.
        archHead(b, x, y + wh / 2 + 0.1, ww / 2 + 0.2, 0.1, archCol,
          { span: Math.PI, n: 11, rise: 0.3, depth: 0.24 });
      } else if (segmental) {
        // Shallow segmental arch of rubbed brick — the workaday 1900s opening.
        const rise = 0.22, half = ww / 2 + 0.16;
        const R = (half * half + rise * rise) / (2 * rise);
        const span = 2 * Math.asin(half / R);
        archHead(b, x, y + wh / 2 + 0.13 - (R - rise), R, 0.075, archCol,
          { span, n: 11, rise: 0.185, depth: 0.15 });
      } else {
        b.box(ww + 0.34, 0.14, 0.2, x, y + wh / 2 + 0.16, 0.1, trim);      // lintel
      }
      if (brackets) {
        corbel(b, x - ww / 2 - 0.06, y - wh / 2 - 0.34, 0.1, era.palette.stone?.[1] ?? 0x9a9280, 0.9);
        corbel(b, x + ww / 2 + 0.06, y - wh / 2 - 0.34, 0.1, era.palette.stone?.[1] ?? 0x9a9280, 0.9);
      }
      b.box(0.12, wh, inset, x - ww / 2 - 0.06, y, -inset / 2, trim);
      b.box(0.12, wh, inset, x + ww / 2 + 0.06, y, -inset / 2, trim);
      b.box(ww, 0.12, inset, x, y + wh / 2 + 0.06, -inset / 2, trim);

      /* A dark backing plane turns the glass into a hole rather than a tile of
         brick seen through tinted film. */
      b.box(ww + 0.2, wh + 0.2, 0.02, x, y, -inset - 0.17, 0x0d0c0b);

      if (boarded) {
        b.box(ww, wh, 0.08, x, y, -inset + 0.05, 0x8a7a5c);
        for (let k = 0; k < 3; k++) b.box(ww, 0.04, 0.12, x, y - wh / 2 + wh * (k + 0.5) / 3, -inset + 0.11, 0x6a5a44);
        continue;
      }

      /* Frame + sashes */
      if (kind === 'sash' || kind === 'newSash') {
        b.box(ww, 0.07, 0.09, x, y, -inset + 0.06, trim);               // meeting rail
        b.box(0.06, wh, 0.09, x, y, -inset + 0.06, trim);               // centre mullion
      } else if (kind === 'blackFrame' || kind === 'oled') {
        b.box(ww + 0.08, wh + 0.08, 0.07, x, y, -inset + 0.05, 0x14141a);
      } else if (kind === 'tall-arched') {
        b.box(0.06, wh, 0.09, x, y, -inset + 0.06, trim);
        // Fanlight bars radiating from the springing line.
        for (let k = 1; k < 4; k++) {
          const a = -Math.PI / 2 + (k * Math.PI) / 4;
          const rr = ww / 2;
          b.rod(x, y + wh / 2 + 0.06, -inset + 0.06,
            x + Math.cos(a) * rr, y + wh / 2 + 0.06 + Math.sin(a) * rr, -inset + 0.06, 0.028, trim);
        }
      }

      /* Blinds and shades. Eighty identical windows is what makes a procedural
         elevation read as wallpaper; a third of them half-shut, at eight
         different heights, is what makes it read as eighty rooms. */
      if (!wide || eraIdx >= 3) {
        const blindRoll = rnd.range(0, 1);
        if (blindRoll < 0.34) {
          const drop = rnd.range(0.2, 0.88);
          const bh = wh * drop;
          const shade = eraIdx <= 1 ? 0xd8cbb0 : eraIdx === 2 ? 0xc8c0b4 : 0xe4e4e0;
          b.box(ww - 0.03, bh, 0.03, x, y + wh / 2 - bh / 2, -inset + 0.09, shade);
          // Slat lines, so it is a venetian blind and not a sheet of card.
          const slats = Math.max(2, Math.round(bh / 0.09));
          for (let k = 1; k < slats; k++) {
            b.box(ww - 0.05, 0.012, 0.012, x, y + wh / 2 - k * (bh / slats), -inset + 0.105,
              eraIdx <= 1 ? 0xb8ab92 : 0xc4c4c0);
          }
          b.box(ww - 0.02, 0.035, 0.045, x, y + wh / 2 - bh, -inset + 0.10, shade);   // bottom rail
        } else if (blindRoll < 0.44 && eraIdx <= 2) {
          // A roller shade pulled to a stop, crooked, as they always are.
          const drop = rnd.range(0.3, 0.8);
          b.box(ww - 0.04, wh * drop, 0.03, x, y + wh / 2 - wh * drop / 2, -inset + 0.09,
            0xd0c4a4, { z: rnd.range(-0.02, 0.02) });
        }
      }

      const isLit = rnd.chance(litFrac);
      if (isLit) {
        litBucket.box(ww, wh, 0.02, x, y, -inset + 0.02, rnd.pick(era.curtains || [0xffd8a0]));
        // A silhouette in one window in ten — somebody is home. It sits just in
        // front of the lit pane so it reads as a person against the light.
        if (rnd.chance(0.13)) {
          b.box(0.34, 0.86, 0.03, x + rnd.range(-0.22, 0.22), y - 0.28, -inset + 0.05, 0x120f0d);
          b.sphere(0.11, x + rnd.range(-0.22, 0.22), y + 0.2, -inset + 0.05, 0x120f0d, true);
        }
      } else {
        glassBucket.push({ x, y, ww, wh });
      }
      // A cat in exactly one upper window per era — see the codex.
      if (lot.id === 'hotel' && f === 1 && i === 1) {
        b.box(0.3, 0.16, 0.14, x + 0.2, y - wh / 2 + 0.12, -inset + 0.06, 0x2a2622);
        b.box(0.1, 0.12, 0.1, x + 0.36, y - wh / 2 + 0.22, -inset + 0.06, 0x2a2622);
        out.interactables.push({
          id: 'secret:cat', secret: true,
          pos: localToWorld(face, lot, x + 0.2, y - 0.2, 1.2), radius: 3.0,
          title: 'A cat in the window', sub: 'Look closer', kind: 'secret',
          body: [{ type: 'p', text: 'Third floor, second window from the left. Black, unbothered, watching the street. There is a cat in this window in every single decade, which is not possible, and nobody who lives here finds it strange.' }],
          foot: `Hotel Vernon · ${era.year}`,
        });
      }
    }
  }

  /* Glass and lit panes go in as their own merged meshes. */
  if (glassBucket.length) {
    const gb = new Bucket();
    for (const g of glassBucket) gb.box(g.ww, g.wh, 0.02, g.x, g.y, -inset + 0.02, 0xffffff);
    const gm = gb.mesh(glassMat, { cast: false, receive: false, name: 'windows' });
    if (gm) { gm.renderOrder = 2; fg.add(gm); }
  }
  const lm = litBucket.mesh(litMat, { cast: false, receive: false, name: 'litwindows' });
  if (lm) fg.add(lm);

  if (kind === 'growTube') buildGrowTubes(fg, b, W, floors, era, ctx, lot, out);
}

function buildWindowACs(b, W, lot, rnd) {
  const floors = Math.max(0, lot.floors - 1);
  const bays = Math.max(1, Math.round((W - 1.6) / 2.55));
  const step = (W - 1.6) / bays;
  for (let f = 0; f < floors; f++) {
    for (let i = 0; i < bays; i++) {
      if (!rnd.chance(lot.acUnits)) continue;
      const x = -W / 2 + 0.8 + (i + 0.5) * step;
      const y = GROUND_H + f * FLOOR_H + FLOOR_H * 0.52 - 0.55;
      b.box(0.72, 0.44, 0.56, x, y, 0.2, 0xb8b4ac);
      b.box(0.68, 0.34, 0.06, x, y, 0.5, 0x6a6a70);
      b.rod(x - 0.3, y - 0.22, 0.42, x - 0.3, y - 0.5, 0.06, 0.02, 0x4a4a4a);
      b.rod(x + 0.3, y - 0.22, 0.42, x + 0.3, y - 0.5, 0.06, 0.02, 0x4a4a4a);
    }
  }
}

/* ══════════════════════════ cornice & structure ══════════════════════════ */

function buildCornice(b, W, H, style, era, trim) {
  const stone = era.palette.stone?.[0] ?? 0xa8a090;
  switch (style) {
    case 'heavy':
      b.prism([[-W / 2, 0], [W / 2, 0], [W / 2, 0.5], [W / 2 - 0.1, 0.62], [-W / 2 + 0.1, 0.62], [-W / 2, 0.5]], 1.05, 0, H - 0.1, 0.5, stone, { x: 0 });
      b.box(W, 0.24, 0.72, 0, H - 0.5, 0.36, stone);
      // Modillion brackets
      for (let i = 0; i < Math.round(W / 1.1); i++) {
        b.box(0.18, 0.42, 0.5, -W / 2 + 0.55 + i * 1.1, H - 0.85, 0.26, stone);
      }
      b.box(W, 0.2, 0.28, 0, H - 1.15, 0.14, stone);
      break;
    case 'bracketed':
      b.box(W, 0.34, 0.86, 0, H - 0.17, 0.43, stone);
      for (let i = 0; i < Math.round(W / 1.5); i++) {
        const x = -W / 2 + 0.75 + i * 1.5;
        b.prism([[0, 0], [0.7, 0], [0.7, 0.18], [0.18, 0.62], [0, 0.62]], 0.2, x, H - 0.82, 0.5, stone);
      }
      b.box(W, 0.16, 0.3, 0, H - 0.92, 0.15, stone);
      break;
    case 'dentil':
      b.box(W, 0.3, 0.7, 0, H - 0.15, 0.35, stone);
      for (let i = 0; i < Math.round(W / 0.42); i++) {
        b.box(0.2, 0.22, 0.34, -W / 2 + 0.21 + i * 0.42, H - 0.44, 0.17, stone);
      }
      b.box(W, 0.18, 0.46, 0, H - 0.64, 0.23, stone);
      break;
    case 'brick-corbel':
      for (let r = 0; r < 3; r++) {
        b.box(W, 0.14, 0.16 + r * 0.1, 0, H - 0.1 - r * 0.15, (0.16 + r * 0.1) / 2, stone);
      }
      break;
    case 'angled':
      b.prism([[-W / 2, 0], [W / 2, 0], [W / 2, 0.36], [-W / 2, 0.62]], 0.8, 0, H - 0.1, 0.4, trim);
      break;
    default:
      b.box(W, 0.28, 0.36, 0, H - 0.14, 0.18, trim);
      b.box(W, 0.1, 0.5, 0, H - 0.3, 0.25, trim);
  }
}

function buildFireEscape(b, W, lot, era, rnd) {
  const floors = Math.max(1, lot.floors - 1);
  const x = W * 0.22;
  const bw = 2.4, proj = 1.5;
  const rail = 0x2e2a26;
  for (let f = 0; f < floors; f++) {
    const y = GROUND_H + f * FLOOR_H + 0.1;
    // Platform grating
    b.box(bw, 0.07, proj, x, y, proj / 2, rail);
    for (let i = 0; i < 7; i++) b.box(bw, 0.03, 0.05, x, y + 0.05, 0.16 + i * 0.2, rail);
    // Railings
    for (const s of [-1, 1]) b.rod(x + s * bw / 2, y, proj, x + s * bw / 2, y + 1.05, proj, 0.03, rail);
    b.rod(x - bw / 2, y + 1.05, proj, x + bw / 2, y + 1.05, proj, 0.03, rail);
    b.rod(x - bw / 2, y + 0.55, proj, x + bw / 2, y + 0.55, proj, 0.03, rail);
    for (let i = 0; i < 8; i++) {
      const bx = x - bw / 2 + (i + 0.5) * bw / 8;
      b.rod(bx, y, proj, bx, y + 1.05, proj, 0.016, rail);
    }
    // Diagonal stair to the floor above
    if (f < floors - 1) {
      const y2 = y + FLOOR_H;
      b.rod(x - bw / 2 + 0.2, y + 0.05, proj - 0.2, x + bw / 2 - 0.2, y2 - 0.05, 0.4, 0.04, rail);
      b.rod(x - bw / 2 + 0.55, y + 0.05, proj - 0.2, x + bw / 2 + 0.15, y2 - 0.05, 0.4, 0.04, rail);
      for (let s = 0; s < 8; s++) {
        const t = (s + 0.5) / 8;
        b.box(0.62, 0.035, 0.2,
          lerp(x - bw / 2 + 0.38, x + bw / 2 - 0.02, t),
          lerp(y + 0.1, y2 - 0.1, t),
          lerp(proj - 0.2, 0.4, t), rail);
      }
    }
    // Brackets back to the wall
    b.rod(x - bw / 2, y, proj, x - bw / 2 + 0.1, y + 0.6, 0.1, 0.028, rail);
    b.rod(x + bw / 2, y, proj, x + bw / 2 - 0.1, y + 0.6, 0.1, 0.028, rail);
    // Somebody's stuff on the fire escape
    if (rnd.chance(0.4)) b.box(0.4, 0.34, 0.34, x + rnd.range(-0.7, 0.7), y + 0.2, proj * 0.6, rnd.pick([0x6a8a4a, 0x8a4a3a, 0x4a5a6a]));
  }
  // Drop ladder
  b.rod(x - 0.4, GROUND_H + 0.1, proj - 0.3, x - 0.4, GROUND_H - 1.8, proj - 0.3, 0.03, rail);
  b.rod(x + 0.4, GROUND_H + 0.1, proj - 0.3, x + 0.4, GROUND_H - 1.8, proj - 0.3, 0.03, rail);
  for (let i = 0; i < 6; i++) b.rod(x - 0.4, GROUND_H - 0.1 - i * 0.28, proj - 0.3, x + 0.4, GROUND_H - 0.1 - i * 0.28, proj - 0.3, 0.018, rail);
}

function buildScaffold(fg, b, W, H, ctx, rnd) {
  const tube = 0x8a8a70;
  const bays = Math.max(2, Math.round(W / 2.4));
  const lifts = Math.max(2, Math.round(H / 2.1));
  const proj = 1.3;
  for (let i = 0; i <= bays; i++) {
    const x = -W / 2 + i * (W / bays);
    b.rod(x, 0, proj, x, H + 1.2, proj, 0.04, tube);
    b.rod(x, 0, 0.2, x, H + 1.2, 0.2, 0.04, tube);
  }
  for (let l = 0; l <= lifts; l++) {
    const y = l * (H / lifts);
    b.rod(-W / 2, y, proj, W / 2, y, proj, 0.04, tube);
    b.rod(-W / 2, y, 0.2, W / 2, y, 0.2, 0.04, tube);
    for (let i = 0; i < bays; i++) {
      const x = -W / 2 + (i + 0.5) * (W / bays);
      b.rod(x - 0.6, y, 0.2, x + 0.6, y + 0.9, proj, 0.03, tube);
    }
    if (l > 0) {
      for (let p = 0; p < 4; p++) b.box(W, 0.05, 0.3, 0, y + 0.04, 0.35 + p * 0.32, 0x8a7a5c);
      b.rod(-W / 2, y + 1.0, proj, W / 2, y + 1.0, proj, 0.03, tube);
    }
  }
  // Sidewalk shed roof + protective netting
  b.box(W, 0.16, proj + 2.4, 0, 3.3, proj / 2 + 1.2, 0x6a7a5a);
  for (let i = 0; i <= bays; i++) {
    const x = -W / 2 + i * (W / bays);
    b.rod(x, 0, proj + 2.2, x, 3.3, proj + 2.2, 0.06, tube);
  }
  const { mats } = ctx;
  const net = quad(W, H - 3.4, 0, 3.4 + (H - 3.4) / 2, proj + 0.12,
    mats.printed(null, { transparent: true }));
  net.material.color.setHex(0x5a7a4a);
  net.material.opacity = 0.32;
  net.material.transparent = true;
  net.material.side = THREE.DoubleSide;
  fg.add(net);
}

function buildColumns(b, W, lot, era, ctx) {
  const n = lot.columns || 6;
  const stone = lot.columnsClad ? 0xb8bcc0 : (era.palette.stone?.[0] ?? 0xbfae94);
  const r = 0.42, h = GROUND_H + 1.6;
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + (i + 0.5) * (W / n);
    b.cyl(r, h, x, h / 2, 0.75, stone, null, lot.columnsClad ? 12 : 20);
    if (!lot.columnsClad) {
      for (let f = 0; f < 16; f++) {
        const a = (f / 16) * Math.PI * 2;
        b.cyl(0.035, h * 0.92, x + Math.cos(a) * r * 0.94, h / 2, 0.75 + Math.sin(a) * r * 0.94, 0x9a8f78, null, 6);
      }
    }
    b.box(r * 2.5, 0.22, r * 2.5, x, 0.11, 0.75, stone);        // base
    b.box(r * 2.6, 0.3, r * 2.6, x, h + 0.1, 0.75, stone);      // capital
  }
  b.box(W, 0.5, 1.7, 0, h + 0.5, 0.85, stone);                  // entablature
  b.box(W, 0.32, 1.9, 0, h + 0.85, 0.95, stone);
  if (lot.clock) {
    const cy = h + 2.4;
    b.cyl(0.92, 0.24, 0, cy, 0.86, stone, { x: Math.PI / 2 }, 24);
    b.cyl(0.8, 0.28, 0, cy, 0.92, 0xf0ece0, { x: Math.PI / 2 }, 24);
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      b.box(0.05, 0.13, 0.03, Math.sin(a) * 0.66, cy + Math.cos(a) * 0.66, 1.07, 0x2a2a2e, { z: -a });
    }
  }
}

function buildGreenWall(fg, b, W, H, lot, era, ctx, rnd, out) {
  const amount = lot.greenWall;
  const rows = Math.round(H / 1.2);
  const cols = Math.round(W / 0.85);
  const bio = era.palette.bio || [0x3a7a4a, 0x5a9a5a, 0x2a6a3a, 0x9fe870];
  const leaves = new Bucket();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!rnd.chance(amount * 0.9)) continue;
      const x = -W / 2 + (c + 0.5) * (W / cols);
      const y = 1.0 + r * (H / rows) * 0.96;
      if (y > H - 0.4) continue;
      const s = rnd.range(0.28, 0.62);
      leaves.sphere(s * 0.5, x + rnd.range(-0.18, 0.18), y, 0.22 + rnd.range(0, 0.2), rnd.pick(bio), true);
      if (rnd.chance(0.28)) leaves.box(0.07, rnd.range(0.3, 0.8), 0.07, x, y - 0.3, 0.2, 0x3a5a3a);
    }
  }
  // Support trellis
  for (let c = 0; c <= cols; c += 2) {
    b.rod(-W / 2 + c * (W / cols), 0.8, 0.16, -W / 2 + c * (W / cols), H - 0.4, 0.16, 0.02, 0x5a6a5a);
  }
  const lm = leaves.mesh(ctx.mats.vcol('rough'), { cast: true, receive: true, name: 'greenwall' });
  if (lm) fg.add(lm);
}

function buildGrowTubes(fg, b, W, floors, era, ctx, lot, out) {
  const { mats } = ctx;
  const tiers = floors * 2 + 2;
  for (let t = 0; t < tiers; t++) {
    const y = GROUND_H + t * ((floors * FLOOR_H) / tiers) + 0.4;
    b.cyl(0.16, W - 1.0, 0, y, 0.55, 0xd8dcd8, { z: Math.PI / 2 }, 10);
    const glow = quad(W - 1.2, 0.1, 0, y - 0.26, 0.55,
      mats.emissive(null, { color: lot.growLights ?? 0xff5aa0, strength: 2.6, transparent: false }));
    glow.rotation.x = Math.PI / 2;
    fg.add(glow);
    for (let i = 0; i < Math.round(W / 0.6); i++) {
      b.sphere(0.1, -W / 2 + 0.6 + i * 0.6, y + 0.2, 0.55, 0x4a9a4a, true);
    }
  }
  out.lights.push({
    pos: new THREE.Vector3(...localToWorld(lot.face, lot, 0, GROUND_H + 3, 2.4).toArray()),
    color: lot.growLights ?? 0xff5aa0, intensity: 17.6, distance: 12, key: `grow:${lot.id}`,
  });
}

function buildLouvres(b, W, H, era, rnd) {
  const n = Math.round(W / 1.4);
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + (i + 0.5) * (W / n);
    for (let f = 0; f < Math.round((H - GROUND_H) / FLOOR_H); f++) {
      const y = GROUND_H + f * FLOOR_H + FLOOR_H / 2;
      const a = rnd.range(-0.7, 0.7);
      b.box(W / n - 0.14, 2.2, 0.06, x, y, 0.55, 0xa8b0ac, { y: a });
    }
  }
}

function buildPods(b, W, H, era, rnd) {
  const n = Math.max(2, Math.round(W / 4.5));
  for (let i = 0; i < n; i++) {
    if (!rnd.chance(0.75)) continue;
    const x = -W / 2 + (i + 0.5) * (W / n);
    const y = H - 2.2;
    b.box(3.4, 2.6, 2.4, x, y, 1.2, 0xd8dcd8);
    b.box(2.6, 1.3, 0.12, x, y + 0.2, 2.44, 0x1e3038);
    b.box(3.6, 0.14, 2.5, x, y + 1.34, 1.2, 0x56d0e0);
    b.rod(x - 1.6, y - 1.3, 0.2, x - 1.6, y - 1.3, 2.3, 0.06, 0x8a9a9a);
    b.rod(x + 1.6, y - 1.3, 0.2, x + 1.6, y - 1.3, 2.3, 0.06, 0x8a9a9a);
  }
}

/* ══════════════════════════ roof ══════════════════════════ */

function buildRoof(lot, era, ctx, rnd, out, H) {
  const { mats } = ctx;
  const b = new Bucket();
  const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
  const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
  const items = lot.roof || [];
  const emissiveBucket = new Bucket();

  const px = (u) => (u - 0.5) * (w - 3);
  const pz = (u) => (u - 0.5) * (d - 3);

  for (const item of items) {
    switch (item) {
      case 'watertank': {
        const x = px(rnd.range(0.2, 0.8)), z = pz(rnd.range(0.2, 0.8));
        const legH = 2.4, tr = 1.95, th = 3.3;
        for (let i = 0; i < 6; i++) {
          const a = i * Math.PI / 3;
          b.rod(x + Math.cos(a) * tr * 0.8, H, z + Math.sin(a) * tr * 0.8,
                x + Math.cos(a) * tr * 0.62, H + legH, z + Math.sin(a) * tr * 0.62, 0.09, 0x4a3f34);
        }
        b.taper(tr * 0.62, tr * 0.68, th, x, H + legH, z, 0x6a5340, 14);
        b.cone(tr * 0.7, 1.0, x, H + legH + th + 0.5, z, 0x4a3f34);
        for (let i = 0; i < 3; i++) b.cyl(tr * 0.66, 0.1, x, H + legH + 0.5 + i * 1.1, z, 0x2f2a24, null, 14);
        b.rod(x, H, z + tr * 0.5, x, H + legH + th, z + tr * 0.5, 0.06, 0x3a3a3a);
        break;
      }
      case 'chimneys': {
        const n = rnd.int(2, 4);
        for (let i = 0; i < n; i++) {
          const x = px(rnd.f()), z = pz(rnd.f());
          const ch = rnd.range(1.4, 2.6);
          b.boxOn(0.85, ch, 0.85, x, H, z, era.palette.brick[0]);
          b.box(1.05, 0.16, 1.05, x, H + ch + 0.08, z, 0xa89880);
          for (let p = 0; p < 2; p++) b.cyl(0.14, 0.42, x + (p - 0.5) * 0.34, H + ch + 0.3, z, 0x8a6a4a, null, 8);
        }
        break;
      }
      case 'acUnit': case 'acRooftop': {
        const n = item === 'acRooftop' ? rnd.int(2, 4) : 1;
        for (let i = 0; i < n; i++) {
          const x = px(rnd.f()), z = pz(rnd.f());
          const s = item === 'acRooftop' ? 1.0 : 0.8;
          b.boxOn(2.0 * s, 1.1 * s, 1.5 * s, x, H + 0.15, z, 0xb0b4b0);
          b.box(1.5 * s, 0.1, 1.5 * s, x, H + 1.28 * s, z, 0x8a8e8a);
          b.cyl(0.55 * s, 0.12, x, H + 1.36 * s, z, 0x6a6e6a, null, 12);
          b.boxOn(2.1 * s, 0.18, 1.6 * s, x, H, z, 0x6a6a6a);
          out.animated.push({ kind: 'fan', pos: new THREE.Vector3(cx + x, H + 1.4 * s, cz + z) });
        }
        break;
      }
      case 'antenna': {
        const x = px(rnd.f()), z = pz(rnd.f());
        b.rod(x, H, z, x, H + 3.4, z, 0.05, 0xa8a8a8);
        for (let i = 0; i < 7; i++) {
          const y = H + 1.2 + i * 0.3;
          const len = 1.5 - i * 0.14;
          b.rod(x - len / 2, y, z, x + len / 2, y, z, 0.022, 0xa8a8a8);
        }
        break;
      }
      case 'satelliteDish': {
        const x = px(rnd.f()), z = pz(rnd.f());
        b.rod(x, H, z, x, H + 1.1, z, 0.06, 0x6a6a6a);
        b.cyl(0.85, 0.14, x, H + 1.5, z, 0xd8d4c8, { x: -0.8 }, 16);
        b.rod(x, H + 1.5, z, x + 0.2, H + 1.9, z + 0.5, 0.03, 0x4a4a4a);
        break;
      }
      case 'cellAntenna': {
        const x = px(rnd.f()), z = pz(rnd.f());
        b.rod(x, H, z, x, H + 2.6, z, 0.07, 0x9a9a9a);
        for (let i = 0; i < 3; i++) {
          const a = i * Math.PI * 2 / 3;
          b.box(0.22, 1.3, 0.12, x + Math.cos(a) * 0.5, H + 2.0, z + Math.sin(a) * 0.5, 0xd8d8d4, { y: -a });
        }
        break;
      }
      case 'solarRoof': {
        const rows = Math.max(1, Math.floor((d - 4) / 2.2));
        const cols = Math.max(1, Math.floor((w - 4) / 2.4));
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const x = -(w - 4) / 2 + (c + 0.5) * 2.4, z = -(d - 4) / 2 + (r + 0.5) * 2.2;
          b.box(2.2, 0.06, 1.5, x, H + 0.6, z, 0x1a2a3a, { x: -0.34 });
          b.rod(x, H, z + 0.5, x, H + 0.4, z + 0.5, 0.03, 0x8a8a8a);
          b.rod(x, H, z - 0.5, x, H + 0.75, z - 0.5, 0.03, 0x8a8a8a);
        }
        break;
      }
      case 'greenRoof': {
        const bio = era.palette.bio || [0x3a7a4a, 0x5a9a5a];
        for (let i = 0; i < 70; i++) {
          b.sphere(rnd.range(0.2, 0.5), px(rnd.f()), H + 0.25, pz(rnd.f()), rnd.pick(bio), true);
        }
        b.box(w - 2, 0.16, d - 2, 0, H + 0.08, 0, 0x3a4a30);
        break;
      }
      case 'droneDock': {
        const x = px(rnd.range(0.3, 0.7)), z = pz(rnd.range(0.3, 0.7));
        b.cyl(1.5, 0.24, x, H + 0.12, z, 0x3a4a4a, null, 12);
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          emissiveBucket.box(0.24, 0.05, 0.1, x + Math.cos(a) * 1.3, H + 0.26, z + Math.sin(a) * 1.3, 0x56d0e0, { y: -a });
        }
        out.animated.push({ kind: 'dronePad', pos: new THREE.Vector3(cx + x, H + 0.3, cz + z) });
        break;
      }
      case 'waterReclaim': {
        const x = px(rnd.f()), z = pz(rnd.f());
        b.cylOn(1.1, 3.4, x, H, z, 0xa8b0ac, null, 14);
        b.cyl(1.2, 0.2, x, H + 3.5, z, 0x8a9a96, null, 14);
        b.rod(x + 1.1, H + 0.4, z, x + 1.1, H + 3.2, z, 0.06, 0x6a7a76);
        break;
      }
      case 'clothesline': {
        const y = H + 1.6;
        b.rod(px(0.15), H, pz(0.2), px(0.15), y, pz(0.2), 0.05, 0x4a4038);
        b.rod(px(0.85), H, pz(0.8), px(0.85), y, pz(0.8), 0.05, 0x4a4038);
        b.rod(px(0.15), y, pz(0.2), px(0.85), y, pz(0.8), 0.012, 0xd8d0c0);
        for (let i = 0; i < 6; i++) {
          const t = (i + 0.7) / 7;
          b.box(0.5, 0.72, 0.02,
            lerp(px(0.15), px(0.85), t), y - 0.42, lerp(pz(0.2), pz(0.8), t),
            rnd.pick([0xe8e0cc, 0xd8ccb0, 0xb8c8d0, 0xe0d0c0]));
        }
        break;
      }
      case 'parapet':
        b.box(w - 0.6, 0.5, 0.5, 0, H + 1.3, -(d / 2) + 0.6, era.palette.stone?.[0] ?? 0xbfae94);
        break;
      case 'flagpole': {
        const x = px(0.5), z = pz(0.12);
        b.rod(x, H + 1.1, z, x + 2.6, H + 2.6, z, 0.05, 0xd8d4c8);
        b.box(1.5, 0.9, 0.03, x + 1.6, H + 2.0, z, 0xc8302a, { z: 0.5 });
        break;
      }
      case 'neonPylon': case 'neonPylonDead': {
        const dead = item.endsWith('Dead');
        const x = px(0.5), z = pz(0.5);
        b.rod(x - 0.8, H, z, x - 0.8, H + 4.4, z, 0.08, 0x4a4a4a);
        b.rod(x + 0.8, H, z, x + 0.8, H + 4.4, z, 0.08, 0x4a4a4a);
        b.box(3.0, 1.4, 0.24, x, H + 3.6, z, 0x1a1a1e);
        if (!dead) emissiveBucket.box(2.7, 1.1, 0.08, x, H + 3.6, z + 0.16, era.palette.neon?.[0] ?? 0xff2d95);
        break;
      }
      case 'deck': {
        b.box(w - 4, 0.12, d - 4, 0, H + 0.2, 0, 0x8a7a5c);
        for (let i = 0; i < 4; i++) {
          b.boxOn(0.6, 0.5, 0.6, px(0.25 + i * 0.16), H + 0.26, pz(0.3), 0x4a4a4e);
        }
        for (let i = 0; i < 6; i++) b.sphere(0.5, px(rnd.f()), H + 0.7, pz(rnd.f()), 0x3a6a3a, true);
        break;
      }
      case 'airPylon': {
        const x = px(0.5), z = pz(0.5);
        b.taper(0.3, 0.7, 5.0, x, H, z, 0xa8b0ac, 10);
        emissiveBucket.cyl(0.34, 0.16, x, H + 5.0, z, 0x56d0e0, null, 10);
        out.animated.push({ kind: 'pylon', pos: new THREE.Vector3(cx + x, H + 5.0, cz + z) });
        break;
      }
      case 'securityCam': {
        b.box(0.2, 0.16, 0.42, px(0.9), H + 0.9, pz(0.1), 0xd8d8d4);
        b.rod(px(0.9), H, pz(0.1), px(0.9), H + 0.85, pz(0.1), 0.03, 0x8a8a8a);
        break;
      }
      case 'vent': {
        const x = px(rnd.f()), z = pz(rnd.f());
        b.cylOn(0.32, 1.1, x, H, z, 0x8a8a86, null, 10);
        b.cyl(0.42, 0.14, x, H + 1.18, z, 0x6a6a66, null, 10);
        break;
      }
      case 'pigeons': {
        for (let i = 0; i < rnd.int(3, 7); i++) {
          const x = px(rnd.f()), z = -(d / 2) + 0.35;
          b.box(0.16, 0.13, 0.24, x, H + PARAPET + 0.08, z, rnd.pick([0x6a6a70, 0x4a4a52, 0x8a8a90]));
          b.box(0.08, 0.08, 0.08, x, H + PARAPET + 0.19, z - 0.11, 0x5a5a62);
        }
        break;
      }
      default: break;
    }
  }

  const rm = b.mesh(mats.vcol('matte'), { name: 'roof' });
  if (rm) { rm.position.set(cx, 0, cz); out.group.add(rm); }
  const em = emissiveBucket.mesh(mats.emitVcol({ strength: 2.6 }), { cast: false });
  if (em) { em.position.set(cx, 0, cz); out.group.add(em); }
}

/* ══════════════════════════ the open corner lot ══════════════════════════ */

function buildOpenLot(lot, era, eraIdx, ctx, rnd, out) {
  const { mats } = ctx;
  const b = new Bucket();
  const emit = new Bucket();
  const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
  const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
  const use = lot.use;

  /* Ground surface */
  const groundMat = use === 'parking' ? mats.asphalt(lot.asphalt ?? 0x2a2a2e, { repeat: [w / 4, d / 4], wet: era.road.wet })
    : use === 'gasStation' ? mats.concrete(0xb0aca0, { repeat: [w / 3, d / 3] })
    : use === 'construction' ? mats.concrete(0x8a8478, { repeat: [w / 3, d / 3] })
    : use === 'victoryGarden' ? mats.concrete(0x6a5a42, { repeat: [w / 2, d / 2], rough: 1 })
    : mats.concrete(lot.paving ?? 0x9a8e80, { repeat: [w / 2.5, d / 2.5] });
  const g = quad(w, d, 0, 0, 0, groundMat);
  g.rotation.x = -Math.PI / 2;
  g.position.set(cx, 0.02, cz);
  g.receiveShadow = true;
  out.group.add(g);

  /* Party walls of the neighbours that this lot exposes */
  const partyN = quad(w, 14, 0, 0, 0, mats.brick(era.palette.brick[1], { repeat: [w / 1.85, 14 / 1.85], condition: 0.6 }));
  partyN.geometry.translate(0, 7, 0);
  partyN.position.set(cx, 0, lot.z0);
  partyN.rotation.y = 0;
  partyN.receiveShadow = true; partyN.castShadow = true;
  out.group.add(partyN);
  const partyE = quad(d, 14, 0, 0, 0, mats.brick(era.palette.brick[2], { repeat: [d / 1.85, 14 / 1.85], condition: 0.55 }));
  partyE.geometry.translate(0, 7, 0);
  partyE.position.set(lot.x1, 0, cz);
  partyE.rotation.y = -Math.PI / 2;
  partyE.receiveShadow = true; partyE.castShadow = true;
  out.group.add(partyE);

  /* The tree — the spine of the whole piece */
  if (lot.tree) buildTree(b, lot.tree, cx - w * 0.28, 0, cz - d * 0.3, era, rnd, out, eraIdx);

  switch (use) {
    case 'victoryGarden': {
      // Raised beds, cane frames, a hand-lettered sign, cabbages.
      for (let r = 0; r < 4; r++) {
        const z = cz - d / 2 + 3.5 + r * 4.6;
        b.boxOn(w - 5, 0.34, 2.2, cx, 0.02, z, 0x6a5540);
        for (let i = 0; i < 9; i++) {
          const x = cx - (w - 6) / 2 + i * ((w - 6) / 8);
          b.sphere(rnd.range(0.24, 0.4), x, 0.5, z + rnd.range(-0.6, 0.6), rnd.pick([0x4a6a3a, 0x5a7a42, 0x3a5a30]), true);
        }
        if (r % 2 === 0) {
          for (let i = 0; i < 4; i++) {
            const x = cx - 3 + i * 2;
            b.rod(x, 0.3, z - 0.8, x + 0.4, 2.2, z, 0.03, 0x9a8a6a);
            b.rod(x + 0.8, 0.3, z + 0.8, x + 0.4, 2.2, z, 0.03, 0x9a8a6a);
          }
        }
      }
      buildFence(b, lot, 'picket', 0xa89878, rnd);
      addLotSign(out, ctx, lot, era, cx, cz - d / 2 + 1.2, 'painted');

      /* A fresh mound and a spade by the sapling. This is where the tin box
         goes in, and it is the first bead of the longest thread in the game. */
      const mx = cx - w * 0.28 + 1.6, mz = cz - d * 0.3 + 1.2;
      b.sphere(0.72, mx, 0.02, mz, 0x5a4630, true);
      b.cylOn(0.035, 1.15, mx + 0.7, 0.1, mz + 0.2, 0x8a7a5a, { z: 0.32 }, 6);
      b.box(0.2, 0.28, 0.04, mx + 1.05, 0.16, mz + 0.2, 0x6a6a70, { z: 0.32 });
      b.box(0.22, 0.14, 0.16, mx - 0.2, 0.4, mz + 0.35, 0x8a8478);
      out.interactables.push({
        id: 'secret:capsule', secret: true,
        pos: new THREE.Vector3(mx, 0.6, mz + 1.2), radius: 2.6,
        title: 'A fresh mound of earth', sub: 'Look closer', kind: 'secret',
        body: [
          { type: 'p', text: 'Somebody has been digging by the sapling. A biscuit tin sits on the grass beside the hole, lid off, half packed.', lede: true },
          { type: 'p', text: 'A ration book. A photograph of eleven people outside a theatre. A bus ticket. A folded page of newsprint with the date circled twice.' },
          { type: 'quote', text: '“For whoever digs here next. It was a good street. Look after the tree. — the neighbours of 55 Fifth, September 1945”' },
        ],
        foot: 'The victory garden · 1945',
      });
      break;
    }
    case 'gasStation': {
      // Canopy on two columns, two pumps, a small kiosk.
      const kx = cx + w * 0.22, kz = cz + d * 0.2;
      b.boxOn(6.5, 3.2, 5.0, kx, 0, kz, lot.canopy ?? 0xe8e4d8);
      b.box(7.0, 0.4, 5.4, kx, 3.4, kz, lot.canopyTrim ?? 0xe8663a);
      b.box(5.4, 1.6, 0.1, kx, 1.8, kz - 2.55, 0x2a3a44);
      b.box(4.6, 5.6, 0.34, cx - w * 0.1, 5.0, cz - d * 0.1, lot.canopy ?? 0xe8e4d8);
      const canopyY = 4.8;
      b.box(9.0, 0.5, 7.0, cx - w * 0.1, canopyY, cz - d * 0.08, lot.canopy ?? 0xe8e4d8);
      b.box(9.2, 0.34, 7.2, cx - w * 0.1, canopyY - 0.34, cz - d * 0.08, lot.canopyTrim ?? 0xe8663a);
      for (const s of [-1, 1]) {
        b.cylOn(0.26, canopyY - 0.4, cx - w * 0.1 + s * 3.4, 0, cz - d * 0.08, 0xe8e4d8, null, 10);
      }
      emit.box(8.0, 0.12, 6.0, cx - w * 0.1, canopyY - 0.56, cz - d * 0.08, 0xfff0d0);
      out.lights.push({ pos: new THREE.Vector3(cx - w * 0.1, canopyY - 0.8, cz - d * 0.08), color: 0xfff0d0, intensity: 32.0, distance: 18, key: 'gas' });
      for (let p = 0; p < (lot.pumps || 2); p++) {
        const px = cx - w * 0.1 + (p - 0.5) * 3.0, pz = cz - d * 0.08;
        b.boxOn(0.7, 1.5, 0.5, px, 0.3, pz, lot.pumpColor ?? 0xd83a3a);
        b.boxOn(1.0, 0.3, 0.8, px, 0, pz, 0xb0aca0);
        b.box(0.5, 0.34, 0.06, px, 1.5, pz + 0.28, 0xe8e4d8);
        b.rod(px + 0.3, 1.4, pz, px + 0.62, 0.9, pz + 0.3, 0.045, 0x2a2a2e);
      }
      addLotSign(out, ctx, lot, era, cx - w * 0.32, cz - d * 0.36, 'plastic', 4.5);
      break;
    }
    case 'parking': {
      buildFence(b, lot, 'chainlink', 0x8a8a8a, rnd);
      // Faded bay markings + a few parked cars are added by the vehicle system.
      for (let i = 0; i < 6; i++) {
        b.box(0.14, 0.02, 4.6, cx - w / 2 + 2.6 + i * 2.7, 0.05, cz + d * 0.1, 0xd8d4c0);
      }
      for (let i = 0; i < 3; i++) {
        b.boxOn(1.1, 1.2, 1.1, cx + w * 0.3 + rnd.range(-1, 1), 0.03, cz - d * 0.36 + i * 1.4, 0x2a3a2e);
      }
      addLotSign(out, ctx, lot, era, cx - w * 0.36, cz + d * 0.42, 'handpainted', 2.6);
      break;
    }
    case 'construction': {
      buildHoarding(b, out, ctx, lot, era, rnd);
      // Excavation pit, spoil heaps, a crane.
      b.box(w - 6, 0.1, d - 8, cx, -1.4, cz, 0x5a4a3a);
      for (let i = 0; i < 5; i++) {
        b.cone(rnd.range(1.2, 2.4), rnd.range(1.0, 2.0), cx + rnd.range(-w / 3, w / 3), 0.6, cz + rnd.range(-d / 3, d / 3), 0x6a5a45);
      }
      if (lot.crane) {
        const kx = cx + w * 0.22, kz = cz + d * 0.1;
        for (let s = 0; s < 14; s++) {
          const y = s * 2.4;
          b.box(1.5, 0.16, 1.5, kx, y, kz, 0xe8c040);
          for (const [ox, oz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
            b.rod(kx + ox, y, kz + oz, kx + ox, y + 2.4, kz + oz, 0.07, 0xe8c040);
          }
        }
        b.box(22, 0.7, 0.9, kx + 7, 34.5, kz, 0xe8c040);
        b.box(7, 0.6, 0.8, kx - 4, 34.5, kz, 0xe8c040);
        b.boxOn(1.6, 1.6, 1.8, kx, 33.4, kz, 0xd8d4c8);
        b.rod(kx + 13, 34.2, kz, kx + 13, 12, kz, 0.03, 0x3a3a3a);
        b.boxOn(1.0, 1.0, 1.0, kx + 13, 11, kz, 0x8a4a2a);
        out.animated.push({ kind: 'crane', pos: new THREE.Vector3(kx, 34.5, kz) });
      }
      for (let i = 0; i < 8; i++) {
        b.cone(0.28, 0.7, cx + rnd.range(-w / 2 + 2, w / 2 - 2), 0.35, cz + rnd.range(-d / 2 + 2, d / 2 - 2), 0xe8663a);
      }
      break;
    }
    case 'pocketPark': {
      // Paving, benches, planters, a little free library and the new tree.
      for (let i = 0; i < (lot.benches || 3); i++) {
        const a = i * 2.1;
        const bx = cx + Math.cos(a) * w * 0.22, bz = cz + Math.sin(a) * d * 0.2;
        buildBench(b, bx, bz, a, 0x6a5a3a, 0x3a3a3e);
      }
      for (let i = 0; i < 7; i++) {
        const px = cx + rnd.range(-w / 2 + 2, w / 2 - 2), pz = cz + rnd.range(-d / 2 + 2, d / 2 - 2);
        b.boxOn(1.2, 0.62, 1.2, px, 0.02, pz, 0x6a5a48);
        for (let k = 0; k < 5; k++) b.sphere(rnd.range(0.18, 0.32), px + rnd.range(-0.4, 0.4), 0.78, pz + rnd.range(-0.4, 0.4), rnd.pick([0x4a8a4a, 0x6aaa5a, 0xc8a83a]), true);
      }
      if (lot.library) {
        const lx = cx - w * 0.3, lz = cz + d * 0.32;
        b.cylOn(0.06, 1.1, lx, 0.02, lz, 0x5a4a3a, null, 6);
        b.boxOn(0.62, 0.5, 0.42, lx, 1.1, lz, 0x8a5a3a);
        b.box(0.7, 0.1, 0.5, lx, 1.65, lz, 0x6a4a2a, { x: 0.2 });
        b.box(0.5, 0.36, 0.03, lx, 1.34, lz + 0.22, 0xd8e0e8);
        out.interactables.push({
          id: 'secret:library', secret: true,
          pos: new THREE.Vector3(lx, 1.2, lz), radius: 2.0,
          title: 'Little free library', sub: 'Take one, leave one', kind: 'secret',
          body: [
            { type: 'p', text: 'Four paperbacks, a road atlas from 1998, and a spiral notebook somebody has been using as a guestbook since the park opened.' },
            { type: 'quote', text: '“Mum used to buy apples on this corner. There was a green awning. — R.M., 2023”' },
            { type: 'quote', text: '“I proposed here in 1966 when it was a gas station. She said yes anyway. — A.” ' },
          ],
          foot: 'Vine Street Pocket Park · 2025',
        });
      }
      if (lot.mural) buildLotMural(out, ctx, lot, era, cx, cz, w, d);
      addLotSign(out, ctx, lot, era, cx + w * 0.3, cz + d * 0.42, 'minimal', 1.9);
      break;
    }
    case 'grove': {
      for (let i = 0; i < (lot.benches || 4); i++) {
        const a = i * 1.6 + 0.4;
        buildBench(b, cx + Math.cos(a) * w * 0.26, cz + Math.sin(a) * d * 0.22, a, 0x3a4a44, 0x56d0e0, emit);
      }
      if (lot.mistArch) {
        const ax = cx + w * 0.3, az = cz + d * 0.3;
        for (const s of [-1, 1]) b.cylOn(0.12, 3.2, ax + s * 1.6, 0, az, 0xa8b0ac, null, 8);
        b.box(3.6, 0.2, 0.3, ax, 3.3, az, 0xa8b0ac);
        emit.box(3.2, 0.06, 0.12, ax, 3.16, az, 0x56d0e0);
        out.animated.push({ kind: 'mist', pos: new THREE.Vector3(ax, 3.1, az) });
      }
      for (let i = 0; i < 10; i++) {
        const px = cx + rnd.range(-w / 2 + 2, w / 2 - 2), pz = cz + rnd.range(-d / 2 + 2, d / 2 - 2);
        b.cylOn(0.5, 0.7, px, 0.02, pz, 0x3a4a44, null, 10);
        for (let k = 0; k < 6; k++) b.sphere(rnd.range(0.2, 0.36), px + rnd.range(-0.4, 0.4), 0.9, pz + rnd.range(-0.4, 0.4), rnd.pick(era.palette.bio), true);
      }
      addLotSign(out, ctx, lot, era, cx + w * 0.26, cz + d * 0.42, 'eInk', 1.9);
      break;
    }
    default: break;
  }

  const m = b.mesh(mats.vcol('matte'), { name: 'openlot' });
  if (m) out.group.add(m);
  const em = emit.mesh(mats.emitVcol({ strength: 2.4 }), { cast: false });
  if (em) out.group.add(em);
}

function buildTree(b, tree, x, y, z, era, rnd, out, eraIdx) {
  const { h, r, kind } = tree;
  const bark = eraIdx >= 4 ? 0x5a4a3a : 0x4a3a2c;
  if (kind === 'stump') {
    b.taper(0.42, 0.55, h, x, y, z, bark, 10);
    b.cyl(0.44, 0.06, x, y + h, z, 0xc8b090, null, 10);
    out.interactables.push({
      id: 'secret:stump', secret: true,
      pos: new THREE.Vector3(x, 0.6, z), radius: 2.4,
      title: 'A cut stump', sub: 'Count the rings', kind: 'secret',
      body: [
        { type: 'p', text: 'Forty-one rings, if you are patient and the light is right. Planted 1945, cut 1978 — for two extra parking spaces, and one of them is still empty.' },
        { type: 'p', text: 'Somebody has scratched a date into the cut face with a key. It is not the date the tree died.' },
      ],
      foot: 'The corner lot · 1985',
    });
    return;
  }

  const trunkH = h * (kind === 'ancient' ? 0.42 : kind === 'sapling' ? 0.62 : 0.5);
  b.taper(kind === 'ancient' ? 0.55 : 0.14, kind === 'ancient' ? 1.0 : 0.24, trunkH, x, y, z, bark, kind === 'ancient' ? 14 : 8);

  // Branches: a small L-system, two levels.
  const branches = kind === 'sapling' ? 4 : kind === 'ancient' ? 9 : 6;
  const canopy = [];
  for (let i = 0; i < branches; i++) {
    const a = (i / branches) * Math.PI * 2 + rnd.range(-0.3, 0.3);
    const spread = r * rnd.range(0.5, 0.9);
    const bx = x + Math.cos(a) * spread, bz = z + Math.sin(a) * spread;
    const by = y + trunkH + (h - trunkH) * rnd.range(0.3, 0.7);
    b.rod(x, y + trunkH * 0.85, z, bx, by, bz, kind === 'ancient' ? 0.16 : 0.075, bark);
    canopy.push([bx, by, bz, spread]);
    if (kind !== 'sapling') {
      for (let k = 0; k < 2; k++) {
        const a2 = a + rnd.range(-0.9, 0.9);
        const s2 = spread * rnd.range(0.4, 0.8);
        const cx2 = bx + Math.cos(a2) * s2, cz2 = bz + Math.sin(a2) * s2;
        const cy2 = by + rnd.range(0.4, 1.6);
        b.rod(bx, by, bz, cx2, cy2, cz2, 0.05, bark);
        canopy.push([cx2, cy2, cz2, s2 * 0.7]);
      }
    }
  }

  const leafCols = era.year >= 2055 ? [0x3a7a4a, 0x4a8a52, 0x2a6a3a]
    : era.year === 1945 ? [0x7a7a3a, 0x8a7a32, 0x6a6a2a]   // autumn
    : era.year === 2025 ? [0x4a7a3a, 0x5a8a42, 0x3a6a30]
    : [0x4a7a3a, 0x3a6a34];
  const blobs = kind === 'sapling' ? 12 : kind === 'ancient' ? 90 : 42;
  for (let i = 0; i < blobs; i++) {
    const c = canopy[rnd.int(0, canopy.length - 1)] || [x, y + trunkH, z, r * 0.4];
    const rr = r * rnd.range(0.18, 0.34);
    b.sphere(rr, c[0] + rnd.range(-c[3], c[3]) * 0.5, c[1] + rnd.range(-0.4, 1.4), c[2] + rnd.range(-c[3], c[3]) * 0.5, rnd.pick(leafCols), true);
  }

  // Tree pit + guard for the younger ones
  b.cyl(kind === 'ancient' ? 2.6 : 1.1, 0.1, x, y + 0.06, z, 0x4a3a2a, null, 12);
  if (kind === 'sapling' || kind === 'young') {
    for (const s of [-1, 1]) {
      b.rod(x + s * 0.5, y, z, x + s * 0.5, y + 1.8, z, 0.035, 0x8a7a5a);
      b.rod(x + s * 0.5, y + 1.5, z, x, y + 1.5, z, 0.012, 0xd8d0b0);
    }
  }

  if (kind === 'ancient') {
    out.interactables.push({
      id: 'secret:tree', secret: true,
      pos: new THREE.Vector3(x, 1.4, z + 2.0), radius: 3.4,
      title: 'Protected Tree No. 0114', sub: 'Read the plaque', kind: 'secret',
      body: [
        { type: 'sign', text: 'PROTECTED TREE No. 0114\nPLANTED 1945 · CUT 1978\nREPLANTED 2021' },
        { type: 'p', text: 'Two trees share one number. The paperwork treats them as the same tree, which is legally untidy and, everyone involved agrees, correct.' },
        { type: 'p', text: 'Roots have lifted the paving on the Fifth Street side. The Trust has decided the paving can move.' },
      ],
      foot: 'The Grove · 2055',
    });
  }
}

function buildBench(b, x, z, angle, wood, metal, emit = null) {
  const rot = { y: angle };
  b.box(1.9, 0.09, 0.5, x, 0.44, z, wood, rot);
  b.box(1.9, 0.44, 0.08, x - Math.sin(angle) * 0.24, 0.7, z - Math.cos(angle) * 0.24, wood, rot);
  for (const s of [-1, 1]) {
    const ox = Math.cos(angle) * s * 0.8, oz = -Math.sin(angle) * s * 0.8;
    b.box(0.08, 0.44, 0.46, x + ox, 0.22, z + oz, metal, rot);
  }
  if (emit) emit.box(1.7, 0.04, 0.06, x, 0.38, z + 0.24, 0x56d0e0, rot);
}

function buildFence(b, lot, kind, color, rnd) {
  const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
  const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
  const sides = [
    { x: cx, z: lot.z1, len: w, rot: 0 },
    { x: lot.x0, z: cz, len: d, rot: Math.PI / 2 },
  ];
  for (const s of sides) {
    if (kind === 'picket') {
      const n = Math.round(s.len / 0.3);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5;
        const px = s.x + Math.cos(s.rot) * t * s.len;
        const pz = s.z - Math.sin(s.rot) * t * s.len;
        b.boxOn(0.09, 1.05 + (i % 3 === 0 ? 0.1 : 0), 0.03, px, 0, pz, color, { y: s.rot });
      }
      for (const h of [0.35, 0.85]) b.box(s.len, 0.06, 0.04, s.x, h, s.z, color, { y: s.rot });
    } else {
      const posts = Math.round(s.len / 3);
      for (let i = 0; i <= posts; i++) {
        const t = i / posts - 0.5;
        b.cylOn(0.045, 2.2, s.x + Math.cos(s.rot) * t * s.len, 0, s.z - Math.sin(s.rot) * t * s.len, color, null, 6);
      }
      b.box(s.len, 0.045, 0.045, s.x, 2.15, s.z, color, { y: s.rot });
      b.box(s.len, 0.045, 0.045, s.x, 0.1, s.z, color, { y: s.rot });
      // Mesh suggested by a sparse diagonal lattice — cheaper than real chain link.
      const n = Math.round(s.len / 0.5);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5;
        const px = s.x + Math.cos(s.rot) * t * s.len, pz = s.z - Math.sin(s.rot) * t * s.len;
        b.box(0.02, 2.9, 0.02, px, 1.1, pz, color, { y: s.rot, z: 0.72 });
        b.box(0.02, 2.9, 0.02, px, 1.1, pz, color, { y: s.rot, z: -0.72 });
      }
    }
  }
}

function buildHoarding(b, out, ctx, lot, era, rnd) {
  const { mats } = ctx;
  const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
  const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
  const H = 3.2;
  const sides = [
    { x: cx, z: lot.z1, len: w, rot: 0 },
    { x: lot.x0, z: cz, len: d, rot: -Math.PI / 2 },
  ];
  for (const s of sides) {
    b.box(s.len, H, 0.14, s.x, H / 2, s.z, lot.hoarding ?? 0x2a4a6a, { y: s.rot });
    b.box(s.len, 0.2, 0.24, s.x, H, s.z, 0xd8d8d4, { y: s.rot });
    const posts = Math.round(s.len / 2.4);
    for (let i = 0; i <= posts; i++) {
      const t = i / posts - 0.5;
      b.boxOn(0.14, H, 0.3, s.x + Math.cos(s.rot) * t * s.len, 0, s.z + Math.sin(s.rot) * t * s.len, 0x6a5a44, { y: s.rot });
    }
  }
  // Developer rendering pasted along the front
  const c = billboardTexture(lot.hoardingText || 'COMING SOON', {
    w: 1024, h: 384, tone: 'digital', bg: 0x2a4a6a, accent: 0x8aa8c8, seed: 'hoard',
  });
  const m = quad(Math.min(w * 0.7, 12), Math.min(w * 0.7, 12) * 384 / 1024, 0, 0, 0, mats.printed(toTexture(c, { clamp: true })));
  m.position.set(cx, 1.9, lot.z1 + 0.09);
  out.group.add(m);
  out.interactables.push({
    id: `hoarding:${era.year}`,
    pos: new THREE.Vector3(cx, 1.6, lot.z1 + 2.0), radius: 3.6,
    title: 'Site hoarding', sub: lot.hoardingText || '', kind: 'read',
    body: [
      { type: 'sign', text: lot.hoardingText || '' },
      { type: 'p', text: lot.story || '' },
    ],
    foot: `55 Fifth · ${era.year}`,
  });
}

function addLotSign(out, ctx, lot, era, x, z, style, h = 2.2) {
  const { mats } = ctx;
  if (!lot.sign) return;
  const c = signTexture({
    text: lot.sign.split('·')[0].trim(), sub: (lot.sign.split('·')[1] || '').trim(),
    style, fg: style === 'eInk' ? 0x1a2a24 : 0xffffff,
    bg: style === 'minimal' ? 0x2a2a2e : 0x1a2a3a, accent: 0xd8b04a,
    w: 512, h: 200, seed: lot.id + era.year,
  });
  const post = new THREE.Group();
  const b = new Bucket();
  b.cylOn(0.05, h, 0, 0, 0, 0x4a4a4e, null, 6);
  const pm = b.mesh(mats.vcol('matte'));
  if (pm) post.add(pm);
  const face = quad(1.5, 0.6, 0, h, 0.04, mats.printed(toTexture(c, { clamp: true }), { double: true }));
  post.add(face);
  post.position.set(x, 0, z);
  post.rotation.y = Math.PI * 0.15;
  out.group.add(post);
  out.interactables.push({
    id: `lotsign:${era.year}`, pos: new THREE.Vector3(x, h, z), radius: 2.4,
    title: lot.label, sub: 'Read the sign', kind: 'read', place: 'lot',
    body: [
      { type: 'sign', text: lot.sign },
      { type: 'p', text: lot.story || '', lede: true },
    ],
    foot: `55 Fifth · ${era.year}`,
  });
}

function buildLotMural(out, ctx, lot, era, cx, cz, w, d) {
  const { mats } = ctx;
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  const pal = era.palette.mural || [0xe8663a, 0x2ea8b4, 0xe8c040, 0x7fd6a0, 0xb44dff];
  g.fillStyle = '#20242a'; g.fillRect(0, 0, 1024, 512);
  const years = ['1945', '1965', '1985', '2005', '2025'];
  for (let i = 0; i < 5; i++) {
    g.fillStyle = `#${pal[i % pal.length].toString(16).padStart(6, '0')}`;
    g.globalAlpha = 0.85;
    g.fillRect(i * 204.8, 512 - (i + 2) * 56, 204.8, (i + 2) * 56);
    g.globalAlpha = 1;
    g.fillStyle = '#0e1014';
    g.font = 'bold 30px Impact, sans-serif'; g.textAlign = 'center';
    g.fillText(years[i], i * 204.8 + 102, 512 - 18);
  }
  g.fillStyle = '#f0ece0';
  g.font = 'bold 52px Impact, sans-serif';
  g.fillText(lot.muralText || 'THE CORNER', 512, 70);
  const m = quad(Math.min(d * 0.8, 14), Math.min(d * 0.8, 14) * 0.5, 0, 0, 0, mats.printed(toTexture(c, { clamp: true })));
  m.position.set(lot.x1 - 0.08, 4.0, cz);
  m.rotation.y = -Math.PI / 2;
  out.group.add(m);
  out.interactables.push({
    id: 'mural:lot:2025', pos: new THREE.Vector3(lot.x1 - 2.4, 2.0, cz), radius: 4.0,
    title: 'Corner mural', sub: 'Five decades, five colours', kind: 'read',
    body: [{ type: 'p', text: 'Each band is one era of this lot, and each is as tall as the thing that stood here: cabbages, then a canopy, then nothing but asphalt, then a hoarding, then this.' }],
    foot: 'Vine Street Pocket Park · 2025',
  });
}
