/**
 * All DOM. The game loop never touches an element directly — it calls into
 * this controller, and this controller emits intents back out through
 * callbacks. That keeps the render loop free of layout thrash and makes the
 * whole interface testable by poking at the same methods.
 */

import { ERAS, YEARS } from '../data/eras.js';
import { SECRETS, THREADS, PLACES, secretById, TOTAL_SECRETS } from '../data/secrets.js';
import { clamp, clamp01, lerp, clockString } from '../core/mathx.js';

const $ = (id) => document.getElementById(id);
const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);

const FILMS = [
  { id: 'none', label: 'None' },
  { id: 'era', label: 'Era' },
  { id: 'bw', label: 'B&W' },
  { id: 'kodachrome', label: 'Kodachrome' },
  { id: 'cross', label: 'Cross-process' },
  { id: 'noir', label: 'Noir' },
  { id: 'infra', label: 'Infrared' },
];

const WEATHERS = [
  { id: null, label: 'Era default' },
  { id: 'clear', label: 'Clear' },
  { id: 'rain', label: 'Rain' },
  { id: 'snow', label: 'Snow' },
  { id: 'soot', label: 'Soot' },
  { id: 'haze', label: 'Haze' },
];

const QUALITIES = ['low', 'medium', 'high', 'ultra'];

export class HUD {
  constructor(save, opts = {}) {
    this.save = save;
    this.on = {};                 // event → handler, assigned by main
    this.eraIndex = 0;
    this.dragging = false;
    this._toastId = 0;
    this._promptShown = null;
    this._factTimer = 0;
    this._factIdx = 0;
    this.isTouch = opts.touch;

    this.build();
    this.bind();
    this.applySettings();
  }

  emit(name, ...args) { this.on[name]?.(...args); }

  /** Highlight the quality chip that is actually in use (auto-detected or saved). */
  setQualityChip(tier) {
    const host = document.getElementById('setQuality');
    if (!host) return;
    [...host.children].forEach((c) => c.classList.toggle('on', c.dataset.v === tier));
  }

  /* ══════════════════════════ construction ══════════════════════════ */

  build() {
    /* Timeline stops */
    const stops = $('tlStops');
    if (stops) {
      stops.innerHTML = '';
      YEARS.forEach((y, i) => {
        const el = document.createElement('div');
        el.className = 'tl-stop';
        el.innerHTML = `<b>${y}</b>`;
        el.dataset.i = String(i);
        stops.appendChild(el);
      });
    }

    /* Chip groups */
    this.chipGroup($('setQuality'), QUALITIES.map((q) => ({ id: q, label: q[0].toUpperCase() + q.slice(1) })),
      this.save.get('settings.quality'), (v) => this.emit('quality', v));
    this.chipGroup($('setWx'), WEATHERS, this.save.get('settings.weather'), (v) => {
      this.save.set('settings.weather', v);
      $('wxVal').textContent = (WEATHERS.find((w) => w.id === v) || WEATHERS[0]).label.toLowerCase();
      this.emit('weather', v);
    });
    this.chipGroup($('pbFilm'), FILMS, 'era', (v) => this.emit('film', v));

    /* Key map */
    const km = $('keymap');
    if (km) {
      km.innerHTML = [
        ['Move', 'W A S D / arrows'],
        ['Look', 'Drag with the mouse'],
        ['Inspect', 'Click, or E'],
        ['Sprint', 'Shift'], ['Crouch', 'Z'], ['Jump', 'Space'],
        ['Interact', 'E'], ['Jump to era', '1 – 6'],
        ['Nudge time', 'Q / R'], ['Photo mode', 'P'], ['Ghost overlay', 'G'],
        ['Codex', 'C'], ['Free-fly', 'F'], ['Mute', 'M'], ['Menu', 'Esc'],
      ].map(([a, b]) => `<div><b>${a}</b><span>${b}</span></div>`).join('');
    }

    $('cxTotal').textContent = String(TOTAL_SECRETS);
    this.renderCodex();
    this.setEra(0, true);

    const line = $('titleSaveLine');
    if (line) line.textContent = this.save.summary();
  }

