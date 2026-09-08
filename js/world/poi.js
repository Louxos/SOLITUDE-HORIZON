/**
 * poi.js — Lieux d'intérêt : villes, villages, hameaux, fermes, cabanes,
 * garages, camps, épaves, abris sous roche, points de vue.
 * Placement déterministe + streaming.
 *
 * Architecture v2 :
 *  1. PHASE DE PLANIFICATION (generateDefs) : chaque lieu calcule son plan
 *     (positions des bâtiments) de façon déterministe et enregistre les
 *     "pads" d'aplanissement dans le terrain → le sol est définitif AVANT
 *     le maillage des chunks et la physique. Les seuils sont au niveau du
 *     sol : ON PEUT ENTRER DANS LES MAISONS.
 *  2. PHASE D'INSTANTIATION (load) : seuls les meshes/colliders sont créés.
 *
 * Villes & villages : place aplanie, anneau de bâtiments tournés vers la
 * place, église à clocher, commerces, station-service, lampadaires, bancs,
 * puits, cageots fouillables, épaves. Coffres à gants sur les véhicules.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { WORLD } from '../core/config.js';
import { makeRng, hashInt, valueAt } from '../core/rng.js';
import { generateBuilding, buildingFootprint, BUILDING_TYPES } from './buildings.js';
import { Vehicle, VEHICLE_TYPES } from './vehicles.js';
import { getTexture } from '../core/textures.js';
import { mergeGeometries, box, transformGeometry, colorize } from '../core/geometry.js';
import { settings } from '../core/settings.js';
import { bus } from '../core/events.js';
import { BIOME } from './terrain.js';

const CELL = 360;
const LOAD_RADIUS = 520;
const UNLOAD_RADIUS = 700;

const NAME_A = ['Vieux', 'Petit', 'Haut', 'Bas', 'Grand', 'Ancien'];
const NAME_B = ['Moulin', 'Chêne', 'Ruisseau', 'Corbeau', 'Verger', 'Pré', 'Fontaine', 'Sentier', 'Roc', 'Étang', 'Bosquet', 'Colombier', 'Frêne', 'Marais'];
const NAME_C = ['des Brumes', 'du Nord', "d'en Haut", 'perdu', 'oublié', 'des Cerfs', 'aux Loups', 'du Vent', 'silencieux'];

const TOWN_NAMES = ['Saint-Elme', 'Aubry-sur-Lac', 'Valmont', 'Pierre-Fendue', 'Combe-Basse', 'Hautefeuille'];
const VILLAGE_NAMES = ['Les Sauges', 'Combe-Verte', 'Rocher-Blanc', "Fond-d'Étang", 'Brame-Loup', 'Pré-Salé', 'Cinq-Chênes'];

const usedNames = new Set();     // un lieu = un nom unique (lisible sur la carte)

function poiName(rng, kind) {
  if (kind === 'town' || kind === 'village') {
    const pool = kind === 'town' ? TOWN_NAMES : VILLAGE_NAMES;
    const free = pool.filter((n) => !usedNames.has(n));
    const name = (free.length ? free : pool)[Math.floor(rng() * (free.length || pool.length)) % (free.length || pool.length)];
    usedNames.add(name);
    return name;
  }
  const base = `${rng.pick(NAME_A)} ${rng.pick(NAME_B)}`;
  const suffix = rng() < 0.45 ? ` ${rng.pick(NAME_C)}` : '';
  const prefix = {
    hamlet: 'Hameau', farm: 'Ferme', cabin: 'Cabane', garage: 'Garage',
    camp: 'Campement', wreck: 'Épave', cave: 'Abri', viewpoint: 'Point de vue',
    industrial: 'Site', shelter: 'Refuge', overlook: 'Belvédère',
  }[kind] || 'Lieu';
  return `${prefix} ${base}${suffix}`;
}

/** Rayon de découverte selon le type (les villes se voient de plus loin). */
const DISCOVER_RADIUS = {
  town: 160, village: 100, industrial: 85, hamlet: 60, farm: 60,
};

/* ------------------------------------------------------------------ *
 *  PLANIFICATION : positions des bâtiments + aplanissement du terrain *
 * ------------------------------------------------------------------ */

/**
 * Enregistre la dalle d'un bâtiment et renvoie son entrée de layout.
 * Le seed fourni sera transmis tel quel à generateBuilding (le hachage
 * interne de l'empreinte est identique des deux côtés → déterminisme).
 */
function planBuilding(terrain, type, seed, x, z, yaw) {
  if (Math.abs(x) > WORLD.half - 160 || Math.abs(z) > WORLD.half - 160) return null;
  const fp = buildingFootprint(type, seed, x, z);
  const y = terrain.footprintHeight(x, z, fp.W / 2, fp.D / 2, yaw);
  if (y < WORLD.waterLevel + 1.2) return null;
  const inner = Math.max(fp.W, fp.D) * 0.62 + 2.5;
  terrain.addPad(x, z, y, inner, inner + 16);
  return { type, x, z, yaw, y, seed };
}

