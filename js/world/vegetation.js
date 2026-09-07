/**
 * vegetation.js — Arbres, arbustes, fougères, rochers, herbe.
 * Tout est instancié (InstancedMesh) et généré depuis la seed du chunk.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { getTexture } from '../core/textures.js';
import { mergeGeometries, transformGeometry, colorize } from '../core/geometry.js';
import { makeRng, hashInt } from '../core/rng.js';
import { settings } from '../core/settings.js';
import { BIOME } from './terrain.js';
import { WORLD } from '../core/config.js';

const SPECIES = ['pine', 'spruce', 'oak', 'birch', 'dead'];

function makeTrunkGeom(rng, height, radius, lean) {
  const g = new THREE.CylinderGeometry(radius * 0.62, radius, height, 6, 2);
  transformGeometry(g, { pos: [0, height / 2, 0], rot: [lean * 0.6, 0, lean] });
  return g;
}

function makeConeFoliage(rng, baseY, height, radius) {
  const g = new THREE.ConeGeometry(radius, height, 7, 2);
  transformGeometry(g, { pos: [0, baseY + height / 2, 0], rot: [0, rng() * 3, 0] });
  return g;
}

function makeBlobFoliage(rng, y, r, off = 0) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  transformGeometry(g, {
    pos: [(rng() - 0.5) * off, y, (rng() - 0.5) * off],
    rot: [rng() * 3, rng() * 3, rng() * 3],
    scale: [1, 0.78 + rng() * 0.3, 1],
  });
  return g;
}

/** Construit les géométries de base d'une espèce (variante déterministe). */
function buildTree(species, variant) {
  const rng = makeRng(hashInt(0xbeef, SPECIES.indexOf(species), variant));
  const lean = (rng() - 0.5) * 0.09;
  let trunkParts = [], leafParts = [];

  if (species === 'pine' || species === 'spruce') {
    const h = species === 'pine' ? rng.range(11, 18) : rng.range(9, 15);
    const r = h * 0.028;
    trunkParts.push(makeTrunkGeom(rng, h, r, lean));
    const layers = 4 + Math.floor(rng() * 2);
    for (let i = 0; i < layers; i++) {
      const t = i / layers;
      const y = h * (0.28 + t * 0.62);
      const rad = h * (0.26 - t * 0.17) * (species === 'spruce' ? 1.12 : 1);
      leafParts.push(makeConeFoliage(rng, y, h * 0.3 * (1 - t * 0.35), rad));
    }
  } else if (species === 'oak') {
    const h = rng.range(8, 14);
    const r = h * 0.045;
    trunkParts.push(makeTrunkGeom(rng, h * 0.62, r, lean));
    // branches
    for (let i = 0; i < 3; i++) {
      const a = rng() * Math.PI * 2;
      const br = new THREE.CylinderGeometry(r * 0.22, r * 0.42, h * 0.4, 5);
      transformGeometry(br, {
        pos: [Math.cos(a) * h * 0.1, h * 0.55, Math.sin(a) * h * 0.1],
        rot: [Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5],
      });
      trunkParts.push(br);
    }
    const blobs = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < blobs; i++) {
      leafParts.push(makeBlobFoliage(rng, h * (0.62 + rng() * 0.32), h * (0.19 + rng() * 0.1), h * 0.35));
    }
  } else if (species === 'birch') {
    const h = rng.range(9, 15);
    const r = h * 0.022;
    trunkParts.push(colorize(makeTrunkGeom(rng, h, r, lean), 0xd8d5c8));
    for (let i = 0; i < 3; i++) {
      leafParts.push(makeBlobFoliage(rng, h * (0.66 + rng() * 0.3), h * (0.15 + rng() * 0.08), h * 0.28));
    }
  } else { // dead
    const h = rng.range(6, 12);
    const r = h * 0.035;
    trunkParts.push(colorize(makeTrunkGeom(rng, h, r, lean * 2.5), 0x6d6152));
    for (let i = 0; i < 4; i++) {
      const a = rng() * Math.PI * 2;
      const br = new THREE.CylinderGeometry(r * 0.14, r * 0.36, h * (0.25 + rng() * 0.3), 4);
      transformGeometry(br, {
        pos: [Math.cos(a) * h * 0.06, h * (0.4 + rng() * 0.45), Math.sin(a) * h * 0.06],
        rot: [Math.sin(a) * 0.9, 0, Math.cos(a) * 0.9],
      });
      trunkParts.push(colorize(br, 0x6d6152));
    }
  }

  for (const g of trunkParts) if (!g.attributes.color) colorize(g, 0xffffff);
  for (const g of leafParts) colorize(g, 0xffffff);

  return {
    trunk: mergeGeometries(trunkParts),
    leaves: leafParts.length ? mergeGeometries(leafParts) : null,
  };
}

