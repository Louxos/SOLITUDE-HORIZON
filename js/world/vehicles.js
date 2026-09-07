/**
 * vehicles.js — Véhicules abandonnés : diagnostic, réparation par pièces,
 * puis conduite arcade crédible sur le terrain.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { getTexture } from '../core/textures.js';
import { mergeGeometries, box, transformGeometry, colorize } from '../core/geometry.js';
import { makeRng, hashInt } from '../core/rng.js';
import { bus } from '../core/events.js';
import { settings } from '../core/settings.js';
import { clamp, lerp, damp } from '../core/noise.js';
import { WORLD } from '../core/config.js';

export const VEHICLE_TYPES = {
  sedan: { label: 'Berline', w: 1.82, l: 4.4, h: 1.42, mass: 1300, power: 1.0, colors: [0x7a8288, 0x6d5f52, 0x8a3f34, 0x4a5a68, 0xa8a49a] },
  van: { label: 'Camionnette', w: 2.0, l: 5.1, h: 2.1, mass: 1900, power: 0.82, colors: [0xb0aca0, 0x6f7a70, 0x8e8578] },
  offroad: { label: 'Tout-terrain', w: 1.94, l: 4.2, h: 1.85, mass: 1650, power: 1.15, colors: [0x5f6a4e, 0x7a6a52, 0x555a5e] },
};

/** Définition des systèmes réparables. */
export const VEHICLE_PARTS = {
  battery: { label: 'Batterie', item: 'car_battery', tool: 'wrench', critical: true, time: 3.2 },
  oil: { label: 'Huile moteur', item: 'engine_oil', tool: null, critical: true, time: 2.4 },
  belt: { label: 'Courroie', item: 'fan_belt', tool: 'wrench', critical: true, time: 3.0 },
  wiring: { label: 'Câblage', item: 'wire', tool: 'pliers', critical: true, time: 3.6 },
  plugs: { label: 'Bougies', item: 'spark_plug', tool: 'wrench', critical: true, time: 2.8 },
  hose: { label: 'Durite', item: 'radiator_hose', tool: 'screwdriver', critical: false, time: 2.2 },
  tire: { label: 'Roue', item: 'tire', tool: 'wrench', critical: true, time: 4.0 },
  fuel: { label: 'Carburant', item: 'fuel_can', tool: null, critical: true, time: 2.6 },
};

let VMATS = null;
function vehicleMaterials() {
  if (VMATS) return VMATS;
  VMATS = {
    body: new THREE.MeshStandardMaterial({ map: getTexture('rust'), roughness: 0.62, metalness: 0.42, vertexColors: true }),
    glass: new THREE.MeshStandardMaterial({ color: 0x8fa0a6, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x22201e, roughness: 0.95, metalness: 0 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0x9a9a98, roughness: 0.42, metalness: 0.7 }),
  };
  return VMATS;
}

