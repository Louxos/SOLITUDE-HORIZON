/**
 * roads.js — Réseau routier déterministe (routes goudronnées + chemins de terre).
 * Les routes sont des polylignes générées depuis la seed ; elles servent aussi
 * à aplanir le terrain, à placer les bâtiments et les véhicules.
 */

import { WORLD } from '../core/config.js';
import { makeRng } from '../core/rng.js';
import { Noise } from '../core/noise.js';
import { clamp, smoothstep } from '../core/noise.js';

const CELL = 128;

export class RoadNetwork {
  /**
   * @param {number} seed
   * @param {(x:number,z:number)=>number} baseHeight fonction d'altitude SANS route
   */
  constructor(seed, baseHeight) {
    this.seed = seed;
    this.baseHeight = baseHeight;
    this.noise = new Noise(seed ^ 0x5eed);
    this.roads = [];
    this.segments = [];
    this.grid = new Map();
    this.build();
  }

  build() {
    const rng = makeRng((this.seed ^ 0x20ad0000) >>> 0);
    const half = WORLD.half - 220;

    // 1 route principale traversante (nord-sud, sinueuse) + 1 est-ouest
    this.addRoad(this.makePath(-half, -half * 0.9, half, half * 0.6, 8.2, 'asphalt', 11));
    this.addRoad(this.makePath(-half, half * 0.35, half, -half * 0.25, 7.2, 'asphalt', 23));

    // Routes secondaires
    for (let i = 0; i < 3; i++) {
      const a = rng.range(-half, half), b = rng.range(-half, half);
      this.addRoad(this.makePath(a, -half, b, half, 5.4, 'gravel', 40 + i * 13));
    }
    // Chemins de terre courts reliant des zones intérieures
    for (let i = 0; i < 6; i++) {
      const x0 = rng.range(-half, half), z0 = rng.range(-half, half);
      const ang = rng.range(0, Math.PI * 2);
      const len = rng.range(420, 1100);
      this.addRoad(this.makePath(x0, z0, x0 + Math.cos(ang) * len, z0 + Math.sin(ang) * len, 3.4, 'dirt', 90 + i * 7));
    }
    this.indexSegments();
  }

  /** Génère une polyligne sinueuse entre deux points, perturbée par du bruit. */
  makePath(x0, z0, x1, z1, width, kind, salt) {
    const pts = [];
    const steps = Math.max(14, Math.round(Math.hypot(x1 - x0, z1 - z0) / 60));
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    const px = -dz / len, pz = dx / len;   // perpendiculaire
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const wobble = this.noise.fbm(t * 2.4 + salt, salt * 0.13, 3) * 210 * Math.sin(Math.PI * t);
      const x = x0 + dx * t + px * wobble;
      const z = z0 + dz * t + pz * wobble;
      pts.push({ x, z, y: 0 });
    }
    // Altitude lissée le long du tracé : la route "coupe" doucement le relief
    for (const p of pts) p.y = this.baseHeight(p.x, p.z);
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 1; i < pts.length - 1; i++) {
        pts[i].y = (pts[i - 1].y + pts[i].y * 2 + pts[i + 1].y) / 4;
      }
    }
    // Limitation de la pente : une route reste praticable (< 18 %)
    const MAX_GRADE = 0.17;
    for (let pass = 0; pass < 24; pass++) {
      let changed = false;
      for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z) || 1;
        const maxDy = d * MAX_GRADE;
        const dy = pts[i].y - pts[i - 1].y;
        if (Math.abs(dy) > maxDy) {
          const corr = (Math.abs(dy) - maxDy) * Math.sign(dy) * 0.5;
          pts[i].y -= corr;
          pts[i - 1].y += corr;
          changed = true;
        }
      }
      for (let i = pts.length - 2; i >= 0; i--) {
        const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z) || 1;
        const maxDy = d * MAX_GRADE;
        const dy = pts[i + 1].y - pts[i].y;
        if (Math.abs(dy) > maxDy) {
          const corr = (Math.abs(dy) - maxDy) * Math.sign(dy) * 0.5;
          pts[i + 1].y -= corr;
          pts[i].y += corr;
          changed = true;
        }
      }
      if (!changed) break;
    }
    // Les routes évitent de plonger sous l'eau
    for (const p of pts) p.y = Math.max(p.y, WORLD.waterLevel + 0.6);
    return { pts, width, kind };
  }

  addRoad(road) {
    this.roads.push(road);
    for (let i = 0; i < road.pts.length - 1; i++) {
      this.segments.push({ a: road.pts[i], b: road.pts[i + 1], width: road.width, kind: road.kind, road });
    }
  }

  indexSegments() {
    for (const seg of this.segments) {
      const minX = Math.min(seg.a.x, seg.b.x) - seg.width * 4;
      const maxX = Math.max(seg.a.x, seg.b.x) + seg.width * 4;
      const minZ = Math.min(seg.a.z, seg.b.z) - seg.width * 4;
      const maxZ = Math.max(seg.a.z, seg.b.z) + seg.width * 4;
      for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
        for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
          const key = cx * 73856093 ^ cz * 19349663;
          let arr = this.grid.get(key);
          if (!arr) { arr = []; this.grid.set(key, arr); }
          arr.push(seg);
        }
      }
    }
  }

  segmentsNear(x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const key = cx * 73856093 ^ cz * 19349663;
    return this.grid.get(key) || null;
  }

  /**
   * @returns {{dist:number, width:number, y:number, kind:string}|null}
   * distance au bord de la chaussée la plus proche + altitude de la route.
   */
  query(x, z) {
    const segs = this.segmentsNear(x, z);
    if (!segs) return null;
    let best = null, bestD = Infinity;
    for (const seg of segs) {
      const ax = seg.a.x, az = seg.a.z;
      const bx = seg.b.x, bz = seg.b.z;
      const vx = bx - ax, vz = bz - az;
      const l2 = vx * vx + vz * vz || 1;
      let t = ((x - ax) * vx + (z - az) * vz) / l2;
      t = clamp(t, 0, 1);
      const px = ax + vx * t, pz = az + vz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < bestD) {
        bestD = d;
        best = { dist: d, width: seg.width, y: seg.a.y + (seg.b.y - seg.a.y) * t, kind: seg.kind };
      }
    }
    return best;
  }

  /** Facteur d'influence [0,1] : 1 = pleine chaussée, 0 = terrain naturel. */
  influence(x, z) {
    const q = this.query(x, z);
    if (!q) return { w: 0, y: 0, kind: null, onRoad: false };
    const halfW = q.width * 0.5;
    const w = 1 - smoothstep(halfW, halfW + 9, q.dist);
    return { w, y: q.y, kind: q.kind, onRoad: q.dist < halfW };
  }

  /** Point aléatoire déterministe sur une route (pour placer épaves, panneaux…). */
  pointOnRoad(rng) {
    const road = rng.pick(this.roads);
    const i = rng.int(0, road.pts.length - 2);
    const t = rng();
    const a = road.pts[i], b = road.pts[i + 1];
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      y: a.y + (b.y - a.y) * t,
      angle: Math.atan2(b.x - a.x, b.z - a.z),
      width: road.width,
      kind: road.kind,
    };
  }
}
