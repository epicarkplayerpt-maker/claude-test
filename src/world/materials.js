/**
 * Material library.
 *
 * Two jobs:
 *  1. Cache PBR materials keyed by (kind, colour, roughness…) so a block with
 *     three hundred surfaces still only compiles a handful of programs.
 *  2. Inject the shared **time-warp dissolve** into every era-owned material.
 *     One global uniform block drives all of them, so the wipe across the whole
 *     city is a single number per frame rather than a traversal.
 *
 * The dissolve is a world-space radial wipe with a hashed ragged edge and an
 * emissive rim. Outgoing-era surfaces erase from the inside out; incoming-era
 * surfaces appear behind the same front, so the two eras interlock exactly.
 */

import * as THREE from 'three';
import { Tex } from './textures.js';

/* ══════════════════════════ shared warp uniforms ══════════════════════════ */

export const WARP = {
  uWarpCenter: { value: new THREE.Vector3(0, 1.6, 0) },
  uWarpRadius: { value: -1 },          // < 0 ⇒ inactive, everything draws
  uWarpWidth: { value: 3.2 },
  uWarpEdge: { value: new THREE.Color(0xffd6a0) },
  uWarpActive: { value: 0 },
  uWarpTime: { value: 0 },
};

const WARP_PARS = /* glsl */`
uniform vec3 uWarpCenter;
uniform float uWarpRadius;
uniform float uWarpWidth;
uniform vec3 uWarpEdge;
uniform float uWarpActive;
uniform float uWarpTime;
uniform float uEraSide;          // +1 outgoing (erases first), -1 incoming
varying vec3 vTbWorld;

float tbHash(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
`;

/* Placed right after clipping so we discard before doing any lighting work. */
const WARP_BODY = /* glsl */`
  if (uWarpActive > 0.5) {
    vec3 d3 = vTbWorld - uWarpCenter;
    // Flatten Y a little: the front should read as a ring on the street,
    // not a sphere that swallows the rooftops first.
    float dist = length(vec3(d3.x, d3.y * 0.55, d3.z));

    // Ragged edge: two octaves of cheap value hash, animated slightly.
    float n = tbHash(floor(vTbWorld * 2.3)) * 0.62 + tbHash(floor(vTbWorld * 7.1 + 13.0)) * 0.38;
    float edge = uWarpRadius + (n - 0.5) * uWarpWidth;

    float signedD = (dist - edge) * uEraSide;
    // uEraSide = +1 → visible while dist > edge (the old era survives ahead of
    //                 the front and is eaten behind it)
    // uEraSide = -1 → visible while dist < edge (the new era fills in behind)
    if (signedD < 0.0) discard;

    // Keep the glowing rim tight regardless of how ragged the edge itself is:
    // tying it to uWarpWidth made a 90 m front paint the whole street orange.
    float rim = 1.0 - smoothstep(0.0, min(uWarpWidth, 2.0), signedD);
    tbRim = rim * rim * rim;
  }
`;

/** Fragment-side: add the rim glow after all lighting is resolved. */
const WARP_OUT = /* glsl */`
  gl_FragColor.rgb += uWarpEdge * tbRim * 1.35;
`;

/**
 * Patch a standard/physical material with the dissolve.
 * `side`: +1 for the era being left, −1 for the era being entered.
 */
export function patchWarp(mat, side = 1) {
  if (mat.userData._warped) { mat.userData.eraSideU.value = side; return mat; }
  const sideU = { value: side };
  mat.userData._warped = true;
  mat.userData.eraSideU = sideU;

  // A material may already carry its own shader hook (see `vcolLit`), so chain
  // rather than clobber — the warp is an overlay on whatever it was doing.
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, WARP, { uEraSide: sideU });

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTbWorld;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 tbWp = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          tbWp = instanceMatrix * tbWp;
        #endif
        #ifdef USE_BATCHING
          tbWp = batchingMatrix * tbWp;
        #endif
        vTbWorld = ( modelMatrix * tbWp ).xyz;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WARP_PARS)
      .replace('void main() {', 'void main() {\n  float tbRim = 0.0;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + WARP_BODY)
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + WARP_OUT);

    mat.userData.shader = shader;
  };
  // Force a distinct program so patched and unpatched variants don't collide.
  // `progTag` keeps two differently-hooked materials from sharing one program.
  const tag = mat.userData.progTag || '';
  mat.customProgramCacheKey = () => 'tbwarp|' + tag;
  return mat;
}

