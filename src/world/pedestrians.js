/**
 * Crowd.
 *
 * Pedestrians are the cheapest era signal per polygon in the whole scene — a
 * silhouette with a hat reads as 1945 from forty metres, and the same
 * silhouette in a windbreaker with a boombox reads as 1985. So the wardrobe is
 * data-driven from the era table and the bodies themselves are deliberately
 * simple.
 *
 * Performance: one `InstancedMesh` per body part rather than one Group per
 * person. Forty animated pedestrians cost about fifteen draw calls instead of
 * four hundred. Limb angles are recomputed on the CPU each frame and written
 * straight into the instance matrices — for this crowd size that is far cheaper
 * than a skinning setup, and it keeps every behaviour readable in plain JS.
 */

import * as THREE from 'three';
import { Bucket } from './geom.js';
import { Rand } from '../core/rng.js';
import { clamp, clamp01, lerp, damp, dampAngle, angleDelta, TAU } from '../core/mathx.js';
import { BLOCK } from '../data/eras.js';
import { makeRing, ringAt } from './vehicles.js';

const CURB = BLOCK.half + BLOCK.sidewalk;
const ROADOUT = CURB + BLOCK.road;

/* ══════════════════════════ part geometry ══════════════════════════ */
/* Every part's origin sits at the joint it rotates about, so the animation is
   a plain rotation with no offset bookkeeping. */