/** Croix de plans texturés (buissons, fougères, hautes herbes). */
function buildCross(w, h, tiltable = true) {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const p = new THREE.PlaneGeometry(w, h, 1, 1);
    transformGeometry(p, { pos: [0, h / 2, 0], rot: [tiltable ? 0.06 : 0, (i / 3) * Math.PI, 0] });
    parts.push(colorize(p, 0xffffff));
  }
  return mergeGeometries(parts);
}

function buildRock(variant) {
  const rng = makeRng(hashInt(0x0c0c, variant));
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const s = 0.62 + rng() * 0.7;
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.72, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return colorize(g, 0xffffff);
}

export class VegetationFactory {
  constructor() {
    this.trees = {};
    for (const s of SPECIES) {
      this.trees[s] = [0, 1, 2].map((v) => buildTree(s, v));
    }
    this.bush = buildCross(1.7, 1.35);
    this.fern = buildCross(1.15, 0.75);
    this.tallGrass = buildCross(1.1, 0.85);
    this.rocks = [0, 1, 2].map(buildRock);

    const bark = getTexture('bark');
    bark.repeat.set(1, 3);
    this.trunkMat = new THREE.MeshStandardMaterial({
      map: bark, roughness: 0.94, metalness: 0, vertexColors: true,
    });

    const foliageTex = getTexture('foliage');
    this.leafMat = new THREE.MeshStandardMaterial({
      map: foliageTex, alphaTest: 0.42, transparent: false, side: THREE.DoubleSide,
      roughness: 0.86, metalness: 0, vertexColors: true,
    });
    this.applyWind(this.leafMat, 1.0);

    this.bushMat = new THREE.MeshStandardMaterial({
      map: foliageTex, alphaTest: 0.4, side: THREE.DoubleSide,
      roughness: 0.9, metalness: 0, vertexColors: true,
    });
    this.applyWind(this.bushMat, 1.4);

    const rockTex = getTexture('rock');
    this.rockMat = new THREE.MeshStandardMaterial({
      map: rockTex, normalMap: getTexture('groundNormal'), roughness: 0.96, metalness: 0, vertexColors: true,
    });

    this.windUniforms = this._windUniforms || [];
  }

