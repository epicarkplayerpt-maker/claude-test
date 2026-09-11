/**
 * Hand-rolled HDR post stack.
 *
 * Why not EffectComposer: this pipeline needs the scene depth for AO and DOF,
 * a two-level bloom rather than five, and one fused composite pass that also
 * does the era colour grade, the time-warp wipe and the "ghost of the previous
 * decade" overlay. Doing it by hand is fewer draws than chaining addon passes
 * and keeps every knob in one place.
 *
 * Flow (all HDR / half-float until the last step):
 *
 *   scene ──▶ sceneRT (MSAA, +depth)
 *              │
 *              ├─▶ AO pass (½ res, depth only) ─────────┐
 *              ├─▶ bright pass (½) ─▶ blur H/V (½) ─▶ blur H/V (¼) ─┐
 *              └─▶ dof downsample (½, photo mode only) ─┐          │
 *                                                        ▼          ▼
 *                                       composite ──▶ canvas (sRGB)
 */

import * as THREE from 'three';
import { clamp01 } from '../core/mathx.js';

const FS_QUAD_VS = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/* ────────────────────────────── shaders ────────────────────────────── */

const BRIGHT_FS = /* glsl */`
precision highp float;
uniform sampler2D tSrc; uniform vec2 texel; uniform float threshold; uniform float knee;
varying vec2 vUv;
void main(){
  // 4-tap box downsample keeps fireflies from popping when the camera moves.
  vec3 c = texture2D(tSrc, vUv + texel*vec2(-1.0,-1.0)).rgb
         + texture2D(tSrc, vUv + texel*vec2( 1.0,-1.0)).rgb
         + texture2D(tSrc, vUv + texel*vec2(-1.0, 1.0)).rgb
         + texture2D(tSrc, vUv + texel*vec2( 1.0, 1.0)).rgb;
  c *= 0.25;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Soft knee so bright-but-not-blown surfaces ramp in instead of snapping.
  float soft = clamp(l - threshold + knee, 0.0, 2.0*knee);
  soft = soft*soft / (4.0*knee + 1e-5);
  float w = max(soft, l - threshold) / max(l, 1e-5);
  gl_FragColor = vec4(c * clamp(w, 0.0, 1.0), 1.0);
}
`;

const BLUR_FS = /* glsl */`
precision highp float;
uniform sampler2D tSrc; uniform vec2 dir;
varying vec2 vUv;
void main(){
  // 9-tap gaussian collapsed to 5 bilinear fetches.
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
  vec2 o1 = dir * 1.3846153846;
  vec2 o2 = dir * 3.2307692308;
  c += (texture2D(tSrc, vUv + o1).rgb + texture2D(tSrc, vUv - o1).rgb) * 0.3162162162;
  c += (texture2D(tSrc, vUv + o2).rgb + texture2D(tSrc, vUv - o2).rgb) * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}
`;

const DOWN_FS = /* glsl */`
precision highp float;
uniform sampler2D tSrc; uniform vec2 texel;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv + texel*vec2(-1.0,-1.0)).rgb
         + texture2D(tSrc, vUv + texel*vec2( 1.0,-1.0)).rgb
         + texture2D(tSrc, vUv + texel*vec2(-1.0, 1.0)).rgb
         + texture2D(tSrc, vUv + texel*vec2( 1.0, 1.0)).rgb;
  gl_FragColor = vec4(c*0.25, 1.0);
}
`;

/* Depth-only ambient occlusion. Normals are reconstructed from depth
   derivatives — cheaper than a normal prepass and plenty for street-level
   contact darkening under awnings, cornices, car bodies and kerbs. */
