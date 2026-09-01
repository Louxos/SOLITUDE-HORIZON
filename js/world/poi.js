/**
 * poi.js — Lieux d'intérêt : hameaux, fermes, cabanes, garages, camps,
 * épaves, abris sous roche, points de vue. Placement déterministe + streaming.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { WORLD } from '../core/config.js';
import { makeRng, hashInt, valueAt } from '../core/rng.js';
import { generateBuilding, BUILDING_TYPES } from './buildings.js';
import { Vehicle, VEHICLE_TYPES } from './vehicles.js';
import { getTexture } from '../core/textures.js';
import { mergeGeometries, box, transformGeometry, colorize } from '../core/geometry.js';
import { settings } from '../core/settings.js';
import { bus } from '../core/events.js';
import { BIOME } from './terrain.js';

const CELL = 360;
const LOAD_RADIUS = 460;
const UNLOAD_RADIUS = 620;

const NAME_A = ['Vieux', 'Petit', 'Haut', 'Bas', 'Grand', 'Ancien'];
const NAME_B = ['Moulin', 'Chêne', 'Ruisseau', 'Corbeau', 'Verger', 'Pré', 'Fontaine', 'Sentier', 'Roc', 'Étang', 'Bosquet', 'Colombier', 'Frêne', 'Marais'];
const NAME_C = ['des Brumes', 'du Nord', "d'en Haut", 'perdu', 'oublié', 'des Cerfs', 'aux Loups', 'du Vent', 'silencieux'];

function poiName(rng, kind) {
  const base = `${rng.pick(NAME_A)} ${rng.pick(NAME_B)}`;
  const suffix = rng() < 0.45 ? ` ${rng.pick(NAME_C)}` : '';
  const prefix = {
    hamlet: 'Hameau', farm: 'Ferme', cabin: 'Cabane', garage: 'Garage',
    camp: 'Campement', wreck: 'Épave', cave: 'Abri', viewpoint: 'Point de vue',
    industrial: 'Site', shelter: 'Refuge',
  }[kind] || 'Lieu';
  return `${prefix} ${base}${suffix}`;
}

/** Petits props partagés : tente, feu de camp, clôtures, panneaux, tas de bois. */
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

  // tente (deux plans inclinés)
  const tx = cx + rng.range(-3, 3), tz = cz + rng.range(-3, 3);
  const ty = terrain.height(tx, tz);
  for (const side of [-1, 1]) {
    const p = new THREE.PlaneGeometry(2.4, 1.9);
    transformGeometry(p, { pos: [tx + side * 0.55, ty + 0.55, tz], rot: [0, Math.PI / 2, side * 0.62] });
    geoms.fabric.push(colorize(p, 0x6f6a58));
  }
  colliders.push({ wx: tx, wy: ty + 0.5, wz: tz, hx: 1.3, hy: 0.5, hz: 1.2, yaw: 0 });

  // foyer de pierres
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

  // tas de bois / caisses
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

  // sol
  parts.push(colorize(box(W, 0.4, D, [cx, y - 0.2, cz]), 0x777069));
  supports.push({ wx: cx, wz: cz, hx: W / 2, hz: D / 2, top: y, yaw: 0 });

  // parois : trois côtés pleins, façade percée d'une entrée
  const wall = (w, h, d, px, py, pz) => {
    parts.push(colorize(box(w, h, d, [px, py, pz]), 0x6f6a63));
    colliders.push({ wx: px, wy: py, wz: pz, hx: w / 2, hy: h / 2, hz: d / 2, yaw: 0 });
  };
  wall(W, H, 0.9, cx, y + H / 2, cz + D / 2);
  wall(0.9, H, D, cx - W / 2, y + H / 2, cz);
  wall(0.9, H, D, cx + W / 2, y + H / 2, cz);
  // façade avec entrée centrale
  const openW = 2.2;
  wall((W - openW) / 2, H, 0.9, cx - (W + openW) / 4, y + H / 2, cz - D / 2);
  wall((W - openW) / 2, H, 0.9, cx + (W + openW) / 4, y + H / 2, cz - D / 2);
  wall(openW, H - 2.2, 0.9, cx, y + H - (H - 2.2) / 2, cz - D / 2);
  // plafond
  parts.push(colorize(box(W + 1.4, 0.8, D + 1.4, [cx, y + H + 0.4, cz]), 0x625d57));
  colliders.push({ wx: cx, wy: y + H + 0.4, wz: cz, hx: (W + 1.4) / 2, hy: 0.4, hz: (D + 1.4) / 2, yaw: 0 });

  // rochers décoratifs autour de l'entrée
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

export class PoiManager {
  constructor(scene, terrain, world) {
    this.scene = scene;
    this.terrain = terrain;
    this.world = world;
    this.defs = new Map();     // id -> définition légère (toujours en mémoire)
    this.loaded = new Map();   // id -> instance chargée (meshes)
    this.vehicles = new Map(); // id -> Vehicle
    this.discovered = new Set();
    this.generateDefs();
  }

  /** Génère la liste (légère) de tous les lieux du monde. */
  generateDefs() {
    const cells = Math.floor(WORLD.size / CELL);
    const halfCells = Math.floor(cells / 2);
    for (let cz = -halfCells; cz <= halfCells; cz++) {
      for (let cx = -halfCells; cx <= halfCells; cx++) {
        const baseX = cx * CELL, baseZ = cz * CELL;
        const rng = makeRng(hashInt(WORLD.seed, cx, cz, 31337));
        const jitterX = baseX + rng.range(-CELL * 0.35, CELL * 0.35);
        const jitterZ = baseZ + rng.range(-CELL * 0.35, CELL * 0.35);

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
        this.defs.set(id, {
          id, kind, x: spot.x, y: h, z: spot.z, cx, cz,
          seed: hashInt(WORLD.seed, cx, cz, 777),
          name: poiName(makeRng(hashInt(WORLD.seed, cx, cz, 555)), kind),
          biome,
        });
      }
    }
    this.generateGuaranteedDefs();
  }

