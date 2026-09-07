/**
 * weather.js — Météo dynamique : ciel dégagé, nuages, pluie, orage, brouillard.
 * Transitions progressives, particules de pluie, éclairs, vent, humidité du sol.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { settings } from '../core/settings.js';
import { makeRng } from '../core/rng.js';
import { bus } from '../core/events.js';
import { clamp, lerp, damp } from '../core/noise.js';

export const WEATHER_STATES = {
  clear: { label: 'Ciel dégagé', cloud: 0.12, rain: 0, fog: 0.00006, wind: 0.25, storm: 0, w: 26 },
  fair: { label: 'Éclaircies', cloud: 0.34, rain: 0, fog: 0.00012, wind: 0.4, storm: 0, w: 22 },
  cloudy: { label: 'Couvert', cloud: 0.72, rain: 0, fog: 0.00022, wind: 0.5, storm: 0, w: 18 },
  drizzle: { label: 'Bruine', cloud: 0.8, rain: 0.3, fog: 0.00045, wind: 0.45, storm: 0, w: 10 },
  rain: { label: 'Pluie', cloud: 0.9, rain: 0.72, fog: 0.00072, wind: 0.68, storm: 0, w: 9 },
  heavy_rain: { label: 'Pluie forte', cloud: 0.97, rain: 1.0, fog: 0.00105, wind: 0.9, storm: 0.25, w: 5 },
  storm: { label: 'Orage', cloud: 1.0, rain: 1.0, fog: 0.0012, wind: 1.0, storm: 1, w: 3 },
  fog: { label: 'Brouillard', cloud: 0.55, rain: 0, fog: 0.0035, wind: 0.12, storm: 0, w: 7 },
};

export class Weather {
  constructor(scene, terrain, seed = 1234) {
    this.scene = scene;
    this.terrain = terrain;
    this.rng = makeRng(seed);
    this.state = 'fair';
    this.next = 'fair';
    this.timer = 0;
    this.duration = 300;
    this.blend = 1;

    this.cloudiness = WEATHER_STATES.fair.cloud;
    this.rainIntensity = 0;
    this.fogDensity = WEATHER_STATES.fair.fog;
    this.windStrength = WEATHER_STATES.fair.wind;
    this.storminess = 0;
    this.wetness = 0;
    this.temperature = 14;
    this.lightningTimer = 8;
    this.flash = 0;

    this.buildRain();
    this.flashLight = new THREE.PointLight(0xdfe8ff, 0, 900, 1.4);
    this.flashLight.visible = false;
    scene.add(this.flashLight);
  }

  buildRain() {
    const max = 6000;
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(max * 3);
    const vel = new Float32Array(max);
    for (let i = 0; i < max; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 46;
      pos[i * 3 + 1] = Math.random() * 26;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 46;
      vel[i] = 14 + Math.random() * 10;
    }
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('aVel', new THREE.BufferAttribute(vel, 1));
    this.rainGeom = geom;

    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uOpacity: { value: 0.0 }, uSize: { value: 2.2 } },
      vertexShader: `
        uniform float uSize;
        varying float vFade;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * (12.0 / max(1.0, -mv.z));
          vFade = clamp(1.0 - (-mv.z) / 40.0, 0.0, 1.0);
        }`,
      fragmentShader: `
        uniform float uOpacity;
        varying float vFade;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.05, length(d * vec2(2.6, 0.5)));
          gl_FragColor = vec4(vec3(0.72, 0.78, 0.85), a * uOpacity * vFade);
        }`,
    });
    this.rainMat = mat;
    this.rain = new THREE.Points(geom, mat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  pickNext(hour) {
    const entries = Object.entries(WEATHER_STATES).map(([key, s]) => {
      let w = s.w;
      // Le brouillard se forme surtout à l'aube
      if (key === 'fog') w *= (hour > 4 && hour < 9) ? 3.2 : 0.25;
      // Les orages restent rares
      if (key === 'storm') w *= 0.6;
      // Enchaînements crédibles
      if (this.state === 'clear' && (key === 'storm' || key === 'heavy_rain')) w *= 0.15;
      if (this.state === 'storm' && key === 'clear') w *= 0.2;
      if (key === this.state) w *= 0.35;
      return { key, w };
    });
    return this.rng.weighted(entries).key;
  }

  forceState(key) {
    if (!WEATHER_STATES[key]) return;
    this.state = key;
    this.next = key;
    this.blend = 1;
    this.timer = 0;
  }

  update(dt, camera, hour) {
    this.timer += dt;
    if (this.timer > this.duration) {
      this.timer = 0;
      this.duration = this.rng.range(210, 620);
      this.state = this.next;
      this.next = this.pickNext(hour);
      this.blend = 0;
      bus.emit('weather:changed', { state: this.next, label: WEATHER_STATES[this.next].label });
    }
    this.blend = Math.min(1, this.blend + dt / 45);   // transition lente (~45 s)

    const a = WEATHER_STATES[this.state], b = WEATHER_STATES[this.next];
    const t = this.blend;
    this.cloudiness = lerp(a.cloud, b.cloud, t);
    const rainTarget = lerp(a.rain, b.rain, t);
    this.rainIntensity = damp(this.rainIntensity, rainTarget, 0.6, dt);
    this.fogDensity = lerp(a.fog, b.fog, t);
    this.windStrength = lerp(a.wind, b.wind, t);
    this.storminess = lerp(a.storm, b.storm, t);

    // Humidité du sol : monte sous la pluie, sèche lentement ensuite
    const dryRate = 0.012 * (1 - this.cloudiness * 0.5);
    this.wetness = clamp(this.wetness + (this.rainIntensity > 0.05 ? dt * 0.06 : -dt * dryRate), 0, 1);

    // Température : heure + altitude + météo
    const alt = camera.position.y;
    const dayCurve = Math.sin(((hour - 6) / 24) * Math.PI * 2) * 0.5 + 0.5;
    this.temperature = 5 + dayCurve * 15
      - alt * 0.0065                       // gradient adiabatique
      - this.rainIntensity * 4.5
      - this.windStrength * 2.2
      + (1 - this.cloudiness) * 1.5;

    this.updateRain(dt, camera);
    this.updateLightning(dt, camera);
  }

  updateRain(dt, camera) {
    const maxCount = settings.preset.rainParticles;
    const count = Math.floor(maxCount * clamp(this.rainIntensity, 0, 1));
    this.rain.visible = count > 4;
    this.rainGeom.setDrawRange(0, count);
    this.rainMat.uniforms.uOpacity.value = clamp(this.rainIntensity * 0.65, 0, 0.7);
    this.rainMat.uniforms.uSize.value = 1.6 + this.rainIntensity * 1.6;
    if (!this.rain.visible) return;

    const pos = this.rainGeom.attributes.position.array;
    const vel = this.rainGeom.attributes.aVel.array;
    const wind = this.windStrength * 5.5;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      pos[i3 + 1] -= vel[i] * dt * (0.7 + this.rainIntensity * 0.6);
      pos[i3] += wind * dt;
      if (pos[i3 + 1] < -4) {
        pos[i3] = (Math.random() - 0.5) * 46;
        pos[i3 + 1] = 22 + Math.random() * 8;
        pos[i3 + 2] = (Math.random() - 0.5) * 46;
      }
      if (pos[i3] > 24) pos[i3] -= 46;
    }
    this.rainGeom.attributes.position.needsUpdate = true;
    this.rain.position.set(camera.position.x, camera.position.y, camera.position.z);
  }

  updateLightning(dt, camera) {
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 3.2);
      this.flashLight.intensity = this.flash * 900;
      this.flashLight.visible = this.flash > 0.01;
      this.flashLight.position.copy(camera.position).add(new THREE.Vector3(0, 220, 0));
    }
    if (this.storminess < 0.35) return;
    this.lightningTimer -= dt * this.storminess;
    if (this.lightningTimer <= 0) {
      this.lightningTimer = this.rng.range(6, 26) / Math.max(0.3, this.storminess);
      this.flash = this.rng.range(0.5, 1.0);
      const distance = this.rng.range(300, 3200);
      bus.emit('weather:lightning', { distance, delay: distance / 340 });
    }
  }

  get label() { return WEATHER_STATES[this.next]?.label || WEATHER_STATES[this.state].label; }

  toJSON() { return { state: this.state, next: this.next, timer: this.timer, blend: this.blend, wetness: this.wetness }; }
  fromJSON(d) {
    if (!d) return;
    this.state = WEATHER_STATES[d.state] ? d.state : 'fair';
    this.next = WEATHER_STATES[d.next] ? d.next : this.state;
    this.timer = d.timer ?? 0;
    this.blend = d.blend ?? 1;
    this.wetness = d.wetness ?? 0;
  }
}