const AO_FS = /* glsl */`
precision highp float;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform mat4 projInv;
uniform float radius, intensity, bias, near, far;
varying vec2 vUv;

float linearDepth(vec2 uv){
  float d = texture2D(tDepth, uv).x;
  float z = d * 2.0 - 1.0;
  return (2.0 * near * far) / (far + near - z * (far - near));
}
vec3 viewPos(vec2 uv){
  float d = texture2D(tDepth, uv).x;
  vec4 clip = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 v = projInv * clip;
  return v.xyz / v.w;
}

void main(){
  float d = texture2D(tDepth, vUv).x;
  if (d >= 0.9999){ gl_FragColor = vec4(1.0); return; }   // sky: no occlusion

  vec3 p = viewPos(vUv);
  vec3 n = normalize(cross(dFdx(p), dFdy(p)));

  // Rotate the kernel per-pixel with an interleaved gradient hash so the
  // 8 taps read as film grain rather than banding.
  float a = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
  float ca = cos(a), sa = sin(a);
  mat2 rot = mat2(ca, -sa, sa, ca);

  float occ = 0.0;
  const int TAPS = 8;
  for (int i = 0; i < TAPS; i++){
    float fi = float(i);
    float ang = fi * 0.7853981634;
    float rad = (fi + 1.0) / float(TAPS);
    vec2 off = rot * vec2(cos(ang), sin(ang)) * rad;
    // Scale the screen-space radius by distance so AO stays world-sized.
    vec2 suv = vUv + off * texel * radius * (30.0 / max(-p.z, 1.0));
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    vec3 sp = viewPos(suv);
    vec3 v = sp - p;
    float len = length(v);
    if (len < 1e-4) continue;
    float ndotv = max(dot(n, v / len), 0.0);
    // Range check keeps distant geometry from haloing near silhouettes.
    float rangeFix = smoothstep(0.0, 1.0, radius / max(len, 1e-4));
    occ += max(ndotv - bias, 0.0) * rangeFix;
  }
  occ = clamp(1.0 - occ / float(TAPS) * intensity, 0.0, 1.0);
  gl_FragColor = vec4(occ, occ, occ, 1.0);
}
`;

const AO_BLUR_FS = /* glsl */`
precision highp float;
uniform sampler2D tAO, tDepth;
uniform vec2 dir; uniform float near, far;
varying vec2 vUv;
float lin(vec2 uv){
  float d = texture2D(tDepth, uv).x; float z = d*2.0-1.0;
  return (2.0*near*far) / (far + near - z*(far-near));
}
void main(){
  // Depth-aware (bilateral) blur — keeps AO from bleeding across silhouettes.
  float dc = lin(vUv);
  float sum = texture2D(tAO, vUv).r, wsum = 1.0;
  for (int i = 1; i <= 4; i++){
    float fi = float(i);
    vec2 o = dir * fi;
    for (int s = 0; s < 2; s++){
      vec2 uv = vUv + (s == 0 ? o : -o);
      float dz = abs(lin(uv) - dc);
      float w = exp(-fi*fi*0.16) * exp(-dz*dz*3.0);
      sum += texture2D(tAO, uv).r * w; wsum += w;
    }
  }
  float v = sum / wsum;
  gl_FragColor = vec4(v, v, v, 1.0);
}
`;

