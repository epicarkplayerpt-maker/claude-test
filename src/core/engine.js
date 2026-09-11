/**
 * Renderer, camera, render targets, quality tiers and the adaptive governor
 * that keeps frame time inside budget without the player ever touching a menu.
 */

import * as THREE from 'three';
import { PostFX } from '../fx/post.js';
import { clamp, damp } from './mathx.js';

export const QUALITY = {
  low: {
    label: 'Low', dprCap: 1.25, msaa: 0, ao: false, bloom: true,
    shadows: true, shadowSize: 1024, shadowDist: 55, crowd: 0.34, traffic: 0.4,
    windowLights: 0.4, reflections: false, weatherScale: 0.4, detailBias: 0.55,
  },
  medium: {
    label: 'Medium', dprCap: 1.6, msaa: 2, ao: false, bloom: true,
    shadows: true, shadowSize: 2048, shadowDist: 75, crowd: 0.6, traffic: 0.7,
    windowLights: 0.7, reflections: true, weatherScale: 0.7, detailBias: 0.8,
  },
  high: {
    label: 'High', dprCap: 2.0, msaa: 4, ao: true, bloom: true,
    shadows: true, shadowSize: 2048, shadowDist: 95, crowd: 1.0, traffic: 1.0,
    windowLights: 1.0, reflections: true, weatherScale: 1.0, detailBias: 1.0,
  },
  ultra: {
    label: 'Ultra', dprCap: 2.0, msaa: 4, ao: true, bloom: true,
    shadows: true, shadowSize: 4096, shadowDist: 125, crowd: 1.25, traffic: 1.2,
    windowLights: 1.0, reflections: true, weatherScale: 1.3, detailBias: 1.25,
  },
};

export class Engine {
  constructor(canvas, device) {
    this.canvas = canvas;
    this.device = device;
    this.tier = device.tier;
    this.q = QUALITY[this.tier];

    /* ── Renderer ─────────────────────────────────────────────── */
    const ctxAttrs = {
      canvas,
      antialias: false,             // MSAA happens on the HDR target instead
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,  // needed for photo-mode export
      failIfMajorPerformanceCaveat: false,
    };
    this.renderer = new THREE.WebGLRenderer(ctxAttrs);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // done in the composite pass
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.info.autoReset = false;
    this.renderer.setClearColor(0x05070a, 1);

    this.caps = {
      webgl2: this.renderer.capabilities.isWebGL2,
      maxTexture: this.renderer.capabilities.maxTextureSize,
      maxSamples: this.renderer.capabilities.maxSamples ?? 0,
      anisotropy: this.renderer.capabilities.getMaxAnisotropy(),
    };

    /* ── Scene & camera ───────────────────────────────────────── */
    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = true;

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.08, 620);
    this.camera.position.set(0, 1.68, 26);

    /* ── Post ─────────────────────────────────────────────────── */
    this.post = new PostFX(this.renderer, this.scene, this.camera, {
      ao: this.q.ao,
      msaa: Math.min(this.q.msaa, this.caps.maxSamples || 0),
    });

    /* ── Sizing ───────────────────────────────────────────────── */
    this.renderScale = 1.0;      // user preference
    this._adaptive = 1.0;        // governor output
    this._sizeDirty = true;
    this._w = 0; this._h = 0;