function partGeometries() {
  const mk = (fn) => { const b = new Bucket(); fn(b); return b.build(); };

  return {
    torso: mk((b) => {
      b.box(0.40, 0.58, 0.23, 0, 0.29, 0, 0xffffff);           // coat
      b.box(0.44, 0.10, 0.25, 0, 0.55, 0, 0xf0f0f0);           // shoulders
      b.box(0.15, 0.26, 0.20, 0, 0.44, 0.03, 0xd8d8d8);        // shirt front / lapel gap
    }),
    hips: mk((b) => b.box(0.36, 0.18, 0.22, 0, -0.09, 0, 0xffffff)),
    head: mk((b) => {
      b.box(0.19, 0.23, 0.21, 0, 0.13, 0, 0xffffff);
      b.box(0.09, 0.09, 0.03, 0, 0.13, 0.11, 0xf4f4f4);        // face plane catches light
      b.box(0.055, 0.05, 0.05, -0.10, 0.14, 0.02, 0xf0f0f0);   // ears
      b.box(0.055, 0.05, 0.05, 0.10, 0.14, 0.02, 0xf0f0f0);
      b.box(0.11, 0.12, 0.11, 0, -0.02, 0, 0xf8f8f8);          // neck
    }),
    hair: mk((b) => {
      b.box(0.205, 0.13, 0.225, 0, 0.185, -0.005, 0xffffff);
      b.box(0.19, 0.06, 0.06, 0, 0.13, -0.10, 0xffffff);
    }),
    hairLong: mk((b) => {
      b.box(0.215, 0.15, 0.235, 0, 0.185, -0.005, 0xffffff);
      b.box(0.22, 0.26, 0.10, 0, 0.06, -0.10, 0xffffff);
    }),
    arm: mk((b) => {
      b.box(0.105, 0.30, 0.115, 0, -0.15, 0, 0xffffff);        // upper
      b.box(0.095, 0.26, 0.105, 0, -0.43, 0, 0xf4f4f4);        // fore
      b.box(0.085, 0.09, 0.09, 0, -0.60, 0, 0xe8e8e8);         // hand
    }),
    thigh: mk((b) => b.box(0.145, 0.42, 0.155, 0, -0.21, 0, 0xffffff)),
    shin: mk((b) => {
      b.box(0.125, 0.42, 0.135, 0, -0.21, 0, 0xffffff);
      b.box(0.13, 0.075, 0.26, 0, -0.44, 0.045, 0x8a8a8a);     // shoe
    }),
    skirt: mk((b) => {
      b.push(new THREE.CylinderGeometry(0.19, 0.34, 0.46, 10, 1), new THREE.Matrix4().makeTranslation(0, -0.23, 0), 0xffffff);
    }),
    /* Hats — one mesh per silhouette; unused ones are scaled to nothing. */
    fedora: mk((b) => {
      b.cyl(0.115, 0.13, 0, 0.065, 0, 0xffffff, null, 12);
      b.cyl(0.21, 0.022, 0, 0.005, -0.005, 0xffffff, null, 14);
      b.box(0.24, 0.03, 0.24, 0, 0.03, 0, 0xd0d0d0);
    }),
    flatcap: mk((b) => {
      b.cyl(0.115, 0.075, 0, 0.038, -0.01, 0xffffff, null, 12);
      b.box(0.20, 0.025, 0.13, 0, 0.02, 0.10, 0xffffff);
    }),
    ladyhat: mk((b) => {
      b.cyl(0.09, 0.08, 0, 0.05, -0.02, 0xffffff, null, 12);
      b.cyl(0.175, 0.02, 0, 0.015, -0.02, 0xffffff, null, 14);
      b.sphere(0.035, 0.06, 0.055, -0.08, 0xe8e8e8, true);
    }),
    cap: mk((b) => {
      b.cyl(0.112, 0.085, 0, 0.042, 0, 0xffffff, null, 12);
      b.box(0.19, 0.022, 0.12, 0, 0.012, 0.115, 0xffffff);
    }),
    beanie: mk((b) => {
      b.cyl(0.115, 0.115, 0, 0.055, 0, 0xffffff, null, 12);
      b.sphere(0.032, 0, 0.125, 0, 0xf0f0f0, true);
    }),
    pillbox: mk((b) => b.cyl(0.115, 0.09, 0, 0.05, 0, 0xffffff, null, 12)),
    garrison: mk((b) => {
      b.box(0.20, 0.10, 0.15, 0, 0.045, 0, 0xffffff);
      b.box(0.05, 0.12, 0.155, 0, 0.055, 0, 0xf0f0f0);
    }),
    visor: mk((b) => {
      b.box(0.21, 0.055, 0.02, 0, 0.02, 0.105, 0xffffff);
      b.box(0.045, 0.05, 0.16, -0.10, 0.02, 0.03, 0xe0e0e0);
      b.box(0.045, 0.05, 0.16, 0.10, 0.02, 0.03, 0xe0e0e0);
    }),
    hood: mk((b) => {
      b.box(0.24, 0.20, 0.26, 0, 0.10, -0.03, 0xffffff);
      b.box(0.20, 0.14, 0.05, 0, 0.06, -0.16, 0xf0f0f0);
    }),
    bucket: mk((b) => {
      b.cyl(0.115, 0.10, 0, 0.05, 0, 0xffffff, null, 12);
      b.cyl(0.175, 0.03, 0, 0.005, 0, 0xffffff, null, 14);
    }),
    /* Held / carried things */
    carry: mk((b) => b.box(0.28, 0.24, 0.11, 0, 0, 0, 0xffffff)),        // case / bag
    boombox: mk((b) => {
      b.box(0.52, 0.24, 0.14, 0, 0, 0, 0xffffff);
      b.cyl(0.085, 0.03, -0.15, 0, 0.08, 0x2a2a2e, { x: Math.PI / 2 }, 10);
      b.cyl(0.085, 0.03, 0.15, 0, 0.08, 0x2a2a2e, { x: Math.PI / 2 }, 10);
    }),
    backpack: mk((b) => b.box(0.28, 0.36, 0.16, 0, 0, 0, 0xffffff)),
    dog: mk((b) => {
      b.box(0.14, 0.16, 0.36, 0, 0.26, 0, 0xffffff);
      b.box(0.10, 0.12, 0.13, 0, 0.32, 0.22, 0xf0f0f0);
      b.box(0.045, 0.24, 0.045, -0.05, 0.12, 0.13, 0xffffff);
      b.box(0.045, 0.24, 0.045, 0.05, 0.12, 0.13, 0xffffff);
      b.box(0.045, 0.24, 0.045, -0.05, 0.12, -0.13, 0xffffff);
      b.box(0.045, 0.24, 0.045, 0.05, 0.12, -0.13, 0xffffff);
      b.box(0.04, 0.14, 0.04, 0, 0.34, -0.19, 0xf0f0f0, { x: -0.7 });
    }),
    board: mk((b) => {
      b.box(0.20, 0.035, 0.78, 0, 0, 0, 0xffffff);
      b.cyl(0.035, 0.05, -0.07, -0.05, 0.26, 0x2a2a2e, { z: Math.PI / 2 }, 8);
      b.cyl(0.035, 0.05, 0.07, -0.05, 0.26, 0x2a2a2e, { z: Math.PI / 2 }, 8);
      b.cyl(0.035, 0.05, -0.07, -0.05, -0.26, 0x2a2a2e, { z: Math.PI / 2 }, 8);
      b.cyl(0.035, 0.05, 0.07, -0.05, -0.26, 0x2a2a2e, { z: Math.PI / 2 }, 8);
    }),
    petdrone: mk((b) => {
      b.sphere(0.10, 0, 0, 0, 0xffffff, true);
      b.cyl(0.13, 0.012, 0, 0.09, 0, 0xd8dcd8, null, 10);
    }),
    /* Glowing trim (2055 garments, AR visors, earbud LEDs) */
    trim: mk((b) => {
      b.box(0.42, 0.022, 0.245, 0, 0.30, 0, 0xffffff);
      b.box(0.022, 0.30, 0.245, 0.20, 0.42, 0, 0xffffff);
    }),
  };
}

