/**
 * animals.js — Faune : cerfs, sangliers, renards, lapins, oiseaux.
 * IA à états (paître, boire, se reposer, observer, fuir, charger),
 * spawn autour du joueur, budget limité par la qualité graphique.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { makeRng, hashInt } from '../core/rng.js';
import { settings } from '../core/settings.js';
import { bus } from '../core/events.js';
import { clamp, damp, lerp } from '../core/noise.js';
import { WORLD } from '../core/config.js';
import { mergeGeometries, box, transformGeometry, colorize } from '../core/geometry.js';

export const SPECIES = {
  deer: {
    label: 'Cerf', color: 0x8a6a48, scale: 1.0, speed: 2.4, runSpeed: 8.2, alert: 34, flee: 26,
    health: 60, meat: 3, group: [1, 4], nocturnal: false, dangerous: false, size: [0.62, 1.05, 1.65],
  },
  boar: {
    label: 'Sanglier', color: 0x4a3f36, scale: 0.85, speed: 1.9, runSpeed: 7.0, alert: 20, flee: 12,
    health: 85, meat: 4, group: [1, 3], nocturnal: false, dangerous: true, damage: 16, size: [0.55, 0.72, 1.25],
  },
  fox: {
    label: 'Renard', color: 0xa8582c, scale: 0.55, speed: 2.6, runSpeed: 7.4, alert: 26, flee: 22,
    health: 30, meat: 1, group: [1, 1], nocturnal: true, dangerous: false, size: [0.28, 0.4, 0.85],
  },
  rabbit: {
    label: 'Lapin', color: 0x8d7f6b, scale: 0.32, speed: 2.0, runSpeed: 6.6, alert: 18, flee: 16,
    health: 12, meat: 1, group: [1, 3], nocturnal: false, dangerous: false, size: [0.2, 0.24, 0.42],
  },
  wolf: {
    label: 'Loup', color: 0x5c5b58, scale: 0.8, speed: 2.8, runSpeed: 8.8, alert: 40, flee: 8,
    health: 70, meat: 2, group: [1, 3], nocturnal: true, dangerous: true, damage: 22, size: [0.42, 0.72, 1.25],
  },
};

const MATS = {};
function speciesMaterial(key) {
  if (!MATS[key]) {
    MATS[key] = new THREE.MeshStandardMaterial({
      color: SPECIES[key].color, roughness: 0.92, metalness: 0, vertexColors: true, flatShading: true,
    });
  }
  return MATS[key];
}

/** Construit un quadrupède stylisé mais crédible en volumes. */
function buildAnimalMesh(key) {
  const s = SPECIES[key];
  const [w, h, l] = s.size;
  const group = new THREE.Group();
  const bodyParts = [];
  bodyParts.push(box(w, h * 0.72, l, [0, h * 0.62, 0]));
  bodyParts.push(box(w * 0.72, h * 0.5, l * 0.28, [0, h * 0.78, -l * 0.52]));   // poitrail
  const bodyGeom = mergeGeometries(bodyParts.map((g) => colorize(g, 0xffffff)));
  const body = new THREE.Mesh(bodyGeom, speciesMaterial(key));
  body.castShadow = settings.preset.shadows;
  group.add(body);

  // cou + tête
  const neck = new THREE.Group();
  const neckGeoms = [
    box(w * 0.42, h * 0.55, w * 0.42, [0, h * 0.28, 0], [0.35, 0, 0]),
    box(w * 0.44, h * 0.32, l * 0.3, [0, h * 0.55, -l * 0.1]),
  ];
  if (key === 'deer') {
    neckGeoms.push(box(0.05, 0.42, 0.05, [w * 0.16, h * 0.82, -l * 0.06], [0.3, 0, 0.25]));
    neckGeoms.push(box(0.05, 0.42, 0.05, [-w * 0.16, h * 0.82, -l * 0.06], [0.3, 0, -0.25]));
  }
  if (key === 'rabbit' || key === 'fox' || key === 'wolf') {
    neckGeoms.push(box(0.06, 0.16, 0.05, [w * 0.14, h * 0.72, -l * 0.06]));
    neckGeoms.push(box(0.06, 0.16, 0.05, [-w * 0.14, h * 0.72, -l * 0.06]));
  }
  const neckMesh = new THREE.Mesh(mergeGeometries(neckGeoms.map((g) => colorize(g, 0xf2f2f2))), speciesMaterial(key));
  neckMesh.castShadow = settings.preset.shadows;
  neck.add(neckMesh);
  neck.position.set(0, h * 0.72, -l * 0.5);
  group.add(neck);

  // pattes
  const legs = [];
  const legGeom = box(w * 0.16, h * 0.62, w * 0.16, [0, -h * 0.31, 0]);
  colorize(legGeom, 0xdddddd);
  const legPos = [
    [w * 0.32, h * 0.55, -l * 0.34], [-w * 0.32, h * 0.55, -l * 0.34],
    [w * 0.32, h * 0.55, l * 0.34], [-w * 0.32, h * 0.55, l * 0.34],
  ];
  for (const p of legPos) {
    const m = new THREE.Mesh(legGeom, speciesMaterial(key));
    m.position.set(p[0], p[1], p[2]);
    m.castShadow = settings.preset.shadows;
    group.add(m);
    legs.push(m);
  }

  // queue
  const tail = new THREE.Mesh(box(w * 0.14, w * 0.14, l * 0.28, [0, h * 0.78, l * 0.55]), speciesMaterial(key));
  group.add(tail);

  group.scale.setScalar(s.scale);
  return { group, legs, neck, body };
}

