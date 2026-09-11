/**
 * Screen-space markers.
 *
 * The block is full of things worth walking up to, and until now the only way
 * to discover that was to already be looking at one — the prompt appears when
 * the reticle lands on something. On a desktop you sweep the mouse and find
 * things by accident. On a phone there is no hover at all, so the scene reads
 * as scenery: you can walk around a beautifully detailed street and never learn
 * that any of it is readable. That is the difference between a place and a game.
 *
 * Two readouts, drawn into one full-screen canvas:
 *
 *  - A **lead chevron**, always on (until you turn it off), pointing at the
 *    nearest thing you have not yet read, with the distance to it. Direction
 *    without spoilers: it tells you where to walk, never what you will find.
 *  - **Sense rings**, which appear for a few seconds when you ask for them.
 *    Everything unread within range gets a ring and a label. It is on a
 *    cooldown so it stays a decision rather than a thing you hold down.
 *
 * Nothing here touches the 3D scene: no geometry, no materials, no draw calls.
 * It is one 2D canvas the frame loop paints.
 */

import * as THREE from 'three';

const SENSE_TIME = 4.2;      // seconds a pulse stays up
const SENSE_COOLDOWN = 7.0;  // seconds before it can be asked for again
const SENSE_RANGE = 26;      // metres a pulse reaches
const LEAD_RANGE = 90;       // metres the chevron will point across

