/**
 * The flock.
 *
 * Every city block has birds on it, and their behaviour is one of the few
 * things on this street that does not change between 1945 and 2055: they
 * gather where the food is, they walk with that jerky head-first gait, and
 * when you get within about three metres they all leave at once.
 *
 * That last part is the whole reason they are here. A scene where nothing
 * reacts to you reads as a diorama; a scene where a dozen pigeons explode off
 * the pavement the moment you step toward them reads as a place. They wheel
 * once around the block, lose height, and settle again — usually somewhere
 * else, which is why the block never looks quite the same twice.
 *
 * Everything is instanced: one draw call for bodies, one per wing, one for
 * heads. Sixteen birds cost four draws.
 */

import * as THREE from 'three';
import { Bucket } from './geom.js';
import { BLOCK } from '../data/eras.js';
import { clamp01, damp, lerp, TAU } from '../core/mathx.js';
import { Rand } from '../core/rng.js';

/* Where birds like to be: kerb edges, the square in front of the cinema, the
   lamp posts, and the parapets. Roosts are perches; grounds are for walking. */
const HALF = BLOCK.half;
const WALK = HALF + BLOCK.sidewalk;

/** Per-era plumage and headcount. A 1945 block is thick with pigeons. */
const FLAVOUR = {
  1945: { n: 18, body: [0x6a6a72, 0x585862, 0x7a7268], iris: 0xd8a030, ring: 0x2a6a5a, tag: false },
  1965: { n: 15, body: [0x6a6a72, 0x62626c, 0x8a8078], iris: 0xd8a030, ring: 0x2a6a5a, tag: false },
  1985: { n: 12, body: [0x5a5a64, 0x6a6a72, 0x4a4a54], iris: 0xd07030, ring: 0x3a5a6a, tag: false },
  2005: { n: 11, body: [0x6a6a72, 0x585862, 0x7a7268], iris: 0xd8a030, ring: 0x2a6a5a, tag: false },
  2025: { n: 13, body: [0x6a6a72, 0x62626c, 0x8a8078], iris: 0xd8a030, ring: 0x2a6a5a, tag: false },
  // By 2055 the flock is monitored: every bird carries a numbered leg ring and
  // a chip, and the city publishes their movements as an open data feed.
  2055: { n: 14, body: [0x6a6a72, 0x707a80, 0x5a6068], iris: 0x8adcff, ring: 0x30f0c0, tag: true },
};

function birdParts() {
  const W = 0xffffff, D = 0xa8a8a8, L = 0xe4e4e4;
  const mk = (fn) => { const b = new Bucket(); fn(b); return b.build(true); };
  return {
    body: mk((b) => {
      b.box(0.088, 0.084, 0.150, 0, 0, 0.004, W);              // breast → back
      b.box(0.070, 0.062, 0.120, 0, -0.012, 0.062, D);         // rump
      b.prism([[0, 0], [0.030, 0.012], [0, 0.030], [-0.030, 0.012]], 0.115,
        0, -0.020, 0.150, D, { x: 0.22 });                     // tail
      b.box(0.052, 0.036, 0.030, 0, 0.036, -0.070, L);         // neck
    }),
    head: mk((b) => {
      b.box(0.048, 0.046, 0.052, 0, 0, 0, W);
      b.box(0.040, 0.030, 0.020, 0, -0.004, -0.034, L);        // face
      b.cone(0.011, 0.030, 0, -0.006, -0.052, 0xd8a860, { x: -Math.PI / 2 });
    }),
    eye: mk((b) => {
      b.sphere(0.0075, -0.019, 0.006, -0.026, W, true);
      b.sphere(0.0075, 0.019, 0.006, -0.026, W, true);
    }),
    wing: mk((b) => {
      // Pinned at the shoulder, extending along −x so a z-rotation flaps it.
      b.box(0.090, 0.020, 0.096, -0.048, 0, 0.006, W);
      b.box(0.084, 0.014, 0.076, -0.122, -0.004, 0.020, D);
      b.box(0.062, 0.010, 0.050, -0.178, -0.010, 0.038, L);    // primaries
    }),
    leg: mk((b) => {
      b.cyl(0.005, 0.034, 0, -0.017, 0, 0xc06a4a, null, 6);
      b.box(0.016, 0.004, 0.024, 0, -0.034, -0.006, 0xc06a4a);
    }),
    ring: mk((b) => {
      b.cyl(0.008, 0.010, 0, -0.010, 0, 0xffffff, null, 8);
    }),
  };
}