  /**
   * Certains lieux sont indispensables à la boucle de jeu (pièces mécaniques,
   * véhicules, points de repère) : on en garantit une quantité minimale.
   */
  generateGuaranteedDefs() {
    const rng = makeRng(WORLD.seed ^ 0x5150);
    const push = (kind, x, z, salt) => {
      const spot = this.terrain.findFlatSpot(x, z, 60, 22, rng, 9);
      if (!spot || spot.y < WORLD.waterLevel + 1.5) return false;
      const id = `poi_${kind}_${salt}`;
      if (this.defs.has(id)) return false;
      this.defs.set(id, {
        id, kind, x: spot.x, y: spot.y, z: spot.z,
        seed: hashInt(WORLD.seed, salt, kind.length, 999),
        name: poiName(makeRng(hashInt(WORLD.seed, salt, 4321)), kind),
        biome: this.terrain.biomeAt(spot.x, spot.z),
      });
      return true;
    };

    // Épaves et garages le long des routes : la mécanique doit rester atteignable
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

    // Grottes en altitude et points de vue remarquables
    let caves = 0, views = 0;
    for (let i = 0; i < 900 && (caves < 8 || views < 6); i++) {
      const x = rng.range(-WORLD.half + 200, WORLD.half - 200);
      const z = rng.range(-WORLD.half + 200, WORLD.half - 200);
      const h = this.terrain.height(x, z);
      if (h < 140) continue;
      if (caves < 8 && h < 230) { if (push('cave', x, z, 4000 + i)) caves++; }
      else if (views < 6 && h > 200) { if (push('viewpoint', x, z, 5000 + i)) views++; }
    }
  }

  /** Construit réellement les meshes / interactions d'un lieu. */
  load(def) {
    if (this.loaded.has(def.id)) return this.loaded.get(def.id);
    const rng = makeRng(def.seed);
    const root = new THREE.Group();
    root.name = def.id;
    const inst = {
      def, root, buildings: [], colliders: [], supports: [], interactables: [], vehicles: [],
    };

    const addBuilding = (type, bx, bz, yaw) => {
      const spot = this.terrain.findFlatSpot(bx, bz, 26, 14, rng, 9) || { x: bx, z: bz, y: this.terrain.height(bx, bz) };
      const b = generateBuilding({
        type, seed: def.seed, x: spot.x, y: spot.y, z: spot.z, yaw,
        id: `${def.id}_b${inst.buildings.length}`,
      });
      root.add(b.group);
      inst.buildings.push(b);
      inst.colliders.push(...b.colliders);
      inst.supports.push(...b.supports);
      inst.interactables.push(...b.interactables);
      return b;
    };

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
      return v;
    };

    switch (def.kind) {
      case 'hamlet': {
        const count = rng.int(2, 4);
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + rng.range(-0.4, 0.4);
          const r = rng.range(16, 34);
          const type = rng.weighted([
            { w: 4, v: 'small_house' }, { w: 3, v: 'family_house' },
            { w: 2, v: 'garage' }, { w: 2, v: 'cabin' }, { w: 1, v: 'workshop' },
          ]).v;
          addBuilding(type, def.x + Math.cos(a) * r, def.z + Math.sin(a) * r, rng() * Math.PI * 2);
        }
        if (rng() < 0.75) addVehicle(def.x + rng.range(-22, 22), def.z + rng.range(-22, 22), rng() * 6.28);
        break;
      }
      case 'farm': {
        addBuilding('farm', def.x, def.z, rng() * Math.PI * 2);
        addBuilding('barn', def.x + rng.range(-30, -18), def.z + rng.range(12, 26), rng() * Math.PI * 2);
        if (rng() < 0.6) addBuilding('workshop', def.x + rng.range(16, 28), def.z + rng.range(-24, -10), rng() * 6.28);
        if (rng() < 0.8) addVehicle(def.x + rng.range(-18, 18), def.z + rng.range(-18, 18), rng() * 6.28, 'van');
        break;
      }
      case 'cabin': {
        addBuilding(rng() < 0.5 ? 'cabin' : 'chalet', def.x, def.z, rng() * Math.PI * 2);
        if (rng() < 0.4) addBuilding('cabin', def.x + rng.range(-18, 18), def.z + rng.range(-18, 18), rng() * 6.28);
        break;
      }
      case 'garage': {
        addBuilding('garage', def.x, def.z, rng() * Math.PI * 2);
        const n = rng.int(1, 3);
        for (let i = 0; i < n; i++) addVehicle(def.x + rng.range(-18, 18), def.z + rng.range(-18, 18), rng() * 6.28);
        break;
      }
      case 'industrial': {
        addBuilding('industrial', def.x, def.z, rng() * Math.PI * 2);
        if (rng() < 0.7) addBuilding('workshop', def.x + rng.range(-34, -20), def.z + rng.range(-16, 16), rng() * 6.28);
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
        addBuilding('cabin', def.x, def.z, rng() * Math.PI * 2);
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
      case 'viewpoint': {
        // formation rocheuse remarquable
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
          const p = this.terrain.roads.query(def.x, def.z);
          addVehicle(def.x + rng.range(-10, 10), def.z + rng.range(-10, 10), rng() * 6.28);
        }
        break;
      }
    }

    // Conteneurs "monde" : positions absolues déjà correctes pour les bâtiments
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
      // Un véhicule en cours d'utilisation suit le joueur : on le rattache à la scène
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

      if (d < 55 && !this.discovered.has(def.id)) {
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
      if (d > 120) continue;
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
