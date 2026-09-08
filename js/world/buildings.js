/**
 * buildings.js — Générateur procédural de bâtiments abandonnés.
 *
 * Un bâtiment = murs modulaires percés (portes/fenêtres), pièces intérieures,
 * mobilier, conteneurs fouillables, portes articulées, végétation envahissante.
 * Tout est déterministe (seed) et fournit ses collisions + ses interactions.
 *
 * Améliorations v2 :
 *  - empreinte déterministe exportée (buildingFootprint) pour aplanir le sol
 *    avant la construction (le joueur peut ENTRER : plus de dalle flottante) ;
 *  - marches de porte, portes arrière, entrée par les fenêtres brisées ;
 *  - nouveaux types : commerce, église (clocher), station-service ;
 *  - habillage : plinthes, encadrements+meneaux, appuis de fenêtre, débords de
 *    toit, faîtage, cheminée à chapeau, porches, auvents, moquettes, rideaux,
 *    luminaires plafond.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { getTexture } from '../core/textures.js';
import { mergeGeometries, transformGeometry, box, colorize } from '../core/geometry.js';
import { makeRng, hashInt } from '../core/rng.js';
import { settings } from '../core/settings.js';

export const BUILDING_TYPES = {
  cabin: { label: 'Cabane', w: [5, 7], d: [4, 6], floors: 1, rooms: 1, wall: 'wood', roof: 'metal', loot: ['shed'] },
  small_house: { label: 'Petite maison', w: [7, 9], d: [6, 8], floors: 1, rooms: 3, wall: 'plaster', roof: 'tile', loot: ['kitchen', 'bedroom', 'bathroom'], backDoor: true, porch: 0.5 },
  family_house: { label: 'Maison familiale', w: [9, 12], d: [7, 10], floors: 2, rooms: 4, wall: 'plaster', roof: 'tile', loot: ['kitchen', 'bedroom', 'bathroom', 'bedroom'], backDoor: true, porch: 0.55 },
  farm: { label: 'Ferme', w: [11, 15], d: [8, 11], floors: 2, rooms: 4, wall: 'stone', roof: 'tile', loot: ['kitchen', 'workshop', 'bedroom', 'shed'], backDoor: true },
  chalet: { label: 'Chalet', w: [8, 10], d: [6, 8], floors: 1, rooms: 2, wall: 'wood', roof: 'wood', loot: ['kitchen', 'bedroom'], porch: 0.45 },
  garage: { label: 'Garage', w: [7, 9], d: [6, 7], floors: 1, rooms: 1, wall: 'concrete', roof: 'metal', loot: ['garage'], garageDoor: true, roofStyle: 'flat' },
  workshop: { label: 'Atelier', w: [9, 12], d: [7, 9], floors: 1, rooms: 2, wall: 'concrete', roof: 'metal', loot: ['workshop', 'garage'], roofStyle: 'flat' },
  barn: { label: 'Bâtiment agricole', w: [12, 16], d: [9, 12], floors: 1, rooms: 1, wall: 'wood', roof: 'metal', loot: ['shed', 'workshop'], tall: true },
  industrial: { label: 'Halle industrielle', w: [14, 18], d: [11, 14], floors: 1, rooms: 2, wall: 'concrete', roof: 'metal', loot: ['workshop', 'garage'], tall: true, roofStyle: 'flat' },
  store: { label: 'Ancien commerce', w: [8, 11], d: [6, 9], floors: 1, rooms: 2, wall: 'brick', roof: 'concrete', loot: ['store', 'kitchen'], roofStyle: 'flat', awning: true },
  church: { label: 'Église', w: [9, 11], d: [14, 18], floors: 1, rooms: 2, wall: 'stone', roof: 'tile', loot: ['chapel', 'chapel'], tall: true, tower: true },
  gas_shop: { label: 'Boutique de station', w: [7, 9], d: [5, 7], floors: 1, rooms: 1, wall: 'brick', roof: 'metal', loot: ['gasstation'], roofStyle: 'flat', awning: true },
};

const WALL_T = 0.22;
const FLOOR_H = 2.75;

let MATS = null;
function materials() {
  if (MATS) return MATS;
  const mk = (tex, opts = {}) => new THREE.MeshStandardMaterial({
    map: getTexture(tex), roughness: 0.93, metalness: 0, vertexColors: true, ...opts,
  });
  MATS = {
    plaster: mk('plaster', { normalMap: getTexture('wallNormal') }),
    brick: mk('brick', { normalMap: getTexture('wallNormal') }),
    wood: mk('wood'),
    concrete: mk('concrete', { normalMap: getTexture('wallNormal') }),
    stone: mk('rock'),
    metal: mk('rust', { roughness: 0.68, metalness: 0.35 }),
    roof: mk('roof'),
    glass: new THREE.MeshStandardMaterial({
      color: 0x9db3b8, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.28,
      side: THREE.DoubleSide, depthWrite: false,
    }),
    ivy: new THREE.MeshStandardMaterial({
      map: getTexture('ivy'), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9, vertexColors: true,
    }),
    fabric: new THREE.MeshStandardMaterial({ color: 0x6b6455, roughness: 0.98, vertexColors: true }),
    rug: new THREE.MeshStandardMaterial({ color: 0x7c4b42, roughness: 0.99, vertexColors: true }),
    dark: new THREE.MeshStandardMaterial({ color: 0x3c3833, roughness: 0.95, vertexColors: true }),
  };
  return MATS;
}

function wallMaterialFor(kind) {
  const m = materials();
  return m[kind] || m.plaster;
}

/**
 * Empreinte déterministe d'un bâtiment : dimensions + état de dégradation.
 * Doit consommer le RNG exactement comme generateBuilding (mêmes tirages).
 */
export function buildingFootprint(type, seed, x, z) {
  const spec = BUILDING_TYPES[type] || BUILDING_TYPES.small_house;
  const rng = makeRng(hashInt(seed, Math.round(x), Math.round(z), 4242));
  const W = rng.range(spec.w[0], spec.w[1]);
  const D = rng.range(spec.d[0], spec.d[1]);
  const condition = rng.range(0.25, 1);         // 0 = presque intact, 1 = ruine
  return { W, D, floors: spec.floors, condition, tall: !!spec.tall };
}

