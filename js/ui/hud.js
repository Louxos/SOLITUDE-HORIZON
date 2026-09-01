/**
 * hud.js — Interface de jeu minimaliste : jauges, heure, météo, boussole,
 * indicateur d'interaction, notifications, mode debug.
 */

import { bus } from '../core/events.js';
import { settings } from '../core/settings.js';
import { itemDef } from '../inventory/items.js';
import { clamp } from '../core/noise.js';

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

export class Hud {
  constructor(root, world, engine) {
    this.world = world;
    this.engine = engine;
    this.root = root;
    this.debug = false;
    this.build();
    this.bindEvents();
  }

  build() {
    this.root.innerHTML = `
      <div id="crosshair" class="crosshair"></div>
      <div id="damage-flash" class="damage-flash"></div>
      <div id="vignette" class="vignette"></div>

      <div class="hud-top-right">
        <div class="clock-box">
          <div class="clock" id="hud-clock">07:30</div>
          <div class="clock-sub"><span id="hud-day">Jour 1</span> · <span id="hud-weather">Éclaircies</span></div>
          <div class="clock-sub"><span id="hud-temp">14°C</span> · <span id="hud-biome">Prairie</span></div>
        </div>
        <canvas id="minimap" width="150" height="150"></canvas>
        <div class="compass" id="hud-compass">N</div>
      </div>

      <div class="hud-bottom-left" id="hud-stats">
        <div class="stat" data-stat="health"><span class="ico">❤</span><div class="bar"><i></i></div></div>
        <div class="stat" data-stat="stamina"><span class="ico">⚡</span><div class="bar"><i></i></div></div>
        <div class="stat" data-stat="hunger"><span class="ico">🍖</span><div class="bar"><i></i></div></div>
        <div class="stat" data-stat="thirst"><span class="ico">💧</span><div class="bar"><i></i></div></div>
        <div class="stat" data-stat="fatigue"><span class="ico">🌙</span><div class="bar"><i></i></div></div>
        <div class="stat" data-stat="warmth"><span class="ico">🔥</span><div class="bar"><i></i></div></div>
      </div>

      <div class="hud-bottom-right">
        <div id="hud-carry">0.0 / 38 kg</div>
        <div id="hud-vehicle" class="vehicle-panel hidden"></div>
      </div>

      <div class="interact-prompt hidden" id="interact-prompt">
        <div class="ip-label"></div>
        <div class="ip-action"><span class="key">E</span> <span class="txt"></span></div>
        <div class="ip-sub"></div>
      </div>

      <div class="notifications" id="notifications"></div>
      <div class="discover-banner hidden" id="discover-banner">
        <div class="db-title">Nouvel endroit découvert</div>
        <div class="db-name"></div>
      </div>
      <div class="debug hidden" id="debug-panel"></div>
      <div class="underwater-overlay hidden" id="underwater"></div>
    `;

    this.el = {
      clock: document.getElementById('hud-clock'),
      day: document.getElementById('hud-day'),
      weather: document.getElementById('hud-weather'),
      temp: document.getElementById('hud-temp'),
      biome: document.getElementById('hud-biome'),
      compass: document.getElementById('hud-compass'),
      carry: document.getElementById('hud-carry'),
      prompt: document.getElementById('interact-prompt'),
      promptLabel: document.querySelector('#interact-prompt .ip-label'),
      promptKey: document.querySelector('#interact-prompt .key'),
      promptText: document.querySelector('#interact-prompt .txt'),
      promptSub: document.querySelector('#interact-prompt .ip-sub'),
      notifications: document.getElementById('notifications'),
      banner: document.getElementById('discover-banner'),
      bannerName: document.querySelector('#discover-banner .db-name'),
      debug: document.getElementById('debug-panel'),
      crosshair: document.getElementById('crosshair'),
      damage: document.getElementById('damage-flash'),
      underwater: document.getElementById('underwater'),
      vehicle: document.getElementById('hud-vehicle'),
      stats: {},
    };
    for (const key of ['health', 'stamina', 'hunger', 'thirst', 'fatigue', 'warmth']) {
      this.el.stats[key] = document.querySelector(`.stat[data-stat="${key}"] .bar i`);
    }
    this.root.style.setProperty('--hud-opacity', settings.data.hudOpacity);
  }

  bindEvents() {
    bus.on('interaction:prompt', (p) => this.setPrompt(p));
    bus.on('notify', (n) => this.notify(n));
    bus.on('poi:discovered', (def) => this.showBanner(def.name));
    bus.on('player:damaged', () => this.flashDamage());
    bus.on('input:keydown', (code) => {
      if (settings.data.bindings.debug.includes(code)) {
        this.debug = !this.debug;
        this.el.debug.classList.toggle('hidden', !this.debug);
      }
    });
    bus.on('settings:changed', ({ key }) => {
      if (key === 'hudOpacity') this.root.style.setProperty('--hud-opacity', settings.data.hudOpacity);
      if (key === 'crosshair') this.el.crosshair.classList.toggle('hidden', !settings.data.crosshair);
    });
  }