function buildVehicleMesh(type, color, condition, rng) {
  const spec = VEHICLE_TYPES[type];
  const mats = vehicleMaterials();
  const group = new THREE.Group();
  const bodyParts = [];
  const { w, l, h } = spec;

  // châssis
  bodyParts.push(box(w, h * 0.55, l, [0, h * 0.42, 0]));
  // cabine
  const cabinL = type === 'van' ? l * 0.52 : l * 0.42;
  const cabinY = h * 0.72 + (type === 'van' ? 0.28 : 0.12);
  bodyParts.push(box(w * 0.92, h * 0.5, cabinL, [0, cabinY, type === 'van' ? l * 0.06 : -l * 0.02]));
  // capot / coffre
  if (type !== 'van') {
    bodyParts.push(box(w * 0.95, h * 0.18, l * 0.26, [0, h * 0.66, -l * 0.32]));
    bodyParts.push(box(w * 0.95, h * 0.2, l * 0.22, [0, h * 0.66, l * 0.34]));
  }
  // pare-chocs
  bodyParts.push(box(w * 1.02, 0.16, 0.16, [0, h * 0.32, -l / 2]));
  bodyParts.push(box(w * 1.02, 0.16, 0.16, [0, h * 0.32, l / 2]));

  const bodyGeom = mergeGeometries(bodyParts.map((g) => colorize(g, color)));
  const body = new THREE.Mesh(bodyGeom, mats.body);
  body.castShadow = settings.preset.shadows;
  body.receiveShadow = settings.preset.shadows;
  group.add(body);

  // vitres (certaines brisées)
  const glassParts = [];
  const addGlass = (gw, gh, pos, rot) => {
    if (rng() < condition * 0.55) return;   // vitre cassée
    glassParts.push(transformGeometry(new THREE.PlaneGeometry(gw, gh), { pos, rot }));
  };
  addGlass(w * 0.85, h * 0.42, [0, cabinY, -cabinL / 2 - 0.02 + (type === 'van' ? l * 0.06 : -l * 0.02)], [0.22, 0, 0]);
  addGlass(w * 0.85, h * 0.42, [0, cabinY, cabinL / 2 + 0.02 + (type === 'van' ? l * 0.06 : -l * 0.02)], [-0.22, Math.PI, 0]);
  addGlass(cabinL * 0.86, h * 0.38, [w * 0.47, cabinY, (type === 'van' ? l * 0.06 : -l * 0.02)], [0, Math.PI / 2, 0]);
  addGlass(cabinL * 0.86, h * 0.38, [-w * 0.47, cabinY, (type === 'van' ? l * 0.06 : -l * 0.02)], [0, -Math.PI / 2, 0]);
  if (glassParts.length) group.add(new THREE.Mesh(mergeGeometries(glassParts), mats.glass));

  // roues
  const wheelGeom = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12);
  wheelGeom.rotateZ(Math.PI / 2);
  const wheels = [];
  const wx = w * 0.48, wz = l * 0.33;
  const positions = [[-wx, 0.34, -wz], [wx, 0.34, -wz], [-wx, 0.34, wz], [wx, 0.34, wz]];
  positions.forEach((p, i) => {
    const m = new THREE.Mesh(wheelGeom, mats.rubber);
    m.position.set(p[0], p[1], p[2]);
    m.castShadow = settings.preset.shadows;
    group.add(m);
    wheels.push(m);
  });

  // phares
  const lampGeom = new THREE.SphereGeometry(0.11, 8, 6);
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(lampGeom, mats.chrome);
    lamp.position.set(sx * w * 0.34, h * 0.55, -l / 2 - 0.02);
    group.add(lamp);
  }

  return { group, wheels, body };
}

export class Vehicle {
  constructor({ id, type, x, z, yaw, seed, terrain }) {
    this.id = id;
    this.type = type;
    this.terrain = terrain;
    const rng = makeRng(hashInt(seed, Math.round(x), Math.round(z), 909));
    this.rng = rng;
    this.spec = VEHICLE_TYPES[type];
    this.color = rng.pick(this.spec.colors);
    this.condition = rng.range(0.35, 1);
    this.position = new THREE.Vector3(x, terrain.height(x, z), z);
    this.yaw = yaw ?? rng() * Math.PI * 2;
    this.speed = 0;
    this.steer = 0;
    this.mesh = null;
    this.driving = false;
    this.headlights = false;
    this.engineRunning = false;
    this.looted = false;

    // État initial des systèmes (déterministe)
    this.parts = {};
    for (const [key, def] of Object.entries(VEHICLE_PARTS)) {
      if (key === 'fuel') { this.parts.fuel = { ok: false, value: rng() < 0.25 ? rng.range(2, 9) : 0 }; continue; }
      if (key === 'tire') { this.parts.tire = { ok: rng() > 0.45 * this.condition, count: rng.int(0, 2) }; continue; }
      this.parts[key] = { ok: rng() > (0.35 + this.condition * 0.45) };
    }
    this.parts.fuel.ok = this.parts.fuel.value > 1;
    this.fuel = this.parts.fuel.value;
    this.maxFuel = 45;
  }

  get label() { return `${this.spec.label} abandonnée`; }

  get repaired() {
    for (const [key, def] of Object.entries(VEHICLE_PARTS)) {
      if (!def.critical) continue;
      if (key === 'fuel') { if (this.fuel <= 0.5) return false; continue; }
      if (!this.parts[key].ok) return false;
    }
    return true;
  }

