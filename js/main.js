/**
 * main.js — Amorçage : moteur, chargement, monde, UI, boucle de jeu.
 */

import { Engine } from './core/engine.js';
import { input } from './core/input.js';
import { settings } from './core/settings.js';
import { bus } from './core/events.js';
import { ALL_TEXTURES, preloadTextures, applyPhotoTextures } from './core/textures.js';
import { World } from './world/world.js';
import { SaveManager } from './save/save.js';
import { Hud } from './ui/hud.js';
import { Panels } from './ui/panels.js';
import { MapSystem } from './ui/map.js';
import { Menu } from './ui/menu.js';
import { audio } from './audio/audio.js';

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');
const hudRoot = document.getElementById('hud');

let engine = null;
let world = null;
let hud = null;
let panels = null;
let map = null;
let save = null;
let started = false;

const menu = new Menu(uiRoot, {
  onNewGame: () => boot(null),
  onContinue: async () => boot(await SaveManager.loadData()),
});

async function boot(saveData) {
  if (started) return;
  started = true;
  menu.showLoading('Initialisation du moteur');

  engine = new Engine(canvas);
  input.attach(canvas);
  audio.init();

  await frame();
  menu.setProgress(0.05, 'Génération des textures');
  await preloadTextures(ALL_TEXTURES, (p) => menu.setProgress(0.05 + p * 0.3, 'Génération des textures'));
  await applyPhotoTextures((p) => menu.setProgress(0.35 + p * 0.1, 'Application des textures photo'));

  menu.setProgress(0.42, 'Modelage du relief');
  await frame();
  world = new World(engine);

  menu.setProgress(0.6, 'Placement des lieux abandonnés');
  await frame();
  world.start(saveData);

  save = new SaveManager(world);
  hud = new Hud(hudRoot, world, engine);
  panels = new Panels(uiRoot, world, save);
  map = new MapSystem(uiRoot, world);
  menu.attach(world, save);

  // Pré-construction des chunks autour du joueur avant d'afficher le monde
  menu.setProgress(0.7, 'Construction du terrain');
  for (let i = 0; i < 30; i++) {
    world.chunks.update(0.016, world.player.position);
    menu.setProgress(0.7 + (i / 30) * 0.2, 'Construction du terrain');
    if (world.chunks.pending === 0 && i > 6) break;
    await frame();
  }

  menu.setProgress(0.92, 'Cartographie');
  for (let i = 0; i < 24 && !map.ready; i++) {
    map.buildStep(24);
    await frame();
  }

  menu.setProgress(1, 'Prêt');
  await frame();
  menu.hideLoading();

  engine.add({
    alwaysUpdate: true,
    update: (dt) => {
      if (!world.paused) {
        world.update(dt);
        save.update(dt);
      }
      hud.update(dt);
      map.update(dt);
      input.endFrame();
    },
  });
  engine.start();

  // Le pointer lock nécessite un geste utilisateur
  canvas.addEventListener('click', () => {
    if (!world.paused && !panels.open && !map.visible && !world.player.stats.dead) {
      audio.resume();
      input.requestLock();
    }
  });
  bus.emit('notify', { text: 'Clic pour capturer la souris · ÉCHAP pour le menu', kind: 'system' });
  input.requestLock();
}

function frame() {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

// Enregistrement du service worker (fonctionnement hors ligne)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('[pwa] service worker non enregistré', err);
    });
  });
}

// Filet de sécurité : une erreur ne doit pas laisser un écran noir muet
window.addEventListener('error', (e) => {
  console.error('[fatal]', e.error || e.message);
  const el = document.getElementById('loading-text');
  if (el && !document.getElementById('loading').classList.contains('hidden')) {
    el.textContent = `Erreur : ${e.message}`;
  }
});

window.__game = { get engine() { return engine; }, get world() { return world; }, settings, bus };