  setPrompt(p) {
    if (!p) { this.el.prompt.classList.add('hidden'); return; }
    this.el.prompt.classList.remove('hidden');
    this.el.promptLabel.textContent = p.label;
    this.el.promptText.textContent = p.action;
    this.el.promptKey.textContent = p.key || 'E';
    this.el.promptSub.textContent = p.sub || '';
  }

  notify({ text, sub, kind = 'info' }) {
    const el = document.createElement('div');
    el.className = `notification ${kind}`;
    el.innerHTML = sub ? `<b>${text}</b><span>${sub}</span>` : text;
    this.el.notifications.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 400);
    }, 3800);
    while (this.el.notifications.children.length > 5) this.el.notifications.firstChild.remove();
  }

  showBanner(name) {
    this.el.bannerName.textContent = name;
    this.el.banner.classList.remove('hidden');
    setTimeout(() => this.el.banner.classList.add('show'), 10);
    setTimeout(() => {
      this.el.banner.classList.remove('show');
      setTimeout(() => this.el.banner.classList.add('hidden'), 700);
    }, 4200);
  }

  flashDamage() {
    this.el.damage.classList.add('active');
    setTimeout(() => this.el.damage.classList.remove('active'), 220);
  }

  update(dt) {
    const w = this.world;
    const p = w.player;
    const s = p.stats;

    // Jauges (affichées seulement si pertinentes -> HUD adaptatif)
    const values = {
      health: s.health, stamina: (s.stamina / Math.max(1, s.maxStamina)) * 100,
      hunger: s.hunger, thirst: s.thirst, fatigue: s.fatigue, warmth: s.warmth,
    };
    for (const [key, el] of Object.entries(this.el.stats)) {
      const v = clamp(values[key], 0, 100);
      el.style.width = `${v}%`;
      const parent = el.closest('.stat');
      const critical = v < 30;
      parent.classList.toggle('critical', critical);
      // discret quand tout va bien
      const idle = v > 78 && key !== 'health';
      parent.classList.toggle('idle', idle && !this.debug);
    }

    this.el.clock.textContent = w.sky.timeString();
    this.el.day.textContent = `Jour ${w.sky.day}`;
    this.el.weather.textContent = w.weather.label;
    this.el.temp.textContent = `${Math.round(w.weather.temperature)}°C`;
    this.el.biome.textContent = w.terrain.biomeAt(p.position.x, p.position.z);
    this.el.carry.textContent = `${p.inventory.weight.toFixed(1)} / ${p.inventory.maxWeight} kg`;
    this.el.carry.classList.toggle('over', p.inventory.weight > p.inventory.maxWeight * 0.9);

    // Boussole
    let deg = (-p.yaw * 180 / Math.PI) % 360;
    if (deg < 0) deg += 360;
    const idx = Math.round(deg / 45) % 8;
    this.el.compass.textContent = `${DIRS[idx]} ${Math.round(deg)}°`;

    this.el.underwater.classList.toggle('hidden', !p.underwater);
    this.el.crosshair.classList.toggle('hidden', !settings.data.crosshair || p.vehicle);

    // Panneau véhicule
    if (p.vehicle) {
      const v = p.vehicle;
      this.el.vehicle.classList.remove('hidden');
      this.el.vehicle.innerHTML = `
        <div class="v-speed">${Math.abs(Math.round(v.speed * 3.6))} <span>km/h</span></div>
        <div class="v-fuel">Carburant ${v.fuel.toFixed(1)} L</div>
        <div class="v-hint">[E] sortir · [R] entretien</div>`;
    } else {
      this.el.vehicle.classList.add('hidden');
    }

    if (this.debug) {
      const r = this.engine.renderer.info.render;
      this.el.debug.innerHTML = `
        FPS ${this.engine.fps} · draw ${r.calls} · tri ${(r.triangles / 1000).toFixed(0)}k<br>
        pos ${p.position.x.toFixed(1)}, ${p.position.y.toFixed(1)}, ${p.position.z.toFixed(1)}<br>
        chunks ${this.world.chunks.chunks.size} (file ${this.world.chunks.pending})<br>
        lieux chargés ${this.world.poi.loaded.size}/${this.world.poi.defs.size} · animaux ${this.world.animals.animals.length}<br>
        biome ${this.world.terrain.biomeAt(p.position.x, p.position.z)} · surface ${this.world.terrain.surfaceAt(p.position.x, p.position.z)}<br>
        météo ${this.world.weather.state} → ${this.world.weather.next} (${(this.world.weather.blend * 100) | 0}%)<br>
        vent ${this.world.weather.windStrength.toFixed(2)} · pluie ${this.world.weather.rainIntensity.toFixed(2)} · humidité sol ${this.world.weather.wetness.toFixed(2)}<br>
        qualité ${settings.preset.name} · sol ${p.grounded ? 'oui' : 'non'} ${p.swimming ? '· nage' : ''} ${p.climbing ? '· escalade' : ''}
      `;
    }
  }
}
