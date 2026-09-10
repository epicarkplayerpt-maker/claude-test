/**
 * Unified input: keyboard + mouse (pointer lock), multi-touch (virtual stick +
 * free-look drag + pinch), and Gamepad API. Everything funnels into one flat
 * state object the camera controller reads once per frame.
 *
 * iOS notes that cost real debugging time:
 *  - Pointer Events are used throughout (iOS 13+). Touch fallback is kept for
 *    very old Safari where `PointerEvent` is missing.
 *  - `touch-action:none` on the canvas plus preventDefault on move stops the
 *    rubber-band scroll that otherwise fights the look-drag.
 *  - Safari fires `gesturestart/gesturechange` for pinch *in addition to*
 *    pointer events; both are cancelled so the page never zooms.
 *  - Pointer lock does not exist on iOS. Touch look is therefore drag-relative,
 *    not lock-relative, and must survive a finger leaving the screen mid-drag
 *    (pointercancel), which iOS does aggressively on incoming calls/notifications.
 */

import { clamp, deadzone2 } from './mathx.js';

const LOOK_KEYS = new Set([
  'KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
  'Space','ShiftLeft','ShiftRight','KeyE','KeyQ','KeyR','KeyF','KeyC','KeyG',
  'KeyP','KeyM','KeyH','KeyT','Escape','Tab','Digit1','Digit2','Digit3',
  'Digit4','Digit5','Digit6','KeyZ','Enter','Backquote',
]);

export class Input {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;

    /* ── Public per-frame state ─────────────────────────────────────── */
    this.move = { x: 0, y: 0 };      // −1..1, y = forward
    this.moveMag = 0;                // analog magnitude 0..1
    this.look = { x: 0, y: 0 };      // accumulated look delta, consumed each frame
    this.sprint = false;
    this.jumpPressed = false;
    this.crouch = false;
    this.zoom = 0;                   // −1..1 transient, consumed each frame
    this.pinch = 0;                  // pinch delta in px, consumed each frame

    this.keys = new Set();
    this.pressed = new Set();        // edge-triggered, cleared at endFrame()
    this.pointerLocked = false;
    this.usingTouch = false;
    this.usingGamepad = false;
    this.lastInputKind = 'kbd';

    this.sensitivity = 1;
    this.invertY = false;
    this.enabled = true;
    this.lookLocked = false;         // set true while a modal is open
    this.dragLook = true;            // false ⇒ classic pointer-lock capture

    /* ── Internal ───────────────────────────────────────────────────── */
    this._pointers = new Map();      // pointerId → {x,y,role,startX,startY,time}
    this._stickId = null;
    this._lookId = null;
    this._stickVec = { x: 0, y: 0 };
    this._pinchIds = [];
    this._pinchDist = 0;
    this._touchSprintSticky = true;
    this._touchSprintOn = false;
    this._listeners = { interact: [], tap: [], era: [], key: [] };
    this._gpPrev = [];