/**
 * Plan complet d'un lieu : renvoie { layout:[{type,x,z,yaw,y,seed}], ... }.
 * Appelé UNE fois à la génération des définitions ; consomme son propre RNG.
 */
function planLayout(terrain, kind, x, z, seed) {
  const rng = makeRng(hashInt(seed, 0x5ca1ab1e));
  const layout = [];
  const add = (type, bx, bz, yaw) => {
    const b = planBuilding(terrain, type, seed, bx, bz, yaw);
    if (b) layout.push(b);
    return b;
  };

  switch (kind) {
    case 'town':
    case 'village': {
      const isTown = kind === 'town';
      const plazaR = isTown ? rng.range(38, 50) : rng.range(20, 28);
      const y = terrain.height(x, z);
      // place : cœur plat, transition douce jusqu'à l'anneau des bâtiments
      terrain.addPad(x, z, y, plazaR * 0.35, plazaR + 20);

      const ringR = plazaR + rng.range(4, 10);
      const count = isTown ? Math.round(rng.range(9, 13)) : Math.round(rng.range(5, 7));
      const HOUSE_POOL = isTown
        ? ['small_house', 'family_house', 'family_house', 'small_house', 'store', 'garage', 'workshop', 'chalet', 'small_house', 'store']
        : ['small_house', 'cabin', 'chalet', 'small_house', 'cabin', 'farm'];
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rng.range(-0.18, 0.18);
        const r = ringR + rng.range(-6, 10);
        add(rng.pick(HOUSE_POOL), x + Math.cos(a) * r, z + Math.sin(a) * r, Math.PI / 2 - a);
      }
      // église légèrement excentrée, tournée vers la place
      if (isTown) {
        const ca = rng.range(0, Math.PI * 2);
        const cr = ringR + 16;
        add('church', x + Math.cos(ca) * cr, z + Math.sin(ca) * cr, Math.PI / 2 - ca);
      }
      // station-service en périphérie des villes
      if (isTown && rng() < 0.75) {
        const ga = rng.range(0, Math.PI * 2);
        const gr = ringR + rng.range(18, 30);
        add('gas_shop', x + Math.cos(ga) * gr, z + Math.sin(ga) * gr, Math.PI / 2 - ga);
      }
      // grange ou garage en lisière des villages
      if (!isTown && rng() < 0.6) {
        const fa = rng.range(0, Math.PI * 2);
        const fr = ringR + rng.range(16, 26);
        add(rng() < 0.5 ? 'barn' : 'garage', x + Math.cos(fa) * fr, z + Math.sin(fa) * fr, rng() * Math.PI * 2);
      }
      return { layout, plazaR, plazaY: y };
    }
    case 'hamlet': {
      const count = rng.int(2, 4);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rng.range(-0.4, 0.4);
        const r = rng.range(16, 34);
        const type = rng.weighted([
          { w: 4, v: 'small_house' }, { w: 3, v: 'family_house' },
          { w: 2, v: 'garage' }, { w: 2, v: 'cabin' }, { w: 1, v: 'workshop' },
        ]).v;
        add(type, x + Math.cos(a) * r, z + Math.sin(a) * r, rng() * Math.PI * 2);
      }
      return { layout };
    }
    case 'farm': {
      add('farm', x, z, rng() * Math.PI * 2);
      add('barn', x + rng.range(-30, -18), z + rng.range(12, 26), rng() * Math.PI * 2);
      if (rng() < 0.6) add('workshop', x + rng.range(16, 28), z + rng.range(-24, -10), rng() * 6.28);
      return { layout };
    }
    case 'cabin': {
      add(rng() < 0.5 ? 'cabin' : 'chalet', x, z, rng() * Math.PI * 2);
      if (rng() < 0.4) add('cabin', x + rng.range(-18, 18), z + rng.range(-18, 18), rng() * 6.28);
      return { layout };
    }
    case 'garage': {
      add('garage', x, z, rng() * Math.PI * 2);
      return { layout };
    }
    case 'industrial': {
      add('industrial', x, z, rng() * Math.PI * 2);
      if (rng() < 0.7) add('workshop', x + rng.range(-34, -20), z + rng.range(-16, 16), rng() * 6.28);
      return { layout };
    }
    case 'shelter': {
      add('cabin', x, z, rng() * Math.PI * 2);
      return { layout };
    }
    default:
      return { layout };
  }
}

/* ------------------------------------------------------------------ *
 *  PROPS DÉCORATIFS (construits au chargement)                        *
 * ------------------------------------------------------------------ */

