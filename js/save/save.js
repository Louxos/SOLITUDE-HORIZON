/**
 * save.js — Sauvegarde/chargement (localStorage + IndexedDB en secours),
 * autosave périodique et à la sortie.
 */

import { SAVE_KEY } from '../core/config.js';
import { bus } from '../core/events.js';

const DB_NAME = 'solitude-horizon';
const STORE = 'saves';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('IndexedDB indisponible')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class SaveManager {
  constructor(world) {
    this.world = world;
    this.lastSave = 0;
    this.autosaveInterval = 120;   // secondes
    this.timer = 0;
    this.saving = false;
    window.addEventListener('beforeunload', () => {
      try { this.saveSync(); } catch (e) { /* ignore */ }
    });
  }

  static hasSave() {
    return !!localStorage.getItem(SAVE_KEY);
  }

  static async loadData() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (err) {
      console.warn('[save] localStorage illisible', err);
    }
    try {
      const data = await idbGet(SAVE_KEY);
      if (data) return data;
    } catch (err) { /* IndexedDB absente */ }
    return null;
  }

  static async deleteSave() {
    localStorage.removeItem(SAVE_KEY);
    try { await idbPut(SAVE_KEY, undefined); } catch (e) { /* ignore */ }
  }

  serialize() {
    const data = this.world.toJSON();
    data.savedAt = Date.now();
    return data;
  }

  saveSync() {
    const data = this.serialize();
    const json = JSON.stringify(data);
    localStorage.setItem(SAVE_KEY, json);
    this.lastSave = performance.now();
    return data;
  }

  async save(reason = 'manuel') {
    if (this.saving) return;
    this.saving = true;
    try {
      const data = this.saveSync();
      try { await idbPut(SAVE_KEY, data); } catch (e) { /* secours facultatif */ }
      bus.emit('save:done', { reason, at: data.savedAt });
      if (reason !== 'auto') bus.emit('notify', { text: 'Partie sauvegardée.', kind: 'system' });
      else bus.emit('notify', { text: 'Sauvegarde automatique', kind: 'system' });
    } catch (err) {
      console.error('[save] échec', err);
      bus.emit('notify', { text: 'Échec de la sauvegarde (stockage plein ?)', kind: 'warn' });
    } finally {
      this.saving = false;
    }
  }

  update(dt) {
    this.timer += dt;
    if (this.timer >= this.autosaveInterval) {
      this.timer = 0;
      this.save('auto');
    }
  }
}
