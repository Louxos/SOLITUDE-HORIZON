/**
 * input.js — Clavier / souris / pointer lock, avec bindings configurables.
 */

import { settings } from './settings.js';
import { bus } from './events.js';

class Input {
  constructor() {
    this.codes = new Set();
    this.pressedThisFrame = new Set();
    this.mouse = { dx: 0, dy: 0, wheel: 0, left: false, right: false };
    this.locked = false;
    this.enabled = true;
    this._bound = false;
  }

  attach(canvas) {
    if (this._bound) return;
    this._bound = true;
    this.canvas = canvas;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'F3') e.preventDefault();
      if (e.repeat) return;
      this.codes.add(e.code);
      this.pressedThisFrame.add(e.code);
      bus.emit('input:keydown', e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.codes.delete(e.code);
      bus.emit('input:keyup', e.code);
    });
    window.addEventListener('blur', () => { this.codes.clear(); });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
      bus.emit('input:mousedown', e.button);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      bus.emit('input:pointerlock', this.locked);
    });
  }

  requestLock() {
    if (!this.canvas || this.locked) return;
    try {
      const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch (e) { /* geste requis */ } });
    } catch (err) {
      // Le verrouillage nécessite un geste utilisateur : on réessaiera au clic.
    }
  }

  exitLock() { if (this.locked) document.exitPointerLock(); }

  isDown(action) {
    const codes = settings.data.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (this.codes.has(c)) return true;
    return false;
  }

  wasPressed(action) {
    const codes = settings.data.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (this.pressedThisFrame.has(c)) return true;
    return false;
  }

  /** Quelle action correspond à ce code ? (utile pour l'UI de remap) */
  actionForCode(code) {
    for (const [action, codes] of Object.entries(settings.data.bindings)) {
      if (codes.includes(code)) return action;
    }
    return null;
  }

  endFrame() {
    this.pressedThisFrame.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
  }
}

export const input = new Input();
