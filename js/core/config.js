/**
 * config.js — Constantes globales du jeu.
 * Toutes les valeurs "magiques" partagées vivent ici.
 */

export const WORLD_SEED = 847291;

export const WORLD = {
  seed: WORLD_SEED,
  size: 5120,            // monde 5.12 km x 5.12 km
  get half() { return this.size / 2; },
  chunkSize: 256,        // taille d'un chunk en mètres
  waterLevel: 9.5,       // altitude de la nappe d'eau
  maxHeight: 420,
};

export const QUALITY_PRESETS = {
  low: {
    name: 'Bas',
    pixelRatio: 0.75,
    shadows: false,
    shadowMapSize: 1024,
    viewDistance: 1100,
    chunkRadius: 5,
    treeDensity: 0.45,
    grass: false,
    grassRadius: 0,
    rainParticles: 1500,
    anisotropy: 1,
    animals: 8,
  },
  medium: {
    name: 'Moyen',
    pixelRatio: 1,
    shadows: true,
    shadowMapSize: 1024,
    viewDistance: 1700,
    chunkRadius: 7,
    treeDensity: 0.7,
    grass: true,
    grassRadius: 40,
    rainParticles: 3500,
    anisotropy: 4,
    animals: 14,
  },
  high: {
    name: 'Élevé',
    pixelRatio: 1,
    shadows: true,
    shadowMapSize: 2048,
    viewDistance: 2400,
    chunkRadius: 10,
    treeDensity: 1,
    grass: true,
    grassRadius: 64,
    rainParticles: 6000,
    anisotropy: 8,
    animals: 22,
  
    postfx: true,
  },
};

export const PLAYER = {
  eyeHeight: 1.68,
  crouchEyeHeight: 1.05,
  radius: 0.34,
  walkSpeed: 2.5,
  runSpeed: 5.1,
  crouchSpeed: 1.25,
  swimSpeed: 1.7,
  waterWalkSpeed: 1.5,
  jumpSpeed: 4.4,
  gravity: 20.5,
  accel: 24,
  airAccel: 5,
  friction: 11,
  maxSlopeCos: Math.cos(48 * Math.PI / 180), // pente maximale marchable
  climbSlopeCos: Math.cos(70 * Math.PI / 180),
  stepHeight: 0.55,
  maxCarry: 38,          // kg avant surcharge
};

export const SURVIVAL = {
  // Unités par heure de jeu
  hungerPerHour: 4.2,
  thirstPerHour: 6.4,
  fatiguePerHour: 3.6,
  staminaRegen: 11.5,    // par seconde au repos
  staminaRun: 6.2,       // par seconde de course
  staminaClimb: 12,
  staminaSwim: 4.5,
  healthRegen: 0.32,     // par seconde en bonne condition
};

// 1 seconde réelle = TIME_SCALE secondes de jeu (24 min réelles = 1 jour)
export const TIME_SCALE = 60;

export const SAVE_KEY = 'solitude-horizon:save:v1';
export const SETTINGS_KEY = 'solitude-horizon:settings:v1';

export const LAYERS = {
  DEFAULT: 0,
};