/** Petits props : tente, feu de camp, tas de bois. */
function buildCampProps(rng, terrain, cx, cz) {
  const group = new THREE.Group();
  const colliders = [];
  const geoms = { wood: [], fabric: [], metal: [], stone: [] };
  const mats = {
    wood: new THREE.MeshStandardMaterial({ map: getTexture('wood'), roughness: 0.95, vertexColors: true }),
    fabric: new THREE.MeshStandardMaterial({ color: 0x6d7264, roughness: 0.98, vertexColors: true, side: THREE.DoubleSide }),
    metal: new THREE.MeshStandardMaterial({ map: getTexture('rust'), roughness: 0.7, metalness: 0.4, vertexColors: true }),
    stone: new THREE.MeshStandardMaterial({ map: getTexture('rock'), roughness: 0.96, vertexColors: true }),
  };

  const tx = cx + rng.range(-3, 3), tz = cz + rng.range(-3, 3);
  const ty = terrain.height(tx, tz);
  for (const side of [-1, 1]) {
    const p = new THREE.PlaneGeometry(2.4, 1.9);
    transformGeometry(p, { pos: [tx + side * 0.55, ty + 0.55, tz], rot: [0, Math.PI / 2, side * 0.62] });
    geoms.fabric.push(colorize(p, 0x6f6a58));
  }
  colliders.push({ wx: tx, wy: ty + 0.5, wz: tz, hx: 1.3, hy: 0.5, hz: 1.2, yaw: 0 });

  const fx = cx + rng.range(-4, 4), fz = cz + rng.range(-4, 4);
  const fy = terrain.height(fx, fz);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const g = new THREE.IcosahedronGeometry(0.19, 0);
    transformGeometry(g, { pos: [fx + Math.cos(a) * 0.55, fy + 0.08, fz + Math.sin(a) * 0.55], rot: [rng(), rng(), rng()] });
    geoms.stone.push(colorize(g, 0x8d8880));
  }
  for (let i = 0; i < 4; i++) {
    const g = box(0.08, 0.08, 0.7, [fx + rng.range(-0.2, 0.2), fy + 0.06, fz + rng.range(-0.2, 0.2)], [0, rng() * 3, 0.1]);
    geoms.wood.push(colorize(g, 0x4a3d2c));
  }

  for (let i = 0; i < rng.int(1, 3); i++) {
    const bx = cx + rng.range(-6, 6), bz = cz + rng.range(-6, 6);
    const by = terrain.height(bx, bz);
    geoms.wood.push(colorize(box(0.7, 0.6, 0.7, [bx, by + 0.3, bz], [0, rng() * 3, 0]), 0x9a8664));
    colliders.push({ wx: bx, wy: by + 0.3, wz: bz, hx: 0.35, hy: 0.3, hz: 0.35, yaw: 0 });
  }

  for (const [key, list] of Object.entries(geoms)) {
    if (!list.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(list), mats[key]);
    mesh.castShadow = settings.preset.shadows;
    mesh.receiveShadow = settings.preset.shadows;
    group.add(mesh);
  }
  return { group, colliders, firePos: new THREE.Vector3(fx, fy, fz) };
}

/** Abri sous roche : coque rocheuse + salle intérieure exploitable. */
function buildRockShelter(rng, terrain, cx, cz) {
  const group = new THREE.Group();
  const colliders = [];
  const supports = [];
  const parts = [];
  const y = terrain.height(cx, cz);
  const W = rng.range(7, 11), D = rng.range(6, 9), H = 3.1;

  parts.push(colorize(box(W, 0.4, D, [cx, y - 0.2, cz]), 0x777069));
  supports.push({ wx: cx, wz: cz, hx: W / 2, hz: D / 2, top: y, yaw: 0 });

  const wall = (w, h, d, px, py, pz) => {
    parts.push(colorize(box(w, h, d, [px, py, pz]), 0x6f6a63));
    colliders.push({ wx: px, wy: py, wz: pz, hx: w / 2, hy: h / 2, hz: d / 2, yaw: 0 });
  };
  wall(W, H, 0.9, cx, y + H / 2, cz + D / 2);
  wall(0.9, H, D, cx - W / 2, y + H / 2, cz);
  wall(0.9, H, D, cx + W / 2, y + H / 2, cz);
  const openW = 2.2;
  wall((W - openW) / 2, H, 0.9, cx - (W + openW) / 4, y + H / 2, cz - D / 2);
  wall((W - openW) / 2, H, 0.9, cx + (W + openW) / 4, y + H / 2, cz - D / 2);
  wall(openW, H - 2.2, 0.9, cx, y + H - (H - 2.2) / 2, cz - D / 2);
  parts.push(colorize(box(W + 1.4, 0.8, D + 1.4, [cx, y + H + 0.4, cz]), 0x625d57));
  colliders.push({ wx: cx, wy: y + H + 0.4, wz: cz, hx: (W + 1.4) / 2, hy: 0.4, hz: (D + 1.4) / 2, yaw: 0 });

  for (let i = 0; i < 10; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng.range(W * 0.5, W * 0.9);
    const px = cx + Math.cos(a) * r, pz = cz + Math.sin(a) * r;
    const s = rng.range(0.5, 1.8);
    const g = new THREE.IcosahedronGeometry(s, 0);
    transformGeometry(g, { pos: [px, terrain.height(px, pz) + s * 0.3, pz], rot: [rng(), rng(), rng()], scale: [1, 0.7, 1] });
    parts.push(colorize(g, 0x6d6862));
  }

  const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({
    map: getTexture('rock'), normalMap: getTexture('groundNormal'), roughness: 0.98, vertexColors: true,
  }));
  mesh.castShadow = settings.preset.shadows;
  mesh.receiveShadow = settings.preset.shadows;
  group.add(mesh);

  return { group, colliders, supports, interior: new THREE.Vector3(cx, y, cz + D * 0.2) };
}

