/**
 * Shop interiors.
 *
 * The painted backdrop on the rear wall does the far half of the job; this
 * module puts actual geometry in the front two metres, because a display
 * window is the one place on a street where a passer-by is *invited* to look
 * closely. A counter with stools, a rack of tapes, a row of arcade cabinets or
 * eleven television sets tuned to the same channel says more about a decade
 * than another storey of brick.
 *
 * Everything is built in the facade's local frame (x right, y up, +z out of the
 * wall) and accumulated into the caller's buckets, so a whole shop costs no
 * extra draw calls.
 */

import { Rand } from '../core/rng.js';
import { TAU } from '../core/mathx.js';

/**
 * @param kind    the display id from the era table
 * @param b       opaque bucket (matte vertex-coloured)
 * @param em      emissive bucket (screens, tubes, grow lights)
 * @param box     { x0, x1, y0, y1, z0, z1 } the volume behind the glass
 * @param era     era record, for palette and period cues
 * @param rnd     seeded stream
 */
export function buildInterior(kind, b, em, box, era, rnd) {
  const { x0, x1, y0, y1, z0, z1 } = box;
  const w = x1 - x0, d = z1 - z0;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const fn = SHOPS[kind] || SHOPS.default;
  const ctx = { b, em, x0, x1, y0, y1, z0, z1, w, d, cx, cz, era, rnd, tint: stockPalette(era.year) };
  const mark = b.parts.length;
  fn(ctx);
  addLitter(ctx);
  shadeByDepth(b, mark, z0, d);
}

/**
 * Fake the light falloff into the back of the shop.
 *
 * Everything behind the glass is lit by one strip in the ceiling and whatever
 * daylight gets past the soffit, so the far wall should be a good deal darker
 * than the goods pressed against the window. Vertex-shading it here costs
 * nothing at runtime and is the single biggest thing that stops a display
 * window reading as a flat printed panel.
 */
function shadeByDepth(bucket, from, z0, d) {
  for (let i = from; i < bucket.parts.length; i++) {
    const g = bucket.parts[i];
    const pos = g.attributes.position, col = g.attributes.color;
    if (!pos || !col) continue;
    for (let v = 0; v < pos.count; v++) {
      const t = Math.max(0, Math.min(1, (pos.getZ(v) - z0) / Math.max(0.001, d)));
      const k = 0.40 + 0.60 * Math.pow(t, 0.65);
      col.array[v * 3] *= k; col.array[v * 3 + 1] *= k; col.array[v * 3 + 2] *= k;
    }
  }
}

/**
 * What the packaging on the shelves looks like.
 *
 * Wartime cartons were printed in two colours on kraft board; a 1985 shelf is
 * a wall of process cyan and magenta; a 2025 shelf is mostly white with one
 * accent. Picking hues at random across the whole wheel makes every decade
 * look like the same toy shop, so each era gets its own narrow band.
 */
function stockPalette(year) {
  const P = {
    1945: [[18, 34, 30, 52], [38, 22, 62, 80], [8, 46, 26, 40], [148, 30, 24, 38], [212, 26, 22, 36], [44, 52, 44, 58]],
    1965: [[176, 44, 42, 62], [26, 62, 48, 66], [78, 38, 36, 52], [44, 68, 52, 68], [348, 40, 44, 60], [30, 20, 70, 86]],
    1985: [[196, 72, 46, 62], [318, 66, 46, 62], [52, 88, 50, 64], [8, 74, 44, 58], [258, 56, 44, 58], [140, 60, 38, 52]],
    2005: [[208, 54, 44, 64], [92, 46, 42, 58], [24, 48, 46, 62], [0, 0, 72, 92], [344, 46, 46, 60], [186, 40, 44, 60]],
    2025: [[0, 0, 64, 82], [32, 26, 54, 70], [162, 30, 38, 54], [16, 44, 42, 56], [222, 24, 32, 48], [88, 26, 44, 58]],
    2055: [[188, 46, 46, 64], [268, 40, 42, 58], [0, 0, 68, 84], [154, 38, 44, 58], [206, 34, 36, 50], [318, 34, 46, 60]],
  }[year] || [[30, 30, 40, 60]];
  return (r) => {
    const [h, s, l0, l1] = r.pick(P);
    return hsl((h + r.range(-9, 9) + 360) % 360, s + r.range(-8, 8), r.range(l0, l1));
  };
}

/* Small shared pieces ------------------------------------------------- */

/** A run of shelving against the back wall. */
function shelfRun(c, { y = 0.4, tiers = 4, gap = 0.42, depth = 0.32, frame = 0x5a4a38, fill = null, z = null }) {
  const { b, x0, x1, w, rnd } = c;
  const zz = z ?? (c.z0 + depth / 2 + 0.05);
  for (let t = 0; t < tiers; t++) {
    const ty = y + t * gap;
    b.box(w - 0.1, 0.035, depth, (x0 + x1) / 2, ty, zz, frame);
    const n = Math.max(3, Math.round(w / 0.22));
    for (let i = 0; i < n; i++) {
      if (!rnd.chance(0.82)) continue;
      const bw = rnd.range(0.09, 0.18);
      const bh = rnd.range(0.12, gap - 0.09);
      const col = fill ? fill(rnd) : c.tint(rnd);
      b.box(bw, bh, rnd.range(0.10, depth * 0.8), x0 + 0.06 + (i + 0.5) * ((w - 0.12) / n), ty + 0.02 + bh / 2, zz, col);
    }
  }
  // Uprights
  for (const sx of [x0 + 0.05, x1 - 0.05, (x0 + x1) / 2]) {
    b.box(0.05, tiers * gap + 0.1, depth, sx, y + (tiers * gap) / 2, zz, frame);
  }
}