  /** Ajoute une animation de vent au vertex shader (coût quasi nul). */
  applyWind(material, strength) {
    material.userData.wind = { value: new THREE.Vector4(0, strength, 0, 0) };
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uWind = material.userData.wind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform vec4 uWind;`)
        .replace('#include <begin_vertex>', `
          #include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 iOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
            vec3 iOrigin = vec3(0.0);
          #endif
          float sway = sin(uWind.x * 1.7 + iOrigin.x * 0.28 + iOrigin.z * 0.19) * 0.5
                     + sin(uWind.x * 0.83 + iOrigin.z * 0.11) * 0.5;
          float hFactor = clamp(transformed.y * 0.16, 0.0, 1.6);
          transformed.x += sway * hFactor * uWind.y * (0.055 + uWind.z * 0.16);
          transformed.z += sway * hFactor * uWind.y * (0.035 + uWind.z * 0.11);
        `);
    };
    (this._windUniforms || (this._windUniforms = [])).push(material.userData.wind);
    material.needsUpdate = true;
  }

  updateWind(time, strength) {
    for (const u of this._windUniforms || []) {
      u.value.x = time;
      u.value.z = strength;
    }
  }
}

/**
 * Génère la végétation d'un chunk (déterministe).
 * Renvoie un THREE.Group prêt à être ajouté à la scène.
 */
export function buildChunkVegetation(factory, terrain, cx, cz, lod) {
  const size = WORLD.chunkSize;
  const ox = cx * size, oz = cz * size;
  const group = new THREE.Group();
  group.name = `veg_${cx}_${cz}`;
  const rng = makeRng(hashInt(terrain.seed, cx, cz, 77));
  const preset = settings.preset;

  const spacing = lod === 0 ? 6.5 : 9.0;
  const cols = Math.floor(size / spacing);

  const buckets = {};              // espèce -> [matrices, couleurs]
  const bushes = [], ferns = [], rocks = [[], [], []];
  const trunkAABB = [];            // collisions arbres (cylindres approximés)

  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < cols; j++) {
      const x = ox + (i + rng()) * spacing;
      const z = oz + (j + rng()) * spacing;
      const density = terrain.treeDensity(x, z);
      if (density <= 0.02) continue;

      const y = terrain.height(x, z);
      const biome = terrain.biomeAt(x, z);
      const roll = rng();

      // --- Arbres ---
      if (roll < density * 0.55 * preset.treeDensity) {
        let species;
        if (y > 145) species = rng() < 0.72 ? 'spruce' : 'pine';
        else if (biome === BIOME.DENSE_FOREST) species = rng() < 0.5 ? 'pine' : (rng() < 0.6 ? 'oak' : 'spruce');
        else if (biome === BIOME.WETLAND) species = rng() < 0.55 ? 'birch' : 'oak';
        else species = rng() < 0.45 ? 'oak' : (rng() < 0.6 ? 'birch' : 'pine');
        if (rng() < 0.07) species = 'dead';

        const variant = rng.int(0, 2);
        const key = `${species}:${variant}`;
        if (!buckets[key]) buckets[key] = { species, variant, m: [], c: [] };
        const scale = 0.72 + rng() * 0.66 * (biome === BIOME.DENSE_FOREST ? 1.12 : 1);
        const mtx = new THREE.Matrix4().compose(
          new THREE.Vector3(x, y - 0.25, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng() * Math.PI * 2, 0)),
          new THREE.Vector3(scale, scale * (0.9 + rng() * 0.25), scale),
        );
        buckets[key].m.push(mtx);
        // Variation de teinte : évite l'effet copier-coller
        const tint = new THREE.Color().setHSL(0.24 + (rng() - 0.5) * 0.045, 0.32 + rng() * 0.2, 0.34 + rng() * 0.16);
        buckets[key].c.push(tint);
        if (lod === 0) trunkAABB.push({ x, z, r: 0.32 * scale + 0.12, y, h: 6 * scale });
        continue;
      }

      // --- Sous-bois ---
      if (roll < density * 0.55 + 0.20) {
        const which = rng();
        const mtx = new THREE.Matrix4().compose(
          new THREE.Vector3(x, y - 0.05, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng() * Math.PI * 2, 0)),
          new THREE.Vector3(0.7 + rng() * 0.9, 0.7 + rng() * 1.0, 0.7 + rng() * 0.9),
        );
        const tint = new THREE.Color().setHSL(0.23 + (rng() - 0.5) * 0.05, 0.3 + rng() * 0.22, 0.28 + rng() * 0.18);
        if (which < 0.45) { bushes.push({ mtx, tint }); }
        else { ferns.push({ mtx, tint }); }
        continue;
      }

      // --- Rochers ---
      const slope = terrain.slope(x, z);
      if (rng() < 0.035 + (slope > 26 ? 0.11 : 0) + (y > 175 ? 0.09 : 0)) {
        const v = rng.int(0, 2);
        const s = 0.35 + rng() * (y > 150 ? 2.6 : 1.1);
        const mtx = new THREE.Matrix4().compose(
          new THREE.Vector3(x, y - s * 0.28, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 0.4, rng() * 6.28, rng() * 0.4)),
          new THREE.Vector3(s, s * (0.6 + rng() * 0.5), s),
        );
        const g = 0.55 + rng() * 0.45;
        rocks[v].push({ mtx, tint: new THREE.Color(g * 0.95, g * 0.95, g * 0.9) });
        if (s > 1.2 && lod === 0) trunkAABB.push({ x, z, r: s * 0.8, y, h: s * 1.2 });
      }
    }
  }

  const makeInstanced = (geom, mat, entries, castShadow) => {
    if (!entries.length) return null;
    const mesh = new THREE.InstancedMesh(geom, mat, entries.length);
    const col = new THREE.Color();
    entries.forEach((e, i) => {
      mesh.setMatrixAt(i, e.mtx);
      mesh.setColorAt(i, e.tint || col.set(0xffffff));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = castShadow && settings.preset.shadows;
    mesh.receiveShadow = settings.preset.shadows;
    mesh.frustumCulled = true;
    group.add(mesh);
    return mesh;
  };

  for (const key of Object.keys(buckets)) {
    const b = buckets[key];
    const geo = factory.trees[b.species][b.variant];
    const entries = b.m.map((mtx, i) => ({ mtx, tint: new THREE.Color(0.72, 0.68, 0.62) }));
    makeInstanced(geo.trunk, factory.trunkMat, entries, true);
    if (geo.leaves) {
      makeInstanced(geo.leaves, factory.leafMat, b.m.map((mtx, i) => ({ mtx, tint: b.c[i] })), true);
    }
  }
  makeInstanced(factory.bush, factory.bushMat, bushes, false);
  makeInstanced(factory.fern, factory.bushMat, ferns, false);
  rocks.forEach((list, i) => makeInstanced(factory.rocks[i], factory.rockMat, list, true));

  group.userData.colliders = trunkAABB;
  return group;
}

/**
 * Champ d'herbe dense autour du joueur (rayon limité, recyclé au déplacement).
 */
export class GrassField {
  constructor(scene, terrain, factory) {
    this.scene = scene;
    this.terrain = terrain;
    this.count = 9000;
    this.center = new THREE.Vector3(1e9, 0, 1e9);
    const geom = buildCross(0.55, 0.42);
    const tex = getTexture('grassBlade');
    this.material = new THREE.MeshStandardMaterial({
      map: tex, alphaTest: 0.35, side: THREE.DoubleSide,
      roughness: 1, metalness: 0, vertexColors: true,
    });
    factory.applyWind(this.material, 2.4);
    this.mesh = new THREE.InstancedMesh(geom, this.material, this.count);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = false;
    this.mesh.castShadow = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  setEnabled(on) { this.mesh.visible = on; }

  refresh(px, pz) {
    const radius = settings.preset.grassRadius;
    if (!settings.preset.grass || radius <= 0) { this.mesh.count = 0; return; }
    const rng = makeRng(hashInt(this.terrain.seed, Math.round(px / 8), Math.round(pz / 8), 5150));
    let n = 0;
    const target = Math.min(this.count, Math.floor(radius * radius * 3.1));
    for (let i = 0; i < target * 1.6 && n < target; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * radius;
      const x = px + Math.cos(a) * r;
      const z = pz + Math.sin(a) * r;
      const surf = this.terrain.surfaceAt(x, z);
      if (surf !== 'grass' && surf !== 'dirt') continue;
      const y = this.terrain.height(x, z);
      const dens = this.terrain.moisture(x, z);
      if (rng() > 0.35 + dens * 0.75) continue;
      const s = 0.7 + rng() * 1.5 + dens * 0.5;
      this._v.set(x, y - 0.04, z);
      this._q.setFromEuler(new THREE.Euler(0, rng() * 6.28, 0));
      this._s.set(s, s * (0.7 + rng() * 0.9), s);
      this._m.compose(this._v, this._q, this._s);
      this.mesh.setMatrixAt(n, this._m);
      this._c.setHSL(0.235 + (rng() - 0.5) * 0.05, 0.34 + rng() * 0.2, 0.26 + rng() * 0.18);
      this.mesh.setColorAt(n, this._c);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.center.set(px, 0, pz);
  }

  update(playerPos) {
    if (!settings.preset.grass) { this.mesh.count = 0; return; }
    const d = Math.hypot(playerPos.x - this.center.x, playerPos.z - this.center.z);
    if (d > settings.preset.grassRadius * 0.28) this.refresh(playerPos.x, playerPos.z);
  }
}
