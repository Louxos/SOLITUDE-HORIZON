/**
 * engine.js — Renderer, scène, caméra, boucle de rendu, moniteur de performance.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { settings } from './settings.js';
import { bus } from './events.js';

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    const preset = settings.preset;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: settings.data.quality !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio * 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = preset.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = true;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x9fb3c4, 0.0016);

    this.camera = new THREE.PerspectiveCamera(
      settings.data.fov, window.innerWidth / window.innerHeight, 0.1, preset.viewDistance * 1.6
    );
    this.camera.rotation.order = 'YXZ';

    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.frames = 0;
    this.fps = 60;
    this.fpsAccum = 0;
    this.fpsTimer = 0;
    this.autoQualityTimer = 0;

    this.updaters = [];
    this.running = false;
    this.paused = false;

    window.addEventListener('resize', () => this.resize());
    this.resize();

    bus.on('settings:changed', ({ key }) => {
      if (key === 'quality') this.applyQuality();
      if (key === 'fov') { this.camera.fov = settings.data.fov; this.camera.updateProjectionMatrix(); }
    });
  }

  applyQuality() {
    const preset = settings.preset;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio * 1.5));
    this.renderer.shadowMap.enabled = preset.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    this.camera.far = preset.viewDistance * 1.6;
    this.camera.updateProjectionMatrix();
    bus.emit('quality:applied', preset);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  add(updater) { this.updaters.push(updater); return updater; }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const tick = () => {
      if (!this.running) return;
      requestAnimationFrame(tick);
      this.frame();
    };
    requestAnimationFrame(tick);
  }

  frame() {
    let dt = this.clock.getDelta();
    if (dt > 0.1) dt = 0.1;         // évite les sauts après un onglet inactif
    this.elapsed += dt;
    this.frames++;

    // Mesure FPS lissée
    this.fpsAccum += dt;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(1 / (this.fpsAccum / Math.max(1, this.framesInWindow || 30)));
      this.framesInWindow = 0;
      this.fpsAccum = 0;
      this.fpsTimer = 0;
    }
    this.framesInWindow = (this.framesInWindow || 0) + 1;

    for (const u of this.updaters) {
      if (u.alwaysUpdate || !this.paused) {
        try { u.update(dt, this.elapsed); }
        catch (err) { console.error('[engine] update error', u.constructor?.name, err); }
      }
    }

    this.renderer.render(this.scene, this.camera);
    this.autoQuality(dt);
  }

  /** Ajustement automatique de la qualité si le framerate s'effondre durablement. */
  autoQuality(dt) {
    if (!settings.data.autoQuality) return;
    this.autoQualityTimer += dt;
    if (this.autoQualityTimer < 6) return;
    this.autoQualityTimer = 0;
    const q = settings.data.quality;
    if (this.fps < 34 && q !== 'low') {
      settings.set('quality', q === 'high' ? 'medium' : 'low');
      bus.emit('notify', { text: `Qualité réduite automatiquement (${settings.preset.name})`, kind: 'system' });
    } else if (this.fps > 75 && q === 'low') {
      settings.set('quality', 'medium');
      bus.emit('notify', { text: 'Qualité augmentée automatiquement (Moyen)', kind: 'system' });
    }
  }
}
