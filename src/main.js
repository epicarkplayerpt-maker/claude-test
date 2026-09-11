/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE BLOCK — one corner, six decades
 * ════════════════════════════════════════════════════════════════════════
 *
 * Orchestration only: every system lives in its own module and this file is
 * the loop that runs them in the right order and routes intents between the
 * interface and the world.
 */

import * as THREE from 'three';
import { Engine, QUALITY } from './core/engine.js';
import { Input, probeDevice } from './core/input.js';
import { Player } from './core/player.js';
import { Save } from './core/save.js';
import { Audio } from './core/audio.js';
import { Sky } from './world/sky.js';
import { City } from './world/city.js';
import { setAnisotropy, setTextureScale } from './world/textures.js';
import { setWind } from './world/materials.js';
import { Weather, WarpRing } from './fx/weather.js';
import { TimeWarp } from './fx/timewarp.js';
import { HUD } from './ui/hud.js';
import { Markers } from './ui/markers.js';
import { Tour } from './ui/tour.js';
import { ERAS, YEARS } from './data/eras.js';
import { secretById, THREADS } from './data/secrets.js';
import { clamp, clamp01, damp, lerp, clockString } from './core/mathx.js';

/* ══════════════════════════ boot ══════════════════════════ */

const canvas = document.getElementById('viewport');
const device = probeDevice();
const save = new Save();
save.beginSession();

const bootFill = document.getElementById('bootFill');
const bootRing = document.getElementById('bootRing');
const bootStep = document.getElementById('bootStep');
function progress(p, label) {
  if (bootFill) bootFill.style.width = (clamp01(p) * 100).toFixed(1) + '%';
  if (bootRing) bootRing.style.strokeDashoffset = String(276.5 * (1 - clamp01(p)));
  if (bootStep && label) bootStep.textContent = label;
}

const tier = save.get('settings.quality') || device.tier;
const engine = new Engine(canvas, { ...device, tier });
engine.baseFov = save.get('settings.fov', 72);
engine.setRenderScale(save.get('settings.renderScale', 1));
setAnisotropy(Math.min(8, engine.caps.anisotropy));
setTextureScale(tier === 'low' ? 0.42 : tier === 'medium' ? 0.62 : 1.0);

const sky = new Sky(engine.scene, engine.renderer);
const city = new City(engine, { maxResident: tier === 'low' ? 3 : tier === 'medium' ? 4 : 6 });
const player = new Player(engine.camera, city);
const input = new Input(canvas, {});
const audio = new Audio();
const weather = new Weather(engine.scene, engine.q);
const warpRing = new WarpRing(engine.scene, tier === 'low' ? 320 : 900);
const hud = new HUD(save, { touch: device.touch });
const markers = new Markers(document.getElementById('markers'));
hud.initMinimap();
hud.setQualityChip(tier);

const warp = new TimeWarp({
  engine, sky, city, weather, ring: warpRing, audio, player,
  onPhase: (phase) => {
    if (phase === 'done') {
      applyEraSettled(state.era);
      hud.setEra(state.era, true);
    }
  },
});

const tour = new Tour({ player, hud, audio, setEra: (i) => requestEra(i, true) });

const state = {
  era: 0,
  playing: false,
  paused: false,
  photo: false,
  ghost: false,
  film: 'era',
  time: 0,
  todOverride: save.get('settings.timeOfDay'),
  weatherOverride: save.get('settings.weather'),
  lastInteract: null,
  konami: [],
  visited: new Set(),
  appliedEra: -1,
  ghostFrame: 0,
  photoExp: 0, photoDof: 0, grid: false,
  // Cached so the marker overlay doesn't force a style recalc every frame.
  eraAccent: '#e8b46a',
};

player.reset(16, -46, 0);
player.bobEnabled = save.get('settings.viewBob', true);
player.onStep = (power) => audio.footstep(power, ERAS[state.era].audio.footstep.kind);
input.setSensitivity(save.get('settings.sensitivity', 1));
input.setInvert(save.get('settings.invertY', false));
input.setStickySprint(save.get('settings.stickySprint', true));
input.setDragLook(!save.get('settings.pointerLock', false));
warp.reduceMotion = save.get('settings.reduceMotion', false);
warp.noFlash = save.get('settings.noFlash', false);
audio.setVolume(save.get('settings.volume', 0.8));
audio.setMusicVolume(save.get('settings.music', 0.55));
audio.muted = save.get('settings.muted', false);
hud.setMuted(audio.muted);
engine.setShadows(save.get('settings.shadows', true));
engine.setBloom(save.get('settings.bloom', true));
engine.setAO(save.get('settings.ssao', true));

