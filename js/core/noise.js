/**
 * noise.js — Bruits procéduraux déterministes (simplex 2D + fbm + ridged).
 * Implémentation autonome : aucune dépendance externe, seed contrôlée.
 */

import { hashInt } from './rng.js';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

const GRAD2 = new Float32Array([
  1, 1, -1, 1, 1, -1, -1, -1,
  1, 0, -1, 0, 0, 1, 0, -1,
]);

export class Noise {
  constructor(seed = 0) {
    this.seed = seed >>> 0;
    // Table de permutation dérivée de la seed
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = this.seed || 1;
    for (let i = 255; i > 0; i--) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const j = s % (i + 1);
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    this.permMod8 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod8[i] = this.perm[i] % 8;
    }
  }

  /** Simplex 2D, sortie approximativement dans [-1,1]. */
  noise2(xin, yin) {
    const perm = this.perm, permMod8 = this.permMod8;
    let n0 = 0, n1 = 0, n2 = 0;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const X0 = i - t, Y0 = j - t;
    const x0 = xin - X0, y0 = yin - Y0;
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const gi0 = permMod8[ii + perm[jj]] * 2;
      t0 *= t0;
      n0 = t0 * t0 * (GRAD2[gi0] * x0 + GRAD2[gi0 + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const gi1 = permMod8[ii + i1 + perm[jj + j1]] * 2;
      t1 *= t1;
      n1 = t1 * t1 * (GRAD2[gi1] * x1 + GRAD2[gi1 + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const gi2 = permMod8[ii + 1 + perm[jj + 1]] * 2;
      t2 *= t2;
      n2 = t2 * t2 * (GRAD2[gi2] * x2 + GRAD2[gi2 + 1] * y2);
    }
    return 70 * (n0 + n1 + n2);
  }

  /** Bruit fractal classique. */
  fbm(x, y, octaves = 4, lacunarity = 2.02, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise2(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Bruit "ridged" : crêtes acérées, idéal pour les montagnes. */
  ridged(x, y, octaves = 4, lacunarity = 2.04, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0, prev = 1;
    for (let o = 0; o < octaves; o++) {
      let n = 1 - Math.abs(this.noise2(x * freq, y * freq));
      n *= n;
      n *= prev;
      prev = n;
      sum += amp * n;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Bruit cellulaire (distance au point le plus proche), normalisé ~[0,1]. */
  worley(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let best = 8;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx, cy = yi + dy;
        const h = hashInt(this.seed, cx, cy);
        const px = cx + (h & 0xffff) / 65536;
        const py = cy + ((h >>> 16) & 0xffff) / 65536;
        const d = (px - x) * (px - x) + (py - y) * (py - y);
        if (d < best) best = d;
      }
    }
    return Math.min(1, Math.sqrt(best));
  }
}

export const smoothstep = (edge0, edge1, x) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