/** Collecteur de géométries par matériau. */
class Bucket {
  constructor() { this.map = new Map(); }
  add(matKey, geom, tint = 0xffffff) {
    colorize(geom, tint);
    if (!this.map.has(matKey)) this.map.set(matKey, []);
    this.map.get(matKey).push(geom);
  }
  build(group) {
    const mats = materials();
    for (const [key, geoms] of this.map) {
      if (!geoms.length) continue;
      const merged = mergeGeometries(geoms);
      const mesh = new THREE.Mesh(merged, mats[key] || mats.plaster);
      mesh.castShadow = settings.preset.shadows;
      mesh.receiveShadow = settings.preset.shadows;
      group.add(mesh);
    }
  }
}

/**
 * Construit un pan de mur percé d'ouvertures.
 * openings = [{x, y, w, h}] en coordonnées locales du mur (x centré).
 * Retourne les boîtes du mur (utilisées pour géométrie ET collisions).
 */
function wallWithOpenings(length, height, openings) {
  const parts = [];
  const sorted = [...openings].sort((a, b) => (a.x - a.w / 2) - (b.x - b.w / 2));
  let cursor = -length / 2;
  for (const op of sorted) {
    const x0 = op.x - op.w / 2, x1 = op.x + op.w / 2;
    if (x0 > cursor) parts.push({ x: (cursor + x0) / 2, y: height / 2, w: x0 - cursor, h: height });
    // linteau
    if (op.y + op.h < height) {
      parts.push({ x: op.x, y: (op.y + op.h + height) / 2, w: op.w, h: height - (op.y + op.h) });
    }
    // allège (sous fenêtre)
    if (op.y > 0) parts.push({ x: op.x, y: op.y / 2, w: op.w, h: op.y });
    cursor = Math.max(cursor, x1);
  }
  if (cursor < length / 2) parts.push({ x: (cursor + length / 2) / 2, y: height / 2, w: length / 2 - cursor, h: height });
  return parts.filter((p) => p.w > 0.03 && p.h > 0.03);
}

/** Découpe récursive d'un rectangle en pièces (BSP simple). */
function splitRooms(x0, z0, x1, z1, count, rng, depth = 0) {
  if (count <= 1 || depth > 4) return [{ x0, z0, x1, z1 }];
  const w = x1 - x0, d = z1 - z0;
  const horizontal = w > d ? false : true; // coupe selon la plus grande dimension
  const left = Math.ceil(count / 2), right = count - left;
  if (!horizontal) {
    const cut = x0 + w * rng.range(0.38, 0.62);
    return [
      ...splitRooms(x0, z0, cut, z1, left, rng, depth + 1),
      ...splitRooms(cut, z0, x1, z1, right, rng, depth + 1),
    ];
  }
  const cut = z0 + d * rng.range(0.38, 0.62);
  return [
    ...splitRooms(x0, z0, x1, cut, left, rng, depth + 1),
    ...splitRooms(x0, cut, x1, z1, right, rng, depth + 1),
  ];
}

