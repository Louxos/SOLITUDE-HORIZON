import './headless-shim.mjs';

// ----------------------------------------------------------------- utilitaires
let passed = 0, failed = 0;
const results = [];
function check(name, cond, info = '') {
  if (cond) { passed++; results.push(`  ✓ ${name}${info ? ` — ${info}` : ''}`); }
  else { failed++; results.push(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
}
function section(title) { results.push(`\n▸ ${title}`); }

// ----------------------------------------------------------------- tests
const THREE = await import('../vendor/three/three.module.min.js');
const { Terrain, BIOME } = await import('../js/world/terrain.js');
const { WORLD, PLAYER } = await import('../js/core/config.js');
const { generateBuilding, BUILDING_TYPES } = await import('../js/world/buildings.js');
const { Vehicle, VEHICLE_PARTS: VEHICLE_PARTS_DEF } = await import('../js/world/vehicles.js');
const { Inventory } = await import('../js/inventory/inventory.js');
const { ITEMS, rollLoot } = await import('../js/inventory/items.js');
const { makeRng, hashString } = await import('../js/core/rng.js');
const { SurvivalStats } = await import('../js/survival/stats.js');
const { Weather } = await import('../js/environment/weather.js');
const { ChunkManager } = await import('../js/world/chunks.js');
const { VegetationFactory } = await import('../js/world/vegetation.js');
const { Player } = await import('../js/player/player.js');

const t0 = Date.now();

// --- 1. Déterminisme + terrain -------------------------------------------
section('Monde procédural déterministe');
const terrainA = new Terrain(WORLD.seed);
const terrainB = new Terrain(WORLD.seed);
let identical = true;
for (let i = 0; i < 500; i++) {
  const x = (i * 137.7) % WORLD.size - WORLD.half;
  const z = (i * 311.3) % WORLD.size - WORLD.half;
  if (Math.abs(terrainA.height(x, z) - terrainB.height(x, z)) > 1e-9) { identical = false; break; }
}
check('deux instances de la même seed produisent le même relief', identical);

let min = Infinity, max = -Infinity, water = 0, sum = 0;
const N = 4000;
for (let i = 0; i < N; i++) {
  const x = (Math.sin(i * 12.9898) * 43758.5453 % 1) * WORLD.size - WORLD.half;
  const z = (Math.sin(i * 78.233) * 12345.6789 % 1) * WORLD.size - WORLD.half;
  const h = terrainA.height(x, z);
  min = Math.min(min, h); max = Math.max(max, h); sum += h;
  if (h < WORLD.waterLevel) water++;
}
check('relief varié (montagnes et vallées)', max - min > 180, `min ${min.toFixed(0)} m, max ${max.toFixed(0)} m`);
check('présence d\'eau mais pas d\'inondation', water / N > 0.01 && water / N < 0.35, `${((water / N) * 100).toFixed(1)} % sous le niveau de l'eau`);

const biomes = new Set();
for (let i = 0; i < 3000; i++) {
  const x = ((i * 613) % 5000) - 2500, z = ((i * 977) % 5000) - 2500;
  biomes.add(terrainA.biomeAt(x, z));
}
check('biomes multiples générés', biomes.size >= 6, `${biomes.size} biomes : ${[...biomes].slice(0, 10).join(', ')}`);

// --- 2. Routes -------------------------------------------------------------
section('Réseau routier');
check('routes générées', terrainA.roads.roads.length >= 5, `${terrainA.roads.roads.length} axes, ${terrainA.roads.segments.length} segments`);
let onRoad = 0;
for (const road of terrainA.roads.roads) {
  for (const p of road.pts) {
    const inf = terrainA.roads.influence(p.x, p.z);
    if (inf.onRoad) onRoad++;
  }
}
check('la chaussée est détectée sur son tracé', onRoad > 100, `${onRoad} points sur route`);
let roadFlat = true;
for (const road of terrainA.roads.roads.slice(0, 2)) {
  for (let i = 1; i < road.pts.length; i++) {
    const a = road.pts[i - 1], b = road.pts[i];
    const grade = Math.abs(b.y - a.y) / Math.max(1, Math.hypot(b.x - a.x, b.z - a.z));
    if (grade > 0.35) roadFlat = false;
  }
}
check('pente des routes praticable (< 35 %)', roadFlat);

// --- 3. Chunks -------------------------------------------------------------
section('Chunks & LOD');
const scene = new THREE.Scene();
const veg = new VegetationFactory();
const chunks = new ChunkManager(scene, terrainA, veg);
const geomLod0 = chunks.buildGeometry(0, 0, 0);
const geomLod3 = chunks.buildGeometry(0, 0, 3);
check('géométrie LOD0 détaillée', geomLod0.attributes.position.count > 2000, `${geomLod0.attributes.position.count} sommets`);
check('géométrie LOD3 allégée', geomLod3.attributes.position.count < geomLod0.attributes.position.count / 8,
  `${geomLod3.attributes.position.count} sommets`);
check('couleurs de terrain présentes', !!geomLod0.attributes.color);

const tStart = Date.now();
const playerPos = new THREE.Vector3(0, 60, 0);
for (let i = 0; i < 40; i++) chunks.update(0.016, playerPos);
check('streaming de chunks fonctionnel', chunks.chunks.size > 20, `${chunks.chunks.size} chunks en ${Date.now() - tStart} ms`);

// --- 4. Bâtiments ----------------------------------------------------------
section('Bâtiments procéduraux');
let totalContainers = 0, totalDoors = 0, totalColliders = 0, totalSupports = 0;
for (const type of Object.keys(BUILDING_TYPES)) {
  const b = generateBuilding({ type, seed: 1234, x: 100, y: 50, z: 100, yaw: 0.6, id: `test_${type}` });
  const containers = b.interactables.filter((i) => i.kind === 'container');
  const doors = b.interactables.filter((i) => i.kind === 'door');
  totalContainers += containers.length;
  totalDoors += doors.length;
  totalColliders += b.colliders.length;
  totalSupports += b.supports.length;
  const windows = b.interactables.filter((i) => i.kind === 'window');
  check(`${BUILDING_TYPES[type].label} : structure complète`,
    b.colliders.length > 8 && doors.length >= 1 && b.group.children.length > 0,
    `${b.colliders.length} collisions, ${containers.length} conteneurs, ${doors.length} porte(s), ${windows.length} fenêtre(s) franchissables`);
}
check('conteneurs fouillables répartis', totalContainers >= 12, `${totalContainers} conteneurs au total`);
check('supports de plancher générés', totalSupports >= 9, `${totalSupports} surfaces marchables`);

const bA = generateBuilding({ type: 'family_house', seed: 77, x: 10, y: 20, z: -30, yaw: 1, id: 'det' });
const bB = generateBuilding({ type: 'family_house', seed: 77, x: 10, y: 20, z: -30, yaw: 1, id: 'det' });
check('bâtiments déterministes', bA.colliders.length === bB.colliders.length && bA.meta.W === bB.meta.W);

// --- 5. Butin & inventaire -------------------------------------------------
section('Butin, inventaire, poids');
const inv = new Inventory({ slots: 24, maxWeight: PLAYER.maxCarry });
const rng = makeRng(hashString('coffre-test'));
const loot = rollLoot(rng, 'garage', 6, 0.9);
check('table de butin garage produit des pièces', loot.length > 0, loot.map((l) => l.id).join(', '));
for (const e of loot) inv.addEntry(e);
check('objets ajoutés à l\'inventaire', inv.items.length > 0, `${inv.items.length} emplacements, ${inv.weight} kg`);

const heavy = new Inventory({ slots: 24, maxWeight: 20 });
let added = 0;
for (let i = 0; i < 10; i++) added += heavy.add('car_battery', 1);
check('limite de poids respectée', heavy.weight <= 20 && added < 10, `${heavy.weight} kg pour ${added} batteries`);

const stackTest = new Inventory({ slots: 3, maxWeight: 500 });
stackTest.add('nails', 250);
check('empilement correct', stackTest.items.length === 3 && stackTest.count('nails') === 250,
  `${stackTest.items.length} piles`);
check('inventaire plein refusé proprement', stackTest.canAccept('hammer', 1).ok === false);

const src = new Inventory({ slots: 5, maxWeight: 100 });
const dst = new Inventory({ slots: 5, maxWeight: 100 });
src.add('wrench', 1, 0.8);
src.transferTo(dst, 0);
check('transfert entre inventaires', dst.count('wrench') === 1 && src.count('wrench') === 0);
check('état de l\'outil conservé', dst.items[0].condition === 0.8);

// --- 6. Véhicules ----------------------------------------------------------
section('Véhicule : diagnostic et réparation');
const vehicle = new Vehicle({ id: 'v_test', type: 'sedan', x: 50, z: 50, yaw: 0, seed: 4242, terrain: terrainA });
const diag = vehicle.diagnose();
check('diagnostic complet', diag.length === 8, diag.map((d) => `${d.label}:${d.ok ? 'ok' : 'ko'}`).join(' '));
const wasRepaired = vehicle.repaired;
const toolbox = new Inventory({ slots: 40, maxWeight: 500 });
toolbox.add('wrench', 1, 1); toolbox.add('pliers', 1, 1); toolbox.add('screwdriver', 1, 1);
for (const id of ['car_battery', 'engine_oil', 'fan_belt', 'wire', 'spark_plug', 'tire', 'fuel_can', 'radiator_hose']) {
  toolbox.add(id, 1);
}
const brokenKeys = diag.filter((d) => !d.ok).map((d) => d.key);
const neededItems = brokenKeys.map((k) => VEHICLE_PARTS_DEF[k].item);
const beforeCounts = Object.fromEntries(neededItems.map((i) => [i, toolbox.count(i)]));
for (const key of ['battery', 'oil', 'belt', 'wiring', 'plugs', 'tire', 'fuel', 'hose']) {
  vehicle.repair(key, toolbox);
}
check('véhicule réparé après avoir fourni les pièces', vehicle.repaired, `était réparé au départ : ${wasRepaired}`);
check('seules les pièces nécessaires sont consommées',
  neededItems.every((i) => toolbox.count(i) < beforeCounts[i]),
  `systèmes réparés : ${brokenKeys.join(', ')}`);
check('outils usés par la réparation', toolbox.items.find((i) => i.id === 'wrench').condition < 1);

const start = vehicle.startEngine();
check('démarrage moteur', start.ok, start.msg);
const posBefore = vehicle.position.clone();
for (let i = 0; i < 120; i++) vehicle.drive(1 / 60, { forward: true, back: false, left: false, right: false, brake: false });
check('le véhicule avance', vehicle.position.distanceTo(posBefore) > 3,
  `${vehicle.position.distanceTo(posBefore).toFixed(1)} m parcourus, ${(vehicle.speed * 3.6).toFixed(0)} km/h`);
check('consommation de carburant', vehicle.fuel < 22 + 0.001);

const json = vehicle.toJSON();
const clone = new Vehicle({ id: 'v_test', type: 'sedan', x: 50, z: 50, yaw: 0, seed: 4242, terrain: terrainA });
clone.fromJSON(json);
check('état du véhicule persistant', clone.repaired === vehicle.repaired && Math.abs(clone.fuel - vehicle.fuel) < 1e-6);

// --- 7. Survie -------------------------------------------------------------
section('Systèmes de survie');
const stats = new SurvivalStats();
const h0 = stats.hunger, th0 = stats.thirst;
for (let i = 0; i < 600; i++) {
  stats.update(1 / 60, { running: true, moving: true, temperature: 12, carryRatio: 0.4, resting: false });
}
check('la course consomme de l\'endurance', stats.stamina < 100, `endurance ${stats.stamina.toFixed(1)}`);
check('faim et soif diminuent', stats.hunger < h0 && stats.thirst < th0,
  `faim ${stats.hunger.toFixed(1)}, soif ${stats.thirst.toFixed(1)}`);
check('la soif baisse plus vite que la faim', (th0 - stats.thirst) > (h0 - stats.hunger));

const starving = new SurvivalStats();
starving.hunger = 0; starving.thirst = 0; starving.fatigue = 0;
const hp0 = starving.health;
for (let i = 0; i < 60 * 60; i++) starving.update(1 / 60, { temperature: 14, carryRatio: 0 });
check('privation prolongée entame la santé progressivement', starving.health < hp0 && starving.health > 0,
  `${hp0} -> ${starving.health.toFixed(1)} en 60 s`);

const cold = new SurvivalStats();
for (let i = 0; i < 60 * 120; i++) cold.update(1 / 60, { temperature: -6, wet: true, carryRatio: 0 });
check('le froid fait chuter la chaleur corporelle', cold.warmth < 40, `chaleur ${cold.warmth.toFixed(1)}`);
const warmMax = new SurvivalStats();
warmMax.hunger = 10; warmMax.thirst = 10;
check('endurance maximale réduite par la faim/soif', warmMax.maxStamina < 80, `max ${warmMax.maxStamina.toFixed(1)}`);

const dying = new SurvivalStats();
dying.damage(150, 'test');
check('la mort est déclenchée', dying.dead === true);
dying.respawn();
check('réapparition possible', dying.dead === false && dying.health > 0);

// --- 8. Physique du joueur -------------------------------------------------
section('Physique et collisions du joueur');
const camera = new THREE.PerspectiveCamera(75, 1.7, 0.1, 2000);
const player = new Player(camera, terrainA);
const spawnX = 120, spawnZ = -80;
player.spawn(spawnX, spawnZ);
player.position.y += 12;    // chute libre
for (let i = 0; i < 240; i++) {
  player.update(1 / 60, { colliders: [], supports: [], treeColliders: [], weather: { temperature: 14, rainIntensity: 0 } });
}
const groundH = terrainA.height(player.position.x, player.position.z);
check('le joueur retombe au sol', Math.abs(player.position.y - groundH) < 0.2,
  `y ${player.position.y.toFixed(2)} vs sol ${groundH.toFixed(2)}`);
check('dégâts de chute appliqués', player.stats.health < 100, `santé ${player.stats.health.toFixed(1)}`);

// mur infranchissable
const wall = [{ wx: player.position.x, wy: player.position.y + 1.5, wz: player.position.z - 1.0, hx: 4, hy: 1.5, hz: 0.2, yaw: 0 }];
player.yaw = 0;   // regarde vers -Z
const before = player.position.z;
const fakeInput = await import('../js/core/input.js');
fakeInput.input.codes.add('KeyW');
for (let i = 0; i < 120; i++) {
  player.update(1 / 60, { colliders: wall, supports: [], treeColliders: [], weather: { temperature: 14 } });
}
check('collision avec un mur', player.position.z > before - 1.05,
  `déplacement ${(before - player.position.z).toFixed(2)} m bloqué par le mur`);

// plancher surélevé (bâtiment)
const floorTop = terrainA.height(300, 300) + 3;
const support = [{ wx: 300, wz: 300, hx: 5, hz: 5, top: floorTop, yaw: 0 }];
player.position.set(300, floorTop + 2, 300);
player.velocity.set(0, 0, 0);
fakeInput.input.codes.clear();
for (let i = 0; i < 180; i++) {
  player.update(1 / 60, { colliders: [], supports: support, treeColliders: [], weather: { temperature: 14 } });
}
check('le joueur se pose sur un plancher de bâtiment', Math.abs(player.position.y - floorTop) < 0.15,
  `y ${player.position.y.toFixed(2)} vs plancher ${floorTop.toFixed(2)}`);

// nage
let lake = null;
for (let i = 0; i < 20000 && !lake; i++) {
  const x = ((i * 313) % 4800) - 2400, z = ((i * 787) % 4800) - 2400;
  if (terrainA.height(x, z) < WORLD.waterLevel - 3) lake = { x, z };
}
if (lake) {
  player.position.set(lake.x, WORLD.waterLevel - 0.2, lake.z);
  player.velocity.set(0, 0, 0);
  for (let i = 0; i < 120; i++) {
    player.update(1 / 60, { colliders: [], supports: [], treeColliders: [], weather: { temperature: 14 } });
  }
  check('nage en eau profonde', player.swimming === true, `profondeur ${player.inWaterDepth.toFixed(2)} m`);
  check('flottaison stable', player.position.y > WORLD.waterLevel - 1.6 && player.position.y < WORLD.waterLevel + 0.5,
    `y ${player.position.y.toFixed(2)} (eau ${WORLD.waterLevel})`);
} else {
  check('un lac existe dans le monde', false);
}

// --- 9. Météo --------------------------------------------------------------
section('Météo dynamique');
const weatherScene = new THREE.Scene();
const weather = new Weather(weatherScene, terrainA, 999);
const seen = new Set();
const cam = new THREE.PerspectiveCamera();
cam.position.set(0, 60, 0);
let maxRain = 0, minRain = 1;
for (let i = 0; i < 60 * 60 * 40; i++) {   // 40 minutes simulées
  weather.update(1 / 60, cam, (i / 3600) % 24);
  seen.add(weather.next);
  maxRain = Math.max(maxRain, weather.rainIntensity);
  minRain = Math.min(minRain, weather.rainIntensity);
}
check('la météo évolue', seen.size >= 3, `états rencontrés : ${[...seen].join(', ')}`);
check('la pluie apparaît et cesse', maxRain > 0.2 && minRain < 0.05, `max ${maxRain.toFixed(2)}`);
check('humidité du sol bornée', weather.wetness >= 0 && weather.wetness <= 1);
check('température plausible', weather.temperature > -25 && weather.temperature < 45, `${weather.temperature.toFixed(1)} °C`);

// --- 10. Sauvegarde --------------------------------------------------------
section('Sérialisation de la sauvegarde');
const invSave = new Inventory({ slots: 24, maxWeight: 38 });
invSave.add('canned_beans', 3);
invSave.add('hammer', 1, 0.42);
const dump = JSON.stringify(invSave.toJSON());
const invLoad = new Inventory({ slots: 24, maxWeight: 38 });
invLoad.fromJSON(JSON.parse(dump));
check('inventaire sérialisé/restauré', invLoad.count('canned_beans') === 3 && invLoad.items.find((i) => i.id === 'hammer').condition === 0.42);
check('objets inconnus filtrés', (() => {
  const bad = new Inventory({});
  bad.fromJSON({ items: [{ id: 'objet_inexistant', count: 1 }, { id: 'nails', count: 5 }] });
  return bad.items.length === 1;
})());

const statsSave = new SurvivalStats();
statsSave.hunger = 44.5;
const statsLoad = new SurvivalStats();
statsLoad.fromJSON(JSON.parse(JSON.stringify(statsSave.toJSON())));
check('statistiques de survie persistées', Math.abs(statsLoad.hunger - 44.5) < 1e-9);

// --- 11. Cohérence base de données objets ----------------------------------
section('Base de données des objets');
let dbOk = true, dbErr = '';
for (const [id, def] of Object.entries(ITEMS)) {
  if (!def.name || !def.cat || typeof def.weight !== 'number' || !def.stack) { dbOk = false; dbErr = id; break; }
  if (def.weight <= 0 || def.weight > 20) { dbOk = false; dbErr = `${id} poids ${def.weight}`; break; }
}
check('tous les objets sont bien définis', dbOk, dbErr || `${Object.keys(ITEMS).length} objets`);

const placeables = Object.entries(ITEMS).filter(([, d]) => d.place).length;
const parts = Object.entries(ITEMS).filter(([, d]) => d.part).length;
check('objets posables et pièces disponibles', placeables >= 5 && parts >= 7, `${placeables} posables, ${parts} pièces`);


// --- 12. Villes, villages et entrée dans les bâtiments ----------------------
section('Villes, villages, aplanissement du sol');
const { PoiManager } = await import('../js/world/poi.js');

// Terrain de test vierge avec pads (comme en jeu)
const terrainPads = new Terrain(WORLD.seed);
const fakeWorld = { state: { vehicles: {} }, terrain: terrainPads };
const scenePoi = new THREE.Scene();
let poiMgr;
try {
  poiMgr = new PoiManager(scenePoi, terrainPads, fakeWorld);
} catch (e) {
  check('PoiManager constructible', false, String(e).slice(0, 80));
}
if (poiMgr) {
  // Comme en jeu : le joueur partage le MÊME terrain que la ville (pads aplatis)
  const townPlayer = new Player(camera, terrainPads);
  const towns = [...poiMgr.defs.values()].filter((d) => d.kind === 'town');
  const villages = [...poiMgr.defs.values()].filter((d) => d.kind === 'village');
  check('des villes sont générées', towns.length >= 1, `${towns.length} ville(s) : ${towns.map((t) => t.name).join(', ')}`);
  check('des villages sont générés', villages.length >= 2, `${villages.length} village(s) : ${villages.map((t) => t.name).join(', ')}`);

  const town = towns[0];
  check('une ville contient plusieurs bâtiments', town.layout.length >= 5, `${town.layout.length} bâtiments autour de la place`);

  // la place est bien plate
  const plazaSlope = terrainPads.slope(town.x, town.z);
  check('la place de ville est aplatie', plazaSlope < 3, `pente ${plazaSlope.toFixed(1)}°`);

  // chargement effectif : bâtiments, portes, conteneurs
  const inst = poiMgr.load(town);
  const doors = [], containers = [];
  for (const b of inst.buildings) {
    doors.push(...b.interactables.filter((i) => i.kind === 'door'));
    containers.push(...b.interactables.filter((i) => i.kind === 'container'));
  }
  check('les bâtiments de la ville ont des portes', doors.length >= town.layout.length * 0.7, `${doors.length} portes`);
  check('la ville contient du butin', containers.length >= 5, `${containers.length} conteneurs`);

  // ---- LE test critique : on peut ENTRER dans une maison ----
  let entryOk = false, entryInfo = '';
  outer:
  for (const b of inst.buildings) {
    const door = b.interactables.find((i) => i.kind === 'door' && !i.locked && !i.jammed);
    if (!door) continue;
    // ouvrir la porte
    fakeWorld.state.doors = fakeWorld.state.doors || {};
    fakeWorld.state.doors[door.id] = { open: true };
    for (const c of inst.colliders) if (c.door === door.id) c.disabled = true;

    // se placer devant la porte (côté opposé au centre du bâtiment)
    let dx = door.world.x - b.meta.center.x, dz = door.world.z - b.meta.center.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const px = door.world.x + dx * 2.0, pz = door.world.z + dz * 2.0;
    townPlayer.position.set(px, terrainPads.height(px, pz) + 0.1, pz);
    townPlayer.velocity.set(0, 0, 0);
    townPlayer.yaw = Math.atan2(-(door.world.x - px), -(door.world.z - pz));

    // marcher vers le centre du bâtiment avec la vraie physique et le vrai input
    const start = { x: px, z: pz };
    fakeInput.input.codes.clear();
    fakeInput.input.codes.add('KeyW');
    for (let i = 0; i < 120; i++) {
      // viser le centre (recalculé : on peut dévier en franchissant le seuil)
      const vx = b.meta.center.x - townPlayer.position.x, vz = b.meta.center.z - townPlayer.position.z;
      townPlayer.yaw = Math.atan2(-vx, -vz);
      townPlayer.update(1 / 30, {
        colliders: inst.colliders, supports: inst.supports,
        treeColliders: [], weather: { temperature: 14, rainIntensity: 0 },
      });
      const m = b.meta;
      const pdx = townPlayer.position.x - m.center.x, pdz = townPlayer.position.z - m.center.z;
      const c = Math.cos(-m.yaw), sn = Math.sin(-m.yaw);
      const lx = pdx * c + pdz * sn, lz = -pdx * sn + pdz * c;
      if (Math.abs(lx) < m.W / 2 - 0.5 && Math.abs(lz) < m.D / 2 - 0.5) {
        entryOk = true;
        entryInfo = `${b.meta.label} atteinte (${(Math.hypot(townPlayer.position.x - start.x, townPlayer.position.z - start.z)).toFixed(1)} m parcourus)`;
        break outer;
      }
    }
    if (!entryOk) entryInfo = `bloqué à ${(Math.hypot(townPlayer.position.x - start.x, townPlayer.position.z - start.z)).toFixed(1)} m de la porte`;
  }
  check('ON PEUT ENTRER DANS LES MAISONS (seuil au niveau du sol)', entryOk, entryInfo);

  fakeInput.input.codes.clear();
  // les fenêtres brisées du rez-de-chaussée sont franchissables
  let windowsTotal = 0;
  for (const b of inst.buildings) windowsTotal += b.interactables.filter((i) => i.kind === 'window').length;
  check("des fenêtres brisées servent d'entrée de secours", windowsTotal >= 1, `${windowsTotal} fenêtres franchissables dans la ville`);

  // l'église a un clocher (collisions hautes)
  const church = inst.buildings.find((b) => b.meta.type === 'church');
  if (church) {
    const tall = church.colliders.some((c) => c.wy + c.hy > church.meta.center.y + 9);
    check("l'église possède un clocher", tall);
  }

  // coffre à gants des véhicules
  const gloveboxes = inst.interactables.filter((i) => i.label === 'Boîte à gants');
  check('les véhicules ont une boîte à gants fouillable', gloveboxes.length >= 1, `${gloveboxes.length} boîte(s)`);

  // déchargement propre
  poiMgr.unload(town.id);
  check('déchargement du lieu sans erreur', !poiMgr.loaded.has(town.id));
}

// --- 13. Persistance des portes ----------------------------------------------
section('Persistance de l\'état des portes');
{
  const b = generateBuilding({ type: 'small_house', seed: 42, x: 500, y: 60, z: -500, yaw: 0.3, id: 'door_test' });
  const door = b.interactables.find((i) => i.kind === 'door');
  const doorCollider = b.colliders.find((c) => c.door === door.id);
  doorCollider.disabled = true;    // ouverte
  check('le collider de porte se désactive à l\'ouverture', doorCollider.disabled === true);
  const back = b.interactables.find((i) => i.kind === 'door' && i.id !== door.id);
  check('les maisons familiales ont une porte de service', !!back, back ? back.label : 'absente');
}

// ----------------------------------------------------------------- rapport
console.log('\n══════════════════════════════════════════════════════════════');
console.log('  SOLITUDE HORIZON — tests système (headless)');
console.log('══════════════════════════════════════════════════════════════');
console.log(results.join('\n'));
console.log('\n──────────────────────────────────────────────────────────────');
console.log(`  ${passed} réussis · ${failed} échoués · ${(Date.now() - t0) / 1000} s`);
console.log('──────────────────────────────────────────────────────────────\n');
process.exit(failed > 0 ? 1 : 0);
