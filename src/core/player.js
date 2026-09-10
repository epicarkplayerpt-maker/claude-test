/**
 * First-person controller.
 *
 * Walking, sprinting, crouching, a small jump, stepping up the kerb, head bob,
 * and a free-fly mode for photography. Movement is acceleration-based rather
 * than teleport-per-frame so a phone at 40fps and a desktop at 144fps feel the
 * same, and collision is a slide against the block's AABBs.
 */

import * as THREE from 'three';
import { clamp, clamp01, damp, dampAngle, lerp, smoothstep, DEG } from './mathx.js';

const EYE = 1.68;
const CROUCH_EYE = 1.06;

export class Player {
  constructor(camera, city) {
    this.camera = camera;
    this.city = city;

    this.pos = new THREE.Vector3(0, 0, CURB_START());
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;
    this.pitch = -0.04;
    this.eye = EYE;
    this.targetEye = EYE;

    this.grounded = true;
    this.flying = false;
    this.speedWalk = 2.5;
    this.speedRun = 5.4;
    this.speedFly = 9;
    this.bobEnabled = true;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.fovBase = 72;
    this.fovKick = 0;
    this.stepAccum = 0;
    this.onStep = null;

    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._targetRoll = 0;
    this.roll = 0;

    this.frozen = false;
  }

  reset(x = 0, z = 40, yaw = Math.PI) {
    this.pos.set(x, this.city ? this.city.groundAt(x, z) : 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = -0.04;
    this.flying = false;
  }

  /** Where the camera is actually looking, unit length. */
  get lookDir() {
    return this._dir.set(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();
  }

  update(dt, input, opts = {}) {
    const look = input.takeLook();
    if (!this.frozen) {
      this.yaw += look.x;
      this.pitch = clamp(this.pitch + look.y, -1.45, 1.45);
    }

    const move = input.move;
    const mag = input.moveMag;
    const wantRun = input.sprint && !input.crouch;
    const wantCrouch = input.crouch && !this.flying;

    /* Movement basis from yaw only — pitch must not drive walking. */
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);

    let wishX = fx * move.y + rx * move.x;
    let wishZ = fz * move.y + rz * move.x;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 1e-4) { wishX /= wishLen; wishZ /= wishLen; }

    if (this.flying) {
      const s = this.speedFly * (wantRun ? 2.6 : 1) * (input.crouch ? 0.35 : 1);
      // In free-fly the camera moves along the full look vector.
      const d = this.lookDir;
      const vx = (d.x * move.y + rx * move.x) * s * mag;
      const vz = (d.z * move.y + rz * move.x) * s * mag;
      const vy = d.y * move.y * s * mag + (input.jumpPressed || input.keys?.has('Space') ? s * 0.6 : 0);
      this.vel.x = damp(this.vel.x, vx, 9, dt);
      this.vel.z = damp(this.vel.z, vz, 9, dt);
      this.vel.y = damp(this.vel.y, vy, 9, dt);
      this.pos.addScaledVector(this.vel, dt);
      this.pos.y = clamp(this.pos.y, 0.4, 90);
      this.targetEye = 0;
      this.bobAmount = damp(this.bobAmount, 0, 8, dt);
    } else {
      const base = wantCrouch ? this.speedWalk * 0.46 : wantRun ? this.speedRun : this.speedWalk;
      const target = base * clamp01(mag);
      const accel = this.grounded ? 26 : 6;
      this.vel.x = damp(this.vel.x, wishX * target, accel * 0.5, dt);
      this.vel.z = damp(this.vel.z, wishZ * target, accel * 0.5, dt);

      /* Gravity + jump */
      if (input.jumpPressed && this.grounded) { this.vel.y = 4.2; this.grounded = false; }
      this.vel.y -= 15.5 * dt;

      let nx = this.pos.x + this.vel.x * dt;
      let nz = this.pos.z + this.vel.z * dt;
      if (this.city) [nx, nz] = this.city.collide(nx, nz, 0.36);
      this.pos.x = nx; this.pos.z = nz;
      this.pos.y += this.vel.y * dt;

      const g = this.city ? this.city.groundAt(this.pos.x, this.pos.z) : 0;
      if (this.pos.y <= g + 0.001) {
        // Kerbs are 16 cm; step straight up rather than blocking.
        this.pos.y = g;
        this.vel.y = 0;
        this.grounded = true;
      } else if (this.pos.y - g < 0.34 && this.vel.y <= 0) {
        this.pos.y = lerp(this.pos.y, g, 1 - Math.exp(-22 * dt));
        this.grounded = true;
      } else {
        this.grounded = false;
      }

      this.targetEye = wantCrouch ? CROUCH_EYE : EYE;

      /* Head bob + footsteps, both driven by distance travelled. */
      const speed = Math.hypot(this.vel.x, this.vel.z);
      const moving = speed > 0.35 && this.grounded;
      this.bobAmount = damp(this.bobAmount, moving && this.bobEnabled ? clamp01(speed / this.speedRun) : 0, 7, dt);
      if (moving) {
        const prev = this.bobPhase;
        this.bobPhase += speed * 1.62 * dt;
        this.stepAccum += speed * dt;
        // A footstep every ~0.78 m, which is about right for a walking stride.
        if (this.stepAccum > 0.78) {
          this.stepAccum = 0;
          this.onStep?.(clamp01(speed / this.speedRun));
        }
      }
      this._targetRoll = -move.x * 0.018 * clamp01(speed / this.speedRun);
    }

    this.eye = damp(this.eye, this.targetEye, 11, dt);
    this.roll = damp(this.roll, this.flying ? 0 : this._targetRoll, 6, dt);

    /* FOV kick while sprinting sells speed better than moving faster does. */
    const kickTarget = (!this.flying && wantRun && mag > 0.5) ? 6 : 0;
    this.fovKick = damp(this.fovKick, kickTarget, 5, dt);

    this.applyToCamera(opts.reduceMotion);
  }