/** Mobilier urbain d'une place : puits/fontaine, lampadaires, bancs, cageots, panneaux. */
function buildTownProps(rng, terrain, cx, cz, plazaR, isTown) {
  const group = new THREE.Group();
  const colliders = [];
  const interactables = [];
  const mats = {
    wood: new THREE.MeshStandardMaterial({ map: getTexture('wood'), roughness: 0.94, vertexColors: true }),
    metal: new THREE.MeshStandardMaterial({ map: getTexture('rust'), roughness: 0.7, metalness: 0.35, vertexColors: true }),
    stone: new THREE.MeshStandardMaterial({ map: getTexture('rock'), roughness: 0.96, vertexColors: true }),
  };
  const buckets = { wood: [], metal: [], stone: [] };
  const y = terrain.height(cx, cz);

  // puits (village) ou fontaine (ville)
  {
    const w = isTown ? 1.9 : 1.4;
    const rim = new THREE.CylinderGeometry(w, w * 1.05, 0.75, 10);
    transformGeometry(rim, { pos: [cx, y + 0.37, cz] });
    buckets.stone.push(colorize(rim, 0x8d867c));
    const inner = new THREE.CylinderGeometry(w * 0.72, w * 0.72, 0.1, 10);
    transformGeometry(inner, { pos: [cx, y + 0.62, cz] });
    buckets.stone.push(colorize(inner, 0x1c2426));
    if (!isTown) {
      for (const s of [-1, 1]) {
        buckets.wood.push(colorize(box(0.1, 1.7, 0.1, [cx + s * w * 0.8, y + 1.0, cz]), 0x6e5a40));
      }
      buckets.wood.push(colorize(box(w * 2.2, 0.1, 1.1, [cx, y + 1.9, cz], [0, 0, 0]), 0x6e5a40));
    }
    colliders.push({ wx: cx, wy: y + 0.4, wz: cz, hx: w + 0.1, hy: 0.4, hz: w + 0.1, yaw: 0 });
  }

  // lampadères en cercle (vasques émissives, sans lumières dynamiques : perf)
  const lampCount = isTown ? 6 : 4;
  for (let i = 0; i < lampCount; i++) {
    const a = (i / lampCount) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const r = plazaR * rng.range(0.55, 0.75);
    const lx = cx + Math.cos(a) * r, lz = cz + Math.sin(a) * r;
    const ly = terrain.height(lx, lz);
    buckets.metal.push(colorize(box(0.11, 4.4, 0.11, [lx, ly + 2.2, lz]), 0x5a5750));
    buckets.metal.push(colorize(box(0.5, 0.16, 0.28, [lx, ly + 4.42, lz], [0, a, 0]), 0x6a675e));
    const head = new THREE.Mesh(
      colorize(box(0.34, 0.14, 0.2, [0, 0, 0]), 0xd8c9a0),
      new THREE.MeshStandardMaterial({ color: 0xd8c9a0, emissive: 0xffd890, emissiveIntensity: 0.55, roughness: 0.6 }),
    );
    head.position.set(lx + Math.cos(a) * 0.18, ly + 4.3, lz + Math.sin(a) * 0.18);
    group.add(head);
    colliders.push({ wx: lx, wy: ly + 2.2, wz: lz, hx: 0.14, hy: 2.2, hz: 0.14, yaw: 0 });
  }

  // bancs
  const benchCount = isTown ? 5 : 3;
  for (let i = 0; i < benchCount; i++) {
    const a = rng() * Math.PI * 2;
    const r = plazaR * rng.range(0.3, 0.62);
    const bx = cx + Math.cos(a) * r, bz = cz + Math.sin(a) * r;
    const by = terrain.height(bx, bz);
    buckets.wood.push(colorize(box(1.6, 0.07, 0.42, [bx, by + 0.44, bz], [0, a, 0]), 0x7a664c));
    buckets.wood.push(colorize(box(1.6, 0.5, 0.06, [bx - Math.sin(a) * 0.2, by + 0.7, bz + Math.cos(a) * 0.2], [0, a, 0]), 0x6e5a40));
    buckets.metal.push(colorize(box(0.06, 0.44, 0.4, [bx - Math.cos(a) * 0.7, by + 0.22, bz - Math.sin(a) * 0.7]), 0x55524a));
    buckets.metal.push(colorize(box(0.06, 0.44, 0.4, [bx + Math.cos(a) * 0.7, by + 0.22, bz + Math.sin(a) * 0.7]), 0x55524a));
    colliders.push({ wx: bx, wy: by + 0.25, wz: bz, hx: 0.8, hy: 0.25, hz: 0.35, yaw: a });
  }

  // cageots fouillables
  for (let i = 0; i < rng.int(2, 4); i++) {
    const a = rng() * Math.PI * 2;
    const r = plazaR * rng.range(0.35, 0.6);
    const kx = cx + Math.cos(a) * r, kz = cz + Math.sin(a) * r;
    const ky = terrain.height(kx, kz);
    buckets.wood.push(colorize(box(0.75, 0.55, 0.75, [kx, ky + 0.28, kz], [0, rng() * 3, 0]), 0x9a8664));
    colliders.push({ wx: kx, wy: ky + 0.28, wz: kz, hx: 0.38, hy: 0.28, hz: 0.38, yaw: 0 });
    interactables.push({
      kind: 'container', id: `crate_${Math.round(cx)}_${Math.round(cz)}_${i}`,
      label: 'Cageot abandonné', lootTable: 'store', rolls: 2,
      world: new THREE.Vector3(kx, ky + 0.5, kz),
    });
  }

  // panneaux directionnels
  for (let i = 0; i < 2; i++) {
    const a = rng() * Math.PI * 2;
    const sx = cx + Math.cos(a) * plazaR * 0.85, sz = cz + Math.sin(a) * plazaR * 0.85;
    const sy = terrain.height(sx, sz);
    buckets.metal.push(colorize(box(0.08, 2.4, 0.08, [sx, sy + 1.2, sz]), 0x605d55));
    buckets.wood.push(colorize(box(1.1, 0.3, 0.05, [sx, sy + 2.15, sz], [0, a, 0]), 0x7d8a7a));
    buckets.wood.push(colorize(box(1.0, 0.26, 0.05, [sx, sy + 1.78, sz], [0, a + 0.08, 0]), 0x74816f));
    colliders.push({ wx: sx, wy: sy + 1.2, wz: sz, hx: 0.1, hy: 1.2, hz: 0.1, yaw: 0 });
  }

  for (const [key, list] of Object.entries(buckets)) {
    if (!list.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(list), mats[key]);
    mesh.castShadow = settings.preset.shadows;
    mesh.receiveShadow = settings.preset.shadows;
    group.add(mesh);
  }
  return { group, colliders, interactables };
}