/* ══════════════════════════ era handling ══════════════════════════ */

const FILM = {
  none: null,
  era: null,
  bw: { sat: 0, contrast: 1.22, sepia: 0.06, grain: 0.09, vignette: 0.55 },
  kodachrome: { sat: 1.5, contrast: 1.2, temp: 0.16, grain: 0.03, vignette: 0.36, gain: [1.06, 1.0, 0.94] },
  cross: { sat: 1.35, contrast: 1.3, temp: -0.22, tint: [0.94, 1.06, 1.12], lift: [0.0, 0.05, 0.09], grain: 0.05 },
  noir: { sat: 0.04, contrast: 1.55, vignette: 0.78, grain: 0.13, lift: [0, 0, 0.01], halation: 0.2 },
  infra: { sat: 1.1, contrast: 1.2, tint: [1.25, 0.72, 1.12], temp: 0.1, grain: 0.06, halation: 0.3 },
};

/**
 * Settle sky, grade and environment on one era. Cheap enough to call whenever
 * a setting changes — the expensive half (particle emitters, the soundtrack) is
 * gated behind an actual change of decade.
 */
function applyEraSettled(idx) {
  warp.applyBlend(idx, idx, 0, state.todOverride, state.weatherOverride);
  const env = sky.updateEnvironment();
  if (env) {
    for (const rec of city.eras) rec?.mats.setEnvironment(env);
    city.sharedMats.setEnvironment(env);
  }
  applyFilm();

  state.eraAccent = '#' + new THREE.Color(ERAS[idx].accent).getHexString();

  if (state.appliedEra !== idx) {
    state.appliedEra = idx;
    const era = ERAS[idx];
    weather.setEmitters(buildEmitters(idx));
    if (audio.ready) audio.setEra(era, false);
    state.visited.add(era.year);
    if (state.visited.size >= YEARS.length) grantSecret('secret:sixeras');
  }
}

/** Local particle emitters that belong to this decade's props. */
function buildEmitters(idx) {
  const era = ERAS[idx];
  const list = [];
  const rec = city.eras[idx];
  if (!rec) return list;
  for (const a of rec.animated) {
    if (a.kind === 'steam') list.push({ pos: a.pos, opts: { color: 0xd8d4cc, rise: 6.5, spread: 0.7, size: 1.5, life: 5.5, opacity: 0.13, count: 30 } });
    if (a.kind === 'mist') list.push({ pos: a.pos, opts: { color: 0xbfe4ea, rise: -2.6, spread: 1.4, size: 1.1, life: 3.4, opacity: 0.10, count: 26 } });
    if (a.kind === 'crane') list.push({ pos: a.pos, opts: { color: 0xc8c0b0, rise: 2, spread: 2, size: 0.7, life: 6, opacity: 0.04, count: 12 } });
  }
  if (era.sky.smokestacks) {
    for (const p of [[-58, -62], [64, -70], [-70, 58]]) {
      list.push({ pos: new THREE.Vector3(p[0], 22, p[1]), opts: { color: 0x6a6058, rise: 14, spread: 2.4, size: 2.6, life: 9, opacity: 0.07, count: 22 } });
    }
  }
  return list;
}

function applyFilm() {
  const f = FILM[state.film];
  const s = engine.post.settings;
  if (state.photo) {
    s.exposure *= Math.pow(2, state.photoExp);
    s.letterbox = 0.055;
    s.grid = state.grid ? 1 : 0;
  } else {
    s.letterbox = 0;
    s.grid = 0;
  }
  if (!save.get('settings.grain', true)) { s.grain = 0; s.sepia = 0; s.vhs = 0; s.bleach = 0; s.dust = 0; }
  if (!save.get('settings.ca', true)) { s.chroma = 0; }
  if (!f) return;
  for (const k in f) {
    s[k] = Array.isArray(f[k]) ? f[k].slice() : f[k];
  }
}

