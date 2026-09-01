/**
 * settings.js — Paramètres persistants (graphismes, audio, contrôles).
 */

import { QUALITY_PRESETS, SETTINGS_KEY } from './config.js';
import { bus } from './events.js';

export const DEFAULT_BINDINGS = {
  forward: ['KeyZ', 'KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyQ', 'KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  run: ['ShiftLeft', 'ShiftRight'],
  crouch: ['ControlLeft', 'KeyC'],
  interact: ['KeyE'],
  inventory: ['KeyI', 'Tab'],
  map: ['KeyM'],
  flashlight: ['KeyF'],
  menu: ['Escape'],
  drop: ['KeyG'],
  repair: ['KeyR'],
  debug: ['F3'],
};

const DEFAULTS = {
  quality: 'medium',
  autoQuality: true,
  fov: 74,
  masterVolume: 0.85,
  ambienceVolume: 0.9,
  sfxVolume: 1.0,
  headBob: true,
  crosshair: true,
  invertY: false,
  mouseSensitivity: 1.0,
  hudOpacity: 0.92,
  subtitles: true,
  bindings: DEFAULT_BINDINGS,
};

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

class Settings {
  constructor() {
    this.data = deepClone(DEFAULTS);
    this.load();
  }

  get preset() { return QUALITY_PRESETS[this.data.quality] || QUALITY_PRESETS.medium; }

  get(key) { return this.data[key]; }

  set(key, value) {
    this.data[key] = value;
    this.save();
    bus.emit('settings:changed', { key, value, settings: this });
  }

  setBinding(action, codes) {
    this.data.bindings[action] = codes;
    this.save();
    bus.emit('settings:changed', { key: 'bindings', value: this.data.bindings, settings: this });
  }

  resetBindings() {
    this.data.bindings = deepClone(DEFAULT_BINDINGS);
    this.save();
    bus.emit('settings:changed', { key: 'bindings', value: this.data.bindings, settings: this });
  }

  load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      this.data = Object.assign(deepClone(DEFAULTS), parsed);
      this.data.bindings = Object.assign(deepClone(DEFAULT_BINDINGS), parsed.bindings || {});
    } catch (err) {
      console.warn('[settings] chargement impossible, valeurs par défaut', err);
    }
  }

  save() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.data)); }
    catch (err) { console.warn('[settings] sauvegarde impossible', err); }
  }
}

export const settings = new Settings();