const COMPOSITE_FS = /* glsl */`
precision highp float;

uniform sampler2D tScene, tBloom, tBloom2, tAO, tDof, tDepth;
uniform vec2 resolution;
uniform float uTime;

uniform float exposure, bloomStrength, aoStrength, useAO, useDof;
uniform float dofFocus, dofRange;          // metres
uniform float near, far;

/* Grade */
uniform vec3  gLift, gGamma, gGain, gTint;
uniform float gSat, gContrast, gTemp;

/* Look */
uniform float vignette, grain, chroma, halation, sepia, vhs, bleach, holo, dust;
uniform float letterbox, gridOverlay;

/* Time-warp wipe */
uniform float warp;                         // 0..1 progress
uniform vec3  warpColor;
uniform float warpDir;                      // 0 = radial, 1 = horizontal

/* Ghost overlay (previous era rendered faintly) */
uniform sampler2D tGhost;
uniform float ghostMix;

varying vec2 vUv;

/* ── helpers ────────────────────────────────────────────────────── */
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

/* ACES filmic approximation (Narkowicz) — cheap, and the shoulder is right. */
vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x*(a*x+b)) / (x*(c*x+d)+e), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(1e-5)), vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
}
float linDepth(vec2 uv){
  float d = texture2D(tDepth, uv).x; float z = d*2.0-1.0;
  return (2.0*near*far) / (far + near - z*(far-near));
}

void main(){
  vec2 uv = vUv;

  /* Barrel + chromatic aberration: sample each channel along a slightly
     different radius. Strength ramps with r² so the centre stays clean. */
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  vec3 col;
  if (chroma > 0.0001){
    float k = chroma * 0.0035 * (1.0 + r2 * 2.2);
    col.r = texture2D(tScene, uv + cc * k).r;
    col.g = texture2D(tScene, uv).g;
    col.b = texture2D(tScene, uv - cc * k).b;
  } else {
    col = texture2D(tScene, uv).rgb;
  }

  /* Depth of field — lerp toward the pre-blurred half-res copy by CoC. */
  if (useDof > 0.5){
    float z = linDepth(uv);
    float coc = clamp(abs(z - dofFocus) / max(dofRange, 0.01), 0.0, 1.0);
    coc = coc * coc;
    vec3 blurred = texture2D(tDof, uv).rgb;
    col = mix(col, blurred, coc);
  }

  /* Ambient occlusion */
  if (useAO > 0.5){
    float ao = texture2D(tAO, uv).r;
    col *= mix(1.0, ao, aoStrength);
  }

  /* Bloom: two mips, the wider one weighted lower, plus optional halation
     (a warm, wide, red-shifted bleed that sells neon and sodium lamps). */
  vec3 b1 = texture2D(tBloom, uv).rgb;
  vec3 b2 = texture2D(tBloom2, uv).rgb;
  vec3 bloom = b1 * 0.62 + b2 * 0.38;
  col += bloom * bloomStrength;
  if (halation > 0.0001){
    col += b2 * vec3(1.0, 0.34, 0.16) * halation * 0.9;
  }

  /* Exposure + tonemap */
  col *= exposure;
  col = aces(col);

  /* ── grade (all in display-referred space) ───────────────────── */
  col = clamp(col + gLift * (1.0 - col), 0.0, 1.0);      // lift shadows
  col = pow(max(col, vec3(1e-5)), 1.0 / max(gGamma, vec3(0.05)));
  col *= gGain;
  col *= gTint;
  // Temperature: push R vs B around the midpoint.
  col.r *= 1.0 + gTemp * 0.16;
  col.b *= 1.0 - gTemp * 0.16;
  float l = luma(col);
  col = mix(vec3(l), col, gSat);
  col = clamp((col - 0.5) * gContrast + 0.5, 0.0, 2.0);

  /* Sepia / silver-halide toning (1945) */
  if (sepia > 0.0001){
    vec3 sp = vec3(l*1.07 + 0.06, l*0.94 + 0.03, l*0.72);
    col = mix(col, sp, sepia);
  }
  /* Bleach bypass (2005 — that flat, contrasty digital-video look) */
  if (bleach > 0.0001){
    vec3 bb = mix(vec3(l), col, 0.4);
    bb = clamp((bb - 0.5) * 1.25 + 0.5, 0.0, 1.0);
    col = mix(col, bb, bleach);
  }
  /* Holographic spectral fringe (2055) */
  if (holo > 0.0001){
    float f = sin((uv.y * 220.0) + uTime * 1.7) * 0.5 + 0.5;
    vec3 spec = vec3(0.35 + 0.65*f, 0.55, 1.0 - 0.4*f);
    col += bloom * spec * holo * 0.5;
  }
  /* VHS (1985): chroma smear on scanlines, tape wobble, dropouts */
  if (vhs > 0.0001){
    float sl = sin(uv.y * resolution.y * 1.5) * 0.5 + 0.5;
    col *= mix(1.0, 0.9 + 0.1*sl, vhs * 0.7);
    float wob = sin(uv.y * 90.0 + uTime * 5.0) * 0.0011 * vhs;
    col.r = mix(col.r, texture2D(tScene, uv + vec2(wob, 0.0)).r, vhs * 0.55);
    float drop = step(0.9985, hash(vec2(floor(uv.y * 180.0), floor(uTime * 12.0))));
    col += drop * vhs * 0.16;
  }

  /* Airborne dust / soot motes drifting in the light (1945 & 2055) */
  if (dust > 0.0001){
    vec2 dv = uv * vec2(resolution.x / resolution.y, 1.0) * 3.0;
    float t = uTime * 0.05;
    float m = 0.0;
    for (int i = 0; i < 2; i++){
      vec2 q = dv * (1.0 + float(i) * 1.7) + vec2(t * (1.0 + float(i)), -t * 0.6);
      vec2 g = floor(q); vec2 f = fract(q);
      float h = hash(g);
      vec2 c = vec2(hash(g + 3.1), hash(g + 7.7));
      float d = length(f - c);
      m += smoothstep(0.055, 0.0, d) * step(0.86, h);
    }
    col += m * dust * vec3(1.0, 0.92, 0.78) * 0.5;
  }

  /* Ghost overlay — the previous era, faint, like a double exposure */
  if (ghostMix > 0.0001){
    vec3 g = texture2D(tGhost, uv).rgb;
    float gl = luma(g);
    vec3 gs = mix(vec3(gl), g, 0.25) * vec3(0.72, 0.86, 1.15);
    col = mix(col, max(col, gs), ghostMix);
    // Register lines so the overlay reads as an overlay, not a fog.
    col += ghostMix * 0.045 * step(0.5, fract(uv.y * resolution.y * 0.25));
  }

  /* Time-warp wipe: an expanding chromatic shockwave across the frame */
  if (warp > 0.0001){
    float d = warpDir > 0.5 ? uv.x : length(cc * vec2(resolution.x/resolution.y, 1.0)) / 0.72;
    float edge = warp * 1.55 - 0.28;
    float band = 1.0 - smoothstep(0.0, 0.16, abs(d - edge));
    float past = smoothstep(edge + 0.02, edge - 0.02, d);
    col = mix(col, col * vec3(0.62, 0.72, 0.95), (1.0 - past) * warp * 0.55);
    col += warpColor * band * (0.95 * (1.0 - abs(warp * 2.0 - 1.0)) + 0.22);
    // Streak the wipe front outward for a light-speed feel.
    float streak = band * 0.5;
    col += texture2D(tBloom2, mix(uv, vec2(0.5), 0.14)).rgb * streak * 0.9;
  }

  /* Vignette */
  if (vignette > 0.0001){
    float v = smoothstep(0.92, 0.22, length(cc) * 1.34);
    col *= mix(1.0, v, vignette);
  }

  /* Film grain, luminance-weighted (shadows get more, like real stock) */
  if (grain > 0.0001){
    float n = hash(uv * resolution + fract(uTime) * 137.0) - 0.5;
    col += n * grain * (0.16 + 0.5 * (1.0 - luma(col)));
  }

  /* Photo-mode chrome */
  if (letterbox > 0.0001){
    float bar = step(uv.y, letterbox) + step(1.0 - letterbox, uv.y);
    col = mix(col, vec3(0.0), clamp(bar, 0.0, 1.0));
  }
  if (gridOverlay > 0.5){
    vec2 g = abs(fract(uv * 3.0) - 0.5);
    float line = step(0.497, max(g.x, g.y)) * step(0.02, min(uv.y, 1.0-uv.y));
    col = mix(col, vec3(1.0), line * 0.22);
  }

  gl_FragColor = vec4(toSRGB(clamp(col, 0.0, 1.0)), 1.0);
}
`;

