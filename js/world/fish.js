/**
 * fish.js — Poissonnerie du monde : bancs visibles sous la surface et
 * mini-jeu de pêche à la ligne.
 *
 * Les bancs sont purement décoratifs (non persistés) : ils se répartissent
 * autour du joueur près des eaux profondes. La densité qu'ils renvoient
 * influence le temps d'attente et la réussite de la pêche.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { WORLD } from '../core/config.js';
import { makeRng, hashInt } from '../core/rng.js';

const SHOAL_COUNT = 6;
const FISH_PER_SHOAL = 14;
const RIPPLE_POOL = 8;

/** Mini-jeu de pêche, isolé du reste pour être testable tête haute. */
export class FishingGame {
  constructor(rng) { this.rng = rng; this.reset(); }

  reset() {
    this.phase = 'idle';        // idle | wait | bite
    this.t = 0;
    this.density = 0;
    this.tries = 0;
  }

  get active() { return this.phase !== 'idle'; }

  /** Lance la ligne. density ∈ [0,1] selon la proximité d'un banc. */
  cast(density) {
    if (this.active) return false;
    this.density = density;
    this.phase = 'wait';
    this.tries++;
    //près d'un banc : ça mord vite ; eau vide : longue attente, souvent rien
    if (density > 0.12) this.t = this.rng.range(3, 7);
    else this.t = this.rng.range(9, 16);
    return true;
  }

  update(dt) {
    if (this.phase === 'wait') {
      this.t -= dt;
      if (this.t <= 0) {
        if (this.density > 0.12 || this.rng() < 0.3) {
          this.phase = 'bite';
          this.t = 1.7;         // fenêtre pour ferrer
        } else {
          this.reset();
          return 'nothing';     // rien ne mord
        }
      }
    } else if (this.phase === 'bite') {
      this.t -= dt;
      if (this.t <= 0) {
        this.reset();
        return 'late';          // trop tard
      }
    }
    return null;
  }

  /** Ferre. Renvoie 'caught' | 'early' | 'missed'. */
  reel() {
    if (this.phase === 'bite') {
      // même au bon moment, le poisson se décroche parfois
      const ok = this.rng() < 0.82;
      this.reset();
      return ok ? 'caught' : 'missed';
    }
    if (this.phase === 'wait') {
      this.reset();
      return 'early';           // ligne relevée sans attendre
    }
    return 'idle';
  }
}

export class FishShoals {
  constructor(scene, terrain, water) {
    this.scene = scene;
    this.terrain = terrain;
    this.water = water;
    this.rng = makeRng(WORLD.seed ^ 0xf152);
    this.shoals = [];           // {x,z,rx,rz,phase,speed,depth,rippleT}

    // Un seul InstancedMesh pour tous les poissons
    const geom = new THREE.SphereGeometry(1, 6, 5);
    geom.scale(0.05, 0.055, 0.16);
    this.fishMesh = new THREE.InstancedMesh(
      geom, new THREE.MeshStandardMaterial({ color: 0x39443a, roughness: 0.55, metalness: 0.1 }),
      SHOAL_COUNT * FISH_PER_SHOAL,
    );
    this.fishMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fishMesh.frustumCulled = false;
    this.fishMesh.count = 0;
    scene.add(this.fishMesh);

    // Anneaux de surface (à chaque touche, un cercle s'élargit)
    const ring = new THREE.RingGeometry(0.92, 1.0, 22);
    ring.rotateX(-Math.PI / 2);
    this.ripples = [];
    for (let i = 0; i < RIPPLE_POOL; i++) {
      const m = new THREE.Mesh(
        ring,
        new THREE.MeshBasicMaterial({ color: 0xbccdd2, transparent: true, opacity: 0, depthWrite: false }),
      );
      m.visible = false;
      m.userData.t = -1;
      scene.add(m);
      this.ripples.push(m);
    }

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._spawnCooldown = 0;
  }