const HAT_PARTS = ['fedora', 'flatcap', 'ladyhat', 'cap', 'beanie', 'pillbox', 'garrison', 'visor', 'hood', 'bucket'];
const CARRY_PARTS = ['carry', 'boombox', 'backpack', 'dog', 'board', 'petdrone'];

const ACCESSORY_TO_PART = {
  briefcase: 'carry', shoppingbag: 'carry', newspaper: 'carry', umbrella: 'carry',
  boombox: 'boombox', walkman: null, transistor: 'carry', camera: 'carry',
  skateboard: 'board', flipphone: null, ipod: null, coffee: null, backpack: 'backpack',
  rollbag: 'carry', phone: null, totebag: 'carry', earbuds: null, deliverybag: 'backpack',
  dog: 'dog', arvisor: null, filtermask: null, petdrone: 'petdrone', satchel: 'carry',
  'cane-exo': 'carry', none: null,
};

/* ══════════════════════════ crowd ══════════════════════════ */

export class Crowd {
  constructor(scene, mats, maxCount = 56) {
    this.scene = scene;
    this.mats = mats;
    this.max = maxCount;
    this.group = new THREE.Group();
    this.group.name = 'crowd';
    scene.add(this.group);

    this.geo = partGeometries();
    this.meshes = {};
    this.people = [];
    this.era = null;

    const bodyMat = mats.character();
    const emitMat = mats.emitVcol({ strength: 2.0 });

    for (const key of Object.keys(this.geo)) {
      const g = this.geo[key];
      if (!g) continue;
      const m = new THREE.InstancedMesh(g, key === 'trim' ? emitMat : bodyMat, maxCount);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = key !== 'trim';
      m.receiveShadow = false;
      m.frustumCulled = false;
      m.count = 0;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxCount * 3).fill(1), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.meshes[key] = m;
      this.group.add(m);
    }