/**
 * Wind.
 *
 * One shared uniform block, read by every leaf on the block. Displacing the
 * canopy in the vertex shader means a street tree, a window box and a green
 * wall all move together in the same gust for the cost of three uniforms, and
 * nothing on the CPU has to know that foliage exists.
 */
export const WIND = {
  uWindTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.82, 0.57) },
  uWindAmt: { value: 0.16 },
};

/** Point and strengthen the wind — weather and era both move it. */
export function setWind({ time, dir, amount }) {
  if (time !== undefined) WIND.uWindTime.value = time;
  if (dir !== undefined) WIND.uWindDir.value.set(Math.cos(dir), Math.sin(dir));
  if (amount !== undefined) WIND.uWindAmt.value = amount;
}

export function setWarp({ active, radius, center, width, color, time }) {
  if (active !== undefined) WARP.uWarpActive.value = active ? 1 : 0;
  if (radius !== undefined) WARP.uWarpRadius.value = radius;
  if (center) WARP.uWarpCenter.value.copy(center);
  if (width !== undefined) WARP.uWarpWidth.value = width;
  if (color !== undefined) WARP.uWarpEdge.value.set(color);
  if (time !== undefined) WARP.uWarpTime.value = time;
}

/* ══════════════════════════ material factory ══════════════════════════ */

/**
 * Snap a texture repeat to half-steps.
 *
 * `Texture.clone()` gets its own GPU upload, so every distinct repeat value
 * costs another copy of a 512² detail map. Facades on this block ask for
 * dozens of near-identical repeats; quantising collapses them onto a handful
 * of shared textures at no visible cost.
 */
const qr = (v) => Math.max(0.5, Math.round(v * 2) / 2);
const qrep = (r) => [qr(r[0]), qr(r[1])];

const clone = (t, rx, ry) => {
  if (!t) return null;
  const c = t.clone();
  c.needsUpdate = true;
  c.repeat.set(rx, ry);
  c.wrapS = c.wrapT = THREE.RepeatWrapping;
  return c;
};

export class MatLib {
  /**
   * `noWarp` opts a library out of the dissolve entirely. The crowd and the
   * traffic use one of these: they are swapped wholesale at the midpoint of a
   * transition rather than being erased in place, and their materials must
   * outlive any single era's library — which gets disposed when the LRU trims.
   */
  constructor(env = null, { noWarp = false } = {}) {
    this.cache = new Map();
    this.env = env;
    this.all = [];
    this.noWarp = noWarp;
    /**
     * Which side of a time-warp this library's materials are on:
     *  +1 the era being left (erased ahead of the wipe front)
     *  −1 the era being entered (revealed behind it)
     * Every era owns one library, so flipping this one number re-roles a whole
     * decade's worth of surfaces in a single pass.
     */
    this.defaultSide = 1;
  }

  /** Re-role every material in this library for a transition. */
  setSide(side) {
    this.defaultSide = side;
    for (const m of this.all) {
      if (m.userData.eraSideU) m.userData.eraSideU.value = side;
    }
  }

  setEnvironment(envMap) {
    this.env = envMap;
    for (const m of this.all) {
      if (m.userData.wantsEnv) { m.envMap = envMap; m.needsUpdate = true; }
    }
  }

  _reg(m, { warp = true, side = undefined, env = false } = {}) {
    side = side ?? this.defaultSide;
    m.userData.wantsEnv = env;
    if (env && this.env) m.envMap = this.env;
    if (warp && !this.noWarp) patchWarp(m, side);
    else if (m.userData.progTag) { const t = m.userData.progTag; m.customProgramCacheKey = () => t; }
    this.all.push(m);
    return m;
  }

  _get(key, make, opts) {
    if (this.cache.has(key)) return this.cache.get(key);
    const m = this._reg(make(), opts);
    this.cache.set(key, m);
    return m;
  }

  /* ── surfaces ─────────────────────────────────────────────────── */

  brick(color, { repeat = [1, 1], rough = 0.94, condition = 0.2, side = undefined } = {}) {
    repeat = qrep(repeat);
    const key = `brick|${color}|${repeat}|${rough.toFixed(2)}|${condition.toFixed(2)}`;
    return this._get(key, () => new THREE.MeshStandardMaterial({
      color, map: clone(Tex.brick(), repeat[0], repeat[1]),
      normalMap: clone(Tex.brickNormal(), repeat[0], repeat[1]),
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughness: Math.min(1, rough + condition * 0.05), metalness: 0.0,
    }), { side, env: false });
  }