/** A serving counter running along the window. */
function counter(c, { y = 0, h = 0.95, depth = 0.6, top = 0xc8b090, body = 0x6a4a32, z = null }) {
  const { b, cx, w } = c;
  const zz = z ?? (c.z1 - depth / 2 - 0.15);
  b.box(w - 0.3, h, depth, cx, y + h / 2, zz, body);
  b.box(w - 0.24, 0.06, depth + 0.08, cx, y + h + 0.03, zz, top);
  b.box(w - 0.3, 0.05, 0.05, cx, y + 0.12, zz + depth / 2, 0x4a3a28);   // kick rail
}

function stools(c, { n = 4, y = 0, h = 0.68, z = null, seat = 0x8a2a2a }) {
  const { b, x0, x1, w } = c;
  const zz = z ?? (c.z1 - 0.95);
  for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * (w / n);
    b.cylOn(0.045, h - 0.06, x, y, zz, 0xb8bcc0, null, 8);
    b.cyl(0.16, 0.075, x, y + h, zz, seat, null, 14);
    b.cyl(0.13, 0.02, x, y + 0.12, zz, 0xb8bcc0, null, 10);
  }
}

function table(c, x, z, { y = 0, h = 0.74, r = 0.34, top = 0x8a6a4a, leg = 0x3a3a3e }) {
  const { b } = c;
  b.cylOn(0.05, h - 0.04, x, y, z, leg, null, 8);
  b.cyl(r, 0.045, x, y + h, z, top, null, 14);
  b.cyl(r * 0.55, 0.03, x, y + 0.02, z, leg, null, 10);
}

function chair(c, x, z, rot, { y = 0, col = 0x4a3a2a }) {
  const { b } = c;
  b.box(0.34, 0.05, 0.34, x, y + 0.44, z, col, { y: rot });
  b.box(0.34, 0.42, 0.05, x - Math.sin(rot) * 0.15, y + 0.66, z - Math.cos(rot) * 0.15, col, { y: rot });
  for (const [ox, oz] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]]) {
    b.box(0.035, 0.44, 0.035, x + ox, y + 0.22, z + oz, col);
  }
}

/** A lit sign or screen hung on the back wall. */
function wallScreen(c, x, y, w, h, color, { z = null, frame = 0x1a1a1e } = {}) {
  const { b, em } = c;
  const zz = z ?? (c.z0 + 0.06);
  b.box(w + 0.06, h + 0.06, 0.04, x, y, zz, frame);
  em.box(w, h, 0.02, x, y, zz + 0.03, color);
}

const hsl = (h, s, l) => {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
};

/** A few things on the floor that nobody tidied. */
function addLitter(c) {
  const { b, rnd, x0, x1, z0, z1 } = c;
  for (let i = 0; i < rnd.int(0, 3); i++) {
    b.box(rnd.range(0.1, 0.3), rnd.range(0.08, 0.26), rnd.range(0.1, 0.3),
      rnd.range(x0 + 0.2, x1 - 0.2), c.y0 + 0.08, rnd.range(z0 + 0.2, z1 - 0.3),
      c.tint(rnd), { y: rnd.range(0, 3) });
  }
}

/* ══════════════════════════ the shops ══════════════════════════ */