export class Markers {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.senseT = 0;
    this.coolT = 0;
    this.enabled = true;      // the lead chevron; sense always works
    this.reduceMotion = false;
    this._v = new THREE.Vector3();
    this._w = 0; this._h = 0; this._dpr = 1;
  }

  /** True if a pulse was actually started (i.e. not on cooldown). */
  sense() {
    if (this.coolT > 0) return false;
    this.senseT = SENSE_TIME;
    this.coolT = SENSE_TIME + SENSE_COOLDOWN;
    return true;
  }

  /** 0..1 — how much of the cooldown is left, for the button's dimming. */
  get cooldown() { return this.coolT > 0 ? this.coolT / (SENSE_TIME + SENSE_COOLDOWN) : 0; }

  resize(w, h, dpr) {
    if (this._w === w && this._h === h && this._dpr === dpr) return;
    this._w = w; this._h = h; this._dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  /**
   * @param dt      seconds
   * @param camera  the live camera
   * @param items   interactables for the current era
   * @param isSeen  (id) => boolean
   * @param accent  css colour for rings
   */
  update(dt, camera, items, isSeen, accent = '#e8b46a', playing = true) {
    this.senseT = Math.max(0, this.senseT - dt);
    this.coolT = Math.max(0, this.coolT - dt);

    /* Clearing and repainting a full-screen 2D canvas every frame costs real
       milliseconds on a phone, and nothing here moves fast enough to need 60
       of them a second. Twenty-five is indistinguishable and nearly free. */
    this._acc = (this._acc || 0) + dt;
    if (this._acc < 0.04) return;
    dt = this._acc;
    this._acc = 0;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.resize(window.innerWidth, window.innerHeight, dpr);

    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, this._w, this._h);
    if (!playing || !items?.length) return;

    const cam = camera.position;
    const pulse = this.senseT > 0 ? Math.min(1, this.senseT / 0.4) *
      Math.min(1, (SENSE_TIME - this.senseT) / 0.25 + 0.25) : 0;

    /* Gather first, draw second: labels have to know about each other or two
       things a metre apart print on top of one another. */
    let lead = null, leadD = Infinity;
    const onScreen = [];

    for (const it of items) {
      if (isSeen(it.id)) continue;
      const dx = it.pos.x - cam.x, dy = it.pos.y - cam.y, dz = it.pos.z - cam.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > LEAD_RANGE) continue;
      if (dist < leadD) { leadD = dist; lead = it; }

      if (pulse <= 0 || dist > SENSE_RANGE) continue;

      this._v.set(it.pos.x, it.pos.y, it.pos.z).project(camera);
      if (this._v.z > 1) continue;                       // behind the camera
      const sx = (this._v.x * 0.5 + 0.5) * this._w;
      const sy = (-this._v.y * 0.5 + 0.5) * this._h;
      if (sx < -60 || sx > this._w + 60 || sy < -60 || sy > this._h + 60) continue;
      onScreen.push({ it, dist, sx, sy });
    }

    onScreen.sort((a, b) => a.dist - b.dist);

    const taken = [];   // label boxes already placed, for collision
    for (let i = 0; i < onScreen.length; i++) {
      const { it, dist, sx, sy } = onScreen[i];
      // Near things get a bigger ring; everything fades out with range.
      const r = Math.max(9, Math.min(30, 340 / Math.max(3, dist)));
      const a = pulse * (1 - Math.min(1, dist / SENSE_RANGE) * 0.55);
      c.save();
      c.globalAlpha = a;
      c.strokeStyle = accent;
      c.lineWidth = 2;
      c.beginPath(); c.arc(sx, sy, r, 0, Math.PI * 2); c.stroke();
      c.globalAlpha = a * 0.32;
      c.fillStyle = accent;
      c.beginPath(); c.arc(sx, sy, r * 0.42, 0, Math.PI * 2); c.fill();

      /* Only the three nearest get named, and only if a slot is free. Any more
         and the pulse stops being a hint and becomes a wall of text. */
      if (i < 3 && dist < 18 && it.title) {
        c.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
        const tw = c.measureText(it.title).width + 12;
        let ly = sy + r + 6;
        for (let guard = 0; guard < 6; guard++) {
          const clash = taken.some((t) => Math.abs(t.y - ly) < 21 && Math.abs(t.x - sx) < (t.w + tw) / 2);
          if (!clash) break;
          ly += 22;
        }
        taken.push({ x: sx, y: ly, w: tw });
        c.globalAlpha = a;
        c.textAlign = 'center';
        c.fillStyle = 'rgba(6,8,12,.72)';
        c.fillRect(sx - tw / 2, ly, tw, 18);
        c.fillStyle = accent;
        c.fillText(it.title, sx, ly + 13);
      }
      c.restore();
    }

    // Within arm's reach the prompt already says what it is, so the chevron
    // would only be repeating itself.
    if (this.enabled && lead && leadD > 3.2) this._drawLead(c, camera, lead, leadD, accent);
  }

  /**
   * A chevron at the edge of the screen pointing at the nearest unread thing.
   * When it is already on screen the chevron becomes a small diamond over it,
   * so the readout is continuous rather than popping in and out at the border.
   */
  _drawLead(c, camera, lead, dist, accent) {
    this._v.set(lead.pos.x, lead.pos.y, lead.pos.z).project(camera);
    const behind = this._v.z > 1;
    let sx = (this._v.x * 0.5 + 0.5) * this._w;
    let sy = (-this._v.y * 0.5 + 0.5) * this._h;
    if (behind) { sx = this._w - sx; sy = this._h + 200; }

    const pad = 54;
    const cx = this._w / 2, cy = this._h / 2;
    const onScreen = !behind && sx > pad && sx < this._w - pad && sy > pad && sy < this._h - pad;

    let ax = sx, ay = sy, angle = 0;
    if (!onScreen) {
      // Clamp the point to the edge of a padded rectangle, along the ray from
      // screen centre — the standard off-screen indicator, and the only one
      // that stays readable when the target is directly behind you.
      const vx = sx - cx, vy = sy - cy;
      const len = Math.hypot(vx, vy) || 1;
      const ux = vx / len, uy = vy / len;
      const tx = (this._w / 2 - pad) / Math.abs(ux || 1e-6);
      const ty = (this._h / 2 - pad) / Math.abs(uy || 1e-6);
      const t = Math.min(tx, ty);
      ax = cx + ux * t; ay = cy + uy * t;
      angle = Math.atan2(uy, ux);
    }

    c.save();
    c.globalAlpha = 0.82;
    c.translate(ax, ay);
    if (!onScreen) {
      c.rotate(angle);
      c.fillStyle = accent;
      c.beginPath();
      c.moveTo(11, 0); c.lineTo(-7, -8); c.lineTo(-3, 0); c.lineTo(-7, 8);
      c.closePath(); c.fill();
      c.rotate(-angle);
    } else {
      c.strokeStyle = accent;
      c.lineWidth = 1.6;
      c.globalAlpha = 0.5;
      c.beginPath();
      c.moveTo(0, -8); c.lineTo(8, 0); c.lineTo(0, 8); c.lineTo(-8, 0);
      c.closePath(); c.stroke();
    }
    c.globalAlpha = 0.72;
    c.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    c.textAlign = 'center';
    c.fillStyle = accent;
    c.fillText(`${Math.round(dist)} m`, 0, onScreen ? -14 : 22);
    c.restore();
  }
}
