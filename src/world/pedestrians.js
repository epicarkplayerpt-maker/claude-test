/**
 * Crowd.
 *
 * Pedestrians are the cheapest era signal per polygon in the whole scene — a
 * silhouette with a fedora reads as 1945 from forty metres, and the same
 * silhouette in a windbreaker with a boombox reads as 1985. So the wardrobe is
 * data-driven from the era table, the *proportions* shift by decade (1945 has
 * wide shoulders and a high waist; 1985 has shoulder pads; 2025 wears
 * everything oversized), and the anatomy is detailed enough to hold up when you
 * walk right past someone.
 *
 * Performance: one `InstancedMesh` per body part rather than one Group per
 * person. Fifty animated pedestrians with bending elbows, turning heads and
 * per-person wardrobes cost about thirty draw calls instead of a thousand.
 * Limb transforms are recomputed on the CPU each frame and written straight
 * into the instance matrices — at this crowd size that is far cheaper than a
 * skinning setup, and it keeps every behaviour readable in plain JS.
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
   a plain rotation with no offset bookkeeping. Vertex colours inside a part
   give it internal detail (a lapel, a shoe sole, a hat band) while the
   per-person instance colour tints the whole thing. */

function partGeometries() {
  const mk = (fn) => { const b = new Bucket(); fn(b); return b.build(); };
  const W = 0xffffff;          // takes the instance colour unchanged
  const D = 0xb4b4b4;          // a shade darker
  const DD = 0x8a8a8a;         // darker still — creases, undersides
  const L = 0xe8e8e8;          // a shade lighter — highlights, collars

  return {
    /* ── head ───────────────────────────────────────────────────── */
    head: mk((b) => {
      // Skull built from three stacked boxes so the profile has a brow, a
      // cheekbone line and a jaw rather than reading as a cube.
      b.box(0.170, 0.085, 0.185, 0, 0.185, -0.004, W);   // cranium
      b.box(0.180, 0.070, 0.190, 0, 0.128, 0.000, W);    // brow / temples
      b.box(0.160, 0.070, 0.170, 0, 0.068, 0.006, W);    // cheeks
      b.box(0.120, 0.045, 0.140, 0, 0.028, 0.012, D);    // jaw
      b.box(0.034, 0.038, 0.030, 0, 0.096, 0.096, L);    // nose
      b.box(0.048, 0.014, 0.014, -0.040, 0.128, 0.090, DD); // brow ridges
      b.box(0.048, 0.014, 0.014, 0.040, 0.128, 0.090, DD);
      b.box(0.026, 0.030, 0.014, -0.041, 0.120, 0.086, 0x3a3a3a); // eyes
      b.box(0.026, 0.030, 0.014, 0.041, 0.120, 0.086, 0x3a3a3a);
      b.box(0.040, 0.012, 0.012, 0, 0.046, 0.084, DD);   // mouth
      b.box(0.022, 0.052, 0.042, -0.088, 0.110, 0.000, D);  // ears
      b.box(0.022, 0.052, 0.042, 0.088, 0.110, 0.000, D);
      b.box(0.088, 0.075, 0.080, 0, -0.020, -0.004, D);  // neck
    }),

    /* ── hair ───────────────────────────────────────────────────── */
    hairShort: mk((b) => {
      b.box(0.186, 0.062, 0.200, 0, 0.216, -0.006, W);
      b.box(0.196, 0.048, 0.056, 0, 0.180, -0.086, W);
      b.box(0.190, 0.030, 0.030, 0, 0.160, 0.086, D);    // fringe
      b.box(0.030, 0.070, 0.180, -0.093, 0.170, -0.010, W);  // sides
      b.box(0.030, 0.070, 0.180, 0.093, 0.170, -0.010, W);
    }),
    hairLong: mk((b) => {
      b.box(0.196, 0.070, 0.210, 0, 0.216, -0.006, W);
      b.box(0.210, 0.230, 0.090, 0, 0.075, -0.104, W);   // fall down the back
      b.box(0.048, 0.180, 0.060, -0.098, 0.090, -0.020, W);  // framing the face
      b.box(0.048, 0.180, 0.060, 0.098, 0.090, -0.020, W);
      b.box(0.170, 0.034, 0.036, 0, 0.176, 0.082, D);
    }),
    hairBun: mk((b) => {
      b.box(0.186, 0.062, 0.196, 0, 0.214, -0.006, W);
      b.sphere(0.052, 0, 0.238, -0.108, W, true);
      b.box(0.190, 0.040, 0.050, 0, 0.182, -0.080, D);
    }),
    hairAfro: mk((b) => {
      b.sphere(0.132, 0, 0.198, -0.008, W, true);
      b.sphere(0.086, -0.084, 0.166, -0.010, W, true);
      b.sphere(0.086, 0.084, 0.166, -0.010, W, true);
      b.sphere(0.078, 0, 0.170, -0.098, W, true);
    }),
    hairBeehive: mk((b) => {
      b.box(0.182, 0.056, 0.196, 0, 0.212, -0.006, W);
      b.taper(0.052, 0.096, 0.150, 0, 0.230, -0.020, W, 10);
      b.sphere(0.056, 0, 0.386, -0.024, W, true);
    }),
    hairMullet: mk((b) => {
      b.box(0.184, 0.058, 0.196, 0, 0.214, -0.006, W);
      b.box(0.200, 0.026, 0.036, 0, 0.180, 0.086, W);
      b.box(0.180, 0.170, 0.058, 0, 0.108, -0.108, W);   // business at the front…
      b.box(0.036, 0.130, 0.070, -0.090, 0.120, -0.050, W);
      b.box(0.036, 0.130, 0.070, 0.090, 0.120, -0.050, W);
    }),
    hairPomp: mk((b) => {
      b.box(0.180, 0.054, 0.192, 0, 0.210, -0.010, W);
      b.box(0.150, 0.086, 0.070, 0, 0.246, 0.060, W);    // the quiff
      b.box(0.026, 0.060, 0.170, -0.092, 0.166, -0.010, D);
      b.box(0.026, 0.060, 0.170, 0.092, 0.166, -0.010, D);
    }),
    hairBald: mk((b) => {
      b.box(0.030, 0.056, 0.170, -0.092, 0.162, -0.014, W);
      b.box(0.030, 0.056, 0.170, 0.092, 0.162, -0.014, W);
      b.box(0.160, 0.030, 0.044, 0, 0.170, -0.086, W);
    }),

    /* ── hats ───────────────────────────────────────────────────── */
    fedora: mk((b) => {
      b.taper(0.104, 0.116, 0.130, 0, 0.196, -0.006, W, 14);
      b.box(0.110, 0.046, 0.030, 0, 0.286, 0.052, DD);   // crown pinch
      b.cyl(0.215, 0.020, 0, 0.200, -0.010, W, null, 16);
      b.cyl(0.222, 0.008, 0, 0.192, 0.030, W, { x: 0.10 }, 16);  // brim snapped down at the front
      b.cyl(0.120, 0.024, 0, 0.216, -0.006, DD, null, 14);       // grosgrain band
    }),
    flatcap: mk((b) => {
      b.taper(0.100, 0.112, 0.072, 0, 0.198, -0.014, W, 12);
      b.box(0.210, 0.024, 0.128, 0, 0.196, 0.078, W, { x: -0.16 });
      b.box(0.200, 0.020, 0.030, 0, 0.212, 0.020, D);
    }),
    ladyhat: mk((b) => {
      b.taper(0.076, 0.092, 0.086, 0, 0.202, -0.018, W, 12);
      b.cyl(0.184, 0.014, 0, 0.208, -0.018, W, { x: 0.12 }, 16);
      b.sphere(0.030, 0.062, 0.244, -0.070, L, true);
      b.box(0.026, 0.010, 0.090, 0.070, 0.230, -0.020, D);   // feather
    }),
    cap: mk((b) => {
      b.taper(0.100, 0.114, 0.080, 0, 0.196, -0.002, W, 12);
      b.box(0.190, 0.022, 0.120, 0, 0.190, 0.098, W, { x: -0.10 });
      b.sphere(0.016, 0, 0.278, -0.002, D, true);
      b.box(0.196, 0.030, 0.020, 0, 0.198, 0.062, D);
    }),
    beanie: mk((b) => {
      b.taper(0.104, 0.114, 0.128, 0, 0.190, -0.004, W, 12);
      b.cyl(0.118, 0.042, 0, 0.200, -0.004, D, null, 12);    // rolled brim
      b.sphere(0.030, 0, 0.326, -0.004, L, true);
    }),
    pillbox: mk((b) => {
      b.cyl(0.108, 0.086, 0, 0.238, -0.016, W, null, 14);
      b.cyl(0.112, 0.012, 0, 0.198, -0.016, D, null, 14);
    }),
    garrison: mk((b) => {
      b.box(0.192, 0.098, 0.150, 0, 0.216, -0.004, W);
      b.box(0.046, 0.116, 0.156, 0, 0.226, -0.004, L);
      b.box(0.196, 0.022, 0.030, 0, 0.172, 0.062, D);
    }),
    visor: mk((b) => {
      b.box(0.205, 0.058, 0.020, 0, 0.126, 0.104, W);
      b.box(0.044, 0.040, 0.150, -0.098, 0.130, 0.030, D);
      b.box(0.044, 0.040, 0.150, 0.098, 0.130, 0.030, D);
      b.box(0.170, 0.016, 0.016, 0, 0.158, 0.098, L);
    }),
    hood: mk((b) => {
      b.box(0.234, 0.204, 0.232, 0, 0.176, -0.026, W);
      b.box(0.200, 0.150, 0.040, 0, 0.150, -0.140, D);
      b.box(0.190, 0.030, 0.120, 0, 0.256, 0.058, D);
      b.box(0.060, 0.180, 0.036, -0.108, 0.110, 0.020, W);
      b.box(0.060, 0.180, 0.036, 0.108, 0.110, 0.020, W);
    }),
    bucket: mk((b) => {
      b.taper(0.106, 0.114, 0.096, 0, 0.196, -0.004, W, 12);
      b.cyl(0.176, 0.024, 0, 0.198, -0.004, W, { x: 0.16 }, 14);
    }),
    turban: mk((b) => {
      b.taper(0.108, 0.120, 0.132, 0, 0.192, -0.004, W, 12);
      for (let i = 0; i < 3; i++) b.cyl(0.122 - i * 0.006, 0.036, 0, 0.206 + i * 0.040, -0.004, i % 2 ? D : W, null, 12);
    }),
    headscarf: mk((b) => {
      b.box(0.192, 0.120, 0.200, 0, 0.180, -0.010, W);
      b.box(0.150, 0.070, 0.040, 0, 0.104, -0.104, D);
      b.box(0.070, 0.026, 0.070, 0, 0.070, -0.120, W, { x: 0.5 });
    }),

    /* ── torso ──────────────────────────────────────────────────── */
    /* Built to the *unit* proportions; per-era shoulder width and waist height
       are applied as a non-uniform instance scale. */
    torso: mk((b) => {
      b.box(0.400, 0.190, 0.228, 0, 0.500, 0.000, W);     // chest
      b.box(0.372, 0.180, 0.212, 0, 0.330, 0.004, W);     // midriff
      b.box(0.356, 0.160, 0.206, 0, 0.180, 0.006, W);     // waist
      b.box(0.428, 0.092, 0.240, 0, 0.590, -0.002, W);    // shoulder yoke
      b.box(0.150, 0.056, 0.070, 0, 0.628, 0.000, L);     // collar
      b.box(0.146, 0.300, 0.026, 0, 0.430, 0.108, L);     // shirt placket
      b.box(0.072, 0.220, 0.030, -0.076, 0.470, 0.104, D);// lapels
      b.box(0.072, 0.220, 0.030, 0.076, 0.470, 0.104, D);
      b.box(0.026, 0.026, 0.014, 0, 0.352, 0.118, DD);    // buttons
      b.box(0.026, 0.026, 0.014, 0, 0.262, 0.118, DD);
      b.box(0.404, 0.040, 0.232, 0, 0.104, 0.004, DD);    // hem
    }),
    hips: mk((b) => {
      b.box(0.336, 0.170, 0.206, 0, -0.082, 0.000, W);
      b.box(0.344, 0.036, 0.212, 0, -0.008, 0.000, D);    // belt
      b.box(0.052, 0.030, 0.020, 0, -0.008, 0.108, DD);   // buckle
    }),

    /* ── arms ───────────────────────────────────────────────────── */
    upperArm: mk((b) => {
      b.box(0.112, 0.150, 0.118, 0, -0.086, 0, W);
      b.box(0.104, 0.130, 0.110, 0, -0.224, 0, W);
      b.sphere(0.062, 0, -0.010, 0, W, true);             // shoulder cap
    }),
    foreArm: mk((b) => {
      b.box(0.096, 0.140, 0.102, 0, -0.078, 0, W);
      b.box(0.086, 0.110, 0.092, 0, -0.200, 0, W);
      b.box(0.098, 0.030, 0.104, 0, -0.256, 0, L);        // cuff
    }),
    hand: mk((b) => {
      b.box(0.074, 0.084, 0.052, 0, -0.042, 0, W);
      b.box(0.030, 0.052, 0.044, 0.040, -0.026, 0.006, W); // thumb
    }),

    /* ── legs ───────────────────────────────────────────────────── */
    thigh: mk((b) => {
      b.box(0.148, 0.180, 0.160, 0, -0.100, 0, W);
      b.box(0.134, 0.180, 0.146, 0, -0.290, 0, W);
      b.sphere(0.070, 0, -0.020, 0, W, true);             // hip cap
    }),
    shin: mk((b) => {
      b.box(0.128, 0.170, 0.136, 0, -0.096, 0.002, W);
      b.box(0.112, 0.180, 0.120, 0, -0.286, 0.004, W);
      b.sphere(0.058, 0, -0.016, 0, W, true);             // knee
    }),
    shoe: mk((b) => {
      b.box(0.126, 0.062, 0.150, 0, -0.032, 0.036, 0x8f8f8f);
      b.box(0.116, 0.048, 0.086, 0, -0.070, 0.070, 0x6a6a6a);   // toe
      b.box(0.130, 0.026, 0.160, 0, -0.086, 0.030, 0x4a4a4a);   // sole
      b.box(0.110, 0.048, 0.056, 0, -0.050, -0.048, 0x7a7a7a);  // heel counter
    }),
    heel: mk((b) => {
      b.box(0.112, 0.056, 0.130, 0, -0.038, 0.032, 0x8f8f8f);
      b.box(0.100, 0.040, 0.070, 0, -0.062, 0.072, 0x6a6a6a);
      b.box(0.046, 0.060, 0.046, 0, -0.086, -0.036, 0x4a4a4a);  // the actual heel
    }),

    /* ── garments ───────────────────────────────────────────────── */
    skirt: mk((b) => {
      b.push(new THREE.CylinderGeometry(0.196, 0.330, 0.430, 12, 1),
        new THREE.Matrix4().makeTranslation(0, -0.215, 0), W);
      b.push(new THREE.CylinderGeometry(0.332, 0.336, 0.030, 12, 1),
        new THREE.Matrix4().makeTranslation(0, -0.430, 0), D);
    }),
    longSkirt: mk((b) => {
      b.push(new THREE.CylinderGeometry(0.198, 0.300, 0.700, 12, 1),
        new THREE.Matrix4().makeTranslation(0, -0.350, 0), W);
      b.push(new THREE.CylinderGeometry(0.302, 0.306, 0.028, 12, 1),
        new THREE.Matrix4().makeTranslation(0, -0.700, 0), D);
    }),
    coatTail: mk((b) => {
      b.box(0.400, 0.400, 0.244, 0, -0.200, 0, W);
      b.box(0.404, 0.034, 0.248, 0, -0.400, 0, DD);
      b.box(0.020, 0.380, 0.030, 0, -0.196, 0.126, DD);   // centre vent
    }),
    apron: mk((b) => {
      b.box(0.300, 0.420, 0.020, 0, -0.180, 0.116, W);
      b.box(0.200, 0.180, 0.020, 0, 0.120, 0.116, W);
    }),

    /* ── carried things ─────────────────────────────────────────── */
    briefcase: mk((b) => {
      b.box(0.300, 0.230, 0.086, 0, -0.115, 0, W);
      b.box(0.310, 0.024, 0.094, 0, -0.115, 0, DD);       // seam
      b.box(0.090, 0.050, 0.014, 0, 0.020, 0, DD);        // handle
      b.box(0.030, 0.026, 0.020, -0.080, -0.036, 0.048, L);
      b.box(0.030, 0.026, 0.020, 0.080, -0.036, 0.048, L);
    }),
    shoppingBag: mk((b) => {
      b.box(0.230, 0.280, 0.130, 0, -0.140, 0, W);
      b.box(0.100, 0.060, 0.012, 0, 0.020, 0.050, D);
      b.box(0.234, 0.030, 0.134, 0, -0.278, 0, D);
      b.box(0.120, 0.070, 0.090, 0.030, -0.008, 0, 0x8ab06a);  // greens sticking out
    }),
    boombox: mk((b) => {
      b.box(0.540, 0.250, 0.150, 0, 0, 0, W);
      b.cyl(0.090, 0.036, -0.160, 0, 0.082, 0x2a2a2e, { x: Math.PI / 2 }, 12);
      b.cyl(0.090, 0.036, 0.160, 0, 0.082, 0x2a2a2e, { x: Math.PI / 2 }, 12);
      b.cyl(0.060, 0.020, -0.160, 0, 0.096, 0x6a6a70, { x: Math.PI / 2 }, 10);
      b.cyl(0.060, 0.020, 0.160, 0, 0.096, 0x6a6a70, { x: Math.PI / 2 }, 10);
      b.box(0.150, 0.090, 0.024, 0, 0.020, 0.082, 0x3a3a40);   // cassette door
      b.box(0.560, 0.036, 0.040, 0, 0.136, 0, D);              // carry handle
      for (let i = 0; i < 5; i++) b.box(0.016, 0.030, 0.016, -0.040 + i * 0.020, -0.086, 0.080, 0xc8c8c8);
    }),
    backpack: mk((b) => {
      b.box(0.280, 0.360, 0.170, 0, 0, 0, W);
      b.box(0.230, 0.140, 0.050, 0, -0.090, -0.100, D);   // front pocket
      b.box(0.040, 0.300, 0.030, -0.150, 0.010, 0.100, D);// straps
      b.box(0.040, 0.300, 0.030, 0.150, 0.010, 0.100, D);
      b.box(0.290, 0.028, 0.180, 0, 0.184, 0, DD);
    }),
    deliveryBag: mk((b) => {
      b.box(0.400, 0.420, 0.300, 0, 0, 0, W);
      b.box(0.410, 0.030, 0.310, 0, 0.216, 0, DD);
      b.box(0.240, 0.180, 0.020, 0, 0.020, -0.156, L);    // logo panel
      b.box(0.040, 0.320, 0.030, -0.200, 0.020, 0.130, D);
      b.box(0.040, 0.320, 0.030, 0.200, 0.020, 0.130, D);
    }),
    dog: mk((b) => {
      b.box(0.150, 0.170, 0.380, 0, 0.270, 0, W);
      b.box(0.130, 0.130, 0.150, 0, 0.330, 0.240, W);     // head
      b.box(0.060, 0.060, 0.070, 0, 0.300, 0.330, D);     // muzzle
      b.box(0.040, 0.070, 0.020, -0.048, 0.400, 0.216, D);// ears
      b.box(0.040, 0.070, 0.020, 0.048, 0.400, 0.216, D);
      b.box(0.048, 0.250, 0.048, -0.052, 0.130, 0.140, W);
      b.box(0.048, 0.250, 0.048, 0.052, 0.130, 0.140, W);
      b.box(0.048, 0.250, 0.048, -0.052, 0.130, -0.140, W);
      b.box(0.048, 0.250, 0.048, 0.052, 0.130, -0.140, W);
      b.box(0.040, 0.150, 0.040, 0, 0.350, -0.200, D, { x: -0.7 });
    }),
    skateboard: mk((b) => {
      b.box(0.200, 0.030, 0.800, 0, 0, 0, W);
      b.box(0.190, 0.014, 0.180, 0, 0.024, 0.320, 0x2a2a2e);
      b.box(0.190, 0.014, 0.180, 0, 0.024, -0.320, 0x2a2a2e);
      for (const [ox, oz] of [[-0.075, 0.270], [0.075, 0.270], [-0.075, -0.270], [0.075, -0.270]]) {
        b.cyl(0.036, 0.050, ox, -0.050, oz, 0xd8d0b0, { z: Math.PI / 2 }, 10);
      }
      b.box(0.130, 0.040, 0.040, 0, -0.036, 0.270, 0xa8a8b0);
      b.box(0.130, 0.040, 0.040, 0, -0.036, -0.270, 0xa8a8b0);
    }),
    umbrella: mk((b) => {
      b.cyl(0.014, 0.760, 0, -0.380, 0, 0x3a3a3e, null, 8);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        b.box(0.300, 0.016, 0.060, Math.cos(a) * 0.190, 0.030, Math.sin(a) * 0.190, W, { y: -a, z: 0.34 });
      }
      b.cone(0.036, 0.070, 0, 0.096, 0, W);
      b.box(0.020, 0.090, 0.070, 0, -0.740, 0.030, 0x6a4a2a, { x: 0.9 });
    }),
    newspaper: mk((b) => {
      b.box(0.230, 0.300, 0.020, 0, 0, 0, 0xe8e4d8, { x: 0.28 });
      b.box(0.230, 0.020, 0.040, 0, 0.140, 0, 0xd0ccc0);
      b.box(0.180, 0.036, 0.024, 0, 0.090, 0.014, 0x3a3a3a);   // masthead
      for (let i = 0; i < 5; i++) b.box(0.170, 0.010, 0.022, 0, 0.020 - i * 0.032, 0.014, 0x9a9a9a);
    }),
    coffee: mk((b) => {
      b.taper(0.042, 0.034, 0.110, 0, -0.055, 0, W, 12);
      b.cyl(0.046, 0.016, 0, 0.058, 0, D, null, 12);
      b.cyl(0.044, 0.026, 0, -0.020, 0, DD, null, 12);   // cardboard sleeve
    }),
    phone: mk((b) => {
      b.box(0.072, 0.140, 0.014, 0, 0, 0, 0x1a1a1e);
      b.box(0.062, 0.124, 0.006, 0, 0, 0.010, 0x8ad0f0);
    }),
    flipphone: mk((b) => {
      b.box(0.056, 0.100, 0.020, 0, 0, 0, 0x2a2a30);
      b.box(0.056, 0.090, 0.018, 0, 0.088, -0.014, 0x2a2a30, { x: -0.5 });
      b.box(0.044, 0.036, 0.006, 0, 0.088, -0.002, 0x8ac0d8, { x: -0.5 });
      b.cyl(0.006, 0.070, 0.024, 0.078, -0.008, 0x1a1a1e, null, 6);
    }),
    transistor: mk((b) => {
      b.box(0.100, 0.150, 0.040, 0, 0, 0, W);
      b.cyl(0.034, 0.010, -0.020, 0.028, 0.022, 0x3a3a3a, { x: Math.PI / 2 }, 10);
      b.cyl(0.018, 0.014, 0.032, -0.040, 0.020, 0xd8d0b0, { x: Math.PI / 2 }, 10);
    }),
    camera: mk((b) => {
      b.box(0.140, 0.090, 0.060, 0, 0, 0, 0x2a2a2e);
      b.cyl(0.032, 0.060, 0, 0, 0.056, 0x1a1a1e, { x: Math.PI / 2 }, 12);
      b.cyl(0.036, 0.012, 0, 0, 0.088, 0x8ad0f0, { x: Math.PI / 2 }, 12);
      b.box(0.030, 0.026, 0.030, 0.046, 0.056, 0, 0xc8c8c8);
    }),
    toteBag: mk((b) => {
      b.box(0.280, 0.320, 0.100, 0, -0.160, 0, W);
      b.box(0.024, 0.180, 0.014, -0.090, 0.070, 0, W);
      b.box(0.024, 0.180, 0.014, 0.090, 0.070, 0, W);
      b.box(0.180, 0.140, 0.014, 0, -0.160, 0.056, L);
    }),
    rollBag: mk((b) => {
      b.box(0.280, 0.420, 0.170, 0, 0.210, 0, W);
      b.box(0.290, 0.030, 0.180, 0, 0.420, 0, DD);
      b.cyl(0.014, 0.400, 0, 0.620, -0.070, 0xb0b0b8, null, 8);
      b.box(0.180, 0.020, 0.024, 0, 0.820, -0.070, 0xb0b0b8);
      b.cyl(0.044, 0.030, -0.100, 0.044, -0.056, 0x2a2a2e, { z: Math.PI / 2 }, 10);
      b.cyl(0.044, 0.030, 0.100, 0.044, -0.056, 0x2a2a2e, { z: Math.PI / 2 }, 10);
    }),
    petDrone: mk((b) => {
      b.sphere(0.096, 0, 0, 0, W, true);
      b.cyl(0.130, 0.012, 0, 0.086, 0, 0xd8dcd8, null, 12);
      b.box(0.060, 0.026, 0.014, 0, 0.010, 0.086, 0x56d0e0);
    }),
    cane: mk((b) => {
      b.cyl(0.012, 0.860, 0, -0.430, 0, W, null, 8);
      b.box(0.080, 0.024, 0.030, 0.030, 0.010, 0, W, { z: 0.4 });
      b.cyl(0.020, 0.026, 0, -0.860, 0, 0x2a2a2e, null, 8);
    }),
    cigarette: mk((b) => {
      b.cyl(0.006, 0.070, 0, 0, 0.034, 0xe8e4d8, { x: Math.PI / 2 }, 6);
    }),

    /* ── glowing trim (2055 garments, AR visors) ────────────────── */
    trim: mk((b) => {
      b.box(0.412, 0.020, 0.238, 0, 0.360, 0, W);
      b.box(0.020, 0.400, 0.238, 0.196, 0.360, 0, W);
      b.box(0.020, 0.400, 0.238, -0.196, 0.360, 0, W);
      b.box(0.120, 0.016, 0.020, 0, 0.612, 0.118, W);
    }),
    arVisor: mk((b) => {
      b.box(0.196, 0.044, 0.016, 0, 0.124, 0.100, W);
      b.box(0.040, 0.030, 0.140, -0.094, 0.128, 0.030, W);
      b.box(0.040, 0.030, 0.140, 0.094, 0.128, 0.030, W);
    }),
    mask: mk((b) => {
      b.box(0.140, 0.090, 0.060, 0, 0.062, 0.082, W);
      b.box(0.030, 0.020, 0.100, -0.084, 0.088, 0.030, D);
      b.box(0.030, 0.020, 0.100, 0.084, 0.088, 0.030, D);
    }),
    earbuds: mk((b) => {
      b.box(0.020, 0.030, 0.020, -0.090, 0.106, 0.006, W);
      b.box(0.020, 0.030, 0.020, 0.090, 0.106, 0.006, W);
    }),
    glasses: mk((b) => {
      b.box(0.062, 0.048, 0.010, -0.042, 0.120, 0.092, W);
      b.box(0.062, 0.048, 0.010, 0.042, 0.120, 0.092, W);
      b.box(0.030, 0.010, 0.010, 0, 0.120, 0.092, W);
      b.box(0.014, 0.010, 0.120, -0.082, 0.122, 0.036, W);
      b.box(0.014, 0.010, 0.120, 0.082, 0.122, 0.036, W);
    }),
  };
}

