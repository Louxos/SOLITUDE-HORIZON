/**
 * rng.js — Aléatoire déterministe.
 * Aucune utilisation de Math.random() pour la génération du monde :
 * tout dérive de WORLD_SEED via des hash entiers, donc identique pour tous.
 */

/** Hash entier 32 bits (variante de xxhash/murmur finalizer). */
export function hashInt(...values) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < values.length; i++) {
    let v = values[i] | 0;
    h ^= v & 0xff;         h = Math.imul(h, 16777619);
    h ^= (v >>> 8) & 0xff; h = Math.imul(h, 16777619);
    h ^= (v >>> 16) & 0xff; h = Math.imul(h, 16777619);
    h ^= (v >>> 24) & 0xff; h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15; h = Math.imul(h, 2246822507);
  h ^= h >>> 13; h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash de chaîne -> entier. */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Générateur mulberry32 : rapide, déterministe, suffisant pour du gameplay. */
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  const rng = function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (min, max) => min + rng() * (max - min);
  rng.int = (min, max) => Math.floor(min + rng() * (max - min + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  rng.chance = (p) => rng() < p;
  /** Choix pondéré : items = [{w, ...}] */
  rng.weighted = (items) => {
    let total = 0;
    for (const it of items) total += it.w;
    let r = rng() * total;
    for (const it of items) { r -= it.w; if (r <= 0) return it; }
    return items[items.length - 1];
  };
  return rng;
}

/** RNG dérivé d'une position monde + sel : stable quel que soit l'ordre de génération. */
export function rngAt(seed, x, z, salt = 0) {
  return makeRng(hashInt(seed, Math.round(x), Math.round(z), salt));
}

/** Valeur pseudo-aléatoire [0,1[ pour une clé entière. */
export function valueAt(seed, ...keys) {
  return hashInt(seed, ...keys) / 4294967296;
}