/* ────────────────────────────── class ────────────────────────────── */

export class PostFX {
  constructor(renderer, scene, camera, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    this.enabled = true;
    this.useBloom = true;
    this.useAO = opts.ao ?? true;
    this.useDof = false;
    this.msaa = opts.msaa ?? 4;

    this.settings = {
      exposure: 1.0,
      bloomStrength: 0.9,
      bloomThreshold: 1.0,
      bloomKnee: 0.55,
      aoStrength: 0.62,
      aoRadius: 1.2,
      vignette: 0.42,
      grain: 0.05,
      chroma: 0.4,
      halation: 0.0,
      sepia: 0, vhs: 0, bleach: 0, holo: 0, dust: 0,
      lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], tint: [1, 1, 1],
      sat: 1.0, contrast: 1.0, temp: 0.0,
      letterbox: 0, grid: 0,
      dofFocus: 8, dofRange: 6,
    };

    this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this._quad.frustumCulled = false;
    this._fsScene = new THREE.Scene();
    this._fsScene.add(this._quad);
    this._fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this._makeMaterials();
    this._targets = {};
    this.setSize(1, 1);
  }

  _makeMaterials() {
    const mk = (fs, uniforms) => new THREE.ShaderMaterial({
      vertexShader: FS_QUAD_VS, fragmentShader: fs, uniforms,
      depthTest: false, depthWrite: false,
    });

    this.mBright = mk(BRIGHT_FS, {
      tSrc: { value: null }, texel: { value: new THREE.Vector2() },
      threshold: { value: 1.0 }, knee: { value: 0.55 },
    });
    this.mBlur = mk(BLUR_FS, { tSrc: { value: null }, dir: { value: new THREE.Vector2() } });
    this.mDown = mk(DOWN_FS, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
    this.mAO = mk(AO_FS, {
      tDepth: { value: null }, texel: { value: new THREE.Vector2() },
      projInv: { value: new THREE.Matrix4() },
      radius: { value: 1.2 }, intensity: { value: 1.6 }, bias: { value: 0.035 },
      near: { value: 0.1 }, far: { value: 600 },
    });
    this.mAO.extensions = { derivatives: true };
    this.mAOBlur = mk(AO_BLUR_FS, {
      tAO: { value: null }, tDepth: { value: null }, dir: { value: new THREE.Vector2() },
      near: { value: 0.1 }, far: { value: 600 },
    });

    this.mComposite = mk(COMPOSITE_FS, {
      tScene: { value: null }, tBloom: { value: null }, tBloom2: { value: null },
      tAO: { value: null }, tDof: { value: null }, tDepth: { value: null }, tGhost: { value: null },
      resolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      exposure: { value: 1 }, bloomStrength: { value: 0.9 },
      aoStrength: { value: 0.6 }, useAO: { value: 1 }, useDof: { value: 0 },
      dofFocus: { value: 8 }, dofRange: { value: 6 },
      near: { value: 0.1 }, far: { value: 600 },
      gLift: { value: new THREE.Vector3() }, gGamma: { value: new THREE.Vector3(1, 1, 1) },
      gGain: { value: new THREE.Vector3(1, 1, 1) }, gTint: { value: new THREE.Vector3(1, 1, 1) },
      gSat: { value: 1 }, gContrast: { value: 1 }, gTemp: { value: 0 },
      vignette: { value: 0.42 }, grain: { value: 0.05 }, chroma: { value: 0.4 },
      halation: { value: 0 }, sepia: { value: 0 }, vhs: { value: 0 },
      bleach: { value: 0 }, holo: { value: 0 }, dust: { value: 0 },
      letterbox: { value: 0 }, gridOverlay: { value: 0 },
      warp: { value: 0 }, warpColor: { value: new THREE.Vector3(1, 0.8, 0.5) }, warpDir: { value: 0 },
      ghostMix: { value: 0 },
    });
  }

  setSize(w, h) {
    w = Math.max(2, Math.floor(w)); h = Math.max(2, Math.floor(h));
    if (this._w === w && this._h === h) return;
    this._w = w; this._h = h;

    for (const k in this._targets) this._targets[k]?.dispose();
    this._targets = {};

    const hdr = {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      generateMipmaps: false, depthBuffer: true, stencilBuffer: false,
      colorSpace: THREE.LinearSRGBColorSpace,
    };

    const scene = new THREE.WebGLRenderTarget(w, h, { ...hdr, samples: this.msaa });
    scene.depthTexture = new THREE.DepthTexture(w, h);
    scene.depthTexture.type = THREE.UnsignedIntType;
    scene.depthTexture.minFilter = THREE.NearestFilter;
    scene.depthTexture.magFilter = THREE.NearestFilter;
    this._targets.scene = scene;

    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    const qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
    const light = { ...hdr, depthBuffer: false };
    this._targets.half1 = new THREE.WebGLRenderTarget(hw, hh, light);
    this._targets.half2 = new THREE.WebGLRenderTarget(hw, hh, light);
    this._targets.quarter1 = new THREE.WebGLRenderTarget(qw, qh, light);
    this._targets.quarter2 = new THREE.WebGLRenderTarget(qw, qh, light);
    this._targets.dof = new THREE.WebGLRenderTarget(hw, hh, light);
    this._targets.dofTmp = new THREE.WebGLRenderTarget(hw, hh, light);

    const ldr = {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, generateMipmaps: false, colorSpace: THREE.LinearSRGBColorSpace,
    };
    this._targets.ao1 = new THREE.WebGLRenderTarget(hw, hh, ldr);
    this._targets.ao2 = new THREE.WebGLRenderTarget(hw, hh, ldr);

    this.mComposite.uniforms.resolution.value.set(w, h);
  }

  /** Off-screen HDR target the scene should be rendered into. */
  get sceneTarget() { return this._targets.scene; }

  /**
   * Half-resolution HDR target for the "ghost of the adjacent decade" overlay.
   * The caller renders the other era's scene into this, then the composite
   * pass double-exposes it over the live frame.
   */
  ghostTarget() {
    const w = Math.max(1, this._w >> 1), h = Math.max(1, this._h >> 1);
    if (!this._ghostRT) {
      this._ghostRT = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        depthBuffer: true, colorSpace: THREE.LinearSRGBColorSpace,
      });
    } else if (this._ghostRT.width !== w || this._ghostRT.height !== h) {
      this._ghostRT.setSize(w, h);
    }
    this.mComposite.uniforms.tGhost.value = this._ghostRT.texture;
    return this._ghostRT;
  }

  /** A snapshot of the current composite input, used for the ghost overlay. */
  captureGhost() {
    const t = this._targets;
    if (!this._ghostRT) {
      this._ghostRT = new THREE.WebGLRenderTarget(this._w >> 1, this._h >> 1, {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        depthBuffer: false, colorSpace: THREE.LinearSRGBColorSpace,
      });
    } else if (this._ghostRT.width !== (this._w >> 1)) {
      this._ghostRT.setSize(Math.max(1, this._w >> 1), Math.max(1, this._h >> 1));
    }
    this._blit(this.mDown, { tSrc: t.scene.texture, texel: [0.5 / this._w, 0.5 / this._h] }, this._ghostRT);
    this.mComposite.uniforms.tGhost.value = this._ghostRT.texture;
    return this._ghostRT.texture;
  }

  _blit(mat, uniforms, target) {
    for (const k in uniforms) {
      const u = mat.uniforms[k];
      if (!u) continue;
      const v = uniforms[k];
      if (Array.isArray(v) && u.value?.set) u.value.set(...v);
      else u.value = v;
    }
    this._quad.material = mat;
    this.renderer.setRenderTarget(target ?? null);
    this.renderer.render(this._fsScene, this._fsCam);
  }

  /**
   * Run the full chain. The scene must already have been rendered into
   * `sceneTarget` by the caller (so it can control layers/overrides).
   */
  render(time) {
    const r = this.renderer, t = this._targets, s = this.settings;
    const w = this._w, h = this._h;

    /* ── AO ───────────────────────────────────────────────────── */
    if (this.useAO) {
      this.camera.updateProjectionMatrix();
      this.mAO.uniforms.projInv.value.copy(this.camera.projectionMatrixInverse);
      this.mAO.uniforms.near.value = this.camera.near;
      this.mAO.uniforms.far.value = this.camera.far;
      this.mAO.uniforms.radius.value = s.aoRadius;
      this._blit(this.mAO, {
        tDepth: t.scene.depthTexture,
        texel: [2 / w, 2 / h],
      }, t.ao1);
      this.mAOBlur.uniforms.near.value = this.camera.near;
      this.mAOBlur.uniforms.far.value = this.camera.far;
      this._blit(this.mAOBlur, { tAO: t.ao1.texture, tDepth: t.scene.depthTexture, dir: [2 / w, 0] }, t.ao2);
      this._blit(this.mAOBlur, { tAO: t.ao2.texture, tDepth: t.scene.depthTexture, dir: [0, 2 / h] }, t.ao1);
    }

    /* ── Bloom ────────────────────────────────────────────────── */
    if (this.useBloom) {
      this.mBright.uniforms.threshold.value = s.bloomThreshold;
      this.mBright.uniforms.knee.value = s.bloomKnee;
      this._blit(this.mBright, { tSrc: t.scene.texture, texel: [1 / w, 1 / h] }, t.half1);
      this._blit(this.mBlur, { tSrc: t.half1.texture, dir: [2 / w, 0] }, t.half2);
      this._blit(this.mBlur, { tSrc: t.half2.texture, dir: [0, 2 / h] }, t.half1);
      this._blit(this.mDown, { tSrc: t.half1.texture, texel: [1 / w, 1 / h] }, t.quarter1);
      this._blit(this.mBlur, { tSrc: t.quarter1.texture, dir: [4 / w, 0] }, t.quarter2);
      this._blit(this.mBlur, { tSrc: t.quarter2.texture, dir: [0, 4 / h] }, t.quarter1);
    }

    /* ── DOF prefilter (photo mode only) ──────────────────────── */
    if (this.useDof) {
      this._blit(this.mDown, { tSrc: t.scene.texture, texel: [1 / w, 1 / h] }, t.dofTmp);
      this._blit(this.mBlur, { tSrc: t.dofTmp.texture, dir: [2.5 / w, 0] }, t.dof);
      this._blit(this.mBlur, { tSrc: t.dof.texture, dir: [0, 2.5 / h] }, t.dofTmp);
      this._blit(this.mBlur, { tSrc: t.dofTmp.texture, dir: [1.8 / w, 1.8 / h] }, t.dof);
    }

    /* ── Composite ────────────────────────────────────────────── */
    const u = this.mComposite.uniforms;
    u.tScene.value = t.scene.texture;
    u.tBloom.value = this.useBloom ? t.half1.texture : t.half1.texture;
    u.tBloom2.value = this.useBloom ? t.quarter1.texture : t.quarter1.texture;
    u.tAO.value = t.ao1.texture;
    u.tDof.value = t.dof.texture;
    u.tDepth.value = t.scene.depthTexture;
    u.uTime.value = time;
    u.exposure.value = s.exposure;
    u.bloomStrength.value = this.useBloom ? s.bloomStrength : 0;
    u.aoStrength.value = s.aoStrength;
    u.useAO.value = this.useAO ? 1 : 0;
    u.useDof.value = this.useDof ? 1 : 0;
    u.dofFocus.value = s.dofFocus;
    u.dofRange.value = s.dofRange;
    u.near.value = this.camera.near;
    u.far.value = this.camera.far;
    u.gLift.value.set(...s.lift);
    u.gGamma.value.set(...s.gamma);
    u.gGain.value.set(...s.gain);
    u.gTint.value.set(...s.tint);
    u.gSat.value = s.sat;
    u.gContrast.value = s.contrast;
    u.gTemp.value = s.temp;
    u.vignette.value = s.vignette;
    u.grain.value = s.grain;
    u.chroma.value = s.chroma;
    u.halation.value = s.halation;
    u.sepia.value = s.sepia;
    u.vhs.value = s.vhs;
    u.bleach.value = s.bleach;
    u.holo.value = s.holo;
    u.dust.value = s.dust;
    u.letterbox.value = s.letterbox;
    u.gridOverlay.value = s.grid;

    this._quad.material = this.mComposite;
    r.setRenderTarget(null);
    r.render(this._fsScene, this._fsCam);
  }

  setWarp(progress, colorHex = 0xffd6a0, horizontal = false) {
    const u = this.mComposite.uniforms;
    u.warp.value = clamp01(progress);
    u.warpDir.value = horizontal ? 1 : 0;
    const c = new THREE.Color(colorHex);
    u.warpColor.value.set(c.r, c.g, c.b);
  }
  setGhost(mix) { this.mComposite.uniforms.ghostMix.value = clamp01(mix); }

  dispose() {
    for (const k in this._targets) this._targets[k]?.dispose();
    this._ghostRT?.dispose();
    this._quad.geometry.dispose();
    [this.mBright, this.mBlur, this.mDown, this.mAO, this.mAOBlur, this.mComposite]
      .forEach((m) => m.dispose());
  }
}