export class Flock {
  constructor(scene, mats, max = 20) {
    this.max = max;
    this.parts = birdParts();
    this.group = new THREE.Group();
    this.group.name = 'flock';
    this.meshes = {};
    const mat = mats.character ? mats.character() : mats.vcol('matte');
    for (const key of Object.keys(this.parts)) {
      const count = key === 'wing' || key === 'leg' || key === 'ring' ? max * 2 : max;
      const m = new THREE.InstancedMesh(this.parts[key], mat, count);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      m.frustumCulled = false;
      m.castShadow = key === 'body';
      m.receiveShadow = false;
      m.count = 0;
      this.meshes[key] = m;
      this.group.add(m);
    }
    this.birds = [];
    this.startle = 0;
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
    scene.add(this.group);
  }

  /** A patch of pavement a bird is willing to stand on. */
  _groundSpot(rnd) {
    const side = rnd.int(0, 3);
    const along = rnd.range(-HALF + 1.5, HALF - 1.5);
    const out = rnd.range(0.7, BLOCK.sidewalk - 0.7);
    const r = HALF + out;
    return side === 0 ? { x: along, z: -r } : side === 1 ? { x: along, z: r }
      : side === 2 ? { x: -r, z: along } : { x: r, z: along };
  }

  /** A ledge, lamp arm or parapet a bird will sit on. */
  _perchSpot(rnd) {
    const g = this._groundSpot(rnd);
    // Pulled a little toward the block so it lands on a sill rather than in
    // mid-air over the kerb.
    return { x: g.x * 0.94, z: g.z * 0.94, y: rnd.pick([2.9, 4.6, 4.6, 7.9]) };
  }

  populate(era, eraIdx, quality = 1) {
    const f = FLAVOUR[era.year] || FLAVOUR[1945];
    const rnd = new Rand(era.year * 977 + 31);
    const n = Math.min(this.max, Math.round(f.n * quality));
    this.birds.length = 0;
    for (let i = 0; i < n; i++) {
      const spot = this._groundSpot(rnd);
      const col = new THREE.Color(rnd.pick(f.body));
      // A few birds are noticeably paler — every flock has one white one.
      if (rnd.chance(0.12)) col.setHex(0xd8d4cc);
      this.birds.push({
        i,
        x: spot.x, y: BLOCK.curbHeight, z: spot.z,
        vx: 0, vy: 0, vz: 0,
        heading: rnd.range(0, TAU),
        state: 'peck',
        t: rnd.range(0.4, 3),
        phase: rnd.range(0, TAU),
        bob: 0,
        scale: rnd.range(0.86, 1.12),
        col,
        iris: new THREE.Color(f.iris),
        ring: f.tag ? new THREE.Color(f.ring) : null,
        target: spot,
        circle: rnd.range(0, TAU),
        alt: rnd.range(9, 17),
      });
    }
    this.flavour = f;
    this.rnd = rnd;
  }

  setVisible(v) { this.group.visible = v; }

