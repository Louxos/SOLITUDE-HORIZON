/**
 * audio.js — Ambiance et effets 100 % procéduraux (Web Audio API).
 * Aucun fichier son : le jeu reste léger et fonctionne hors ligne.
 */

import { bus } from '../core/events.js';
import { settings } from '../core/settings.js';
import { clamp, lerp } from '../core/noise.js';

function makeNoiseBuffer(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;    // bruit brownien léger
    data[i] = last * 3.2 + white * 0.35;
  }
  return buf;
}

export class AudioEngine {
  constructor() {
    this.ready = false;
    this.ctx = null;
    this.enabled = true;
    this.interiorFactor = 0;
    this.underwater = 0;
    this._birdTimer = 0;
    this._crackTimer = 12;
  }

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { console.warn('[audio] Web Audio indisponible'); return; }
    const ctx = new AC();
    this.ctx = ctx;
    this.noiseBuffer = makeNoiseBuffer(ctx, 3);

    this.master = ctx.createGain();
    this.master.gain.value = settings.data.masterVolume;
    this.master.connect(ctx.destination);

    // Filtre global : étouffe le son en intérieur / sous l'eau
    this.globalFilter = ctx.createBiquadFilter();
    this.globalFilter.type = 'lowpass';
    this.globalFilter.frequency.value = 20000;
    this.globalFilter.connect(this.master);

