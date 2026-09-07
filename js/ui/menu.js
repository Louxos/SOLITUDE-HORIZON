/**
 * menu.js — Écran-titre, chargement, menu pause et paramètres (dont contrôles).
 */

import { bus } from '../core/events.js';
import { input } from '../core/input.js';
import { settings, DEFAULT_BINDINGS } from '../core/settings.js';
import { QUALITY_PRESETS } from '../core/config.js';
import { SaveManager } from '../save/save.js';
import { audio } from '../audio/audio.js';

const ACTION_LABELS = {
  forward: 'Avancer', back: 'Reculer', left: 'Gauche', right: 'Droite',
  jump: 'Sauter / freiner', run: 'Courir', crouch: 'S\'accroupir',
  interact: 'Interagir', inventory: 'Inventaire', map: 'Carte',
  flashlight: 'Lampe torche', menu: 'Menu', drop: 'Lâcher', repair: 'Entretien véhicule',
  debug: 'Infos techniques',
};

export class Menu {
  constructor(root, { onNewGame, onContinue }) {
    this.root = root;
    this.onNewGame = onNewGame;
    this.onContinue = onContinue;
    this.world = null;
    this.save = null;
    this.paused = false;
    this.listening = null;
    this.build();
    this.bind();
  }

  attach(world, save) { this.world = world; this.save = save; }

  build() {
    const el = document.createElement('div');
    el.id = 'menu-layer';
    el.innerHTML = `
      <div class="title-screen" id="title-screen">
        <div class="title-inner">
          <h1>SOLITUDE<span>HORIZON</span></h1>
          <p class="tagline">Une région abandonnée. Personne d'autre. Juste vous.</p>
          <div class="title-buttons">
            <button id="btn-continue" class="primary">Continuer</button>
            <button id="btn-new">Nouvelle partie</button>
            <button id="btn-settings-title">Paramètres</button>
          </div>
          <p class="version">Version 1.0 · monde procédural déterministe · seed 847291</p>
        </div>
      </div>

      <div class="loading hidden" id="loading">
        <div class="loading-inner">
          <h2>Génération de la région…</h2>
          <div class="progress"><i id="loading-bar"></i></div>
          <p id="loading-text">Préparation</p>
          <p class="tip" id="loading-tip"></p>
        </div>
      </div>

      <div class="pause hidden" id="pause-menu">
        <div class="pause-inner">
          <h2>Pause</h2>
          <div class="pause-buttons">
            <button data-menu="resume" class="primary">Reprendre</button>
            <button data-menu="save">Sauvegarder</button>
            <button data-menu="home">Établir un refuge ici</button>
            <button data-menu="settings">Paramètres</button>
            <button data-menu="quit">Retour au menu principal</button>
          </div>
          <p class="pause-info" id="pause-info"></p>
        </div>
      </div>

      <div class="settings-screen hidden" id="settings-screen">
        <div class="settings-inner">
          <header><h2>Paramètres</h2><button data-settings="close" class="close">✕</button></header>
          <nav class="tabs">
            <button data-tab="graphics" class="active">Graphismes</button>
            <button data-tab="audio">Audio</button>
            <button data-tab="controls">Contrôles</button>
            <button data-tab="game">Jeu</button>
          </nav>
          <div class="tab-body" id="tab-graphics"></div>
          <div class="tab-body hidden" id="tab-audio"></div>
          <div class="tab-body hidden" id="tab-controls"></div>
          <div class="tab-body hidden" id="tab-game"></div>
        </div>
      </div>
    `;
    this.root.appendChild(el);
    this.el = el;
    this.titleScreen = document.getElementById('title-screen');
    this.loading = document.getElementById('loading');
    this.pauseMenu = document.getElementById('pause-menu');
    this.settingsScreen = document.getElementById('settings-screen');

    document.getElementById('btn-continue').disabled = !SaveManager.hasSave();
    this.renderSettings();
  }