  /**
   * @param camPos  the player — birds keep a personal space of ~3 m
   * @param loud    a transient 0..1 (a car horn, a warp) that startles the lot
   */
  update(dt, time, camPos, loud = 0) {
    if (!this.birds.length || !this.group.visible) return;
    this.startle = Math.max(this.startle * Math.exp(-dt * 0.7), loud);

    const counts = {};
    for (const k in this.meshes) counts[k] = 0;

    for (const b of this.birds) {
      this._step(b, dt, time, camPos);
      this._pose(b, counts, time);
    }

    for (const k in this.meshes) {
      const m = this.meshes[k];
      m.count = counts[k];
      m.visible = counts[k] > 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  _step(b, dt, time, camPos) {
    const rnd = this.rnd;
    const dxc = b.x - camPos.x, dzc = b.z - camPos.z;
    const near = Math.hypot(dxc, dzc);
    b.t -= dt;

    // Anything within three metres, or a loud enough noise, puts the whole
    // bird in the air on the next frame. Real pigeons do not deliberate.
    if ((b.state === 'peck' || b.state === 'walk' || b.state === 'perch') &&
        (near < 3.0 || this.startle > 0.55)) {
      b.state = 'flee';
      b.t = 1.1 + Math.random() * 0.9;
      b.vy = 4.2 + Math.random() * 1.6;
      const away = Math.atan2(dzc, dxc);
      b.vx = Math.cos(away) * (3.4 + Math.random() * 1.6);
      b.vz = Math.sin(away) * (3.4 + Math.random() * 1.6);
      b.circle = Math.atan2(b.z, b.x);
      b.alt = 9 + Math.random() * 8;
    }

    switch (b.state) {
      case 'peck': {
        // Head down, then a sharp look around. The bob is the tell.
        b.bob = damp(b.bob, Math.sin(time * 5.5 + b.phase) > 0.2 ? 1 : 0, 16, dt);
        if (b.t <= 0) {
          b.state = Math.random() < 0.55 ? 'walk' : 'peck';
          b.t = 0.8 + Math.random() * 2.6;
          if (b.state === 'walk') b.target = this._groundSpot(rnd);
        }
        break;
      }
      case 'walk': {
        b.bob = damp(b.bob, 0, 8, dt);
        const dx = b.target.x - b.x, dz = b.target.z - b.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.18 || b.t <= 0) { b.state = 'peck'; b.t = 1 + Math.random() * 3; break; }
        const sp = 0.44;
        b.x += (dx / d) * sp * dt; b.z += (dz / d) * sp * dt;
        b.heading = Math.atan2(dx, dz);
        break;
      }
      case 'flee': {
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        b.vy -= 3.2 * dt;
        b.heading = Math.atan2(b.vx, b.vz);
        if (b.t <= 0 || b.y > b.alt) { b.state = 'wheel'; b.t = 4 + Math.random() * 5; }
        break;
      }
      case 'wheel': {
        // A wide, banking circuit of the block, losing height near the end.
        b.circle += dt * 0.42;
        const r = HALF + BLOCK.sidewalk + 6 + Math.sin(b.circle * 0.7 + b.phase) * 5;
        const tx = Math.cos(b.circle) * r, tz = Math.sin(b.circle) * r;
        const ty = b.t < 2.2 ? lerp(BLOCK.curbHeight + 0.4, b.alt, clamp01(b.t / 2.2)) : b.alt;
        b.x = damp(b.x, tx, 2.2, dt);
        b.z = damp(b.z, tz, 2.2, dt);
        b.y = damp(b.y, ty, 2.0, dt);
        b.heading = Math.atan2(Math.cos(b.circle + 0.1) * r - b.x, Math.sin(b.circle + 0.1) * r - b.z);
        if (b.t <= 0) {
          b.state = 'land';
          b.target = Math.random() < 0.25 ? this._perchSpot(rnd) : this._groundSpot(rnd);
          b.t = 3;
        }
        break;
      }
      case 'land': {
        const ty = b.target.y ?? BLOCK.curbHeight;
        b.x = damp(b.x, b.target.x, 2.6, dt);
        b.z = damp(b.z, b.target.z, 2.6, dt);
        b.y = damp(b.y, ty, 3.4, dt);
        b.heading = Math.atan2(b.target.x - b.x, b.target.z - b.z);
        if (Math.abs(b.y - ty) < 0.06 && b.t <= 0) {
          b.state = b.target.y ? 'perch' : 'peck';
          b.y = ty;
          b.t = 3 + Math.random() * 8;
        }
        break;
      }
      case 'perch': {
        b.bob = damp(b.bob, 0, 6, dt);
        if (b.t <= 0) { b.state = 'flee'; b.t = 1.2; b.vy = 3.4; b.vx = Math.cos(b.heading) * 2.6; b.vz = Math.sin(b.heading) * 2.6; }
        break;
      }
      default: break;
    }

    b.airborne = b.state === 'flee' || b.state === 'wheel' || b.state === 'land';
    // Wings beat hard on take-off, then settle into a glide-and-flap cycle.
    const rate = b.state === 'flee' ? 17 : b.state === 'land' ? 11 : 7.5;
    b.phase += dt * rate;
  }

  _pose(b, counts, time) {
    const s = b.scale;
    const cosH = Math.cos(b.heading), sinH = Math.sin(b.heading);

    const put = (key, ox, oy, oz, rx = 0, ry = 0, rz = 0, colour = b.col) => {
      const m = this.meshes[key];
      if (!m) return;
      const idx = counts[key]++;
      if (idx >= m.instanceMatrix.count) { counts[key]--; return; }
      this._v.set(b.x + (ox * cosH + oz * sinH) * s, b.y + oy * s, b.z + (-ox * sinH + oz * cosH) * s);
      this._e.set(rx, b.heading + ry, rz, 'YXZ');
      this._q.setFromEuler(this._e);
      this._s.set(s, s, s);
      this._m.compose(this._v, this._q, this._s);
      m.setMatrixAt(idx, this._m);
      if (m.instanceColor) {
        m.instanceColor.array[idx * 3] = colour.r;
        m.instanceColor.array[idx * 3 + 1] = colour.g;
        m.instanceColor.array[idx * 3 + 2] = colour.b;
      }
    };

    const air = b.airborne;
    // On the ground the body is nearly level and the legs carry it; in the air
    // it tips nose-down and the legs tuck under the tail.
    const pitch = air ? -0.28 : 0.10 + b.bob * 0.34;
    const bodyY = air ? 0.10 : 0.098;
    put('body', 0, bodyY, 0, pitch);

    // The head stays level whatever the body does — that is what makes a
    // walking pigeon look like a pigeon and not like a wind-up toy.
    const step = air ? 0 : Math.sin(b.phase * 0.9) * 0.020;
    put('head', 0, bodyY + 0.058 - b.bob * 0.075, -0.082 - b.bob * 0.036 + step, air ? -0.12 : b.bob * 0.9);
    put('eye', 0, bodyY + 0.058 - b.bob * 0.075, -0.082 - b.bob * 0.036 + step, air ? -0.12 : b.bob * 0.9, 0, 0, b.iris);

    // Wings: a flap when airborne, folded along the flank when not.
    const beat = air ? Math.sin(b.phase) : 0;
    for (const side of [-1, 1]) {
      const fold = !air;
      // The wing geometry runs along −x from the shoulder, so the left wing is
      // the same shape turned through half a turn; both then flap outward and
      // up by the same angle.
      const a = fold ? 0.06 : 0.55 + beat * 0.85;
      const rz = side > 0 ? -a : Math.PI + a;
      const ry = side * (fold ? 0.10 : 0.16);
      const rx = fold ? 0 : -0.10 + beat * 0.12;
      put('wing', side * 0.036, bodyY + 0.014, -0.004, rx, ry, rz);
    }

    if (!air) {
      const gait = Math.sin(b.phase * 0.9);
      for (const side of [-1, 1]) {
        put('leg', side * 0.020, 0.036, (side > 0 ? gait : -gait) * 0.022, 0);
      }
      if (b.ring) put('ring', 0.020, 0.030, gait * 0.022, 0, 0, 0, b.ring);
    }
  }

  dispose() {
    for (const k in this.meshes) {
      this.meshes[k].geometry.dispose();
      this.group.remove(this.meshes[k]);
    }
    this.group.parent?.remove(this.group);
  }
}