    // Réverbération intérieure : réponse impulsionnelle générée (pièce vide)
    this.reverb = ctx.createConvolver();
    {
      const len = Math.floor(ctx.sampleRate * 1.1);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const t = i / len;
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * (i < 40 ? i / 40 : 1) * 0.5;
        }
      }
      this.reverb.buffer = ir;
    }
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0;
    this.globalFilter.connect(this.reverbSend);
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);

    this.ambienceGain = ctx.createGain();
    this.ambienceGain.gain.value = settings.data.ambienceVolume;
    this.ambienceGain.connect(this.globalFilter);

    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = settings.data.sfxVolume;
    this.sfxGain.connect(this.globalFilter);

    // --- Vent permanent ---
    this.wind = this.makeLoop(this.ambienceGain, 'bandpass', 420, 0.0);
    this.windLfo = ctx.createOscillator();
    this.windLfoGain = ctx.createGain();
    this.windLfo.frequency.value = 0.07;
    this.windLfoGain.gain.value = 260;
    this.windLfo.connect(this.windLfoGain).connect(this.wind.filter.frequency);
    this.windLfo.start();

    // --- Pluie ---
    this.rain = this.makeLoop(this.ambienceGain, 'highpass', 900, 0.0);
    // --- Feuillage ---
    this.leaves = this.makeLoop(this.ambienceGain, 'bandpass', 2600, 0.0);

    this.ready = true;
    bus.emit('audio:ready');
  }

  makeLoop(dest, filterType, freq, gain) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(dest);
    src.start();
    return { src, filter, gain: g };
  }

  resume() {
    if (!this.ready) this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolumes() {
    if (!this.ready) return;
    this.master.gain.value = settings.data.masterVolume;
    this.ambienceGain.gain.value = settings.data.ambienceVolume;
    this.sfxGain.gain.value = settings.data.sfxVolume;
  }

  /** Impulsion de bruit filtrée : base de la plupart des effets. */
  burst({ duration = 0.18, freq = 900, type = 'bandpass', q = 1.2, gain = 0.5, decay = 0.14, pan = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, now + duration + decay);
    let node = src.connect(filter).connect(g);
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p).connect(this.sfxGain);
    } else {
      g.connect(this.sfxGain);
    }
    src.start(now);
    src.stop(now + duration + decay + 0.05);
  }

  tone({ freq = 440, duration = 0.12, gain = 0.12, type = 'sine', slideTo = null }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0006, now + duration);
    osc.connect(g).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + duration + 0.03);
  }

  footstep(surface, running) {
    const g = running ? 0.42 : 0.26;
    const profiles = {
      grass: { freq: 2400, q: 0.9, duration: 0.08, gain: g * 0.7 },
      dirt: { freq: 900, q: 1.1, duration: 0.09, gain: g * 0.8 },
      sand: { freq: 1800, q: 0.8, duration: 0.1, gain: g * 0.7 },
      rock: { freq: 3200, q: 2.2, duration: 0.06, gain: g },
      gravel: { freq: 2800, q: 1.6, duration: 0.09, gain: g },
      asphalt: { freq: 1500, q: 2.6, duration: 0.05, gain: g * 0.9 },
      wood: { freq: 420, q: 3.4, duration: 0.09, gain: g },
      water: { freq: 1200, q: 0.6, duration: 0.16, gain: g * 1.1 },
      metal: { freq: 5200, q: 5, duration: 0.07, gain: g },
    };
    const p = profiles[surface] || profiles.dirt;
    this.burst({ ...p, pan: (Math.random() - 0.5) * 0.5 });
    if (surface === 'water') this.burst({ freq: 600, q: 0.5, duration: 0.22, gain: g * 0.5, type: 'lowpass' });
  }

  thunder(distance) {
    if (!this.ready) return;
    const delay = clamp(distance / 340, 0, 12);
    const near = clamp(1 - distance / 3200, 0, 1);
    setTimeout(() => {
      this.burst({ freq: lerp(90, 260, near), q: 0.5, type: 'lowpass', duration: 0.9 + near * 1.2, gain: 0.25 + near * 0.55, decay: 1.6 });
      setTimeout(() => this.burst({
        freq: lerp(60, 180, near), q: 0.4, type: 'lowpass', duration: 1.6, gain: 0.14 + near * 0.3, decay: 2.4,
      }), 260 + Math.random() * 400);
    }, delay * 1000);
  }

  birdChirp() {
    const base = 1800 + Math.random() * 2200;
    this.tone({ freq: base, slideTo: base * (0.7 + Math.random() * 0.8), duration: 0.09, gain: 0.05, type: 'sine' });
    if (Math.random() < 0.55) {
      setTimeout(() => this.tone({
        freq: base * 1.1, slideTo: base * 0.8, duration: 0.07, gain: 0.04, type: 'sine',
      }), 90 + Math.random() * 120);
    }
  }

  owl() {
    this.tone({ freq: 380, slideTo: 300, duration: 0.5, gain: 0.05, type: 'sine' });
    setTimeout(() => this.tone({ freq: 340, slideTo: 280, duration: 0.6, gain: 0.04, type: 'sine' }), 700);
  }

  sfx(name, opts = {}) {
    if (!this.ready) return;
    switch (name) {
      case 'step': this.footstep(opts.surface || 'dirt', opts.running); break;
      case 'jump': this.burst({ freq: 700, q: 1, duration: 0.06, gain: 0.16 }); break;
      case 'land': this.burst({ freq: 300, q: 1, duration: 0.12, gain: 0.3, type: 'lowpass' }); break;
      case 'hurt': this.tone({ freq: 210, slideTo: 120, duration: 0.28, gain: 0.16, type: 'sawtooth' }); break;
      case 'click': this.tone({ freq: 900, duration: 0.035, gain: 0.05, type: 'square' }); break;
      case 'pickup': this.tone({ freq: 620, slideTo: 880, duration: 0.09, gain: 0.07 }); break;
      case 'open': this.burst({ freq: 320, q: 4, duration: 0.4, gain: 0.22, type: 'bandpass', decay: 0.3 }); break;
      case 'locked': this.burst({ freq: 2200, q: 6, duration: 0.07, gain: 0.2, type: 'bandpass' }); break;
      case 'search': this.burst({ freq: 1400, q: 1.4, duration: 0.22, gain: 0.14 }); break;
      case 'page': this.burst({ freq: 2400, q: 0.7, duration: 0.16, gain: 0.10 }); break;
      case 'repair': this.burst({ freq: 3800, q: 6, duration: 0.09, gain: 0.24, type: 'bandpass' }); break;
      case 'drink': this.burst({ freq: 500, q: 1.2, duration: 0.3, gain: 0.16, type: 'lowpass' }); break;
      case 'eat': this.burst({ freq: 700, q: 1.4, duration: 0.22, gain: 0.14 }); break;
      case 'splash': this.burst({ freq: 900, q: 0.6, duration: 0.32, gain: 0.35 }); break;
      case 'engine_start': this.engineStart(); break;
      case 'engine_fail': this.burst({ freq: 180, q: 2, duration: 0.5, gain: 0.3, type: 'lowpass' }); break;
      case 'discover': this.tone({ freq: 330, slideTo: 495, duration: 1.1, gain: 0.05, type: 'sine' }); break;
      default: break;
    }
  }

  engineStart() {
    this.burst({ freq: 140, q: 1.4, duration: 0.6, gain: 0.3, type: 'lowpass', decay: 0.3 });
  }

  /** Moteur en marche : oscillateur modulé par le régime. */
  setEngine(on, rpm = 0) {
    if (!this.ready) return;
    if (on && !this.engineNode) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const g = ctx.createGain();
      g.gain.value = 0.0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      osc.connect(filter).connect(g).connect(this.sfxGain);
      osc.start();
      this.engineNode = { osc, g, filter };
    }
    if (!on && this.engineNode) {
      this.engineNode.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
      const node = this.engineNode;
      setTimeout(() => { try { node.osc.stop(); } catch (e) { /* déjà arrêté */ } }, 500);
      this.engineNode = null;
    }
    if (on && this.engineNode) {
      this.engineNode.osc.frequency.setTargetAtTime(48 + rpm * 90, this.ctx.currentTime, 0.1);
      this.engineNode.g.gain.setTargetAtTime(0.055 + rpm * 0.05, this.ctx.currentTime, 0.15);
      this.engineNode.filter.frequency.setTargetAtTime(300 + rpm * 900, this.ctx.currentTime, 0.2);
    }
  }

  /**
   * Ambiance dynamique : vent, pluie, feuillages, faune, intérieur, sous l'eau.
   */
  update(dt, ctx) {
    if (!this.ready) return;
    const { wind = 0.3, rain = 0, daylight = 1, forest = 0, interior = 0, underwater = false, engineRpm = null } = ctx;

    const t = this.ctx.currentTime;
    this.wind.gain.gain.setTargetAtTime(0.02 + wind * 0.085, t, 0.6);
    this.wind.filter.frequency.setTargetAtTime(280 + wind * 520, t, 0.8);
    this.rain.gain.gain.setTargetAtTime(rain * 0.16, t, 0.5);
    this.rain.filter.frequency.setTargetAtTime(700 + rain * 1400, t, 0.6);
    this.leaves.gain.gain.setTargetAtTime(forest * wind * 0.05, t, 0.7);

    this.interiorFactor = lerp(this.interiorFactor, interior, clamp(dt * 2.4, 0, 1));
    if (this.reverbSend) {
      this.reverbSend.gain.setTargetAtTime(this.interiorFactor * 0.32, t, 0.5);
    }
    const targetFreq = underwater ? 420 : lerp(20000, 2600, this.interiorFactor);
    this.globalFilter.frequency.setTargetAtTime(targetFreq, t, 0.25);

    // Faune sonore
    this._birdTimer -= dt;
    if (this._birdTimer <= 0) {
      if (daylight > 0.35 && rain < 0.4) {
        this._birdTimer = 0.6 + Math.random() * (3.5 - forest * 1.6);
        if (Math.random() < 0.7 * (0.3 + forest)) this.birdChirp();
      } else if (daylight < 0.25) {
        this._birdTimer = 8 + Math.random() * 22;
        if (Math.random() < 0.4) this.owl();
      } else {
        this._birdTimer = 4;
      }
    }

    // Craquements dans les bâtiments
    if (interior > 0.5) {
      this._crackTimer -= dt;
      if (this._crackTimer <= 0) {
        this._crackTimer = 6 + Math.random() * 20;
        this.burst({ freq: 260 + Math.random() * 400, q: 5, duration: 0.12, gain: 0.08, type: 'bandpass' });
      }
    }

    if (engineRpm !== null) this.setEngine(true, engineRpm);
  }
}

export const audio = new AudioEngine();

bus.on('audio:sfx', (payload) => audio.sfx(payload.name, payload));
bus.on('weather:lightning', ({ distance }) => audio.thunder(distance));
bus.on('settings:changed', () => audio.setVolumes());
