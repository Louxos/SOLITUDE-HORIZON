/**
 * textures.js — Génération procédurale de toutes les textures (canvas 2D).
 * Aucun asset binaire : le jeu fonctionne hors ligne sans télécharger d'images.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { Noise } from './noise.js';
import { settings } from './settings.js';

const cache = new Map();
const noise = new Noise(90210);

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTexture(cnv, { repeat = 1, srgb = true, aniso = true } = {}) {
  const tex = new THREE.CanvasTexture(cnv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso ? settings.preset.anisotropy : 1;
  tex.needsUpdate = true;
  return tex;
}

/** Bruit fractal en niveaux tileable (wrap via coordonnées cycliques). */
function tileNoise(size, scale, octaves = 4) {
  const data = new Float32Array(size * size);
  const R = size / (2 * Math.PI);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Projection torique -> texture tileable
      const a = (x / size) * Math.PI * 2, b = (y / size) * Math.PI * 2;
      const nx = Math.cos(a) * R * scale / 32, ny = Math.sin(a) * R * scale / 32;
      const nz = Math.cos(b) * R * scale / 32, nw = Math.sin(b) * R * scale / 32;
      let v = 0, amp = 1, freq = 1, norm = 0;
      for (let o = 0; o < octaves; o++) {
        v += amp * (noise.noise2(nx * freq + nz * freq * 0.37, ny * freq + nw * freq * 0.61));
        norm += amp; amp *= 0.5; freq *= 2.03;
      }
      data[y * size + x] = v / norm * 0.5 + 0.5;
    }
  }
  return data;
}

