/**
 * terrain.js — Champ d'altitude procédural déterministe + biomes + surfaces.
 *
 * Le terrain est une fonction analytique height(x,z) : elle sert à la fois
 * au maillage (chunks LOD) et à la physique du joueur / des véhicules,
 * ce qui garantit une cohérence parfaite entre visuel et collision.
 */

import { WORLD } from '../core/config.js';
import { Noise, clamp, smoothstep, lerp } from '../core/noise.js';
import { RoadNetwork } from './roads.js';

export const BIOME = {
  DENSE_FOREST: 'Forêt dense',
  SPARSE_FOREST: 'Forêt clairsemée',
  MEADOW: 'Prairie',
  FIELDS: 'Champs abandonnés',
  MOUNTAIN: 'Montagne',
  ROCKY: 'Zone rocheuse',
  LAKESHORE: 'Bord de lac',
  VALLEY: 'Vallée',
  WETLAND: 'Zone humide',
  OVERGROWN: 'Friche envahie',
};

export class Terrain {
  constructor(seed = WORLD.seed) {
    this.seed = seed;
    this.nBase = new Noise(seed);
    this.nMount = new Noise(seed + 101);
    this.nDetail = new Noise(seed + 202);
    this.nBasin = new Noise(seed + 303);
    this.nMoist = new Noise(seed + 404);
    this.nField = new Noise(seed + 505);
    this.roads = new RoadNetwork(seed, (x, z) => this.baseHeight(x, z));
    this._cache = new Map();
    this.pads = new Map();      // grille de cellules -> platages (bâtiments, places)
    this.padCount = 0;
    this.padsFrozen = false;    // vrai une fois la génération terminée (perfs)
  }

