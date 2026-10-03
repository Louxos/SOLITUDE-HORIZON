/**
 * sky.js — Cycle jour/nuit complet : dôme atmosphérique, soleil, lune,
 * étoiles, lumières et couleurs de brouillard pilotées par l'heure.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { TIME_SCALE } from '../core/config.js';
import { settings } from '../core/settings.js';
import { clamp, lerp, smoothstep } from '../core/noise.js';
import { bus } from '../core/events.js';

const SKY_VERT = `
  varying vec3 vWorldDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldDir = normalize(wp.xyz - cameraPosition);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w; // toujours au fond
  }
`;

const SKY_FRAG = `
  precision highp float;
  #include <common>
  varying vec3 vWorldDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uMoonDir;
  uniform float uStars;
  uniform float uCloud;
  uniform float uTime;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise3(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise3(p); p *= 2.02; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    float h = dir.y;
    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
    col = mix(uGround, col, smoothstep(-0.14, 0.02, h));

    // halo solaire
    float sunDot = max(dot(dir, uSunDir), 0.0);
    col += uSunColor * pow(sunDot, 220.0) * 6.0;              // disque
    col += uSunColor * pow(sunDot, 6.0) * 0.28;               // halo
    col += uSunColor * pow(sunDot, 1.6) * 0.06;

    // lune
    float moonDot = max(dot(dir, uMoonDir), 0.0);
    col += vec3(0.85, 0.88, 0.95) * pow(moonDot, 900.0) * 3.4;
    col += vec3(0.35, 0.4, 0.5) * pow(moonDot, 18.0) * 0.06;

    // étoiles
    if (uStars > 0.01 && h > -0.02) {
      vec3 sp = dir * 260.0;
      float s = hash(floor(sp));
      float star = smoothstep(0.9975, 1.0, s);
      float twinkle = 0.75 + 0.25 * sin(uTime * 2.1 + s * 90.0);
      col += vec3(star) * uStars * twinkle * smoothstep(0.0, 0.25, h);
    }

    // nuages procéduraux
    if (h > 0.005) {
      vec3 cp = dir / max(h, 0.06);
      float c = fbm(vec3(cp.x * 0.55 + uTime * 0.006, cp.z * 0.55 + uTime * 0.004, uTime * 0.01));
      float cover = smoothstep(0.52 - uCloud * 0.42, 0.86 - uCloud * 0.3, c);
      cover *= smoothstep(0.0, 0.18, h);
      vec3 cloudCol = mix(vec3(0.30, 0.31, 0.34), vec3(1.0, 0.99, 0.96), clamp(uSunDir.y * 1.6 + 0.3, 0.0, 1.0));
      cloudCol = mix(cloudCol, uSunColor * 1.2, pow(sunDot, 3.0) * 0.5);
      col = mix(col, cloudCol, cover * (0.35 + uCloud * 0.6));
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Palettes clés du cycle (heure -> couleurs). */
const KEYS = [
  { t: 0.0, zenith: 0x05070f, horizon: 0x0b1018, sun: 0x1a2030, amb: 0x0a0e18, intensity: 0.02 },
  { t: 5.0, zenith: 0x121c30, horizon: 0x2a2c38, sun: 0x40465c, amb: 0x1a2030, intensity: 0.08 },
  { t: 6.5, zenith: 0x3a5a86, horizon: 0xd98a5a, sun: 0xffb27a, amb: 0x4a4c50, intensity: 0.55 },
  { t: 8.0, zenith: 0x5d8fc4, horizon: 0xbcc9d2, sun: 0xffe6c4, amb: 0x8a9099, intensity: 1.35 },
  { t: 12.0, zenith: 0x4a86c8, horizon: 0xa8bccd, sun: 0xfff6e4, amb: 0x9aa4ad, intensity: 1.75 },
  { t: 17.0, zenith: 0x548ac0, horizon: 0xc0c3c0, sun: 0xffe8c0, amb: 0x8e939a, intensity: 1.2 },
  { t: 19.5, zenith: 0x2d4a74, horizon: 0xd97a48, sun: 0xff9a52, amb: 0x4e4a4a, intensity: 0.42 },
  { t: 21.0, zenith: 0x121a2c, horizon: 0x2c2c3a, sun: 0x2a3348, amb: 0x161c28, intensity: 0.07 },
  { t: 24.0, zenith: 0x05070f, horizon: 0x0b1018, sun: 0x1a2030, amb: 0x0a0e18, intensity: 0.02 },
];

function samplePalette(hour) {
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (hour >= KEYS[i].t && hour <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
  }
  const t = (hour - a.t) / Math.max(0.0001, b.t - a.t);
  const mix = (ca, cb) => new THREE.Color(ca).lerp(new THREE.Color(cb), t);
  return {
    zenith: mix(a.zenith, b.zenith),
    horizon: mix(a.horizon, b.horizon),
    sun: mix(a.sun, b.sun),
    amb: mix(a.amb, b.amb),
    intensity: lerp(a.intensity, b.intensity, t),
  };
}

