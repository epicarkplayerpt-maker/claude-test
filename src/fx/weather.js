/**
 * Weather and atmospheric particles.
 *
 * All of it runs as `THREE.Points` with the motion computed in the vertex
 * shader from a per-particle seed and a time uniform — the CPU never touches a
 * particle position, so a thousand raindrops cost one draw call and no
 * per-frame JavaScript. Particles live in a box that follows the camera and
 * wrap inside it, which is why you can walk the whole block without ever
 * leaving the rain.
 */

import * as THREE from 'three';
import { Rand } from '../core/rng.js';
import { clamp01, lerp, damp } from '../core/mathx.js';

const VS = /* glsl */`
attribute vec4 aSeed;      // xyz = home position in the box, w = speed/size seed
uniform float uTime;
uniform vec3 uOrigin;      // camera position, snapped
uniform vec3 uBox;         // half extents
uniform float uFall;       // fall speed
uniform float uDrift;      // lateral sway
uniform float uSize;
uniform float uSway;
uniform float uPixelScale;
uniform float uMaxSize;       // sway frequency
varying float vFade;
varying float vSeed;

void main(){
  vec3 p = aSeed.xyz;
  float sp = 0.6 + aSeed.w * 0.8;

  // Fall and wrap inside the box. mod() keeps this stable for hours.
  float y = p.y - uTime * uFall * sp;
  y = mod(y, uBox.y * 2.0) - uBox.y;

  float t = uTime * uSway * (0.4 + aSeed.w);
  float x = p.x + sin(t + p.z) * uDrift;
  float z = p.z + cos(t * 0.83 + p.x) * uDrift;

  vec3 world = uOrigin + vec3(x, y, z);
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;

  float dist = max(-mv.z, 0.05);

  // Fade at the box edges so particles never pop into existence...
  float edge = 1.0 - max(abs(x) / uBox.x, abs(z) / uBox.z);
  // ...and fade anything nearly touching the lens. Without this a single
  // raindrop 30 cm from the camera projects to thousands of pixels and, being
  // additive, whites out the entire frame.
  float near = smoothstep(0.30, 2.4, dist);
  vFade = clamp(edge * 2.4, 0.0, 1.0) * near;
  vSeed = aSeed.w;

  // uSize is a world size in metres; uPixelScale converts it to pixels at
  // one metre, so the sprite stays physically sized at any FOV or resolution.
  gl_PointSize = clamp(uSize * sp * uPixelScale / dist, 1.0, uMaxSize);
}
`;

const FS = /* glsl */`
precision mediump float;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uStreak;     // 0 = round flake, 1 = vertical rain streak
varying float vFade;
varying float vSeed;

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float a;
  if (uStreak > 0.5) {
    // A vertical sliver: tight in x, soft-capped in y.
    float dx = abs(uv.x) / 0.16;
    float dy = abs(uv.y) / 0.5;
    a = (1.0 - smoothstep(0.5, 1.0, dx)) * (1.0 - smoothstep(0.6, 1.0, dy));
  } else {
    a = 1.0 - smoothstep(0.18, 0.5, length(uv));
  }
  a *= vFade * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * (0.7 + vSeed * 0.5), a);
}
`;

class Field {
  constructor(scene, count, opts) {
    const rnd = new Rand(opts.seed || 'weather');
    const geo = new THREE.BufferGeometry();
    const seeds = new Float32Array(count * 4);
    const box = opts.box;
    for (let i = 0; i < count; i++) {
      seeds[i * 4] = rnd.range(-box.x, box.x);
      seeds[i * 4 + 1] = rnd.range(-box.y, box.y);
      seeds[i * 4 + 2] = rnd.range(-box.z, box.z);
      seeds[i * 4 + 3] = rnd.f();
    }
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    // The vertex shader ignores `position`, but three needs it to size the draw.
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.uniforms = {
      uTime: { value: 0 },
      uOrigin: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(box.x, box.y, box.z) },
      uFall: { value: opts.fall },
      uDrift: { value: opts.drift },
      uSize: { value: opts.size },
      uPixelScale: { value: 600 },
      uMaxSize: { value: opts.maxSize ?? 42 },
      uSway: { value: opts.sway ?? 0.6 },
      uColor: { value: new THREE.Color(opts.color) },
      uOpacity: { value: 0 },
      uStreak: { value: opts.streak ? 1 : 0 },
    };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 900;
    this.points.visible = false;
    scene.add(this.points);

