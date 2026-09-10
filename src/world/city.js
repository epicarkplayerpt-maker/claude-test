/**
 * The city: assembly, era lifecycle, collision, interaction and the light budget.
 *
 * Each era is a self-contained `THREE.Group` plus its own material library, so
 * a transition is just two groups visible at once with opposite dissolve signs.
 * Building all six up front is fine on a desktop and far too much VRAM on a
 * phone, so eras are built on demand and the least-recently-used ones are
 * released past a cap that depends on the quality tier.
 */

import * as THREE from 'three';
import { ERAS, LOTS, BLOCK } from '../data/eras.js';
import { MatLib } from './materials.js';
import { buildLot, buildingHeight } from './buildings.js';
import { buildStreet } from './street.js';
import { Traffic } from './vehicles.js';
import { Crowd } from './pedestrians.js';
import { Rand } from '../core/rng.js';
import { clamp, clamp01, damp, lerp, resolveAABB } from '../core/mathx.js';

const CURB = BLOCK.half + BLOCK.sidewalk;

export class City {
  constructor(engine, opts = {}) {
    this.engine = engine;
    this.scene = engine.scene;
    this.quality = engine.q;
    this.maxResident = opts.maxResident ?? 6;

    this.eras = new Array(ERAS.length).fill(null);
    this.lastUsed = new Array(ERAS.length).fill(0);
    this.tick = 0;

    this.root = new THREE.Group();
    this.root.name = 'city';
    this.scene.add(this.root);

    /**
     * The crowd and the traffic own a library of their own. Their materials
     * have to survive the LRU trimming an era's library, and they are swapped
     * wholesale at the midpoint of a transition rather than dissolved, so they
     * opt out of the warp entirely.
     */
    this.sharedMats = new MatLib(this.scene.environment || null, { noWarp: true });
    this.traffic = new Traffic(this.scene, this.sharedMats, this.quality);
    this.crowd = null;
    this.signals = this.traffic.signals;

    this.currentIdx = -1;
    this.otherIdx = -1;

    /* ── Light budget ─────────────────────────────────────────── */
    const nLights = this.quality.windowLights >= 1 ? 7 : this.quality.windowLights >= 0.7 ? 5 : 3;
    this.lightPool = [];
    for (let i = 0; i < nLights; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 12, 2);
      l.castShadow = false;
      l.visible = false;
      this.scene.add(l);
      this.lightPool.push(l);
    }
    this._lightTimer = 0;

