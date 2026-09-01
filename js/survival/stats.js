/**
 * stats.js — Survie : santé, endurance, faim, soif, fatigue, température.
 * Les statistiques s'influencent mutuellement (voir applyEffects).
 */

import { SURVIVAL, TIME_SCALE } from '../core/config.js';
import { clamp } from '../core/noise.js';
import { bus } from '../core/events.js';

export class SurvivalStats {
  constructor() {
    this.health = 100;
    this.stamina = 100;
    this.hunger = 82;      // 100 = repu
    this.thirst = 78;      // 100 = hydraté
    this.fatigue = 88;     // 100 = reposé
    this.warmth = 68;      // 100 = confortable, 0 = hypothermie
    this.sick = 0;         // intoxication en cours
    this.bleeding = 0;
    this.dead = false;
    this.exhausted = false;
    this._notified = {};
  }

  get maxStamina() {
    let m = 100;
    m -= (100 - this.hunger) * 0.22;
    m -= (100 - this.thirst) * 0.30;
    m -= (100 - this.fatigue) * 0.20;
    m -= (100 - this.warmth) * 0.12;
    return clamp(m, 22, 100);
  }

  get speedMultiplier() {
    let s = 1;
    if (this.exhausted) s *= 0.62;
    s *= clamp(0.72 + this.health / 320, 0.62, 1);
    if (this.hunger < 15) s *= 0.9;
    if (this.thirst < 12) s *= 0.86;
    if (this.warmth < 20) s *= 0.88;
    return s;
  }

  /**
   * @param {number} dt secondes réelles
   * @param {object} ctx {running, climbing, swimming, resting, temperature, carryRatio, wet, sheltered}
   */
  update(dt, ctx) {
    if (this.dead) return;
    const gameHours = (dt * TIME_SCALE) / 3600;

    // --- Besoins de base ---
    const effort = ctx.running ? 1.75 : ctx.swimming ? 1.9 : ctx.climbing ? 2.2 : ctx.moving ? 1.12 : 0.85;
    this.hunger -= SURVIVAL.hungerPerHour * gameHours * effort;
    this.thirst -= SURVIVAL.thirstPerHour * gameHours * effort;
    this.fatigue -= SURVIVAL.fatiguePerHour * gameHours * (ctx.resting ? 0.4 : 1);

    // --- Endurance ---
    let drain = 0;
    if (ctx.running) drain += SURVIVAL.staminaRun * (1 + ctx.carryRatio * 0.7);
    if (ctx.climbing) drain += SURVIVAL.staminaClimb;
    if (ctx.swimming) drain += SURVIVAL.staminaSwim * (1 + ctx.carryRatio);
    if (drain > 0) {
      this.stamina -= drain * dt;
    } else {
      const regen = SURVIVAL.staminaRegen * (ctx.moving ? 0.45 : 1) * (this.hunger > 25 ? 1 : 0.55);
      this.stamina += regen * dt;
    }
    this.stamina = clamp(this.stamina, 0, this.maxStamina);
    if (this.stamina <= 0.5) this.exhausted = true;
    if (this.exhausted && this.stamina > this.maxStamina * 0.35) this.exhausted = false;

    // --- Température ressentie ---
    const target = ctx.temperature
      - (ctx.wet ? 5.5 : 0)
      + (ctx.sheltered ? 3.5 : 0)
      + (ctx.nearFire ? 12 : 0)
      + (ctx.running ? 2.5 : 0);
    const comfort = clamp((target - 2) / 20, 0, 1) * 100;
    this.warmth += (comfort - this.warmth) * clamp(dt * 0.05, 0, 1);
    this.warmth = clamp(this.warmth, 0, 100);

    // --- Santé ---
    let delta = 0;
    if (this.hunger <= 0) delta -= 0.16;
    else if (this.hunger < 12) delta -= 0.05;
    if (this.thirst <= 0) delta -= 0.28;
    else if (this.thirst < 10) delta -= 0.09;
    if (this.fatigue <= 0) delta -= 0.05;
    if (this.warmth < 8) delta -= 0.22;
    else if (this.warmth < 20) delta -= 0.06;
    if (this.sick > 0) {
      delta -= 0.35;
      this.sick = Math.max(0, this.sick - dt * 0.9);
    }
    if (this.bleeding > 0) {
      delta -= 1.4;
      this.bleeding = Math.max(0, this.bleeding - dt * 0.6);
    }
    if (delta === 0 && this.hunger > 32 && this.thirst > 32 && this.warmth > 35) {
      delta += SURVIVAL.healthRegen * (this.fatigue > 30 ? 1 : 0.4);
    }
    this.health = clamp(this.health + delta * dt, 0, 100);

    this.hunger = clamp(this.hunger, 0, 100);
    this.thirst = clamp(this.thirst, 0, 100);
    this.fatigue = clamp(this.fatigue, 0, 100);

    this.checkWarnings();
    if (this.health <= 0 && !this.dead) {
      this.dead = true;
      bus.emit('player:died', { cause: this.deathCause() });
    }
  }

