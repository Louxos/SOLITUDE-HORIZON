/**
 * world.js — Chef d'orchestre : relie terrain, chunks, eau, lieux, faune,
 * ciel, météo, joueur, interactions, refuge et état persistant.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { WORLD } from '../core/config.js';
import { bus } from '../core/events.js';
import { input } from '../core/input.js';
import { settings } from '../core/settings.js';
import { makeRng, hashString } from '../core/rng.js';
import { Terrain, findSpawnPoint } from './terrain.js';
import { ChunkManager } from './chunks.js';
import { VegetationFactory, GrassField } from './vegetation.js';
import { Water } from './water.js';
import { FishShoals, FishingGame } from './fish.js';
import { AmbienceFX } from '../environment/ambience.js';
import { CustomProps } from './custom-props.js';
import { PoiManager } from './poi.js';
import { Sky } from '../environment/sky.js';
import { Weather } from '../environment/weather.js';
import { AnimalManager } from '../animals/animals.js';
import { Player } from '../player/player.js';
import { InteractionSystem } from '../interaction/interaction.js';
import { BaseSystem } from '../base/base.js';
import { Inventory } from '../inventory/inventory.js';
import { rollLoot, itemDef } from '../inventory/items.js';
import { audio } from '../audio/audio.js';
import { box, colorize } from '../core/geometry.js';
import { clamp } from '../core/noise.js';

export class World {
  constructor(engine) {
    this.engine = engine;
    this.scene = engine.scene;
    this.camera = engine.camera;

    this.terrain = new Terrain(WORLD.seed);
    this.vegFactory = new VegetationFactory();
    this.chunks = new ChunkManager(this.scene, this.terrain, this.vegFactory);
    this.grass = new GrassField(this.scene, this.terrain, this.vegFactory);
    this.water = new Water(this.scene, this.terrain);
    this.fishShoals = new FishShoals(this.scene, this.terrain, this.water);
    this.fishing = new FishingGame(makeRng(WORLD.seed ^ 0x91a7));
    this.ambience = new AmbienceFX(this.scene, this.terrain, this.water);
    this.customProps = new CustomProps(this.scene);
    this.sky = new Sky(this.scene, engine);
    this.weather = new Weather(this.scene, this.terrain, WORLD.seed + 17);
    this.animals = new AnimalManager(this.scene, this.terrain, WORLD.seed);
    this.player = new Player(this.camera, this.terrain);
    // La caméra doit appartenir au graphe de scène : la lampe torche y est attachée.
    this.scene.add(this.camera);

    this.state = {
      doors: {},
      containers: {},
      looted: {},
      vehicles: {},
      discovered: [],
      explored: {},      // cellules de 64 m visitées (brouillard de carte)
      startTime: Date.now(),
      playTime: 0,
    };

    // le point d'apparition doit être connu AVANT la planification des bourgs
    // (poi.js y accroche une ville de départ) et calculé avant tout aplanissement
    this.spawnPoint = findSpawnPoint(this.terrain);
    this.poi = new PoiManager(this.scene, this.terrain, this);
    this.base = new BaseSystem(this.scene, this);
    this.interaction = new InteractionSystem(this);

    this.carcasses = [];
    this.activeColliders = [];
    this.activeSupports = [];
    this.treeColliders = [];
    this.paused = false;
    this.alwaysUpdate = false;

    this.setupEvents();
  }

  setupEvents() {
    bus.on('poi:discovered', (def) => {
      if (!this.state.discovered.includes(def.id)) this.state.discovered.push(def.id);
      bus.emit('notify', { text: 'Nouvel endroit découvert', sub: def.name, kind: 'discover' });
      bus.emit('audio:sfx', { name: 'discover' });
    });
    bus.on('poi:loaded', (inst) => {
      // Rétablit l'état des portes déjà ouvertes
      for (const it of inst.interactables) {
        if (it.kind === 'door') {
          const st = this.state.doors[it.id];
          if (st) this.applyDoorState(it, st.open);
        }
      }
    });
    bus.on('weather:lightning', () => { /* son géré par l'audio */ });
    bus.on('player:died', () => {
      if (this.player.vehicle) this.player.exitVehicle();
    });
  }

  /** Point de départ : une clairière proche d'une route, jamais dans l'eau. */
  findSpawn() {
    if (!this.spawnPoint) this.spawnPoint = findSpawnPoint(this.terrain);
    return this.spawnPoint;
  }

  start(saveData) {
    if (saveData) {
      this.load(saveData);
    } else {
      const spawn = this.findSpawn();
      this.player.spawn(spawn.x, spawn.z);
      // Équipement de départ minimal (le joueur commence avec presque rien)
      this.player.inventory.add('empty_bottle', 1);
      this.player.inventory.add('dry_biscuits', 1);
      this.player.inventory.add('cloth', 2);
      this.player.inventory.add('flashlight', 1, 0.6);
      this.player.inventory.add('battery_aa', 2);
      this.sky.setTime(7.6, 1);
    }
    this.grass.refresh(this.player.position.x, this.player.position.z);
  }

  // ---------------------------------------------------------------- conteneurs
  containerInventory(target) {
    let inv = this.containersCache?.get(target.id);
    if (inv) return inv;
    if (!this.containersCache) this.containersCache = new Map();

    inv = new Inventory({ slots: 12, maxWeight: 120, name: target.label, id: target.id });
    const saved = this.state.containers[target.id];
    if (saved) {
      inv.fromJSON(saved);
    } else {
      const rng = makeRng(hashString(target.id) ^ WORLD.seed);
      const loot = rollLoot(rng, target.lootTable || 'shed', target.rolls || 3, 0.85);
      for (const entry of loot) inv.addEntry(entry);
      this.state.containers[target.id] = inv.toJSON();
    }
    this.containersCache.set(target.id, inv);
    return inv;
  }

  openContainer(target) {
    const inv = this.containerInventory(target);
    this.state.looted[target.id] = true;
    bus.emit('audio:sfx', { name: 'search' });
    bus.emit('ui:container', { title: target.label, inventory: inv, id: target.id });
  }

  syncContainers() {
    if (!this.containersCache) return;
    // Les coffres de la base sont sérialisés par BaseSystem lui-même.
    for (const [id, inv] of this.containersCache) this.state.containers[id] = inv.toJSON();
  }

  // ---------------------------------------------------------------- portes
  applyDoorState(target, open) {
    if (target.object) {
      if (target.slide) {
        // porte de garage : coulisse vers le haut
        target.object.position.y = open ? target.doorHeight * 0.92 : 0;
      } else {
        // porte battante : s'ouvre vers l'extérieur du bâtiment
        target.object.rotation.y = open ? (target.swing || -1) * -Math.PI * 0.62 : 0;
      }
    }
    target.open = open;
    for (const inst of this.poi.loaded.values()) {
      for (const c of inst.colliders) {
        if (c.door === target.id) c.disabled = open;
      }
    }
  }

  // ---------------------------------------------------------------- véhicules
  // ---------------------------------------------------------------- pêche
  /** Lance la ligne au point visé (profondeur > ~1 m requise). */
  startFishing(x, z) {
    if (this.fishing.active) return;
    if (!this.player.inventory.has('fishing_rod')) {
      bus.emit('notify', { text: 'Il vous faut une canne à pêche.', kind: 'warn' });
      return;
    }
    if (this.player.stats.stamina < 8) {
      bus.emit('notify', { text: 'Trop épuisé pour lancer la ligne.', kind: 'warn' });
      return;
    }
    const depth = this.water.depthAt(x, z);
    if (depth < 0.9) {
      bus.emit('notify', { text: "L'eau est trop peu profonde ici.", kind: 'warn' });
      return;
    }
    this.player.stats.stamina -= 6;
    const density = this.fishShoals.query(x, z);
    this.fishingPoint = { x, z };
    this.fishing.cast(density);
    this.fishShoals.ripple(x, z, 0.5);
    bus.emit('notify', { text: 'Ligne lancée. Vous attendez…', kind: 'muted' });
    bus.emit('audio:sfx', { name: 'splash' });
  }

  /** Ferre la ligne (ou la relève). */
  reelFishing() {
    if (!this.fishing.active) return;
    const res = this.fishing.reel();
    if (res === 'caught') {
      this.player.inventory.add('raw_fish', 1);
      bus.emit('notify', { text: 'Poisson attrapé !', kind: 'good' });
      bus.emit('audio:sfx', { name: 'splash' });
    } else if (res === 'missed') {
      bus.emit('notify', { text: 'Il s\'est décroché…', kind: 'warn' });
    } else if (res === 'early') {
      bus.emit('notify', { text: 'Vous relevez la ligne.', kind: 'muted' });
    }
  }

  /** Pose un modèle importé (Meshy AI / .glb) devant le joueur et le persiste. */
  async addCustomProp(name, buffer) {
    const player = this.player;
    const dir = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const pos = player.position.clone().add(dir.multiplyScalar(2.6));
    pos.y = this.terrain.height(pos.x, pos.z);
    const prop = await this.customProps.spawn(name, buffer, pos, player.yaw + Math.PI, 1);
    await this.customProps.saveModel(name, buffer);
    this.state.customProps = this.state.customProps || [];
    this.state.customProps.push({ name, x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2), yaw: player.yaw + Math.PI, scale: 1 });
    bus.emit('notify', { text: 'Modèle posé devant vous.', kind: 'good' });
    return prop;
  }

  removeLastCustomProp() {
    const p = this.customProps.removeLast();
    if (p && Array.isArray(this.state.customProps)) this.state.customProps.pop();
    return p;
  }

  useVehicle(vehicle) {
    if (this.player.vehicle) return;
    if (!vehicle.repaired) {
      bus.emit('ui:vehicle', { vehicle });
      return;
    }
    this.player.enterVehicle(vehicle);
    const res = vehicle.startEngine();
    bus.emit('notify', { text: res.msg, kind: res.ok ? 'info' : 'warn' });
    if (res.ok) bus.emit('audio:sfx', { name: 'engine_start' });
  }

  // ---------------------------------------------------------------- chasse
  spawnCarcass(animal) {
    const mesh = new THREE.Mesh(
      colorize(box(0.7, 0.35, 1.2, [0, 0.18, 0]), 0x6b5a48),
      new THREE.MeshStandardMaterial({ color: animal.spec.color, roughness: 0.95, vertexColors: true }),
    );
    mesh.position.copy(animal.position);
    mesh.rotation.y = animal.yaw;
    mesh.castShadow = settings.preset.shadows;
    this.scene.add(mesh);
    const carcass = {
      id: `carcass_${Date.now()}_${this.carcasses.length}`,
      label: `Carcasse de ${animal.spec.label.toLowerCase()}`,
      position: animal.position.clone().setY(animal.position.y + 0.3),
      meat: animal.spec.meat, mesh, age: 0,
    };
    this.carcasses.push(carcass);
  }

  butcher(carcass) {
    const inv = this.player.inventory;
    const added = inv.add('raw_meat', carcass.meat);
    if (added > 0) {
      bus.emit('notify', { text: `+${added} ${itemDef('raw_meat').name}`, kind: 'loot' });
      bus.emit('audio:sfx', { name: 'pickup' });
    } else {
      bus.emit('notify', { text: 'Sac plein.', kind: 'warn' });
      return;
    }
    carcass.meat -= added;
    if (carcass.meat <= 0) {
      this.scene.remove(carcass.mesh);
      carcass.mesh.geometry.dispose();
      this.carcasses.splice(this.carcasses.indexOf(carcass), 1);
    }
  }

  meleeAttack() {
    const player = this.player;
    if (player.stats.stamina < 8 || player.vehicle) return;
    const weapon = player.inventory.items.find((i) => itemDef(i.id).damage);
    const damage = weapon ? itemDef(weapon.id).damage : 6;
    player.stats.stamina -= 8;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    bus.emit('audio:sfx', { name: 'jump' });
    const hit = this.animals.hitScan(this.camera.position, dir, 2.6, damage);
    if (hit) {
      bus.emit('audio:sfx', { name: 'hurt' });
      if (hit.killed) {
        this.spawnCarcass(hit.animal);
        bus.emit('notify', { text: `${hit.animal.spec.label} abattu.`, kind: 'info' });
      }
      if (weapon) {
        const idx = player.inventory.items.indexOf(weapon);
        if (idx >= 0) player.inventory.damageTool(idx, 0.04);
      }
    }
  }

  // ---------------------------------------------------------------- exploration
  markExplored(x, z) {
    const cx = Math.floor(x / 64), cz = Math.floor(z / 64);
    const key = `${cx},${cz}`;
    if (!this.state.explored[key]) {
      this.state.explored[key] = 1;
      bus.emit('map:explored', { cx, cz });
    }
  }

  revealAround(x, z, radius) {
    const cells = Math.ceil(radius / 64);
    const cx0 = Math.floor(x / 64), cz0 = Math.floor(z / 64);
    for (let j = -cells; j <= cells; j++) {
      for (let i = -cells; i <= cells; i++) {
        this.state.explored[`${cx0 + i},${cz0 + j}`] = 1;
      }
    }
    bus.emit('map:explored', {});
  }

  /** Le joueur est-il abrité (sous un toit) ? */
  computeSheltered() {
    const p = this.player.position;
    for (const inst of this.poi.loaded.values()) {
      for (const b of inst.buildings) {
        const m = b.meta;
        const dx = p.x - m.center.x, dz = p.z - m.center.z;
        const c = Math.cos(-m.yaw), s = Math.sin(-m.yaw);
        const lx = dx * c + dz * s, lz = -dx * s + dz * c;
        if (Math.abs(lx) < m.W / 2 && Math.abs(lz) < m.D / 2 && p.y > m.center.y - 1.5 && p.y < m.center.y + m.floors * 3.2) {
          return true;
        }
      }
    }
    return false;
  }

  update(dt) {
    const player = this.player;
    const pos = player.position;

    // Monde
    this.chunks.update(dt, pos);
    this.poi.update(dt, pos);
    const physics = this.poi.collectPhysics(pos);
    this.activeColliders = physics.colliders.concat(this.base.colliders);
    this.activeSupports = physics.supports;
    this.treeColliders = this.chunks.nearbyColliders(pos.x, pos.z, []).concat(this.customProps.colliders);

    // Environnement
    this.weather.update(dt, this.camera, this.sky.hour);
    this.sky.update(dt, this.camera, this.weather);
    this.chunks.setWetness(this.weather.wetness);
    this.water.update(dt, this.camera, this.weather.rainIntensity, this.sky.sunDir, this.sky.uniforms.uSunColor.value, this.sky.daylight);
    this.vegFactory.updateWind(this.engine.elapsed, this.weather.windStrength);

    // Poissons & pêche
    this.fishShoals.update(dt, pos, this.engine.elapsed);
    const wasBiting = this.fishing.phase === 'bite';
    const fishEvent = this.fishing.update(dt);
    if (this.fishing.phase === 'bite' && !wasBiting) {
      bus.emit('notify', { text: 'Ça mord !', kind: 'good' });
      bus.emit('audio:sfx', { name: 'splash' });
      const fp = this.fishingPoint || pos;
      this.fishShoals.ripple(fp.x, fp.z, 1);
    }
    if (fishEvent === 'nothing') bus.emit('notify', { text: 'Rien ne mord…', kind: 'muted' });
    else if (fishEvent === 'late') bus.emit('notify', { text: 'Trop tard — le poisson est reparti.', kind: 'warn' });

    // Brume du matin sur les lacs, poussière dans les bâtiments
    this.ambience.update(dt, this.camera, this.sky.hour, this.weather.rainIntensity, player.sheltered, this.sky.daylight);
    this.base.update(dt);

    // Joueur
    player.sheltered = this.computeSheltered();
    player.nearFire = this.base.nearFire(pos);
    player.update(dt, {
      colliders: this.activeColliders,
      supports: this.activeSupports,
      treeColliders: this.treeColliders,
      weather: this.weather,
      sky: this.sky,
    });

    // Faune
    this.animals.update(dt, pos, this.sky.daylight, player);

    // Herbe + carte
    this.grass.update(pos);
    this.markExplored(pos.x, pos.z);
    this.state.playTime += dt;

    // Interactions
    this.interaction.update(dt, this.camera);
    if (input.mouse.left && !player.frozen && !this.interaction.blocked) {
      this._attackCooldown = (this._attackCooldown || 0) - dt;
      if (this._attackCooldown <= 0) {
        this._attackCooldown = 0.7;
        this.meleeAttack();
      }
    }
    if (input.wasPressed('repair') && !player.frozen) {
      const t = this.interaction.current;
      if (t?.kind === 'vehicle') bus.emit('ui:vehicle', { vehicle: t.vehicle });
      else if (player.vehicle) bus.emit('ui:vehicle', { vehicle: player.vehicle });
    }
    // Sortie de véhicule
    if (player.vehicle && input.wasPressed('interact')) {
      player.exitVehicle();
    }

    // Carcasses : disparaissent lentement
    for (let i = this.carcasses.length - 1; i >= 0; i--) {
      const c = this.carcasses[i];
      c.age += dt;
      if (c.age > 600) {
        this.scene.remove(c.mesh);
        this.carcasses.splice(i, 1);
      }
    }

    // Audio ambiant
    const forest = clamp(this.terrain.treeDensity(pos.x, pos.z), 0, 1);
    audio.update(dt, {
      wind: this.weather.windStrength,
      rain: this.weather.rainIntensity * (player.sheltered ? 0.35 : 1),
      daylight: this.sky.daylight,
      forest,
      interior: player.sheltered ? 1 : 0,
      underwater: player.underwater,
      engineRpm: player.vehicle?.engineRunning ? clamp(Math.abs(player.vehicle.speed) / 22, 0.08, 1) : null,
    });
    if (!player.vehicle) audio.setEngine(false);

    // Brouillard sous-marin
    if (player.underwater) {
      this.scene.fog.color.setHex(0x16323a);
      this.scene.fog.density = 0.09;
    }
  }

  // ---------------------------------------------------------------- sauvegarde
  toJSON() {
    this.syncContainers();
    return {
      version: 1,
      seed: WORLD.seed,
      player: this.player.toJSON(),
      sky: this.sky.toJSON(),
      weather: this.weather.toJSON(),
      base: this.base.toJSON(),
      state: {
        ...this.state,
        vehicles: Object.fromEntries([...this.poi.vehicles].map(([id, v]) => [id, v.toJSON()])),
      },
    };
  }

  load(data) {
    if (!data) return;
    this.player.fromJSON(data.player);
    this.sky.fromJSON(data.sky);
    this.weather.fromJSON(data.weather);
    Object.assign(this.state, data.state || {});
    this.base.fromJSON(data.base);
    for (const id of this.state.discovered || []) this.poi.discovered.add(id);
    this.containersCache = new Map();
    // Sécurité : si le relief a évolué (aplanissement des dalles), on ne
    // laisse jamais le joueur sous le sol.
    const p = this.player.position;
    p.y = Math.max(p.y, this.terrain.height(p.x, p.z) + 0.05);

    // Modèles importés (Meshy AI / .glb) : replacés à leur position
    this.customProps.restore(this.state.customProps).catch(() => {});
  }
}
