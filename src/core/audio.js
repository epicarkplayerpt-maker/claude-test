/**
 * Procedural audio.
 *
 * Every sound in this project is synthesised at runtime: the swing band on a
 * 1945 shop radio, the V8 idle of a 1965 sedan, an arcade cabinet through a
 * 1985 doorway, a 2025 e-scooter, a 2055 delivery drone. There are no audio
 * files to download, which keeps the whole thing under a megabyte and means
 * the music can follow the timeline continuously instead of cutting between
 * loops.
 *
 * Structure:
 *   master ─┬─ music   (generative, era-styled, scheduled ahead)
 *           ├─ ambience(noise beds + random one-shot layers)
 *           └─ sfx     (footsteps, horns, UI, the warp)
 *   with a synthesised convolution reverb on a send.
 *
 * iOS: the context is created lazily inside a user gesture and a silent buffer
 * is played to unlock it; `resume()` is also called on every visibility change
 * because iOS suspends audio aggressively when the tab backgrounds.
 */

import { clamp, clamp01, lerp } from './mathx.js';

const AC = window.AudioContext || window.webkitAudioContext;

/* ══════════════════════════ helpers ══════════════════════════ */

function noiseBuffer(ctx, seconds = 2, type = 'white') {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  if (type === 'white') {
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } else if (type === 'pink') {
    // Voss-McCartney-ish: cheap, and the spectrum is close enough for beds.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else { // brown
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  return buf;
}

/** A synthesised room impulse: exponentially decaying noise with early taps. */
function impulseBuffer(ctx, seconds = 1.9, decay = 3.2, bright = 0.5) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, decay);
      const n = (Math.random() * 2 - 1) * env;
      lp += (n - lp) * (0.08 + bright * 0.5);
      d[i] = lp;
    }
    // Early reflections give the street its size.
    for (const [tapT, g] of [[0.012, 0.5], [0.021, -0.36], [0.034, 0.28], [0.051, -0.2]]) {
      const idx = Math.floor(tapT * ctx.sampleRate) + (ch * 37);
      if (idx < len) d[idx] += g;
    }
  }
  return buf;
}

const NOTE = (root, semis) => root * Math.pow(2, semis / 12);

