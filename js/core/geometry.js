/**
 * geometry.js — Utilitaires de géométrie (fusion, transformation, helpers).
 * Évite de dépendre des addons three/examples : on garde un bundle minimal.
 */

import * as THREE from '../../vendor/three/three.module.min.js';

/** Fusionne des BufferGeometry (converties en non-indexées) en une seule. */
export function mergeGeometries(geoms) {
  const list = geoms.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of list) total += g.attributes.position.count;

  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const col = new Float32Array(total * 3);
  let hasColor = false;
  for (const g of list) if (g.attributes.color) hasColor = true;

  let o = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv, c = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      pos[(o + i) * 3] = p.getX(i);
      pos[(o + i) * 3 + 1] = p.getY(i);
      pos[(o + i) * 3 + 2] = p.getZ(i);
      if (n) {
        nrm[(o + i) * 3] = n.getX(i);
        nrm[(o + i) * 3 + 1] = n.getY(i);
        nrm[(o + i) * 3 + 2] = n.getZ(i);
      }
      if (u) {
        uv[(o + i) * 2] = u.getX(i);
        uv[(o + i) * 2 + 1] = u.getY(i);
      }
      if (hasColor) {
        col[(o + i) * 3] = c ? c.getX(i) : 1;
        col[(o + i) * 3 + 1] = c ? c.getY(i) : 1;
        col[(o + i) * 3 + 2] = c ? c.getZ(i) : 1;
      }
    }
    o += p.count;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (hasColor) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const g of list) if (!geoms.includes(g)) g.dispose();
  return out;
}

/** Applique une transformation à une géométrie (retourne la même instance). */
export function transformGeometry(geom, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ'));
  m.compose(new THREE.Vector3(pos[0], pos[1], pos[2]), q, new THREE.Vector3(scale[0], scale[1], scale[2]));
  geom.applyMatrix4(m);
  return geom;
}

/** Boîte positionnée (helper très utilisé par les bâtiments). */
export function box(w, h, d, pos = [0, 0, 0], rot = [0, 0, 0]) {
  return transformGeometry(new THREE.BoxGeometry(w, h, d), { pos, rot });
}

/** Applique une couleur uniforme comme attribut de sommet. */
export function colorize(geom, color) {
  const c = new THREE.Color(color);
  const count = geom.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geom;
}

/** Bruite légèrement les sommets : casse l'aspect "boîte parfaite". */
export function roughen(geom, amount = 0.02, seedFn = Math.random) {
  const p = geom.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i,
      p.getX(i) + (seedFn() - 0.5) * amount,
      p.getY(i) + (seedFn() - 0.5) * amount,
      p.getZ(i) + (seedFn() - 0.5) * amount);
  }
  p.needsUpdate = true;
  geom.computeVertexNormals();
  return geom;
}

export function disposeObject(obj) {
  obj.traverse?.((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        // Les textures sont partagées/caches : on ne les libère pas ici.
        m.dispose();
      }
    }
  });
}