let requestingEra = false;
async function requestEra(idx, silent = false) {
  if (requestingEra || warp.active || idx === state.era) return;
  idx = clamp(idx, 0, ERAS.length - 1);
  requestingEra = true;
  hud.locked = true;
  const from = state.era;
  state.era = idx;
  try {
    await warp.start(from, idx, (p, label) => progress(p, label));
  } finally {
    requestingEra = false;
    hud.locked = hud.anyOpen();
  }
  if (!silent) hud.toast(String(ERAS[idx].year), ERAS[idx].tagline, 'era');
  hud.setEra(idx, true);
}

/* ══════════════════════════ secrets ══════════════════════════ */

const SECRET_FOR = {
  'shop:drug:1945': 'secret:fountain',
  'marquee:1945': 'secret:usher',
  'lotsign:1965': 'secret:pumps',
  'shop:dime:1965': 'secret:tv',
  'shop:arcade:1985': 'secret:highscore',
  'atm:bank:1985': 'secret:clock',
  'shop:arcade:2005': 'secret:dialup',
  'hoarding:2005': 'secret:hoarding',
  'mural:lot:2025': 'secret:mural',
  'marquee:2055': 'secret:archive',
};

function grantSecret(id) {
  const year = ERAS[state.era].year;
  const base = id.split('@')[0];
  const isNew = save.markSecret(base, year);
  // Threads that repeat per decade also record which decade you found it in.
  save.markSecret(`${base}@${year}`, year);
  if (isNew) {
    hud.celebrateSecret(base);
    audio.ui('secret');
    reportThread(base);
  }
  return isNew;
}

/**
 * Say where a discovery sits in its thread.
 *
 * Seven objects on this block are followed across all six decades, and that is
 * the actual game: find the tree in 1945, then go and find what happened to it.
 * A discovery toast that only says "added to the codex" hides that entirely.
 * Saying "The tree on the corner — 2 of 6 decades" turns one find into a
 * reason to move the timeline.
 */
function reportThread(secretId) {
  const meta = secretById[secretId];
  const thread = THREADS.find((t) => t.id === meta?.thread);
  if (!thread) return;
  const total = thread.beads.length;
  const found = thread.perEra
    ? YEARS.filter((y) => save.hasSecret(`${thread.perEra}@${y}`)).length
    : thread.beads.filter((b) => b.secret && save.hasSecret(b.secret)).length;
  if (found <= 0) return;
  setTimeout(() => {
    hud.toast(`${thread.icon}  ${thread.title}`,
      found >= total ? `Complete — all ${total} decades` : `${found} of ${total} decades`);
  }, 1400);
}

/* ══════════════════════════ interaction ══════════════════════════ */

function tryInteract(silentMiss = false) {
  // Aim from the eye, not the feet — a marquee two storeys up sits at a very
  // different angle from head height than from ankle height.
  const it = city.findInteractable(engine.camera.position, player.lookDir, 0.9);
  if (!it) { if (!silentMiss) audio.ui('deny'); return; }
  audio.ui('confirm');
  if (it.place) save.markPlace(`${it.place}@${ERAS[state.era].year}`);
  save.markSeen(it.id);
  const secretId = it.secret ? it.id : SECRET_FOR[it.id];
  if (secretId) grantSecret(secretId);
  hud.openReader({ title: it.title, body: it.body, foot: it.foot });
}

/**
 * Look around.
 *
 * Rings everything unread within a couple of dozen metres for a few seconds.
 * This is the answer to "how would anyone know that shop window is readable" —
 * on a phone especially, where there is no hover and the reticle only speaks
 * when you are already pointing at something.
 */
function sense() {
  if (!state.playing || hud.locked) return;
  if (markers.sense()) {
    audio.ui('sense');
    const n = city.interactables.filter((it) => !save.hasSeen(it.id)).length;
    if (n === 0) hud.toast('Nothing left here', `You have read everything in ${ERAS[state.era].year}`);
  } else {
    audio.ui('deny');
  }
}

/**
 * When the governor changes tier, the scene has to act on it.
 *
 * `setTier` re-points the renderer at the new MSAA, AO and shadow settings,
 * but the crowd and the traffic were already populated at the old densities
 * and would carry that cost until the next era change. Re-populating is cheap
 * — they are instanced — and it is most of the CPU the tier drop was after.
 */
engine.onTierChange = (t) => {
  city.quality = engine.q;
  if (city.currentIdx >= 0) {
    city.traffic.populate(ERAS[state.era], state.era, engine.q.traffic);
    city.crowd?.populate(ERAS[state.era], state.era, engine.q.crowd);
    city.flock?.populate(ERAS[state.era], state.era, engine.q.crowd);
  }
  hud.setStatsTier?.(t);
};