    this._onResize = () => { this._sizeDirty = true; };
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', () => setTimeout(this._onResize, 260));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', this._onResize);

    /* ── Context loss (mobile browsers do this when backgrounded) ─ */
    this.contextLost = false;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.onContextLost?.();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this._sizeDirty = true;
      this.onContextRestored?.();
    });

    /* ── Frame stats ──────────────────────────────────────────── */
    this.stats = { fps: 0, ms: 0, draws: 0, tris: 0, avg: 16.7 };
    this._frameTimes = new Float32Array(60);
    this._ftIdx = 0;
    this._govCooldown = 0;
    this.governorEnabled = true;
    // The governor may climb back to where the device probe started it, never
    // past — a phone that manages a few smooth seconds is not an ultra machine.
    this._tierCeiling = this.tier;
    this._tierFloor = 'low';

    this.resize();
  }

  setTier(tier) {
    if (!QUALITY[tier]) return;
    this.tier = tier;
    this.q = QUALITY[tier];
    this.renderer.shadowMap.enabled = this.q.shadows && this.userShadows !== false;
    this.post.useAO = this.q.ao && this.userAO !== false;
    this.post.useBloom = this.q.bloom && this.userBloom !== false;
    const want = Math.min(this.q.msaa, this.caps.maxSamples || 0);
    if (this.post.msaa !== want) {
      this.post.msaa = want;
      this.post._w = -1;                 // force target rebuild
      this._sizeDirty = true;
    }
    this._adaptive = 1.0;
    this.onTierChange?.(tier);
  }

  setRenderScale(s) { this.renderScale = clamp(s, 0.4, 1.4); this._sizeDirty = true; }
  setShadows(on) {
    this.userShadows = on;
    this.renderer.shadowMap.enabled = on && this.q.shadows;
    // Materials compiled without shadow support need a recompile toggle.
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }
  setAO(on) { this.userAO = on; this.post.useAO = on && this.q.ao; }
  setBloom(on) { this.userBloom = on; this.post.useBloom = on && this.q.bloom; }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.dprCap);
    const scale = dpr * this.renderScale * this._adaptive;
    const cw = Math.max(1, window.innerWidth);
    const ch = Math.max(1, window.innerHeight);
    const w = Math.max(2, Math.round(cw * scale));
    const h = Math.max(2, Math.round(ch * scale));

    if (w === this._w && h === this._h && !this._sizeDirty) return;
    this._w = w; this._h = h; this._sizeDirty = false;

    this.renderer.setPixelRatio(1);       // we size the drawing buffer ourselves
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = cw + 'px';
    this.canvas.style.height = ch + 'px';

    this.camera.aspect = cw / ch;
    // On a narrow phone in portrait, widen the vertical FOV so the framing
    // doesn't feel like looking through a letterbox.
    this.camera.fov = this.baseFov * (this.camera.aspect < 0.85 ? 1.16 : 1.0);
    this.camera.updateProjectionMatrix();

    this.post.setSize(w, h);
    this.onResize?.(cw, ch);
  }

  set baseFov(v) { this._baseFov = v; }
  get baseFov() { return this._baseFov ?? 72; }

  setFov(deg) {
    this.baseFov = deg;
    this.camera.fov = deg * (this.camera.aspect < 0.85 ? 1.16 : 1.0);
    this.camera.updateProjectionMatrix();
  }

  /** Rolling frame-time governor: trades resolution for smoothness. */
  _governor(dt) {
    this._frameTimes[this._ftIdx] = dt * 1000;
    this._ftIdx = (this._ftIdx + 1) % this._frameTimes.length;
    let sum = 0;
    for (let i = 0; i < this._frameTimes.length; i++) sum += this._frameTimes[i] || 16.7;
    const avg = sum / this._frameTimes.length;
    this.stats.avg = damp(this.stats.avg, avg, 4, dt);

    if (!this.governorEnabled) return;
    this._govCooldown -= dt;
    if (this._govCooldown > 0) return;

    // Targets: 60fps desktop, 45fps mobile (phones throttle hard under load and
    // a stable 45 reads better than an oscillating 60/30).
    const budget = this.device.mobile ? 22.5 : 17.5;
    const ORDER = ['low', 'medium', 'high', 'ultra'];
    const FLOOR = 0.5;

    if (avg > budget * 1.35) {
      if (this._adaptive > FLOOR) {
        this._adaptive = Math.max(FLOOR, this._adaptive - 0.09);
        this._sizeDirty = true;
        this._govCooldown = 1.6;
        this.onGovernor?.('down', this._adaptive);
        return;
      }
      /* Out of resolution to give. Resolution is only ever half the bill — the
         rest is MSAA samples, the AO pass, shadow map size and how many people
         and cars are being animated. Step the whole tier down and get all of
         it at once, rather than sitting at half resolution and still dropping
         frames, which is what a struggling phone used to do for ever. */
      const i = ORDER.indexOf(this.tier);
      if (i > ORDER.indexOf(this._tierFloor)) {
        this.setTier(ORDER[i - 1]);
        this._adaptive = 0.82;
        this._sizeDirty = true;
        this._govCooldown = 4.0;
        this.onGovernor?.('tier-down', this.tier);
      }
    } else if (avg < budget * 0.74 && this._adaptive < 1.0) {
      this._adaptive = Math.min(1.0, this._adaptive + 0.05);
      this._sizeDirty = true;
      this._govCooldown = 2.4;
      this.onGovernor?.('up', this._adaptive);
    } else if (avg < budget * 0.62 && this._adaptive >= 1.0) {
      // Comfortable at full resolution — take the tier back, at most to where
      // the device probe put us, and slowly.
      const i = ORDER.indexOf(this.tier);
      if (i < ORDER.indexOf(this._tierCeiling)) {
        this.setTier(ORDER[i + 1]);
        this._govCooldown = 8.0;
        this.onGovernor?.('tier-up', this.tier);
      }
    }
  }

  /** Render one frame. `time` is seconds since start. */
  render(dt, time) {
    if (this.contextLost) return;
    if (this._sizeDirty) this.resize();

    this.renderer.info.reset();
    this.renderer.setRenderTarget(this.post.sceneTarget);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.scene, this.camera);
    this.post.render(time);

    this.stats.draws = this.renderer.info.render.calls;
    this.stats.tris = this.renderer.info.render.triangles;
    this.stats.ms = dt * 1000;
    this.stats.fps = dt > 0 ? 1 / dt : 0;
    this._governor(dt);
  }

  /** Read the current frame back as a data URL (photo mode). */
  snapshot(type = 'image/png', quality = 0.95) {
    return this.canvas.toDataURL(type, quality);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.post.dispose();
    this.renderer.dispose();
  }
}
