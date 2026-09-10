/**
 * Sky, sun and atmosphere.
 *
 * A single inverted sphere with a procedural shader gives the gradient, the sun
 * disc and halo, drifting fbm clouds, stars and horizon haze. Because it is a
 * real shader rather than a photo, it can be interpolated continuously — which
 * is what lets the time-warp slide 1945's coal haze into 1985's neon-lit
 * overcast without a visible cut.
 *
 * The same dome is also the scene's environment map: PMREM-filtering it gives
 * physically sensible reflections in glass, chrome and wet asphalt for free.
 */

import * as THREE from 'three';
import { lerp, clamp01, DEG } from '../core/mathx.js';

const SKY_VS = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w;      // always at the far plane
}
`;

const SKY_FS = /* glsl */`
precision highp float;
varying vec3 vDir;

uniform vec3 topColor, horizonColor, groundColor, sunColor, cloudColor;
uniform vec3 sunDir;
uniform float sunSize, sunIntensity;
uniform float cloudAmount, cloudSpeed, cloudSharp;
uniform float haze, stars, time, exposure;
uniform float holoGlow;
uniform vec3 holoColor;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = hash(i), b = hash(i+vec2(1,0)), c = hash(i+vec2(0,1)), d = hash(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
float hash31(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

void main(){
  vec3 dir = normalize(vDir);
  float h = dir.y;

  /* Base gradient. The horizon band is deliberately wide — it is what makes a
     procedural sky read as "atmosphere" rather than "gradient". */
  float up = smoothstep(-0.06, 0.46, h);
  vec3 col = mix(horizonColor, topColor, up);
  col = mix(groundColor, col, smoothstep(-0.16, 0.02, h));

  /* Sun */
  float sd = max(dot(dir, sunDir), 0.0);
  float disc = smoothstep(1.0 - sunSize * 1.6, 1.0 - sunSize * 0.4, sd);
  float glow = pow(sd, 1400.0) * 0.5 + pow(sd, 90.0) * 0.30 + pow(sd, 8.0) * 0.16;
  col += sunColor * (disc * 9.0 + glow * 2.6) * sunIntensity;

  /* Stars — only where the sky is dark enough to earn them. */
  if (stars > 0.001 && h > -0.02){
    vec3 cell = floor(dir * 340.0);
    float s = hash31(cell);
    float tw = 0.6 + 0.4 * sin(time * 2.2 + s * 60.0);
    float bright = smoothstep(0.9965, 0.9995, s) * tw;
    float dim = 1.0 - clamp(dot(col, vec3(0.33)) * 1.6, 0.0, 1.0);
    col += vec3(0.85, 0.9, 1.0) * bright * stars * dim * 2.2;
  }

  /* Clouds: fbm on the direction projected onto a high plane. */
  if (cloudAmount > 0.001 && h > 0.005){
    vec2 cuv = dir.xz / max(h, 0.09);
    cuv *= 0.42;
    float t = time * cloudSpeed;
    float n = fbm(cuv * 1.1 + vec2(t, t * 0.35));
    n = mix(n, fbm(cuv * 2.7 - vec2(t * 1.6, 0.0)), 0.4);
    float cover = smoothstep(0.62 - cloudAmount * 0.42, 0.86 - cloudAmount * 0.28, n);
    cover *= smoothstep(0.0, 0.16, h);                 // fade at the horizon
    // Light the underside from the sun so cloud edges pick up rim colour.
    float lit = clamp(dot(dir, sunDir) * 0.5 + 0.5, 0.0, 1.0);
    vec3 cc = mix(cloudColor * 0.72, cloudColor + sunColor * 0.55, pow(lit, 3.0));
    col = mix(col, cc, cover * mix(0.55, 0.96, cloudSharp));
  }

  /* Horizon haze — pollution in 1945, humidity in 2055. */
  float hz = exp(-max(h, 0.0) * 7.0);
  col = mix(col, horizonColor * 1.06, hz * haze);

  /* 2055: the ambient glow of a hundred holographic ads bouncing off the air. */
  if (holoGlow > 0.001){
    float band = exp(-max(h, 0.0) * 3.2) * (0.6 + 0.4 * sin(dir.x * 3.0 + time * 0.4));
    col += holoColor * band * holoGlow * 0.16;
  }

  gl_FragColor = vec4(col * exposure, 1.0);
}
`;

const V = (hex) => new THREE.Color(hex);

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;

    this.uniforms = {
      topColor: { value: V(0x5a7ea8) },
      horizonColor: { value: V(0xd8b98a) },
      groundColor: { value: V(0x6b5a45) },
      sunColor: { value: V(0xffd9a0) },
      cloudColor: { value: V(0xe8dcc8) },
      holoColor: { value: V(0x56d0e0) },
      sunDir: { value: new THREE.Vector3(0.4, 0.5, -0.6).normalize() },
      sunSize: { value: 0.006 },
      sunIntensity: { value: 1.0 },
      cloudAmount: { value: 0.4 },
      cloudSpeed: { value: 0.014 },
      cloudSharp: { value: 0.5 },
      haze: { value: 0.4 },
      stars: { value: 0 },
      time: { value: 0 },
      exposure: { value: 1 },
      holoGlow: { value: 0 },
    };

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 40, 24),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: this.uniforms,
        side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
        toneMapped: false,
      })
    );
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.scale.setScalar(400);
    scene.add(this.mesh);

    /* ── Lights ─────────────────────────────────────────────────── */
    this.sun = new THREE.DirectionalLight(0xffd9a0, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 260;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.045;
    this.sun.shadow.radius = 1.6;
    this._setShadowExtent(95);
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x9fb4cc, 0x6a5a48, 0.72);
    scene.add(this.hemi);

    /* A gentle bounce from the sunlit facade opposite — cheap fill that makes
       shadowed brick read as brick rather than as a black hole. */
    this.bounce = new THREE.DirectionalLight(0xffe0c0, 0.28);
    this.bounce.castShadow = false;
    scene.add(this.bounce);

    this.fog = new THREE.Fog(0xcbb193, 40, 235);
    scene.fog = this.fog;

    /* ── Environment (PMREM of this dome) ───────────────────────── */
    this._pmrem = new THREE.PMREMGenerator(renderer);
    this._pmrem.compileEquirectangularShader();
    this._envScene = new THREE.Scene();
    this._envSky = this.mesh.clone();
    this._envSky.material = this.mesh.material;
    this._envSky.scale.setScalar(100);
    this._envScene.add(this._envSky);
    this._envRT = null;
    this._envDirty = true;

    this.shadowDistance = 95;
    this._time = 0;
  }

  _setShadowExtent(d) {
    const c = this.sun.shadow.camera;
    c.left = -d; c.right = d; c.top = d; c.bottom = -d;
    c.far = d * 3.2;
    c.updateProjectionMatrix();
  }

  setShadowQuality(size, distance) {
    if (this.sun.shadow.mapSize.width !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.shadowDistance = distance;
    this._setShadowExtent(distance);
  }

  /**
   * Apply an era's sky block, optionally blended toward another.
   * `timeOfDay` (minutes) rotates the sun independently so the time-of-day
   * slider works inside every era.
   */
  apply(skyA, skyB = null, t = 0, timeOfDay = null) {
    const u = this.uniforms;
    const mix = (a, b) => (skyB ? lerp(a, b, t) : a);
    const mixC = (target, a, b) => {
      target.set(a);
      if (skyB) target.lerp(new THREE.Color(b), t);
    };

    mixC(u.topColor.value, skyA.top, skyB?.top);
    mixC(u.horizonColor.value, skyA.horizon, skyB?.horizon);
    mixC(u.groundColor.value, skyA.ground, skyB?.ground);
    mixC(u.sunColor.value, skyA.sunColor, skyB?.sunColor);
    mixC(u.cloudColor.value, skyA.cloudColor, skyB?.cloudColor);

    u.cloudAmount.value = mix(skyA.clouds, skyB?.clouds ?? skyA.clouds);
    u.cloudSpeed.value = mix(skyA.cloudSpeed, skyB?.cloudSpeed ?? skyA.cloudSpeed);
    u.haze.value = mix(skyA.haze, skyB?.haze ?? skyA.haze);
    u.stars.value = mix(skyA.stars ?? 0, skyB?.stars ?? 0);
    u.holoGlow.value = mix(skyA.holoGlow ?? 0, skyB?.holoGlow ?? 0);
    u.cloudSharp.value = skyA.overcast ? 0.95 : 0.5;

    let elev = mix(skyA.sunElev, skyB?.sunElev ?? skyA.sunElev);
    let azim = mix(skyA.sunAzim, skyB?.sunAzim ?? skyA.sunAzim);
    let intensity = mix(skyA.sunIntensity, skyB?.sunIntensity ?? skyA.sunIntensity);

    if (timeOfDay !== null) {
      // Map 06:00→sunrise (0°) through 12:00→peak through 18:00→sunset.
      const frac = (timeOfDay % 1440) / 1440;
      const dayAngle = (frac - 0.25) * Math.PI * 2;   // 06:00 == 0
      const peak = Math.max(skyA.sunElev, 52);
      elev = Math.sin(dayAngle) * peak;
      azim = 90 + frac * 360;
      const night = clamp01((-elev + 2) / 10);
      intensity = lerp(skyA.sunIntensity, 0.05, night);
      u.stars.value = Math.max(u.stars.value, night * 0.75);
      // Warm the sky as the sun sits low; cool it at night.
      const low = clamp01(1 - Math.abs(elev) / 22);
      u.horizonColor.value.lerp(new THREE.Color(0xff9a52), low * 0.55 * (1 - night));
      u.topColor.value.lerp(new THREE.Color(0x0a1226), night * 0.85);
      u.horizonColor.value.lerp(new THREE.Color(0x14203a), night * 0.7);
      u.groundColor.value.lerp(new THREE.Color(0x0a0e16), night * 0.8);
    }

    const e = elev * DEG, a = azim * DEG;
    const dir = new THREE.Vector3(
      Math.cos(e) * Math.sin(a),
      Math.sin(e),
      Math.cos(e) * Math.cos(a)
    ).normalize();
    u.sunDir.value.copy(dir);
    u.sunIntensity.value = clamp01(intensity / 3.4) + 0.25;

    /* Directional light follows the same vector. */
    this.sun.position.copy(dir).multiplyScalar(120);
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();
    this.sun.color.copy(u.sunColor.value);
    this.sun.intensity = Math.max(0, intensity);
    this.sun.visible = intensity > 0.02;

    this.bounce.position.set(-dir.x * 60, Math.max(8, dir.y * 20), -dir.z * 60);
    this.bounce.color.copy(u.horizonColor.value);
    this.bounce.intensity = 0.18 + u.haze.value * 0.3;

    this.hemi.color.copy(new THREE.Color(skyA.ambSky));
    this.hemi.groundColor.copy(new THREE.Color(skyA.ambGround));
    if (skyB) {
      this.hemi.color.lerp(new THREE.Color(skyB.ambSky), t);
      this.hemi.groundColor.lerp(new THREE.Color(skyB.ambGround), t);
    }
    this.hemi.intensity = mix(skyA.ambIntensity, skyB?.ambIntensity ?? skyA.ambIntensity);

    const fogC = new THREE.Color(skyA.fog);
    if (skyB) fogC.lerp(new THREE.Color(skyB.fog), t);
    this.fog.color.copy(fogC);
    this.fog.near = mix(skyA.fogNear, skyB?.fogNear ?? skyA.fogNear);
    this.fog.far = mix(skyA.fogFar, skyB?.fogFar ?? skyA.fogFar);
    this.scene.background = null;

    this._envDirty = true;
  }

  /** Regenerate the PMREM environment. Called on era/time change, not per frame. */
  updateEnvironment() {
    if (!this._envDirty) return null;
    this._envDirty = false;
    const prev = this._envRT;
    try {
      this._envRT = this._pmrem.fromScene(this._envScene, 0.02, 0.1, 900);
    } catch {
      return prev?.texture ?? null;   // PMREM can fail on very old GPUs
    }
    prev?.dispose();
    this.scene.environment = this._envRT.texture;
    return this._envRT.texture;
  }

  /** Keep the shadow frustum centred on the player so 2048² goes a long way. */
  followCamera(camPos) {
    const d = this.uniforms.sunDir.value;
    this.sun.position.set(
      camPos.x + d.x * 120,
      camPos.y + d.y * 120,
      camPos.z + d.z * 120
    );
    this.sun.target.position.set(camPos.x, 0, camPos.z);
    this.sun.target.updateMatrixWorld();
    this.mesh.position.copy(camPos);
  }

  update(dt) {
    this._time += dt;
    this.uniforms.time.value = this._time;
  }

  /** Direction the sun is coming FROM (for lens flare / god ray placement). */
  get sunDirection() { return this.uniforms.sunDir.value; }
  /** 0 at night, 1 at noon — drives street-lamp auto-on and window lights. */
  get daylight() { return clamp01(this.uniforms.sunDir.value.y * 3.2); }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this._envRT?.dispose();
    this._pmrem.dispose();
  }
}