/* ══════════════════════════ HUD wiring ══════════════════════════ */

hud.on = {
  start: (opts) => startPlaying(opts?.tour),
  era: (i) => requestEra(i),
  photo: (v) => setPhoto(v === undefined ? !state.photo : v),
  ghost: () => setGhost(!state.ghost),
  mute: () => { audio.setMuted(!audio.muted); save.set('settings.muted', audio.muted); hud.setMuted(audio.muted); },
  pause: (p) => { state.paused = p; if (p) input.releaseLock(); input.lookLocked = p; document.body.classList.toggle('locked', !p && !input.dragLook); },
  tour: () => tour.start(),
  resetPos: () => { player.reset(16, -46, 0); hud.toast('Position reset', '5th & Vine, north side'); },
  fly: () => {
    player.flying = !player.flying;
    hud.toast(player.flying ? 'Free-fly on' : 'Free-fly off', player.flying ? 'Space to rise, Z to sink' : '');
    if (player.flying) player.pos.y = Math.max(player.pos.y, 2);
  },
  ui: (kind) => audio.ui(kind),
  quality: (q) => {
    save.set('settings.quality', q);
    engine.setTier(q);
    hud.toast('Quality: ' + q, 'Reload for texture detail changes');
  },
  renderScale: (v) => engine.setRenderScale(v),
  sensitivity: (v) => input.setSensitivity(v),
  invertY: (v) => input.setInvert(v),
  pointerLock: (v) => {
    input.setDragLook(!v);
    document.body.classList.toggle('locked', !!v);
    hud.toast(v ? 'Mouse capture on' : 'Mouse capture off',
      v ? 'Click the view to capture · Esc releases it' : 'Drag the view to look around');
  },
  viewBob: (v) => { player.bobEnabled = v; },
  stickySprint: (v) => input.setStickySprint(v),
  fov: (v) => engine.setFov(v),
  shadows: (v) => engine.setShadows(v),
  bloom: (v) => engine.setBloom(v),
  ssao: (v) => engine.setAO(v),
  grain: () => applyFilm(),
  ca: () => applyFilm(),
  reflections: (v) => { sky._envDirty = true; },
  crowd: (v) => {
    const scale = v ? 1 : 0.3;
    city.traffic.populate(ERAS[state.era], state.era, engine.q.traffic * scale);
    city.crowd?.populate(ERAS[state.era], state.era, engine.q.crowd * scale);
    city.flock?.populate(ERAS[state.era], state.era, engine.q.crowd * scale);
  },
  volume: (v) => audio.setVolume(v),
  music: (v) => audio.setMusicVolume(v),
  tod: (v) => { state.todOverride = v; applyEraSettled(state.era); checkNightSecret(v); },
  weather: (v) => { state.weatherOverride = v; weather.setMode(v || ERAS[state.era].weather, 1); },
  reduceMotion: (v) => { warp.reduceMotion = v; },
  noFlash: (v) => { warp.noFlash = v; },
  waypoints: () => {},
  film: (v) => { state.film = v; applyEraSettled(state.era); },
  photoFov: (mm) => { engine.setFov(clamp(2 * Math.atan(18 / mm) * 180 / Math.PI, 8, 120)); },
  photoDof: (v) => {
    state.photoDof = v;
    engine.post.useDof = v > 0.01;
    engine.post.settings.dofRange = lerp(40, 3.2, v);
  },
  photoExp: (v) => { state.photoExp = v; applyFilm(); },
  grid: (v) => { state.grid = v; applyFilm(); },
  shoot: () => shoot(),
};

function setPhoto(on) {
  state.photo = on;
  hud.setPhotoMode(on);
  engine.post.useDof = on && state.photoDof > 0.01;
  if (!on) { engine.setFov(save.get('settings.fov', 72)); document.body.classList.remove('uihidden'); }
  applyEraSettled(state.era);
  audio.ui(on ? 'open' : 'close');
}

function setGhost(on) {
  if (on && engine.tier === 'low') {
    hud.toast('Ghost overlay needs Medium quality', 'It renders the scene twice');
    return;
  }
  state.ghost = on;
  hud.setGhost(on);
  engine.post.setGhost(on ? 0.55 : 0);
  if (on) {
    const other = state.era > 0 ? state.era - 1 : 1;
    city.build(other).then(() => { state.ghostEra = other; });
    hud.toast('Ghost overlay', `Showing ${ERAS[state.era > 0 ? state.era - 1 : 1].year} behind ${ERAS[state.era].year}`);
  }
}