/* ══════════════════════════ engine ══════════════════════════ */

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.masterVolume = 0.8;
    this.musicVolume = 0.55;
    this.era = null;
    this._layerTimers = [];
    this._nextNoteTime = 0;
    this._step = 0;
    this._schedTimer = null;
    this._engineVoices = [];
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  init() {
    if (this.ctx) { this.resume(); return; }
    try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch { return; }
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.masterVolume;
    this.master.connect(ctx.destination);

    // A gentle limiter keeps a busy 1985 corner from clipping.
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.006;
    this.comp.release.value = 0.22;
    this.comp.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(this.comp);

    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.9;
    this.ambBus.connect(this.comp);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 1.0;
    this.sfxBus.connect(this.comp);

    this.verb = ctx.createConvolver();
    this.verb.buffer = impulseBuffer(ctx, 1.9, 3.2, 0.45);
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.32;
    this.verb.connect(this.verbGain);
    this.verbGain.connect(this.comp);

    this.noiseWhite = noiseBuffer(ctx, 2, 'white');
    this.noisePink = noiseBuffer(ctx, 3, 'pink');
    this.noiseBrown = noiseBuffer(ctx, 3, 'brown');

    /* Unlock: a single silent buffer through the graph. */
    const s = ctx.createBufferSource();
    s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    s.connect(this.master);
    s.start(0);

    this.ready = true;
    this.resume();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.ctx?.suspend?.();
      else this.resume();
    });
  }

  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume?.().catch(() => {}); }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.masterVolume, this.now, 0.05);
  }
  setVolume(v) {
    this.masterVolume = clamp01(v);
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(this.masterVolume, this.now, 0.06);
  }
  setMusicVolume(v) {
    this.musicVolume = clamp01(v);
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(this.musicVolume, this.now, 0.1);
  }

  /* ══════════════════════════ primitives ══════════════════════════ */

  _env(node, t, a, d, s, r, peak = 1) {
    const g = node.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak * s), t + a + d);
    g.exponentialRampToValueAtTime(0.0001, t + a + d + r);
    return t + a + d + r;
  }

  _osc(type, freq, t, dur, gain, dest, detune = 0) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (detune) o.detune.setValueAtTime(detune, t);
    o.connect(g); g.connect(dest || this.sfxBus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.03);
    return { o, g };
  }

  _noise(t, dur, gain, filterType, freq, q, dest, buffer) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer || this.noiseWhite;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.008, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest || this.sfxBus);
    src.start(t); src.stop(t + dur + 0.05);
    return { src, f, g };
  }

  /** Positional helper: returns a {input, setPos} pair with distance + pan. */
  _spatial(dest) {
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 18000;
    lp.connect(g);
    if (pan) { g.connect(pan); pan.connect(dest || this.sfxBus); }
    else g.connect(dest || this.sfxBus);
    return {
      input: lp,
      set(pos, camPos, camYaw, maxDist = 55) {
        const dx = pos.x - camPos.x, dz = pos.z - camPos.z;
        const dist = Math.hypot(dx, dz);
        const atten = clamp01(1 - dist / maxDist);
        g.gain.value = atten * atten;
        lp.frequency.value = lerp(1200, 18000, atten);
        if (pan) {
          // Angle relative to where the camera is facing, projected to stereo.
          const a = Math.atan2(dx, dz) - camYaw;
          pan.pan.value = clamp(-Math.sin(a), -1, 1) * 0.8;
        }
      },
    };
  }

  /* ══════════════════════════ one-shots ══════════════════════════ */

  ui(kind = 'tick') {
    if (!this.ready) return;
    const t = this.now + 0.001;
    if (kind === 'tick') this._osc('sine', 1320, t, 0.045, 0.06, this.sfxBus);
    else if (kind === 'confirm') {
      this._osc('sine', 660, t, 0.09, 0.08, this.sfxBus);
      this._osc('sine', 990, t + 0.05, 0.14, 0.06, this.sfxBus);
    } else if (kind === 'open') {
      this._osc('triangle', 420, t, 0.12, 0.06, this.sfxBus);
      this._osc('triangle', 630, t + 0.03, 0.16, 0.04, this.sfxBus);
    } else if (kind === 'close') {
      this._osc('triangle', 520, t, 0.1, 0.05, this.sfxBus);
      this._osc('triangle', 340, t + 0.04, 0.14, 0.04, this.sfxBus);
    } else if (kind === 'secret') {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        this._osc('sine', f, t + i * 0.085, 0.5, 0.09, this.verb);
        this._osc('triangle', f * 2, t + i * 0.085, 0.28, 0.03, this.sfxBus);
      });
    } else if (kind === 'shutter') {
      this._noise(t, 0.045, 0.24, 'bandpass', 2600, 1.2, this.sfxBus);
      this._noise(t + 0.07, 0.05, 0.16, 'bandpass', 1800, 1.2, this.sfxBus);
    } else if (kind === 'deny') {
      this._osc('square', 180, t, 0.13, 0.05, this.sfxBus);
    }
  }

  /** Footstep on a given surface, at a given effort. */
  footstep(power = 0.5, surface = 'leather') {
    if (!this.ready) return;
    const t = this.now + 0.001;
    const g = 0.05 + power * 0.08;
    if (surface === 'wet') {
      this._noise(t, 0.09, g * 1.2, 'bandpass', 900 + Math.random() * 500, 0.8, this.sfxBus);
      this._noise(t + 0.01, 0.16, g * 0.5, 'highpass', 2800, 0.6, this.verb);
    } else if (surface === 'rubber') {
      this._noise(t, 0.07, g, 'lowpass', 700 + Math.random() * 300, 1.1, this.sfxBus);
    } else if (surface === 'soft') {
      this._noise(t, 0.1, g * 0.7, 'lowpass', 420, 0.9, this.sfxBus);
    } else {
      this._noise(t, 0.055, g, 'bandpass', 1500 + Math.random() * 900, 1.6, this.sfxBus);
      this._noise(t + 0.004, 0.11, g * 0.35, 'lowpass', 380, 0.7, this.sfxBus);
    }
  }

  horn(kind, pos, camPos, camYaw = 0) {
    if (!this.ready) return;
    const t = this.now + 0.02;
    const sp = this._spatial(this.sfxBus);
    sp.set(pos, camPos, camYaw, 70);
    const dest = sp.input;
    if (kind === 'ahooga') {
      // Two-tone klaxon with a wobble.
      const o = this._osc('sawtooth', 180, t, 0.55, 0.1, dest);
      o.o.frequency.setValueAtTime(180, t);
      o.o.frequency.linearRampToValueAtTime(240, t + 0.22);
      o.o.frequency.linearRampToValueAtTime(170, t + 0.5);
    } else if (kind === 'brass') {
      this._osc('sawtooth', 392, t, 0.5, 0.07, dest);
      this._osc('sawtooth', 494, t, 0.5, 0.06, dest, 6);
    } else if (kind === 'chime') {
      this._osc('sine', 880, t, 0.35, 0.05, dest);
      this._osc('sine', 1320, t + 0.09, 0.4, 0.035, dest);
    } else if (kind === 'flat') {
      this._osc('square', 330, t, 0.6, 0.06, dest);
      this._osc('square', 415, t, 0.6, 0.05, dest, -4);
    } else {
      this._osc('square', 440, t, 0.28, 0.055, dest);
      this._osc('square', 554, t, 0.28, 0.045, dest);
    }
  }

  /* ══════════════════════════ ambience ══════════════════════════ */

  setEra(era, immediate = false) {
    if (!this.ready) return;
    this.era = era;
    const ctx = this.ctx, t = this.now;

    /* Bed: a filtered noise floor plus a low rumble. */
    if (!this._bed) {
      this._bed = {
        src: ctx.createBufferSource(), filt: ctx.createBiquadFilter(),
        gain: ctx.createGain(), rumbleOsc: ctx.createOscillator(), rumbleGain: ctx.createGain(),
      };
      this._bed.src.buffer = this.noisePink;
      this._bed.src.loop = true;
      this._bed.filt.type = 'lowpass';
      this._bed.src.connect(this._bed.filt);
      this._bed.filt.connect(this._bed.gain);
      this._bed.gain.connect(this.ambBus);
      this._bed.gain.connect(this.verb);
      this._bed.src.start(t);

      this._bed.rumbleOsc.type = 'sine';
      this._bed.rumbleOsc.connect(this._bed.rumbleGain);
      this._bed.rumbleGain.connect(this.ambBus);
      this._bed.rumbleOsc.start(t);
    }
    const b = era.audio.ambienceBed;
    const ramp = immediate ? 0.01 : 0.9;
    this._bed.filt.frequency.setTargetAtTime(b.airHz, t, ramp);
    this._bed.gain.gain.setTargetAtTime(b.airGain, t, ramp);
    this._bed.rumbleOsc.frequency.setTargetAtTime(b.rumbleHz, t, ramp);
    this._bed.rumbleGain.gain.setTargetAtTime(b.rumbleGain, t, ramp);

    /* Reverb character: a 1945 street of masonry is drier and darker than a
       2055 street of glass and planting. */
    this.verbGain.gain.setTargetAtTime(era.year >= 2025 ? 0.22 : 0.34, t, ramp);

    this._scheduleLayers(era);
    this._startMusic(era, immediate);
  }

  _scheduleLayers(era) {
    for (const id of this._layerTimers) clearTimeout(id);
    this._layerTimers = [];
    for (const name of era.audio.layers) {
      const spec = LAYERS[name];
      if (!spec) continue;
      const fire = () => {
        if (this.era !== era || !this.ready) return;
        try { spec.play(this, this.now + 0.05); } catch { /* keep the loop alive */ }
        const next = spec.every[0] + Math.random() * (spec.every[1] - spec.every[0]);
        this._layerTimers.push(setTimeout(fire, next * 1000));
      };
      this._layerTimers.push(setTimeout(fire, (1 + Math.random() * spec.every[1]) * 1000));
    }
  }

  /* ══════════════════════════ music ══════════════════════════ */

  _startMusic(era, immediate) {
    const m = era.audio.music;
    this.music = { ...m, chord: 0, bar: 0 };
    // A radio-band filter is what makes a 1945 big band sound like it is
    // coming out of a shop doorway rather than out of your headphones.
    if (!this._radio) {
      this._radio = {
        hp: this.ctx.createBiquadFilter(), lp: this.ctx.createBiquadFilter(),
        gain: this.ctx.createGain(), noiseSrc: this.ctx.createBufferSource(),
        noiseGain: this.ctx.createGain(), noiseFilt: this.ctx.createBiquadFilter(),
      };
      this._radio.hp.type = 'highpass'; this._radio.lp.type = 'lowpass';
      this._radio.hp.connect(this._radio.lp);
      this._radio.lp.connect(this._radio.gain);
      this._radio.gain.connect(this.musicBus);
      this._radio.gain.connect(this.verb);
      this._radio.noiseSrc.buffer = this.noiseWhite;
      this._radio.noiseSrc.loop = true;
      this._radio.noiseFilt.type = 'bandpass';
      this._radio.noiseFilt.frequency.value = 3000;
      this._radio.noiseSrc.connect(this._radio.noiseFilt);
      this._radio.noiseFilt.connect(this._radio.noiseGain);
      this._radio.noiseGain.connect(this.musicBus);
      this._radio.noiseSrc.start(this.now);
    }
    const t = this.now, ramp = immediate ? 0.01 : 0.7;
    this._radio.hp.frequency.setTargetAtTime(m.radioFilter[0], t, ramp);
    this._radio.lp.frequency.setTargetAtTime(m.radioFilter[1], t, ramp);
    this._radio.gain.gain.setTargetAtTime(m.gain, t, ramp);
    this._radio.noiseGain.gain.setTargetAtTime(m.radioNoise, t, ramp);

    if (!this._schedTimer) {
      this._nextNoteTime = this.now + 0.1;
      this._step = 0;
      this._schedTimer = setInterval(() => this._scheduler(), 25);
    }
  }

  _scheduler() {
    if (!this.ready || !this.music || this.ctx.state !== 'running') return;
    const m = this.music;
    const spb = 60 / m.bpm / 4;          // sixteenth notes
    while (this._nextNoteTime < this.now + 0.16) {
      this._playStep(this._step, this._nextNoteTime, m);
      // Swing: delay every other sixteenth.
      const sw = (this._step % 2 === 1) ? (m.swing - 0.5) * 2 * spb * 0.6 : 0;
      this._nextNoteTime += spb;
      this._step = (this._step + 1) % 64;
      if (sw) this._nextNoteTime += sw - (this._step % 2 === 1 ? 0 : sw);
    }
  }

  _playStep(step, t, m) {
    const dest = this._radio.hp;
    const bar = Math.floor(step / 16);
    const beat = Math.floor((step % 16) / 4);
    const six = step % 16;
    const prog = PROGRESSIONS[m.style] || [0, 5, 3, 4];
    const degree = prog[bar % prog.length];
    const root = m.root;
    const sc = m.scale;
    const chordRoot = NOTE(root, sc[degree % sc.length] + (degree >= sc.length ? 12 : 0));
    const third = NOTE(root, sc[(degree + 2) % sc.length] + (degree + 2 >= sc.length ? 12 : 0));
    const fifth = NOTE(root, sc[(degree + 4) % sc.length] + (degree + 4 >= sc.length ? 12 : 0));

    const V = VOICES;
    switch (m.style) {
      case 'bigband':
        if (six === 0 || six === 6 || six === 10) V.brassStab(this, t, [chordRoot * 2, third * 2, fifth * 2], dest, 0.055);
        V.walkingBass(this, t, step, chordRoot / 2, sc, root, dest);
        V.brushKit(this, t, step, dest);
        if (bar % 2 === 1 && six === 12) V.clarinet(this, t, fifth * 2, dest);
        break;
      case 'surfpop':
        if (six % 2 === 0) V.twangGuitar(this, t, [chordRoot * 2, third * 2][((step / 2) | 0) % 2], dest);
        if (six === 0 || six === 8) V.organ(this, t, [chordRoot, third, fifth], dest);
        V.bass(this, t, step, chordRoot / 2, dest);
        V.kit(this, t, step, dest, 0.5);
        if (six === 4 || six === 12) V.handclap(this, t, dest);
        break;
      case 'synthwave':
        V.arpBass(this, t, step, chordRoot / 2, sc, root, dest);
        if (six === 0) V.sawPad(this, t, [chordRoot, third, fifth], dest, 60 / m.bpm * 4);
        if (six === 4 || six === 12) V.gatedSnare(this, t, dest);
        if (six % 4 === 0) V.kit(this, t, step, dest, 0.6);
        if (bar % 4 === 3 && six === 14) V.brassStab(this, t, [chordRoot * 2, fifth * 2], dest, 0.04);
        break;
      case 'popPunk':
        if (six % 2 === 0) V.palmMute(this, t, chordRoot, dest);
        if (six === 0 || six === 8) V.distGuitar(this, t, [chordRoot, fifth], dest);
        V.bass(this, t, step, chordRoot / 2, dest);
        V.kit(this, t, step, dest, 0.8);
        break;
      case 'lofi':
        if (six === 0 || six === 7) V.rhodes(this, t, [chordRoot, third, fifth], dest);
        if (six === 0 || six === 10) V.subBass(this, t, chordRoot / 2, dest);
        V.dustKit(this, t, step, dest);
        break;
      case 'ambient':
        if (step % 32 === 0) V.glassPad(this, t, [chordRoot, third, fifth], dest, 60 / m.bpm * 8);
        if (step % 16 === 8) V.bellPluck(this, t, fifth * 2, dest);
        if (step % 64 === 0) V.subDrone(this, t, chordRoot / 4, dest, 60 / m.bpm * 16);
        break;
      default: break;
    }
  }

  /* ══════════════════════════ engines ══════════════════════════ */

  /** A continuous engine tone that tracks the nearest vehicle. */
  updateTraffic(nearest, camPos, camYaw, era) {
    if (!this.ready || !era) return;
    if (!this._engine) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const filt = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      const nz = ctx.createBufferSource();
      const nzFilt = ctx.createBiquadFilter();
      const nzGain = ctx.createGain();
      osc.type = 'sawtooth'; osc2.type = 'square';
      filt.type = 'lowpass'; filt.Q.value = 4;
      nz.buffer = this.noiseBrown; nz.loop = true;
      nzFilt.type = 'bandpass'; nzFilt.frequency.value = 900; nzFilt.Q.value = 0.7;
      osc.connect(filt); osc2.connect(filt);
      nz.connect(nzFilt); nzFilt.connect(nzGain); nzGain.connect(gain);
      filt.connect(gain);
      if (pan) { gain.connect(pan); pan.connect(this.ambBus); } else gain.connect(this.ambBus);
      gain.gain.value = 0;
      osc.start(); osc2.start(); nz.start();
      this._engine = { osc, osc2, filt, gain, pan, nzGain };
    }
    const e = this._engine, t = this.now;
    if (!nearest) { e.gain.gain.setTargetAtTime(0, t, 0.3); return; }
    const tone = era.audio.trafficTone;
    const dist = nearest.dist;
    const atten = clamp01(1 - dist / 48);
    const speed = clamp01((nearest.v.cur || 0) / 14);
    const f = tone.engineHz * (0.7 + speed * (tone.electric ? 2.4 : 1.1));
    e.osc.frequency.setTargetAtTime(f, t, 0.12);
    e.osc2.frequency.setTargetAtTime(f * (tone.electric ? 2.01 : 0.5), t, 0.12);
    e.filt.frequency.setTargetAtTime(tone.engineHz * tone.engineQ * (1 + speed), t, 0.15);
    e.nzGain.gain.setTargetAtTime(tone.tireGain * speed * 0.6, t, 0.2);
    e.gain.gain.setTargetAtTime(atten * atten * 0.14, t, 0.2);
    if (e.pan) {
      const p = nearest.v.model.position;
      const a = Math.atan2(p.x - camPos.x, p.z - camPos.z) - camYaw;
      e.pan.pan.value = clamp(-Math.sin(a), -1, 1) * 0.7;
    }
  }

  /* ══════════════════════════ the warp ══════════════════════════ */

  warpStart(fromEra, toEra, duration) {
    if (!this.ready) return;
    const t = this.now;
    const ctx = this.ctx;

    // Duck everything, then blow it back open.
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t);
    this.musicBus.gain.linearRampToValueAtTime(0.0001, t + duration * 0.35);
    this.musicBus.gain.linearRampToValueAtTime(this.musicVolume, t + duration * 1.05);
    this.ambBus.gain.setValueAtTime(this.ambBus.gain.value, t);
    this.ambBus.gain.linearRampToValueAtTime(0.12, t + duration * 0.4);
    this.ambBus.gain.linearRampToValueAtTime(0.9, t + duration * 1.05);

    /* Riser: noise sweeping up through a resonant filter. */
    const src = ctx.createBufferSource();
    src.buffer = this.noiseWhite; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 6;
    bp.frequency.setValueAtTime(140, t);
    bp.frequency.exponentialRampToValueAtTime(7200, t + duration * 0.62);
    bp.frequency.exponentialRampToValueAtTime(220, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.24, t + duration * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration * 1.0);
    src.connect(bp); bp.connect(g); g.connect(this.comp); g.connect(this.verb);
    src.start(t); src.stop(t + duration + 0.2);

    /* Pitch-bent tone: the sense of years going past. */
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'sawtooth';
    const dir = toEra.year > fromEra.year ? 1 : -1;
    o.frequency.setValueAtTime(dir > 0 ? 60 : 620, t);
    o.frequency.exponentialRampToValueAtTime(dir > 0 ? 620 : 60, t + duration * 0.7);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.06, t + duration * 0.4);
    og.gain.exponentialRampToValueAtTime(0.0001, t + duration * 0.92);
    o.connect(og); og.connect(this.comp);
    o.start(t); o.stop(t + duration + 0.1);

    /* Impact at the moment the two eras interlock. */
    const boomT = t + duration * 0.5;
    const bo = ctx.createOscillator(), bg = ctx.createGain();
    bo.type = 'sine';
    bo.frequency.setValueAtTime(120, boomT);
    bo.frequency.exponentialRampToValueAtTime(28, boomT + 0.9);
    bg.gain.setValueAtTime(0.34, boomT);
    bg.gain.exponentialRampToValueAtTime(0.0001, boomT + 1.2);
    bo.connect(bg); bg.connect(this.comp);
    bo.start(boomT); bo.stop(boomT + 1.3);

    // Swap the bed and the band halfway, under the noise.
    clearTimeout(this._warpSwap);
    this._warpSwap = setTimeout(() => this.setEra(toEra, false), duration * 480);
  }

  warpEnd(era) {
    if (!this.ready) return;
    this.setEra(era, false);
  }

  dispose() {
    for (const id of this._layerTimers) clearTimeout(id);
    clearInterval(this._schedTimer);
    this._schedTimer = null;
    this.ctx?.close?.();
  }
}

