/**
 * map.js — Carte du monde (touche M) et minimap.
 * La carte est rendue une seule fois depuis la fonction de terrain, puis
 * dévoilée progressivement selon les zones explorées.
 */

import { WORLD } from '../core/config.js';
import { bus } from '../core/events.js';
import { input } from '../core/input.js';
import { settings } from '../core/settings.js';
import { clamp } from '../core/noise.js';

const MAP_RES = 384;   // pixels pour 5120 m -> ~13 m/pixel

export class MapSystem {
  constructor(root, world) {
    this.world = world;
    this.root = root;
    this.visible = false;
    this.ready = false;
    this.buildDom();
    this.baseCanvas = document.createElement('canvas');
    this.baseCanvas.width = this.baseCanvas.height = MAP_RES;
    this.baseCtx = this.baseCanvas.getContext('2d');
    this.renderRow = 0;
    this.minimapCanvas = document.getElementById('minimap');
    this.minimapCtx = this.minimapCanvas.getContext('2d');

    bus.on('input:keydown', (code) => {
      if (settings.data.bindings.map.includes(code)) this.toggle();
      if (code === 'Escape' && this.visible) this.hide();
    });
  }

  buildDom() {
    const el = document.createElement('div');
    el.id = 'map-screen';
    el.className = 'map-screen hidden';
    el.innerHTML = `
      <div class="map-frame">
        <header><h2>Carte de la région</h2><span class="hint">[M] fermer</span></header>
        <div class="map-wrap"><canvas id="map-canvas" width="${MAP_RES}" height="${MAP_RES}"></canvas></div>
        <footer>
          <span id="map-coords"></span>
          <span id="map-legend">◉ vous · ▲ lieux · ⌂ village/refuge · ▦ ville</span>
        </footer>
      </div>`;
    this.root.appendChild(el);
    this.el = el;
    this.canvas = document.getElementById('map-canvas');
    this.ctx = this.canvas.getContext('2d');
  }

  /** Rendu progressif de la carte de base (quelques lignes par frame). */
  buildStep(budgetRows = 6) {
    if (this.ready) return true;
    const t = this.world.terrain;
    const img = this.baseCtx.createImageData(MAP_RES, 1);
    for (let r = 0; r < budgetRows && this.renderRow < MAP_RES; r++, this.renderRow++) {
      const z = -WORLD.half + (this.renderRow / MAP_RES) * WORLD.size;
      for (let i = 0; i < MAP_RES; i++) {
        const x = -WORLD.half + (i / MAP_RES) * WORLD.size;
        const h = t.height(x, z);
        let col;
        if (h < WORLD.waterLevel) {
          const d = clamp((WORLD.waterLevel - h) / 12, 0, 1);
          col = [40 - d * 18, 70 - d * 26, 92 - d * 30];
        } else {
          const road = t.roads.influence(x, z);
          if (road.w > 0.5) {
            col = road.kind === 'asphalt' ? [52, 50, 48] : [92, 82, 66];
          } else {
            const moist = t.moisture(x, z);
            // pente approchée à partir de deux échantillons voisins (rapide)
            const hE = t.height(x + 13, z);
            const hN = t.height(x, z + 13);
            const slope = Math.atan(Math.hypot(hE - h, hN - h) / 13) * 180 / Math.PI;
            const alt = clamp((h - WORLD.waterLevel) / 260, 0, 1);
            let r0 = 92 - moist * 36 + alt * 60;
            let g0 = 104 - moist * 12 + alt * 50;
            let b0 = 66 - moist * 18 + alt * 46;
            if (slope > 34) { r0 = 108 + alt * 40; g0 = 104 + alt * 40; b0 = 98 + alt * 40; }
            if (h > 320) { r0 = 210; g0 = 214; b0 = 220; }
            col = [r0, g0, b0];
          }
        }
        // relief : ombrage simple (réutilise l'échantillon voisin)
        const shade = clamp(1 + (h - t.height(x + 14, z)) * 0.045, 0.6, 1.4);
        img.data[i * 4] = clamp(col[0] * shade, 0, 255);
        img.data[i * 4 + 1] = clamp(col[1] * shade, 0, 255);
        img.data[i * 4 + 2] = clamp(col[2] * shade, 0, 255);
        img.data[i * 4 + 3] = 255;
      }
      this.baseCtx.putImageData(img, 0, this.renderRow);
    }
    if (this.renderRow >= MAP_RES) { this.ready = true; return true; }
    return false;
  }

  worldToMap(x, z) {
    return {
      px: ((x + WORLD.half) / WORLD.size) * MAP_RES,
      py: ((z + WORLD.half) / WORLD.size) * MAP_RES,
    };
  }

  toggle() {
    if (this.world.player.stats.dead) return;
    this.visible ? this.hide() : this.show();
  }

  show() {
    this.visible = true;
    this.el.classList.remove('hidden');
    this.world.player.frozen = true;
    this.world.interaction.blocked = true;
    input.exitLock();
    this.draw();
  }

  hide() {
    this.visible = false;
    this.el.classList.add('hidden');
    this.world.player.frozen = false;
    this.world.interaction.blocked = false;
    if (!this.world.paused) input.requestLock();
  }

  /** Dessine la carte complète avec brouillard d'exploration et marqueurs. */
  draw() {
    if (!this.ready) this.buildStep(MAP_RES);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, MAP_RES, MAP_RES);
    ctx.drawImage(this.baseCanvas, 0, 0);