/* ------------------------------------------------------------------ */

export class PoiManager {
  constructor(scene, terrain, world) {
    this.scene = scene;
    this.terrain = terrain;
    this.world = world;
    this.defs = new Map();     // id -> définition (toujours en mémoire)
    this.loaded = new Map();   // id -> instance chargée (meshes)
    this.vehicles = new Map(); // id -> Vehicle
    this.discovered = new Set();
    this.settlements = [];
    this.generateDefs();
  }

  /** Génère la liste (légère mais planifiée) de tous les lieux du monde. */
  generateDefs() {
    // 1) Villes & villages d'abord : ils aplanissent le terrain et réservent
    //    leur emplacement ; le placement diffus les évitera ensuite.
    this.generateSettlements();

    // 2) Lieux diffus par cellule
    const cells = Math.floor(WORLD.size / CELL);
    const halfCells = Math.floor(cells / 2);
    for (let cz = -halfCells; cz <= halfCells; cz++) {
      for (let cx = -halfCells; cx <= halfCells; cx++) {
        const baseX = cx * CELL, baseZ = cz * CELL;
        const rng = makeRng(hashInt(WORLD.seed, cx, cz, 31337));
        const jitterX = baseX + rng.range(-CELL * 0.35, CELL * 0.35);
        const jitterZ = baseZ + rng.range(-CELL * 0.35, CELL * 0.35);

        if (this.nearSettlement(jitterX, jitterZ, 300)) continue;

        const spot = this.terrain.findFlatSpot(jitterX, jitterZ, 70, 26, rng, 8);
        if (!spot) continue;
        const h = spot.y;
        if (h < WORLD.waterLevel + 1.5 || h > 250) continue;

        const roadInf = this.terrain.roads.query(spot.x, spot.z);
        const nearRoad = roadInf && roadInf.dist < 130;
        const biome = this.terrain.biomeAt(spot.x, spot.z);
        const roll = rng();

        let kind = null;
        if (nearRoad) {
          if (roll < 0.20) kind = 'hamlet';
          else if (roll < 0.34) kind = 'farm';
          else if (roll < 0.44) kind = 'garage';
          else if (roll < 0.50) kind = 'industrial';
          else if (roll < 0.60) kind = 'wreck';
          else if (roll < 0.66) kind = 'cabin';
        } else {
          if (roll < 0.13) kind = 'cabin';
          else if (roll < 0.20) kind = 'farm';
          else if (roll < 0.28) kind = 'camp';
          else if (roll < 0.34 && h > 130) kind = 'cave';
          else if (roll < 0.40 && h > 165) kind = 'viewpoint';
          else if (roll < 0.45) kind = 'shelter';
        }
        if (!kind) continue;

        const id = `poi_${cx}_${cz}`;
        const seed = hashInt(WORLD.seed, cx, cz, 777);
        const def = {
          id, kind, x: spot.x, y: h, z: spot.z, cx, cz,
          seed,
          name: poiName(makeRng(hashInt(WORLD.seed, cx, cz, 555)), kind),
          biome,
          ...planLayout(this.terrain, kind, spot.x, spot.z, seed),
        };
        this.defs.set(id, def);
      }
    }
    this.generateGuaranteedDefs();
  }

