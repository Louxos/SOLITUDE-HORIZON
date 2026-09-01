/**
 * player.js — Contrôleur joueur première personne : marche, course, saut,
 * accroupissement, nage, escalade, collisions capsule/boîtes, head bob,
 * dégâts de chute, lampe torche, conduite.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { PLAYER, WORLD } from '../core/config.js';
import { input } from '../core/input.js';
import { settings } from '../core/settings.js';
import { bus } from '../core/events.js';
import { clamp, damp, lerp } from '../core/noise.js';
import { Inventory } from '../inventory/inventory.js';
import { SurvivalStats } from '../survival/stats.js';

const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  constructor(camera, terrain) {
    this.camera = camera;
    this.terrain = terrain;
    this.position = new THREE.Vector3(0, 0, 0);   // pieds
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.height = 1.8;
    this.grounded = false;
    this.crouching = false;
    this.swimming = false;
    this.underwater = false;
    this.climbing = false;
    this.inWaterDepth = 0;
    this.running = false;
    this.moving = false;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.fallStartY = null;
    this.lastSurface = 'grass';
    this.stepDistance = 0;
    this.sheltered = false;
    this.nearFire = false;
    this.vehicle = null;         // véhicule conduit
    this.frozen = false;         // pendant les menus / le sommeil

    this.inventory = new Inventory({ slots: 24, maxWeight: PLAYER.maxCarry, name: 'Sac à dos' });
    this.stats = new SurvivalStats();

    // Lampe torche
    this.flashlight = new THREE.SpotLight(0xffe9c4, 0, 46, Math.PI / 7.2, 0.42, 1.1);
    this.flashlight.castShadow = false;
    this.flashlightOn = false;
    this.flashlightBattery = 0;    // secondes restantes
    camera.add(this.flashlight);
    this.flashlight.position.set(0.12, -0.08, 0);
    this.flashlight.target.position.set(0, 0, -1);
    camera.add(this.flashlight.target);

    bus.on('input:keydown', (code) => {
      if (this.frozen) return;
      if (settings.data.bindings.flashlight.includes(code)) this.toggleFlashlight();
    });
  }

  get eyeY() { return this.crouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight; }

  get carryRatio() { return clamp(this.inventory.weight / this.inventory.maxWeight, 0, 1.2); }

  spawn(x, z) {
    this.position.set(x, this.terrain.height(x, z) + 0.2, z);
    this.velocity.set(0, 0, 0);
  }

  toggleFlashlight() {
    if (!this.inventory.has('flashlight') && this.flashlightBattery <= 0) {
      const has = this.inventory.items.find((i) => i.id === 'flashlight');
      if (!has) { bus.emit('notify', { text: 'Vous n\'avez pas de lampe.', kind: 'info' }); return; }
    }
    if (!this.inventory.has('flashlight')) {
      bus.emit('notify', { text: 'Vous n\'avez pas de lampe.', kind: 'info' });
      return;
    }
    if (this.flashlightBattery <= 0) {
      if (this.inventory.has('battery_aa')) {
        this.inventory.remove('battery_aa', 1);
        this.flashlightBattery = 900;      // 15 min réelles
        bus.emit('notify', { text: 'Piles remplacées.', kind: 'info' });
      } else {
        bus.emit('notify', { text: 'La lampe est vide. Il faut des piles.', kind: 'warn' });
        return;
      }
    }
    this.flashlightOn = !this.flashlightOn;
    bus.emit('audio:sfx', { name: 'click' });
  }

  /** Transforme un point monde vers l'espace local d'une boîte orientée. */
  static toBoxLocal(px, pz, box) {
    const dx = px - box.wx, dz = pz - box.wz;
    if (!box.yaw) return { x: dx, z: dz };
    const c = Math.cos(-box.yaw), s = Math.sin(-box.yaw);
    return { x: dx * c + dz * s, z: -dx * s + dz * c };
  }

  /** Hauteur du sol la plus haute sous le joueur (terrain, planchers, meubles). */
  groundHeightAt(x, z, colliders, supports, maxY) {
    let g = this.terrain.height(x, z);
    const r = PLAYER.radius;
    for (const s of supports) {
      const l = Player.toBoxLocal(x, z, { wx: s.wx, wz: s.wz, yaw: s.yaw });
      if (Math.abs(l.x) <= s.hx + r && Math.abs(l.z) <= s.hz + r) {
        if (s.top <= maxY + PLAYER.stepHeight && s.top > g) g = s.top;
      }
    }
    for (const c of colliders) {
      if (c.disabled) continue;
      const l = Player.toBoxLocal(x, z, c);
      if (Math.abs(l.x) <= c.hx + r * 0.55 && Math.abs(l.z) <= c.hz + r * 0.55) {
        const top = c.wy + c.hy;
        if (top <= maxY + PLAYER.stepHeight && top > g) g = top;
      }
    }
    return g;
  }

  /** Résolution des collisions horizontales contre les boîtes. */
  resolveCollisions(colliders, treeColliders) {
    const r = PLAYER.radius;
    const feetY = this.position.y;
    const headY = this.position.y + this.height;

    for (let iter = 0; iter < 2; iter++) {
      for (const c of colliders) {
        if (c.disabled) continue;
        const top = c.wy + c.hy, bottom = c.wy - c.hy;
        if (top < feetY + PLAYER.stepHeight) continue;     // on marche dessus
        if (bottom > headY) continue;                      // on passe dessous
        const l = Player.toBoxLocal(this.position.x, this.position.z, c);
        const ox = c.hx + r - Math.abs(l.x);
        const oz = c.hz + r - Math.abs(l.z);
        if (ox <= 0 || oz <= 0) continue;
        // Repousse selon l'axe de moindre pénétration
        let lx = l.x, lz = l.z;
        if (ox < oz) lx += Math.sign(l.x || 1) * ox;
        else lz += Math.sign(l.z || 1) * oz;
        const cs = Math.cos(c.yaw || 0), sn = Math.sin(c.yaw || 0);
        this.position.x = c.wx + lx * cs - lz * sn;
        this.position.z = c.wz + lx * sn + lz * cs;
        // annule la vitesse entrante
        if (ox < oz) this.velocity.x *= 0.1; else this.velocity.z *= 0.1;
      }
      // troncs d'arbres / rochers (cylindres)
      for (const t of treeColliders) {
        if (feetY > t.y + t.h) continue;
        const dx = this.position.x - t.x, dz = this.position.z - t.z;
        const d = Math.hypot(dx, dz);
        const min = t.r + r;
        if (d >= min || d < 1e-5) continue;
        const push = (min - d) / d;
        this.position.x += dx * push;
        this.position.z += dz * push;
      }
    }
  }

  update(dt, ctx) {
    const { colliders = [], supports = [], treeColliders = [], weather, sky } = ctx;

    // Regard
    if (!this.frozen && input.locked) {
      const sens = 0.0022 * settings.data.mouseSensitivity;
      this.yaw -= input.mouse.dx * sens;
      this.pitch -= input.mouse.dy * sens * (settings.data.invertY ? -1 : 1);
      this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    }

    if (this.vehicle) { this.updateDriving(dt, ctx); return; }

    const stats = this.stats;
    const wantForward = !this.frozen && input.isDown('forward');
    const wantBack = !this.frozen && input.isDown('back');
    const wantLeft = !this.frozen && input.isDown('left');
    const wantRight = !this.frozen && input.isDown('right');
    const wantRun = !this.frozen && input.isDown('run');
    const wantJump = !this.frozen && input.isDown('jump');
    const wantCrouch = !this.frozen && input.isDown('crouch');

    // Eau
    const groundY = this.groundHeightAt(this.position.x, this.position.z, colliders, supports, this.position.y);
    const waterTop = WORLD.waterLevel;
    this.inWaterDepth = Math.max(0, waterTop - this.position.y);
    const wading = this.inWaterDepth > 0.05;
    this.swimming = this.inWaterDepth > 1.25;
    this.underwater = (this.position.y + this.eyeY) < waterTop - 0.05;

    // Accroupi
    const canStand = true;
    this.crouching = wantCrouch && !this.swimming && canStand;
    this.height = this.crouching ? 1.25 : 1.8;

    // Vitesse cible
    let speed = PLAYER.walkSpeed;
    this.running = false;
    if (this.swimming) speed = PLAYER.swimSpeed;
    else if (this.crouching) speed = PLAYER.crouchSpeed;
    else if (wantRun && !stats.exhausted && (wantForward || wantLeft || wantRight)) {
      speed = PLAYER.runSpeed;
      this.running = true;
    }
    if (wading && !this.swimming) speed = Math.min(speed, lerp(speed, PLAYER.waterWalkSpeed, clamp(this.inWaterDepth / 1.2, 0, 1)));
    speed *= stats.speedMultiplier;
    if (this.carryRatio > 1) speed *= 0.7;
    else if (this.carryRatio > 0.85) speed *= 0.88;

    // Direction
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3();
    if (wantForward) wish.add(forward);
    if (wantBack) wish.sub(forward);
    if (wantRight) wish.add(right);
    if (wantLeft) wish.sub(right);
    const wishLen = wish.length();
    if (wishLen > 0) wish.divideScalar(wishLen);
    this.moving = wishLen > 0;

    // Escalade : pentes trop raides mais accrochables
    this.climbing = false;
    const slopeNormal = this.terrain.normal(this.position.x, this.position.z);
    const steep = slopeNormal.y < PLAYER.maxSlopeCos;
    if (steep && this.moving && !this.swimming) {
      const aheadX = this.position.x + wish.x * 0.6;
      const aheadZ = this.position.z + wish.z * 0.6;
      const aheadH = this.terrain.height(aheadX, aheadZ);
      const rise = aheadH - this.position.y;
      const n2 = this.terrain.normal(aheadX, aheadZ);
      if (rise > 0.25 && n2.y > PLAYER.climbSlopeCos && stats.stamina > 4) {
        this.climbing = true;
        speed *= 0.45;
        this.velocity.y = Math.max(this.velocity.y, 1.5);
      } else if (rise > 0.25 && n2.y <= PLAYER.climbSlopeCos) {
        // paroi infranchissable
        speed *= 0.12;
      }
    }

    // Accélération / friction
    const accel = this.grounded || this.swimming ? PLAYER.accel : PLAYER.airAccel;
    const targetVx = wish.x * speed, targetVz = wish.z * speed;
    this.velocity.x = damp(this.velocity.x, targetVx, accel * (this.moving ? 0.55 : PLAYER.friction * 0.18), dt);
    this.velocity.z = damp(this.velocity.z, targetVz, accel * (this.moving ? 0.55 : PLAYER.friction * 0.18), dt);

    // Vertical
    if (this.swimming) {
      const buoyancy = clamp((waterTop - 0.4 - this.position.y) * 3.2, -2, 2.2);
      this.velocity.y = damp(this.velocity.y, buoyancy + (wantJump ? 1.7 : 0) - (wantCrouch ? 1.9 : 0), 5, dt);
      this.grounded = false;
    } else {
      this.velocity.y -= PLAYER.gravity * dt;
      if (this.grounded && wantJump && !stats.exhausted) {
        this.velocity.y = PLAYER.jumpSpeed;
        this.grounded = false;
        stats.stamina = Math.max(0, stats.stamina - 6);
        bus.emit('audio:sfx', { name: 'jump', surface: this.lastSurface });
      }
    }

    // Intégration + collisions
    const prevY = this.position.y;
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y += this.velocity.y * dt;

    // Bordures du monde
    const lim = WORLD.half - 12;
    this.position.x = clamp(this.position.x, -lim, lim);
    this.position.z = clamp(this.position.z, -lim, lim);

    this.resolveCollisions(colliders, treeColliders);

    // Sol
    const g = this.groundHeightAt(this.position.x, this.position.z, colliders, supports, Math.max(prevY, this.position.y));
    if (this.position.y <= g + 0.02) {
      if (!this.grounded && this.fallStartY !== null) {
        const fall = this.fallStartY - g;
        if (fall > 4.2) {
          const dmg = Math.pow(fall - 4.2, 1.42) * 3.1;
          this.stats.damage(dmg, 'chute');
          bus.emit('audio:sfx', { name: 'hurt' });
        }
        this.fallStartY = null;
      }
      this.position.y = g;
      this.velocity.y = Math.max(0, this.velocity.y);
      this.grounded = true;
    } else {
      if (this.fallStartY === null) this.fallStartY = this.position.y;
      else this.fallStartY = Math.max(this.fallStartY, this.position.y);
      this.grounded = false;
    }
    if (this.swimming) this.fallStartY = null;

    // Pas
    const planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && planarSpeed > 0.4) {
      this.stepDistance += planarSpeed * dt;
      const stride = this.running ? 2.1 : this.crouching ? 2.6 : 1.65;
      if (this.stepDistance > stride) {
        this.stepDistance = 0;
        this.lastSurface = wading ? 'water' : this.terrain.surfaceAt(this.position.x, this.position.z);
        bus.emit('audio:sfx', { name: 'step', surface: this.lastSurface, running: this.running });
      }
    }

    // Caméra + head bob
    const targetBob = settings.data.headBob ? clamp(planarSpeed / PLAYER.runSpeed, 0, 1) : 0;
    this.bobAmount = damp(this.bobAmount, targetBob, 6, dt);
    this.bobPhase += planarSpeed * dt * (this.running ? 8.4 : 6.2);
    const bobY = Math.sin(this.bobPhase) * 0.028 * this.bobAmount;
    const bobX = Math.cos(this.bobPhase * 0.5) * 0.022 * this.bobAmount;

    const eye = this.swimming ? Math.min(this.eyeY, waterTop - this.position.y + 0.28) : this.eyeY;
    this.camera.position.set(
      this.position.x + bobX,
      this.position.y + eye + bobY,
      this.position.z,
    );
    this.camera.rotation.set(this.pitch, this.yaw, Math.sin(this.bobPhase) * 0.006 * this.bobAmount, 'YXZ');

    // Lampe torche
    if (this.flashlightOn) {
      this.flashlightBattery -= dt;
      if (this.flashlightBattery <= 0) {
        this.flashlightOn = false;
        bus.emit('notify', { text: 'La lampe s\'éteint : piles épuisées.', kind: 'warn' });
      }
    }
    this.flashlight.intensity = damp(this.flashlight.intensity, this.flashlightOn ? 3.4 : 0, 9, dt);

    // Survie
    this.stats.update(dt, {
      running: this.running && this.moving,
      climbing: this.climbing,
      swimming: this.swimming,
      moving: this.moving,
      resting: !this.moving && this.grounded,
      temperature: weather ? weather.temperature : 14,
      carryRatio: this.carryRatio,
      wet: wading || (weather && weather.rainIntensity > 0.2 && !this.sheltered),
      sheltered: this.sheltered,
      nearFire: this.nearFire,
    });
  }

  /** Conduite : le joueur est solidaire du véhicule. */
  updateDriving(dt, ctx) {
    const v = this.vehicle;
    const controls = {
      forward: !this.frozen && input.isDown('forward'),
      back: !this.frozen && input.isDown('back'),
      left: !this.frozen && input.isDown('left'),
      right: !this.frozen && input.isDown('right'),
      brake: !this.frozen && input.isDown('jump'),
    };
    v.drive(dt, controls);

    // Caméra intérieure
    const seat = new THREE.Vector3(-0.38, 1.12, 0.15).applyAxisAngle(UP, v.yaw);
    this.position.set(v.position.x, v.position.y, v.position.z);
    this.camera.position.copy(v.position).add(seat);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.flashlight.intensity = 0;

    this.stats.update(dt, {
      running: false, climbing: false, swimming: false, moving: false, resting: true,
      temperature: (ctx.weather ? ctx.weather.temperature : 14) + 3,
      carryRatio: this.carryRatio, wet: false, sheltered: true, nearFire: false,
    });
  }

  enterVehicle(vehicle) {
    this.vehicle = vehicle;
    vehicle.driving = true;
    this.yaw = vehicle.yaw;
    bus.emit('player:vehicle', { vehicle, entered: true });
  }

  exitVehicle() {
    const v = this.vehicle;
    if (!v) return;
    v.driving = false;
    v.stopEngine();
    this.vehicle = null;
    const side = new THREE.Vector3(-2.2, 0, 0).applyAxisAngle(UP, v.yaw);
    const x = v.position.x + side.x, z = v.position.z + side.z;
    this.position.set(x, this.terrain.height(x, z) + 0.1, z);
    this.velocity.set(0, 0, 0);
    bus.emit('player:vehicle', { vehicle: v, entered: false });
  }

  toJSON() {
    return {
      x: this.position.x, y: this.position.y, z: this.position.z,
      yaw: this.yaw, pitch: this.pitch,
      stats: this.stats.toJSON(),
      inventory: this.inventory.toJSON(),
      flashlightBattery: this.flashlightBattery,
      flashlightOn: this.flashlightOn,
    };
  }

  fromJSON(d) {
    if (!d) return;
    this.position.set(d.x, d.y, d.z);
    this.yaw = d.yaw ?? 0;
    this.pitch = d.pitch ?? 0;
    this.stats.fromJSON(d.stats);
    this.inventory.fromJSON(d.inventory);
    this.flashlightBattery = d.flashlightBattery ?? 0;
    this.flashlightOn = !!d.flashlightOn && this.flashlightBattery > 0;
  }
}