  bind() {
    document.getElementById('btn-new').addEventListener('click', async () => {
      if (SaveManager.hasSave() && !confirm('Une sauvegarde existe. Démarrer une nouvelle partie l\'effacera. Continuer ?')) return;
      await SaveManager.deleteSave();
      audio.resume();
      this.onNewGame();
    });
    document.getElementById('btn-continue').addEventListener('click', () => {
      audio.resume();
      this.onContinue();
    });
    document.getElementById('btn-settings-title').addEventListener('click', () => this.openSettings());

    this.el.addEventListener('click', (e) => {
      const m = e.target.closest('[data-menu]')?.dataset.menu;
      if (m) this.handleMenu(m);
      const s = e.target.closest('[data-settings]')?.dataset.settings;
      if (s === 'close') this.closeSettings();
      const tab = e.target.closest('[data-tab]')?.dataset.tab;
      if (tab) this.switchTab(tab);
    });

    bus.on('input:keydown', (code) => {
      if (this.listening) { this.assignKey(code); return; }
      if (code !== 'Escape') return;
      if (!this.world) return;
      if (!this.settingsScreen.classList.contains('hidden')) { this.closeSettings(); return; }
      if (document.getElementById('panel-backdrop')?.classList.contains('hidden') === false) return;
      if (document.getElementById('map-screen')?.classList.contains('hidden') === false) return;
      this.togglePause();
    });
  }

  // ------------------------------------------------------------- chargement
  showLoading(text = 'Préparation') {
    const tips = [
      'La nuit, une lampe torche change tout. Pensez aux piles.',
      'L\'eau des lacs peut rendre malade : faites-la bouillir sur un feu.',
      'Les garages abritent souvent les pièces mécaniques les plus rares.',
      'Un véhicule réparé transforme votre rayon d\'exploration.',
      'Fouillez les tiroirs, les armoires et les établis : rien n\'est posé au hasard.',
      'Le poids ralentit et fatigue. Un coffre dans votre refuge est précieux.',
    ];
    document.getElementById('loading-tip').textContent = tips[Math.floor(Math.random() * tips.length)];
    document.getElementById('loading-text').textContent = text;
    this.loading.classList.remove('hidden');
    this.titleScreen.classList.add('hidden');
  }

  setProgress(p, text) {
    document.getElementById('loading-bar').style.width = `${Math.round(p * 100)}%`;
    if (text) document.getElementById('loading-text').textContent = text;
  }

  hideLoading() { this.loading.classList.add('hidden'); }

  showTitle() {
    this.titleScreen.classList.remove('hidden');
    document.getElementById('btn-continue').disabled = !SaveManager.hasSave();
  }

  // ------------------------------------------------------------- pause
  togglePause() {
    this.paused ? this.resume() : this.pause();
  }

  pause() {
    if (!this.world) return;
    this.paused = true;
    this.world.paused = true;
    this.world.player.frozen = true;
    this.world.interaction.blocked = true;
    this.pauseMenu.classList.remove('hidden');
    input.exitLock();
    const w = this.world;
    document.getElementById('pause-info').textContent =
      `Jour ${w.sky.day} · ${w.sky.timeString()} · ${w.weather.label} · ${Math.round(w.state.playTime / 60)} min de jeu`;
  }

  resume() {
    this.paused = false;
    if (this.world) {
      this.world.paused = false;
      this.world.player.frozen = false;
      this.world.interaction.blocked = false;
    }
    this.pauseMenu.classList.add('hidden');
    input.requestLock();
  }

  handleMenu(action) {
    switch (action) {
      case 'resume': this.resume(); break;
      case 'save': this.save?.save('manuel'); break;
      case 'home': {
        const p = this.world.player.position;
        const nearest = [...this.world.poi.loaded.values()]
          .map((i) => ({ i, d: Math.hypot(i.def.x - p.x, i.def.z - p.z) }))
          .sort((a, b) => a.d - b.d)[0];
        this.world.base.setHome(p, nearest && nearest.d < 60 ? nearest.i.def.name : null);
        this.resume();
        break;
      }
      case 'settings': this.openSettings(); break;
      case 'quit':
        this.save?.save('manuel');
        location.reload();
        break;
    }
  }

  // ------------------------------------------------------------- paramètres
  openSettings() {
    this.settingsScreen.classList.remove('hidden');
    this.renderSettings();
  }

  closeSettings() {
    this.settingsScreen.classList.add('hidden');
    this.listening = null;
  }

  switchTab(tab) {
    for (const b of this.el.querySelectorAll('[data-tab]')) b.classList.toggle('active', b.dataset.tab === tab);
    for (const key of ['graphics', 'audio', 'controls', 'game']) {
      document.getElementById(`tab-${key}`).classList.toggle('hidden', key !== tab);
    }
  }