class Animal {
  constructor(key, x, z, terrain, rng) {
    this.key = key;
    this.spec = SPECIES[key];
    this.terrain = terrain;
    this.rng = rng;
    this.position = new THREE.Vector3(x, terrain.height(x, z), z);
    this.yaw = rng() * Math.PI * 2;
    this.state = 'graze';
    this.stateTimer = rng.range(2, 7);
    this.health = this.spec.health;
    this.speed = 0;
    this.target = new THREE.Vector3(x, 0, z);
    this.legPhase = rng() * 6.28;
    this.alerted = 0;
    this.attackCooldown = 0;
    this.dead = false;
    this.mesh = null;
    this.home = new THREE.Vector3(x, 0, z);
  }

  ensureMesh(scene) {
    if (this.mesh) return;
    const built = buildAnimalMesh(this.key);
    this.mesh = built.group;
    this.legs = built.legs;
    this.neck = built.neck;
    scene.add(this.mesh);
  }

  removeMesh(scene) {
    if (!this.mesh) return;
    scene.remove(this.mesh);
    this.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.mesh = null;
  }

  pickWanderTarget() {
    const r = this.rng.range(8, 45);
    const a = this.rng() * Math.PI * 2;
    let x = this.home.x + Math.cos(a) * r;
    let z = this.home.z + Math.sin(a) * r;
    x = clamp(x, -WORLD.half + 20, WORLD.half - 20);
    z = clamp(z, -WORLD.half + 20, WORLD.half - 20);
    this.target.set(x, 0, z);
  }

  /** Cherche un point d'eau proche (comportement de soif). */
  pickWaterTarget() {
    for (let i = 0; i < 12; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = this.rng.range(10, 90);
      const x = this.position.x + Math.cos(a) * r;
      const z = this.position.z + Math.sin(a) * r;
      const h = this.terrain.height(x, z);
      if (h < WORLD.waterLevel + 0.9 && h > WORLD.waterLevel - 0.6) {
        this.target.set(x, 0, z);
        return true;
      }
    }
    return false;
  }

  hurt(amount, fromPlayer) {
    this.health -= amount;
    this.alerted = 1;
    if (this.health <= 0) {
      this.dead = true;
      return true;
    }
    // Un animal dangereux blessé peut charger au lieu de fuir
    if (this.spec.dangerous && this.rng() < 0.6) this.setState('charge', 6);
    else this.setState('flee', 8);
    return false;
  }

  setState(s, t) { this.state = s; this.stateTimer = t; }

  update(dt, playerPos, daylight, playerRef) {
    const spec = this.spec;
    this.stateTimer -= dt;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.position);
    const dist = toPlayer.length();
    const activityBias = spec.nocturnal ? (1 - daylight) : daylight;

    // Détection du joueur
    const alertDist = spec.alert * (0.6 + activityBias * 0.6);
    if (dist < alertDist && this.state !== 'flee' && this.state !== 'charge') {
      this.alerted = clamp(this.alerted + dt * (1.4 - dist / alertDist), 0, 1.6);
      if (this.alerted > 0.6) {
        if (dist < spec.flee) {
          if (spec.dangerous && dist < spec.flee * 0.55 && this.rng() < 0.35) this.setState('charge', 5);
          else this.setState('flee', this.rng.range(3, 7));
        } else this.setState('watch', 2.5);
      }
    } else if (dist > alertDist * 1.4) {
      this.alerted = Math.max(0, this.alerted - dt * 0.4);
    }

