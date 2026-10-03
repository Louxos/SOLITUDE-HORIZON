/**
 * custom-props.js — Modèles 3D importés (Meshy AI ou fichiers .glb).
 *
 * Les fichiers GLB sont stockés dans IndexedDB (store « models »),
 * les positions dans la sauvegarde (world.state.customProps).
 * Chaque modèle posé ajoute un collider cylindrique approximatif.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../vendor/three/loaders/GLTFLoader.js';

const DB_NAME = 'solitude-horizon';
const STORE = 'models';

function withStore(mode, fn) {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('IndexedDB indisponible')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const out = fn(store);
      tx.oncomplete = () => { db.close(); resolve(out?.result !== undefined ? out.result : out); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    req.onerror = () => reject(req.error);
  });
}

export class CustomProps {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.props = [];        // { name, mesh, collider:{x,z,y,r,h} }
  }

  /** Enregistre un GLB dans la bibliothèque locale. */
  async saveModel(name, buffer) {
    await withStore('readwrite', (store) => store.put(buffer, name));
  }

  async loadModel(name) {
    return withStore('readonly', (store) => store.get(name));
  }

  /** Instancie un GLB. Renvoie le prop posé. */
  async spawn(name, buffer, pos, yaw = 0, scale = 1) {
    const gltf = await new Promise((resolve, reject) => {
      try {
        this.loader.parse(buffer, '', resolve, reject);
      } catch (err) { reject(err); }
    });
    const mesh = gltf.scene || gltf.scenes?.[0];
    if (!mesh) throw new Error('GLB illisible (pas de scène)');
    mesh.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
        if (o.material) o.material.side = THREE.FrontSide;
      }
    });
    mesh.position.copy(pos);
    mesh.rotation.y = yaw;
    mesh.scale.setScalar(scale);
    this.scene.add(mesh);
    mesh.updateMatrixWorld(true);

    // collider cylindrique approximatif (base au sol)
    const box = new THREE.Box3().setFromObject(mesh);
    const r = Math.max(0.35, Math.min((box.max.x - box.min.x), (box.max.z - box.min.z)) / 2);
    const h = Math.max(0.5, box.max.y - box.min.y);
    const prop = {
      name,
      mesh,
      collider: { x: pos.x, y: pos.y, z: pos.z, r, h },
    };
    this.props.push(prop);
    return prop;
  }

  removeLast() {
    const p = this.props.pop();
    if (!p) return null;
    this.scene.remove(p.mesh);
    return p;
  }

  /** Colliders au format « arbre » consommé par la physique du joueur. */
  get colliders() {
    return this.props.map((p) => p.collider);
  }

  /** Recharge les placements sauvegardés (appelé au démarrage/reprise). */
  async restore(placements) {
    if (!Array.isArray(placements)) return;
    for (const pl of placements) {
      try {
        const buffer = await this.loadModel(pl.name);
        if (buffer) await this.spawn(pl.name, buffer, new THREE.Vector3(pl.x, pl.y, pl.z), pl.yaw || 0, pl.scale || 1);
      } catch (e) { /* modèle absent de la bibliothèque : on ignore */ }
    }
  }
}