function paintNoise(ctx, size, palette, scale, octaves = 4, alpha = 1) {
  const n = tileNoise(size, scale, octaves);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.max(0, Math.min(0.9999, n[i]));
    const idx = Math.floor(v * (palette.length - 1));
    const t = v * (palette.length - 1) - idx;
    const c0 = palette[idx], c1 = palette[Math.min(palette.length - 1, idx + 1)];
    const r = c0[0] + (c1[0] - c0[0]) * t;
    const g = c0[1] + (c1[1] - c0[1]) * t;
    const b = c0[2] + (c1[2] - c0[2]) * t;
    const o = i * 4;
    img.data[o] = img.data[o] * (1 - alpha) + r * alpha;
    img.data[o + 1] = img.data[o + 1] * (1 - alpha) + g * alpha;
    img.data[o + 2] = img.data[o + 2] * (1 - alpha) + b * alpha;
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Carte de normales dérivée d'une heightmap flottante. */
function normalMapFrom(heights, size, strength = 2.2) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => heights[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const o = (y * size + x) * 4;
      img.data[o] = (nx * 0.5 + 0.5) * 255;
      img.data[o + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[o + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = toTexture(c, { srgb: false });
  return tex;
}

const BUILDERS = {
  grass: () => {
    const size = 256, c = canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#4a5b34'; ctx.fillRect(0, 0, size, size);
    paintNoise(ctx, size, [[48, 58, 34], [63, 76, 42], [86, 96, 55], [72, 84, 46], [55, 66, 38]], 7, 5);
    // touffes sombres + brins clairs
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      ctx.fillStyle = `rgba(${30 + Math.random() * 30},${40 + Math.random() * 35},${20 + Math.random() * 20},0.35)`;
      ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 3);
    }
    for (let i = 0; i < 420; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      ctx.fillStyle = `rgba(${110 + Math.random() * 50},${120 + Math.random() * 50},${60 + Math.random() * 30},0.22)`;
      ctx.fillRect(x, y, 1, 1 + Math.random() * 2);
    }
    return toTexture(c, { repeat: 1 });
  },
  dirt: () => {
    const size = 256, c = canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#6b5a45'; ctx.fillRect(0, 0, size, size);
    paintNoise(ctx, size, [[74, 61, 46], [96, 80, 60], [112, 95, 72], [84, 70, 52]], 9, 5);
    for (let i = 0; i < 400; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      ctx.fillStyle = `rgba(${60 + Math.random() * 40},${50 + Math.random() * 30},${40 + Math.random() * 20},0.4)`;
      ctx.beginPath(); ctx.arc(x, y, Math.random() * 2.4, 0, 7); ctx.fill();
    }
    return toTexture(c);
  },
  rock: () => {
    const size = 256, c = canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#6c6b66'; ctx.fillRect(0, 0, size, size);
    paintNoise(ctx, size, [[74, 73, 70], [96, 95, 91], [120, 118, 112], [88, 86, 82]], 6, 5);
    ctx.strokeStyle = 'rgba(40,40,40,0.35)'; ctx.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
      ctx.beginPath();
      let x = Math.random() * size, y = Math.random() * size;
      ctx.moveTo(x, y);
      for (let s = 0; s < 6; s++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    return toTexture(c);
  },
  sand: () => {
    const size = 128, c = canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#9c8f72'; ctx.fillRect(0, 0, size, size);
    paintNoise(ctx, size, [[136, 124, 100], [160, 148, 120], [174, 162, 134]], 10, 4);
    return toTexture(c);
  },
  bark: () => {
    const size = 128, c = canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#4a3c2e'; ctx.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x++) {
      const v = 0.5 + 0.5 * Math.sin(x * 0.35 + Math.sin(x * 0.07) * 3);
      ctx.fillStyle = `rgba(${40 + v * 45},${32 + v * 36},${24 + v * 26},1)`;
      ctx.fillRect(x, 0, 1, size);
    }
    paintNoise(ctx, size, [[38, 30, 22], [82, 70, 54], [60, 50, 38]], 14, 4, 0.45);
    // stries verticales profondes + mousse
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * size;
      const y0 = Math.random() * size;
      const len = 20 + Math.random() * 90;
      ctx.strokeStyle = `rgba(20,15,10,${0.25 + Math.random() * 0.35})`;
      ctx.lineWidth = 0.6 + Math.random();
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x + (Math.random() - 0.5) * 4, (y0 + len) % size); ctx.stroke();
    }
    for (let i = 0; i < 24; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      ctx.fillStyle = `rgba(${60 + Math.random() * 25},${85 + Math.random() * 30},${45 + Math.random() * 20},0.20)`;
      ctx.beginPath(); ctx.ellipse(x, y, 2 + Math.random() * 6, 3 + Math.random() * 8, 0, 0, 7); ctx.fill();
    }
    return toTexture(c);
  },
  wood: () => {
    const size = 256, c = canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#7a6142'; ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y++) {
      const v = 0.5 + 0.5 * Math.sin(y * 0.12 + Math.sin(y * 0.031) * 4);
      ctx.fillStyle = `rgba(${86 + v * 46},${68 + v * 36},${46 + v * 24},1)`;
      ctx.fillRect(0, y, size, 1);
    }
    // planches
    ctx.strokeStyle = 'rgba(30,22,14,0.55)'; ctx.lineWidth = 2;
    for (let y = 0; y <= size; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke(); }
    // nœuds du bois
    for (let i = 0; i < 10; i++) {
      const x = Math.random() * size, y = Math.floor(Math.random() * 8) * 32 + 16;
      ctx.strokeStyle = 'rgba(40,28,16,0.5)'; ctx.lineWidth = 1.2;
      for (let r = 2; r < 7; r += 2) {
        ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r, 0, 0, 7); ctx.stroke();
      }
    }
    paintNoise(ctx, size, [[50, 40, 28], [110, 92, 66]], 12, 4, 0.28);
    return toTexture(c);
  },
  brick: () => {
    const size = 256, c = canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#8a8578'; ctx.fillRect(0, 0, size, size);   // mortier
    const bh = 22, bw = 58;
    let row = 0;
    for (let y = 0; y < size; y += bh, row++) {
      const off = (row % 2) * (bw / 2);
      for (let x = -bw; x < size + bw; x += bw) {
        const v = 0.72 + Math.random() * 0.45;
        const r0 = Math.floor(128 * v), g0 = Math.floor(62 * v), b0 = Math.floor(48 * v);
        ctx.fillStyle = `rgb(${r0},${g0},${b0})`;
        ctx.fillRect(x + off + 2, y + 2, bw - 4, bh - 4);
        // arête éclairée
        ctx.fillStyle = `rgba(255,225,200,${0.05 + Math.random() * 0.07})`;
        ctx.fillRect(x + off + 2, y + 2, bw - 4, 2);
        // éclats
        if (Math.random() < 0.4) {
          ctx.fillStyle = `rgba(${r0 * 0.7},${g0 * 0.7},${b0 * 0.7},0.6)`;
          ctx.fillRect(x + off + 2 + Math.random() * (bw - 12), y + 4 + Math.random() * (bh - 10), 3 + Math.random() * 5, 2 + Math.random() * 4);
        }
      }
    }
    // coulures d'humidité
    for (let i = 0; i < 16; i++) {
      const x = Math.random() * size;
      const grd = ctx.createLinearGradient(x, 0, x, size);
      grd.addColorStop(0, 'rgba(50,54,46,0.16)');
      grd.addColorStop(1, 'rgba(50,54,46,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(x, Math.random() * size * 0.5, 4 + Math.random() * 10, size);
    }
    return toTexture(c);
  },
  plaster: () => {
    const size = 256, c = canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#b9b2a3'; ctx.fillRect(0, 0, size, size);
    paintNoise(ctx, size, [[150, 144, 132], [186, 180, 168], [170, 162, 148], [128, 122, 112]], 8, 5, 0.75);
    // coulures d'humidité
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * size;
      const grd = ctx.createLinearGradient(x, 0, x, size);
      grd.addColorStop(0, 'rgba(70,72,60,0.20)');
      grd.addColorStop(1, 'rgba(70,72,60,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(x, Math.random() * size * 0.4, 3 + Math.random() * 12, size);
    }
    // fissures
    ctx.strokeStyle = 'rgba(60,55,48,0.5)';
    for (let i = 0; i < 18; i++) {
      ctx.beginPath();
      let x = Math.random() * size, y = Math.random() * size;
      ctx.moveTo(x, y);
      for (let s = 0; s < 5; s++) { x += (Math.random() - 0.5) * 30; y += Math.random() * 25; ctx.lineTo(x, y); }
      ctx.lineWidth = Math.random() * 1.4;
      ctx.stroke();
    }
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      const g = 150 + Math.random() * 60;
      ctx.fillStyle = `rgba(${g},${g * 0.96},${g * 0.86},${0.14 + Math.random() * 0.2})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 3 + Math.random() * 10, 2 + Math.random() * 7, Math.random() * 3, 0, 7);
      ctx.fill();
    }
    return toTexture(c);
  },
  concrete: () => {
    const size = 256, c = canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#8d8b87'; ctx.fillRect(0, 0, size, size);
    paintNoise(ctx, size, [[110, 108, 104], [140, 138, 133], [124, 122, 118]], 9, 5, 0.85);
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = `rgba(${70 + Math.random() * 60},${70 + Math.random() * 60},${68 + Math.random() * 55},0.35)`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
    }
    for (let i = 0; i < 12; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      ctx.fillStyle = `rgba(60,62,58,${0.05 + Math.random() * 0.08})`;
      ctx.beginPath(); ctx.ellipse(x, y, 8 + Math.random() * 26, 6 + Math.random() * 18, Math.random() * 3, 0, 7); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(48,46,42,0.4)';
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      let x = Math.random() * size, y = Math.random() * size;
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (Math.random() - 0.5) * 40; y += Math.random() * 30; ctx.lineTo(x, y); }
      ctx.lineWidth = 0.8; ctx.stroke();
    }
    return toTexture(c);
  },
  asphalt: () => {
    const size = 256, c = canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#3b3a38'; ctx.fillRect(0, 0, size, size);
    paintNoise(ctx, size, [[44, 43, 41], [58, 57, 54], [70, 68, 64]], 12, 4, 0.8);
    // nids-de-poule
    for (let i = 0; i < 6; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      ctx.fillStyle = `rgba(${30 + Math.random() * 14},${29 + Math.random() * 14},${28 + Math.random() * 12},0.5)`;
      ctx.beginPath(); ctx.ellipse(x, y, 6 + Math.random() * 16, 5 + Math.random() * 12, Math.random() * 3, 0, 7); ctx.fill();
    }
    // fissures + herbe dans les fissures
    for (let i = 0; i < 22; i++) {
      ctx.strokeStyle = 'rgba(24,24,22,0.8)'; ctx.lineWidth = 1 + Math.random();
      ctx.beginPath();
      let x = Math.random() * size, y = Math.random() * size;
      ctx.moveTo(x, y);
      for (let s = 0; s < 7; s++) { x += (Math.random() - 0.5) * 34; y += (Math.random() - 0.5) * 34; ctx.lineTo(x, y); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(72,88,44,0.45)'; ctx.lineWidth = 1;
      ctx.stroke();
    }
    return toTexture(c);
  },
  rust: () => {
    const size = 128, c = canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#6f6a63'; ctx.fillRect(0, 0, size, size);
    paintNoise(ctx, size, [[70, 66, 62], [104, 70, 44], [128, 78, 44], [86, 82, 76]], 10, 5, 0.9);
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      ctx.fillStyle = `rgba(${150 + Math.random() * 60},${80 + Math.random() * 40},${30 + Math.random() * 25},${0.3 + Math.random() * 0.4})`;
      ctx.beginPath(); ctx.ellipse(x, y, 1 + Math.random() * 5, 1 + Math.random() * 4, Math.random() * 3, 0, 7); ctx.fill();
    }
    return toTexture(c);
  },
  roof: () => {
    const size = 256, c = canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#5a4038'; ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 16) {
      for (let x = 0; x < size; x += 24) {
        const off = (y / 16) % 2 ? 12 : 0;
        const v = 0.7 + Math.random() * 0.5;
        ctx.fillStyle = `rgb(${Math.floor(96 * v)},${Math.floor(62 * v)},${Math.floor(50 * v)})`;
        ctx.fillRect(x + off, y, 22, 14);
        ctx.fillStyle = `rgba(255,222,192,${0.05 + Math.random() * 0.08})`;
        ctx.fillRect(x + off, y, 22, 2);
        if (Math.random() < 0.06) {
          ctx.fillStyle = 'rgba(28,22,18,0.85)';
          ctx.fillRect(x + off + 2, y + 2, 18, 10);
        }
      }
    }
    paintNoise(ctx, size, [[40, 48, 34], [90, 60, 48]], 9, 4, 0.3);
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * size;
      const y = size - Math.random() * size * 0.5;
      ctx.fillStyle = `rgba(${60 + Math.random() * 30},${90 + Math.random() * 40},${45 + Math.random() * 25},0.22)`;
      ctx.beginPath(); ctx.ellipse(x, y, 2 + Math.random() * 5, 1.5 + Math.random() * 3, 0, 0, 7); ctx.fill();
    }
    return toTexture(c);
  },
  foliage: () => {
    const size = 128, c = canvas(size), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    // amas de feuilles avec canal alpha
    for (let i = 0; i < 420; i++) {
      const x = size / 2 + (Math.random() - 0.5) * size * 0.95;
      const y = size / 2 + (Math.random() - 0.5) * size * 0.95;
      const d = Math.hypot(x - size / 2, y - size / 2) / (size / 2);
      if (Math.random() < d * d) continue;
      const g = 60 + Math.random() * 70;
      ctx.fillStyle = `rgba(${28 + Math.random() * 40},${g},${24 + Math.random() * 30},${0.75 + Math.random() * 0.25})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 3 + Math.random() * 7, 2 + Math.random() * 5, Math.random() * 3.14, 0, 7);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  },
  grassBlade: () => {
    const size = 64, c = canvas(size), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < 22; i++) {
      const x = 2 + Math.random() * (size - 4);
      const h = size * (0.45 + Math.random() * 0.5);
      const g = 70 + Math.random() * 60;
      ctx.strokeStyle = `rgba(${34 + Math.random() * 30},${g},${28 + Math.random() * 24},0.95)`;
      ctx.lineWidth = 1 + Math.random() * 1.8;
      ctx.beginPath();
      ctx.moveTo(x, size);
      ctx.quadraticCurveTo(x + (Math.random() - 0.5) * 12, size - h * 0.6, x + (Math.random() - 0.5) * 18, size - h);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  },
  ivy: () => {
    const size = 128, c = canvas(size), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < 300; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const fade = 1 - y / size;
      if (Math.random() > fade * 1.25) continue;
      ctx.fillStyle = `rgba(${24 + Math.random() * 30},${54 + Math.random() * 60},${22 + Math.random() * 26},${0.6 + Math.random() * 0.4})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 3 + Math.random() * 5, 2.5 + Math.random() * 4, Math.random() * 3, 0, 7);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  },
  groundDetail: () => {
    // Détail neutre (gris) multiplié par la couleur de sommet du terrain :
    // permet une seule passe de rendu pour tous les types de sol.
    const size = 256, c = canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#b0b0b0'; ctx.fillRect(0, 0, size, size);
    paintNoise(ctx, size, [[132, 132, 132], [168, 168, 168], [196, 196, 196], [150, 150, 150]], 11, 5, 0.9);
    for (let i = 0; i < 1400; i++) {
      const v = 90 + Math.random() * 120;
      ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
    }
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      const g = 70 + Math.random() * 50;
      ctx.strokeStyle = `rgba(${g},${g * 0.9},${g * 0.7},0.4)`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 8, y + (Math.random() - 0.5) * 8);
      ctx.stroke();
    }
    return toTexture(c);
  },
  water: () => {
    const size = 256;
    const heights = tileNoise(size, 18, 4);
    return normalMapFrom(heights, size, 3.2);
  },
  groundNormal: () => {
    const size = 256;
    const heights = tileNoise(size, 22, 5);
    return normalMapFrom(heights, size, 2.0);
  },
  wallNormal: () => {
    const size = 256;
    const heights = tileNoise(size, 26, 4);
    return normalMapFrom(heights, size, 1.4);
  },
};

// ============================================================ photos IA
// Les textures photo (générées par IA, licences propres) remplacent
// l'albédo procédural quand le fichier existe. Le procédural reste
// la solution de secours (Node, premier lancement hors ligne).
const PHOTO_FILES = {
  grass: 'grass.jpg', dirt: 'dirt.jpg', asphalt: 'asphalt.jpg', brick: 'brick.jpg',
  plaster: 'plaster.jpg', wood: 'wood_planks.jpg', roof: 'roof_tiles.jpg', rust: 'rust_metal.jpg',
};
const PHOTO_NORMAL_STRENGTH = {
  grass: 0.9, dirt: 1.1, asphalt: 1.2, brick: 1.7, plaster: 1.0,
  wood: 1.5, roof: 1.4, rust: 1.8,
};

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image introuvable: ${url}`));
    img.src = url;
  });
}

