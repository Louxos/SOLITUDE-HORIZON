/**
 * items.js — Base de données des objets + tables de butin.
 * Chaque objet est réellement utilisable par un système du jeu
 * (survie, réparation, base, éclairage…).
 */

export const CATEGORY = {
  FOOD: 'Nourriture',
  DRINK: 'Boisson',
  TOOL: 'Outil',
  MATERIAL: 'Matériau',
  PART: 'Pièce mécanique',
  MEDICAL: 'Médical',
  BUILD: 'Construction',
  MISC: 'Divers',
};

/**
 * weight : kg — stack : empilement max — cond : possède un état d'usure
 */
export const ITEMS = {
  // --- Nourriture ---
  canned_beans: { name: 'Conserve de haricots', cat: CATEGORY.FOOD, weight: 0.42, stack: 6, food: 26, thirst: 3, desc: "Une boîte cabossée. Le métal a tenu.", icon: '🥫' },
  canned_meat: { name: 'Conserve de viande', cat: CATEGORY.FOOD, weight: 0.38, stack: 6, food: 32, thirst: -2, desc: 'Date de péremption illisible.', icon: '🥫' },
  dry_biscuits: { name: 'Biscuits secs', cat: CATEGORY.FOOD, weight: 0.2, stack: 8, food: 14, thirst: -5, desc: 'Emballage intact, miracle.', icon: '🍪' },
  berries: { name: 'Baies sauvages', cat: CATEGORY.FOOD, weight: 0.12, stack: 12, food: 8, thirst: 4, desc: 'Cueillies dans les fourrés.', icon: '🫐' },
  mushroom: { name: 'Champignon', cat: CATEGORY.FOOD, weight: 0.09, stack: 12, food: 6, thirst: 1, risk: 0.18, desc: 'Comestible… probablement.', icon: '🍄' },
  cooked_meat: { name: 'Viande cuite', cat: CATEGORY.FOOD, weight: 0.35, stack: 5, food: 38, thirst: -3, desc: 'Cuite sur un feu.', icon: '🍖' },
  raw_meat: { name: 'Viande crue', cat: CATEGORY.FOOD, weight: 0.5, stack: 5, food: 12, thirst: 0, risk: 0.45, desc: 'À cuire avant consommation.', icon: '🥩' },

  // --- Boisson ---
  water_bottle: { name: "Bouteille d'eau", cat: CATEGORY.DRINK, weight: 0.6, stack: 4, thirst: 40, container: true, desc: 'Bouteille remplissable.', icon: '💧' },
  empty_bottle: { name: 'Bouteille vide', cat: CATEGORY.DRINK, weight: 0.15, stack: 4, fillable: 'water_bottle', desc: 'Peut être remplie à un point d\'eau.', icon: '🍾' },
  dirty_water: { name: 'Eau non traitée', cat: CATEGORY.DRINK, weight: 0.6, stack: 4, thirst: 34, risk: 0.35, desc: 'Prélevée dans un lac. À faire bouillir.', icon: '🥛' },
  canteen: { name: 'Gourde militaire', cat: CATEGORY.DRINK, weight: 0.8, stack: 2, thirst: 55, container: true, desc: 'Robuste, grande capacité.', icon: '🧴' },

  // --- Outils ---
  flashlight: { name: 'Lampe torche', cat: CATEGORY.TOOL, weight: 0.4, stack: 1, cond: true, tool: 'light', desc: 'Fonctionne avec des piles.', icon: '🔦' },
  battery_aa: { name: 'Piles', cat: CATEGORY.TOOL, weight: 0.05, stack: 12, desc: 'Recharge la lampe torche.', icon: '🔋' },
  screwdriver: { name: 'Tournevis', cat: CATEGORY.TOOL, weight: 0.18, stack: 1, cond: true, tool: 'screwdriver', desc: 'Indispensable pour l\'électricité.', icon: '🪛' },
  hammer: { name: 'Marteau', cat: CATEGORY.TOOL, weight: 0.65, stack: 1, cond: true, tool: 'hammer', damage: 22, desc: 'Sert aussi à se défendre.', icon: '🔨' },
  wrench: { name: 'Clé à molette', cat: CATEGORY.TOOL, weight: 0.7, stack: 1, cond: true, tool: 'wrench', damage: 20, desc: 'Mécanique lourde.', icon: '🔧' },
  pliers: { name: 'Pince', cat: CATEGORY.TOOL, weight: 0.3, stack: 1, cond: true, tool: 'pliers', desc: 'Câblage, fil de fer.', icon: '🗜️' },
  multitool: { name: 'Outil multifonction', cat: CATEGORY.TOOL, weight: 0.25, stack: 1, cond: true, tool: 'multi', desc: 'Remplace la plupart des outils, s\'use vite.', icon: '🛠️' },
  axe: { name: 'Hache', cat: CATEGORY.TOOL, weight: 1.8, stack: 1, cond: true, tool: 'axe', damage: 40, desc: 'Bois de chauffage et dernier recours.', icon: '🪓' },
  lighter: { name: 'Briquet', cat: CATEGORY.TOOL, weight: 0.03, stack: 1, cond: true, tool: 'fire', desc: 'Encore un peu de gaz.', icon: '🔥' },

  // --- Matériaux ---
  scrap_metal: { name: 'Ferraille', cat: CATEGORY.MATERIAL, weight: 1.1, stack: 20, desc: 'Tôle et pièces récupérées.', icon: '⚙️' },
  wood_plank: { name: 'Planche', cat: CATEGORY.MATERIAL, weight: 1.6, stack: 20, desc: 'Bois récupéré.', icon: '🪵' },
  nails: { name: 'Clous', cat: CATEGORY.MATERIAL, weight: 0.02, stack: 100, desc: 'Poignée de clous rouillés.', icon: '📌' },
  cloth: { name: 'Tissu', cat: CATEGORY.MATERIAL, weight: 0.1, stack: 30, desc: 'Chiffons propres.', icon: '🧵' },
  rope: { name: 'Corde', cat: CATEGORY.MATERIAL, weight: 0.8, stack: 6, desc: 'Quelques mètres solides.', icon: '🪢' },
  duct_tape: { name: 'Ruban adhésif', cat: CATEGORY.MATERIAL, weight: 0.2, stack: 6, desc: 'Répare presque tout, provisoirement.', icon: '🩹' },
  wire: { name: 'Fil électrique', cat: CATEGORY.MATERIAL, weight: 0.25, stack: 12, desc: 'Cuivre isolé.', icon: '🔌' },

  // --- Pièces mécaniques ---
  car_battery: { name: 'Batterie de voiture', cat: CATEGORY.PART, weight: 14.5, stack: 1, cond: true, part: 'battery', desc: 'Lourde. Charge résiduelle inconnue.', icon: '🔋' },
  engine_oil: { name: "Bidon d'huile", cat: CATEGORY.PART, weight: 4.2, stack: 2, part: 'oil', desc: 'Huile moteur 5L.', icon: '🛢️' },
  fan_belt: { name: 'Courroie', cat: CATEGORY.PART, weight: 0.4, stack: 3, part: 'belt', desc: 'Caoutchouc encore souple.', icon: '⭕' },
  spark_plug: { name: 'Bougies', cat: CATEGORY.PART, weight: 0.3, stack: 4, part: 'plugs', desc: 'Jeu de quatre.', icon: '🕯️' },
  fuel_can: { name: 'Jerrican de carburant', cat: CATEGORY.PART, weight: 15, stack: 1, part: 'fuel', fuel: 22, desc: '20 litres, odeur d\'essence éventée.', icon: '⛽' },
  tire: { name: 'Roue de secours', cat: CATEGORY.PART, weight: 11, stack: 1, part: 'tire', desc: 'Gomme dure mais utilisable.', icon: '🛞' },
  radiator_hose: { name: 'Durite', cat: CATEGORY.PART, weight: 0.5, stack: 3, part: 'hose', desc: 'Caoutchouc de refroidissement.', icon: '🧯' },

  // --- Médical ---
  bandage: { name: 'Bandage', cat: CATEGORY.MEDICAL, weight: 0.08, stack: 10, heal: 18, desc: 'Stoppe les saignements.', icon: '🩹' },
  painkillers: { name: 'Antidouleurs', cat: CATEGORY.MEDICAL, weight: 0.05, stack: 8, heal: 8, stamina: 25, desc: 'Atténue la douleur un moment.', icon: '💊' },
  antiseptic: { name: 'Antiseptique', cat: CATEGORY.MEDICAL, weight: 0.15, stack: 4, heal: 10, cure: true, desc: 'Désinfecte une plaie ou une eau douteuse.', icon: '🧪' },
  first_aid: { name: 'Trousse de secours', cat: CATEGORY.MEDICAL, weight: 0.9, stack: 2, heal: 55, cure: true, desc: 'Complète, rare.', icon: '⛑️' },

  // --- Construction / base ---
  storage_crate: { name: 'Caisse de rangement', cat: CATEGORY.BUILD, weight: 6, stack: 3, place: 'chest', desc: 'Peut être posée dans votre refuge.', icon: '📦' },
  camp_lamp: { name: 'Lampe de camp', cat: CATEGORY.BUILD, weight: 1.4, stack: 3, place: 'lamp', desc: 'Éclaire une pièce, fonctionne aux piles.', icon: '🏮' },
  bed_roll: { name: 'Sac de couchage', cat: CATEGORY.BUILD, weight: 2.5, stack: 1, place: 'bed', desc: 'Permet de dormir n\'importe où.', icon: '🛏️' },
  campfire_kit: { name: 'Foyer de camp', cat: CATEGORY.BUILD, weight: 3.5, stack: 2, place: 'fire', desc: 'Pierres et bois : chaleur et cuisson.', icon: '🔥' },
  workbench_kit: { name: 'Établi démontable', cat: CATEGORY.BUILD, weight: 9, stack: 1, place: 'bench', desc: 'Permet la fabrication et la réparation.', icon: '🧰' },

  // --- Divers ---
  keys: { name: 'Trousseau de clés', cat: CATEGORY.MISC, weight: 0.05, stack: 4, desc: 'Ouvre peut-être une porte du secteur.', icon: '🔑' },
  photo: { name: 'Photographie', cat: CATEGORY.MISC, weight: 0.01, stack: 10, lore: true, desc: 'Un visage effacé par l\'humidité.', icon: '🖼️' },
  notebook: { name: 'Carnet', cat: CATEGORY.MISC, weight: 0.15, stack: 5, lore: true, desc: 'Des notes d\'un ancien habitant.', icon: '📓' },
  map_fragment: { name: 'Fragment de carte', cat: CATEGORY.MISC, weight: 0.02, stack: 6, reveal: 340, desc: 'Révèle une portion de la région.', icon: '🗺️' },
  radio: { name: 'Radio portable', cat: CATEGORY.MISC, weight: 0.9, stack: 1, cond: true, desc: 'Statique. Rien que de la statique.', icon: '📻' },
  road_sign: { name: 'Panneau routier', cat: CATEGORY.MISC, weight: 2.2, stack: 3, lore: true, desc: '"Saint-Elme — 12 km". La peinture s\'écaille.', icon: '🪧' },
  old_coin: { name: 'Pièce ancienne', cat: CATEGORY.MISC, weight: 0.01, stack: 24, desc: 'Une devise qui ne vaut plus rien. Presque jolie.', icon: '🪙' },
  candle: { name: 'Bougie de pain', cat: CATEGORY.MISC, weight: 0.08, stack: 6, desc: 'Cire poussiéreuse, encore longue.', icon: '🕯️' },
};

