/**
 * Persistence. Everything lives in one localStorage key so a wipe is one call.
 * Storage can throw (Safari private mode, embedded webviews, quota) — every
 * access is guarded and the game runs fine with persistence unavailable.
 */

const KEY = 'the-block:save:v1';

const DEFAULTS = {
  version: 1,
  visits: 0,
  firstSeen: 0,
  lastSeen: 0,
  secondsPlayed: 0,
  erasVisited: {},        // year → seconds spent
  secrets: {},            // id → { at, era }
  places: {},             // placeId → true once inspected
  seen: {},               // interactable id → true once read (drives markers)
  lastEra: 1945,
  lastPos: null,
  settings: {
    quality: null,        // null ⇒ auto-detect
    renderScale: 1.0,
    shadows: true, bloom: true, ssao: true, grain: true, ca: true,
    reflections: true, crowd: true, fps: false,
    sensitivity: 1.0, fov: 72, invertY: false, viewBob: true, pointerLock: false,
    stickySprint: true, stickSize: 1.0, lefty: false,
    reduceMotion: false, noFlash: false, bigUI: false, contrast: false,
    subtitles: true, prompts: true, waypoints: true,
    volume: 0.8, music: 0.55, muted: false,
    timeOfDay: null,      // null ⇒ era default
    weather: null,        // null ⇒ era default
  },
};

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k in over) {
    const v = over[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof base?.[k] === 'object' && base[k] !== null) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

export class Save {
  constructor() {
    this.available = false;
    this.data = structuredClone(DEFAULTS);
    try {
      const probe = '__tb_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      this.available = true;
    } catch { this.available = false; }
    this.load();
    this._dirty = false;
    this._flushTimer = 0;
  }

  load() {
    if (!this.available) return this.data;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.data = deepMerge(structuredClone(DEFAULTS), parsed);
        }
      }
    } catch {
      // Corrupt payload — start clean rather than crash on boot.
      this.data = structuredClone(DEFAULTS);
    }
    return this.data;
  }

  /** Mark dirty; the actual write is debounced by `tick`. */
  touch() { this._dirty = true; }

  flush() {
    if (!this.available || !this._dirty) return;
    this._dirty = false;
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* quota — ignore */ }
  }

  tick(dt) {
    this.data.secondsPlayed += dt;
    this._flushTimer -= dt;
    if (this._flushTimer <= 0) { this._flushTimer = 4; this.flush(); }
  }

  get settings() { return this.data.settings; }

  set(path, value) {
    const parts = path.split('.');
    let o = this.data;
    for (let i = 0; i < parts.length - 1; i++) o = (o[parts[i]] ||= {});
    o[parts[parts.length - 1]] = value;
    this.touch();
  }

  get(path, fallback) {
    const parts = path.split('.');
    let o = this.data;
    for (const p of parts) { if (o == null) return fallback; o = o[p]; }
    return o === undefined ? fallback : o;
  }

  markSecret(id, era) {
    if (this.data.secrets[id]) return false;
    this.data.secrets[id] = { at: Date.now(), era };
    this.touch();
    this.flush();
    return true;
  }
  hasSecret(id) { return !!this.data.secrets[id]; }

  /** Everything you have actually walked up to and read. */
  markSeen(id) {
    if (!id || this.data.seen[id]) return false;
    this.data.seen[id] = true;
    this.touch();
    return true;
  }
  hasSeen(id) { return !!this.data.seen[id]; }

  secretCount() { return Object.keys(this.data.secrets).length; }

  markPlace(id) {
    if (this.data.places[id]) return false;
    this.data.places[id] = Date.now();
    this.touch();
    return true;
  }

  noteEra(year, dt) {
    this.data.erasVisited[year] = (this.data.erasVisited[year] || 0) + dt;
    this.data.lastEra = year;
  }

  beginSession() {
    this.data.visits++;
    if (!this.data.firstSeen) this.data.firstSeen = Date.now();
    this.data.lastSeen = Date.now();
    this.touch(); this.flush();
  }

  wipe() {
    this.data = structuredClone(DEFAULTS);
    this.data.firstSeen = Date.now();
    if (this.available) { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
  }

  /** Human summary for the title screen. */
  summary() {
    const n = this.secretCount();
    const mins = Math.floor(this.data.secondsPlayed / 60);
    if (!this.data.visits) return '';
    const bits = [];
    if (mins >= 1) bits.push(`${mins} min on the block`);
    if (n) bits.push(`${n} secret${n === 1 ? '' : 's'} found`);
    return bits.length ? `Welcome back — ${bits.join(' · ')}` : '';
  }
}