/** Rend une image tileable : mosaïque décalée + fondu de la croix centrale. */
function makeSeamlessCanvas(img, size = 512) {
  const c = canvas(size), ctx = c.getContext('2d');
  const half = size / 2;
  for (const dx of [-half, 0]) for (const dy of [-half, 0]) {
    ctx.drawImage(img, dx, dy, size, size);
  }
  // masque en croix adoucie : le centre montre l'image originale,
  // les bords gardent la mosaïque décalée ( perfectly wrappée)
  const mask = canvas(size), mctx = mask.getContext('2d');
  mctx.filter = 'blur(22px)';
  mctx.fillStyle = '#fff';
  const w = size * 0.34;
  mctx.fillRect(half - w / 2, 0, w, size);
  mctx.fillRect(0, half - w / 2, size, w);
  const over = canvas(size), octx = over.getContext('2d');
  octx.drawImage(img, 0, 0, size, size);
  octx.globalCompositeOperation = 'destination-in';
  octx.drawImage(mask, 0, 0);
  ctx.drawImage(over, 0, 0);
  return c;
}

/** Normale dérivée d'un canvas (luminance → hauteur → sobel simple). */
function normalCanvasFrom(srcCanvas, strength = 1.4) {
  const size = 512;
  const small = canvas(size);
  small.getContext('2d').drawImage(srcCanvas, 0, 0, size, size);
  const d = small.getContext('2d').getImageData(0, 0, size, size).data;
  const lum = (x, y) => {
    x &= size - 1; y &= size - 1;
    const i = (y * size + x) * 4;
    return (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
  };
  const out = canvas(size), octx = out.getContext('2d');
  const img = octx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (lum(x + 1, y) - lum(x - 1, y)) * strength;
      const dy = (lum(x, y + 1) - lum(x, y - 1)) * strength;
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = (y * size + x) * 4;
      img.data[i] = (nx / l * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function wrapNormal(cnv) {
  const tex = new THREE.CanvasTexture(cnv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Charge les photos, les rend tileables et remplace l'albédo des textures
 * procédurales correspondantes (même objet texture → matériaux à jour).
 * Échoue silencieusement en Node / hors ligne.
 */
export async function applyPhotoTextures(onProgress) {
  const keys = Object.keys(PHOTO_FILES);
  let done = 0;
  for (const key of keys) {
    try {
      const img = await loadImage(`textures/${PHOTO_FILES[key]}`);
      const seamless = makeSeamlessCanvas(img, 512);
      const tex = getTexture(key);
      const cnv = tex.image;
      cnv.getContext('2d').drawImage(seamless, 0, 0, cnv.width, cnv.height);
      tex.needsUpdate = true;
      const nTex = wrapNormal(normalCanvasFrom(seamless, PHOTO_NORMAL_STRENGTH[key] || 1.4));
      nTex.repeat.copy(tex.repeat);
      cache.set(`${key}PhotoNormal:1`, nTex);
    } catch (e) { /* secours procédural */ }
    done++;
    onProgress?.(done / keys.length, key);
    await new Promise((r) => setTimeout(r, 0));
  }
}

/** Meilleure normale disponible pour un matériau : photo > dérivée > null. */
export function normalFor(key, fallback = null) {
  const photo = cache.get(`${key}PhotoNormal:1`);
  if (photo) return photo;
  try {
    const ck = `${key}DerivedNormal:1`;
    if (cache.has(ck)) return cache.get(ck);
    const src = getTexture(key).image;
    const tex = wrapNormal(normalCanvasFrom(src, 1.2));
    cache.set(ck, tex);
    return tex;
  } catch (e) {
    return fallback ? getTexture(fallback) : null;
  }
}

export function getTexture(name, repeat = 1) {
  const key = `${name}:${repeat}`;
  if (cache.has(key)) return cache.get(key);
  const builder = BUILDERS[name];
  if (!builder) throw new Error(`texture inconnue: ${name}`);
  const tex = builder();
  if (repeat !== 1) tex.repeat.set(repeat, repeat);
  cache.set(key, tex);
  return tex;
}

/** Précharge (utilisé par l'écran de chargement) toutes les textures listées. */
export async function preloadTextures(names, onProgress) {
  for (let i = 0; i < names.length; i++) {
    getTexture(names[i]);
    onProgress?.((i + 1) / names.length, names[i]);
    // laisse respirer le thread pour animer la barre de chargement
    await new Promise((r) => setTimeout(r, 0));
  }
}

export const ALL_TEXTURES = Object.keys(BUILDERS);