  applyToCamera(reduceMotion = false) {
    const cam = this.camera;
    const bob = reduceMotion ? 0 : this.bobAmount;
    const bobY = Math.sin(this.bobPhase * 2) * 0.042 * bob;
    const bobX = Math.cos(this.bobPhase) * 0.03 * bob;

    cam.position.set(
      this.pos.x + bobX * Math.cos(this.yaw),
      this.pos.y + this.eye + bobY,
      this.pos.z - bobX * Math.sin(this.yaw)
    );
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw + Math.PI;   // +Z forward in this scene's convention
    cam.rotation.x = this.pitch;
    cam.rotation.z = reduceMotion ? 0 : this.roll + Math.sin(this.bobPhase) * 0.006 * bob;
  }

  /** Point the camera at a world position (used by the guided tour). */
  lookAt(target, immediate = false, dt = 0) {
    const dx = target.x - this.pos.x;
    const dy = target.y - (this.pos.y + this.eye);
    const dz = target.z - this.pos.z;
    const yaw = Math.atan2(dx, dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    if (immediate) { this.yaw = yaw; this.pitch = pitch; }
    else {
      this.yaw = dampAngle(this.yaw, yaw, 3.2, dt);
      this.pitch = damp(this.pitch, pitch, 3.2, dt);
    }
  }

  /** Move toward a world position; returns true once within `stop` metres. */
  moveTo(target, dt, stop = 1.4, speed = 2.2) {
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < stop) return true;
    const s = Math.min(speed, d * 1.6);
    let nx = this.pos.x + (dx / d) * s * dt;
    let nz = this.pos.z + (dz / d) * s * dt;
    if (this.city) [nx, nz] = this.city.collide(nx, nz, 0.36);
    this.pos.x = nx; this.pos.z = nz;
    this.pos.y = this.city ? this.city.groundAt(nx, nz) : 0;
    this.bobPhase += s * 1.62 * dt;
    this.bobAmount = damp(this.bobAmount, 0.6, 6, dt);
    return false;
  }
}

/** Starting position: on the sidewalk across Vine, looking at the Palace. */
function CURB_START() { return 41; }