    this.targetOpacity = 0;
    this.baseOpacity = opts.opacity ?? 0.55;
  }
  update(dt, time, camPos, pixelScale) {
    const u = this.uniforms;
    if (pixelScale) u.uPixelScale.value = pixelScale;
    u.uTime.value = time;
    u.uOrigin.value.set(camPos.x, camPos.y, camPos.z);
    u.uOpacity.value = damp(u.uOpacity.value, this.targetOpacity, 2.2, dt);
    this.points.visible = u.uOpacity.value > 0.004;
  }
  set(on, scale = 1) { this.targetOpacity = on ? this.baseOpacity * scale : 0; }
  dispose(scene) {
    scene.remove(this.points);
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

/* ══════════════════════════ localised puffs ══════════════════════════ */

const PUFF_VS = /* glsl */`
attribute vec4 aSeed;
uniform float uTime, uRise, uSpread, uSize, uLife, uPixelScale;
uniform vec3 uAnchor;
varying float vAge;
varying float vNear;
void main(){
  float life = uLife * (0.6 + aSeed.w * 0.7);
  float age = mod(uTime * (0.5 + aSeed.w * 0.5) + aSeed.w * 13.0, life) / life;
  vec3 p = uAnchor
    + vec3(aSeed.x, 0.0, aSeed.z) * uSpread * (0.35 + age * 1.5)
    + vec3(0.0, age * uRise, 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.05);
  gl_PointSize = clamp(uSize * (0.4 + age * 2.2) * uPixelScale / dist, 1.0, 220.0);
  vAge = age;
  vNear = smoothstep(0.4, 3.0, dist);
}
`;
const PUFF_FS = /* glsl */`
precision mediump float;
uniform vec3 uColor; uniform float uOpacity;
varying float vAge;
varying float vNear;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.1, 0.5, d)) * uOpacity * vNear;
  a *= smoothstep(0.0, 0.18, vAge) * (1.0 - smoothstep(0.45, 1.0, vAge));
  if (a < 0.008) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

class Puff {
  constructor(scene, anchor, opts = {}) {
    const count = opts.count ?? 26;
    const rnd = new Rand('puff' + anchor.x + anchor.z);
    const geo = new THREE.BufferGeometry();
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seeds[i * 4] = rnd.range(-1, 1);
      seeds[i * 4 + 1] = 0;
      seeds[i * 4 + 2] = rnd.range(-1, 1);
      seeds[i * 4 + 3] = rnd.f();
    }
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.boundingSphere = new THREE.Sphere(anchor.clone(), 20);

    this.uniforms = {
      uTime: { value: 0 }, uAnchor: { value: anchor.clone() },
      uRise: { value: opts.rise ?? 4.5 }, uSpread: { value: opts.spread ?? 0.6 },
      uSize: { value: opts.size ?? 1.2 }, uLife: { value: opts.life ?? 5 },
      uPixelScale: { value: 600 },
      uColor: { value: new THREE.Color(opts.color ?? 0xd8d8d0) },
      uOpacity: { value: opts.opacity ?? 0.14 },
    };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PUFF_VS, fragmentShader: PUFF_FS, uniforms: this.uniforms,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = true;
    this.points.renderOrder = 890;
    scene.add(this.points);
  }
  update(time, pixelScale) {
    this.uniforms.uTime.value = time;
    if (pixelScale) this.uniforms.uPixelScale.value = pixelScale;
  }
  dispose(scene) { scene.remove(this.points); this.points.geometry.dispose(); this.mat.dispose(); }
}

/* ══════════════════════════ manager ══════════════════════════ */

export class Weather {
  constructor(scene, quality) {
    this.scene = scene;
    this.scale = quality.weatherScale ?? 1;
    const n = (v) => Math.max(60, Math.round(v * this.scale));

    this.rain = new Field(scene, n(1100), {
      seed: 'rain', box: { x: 16, y: 12, z: 16 }, fall: 22, drift: 0.18,
      size: 0.24, maxSize: 34, sway: 0.3, color: 0xa8c0d8, opacity: 0.30, streak: true, additive: false,
    });
    this.snow = new Field(scene, n(700), {
      seed: 'snow', box: { x: 18, y: 13, z: 18 }, fall: 1.5, drift: 1.5,
      size: 0.075, maxSize: 26, sway: 0.5, color: 0xf4f8ff, opacity: 0.85, streak: false,
    });
    this.soot = new Field(scene, n(420), {
      seed: 'soot', box: { x: 20, y: 12, z: 20 }, fall: 0.55, drift: 2.4,
      size: 0.045, maxSize: 16, sway: 0.28, color: 0x3a3228, opacity: 0.45, streak: false,
    });
    this.leaves = new Field(scene, n(120), {
      seed: 'leaf', box: { x: 18, y: 10, z: 18 }, fall: 1.9, drift: 3.2,
      size: 0.11, maxSize: 30, sway: 0.9, color: 0xa8823a, opacity: 0.85, streak: false,
    });
    this.pollen = new Field(scene, n(300), {
      seed: 'pollen', box: { x: 16, y: 9, z: 16 }, fall: 0.28, drift: 1.9,
      size: 0.030, maxSize: 12, sway: 0.4, color: 0xffe8b0, opacity: 0.30, streak: false, additive: true,
    });
    this.ash = new Field(scene, n(240), {
      seed: 'ash', box: { x: 18, y: 11, z: 18 }, fall: 0.7, drift: 2.6,
      size: 0.038, maxSize: 14, sway: 0.35, color: 0x8fd6d8, opacity: 0.26, streak: false, additive: true,
    });

    this.fields = [this.rain, this.snow, this.soot, this.leaves, this.pollen, this.ash];
    this.puffs = [];
    this.mode = 'clear';
  }

  /** Replace the local puff emitters (manhole steam, mist arches, chimneys). */
  setEmitters(list) {
    for (const p of this.puffs) p.dispose(this.scene);
    this.puffs = [];
    for (const e of list) {
      this.puffs.push(new Puff(this.scene, e.pos, e.opts));
    }
  }

  setMode(mode, intensity = 1) {
    this.mode = mode;
    const s = intensity;
    this.rain.set(mode === 'rain', s);
    this.snow.set(mode === 'snow', s);
    this.soot.set(mode === 'soot', s);
    this.leaves.set(mode === 'soot' || mode === 'leaves', s * 0.8);
    this.pollen.set(mode === 'clear' || mode === 'haze', s * 0.7);
    this.ash.set(mode === 'haze' || mode === 'drizzle', s);
    if (mode === 'drizzle') this.rain.set(true, s * 0.45);
    if (mode === 'overcast') this.rain.set(true, s * 0.16);
  }

  /** Wet-look factor the street material uses; ramps with recent rain. */
  get wetness() {
    return this.mode === 'rain' ? 1 : this.mode === 'drizzle' ? 0.6 : this.mode === 'overcast' ? 0.25 : 0;
  }

  /**
   * `pixelScale` is viewportHeight / (2·tan(fov/2)) — the number of pixels a
   * one-metre object covers at one metre. Passing it in keeps sprite sizes
   * physical across every FOV, render scale and device.
   */
  update(dt, time, camPos, pixelScale) {
    for (const f of this.fields) f.update(dt, time, camPos, pixelScale);
    for (const p of this.puffs) p.update(time, pixelScale);
  }

  dispose() {
    for (const f of this.fields) f.dispose(this.scene);
    for (const p of this.puffs) p.dispose(this.scene);
  }
}

/* ══════════════════════════ warp shockwave ══════════════════════════ */

const RING_VS = /* glsl */`
attribute vec4 aSeed;
uniform float uTime, uRadius, uSize, uPixelScale;
uniform vec3 uCenter;
varying float vA;
void main(){
  float ang = aSeed.x * 6.2831853;
  float rj = 0.82 + aSeed.y * 0.38;
  float r = uRadius * rj;
  vec3 p = uCenter + vec3(cos(ang) * r, aSeed.z * 8.0 + 1.0, sin(ang) * r);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.05);
  gl_PointSize = clamp(uSize * (0.5 + aSeed.w) * uPixelScale / dist, 1.0, 90.0);
  vA = aSeed.w * smoothstep(0.5, 3.0, dist);
}
`;
const RING_FS = /* glsl */`
precision mediump float;
uniform vec3 uColor; uniform float uOpacity;
varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.05, 0.5, d)) * uOpacity * (0.4 + vA);
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

/** The ring of sparks that rides the time-warp front. */
export class WarpRing {
  constructor(scene, count = 900) {
    const rnd = new Rand('warpring');
    const geo = new THREE.BufferGeometry();
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seeds[i * 4] = rnd.f();
      seeds[i * 4 + 1] = rnd.f();
      seeds[i * 4 + 2] = rnd.f();
      seeds[i * 4 + 3] = rnd.f();
    }
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.uniforms = {
      uTime: { value: 0 }, uRadius: { value: 0 }, uSize: { value: 0.55 },
      uPixelScale: { value: 600 },
      uCenter: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color(0xffe0b0) }, uOpacity: { value: 0 },
    };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: RING_VS, fragmentShader: RING_FS, uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 950;
    this.points.visible = false;
    scene.add(this.points);
    this.scene = scene;
  }
  set(center, radius, opacity, color) {
    this.uniforms.uCenter.value.copy(center);
    this.uniforms.uRadius.value = radius;
    this.uniforms.uOpacity.value = opacity;
    if (color !== undefined) this.uniforms.uColor.value.set(color);
    this.points.visible = opacity > 0.01;
  }
  dispose() { this.scene.remove(this.points); this.points.geometry.dispose(); this.mat.dispose(); }
}
