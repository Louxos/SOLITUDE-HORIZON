/**
 * base.js — Refuge du joueur : objets posés (coffres, lampes, lits, foyers,
 * établi), stockage persistant, feu (chaleur + cuisson), désignation du refuge.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { bus } from '../core/events.js';
import { Inventory } from '../inventory/inventory.js';
import { itemDef } from '../inventory/items.js';
import { getTexture } from '../core/textures.js';
import { box, colorize, mergeGeometries, transformGeometry } from '../core/geometry.js';
import { settings } from '../core/settings.js';
import { clamp } from '../core/noise.js';

const PLACEABLE = {
  chest: { label: 'Caisse de rangement', slots: 30, weight: 220 },
  lamp: { label: 'Lampe de camp' },
  bed: { label: 'Sac de couchage' },
  fire: { label: 'Foyer' },
  bench: { label: 'Établi' },
};

let BMATS = null;
function baseMaterials() {
  if (BMATS) return BMATS;
  BMATS = {
    wood: new THREE.MeshStandardMaterial({ map: getTexture('wood'), roughness: 0.94, vertexColors: true }),
    metal: new THREE.MeshStandardMaterial({ map: getTexture('rust'), roughness: 0.7, metalness: 0.35, vertexColors: true }),
    fabric: new THREE.MeshStandardMaterial({ color: 0x5f6a58, roughness: 0.98, vertexColors: true }),
    stone: new THREE.MeshStandardMaterial({ map: getTexture('rock'), roughness: 0.97, vertexColors: true }),
  };
  return BMATS;
}

function buildPlacedMesh(type) {
  const mats = baseMaterials();
  const g = new THREE.Group();
  if (type === 'chest') {
    const body = new THREE.Mesh(colorize(box(0.9, 0.6, 0.62, [0, 0.3, 0]), 0xa8926c), mats.wood);
    const lid = new THREE.Mesh(colorize(box(0.94, 0.1, 0.66, [0, 0.65, 0]), 0x8d7a58), mats.wood);
    g.add(body, lid);
  } else if (type === 'lamp') {
    const base = new THREE.Mesh(colorize(box(0.22, 0.06, 0.22, [0, 0.03, 0]), 0x777770), mats.metal);
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.13, 0.24, 10),
      new THREE.MeshStandardMaterial({ color: 0xffe6b0, emissive: 0xffcf80, emissiveIntensity: 0, transparent: true, opacity: 0.85 }),
    );
    glass.position.y = 0.2;
    g.add(base, glass);
    g.userData.glass = glass;
  } else if (type === 'bed') {
    const roll = new THREE.Mesh(colorize(box(0.75, 0.22, 1.95, [0, 0.11, 0]), 0x6b7360), mats.fabric);
    const pillow = new THREE.Mesh(colorize(box(0.6, 0.12, 0.34, [0, 0.24, -0.72]), 0x8a8f7c), mats.fabric);
    g.add(roll, pillow);
  } else if (type === 'fire') {
    const stones = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const s = new THREE.IcosahedronGeometry(0.17, 0);
      transformGeometry(s, { pos: [Math.cos(a) * 0.5, 0.07, Math.sin(a) * 0.5], rot: [i, i * 2, i * 3] });
      stones.push(colorize(s, 0x8d8880));
    }
    const ring = new THREE.Mesh(mergeGeometries(stones), mats.stone);
    const logs = [];
    for (let i = 0; i < 4; i++) {
      logs.push(colorize(box(0.09, 0.09, 0.66, [0, 0.08, 0], [0, (i / 4) * Math.PI, 0.12]), 0x4b3d2c));
    }
    const wood = new THREE.Mesh(mergeGeometries(logs), mats.wood);
    g.add(ring, wood);
  } else if (type === 'bench') {
    const top = new THREE.Mesh(colorize(box(1.6, 0.1, 0.7, [0, 0.9, 0]), 0x9c8a68), mats.wood);
    const l1 = new THREE.Mesh(colorize(box(0.1, 0.9, 0.1, [-0.7, 0.45, -0.28]), 0x8a7a5c), mats.wood);
    const l2 = new THREE.Mesh(colorize(box(0.1, 0.9, 0.1, [0.7, 0.45, -0.28]), 0x8a7a5c), mats.wood);
    const l3 = new THREE.Mesh(colorize(box(0.1, 0.9, 0.1, [-0.7, 0.45, 0.28]), 0x8a7a5c), mats.wood);
    const l4 = new THREE.Mesh(colorize(box(0.1, 0.9, 0.1, [0.7, 0.45, 0.28]), 0x8a7a5c), mats.wood);
    g.add(top, l1, l2, l3, l4);
  }
  g.traverse((o) => { o.castShadow = settings.preset.shadows; o.receiveShadow = settings.preset.shadows; });
  return g;
}

export class BaseSystem {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.placed = [];
    this.homePosition = null;
    this.homeName = null;
    this.worldFires = {};    // foyers trouvés dans le monde : id -> {burnTime}
    this.nextId = 1;
  }

  get colliders() {
    return this.placed
      .filter((p) => p.type === 'chest' || p.type === 'bench')
      .map((p) => ({
        wx: p.position.x, wy: p.position.y + 0.35, wz: p.position.z,
        hx: 0.5, hy: 0.35, hz: 0.4, yaw: p.yaw,
      }));
  }

  /** Peut-on poser ici ? (sol praticable, pas dans l'eau) */
  canPlaceAt(pos) {
    const t = this.world.terrain;
    if (t.height(pos.x, pos.z) < 9.8) return false;
    if (t.slope(pos.x, pos.z) > 22) return false;
    for (const p of this.placed) {
      if (p.position.distanceTo(pos) < 1.0) return false;
    }
    return true;
  }

  /** Pose un objet depuis l'inventaire (index du slot). */
  placeFromInventory(index) {
    const player = this.world.player;
    const entry = player.inventory.items[index];
    if (!entry) return false;
    const def = itemDef(entry.id);
    if (!def.place) { bus.emit('notify', { text: 'Cet objet ne se pose pas.', kind: 'warn' }); return false; }

    const dir = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const pos = player.position.clone().add(dir.multiplyScalar(1.7));
    const supportY = player.groundHeightAt(pos.x, pos.z, this.world.activeColliders, this.world.activeSupports, player.position.y + 1);
    pos.y = supportY;

    if (!this.canPlaceAt(pos)) {
      bus.emit('notify', { text: 'Impossible de poser ici.', kind: 'warn' });
      return false;
    }
    player.inventory.removeAt(index, 1);
    this.spawnPlaced(def.place, pos, player.yaw);
    bus.emit('notify', { text: `${def.name} installé.`, kind: 'info' });
    bus.emit('audio:sfx', { name: 'repair' });
    return true;
  }

  spawnPlaced(type, position, yaw, data = {}) {
    const spec = PLACEABLE[type];
    const id = data.id || `placed_${this.nextId++}`;
    const mesh = buildPlacedMesh(type);
    mesh.position.copy(position);
    mesh.rotation.y = yaw;
    this.scene.add(mesh);

    const obj = {
      id, type, label: spec.label, position: position.clone(), yaw, mesh,
      on: !!data.on, burnTime: data.burnTime ?? 0,
    };
    if (type === 'chest') {
      obj.inventory = new Inventory({ slots: spec.slots, maxWeight: spec.weight, name: spec.label, id });
      if (data.inventory) obj.inventory.fromJSON(data.inventory);
    }
    if (type === 'lamp' || type === 'fire') {
      const light = new THREE.PointLight(type === 'fire' ? 0xff9a4a : 0xffe0b0, 0, type === 'fire' ? 14 : 9, 1.6);
      light.position.set(position.x, position.y + (type === 'fire' ? 0.5 : 0.25), position.z);
      light.castShadow = false;
      this.scene.add(light);
      obj.light = light;
    }
    this.placed.push(obj);
    return obj;
  }

  removePlaced(obj) {
    const i = this.placed.indexOf(obj);
    if (i >= 0) this.placed.splice(i, 1);
    this.scene.remove(obj.mesh);
    if (obj.light) this.scene.remove(obj.light);
  }

  usePlaced(obj) {
    const player = this.world.player;
    switch (obj.type) {
      case 'chest':
        bus.emit('ui:container', { title: obj.label, inventory: obj.inventory, id: obj.id });
        break;
      case 'bed':
        bus.emit('ui:sleep', { position: obj.position });
        break;
      case 'lamp': {
        if (!obj.on) {
          if (!player.inventory.has('battery_aa')) {
            bus.emit('notify', { text: 'Il faut des piles.', kind: 'warn' });
            return;
          }
          player.inventory.remove('battery_aa', 1);
          obj.on = true;
          obj.burnTime = 1800;
        } else obj.on = false;
        bus.emit('audio:sfx', { name: 'click' });
        break;
      }
      case 'fire': {
        if (!obj.on) this.lightFire(obj, player);
        else bus.emit('ui:cook', { fire: obj });
        break;
      }
      case 'bench':
        bus.emit('ui:workbench', { bench: obj });
        break;
    }
  }

  lightFire(obj, player) {
    if (!player.inventory.has('lighter') && !player.inventory.has('matches')) {
      bus.emit('notify', { text: 'Il vous faut de quoi faire du feu.', kind: 'warn' });
      return false;
    }
    if (!player.inventory.has('wood_plank')) {
      bus.emit('notify', { text: 'Il faut du bois.', kind: 'warn' });
      return false;
    }
    player.inventory.remove('wood_plank', 1);
    const idx = player.inventory.items.findIndex((i) => i.id === 'lighter');
    if (idx >= 0) player.inventory.damageTool(idx, 0.04);
    obj.on = true;
    obj.burnTime = 600;
    bus.emit('notify', { text: 'Le feu prend.', kind: 'info' });
    bus.emit('audio:sfx', { name: 'repair' });
    return true;
  }

  fireLit(id) { return !!this.worldFires[id]?.on; }

  /** Foyers présents dans le monde (campements). */
  toggleWorldFire(target, player) {
    const state = this.worldFires[target.id] || (this.worldFires[target.id] = { on: false, burnTime: 0 });
    if (state.on) {
      bus.emit('ui:cook', { fire: state, worldFire: true, position: target.world });
      return;
    }
    if (!player.inventory.has('lighter')) {
      bus.emit('notify', { text: 'Il vous faut un briquet.', kind: 'warn' });
      return;
    }
    if (!player.inventory.has('wood_plank')) {
      bus.emit('notify', { text: 'Il faut du bois pour alimenter le foyer.', kind: 'warn' });
      return;
    }
    player.inventory.remove('wood_plank', 1);
    state.on = true;
    state.burnTime = 600;
    state.position = target.world.clone();
    if (!state.light) {
      const light = new THREE.PointLight(0xff9a4a, 0, 14, 1.6);
      light.position.copy(target.world);
      this.scene.add(light);
      state.light = light;
    }
    bus.emit('notify', { text: 'Le foyer crépite.', kind: 'info' });
  }

  setHome(position, name) {
    this.homePosition = position.clone();
    this.homeName = name || 'Refuge';
    bus.emit('notify', { text: `Refuge établi : ${this.homeName}`, kind: 'info' });
    bus.emit('base:changed', this);
  }

  /** Chaleur ressentie près d'un feu allumé. */
  nearFire(pos, radius = 4.5) {
    for (const p of this.placed) {
      if (p.type === 'fire' && p.on && p.position.distanceTo(pos) < radius) return true;
    }
    for (const f of Object.values(this.worldFires)) {
      if (f.on && f.position && f.position.distanceTo(pos) < radius) return true;
    }
    return false;
  }

  update(dt) {
    const flicker = 0.82 + Math.sin(performance.now() * 0.012) * 0.1 + Math.random() * 0.08;
    for (const p of this.placed) {
      if (p.burnTime > 0 && p.on) {
        p.burnTime -= dt;
        if (p.burnTime <= 0) {
          p.on = false;
          bus.emit('notify', { text: `${p.label} : éteint.`, kind: 'info' });
        }
      }
      if (p.light) {
        const target = p.on ? (p.type === 'fire' ? 2.6 * flicker : 1.5) : 0;
        p.light.intensity += (target - p.light.intensity) * clamp(dt * 8, 0, 1);
        p.light.visible = p.light.intensity > 0.02;
      }
      if (p.type === 'lamp' && p.mesh.userData.glass) {
        p.mesh.userData.glass.material.emissiveIntensity = p.on ? 1.6 : 0;
      }
    }
    for (const f of Object.values(this.worldFires)) {
      if (f.on) {
        f.burnTime -= dt;
        if (f.burnTime <= 0) f.on = false;
      }
      if (f.light) {
        const target = f.on ? 2.6 * flicker : 0;
        f.light.intensity += (target - f.light.intensity) * clamp(dt * 8, 0, 1);
        f.light.visible = f.light.intensity > 0.02;
      }
    }
  }

  toJSON() {
    return {
      home: this.homePosition ? { x: this.homePosition.x, y: this.homePosition.y, z: this.homePosition.z, name: this.homeName } : null,
      nextId: this.nextId,
      placed: this.placed.map((p) => ({
        id: p.id, type: p.type, x: p.position.x, y: p.position.y, z: p.position.z, yaw: p.yaw,
        on: p.on, burnTime: p.burnTime,
        inventory: p.inventory ? p.inventory.toJSON() : undefined,
      })),
      worldFires: Object.fromEntries(Object.entries(this.worldFires).map(([k, v]) => [k, {
        on: v.on, burnTime: v.burnTime,
        position: v.position ? { x: v.position.x, y: v.position.y, z: v.position.z } : null,
      }])),
    };
  }

  fromJSON(d) {
    if (!d) return;
    for (const p of [...this.placed]) this.removePlaced(p);
    this.nextId = d.nextId || 1;
    for (const p of d.placed || []) {
      this.spawnPlaced(p.type, new THREE.Vector3(p.x, p.y, p.z), p.yaw, p);
    }
    if (d.home) this.setHomeSilent(new THREE.Vector3(d.home.x, d.home.y, d.home.z), d.home.name);
    for (const [k, v] of Object.entries(d.worldFires || {})) {
      this.worldFires[k] = {
        on: v.on, burnTime: v.burnTime,
        position: v.position ? new THREE.Vector3(v.position.x, v.position.y, v.position.z) : null,
      };
      if (this.worldFires[k].on && this.worldFires[k].position) {
        const light = new THREE.PointLight(0xff9a4a, 0, 14, 1.6);
        light.position.copy(this.worldFires[k].position);
        this.scene.add(light);
        this.worldFires[k].light = light;
      }
    }
  }

  setHomeSilent(pos, name) {
    this.homePosition = pos;
    this.homeName = name;
    bus.emit('base:changed', this);
  }
}
