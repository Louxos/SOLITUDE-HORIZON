/**
 * sw.js — Service worker : mise en cache de toutes les ressources du jeu
 * pour un fonctionnement hors ligne après le premier chargement.
 */
const CACHE = 'solitude-horizon-v4';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/main.css',
  './css/ui.css',
  './vendor/three/three.module.min.js',
  './vendor/three/three.core.min.js',
  './js/main.js',
  './js/core/config.js',
  './js/core/engine.js',
  './js/core/events.js',
  './js/core/geometry.js',
  './js/core/input.js',
  './js/core/noise.js',
  './js/core/rng.js',
  './js/core/settings.js',
  './js/core/textures.js',
  './js/world/world.js',
  './js/world/terrain.js',
  './js/world/chunks.js',
  './js/world/roads.js',
  './js/world/vegetation.js',
  './js/world/water.js',
  './js/world/buildings.js',
  './js/world/poi.js',
  './js/world/vehicles.js',
  './js/environment/sky.js',
  './js/environment/weather.js',
  './js/animals/animals.js',
  './js/player/player.js',
  './js/survival/stats.js',
  './js/inventory/items.js',
  './js/inventory/inventory.js',
  './js/interaction/interaction.js',
  './js/base/base.js',
  './js/audio/audio.js',
  './js/save/save.js',
  './js/ui/hud.js',
  './js/ui/panels.js',
  './js/ui/map.js',
  './js/ui/menu.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[sw] pré-cache partiel', err)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