  /** Fait apparaître un ripple à la surface. */
  ripple(x, z, scale = 1) {
    const r = this.ripples.find((m) => !m.visible);
    if (!r) return;
    r.visible = true;
    r.position.set(x, WORLD.waterLevel + 0.03, z);
    r.scale.setScalar(0.3 * scale);
    r.userData.t = 0;
    r.material.opacity = 0.4;
  }

  _trySpawnShoal(playerPos) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const ang = this.rng.range(0, Math.PI * 2);
      const dist = this.rng.range(18, 110);
      const x = playerPos.x + Math.cos(ang) * dist;
      const z = playerPos.z + Math.sin(ang) * dist;
      const depth = WORLD.waterLevel - this.terrain.height(x, z);
      if (depth < 1.1) continue;
      this.shoals.push({
        x, z,
        rx: this.rng.range(2.2, 5.5),
        rz: this.rng.range(1.4, 3.6),
        phase: this.rng.range(0, Math.PI * 2),
        speed: this.rng.range(0.25, 0.6) * (this.rng() < 0.5 ? 1 : -1),
        depth: Math.min(depth - 0.3, 0.9),
        rippleT: this.rng.range(2, 8),
      });
      return true;
    }
    return false;
  }

  /** Densité de poissons près d'un point (0..1) — pilote la pêche. */
  query(x, z) {
    let best = 0;
    for (const s of this.shoals) {
      const d = Math.hypot(s.x - x, s.z - z);
      const reach = Math.max(s.rx, s.rz) + 3;
      if (d < reach) best = Math.max(best, 1 - d / reach);
    }
    return best;
  }

  update(dt, playerPos, elapsed = 0) {
    // recyclage des bancs trop loin
    for (let i = this.shoals.length - 1; i >= 0; i--) {
      const s = this.shoals[i];
      if (Math.hypot(s.x - playerPos.x, s.z - playerPos.z) > 160) this.shoals.splice(i, 1);
    }
    this._spawnCooldown -= dt;
    if (this.shoals.length < SHOAL_COUNT && this._spawnCooldown <= 0) {
      this._trySpawnShoal(playerPos);
      this._spawnCooldown = 0.4;
    }

    // ripples
    for (const r of this.ripples) {
      if (!r.visible) continue;
      r.userData.t += dt;
      const t = r.userData.t / 1.9;
      if (t >= 1) { r.visible = false; continue; }
      r.scale.setScalar(0.3 + t * 2.2);
      r.material.opacity = 0.4 * (1 - t);
    }

    // poissons : trajectoires elliptiques par banc
    let n = 0;
    for (const s of this.shoals) {
      s.phase += s.speed * dt;
      s.rippleT -= dt;
      if (s.rippleT <= 0) {
        this.ripple(s.x + Math.cos(s.phase) * s.rx, s.z + Math.sin(s.phase) * s.rz, 0.8);
        s.rippleT = this.rng.range(3, 9);
      }
      const near = Math.hypot(s.x - playerPos.x, s.z - playerPos.z) < 130;
      if (!near || n + FISH_PER_SHOAL > this.fishMesh.instanceMatrix.count) continue;
      for (let i = 0; i < FISH_PER_SHOAL; i++) {
        const a = s.phase + (i / FISH_PER_SHOAL) * Math.PI * 2 + Math.sin(elapsed * 0.7 + i * 2.1) * 0.22;
        const fx = s.x + Math.cos(a) * s.rx;
        const fz = s.z + Math.sin(a) * s.rz;
        const fy = WORLD.waterLevel - s.depth - 0.15 * Math.sin(elapsed * 1.3 + i * 1.7);
        // orienté selon la tangente de l'ellipse
        const heading = a + Math.PI / 2 * Math.sign(s.speed);
        this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -heading);
        this._v.set(fx, fy, fz);
        this._m.compose(this._v, this._q, this._s);
        this.fishMesh.setMatrixAt(n++, this._m);
      }
    }
    this.fishMesh.count = n;
    if (n > 0) this.fishMesh.instanceMatrix.needsUpdate = true;
  }
}