  nearSettlement(x, z, minDist) {
    for (const s of this.settlements) {
      if (Math.hypot(s.x - x, s.z - z) < minDist) return true;
    }
    return false;
  }

  /** Villes et villages le long des axes goudronnés, placés une fois pour toutes. */
  generateSettlements() {
    const rng = makeRng(WORLD.seed ^ 0x7c47);
    const mainRoads = this.terrain.roads.roads.filter((r) => r.kind === 'asphalt');

    const tryPlace = (kind, roadIndexHint) => {
      for (let attempt = 0; attempt < 70; attempt++) {
        const road = mainRoads.length
          ? mainRoads[(roadIndexHint + attempt) % mainRoads.length]
          : null;
        let px, pz;
        if (road) {
          const i = Math.floor(road.pts.length * (0.25 + rng() * 0.5));
          const p = road.pts[i];
          const q = road.pts[Math.min(road.pts.length - 1, i + 1)];
          const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
          const nx = -(q.z - p.z) / len, nz = (q.x - p.x) / len;
          const side = rng() < 0.5 ? -1 : 1;
          const off = rng.range(58, 95) * side;
          px = p.x + nx * off;
          pz = p.z + nz * off;
        } else {
          px = rng.range(-WORLD.half + 400, WORLD.half - 400);
          pz = rng.range(-WORLD.half + 400, WORLD.half - 400);
        }
        px = Math.max(-WORLD.half + 340, Math.min(WORLD.half - 340, px));
        pz = Math.max(-WORLD.half + 340, Math.min(WORLD.half - 340, pz));

        const h = this.terrain.height(px, pz);
        if (h < WORLD.waterLevel + 3 || h > 170) continue;
        if (this.settlements.some((s) => Math.hypot(s.x - px, s.z - pz) < 760)) continue;

        // pente moyenne de la zone : pas de ville à flanc de falaise
        let slopeSum = 0;
        for (let i = 0; i < 8; i++) {
          slopeSum += this.terrain.slope(px + rng.range(-40, 40), pz + rng.range(-40, 40));
        }
        if (slopeSum / 8 > 16) continue;

        const seed = hashInt(WORLD.seed, Math.round(px), Math.round(pz), kind === 'town' ? 909 : 910);
        const plan = planLayout(this.terrain, kind, px, pz, seed);
        if (!plan.layout || plan.layout.length < 3) continue;

        const def = {
          id: `${kind}_${Math.round(px)}_${Math.round(pz)}`,
          kind, x: px, y: plan.plazaY ?? h, z: pz,
          seed, ...plan,
          name: poiName(makeRng(seed ^ 5), kind),
          biome: this.terrain.biomeAt(px, pz),
          discoverRadius: DISCOVER_RADIUS[kind] || 60,
        };
        this.settlements.push(def);
        this.defs.set(def.id, def);
        return true;
      }
      return false;
    };

    // 2 villes + 3 villages
    tryPlace('town', 0);
    tryPlace('town', 1);
    let villages = 0;
    for (let i = 0; i < 40 && villages < 3; i++) {
      if (tryPlace('village', i)) villages++;
    }
  }

  /** Lieux garantis : la boucle de jeu (pièces, véhicules) doit rester atteignable. */
  generateGuaranteedDefs() {
    const rng = makeRng(WORLD.seed ^ 0x5150);
    const push = (kind, x, z, salt) => {
      if (this.nearSettlement(x, z, 240)) return false;
      const spot = this.terrain.findFlatSpot(x, z, 60, 22, rng, 9);
      if (!spot || spot.y < WORLD.waterLevel + 1.5) return false;
      const id = `poi_${kind}_${salt}`;
      if (this.defs.has(id)) return false;
      const seed = hashInt(WORLD.seed, salt, kind.length, 999);
      this.defs.set(id, {
        id, kind, x: spot.x, y: spot.y, z: spot.z,
        seed,
        name: poiName(makeRng(hashInt(WORLD.seed, salt, 4321)), kind),
        biome: this.terrain.biomeAt(spot.x, spot.z),
        ...planLayout(this.terrain, kind, spot.x, spot.z, seed),
      });
      return true;
    };

    // Épaves et garages le long des routes
    let wrecks = 0, garages = 0, industrial = 0;
    for (let i = 0; i < 260 && (wrecks < 14 || garages < 7 || industrial < 3); i++) {
      const p = this.terrain.roads.pointOnRoad(rng);
      const off = rng.range(14, 42) * (rng() < 0.5 ? -1 : 1);
      const x = p.x + Math.cos(p.angle) * off;
      const z = p.z - Math.sin(p.angle) * off;
      if (wrecks < 14 && rng() < 0.5) { if (push('wreck', x, z, 1000 + i)) wrecks++; }
      else if (garages < 7 && rng() < 0.6) { if (push('garage', x, z, 2000 + i)) garages++; }
      else if (industrial < 3) { if (push('industrial', x, z, 3000 + i)) industrial++; }
    }

    // Grottes, points de vue et belvédères
    let caves = 0, views = 0, overlooks = 0;
    for (let i = 0; i < 900 && (caves < 8 || views < 6 || overlooks < 4); i++) {
      const x = rng.range(-WORLD.half + 200, WORLD.half - 200);
      const z = rng.range(-WORLD.half + 200, WORLD.half - 200);
      const h = this.terrain.height(x, z);
      if (h < 140) continue;
      if (this.nearSettlement(x, z, 240)) continue;
      if (caves < 8 && h < 230) { if (push('cave', x, z, 4000 + i)) caves++; }
      else if (views < 6 && h > 200) { if (push('viewpoint', x, z, 5000 + i)) views++; }
      else if (overlooks < 4) { if (push('overlook', x, z, 6000 + i)) overlooks++; }
    }
  }