    this._bind();
  }

  on(evt, fn) { (this._listeners[evt] ||= []).push(fn); return this; }
  _emit(evt, ...a) { (this._listeners[evt] || []).forEach((f) => f(...a)); }

  /* ═══════════════════════════ BINDING ═══════════════════════════ */
  _bind() {
    const c = this.canvas;

    /* Keyboard ---------------------------------------------------- */
    this._onKeyDown = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (LOOK_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.lastInputKind = 'kbd';
      this.keys.add(e.code);
      this.pressed.add(e.code);
      this._emit('key', e.code, e);
    };
    this._onKeyUp = (e) => { this.keys.delete(e.code); };
    this._onBlur = () => { this.keys.clear(); this._resetTouch(); };

    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);

    /* Pointer lock (desktop) -------------------------------------- */
    this._onLockChange = () => {
      this.pointerLocked = document.pointerLockElement === c;
      this._emit('lockchange', this.pointerLocked);
    };
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('pointerlockerror', () => { this.pointerLocked = false; });

    this._onMouseMove = (e) => {
      if (!this.pointerLocked || this.lookLocked) return;
      const s = this.sensitivity * 0.0022;
      this.look.x -= (e.movementX || 0) * s;
      this.look.y -= (e.movementY || 0) * s * (this.invertY ? -1 : 1);
    };
    document.addEventListener('mousemove', this._onMouseMove);

    this._onWheel = (e) => {
      if (this.lookLocked) return;
      e.preventDefault();
      this.zoom += clamp(-e.deltaY / 500, -1, 1);
    };
    c.addEventListener('wheel', this._onWheel, { passive: false });

    /* Pointer / touch --------------------------------------------- */
    if (window.PointerEvent) {
      c.addEventListener('pointerdown', (e) => this._pDown(e), { passive: false });
      window.addEventListener('pointermove', (e) => this._pMove(e), { passive: false });
      window.addEventListener('pointerup', (e) => this._pUp(e));
      window.addEventListener('pointercancel', (e) => this._pUp(e));
    } else {
      // Legacy Safari fallback — synthesise pointer-shaped events from touches.
      const conv = (t) => ({
        pointerId: t.identifier, clientX: t.clientX, clientY: t.clientY,
        pointerType: 'touch', preventDefault() {}, button: 0,
      });
      c.addEventListener('touchstart', (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) this._pDown(conv(t));
      }, { passive: false });
      window.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) this._pMove(conv(t));
      }, { passive: false });
      const end = (e) => { for (const t of e.changedTouches) this._pUp(conv(t)); };
      window.addEventListener('touchend', end);
      window.addEventListener('touchcancel', end);
    }

    /* Safari pinch-zoom suppression -------------------------------- */
    for (const g of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.addEventListener(g, (e) => e.preventDefault(), { passive: false });
    }
    document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
    // Long-press callout on iOS
    document.addEventListener('contextmenu', (e) => {
      if (e.target === c) e.preventDefault();
    });

    /* Gamepad ------------------------------------------------------ */
    window.addEventListener('gamepadconnected', () => { this.usingGamepad = true; });
    window.addEventListener('gamepaddisconnected', () => { this.usingGamepad = false; });
  }

  /* ═══════════════════════════ POINTERS ═══════════════════════════ */

  /** Which half of the screen a touch started in decides its job. */
  _roleFor(e) {
    const lefty = document.body.classList.contains('lefty');
    const w = window.innerWidth;
    const onStickSide = lefty ? e.clientX > w * 0.5 : e.clientX < w * 0.5;
    // The stick only claims a touch that starts inside its footprint; a touch
    // anywhere else — including the "stick side" — is a look drag, so players
    // can turn with either thumb.
    const zone = this._stickZone();
    if (zone && e.clientX >= zone.x0 && e.clientX <= zone.x1 &&
        e.clientY >= zone.y0 && e.clientY <= zone.y1 && onStickSide) return 'stick';
    return 'look';
  }

  _stickZone() {
    const el = document.getElementById('stickL');
    if (!el || el.offsetParent === null) return null;
    const r = el.getBoundingClientRect();
    const pad = Math.max(30, r.width * 0.42); // generous grab radius for thumbs
    return { x0: r.left - pad, x1: r.right + pad, y0: r.top - pad, y1: r.bottom + pad,
             cx: r.left + r.width / 2, cy: r.top + r.height / 2, rad: r.width / 2 };
  }

  _pDown(e) {
    if (!this.enabled) return;
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (touch) { this.usingTouch = true; this.lastInputKind = 'touch'; document.body.classList.add('istouch'); }
    else this.lastInputKind = 'mouse';

    if (!touch) {
      this._emit('canvasdown', e);
      // Desktop default is drag-to-look, not pointer lock. Pointer lock hands
      // every mouse event to the canvas, which would make the timeline — the
      // whole point of this scene — unclickable. Players who want classic FPS
      // capture can turn it on in Controls; then this branch does nothing and
      // the movementX/Y handler takes over.
      if (this.pointerLocked || !this.dragLook) return;
      this._pointers.set(e.pointerId, {
        x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY,
        role: 'look', t: performance.now(), moved: 0, mouse: true,
      });
      this._lookId = e.pointerId;
      this.canvas.setPointerCapture?.(e.pointerId);
      this.canvas.classList.add('dragging');
      return;
    }
    e.preventDefault?.();

    const role = this._roleFor(e);
    this._pointers.set(e.pointerId, {
      x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY,
      role, t: performance.now(), moved: 0,
    });

    if (role === 'stick' && this._stickId === null) {
      this._stickId = e.pointerId;
      const z = this._stickZone();
      // Re-centre the stick origin on the touch point so the thumb never has to
      // hunt for the exact centre — feels dramatically better on a phone.
      this._stickOrigin = { x: e.clientX, y: e.clientY, r: z ? z.rad : 56 };
      document.getElementById('stickL')?.classList.add('act');
    } else if (role === 'look' && this._lookId === null) {
      this._lookId = e.pointerId;
    }

    // Two look-pointers ⇒ pinch
    const lookPts = [...this._pointers.entries()].filter(([, p]) => p.role === 'look');
    if (lookPts.length === 2) {
      this._pinchIds = lookPts.map(([id]) => id);
      const [a, b] = lookPts.map(([, p]) => p);
      this._pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }

  _pMove(e) {
    const p = this._pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault?.();
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.moved += Math.hypot(dx, dy);
    p.x = e.clientX; p.y = e.clientY;

    if (e.pointerId === this._stickId) {
      const o = this._stickOrigin;
      const r = o.r || 56;
      let vx = (e.clientX - o.x) / r, vy = (e.clientY - o.y) / r;
      const m = Math.hypot(vx, vy);
      if (m > 1) { vx /= m; vy /= m; }
      this._stickVec.x = vx; this._stickVec.y = vy;
      this._paintStick(vx, vy);
      // Push past the ring edge to sprint, if sticky-sprint is off.
      if (!this._touchSprintSticky) this._touchSprintOn = m > 0.94;
      return;
    }

    if (this._pinchIds.length === 2 && this._pinchIds.includes(e.pointerId)) {
      const a = this._pointers.get(this._pinchIds[0]);
      const b = this._pointers.get(this._pinchIds[1]);
      if (a && b) {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.pinch += d - this._pinchDist;
        this._pinchDist = d;
      }
      return; // no look while pinching
    }

    if (e.pointerId === this._lookId && !this.lookLocked) {
      // A mouse drag covers more pixels per intended turn than a thumb does.
      const s = this.sensitivity * (p.mouse ? 0.0028 : 0.0042);
      this.look.x -= dx * s;
      this.look.y -= dy * s * (this.invertY ? -1 : 1);
    }
  }

  _pUp(e) {
    const p = this._pointers.get(e.pointerId);
    this._pointers.delete(e.pointerId);
    if (!p) return;

    if (e.pointerId === this._stickId) {
      this._stickId = null;
      this._stickVec.x = 0; this._stickVec.y = 0;
      this._paintStick(0, 0);
      document.getElementById('stickL')?.classList.remove('act');
      if (!this._touchSprintSticky) this._touchSprintOn = false;
    }
    if (e.pointerId === this._lookId) {
      this._lookId = null;
      // Promote another live look pointer so a two-finger release keeps working.
      for (const [id, q] of this._pointers) if (q.role === 'look') { this._lookId = id; break; }
    }
    if (this._pinchIds.includes(e.pointerId)) this._pinchIds = [];
    if (p.mouse) this.canvas.classList.remove('dragging');

    // A short, near-stationary touch is a tap — used for world interaction.
    // A short, near-stationary press is a tap/click — interact with whatever
    // the reticle is on. Mouse clicks get a slightly longer window because a
    // deliberate click takes longer than a thumb tap.
    const dt = performance.now() - p.t;
    if (p.role === 'look' && dt < (p.mouse ? 420 : 320) && p.moved < 14) {
      this._emit('tap', p.sx, p.sy);
    }
  }

  _paintStick(vx, vy) {
    const nub = document.querySelector('#stickL .stick-nub');
    if (!nub) return;
    const reach = 32;
    nub.style.transform = `translate(${(vx * reach).toFixed(1)}px, ${(vy * reach).toFixed(1)}px)`;
  }

  _resetTouch() {
    this._pointers.clear();
    this._stickId = this._lookId = null;
    this._pinchIds = [];
    this._stickVec.x = this._stickVec.y = 0;
    this._paintStick(0, 0);
    document.getElementById('stickL')?.classList.remove('act');
  }

  /* ═══════════════════════════ PER-FRAME ═══════════════════════════ */

  /** Fold keyboard/stick/gamepad into `move`, `sprint`, etc. Call once/frame. */
  sample() {
    let mx = 0, my = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    const kbMag = Math.hypot(mx, my);
    if (kbMag > 1) { mx /= kbMag; my /= kbMag; }

    let sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    let crouch = this.keys.has('KeyZ') || this.keys.has('ControlLeft');
    let mag = Math.min(1, kbMag);

    // Touch stick overrides when active
    if (this._stickId !== null) {
      const [sx, sy, m] = deadzone2(this._stickVec.x, this._stickVec.y, 0.12);
      mx = sx; my = -sy; mag = m;
      if (this._touchSprintOn) sprint = true;
    } else if (this._touchSprintOn && this._touchSprintSticky && mag > 0) {
      sprint = true;
    }

    // Gamepad
    const gp = this._readGamepad();
    if (gp) {
      if (gp.mag > 0.08) { mx = gp.lx; my = -gp.ly; mag = gp.mag; this.lastInputKind = 'pad'; }
      if (Math.abs(gp.rx) > 0.12 || Math.abs(gp.ry) > 0.12) {
        const s = this.sensitivity * 0.045;
        this.look.x -= gp.rx * s;
        this.look.y -= gp.ry * s * (this.invertY ? -1 : 1);
        this.lastInputKind = 'pad';
      }
      if (gp.sprint) sprint = true;
      if (gp.crouch) crouch = true;
    }

    this.move.x = mx; this.move.y = my; this.moveMag = mag;
    this.sprint = sprint; this.crouch = crouch;
    this.jumpPressed = this.pressed.has('Space') || (gp?.jumpEdge ?? false);
    return this;
  }

  _readGamepad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    if (!pad) return null;
    this.usingGamepad = true;

    const ax = pad.axes;
    const dz = (v) => (Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86);
    const lx = dz(ax[0] || 0), ly = dz(ax[1] || 0);
    const rx = dz(ax[2] || 0), ry = dz(ax[3] || 0);
    const b = pad.buttons;
    const down = (i) => !!(b[i] && b[i].pressed);
    const edge = (i) => { const now = down(i); const was = this._gpPrev[i]; this._gpPrev[i] = now; return now && !was; };

    // Each edge() call consumes that button's previous state, so every button
    // must be tested exactly once per frame.
    if (edge(0)) this._emit('interact');           // A / cross
    if (edge(4)) this._emit('era', -1);            // LB
    if (edge(5)) this._emit('era', +1);            // RB
    if (edge(9)) this._emit('key', 'Escape');      // start
    if (edge(3)) this._emit('key', 'KeyC');        // Y → codex
    if (edge(2)) this._emit('key', 'KeyP');        // X → photo
    const jumpEdge = edge(11);                     // left stick click

    return {
      lx, ly, rx, ry, mag: Math.min(1, Math.hypot(lx, ly)),
      sprint: down(10) || (b[6]?.value ?? 0) > 0.5,
      crouch: down(1),
      jumpEdge,
    };
  }

  /** Consume look accumulation; returns the delta for this frame. */
  takeLook() {
    const l = { x: this.look.x, y: this.look.y };
    this.look.x = 0; this.look.y = 0;
    return l;
  }
  takeZoom() { const z = this.zoom; this.zoom = 0; return z; }
  takePinch() { const p = this.pinch; this.pinch = 0; return p; }

  /** Clear edge-triggered state. Call at the very end of the frame. */
  endFrame() { this.pressed.clear(); }

  /* ═══════════════════════════ HELPERS ═══════════════════════════ */
  wasPressed(code) { return this.pressed.has(code); }
  setSensitivity(v) { this.sensitivity = v; }
  setInvert(v) { this.invertY = !!v; }
  setStickySprint(v) { this._touchSprintSticky = !!v; if (!v) this._touchSprintOn = false; }
  toggleTouchSprint() { this._touchSprintOn = !this._touchSprintOn; return this._touchSprintOn; }
  setDragLook(on) {
    this.dragLook = !!on;
    if (on) this.releaseLock();
  }

  requestLock() {
    if (this.usingTouch || this.dragLook) return;
    const el = this.canvas;
    if (document.pointerLockElement === el) return;
    const p = el.requestPointerLock?.({ unadjustedMovement: true });
    // Chrome returns a promise when unadjustedMovement is requested; older
    // engines return undefined and may throw if the option is unsupported.
    if (p && typeof p.catch === 'function') p.catch(() => { try { el.requestPointerLock(); } catch { /* ignore */ } });
  }
  releaseLock() { if (document.pointerLockElement) document.exitPointerLock?.(); }
}

/** Coarse device probe used to pick defaults (not for feature gating). */
export function probeDevice() {
  const ua = navigator.userAgent || '';
  const touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
  const iOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
  const android = /Android/.test(ua);
  const mobile = touch && (iOS || android || Math.min(screen.width, screen.height) < 820);
  const cores = navigator.hardwareConcurrency || (mobile ? 4 : 8);
  const mem = navigator.deviceMemory || (mobile ? 4 : 8);
  const dpr = window.devicePixelRatio || 1;
  // Heuristic tier: mobiles and low-core machines start conservative and the
  // adaptive governor raises quality if frame times allow.
  let tier = 'high';
  if (mobile) tier = (cores >= 6 && mem >= 4) ? 'medium' : 'low';
  else if (cores <= 4 || mem <= 4) tier = 'medium';
  return { touch, iOS, android, mobile, cores, mem, dpr, tier };
}