const SHOPS = {
  /* ── 1945 ─────────────────────────────────────────────────── */
  apothecary(c) {
    const { b, em, cx, w, rnd } = c;
    shelfRun(c, { y: c.y0 + 0.55, tiers: 4, gap: 0.44, frame: 0x5a3a24,
      fill: (r) => hsl(r.int(20, 45), 30, r.int(55, 80)) });   // apothecary jars
    counter(c, { y: c.y0, h: 0.98, depth: 0.62, top: 0xd8cdb8, body: 0x7a4a30 });
    stools(c, { n: Math.max(3, Math.round(w / 0.62)), y: c.y0, seat: 0x9a2a2a });
    // Soda fountain: taps, a mirror, and a row of glasses.
    for (let i = 0; i < 3; i++) {
      b.cylOn(0.035, 0.34, cx - 0.35 + i * 0.35, c.y0 + 1.01, c.z1 - 0.62, 0xc8ccd0, null, 8);
      b.box(0.1, 0.03, 0.12, cx - 0.35 + i * 0.35, c.y0 + 1.34, c.z1 - 0.56, 0xc8ccd0);
    }
    for (let i = 0; i < 6; i++) b.cylOn(0.045, 0.14, cx - 0.6 + i * 0.24, c.y0 + 1.04, c.z1 - 0.42, 0xd8e8f0, null, 8);
    wallScreen(c, cx, c.y0 + 1.9, w * 0.45, 0.5, 0x2a6a5a);   // painted price board
    em.box(w * 0.7, 0.05, 0.05, cx, c.y1 - 0.12, c.cz, 0xfff0d0);
  },

  fivedime(c) {
    const { b, rnd, w, x0 } = c;
    for (let t = 0; t < 3; t++) shelfRun(c, { y: c.y0 + 0.35 + t * 0.62, tiers: 1, gap: 0.6, depth: 0.34, frame: 0x6a5230 });
    // Island bins of small goods — a dime store sold everything loose, in
    // shallow divided trays on trestles you could reach across.
    const bins = Math.max(2, Math.round(w / 0.78));
    for (let i = 0; i < bins; i++) {
      const x = x0 + (i + 0.5) * (w / bins);
      const bw = w / bins - 0.16;
      b.box(bw, 0.07, 0.46, x, c.y0 + 0.72, c.z1 - 0.7, 0x8a6a3a);                 // tray floor
      for (const s2 of [-1, 1]) b.box(bw, 0.13, 0.03, x, c.y0 + 0.79, c.z1 - 0.7 + s2 * 0.22, 0x9a7a48);
      for (const s2 of [-1, 1]) b.box(0.03, 0.13, 0.46, x + s2 * bw / 2, c.y0 + 0.79, c.z1 - 0.7, 0x9a7a48);
      b.box(0.03, 0.11, 0.44, x, c.y0 + 0.78, c.z1 - 0.7, 0x9a7a48);               // divider
      for (let k = 0; k < 10; k++) {
        b.box(rnd.range(0.05, 0.09), rnd.range(0.04, 0.07), rnd.range(0.05, 0.09),
          x + rnd.range(-bw * 0.42, bw * 0.42), c.y0 + 0.78, c.z1 - 0.7 + rnd.range(-0.18, 0.18),
          c.tint(rnd), { y: rnd.range(0, 3) });
      }
      for (const s2 of [-1, 1]) b.cylOn(0.028, 0.70, x + s2 * bw * 0.4, c.y0, c.z1 - 0.7, 0x6a5230, null, 6);
      b.box(bw * 0.5, 0.10, 0.02, x, c.y0 + 0.94, c.z1 - 0.94, 0xd8cba8);          // price card
    }
    c.em.box(w * 0.8, 0.05, 0.05, c.cx, c.y1 - 0.1, c.cz, 0xfff0d0);
  },

  produce(c) {
    const { b, rnd, w, x0 } = c;
    // Crates on a slope, the good apples at the front.
    for (let r = 0; r < 3; r++) {
      const z = c.z0 + 0.35 + r * 0.5;
      const y = c.y0 + 0.75 - r * 0.16;
      b.box(w - 0.2, 0.12, 0.46, c.cx, y, z, 0x8a6a42, { x: -0.22 });
      const n = Math.max(4, Math.round(w / 0.28));
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3; k++) {
          b.sphere(rnd.range(0.035, 0.06), x0 + 0.1 + (i + 0.5) * ((w - 0.2) / n) + rnd.range(-0.04, 0.04),
            y + 0.10 + k * 0.05, z + rnd.range(-0.16, 0.16),
            rnd.pick([0xc03a2a, 0xd8a020, 0x5a8a2a, 0xe8c840, 0x8a4a20]), true);
        }
      }
    }
    counter(c, { y: c.y0, h: 0.92, depth: 0.5, top: 0xc8b090, body: 0x6a4a30 });
    b.box(0.3, 0.28, 0.24, c.cx + c.w * 0.3, c.y0 + 1.06, c.z1 - 0.4, 0xb0b4b8);   // scales
    c.em.box(w * 0.7, 0.05, 0.05, c.cx, c.y1 - 0.12, c.cz, 0xfff0d0);
  },

  barber(c) {
    const { b, em, cx, w, rnd } = c;
    // Two chairs facing a mirrored wall.
    for (let i = 0; i < 2; i++) {
      const x = cx + (i - 0.5) * Math.min(1.5, w * 0.45);
      b.cylOn(0.22, 0.34, x, c.y0, c.cz, 0xb8bcc0, null, 12);
      b.box(0.52, 0.16, 0.5, x, c.y0 + 0.44, c.cz, 0x7a2a24);
      b.box(0.52, 0.62, 0.14, x, c.y0 + 0.78, c.cz - 0.2, 0x7a2a24);
      b.box(0.5, 0.1, 0.3, x, c.y0 + 0.40, c.cz + 0.28, 0x7a2a24);
    }
    b.box(w - 0.4, 0.9, 0.05, cx, c.y0 + 1.5, c.z0 + 0.06, 0xc8d8e0);              // mirror
    b.box(w - 0.4, 0.14, 0.28, cx, c.y0 + 0.98, c.z0 + 0.16, 0x5a3a22);            // shelf
    for (let i = 0; i < 8; i++) b.cylOn(0.03, rnd.range(0.1, 0.2), cx - w * 0.4 + i * (w * 0.8 / 8), c.y0 + 1.05, c.z0 + 0.16, hsl(rnd.int(20, 60), 45, 60), null, 6);
    em.box(w * 0.6, 0.05, 0.05, cx, c.y1 - 0.12, c.cz, 0xfff0d0);
  },

  /* ── 1965 ─────────────────────────────────────────────────── */
  sundries(c) {
    for (let t = 0; t < 4; t++) shelfRun(c, { y: c.y0 + 0.3 + t * 0.46, tiers: 1, gap: 0.44, depth: 0.3, frame: 0xb8bcc0 });
    counter(c, { y: c.y0, h: 0.94, depth: 0.55, top: 0x2ea8b4, body: 0xe8e4d8 });
    c.em.box(c.w * 0.86, 0.06, 0.06, c.cx, c.y1 - 0.1, c.cz, 0xf0f8ff);
    c.em.box(c.w * 0.86, 0.06, 0.06, c.cx, c.y1 - 0.1, c.cz - c.d * 0.3, 0xf0f8ff);
  },

  supermarket(c) {
    const { b, rnd, w, x0 } = c;
    // Gondola aisles running away from the window.
    const aisles = Math.max(2, Math.round(w / 1.1));
    for (let i = 0; i < aisles; i++) {
      const x = x0 + (i + 0.5) * (w / aisles);
      for (let t = 0; t < 3; t++) {
        b.box(w / aisles - 0.24, 0.04, c.d * 0.7, x, c.y0 + 0.35 + t * 0.42, c.cz, 0xd8d8d0);
        for (let k = 0; k < 7; k++) {
          b.box(0.1, 0.16, 0.1, x + rnd.range(-0.2, 0.2), c.y0 + 0.45 + t * 0.42, c.cz + rnd.range(-c.d * 0.3, c.d * 0.3),
            c.tint(rnd));
        }
      }
      b.box(0.06, 1.3, c.d * 0.7, x, c.y0 + 0.65, c.cz, 0xc8c8c0);
    }
    // A cart by the door
    b.box(0.42, 0.36, 0.56, x0 + 0.4, c.y0 + 0.42, c.z1 - 0.5, 0xa8acb0);
    c.em.box(w * 0.9, 0.06, 0.06, c.cx, c.y1 - 0.1, c.cz, 0xf4f8ff);
  },

  television(c) {
    const { b, em, w, x0, rnd } = c;
    // Eleven sets, all tuned to the same channel, all slightly out of sync.
    const cols = Math.max(3, Math.round(w / 0.62));
    for (let r = 0; r < 3; r++) {
      b.box(w - 0.16, 0.05, 0.46, c.cx, c.y0 + 0.42 + r * 0.62, c.z0 + 0.32, 0x6a4a2a);
      for (let i = 0; i < cols; i++) {
        const x = x0 + 0.1 + (i + 0.5) * ((w - 0.2) / cols);
        const y = c.y0 + 0.47 + r * 0.62;
        b.box(0.44, 0.40, 0.38, x, y + 0.20, c.z0 + 0.32, 0x4a3a2a);
        b.box(0.34, 0.28, 0.03, x, y + 0.22, c.z0 + 0.51, 0x1a1a1e);
        em.box(0.30, 0.24, 0.02, x, y + 0.22, c.z0 + 0.53, hsl(rnd.int(190, 215), 22, rnd.int(48, 70)));
        for (let k = 0; k < 2; k++) b.cyl(0.02, 0.03, x + 0.14, y + 0.06 + k * 0.06, c.z0 + 0.52, 0xc8a850, { x: Math.PI / 2 }, 8);
      }
    }
    // Rabbit ears on the top set
    b.rod(c.cx, c.y0 + 2.1, c.z0 + 0.32, c.cx - 0.3, c.y0 + 2.5, c.z0 + 0.3, 0.012, 0xc8ccd0);
    b.rod(c.cx, c.y0 + 2.1, c.z0 + 0.32, c.cx + 0.3, c.y0 + 2.5, c.z0 + 0.3, 0.012, 0xc8ccd0);
  },

  bowling(c) {
    const { b, em, w, x0, rnd } = c;
    const lanes = Math.max(2, Math.round(w / 1.1));
    for (let i = 0; i < lanes; i++) {
      const x = x0 + (i + 0.5) * (w / lanes);
      b.box(w / lanes - 0.16, 0.05, c.d * 0.92, x, c.y0 + 0.08, c.cz, 0xd8b078);
      b.box(0.06, 0.14, c.d * 0.92, x - (w / lanes) / 2 + 0.08, c.y0 + 0.1, c.cz, 0x3a2a1a);
      b.box(0.06, 0.14, c.d * 0.92, x + (w / lanes) / 2 - 0.08, c.y0 + 0.1, c.cz, 0x3a2a1a);
      for (let p = 0; p < 6; p++) {
        b.taper(0.02, 0.045, 0.18, x + ((p % 3) - 1) * 0.13, c.y0 + 0.11, c.z0 + 0.28 + Math.floor(p / 3) * 0.14, 0xf0ece0, 8);
      }
      if (rnd.chance(0.5)) b.sphere(0.075, x + rnd.range(-0.2, 0.2), c.y0 + 0.18, c.z1 - 0.6, rnd.pick([0x1a1a2a, 0x8a1a2a, 0x2a4a8a]), true);
    }
    em.box(w * 0.9, 0.08, 0.08, c.cx, c.y1 - 0.1, c.cz, 0xffe0a0);
    wallScreen(c, c.cx, c.y0 + 2.0, w * 0.5, 0.34, 0xe8c040);   // score board
  },

  /* ── 1985 ─────────────────────────────────────────────────── */
  arcade(c) {
    const { b, em, w, x0, rnd, era } = c;
    const n = Math.max(3, Math.round(w / 0.78));
    for (let i = 0; i < n; i++) {
      const x = x0 + 0.12 + (i + 0.5) * ((w - 0.24) / n);
      const cw = (w - 0.24) / n - 0.12;
      const hue = rnd.int(0, 359);
      // Cabinet: body, angled control deck, marquee, and a screen that glows.
      b.box(cw, 1.62, 0.66, x, c.y0 + 0.81, c.z0 + 0.44, 0x18181f);
      b.box(cw, 0.10, 0.34, x, c.y0 + 0.92, c.z0 + 0.72, 0x24242e);            // control deck
      b.box(cw * 0.9, 0.05, 0.26, x, c.y0 + 0.98, c.z0 + 0.74, 0x2e2e3a, { x: -0.3 });
      em.box(cw * 0.86, 0.24, 0.03, x, c.y0 + 1.62, c.z0 + 0.76, hsl(hue, 90, 58));  // marquee
      em.box(cw * 0.78, 0.52, 0.02, x, c.y0 + 1.22, c.z0 + 0.76, hsl((hue + 40) % 360, 88, 52));
      // Joystick and buttons
      b.cylOn(0.018, 0.10, x - cw * 0.2, c.y0 + 0.98, c.z0 + 0.74, 0x1a1a1e, null, 6);
      b.sphere(0.03, x - cw * 0.2, c.y0 + 1.09, c.z0 + 0.74, 0xd82a2a, true);
      for (let k = 0; k < 3; k++) b.cyl(0.022, 0.014, x + cw * 0.08 + k * 0.07, c.y0 + 1.0, c.z0 + 0.74, hsl(k * 90, 80, 55), null, 8);
      b.box(cw, 0.06, 0.06, x, c.y0 + 0.02, c.z0 + 0.44, 0x0e0e14);
    }
    // Change machine and a taped-up high score
    b.box(0.4, 1.1, 0.3, c.x1 - 0.3, c.y0 + 0.55, c.z1 - 0.4, 0x8a2a2a);
    em.box(0.2, 0.1, 0.02, c.x1 - 0.3, c.y0 + 0.9, c.z1 - 0.25, 0x39ff6a);
    b.box(0.26, 0.34, 0.01, c.x0 + 0.3, c.y0 + 1.7, c.z0 + 0.05, 0xe8e4d8);
    em.box(w * 0.8, 0.04, 0.04, c.cx, c.y1 - 0.14, c.cz, era.palette.neon ? era.palette.neon[5] : 0xb44dff);
  },

  records(c) {
    const { b, em, w, x0, rnd } = c;
    // Browsing bins, angled so the sleeves face you.
    const bins = Math.max(2, Math.round(w / 0.9));
    for (let i = 0; i < bins; i++) {
      const x = x0 + (i + 0.5) * (w / bins);
      b.box(w / bins - 0.14, 0.84, 0.62, x, c.y0 + 0.42, c.cz, 0x3a2a22);
      for (let k = 0; k < 14; k++) {
        b.box(w / bins - 0.22, 0.30, 0.014, x, c.y0 + 0.98, c.cz - 0.26 + k * 0.038, hsl(rnd.int(0, 359), rnd.int(35, 80), rnd.int(30, 62)), { x: -0.28 });
      }
    }
    // Wall of sleeves behind
    for (let r = 0; r < 3; r++) for (let i = 0; i < Math.round(w / 0.34); i++) {
      b.box(0.30, 0.30, 0.012, x0 + 0.18 + i * 0.34, c.y0 + 1.25 + r * 0.36, c.z0 + 0.05, hsl(rnd.int(0, 359), rnd.int(40, 85), rnd.int(30, 60)));
    }
    em.box(w * 0.7, 0.05, 0.05, c.cx, c.y1 - 0.12, c.cz, 0xffd8a0);
  },

  cashwindow(c) {
    const { b, em, w } = c;
    b.box(w - 0.2, 2.2, 0.12, c.cx, c.y0 + 1.1, c.cz, 0x1a1a22);              // security wall
    b.box(0.8, 0.6, 0.06, c.cx, c.y0 + 1.15, c.cz + 0.08, 0xa8c8d8);          // acrylic window
    b.box(0.5, 0.1, 0.24, c.cx, c.y0 + 0.86, c.cz + 0.12, 0xb0b4b8);          // pass tray
    em.box(0.5, 0.16, 0.02, c.cx, c.y0 + 1.62, c.cz + 0.07, 0x39ff6a);
    for (let i = 0; i < 4; i++) b.box(w * 0.7, 0.02, 0.02, c.cx, c.y0 + 1.9 + i * 0.06, c.cz + 0.07, 0xd8d4c8);
    em.box(w * 0.5, 0.04, 0.04, c.cx, c.y1 - 0.16, c.cz + 0.2, 0xc8f0ff);
  },

  bodega(c) {
    const { b, em, w, rnd } = c;
    shelfRun(c, { y: c.y0 + 0.35, tiers: 4, gap: 0.42, depth: 0.3, frame: 0x4a4a50 });
    // Fridge cabinet with a cold glow
    b.box(w * 0.4, 1.8, 0.5, c.x1 - w * 0.24, c.y0 + 0.9, c.z0 + 0.3, 0x2a3a42);
    em.box(w * 0.34, 1.6, 0.02, c.x1 - w * 0.24, c.y0 + 0.9, c.z0 + 0.56, 0x9fd8ff);
    for (let i = 0; i < 16; i++) {
      b.box(0.07, 0.16, 0.07, c.x1 - w * 0.24 + rnd.range(-w * 0.14, w * 0.14), c.y0 + 0.35 + (i % 4) * 0.42, c.z0 + 0.5, c.tint(rnd));
    }
    counter(c, { y: c.y0, h: 1.02, depth: 0.5, top: 0x3a3a42, body: 0x5a4a3a });
    em.box(w * 0.85, 0.05, 0.05, c.cx, c.y1 - 0.1, c.cz, 0xf4fff0);
  },

  /* ── 2005 ─────────────────────────────────────────────────── */
  cybercafe(c) {
    const { b, em, w, x0, rnd } = c;
    const rows = 2, cols = Math.max(2, Math.round(w / 0.9));
    for (let r = 0; r < rows; r++) {
      const z = c.z0 + 0.45 + r * 0.85;
      b.box(w - 0.2, 0.05, 0.6, c.cx, c.y0 + 0.72, z, 0x8a7a5a);
      for (let i = 0; i < cols; i++) {
        const x = x0 + 0.12 + (i + 0.5) * ((w - 0.24) / cols);
        b.box(0.42, 0.36, 0.40, x, c.y0 + 0.95, z, 0xd8d4c8);                  // CRT
        b.box(0.34, 0.27, 0.03, x, c.y0 + 0.96, z + 0.21, 0x1a1a22);
        em.box(0.30, 0.23, 0.02, x, c.y0 + 0.96, z + 0.23, hsl(rnd.int(200, 225), 45, rnd.int(40, 62)));
        b.box(0.40, 0.03, 0.16, x, c.y0 + 0.76, z + 0.28, 0xd0ccc0);           // keyboard
        b.box(0.20, 0.42, 0.44, x - 0.28, c.y0 + 0.21, z, 0xd8d4c8);           // tower under the desk
        em.box(0.03, 0.03, 0.02, x - 0.28, c.y0 + 0.38, z + 0.23, 0x39c86a);
        if (rnd.chance(0.5)) {
          b.box(0.30, 0.30, 0.20, x, c.y0 + 0.90, z - 0.44, 0x3a3a48);         // a customer
          b.sphere(0.10, x, c.y0 + 1.14, z - 0.46, 0xd8ac84, true);
        }
      }
    }
    em.box(w * 0.9, 0.05, 0.05, c.cx, c.y1 - 0.1, c.cz, 0xdcecff);
  },

  phones(c) {
    const { b, em, w, x0, rnd } = c;
    for (let r = 0; r < 5; r++) {
      b.box(w - 0.16, 0.03, 0.22, c.cx, c.y0 + 0.5 + r * 0.34, c.z0 + 0.16, 0x9aa0a6);
      const n = Math.round(w / 0.12);
      for (let i = 0; i < n; i++) {
        b.box(0.055, 0.10, 0.02, x0 + 0.1 + (i + 0.5) * ((w - 0.2) / n), c.y0 + 0.57 + r * 0.34, c.z0 + 0.2,
          rnd.pick([0x2a2a30, 0x8a8a92, 0x4a5a8a, 0xc8c8d0]));
      }
    }
    counter(c, { y: c.y0, h: 1.0, depth: 0.5, top: 0x2a3a44, body: 0xc8ccd0 });
    for (let i = 0; i < 8; i++) b.box(0.05, 0.09, 0.02, c.cx - w * 0.3 + i * 0.09, c.y0 + 1.06, c.z1 - 0.4, rnd.pick([0x2a2a30, 0x8a8a92]));
    em.box(w * 0.9, 0.05, 0.05, c.cx, c.y1 - 0.1, c.cz, 0xf0f8ff);
  },

  dvds(c) {
    const { b, em, w, x0, rnd } = c;
    for (let r = 0; r < 4; r++) {
      b.box(w - 0.16, 0.035, 0.24, c.cx, c.y0 + 0.5 + r * 0.44, c.z0 + 0.18, 0x3a3a44);
      const n = Math.round(w / 0.16);
      for (let i = 0; i < n; i++) {
        b.box(0.13, 0.19, 0.02, x0 + 0.1 + (i + 0.5) * ((w - 0.2) / n), c.y0 + 0.61 + r * 0.44, c.z0 + 0.22, hsl(rnd.int(0, 359), 55, rnd.int(30, 55)));
      }
    }
    // Standee by the window
    b.box(0.6, 1.6, 0.03, c.x0 + 0.6, c.y0 + 0.8, c.z1 - 0.35, hsl(rnd.int(0, 359), 60, 45));
    em.box(w * 0.9, 0.05, 0.05, c.cx, c.y1 - 0.1, c.cz, 0xf0f8ff);
  },

  pho(c) {
    const { b, em, w, rnd } = c;
    const n = Math.max(1, Math.round(w / 1.5));
    for (let i = 0; i < n; i++) {
      const x = c.x0 + (i + 0.5) * (w / n);
      table(c, x, c.cz, { y: c.y0, top: 0xc8b088 });
      chair(c, x, c.cz - 0.6, 0, { y: c.y0, col: 0x6a2a2a });
      chair(c, x, c.cz + 0.6, Math.PI, { y: c.y0, col: 0x6a2a2a });
      b.cyl(0.11, 0.07, x, c.y0 + 0.78, c.cz, 0xf0ece0, null, 12);
    }
    counter(c, { y: c.y0, h: 1.0, depth: 0.5, top: 0xb8bcc0, body: 0x6a2a2a, z: c.z0 + 0.3 });
    em.box(w * 0.8, 0.05, 0.05, c.cx, c.y1 - 0.1, c.cz, 0xffe8c0);
    wallScreen(c, c.cx, c.y0 + 2.0, w * 0.55, 0.4, 0xd83a3a);
  },

  gym(c) {
    const { b, em, w, x0 } = c;
    const n = Math.max(2, Math.round(w / 1.0));
    for (let i = 0; i < n; i++) {
      const x = x0 + (i + 0.5) * (w / n);
      // Treadmill: deck, uprights, console.
      b.box(0.56, 0.18, 1.2, x, c.y0 + 0.22, c.cz, 0x2a2a32);
      b.box(0.5, 0.03, 1.0, x, c.y0 + 0.33, c.cz, 0x1a1a1e);
      b.box(0.05, 1.0, 0.05, x - 0.24, c.y0 + 0.7, c.cz + 0.5, 0x3a3a44);
      b.box(0.05, 1.0, 0.05, x + 0.24, c.y0 + 0.7, c.cz + 0.5, 0x3a3a44);
      b.box(0.52, 0.24, 0.1, x, c.y0 + 1.2, c.cz + 0.5, 0x2a2a32);
      em.box(0.4, 0.14, 0.02, x, c.y0 + 1.2, c.cz + 0.56, 0x39c8ff);
      b.box(0.52, 0.05, 0.05, x, c.y0 + 1.06, c.cz + 0.44, 0x3a3a44);
    }
    em.box(w * 0.9, 0.06, 0.06, c.cx, c.y1 - 0.1, c.cz, 0xeaf4ff);
  },

  /* ── 2025 ─────────────────────────────────────────────────── */
  coffee(c) {
    const { b, em, w, rnd } = c;
    counter(c, { y: c.y0, h: 1.05, depth: 0.62, top: 0x3a3a3e, body: 0xc8a882, z: c.z0 + 0.42 });
    // Espresso machine, grinder, a stack of cups
    b.box(0.62, 0.42, 0.42, c.cx - 0.2, c.y0 + 1.3, c.z0 + 0.42, 0x9aa0a6);
    b.box(0.6, 0.06, 0.4, c.cx - 0.2, c.y0 + 1.53, c.z0 + 0.42, 0x2a2a30);
    b.cylOn(0.07, 0.34, c.cx + 0.36, c.y0 + 1.09, c.z0 + 0.42, 0x2a2a30, null, 10);
    for (let i = 0; i < 5; i++) b.cyl(0.045, 0.09, c.cx + 0.6, c.y0 + 1.12 + i * 0.09, c.z0 + 0.42, 0xf0ece0, null, 10);
    // Bench seating along the window
    b.box(w - 0.4, 0.08, 0.42, c.cx, c.y0 + 0.44, c.z1 - 0.34, 0x8a6a4a);
    b.box(w - 0.4, 0.42, 0.06, c.cx, c.y0 + 0.68, c.z1 - 0.14, 0x8a6a4a);
    for (let i = 0; i < Math.max(1, Math.round(w / 1.3)); i++) {
      const x = c.x0 + (i + 0.6) * (w / Math.max(1, Math.round(w / 1.3)));
      table(c, x, c.z1 - 0.85, { y: c.y0, r: 0.26, top: 0x6a5a48 });
      if (rnd.chance(0.6)) {
        b.box(0.3, 0.32, 0.2, x, c.y0 + 0.92, c.z1 - 1.2, c.tint(rnd));
        b.sphere(0.1, x, c.y0 + 1.18, c.z1 - 1.22, 0xd8ac84, true);
      }
    }
    em.box(w * 0.55, 0.05, 0.05, c.cx, c.y1 - 0.14, c.cz, 0xffe0b0);
    for (let i = 0; i < 3; i++) em.sphere(0.035, c.cx - 0.6 + i * 0.6, c.y1 - 0.34, c.z1 - 0.6, 0xffd8a0, true);
  },

  refill(c) {
    const { b, em, w, x0, rnd } = c;
    // Gravity dispensers in a row, jars underneath.
    const n = Math.max(3, Math.round(w / 0.4));
    for (let i = 0; i < n; i++) {
      const x = x0 + 0.14 + (i + 0.5) * ((w - 0.28) / n);
      b.cylOn(0.10, 0.52, x, c.y0 + 1.24, c.z0 + 0.26, 0xd8dcd8, null, 10);
      b.taper(0.03, 0.10, 0.14, x, c.y0 + 1.10, c.z0 + 0.26, 0xb8bcb8, 8);
      b.box(0.16, 0.42, 0.16, x, c.y0 + 1.44, c.z0 + 0.26, hsl(rnd.int(28, 48), 35, rnd.int(45, 70)));
    }
    b.box(w - 0.24, 0.06, 0.42, c.cx, c.y0 + 1.06, c.z0 + 0.26, 0x8a9a7a);
    for (let i = 0; i < Math.round(w / 0.3); i++) {
      b.cylOn(0.055, 0.16, x0 + 0.2 + i * 0.3, c.y0 + 0.72, c.z0 + 0.26, 0xd8e4e8, null, 10);
    }
    counter(c, { y: c.y0, h: 0.96, depth: 0.5, top: 0x2a2a2e, body: 0x8a9a7a });
    em.box(w * 0.8, 0.05, 0.05, c.cx, c.y1 - 0.12, c.cz, 0xfff0d8);
  },

  climbing(c) {
    const { b, em, w, rnd } = c;
    b.box(w - 0.1, c.y1 - c.y0 - 0.2, 0.12, c.cx, (c.y0 + c.y1) / 2, c.z0 + 0.1, 0x3a4048);
    for (let i = 0; i < 40; i++) {
      b.sphere(rnd.range(0.04, 0.075), rnd.range(c.x0 + 0.2, c.x1 - 0.2), rnd.range(c.y0 + 0.4, c.y1 - 0.3), c.z0 + 0.2,
        hsl(rnd.int(0, 359), 78, 55), true);
    }
    b.box(w - 0.3, 0.22, 0.9, c.cx, c.y0 + 0.11, c.z0 + 0.7, 0x2a3a4a);   // crash mat
    em.box(w * 0.9, 0.05, 0.05, c.cx, c.y1 - 0.1, c.cz, 0xffe6c8);
  },

  dispensary(c) {
    const { b, em, w, rnd } = c;
    counter(c, { y: c.y0, h: 1.05, depth: 0.55, top: 0x1a2a1e, body: 0x2a3a2e });
    for (let r = 0; r < 3; r++) {
      b.box(w - 0.3, 0.04, 0.26, c.cx, c.y0 + 1.3 + r * 0.36, c.z0 + 0.2, 0x2a3a2e);
      for (let i = 0; i < Math.round(w / 0.22); i++) {
        b.cylOn(0.045, 0.13, c.x0 + 0.2 + i * 0.22, c.y0 + 1.34 + r * 0.36, c.z0 + 0.2, 0xd8d8cc, null, 8);
      }
      em.box(w - 0.34, 0.02, 0.02, c.cx, c.y0 + 1.28 + r * 0.36, c.z0 + 0.31, 0x7fd6a0);
    }
    em.box(w * 0.7, 0.05, 0.05, c.cx, c.y1 - 0.12, c.cz, 0xd8ffe8);
  },

  /* ── 2055 ─────────────────────────────────────────────────── */
  printmeal(c) {
    const { b, em, w, x0 } = c;
    const n = Math.max(2, Math.round(w / 0.9));
    for (let i = 0; i < n; i++) {
      const x = x0 + 0.15 + (i + 0.5) * ((w - 0.3) / n);
      b.box((w - 0.3) / n - 0.16, 1.5, 0.68, x, c.y0 + 0.78, c.z0 + 0.42, 0x1a2226);
      em.box((w - 0.3) / n - 0.30, 0.05, 0.02, x, c.y0 + 1.38, c.z0 + 0.77, 0x9fe870);
      em.box((w - 0.3) / n - 0.30, 0.35, 0.02, x, c.y0 + 0.92, c.z0 + 0.77, 0x2a6a4a);
      b.box((w - 0.3) / n - 0.24, 0.30, 0.08, x, c.y0 + 0.50, c.z0 + 0.78, 0x2a3a3e);  // dispensing slot
      em.box((w - 0.3) / n - 0.34, 0.02, 0.02, x, c.y0 + 0.36, c.z0 + 0.80, 0x9fe870);
    }
    em.box(w * 0.9, 0.04, 0.04, c.cx, c.y1 - 0.12, c.cz, 0xd8ffe0);
  },

  farm(c) {
    const { b, em, w, rnd } = c;
    // Growing tiers with magenta grow lights — the giveaway of indoor farming.
    const tiers = Math.max(3, Math.round((c.y1 - c.y0) / 0.5));
    for (let t = 0; t < tiers; t++) {
      const y = c.y0 + 0.3 + t * 0.5;
      if (y > c.y1 - 0.2) break;
      b.box(w - 0.2, 0.05, 0.5, c.cx, y, c.cz, 0x2a3a34);
      em.box(w - 0.3, 0.035, 0.05, c.cx, y + 0.42, c.cz, 0xff5aa0);
      for (let i = 0; i < Math.round(w / 0.17); i++) {
        b.sphere(rnd.range(0.05, 0.085), c.x0 + 0.14 + i * 0.17, y + 0.12, c.cz + rnd.range(-0.16, 0.16),
          hsl(rnd.int(85, 135), rnd.int(40, 70), rnd.int(28, 48)), true);
      }
    }
    for (const sx of [c.x0 + 0.12, c.x1 - 0.12]) b.box(0.06, c.y1 - c.y0 - 0.2, 0.54, sx, (c.y0 + c.y1) / 2, c.cz, 0x3a4a44);
  },

  repair(c) {
    const { b, em, w, rnd } = c;
    // Benches with tools and half-disassembled things.
    b.box(w - 0.3, 0.07, 0.6, c.cx, c.y0 + 0.92, c.cz, 0x6a5a48);
    for (const sx of [c.x0 + 0.35, c.x1 - 0.35]) b.box(0.09, 0.9, 0.55, sx, c.y0 + 0.46, c.cz, 0x4a4a52);
    for (let i = 0; i < 8; i++) {
      b.box(rnd.range(0.08, 0.24), rnd.range(0.05, 0.18), rnd.range(0.08, 0.2),
        c.x0 + 0.4 + rnd.range(0, w - 0.8), c.y0 + 1.02, c.cz + rnd.range(-0.2, 0.2),
        rnd.pick([0x8a9a9a, 0x3a4a4a, 0xd8d8d0, 0x56d0e0]));
    }
    // Pegboard of tools
    b.box(w - 0.3, 0.9, 0.04, c.cx, c.y0 + 1.75, c.z0 + 0.06, 0x8a7a5a);
    for (let i = 0; i < Math.round(w / 0.22); i++) {
      b.box(0.035, rnd.range(0.12, 0.26), 0.03, c.x0 + 0.22 + i * 0.22, c.y0 + 1.75, c.z0 + 0.1, 0x3a4a52);
    }
    em.box(w * 0.85, 0.05, 0.05, c.cx, c.y1 - 0.1, c.cz, 0xd8f4ff);
  },

  spa(c) {
    const { b, em, w } = c;
    const n = Math.max(2, Math.round(w / 1.1));
    for (let i = 0; i < n; i++) {
      const x = c.x0 + (i + 0.5) * (w / n);
      // Reclined pods
      b.box(0.62, 0.34, 1.5, x, c.y0 + 0.44, c.cz, 0x2a1e2e, { x: -0.14 });
      b.box(0.66, 0.5, 0.5, x, c.y0 + 0.74, c.cz - 0.6, 0x1e1622);
      em.box(0.5, 0.03, 0.4, x, c.y0 + 0.98, c.cz - 0.6, 0xe864c8);
      em.box(0.55, 0.02, 1.2, x, c.y0 + 0.26, c.cz, 0xe864c8);
    }
    em.box(w * 0.8, 0.04, 0.04, c.cx, c.y1 - 0.14, c.cz, 0xe8a0e0);
  },

  default(c) {
    shelfRun(c, { y: c.y0 + 0.35, tiers: 4, gap: 0.44, depth: 0.3, frame: 0x4a4a50 });
    counter(c, { y: c.y0, h: 0.95, depth: 0.5 });
    c.em.box(c.w * 0.8, 0.05, 0.05, c.cx, c.y1 - 0.12, c.cz, 0xfff0d8);
  },
};

export const INTERIOR_KINDS = Object.keys(SHOPS);
