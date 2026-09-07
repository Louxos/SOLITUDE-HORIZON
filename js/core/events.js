/**
 * events.js — Bus d'événements minimal partagé par tous les systèmes.
 * Permet de relier météo -> audio, inventaire -> HUD, etc. sans couplage dur.
 */

class EventBus {
  constructor() { this.map = new Map(); }

  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (...a) => { off(); fn(...a); });
    return off;
  }

  off(type, fn) {
    const set = this.map.get(type);
    if (set) set.delete(fn);
  }

  emit(type, payload) {
    const set = this.map.get(type);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try { fn(payload); }
      catch (err) { console.error(`[events] handler error on "${type}"`, err); }
    }
  }
}

export const bus = new EventBus();