/** Mobilier : renvoie {geoms:[{mat,geom,tint}], colliders:[], containers:[]} */
function furnishRoom(room, roomType, rng, floorY, condition) {
  const out = { geoms: [], colliders: [], containers: [] };
  const cx = (room.x0 + room.x1) / 2, cz = (room.z0 + room.z1) / 2;
  const w = room.x1 - room.x0, d = room.z1 - room.z0;

  const put = (mat, geom, tint = 0xffffff) => out.geoms.push({ mat, geom, tint });
  const collide = (x, y, z, hx, hy, hz) => out.colliders.push({ x, y, z, hx, hy, hz, walkable: hy * 2 < 0.75 });

  // Emplacement libre le long d'un mur
  const alongWall = (depthOff = 0.4) => {
    const side = rng.int(0, 3);
    if (side === 0) return { x: cx + (rng() - 0.5) * (w - 1.6), z: room.z0 + depthOff, rot: 0 };
    if (side === 1) return { x: cx + (rng() - 0.5) * (w - 1.6), z: room.z1 - depthOff, rot: Math.PI };
    if (side === 2) return { x: room.x0 + depthOff, z: cz + (rng() - 0.5) * (d - 1.6), rot: Math.PI / 2 };
    return { x: room.x1 - depthOff, z: cz + (rng() - 0.5) * (d - 1.6), rot: -Math.PI / 2 };
  };

  const addContainer = (kind, pos, size, lootTable, matKey, tint) => {
    const geom = box(size[0], size[1], size[2], [pos.x, floorY + size[1] / 2, pos.z], [0, pos.rot || 0, 0]);
    out.containers.push({
      kind, lootTable,
      position: new THREE.Vector3(pos.x, floorY + size[1] / 2, pos.z),
      size, geom, matKey, tint,
    });
    collide(pos.x, floorY + size[1] / 2, pos.z, size[0] / 2, size[1] / 2, size[2] / 2);
  };

  switch (roomType) {
    case 'kitchen': {
      const p = alongWall(0.45);
      addContainer('Placard de cuisine', p, [1.7, 0.9, 0.62], 'kitchen', 'wood', 0xb9a888);
      const p2 = alongWall(0.45);
      addContainer('Tiroirs', p2, [0.9, 0.78, 0.55], 'kitchen', 'wood', 0xa89a80);
      // table + chaises
      put('wood', box(1.3, 0.06, 0.85, [cx, floorY + 0.76, cz]), 0x9c8a70);
      put('wood', box(0.08, 0.75, 0.08, [cx - 0.55, floorY + 0.38, cz - 0.35]), 0x8a7a62);
      put('wood', box(0.08, 0.75, 0.08, [cx + 0.55, floorY + 0.38, cz - 0.35]), 0x8a7a62);
      put('wood', box(0.08, 0.75, 0.08, [cx - 0.55, floorY + 0.38, cz + 0.35]), 0x8a7a62);
      put('wood', box(0.08, 0.75, 0.08, [cx + 0.55, floorY + 0.38, cz + 0.35]), 0x8a7a62);
      collide(cx, floorY + 0.4, cz, 0.7, 0.4, 0.45);
      // évier / cuisinière
      const p3 = alongWall(0.4);
      put('metal', box(0.8, 0.88, 0.6, [p3.x, floorY + 0.44, p3.z]), 0xbcbcbc);
      collide(p3.x, floorY + 0.44, p3.z, 0.4, 0.44, 0.3);
      break;
    }
    case 'bedroom': {
      const p = alongWall(1.1);
      // lit
      put('wood', box(1.35, 0.35, 2.0, [p.x, floorY + 0.18, p.z], [0, p.rot, 0]), 0x8a7a62);
      put('fabric', box(1.3, 0.22, 1.95, [p.x, floorY + 0.45, p.z], [0, p.rot, 0]), 0x9c9382);
      put('fabric', box(0.62, 0.14, 0.4, [p.x, floorY + 0.62, p.z - 0.72], [0, p.rot, 0]), 0xc9c2b2);
      collide(p.x, floorY + 0.3, p.z, 0.75, 0.3, 1.05);
      out.bed = { position: new THREE.Vector3(p.x, floorY + 0.6, p.z) };
      const p2 = alongWall(0.4);
      addContainer('Armoire', p2, [1.2, 2.0, 0.6], 'bedroom', 'wood', 0x9a8a6e);
      const p3 = alongWall(0.35);
      addContainer('Table de chevet', p3, [0.5, 0.6, 0.45], 'bedroom', 'wood', 0xa89878);
      break;
    }
    case 'bathroom': {
      const p = alongWall(0.4);
      put('plaster', box(0.65, 0.4, 0.5, [p.x, floorY + 0.4, p.z]), 0xd8d8d0); // lavabo
      collide(p.x, floorY + 0.4, p.z, 0.33, 0.4, 0.25);
      const p2 = alongWall(0.4);
      put('plaster', box(0.45, 0.75, 0.6, [p2.x, floorY + 0.37, p2.z]), 0xd0d0c8); // wc
      collide(p2.x, floorY + 0.37, p2.z, 0.23, 0.37, 0.3);
      const p3 = alongWall(0.25);
      addContainer('Armoire à pharmacie', { ...p3, }, [0.55, 0.6, 0.22], 'bathroom', 'wood', 0xc8c0b0);
      break;
    }
    case 'garage': {
      const p = alongWall(0.4);
      addContainer('Établi', p, [2.2, 0.9, 0.7], 'garage', 'wood', 0x8f7f66);
      const p2 = alongWall(0.35);
      addContainer('Caisse à outils', p2, [0.7, 0.45, 0.4], 'garage', 'metal', 0x9a5f42);
      const p3 = alongWall(0.4);
      addContainer('Étagère métallique', p3, [1.6, 1.9, 0.45], 'garage', 'metal', 0x8c8c86);
      for (let i = 0; i < rng.int(1, 3); i++) {
        const pp = alongWall(0.6);
        put('metal', box(0.4, 0.6, 0.4, [pp.x, floorY + 0.3, pp.z]), 0x7a6a52);
        collide(pp.x, floorY + 0.3, pp.z, 0.2, 0.3, 0.2);
      }
      break;
    }
    case 'workshop': {
      const p = alongWall(0.45);
      addContainer('Établi', p, [2.6, 0.95, 0.75], 'workshop', 'wood', 0x93815f);
      const p2 = alongWall(0.4);
      addContainer('Casier', p2, [1.0, 1.85, 0.5], 'workshop', 'metal', 0x6f7a70);
      const p3 = alongWall(0.5);
      addContainer('Caisse en bois', p3, [0.9, 0.7, 0.7], 'shed', 'wood', 0xa08d6c);
      break;
    }
    case 'shed': {
      const p = alongWall(0.5);
      addContainer('Étagère', p, [1.4, 1.7, 0.42], 'shed', 'wood', 0xa08d6c);
      const p2 = alongWall(0.55);
      addContainer('Vieille caisse', p2, [0.8, 0.65, 0.65], 'shed', 'wood', 0x93805f);
      break;
    }
    case 'store': {
      // rayonnages de boutique
      for (let i = 0; i < 2; i++) {
        const p = alongWall(0.55);
        addContainer('Rayonnage', p, [2.4, 1.8, 0.55], 'store', 'wood', 0xb0a488);
      }
      const p3 = { x: cx, z: (room.z0 + room.z1) / 2 + (rng() < 0.5 ? -d * 0.28 : d * 0.28), rot: 0 };
      addContainer('Comptoir', p3, [2.6, 1.0, 0.7], 'store', 'wood', 0xcabfa4);
      break;
    }
    case 'gasstation': {
      const p = alongWall(0.45);
      addContainer('Présentoir', p, [1.8, 1.6, 0.5], 'gasstation', 'wood', 0xb0a488);
      const p2 = alongWall(0.4);
      addContainer('Comptoir', p2, [2.2, 1.0, 0.65], 'gasstation', 'wood', 0xcabfa4);
      break;
    }
    case 'chapel': {
      // bancs (deux rangées)
      const along = room.z1 - room.z0 > room.x1 - room.x0;
      const rows = Math.floor((along ? room.z1 - room.z0 : room.x1 - room.x0) / 2.2);
      for (let r = 0; r < Math.max(2, rows - 1); r++) {
        for (const side of [-1, 1]) {
          const t = 0.18 + (r / Math.max(1, rows)) * 0.68;
          const bx = along ? cx + side * (w * 0.22) : room.x0 + (room.x1 - room.x0) * t;
          const bz = along ? room.z0 + (room.z1 - room.z0) * t : cz + side * (d * 0.22);
          put('wood', box(0.5, 0.06, 1.6, [bx, floorY + 0.46, bz], [0, along ? 0 : Math.PI / 2, 0]), 0x7a6448);
          put('wood', box(0.5, 0.7, 0.08, [bx, floorY + 0.8, bz + (along ? -0.78 : 0)], [0, along ? 0 : Math.PI / 2, 0]), 0x6e5a40);
          put('wood', box(0.08, 0.45, 0.08, [bx - 0.2, floorY + 0.23, bz - 0.7]), 0x64513a);
          put('wood', box(0.08, 0.45, 0.08, [bx + 0.2, floorY + 0.23, bz + 0.7]), 0x64513a);
          collide(bx, floorY + 0.3, bz, 0.3, 0.3, 0.85);
        }
      }
      // autel + tronc
      const altar = along ? { x: cx, z: room.z1 - 4.6 } : { x: room.x1 - 4.6, z: cz };
      put('stone', box(1.8, 0.95, 0.7, [altar.x, floorY + 0.48, altar.z]), 0x9a938a);
      put('fabric', box(1.7, 0.08, 0.6, [altar.x, floorY + 0.99, altar.z]), 0x8a4a3c);
      collide(altar.x, floorY + 0.48, altar.z, 0.9, 0.48, 0.35);
      addContainer('Tronc à offrandes', { x: altar.x + 1.2, z: altar.z, rot: 0 }, [0.5, 0.7, 0.4], 'chapel', 'wood', 0x6e5a40);
      break;
    }
    default: { // séjour
      const p = alongWall(0.55);
      put('fabric', box(1.9, 0.75, 0.85, [p.x, floorY + 0.38, p.z], [0, p.rot, 0]), 0x6e6858);
      collide(p.x, floorY + 0.38, p.z, 0.95, 0.38, 0.45);
      const p2 = alongWall(0.4);
      addContainer('Buffet', p2, [1.5, 0.85, 0.5], 'bedroom', 'wood', 0x9d8b6d);
      put('wood', box(1.0, 0.05, 0.6, [cx, floorY + 0.42, cz]), 0x8f7d5f);
      collide(cx, floorY + 0.24, cz, 0.5, 0.24, 0.3);
      // bibliothèque occasionnelle
      if (rng() < 0.5) {
        const p4 = alongWall(0.32);
        addContainer('Étagère', p4, [1.1, 1.9, 0.35], 'bedroom', 'wood', 0x8d7a5c);
      }
      break;
    }
  }

  // Décor doux : moquette, rideaux, luminaire plafond
  if (w > 2.6 && d > 2.6 && rng() < 0.6) {
    const rugC = [0x7c4b42, 0x5c6152, 0x6e5a48, 0x54575e][rng.int(0, 3)];
    const rw = Math.min(w * 0.5, 2.4), rd = Math.min(d * 0.5, 1.7);
    put('rug', box(rw, 0.025, rd, [cx, floorY + 0.013, cz]), rugC);
  }
  if (rng() < 0.5) {
    // rideaux de part et d'autre d'un mur quelconque
    const cw = rng.range(0.5, 0.8);
    put('fabric', box(cw, 1.7, 0.06, [cx - w * 0.28, floorY + 1.55, room.z0 + 0.16]), 0x8a8272);
    put('fabric', box(cw, 1.7, 0.06, [cx + w * 0.28, floorY + 1.55, room.z0 + 0.16]), 0x8a8272);
  }
  if (rng() < 0.65) {
    // luminaire plafond (câble + abat-jour)
    put('dark', box(0.03, 0.5, 0.03, [cx, floorY + 2.5, cz]), 0x2a2a28);
    put('dark', box(0.34, 0.2, 0.34, [cx, floorY + 2.2, cz]), 0x4a463c);
  }

  // Débris au sol : feuilles mortes, gravats
  const debrisCount = Math.round(condition * 6);
  for (let i = 0; i < debrisCount; i++) {
    const x = room.x0 + rng() * w, z = room.z0 + rng() * d;
    const s = 0.1 + rng() * 0.35;
    put('concrete', transformGeometry(new THREE.IcosahedronGeometry(s, 0), {
      pos: [x, floorY + s * 0.3, z], rot: [rng(), rng(), rng()],
      scale: [1, 0.4, 1],
    }), 0x8e8880);
  }
  return out;
}