/**
 * Where a saved photo goes.
 *
 * Served as a plain page, an anchor with a `download` attribute is all it
 * takes. Published as an artifact, the page is sandboxed and cannot start a
 * download itself — the host mediates it and the viewer confirms the filename.
 * Resolve the bridge once and remember whether there is one.
 */
let _downloads;
function downloadBridge() {
  if (_downloads === undefined) {
    _downloads = window.claude?.use
      ? window.claude.use('downloads').catch(() => null)
      : Promise.resolve(null);
  }
  return _downloads;
}

/** data: URL → Blob, without fetch (which the artifact CSP does not carry). */
function dataUrlToBlob(url) {
  const comma = url.indexOf(',');
  const mime = (url.slice(0, comma).match(/:(.*?);/) || [, 'image/png'])[1];
  const bin = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function shoot() {
  hud.flash();
  audio.ui('shutter');
  // The frame on screen is the frame we want, so read it back immediately.
  requestAnimationFrame(async () => {
    const name = `the-block-${ERAS[state.era].year}-${Date.now()}.png`;
    const ok = () => hud.toast('Photo saved', `${ERAS[state.era].year} · ${state.film}`);
    let url;
    try {
      url = engine.snapshot('image/png');
    } catch {
      hud.toast('Could not read the frame', 'Try a screenshot instead');
      return;
    }

    const dl = await downloadBridge();
    if (dl) {
      try {
        await dl.save({ filename: name, data: dataUrlToBlob(url) });
        ok();
      } catch (e) {
        if (e?.code === 'declined') hud.toast('Photo not saved', 'You cancelled the download');
        else hud.toast('Could not save the photo', 'Try a screenshot instead');
      }
      return;
    }

    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      ok();
    } catch {
      hud.toast('Could not save the photo', 'Try a screenshot instead');
    }
  });
}

function checkNightSecret(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  if (m >= 150 && m <= 210) grantSecret('secret:nightwalk');
}

/* ══════════════════════════ input wiring ══════════════════════════ */

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];

input.on('key', (code) => {
  if (!state.playing) return;

  state.konami.push(code);
  if (state.konami.length > KONAMI.length) state.konami.shift();
  if (state.konami.length === KONAMI.length && state.konami.every((c, i) => c === KONAMI[i])) {
    state.konami.length = 0;
    if (grantSecret('secret:konami')) {
      hud.subtitle('Somebody left a cheat code in the wall in 1985. Free-fly unlocked, and the block knows.', 6);
      player.flying = true;
    }
  }

  if (code === 'Escape') {
    if (!hud.closeTop()) hud.openMenu();
    return;
  }
  if (hud.locked || state.paused) return;

  if (code === 'KeyE') tryInteract();
  else if (code === 'KeyP') setPhoto(!state.photo);
  else if (code === 'KeyG') setGhost(!state.ghost);
  else if (code === 'KeyC') hud.openCodex();
  else if (code === 'KeyM') hud.on.mute();
  else if (code === 'KeyF') hud.on.fly();
  else if (code === 'KeyT') tour.start();
  else if (code === 'Enter' && state.photo) shoot();
  else if (code === 'KeyV') sense();
  else if (code === 'KeyQ') requestEra(state.era - 1);
  else if (code === 'KeyR') requestEra(state.era + 1);
  else if (/^Digit[1-6]$/.test(code)) requestEra(Number(code.slice(5)) - 1);
});

input.on('era', (d) => requestEra(state.era + d));
input.on('interact', () => { if (!hud.locked) tryInteract(); });
input.on('tap', () => { if (!hud.locked && state.playing) tryInteract(true); });
input.on('canvasdown', () => {
  // Only meaningful when the player has asked for mouse capture; otherwise the
  // press has already been claimed as a look-drag.
  if (state.playing && !hud.locked && !device.touch && !input.dragLook) input.requestLock();
});
document.getElementById('tbtnAct')?.addEventListener('pointerdown', (e) => {
  e.preventDefault(); e.stopPropagation();
  if (!hud.locked) tryInteract();
});
document.getElementById('tbtnSense')?.addEventListener('pointerdown', (e) => {
  e.preventDefault(); e.stopPropagation();
  sense();
});
document.getElementById('tbtnJump')?.addEventListener('pointerdown', (e) => {
  e.preventDefault(); e.stopPropagation();
  input.pressed.add('Space');
});
document.getElementById('tbtnRun')?.addEventListener('pointerdown', (e) => {
  e.preventDefault(); e.stopPropagation();
  const on = input.toggleTouchSprint();
  e.currentTarget.classList.toggle('on', on);
});