  stucco(color, { repeat = [1, 1], rough = 0.9, side = undefined } = {}) {
    repeat = qrep(repeat);
    const key = `stucco|${color}|${repeat}`;
    return this._get(key, () => new THREE.MeshStandardMaterial({
      color, map: clone(Tex.stucco(), repeat[0], repeat[1]),
      normalMap: clone(Tex.stuccoNormal(), repeat[0], repeat[1]),
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: rough, metalness: 0.0,
    }), { side });
  }

  limestone(color, { repeat = [1, 1], side = undefined } = {}) {
    repeat = qrep(repeat);
    const key = `lime|${color}|${repeat}`;
    return this._get(key, () => new THREE.MeshStandardMaterial({
      color, map: clone(Tex.limestone(), repeat[0], repeat[1]),
      normalMap: clone(Tex.limestoneNormal(), repeat[0], repeat[1]),
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.86, metalness: 0.0,
    }), { side });
  }

  panel(color, { repeat = [1, 1], rough = 0.42, metal = 0.16, side = undefined } = {}) {
    repeat = qrep(repeat);
    const key = `panel|${color}|${repeat}|${rough}|${metal}`;
    return this._get(key, () => new THREE.MeshStandardMaterial({
      color, map: clone(Tex.panel(), repeat[0], repeat[1]),
      normalMap: clone(Tex.panelNormal(), repeat[0], repeat[1]),
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: rough, metalness: metal,
    }), { side, env: true });
  }

  concrete(color, { repeat = [1, 1], rough = 0.95, side = undefined } = {}) {
    repeat = qrep(repeat);
    const key = `conc|${color}|${repeat}`;
    return this._get(key, () => new THREE.MeshStandardMaterial({
      color, map: clone(Tex.concrete(), repeat[0], repeat[1]),
      normalMap: clone(Tex.concreteNormal(), repeat[0], repeat[1]),
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: rough, metalness: 0.0,
    }), { side });
  }

  asphalt(color, { repeat = [1, 1], wet = 0, side = undefined } = {}) {
    repeat = qrep(repeat);
    const key = `asph|${color}|${repeat}|${wet.toFixed(2)}`;
    return this._get(key, () => new THREE.MeshStandardMaterial({
      color, map: clone(Tex.asphalt(), repeat[0], repeat[1]),
      normalMap: clone(Tex.asphaltNormal(), repeat[0], repeat[1]),
      normalScale: new THREE.Vector2(0.9 - wet * 0.6, 0.9 - wet * 0.6),
      // Wet asphalt is the single biggest look-lever in the 1985 scene: drop
      // roughness and let the env map do the work.
      roughness: 0.96 - wet * 0.72,
      metalness: wet * 0.32,
      envMapIntensity: 0.4 + wet * 1.5,
    }), { side, env: true });
  }

  wood(color, { repeat = [1, 1], rough = 0.82, side = undefined } = {}) {
    repeat = qrep(repeat);
    const key = `wood|${color}|${repeat}`;
    return this._get(key, () => new THREE.MeshStandardMaterial({
      color, map: clone(Tex.wood(), repeat[0], repeat[1]), roughness: rough, metalness: 0,
    }), { side });
  }

  metal(color, { rough = 0.38, metal = 0.85, repeat = [1, 1], side = undefined } = {}) {
    repeat = qrep(repeat);
    const key = `metal|${color}|${rough}|${metal}`;
    return this._get(key, () => new THREE.MeshStandardMaterial({
      color, map: clone(Tex.metal(), repeat[0], repeat[1]),
      roughness: rough, metalness: metal, envMapIntensity: 1.2,
    }), { side, env: true });
  }

  /** Flat painted surface — trim, awnings, vehicle bodies. */
  paint(color, { rough = 0.44, metal = 0.06, clear = 0, side = undefined } = {}) {
    const key = `paint|${color}|${rough}|${metal}|${clear}`;
    return this._get(key, () => new THREE.MeshStandardMaterial({
      color, roughness: rough, metalness: metal, envMapIntensity: 0.9 + clear,
    }), { side, env: true });
  }