  /* ------------------------------------------------------------ chargement */

  /** Construit réellement les meshes / interactions d'un lieu. */
  load(def) {
    if (this.loaded.has(def.id)) return this.loaded.get(def.id);
    const rng = makeRng(def.seed);
    const root = new THREE.Group();
    root.name = def.id;
    const inst = {
      def, root, buildings: [], colliders: [], supports: [], interactables: [], vehicles: [],
    };

    // Bâtiments : le plan (et le sol aplani) existe depuis la génération du monde
    for (const b of def.layout || []) {
      const building = generateBuilding({
        type: b.type, seed: b.seed, x: b.x, y: b.y, z: b.z, yaw: b.yaw,
        id: `${def.id}_b${inst.buildings.length}`,
      });
      root.add(building.group);
      inst.buildings.push(building);
      inst.colliders.push(...building.colliders);
      inst.supports.push(...building.supports);
      inst.interactables.push(...building.interactables);
    }

    const addVehicle = (vx, vz, yaw, typeOverride) => {
      const type = typeOverride || rng.pick(Object.keys(VEHICLE_TYPES));
      const vid = `${def.id}_v${inst.vehicles.length}`;
      let v = this.vehicles.get(vid);
      if (!v) {
        v = new Vehicle({ id: vid, type, x: vx, z: vz, yaw, seed: def.seed, terrain: this.terrain });
        const saved = this.world.state.vehicles[vid];
        if (saved) v.fromJSON(saved);
        this.vehicles.set(vid, v);
      }
      v.ensureMesh(root);
      inst.vehicles.push(v);
      inst.interactables.push({
        kind: 'vehicle', id: vid, label: v.label, world: v.position.clone(), vehicle: v,
      });
      // coffre à gants fouillable (persiste via son id)
      const side = new THREE.Vector3(-1.05, 0, 0.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), v.yaw);
      inst.interactables.push({
        kind: 'container', id: `${vid}:glovebox`, label: 'Boîte à gants',
        lootTable: 'vehicle', rolls: 2,
        world: v.position.clone().add(side).setY(v.position.y + 0.6),
      });
      return v;
    };