  deathCause() {
    if (this.thirst <= 0) return 'déshydratation';
    if (this.hunger <= 0) return 'inanition';
    if (this.warmth < 8) return 'hypothermie';
    if (this.bleeding > 0) return 'hémorragie';
    return 'blessures';
  }

  checkWarnings() {
    const warn = (key, cond, text) => {
      if (cond && !this._notified[key]) {
        this._notified[key] = true;
        bus.emit('notify', { text, kind: 'warn' });
      } else if (!cond) this._notified[key] = false;
    };
    warn('thirst', this.thirst < 22, 'Vous avez très soif.');
    warn('hunger', this.hunger < 20, 'La faim se fait sentir.');
    warn('fatigue', this.fatigue < 18, 'Vous tombez de fatigue.');
    warn('cold', this.warmth < 22, 'Vous grelottez.');
    warn('health', this.health < 30, 'Vous êtes en mauvais état.');
  }

  damage(amount, cause = '') {
    if (this.dead) return;
    this.health = clamp(this.health - amount, 0, 100);
    bus.emit('player:damaged', { amount, cause, health: this.health });
    if (amount > 14 && Math.random() < 0.4) this.bleeding = Math.max(this.bleeding, 6);
    if (this.health <= 0) {
      this.dead = true;
      bus.emit('player:died', { cause: cause || this.deathCause() });
    }
  }

  heal(amount) { this.health = clamp(this.health + amount, 0, 100); }

  eat(food = 0, thirst = 0, risk = 0) {
    this.hunger = clamp(this.hunger + food, 0, 100);
    this.thirst = clamp(this.thirst + thirst, 0, 100);
    if (risk > 0 && Math.random() < risk) {
      this.sick = Math.max(this.sick, 25);
      bus.emit('notify', { text: "Ça ne passe pas bien du tout…", kind: 'warn' });
    }
  }

  sleep(hours) {
    this.fatigue = clamp(this.fatigue + hours * 12.5, 0, 100);
    this.hunger = clamp(this.hunger - hours * 2.4, 0, 100);
    this.thirst = clamp(this.thirst - hours * 3.1, 0, 100);
    this.health = clamp(this.health + hours * 2.2, 0, 100);
    this.stamina = this.maxStamina;
  }

  respawn() {
    this.dead = false;
    this.health = 55;
    this.stamina = 60;
    this.hunger = Math.max(this.hunger, 35);
    this.thirst = Math.max(this.thirst, 35);
    this.fatigue = Math.max(this.fatigue, 40);
    this.warmth = 60;
    this.sick = 0;
    this.bleeding = 0;
  }

  toJSON() {
    const { health, stamina, hunger, thirst, fatigue, warmth, sick, bleeding } = this;
    return { health, stamina, hunger, thirst, fatigue, warmth, sick, bleeding };
  }

  fromJSON(d) { if (d) Object.assign(this, d, { dead: false }); }
}