const HAT_PARTS = ['fedora', 'flatcap', 'ladyhat', 'cap', 'beanie', 'pillbox',
  'garrison', 'visor', 'hood', 'bucket', 'turban', 'headscarf'];
const HAIR_PARTS = ['hairShort', 'hairLong', 'hairBun', 'hairAfro', 'hairBeehive',
  'hairMullet', 'hairPomp', 'hairBald'];

/** accessory id → { part, hold } — `hold` says how it is carried. */
const ACCESSORY = {
  briefcase:   { part: 'briefcase',   hold: 'hand' },
  shoppingbag: { part: 'shoppingBag', hold: 'hand' },
  newspaper:   { part: 'newspaper',   hold: 'read' },
  umbrella:    { part: 'umbrella',    hold: 'raised' },
  boombox:     { part: 'boombox',     hold: 'shoulder' },
  walkman:     { part: 'earbuds',     hold: 'head' },
  transistor:  { part: 'transistor',  hold: 'hand' },
  camera:      { part: 'camera',      hold: 'raised' },
  skateboard:  { part: 'skateboard',  hold: 'underarm' },
  flipphone:   { part: 'flipphone',   hold: 'ear' },
  ipod:        { part: 'earbuds',     hold: 'head' },
  coffee:      { part: 'coffee',      hold: 'hand' },
  backpack:    { part: 'backpack',    hold: 'back' },
  rollbag:     { part: 'rollBag',     hold: 'trail' },
  phone:       { part: 'phone',       hold: 'look' },
  totebag:     { part: 'toteBag',     hold: 'hand' },
  earbuds:     { part: 'earbuds',     hold: 'head' },
  deliverybag: { part: 'deliveryBag', hold: 'back' },
  dog:         { part: 'dog',         hold: 'lead' },
  arvisor:     { part: 'arVisor',     hold: 'head' },
  filtermask:  { part: 'mask',        hold: 'head' },
  petdrone:    { part: 'petDrone',    hold: 'hover' },
  satchel:     { part: 'toteBag',     hold: 'sling' },
  'cane-exo':  { part: 'cane',        hold: 'cane' },
  none:        null,
};