/* ══════════════════════════ lifecycle ══════════════════════════ */

function startPlaying(withTour) {
  audio.init();
  audio.setEra(ERAS[state.era], true);
  hud.startPlay();
  state.playing = true;
  state.paused = false;
  if (!device.touch && save.get('settings.pointerLock', false)) {
    document.body.classList.add('locked');
    input.requestLock();
  }
  applyEraSettled(state.era);
  if (withTour) tour.start();
  else {
    hud.subtitle('Corner of Fifth and Vine. Drag the timeline at the top to change decade.', 6);
    hud.toast('1945', ERAS[0].tagline, 'era');
  }
}

async function boot() {
  progress(0.03, 'laying out the block…');
  await city.show(0, (p, label) => progress(0.05 + p * 0.86, label));
  progress(0.93, 'hanging the signs…');
  applyEraSettled(0);
  await new Promise((r) => setTimeout(r, 30));
  progress(1, 'ready');
  window.__ready = true;
  document.getElementById('boot')?.classList.add('hidden');
  hud.showTitle();
}

/* ══════════════════════════ loop ══════════════════════════ */

let last = performance.now();
let statTimer = 0;

function frame(now) {
  const dt = Math.min(0.06, Math.max(0.0005, (now - last) / 1000));
  last = now;
  state.time += dt;

  input.sample();
  window.__frames = (window.__frames || 0) + 1;
  window.__inputEnabled = input.enabled;

  if (state.playing && !state.paused) {
    if (tour.active) tour.update(dt, input);
    else player.update(dt, input, { reduceMotion: save.get('settings.reduceMotion', false) });
    save.tick(dt);
    save.noteEra(ERAS[state.era].year, dt);
    hud.tick(dt);
  } else {
    input.takeLook();
  }

  /* Pinch on touch nudges the field of view — a cheap zoom. */
  const pinch = input.takePinch();
  if (pinch && state.playing) {
    const fov = clamp(engine.baseFov - pinch * 0.06, 34, 100);
    engine.setFov(fov);
  }
  const wheel = input.takeZoom();
  if (wheel && state.playing) engine.setFov(clamp(engine.baseFov - wheel * 6, 34, 100));

  warp.update(dt);
  sky.update(dt);
  sky.followCamera(engine.camera.position);
  if (engine.q.shadows) sky.setShadowQuality(engine.q.shadowSize, engine.q.shadowDist);

  /* Wind: a slow shift in direction with gusts riding on top. Everything with
     a leaf on it reads this, and so does the weather field. */
  const gust = 0.10 + 0.055 * (Math.sin(state.time * 0.21) * 0.5 + 0.5)
    + (ERAS[state.era].weather === 'wind' || ERAS[state.era].weather === 'storm' ? 0.20 : 0);
  setWind({ time: state.time, dir: 0.6 + Math.sin(state.time * 0.037) * 0.9, amount: gust });

  city.update(dt, state.time, player.pos, sky.daylight, audio);

  markers.enabled = save.get('settings.waypoints', true);
  markers.update(dt, engine.camera, city.interactables, (id) => save.hasSeen(id),
    state.eraAccent,
    state.playing && !state.paused && !hud.locked && !state.photo);
  document.getElementById('tbtnSense')?.classList.toggle('cooling', markers.cooldown > 0);
  // Pixels per metre at one metre — keeps every sprite physically sized.
  const pixelScale = engine._h / (2 * Math.tan(engine.camera.fov * Math.PI / 360));
  weather.update(dt, state.time, engine.camera.position, pixelScale);
  warpRing.uniforms.uPixelScale.value = pixelScale;

  /* Audio follows the nearest vehicle and the player's heading. */
  if (audio.ready && state.playing) {
    audio.updateTraffic(city.traffic.nearest(player.pos), player.pos, player.yaw, ERAS[state.era]);
  }

  /* Interaction prompt + proximity secrets. */
  if (state.playing && !hud.locked && !warp.active) {
    const it = city.findInteractable(engine.camera.position, player.lookDir, 0.9);
    hud.setPrompt(it);
    for (const v of city.traffic.secretsNear(player.pos, 8)) grantSecret('secret:' + v.secret);
    if (player.pos.y > 13) grantSecret('secret:rooftop');
  } else {
    hud.setPrompt(null);
  }

  /* Ghost overlay: render the adjacent era at half res, every third frame. */
  if (state.ghost && city.eras[state.ghostEra]) {
    state.ghostFrame = (state.ghostFrame + 1) % 3;
    if (state.ghostFrame === 0) renderGhost();
  }

  engine.render(dt, state.time);

  if (state.playing) hud.drawMinimap(player, city, ERAS[state.era]);

  statTimer -= dt;
  if (statTimer <= 0) {
    statTimer = 0.35;
    hud.setStats(
      `${Math.round(engine.stats.fps)} fps  ${engine.stats.avg.toFixed(1)} ms\n` +
      `${engine.stats.draws} draws  ${(engine.stats.tris / 1000).toFixed(0)}k tris\n` +
      `${engine.tier}  x${(engine._adaptive * 100).toFixed(0)}%  ${ERAS[state.era].year}`
    );
  }

  input.endFrame();
  requestAnimationFrame(frame);
}

