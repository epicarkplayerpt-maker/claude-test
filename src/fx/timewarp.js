/**
 * The time warp.
 *
 * A single expanding front, centred on the player, that erases one decade and
 * writes the next in behind it. Three things move together and have to stay in
 * lockstep or the illusion collapses:
 *
 *   1. The **geometry dissolve** (`WARP` uniforms in materials.js) — the old
 *      era's surfaces vanish ahead of the front, the new era's appear behind it.
 *   2. The **screen wipe** (the composite pass) — a chromatic shockwave riding
 *      the same radius, which hides the moment the two sets of geometry swap.
 *   3. The **atmosphere** — sky colours, sun angle, fog and the colour grade
 *      all cross-fade on the same curve, so 1945's coal haze becomes 1985's
 *      neon overcast continuously rather than cutting.
 *
 * Population (traffic and pedestrians) is swapped at the halfway point, while
 * the front is furthest from the camera and the screen is brightest.
 */

import * as THREE from 'three';
import { setWarp } from '../world/materials.js';
import { ERAS } from '../data/eras.js';
import { clamp01, lerp, smoothstep, smootherstep, easeInOutCubic } from '../core/mathx.js';

const MAX_RADIUS = 118;

export class TimeWarp {
  constructor(deps) {
    this.engine = deps.engine;
    this.sky = deps.sky;
    this.city = deps.city;
    this.weather = deps.weather;
    this.ring = deps.ring;
    this.audio = deps.audio;
    this.player = deps.player;
    this.onPhase = deps.onPhase || (() => {});

    this.active = false;
    this.t = 0;
    this.duration = 1.9;
    this.from = 0;
    this.to = 0;
    this.swapped = false;
    this.reduceMotion = false;
    this.noFlash = false;
    this._center = new THREE.Vector3();
  }

  /**
   * Begin a transition. Building the target era can take a moment on a cold
   * cache, so the caller awaits this before the wipe starts; the loading beat
   * is short and covered by the charge-up phase.
   */
  async start(fromIdx, toIdx, onProgress) {
    if (this.active || fromIdx === toIdx) return false;
    this.from = fromIdx;
    this.to = toIdx;
    this.dir = Math.sign(toIdx - fromIdx);
    this.t = 0;
    this.swapped = false;
    this.duration = this.reduceMotion ? 1.05 : 1.9 + Math.min(3, Math.abs(toIdx - fromIdx)) * 0.14;

    this.onPhase('prepare');
    await this.city.prepareTransition(fromIdx, toIdx, onProgress);

    this._center.copy(this.player.pos);
    this._center.y = 1.6;
    // Travelling forward, the front races outward from you; travelling back it
    // still expands, but the palette leads with the era you are returning to.
    const era = ERAS[toIdx];
    this.color = era.accent;

    setWarp({ active: true, radius: -2, center: this._center, width: this.reduceMotion ? 2 : 4.2, color: this.color });
    this.active = true;
    this.onPhase('start');
    this.audio?.warpStart(ERAS[fromIdx], era, this.duration);
    return true;
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const p = clamp01(this.t / this.duration);

    /* The front accelerates away and decelerates at the far edge. */
    const eased = easeInOutCubic(p);
    const radius = lerp(-3, MAX_RADIUS, eased);

    // Keep the front centred on the player so walking during a warp still works.
    this._center.lerp(
      new THREE.Vector3(this.player.pos.x, 1.6, this.player.pos.z),
      1 - Math.exp(-6 * dt)
    );

    const width = (this.reduceMotion ? 2.2 : 4.6) * (1 + Math.sin(p * Math.PI) * 0.8);
    setWarp({ active: true, radius, center: this._center, width, color: this.color, time: this.t });

    /* Screen wipe rides the same curve but leads it slightly, so the flash
       arrives just before the geometry it is hiding. */
    const flash = this.noFlash ? 0.35 : 1;
    this.engine.post.setWarp(clamp01(eased * 1.06) * flash, this.color, false);

    if (this.ring) {
      const o = Math.sin(p * Math.PI) * (this.noFlash ? 0.35 : 0.9);
      this.ring.set(this._center, Math.max(0.5, radius), o, this.color);
    }

    /* Atmosphere cross-fade. */
    const blend = smootherstep(clamp01((p - 0.08) / 0.7));
    this.applyBlend(this.from, this.to, blend);

    /* Population swap at the halfway mark. */
    if (!this.swapped && p > 0.5) {
      this.swapped = true;
      this.city.swapPopulation(this.to);
      this.onPhase('swap');
    }

    if (p >= 1) this.finish();
  }

  finish() {
    this.active = false;
    setWarp({ active: false, radius: -1 });
    this.engine.post.setWarp(0, this.color, false);
    this.ring?.set(this._center, 0, 0);
    this.city.finishTransition(this.to);
    this.applyBlend(this.to, this.to, 0);
    this.onPhase('done');
    this.audio?.warpEnd(ERAS[this.to]);
  }

  /**
   * Set sky, lights, fog and grade to a blend of two eras.
   * Also used with `a === b` to settle on a single era.
   */
  applyBlend(a, b, t, timeOfDay = null, weatherOverride = null) {
    const A = ERAS[a], B = ERAS[b];
    this.sky.apply(A.sky, a === b ? null : B.sky, t, timeOfDay);

    const s = this.engine.post.settings;
    const ga = A.grade, gb = B.grade;
    const mix = (k) => lerp(ga[k], gb[k], t);
    const mix3 = (k, i) => lerp(ga[k][i], gb[k][i], t);
    for (const k of ['exposure', 'sat', 'contrast', 'temp', 'vignette', 'grain', 'chroma',
                     'halation', 'sepia', 'vhs', 'bleach', 'holo', 'dust',
                     'bloomStrength', 'bloomThreshold']) {
      s[k] = mix(k);
    }
    for (const k of ['lift', 'gamma', 'gain', 'tint']) {
      s[k] = [mix3(k, 0), mix3(k, 1), mix3(k, 2)];
    }

    if (this.weather) {
      const mode = weatherOverride || (t < 0.5 ? A.weather : B.weather);
      if (this.weather.mode !== mode) this.weather.setMode(mode, 1);
    }

    /* UI accents track the blend so the chrome changes with the world. */
    const accent = new THREE.Color(A.accent).lerp(new THREE.Color(B.accent), t);
    const accent2 = new THREE.Color(A.accent2).lerp(new THREE.Color(B.accent2), t);
    const root = document.documentElement.style;
    root.setProperty('--era-accent', '#' + accent.getHexString());
    root.setProperty('--era-accent-2', '#' + accent2.getHexString());
    root.setProperty('--era-glow', `0 0 24px rgba(${Math.round(accent.r * 255)},${Math.round(accent.g * 255)},${Math.round(accent.b * 255)},.38)`);
  }

  /** Progress 0..1, or 0 when idle. */
  get progress() { return this.active ? clamp01(this.t / this.duration) : 0; }
}