/** Porte articulée (ou montante pour les garages) + interactions + collisions. */
function addDoor(bucket, opts) {
  const {
    id, group, doorX, doorZ, width, height, matKey, locked, jammed,
    slide, label, outSign, colliders, interactables,
  } = opts;
  const doorGroup = new THREE.Group();

  const doorW = width - 0.06, doorH = height - 0.05;
  const parts = [box(doorW, doorH, 0.06, [doorW / 2, doorH / 2, 0])];
  if (!slide) {
    parts.push(box(doorW * 0.62, doorH * 0.34, 0.02, [doorW / 2, doorH * 0.66, 0.045]));
    parts.push(box(doorW * 0.62, doorH * 0.34, 0.02, [doorW / 2, doorH * 0.28, 0.045]));
    parts.push(box(0.07, 0.07, 0.1, [doorW - 0.16, doorH * 0.47, 0.03]));
  } else {
    for (let i = 0; i < 5; i++) {
      parts.push(box(doorW - 0.04, doorH / 5 * 0.7, 0.02, [doorW / 2, doorH * (0.1 + i * 0.2), 0.05]));
    }
  }
  const geom = mergeGeometries(parts.map((g) => colorize(g, slide ? 0x8f8a80 : 0x7d6a4e)));
  const doorMesh = new THREE.Mesh(geom, materials()[matKey]);
  doorMesh.castShadow = settings.preset.shadows;
  doorGroup.add(doorMesh);
  doorGroup.position.set(doorX - doorW / 2, 0, doorZ);
  group.add(doorGroup);

  interactables.push({
    kind: 'door',
    id: `${id}`,
    label,
    object: doorGroup,
    slide: !!slide,
    swing: outSign < 0 ? -1 : 1,
    local: new THREE.Vector3(doorX, height / 2, doorZ + outSign * 0.3),
    locked, jammed, open: false,
    doorWidth: width, doorHeight: height,
  });
  colliders.push({ x: doorX, y: height / 2, z: doorZ, hx: width / 2, hy: height / 2, hz: 0.08, door: `${id}` });
}

/**
 * @returns {{group:THREE.Group, colliders:Array, supports:Array, interactables:Array, meta:Object}}
 */
