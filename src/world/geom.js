/**
 * Geometry accumulation helpers.
 *
 * Almost everything in the block — cornice blocks, window frames, fire-escape
 * stringers, AC units, kerbs, chair legs — is a small box or cylinder. Building
 * them as individual meshes would be thousands of draw calls, so they are
 * accumulated into a `Bucket` and merged into one vertex-coloured buffer per
 * building. A four-storey facade with 200 detail pieces ends up as one draw.
 */

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _c = new THREE.Color();

/* Unit primitives, created once and re-used by every bucket call. */
const UNIT = {
  box: new THREE.BoxGeometry(1, 1, 1),
  plane: new THREE.PlaneGeometry(1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1),
  cyl24: new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 1),
  cone: new THREE.ConeGeometry(0.5, 1, 10),
  sphere: new THREE.SphereGeometry(0.5, 12, 8),
  sphereLo: new THREE.SphereGeometry(0.5, 8, 6),
  torus: new THREE.TorusGeometry(0.4, 0.1, 6, 14),
};

export class Bucket {
  constructor() { this.parts = []; this.count = 0; }

  /** Push a geometry with an explicit matrix and flat colour. */
  push(geo, matrix, color) {
    // Primitives are indexed, ExtrudeGeometry is not, and mergeGeometries
    // refuses a mixed batch. De-indexing everything is the cheap way to keep
    // the bucket accepting any shape.
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    g.applyMatrix4(matrix);
    if (!g.attributes.uv) {
      // Merging needs matching attribute sets.
      const n = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    _c.set(color);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    }
    this.parts.push(g);
    this.count++;
    return this;
  }

  _xform(sx, sy, sz, x, y, z, rot) {
    _e.set(rot?.x || 0, rot?.y || 0, rot?.z || 0, 'YXZ');
    _q.setFromEuler(_e);
    _v.set(sx, sy, sz);
    return _m.compose(new THREE.Vector3(x, y, z), _q, _v);
  }

  /** Axis-aligned (or rotated) box, positioned by its centre. */
  box(w, h, d, x, y, z, color, rot) {
    return this.push(UNIT.box, this._xform(w, h, d, x, y, z, rot), color);
  }

  /** Box positioned by its base centre — the common case for props. */
  boxOn(w, h, d, x, y, z, color, rot) {
    return this.box(w, h, d, x, y + h / 2, z, color, rot);
  }

  plane(w, h, x, y, z, color, rot) {
    return this.push(UNIT.plane, this._xform(w, h, 1, x, y, z, rot), color);
  }

  cyl(r, h, x, y, z, color, rot, seg = 12) {
    const g = seg <= 6 ? UNIT.cyl6 : seg >= 24 ? UNIT.cyl24 : UNIT.cyl;
    return this.push(g, this._xform(r * 2, h, r * 2, x, y, z, rot), color);
  }

  cylOn(r, h, x, y, z, color, rot, seg) {
    return this.cyl(r, h, x, y + h / 2, z, color, rot, seg);
  }

  /** Tapered cylinder (poles, tree trunks, chimney pots). */
  taper(rTop, rBot, h, x, y, z, color, seg = 8) {
    const g = new THREE.CylinderGeometry(rTop, rBot, 1, seg, 1);
    const out = this.push(g, this._xform(1, h, 1, x, y + h / 2, z, null), color);
    g.dispose();
    return out;
  }

  cone(r, h, x, y, z, color, rot) {
    return this.push(UNIT.cone, this._xform(r * 2, h, r * 2, x, y, z, rot), color);
  }

  sphere(r, x, y, z, color, lo = false) {
    return this.push(lo ? UNIT.sphereLo : UNIT.sphere, this._xform(r * 2, r * 2, r * 2, x, y, z, null), color);
  }

  /** A rod between two points — pipes, fire-escape rails, cables. */
  rod(x1, y1, z1, x2, y2, z2, r, color, seg = 6) {
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return this;
    const g = seg <= 6 ? UNIT.cyl6 : UNIT.cyl;
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
    _m.compose(
      new THREE.Vector3((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2),
      _q,
      new THREE.Vector3(r * 2, len, r * 2)
    );
    return this.push(g, _m, color);
  }

  /** A prism whose cross-section is an arbitrary 2D polygon (cornices, roofs). */
  prism(points, depth, x, y, z, color, rot) {
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 2 });
    g.translate(0, 0, -depth / 2);
    const out = this.push(g, this._xform(1, 1, 1, x, y, z, rot), color);
    g.dispose();
    return out;
  }

  /** Merge everything into a single geometry. Empty bucket ⇒ null. */
  build(computeNormals = false) {
    if (!this.parts.length) return null;
    const merged = BufferGeometryUtils.mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    if (merged && computeNormals) merged.computeVertexNormals();
    if (merged) merged.computeBoundingSphere();
    return merged;
  }

  /** Merge and wrap in a mesh, or return null if nothing was added. */
  mesh(material, { cast = true, receive = true, name = '' } = {}) {
    const g = this.build();
    if (!g) return null;
    const m = new THREE.Mesh(g, material);
    m.castShadow = cast; m.receiveShadow = receive; m.name = name;
    return m;
  }
}

/* ══════════════════════ shared geometry utilities ══════════════════════ */

/** A quad standing in a facade group's local space (x right, y up, +z out). */
export function quad(w, h, x, y, z, material, { rotY = 0, rotX = 0, double = false } = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  m.position.set(x, y, z);
  m.rotation.set(rotX, rotY, 0);
  if (double) m.material.side = THREE.DoubleSide;
  return m;
}

/** Box mesh with a real material (used where a texture must map properly). */
export function boxMesh(w, h, d, x, y, z, material, { rotY = 0 } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/**
 * A facade group whose local frame is: origin at the wall's base centre,
 * +x right as seen by someone standing in the street, +y up, +z out of the wall.
 */
export function facadeGroup(face, rect) {
  const g = new THREE.Group();
  const cx = (rect.x0 + rect.x1) / 2;
  const cz = (rect.z0 + rect.z1) / 2;
  switch (face) {
    case 'N': g.position.set(cx, 0, rect.z0); g.rotation.y = Math.PI; g.userData.width = rect.x1 - rect.x0; break;
    case 'S': g.position.set(cx, 0, rect.z1); g.rotation.y = 0; g.userData.width = rect.x1 - rect.x0; break;
    case 'E': g.position.set(rect.x1, 0, cz); g.rotation.y = Math.PI / 2; g.userData.width = rect.z1 - rect.z0; break;
    case 'W': g.position.set(rect.x0, 0, cz); g.rotation.y = -Math.PI / 2; g.userData.width = rect.z1 - rect.z0; break;
    default: break;
  }
  g.userData.face = face;
  return g;
}

/** Outward normal for a face letter. */
export function faceNormal(face) {
  return face === 'N' ? new THREE.Vector3(0, 0, -1)
    : face === 'S' ? new THREE.Vector3(0, 0, 1)
    : face === 'E' ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(-1, 0, 0);
}

/** Convert a point in a facade's local frame to world space. */
export function localToWorld(face, rect, lx, ly, lz) {
  const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
  switch (face) {
    case 'N': return new THREE.Vector3(cx - lx, ly, rect.z0 - lz);
    case 'S': return new THREE.Vector3(cx + lx, ly, rect.z1 + lz);
    case 'E': return new THREE.Vector3(rect.x1 + lz, ly, cz - lx);
    case 'W': return new THREE.Vector3(rect.x0 - lz, ly, cz + lx);
    default: return new THREE.Vector3(lx, ly, lz);
  }
}

export { UNIT };