/**
 * Per-era body proportions. This is what makes a 1945 crowd read differently
 * from a 2025 one even in silhouette: broad padded shoulders and a high waist
 * give way to a slim 1960s line, 1980s shoulder pads, 2000s slouch, and the
 * oversized fits of the 2020s.
 */
const BUILD = {
  1945: { shoulder: 1.10, waist: 1.00, coat: 0.62, posture: 0.020, stride: 1.00, heelRate: 0.55 },
  1965: { shoulder: 1.00, waist: 0.98, coat: 0.34, posture: 0.014, stride: 1.02, heelRate: 0.50 },
  1985: { shoulder: 1.16, waist: 1.02, coat: 0.30, posture: 0.010, stride: 1.05, heelRate: 0.30 },
  2005: { shoulder: 1.06, waist: 1.06, coat: 0.22, posture: 0.030, stride: 0.98, heelRate: 0.20 },
  2025: { shoulder: 1.12, waist: 1.10, coat: 0.26, posture: 0.034, stride: 0.96, heelRate: 0.12 },
  2055: { shoulder: 1.02, waist: 1.00, coat: 0.40, posture: 0.016, stride: 0.98, heelRate: 0.10 },
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
    this.build = BUILD[1945];

    const bodyMat = mats.character();
    const emitMat = mats.emitVcol({ strength: 2.0 });
    const EMISSIVE = new Set(['trim', 'arVisor']);

    for (const key of Object.keys(this.geo)) {
      const g = this.geo[key];
      if (!g) continue;
      const m = new THREE.InstancedMesh(g, EMISSIVE.has(key) ? emitMat : bodyMat, maxCount * 2);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = !EMISSIVE.has(key);
      m.receiveShadow = false;
      m.frustumCulled = false;
      m.count = 0;
      m.visible = false;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxCount * 2 * 3).fill(1), 3);
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
    /* Places worth looking at as you pass: shop windows, the marquee, the tree. */
    this.attractors = [
      { x: 18, y: 6.6, z: -33, r: 22 },      // the Palace marquee
      { x: -2, y: 2.0, z: -33, r: 14 },      // 508 Vine window
      { x: -33, y: 2.0, z: -2, r: 14 },      // 41 Fifth window
      { x: -24, y: 4.0, z: 18, r: 20 },      // the corner lot
      { x: 24, y: 2.4, z: 33, r: 16 },       // the bank
      { x: 33, y: 2.0, z: 2, r: 14 },        // 88 Fifth window
    ];

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();
    this.wind = 0;
  }

  populate(era, eraIdx, densityScale = 1) {
    this.era = era;
    this.eraIdx = eraIdx;
    this.build = BUILD[era.year] || BUILD[2025];
    const rnd = new Rand(`crowd:${era.year}`);
    const w = era.peds;
    const n = Math.min(this.max, Math.round(38 * w.density * densityScale));
    this.people.length = 0;

    const hairFor = (dressy) => {
      const pool = era.year === 1945 ? (dressy ? ['hairLong', 'hairBun', 'hairShort'] : ['hairShort', 'hairShort', 'hairPomp', 'hairBald'])
        : era.year === 1965 ? (dressy ? ['hairBeehive', 'hairBun', 'hairShort'] : ['hairShort', 'hairPomp', 'hairShort'])
        : era.year === 1985 ? ['hairMullet', 'hairLong', 'hairAfro', 'hairShort', 'hairBeehive']
        : era.year === 2005 ? ['hairShort', 'hairLong', 'hairShort', 'hairAfro', 'hairBald']
        : era.year === 2025 ? ['hairShort', 'hairLong', 'hairBun', 'hairAfro', 'hairBald']
        : ['hairShort', 'hairBun', 'hairLong', 'hairAfro', 'hairBald'];
      return rnd.pick(pool);
    };

    for (let i = 0; i < n; i++) {
      const dress = rnd.chance(eraIdx <= 1 ? 0.42 : 0.24);
      const uniform = rnd.chance(w.uniforms || 0);
      const acc = rnd.pick(w.accessories);
      const hatKind = rnd.chance(w.hats) ? rnd.pick(w.hatKinds) : null;
      const coat = uniform ? rnd.pick([0x3d4a35, 0xf0ece0, 0x2a3a4a]) : rnd.pick(w.coats);
      const age = rnd.f();
      const child = rnd.chance(0.09);

      const person = {
        i,
        mode: rnd.chance(0.24) ? 'cross' : 'ring',
        ring: rnd.chance(0.55) ? 0 : 1,
        s: rnd.range(0, 1),
        dir: rnd.chance(0.5) ? 1 : -1,
        lateral: rnd.range(-1.25, 1.25),
        speed: w.speed * rnd.range(0.78, 1.22) * (child ? 1.12 : 1) * (age > 0.9 ? 0.7 : 1),
        cur: 0,
        phase: rnd.range(0, TAU),
        height: (child ? rnd.range(0.62, 0.76) : rnd.range(0.92, 1.07)),
        girth: rnd.range(0.92, 1.14),
        heading: 0, targetHeading: 0,
        headYaw: 0, headYawTarget: 0, headPitch: 0,
        state: 'walk', stateT: rnd.range(2, 22),
        gesture: 0, gestureT: 0,
        crossing: rnd.int(0, 3), crossT: rnd.f(), crossDir: rnd.chance(0.5) ? 1 : -1,
        dress, uniform, acc, hatKind, child, age,
        hair: hairFor(dress),
        heels: dress && rnd.chance(this.build.heelRate),
        longSkirt: dress && era.year <= 1965 && rnd.chance(0.45),
        coatTail: !dress && rnd.chance(this.build.coat),
        smokes: rnd.chance(era.year <= 1985 ? 0.16 : 0.03),
        glasses: rnd.chance(era.year === 1965 ? 0.3 : 0.16),
        col: {
          coat, shirt: rnd.pick(w.shirts), trouser: dress ? coat : rnd.pick(w.trousers),
          skin: rnd.pick(w.skin), hair: rnd.pick(w.hair),
          hat: hatKind === 'garrison' ? 0x3d4a35 : rnd.chance(0.5) ? rnd.pick(w.coats) : rnd.pick(w.trousers),
          carry: rnd.pick([0x3a2a20, 0x2a2a2e, 0x8a6a4a, 0xd8d4c8, 0x6a2a2a]),
          shoe: rnd.pick([0x2a2320, 0x1a1a1e, 0x4a3a2a, 0x6a5a4a]),
        },
        emissive: (w.emissive || 0) > 0 && rnd.chance(w.emissive * 2),
        chatPartner: -1,
        bench: null,
      };
      this.people.push(person);
    }

    /* Pair a few people up for conversations — they stop, face each other and
       gesture, which reads as a street far more than motion alone does. */
    for (let i = 0; i + 1 < this.people.length; i += 6) {
      const a = this.people[i], b = this.people[i + 1];
      if (a.mode === 'ring' && b.mode === 'ring') {
        b.ring = a.ring; b.s = a.s; b.dir = a.dir;
        b.lateral = a.lateral + 0.85;
        a.state = b.state = 'chat'; a.stateT = b.stateT = rnd.range(8, 26);
        a.chatPartner = b.i; b.chatPartner = a.i;
      }
    }

    for (const key in this.meshes) { this.meshes[key].count = 0; this.meshes[key].visible = false; }
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
      set('hand', i, p.col.skin);
      set('upperArm', i, p.col.coat);
      set('foreArm', i, p.col.coat);
      set('thigh', i, p.col.trouser);
      set('shin', i, p.col.trouser);
      set('shoe', i, p.col.shoe);
      set('heel', i, p.col.shoe);
      set('skirt', i, p.col.coat);
      set('longSkirt', i, p.col.coat);
      set('coatTail', i, p.col.coat);
      set('apron', i, p.col.shirt);
      set('briefcase', i, p.col.carry);
      set('shoppingBag', i, 0xd8cfbc);
      set('boombox', i, 0xc8ccd0);
      set('backpack', i, p.col.carry);
      set('deliveryBag', i, this.era?.accent ?? 0xe8663a);
      set('dog', i, 0xb08a5a);
      set('skateboard', i, 0xd83a5a);
      set('umbrella', i, 0x2a2a34);
      set('newspaper', i, 0xffffff);
      set('coffee', i, 0xd8d4cc);
      set('phone', i, 0xffffff);
      set('flipphone', i, 0xffffff);
      set('transistor', i, 0xd8d0b8);
      set('camera', i, 0xffffff);
      set('toteBag', i, 0xd0cbbe);
      set('rollBag', i, 0x2a2a34);
      set('petDrone', i, 0xd8dcd8);
      set('cane', i, 0x8a7a5a);
      set('cigarette', i, 0xffffff);
      set('trim', i, this.era?.accent2 ?? 0x56d0e0);
      set('arVisor', i, this.era?.accent2 ?? 0x56d0e0);
      set('mask', i, 0xdde4e8);
      set('earbuds', i, 0xf4f4f4);
      set('glasses', i, 0x2a2a30);
      for (const h of HAT_PARTS) set(h, i, p.col.hat);
      for (const h of HAIR_PARTS) set(h, i, p.col.hair);
    }
    // `_pose` packs instances densely (not everyone wears a hat), so the slot a
    // person occupies in a part mesh differs from their person index. Snapshot
    // the per-person colours and re-index them at write time.
    this._cacheColors();
    for (const key in this.meshes) this.meshes[key].instanceColor.needsUpdate = true;
  }

  /* ── per-frame ─────────────────────────────────────────────── */

  update(dt, signals, camPos, blockers, time = 0) {
    if (!this.people.length) return;
    this.wind = Math.sin(time * 0.37) * 0.6 + Math.sin(time * 0.11 + 1.7) * 0.4;
    const counts = {};
    for (const key in this.meshes) counts[key] = 0;

    for (const p of this.people) {
      this._step(p, dt, signals, camPos, time);
      this._pose(p, counts, time);
    }

    for (const key in this.meshes) {
      const m = this.meshes[key];
      m.count = counts[key];
      m.visible = counts[key] > 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  _step(p, dt, signals, camPos, time) {
    p.stateT -= dt;
    p.gestureT -= dt;

    if (p.mode === 'ring') {
      const ring = this.rings[p.ring];
      if (p.stateT <= 0) {
        // Behaviour churn: stroll, stop at a window, stand and talk, check a
        // phone, light a cigarette, tie a lace.
        const r = Math.random();
        if (p.state === 'walk') {
          p.state = r < 0.34 ? 'window'
            : r < 0.56 ? 'chat'
            : r < 0.70 ? (p.acc === 'phone' || p.acc === 'flipphone' ? 'phone' : 'window')
            : r < 0.78 && p.smokes ? 'smoke'
            : 'walk';
          p.stateT = p.state === 'walk' ? 8 + Math.random() * 20 : 3 + Math.random() * 10;
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
    let lookAt = null;
    if (camPos) {
      const dx = p.x - camPos.x, dz = p.z - camPos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.1 && d > 0.001) {
        const push = (1.1 - d) * 1.6;
        p.x += (dx / d) * push;
        p.z += (dz / d) * push;
      }
      // Some of them notice you go past.
      if (d < 6 && (p.i % 3 === 0 || p.state !== 'walk')) lookAt = camPos;
    }

    /* Otherwise, look at whatever is worth looking at nearby. */
    if (!lookAt) {
      for (const a of this.attractors) {
        const d = Math.hypot(a.x - p.x, a.z - p.z);
        if (d < a.r * 0.32) { lookAt = a; break; }
      }
    }

    p.heading = dampAngle(p.heading, p.targetHeading, 7, dt);

    /* The head turns independently of the body, clamped to a human range. */
    if (lookAt) {
      const want = Math.atan2(lookAt.x - p.x, lookAt.z - p.z);
      p.headYawTarget = clamp(angleDelta(p.heading, want), -1.15, 1.15);
      const dy = (lookAt.y ?? 1.6) - (p.y + 1.5 * p.height);
      const dh = Math.hypot(lookAt.x - p.x, lookAt.z - p.z);
      p.headPitch = damp(p.headPitch, clamp(Math.atan2(dy, dh), -0.5, 0.7), 4, dt);
    } else {
      p.headYawTarget = Math.sin(p.phase * 0.21 + p.i) * 0.18;
      p.headPitch = damp(p.headPitch, p.state === 'phone' ? 0.55 : 0, 3, dt);
    }
    p.headYaw = damp(p.headYaw, p.headYawTarget, 5, dt);

    /* Conversational gestures fire on their own clock. */
    if (p.state === 'chat' && p.gestureT <= 0) {
      p.gesture = 1;
      p.gestureT = 0.9 + Math.random() * 2.2;
    }
    p.gesture = damp(p.gesture, 0, 2.2, dt);

    p.phase += p.cur * 4.6 * this.build.stride * dt;
  }

  _pose(p, counts, time) {
    const h = p.height;
    const B = this.build;
    const walkAmt = clamp01(p.cur / Math.max(0.4, p.speed));
    const swing = Math.sin(p.phase) * 0.62 * walkAmt;
    const swing2 = Math.sin(p.phase + Math.PI) * 0.62 * walkAmt;
    const bob = Math.abs(Math.sin(p.phase)) * 0.035 * walkAmt;
    const lean = B.posture + 0.05 * walkAmt;
    const idle = Math.sin(time * 1.1 + p.i * 2.3) * 0.012 * (1 - walkAmt);

    // The pelvis is pinned so that thigh + shin + the drop through the shoe
    // land the sole exactly on the ground. Deriving it from a "waist" factor
    // instead used to lift or sink the whole person by a few centimetres per
    // era, which reads as floating.
    const HIP = 0.959 * h;
    const SHOULDER = 1.40 * h;
    const NECK = 1.47 * h;
    const rootY = p.y + bob;
    const cosH = Math.cos(p.heading), sinH = Math.sin(p.heading);

    /**
     * Place a part. Offsets are in the person's local frame (x right, y up,
     * z forward); `rx/ry/rz` rotate it about its own joint; `sc` is a uniform
     * or per-axis scale on top of the person's height.
     */
    const put = (key, ox, oy, oz, rx = 0, ry = 0, rz = 0, sc = 1, scx = null) => {
      const m = this.meshes[key];
      if (!m) return;
      const idx = counts[key]++;
      if (idx >= m.instanceMatrix.count) { counts[key]--; return; }
      const wx = p.x + ox * cosH + oz * sinH;
      const wz = p.z - ox * sinH + oz * cosH;
      this._e.set(rx, p.heading + ry, rz, 'YXZ');
      this._q.setFromEuler(this._e);
      this._v.set(wx, rootY + oy, wz);
      const s = sc * h;
      this._s.set((scx ?? 1) * s * p.girth, s, s * (scx ? (1 + (scx - 1) * 0.4) : 1));
      this._m.compose(this._v, this._q, this._s);
      m.setMatrixAt(idx, this._m);
      if (m.instanceColor) {
        const src = p.i * 3;
        m.instanceColor.array[idx * 3] = this._srcColor(key, src, 0);
        m.instanceColor.array[idx * 3 + 1] = this._srcColor(key, src, 1);
        m.instanceColor.array[idx * 3 + 2] = this._srcColor(key, src, 2);
      }
    };

    /* ── torso, head ──────────────────────────────────────────── */
    put('torso', 0, HIP, idle, lean, 0, 0, 1, B.shoulder);
    put('hips', 0, HIP, idle, 0, 0, 0, 1, B.waist);
    if (p.coatTail) put('coatTail', 0, HIP + 0.02, idle - 0.004, lean, 0, 0, 1, B.shoulder * 0.98);

    // The head is a child of the neck: body heading plus its own yaw.
    const headE = this._e;
    put('head', 0, NECK, idle * 0.6, p.headPitch - lean * 0.5, p.headYaw, 0);
    put(p.hair, 0, NECK, idle * 0.6, p.headPitch - lean * 0.5, p.headYaw, 0);
    if (p.hatKind && this.meshes[p.hatKind]) {
      put(p.hatKind, 0, NECK, idle * 0.6, p.headPitch - lean * 0.5, p.headYaw, 0);
    }
    if (p.glasses && !p.hatKind) put('glasses', 0, NECK, idle * 0.6, p.headPitch - lean * 0.5, p.headYaw, 0);

    /* ── arms, with a real elbow ──────────────────────────────── */
    const acc = ACCESSORY[p.acc];
    const hold = acc?.hold;
    const shoulderX = 0.245 * B.shoulder;
    const upperLen = 0.30 * h;

    /** Shoulder angle, elbow bend, and a small outward splay per arm. */
    const armPose = (side) => {
      const base = side < 0 ? swing : swing2;
      let sh = base, el = 0.20 + Math.max(0, -base) * 0.55, splay = side * 0.06;
      if (side > 0) {
        if (hold === 'hand' || hold === 'underarm') { sh = -0.12; el = 0.30; }
        else if (hold === 'read') { sh = -0.62; el = 1.35; splay = side * 0.22; }
        else if (hold === 'raised') { sh = -1.05; el = 1.25; }
        else if (hold === 'shoulder') { sh = -1.25; el = 1.85; splay = side * 0.30; }
        else if (hold === 'ear') { sh = -0.95; el = 1.70; splay = side * 0.28; }
        else if (hold === 'look') { sh = -0.70; el = 1.25; splay = side * 0.16; }
        else if (hold === 'lead' || hold === 'trail') { sh = -0.30; el = 0.18; }
        else if (hold === 'cane') { sh = -0.22; el = 0.22; }
      }
      if (p.state === 'chat' && p.gesture > 0.02) {
        sh -= p.gesture * (side > 0 ? 0.85 : 0.35) * (0.6 + Math.sin(time * 7 + p.i) * 0.4);
        el += p.gesture * 0.6;
      }
      if (p.state === 'smoke' && side > 0) { sh = -0.85; el = 1.55; splay = 0.24; }
      if (p.state === 'phone' && side > 0) { sh = -0.72; el = 1.30; splay = 0.14; }
      return { sh, el, splay };
    };

    for (const side of [-1, 1]) {
      const { sh, el, splay } = armPose(side);
      put('upperArm', side * shoulderX, SHOULDER, idle, sh, 0, splay);
      // Elbow position derived from the upper arm so the forearm connects.
      const ex = side * shoulderX + Math.sin(splay) * upperLen;
      const ey = SHOULDER - Math.cos(sh) * Math.cos(splay) * upperLen;
      const ez = idle + Math.sin(sh) * upperLen;
      put('foreArm', ex, ey, ez, sh + el, 0, splay);
      const foreLen = 0.27 * h;
      const hx = ex + Math.sin(splay) * foreLen * 0.4;
      const hy = ey - Math.cos(sh + el) * foreLen;
      const hz = ez + Math.sin(sh + el) * foreLen;
      put('hand', hx, hy, hz, sh + el, 0, splay);
      if (side > 0) { p._handX = hx; p._handY = hy; p._handZ = hz; p._handR = sh + el; }
    }

    /* ── legs ─────────────────────────────────────────────────── */
    const shoeKey = p.heels ? 'heel' : 'shoe';
    if (p.dress) {
      put(p.longSkirt ? 'longSkirt' : 'skirt', 0, HIP + 0.02, idle, lean * 0.4 + this.wind * 0.012);
      if (!p.longSkirt) {
        const kl = 0.44 * h;
        for (const [sideX, sw] of [[-0.105, swing], [0.105, swing2]]) {
          put('shin', sideX, HIP - 0.42 * h, idle + sw * 0.06, sw * 0.75);
          const fy = HIP - 0.42 * h - Math.cos(sw * 0.75) * kl;
          const fz = idle + sw * 0.06 + Math.sin(sw * 0.75) * kl;
          put(shoeKey, sideX, fy, fz, sw * 0.3);
        }
      }
    } else {
      const thighLen = 0.42 * h, shinLen = 0.44 * h;
      for (const [sideX, sw] of [[-0.105, swing], [0.105, swing2]]) {
        const bend = Math.max(0, -Math.sin(p.phase + (sw === swing ? 0.9 : 0.9 + Math.PI))) * 0.85 * walkAmt;
        put('thigh', sideX, HIP, idle, sw);
        const kx = sideX;
        const ky = HIP - Math.cos(sw) * thighLen;
        const kz = idle + Math.sin(sw) * thighLen;
        put('shin', kx, ky, kz, sw + bend);
        const fy = ky - Math.cos(sw + bend) * shinLen;
        const fz = kz + Math.sin(sw + bend) * shinLen;
        put(shoeKey, kx, fy, fz, (sw + bend) * 0.35);
      }
    }
    if (p.uniform) put('apron', 0, HIP, idle, lean);

    /* ── carried things ───────────────────────────────────────── */
    if (acc) {
      const k = acc.part;
      const hx = p._handX ?? 0.3, hy = p._handY ?? SHOULDER - 0.55, hz = p._handZ ?? 0.05;
      switch (hold) {
        case 'hand': put(k, hx, hy - 0.02, hz, 0, 0, 0); break;
        case 'read': put(k, hx - 0.10, hy - 0.02, hz + 0.10, -0.45, 0, 0); break;
        case 'raised': put(k, hx, hy + 0.04, hz + 0.02, 0, 0, 0); break;
        case 'shoulder': put(k, 0.30 * B.shoulder, SHOULDER + 0.12, idle + 0.02, 0, 0, 0.18); break;
        case 'ear': put(k, 0.10, NECK + 0.02, idle + 0.02, 0, -0.4, 0.4); break;
        case 'look': put(k, hx - 0.06, hy + 0.06, hz + 0.10, -0.9, 0, 0); break;
        case 'underarm': put(k, 0.34 * B.shoulder, SHOULDER - 0.30, idle + 0.04, 0, 0, 1.42); break;
        case 'back': put(k, 0, HIP + 0.36, idle - 0.20, lean); break;
        case 'sling': put(k, 0.22, HIP + 0.10, idle - 0.10, 0, 0, 0.2); break;
        case 'head': put(k, 0, NECK, idle * 0.6, p.headPitch - lean * 0.5, p.headYaw, 0); break;
        case 'lead': {
          const dogX = 0.62, dogZ = 0.52;
          put(k, dogX, 0, dogZ, 0, Math.sin(p.phase * 0.6) * 0.28, 0, 1.0);
          break;
        }
        case 'trail': put(k, 0.34, 0, -0.46, 0, 0, 0); break;
        case 'hover': put(k, -0.42, NECK + 0.34 + Math.sin(time * 1.6 + p.i) * 0.05, idle - 0.16, 0, time * 1.4, 0); break;
        case 'cane': put(k, hx + 0.06, hy, hz + 0.04, 0.12, 0, 0); break;
        default: break;
      }
    }
    if (p.state === 'smoke') {
      put('cigarette', (p._handX ?? 0.3) - 0.02, (p._handY ?? 1.2) + 0.02, (p._handZ ?? 0.1) + 0.03, 0, 0, 0);
    }
    if (p.emissive) put('trim', 0, HIP, idle, lean, 0, 0, 1, B.shoulder);
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