    /* Walking surfaces */
    this.rings = [
      makeRing(BLOCK.half + BLOCK.sidewalk * 0.5, +1, 5.0),    // block-side sidewalk
      makeRing(ROADOUT + BLOCK.farWalk * 0.5, -1, 8.0),        // far sidewalk
    ];
    this.crossings = [
      { ax: true, x: 0, z: -(CURB + BLOCK.road / 2), a: -CURB, b: -ROADOUT },
      { ax: true, x: 0, z: (CURB + BLOCK.road / 2), a: CURB, b: ROADOUT },
      { ax: false, x: -(CURB + BLOCK.road / 2), z: 0, a: -CURB, b: -ROADOUT },
      { ax: false, x: (CURB + BLOCK.road / 2), z: 0, a: CURB, b: ROADOUT },
    ];

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  populate(era, eraIdx, densityScale = 1) {
    this.era = era;
    this.eraIdx = eraIdx;
    const rnd = new Rand(`crowd:${era.year}`);
    const w = era.peds;
    const n = Math.min(this.max, Math.round(34 * w.density * densityScale));
    this.people.length = 0;

    for (let i = 0; i < n; i++) {
      const dress = rnd.chance(eraIdx <= 1 ? 0.42 : 0.24);
      const uniform = rnd.chance(w.uniforms || 0);
      const acc = rnd.pick(w.accessories);
      const hatKind = rnd.chance(w.hats) ? rnd.pick(w.hatKinds) : null;
      const long = dress || rnd.chance(0.3);

      const coat = uniform ? rnd.pick([0x3d4a35, 0xf0ece0, 0x2a3a4a]) : rnd.pick(w.coats);
      const person = {
        i,
        mode: rnd.chance(0.24) ? 'cross' : 'ring',
        ring: rnd.chance(0.55) ? 0 : 1,
        s: rnd.range(0, 1),
        dir: rnd.chance(0.5) ? 1 : -1,
        lateral: rnd.range(-1.25, 1.25),
        speed: w.speed * rnd.range(0.78, 1.22),
        cur: 0,
        phase: rnd.range(0, TAU),
        height: rnd.range(0.9, 1.08) * (dress ? 0.99 : 1),
        heading: 0, targetHeading: 0,
        state: 'walk', stateT: rnd.range(2, 22),
        crossing: rnd.int(0, 3), crossT: rnd.f(), crossDir: rnd.chance(0.5) ? 1 : -1,
        dress, uniform, acc, hatKind, long,
        col: {
          coat, shirt: rnd.pick(w.shirts), trouser: dress ? coat : rnd.pick(w.trousers),
          skin: rnd.pick(w.skin), hair: rnd.pick(w.hair),
          hat: hatKind === 'garrison' ? 0x3d4a35 : rnd.chance(0.5) ? rnd.pick(w.coats) : rnd.pick(w.trousers),
          carry: rnd.pick([0x3a2a20, 0x2a2a2e, 0x8a6a4a, 0xd8d4c8, 0x6a2a2a]),
        },
        emissive: (w.emissive || 0) > 0 && rnd.chance(w.emissive * 2),
        chatPartner: -1,
      };
      person.heading = person.targetHeading = 0;
      this.people.push(person);
    }

    // Pair a few people up for conversations.
    for (let i = 0; i + 1 < this.people.length; i += 7) {
      const a = this.people[i], b = this.people[i + 1];
      if (a.mode === 'ring' && b.mode === 'ring') {
        b.ring = a.ring; b.s = a.s; b.dir = a.dir;
        b.lateral = a.lateral + 0.8;
        a.state = b.state = 'chat'; a.stateT = b.stateT = rnd.range(6, 20);
        a.chatPartner = b.i; b.chatPartner = a.i;
      }
    }

    for (const key in this.meshes) this.meshes[key].count = 0;
    this._writeColors();
  }

  _writeColors() {
    const set = (key, i, hex) => {
      const m = this.meshes[key];
      if (!m) return;
      this._c.set(hex);
      m.instanceColor.setXYZ(i, this._c.r, this._c.g, this._c.b);
    };
    for (const p of this.people) {
      const i = p.i;
      set('torso', i, p.col.coat);
      set('hips', i, p.col.trouser);
      set('head', i, p.col.skin);
      set('hair', i, p.col.hair);
      set('hairLong', i, p.col.hair);
      set('arm', i, p.col.coat);
      set('thigh', i, p.col.trouser);
      set('shin', i, p.col.trouser);
      set('skirt', i, p.col.coat);
      set('carry', i, p.col.carry);
      set('boombox', i, 0xc8ccd0);
      set('backpack', i, p.col.carry);
      set('dog', i, 0xb08a5a);
      set('board', i, 0xd83a5a);
      set('petdrone', i, 0xd8dcd8);
      set('trim', i, this.era?.accent2 ?? 0x56d0e0);
      for (const h of HAT_PARTS) set(h, i, p.col.hat);
    }
    // `_pose` packs instances densely (not everyone wears a hat), so the slot a
    // person occupies in a part mesh differs from their person index. Snapshot
    // the per-person colours and re-index them at write time.
    this._cacheColors();
    for (const key in this.meshes) this.meshes[key].instanceColor.needsUpdate = true;
  }

  /* ── per-frame ─────────────────────────────────────────────── */

