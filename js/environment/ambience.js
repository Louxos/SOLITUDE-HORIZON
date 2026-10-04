/**
 * ambience.js — Deux présences discrètes qui changent tout :
 *
 *  - MistSystem : brume qui dort sur les lacs au petit matin (5 h – 10 h),
 *    nappes de billboards qui se dissipent quand le soleil monte.
 *  - MotesSystem : poussière en suspension dans les bâtiments, visible
 *    quand un rayon traverse la pièce.
 *
 * Les deux sont purement visuels, non persistés, et s'effacent sous la pluie.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { WORLD } from '../core/config.js';
import { makeRng } from '../core/rng.js';
import { clamp, smoothstep } from '../core/noise.js';

function softBlobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.38)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const MIST_PLANES = 16;
const MOTE_COUNT = 260;

export class AmbienceFX {
  constructor(scene, terrain, water) {
    this.scene = scene;
    this.terrain = terrain;
    this.water = water;
    this.rng = makeRng(WORLD.seed ^ 0xa2b1);
    this._time = 0;

    // --- Brume du matin ---
    this.mistTexture = softBlobTexture();
    this.mist = [];
    const mistMat = () => new THREE.MeshBasicMaterial({
      map: this.mistTexture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      color: 0xdfe6ea,
      fog: true,
    });
    for (let i = 0; i < MIST_PLANES; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mistMat());
      m.visible = false;
      m.userData = {
        base: this.rng.range(0.10, 0.26),
        size: this.rng.range(16, 42),
        drift: this.rng.range(0.15, 0.6),
        phase: this.rng.range(0, Math.PI * 2),
        ox: 0, oz: 0,
      };
      scene.add(m);
      this.mist.push(m);
    }
    this.mistAnchors = [];
    this._mistCooldown = 0;
    this.mistLevel = 0;

    // --- Poussière intérieure ---
    const positions = new Float32Array(MOTE_COUNT * 3);
    for (let i = 0; i < MOTE_COUNT; i++) {
      // répartition dans un rayon de 2,6 m autour de l'origine (relatif caméra)
      const a = this.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(this.rng()) * 2.6;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = this.rng.range(-1.2, 1.4);
      positions[i * 3 + 2] = Math.sin(a) * r;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.moteMat = new THREE.PointsMaterial({
      color: 0xfff0d8, size: 0.018, transparent: true, opacity: 0,
      depthWrite: false, sizeAttenuation: true,
    });
    this.motes = new THREE.Points(geom, this.moteMat);
    this.motes.frustumCulled = false;
    this.motes.visible = false;
    scene.add(this.motes);
    this.moteLevel = 0;
  }

  /** Intensité de la brume selon l'heure : pleine à l'aube, dissipée à 10 h. */
  static mistWindow(hour) {
    return clamp(smoothstep(4.6, 6.4, hour) - smoothstep(8.0, 10.4, hour), 0, 1);
  }

  _tryAnchorMist(playerPos) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const ang = this.rng.range(0, Math.PI * 2);
      const dist = this.rng.range(6, 130);
      const x = playerPos.x + Math.cos(ang) * dist;
      const z = playerPos.z + Math.sin(ang) * dist;
      const depth = WORLD.waterLevel - this.terrain.height(x, z);
      if (depth < 1.4) continue;
      this.mistAnchors.push({ x, z });
      if (this.mistAnchors.length > 5) this.mistAnchors.shift();
      return true;
    }
    return false;
  }

  update(dt, camera, hour, rainIntensity, sheltered, daylight) {
    this._time += dt;
    const pos = camera.position;

    // ---- Brume ----
    // visible tôt le matin, par temps calme, près de l'eau
    const nearWater = this.mistAnchors.some((a) => Math.hypot(a.x - pos.x, a.z - pos.z) < 150)
      || (this.water && this.water.depthAt(pos.x, pos.z) > 0);
    const target = AmbienceFX.mistWindow(hour) * (1 - clamp(rainIntensity * 1.6, 0, 1)) * (nearWater ? 1 : 0);
    this.mistLevel += (target - this.mistLevel) * clamp(dt * 0.4, 0, 1);
    const active = this.mistLevel > 0.02;

    this._mistCooldown -= dt;
    if (this._mistCooldown <= 0) {
      this._tryAnchorMist(pos);
      this._mistCooldown = 2.2;
    }

    for (const m of this.mist) {
      const u = m.userData;
      if (!active) { m.visible = false; continue; }
      m.visible = true;
      const a = this.mistAnchors.length
        ? this.mistAnchors[(Math.floor(u.phase * 10) + this.mist.indexOf(m)) % this.mistAnchors.length]
        : null;
      if (!a) { m.visible = false; continue; }
      m.position.set(
        a.x + Math.cos(this._time * u.drift + u.phase) * 6,
        WORLD.waterLevel + 0.35 + Math.sin(u.phase * 3.1) * 0.5,
        a.z + Math.sin(this._time * u.drift * 0.8 + u.phase) * 6,
      );
      m.scale.set(u.size, u.size * 0.5, 1);
      m.quaternion.copy(camera.quaternion);      // billboard doux
      m.material.opacity = u.base * this.mistLevel * (0.75 + 0.25 * Math.sin(this._time * 0.3 + u.phase));
    }

    // ---- Poussière (intérieurs) ----
    const motesTarget = sheltered ? clamp(daylight, 0.15, 1) * 0.5 : 0;
    this.moteLevel += (motesTarget - this.moteLevel) * clamp(dt * 1.5, 0, 1);
    this.motes.visible = this.moteLevel > 0.02;
    if (this.motes.visible) {
      this.motes.position.copy(pos);
      this.moteMat.opacity = this.moteLevel;
      const p = this.motes.geometry.attributes.position;
      // dérive lente : respiration de la pièce
      for (let i = 0; i < MOTE_COUNT; i += 3) {
        p.array[i * 3 + 1] += Math.sin(this._time * 0.4 + i) * 0.0006;
        p.array[i * 3] += Math.cos(this._time * 0.22 + i * 1.7) * 0.0004;
      }
      p.needsUpdate = true;
    }
  }
}