  /** Rapport de diagnostic affiché au joueur. */
  diagnose() {
    const lines = [];
    for (const [key, def] of Object.entries(VEHICLE_PARTS)) {
      let status, ok;
      if (key === 'fuel') {
        ok = this.fuel > 0.5;
        status = ok ? `${this.fuel.toFixed(1)} L` : 'RÉSERVOIR VIDE';
      } else if (key === 'tire') {
        ok = this.parts.tire.ok;
        status = ok ? 'CORRECTES' : `${this.parts.tire.count || 1} À PLAT`;
      } else if (key === 'battery') {
        ok = this.parts.battery.ok;
        status = ok ? 'CHARGÉE' : 'MANQUANTE';
      } else if (key === 'oil') {
        ok = this.parts.oil.ok;
        status = ok ? 'NIVEAU CORRECT' : 'TRÈS BASSE';
      } else {
        ok = this.parts[key].ok;
        status = ok ? 'FONCTIONNELLE' : 'ENDOMMAGÉE';
      }
      lines.push({ key, label: def.label, status, ok, critical: def.critical, item: def.item, tool: def.tool });
    }
    return lines;
  }

  /** Tente une réparation. @returns {{ok:boolean, msg:string}} */
  repair(key, inventory) {
    const def = VEHICLE_PARTS[key];
    if (!def) return { ok: false, msg: 'Système inconnu.' };
    if (key === 'fuel' ? this.fuel > this.maxFuel - 1 : this.parts[key].ok) {
      return { ok: false, msg: 'Rien à faire ici.' };
    }
    if (!inventory.has(def.item, 1)) {
      return { ok: false, msg: `Il manque : ${def.item === 'wire' ? 'du fil électrique' : def.label.toLowerCase()}.` };
    }
    if (def.tool) {
      const toolIdx = inventory.items.findIndex((it) => {
        const d = it.id;
        return (d === 'multitool') || (d === 'wrench' && def.tool === 'wrench') ||
          (d === 'pliers' && def.tool === 'pliers') || (d === 'screwdriver' && def.tool === 'screwdriver');
      });
      if (toolIdx < 0) return { ok: false, msg: `Outil requis : ${def.tool === 'wrench' ? 'clé' : def.tool === 'pliers' ? 'pince' : 'tournevis'}.` };
      inventory.damageTool(toolIdx, 0.06);
    }
    inventory.remove(def.item, 1);
    if (key === 'fuel') {
      this.fuel = Math.min(this.maxFuel, this.fuel + 22);
      this.parts.fuel.ok = true;
    } else {
      this.parts[key].ok = true;
      if (key === 'tire') this.parts.tire.count = 0;
    }
    bus.emit('vehicle:repaired', { vehicle: this, part: key });
    const done = this.repaired;
    return { ok: true, msg: done ? `${def.label} : OK — le véhicule semble prêt à démarrer.` : `${def.label} : réparé.` };
  }

  ensureMesh(scene) {
    if (this.mesh) {
      if (this.mesh.parent !== scene) scene.add(this.mesh);
      return;
    }
    const built = buildVehicleMesh(this.type, this.color, this.condition, this.rng);
    this.mesh = built.group;
    this.wheels = built.wheels;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.yaw;
    this.alignToGround();
    scene.add(this.mesh);
  }

  removeMesh(scene) {
    if (!this.mesh) return;
    scene.remove(this.mesh);
    this.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.mesh = null;
  }

  alignToGround() {
    if (!this.mesh) return;
    const t = this.terrain;
    const f = 1.4, s = 0.9;
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    const sample = (dx, dz) => t.height(
      this.position.x + dx * cos + dz * sin,
      this.position.z + -dx * sin + dz * cos,
    );
    const hFL = sample(-s, -f), hFR = sample(s, -f), hRL = sample(-s, f), hRR = sample(s, f);
    const avg = (hFL + hFR + hRL + hRR) / 4;
    this.position.y = avg + 0.36;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.yaw;
    this.mesh.rotation.x = Math.atan2((hFL + hFR) / 2 - (hRL + hRR) / 2, f * 2) * -1;
    this.mesh.rotation.z = Math.atan2((hFL + hRL) / 2 - (hFR + hRR) / 2, s * 2);
  }

  /** Collision approximative (boîte alignée au véhicule). */
  getCollider() {
    return {
      wx: this.position.x, wy: this.position.y + this.spec.h * 0.5, wz: this.position.z,
      hx: this.spec.w / 2, hy: this.spec.h * 0.6, hz: this.spec.l / 2, yaw: this.yaw,
      vehicle: this.id,
    };
  }