    switch (def.kind) {
      case 'town':
      case 'village': {
        const props = buildTownProps(rng, this.terrain, def.x, def.z, def.plazaR, def.kind === 'town');
        root.add(props.group);
        inst.colliders.push(...props.colliders);
        inst.interactables.push(...props.interactables);
        // véhicules abandonnés près de la place
        const nVeh = def.kind === 'town' ? rng.int(2, 3) : rng.int(0, 1);
        for (let i = 0; i < nVeh; i++) {
          const a = rng() * Math.PI * 2;
          const r = def.plazaR * rng.range(0.72, 1.0);
          addVehicle(def.x + Math.cos(a) * r, def.z + Math.sin(a) * r, rng() * 6.28);
        }
        break;
      }
      case 'hamlet': {
        if (rng() < 0.75) addVehicle(def.x + rng.range(-22, 22), def.z + rng.range(-22, 22), rng() * 6.28);
        break;
      }
      case 'farm': {
        if (rng() < 0.8) addVehicle(def.x + rng.range(-18, 18), def.z + rng.range(-18, 18), rng() * 6.28, 'van');
        break;
      }
      case 'garage': {
        const n = rng.int(1, 3);
        for (let i = 0; i < n; i++) addVehicle(def.x + rng.range(-18, 18), def.z + rng.range(-18, 18), rng() * 6.28);
        break;
      }
      case 'industrial': {
        for (let i = 0; i < rng.int(0, 2); i++) addVehicle(def.x + rng.range(-26, 26), def.z + rng.range(-26, 26), rng() * 6.28, 'van');
        break;
      }
      case 'camp': {
        const camp = buildCampProps(rng, this.terrain, def.x, def.z);
        root.add(camp.group);
        inst.colliders.push(...camp.colliders);
        inst.interactables.push({
          kind: 'container', id: `${def.id}:campcrate`, label: 'Affaires abandonnées',
          lootTable: 'shed', rolls: 3,
          world: new THREE.Vector3(def.x, this.terrain.height(def.x, def.z) + 0.4, def.z),
        });
        inst.interactables.push({
          kind: 'firepit', id: `${def.id}:fire`, label: 'Foyer',
          world: camp.firePos.clone().setY(camp.firePos.y + 0.3),
        });
        break;
      }
      case 'shelter': {
        const camp = buildCampProps(rng, this.terrain, def.x + rng.range(-10, 10), def.z + rng.range(-10, 10));
        root.add(camp.group);
        inst.colliders.push(...camp.colliders);
        inst.interactables.push({
          kind: 'firepit', id: `${def.id}:fire`, label: 'Foyer', world: camp.firePos.clone().setY(camp.firePos.y + 0.3),
        });
        break;
      }
      case 'cave': {
        const shelter = buildRockShelter(rng, this.terrain, def.x, def.z);
        root.add(shelter.group);
        inst.colliders.push(...shelter.colliders);
        inst.supports.push(...shelter.supports);
        for (let i = 0; i < rng.int(1, 3); i++) {
          inst.interactables.push({
            kind: 'container', id: `${def.id}:cave${i}`, label: 'Caisse humide',
            lootTable: 'cave', rolls: 3,
            world: new THREE.Vector3(
              shelter.interior.x + rng.range(-2.5, 2.5),
              shelter.interior.y + 0.4,
              shelter.interior.z + rng.range(-2, 2)),
          });
        }
        break;
      }
      case 'viewpoint':
      case 'overlook': {
        const parts = [];
        for (let i = 0; i < 14; i++) {
          const a = rng() * Math.PI * 2, r = rng.range(0, 9);
          const px = def.x + Math.cos(a) * r, pz = def.z + Math.sin(a) * r;
          const s = rng.range(1.2, 4.2);
          const g = new THREE.IcosahedronGeometry(s, 0);
          transformGeometry(g, {
            pos: [px, this.terrain.height(px, pz) + s * 0.35, pz],
            rot: [rng() * 0.5, rng() * 6.28, rng() * 0.5], scale: [1, rng.range(0.8, 1.6), 1],
          });
          parts.push(colorize(g, 0x6f6a63));
          inst.colliders.push({ wx: px, wy: this.terrain.height(px, pz) + s * 0.35, wz: pz, hx: s * 0.7, hy: s * 0.7, hz: s * 0.7, yaw: 0 });
        }
        const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({
          map: getTexture('rock'), roughness: 0.97, vertexColors: true,
        }));
        mesh.castShadow = settings.preset.shadows;
        mesh.receiveShadow = settings.preset.shadows;
        root.add(mesh);
        break;
      }
      case 'wreck': {
        const n = rng.int(1, 3);
        for (let i = 0; i < n; i++) {
          addVehicle(def.x + rng.range(-10, 10), def.z + rng.range(-10, 10), rng() * 6.28);
        }
        break;
      }
    }

    // Les conteneurs sans position monde explicite héritent de leur position locale
    for (const it of inst.interactables) {
      if (!it.world && it.local) it.world = it.local.clone();
    }

    this.scene.add(root);
    this.loaded.set(def.id, inst);
    bus.emit('poi:loaded', inst);
    return inst;
  }

  unload(id) {
    const inst = this.loaded.get(id);
    if (!inst) return;
    for (const v of inst.vehicles) {
      if (v.driving && v.mesh) this.scene.add(v.mesh);
      else v.removeMesh(inst.root);
    }
    this.scene.remove(inst.root);
    inst.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.loaded.delete(id);
  }

  update(dt, playerPos) {
    for (const def of this.defs.values()) {
      const d = Math.hypot(def.x - playerPos.x, def.z - playerPos.z);
      if (d < LOAD_RADIUS && !this.loaded.has(def.id)) this.load(def);
      else if (d > UNLOAD_RADIUS && this.loaded.has(def.id)) this.unload(def.id);

      const discoverR = def.discoverRadius || DISCOVER_RADIUS[def.kind] || 55;
      if (d < discoverR && !this.discovered.has(def.id)) {
        this.discovered.add(def.id);
        bus.emit('poi:discovered', def);
      }
    }
  }

  /** Colliders + supports actifs autour du joueur. */
  collectPhysics(playerPos, radius = 90) {
    const colliders = [], supports = [];
    for (const inst of this.loaded.values()) {
      const d = Math.hypot(inst.def.x - playerPos.x, inst.def.z - playerPos.z);
      if (d > radius + 60) continue;
      colliders.push(...inst.colliders);
      supports.push(...inst.supports);
      for (const v of inst.vehicles) if (!v.driving) colliders.push(v.getCollider());
    }
    return { colliders, supports };
  }

  /** Interactions candidates proches. */
  nearbyInteractables(playerPos, radius = 6) {
    const out = [];
    for (const inst of this.loaded.values()) {
      const d = Math.hypot(inst.def.x - playerPos.x, inst.def.z - playerPos.z);
      if (d > 150) continue;
      for (const it of inst.interactables) {
        if (!it.world) continue;
        if (it.kind === 'vehicle' && it.vehicle) it.world.copy(it.vehicle.position);
        if (it.world.distanceTo(playerPos) <= radius) out.push(it);
      }
    }
    return out;
  }

  findInteractable(id) {
    for (const inst of this.loaded.values()) {
      const found = inst.interactables.find((i) => i.id === id);
      if (found) return found;
    }
    return null;
  }
}
