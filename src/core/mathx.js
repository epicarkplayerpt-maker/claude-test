/** Small math helpers used everywhere. Frame-rate independent where it matters. */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v, a, b, c, d) => lerp(c, d, clamp01(invLerp(a, b, v)));

export const smoothstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const smootherstep = (t) => { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); };

/** Ease used for camera and UI motion — fast out, gentle settle. */
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
export const easeInOutQuint = (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2);

/**
 * Frame-rate independent exponential smoothing.
 * `damp(current, target, lambda, dt)` — higher lambda converges faster.
 * Unlike naive `lerp(a,b,0.1)` this behaves identically at 30 and 144 fps.
 */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/** Shortest signed angular difference b−a, wrapped to [−π, π]. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export const dampAngle = (a, b, lambda, dt) => a + angleDelta(a, b) * (1 - Math.exp(-lambda * dt));

/** Applies a radial dead-zone to a 2D stick and renormalises the remainder. */
export function deadzone2(x, y, dz = 0.14) {
  const m = Math.hypot(x, y);
  if (m < dz) return [0, 0, 0];
  const s = (m - dz) / (1 - dz) / m;
  return [x * s, y * s, clamp01((m - dz) / (1 - dz))];
}

/** Point-in-rect (axis aligned, centre + half extents). */
export const inRect = (px, pz, cx, cz, hx, hz) =>
  px >= cx - hx && px <= cx + hx && pz >= cz - hz && pz <= cz + hz;

/** Push a point out of an axis-aligned box along the shallowest axis. */
export function resolveAABB(px, pz, cx, cz, hx, hz, radius) {
  const dx = px - cx, dz = pz - cz;
  const ox = hx + radius - Math.abs(dx);
  const oz = hz + radius - Math.abs(dz);
  if (ox <= 0 || oz <= 0) return null;
  if (ox < oz) return [cx + Math.sign(dx || 1) * (hx + radius), pz];
  return [px, cz + Math.sign(dz || 1) * (hz + radius)];
}

/** Sample a Catmull–Rom spline through points (array of {x,z}) at t∈[0,1]. */
export function splineAt(pts, t) {
  const n = pts.length;
  const ft = t * n;
  const i = Math.floor(ft) % n;
  const f = ft - Math.floor(ft);
  const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
  const f2 = f * f, f3 = f2 * f;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * f + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * f2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * f3),
    z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * f + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * f2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * f3),
  };
}

/** Total length of a closed polyline, plus cumulative distances. */
export function pathMetrics(pts) {
  const cum = [0];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    total += Math.hypot(b.x - a.x, b.z - a.z);
    cum.push(total);
  }
  return { cum, total };
}

/** Position + heading along a closed polyline at arc-length `d`. */
export function walkPath(pts, metrics, d) {
  const { cum, total } = metrics;
  d = ((d % total) + total) % total;
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < d) i++;
  const a = pts[i], b = pts[(i + 1) % pts.length];
  const segLen = cum[i + 1] - cum[i] || 1;
  const f = (d - cum[i]) / segLen;
  return {
    x: lerp(a.x, b.x, f),
    z: lerp(a.z, b.z, f),
    heading: Math.atan2(b.x - a.x, b.z - a.z),
    seg: i,
  };
}

/** HSL → hex integer, for feeding THREE.Color without allocating strings. */
export function hsl2hex(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  const r = Math.round(f(0) * 255), g = Math.round(f(8) * 255), b = Math.round(f(4) * 255);
  return (r << 16) | (g << 8) | b;
}

/** #rrggbb string from an integer. */
export const hex2css = (n) => '#' + n.toString(16).padStart(6, '0');

/** Mix two hex integers in sRGB space (good enough for UI chrome). */
export function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(lerp(ar, br, t)) << 16) | (Math.round(lerp(ag, bg, t)) << 8) | Math.round(lerp(ab, bb, t));
}

/** Format minutes-since-midnight as HH:MM. */
export function clockString(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