/* ══════════════════════════ music voices ══════════════════════════ */

const VOICES = {
  brassStab(a, t, freqs, dest, gain = 0.05) {
    for (const f of freqs) {
      const { o, g } = a._osc('sawtooth', f, t, 0.26, gain, dest, 4);
      const filt = a.ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(f * 6, t);
      filt.frequency.exponentialRampToValueAtTime(f * 2, t + 0.24);
      g.disconnect(); g.connect(filt); filt.connect(dest);
    }
  },
  walkingBass(a, t, step, root, scale, base, dest) {
    if (step % 4 !== 0) return;
    const deg = [0, 4, 2, 4][(step / 4) % 4];
    const f = NOTE(base / 2, scale[deg % scale.length]);
    a._osc('triangle', f, t, 0.24, 0.09, dest);
  },
  brushKit(a, t, step, dest) {
    const six = step % 16;
    if (six % 2 === 0) a._noise(t, 0.075, 0.022, 'highpass', 5200, 0.6, dest);
    if (six === 4 || six === 12) a._noise(t, 0.12, 0.05, 'bandpass', 2100, 0.9, dest);
    if (six === 0 || six === 8) a._osc('sine', 62, t, 0.16, 0.10, dest);
  },
  clarinet(a, t, f, dest) {
    const { o, g } = a._osc('square', f, t, 0.55, 0.032, dest);
    const lfo = a.ctx.createOscillator(), lg = a.ctx.createGain();
    lfo.frequency.value = 5.2; lg.gain.value = 4;
    lfo.connect(lg); lg.connect(o.detune);
    lfo.start(t); lfo.stop(t + 0.6);
  },
  twangGuitar(a, t, f, dest) {
    const { o, g } = a._osc('sawtooth', f, t, 0.2, 0.045, dest);
    const filt = a.ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = f * 3; filt.Q.value = 3;
    g.disconnect(); g.connect(filt); filt.connect(dest);
    // Slapback delay — the surf sound is mostly the delay.
    const d = a.ctx.createDelay(); d.delayTime.value = 0.11;
    const dg = a.ctx.createGain(); dg.gain.value = 0.3;
    filt.connect(d); d.connect(dg); dg.connect(dest); dg.connect(d);
  },
  organ(a, t, freqs, dest) {
    for (const f of freqs) {
      a._osc('sine', f, t, 0.5, 0.03, dest);
      a._osc('sine', f * 2, t, 0.5, 0.016, dest);
      a._osc('sine', f * 3, t, 0.5, 0.008, dest);
    }
  },
  bass(a, t, step, f, dest) {
    if (step % 4 !== 0) return;
    a._osc('triangle', f, t, 0.22, 0.085, dest);
  },
  kit(a, t, step, dest, amt = 0.6) {
    const six = step % 16;
    if (six === 0 || six === 8 || six === 10) a._osc('sine', 58, t, 0.15, 0.11 * amt, dest);
    if (six === 4 || six === 12) a._noise(t, 0.14, 0.075 * amt, 'bandpass', 1900, 0.9, dest);
    if (six % 2 === 0) a._noise(t, 0.05, 0.02 * amt, 'highpass', 7000, 0.6, dest);
  },
  handclap(a, t, dest) {
    for (let i = 0; i < 3; i++) a._noise(t + i * 0.011, 0.06, 0.03, 'bandpass', 1500, 1.4, dest);
  },
  arpBass(a, t, step, root, scale, base, dest) {
    const deg = [0, 2, 4, 2, 5, 4, 2, 0][step % 8];
    const f = NOTE(base / 2, scale[deg % scale.length]);
    const { o, g } = a._osc('square', f, t, 0.13, 0.055, dest);
    const filt = a.ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.Q.value = 8;
    filt.frequency.setValueAtTime(f * 8, t);
    filt.frequency.exponentialRampToValueAtTime(f * 2.2, t + 0.12);
    g.disconnect(); g.connect(filt); filt.connect(dest);
  },
  sawPad(a, t, freqs, dest, dur) {
    for (const f of freqs) {
      for (const det of [-7, 0, 7]) {
        const { o, g } = a._osc('sawtooth', f, t, dur, 0.018, dest, det);
        const filt = a.ctx.createBiquadFilter();
        filt.type = 'lowpass'; filt.Q.value = 2;
        filt.frequency.setValueAtTime(f * 1.6, t);
        filt.frequency.linearRampToValueAtTime(f * 5, t + dur * 0.5);
        filt.frequency.linearRampToValueAtTime(f * 1.6, t + dur);
        g.disconnect(); g.connect(filt); filt.connect(dest);
      }
    }
  },
  gatedSnare(a, t, dest) {
    a._noise(t, 0.19, 0.09, 'bandpass', 1700, 0.8, dest);
    const { g } = a._noise(t, 0.34, 0.05, 'highpass', 900, 0.5, a.verb);
  },
  distGuitar(a, t, freqs, dest) {
    for (const f of freqs) {
      const { o, g } = a._osc('sawtooth', f, t, 0.4, 0.04, dest);
      const shaper = a.ctx.createWaveShaper();
      const curve = new Float32Array(129);
      for (let i = 0; i < 129; i++) { const x = (i / 64) - 1; curve[i] = Math.tanh(x * 4); }
      shaper.curve = curve;
      const filt = a.ctx.createBiquadFilter();
      filt.type = 'lowpass'; filt.frequency.value = 2600;
      g.disconnect(); g.connect(shaper); shaper.connect(filt); filt.connect(dest);
    }
  },
  palmMute(a, t, f, dest) {
    const { o, g } = a._osc('sawtooth', f / 2, t, 0.09, 0.05, dest);
    const filt = a.ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 1400;
    g.disconnect(); g.connect(filt); filt.connect(dest);
  },
  rhodes(a, t, freqs, dest) {
    for (const f of freqs) {
      const car = a.ctx.createOscillator(), mod = a.ctx.createOscillator();
      const mg = a.ctx.createGain(), g = a.ctx.createGain();
      car.type = 'sine'; mod.type = 'sine';
      car.frequency.value = f; mod.frequency.value = f * 2.01;
      mg.gain.setValueAtTime(f * 1.6, t);
      mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.5);
      mod.connect(mg); mg.connect(car.frequency);
      car.connect(g); g.connect(dest);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      car.start(t); car.stop(t + 1.4); mod.start(t); mod.stop(t + 1.4);
    }
  },
  subBass(a, t, f, dest) { a._osc('sine', f, t, 0.7, 0.11, dest); },
  dustKit(a, t, step, dest) {
    const six = step % 16;
    if (six === 0 || six === 9) a._osc('sine', 52, t, 0.22, 0.10, dest);
    if (six === 4 || six === 12) a._noise(t, 0.16, 0.05, 'bandpass', 1500, 0.7, dest);
    if (six % 4 === 2) a._noise(t, 0.04, 0.012, 'highpass', 6000, 0.5, dest);
    if (Math.random() < 0.12) a._noise(t, 0.01, 0.02, 'highpass', 3000, 0.4, dest);  // vinyl crackle
  },
  glassPad(a, t, freqs, dest, dur) {
    for (const f of freqs) {
      for (const m of [1, 2, 3.01]) {
        const { o, g } = a._osc('sine', f * m, t, dur, 0.02 / m, dest);
        const lfo = a.ctx.createOscillator(), lg = a.ctx.createGain();
        lfo.frequency.value = 0.14 + Math.random() * 0.2;
        lg.gain.value = 0.008 / m;
        lfo.connect(lg); lg.connect(g.gain);
        lfo.start(t); lfo.stop(t + dur);
      }
    }
  },
  bellPluck(a, t, f, dest) {
    a._osc('sine', f, t, 1.6, 0.035, a.verb);
    a._osc('sine', f * 2.76, t, 0.9, 0.012, a.verb);
    a._osc('sine', f * 5.4, t, 0.4, 0.005, dest);
  },
  subDrone(a, t, f, dest, dur) {
    a._osc('sine', f, t, dur, 0.05, dest);
    a._osc('sine', f * 1.5, t, dur, 0.018, dest);
  },
};