    let desiredSpeed = 0;
    switch (this.state) {
      case 'graze':
        desiredSpeed = 0;
        if (this.stateTimer <= 0) this.setState(this.rng() < 0.55 ? 'wander' : (this.rng() < 0.4 ? 'thirsty' : 'rest'), this.rng.range(4, 12));
        break;
      case 'rest':
        desiredSpeed = 0;
        if (this.stateTimer <= 0) this.setState('graze', this.rng.range(4, 10));
        break;
      case 'wander':
        if (this.target.distanceTo(this.position) < 2.5 || this.stateTimer <= 0) {
          this.pickWanderTarget();
          this.setState(this.rng() < 0.5 ? 'graze' : 'wander', this.rng.range(4, 10));
        }
        desiredSpeed = spec.speed * (0.55 + activityBias * 0.5);
        break;
      case 'thirsty':
        if (!this.pickWaterTarget()) { this.setState('wander', 6); break; }
        this.setState('drink_travel', 22);
        break;
      case 'drink_travel':
        desiredSpeed = spec.speed;
        if (this.target.distanceTo(this.position) < 3 || this.stateTimer <= 0) this.setState('drink', 6);
        break;
      case 'drink':
        desiredSpeed = 0;
        if (this.stateTimer <= 0) this.setState('wander', 8);
        break;
      case 'watch':
        desiredSpeed = 0;
        this.yaw = Math.atan2(toPlayer.x, toPlayer.z);
        if (this.stateTimer <= 0) this.setState(dist < spec.flee * 1.3 ? 'flee' : 'graze', this.rng.range(4, 8));
        break;
      case 'flee': {
        desiredSpeed = spec.runSpeed;
        const away = this.position.clone().sub(playerPos).setY(0).normalize();
        this.target.copy(this.position).add(away.multiplyScalar(24));
        if (this.stateTimer <= 0 && dist > spec.flee * 1.6) this.setState('wander', 6);
        break;
      }
      case 'charge': {
        desiredSpeed = spec.runSpeed * 0.92;
        this.target.copy(playerPos);
        if (dist < 1.9 && this.attackCooldown <= 0) {
          this.attackCooldown = 2.2;
          playerRef?.stats.damage(spec.damage || 10, `attaque de ${spec.label.toLowerCase()}`);
          bus.emit('audio:sfx', { name: 'hurt' });
          bus.emit('notify', { text: `Un ${spec.label.toLowerCase()} vous charge !`, kind: 'warn' });
        }
        if (this.stateTimer <= 0) this.setState('flee', 5);
        break;
      }
    }

    // Déplacement
    if (desiredSpeed > 0) {
      const dir = new THREE.Vector3().subVectors(this.target, this.position).setY(0);
      const len = dir.length();
      if (len > 0.1) {
        dir.divideScalar(len);
        const targetYaw = Math.atan2(dir.x, dir.z);
        let diff = targetYaw - this.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.yaw += clamp(diff, -3.2 * dt, 3.2 * dt);
        const step = desiredSpeed * dt;
        const nx = this.position.x + Math.sin(this.yaw) * step;
        const nz = this.position.z + Math.cos(this.yaw) * step;
        const nh = this.terrain.height(nx, nz);
        // les animaux évitent l'eau profonde et les falaises
        const slopeOk = Math.abs(nh - this.position.y) < step * 2.2 + 0.4;
        if (nh > WORLD.waterLevel - 0.3 && slopeOk) {
          this.position.x = nx;
          this.position.z = nz;
        } else {
          this.pickWanderTarget();
        }
      }
    }
    this.speed = damp(this.speed, desiredSpeed, 6, dt);
    this.position.y = this.terrain.height(this.position.x, this.position.z);

    if (this.mesh) {
      this.mesh.position.copy(this.position);
      this.mesh.rotation.y = this.yaw;
      this.legPhase += this.speed * dt * 3.4;
      const swing = Math.sin(this.legPhase) * clamp(this.speed / spec.runSpeed, 0, 1) * 0.8;
      if (this.legs) {
        this.legs[0].rotation.x = swing;
        this.legs[1].rotation.x = -swing;
        this.legs[2].rotation.x = -swing;
        this.legs[3].rotation.x = swing;
      }
      if (this.neck) {
        const grazing = this.state === 'graze' || this.state === 'drink';
        this.neck.rotation.x = damp(this.neck.rotation.x, grazing ? 0.95 : (this.state === 'watch' ? -0.15 : 0.1), 3, dt);
      }
    }
  }
}