/** Sprite de nuage : bouffées radiales superposées (blanc, alpha). */
function makeCloudTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 22; i++) {
    const x = 30 + Math.random() * 196;
    const y = 44 + Math.random() * 44;
    const r = 16 + Math.random() * 34;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    const a = 0.10 + Math.random() * 0.16;
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Sky {
  constructor(scene, engine) {
    this.scene = scene;
    this.engine = engine;
    this.hour = 7.4;
    this.day = 1;
    this.paused = false;

    const geom = new THREE.SphereGeometry(1, 32, 20);
    this.uniforms = {
      uZenith: { value: new THREE.Color(0x4a86c8) },
      uHorizon: { value: new THREE.Color(0xa8bccd) },
      uGround: { value: new THREE.Color(0x2a2b26) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0xfff6e4) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uStars: { value: 0 },
      uCloud: { value: 0.25 },
      uTime: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.scale.setScalar(1);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.onBeforeRender = (renderer, scene, camera) => {
      this.mesh.position.copy(camera.position);
      this.mesh.scale.setScalar(camera.far * 0.9);
    };
    scene.add(this.mesh);

    this.sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    this.sun.castShadow = settings.preset.shadows;
    this.configureShadow();
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.moonLight = new THREE.DirectionalLight(0x93a7c4, 0.0);
    scene.add(this.moonLight);

    this.hemi = new THREE.HemisphereLight(0x9db4c8, 0x3d3a2f, 0.55);
    scene.add(this.hemi);

    // Nuages dérivants (billboards hauts, hors brouillard)
    this.clouds = [];
    {
      const tex = makeCloudTexture();
      const N = 24;
      for (let i = 0; i < N; i++) {
        const mat = new THREE.MeshBasicMaterial({
          map: tex, transparent: true, opacity: 0, depthWrite: false, fog: false,
        });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.46), mat);
        m.frustumCulled = false;
        m.renderOrder = -900;
        m.userData = {
          ang: (i / N) * Math.PI * 2 + Math.random() * 0.4,
          dist: 750 + Math.random() * 1150,
          alt: 265 + Math.random() * 205,
          w: 330 + Math.random() * 430,
          speed: 0.0022 + Math.random() * 0.0035,
          base: 0.26 + Math.random() * 0.30,
        };
        scene.add(m);
        this.clouds.push(m);
      }
    }

    // Étoiles filantes (rares, nuits dégagées)
    this.shooting = null;
    this.shootTimer = 30 + Math.random() * 60;
    this._shootTex = makeCloudTexture();

    bus.on('quality:applied', () => this.configureShadow());
  }

  configureShadow() {
    const preset = settings.preset;
    this.sun.castShadow = preset.shadows;
    const s = 105;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 480;
    this.sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    this.sun.shadow.bias = -0.0007;
    this.sun.shadow.normalBias = 0.05;
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  get isNight() { return this.hour < 6.0 || this.hour > 20.6; }
  get isDark() { return this.hour < 6.6 || this.hour > 20.0; }

  /** Facteur de luminosité ambiante [0,1] utilisé par l'IA animale et l'audio. */
  get daylight() {
    return clamp(smoothstep(5.2, 7.2, this.hour) - smoothstep(19.4, 21.2, this.hour), 0, 1);
  }

  setTime(hour, day = this.day) {
    this.hour = ((hour % 24) + 24) % 24;
    this.day = day;
  }

  advance(hours) {
    this.hour += hours;
    while (this.hour >= 24) { this.hour -= 24; this.day++; }
  }

  update(dt, camera, weather) {
    if (!this.paused) this.advance((dt * TIME_SCALE) / 3600);

    const hour = this.hour;
    const pal = samplePalette(hour);

    // Position solaire : lever ~6h30, coucher ~20h
    const dayAngle = ((hour - 6) / 12) * Math.PI;
    const sunDir = new THREE.Vector3(
      Math.cos(dayAngle) * 0.75,
      Math.sin(dayAngle),
      Math.sin(dayAngle * 0.55) * 0.42,
    ).normalize();
    const moonDir = sunDir.clone().negate();

    const cloudy = weather ? weather.cloudiness : 0.2;
    const stormy = weather ? weather.storminess : 0;
    const dim = 1 - cloudy * 0.62 - stormy * 0.22;

    this.uniforms.uZenith.value.copy(pal.zenith).multiplyScalar(lerp(1, 0.55, cloudy));
    this.uniforms.uHorizon.value.copy(pal.horizon).multiplyScalar(lerp(1, 0.62, cloudy));
    this.sunDir = sunDir;
    this.uniforms.uSunDir.value.copy(sunDir);
    this.uniforms.uMoonDir.value.copy(moonDir);
    this.uniforms.uSunColor.value.copy(pal.sun);
    this.uniforms.uStars.value = clamp((1 - this.daylight) * (1 - cloudy * 0.9), 0, 1);
    this.uniforms.uCloud.value = cloudy;
    this.uniforms.uTime.value += dt;

    this.sun.color.copy(pal.sun);
    this.sun.intensity = Math.max(0, pal.intensity * dim);
    this.sun.position.copy(camera.position).add(sunDir.clone().multiplyScalar(160));
    this.sun.target.position.copy(camera.position);
    this.sun.target.updateMatrixWorld();
    this.sun.visible = sunDir.y > -0.05;

    const moonUp = clamp(moonDir.y, 0, 1);
    this.moonLight.intensity = moonUp * 0.16 * (1 - this.daylight) * (1 - cloudy * 0.7);
    this.moonLight.position.copy(camera.position).add(moonDir.clone().multiplyScalar(160));

    this.hemi.intensity = lerp(0.08, 0.62, this.daylight) * lerp(1, 0.7, cloudy) + 0.03;
    this.hemi.color.copy(pal.zenith).lerp(new THREE.Color(0xffffff), 0.25);

    // --- Nuages : anneaux dérivants autour du joueur, teintés au crépuscule ---
    const dusk = Math.max(0, 1 - Math.abs(hour - 6.3) * 1.3) + Math.max(0, 1 - Math.abs(hour - 19.5) * 1.3);
    for (const m of this.clouds) {
      const u = m.userData;
      u.ang += u.speed * dt;
      m.position.set(
        camera.position.x + Math.cos(u.ang) * u.dist,
        u.alt,
        camera.position.z + Math.sin(u.ang) * u.dist,
      );
      m.lookAt(camera.position.x, m.position.y - 40, camera.position.z);
      m.scale.set(u.w, u.w * 0.5, 1);
      m.material.opacity = u.base * (0.10 + this.daylight * 0.9) * (1 - cloudy * 0.38);
      m.material.color.setRGB(1, 1, 1).lerp(pal.sun, Math.min(1, dusk) * 0.45);
    }

    // --- Étoile filante : tête + traînée de sprites, nuits dégagées ---
    this.shootTimer -= dt;
    if (!this.shooting && this.shootTimer <= 0) {
      if (this.uniforms.uStars.value > 0.55) {
        const group = new THREE.Group();
        const ang = Math.random() * Math.PI * 2;
        const start = new THREE.Vector3(
          camera.position.x + Math.cos(ang) * 950,
          430 + Math.random() * 170,
          camera.position.z + Math.sin(ang) * 950,
        );
        const dir = new THREE.Vector3(
          -Math.cos(ang) * (0.7 + Math.random() * 0.5),
          -(0.28 + Math.random() * 0.3),
          -Math.sin(ang) * (0.7 + Math.random() * 0.5),
        ).normalize();
        for (let i = 0; i < 6; i++) {
          const mat = new THREE.SpriteMaterial({
            map: this._shootTex, color: 0xdfe8ff, transparent: true,
            opacity: 0.85 * (1 - i / 6), depthWrite: false, fog: false,
          });
          const sp = new THREE.Sprite(mat);
          const sc = i === 0 ? 7 : 4.5 * (1 - i / 7);
          sp.scale.set(sc, sc, 1);
          sp.position.copy(start).addScaledVector(dir, -i * 9);
          group.add(sp);
        }
        group.renderOrder = -899;
        this.scene.add(group);
        this.shooting = { group, dir, t: 0 };
      }
      this.shootTimer = 25 + Math.random() * 55;
    }
    if (this.shooting) {
      const sh = this.shooting;
      sh.t += dt;
      sh.group.position.addScaledVector(sh.dir, 950 * dt);
      for (const sp of sh.group.children) sp.material.opacity *= Math.max(0, 1 - dt * 1.6);
      if (sh.t > 0.9) {
        this.scene.remove(sh.group);
        for (const sp of sh.group.children) sp.material.dispose();
        this.shooting = null;
      }
    }
    this.hemi.groundColor.set(0x35322a);

    // Brouillard atmosphérique
    const fog = this.scene.fog;
    if (fog) {
      const fogCol = pal.horizon.clone().lerp(new THREE.Color(0x7d848c), cloudy * 0.6);
      fog.color.copy(fogCol).multiplyScalar(lerp(0.35, 1, this.daylight * 0.85 + 0.15));
      const baseDensity = 0.00048;
      const weatherFog = weather ? weather.fogDensity : 0;
      fog.density = baseDensity + weatherFog + (1 - this.daylight) * 0.00035;
    }
    this.engine.renderer.toneMappingExposure = lerp(1.28, 1.02, this.daylight) * (1 - cloudy * 0.12);
  }

  timeString() {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  toJSON() { return { hour: this.hour, day: this.day }; }
  fromJSON(d) { if (d) { this.hour = d.hour ?? this.hour; this.day = d.day ?? this.day; } }
}