export function generateBuilding({ type, seed, x, y, z, yaw = 0, id }) {
  const spec = BUILDING_TYPES[type] || BUILDING_TYPES.small_house;
  const rng = makeRng(hashInt(seed, Math.round(x), Math.round(z), 4242));
  const W = rng.range(spec.w[0], spec.w[1]);
  const D = rng.range(spec.d[0], spec.d[1]);
  const floors = spec.floors;
  const fh = spec.tall ? 4.6 : FLOOR_H;
  const condition = rng.range(0.25, 1);         // 0 = presque intact, 1 = ruine
  const wallKey = spec.wall === 'stone' ? 'stone' : spec.wall;

  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = yaw;
  group.name = `building_${id}`;

  const bucket = new Bucket();
  const colliders = [];   // locaux : {x,y,z,hx,hy,hz}
  const supports = [];    // surfaces marchables : {x,z,hx,hz,top}
  const interactables = [];

  const halfW = W / 2, halfD = D / 2;

  // --- Dalle / plancher ---
  const slabH = 0.35;
  bucket.add('concrete', box(W + 0.5, slabH, D + 0.5, [0, -slabH / 2, 0]), 0x8a8880);
  supports.push({ x: 0, z: 0, hx: (W + 0.5) / 2, hz: (D + 0.5) / 2, top: 0 });
  // pied de fondation enterré (masque le relief)
  bucket.add('concrete', box(W + 0.7, 3.2, D + 0.7, [0, -1.85, 0]), 0x6f6d66);
  // --- Ouvertures façade ---
  const doorW = spec.garageDoor ? Math.min(3.4, W - 1.6) : (type === 'church' ? 1.6 : 1.05);
  const doorH = spec.garageDoor ? 2.5 : (type === 'church' ? 2.5 : 2.1);
  const doorX = spec.garageDoor || type === 'church' ? 0 : rng.range(-halfW + 1.4, halfW - 1.4);
  // porte de service éventuelle (façade arrière)
  const hasBackDoor = !!spec.backDoor && D > 7;
  const backDoorX = hasBackDoor ? rng.range(-halfW + 1.5, halfW - 1.5) : 0;

  // plinthe : soubassement plus sombre autour des murs (découpé aux portes)
  {
    const PT = 0.34;                       // épaisseur plinthe
    const seg = (x0, x1, z, axis) => {
      if (x1 - x0 < 0.05) return;
      const len = x1 - x0, cx = (x0 + x1) / 2;
      if (axis === 'x') bucket.add('stone', box(len, 0.6, PT, [cx, 0.28, z]), 0x7b766d);
      else bucket.add('stone', box(PT, 0.6, len, [z, 0.28, cx]), 0x7b766d);
    };
    const gaps = [{ x: doorX, w: doorW + 0.3 }];
    if (hasBackDoor) gaps.push({ x: backDoorX, w: 1.28 });
    const strip = (len, off, gap) => {      // segment le long de x, à z = off
      const x0 = -len / 2;
      if (!gap) { seg(x0, len / 2, off, 'x'); return; }
      const g0 = gap.x - gap.w / 2, g1 = gap.x + gap.w / 2;
      seg(x0, g0, off, 'x');
      seg(g1, len / 2, off, 'x');
    };
    strip(W + PT, -halfD, { x: doorX, w: doorW + 0.3 });            // façade
    strip(W + PT, halfD, hasBackDoor ? { x: backDoorX, w: 1.28 } : null);  // arrière
    seg(-halfD - PT / 2, halfD + PT / 2, -halfW, 'z');              // pignons
    seg(-halfD - PT / 2, halfD + PT / 2, halfW, 'z');
  }

  const windowsFor = (len, count, exclude = null) => {
    const list = [];
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const px = -len / 2 + len * t + (rng() - 0.5) * 0.5;
      if (exclude && Math.abs(px - exclude.x) < exclude.w / 2 + 0.9) continue;
      list.push({
        x: px, y: type === 'church' ? 1.6 : 1.05,
        w: type === 'church' ? rng.range(0.5, 0.8) : rng.range(0.9, 1.3),
        h: type === 'church' ? rng.range(2.2, 3.0) : rng.range(1.05, 1.35),
        broken: rng() < 0.35 + condition * 0.45,
      });
    }
    return list;
  };

  const wallTint = spec.wall === 'wood' ? 0xa08a6a : spec.wall === 'concrete' ? 0xbdbcb6 : spec.wall === 'brick' ? 0xbfae9c : 0xd8d2c4;
  const dirty = new THREE.Color(wallTint).multiplyScalar(1 - condition * 0.25).getHex();

  for (let f = 0; f < floors; f++) {
    const baseY = f * fh;
    const isGround = f === 0;

    const facadeWindows = windowsFor(W, Math.max(1, Math.round(W / (type === 'church' ? 2.6 : 3.2))), isGround ? { x: doorX, w: doorW } : null);
    const backWindows = windowsFor(W, Math.max(1, Math.round(W / 3.6)),
      isGround && hasBackDoor ? { x: backDoorX, w: 0.98 } : null);
    const leftWindows = windowsFor(D, Math.max(1, Math.round(D / 3.6)));
    const rightWindows = windowsFor(D, Math.max(1, Math.round(D / 3.6)));

    const faces = [
      { len: W, axis: 'x', off: -halfD, rot: 0, wins: facadeWindows, door: isGround ? 'front' : null, nx: 0, nz: -1 },
      { len: W, axis: 'x', off: halfD, rot: Math.PI, wins: backWindows, door: isGround && hasBackDoor ? 'back' : null, nx: 0, nz: 1 },
      { len: D, axis: 'z', off: -halfW, rot: -Math.PI / 2, wins: leftWindows, door: false, nx: -1, nz: 0 },
      { len: D, axis: 'z', off: halfW, rot: Math.PI / 2, wins: rightWindows, door: false, nx: 1, nz: 0 },
    ];

    for (const face of faces) {
      const openings = face.wins.map((wn) => ({ x: wn.x, y: wn.y, w: wn.w, h: wn.h }));
      if (face.door === 'front') openings.push({ x: doorX, y: 0, w: doorW, h: doorH });
      if (face.door === 'back') openings.push({ x: backDoorX, y: 0, w: 0.98, h: 2.05 });
      const parts = wallWithOpenings(face.len, fh, openings);
      for (const p of parts) {
        const gx = face.axis === 'x' ? p.x : face.off;
        const gz = face.axis === 'x' ? face.off : p.x;
        const sx = face.axis === 'x' ? p.w : WALL_T;
        const sz = face.axis === 'x' ? WALL_T : p.w;
        bucket.add(wallKey, box(sx, p.h, sz, [gx, baseY + p.y, gz]), dirty);
        colliders.push({ x: gx, y: baseY + p.y, z: gz, hx: sx / 2, hy: p.h / 2, hz: sz / 2 });
      }
      // vitrages restants + meneaux + appuis
      for (const wn of face.wins) {
        const gx = face.axis === 'x' ? wn.x : face.off;
        const gz = face.axis === 'x' ? face.off : wn.x;
        const sx = face.axis === 'x' ? wn.w : 0.04;
        const sz = face.axis === 'x' ? 0.04 : wn.w;
        if (!wn.broken) {
          bucket.add('glass', box(sx, wn.h, sz, [gx, baseY + wn.y + wn.h / 2, gz]), 0xffffff);
          // meneaux (croisillon)
          const mSx = face.axis === 'x' ? 0.04 : 0.06;
          const mSz = face.axis === 'x' ? 0.06 : 0.04;
          bucket.add('wood', box(mSx, wn.h, mSz, [gx, baseY + wn.y + wn.h / 2, gz]), 0xd9d2c2);
          const hSx = face.axis === 'x' ? wn.w : 0.06;
          const hSz = face.axis === 'x' ? 0.06 : wn.w;
          bucket.add('wood', box(hSx, 0.04, hSz, [gx, baseY + wn.y + wn.h / 2, gz]), 0xd9d2c2);
        } else if (isGround) {
          // fenêtre brisée franchissable (rez-de-chaussée)
          const inward = 1.15;
          interactables.push({
            kind: 'window',
            id: `${id}:win_${f}_${interactables.length}`,
            label: 'Fenêtre brisée',
            local: new THREE.Vector3(gx + face.nx * 0.15, baseY + wn.y + wn.h * 0.35, gz + face.nz * 0.15),
            inside: new THREE.Vector3(gx + face.nx * inward, baseY + 0.05, gz + face.nz * inward),
            outside: new THREE.Vector3(gx - face.nx * 1.0, baseY - 0.05, gz - face.nz * 1.0),
          });
        }
        // encadrement + appui saillant
        const fSx = face.axis === 'x' ? wn.w + 0.16 : WALL_T + 0.1;
        const fSz = face.axis === 'x' ? WALL_T + 0.1 : wn.w + 0.16;
        bucket.add('wood', box(fSx, 0.09, fSz, [gx, baseY + wn.y - 0.05, gz]), 0x8d7b5e);
        bucket.add('wood', box(fSx, 0.09, fSz, [gx, baseY + wn.y + wn.h + 0.05, gz]), 0x8d7b5e);
        bucket.add('wood', box(fSx + 0.12, 0.07, fSz + 0.12, [gx, baseY + wn.y - 0.1, gz]), 0x7f6e52);
      }
    }

    // --- Plafond / plancher de l'étage ---
    if (f < floors - 1) {
      bucket.add('wood', box(W - WALL_T, 0.18, D - WALL_T, [0, baseY + fh, 0]), 0x9a8767);
      supports.push({ x: 0, z: 0, hx: (W - WALL_T) / 2, hz: (D - WALL_T) / 2, top: baseY + fh + 0.09 });
    }

    // --- Pièces intérieures ---
    const roomCount = isGround ? spec.rooms : Math.max(1, spec.rooms - 1);
    const rooms = splitRooms(-halfW + WALL_T, -halfD + WALL_T, halfW - WALL_T, halfD - WALL_T, roomCount, rng);
    const lootTables = spec.loot;

    rooms.forEach((room, ri) => {
      const roomType = lootTables[(ri + f) % lootTables.length];
      const furniture = furnishRoom(room, roomType, rng, baseY, condition);
      for (const g of furniture.geoms) bucket.add(g.mat, g.geom, g.tint);
      for (const c of furniture.colliders) colliders.push({ ...c, y: c.y });
      for (const c of furniture.containers) {
        bucket.add(c.matKey, c.geom, c.tint);
        interactables.push({
          kind: 'container',
          id: `${id}:c${f}_${ri}_${interactables.length}`,
          label: c.kind,
          lootTable: c.lootTable,
          local: c.position.clone().setY(c.position.y),
          rolls: 3,
        });
      }
      if (furniture.bed) {
        interactables.push({
          kind: 'bed', id: `${id}:bed${f}_${ri}`, label: 'Lit', local: furniture.bed.position.clone(),
        });
      }
      room.type = roomType;
      room.floor = f;
    });

    // Cloisons intérieures avec passages
    for (let i = 0; i < rooms.length; i++) {
      const r = rooms[i];
      const edges = [
        { a: [r.x0, r.z0], b: [r.x1, r.z0], axis: 'x', off: r.z0 },
        { a: [r.x0, r.z1], b: [r.x1, r.z1], axis: 'x', off: r.z1 },
        { a: [r.x0, r.z0], b: [r.x0, r.z1], axis: 'z', off: r.x0 },
        { a: [r.x1, r.z0], b: [r.x1, r.z1], axis: 'z', off: r.x1 },
      ];
      for (const e of edges) {
        const isOuter = Math.abs(e.off) > (e.axis === 'x' ? halfD - WALL_T - 0.05 : halfW - WALL_T - 0.05);
        if (isOuter) continue;
        const len = e.axis === 'x' ? (r.x1 - r.x0) : (r.z1 - r.z0);
        const center = e.axis === 'x' ? (r.x0 + r.x1) / 2 : (r.z0 + r.z1) / 2;
        const openings = [{ x: (rng() - 0.5) * Math.max(0, len - 2.2), y: 0, w: 0.95, h: 2.05 }];
        const parts = wallWithOpenings(len, fh, openings);
        for (const p of parts) {
          const gx = e.axis === 'x' ? center + p.x : e.off;
          const gz = e.axis === 'x' ? e.off : center + p.x;
          const sx = e.axis === 'x' ? p.w : 0.12;
          const sz = e.axis === 'x' ? 0.12 : p.w;
          bucket.add('plaster', box(sx, p.h, sz, [gx, baseY + p.y, gz]), 0xcfc8ba);
          colliders.push({ x: gx, y: baseY + p.y, z: gz, hx: sx / 2, hy: p.h / 2, hz: sz / 2 });
        }
      }
    }
  }

  // --- Escalier (bâtiments à étage) ---
  if (floors > 1) {
    const steps = Math.ceil(fh / 0.22);
    const stepH = fh / steps;
    const stepD = 0.28;
    const sx = halfW - 1.4;
    const sz0 = -halfD + 0.6;
    for (let i = 0; i < steps; i++) {
      const zz = sz0 + i * stepD;
      const yy = i * stepH;
      bucket.add('wood', box(1.1, stepH + 0.04, stepD, [sx, yy + stepH / 2, zz]), 0x9c8a6a);
      supports.push({ x: sx, z: zz, hx: 0.55, hz: stepD / 2 + 0.02, top: yy + stepH });
    }
    supports.push({ x: sx, z: sz0 + steps * stepD, hx: 0.6, hz: 0.5, top: fh });
  }

  // --- Porche (some houses) ---
  if (spec.porch && rng() < spec.porch) {
    const pw = doorW + 1.6;
    bucket.add('concrete', box(pw, 0.16, 1.6, [doorX, 0.08, -halfD - 0.85]), 0x9a968c);
    supports.push({ x: doorX, z: -halfD - 0.85, hx: pw / 2, hz: 0.8, top: 0.16 });
    bucket.add('wood', box(0.12, 2.3, 0.12, [doorX - pw / 2 + 0.1, 1.15, -halfD - 1.55]), 0x8a7a5e);
    bucket.add('wood', box(0.12, 2.3, 0.12, [doorX + pw / 2 - 0.1, 1.15, -halfD - 1.55]), 0x8a7a5e);
    bucket.add('roof', box(pw + 0.5, 0.12, 2.1, [doorX, 2.42, -halfD - 1.0], [0.18, 0, 0]), 0x8a6a52);
  } else {
    // marche de seuil : garantit l'entrée même en terrain très légèrement bosselé
    bucket.add('stone', box(doorW + 0.5, 0.16, 0.5, [doorX, 0.08, -halfD - 0.3]), 0x8f8a80);
    supports.push({ x: doorX, z: -halfD - 0.3, hx: (doorW + 0.5) / 2, hz: 0.25, top: 0.16 });
  }

  // --- Toiture ---
  const topY = floors * fh;
  if (spec.roofStyle === 'flat') {
    // toit plat avec acrotère
    bucket.add('concrete', box(W + 0.3, 0.22, D + 0.3, [0, topY + 0.11, 0]), 0x8f8c85);
    bucket.add('concrete', box(W + 0.5, 0.5, 0.14, [0, topY + 0.4, -halfD - 0.1]), 0x8a8780);
    bucket.add('concrete', box(W + 0.5, 0.5, 0.14, [0, topY + 0.4, halfD + 0.1]), 0x8a8780);
    bucket.add('concrete', box(0.14, 0.5, D + 0.5, [-halfW - 0.1, topY + 0.4, 0]), 0x8a8780);
    bucket.add('concrete', box(0.14, 0.5, D + 0.5, [halfW + 0.1, topY + 0.4, 0]), 0x8a8780);
    // climatiseur / évent rouillé
    if (rng() < 0.6) bucket.add('metal', box(0.9, 0.6, 0.7, [rng.range(-halfW * 0.4, halfW * 0.4), topY + 0.5, rng.range(-halfD * 0.4, halfD * 0.4)]), 0x9a8f80);
  } else {
    const roofMat = spec.roof === 'tile' ? 'roof' : spec.roof === 'metal' ? 'metal' : 'wood';
    const ridge = spec.tall ? (spec.tower ? 3.4 : 2.6) : 1.9;
    const slopeLen = Math.sqrt((D / 2) * (D / 2) + ridge * ridge);
    const angle = Math.atan2(ridge, D / 2);
    const collapsed = condition > 0.82 && rng() < 0.5;
    for (const side of [-1, 1]) {
      if (collapsed && side === 1) continue;   // toit partiellement effondré
      const g = box(W + 0.6, 0.16, slopeLen,
        [0, topY + ridge / 2, side * (D / 4)],
        [side * -angle, 0, 0]);
      bucket.add(roofMat, g, spec.roof === 'metal' ? 0x9b8f80 : 0xa88b78);
    }
    // faîtage
    if (!collapsed) {
      bucket.add(roofMat, box(W + 0.7, 0.14, 0.3, [0, topY + ridge + 0.05, 0]), spec.roof === 'metal' ? 0x8a8074 : 0x93755f);
    }
    // pignons
    for (const side of [-1, 1]) {
      const tri = new THREE.BufferGeometry();
      const verts = new Float32Array([
        -D / 2, 0, 0, D / 2, 0, 0, 0, ridge, 0,
      ]);
      tri.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      tri.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
      tri.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2));
      transformGeometry(tri, { pos: [side * halfW, topY, 0], rot: [0, Math.PI / 2, 0] });
      bucket.add(wallKey, tri, dirty);
    }
    // cheminée occasionnelle
    if (spec.roof === 'tile' && rng() < 0.6) {
      const chx = rng.range(-halfW * 0.5, halfW * 0.5);
      bucket.add('stone', box(0.6, ridge + 1.2, 0.6, [chx, topY + (ridge + 1.2) / 2, 0]), 0x9a9088);
      bucket.add('stone', box(0.74, 0.12, 0.74, [chx, topY + ridge + 1.22, 0]), 0x6d6660);
    }
  }

  // --- Clocher (église) : tour arrière pleine, autel devant ---
  if (spec.tower) {
    const tw = 3.8;
    const th = fh + 7.5;
    const tz = halfD - tw / 2 - 0.15;
    bucket.add('stone', box(tw, th, tw, [0, th / 2, tz]), 0xb5aca0);
    colliders.push({ x: 0, y: th / 2, z: tz, hx: tw / 2, hy: th / 2, hz: tw / 2 });
    // ouvertures du beffroi
    for (const s of [-1, 1]) {
      bucket.add('dark', box(0.9, 1.2, 0.06, [s * 0.62, th - 1.3, tz]), 0x2e2a26);
      bucket.add('dark', box(0.06, 1.2, 0.9, [0, th - 1.3, tz + s * 0.62]), 0x2e2a26);
    }
    // flèche + croix
    const spire = new THREE.ConeGeometry(tw * 0.75, 3.6, 4);
    transformGeometry(spire, { pos: [0, th + 1.8, tz], rot: [0, Math.PI / 4, 0] });
    bucket.add('roof', spire, 0x8a7060);
    bucket.add('metal', box(0.08, 1.0, 0.08, [0, th + 4.1, tz]), 0xd8d4c8);
    bucket.add('metal', box(0.55, 0.08, 0.08, [0, th + 4.3, tz]), 0xd8d4c8);
    bucket.add('metal', box(0.08, 0.08, 0.55, [0, th + 4.3, tz]), 0xd8d4c8);
  }

  // --- Auvent (commerce / station) ---
  if (spec.awning) {
    const aw = Math.min(W - 1, 6.5);
    bucket.add('metal', box(0.09, 2.5, 0.09, [-aw / 2, 1.25, -halfD - 1.15]), 0x7f7a72);
    bucket.add('metal', box(0.09, 2.5, 0.09, [aw / 2, 1.25, -halfD - 1.15]), 0x7f7a72);
    bucket.add('metal', box(aw + 0.4, 0.1, 1.7, [0, 2.55, -halfD - 0.7], [0.12, 0, 0]), type === 'store' ? 0x7a4a3c : 0x707a72);
    // devanture vitrée : la façade commerce garde une large baie déjà percée
  }

  // --- Porte principale ---
  addDoor(bucket, {
    id: `${id}:door`,
    group,
    doorX, doorZ: -halfD,
    width: doorW, height: doorH,
    matKey: spec.garageDoor ? 'metal' : 'wood',
    locked: rng() < 0.18,
    jammed: rng() < 0.12,
    slide: !!spec.garageDoor,
    label: spec.label,
    outSign: -1,
    colliders, interactables,
  });

  // --- Porte de service (arrière) ---
  if (hasBackDoor) {
    addDoor(bucket, {
      id: `${id}:backdoor`,
      group,
      doorX: backDoorX, doorZ: halfD,
      width: 0.98, height: 2.05,
      matKey: 'wood',
      locked: rng() < 0.3,
      jammed: rng() < 0.15,
      slide: false,
      label: 'Porte de service',
      outSign: 1,
      colliders, interactables,
    });
    bucket.add('stone', box(1.4, 0.16, 0.5, [backDoorX, 0.08, halfD + 0.3]), 0x8f8a80);
    supports.push({ x: backDoorX, z: halfD + 0.3, hx: 0.7, hz: 0.25, top: 0.16 });
  }

  // --- Végétation envahissante ---
  const ivyGeoms = [];
  const ivyCount = Math.round(condition * 14);
  for (let i = 0; i < ivyCount; i++) {
    const face = rng.int(0, 3);
    const h = rng.range(1.4, Math.min(4.2, floors * fh));
    const wdt = rng.range(1.0, 2.4);
    let px = 0, pz = 0, ry = 0;
    if (face === 0) { px = rng.range(-halfW, halfW); pz = -halfD - 0.08; ry = 0; }
    else if (face === 1) { px = rng.range(-halfW, halfW); pz = halfD + 0.08; ry = Math.PI; }
    else if (face === 2) { px = -halfW - 0.08; pz = rng.range(-halfD, halfD); ry = -Math.PI / 2; }
    else { px = halfW + 0.08; pz = rng.range(-halfD, halfD); ry = Math.PI / 2; }
    const g = new THREE.PlaneGeometry(wdt, h);
    transformGeometry(g, { pos: [px, h / 2, pz], rot: [0, ry, 0] });
    ivyGeoms.push(colorize(g, 0x7fa060));
  }
  if (ivyGeoms.length) {
    const mesh = new THREE.Mesh(mergeGeometries(ivyGeoms), materials().ivy);
    mesh.castShadow = false;
    group.add(mesh);
  }

  bucket.build(group);

  // Transformation locale -> monde
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const toWorld = (lx, ly, lz) => new THREE.Vector3(
    x + lx * cos + lz * sin,
    y + ly,
    z + -lx * sin + lz * cos,
  );

  const worldColliders = colliders.map((c) => ({
    ...c,
    wx: x + c.x * cos + c.z * sin,
    wy: y + c.y,
    wz: z + -c.x * sin + c.z * cos,
    yaw,
  }));
  const worldSupports = supports.map((s) => ({
    ...s,
    wx: x + s.x * cos + s.z * sin,
    wz: z + -s.x * sin + s.z * cos,
    top: y + s.top,
    yaw,
  }));
  for (const it of interactables) {
    it.world = toWorld(it.local.x, it.local.y, it.local.z);
    if (it.inside) {
      it.worldInside = toWorld(it.inside.x, it.inside.y, it.inside.z);
      it.worldOutside = toWorld(it.outside.x, it.outside.y, it.outside.z);
    }
    it.buildingId = id;
  }

  return {
    group,
    colliders: worldColliders,
    supports: worldSupports,
    interactables,
    meta: {
      id, type, label: spec.label, condition, W, D, floors, yaw,
      center: new THREE.Vector3(x, y, z),
      radius: Math.hypot(W, D) * 0.6 + 2,
      hasGarage: !!spec.garageDoor,
    },
  };
}