export class AnimalManager {
  constructor(scene, terrain, seed) {
    this.scene = scene;
    this.terrain = terrain;
    this.rng = makeRng(seed ^ 0x1234);
    this.animals = [];
    this.spawnTimer = 0;
    this.birds = null;
    this.buildBirds();
  }

  /** Oiseaux : nuée de points animés, très peu coûteuse. */
  buildBirds() {
    const count = 90;
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 300;
      pos[i * 3 + 1] = 40 + Math.random() * 60;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 300;
    }
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x2a2a28, size: 1.4, sizeAttenuation: true, transparent: true, opacity: 0.75 });
    this.birds = new THREE.Points(geom, mat);
    this.birds.frustumCulled = false;
    this.scene.add(this.birds);
    this.birdPhase = 0;
  }

  spawnAround(playerPos, daylight) {
    const budget = settings.preset.animals;
    if (this.animals.length >= budget) return;
    const rng = this.rng;
    const a = rng() * Math.PI * 2;
    const r = rng.range(55, 130);
    const x = clamp(playerPos.x + Math.cos(a) * r, -WORLD.half + 30, WORLD.half - 30);
    const z = clamp(playerPos.z + Math.sin(a) * r, -WORLD.half + 30, WORLD.half - 30);
    const h = this.terrain.height(x, z);
    if (h < WORLD.waterLevel + 0.5 || h > 240) return;

    const density = this.terrain.treeDensity(x, z);
    const night = daylight < 0.35;
    const table = [
      { w: density > 0.4 ? 8 : 3, v: 'deer' },
      { w: density > 0.5 ? 6 : 2, v: 'boar' },
      { w: night ? 6 : 3, v: 'fox' },
      { w: 9, v: 'rabbit' },
      { w: night && density > 0.45 ? 3 : 0.4, v: 'wolf' },
    ];
    const key = rng.weighted(table).v;
    const spec = SPECIES[key];
    const groupSize = rng.int(spec.group[0], spec.group[1]);
    for (let i = 0; i < groupSize && this.animals.length < budget; i++) {
      const ox = x + rng.range(-8, 8), oz = z + rng.range(-8, 8);
      const animal = new Animal(key, ox, oz, this.terrain, makeRng(hashInt(this.rng() * 1e9 | 0, i)));
      animal.ensureMesh(this.scene);
      this.animals.push(animal);
    }
  }

  update(dt, playerPos, daylight, player) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 3.5;
      this.spawnAround(playerPos, daylight);
    }

    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i];
      const d = Math.hypot(a.position.x - playerPos.x, a.position.z - playerPos.z);
      if (d > 220 || a.dead) {
        a.removeMesh(this.scene);
        this.animals.splice(i, 1);
        continue;
      }
      // IA simplifiée au loin (économie CPU)
      if (d > 110) {
        if (a.mesh) a.removeMesh(this.scene);
        a.update(dt * 0.35, playerPos, daylight, player);
        continue;
      }
      a.ensureMesh(this.scene);
      a.update(dt, playerPos, daylight, player);
    }

    // Oiseaux : cercle lent autour du joueur, plus actifs le jour
    this.birdPhase += dt * 0.22;
    if (this.birds) {
      this.birds.visible = daylight > 0.25;
      this.birds.position.set(playerPos.x, 0, playerPos.z);
      this.birds.rotation.y = this.birdPhase;
    }
  }

  /** Attaque du joueur : renvoie l'animal touché. */
  hitScan(origin, direction, range, damage) {
    let best = null, bestD = range;
    for (const a of this.animals) {
      const to = new THREE.Vector3().subVectors(a.position.clone().setY(a.position.y + 0.6), origin);
      const dist = to.length();
      if (dist > bestD) continue;
      to.divideScalar(dist);
      if (to.dot(direction) < 0.86) continue;
      best = a; bestD = dist;
    }
    if (!best) return null;
    const killed = best.hurt(damage, true);
    return { animal: best, killed };
  }

  nearest(pos, maxDist = 4) {
    let best = null, bestD = maxDist;
    for (const a of this.animals) {
      const d = a.position.distanceTo(pos);
      if (d < bestD) { best = a; bestD = d; }
    }
    return best;
  }
}