const PROGRESSIONS = {
  bigband: [0, 3, 4, 0],
  surfpop: [0, 5, 3, 4],
  synthwave: [0, 5, 3, 4],
  popPunk: [0, 4, 5, 3],
  lofi: [0, 3, 5, 4],
  ambient: [0, 5, 3, 5],
};

/* ══════════════════════════ ambience layers ══════════════════════════ */

const LAYERS = {
  trolleyBell: { every: [18, 55], play(a, t) {
    for (let i = 0; i < 2; i++) {
      a._osc('sine', 1180, t + i * 0.22, 0.7, 0.05, a.verb);
      a._osc('sine', 2360, t + i * 0.22, 0.35, 0.02, a.verb);
    }
  } },
  propPlane: { every: [45, 120], play(a, t) {
    const src = a.ctx.createBufferSource(); src.buffer = a.noiseBrown; src.loop = true;
    const f = a.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 260; f.Q.value = 2.2;
    const g = a.ctx.createGain(); const pan = a.ctx.createStereoPanner?.();
    const lfo = a.ctx.createOscillator(), lg = a.ctx.createGain();
    lfo.frequency.value = 17; lg.gain.value = 0.35;
    lfo.connect(lg); lg.connect(g.gain);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.055, t + 4);
    g.gain.linearRampToValueAtTime(0.0001, t + 11);
    src.connect(f); f.connect(g);
    if (pan) { g.connect(pan); pan.connect(a.ambBus); pan.pan.setValueAtTime(-0.9, t); pan.pan.linearRampToValueAtTime(0.9, t + 11); }
    else g.connect(a.ambBus);
    src.start(t); src.stop(t + 12); lfo.start(t); lfo.stop(t + 12);
  } },
  newsboy: { every: [30, 90], play(a, t) {
    // A shouted syllable pair, formant-ish, deliberately indistinct.
    for (let i = 0; i < 3; i++) {
      const f = 200 + Math.random() * 90;
      const { o, g } = a._osc('sawtooth', f, t + i * 0.26, 0.2, 0.035, a.verb);
      const bp = a.ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = 800 + Math.random() * 700; bp.Q.value = 5;
      g.disconnect(); g.connect(bp); bp.connect(a.verb); bp.connect(a.ambBus);
    }
  } },
  factoryWhistle: { every: [90, 240], play(a, t) {
    a._osc('sawtooth', 330, t, 2.4, 0.03, a.verb);
    a._osc('sawtooth', 392, t, 2.4, 0.026, a.verb);
  } },
  crowdMurmurLow: { every: [7, 16], play(a, t) {
    a._noise(t, 2.6, 0.014, 'bandpass', 420, 1.1, a.ambBus, a.noisePink);
  } },
  crowdMurmur: { every: [5, 12], play(a, t) {
    a._noise(t, 2.2, 0.02, 'bandpass', 560, 1.0, a.ambBus, a.noisePink);
  } },
  busAir: { every: [22, 70], play(a, t) {
    a._noise(t, 0.55, 0.07, 'highpass', 2400, 0.7, a.ambBus);
    a._noise(t + 0.5, 0.3, 0.03, 'bandpass', 900, 0.9, a.ambBus);
  } },
  jetHigh: { every: [60, 160], play(a, t) {
    a._noise(t, 9, 0.022, 'bandpass', 1400, 0.5, a.ambBus, a.noisePink);
  } },
  radioSurf: { every: [40, 110], play(a, t) {
    a._noise(t, 1.6, 0.012, 'bandpass', 2400, 3, a.ambBus);
  } },
  construction: { every: [12, 40], play(a, t) {
    for (let i = 0; i < 4 + Math.floor(Math.random() * 5); i++) {
      a._noise(t + i * 0.17, 0.07, 0.045, 'bandpass', 1800 + Math.random() * 900, 2.4, a.verb);
    }
  } },
  arcadeBleeps: { every: [4, 13], play(a, t) {
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const f = 300 + Math.random() * 900;
      a._osc('square', f, t + i * 0.09, 0.07, 0.018, a.ambBus);
    }
  } },
  boombox: { every: [20, 60], play(a, t) {
    for (let i = 0; i < 8; i++) {
      a._osc('sine', 55, t + i * 0.42, 0.2, 0.05, a.ambBus);
      if (i % 2 === 1) a._noise(t + i * 0.42, 0.12, 0.028, 'bandpass', 1800, 0.9, a.ambBus);
    }
  } },
  carAlarm: { every: [70, 200], play(a, t) {
    for (let i = 0; i < 9; i++) a._osc('square', i % 2 ? 880 : 660, t + i * 0.19, 0.16, 0.03, a.verb);
  } },
  steamHiss: { every: [10, 26], play(a, t) {
    a._noise(t, 3.2, 0.03, 'highpass', 3200, 0.5, a.ambBus);
  } },
  subwayRumble: { every: [35, 100], play(a, t) {
    const { g } = a._noise(t, 6, 0.055, 'lowpass', 180, 1.4, a.ambBus, a.noiseBrown);
  } },
  sirenDistant: { every: [50, 150], play(a, t) {
    const { o } = a._osc('sine', 700, t, 5, 0.022, a.verb);
    for (let i = 0; i < 10; i++) {
      o.frequency.setValueAtTime(i % 2 ? 700 : 980, t + i * 0.5);
    }
  } },
  rain: { every: [12, 12], play(a, t) {
    a._noise(t, 13, 0.05, 'highpass', 1600, 0.4, a.ambBus, a.noisePink);
  } },
  ringtonePoly: { every: [25, 80], play(a, t) {
    const mel = [659, 784, 880, 784, 659, 587];
    mel.forEach((f, i) => a._osc('square', f, t + i * 0.14, 0.12, 0.022, a.ambBus));
  } },
  skateboard: { every: [30, 90], play(a, t) {
    for (let i = 0; i < 14; i++) a._noise(t + i * 0.22, 0.05, 0.03, 'bandpass', 260, 1.6, a.ambBus);
  } },
  hybridWhine: { every: [18, 55], play(a, t) {
    const { o } = a._osc('sine', 900, t, 3.4, 0.012, a.ambBus);
    o.frequency.linearRampToValueAtTime(1500, t + 1.7);
    o.frequency.linearRampToValueAtTime(700, t + 3.4);
  } },
  evWhine: { every: [10, 34], play(a, t) {
    const { o } = a._osc('triangle', 620, t, 3.0, 0.016, a.ambBus);
    o.frequency.linearRampToValueAtTime(1300, t + 1.6);
    o.frequency.linearRampToValueAtTime(500, t + 3.0);
  } },
  escooterHum: { every: [14, 44], play(a, t) {
    const { o } = a._osc('sawtooth', 240, t, 2.4, 0.012, a.ambBus);
    o.frequency.linearRampToValueAtTime(420, t + 1.2);
  } },
  notification: { every: [16, 50], play(a, t) {
    a._osc('sine', 1320, t, 0.09, 0.02, a.ambBus);
    a._osc('sine', 1760, t + 0.08, 0.13, 0.016, a.ambBus);
  } },
  espressoMachine: { every: [22, 70], play(a, t) {
    a._noise(t, 2.4, 0.035, 'highpass', 4200, 0.6, a.ambBus);
    a._noise(t + 2.4, 0.9, 0.05, 'bandpass', 2200, 1.2, a.ambBus);
  } },
  droneFar: { every: [30, 90], play(a, t) {
    const { o } = a._osc('sawtooth', 190, t, 6, 0.014, a.ambBus);
    o.frequency.linearRampToValueAtTime(250, t + 3);
    o.frequency.linearRampToValueAtTime(180, t + 6);
  } },
  droneHum: { every: [8, 24], play(a, t) {
    const { o } = a._osc('triangle', 320, t, 4, 0.018, a.ambBus);
    o.frequency.linearRampToValueAtTime(410, t + 2);
    o.frequency.linearRampToValueAtTime(300, t + 4);
  } },
  airTaxi: { every: [40, 110], play(a, t) {
    const { g } = a._noise(t, 8, 0.03, 'bandpass', 700, 1.2, a.ambBus, a.noisePink);
    a._osc('sine', 140, t, 8, 0.012, a.ambBus);
  } },
  arChime: { every: [12, 40], play(a, t) {
    a._osc('sine', 1046, t, 0.6, 0.016, a.verb);
    a._osc('sine', 1568, t + 0.11, 0.7, 0.011, a.verb);
  } },
  birdSynth: { every: [9, 30], play(a, t) {
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const { o } = a._osc('sine', 2200 + Math.random() * 900, t + i * 0.13, 0.09, 0.014, a.verb);
      o.frequency.linearRampToValueAtTime(1500 + Math.random() * 1200, t + i * 0.13 + 0.09);
    }
  } },
  mistHiss: { every: [16, 44], play(a, t) {
    a._noise(t, 2.8, 0.022, 'highpass', 5200, 0.5, a.ambBus);
  } },
};

export { LAYERS, VOICES };