export function itemDef(id) {
  const def = ITEMS[id];
  if (!def) throw new Error(`objet inconnu: ${id}`);
  return def;
}

/** Tables de butin par type de conteneur / lieu. */
export const LOOT_TABLES = {
  kitchen: [
    { w: 16, id: 'canned_beans', min: 1, max: 2 },
    { w: 12, id: 'canned_meat' }, { w: 10, id: 'dry_biscuits' },
    { w: 8, id: 'empty_bottle' }, { w: 6, id: 'water_bottle' },
    { w: 5, id: 'cloth', min: 1, max: 3 }, { w: 4, id: 'lighter' },
    { w: 3, id: 'painkillers' }, { w: 2, id: 'keys' }, { w: 14, id: null },
  ],
  bedroom: [
    { w: 10, id: 'cloth', min: 1, max: 4 }, { w: 7, id: 'photo' },
    { w: 6, id: 'notebook' }, { w: 6, id: 'battery_aa', min: 1, max: 3 },
    { w: 5, id: 'flashlight' }, { w: 4, id: 'painkillers' },
    { w: 3, id: 'bandage', min: 1, max: 2 }, { w: 3, id: 'map_fragment' },
    { w: 2, id: 'radio' }, { w: 16, id: null },
  ],
  bathroom: [
    { w: 12, id: 'bandage', min: 1, max: 3 }, { w: 9, id: 'antiseptic' },
    { w: 7, id: 'painkillers' }, { w: 4, id: 'first_aid' },
    { w: 6, id: 'cloth' }, { w: 18, id: null },
  ],
  garage: [
    { w: 12, id: 'scrap_metal', min: 1, max: 3 }, { w: 10, id: 'wrench' },
    { w: 9, id: 'screwdriver' }, { w: 8, id: 'pliers' }, { w: 7, id: 'hammer' },
    { w: 7, id: 'wire', min: 1, max: 2 }, { w: 6, id: 'duct_tape' },
    { w: 5, id: 'engine_oil' }, { w: 5, id: 'fan_belt' }, { w: 4, id: 'spark_plug' },
    { w: 3, id: 'car_battery' }, { w: 3, id: 'fuel_can' }, { w: 3, id: 'tire' },
    { w: 3, id: 'radiator_hose' }, { w: 2, id: 'multitool' }, { w: 12, id: null },
  ],
  workshop: [
    { w: 12, id: 'nails', min: 5, max: 30 }, { w: 10, id: 'wood_plank', min: 1, max: 4 },
    { w: 9, id: 'scrap_metal', min: 1, max: 4 }, { w: 8, id: 'screwdriver' },
    { w: 7, id: 'rope' }, { w: 6, id: 'axe' }, { w: 5, id: 'workbench_kit' },
    { w: 5, id: 'storage_crate' }, { w: 4, id: 'camp_lamp' }, { w: 3, id: 'multitool' },
    { w: 14, id: null },
  ],
  shed: [
    { w: 10, id: 'wood_plank', min: 1, max: 3 }, { w: 9, id: 'nails', min: 4, max: 20 },
    { w: 8, id: 'rope' }, { w: 7, id: 'scrap_metal' }, { w: 6, id: 'campfire_kit' },
    { w: 5, id: 'fuel_can' }, { w: 4, id: 'bed_roll' }, { w: 16, id: null },
  ],
  vehicle: [
    { w: 10, id: 'duct_tape' }, { w: 8, id: 'wire' }, { w: 7, id: 'screwdriver' },
    { w: 6, id: 'map_fragment' }, { w: 6, id: 'empty_bottle' }, { w: 5, id: 'keys' },
    { w: 4, id: 'spark_plug' }, { w: 3, id: 'first_aid' }, { w: 18, id: null },
  ],
  store: [
    { w: 14, id: 'canned_beans', min: 1, max: 3 }, { w: 10, id: 'canned_meat', min: 1, max: 2 },
    { w: 10, id: 'dry_biscuits', min: 1, max: 3 }, { w: 8, id: 'water_bottle', min: 1, max: 2 },
    { w: 7, id: 'battery_aa', min: 1, max: 4 }, { w: 6, id: 'cloth', min: 1, max: 4 },
    { w: 5, id: 'painkillers' }, { w: 4, id: 'lighter' }, { w: 4, id: 'old_coin', min: 1, max: 3 },
    { w: 3, id: 'map_fragment' }, { w: 3, id: 'radio' }, { w: 2, id: 'first_aid' },
    { w: 12, id: null },
  ],
  gasstation: [
    { w: 12, id: 'fuel_can' }, { w: 10, id: 'engine_oil', min: 1, max: 2 },
    { w: 9, id: 'fan_belt' }, { w: 8, id: 'spark_plug' }, { w: 8, id: 'duct_tape' },
    { w: 7, id: 'scrap_metal', min: 1, max: 3 }, { w: 6, id: 'wire', min: 1, max: 2 },
    { w: 5, id: 'wrench' }, { w: 4, id: 'dry_biscuits', min: 1, max: 2 }, { w: 4, id: 'canned_beans' },
    { w: 3, id: 'radiator_hose' }, { w: 2, id: 'car_battery' }, { w: 2, id: 'road_sign' }, { w: 14, id: null },
  ],
  chapel: [
    { w: 10, id: 'candle', min: 1, max: 4 }, { w: 7, id: 'old_coin', min: 1, max: 2 },
    { w: 6, id: 'bandage' }, { w: 5, id: 'notebook' }, { w: 4, id: 'photo' },
    { w: 3, id: 'first_aid' }, { w: 2, id: 'keys' }, { w: 20, id: null },
  ],
  cave: [
    { w: 8, id: 'mushroom', min: 1, max: 4 }, { w: 6, id: 'scrap_metal' },
    { w: 5, id: 'rope' }, { w: 4, id: 'flashlight' }, { w: 3, id: 'first_aid' },
    { w: 2, id: 'canteen' }, { w: 16, id: null },
  ],
  wild: [
    { w: 14, id: 'berries', min: 1, max: 5 }, { w: 10, id: 'mushroom', min: 1, max: 3 },
    { w: 6, id: 'wood_plank' }, { w: 20, id: null },
  ],
};

/** Génère le contenu d'un conteneur (déterministe via le rng fourni). */
export function rollLoot(rng, table, rolls = 3, rarity = 1) {
  const entries = LOOT_TABLES[table] || LOOT_TABLES.shed;
  const out = [];
  for (let i = 0; i < rolls; i++) {
    const pick = rng.weighted(entries);
    if (!pick.id) continue;
    if (rng() > rarity) continue;
    const def = ITEMS[pick.id];
    const count = pick.min ? rng.int(pick.min, pick.max ?? pick.min) : 1;
    const entry = { id: pick.id, count };
    if (def.cond) entry.condition = Math.round(rng.range(0.25, 0.95) * 100) / 100;
    out.push(entry);
  }
  return out;
}
