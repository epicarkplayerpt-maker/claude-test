/**
 * Deterministic pseudo-random number generation.
 *
 * The whole city is procedural, so every generator that places a brick, a
 * pigeon or a chewing-gum stain draws from a seeded stream. Same seed ⇒ same
 * city, every reload, on every device. That matters for two reasons:
 *   1. Secrets live at fixed coordinates and must not wander between sessions.
 *   2. Era A and era F must agree on where the building edges are, otherwise
 *      the cross-fade between them looks like two different corners.
 */

/** Mulberry32 — small, fast, good enough distribution for visual work. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turn any string into a 32-bit seed (FNV-1a). */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A named random stream with convenience helpers.
 * Streams are cheap — make one per generator (`new Rand('facade:lot3:1985')`)
 * so adding a feature to one generator never shifts another's output.
 */
export class Rand {
  constructor(seed) {
    this._seed = typeof seed === 'string' ? hashSeed(seed) : (seed >>> 0);
    this.next = mulberry32(this._seed);
  }
  /** Float in [0,1). */
  f() { return this.next(); }
  /** Float in [a,b). */
  range(a, b) { return a + (b - a) * this.next(); }
  /** Integer in [a,b] inclusive. */
  int(a, b) { return Math.floor(a + (b - a + 1) * this.next()); }
  /** True with probability p. */
  chance(p) { return this.next() < p; }
  /** Random element. */
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  /** Random element, weighted by `weights[i]`. */
  weighted(arr, weights) {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    let r = this.next() * total;
    for (let i = 0; i < arr.length; i++) {
      r -= weights[i];
      if (r <= 0) return arr[i];
    }
    return arr[arr.length - 1];
  }
  /** Fisher–Yates, in place, returns the same array. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  /** Roughly gaussian via sum of uniforms (Irwin–Hall, n=3). */
  gauss(mean = 0, dev = 1) {
    const s = (this.next() + this.next() + this.next()) / 3;
    return mean + (s - 0.5) * 3.4641 * dev;
  }
  /** Random sign. */
  sign() { return this.next() < 0.5 ? -1 : 1; }
  /** A CSS/THREE-friendly hsl jitter around a base colour. */
  jitterHSL(h, s, l, dh = 0.02, ds = 0.06, dl = 0.06) {
    return [
      (h + this.range(-dh, dh) + 1) % 1,
      Math.min(1, Math.max(0, s + this.range(-ds, ds))),
      Math.min(1, Math.max(0, l + this.range(-dl, dl))),
    ];
  }
}

/* ── Value noise ───────────────────────────────────────────────────────── */

/** 2D value noise with fBm layering — used for grime, rust, plaster mottling. */
export class Noise2D {
  constructor(seed = 1337) {
    const r = mulberry32(typeof seed === 'string' ? hashSeed(seed) : seed);
    this.p = new Uint8Array(512);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
    this.g = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.g[i] = r();
  }
  _v(ix, iy) { return this.g[this.p[(ix + this.p[iy & 255]) & 255]]; }
  /** Single octave, smoothstep-interpolated, returns [0,1]. */
  at(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = this._v(ix, iy), b = this._v(ix + 1, iy);
    const c = this._v(ix, iy + 1), d = this._v(ix + 1, iy + 1);
    return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
  }
  /** Fractal Brownian motion, returns [0,1]. */
  fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.at(x * freq, y * freq);
      norm += amp;
      amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }
  /** Ridged variant — good for cracks and streaks. */
  ridge(x, y, octaves = 4) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * (1 - Math.abs(this.at(x * freq, y * freq) * 2 - 1));
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }
}

/** Shared global streams for things that don't need their own. */
export const GLOBAL = new Rand('the-block:v1');
export const NOISE = new Noise2D('the-block:noise');