  chipGroup(host, items, current, cb) {
    if (!host) return;
    host.innerHTML = '';
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'chip' + (it.id === current ? ' on' : '');
      b.textContent = it.label;
      b.dataset.v = String(it.id);
      b.onclick = () => {
        [...host.children].forEach((c) => c.classList.remove('on'));
        b.classList.add('on');
        cb(it.id);
        this.emit('ui', 'tick');
      };
      host.appendChild(b);
    }
  }

  /* ══════════════════════════ bindings ══════════════════════════ */

  bind() {
    /* Title screen */
    on($('btnStart'), 'click', () => this.emit('start'));
    on($('btnTour'), 'click', () => this.emit('start', { tour: true }));
    on($('btnSettingsTitle'), 'click', () => this.openMenu('video'));

    /* Timeline */
    const track = $('tlTrack');
    const pick = (clientX) => {
      const r = track.getBoundingClientRect();
      const t = clamp01((clientX - r.left - 6) / Math.max(1, r.width - 12));
      return Math.round(t * (YEARS.length - 1));
    };
    let dragIdx = -1;
    const down = (e) => {
      if (this.locked) return;
      this.dragging = true;
      $('tlThumb')?.classList.add('drag');
      dragIdx = pick(e.clientX ?? e.touches?.[0]?.clientX ?? 0);
      this.previewEra(dragIdx);
      track.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };
    const move = (e) => {
      if (!this.dragging) return;
      const i = pick(e.clientX ?? e.touches?.[0]?.clientX ?? 0);
      if (i !== dragIdx) { dragIdx = i; this.previewEra(i); this.emit('ui', 'tick'); }
      e.preventDefault();
    };
    const up = () => {
      if (!this.dragging) return;
      this.dragging = false;
      $('tlThumb')?.classList.remove('drag');
      if (dragIdx >= 0 && dragIdx !== this.eraIndex) this.emit('era', dragIdx);
      else this.setEra(this.eraIndex, true);
    };
    on(track, 'pointerdown', down);
    on(window, 'pointermove', move, { passive: false });
    on(window, 'pointerup', up);
    on(window, 'pointercancel', up);
    on(track, 'keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { this.emit('era', Math.max(0, this.eraIndex - 1)); e.preventDefault(); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { this.emit('era', Math.min(YEARS.length - 1, this.eraIndex + 1)); e.preventDefault(); }
      if (e.key === 'Home') this.emit('era', 0);
      if (e.key === 'End') this.emit('era', YEARS.length - 1);
    });
    on($('tlPrev'), 'click', () => this.emit('era', Math.max(0, this.eraIndex - 1)));
    on($('tlNext'), 'click', () => this.emit('era', Math.min(YEARS.length - 1, this.eraIndex + 1)));
    on($('tlStops'), 'click', (e) => {
      const stop = e.target.closest('.tl-stop');
      if (stop) this.emit('era', Number(stop.dataset.i));
    });

    /* Top-right cluster */
    on($('btnPhoto'), 'click', () => this.emit('photo'));
    on($('btnGhost'), 'click', () => this.emit('ghost'));
    on($('btnCodex'), 'click', () => this.openCodex());
    on($('btnAudio'), 'click', () => this.emit('mute'));
    on($('btnMenu'), 'click', () => this.openMenu());

    /* Menu */
    on($('menuClose'), 'click', () => this.closeMenu());
    on($('mnResume'), 'click', () => this.closeMenu());
    on($('mnTour'), 'click', () => { this.closeMenu(); this.emit('tour'); });
    on($('mnCodex'), 'click', () => { this.closeMenu(); this.openCodex(); });
    on($('mnReset'), 'click', () => { this.closeMenu(); this.emit('resetPos'); });
    on($('mnFly'), 'click', () => { this.closeMenu(); this.emit('fly'); });
    on($('mnWipe'), 'click', () => {
      if (this._wipeArmed) { this.save.wipe(); location.reload(); return; }
      this._wipeArmed = true;
      $('mnWipe').textContent = 'Tap again to erase everything';
      setTimeout(() => { this._wipeArmed = false; $('mnWipe').textContent = 'Erase saved progress'; }, 4000);
    });
    on($('menuTabs'), 'click', (e) => {
      const t = e.target.closest('.tab');
      if (!t) return;
      this.showTab('menu', t.dataset.tab);
      this.emit('ui', 'tick');
    });

    /* Codex + reader */
    on($('codexClose'), 'click', () => this.closeCodex());
    on($('codexTabs'), 'click', (e) => {
      const t = e.target.closest('.tab');
      if (t) { this.showTab('codex', t.dataset.cx); this.emit('ui', 'tick'); }
    });
    on($('readerClose'), 'click', () => this.closeReader());

    /* Photo bar */
    on($('pbExit'), 'click', () => this.emit('photo', false));
    on($('pbShoot'), 'click', () => this.emit('shoot'));
    on($('pbHideUI'), 'click', () => {
      document.body.classList.toggle('uihidden');
      $('pbHideUI').classList.toggle('on', document.body.classList.contains('uihidden'));
    });
    on($('pbGrid'), 'click', () => {
      const on2 = !$('pbGrid').classList.contains('on');
      $('pbGrid').classList.toggle('on', on2);
      this.emit('grid', on2);
    });
    this.slider('pbFov', (v) => { $('pbFovVal').textContent = v + 'mm'; this.emit('photoFov', v); });
    this.slider('pbDof', (v) => { $('pbDofVal').textContent = v ? v + '%' : 'off'; this.emit('photoDof', v / 100); });
    this.slider('pbExp', (v) => { $('pbExpVal').textContent = (v / 50).toFixed(1); this.emit('photoExp', v / 50); });

    /* Settings */
    this.slider('setTod', (v) => { $('todVal').textContent = clockString(v); this.save.set('settings.timeOfDay', v); this.emit('tod', v); });
    this.slider('setRes', (v) => { $('rsVal').textContent = v + '%'; this.save.set('settings.renderScale', v / 100); this.emit('renderScale', v / 100); });
    this.slider('setSens', (v) => { $('sensVal').textContent = (v / 100).toFixed(2); this.save.set('settings.sensitivity', v / 100); this.emit('sensitivity', v / 100); });
    this.slider('setFov', (v) => { $('fovVal').textContent = v + '°'; this.save.set('settings.fov', v); this.emit('fov', v); });
    this.slider('setStick', (v) => { $('stickVal').textContent = v + '%'; this.save.set('settings.stickSize', v / 100); document.documentElement.style.setProperty('--stick', String(v / 100)); });
    this.slider('setVol', (v) => { $('volVal').textContent = v + '%'; this.save.set('settings.volume', v / 100); this.emit('volume', v / 100); });
    this.slider('setMus', (v) => { $('musVal').textContent = v + '%'; this.save.set('settings.music', v / 100); this.emit('music', v / 100); });

    const toggles = {
      setShadows: ['shadows', (v) => this.emit('shadows', v)],
      setBloom: ['bloom', (v) => this.emit('bloom', v)],
      setSSAO: ['ssao', (v) => this.emit('ssao', v)],
      setGrain: ['grain', (v) => this.emit('grain', v)],
      setCA: ['ca', (v) => this.emit('ca', v)],
      setRefl: ['reflections', (v) => this.emit('reflections', v)],
      setCrowd: ['crowd', (v) => this.emit('crowd', v)],
      setFps: ['fps', (v) => { $('fps').classList.toggle('hidden', !v); }],
      setLock: ['pointerLock', (v) => this.emit('pointerLock', v)],
      setInvert: ['invertY', (v) => this.emit('invertY', v)],
      setBob: ['viewBob', (v) => this.emit('viewBob', v)],
      setSticky: ['stickySprint', (v) => this.emit('stickySprint', v)],
      setLefty: ['lefty', (v) => document.body.classList.toggle('lefty', v)],
      setReduceMotion: ['reduceMotion', (v) => { document.body.classList.toggle('reduce', v); this.emit('reduceMotion', v); }],
      setNoFlash: ['noFlash', (v) => this.emit('noFlash', v)],
      setBigUI: ['bigUI', (v) => document.body.classList.toggle('bigui', v)],
      setHighContrast: ['contrast', (v) => document.body.classList.toggle('contrast', v)],
      setSubs: ['subtitles', () => {}],
      setGuide: ['prompts', () => {}],
      setWaypoint: ['waypoints', (v) => this.emit('waypoints', v)],
    };
    for (const [id, [key, cb]] of Object.entries(toggles)) {
      const el = $(id);
      if (!el) continue;
      on(el, 'change', () => {
        this.save.set('settings.' + key, el.checked);
        cb(el.checked);
        this.emit('ui', 'tick');
      });
    }

    /* Backdrop click closes overlays */
    for (const [id, close] of [['menu', () => this.closeMenu()], ['codex', () => this.closeCodex()], ['reader', () => this.closeReader()]]) {
      on($(id), 'pointerdown', (e) => { if (e.target === $(id)) close(); });
    }

    /* Orientation nudge on small landscape-less screens */
    const checkRotate = () => {
      const el = $('rotatehint');
      if (!el) return;
      const need = this.isTouch && window.innerHeight > window.innerWidth && window.innerWidth < 420;
      el.classList.toggle('hidden', !need || !this._playing);
    };
    on(window, 'resize', checkRotate);
    on(window, 'orientationchange', () => setTimeout(checkRotate, 300));
    this._checkRotate = checkRotate;
  }

  slider(id, cb) {
    const el = $(id);
    if (!el) return;
    on(el, 'input', () => cb(Number(el.value)));
    cb(Number(el.value));
  }

  /* ══════════════════════════ settings ══════════════════════════ */

  applySettings() {
    const s = this.save.settings;
    const setChecked = (id, v) => { const el = $(id); if (el) el.checked = !!v; };
    const setVal = (id, v) => { const el = $(id); if (el) { el.value = String(v); el.dispatchEvent(new Event('input')); } };

    setChecked('setShadows', s.shadows); setChecked('setBloom', s.bloom);
    setChecked('setSSAO', s.ssao); setChecked('setGrain', s.grain);
    setChecked('setCA', s.ca); setChecked('setRefl', s.reflections);
    setChecked('setCrowd', s.crowd); setChecked('setFps', s.fps);
    setChecked('setLock', s.pointerLock); setChecked('setInvert', s.invertY);
    setChecked('setBob', s.viewBob);
    setChecked('setSticky', s.stickySprint); setChecked('setLefty', s.lefty);
    setChecked('setReduceMotion', s.reduceMotion); setChecked('setNoFlash', s.noFlash);
    setChecked('setBigUI', s.bigUI); setChecked('setHighContrast', s.contrast);
    setChecked('setSubs', s.subtitles); setChecked('setGuide', s.prompts);
    setChecked('setWaypoint', s.waypoints);

    setVal('setRes', Math.round(s.renderScale * 100));
    setVal('setSens', Math.round(s.sensitivity * 100));
    setVal('setFov', s.fov);
    setVal('setStick', Math.round(s.stickSize * 100));
    setVal('setVol', Math.round(s.volume * 100));
    setVal('setMus', Math.round(s.music * 100));

    document.body.classList.toggle('lefty', !!s.lefty);
    document.body.classList.toggle('reduce', !!s.reduceMotion);
    document.body.classList.toggle('bigui', !!s.bigUI);
    document.body.classList.toggle('contrast', !!s.contrast);
    document.documentElement.style.setProperty('--stick', String(s.stickSize));
    $('fps')?.classList.toggle('hidden', !s.fps);
  }

  /* ══════════════════════════ era ══════════════════════════ */

  previewEra(i) {
    const pct = (i / (YEARS.length - 1)) * 100;
    const track = $('tlTrack');
    const w = track ? track.clientWidth - 12 : 100;
    $('tlThumb').style.left = (6 + (pct / 100) * w) + 'px';
    $('tlFill').style.width = pct + '%';
    $('tlThumbYear').textContent = String(YEARS[i]);
    [...$('tlStops').children].forEach((el, n) => {
      el.classList.toggle('on', n === i);
      el.classList.toggle('passed', n < i);
    });
  }

  setEra(i, immediate = false) {
    this.eraIndex = i;
    const era = ERAS[i];
    this.previewEra(i);
    $('tlTrack')?.setAttribute('aria-valuenow', String(i));
    $('tlTrack')?.setAttribute('aria-valuetext', String(era.year));
    $('tlCaption').textContent = era.caption;
    $('ecYear').textContent = String(era.year);
    $('ecName').textContent = era.name;
    this._factIdx = 0;
    $('ecFact').textContent = era.facts[0];
    this._factTimer = 12;
    $('tlPrev').disabled = i === 0;
    $('tlNext').disabled = i === YEARS.length - 1;
    this.renderCodex();
  }

  tick(dt) {
    this._factTimer -= dt;
    if (this._factTimer <= 0) {
      this._factTimer = 13;
      const era = ERAS[this.eraIndex];
      this._factIdx = (this._factIdx + 1) % era.facts.length;
      const el = $('ecFact');
      if (el) { el.style.opacity = '0'; setTimeout(() => { el.textContent = era.facts[this._factIdx]; el.style.opacity = ''; }, 220); }
    }
  }

  /* ══════════════════════════ prompts & toasts ══════════════════════════ */

  setPrompt(it) {
    const el = $('prompt');
    const ret = $('reticle');
    const act = $('tbtnAct');
    if (!it || !this.save.get('settings.prompts', true)) {
      el?.classList.add('hidden');
      ret?.classList.remove('hot');
      act?.classList.remove('hot');
      this._promptShown = null;
      return;
    }
    if (this._promptShown === it.id) return;
    this._promptShown = it.id;
    el.classList.remove('hidden');
    $('promptKey').textContent = this.isTouch ? '◎' : 'E';
    $('promptTitle').textContent = it.title;
    $('promptSub').textContent = it.sub || '';
    ret?.classList.add('hot');
    act?.classList.add('hot');
  }

  toast(title, sub, kind = '') {
    const host = $('toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    const icon = kind === 'secret' ? '✦' : kind === 'era' ? '⏱' : 'ⓘ';
    el.innerHTML = `<div class="t-ico">${icon}</div><div class="t-txt"><b></b><span></span></div>`;
    el.querySelector('b').textContent = title;
    el.querySelector('span').textContent = sub || '';
    host.appendChild(el);
    const id = ++this._toastId;
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 320);
    }, kind === 'secret' ? 5200 : 3400);
    while (host.children.length > 4) host.firstChild.remove();
    return id;
  }

  subtitle(text, seconds = 4) {
    if (!this.save.get('settings.subtitles', true)) return;
    const el = $('subtitle');
    if (!el) return;
    clearTimeout(this._subTimer);
    if (!text) { el.classList.add('hidden'); return; }
    $('subtitleText').textContent = text;
    el.classList.remove('hidden');
    this._subTimer = setTimeout(() => el.classList.add('hidden'), seconds * 1000);
  }

  /* ══════════════════════════ panels ══════════════════════════ */

  showTab(panel, name) {
    const root = $(panel);
    const attr = panel === 'codex' ? 'cx' : 'tab';
    const pane = panel === 'codex' ? 'cxpane' : 'pane';
    root.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-on', t.dataset[attr] === name));
    root.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('is-on', p.dataset[pane] === name));
  }

  openMenu(tab) {
    $('menu').classList.remove('hidden');
    if (tab) this.showTab('menu', tab);
    this.locked = true;
    this.emit('pause', true);
    this.emit('ui', 'open');
  }
  closeMenu() {
    $('menu').classList.add('hidden');
    this.locked = this.anyOpen();
    this.emit('pause', this.locked);
    this.emit('ui', 'close');
  }
  openCodex() {
    this.renderCodex();
    $('codex').classList.remove('hidden');
    this.locked = true;
    this.emit('pause', true);
    this.emit('ui', 'open');
    $('codexBadge')?.classList.remove('pulse');
  }
  closeCodex() {
    $('codex').classList.add('hidden');
    this.locked = this.anyOpen();
    this.emit('pause', this.locked);
    this.emit('ui', 'close');
  }
  openReader(payload) {
    $('readerTitle').textContent = payload.title || '';
    const body = $('readerBody');
    body.innerHTML = '';
    for (const b of payload.body || []) {
      const el = document.createElement(b.type === 'sign' ? 'div' : 'p');
      if (b.type === 'sign') el.className = 'sign';
      if (b.type === 'quote') el.className = 'quote';
      if (b.lede) el.className = 'lede';
      el.textContent = b.text;
      body.appendChild(el);
    }
    $('readerFoot').textContent = payload.foot || '';
    $('reader').classList.remove('hidden');
    body.scrollTop = 0;
    this.locked = true;
    this.emit('pause', true);
    this.emit('ui', 'open');
  }
  closeReader() {
    $('reader').classList.add('hidden');
    this.locked = this.anyOpen();
    this.emit('pause', this.locked);
    this.emit('ui', 'close');
  }
  anyOpen() {
    return ['menu', 'codex', 'reader'].some((id) => !$(id).classList.contains('hidden'));
  }
  closeTop() {
    if (!$('reader').classList.contains('hidden')) { this.closeReader(); return true; }
    if (!$('codex').classList.contains('hidden')) { this.closeCodex(); return true; }
    if (!$('menu').classList.contains('hidden')) { this.closeMenu(); return true; }
    return false;
  }

  /* ══════════════════════════ codex ══════════════════════════ */

  renderCodex() {
    const found = this.save.data.secrets;
    const n = Object.keys(found).length;
    $('cxFound').textContent = String(n);
    const badge = $('codexBadge');
    if (badge) { badge.textContent = String(n); badge.classList.toggle('zero', n === 0); }

    const grid = $('cxSecrets');
    if (grid) {
      grid.innerHTML = SECRETS.map((s) => {
        const got = !!found[s.id];
        const eraLabel = s.era ? String(s.era) : 'ANY ERA';
        return `<div class="cx-card ${got ? 'found' : 'locked'}">
          <div class="cx-era">${eraLabel}</div>
          <div class="cx-ico">${got ? s.icon : '·'}</div>
          <h4>${got ? esc(s.title) : '— — —'}</h4>
          <p>${esc(s.hint)}</p>
        </div>`;
      }).join('');
    }

    const th = $('cxThreads');
    if (th) {
      th.innerHTML = THREADS.map((t) => {
        const beads = t.beads.map((b) => {
          const key = t.perEra ? `${t.perEra}@${b.year}` : b.secret;
          const got = key ? !!found[key] : false;
          return `<div class="cx-bead ${got ? 'on' : ''}"><i></i><b>${b.year}</b><span>${got || !key ? esc(b.label) : '·····'}</span></div>`;
        }).join('');
        return `<div class="cx-thread"><h4>${t.icon} ${esc(t.title)}</h4><p>${esc(t.blurb)}</p><div class="cx-beads">${beads}</div></div>`;
      }).join('');
    }

    const pl = $('cxPlaces');
    if (pl) {
      const places = this.save.data.places;
      pl.innerHTML = PLACES.map((p) => {
        const seen = YEARS.filter((y) => places[`${p.id}@${y}`]).length;
        return `<div class="cx-card ${seen ? 'found' : 'locked'}">
          <div class="cx-era">${seen} / 6 DECADES</div>
          <div class="cx-ico">${p.icon}</div>
          <h4>${esc(p.title)}</h4>
          <p>${esc(p.addr)}</p>
        </div>`;
      }).join('');
    }
  }

  celebrateSecret(id) {
    const s = secretById[id.split('@')[0]] || { title: 'Something', icon: '✦' };
    this.toast(`${s.icon}  ${s.title}`, 'Added to the codex', 'secret');
    const badge = $('codexBadge');
    if (badge) { badge.classList.add('pulse'); setTimeout(() => badge.classList.remove('pulse'), 1500); }
    this.renderCodex();
  }

  /* ══════════════════════════ screens ══════════════════════════ */

  showTitle() {
    $('title').classList.remove('hidden');
    $('hud').classList.add('hidden');
    this._playing = false;
    this.locked = true;
  }
  startPlay() {
    $('title').classList.add('hidden');
    $('hud').classList.remove('hidden');
    if (this.isTouch) $('touch').classList.remove('hidden');
    this._playing = true;
    this.locked = false;
    this._checkRotate?.();
  }

  setPhotoMode(on) {
    $('photobar').classList.toggle('hidden', !on);
    $('btnPhoto')?.classList.toggle('on', on);
    $('eracard')?.classList.toggle('hidden', on);
    if (!on) document.body.classList.remove('uihidden');
  }
  setGhost(on) { $('btnGhost')?.classList.toggle('on', on); }
  setMuted(m) {
    $('audioOn')?.classList.toggle('hidden', m);
    $('audioOff')?.classList.toggle('hidden', !m);
    $('btnAudio')?.classList.toggle('on', m);
  }
  flash() {
    const f = $('flash');
    if (!f) return;
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  setStats(text) { const el = $('fps'); if (el && !el.classList.contains('hidden')) el.textContent = text; }

  /* ══════════════════════════ minimap ══════════════════════════ */

  initMinimap() {
    this.mm = $('minimapCanvas');
    this.mmCtx = this.mm?.getContext('2d');
  }

  drawMinimap(player, city, era) {
    if (!this.mmCtx) return;
    const c = this.mmCtx, W = this.mm.width, H = this.mm.height;
    const scale = W / 130;
    c.clearRect(0, 0, W, H);
    c.save();
    c.translate(W / 2, H / 2);

    const accent = getComputedStyle(document.documentElement).getPropertyValue('--era-accent').trim() || '#e8b46a';

    // Streets
    c.fillStyle = 'rgba(255,255,255,0.06)';
    c.fillRect(-W / 2, -34.2 * scale, W, 68.4 * scale);
    c.fillRect(-34.2 * scale, -H / 2, 68.4 * scale, H);
    c.fillStyle = 'rgba(255,255,255,0.02)';
    c.fillRect(-W / 2, -47.2 * scale, W, 94.4 * scale);
    c.fillRect(-47.2 * scale, -H / 2, 94.4 * scale, H);

    // The block
    c.fillStyle = 'rgba(255,255,255,0.16)';
    c.fillRect(-30 * scale, -30 * scale, 60 * scale, 60 * scale);
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.lineWidth = 1;
    c.strokeRect(-30 * scale, -30 * scale, 60 * scale, 60 * scale);
    // Courtyard hole
    c.clearRect(-10 * scale, -11 * scale, 20 * scale, 22 * scale);
    c.fillStyle = 'rgba(255,255,255,0.04)';
    c.fillRect(-10 * scale, -11 * scale, 20 * scale, 22 * scale);
    c.fillRect(5 * scale, 11 * scale, 5 * scale, 19 * scale);

    // Undiscovered secrets, faintly
    if (this.save.get('settings.waypoints', true)) {
      for (const it of city.interactables) {
        if (!it.secret || this.save.hasSecret(it.id)) continue;
        c.fillStyle = 'rgba(255,240,190,0.5)';
        c.beginPath();
        c.arc(it.pos.x * scale, it.pos.z * scale, 2.2, 0, 7);
        c.fill();
      }
    }

    // Player + facing cone
    const px = player.pos.x * scale, pz = player.pos.z * scale;
    const yaw = player.yaw;
    c.fillStyle = accent;
    c.beginPath();
    c.moveTo(px + Math.sin(yaw) * 7, pz + Math.cos(yaw) * 7);
    c.lineTo(px + Math.sin(yaw + 2.5) * 4.5, pz + Math.cos(yaw + 2.5) * 4.5);
    c.lineTo(px + Math.sin(yaw - 2.5) * 4.5, pz + Math.cos(yaw - 2.5) * 4.5);
    c.closePath();
    c.fill();

    c.restore();

    // Compass N
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.font = '9px ui-monospace, monospace';
    c.textAlign = 'center';
    c.fillText('N', W / 2, 11);
  }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export { FILMS, WEATHERS, QUALITIES };