  renderSettings() {
    const d = settings.data;
    // Graphismes
    document.getElementById('tab-graphics').innerHTML = `
      <label class="row">Qualité
        <select data-set="quality">
          ${Object.entries(QUALITY_PRESETS).map(([k, v]) =>
            `<option value="${k}" ${d.quality === k ? 'selected' : ''}>${v.name}</option>`).join('')}
        </select>
      </label>
      <label class="row">Qualité automatique
        <input type="checkbox" data-set="autoQuality" ${d.autoQuality ? 'checked' : ''}>
      </label>
      <label class="row">Champ de vision <b>${d.fov}°</b>
        <input type="range" min="60" max="100" value="${d.fov}" data-set="fov">
      </label>
      <label class="row">Opacité du HUD
        <input type="range" min="0.4" max="1" step="0.02" value="${d.hudOpacity}" data-set="hudOpacity">
      </label>
      <p class="muted small">Distance d'affichage : ${QUALITY_PRESETS[d.quality].viewDistance} m ·
      ombres : ${QUALITY_PRESETS[d.quality].shadows ? 'oui' : 'non'} ·
      herbe : ${QUALITY_PRESETS[d.quality].grass ? 'oui' : 'non'}</p>`;

    // Audio
    document.getElementById('tab-audio').innerHTML = `
      <label class="row">Volume général<input type="range" min="0" max="1" step="0.02" value="${d.masterVolume}" data-set="masterVolume"></label>
      <label class="row">Ambiance<input type="range" min="0" max="1" step="0.02" value="${d.ambienceVolume}" data-set="ambienceVolume"></label>
      <label class="row">Effets<input type="range" min="0" max="1" step="0.02" value="${d.sfxVolume}" data-set="sfxVolume"></label>
      <p class="muted small">Tous les sons sont générés en temps réel (aucun fichier audio).</p>`;

    // Contrôles
    document.getElementById('tab-controls').innerHTML = `
      <div class="bindings">
        ${Object.keys(DEFAULT_BINDINGS).map((action) => `
          <div class="binding">
            <span>${ACTION_LABELS[action] || action}</span>
            <button data-bind="${action}">${(d.bindings[action] || []).map(prettyCode).join(' / ')}</button>
          </div>`).join('')}
      </div>
      <label class="row">Sensibilité souris<input type="range" min="0.2" max="3" step="0.05" value="${d.mouseSensitivity}" data-set="mouseSensitivity"></label>
      <label class="row">Inverser l'axe Y<input type="checkbox" data-set="invertY" ${d.invertY ? 'checked' : ''}></label>
      <button data-set="resetBindings" class="ghost">Réinitialiser les touches</button>`;

    // Jeu
    document.getElementById('tab-game').innerHTML = `
      <label class="row">Head bob<input type="checkbox" data-set="headBob" ${d.headBob ? 'checked' : ''}></label>
      <label class="row">Réticule<input type="checkbox" data-set="crosshair" ${d.crosshair ? 'checked' : ''}></label>
      <p class="muted small">Les touches par défaut suivent la disposition AZERTY (ZQSD) ;
      les équivalents WASD sont également actifs.</p>`;

    // Écoute des changements
    this.settingsScreen.querySelectorAll('[data-set]').forEach((node) => {
      const key = node.dataset.set;
      if (key === 'resetBindings') {
        node.addEventListener('click', () => { settings.resetBindings(); this.renderSettings(); });
        return;
      }
      const evt = node.type === 'checkbox' || node.tagName === 'SELECT' ? 'change' : 'input';
      node.addEventListener(evt, () => {
        let value;
        if (node.type === 'checkbox') value = node.checked;
        else if (node.type === 'range') value = parseFloat(node.value);
        else value = node.value;
        settings.set(key, value);
        if (key === 'quality' || key === 'fov' || key === 'hudOpacity') this.renderSettings();
      });
    });
    this.settingsScreen.querySelectorAll('[data-bind]').forEach((node) => {
      node.addEventListener('click', () => {
        this.listening = node.dataset.bind;
        node.textContent = 'Appuyez sur une touche…';
        node.classList.add('listening');
      });
    });
  }

  assignKey(code) {
    const action = this.listening;
    this.listening = null;
    if (code === 'Escape') { this.renderSettings(); return; }
    settings.setBinding(action, [code]);
    this.renderSettings();
  }
}

function prettyCode(code) {
  return code
    .replace('Key', '')
    .replace('Digit', '')
    .replace('Arrow', '↑↓←→ ')
    .replace('ControlLeft', 'Ctrl')
    .replace('ShiftLeft', 'Maj')
    .replace('ShiftRight', 'Maj D')
    .replace('Space', 'Espace');
}
