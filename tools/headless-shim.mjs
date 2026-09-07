/**
 * headless-shim.mjs — DOM/canvas minimal pour exécuter le jeu hors navigateur.
 *
 * Fournit un DOM/canvas minimal puis exécute réellement les systèmes du jeu :
 * déterminisme du monde, terrain, routes, bâtiments, butin, physique du joueur,
 * réparation de véhicule, survie, météo et sérialisation de la sauvegarde.
 *
 *   node tools/headless-test.mjs
 */

// ----------------------------------------------------------------- stubs DOM
function makeCtx2d(w, h) {
  const noop = () => {};
  return {
    canvas: { width: w, height: h },
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '', textAlign: 'left',
    globalCompositeOperation: 'source-over', globalAlpha: 1,
    fillRect: noop, clearRect: noop, strokeRect: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, arc: noop, ellipse: noop, quadraticCurveTo: noop,
    bezierCurveTo: noop, fill: noop, stroke: noop, save: noop, restore: noop,
    translate: noop, rotate: noop, scale: noop, clip: noop, drawImage: noop,
    fillText: noop, setTransform: noop, measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createImageData: (ww, hh = 1) => ({ data: new Uint8ClampedArray(ww * hh * 4), width: ww, height: hh }),
    getImageData: (x, y, ww, hh) => ({ data: new Uint8ClampedArray(ww * hh * 4), width: ww, height: hh }),
    putImageData: noop,
  };
}

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = {
  addEventListener: () => {}, removeEventListener: () => {},
  devicePixelRatio: 1, innerWidth: 1920, innerHeight: 1080,
};
globalThis.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return { style: {}, appendChild: () => {}, addEventListener: () => {} };
    const c = { width: 300, height: 150, style: {}, addEventListener: () => {} };
    c.getContext = () => makeCtx2d(c.width, c.height);
    return c;
  },
  addEventListener: () => {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  body: { appendChild: () => {} },
};
if (!globalThis.navigator) globalThis.navigator = { userAgent: 'node' };