    // Brouillard : on masque ce qui n'a pas été exploré
    const explored = this.world.state.explored;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(9, 11, 14, 0.82)';
    ctx.fillRect(0, 0, MAP_RES, MAP_RES);
    ctx.globalCompositeOperation = 'destination-out';
    const cellPx = (64 / WORLD.size) * MAP_RES;
    for (const key of Object.keys(explored)) {
      const [cx, cz] = key.split(',').map(Number);
      const p = this.worldToMap(cx * 64, cz * 64);
      const grd = ctx.createRadialGradient(p.px, p.py, 0, p.px, p.py, cellPx * 3.4);
      grd.addColorStop(0, 'rgba(0,0,0,1)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(p.px, p.py, cellPx * 3.4, 0, 7);
      ctx.fill();
    }
    ctx.restore();

    // Lieux découverts (villes et villages mis en évidence)
    ctx.textAlign = 'center';
    for (const id of this.world.state.discovered) {
      const def = this.world.poi.defs.get(id);
      if (!def) continue;
      const p = this.worldToMap(def.x, def.z);
      if (def.kind === 'town') {
        ctx.fillStyle = 'rgba(232, 195, 122, 0.28)';
        ctx.strokeStyle = 'rgba(232, 195, 122, 0.85)';
        ctx.lineWidth = 1;
        const r = 5;
        ctx.beginPath();
        ctx.rect(p.px - r, p.py - r, r * 2, r * 2);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(238, 222, 186, 0.95)';
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.fillText(def.name.toUpperCase(), p.px, p.py - 8);
      } else if (def.kind === 'village') {
        ctx.fillStyle = 'rgba(228, 216, 190, 0.95)';
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText('⌂', p.px, p.py + 4);
        ctx.fillStyle = 'rgba(228, 216, 190, 0.8)';
        ctx.font = '9px system-ui, sans-serif';
        ctx.fillText(def.name, p.px, p.py + 14);
      } else {
        ctx.fillStyle = 'rgba(228, 216, 190, 0.95)';
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText('▲', p.px, p.py + 3);
        ctx.fillStyle = 'rgba(228, 216, 190, 0.75)';
        ctx.font = '9px system-ui, sans-serif';
        ctx.fillText(def.name, p.px, p.py + 14);
      }
      ctx.font = '11px system-ui, sans-serif';
    }

    // Refuge
    const home = this.world.base.homePosition;
    if (home) {
      const p = this.worldToMap(home.x, home.z);
      ctx.fillStyle = '#e8c37a';
      ctx.fillText('⌂', p.px, p.py + 4);
    }

    // Joueur
    const pl = this.world.player.position;
    const pp = this.worldToMap(pl.x, pl.z);
    ctx.save();
    ctx.translate(pp.px, pp.py);
    ctx.rotate(-this.world.player.yaw);
    ctx.fillStyle = '#d8e4ee';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    document.getElementById('map-coords').textContent =
      `X ${Math.round(pl.x)} · Z ${Math.round(pl.z)} · altitude ${Math.round(this.world.terrain.height(pl.x, pl.z))} m`;
  }

  /** Minimap : extrait de la carte, orienté vers le nord. */
  drawMinimap() {
    if (!this.ready) return;
    const ctx = this.minimapCtx;
    const size = this.minimapCanvas.width;
    const p = this.world.player.position;
    const range = 260;                       // mètres visibles
    const srcSize = (range / WORLD.size) * MAP_RES;
    const c = this.worldToMap(p.x, p.z);

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, 7);
    ctx.clip();
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(this.baseCanvas,
      c.px - srcSize / 2, c.py - srcSize / 2, srcSize, srcSize,
      0, 0, size, size);

    // Lieux proches découverts (les villes dépassent légèrement du cadre)
    for (const id of this.world.state.discovered) {
      const def = this.world.poi.defs.get(id);
      if (!def) continue;
      const dx = def.x - p.x, dz = def.z - p.z;
      const big = def.kind === 'town' || def.kind === 'village';
      const lim = big ? range : range / 2;
      if (Math.abs(dx) > lim || Math.abs(dz) > lim) continue;
      const px = Math.min(size - 4, Math.max(4, size / 2 + (dx / range) * size));
      const py = Math.min(size - 4, Math.max(4, size / 2 + (dz / range) * size));
      if (def.kind === 'town') {
        ctx.fillStyle = 'rgba(232, 195, 122, 0.95)';
        ctx.fillRect(px - 3, py - 3, 6, 6);
      } else {
        ctx.fillStyle = 'rgba(232, 214, 176, 0.9)';
        ctx.fillRect(px - 2, py - 2, 4, 4);
      }
    }
    ctx.restore();

    // Joueur + direction
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-this.world.player.yaw);
    ctx.fillStyle = '#e6eef5';
    ctx.beginPath();
    ctx.moveTo(0, -5); ctx.lineTo(3.5, 4); ctx.lineTo(0, 2); ctx.lineTo(-3.5, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(220, 226, 232, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, 7);
    ctx.stroke();
  }

  update(dt) {
    if (!this.ready) this.buildStep(4);
    this._mmTimer = (this._mmTimer || 0) + dt;
    if (this._mmTimer > 0.12) { this._mmTimer = 0; this.drawMinimap(); }
    if (this.visible) {
      this._mapTimer = (this._mapTimer || 0) + dt;
      if (this._mapTimer > 0.4) { this._mapTimer = 0; this.draw(); }
    }
  }
}
