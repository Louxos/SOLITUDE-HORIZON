/**
 * chunks.js — Découpage du monde en chunks avec LOD, budget de construction
 * par frame et déchargement des zones lointaines.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { WORLD } from '../core/config.js';
import { settings } from '../core/settings.js';
import { getTexture } from '../core/textures.js';
import { clamp, smoothstep, lerp } from '../core/noise.js';
import { buildChunkVegetation } from './vegetation.js';

const LOD_SEGMENTS = [64, 28, 14, 8];

function lodForDistance(d) {
  if (d <= 1) return 0;
  if (d <= 2) return 1;
  if (d <= 5) return 2;
  return 3;
}

export class ChunkManager {
  constructor(scene, terrain, vegFactory) {
    this.scene = scene;
    this.terrain = terrain;
    this.veg = vegFactory;
    this.chunks = new Map();     // key -> {cx,cz,lod,mesh,veg}
    this.queue = [];
    this.material = new THREE.MeshStandardMaterial({
      map: getTexture('groundDetail'),
      normalMap: getTexture('groundNormal'),
      normalScale: new THREE.Vector2(0.85, 0.85),
      vertexColors: true,
      roughness: 0.97,
      metalness: 0.0,
      dithering: true,
    });
    this.material.map.repeat.set(28, 28);
    this.material.normalMap.repeat.set(46, 46);
    this.wetness = 0;
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uWet = this._wetUniform = { value: 0 };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uWet;')
        .replace('#include <color_fragment>', `
          #include <color_fragment>
          diffuseColor.rgb *= mix(1.0, 0.62, uWet);
        `)
        .replace('#include <roughnessmap_fragment>', `
          #include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.32, uWet * 0.85);
        `);
    };
  }

  key(cx, cz) { return `${cx},${cz}`; }

  setWetness(v) {
    this.wetness = v;
    if (this._wetUniform) this._wetUniform.value = v;
  }

  /** Construit la géométrie d'un chunk (grille + jupe anti-fissures). */
  buildGeometry(cx, cz, lod) {
    const terrain = this.terrain;
    const size = WORLD.chunkSize;
    const n = LOD_SEGMENTS[lod];
    const step = size / n;
    const ox = cx * size, oz = cz * size;
    const vcount = (n + 1) * (n + 1);

    const heights = new Float32Array(vcount);
    const positions = new Float32Array((vcount + (n + 1) * 4) * 3);
    const normals = new Float32Array((vcount + (n + 1) * 4) * 3);
    const colors = new Float32Array((vcount + (n + 1) * 4) * 3);
    const uvs = new Float32Array((vcount + (n + 1) * 4) * 2);

    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = ox + i * step, z = oz + j * step;
        const h = terrain.height(x, z);
        heights[j * (n + 1) + i] = h;
        const v = (j * (n + 1) + i) * 3;
        positions[v] = x - ox;
        positions[v + 1] = h;
        positions[v + 2] = z - oz;
        uvs[(j * (n + 1) + i) * 2] = i / n;
        uvs[(j * (n + 1) + i) * 2 + 1] = j / n;
      }
    }

    // Normales par différences finies sur la grille
    const H = (i, j) => heights[clamp(j, 0, n) * (n + 1) + clamp(i, 0, n)];
    const tmp = new THREE.Vector3();
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const idx = j * (n + 1) + i;
        const dx = (H(i - 1, j) - H(i + 1, j)) / (2 * step);
        const dz = (H(i, j - 1) - H(i, j + 1)) / (2 * step);
        tmp.set(dx, 1, dz).normalize();
        normals[idx * 3] = tmp.x; normals[idx * 3 + 1] = tmp.y; normals[idx * 3 + 2] = tmp.z;

        // ---- Coloration du sol ----
        const x = ox + i * step, z = oz + j * step;
        const h = heights[idx];
        const slopeF = 1 - tmp.y;                        // 0 = plat
        const depth = h - WORLD.waterLevel;
        const moist = terrain.moisture(x, z);
        const varN = terrain.nDetail.fbm(x * 0.02, z * 0.02, 2) * 0.5 + 0.5;
        const patch = terrain.nDetail.fbm(x * 0.0032 + 3, z * 0.0032 - 8, 3) * 0.5 + 0.5;

        // herbe -> selon humidité, saison sèche des champs
        let r = lerp(0.30, 0.20, moist) + varN * 0.07;
        let g = lerp(0.31, 0.34, moist) + varN * 0.09;
        let b = lerp(0.16, 0.15, moist) + varN * 0.04;
        // champs abandonnés (plus jaunes/secs)
        const field = smoothstep(0.28, 0.5, terrain.nField.fbm(x * 0.00085 - 90, z * 0.00085 + 55, 2)) * (1 - smoothstep(0.1, 0.25, slopeF));
        r = lerp(r, 0.36 + varN * 0.08, field * 0.8);
        g = lerp(g, 0.33 + varN * 0.07, field * 0.8);
        b = lerp(b, 0.16, field * 0.8);
        // patchs de terre nue
        const bare = smoothstep(0.62, 0.78, patch) * 0.6;
        r = lerp(r, 0.29 + varN * 0.05, bare);
        g = lerp(g, 0.23 + varN * 0.04, bare);
        b = lerp(b, 0.16, bare);

        // roche selon pente et altitude
        const rockF = clamp(smoothstep(0.16, 0.42, slopeF) + smoothstep(180, 260, h) * 0.8, 0, 1);
        const rg = 0.33 + varN * 0.13;
        r = lerp(r, rg, rockF); g = lerp(g, rg * 0.99, rockF); b = lerp(b, rg * 0.95, rockF);

        // neige sur les sommets
        const snow = smoothstep(320, 380, h) * (1 - smoothstep(0.42, 0.7, slopeF));
        r = lerp(r, 0.86, snow); g = lerp(g, 0.88, snow); b = lerp(b, 0.9, snow);

        // sable / berges
        const sand = 1 - smoothstep(0.4, 2.6, depth);
        r = lerp(r, 0.46 + varN * 0.06, sand); g = lerp(g, 0.42 + varN * 0.05, sand); b = lerp(b, 0.31, sand);

        // fond de lac plus sombre
        const under = smoothstep(0, -3.5, depth);
        r = lerp(r, 0.19, under * 0.8); g = lerp(g, 0.20, under * 0.8); b = lerp(b, 0.16, under * 0.8);

        // routes
        const inf = terrain.roads.influence(x, z);
        if (inf.w > 0) {
          let rr, rgc, rb;
          if (inf.kind === 'asphalt') { rr = 0.10 + varN * 0.05; rgc = 0.10 + varN * 0.05; rb = 0.095 + varN * 0.04; }
          else if (inf.kind === 'gravel') { rr = 0.26 + varN * 0.08; rgc = 0.25 + varN * 0.07; rb = 0.23 + varN * 0.06; }
          else { rr = 0.28 + varN * 0.06; rgc = 0.22 + varN * 0.05; rb = 0.15 + varN * 0.03; }
          const w = Math.pow(inf.w, 0.7);
          r = lerp(r, rr, w); g = lerp(g, rgc, w); b = lerp(b, rb, w);
        }

        colors[idx * 3] = r; colors[idx * 3 + 1] = g; colors[idx * 3 + 2] = b;
      }
    }

    // Indices de la grille
    const indices = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        const b = a + 1;
        const c = a + (n + 1);
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    // Jupe périphérique : masque les fissures entre LOD différents
    let skirt = vcount;
    const addSkirt = (idx) => {
      const p = idx * 3;
      const s = skirt * 3;
      positions[s] = positions[p];
      positions[s + 1] = positions[p + 1] - 6;
      positions[s + 2] = positions[p + 2];
      normals[s] = normals[p]; normals[s + 1] = normals[p + 1]; normals[s + 2] = normals[p + 2];
      colors[s] = colors[p] * 0.85; colors[s + 1] = colors[p + 1] * 0.85; colors[s + 2] = colors[p + 2] * 0.85;
      uvs[skirt * 2] = uvs[idx * 2]; uvs[skirt * 2 + 1] = uvs[idx * 2 + 1];
      return skirt++;
    };
    const edges = [
      Array.from({ length: n + 1 }, (_, i) => i),                              // j=0
      Array.from({ length: n + 1 }, (_, i) => n * (n + 1) + i),                // j=n
      Array.from({ length: n + 1 }, (_, j) => j * (n + 1)),                    // i=0
      Array.from({ length: n + 1 }, (_, j) => j * (n + 1) + n),                // i=n
    ];
    edges.forEach((edge, e) => {
      const low = edge.map(addSkirt);
      for (let k = 0; k < edge.length - 1; k++) {
        const a = edge[k], b = edge[k + 1], c = low[k], d = low[k + 1];
        if (e === 0 || e === 3) indices.push(a, b, c, b, d, c);
        else indices.push(a, c, b, b, c, d);
      }
    });

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    geom.computeBoundingSphere();
    return geom;
  }

  createChunk(cx, cz, lod) {
    const geom = this.buildGeometry(cx, cz, lod);
    const mesh = new THREE.Mesh(geom, this.material);
    mesh.position.set(cx * WORLD.chunkSize, 0, cz * WORLD.chunkSize);
    mesh.receiveShadow = settings.preset.shadows;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.name = `chunk_${cx}_${cz}`;
    this.scene.add(mesh);

    let veg = null;
    if (lod <= 1) {
      veg = buildChunkVegetation(this.veg, this.terrain, cx, cz, lod);
      this.scene.add(veg);
    }
    return { cx, cz, lod, mesh, veg };
  }

  disposeChunk(chunk) {
    this.scene.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    if (chunk.veg) {
      this.scene.remove(chunk.veg);
      chunk.veg.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    }
  }

  /** Colliders (troncs, rochers) des chunks proches. */
  nearbyColliders(x, z, out = []) {
    const cs = WORLD.chunkSize;
    const cx = Math.floor(x / cs), cz = Math.floor(z / cs);
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const c = this.chunks.get(this.key(cx + i, cz + j));
        if (c?.veg?.userData.colliders) out.push(...c.veg.userData.colliders);
      }
    }
    return out;
  }

  update(dt, playerPos) {
    const cs = WORLD.chunkSize;
    const pcx = Math.floor(playerPos.x / cs);
    const pcz = Math.floor(playerPos.z / cs);
    const radius = settings.preset.chunkRadius;

    // Chunks souhaités
    const wanted = new Map();
    for (let j = -radius; j <= radius; j++) {
      for (let i = -radius; i <= radius; i++) {
        const d = Math.max(Math.abs(i), Math.abs(j));
        if (d > radius) continue;
        const cx = pcx + i, cz = pcz + j;
        // hors du monde
        if (Math.abs(cx * cs) > WORLD.half + cs * 2 || Math.abs(cz * cs) > WORLD.half + cs * 2) continue;
        wanted.set(this.key(cx, cz), { cx, cz, lod: lodForDistance(d), d });
      }
    }

    // Déchargement
    for (const [key, chunk] of this.chunks) {
      if (!wanted.has(key)) {
        this.disposeChunk(chunk);
        this.chunks.delete(key);
      }
    }

    // File de construction triée par proximité
    this.queue.length = 0;
    for (const [key, w] of wanted) {
      const existing = this.chunks.get(key);
      if (!existing) this.queue.push({ ...w, key, priority: w.d });
      else if (existing.lod !== w.lod) this.queue.push({ ...w, key, priority: w.d + 0.5 });
    }
    this.queue.sort((a, b) => a.priority - b.priority);

    // Budget : quelques ms par frame maximum
    const budget = performance.now() + (this.chunks.size < 12 ? 26 : 7);
    while (this.queue.length && performance.now() < budget) {
      const job = this.queue.shift();
      const old = this.chunks.get(job.key);
      if (old) { this.disposeChunk(old); this.chunks.delete(job.key); }
      this.chunks.set(job.key, this.createChunk(job.cx, job.cz, job.lod));
    }
  }

  /** Nombre de chunks encore à construire (écran de chargement). */
  get pending() { return this.queue.length; }
}