  /**
   * Enregistre une zone d'aplanissement (dalle de bâtiment, place de village,
   * carrière…). Le terrain est ramené à `y` dans `inner` puis rejoint
   * naturellement le relief entre `inner` et `outer`.
   * @returns {object} le platage créé (pour d'éventuels ajustements)
   */
  addPad(x, z, y, inner, outer) {
    const pad = { x, z, y, inner, outer };
    const cell = 64;
    const c0x = Math.floor((x - outer) / cell), c1x = Math.floor((x + outer) / cell);
    const c0z = Math.floor((z - outer) / cell), c1z = Math.floor((z + outer) / cell);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const key = cx * 73856093 ^ cz * 19349663;
        let arr = this.pads.get(key);
        if (!arr) { arr = []; this.pads.set(key, arr); }
        arr.push(pad);
      }
    }
    this.padCount++;
    return pad;
  }

  /** Applique les platages : celui de plus forte influence l'emporte. */
  applyPads(x, z, h) {
    if (!this.padCount) return h;
    const arr = this.pads.get(Math.floor(x / 64) * 73856093 ^ Math.floor(z / 64) * 19349663);
    if (!arr) return h;
    let bestW = 0, out = h;
    for (const pad of arr) {
      const d = Math.hypot(x - pad.x, z - pad.z);
      if (d >= pad.outer) continue;
      const w = d <= pad.inner ? 1 : 1 - smoothstep(pad.inner, pad.outer, d);
      if (w > bestW) {
        bestW = w;
        out = pad.y + (h - pad.y) * (1 - w);
      }
    }
    return out;
  }

  /** Relief naturel, sans influence des routes ni des bâtiments. */
  baseHeight(x, z) {
    const cont = this.nBase.fbm(x * 0.00021, z * 0.00021, 4);
    let h = 42 + cont * 56;

    // Collines douces
    h += this.nBase.fbm(x * 0.0013, z * 0.0013, 4) * 15;

    // Montagnes (masque large + crêtes)
    const mMask = smoothstep(0.06, 0.62, this.nMount.fbm(x * 0.00038 + 12.3, z * 0.00038 - 7.1, 3));
    const ridge = Math.pow(this.nMount.ridged(x * 0.00105, z * 0.00105, 5), 1.25);
    h += ridge * 265 * mMask;

    // Bassins / cuvettes -> lacs
    const basin = smoothstep(0.42, 0.86, this.nBasin.fbm(x * 0.00055 - 40, z * 0.00055 + 18, 3) * 0.5 + 0.5);
    h -= basin * 34;

    // Vallées : entaille suivant une crête inversée
    const valley = Math.pow(this.nBasin.ridged(x * 0.00062 + 66, z * 0.00062 - 22, 3), 2.0);
    h -= valley * 26 * (1 - mMask * 0.6);

    // Micro-relief : les plaines ne sont jamais parfaitement planes
    h += this.nDetail.fbm(x * 0.009, z * 0.009, 3) * 1.35;
    h += this.nDetail.fbm(x * 0.035, z * 0.035, 2) * 0.35;

    // Bordure du monde : massif montagneux infranchissable, sans mur artificiel
    const half = WORLD.half;
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const eF = smoothstep(half - 640, half - 60, edge);
    h = lerp(h, h + 220 + ridge * 140, eF);

    return h;
  }

  /** Altitude finale (routes intégrées). */
  height(x, z) {
    const h0 = this.baseHeight(x, z);
    const inf = this.roads.influence(x, z);
    let h = inf.w <= 0 ? h0 : lerp(h0, inf.y, inf.w * 0.94);
    if (this.padCount) h = this.applyPads(x, z, h);
    return h;
  }

  /** Altitude avec petit cache (utilisé par la physique à chaque frame). */
  heightCached(x, z) {
    const kx = Math.round(x * 4), kz = Math.round(z * 4);
    const key = kx * 8191 + kz;
    const c = this._cache.get(key);
    if (c !== undefined) return c;
    const h = this.height(x, z);
    if (this._cache.size > 20000) this._cache.clear();
    this._cache.set(key, h);
    return h;
  }

  /** Normale approchée par différences finies. */
  normal(x, z, eps = 0.6, out = { x: 0, y: 1, z: 0 }) {
    const hL = this.height(x - eps, z), hR = this.height(x + eps, z);
    const hD = this.height(x, z - eps), hU = this.height(x, z + eps);
    let nx = hL - hR, ny = 2 * eps, nz = hD - hU;
    const len = Math.hypot(nx, ny, nz) || 1;
    out.x = nx / len; out.y = ny / len; out.z = nz / len;
    return out;
  }

  /** Pente en degrés. */
  slope(x, z) {
    const n = this.normal(x, z);
    return Math.acos(clamp(n.y, -1, 1)) * 180 / Math.PI;
  }

  /** Humidité [0,1] : pilote végétation et biomes. */
  moisture(x, z) {
    const h = this.height(x, z);
    const m = this.nMoist.fbm(x * 0.00075 + 5, z * 0.00075 - 3, 4) * 0.5 + 0.5;
    const nearWater = smoothstep(26, 2, h - WORLD.waterLevel);
    return clamp(m * 0.78 + nearWater * 0.4, 0, 1);
  }

  /** Masque de champ agricole abandonné (parcelles). */
  fieldMask(x, z) {
    const f = this.nField.fbm(x * 0.00085 - 90, z * 0.00085 + 55, 2);
    const flat = 1 - smoothstep(4, 11, this.slope(x, z));
    return smoothstep(0.28, 0.5, f) * flat;
  }

  biomeAt(x, z) {
    const h = this.height(x, z);
    const s = this.slope(x, z);
    const m = this.moisture(x, z);
    const depth = h - WORLD.waterLevel;

    if (depth < 2.2) return BIOME.LAKESHORE;
    if (h > 190 && s > 32) return BIOME.ROCKY;
    if (h > 160) return BIOME.MOUNTAIN;
    if (s > 34) return BIOME.ROCKY;
    if (depth < 8 && m > 0.66) return BIOME.WETLAND;
    if (this.fieldMask(x, z) > 0.5) return BIOME.FIELDS;
    if (m > 0.72) return BIOME.DENSE_FOREST;
    if (m > 0.55) return BIOME.OVERGROWN;
    if (m > 0.42) return BIOME.SPARSE_FOREST;
    if (h < 60 && s < 8) return BIOME.VALLEY;
    return BIOME.MEADOW;
  }

  /** Type de surface : utilisé pour les pas, l'adhérence des véhicules, le rendu. */
  surfaceAt(x, z) {
    const inf = this.roads.influence(x, z);
    if (inf.w > 0.55) return inf.kind === 'asphalt' ? 'asphalt' : inf.kind === 'gravel' ? 'gravel' : 'dirt';
    const h = this.height(x, z);
    if (h < WORLD.waterLevel + 0.05) return 'water';
    if (h < WORLD.waterLevel + 1.3) return 'sand';
    const s = this.slope(x, z);
    if (s > 36 || h > 205) return 'rock';
    if (this.fieldMask(x, z) > 0.55) return 'dirt';
    return 'grass';
  }

  /** Densité d'arbres [0,1] pour la végétation instanciée. */
  treeDensity(x, z) {
    const h = this.height(x, z);
    const s = this.slope(x, z);
    if (h < WORLD.waterLevel + 0.8) return 0;
    const m = this.moisture(x, z);
    let d = smoothstep(0.30, 0.80, m);
    d *= 1 - smoothstep(30, 44, s);              // pas d'arbres sur les falaises
    d *= 1 - smoothstep(150, 225, h);            // limite forestière
    d *= 1 - this.fieldMask(x, z) * 0.75;        // les champs restent ouverts
    const inf = this.roads.influence(x, z);
    d *= 1 - inf.w;                              // pas d'arbres sur la chaussée
    return clamp(d, 0, 1);
  }

  /** Le point est-il immergé ? */
  isWater(x, z) { return this.height(x, z) < WORLD.waterLevel; }

  /** Trouve un emplacement plat à proximité (placement des bâtiments). */
  findFlatSpot(x, z, radius = 60, samples = 24, rng = null, maxSlope = 7) {
    let best = null;
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2 * 3.7;
      const r = radius * (i / samples);
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const h = this.height(px, pz);
      if (h < WORLD.waterLevel + 2.2) continue;
      const s = this.slope(px, pz);
      const score = s;
      if (!best || score < best.slope) best = { x: px, z: pz, y: h, slope: s };
      if (s < maxSlope * 0.6) break;
    }
    if (best && best.slope <= maxSlope + 6) return best;
    return null;
  }

  /**
   * Altitude moyenne sous une empreinte rectangulaire (pour poser une dalle
   * de bâtiment bien ancrée, ni flottante ni enterrée).
   */
  footprintHeight(x, z, halfW, halfD, yaw = 0) {
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    let sum = 0, n = 0;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const lx = i * halfW * 0.8, lz = j * halfD * 0.8;
        sum += this.height(x + lx * cos + lz * sin, z + -lx * sin + lz * cos);
        n++;
      }
    }
    return sum / n;
  }
}
