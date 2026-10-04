/**
 * interaction.js — Détection de la cible regardée et exécution des actions.
 * Un seul indicateur discret à l'écran : nom + action disponible.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { bus } from '../core/events.js';
import { input } from '../core/input.js';
import { WORLD } from '../core/config.js';
import { itemDef } from '../inventory/items.js';
import { hashInt, makeRng } from '../core/rng.js';

const MAX_DIST = 3.2;
const VEHICLE_DIST = 4.2;

export class InteractionSystem {
  constructor(world) {
    this.world = world;
    this.current = null;
    this.progress = 0;
    this.action = null;      // action longue en cours
    this.blocked = false;    // panneau ouvert -> pas d'interaction
  }

  get player() { return this.world.player; }

  /** Cellule de cueillette déterministe (6 m). */
  forageAt(x, z) {
    const cx = Math.round(x / 6), cz = Math.round(z / 6);
    const id = `forage_${cx}_${cz}`;
    if (this.world.state.looted[id]) return null;
    const terrain = this.world.terrain;
    const wx = cx * 6, wz = cz * 6;
    const density = terrain.treeDensity(wx, wz);
    const moist = terrain.moisture(wx, wz);
    const h = hashInt(WORLD.seed, cx, cz, 8181) / 4294967296;
    if (density < 0.25 || h > 0.16 + moist * 0.14) return null;
    const kind = h < 0.07 ? 'mushroom' : 'berries';
    return { id, kind, x: wx, z: wz, y: terrain.height(wx, wz) };
  }

  /** Cherche la meilleure cible dans le champ de vision. */
  pick(camera) {
    if (this.blocked || this.player.frozen || this.player.vehicle) return null;
    const origin = camera.position;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);

    let best = null, bestScore = -Infinity;
    const consider = (target, pos, maxDist, minDot = 0.55) => {
      const to = new THREE.Vector3().subVectors(pos, origin);
      const d = to.length();
      if (d > maxDist) return;
      to.divideScalar(Math.max(d, 0.0001));
      const dot = to.dot(dir);
      if (dot < minDot) return;
      const score = dot * 2 - d / maxDist;
      if (score > bestScore) { bestScore = score; best = { ...target, distance: d, position: pos }; }
    };

    // Lieux (portes, conteneurs, véhicules, lits, foyers)
    for (const it of this.world.poi.nearbyInteractables(this.player.position, 6)) {
      const maxDist = it.kind === 'vehicle' ? VEHICLE_DIST : MAX_DIST;
      consider(it, it.world, maxDist, it.kind === 'vehicle' ? 0.35 : 0.55);
    }

    // Objets posés par le joueur (base)
    for (const p of this.world.base.placed) {
      consider({ kind: 'placed', id: p.id, label: p.label, placed: p }, p.position, MAX_DIST);
    }

    // Carcasses
    for (const c of this.world.carcasses) {
      consider({ kind: 'carcass', id: c.id, label: c.label, carcass: c }, c.position, MAX_DIST);
    }

    // Cueillette
    const f = this.forageAt(this.player.position.x, this.player.position.z);
    if (f) {
      consider({ kind: 'forage', id: f.id, label: f.kind === 'berries' ? 'Buisson de baies' : 'Champignons', forage: f },
        new THREE.Vector3(f.x, f.y + 0.5, f.z), 4.5, 0.2);
    }

    // Point d'eau
    const ahead = origin.clone().add(dir.clone().multiplyScalar(2.0));
    if (this.world.terrain.height(ahead.x, ahead.z) < WORLD.waterLevel &&
        Math.abs(origin.y - WORLD.waterLevel) < 3.4) {
      consider({ kind: 'water', id: 'water', label: 'Point d\'eau' },
        new THREE.Vector3(ahead.x, WORLD.waterLevel, ahead.z), 4.0, 0.1);
    }

    return best;
  }

  /** Libellé de l'action pour l'UI. */
  promptFor(target) {
    if (!target) return null;
    switch (target.kind) {
      case 'door': {
        const state = this.world.state.doors[target.id];
        const open = state?.open ?? target.open;
        if (target.locked && !state?.unlocked) return { label: target.label, action: 'Verrouillée — forcer', key: 'E' };
        if (target.jammed && !state?.unforced) return { label: target.label, action: 'Coincée — pousser', key: 'E' };
        return { label: target.label, action: open ? 'Fermer' : 'Ouvrir', key: 'E' };
      }
      case 'container':
        return { label: target.label, action: this.world.state.looted[target.id] ? 'Fouiller à nouveau' : 'Fouiller', key: 'E' };
      case 'vehicle': {
        const v = target.vehicle;
        if (v.repaired) return { label: v.label, action: 'Conduire', key: 'E', sub: 'R : entretien' };
        return { label: v.label, action: 'Examiner (diagnostic)', key: 'E' };
      }
      case 'bed': return { label: 'Lit', action: 'Dormir', key: 'E' };
      case 'firepit': return { label: 'Foyer', action: this.world.base.fireLit(target.id) ? 'Se réchauffer' : 'Allumer un feu', key: 'E' };
      case 'forage': return { label: target.label, action: 'Récolter', key: 'E' };
      case 'water': {
        const f = this.world.fishing;
        if (f && f.phase === 'bite') return { label: 'Ça mord !', action: 'Ferrer', key: 'E' };
        if (f && f.active) return { label: 'Ligne à l\'eau', action: 'Relever la ligne', key: 'E' };
        const hasRod = this.player.inventory.has('fishing_rod');
        return { label: 'Eau', action: hasRod ? 'Pêcher / Boire' : 'Boire / Remplir', key: 'E' };
      }
      case 'carcass': return { label: target.label, action: 'Dépecer', key: 'E' };
      case 'window': return { label: 'Fenêtre brisée', action: 'Franchir', key: 'E' };
      case 'placed': {
        const p = target.placed;
        if (p.type === 'chest') return { label: p.label, action: 'Ouvrir', key: 'E' };
        if (p.type === 'bed') return { label: p.label, action: 'Dormir', key: 'E' };
        if (p.type === 'lamp') return { label: p.label, action: p.on ? 'Éteindre' : 'Allumer', key: 'E' };
        if (p.type === 'fire') return { label: p.label, action: p.on ? 'Cuisiner / se réchauffer' : 'Allumer', key: 'E' };
        if (p.type === 'bench') return { label: p.label, action: 'Utiliser l\'établi', key: 'E' };
        return { label: p.label, action: 'Utiliser', key: 'E' };
      }
      default: return null;
    }
  }

  update(dt, camera) {
    this.current = this.pick(camera);
    const prompt = this.promptFor(this.current);
    bus.emit('interaction:prompt', prompt);

    if (input.wasPressed('interact') && this.current) {
      this.execute(this.current);
    }
  }

  execute(target) {
    const world = this.world;
    const player = this.player;
    switch (target.kind) {
      case 'door': return this.useDoor(target);
      case 'container': return world.openContainer(target);
      case 'vehicle': return world.useVehicle(target.vehicle);
      case 'bed': return bus.emit('ui:sleep', { position: target.world });
      case 'firepit': return world.base.toggleWorldFire(target, player);
      case 'forage': return this.forage(target.forage);
      case 'water': {
        const f = this.world.fishing;
        if (f && f.active) { this.world.reelFishing(); return; }
        bus.emit('ui:water', { x: target.position.x, z: target.position.z });
        return;
      }
      case 'carcass': return world.butcher(target.carcass);
      case 'window': return this.climbThroughWindow(target);
      case 'placed': return world.base.usePlaced(target.placed);
      default: break;
    }
  }

  /** Entrer/sortir par une fenêtre brisée : coûte un peu d'endurance. */
  climbThroughWindow(target) {
    const player = this.player;
    if (player.stats.stamina < 10) {
      bus.emit('notify', { text: 'Trop épuisé pour grimper.', kind: 'warn' });
      return;
    }
    // dehors -> dedans, ou l'inverse selon la position actuelle
    const inside = target.worldInside;
    const outside = target.worldOutside;
    const toInside = this.player.position.distanceTo(outside) < this.player.position.distanceTo(inside);
    const dest = toInside ? inside : outside;
    player.stats.stamina -= 10;
    player.position.set(dest.x, dest.y + 0.1, dest.z);
    player.velocity.set(0, 0, 0);
    bus.emit('audio:sfx', { name: 'jump', surface: 'wood' });
    bus.emit('notify', { text: toInside ? 'Vous vous glissez à l\'intérieur.' : 'Vous ressortez par la fenêtre.', kind: 'info' });
  }

  useDoor(target) {
    const state = this.world.state.doors[target.id] || (this.world.state.doors[target.id] = { open: false });
    if (target.locked && !state.unlocked) {
      const inv = this.player.inventory;
      if (inv.has('keys')) {
        inv.remove('keys', 1);
        state.unlocked = true;
        bus.emit('notify', { text: 'La clé fonctionne. La porte s\'ouvre.', kind: 'info' });
        bus.emit('audio:sfx', { name: 'open' });
      } else {
        // Forcer : nécessite un outil et de l'endurance
        const toolIdx = this.player.inventory.items.findIndex((i) => ['hammer', 'axe', 'wrench', 'multitool'].includes(i.id));
        if (toolIdx < 0) {
          bus.emit('notify', { text: 'Verrouillée. Il faudrait un outil pour forcer.', kind: 'warn' });
          bus.emit('audio:sfx', { name: 'locked' });
          return;
        }
        if (this.player.stats.stamina < 18) {
          bus.emit('notify', { text: 'Trop épuisé pour forcer la porte.', kind: 'warn' });
          return;
        }
        this.player.stats.stamina -= 18;
        this.player.inventory.damageTool(toolIdx, 0.12);
        state.unlocked = true;
        bus.emit('notify', { text: 'La serrure cède.', kind: 'info' });
        bus.emit('audio:sfx', { name: 'repair' });
      }
    }
    // Porte coincée : il faut pousser deux fois
    if (target.jammed && !state.unforced) {
      if (this.player.stats.stamina < 8) {
        bus.emit('notify', { text: 'Trop épuisé pour forcer la porte.', kind: 'warn' });
        return;
      }
      state.pushes = (state.pushes || 0) + 1;
      this.player.stats.stamina -= 8;
      if (state.pushes < 2) {
        bus.emit('notify', { text: 'La porte résiste… poussez encore.', kind: 'info' });
        bus.emit('audio:sfx', { name: 'locked' });
        return;
      }
      state.unforced = true;
      bus.emit('notify', { text: 'La porte cède avec un craquement.', kind: 'info' });
    }
    state.open = !state.open;
    this.world.applyDoorState(target, state.open);
    bus.emit('audio:sfx', { name: 'open' });
  }

  forage(f) {
    const rng = makeRng(hashInt(WORLD.seed, Math.round(f.x), Math.round(f.z), 3131));
    const count = rng.int(1, f.kind === 'berries' ? 4 : 3);
    const added = this.player.inventory.add(f.kind, count);
    this.world.state.looted[f.id] = true;
    if (added > 0) {
      bus.emit('notify', { text: `+${added} ${itemDef(f.kind).name}`, kind: 'loot' });
      bus.emit('audio:sfx', { name: 'pickup' });
    } else {
      bus.emit('notify', { text: 'Sac plein.', kind: 'warn' });
    }
  }
}