  update(dt, signals, camPos, blockers) {
    if (!this.people.length) return;
    const counts = {};
    for (const key in this.meshes) counts[key] = 0;

    for (const p of this.people) {
      this._step(p, dt, signals, camPos);
      this._pose(p, counts);
    }

    for (const key in this.meshes) {
      const m = this.meshes[key];
      m.count = counts[key];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  _step(p, dt, signals, camPos) {
    p.stateT -= dt;

    if (p.mode === 'ring') {
      const ring = this.rings[p.ring];
      if (p.stateT <= 0) {
        // Behaviour churn: stroll, stop at a window, stand and talk.
        const r = Math.random();
        if (p.state === 'walk') {
          p.state = r < 0.45 ? 'window' : r < 0.7 ? 'chat' : 'walk';
          p.stateT = p.state === 'walk' ? 8 + Math.random() * 20 : 3 + Math.random() * 9;
        } else {
          p.state = 'walk';
          p.stateT = 8 + Math.random() * 22;
        }
      }

      const want = p.state === 'walk' ? p.speed : 0;
      p.cur = damp(p.cur, want, 3.4, dt);
      p.s += (p.cur * p.dir * dt) / ring.total;

      const q = ringAt(ring, ((p.s % 1) + 1) % 1 * ring.total);
      const nx = Math.cos(q.heading), nz = -Math.sin(q.heading);
      p.x = q.x + nx * p.lateral;
      p.z = q.z + nz * p.lateral;
      p.y = BLOCK.curbHeight;

      if (p.state === 'walk') p.targetHeading = q.heading + (p.dir > 0 ? 0 : Math.PI);
      else if (p.state === 'window') p.targetHeading = Math.atan2(-p.x, -p.z);   // face the block
      else p.targetHeading = q.heading + Math.PI / 2;
    } else {
      /* Crossing: wait at the kerb for the walk phase, then go. */
      const c = this.crossings[p.crossing];
      // A crossing with ax:true runs along z — it crosses the street carrying
      // east–west traffic, so it is walkable on the north–south green.
      const canWalk = signals ? signals.walk(!c.ax) : true;
      const atEnd = p.crossT <= 0.02 || p.crossT >= 0.98;

      if (atEnd && !canWalk) {
        p.cur = damp(p.cur, 0, 6, dt);
        p.state = 'wait';
      } else {
        p.cur = damp(p.cur, p.speed * 1.12, 4, dt);
        p.state = 'walk';
      }
      const span = Math.abs(c.b - c.a);
      p.crossT += (p.cur * p.crossDir * dt) / span;
      if (p.crossT > 1) { p.crossT = 1; p.crossDir = -1; p.stateT = 1 + Math.random() * 3; }
      if (p.crossT < 0) { p.crossT = 0; p.crossDir = 1; p.stateT = 1 + Math.random() * 3; }

      const along = lerp(c.a, c.b, p.crossT);
      if (c.ax) { p.x = c.x + p.lateral; p.z = along; p.targetHeading = p.crossDir > 0 ? Math.PI : 0; }
      else { p.x = along; p.z = c.z + p.lateral; p.targetHeading = p.crossDir > 0 ? -Math.PI / 2 : Math.PI / 2; }
      p.y = 0;
    }

    /* Give the player room — nobody walks through you. */
    if (camPos) {
      const dx = p.x - camPos.x, dz = p.z - camPos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.1 && d > 0.001) {
        const push = (1.1 - d) * 1.6;
        p.x += (dx / d) * push;
        p.z += (dz / d) * push;
      }
      // Some of them look at you as you pass.
      if (d < 4 && p.state !== 'walk') {
        p.targetHeading = Math.atan2(camPos.x - p.x, camPos.z - p.z);
      }
    }

    p.heading = dampAngle(p.heading, p.targetHeading, 7, dt);
    p.phase += p.cur * 4.6 * dt;
  }

  _pose(p, counts) {
    const h = p.height;
    const walkAmt = clamp01(p.cur / Math.max(0.4, p.speed));
    const swing = Math.sin(p.phase) * 0.62 * walkAmt;
    const swing2 = Math.sin(p.phase + Math.PI) * 0.62 * walkAmt;
    const bob = Math.abs(Math.sin(p.phase)) * 0.035 * walkAmt;
    const lean = 0.05 * walkAmt;

    const HIP = 0.90 * h, SHOULDER = 1.38 * h, NECK = 1.46 * h;
    const rootY = p.y + bob;
    const cosH = Math.cos(p.heading), sinH = Math.sin(p.heading);

    /* Place a part: local offset (right, up, fwd) rotated by heading. */
    const put = (key, ox, oy, oz, rx = 0, ry = 0, rz = 0, sc = 1) => {
      const m = this.meshes[key];
      if (!m) return;
      const idx = counts[key]++;
      if (idx >= this.max) { counts[key]--; return; }
      const wx = p.x + ox * cosH + oz * sinH;
      const wz = p.z - ox * sinH + oz * cosH;
      this._e.set(rx, p.heading + ry, rz, 'YXZ');
      this._q.setFromEuler(this._e);
      this._v.set(wx, rootY + oy, wz);
      this._s.set(sc * h, sc * h, sc * h);
      this._m.compose(this._v, this._q, this._s);
      m.setMatrixAt(idx, this._m);
      // Instance colours were written per-person index; re-point this slot.
      if (m.instanceColor) {
        const src = p.i * 3;
        m.instanceColor.array[idx * 3] = this._srcColor(key, src, 0);
        m.instanceColor.array[idx * 3 + 1] = this._srcColor(key, src, 1);
        m.instanceColor.array[idx * 3 + 2] = this._srcColor(key, src, 2);
      }
    };

    put('torso', 0, HIP, 0, lean, 0, 0);
    put('hips', 0, HIP, 0);
    put('head', 0, NECK, 0.01, -lean * 0.5);
    put(p.long ? 'hairLong' : 'hair', 0, NECK, 0.01, -lean * 0.5);
    if (p.hatKind && this.meshes[p.hatKind]) put(p.hatKind, 0, NECK + 0.24 * h, 0.005, -lean * 0.5);

    /* Arms counter-swing; a carried object locks one arm down. */
    const carries = ACCESSORY_TO_PART[p.acc];
    const armR = carries === 'carry' || carries === 'board' ? -0.15 : swing2;
    put('arm', -0.245, SHOULDER, 0, swing, 0, 0.06);
    put('arm', 0.245, SHOULDER, 0, armR, 0, -0.06);

    if (p.dress) {
      put('skirt', 0, HIP + 0.02, 0);
      put('shin', -0.105, HIP - 0.44, swing * 0.1, swing * 0.75);
      put('shin', 0.105, HIP - 0.44, swing2 * 0.1, swing2 * 0.75);
    } else {
      const kneeBendL = Math.max(0, -Math.sin(p.phase + 0.9)) * 0.85 * walkAmt;
      const kneeBendR = Math.max(0, -Math.sin(p.phase + 0.9 + Math.PI)) * 0.85 * walkAmt;
      put('thigh', -0.105, HIP, 0, swing);
      put('thigh', 0.105, HIP, 0, swing2);
      // Knee position derived from the thigh so the shin actually connects.
      const kl = 0.42 * h;
      put('shin', -0.105, HIP - Math.cos(swing) * kl, Math.sin(swing) * kl, swing + kneeBendL);
      put('shin', 0.105, HIP - Math.cos(swing2) * kl, Math.sin(swing2) * kl, swing2 + kneeBendR);
    }

    if (carries) {
      if (carries === 'backpack') put('backpack', 0, HIP + 0.34, -0.19);
      else if (carries === 'dog') put('dog', 0.55, 0, 0.35, 0, Math.sin(p.phase * 0.6) * 0.3);
      else if (carries === 'board') put('board', 0.34, SHOULDER - 0.34, 0.04, 0, 0, 1.4);
      else if (carries === 'petdrone') put('petdrone', -0.4, NECK + 0.4 + Math.sin(p.phase * 0.7) * 0.08, -0.2);
      else if (carries === 'boombox') put('boombox', 0.3, SHOULDER + 0.12, 0.02, 0, 0, 0.2);
      else put('carry', 0.30, SHOULDER - 0.62, 0.04, 0, 0, 0);
    }
    if (p.emissive) put('trim', 0, HIP, 0, lean);
  }

  /** Look up the stored per-person colour channel for a part. */
  _srcColor(key, srcIdx, channel) {
    const base = this.meshes[key].userData.baseColors;
    return base ? base[srcIdx + channel] : 1;
  }

  /** Snapshot the per-person colours so `_pose` can re-index them safely. */
  _cacheColors() {
    for (const key in this.meshes) {
      const m = this.meshes[key];
      m.userData.baseColors = Float32Array.from(m.instanceColor.array);
    }
  }

  setVisible(v) { this.group.visible = v; }

  dispose() {
    for (const key in this.meshes) {
      this.meshes[key].geometry.dispose();
      this.group.remove(this.meshes[key]);
    }
    this.scene.remove(this.group);
  }
}