  /** Physique de conduite (arcade crédible). */
  drive(dt, controls) {
    const t = this.terrain;
    const surf = t.surfaceAt(this.position.x, this.position.z);
    const grip = { asphalt: 1, gravel: 0.82, dirt: 0.74, grass: 0.66, sand: 0.5, rock: 0.6, water: 0.25 }[surf] ?? 0.7;
    const maxSpeed = 22 * this.spec.power * grip;

    if (this.fuel <= 0) { this.engineRunning = false; }
    const throttle = this.engineRunning ? (controls.forward ? 1 : 0) - (controls.back ? 0.6 : 0) : 0;
    const brake = controls.brake ? 1 : 0;

    // pente : ralentit en montée
    const ahead = 3;
    const hNow = t.height(this.position.x, this.position.z);
    const hAhead = t.height(
      this.position.x + Math.sin(this.yaw) * -ahead,
      this.position.z + Math.cos(this.yaw) * -ahead,
    );
    const slope = (hAhead - hNow) / ahead;

    const accel = throttle * 7.6 * this.spec.power * grip - slope * 9.4;
    this.speed += accel * dt;
    this.speed -= this.speed * (0.42 + brake * 2.8) * dt;
    this.speed = clamp(this.speed, -maxSpeed * 0.35, maxSpeed);
    if (Math.abs(this.speed) < 0.05 && !throttle) this.speed = 0;

    const steerInput = (controls.left ? 1 : 0) - (controls.right ? 1 : 0);
    this.steer = damp(this.steer, steerInput, 8, dt);
    const speedFactor = clamp(Math.abs(this.speed) / 8, 0, 1);
    this.yaw += this.steer * dt * 1.5 * speedFactor * Math.sign(this.speed || 1) * grip;

    const dx = -Math.sin(this.yaw) * this.speed * dt;
    const dz = -Math.cos(this.yaw) * this.speed * dt;
    const nx = clamp(this.position.x + dx, -WORLD.half + 8, WORLD.half - 8);
    const nz = clamp(this.position.z + dz, -WORLD.half + 8, WORLD.half - 8);

    // Refus des pentes trop raides / de l'eau profonde
    const targetH = t.height(nx, nz);
    if (targetH < WORLD.waterLevel - 0.4) {
      this.speed *= 0.2;
      this.engineRunning = false;
      bus.emit('notify', { text: "Le moteur cale dans l'eau.", kind: 'warn' });
    } else if ((targetH - hNow) / Math.max(0.01, Math.hypot(dx, dz)) > 1.1) {
      this.speed *= 0.35;
    } else {
      this.position.x = nx;
      this.position.z = nz;
    }

    // consommation
    if (this.engineRunning) {
      this.fuel = Math.max(0, this.fuel - (0.00028 * (1 + Math.abs(this.speed) * 0.6)) * dt * 60);
      if (this.fuel <= 0) {
        this.engineRunning = false;
        bus.emit('notify', { text: 'Panne sèche.', kind: 'warn' });
      }
    }

    this.alignToGround();
    if (this.wheels) {
      const roll = this.speed * dt / 0.34;
      for (const wmesh of this.wheels) wmesh.rotation.x -= roll;
      this.wheels[0].rotation.y = this.steer * 0.4;
      this.wheels[1].rotation.y = this.steer * 0.4;
    }
  }

  startEngine() {
    if (!this.repaired) return { ok: false, msg: 'Le véhicule ne démarre pas.' };
    if (this.fuel <= 0) return { ok: false, msg: 'Réservoir vide.' };
    this.engineRunning = true;
    bus.emit('vehicle:engine', { vehicle: this, on: true });
    return { ok: true, msg: 'Le moteur tourne.' };
  }

  stopEngine() {
    this.engineRunning = false;
    bus.emit('vehicle:engine', { vehicle: this, on: false });
  }

  toJSON() {
    return {
      id: this.id, parts: this.parts, fuel: this.fuel, looted: this.looted,
      x: this.position.x, z: this.position.z, yaw: this.yaw,
    };
  }

  fromJSON(d) {
    if (!d) return;
    Object.assign(this.parts, d.parts || {});
    this.fuel = d.fuel ?? this.fuel;
    this.looted = !!d.looted;
    if (d.x !== undefined) { this.position.x = d.x; this.position.z = d.z; this.yaw = d.yaw; }
    this.alignToGround();
  }
}
