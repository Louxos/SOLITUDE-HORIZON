/**
 * inventory.js — Inventaire à slots + poids (joueur, coffres, conteneurs).
 */

import { ITEMS, itemDef } from './items.js';
import { bus } from '../core/events.js';

export class Inventory {
  constructor({ slots = 24, maxWeight = 38, id = 'inv', name = 'Inventaire' } = {}) {
    this.slots = slots;
    this.maxWeight = maxWeight;
    this.id = id;
    this.name = name;
    this.items = [];   // {id, count, condition?}
  }

  get weight() {
    let w = 0;
    for (const it of this.items) w += itemDef(it.id).weight * it.count;
    return Math.round(w * 100) / 100;
  }

  get used() { return this.items.length; }
  get isFull() { return this.items.length >= this.slots; }

  count(id) {
    let n = 0;
    for (const it of this.items) if (it.id === id) n += it.count;
    return n;
  }

  has(id, n = 1) { return this.count(id) >= n; }

  /** Cherche un objet possédant une propriété (ex: tool='wrench'). */
  findByProp(prop, value) {
    return this.items.find((it) => {
      const d = itemDef(it.id);
      return value === undefined ? d[prop] !== undefined : d[prop] === value;
    }) || null;
  }

  canAccept(id, count = 1) {
    const def = itemDef(id);
    if (this.weight + def.weight * count > this.maxWeight + 0.001) return { ok: false, reason: 'poids' };
    // essai d'empilement
    let remaining = count;
    for (const it of this.items) {
      if (it.id === id && it.condition === undefined) {
        remaining -= Math.max(0, def.stack - it.count);
        if (remaining <= 0) return { ok: true };
      }
    }
    const needed = Math.ceil(remaining / def.stack);
    if (this.items.length + needed > this.slots) return { ok: false, reason: 'place' };
    return { ok: true };
  }

  /** @returns {number} quantité réellement ajoutée */
  add(id, count = 1, condition) {
    const def = itemDef(id);
    let remaining = count;
    if (condition === undefined) {
      for (const it of this.items) {
        if (it.id !== id || it.condition !== undefined) continue;
        const space = def.stack - it.count;
        if (space <= 0) continue;
        const take = Math.min(space, remaining);
        if (this.weight + def.weight * take > this.maxWeight + 0.001) break;
        it.count += take;
        remaining -= take;
        if (remaining <= 0) break;
      }
    }
    while (remaining > 0 && this.items.length < this.slots) {
      const take = condition !== undefined ? 1 : Math.min(def.stack, remaining);
      if (this.weight + def.weight * take > this.maxWeight + 0.001) break;
      const entry = { id, count: take };
      if (condition !== undefined) entry.condition = condition;
      this.items.push(entry);
      remaining -= take;
    }
    const added = count - remaining;
    if (added > 0) bus.emit('inventory:changed', { inv: this, id, delta: added });
    return added;
  }

  addEntry(entry) { return this.add(entry.id, entry.count ?? 1, entry.condition); }

  /** Retire n exemplaires ; @returns {number} retiré */
  remove(id, count = 1) {
    let remaining = count;
    for (let i = this.items.length - 1; i >= 0 && remaining > 0; i--) {
      const it = this.items[i];
      if (it.id !== id) continue;
      const take = Math.min(it.count, remaining);
      it.count -= take;
      remaining -= take;
      if (it.count <= 0) this.items.splice(i, 1);
    }
    const removed = count - remaining;
    if (removed > 0) bus.emit('inventory:changed', { inv: this, id, delta: -removed });
    return removed;
  }

  removeAt(index, count = 1) {
    const it = this.items[index];
    if (!it) return null;
    const take = Math.min(it.count, count);
    it.count -= take;
    const out = { id: it.id, count: take, condition: it.condition };
    if (it.count <= 0) this.items.splice(index, 1);
    bus.emit('inventory:changed', { inv: this, id: out.id, delta: -take });
    return out;
  }

  /** Transfère un slot vers un autre inventaire. */
  transferTo(other, index, count = Infinity) {
    const it = this.items[index];
    if (!it) return 0;
    const want = Math.min(it.count, count);
    const check = other.canAccept(it.id, want);
    if (!check.ok) {
      bus.emit('notify', { text: check.reason === 'poids' ? 'Trop lourd.' : 'Plus de place.', kind: 'warn' });
      return 0;
    }
    const moved = other.add(it.id, want, it.condition);
    if (moved > 0) this.removeAt(index, moved);
    return moved;
  }

  /** Détériore un outil ; renvoie true s'il casse. */
  damageTool(index, amount = 0.08) {
    const it = this.items[index];
    if (!it || it.condition === undefined) return false;
    it.condition = Math.max(0, Math.round((it.condition - amount) * 100) / 100);
    if (it.condition <= 0.02) {
      bus.emit('notify', { text: `${itemDef(it.id).name} : hors d'usage.`, kind: 'warn' });
      this.items.splice(index, 1);
      bus.emit('inventory:changed', { inv: this });
      return true;
    }
    bus.emit('inventory:changed', { inv: this });
    return false;
  }

  sort() {
    const order = Object.values(ITEMS);
    this.items.sort((a, b) => {
      const da = itemDef(a.id), db = itemDef(b.id);
      if (da.cat !== db.cat) return da.cat.localeCompare(db.cat);
      return da.name.localeCompare(db.name);
    });
    bus.emit('inventory:changed', { inv: this });
  }

  toJSON() { return { slots: this.slots, maxWeight: this.maxWeight, items: this.items }; }

  fromJSON(data) {
    if (!data) return;
    this.slots = data.slots ?? this.slots;
    this.maxWeight = data.maxWeight ?? this.maxWeight;
    this.items = (data.items || []).filter((it) => ITEMS[it.id]);
    bus.emit('inventory:changed', { inv: this });
  }
}