    /* ── Static collision from the lot footprints ─────────────── */
    this.blockers = [];
    this.boxes = LOTS.filter((l) => !l.open).map((l) => ({
      cx: (l.x0 + l.x1) / 2, cz: (l.z0 + l.z1) / 2,
      hx: (l.x1 - l.x0) / 2, hz: (l.z1 - l.z0) / 2,
    }));
    // The open lot's two party walls are solid too.
    const open = LOTS.find((l) => l.open);
    if (open) {
      this.boxes.push({ cx: (open.x0 + open.x1) / 2, cz: open.z0 - 0.3, hx: (open.x1 - open.x0) / 2, hz: 0.4 });
      this.boxes.push({ cx: open.x1 + 0.3, cz: (open.z0 + open.z1) / 2, hx: 0.4, hz: (open.z1 - open.z0) / 2 });
    }
    // Backdrop ring keeps the player inside the scene.
    const F = CURB + BLOCK.road + BLOCK.farWalk;
    this.bounds = { min: -F + 1.5, max: F - 1.5 };
  }

  /* ══════════════════════════ building ══════════════════════════ */

  /** Build one era. Yields between lots so a progress bar can animate. */
  async build(idx, onProgress) {
    if (this.eras[idx]) { this.lastUsed[idx] = ++this.tick; return this.eras[idx]; }
    const era = ERAS[idx];
    const mats = new MatLib(this.scene.environment || null);
    const group = new THREE.Group();
    group.name = `era:${era.year}`;
    group.visible = false;
    this.root.add(group);

    const ctx = { mats, quality: this.quality };
    const record = {
      idx, era, mats, group,
      interactables: [], lights: [], animated: [], blockers: [],
    };

    const absorb = (r) => {
      group.add(r.group);
      record.interactables.push(...r.interactables);
      record.lights.push(...r.lights);
      record.animated.push(...r.animated);
      if (r.blockers) record.blockers.push(...r.blockers);
    };

    const steps = LOTS.length + 1;
    let step = 0;
    const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

    for (const lot of LOTS) {
      const merged = { ...lot, ...(era.lots[lot.id] || {}) };
      absorb(buildLot(merged, era, idx, ctx));
      onProgress?.(++step / steps, `${era.year} · ${lot.label}`);
      await yieldFrame();
    }
    absorb(buildStreet(era, idx, ctx));
    onProgress?.(++step / steps, `${era.year} · the street`);
    await yieldFrame();

    this.eras[idx] = record;
    this.lastUsed[idx] = ++this.tick;
    this._trim();
    return record;
  }

  _trim() {
    const resident = this.eras.map((e, i) => (e ? i : -1)).filter((i) => i >= 0);
    if (resident.length <= this.maxResident) return;
    resident.sort((a, b) => this.lastUsed[a] - this.lastUsed[b]);
    for (const i of resident) {
      if (this.eras.filter(Boolean).length <= this.maxResident) break;
      if (i === this.currentIdx || i === this.otherIdx) continue;
      this._dispose(i);
    }
  }

  _dispose(idx) {
    const rec = this.eras[idx];
    if (!rec) return;
    this.root.remove(rec.group);
    rec.group.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh) o.geometry?.dispose();
    });
    rec.mats.dispose();
    this.eras[idx] = null;
  }

  /* ══════════════════════════ era switching ══════════════════════════ */

  /** Make `idx` the visible era with no transition. */
  async show(idx, onProgress) {
    const rec = await this.build(idx, onProgress);
    for (let i = 0; i < this.eras.length; i++) {
      if (this.eras[i]) this.eras[i].group.visible = i === idx;
    }
    rec.mats.setSide(1);
    this.currentIdx = idx;
    this.otherIdx = -1;
    this.lastUsed[idx] = ++this.tick;

    if (!this.crowd) this.crowd = new Crowd(this.scene, this.sharedMats, 56);

    this.traffic.populate(ERAS[idx], idx, this.quality.traffic);
    this.crowd.populate(ERAS[idx], idx, this.quality.crowd);
    this._rebuildLightCandidates();
    return rec;
  }

  /** Bring a second era on screen for a cross-dissolve. */
  async prepareTransition(fromIdx, toIdx, onProgress) {
    const from = this.eras[fromIdx];
    const to = await this.build(toIdx, onProgress);
    from.mats.setSide(+1);
    to.mats.setSide(-1);
    from.group.visible = true;
    to.group.visible = true;
    this.currentIdx = fromIdx;
    this.otherIdx = toIdx;
    return to;
  }

  /** Commit a transition: the old era goes away, the new one owns the world. */
  finishTransition(toIdx) {
    for (let i = 0; i < this.eras.length; i++) {
      if (this.eras[i]) this.eras[i].group.visible = i === toIdx;
    }
    const rec = this.eras[toIdx];
    rec.mats.setSide(1);
    this.currentIdx = toIdx;
    this.otherIdx = -1;
    this.lastUsed[toIdx] = ++this.tick;

    this.traffic.populate(ERAS[toIdx], toIdx, this.quality.traffic);
    this.crowd.populate(ERAS[toIdx], toIdx, this.quality.crowd);
    this._rebuildLightCandidates();
    this._trim();
  }

  /** Swap traffic and crowd mid-warp so they change with the buildings. */
  swapPopulation(toIdx) {
    if (!this.eras[toIdx]) return;
    this.traffic.populate(ERAS[toIdx], toIdx, this.quality.traffic);
    this.crowd.populate(ERAS[toIdx], toIdx, this.quality.crowd);
  }

  get current() { return this.eras[this.currentIdx]; }

  /* ══════════════════════════ lights ══════════════════════════ */

  _rebuildLightCandidates() {
    const rec = this.current;
    this._candidates = rec ? rec.lights.slice() : [];
  }

  /**
   * Assign the pooled point lights to the nearest active emitters.
   * Re-evaluated a few times a second rather than every frame — the popping is
   * invisible and the sort is the expensive part.
   */
  _updateLights(dt, camPos, daylight) {
    this._lightTimer -= dt;
    for (const l of this.lightPool) {
      if (l.userData.target !== undefined) {
        l.intensity = damp(l.intensity, l.userData.target, 6, dt);
        if (l.intensity < 0.02 && l.userData.target === 0) l.visible = false;
      }
    }
    if (this._lightTimer > 0) return;
    this._lightTimer = 0.22;

    const cands = this._candidates || [];
    if (!cands.length) return;
    const nightFactor = clamp01(1.25 - daylight * 1.6);
    const scored = [];
    for (const c of cands) {
      if (c.night && nightFactor < 0.06) continue;
      const d = c.pos.distanceToSquared(camPos);
      if (d > 42 * 42) continue;
      scored.push({ c, d });
    }
    scored.sort((a, b) => a.d - b.d);

    for (let i = 0; i < this.lightPool.length; i++) {
      const l = this.lightPool[i];
      const pick = scored[i];
      if (!pick) { l.userData.target = 0; continue; }
      l.position.copy(pick.c.pos);
      l.color.set(pick.c.color);
      l.distance = pick.c.distance;
      l.decay = 2;
      l.userData.target = pick.c.intensity * (pick.c.night ? nightFactor : lerp(0.45, 1, nightFactor));
      l.visible = true;
    }
  }

  /* ══════════════════════════ per-frame ══════════════════════════ */

  update(dt, time, camPos, daylight, audio) {
    this._updateLights(dt, camPos, daylight);
    this.traffic.update(dt, camPos, audio);
    this.crowd?.update(dt, this.signals, camPos, this.blockers);

    for (const idx of [this.currentIdx, this.otherIdx]) {
      const rec = idx >= 0 ? this.eras[idx] : null;
      if (!rec || !rec.group.visible) continue;
      this._animate(rec, dt, time, camPos, daylight);
    }
  }

  _animate(rec, dt, time, camPos, daylight) {
    for (const a of rec.animated) {
      switch (a.kind) {
        case 'flicker': {
          // Dying fluorescent / broken neon: mostly on, with brownouts.
          const n = Math.sin(time * 27 + (a.seed || 0) * 31) * Math.sin(time * 11.3 + 2);
          const on = n > -0.55 ? 1 : 0.12;
          const mat = a.mat || a.mesh?.material;
          if (mat) mat.emissiveIntensity = (a.base ?? (a.base = mat.emissiveIntensity)) * on * (a.amount ? 1 : 1);
          break;
        }
        case 'neonBuzz': {
          const mat = a.mesh.material;
          if (!a.base) a.base = mat.emissiveIntensity;
          const flick = Math.random() < 0.004 ? 0.3 : 1;
          mat.emissiveIntensity = a.base * (0.94 + Math.sin(time * 8 + a.seed * 20) * 0.06) * flick;
          break;
        }
        case 'bulbChase': {
          if (!a.mat) a.mat = a.mesh.material;
          a.mat.emissiveIntensity = 2.6 + Math.sin(time * 5) * 1.1;
          break;
        }
        case 'marqueeCycle': {
          // The 2055 archive replays every marquee this building ever wore.
          const period = 9;
          const i = Math.floor((time % (period * a.lines.length)) / period);
          if (a.last !== i) {
            a.last = i;
            for (const m of a.mats) m.emissiveIntensity = 3.4;
          } else {
            for (const m of a.mats) m.emissiveIntensity = damp(m.emissiveIntensity, 2.6, 3, dt);
          }
          break;
        }
        case 'ledScroll': {
          if (a.tex) { a.tex.offset.x = -(time * 0.11) % 1; a.tex.wrapS = THREE.RepeatWrapping; }
          break;
        }
        case 'holoAd': {
          const m = a.mesh.material;
          m.opacity = 0.55 + Math.sin(time * 1.7 + a.seed * 10) * 0.12 + (Math.random() < 0.01 ? -0.3 : 0);
          a.mesh.position.y += Math.sin(time * 0.9 + a.seed * 6) * 0.0016;
          break;
        }
        case 'billboard': {
          const m = a.mesh.material;
          m.emissiveIntensity = 1.6 + Math.sin(time * 0.6) * 0.35;
          break;
        }
        case 'fan': case 'dronePad': case 'pylon': case 'mist': case 'steam':
        case 'crane': case 'sidewalkBot': case 'cleanBot': case 'barberPole':
          // Handled by the FX layer (particles) or purely decorative.
          break;
        default: break;
      }
    }
  }

  /* ══════════════════════════ queries ══════════════════════════ */

  /** All interactables for the visible era. */
  get interactables() { return this.current ? this.current.interactables : []; }

  /** Closest interactable in front of the camera within its radius. */
  findInteractable(camPos, camDir, maxAngle = 0.72) {
    let best = null, bestScore = Infinity;
    for (const it of this.interactables) {
      const dx = it.pos.x - camPos.x, dy = it.pos.y - camPos.y, dz = it.pos.z - camPos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > it.radius) continue;
      const dot = (dx * camDir.x + dy * camDir.y + dz * camDir.z) / (d || 1);
      if (dot < Math.cos(maxAngle)) continue;
      const score = d * (2 - dot);
      if (score < bestScore) { bestScore = score; best = it; }
    }
    return best;
  }

  /** Slide a capsule of `radius` out of buildings, props and the world bounds. */
  collide(x, z, radius = 0.34) {
    for (const b of this.boxes) {
      const r = resolveAABB(x, z, b.cx, b.cz, b.hx, b.hz, radius);
      if (r) { x = r[0]; z = r[1]; }
    }
    const rec = this.current;
    if (rec) {
      for (const p of rec.blockers) {
        const dx = x - p.x, dz = z - p.z;
        const d = Math.hypot(dx, dz);
        const min = p.r + radius;
        if (d < min && d > 1e-5) { x = p.x + (dx / d) * min; z = p.z + (dz / d) * min; }
      }
    }
    x = clamp(x, this.bounds.min, this.bounds.max);
    z = clamp(z, this.bounds.min, this.bounds.max);
    return [x, z];
  }

  /** Ground height at a point — the sidewalk ring is a step up from the road. */
  groundAt(x, z) {
    const onWalk = (Math.abs(x) <= CURB && Math.abs(z) <= CURB) ||
      Math.abs(x) >= CURB + BLOCK.road || Math.abs(z) >= CURB + BLOCK.road;
    return onWalk ? BLOCK.curbHeight : 0;
  }

  dispose() {
    for (let i = 0; i < this.eras.length; i++) this._dispose(i);
    this.sharedMats.dispose();
    this.traffic.dispose();
    this.crowd?.dispose();
    for (const l of this.lightPool) this.scene.remove(l);
    this.scene.remove(this.root);
  }
}