  /** Vertex-coloured bucket material — used by all merged detail geometry. */
  vcol(kind = 'matte', { side = undefined } = {}) {
    const key = `vcol|${kind}`;
    const params = {
      matte: { roughness: 0.82, metalness: 0.0, env: false },
      gloss: { roughness: 0.32, metalness: 0.12, env: true },
      // Automotive paint: a hard clearcoat sheen is most of what makes a dark
      // 1940s saloon read as glossy black rather than as a black hole.
      car: { roughness: 0.16, metalness: 0.16, env: true },
      metal: { roughness: 0.36, metalness: 0.82, env: true },
      rough: { roughness: 0.96, metalness: 0.0, env: false },
    }[kind] || { roughness: 0.8, metalness: 0, env: false };
    return this._get(key, () => new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: params.roughness, metalness: params.metalness,
      envMapIntensity: kind === 'car' ? 1.9 : kind === 'metal' ? 1.4 : 0.9,
    }), { side, env: params.env });
  }

  /** Window glass. Transparent, reflective, slightly tinted per era. */
  glass(color, { opacity = 0.42, rough = 0.06, side = undefined, tex = null } = {}) {
    const key = `glass|${color}|${opacity}|${rough}|${tex ? tex.uuid : 0}`;
    return this._get(key, () => new THREE.MeshStandardMaterial({
      color, transparent: true, opacity, roughness: rough, metalness: 0.1,
      envMapIntensity: 2.0, depthWrite: false, side: THREE.FrontSide,
      map: tex || null,
    }), { side, env: true });
  }

  /** Self-lit sign face. `strength` drives bloom pickup. */
  emissive(map, { color = 0xffffff, strength = 1.6, transparent = true, side = undefined, double = false } = {}) {
    const m = new THREE.MeshStandardMaterial({
      map, color: 0x000000,
      emissive: color, emissiveMap: map, emissiveIntensity: strength,
      transparent, alphaTest: transparent ? 0.02 : 0,
      roughness: 1, metalness: 0,
      side: double ? THREE.DoubleSide : THREE.FrontSide,
      depthWrite: !transparent,
    });
    return this._reg(m, { side });
  }

  /**
   * A sign that is *both* printed and lit: the artwork is the diffuse map so it
   * reads as a painted panel in daylight, and the same map drives a modest
   * emissive so it carries the scene after dark. A purely emissive sign
   * (`emissive()`) blows out under a midday sun; a purely printed one goes dead
   * at night. Marquees, fascia boxes and shop interiors all want this.
   */
  litSign(map, { strength = 0.55, color = 0xffffff, rough = 0.7, side = undefined, double = false } = {}) {
    const m = new THREE.MeshStandardMaterial({
      map, color: 0xffffff,
      emissive: color, emissiveMap: map, emissiveIntensity: strength,
      roughness: rough, metalness: 0,
      side: double ? THREE.DoubleSide : THREE.FrontSide,
    });
    return this._reg(m, { side });
  }

  /** Opaque, mirror-ish window pane (upper floors seen from the street). */
  pane(color, { map = null, rough = 0.07, side = undefined } = {}) {
    const key = `pane|${color}|${rough}|${map ? map.uuid : 0}`;
    return this._get(key, () => new THREE.MeshStandardMaterial({
      color, map, roughness: rough, metalness: 0.34, envMapIntensity: 1.9,
    }), { side, env: true });
  }

  /** Unlit printed surface (posters, painted signs read by daylight). */
  printed(map, { rough = 0.92, side = undefined, transparent = false, double = false } = {}) {
    const m = new THREE.MeshStandardMaterial({
      map, roughness: rough, metalness: 0,
      transparent, alphaTest: transparent ? 0.35 : 0,
      side: double ? THREE.DoubleSide : THREE.FrontSide,
    });
    return this._reg(m, { side });
  }

  /** Neon tube: additive, always hot, ignores lighting. */
  neon(color, { strength = 3.0, side = undefined } = {}) {
    const key = `neon|${color}|${strength}`;
    return this._get(key, () => {
      const m = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(strength),
        toneMapped: false, transparent: true, opacity: 0.96,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      return m;
    }, { side, warp: false });
  }

  /** Holographic projection volume — additive, animated by the caller. */
  holo(map, { color = 0x56d0e0, strength = 2.2, side = undefined } = {}) {
    const m = new THREE.MeshBasicMaterial({
      map, color: new THREE.Color(color).multiplyScalar(strength),
      transparent: true, opacity: 0.72, toneMapped: false,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.all.push(m);
    return m;
  }

  /**
   * Additive billboard glow — lamp halos, light pools, headlight beams.
   * Never occludes, never writes depth, and is driven entirely by opacity so
   * the whole set can be faded in as dusk falls.
   */
  glow(color, { strength = 1.0, tex = null, depthWrite = false } = {}) {
    const m = new THREE.MeshBasicMaterial({
      map: tex, color: new THREE.Color(color).multiplyScalar(strength),
      transparent: true, opacity: 0, depthWrite, depthTest: true,
      blending: THREE.AdditiveBlending, toneMapped: false, fog: true,
      side: THREE.DoubleSide,
    });
    this.all.push(m);
    return m;
  }

  /** Foliage: double-sided, alpha-tested, with a touch of translucency fake. */
  foliage(color, { rough = 0.86, side = undefined, map = null } = {}) {
    const key = `foliage|${color}|${map ? map.uuid : 0}`;
    return this._get(key, () => {
      const m = new THREE.MeshStandardMaterial({
        color, roughness: rough, metalness: 0,
        side: THREE.DoubleSide, map, transparent: !!map, alphaTest: map ? 0.4 : 0,
      });
      m.userData.progTag = 'foliagewind';
      m.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, WIND);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>
            uniform float uWindTime;
            uniform vec2 uWindDir;
            uniform float uWindAmt;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            {
              // Sway grows with height above the pavement, so trunks stay put
              // and canopies move; two frequencies keep it from pulsing.
              vec3 tbW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
              float tbH = clamp( tbW.y * 0.15, 0.0, 1.5 );
              float tbG = sin( uWindTime * 1.7 + tbW.x * 0.35 + tbW.z * 0.27 ) * 0.62
                        + sin( uWindTime * 3.3 + tbW.x * 0.91 - tbW.z * 0.44 ) * 0.38;
              transformed.xz += uWindDir * ( tbG * uWindAmt * tbH * tbH );
            }`);
      };
      return m;
    }, { side });
  }

  /** Cloth / skin for pedestrians (vertex-coloured, cheap). */
  character({ side = undefined } = {}) {
    return this._get(`char`, () => new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.78, metalness: 0.02,
    }), { side });
  }

  /**
   * Vertex-coloured self-lit surface: lit windows, neon tubes, bulb borders,
   * vehicle lamps, glowing garment trim.
   *
   * This has to be `MeshBasicMaterial`, not a standard material with an
   * emissive colour: three multiplies vertex colours into *diffuse*, never into
   * emissive, so a vertex-coloured emissive would come out uniformly white.
   * Basic + `toneMapped:false` also lets values above 1 reach the HDR buffer,
   * which is what makes these surfaces bloom.
   */
  /**
   * Vertex-coloured *and* softly self-lit.
   *
   * A shop interior is lit from inside. Rendered as plain matte geometry it
   * falls into shadow the moment the sun swings past the facade, and a display
   * window that goes black reads as a hole in the wall rather than as a shop.
   * Standard shading still applies here — sun, ambient and the shop's own
   * ceiling light all land on it — the vertex colour is simply *also* added as
   * emission, at `fill` strength, so the room keeps a floor of visibility.
   */
  vcolLit({ side = undefined, fill = 0.4, rough = 0.78 } = {}) {
    const key = `vcollit|${fill}|${rough}`;
    return this._get(key, () => {
      const m = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: rough, metalness: 0.0, envMapIntensity: 0.5,
      });
      m.userData.progTag = `vcollit${fill}`;
      m.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           totalEmissiveRadiance += vColor.rgb * ${fill.toFixed(3)};`
        );
      };
      return m;
    }, { side, env: true });
  }

  emitVcol({ side = undefined, strength = 2.2 } = {}) {
    return this._get(`emitv|${strength}`, () => new THREE.MeshBasicMaterial({
      vertexColors: true,
      color: new THREE.Color(strength, strength, strength),
      toneMapped: false, fog: true,
    }), { side });
  }

  dispose() {
    for (const m of this.all) {
      m.map?.dispose?.();
      m.normalMap?.dispose?.();
      m.emissiveMap?.dispose?.();
      m.dispose();
    }
    this.all.length = 0;
    this.cache.clear();
  }
}