function renderGhost() {
  const cur = city.eras[state.era];
  const other = city.eras[state.ghostEra];
  if (!cur || !other) return;
  const rt = engine.post.ghostTarget();
  cur.group.visible = false;
  other.group.visible = true;
  city.crowd?.setVisible(false);
  city.flock?.setVisible(false);
  city.traffic.setVisible(false);
  engine.renderer.setRenderTarget(rt);
  engine.renderer.clear(true, true, false);
  engine.renderer.render(engine.scene, engine.camera);
  engine.renderer.setRenderTarget(null);
  other.group.visible = false;
  cur.group.visible = true;
  city.crowd?.setVisible(true);
  city.flock?.setVisible(true);
  city.traffic.setVisible(true);
}

/* ══════════════════════════ go ══════════════════════════ */

engine.onContextLost = () => hud.toast('Graphics context lost', 'Restoring…');
engine.onContextRestored = () => hud.toast('Graphics restored', '');
window.addEventListener('beforeunload', () => { save.data.lastEra = ERAS[state.era].year; save.flush(); });
window.addEventListener('pagehide', () => save.flush());

boot().then(() => requestAnimationFrame(frame)).catch((err) => {
  console.error(err);
  if (bootStep) bootStep.textContent = 'Something went wrong: ' + (err?.message || err);
});

/* Debug hooks for the headless capture harness. */
window.__diag = () => ({
  tier: engine.tier,
  draws: engine.stats.draws,
  tris: engine.stats.tris,
  fps: Math.round(engine.stats.fps),
  avgMs: +engine.stats.avg.toFixed(2),
  era: ERAS[state.era].year,
  interactables: city.interactables.length,
  peds: city.crowd?.people.length ?? 0,
  birds: city.flock?.birds.length ?? 0,
  vehicles: city.traffic.vehicles.length,
  secrets: save.secretCount(),
  pos: [+player.pos.x.toFixed(2), +player.pos.y.toFixed(2), +player.pos.z.toFixed(2)],
  yaw: +player.yaw.toFixed(4),
  keys: [...input.keys],
  move: [+input.move.x.toFixed(2), +input.move.y.toFixed(2)],
  moveMag: +input.moveMag.toFixed(2),
  tour: tour.active,
  pitch: +player.pitch.toFixed(4),
});
window.__setEra = async (i) => {
  state.era = i;
  await city.show(i);
  applyEraSettled(i);
  hud.setEra(i, true);
};
window.__teleport = (x, y, z, yaw) => { player.pos.set(x, y, z); if (yaw !== undefined) player.yaw = yaw; player.applyToCamera(); };
window.__setPitch = (p) => { player.pitch = p; player.applyToCamera(); };
window.__setFly = (f) => { player.flying = !!f; };
window.__play = () => startPlaying(false);
window.__warp = (i) => requestEra(i);
window.__state = state;
/** True while a transition is in flight (build + wipe). Used by the harness. */
window.__warping = () => requestingEra || warp.active;
