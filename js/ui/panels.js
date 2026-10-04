/**
 * panels.js — Panneaux modaux : inventaire, conteneurs, véhicule, sommeil,
 * cuisson, établi (fabrication), mort. Tous branchés sur de vrais systèmes.
 */

import { bus } from '../core/events.js';
import { input } from '../core/input.js';
import { itemDef, CATEGORY } from '../inventory/items.js';
import { VEHICLE_PARTS } from '../world/vehicles.js';
import { clamp } from '../core/noise.js';
import { loreFor } from './lore.js';
import { WORLD } from '../core/config.js';
import { settings } from '../core/settings.js';

/** Recettes de l'établi : toutes réalisables et utiles. */
export const RECIPES = [
  { id: 'storage_crate', out: 'storage_crate', label: 'Caisse de rangement', need: { wood_plank: 4, nails: 12 }, tool: 'hammer' },
  { id: 'campfire_kit', out: 'campfire_kit', label: 'Foyer de camp', need: { wood_plank: 2, scrap_metal: 1 }, tool: null },
  { id: 'bed_roll', out: 'bed_roll', label: 'Sac de couchage', need: { cloth: 6, rope: 1 }, tool: null },
  { id: 'camp_lamp', out: 'camp_lamp', label: 'Lampe de camp', need: { scrap_metal: 2, wire: 1, battery_aa: 1 }, tool: 'screwdriver' },
  { id: 'bandage', out: 'bandage', count: 2, label: 'Bandages', need: { cloth: 2 }, tool: null },
  { id: 'rope', out: 'rope', label: 'Corde', need: { cloth: 5 }, tool: null },
  { id: 'wood_plank', out: 'wood_plank', count: 2, label: 'Planches (débitage)', need: { scrap_metal: 0 }, tool: 'axe', special: 'chop' },
  { id: 'repair_tool', out: null, label: 'Remettre un outil en état', need: { duct_tape: 1, scrap_metal: 1 }, tool: null, special: 'repair' },
];

export class Panels {
  constructor(root, world, save) {
    this.root = root;
    this.world = world;
    this.save = save;
    this.open = null;
    this.selected = null;
    this.build();
    this.bind();
  }

  build() {
    this.container = document.createElement('div');
    this.container.id = 'panels-layer';
    this.root.appendChild(this.container);
    this.container.innerHTML = `
      <div class="panel-backdrop hidden" id="panel-backdrop">
        <div class="panel hidden" id="panel-inventory">
          <header><h2>Sac à dos</h2><span class="weight" id="inv-weight"></span><button class="close" data-close>✕</button></header>
          <div class="panel-body inventory-body">
            <div class="slots" id="inv-slots"></div>
            <aside class="details" id="inv-details"><p class="muted">Sélectionnez un objet.</p></aside>
          </div>
          <footer><button data-action="sort">Trier</button><span class="hint">Clic : sélectionner · Double-clic : utiliser</span></footer>
        </div>

        <div class="panel wide hidden" id="panel-container">
          <header><h2 id="cont-title">Conteneur</h2><button class="close" data-close>✕</button></header>
          <div class="panel-body split">
            <div class="side">
              <h3 id="cont-name">Contenu</h3>
              <div class="slots small" id="cont-slots"></div>
            </div>
            <div class="side">
              <h3>Sac à dos <span class="weight" id="cont-weight"></span></h3>
              <div class="slots small" id="cont-player"></div>
            </div>
          </div>
          <footer><button data-action="take-all">Tout prendre</button><span class="hint">Clic : transférer</span></footer>
        </div>

        <div class="panel hidden" id="panel-vehicle">
          <header><h2 id="veh-title">Véhicule</h2><button class="close" data-close>✕</button></header>
          <div class="panel-body"><div id="veh-diag" class="diag"></div></div>
          <footer><span class="hint" id="veh-hint"></span></footer>
        </div>

        <div class="panel small hidden" id="panel-sleep">
          <header><h2>Se reposer</h2><button class="close" data-close>✕</button></header>
          <div class="panel-body">
            <p class="muted">Combien de temps souhaitez-vous dormir ?</p>
            <input type="range" id="sleep-hours" min="1" max="12" value="7">
            <div class="big" id="sleep-label">7 h</div>
            <div id="sleep-warn" class="warn-text"></div>
          </div>
          <footer><button data-action="sleep-confirm">Dormir</button></footer>
        </div>

        <div class="panel hidden" id="panel-cook">
          <header><h2>Feu</h2><button class="close" data-close>✕</button></header>
          <div class="panel-body"><div id="cook-list" class="craft-list"></div></div>
          <footer><span class="hint">Le feu réchauffe, cuit la viande et purifie l'eau.</span></footer>
        </div>

        <div class="panel hidden" id="panel-bench">
          <header><h2>Établi</h2><button class="close" data-close>✕</button></header>
          <div class="panel-body"><div id="bench-list" class="craft-list"></div></div>
          <footer><span class="hint">Fabrication à partir des matériaux récupérés.</span></footer>
        </div>

        <div class="panel small hidden" id="panel-water">
          <header><h2>Point d'eau</h2><button class="close" data-close>✕</button></header>
          <div class="panel-body"><div id="water-list" class="craft-list"></div></div>
          <footer><span class="hint">L'eau non traitée peut rendre malade.</span></footer>
        </div>

        <div class="panel lore hidden" id="panel-lore">
          <header><h2 id="lore-title">…</h2><button class="close" data-close>✕</button></header>
          <div class="panel-body"><div id="lore-body" class="lore-body"></div></div>
          <footer><span class="hint">Certains fragments se recoupent. D'autres non.</span></footer>
        </div>

        <div class="panel small hidden" id="panel-meshy">
          <header><h2>Importer un modèle 3D — Meshy AI</h2><button class="close" data-close>✕</button></header>
          <div class="panel-body">
            <p class="hint">Générez un modèle avec votre compte <b>meshy.ai</b>, ou importez un fichier <b>.glb</b>. Le modèle apparaît devant vous et reste dans votre monde.</p>
            <label class="field"><span>Clé API Meshy (gardée dans ce navigateur uniquement)</span>
              <input type="password" id="meshy-key" placeholder="msy-…" autocomplete="off"></label>
            <label class="field"><span>Description du modèle</span>
              <input type="text" id="meshy-prompt" placeholder="ex. une vieille cabine téléphonique rouillée" autocomplete="off"></label>
            <div class="craft-list">
              <div class="craft"><div><b>Générer avec Meshy</b><span>text-to-3D · ~2 min</span></div><button id="meshy-generate">Générer</button></div>
              <div class="craft"><div><b>Importer un fichier .glb</b><span>fonctionne sans clé</span></div><button id="meshy-file-btn">Choisir…</button></div>
              <div class="craft"><div><b>Retirer le dernier modèle</b><span>supprime le prop posé</span></div><button id="meshy-remove">Retirer</button></div>
            </div>
            <input type="file" id="meshy-file" accept=".glb,model/gltf-binary" style="display:none">
            <p id="meshy-status" class="hint"></p>
          </div>
        </div>
      </div>

      <div class="death-screen hidden" id="death-screen">
        <h1>Vous avez succombé</h1>
        <p id="death-cause"></p>
        <button id="death-respawn">Reprendre</button>
      </div>
    `;
    this.backdrop = document.getElementById('panel-backdrop');
    this.panels = {
      inventory: document.getElementById('panel-inventory'),
      container: document.getElementById('panel-container'),
      vehicle: document.getElementById('panel-vehicle'),
      sleep: document.getElementById('panel-sleep'),
      cook: document.getElementById('panel-cook'),
      bench: document.getElementById('panel-bench'),
      water: document.getElementById('panel-water'),
      lore: document.getElementById('panel-lore'),
      meshy: document.getElementById('panel-meshy'),
    };
    this.death = document.getElementById('death-screen');
  }

  bind() {
    this.container.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-close]');
      if (closeBtn) { this.close(); return; }
      if (e.target === this.backdrop) this.close();
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action) this.handleAction(action, e);
    });

    document.getElementById('sleep-hours').addEventListener('input', (e) => {
      document.getElementById('sleep-label').textContent = `${e.target.value} h`;
    });
    document.getElementById('death-respawn').addEventListener('click', () => this.respawn());

    bus.on('ui:container', ({ title, inventory, id }) => this.openContainer(title, inventory));
    bus.on('ui:vehicle', ({ vehicle }) => this.openVehicle(vehicle));
    bus.on('ui:sleep', () => this.openSleep());
    bus.on('ui:cook', ({ fire, worldFire }) => this.openCook(fire, worldFire));
    bus.on('ui:workbench', () => this.openBench());
    bus.on('ui:water', (data) => this.openWater(data));
    bus.on('ui:meshy', () => this.openMeshy());
    bus.on('player:died', ({ cause }) => this.showDeath(cause));
    bus.on('inventory:changed', () => { if (this.open) this.refresh(); });

    bus.on('input:keydown', (code) => {
      if (this.world.player.stats.dead) return;
      if (code === 'Escape' && this.open) { this.close(); return; }
      if (settings.data.bindings.inventory.includes(code)) {
        if (this.open === 'inventory') this.close();
        else if (!this.open && !this.world.paused) this.openInventory();
      }
    });
  }

  // ------------------------------------------------------------- utilitaires
  show(name) {
    for (const [key, el] of Object.entries(this.panels)) el.classList.toggle('hidden', key !== name);
    this.backdrop.classList.remove('hidden');
    this.open = name;
    this.world.interaction.blocked = true;
    this.world.player.frozen = true;
    input.exitLock();
    bus.emit('ui:panel', { open: name });
  }

  close() {
    this.backdrop.classList.add('hidden');
    for (const el of Object.values(this.panels)) el.classList.add('hidden');
    this.open = null;
    this.selected = null;
    this.world.interaction.blocked = false;
    this.world.player.frozen = false;
    bus.emit('ui:panel', { open: null });
    if (!this.world.paused) input.requestLock();
  }

  slotHtml(entry, index, extra = '') {
    const def = itemDef(entry.id);
    const cond = entry.condition !== undefined
      ? `<span class="cond" style="--c:${Math.round(entry.condition * 100)}%"></span>` : '';
    return `<div class="slot ${extra}" data-index="${index}">
      <span class="ico">${def.icon || '▪'}</span>
      <span class="nm">${def.name}</span>
      ${entry.count > 1 ? `<span class="ct">×${entry.count}</span>` : ''}
      ${cond}
    </div>`;
  }

  renderSlots(el, inv, onClick, onDouble) {
    el.innerHTML = inv.items.map((it, i) => this.slotHtml(it, i)).join('')
      || '<p class="muted empty">Vide</p>';
    el.querySelectorAll('.slot').forEach((node) => {
      const i = parseInt(node.dataset.index, 10);
      node.addEventListener('click', () => onClick(i));
      if (onDouble) node.addEventListener('dblclick', () => onDouble(i));
    });
  }

  // ------------------------------------------------------------- inventaire
  openInventory() {
    this.show('inventory');
    this.refreshInventory();
  }

  refreshInventory() {
    const inv = this.world.player.inventory;
    document.getElementById('inv-weight').textContent = `${inv.weight.toFixed(1)} / ${inv.maxWeight} kg · ${inv.used}/${inv.slots} emplacements`;
    const slots = document.getElementById('inv-slots');
    this.renderSlots(slots, inv, (i) => { this.selected = i; this.refreshInventory(); }, (i) => this.useItem(i));
    if (this.selected !== null) {
      const node = slots.querySelector(`.slot[data-index="${this.selected}"]`);
      node?.classList.add('selected');
    }
    this.renderDetails();
  }

  renderDetails() {
    const el = document.getElementById('inv-details');
    const inv = this.world.player.inventory;
    const entry = this.selected !== null ? inv.items[this.selected] : null;
    if (!entry) { el.innerHTML = '<p class="muted">Sélectionnez un objet.</p>'; return; }
    const def = itemDef(entry.id);
    const actions = [];
    if (def.food !== undefined || def.thirst !== undefined) actions.push({ a: 'consume', l: def.cat === CATEGORY.DRINK ? 'Boire' : 'Manger' });
    if (def.heal) actions.push({ a: 'heal', l: 'Se soigner' });
    if (def.place) actions.push({ a: 'place', l: 'Poser' });
    if (def.reveal) actions.push({ a: 'reveal', l: 'Consulter' });
    if (def.lore) actions.push({ a: 'read', l: 'Lire' });
    if (def.fillable) actions.push({ a: 'noop', l: 'À remplir à un point d\'eau' });
    actions.push({ a: 'drop', l: 'Jeter' });

    el.innerHTML = `
      <h3>${def.icon || ''} ${def.name}</h3>
      <p class="cat">${def.cat}</p>
      <p class="desc">${def.desc || ''}</p>
      <ul class="props">
        <li>Poids <b>${(def.weight * entry.count).toFixed(2)} kg</b></li>
        ${entry.condition !== undefined ? `<li>État <b>${Math.round(entry.condition * 100)} %</b></li>` : ''}
        ${def.food ? `<li>Nourriture <b>+${def.food}</b></li>` : ''}
        ${def.thirst ? `<li>Hydratation <b>${def.thirst > 0 ? '+' : ''}${def.thirst}</b></li>` : ''}
        ${def.heal ? `<li>Soin <b>+${def.heal}</b></li>` : ''}
        ${def.damage ? `<li>Dégâts <b>${def.damage}</b></li>` : ''}
        ${def.risk ? `<li class="risk">Risque sanitaire <b>${Math.round(def.risk * 100)} %</b></li>` : ''}
      </ul>
      <div class="actions">
        ${actions.map((a) => `<button data-action="item-${a.a}">${a.l}</button>`).join('')}
      </div>`;
  }

  useItem(i) {
    this.selected = i;
    const inv = this.world.player.inventory;
    const entry = inv.items[i];
    if (!entry) return;
    const def = itemDef(entry.id);
    if (def.food !== undefined || def.thirst !== undefined) this.handleAction('item-consume');
    else if (def.heal) this.handleAction('item-heal');
    else if (def.place) this.handleAction('item-place');
    else if (def.reveal) this.handleAction('item-reveal');
    else if (def.lore) this.handleAction('item-read');
  }

  handleAction(action, e) {
    const world = this.world;
    const player = world.player;
    const inv = player.inventory;
    switch (action) {
      case 'sort': inv.sort(); this.refreshInventory(); break;
      case 'sleep-confirm': this.doSleep(); break;
      case 'take-all': {
        const src = this.currentContainer;
        if (!src) break;
        for (let i = src.items.length - 1; i >= 0; i--) src.transferTo(inv, i);
        this.refreshContainer();
        break;
      }
      case 'item-consume': {
        const entry = inv.items[this.selected];
        if (!entry) break;
        const def = itemDef(entry.id);
        player.stats.eat(def.food || 0, def.thirst || 0, def.risk || 0);
        bus.emit('audio:sfx', { name: def.cat === CATEGORY.DRINK ? 'drink' : 'eat' });
        inv.removeAt(this.selected, 1);
        if (entry.id === 'water_bottle' || entry.id === 'dirty_water') inv.add('empty_bottle', 1);
        this.selected = null;
        this.refreshInventory();
        break;
      }
      case 'item-heal': {
        const entry = inv.items[this.selected];
        if (!entry) break;
        const def = itemDef(entry.id);
        player.stats.heal(def.heal || 0);
        if (def.cure) { player.stats.sick = 0; player.stats.bleeding = 0; }
        if (def.stamina) player.stats.stamina = clamp(player.stats.stamina + def.stamina, 0, player.stats.maxStamina);
        inv.removeAt(this.selected, 1);
        bus.emit('notify', { text: `${def.name} utilisé.`, kind: 'info' });
        this.selected = null;
        this.refreshInventory();
        break;
      }
      case 'item-place': {
        const ok = world.base.placeFromInventory(this.selected);
        this.selected = null;
        this.refreshInventory();
        if (ok) this.close();
        break;
      }
      case 'item-reveal': {
        const entry = inv.items[this.selected];
        if (!entry) break;
        const def = itemDef(entry.id);
        world.revealAround(player.position.x, player.position.z, def.reveal || 300);
        inv.removeAt(this.selected, 1);
        bus.emit('notify', { text: 'Une portion de la carte se précise.', kind: 'info' });
        this.selected = null;
        this.refreshInventory();
        break;
      }
      case 'item-read': {
        const entry = inv.items[this.selected];
        if (!entry) break;
        this.openLore(entry);
        break;
      }
      case 'item-drop': {
        const entry = inv.items[this.selected];
        if (!entry) break;
        inv.removeAt(this.selected, entry.count);
        bus.emit('notify', { text: `${itemDef(entry.id).name} jeté.`, kind: 'info' });
        this.selected = null;
        this.refreshInventory();
        break;
      }
      default: break;
    }
  }

  // ------------------------------------------------------------- conteneur
  openContainer(title, inventory) {
    this.currentContainer = inventory;
    document.getElementById('cont-title').textContent = title;
    document.getElementById('cont-name').textContent = 'Contenu';
    this.show('container');
    this.refreshContainer();
  }

  refreshContainer() {
    const inv = this.world.player.inventory;
    const cont = this.currentContainer;
    document.getElementById('cont-weight').textContent = `${inv.weight.toFixed(1)} / ${inv.maxWeight} kg`;
    this.renderSlots(document.getElementById('cont-slots'), cont, (i) => {
      cont.transferTo(inv, i);
      bus.emit('audio:sfx', { name: 'pickup' });
      this.refreshContainer();
    });
    this.renderSlots(document.getElementById('cont-player'), inv, (i) => {
      inv.transferTo(cont, i);
      this.refreshContainer();
    });
  }

  // ------------------------------------------------------------- véhicule
  openVehicle(vehicle) {
    this.currentVehicle = vehicle;
    document.getElementById('veh-title').textContent = vehicle.label;
    this.show('vehicle');
    this.refreshVehicle();
  }

  refreshVehicle() {
    const v = this.currentVehicle;
    const inv = this.world.player.inventory;
    const lines = v.diagnose();
    document.getElementById('veh-diag').innerHTML = lines.map((l) => {
      const def = VEHICLE_PARTS[l.key];
      const hasItem = inv.has(def.item);
      const canRepair = !l.ok && hasItem;
      return `<div class="diag-line ${l.ok ? 'ok' : 'ko'}">
        <span class="dl-label">${l.label}${l.critical ? '' : ' <i>(confort)</i>'}</span>
        <span class="dl-status">${l.status}</span>
        ${l.ok ? '' : `<button data-part="${l.key}" ${canRepair ? '' : 'disabled'}>
          ${canRepair ? 'Réparer' : `Requiert ${itemDef(def.item).name}`}</button>`}
      </div>`;
    }).join('');
    document.getElementById('veh-hint').textContent = v.repaired
      ? 'Tous les systèmes critiques sont opérationnels : le véhicule peut démarrer.'
      : 'Trouvez les pièces manquantes dans les garages et les ateliers.';

    document.querySelectorAll('#veh-diag button[data-part]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const res = v.repair(btn.dataset.part, this.world.player.inventory);
        bus.emit('notify', { text: res.msg, kind: res.ok ? 'info' : 'warn' });
        if (res.ok) bus.emit('audio:sfx', { name: 'repair' });
        this.refreshVehicle();
      });
    });
  }

  // ------------------------------------------------------------- sommeil
  openSleep() {
    const s = this.world.player.stats;
    document.getElementById('sleep-warn').textContent =
      s.thirst < 25 || s.hunger < 25 ? 'Dormir affamé ou assoiffé est risqué.' : '';
    this.show('sleep');
  }

  doSleep() {
    const hours = parseInt(document.getElementById('sleep-hours').value, 10);
    const world = this.world;
    world.sky.advance(hours);
    world.player.stats.sleep(hours);
    bus.emit('notify', { text: `Vous avez dormi ${hours} h.`, sub: `Il est ${world.sky.timeString()}`, kind: 'info' });
    this.close();
    this.save?.save('auto');
  }

  // ------------------------------------------------------------- cuisson
  openCook(fire) {
    this.currentFire = fire;
    this.show('cook');
    this.refreshCook();
  }

  refreshCook() {
    const inv = this.world.player.inventory;
    const opts = [
      { id: 'cook_meat', label: 'Cuire de la viande', need: { raw_meat: 1 }, out: 'cooked_meat' },
      { id: 'cook_fish', label: 'Griller un poisson', need: { raw_fish: 1 }, out: 'cooked_fish' },
      { id: 'boil_water', label: "Faire bouillir de l'eau", need: { dirty_water: 1 }, out: 'water_bottle' },
      { id: 'warm', label: 'Se réchauffer un moment', need: {}, out: null },
    ];
    document.getElementById('cook-list').innerHTML = opts.map((o) => {
      const ok = Object.entries(o.need).every(([k, n]) => inv.has(k, n));
      const needTxt = Object.entries(o.need).map(([k, n]) => `${itemDef(k).name} ×${n}`).join(', ') || '—';
      return `<div class="craft ${ok ? '' : 'ko'}">
        <div><b>${o.label}</b><span>${needTxt}</span></div>
        <button data-cook="${o.id}" ${ok ? '' : 'disabled'}>Faire</button>
      </div>`;
    }).join('');
    document.querySelectorAll('[data-cook]').forEach((b) => b.addEventListener('click', () => {
      const o = opts.find((x) => x.id === b.dataset.cook);
      const inv2 = this.world.player.inventory;
      for (const [k, n] of Object.entries(o.need)) inv2.remove(k, n);
      if (o.out) inv2.add(o.out, 1);
      if (o.id === 'warm') {
        this.world.player.stats.warmth = clamp(this.world.player.stats.warmth + 30, 0, 100);
        this.world.sky.advance(0.5);
      }
      bus.emit('notify', { text: o.out ? `${itemDef(o.out).name} prêt.` : 'Vous vous réchauffez près du feu.', kind: 'info' });
      bus.emit('audio:sfx', { name: 'eat' });
      this.refreshCook();
    }));
  }

  // ------------------------------------------------------------- établi
  openBench() {
    this.show('bench');
    this.refreshBench();
  }

  refreshBench() {
    const inv = this.world.player.inventory;
    document.getElementById('bench-list').innerHTML = RECIPES.map((r) => {
      const need = Object.entries(r.need).filter(([, n]) => n > 0);
      const hasAll = need.every(([k, n]) => inv.has(k, n));
      const hasTool = !r.tool || inv.has(r.tool) || inv.has('multitool');
      const ok = hasAll && hasTool;
      const needTxt = need.map(([k, n]) => `${itemDef(k).name} ×${n}`).join(', ') || '—';
      return `<div class="craft ${ok ? '' : 'ko'}">
        <div><b>${r.label}</b><span>${needTxt}${r.tool ? ` · outil : ${itemDef(r.tool).name}` : ''}</span></div>
        <button data-craft="${r.id}" ${ok ? '' : 'disabled'}>Fabriquer</button>
      </div>`;
    }).join('');
    document.querySelectorAll('[data-craft]').forEach((b) => b.addEventListener('click', () => {
      this.craft(RECIPES.find((r) => r.id === b.dataset.craft));
    }));
  }

  craft(recipe) {
    const inv = this.world.player.inventory;
    for (const [k, n] of Object.entries(recipe.need)) if (n > 0) inv.remove(k, n);
    if (recipe.special === 'repair') {
      const worn = inv.items
        .map((it, i) => ({ it, i }))
        .filter(({ it }) => it.condition !== undefined && it.condition < 0.95)
        .sort((a, b) => a.it.condition - b.it.condition)[0];
      if (worn) {
        worn.it.condition = Math.min(1, worn.it.condition + 0.45);
        bus.emit('notify', { text: `${itemDef(worn.it.id).name} remis en état.`, kind: 'info' });
      } else {
        bus.emit('notify', { text: 'Aucun outil à réparer.', kind: 'warn' });
        inv.add('duct_tape', 1); inv.add('scrap_metal', 1);
      }
    } else if (recipe.out) {
      const added = inv.add(recipe.out, recipe.count || 1);
      bus.emit('notify', {
        text: added ? `${itemDef(recipe.out).name} fabriqué.` : 'Sac trop plein.',
        kind: added ? 'info' : 'warn',
      });
    }
    if (recipe.tool) {
      const idx = inv.items.findIndex((i) => i.id === recipe.tool || i.id === 'multitool');
      if (idx >= 0) inv.damageTool(idx, 0.05);
    }
    bus.emit('audio:sfx', { name: 'repair' });
    this.refreshBench();
  }

  // ------------------------------------------------------------- eau
  openWater(data) {
    this.waterPos = data || null;    // point visé (pour la pêche)
    this.show('water');
    this.refreshWater();
  }

  refreshWater() {
    const inv = this.world.player.inventory;
    const opts = [
      { id: 'drink', label: 'Boire directement', need: {}, risk: 0.3 },
      { id: 'fill', label: 'Remplir une bouteille', need: { empty_bottle: 1 } },
    ];
    // Pêche : canne + eau profonde au point visé
    const wp = this.waterPos;
    const depth = wp && this.world.water ? this.world.water.depthAt(wp.x, wp.z) : 0;
    if (inv.has('fishing_rod') && depth >= 0.9 && !this.world.fishing.active) {
      const density = this.world.fishShoals ? this.world.fishShoals.query(wp.x, wp.z) : 0;
      opts.push({
        id: 'fish', label: `Lancer la ligne${density > 0.12 ? ' (poissons visibles)' : ''}`,
        need: { fishing_rod: 1 }, fish: true,
      });
    }
    if (this.world.fishing.active) {
      opts.push({ id: 'reel', label: this.world.fishing.phase === 'bite' ? 'Ferrer !' : 'Relever la ligne', need: {}, reel: true });
    }
    document.getElementById('water-list').innerHTML = opts.map((o) => {
      const ok = Object.entries(o.need).every(([k, n]) => inv.has(k, n));
      const needTxt = Object.entries(o.need).map(([k, n]) => `${itemDef(k).name} ×${n}`).join(', ') || '—';
      return `<div class="craft ${ok ? '' : 'ko'}">
        <div><b>${o.label}</b><span>${needTxt}</span></div>
        <button data-water="${o.id}" ${ok ? '' : 'disabled'}>Faire</button>
      </div>`;
    }).join('');
    document.querySelectorAll('[data-water]').forEach((b) => b.addEventListener('click', () => {
      const player = this.world.player;
      if (b.dataset.water === 'fish') {
        if (this.waterPos) this.world.startFishing(this.waterPos.x, this.waterPos.z);
        this.close();
        return;
      }
      if (b.dataset.water === 'reel') {
        this.world.reelFishing();
        this.close();
        return;
      }
      if (b.dataset.water === 'drink') {
        player.stats.eat(0, 30, 0.28);
        bus.emit('audio:sfx', { name: 'drink' });
        bus.emit('notify', { text: 'Vous buvez à même le lac.', kind: 'info' });
      } else {
        inv.remove('empty_bottle', 1);
        inv.add('dirty_water', 1);
        bus.emit('notify', { text: 'Bouteille remplie (eau non traitée).', kind: 'info' });
      }
      this.refreshWater();
    }));
  }

  // ------------------------------------------------------------- meshy
  openMeshy() {
    this.show('meshy');
    const key = localStorage.getItem('solitude-horizon:meshy-key');
    if (key) document.getElementById('meshy-key').value = key;
    this.bindMeshy();
  }

  bindMeshy() {
    if (this._meshyBound) return;
    this._meshyBound = true;
    const st = (t) => { const el = document.getElementById('meshy-status'); if (el) el.textContent = t; };
    document.getElementById('meshy-file-btn').addEventListener('click', () => document.getElementById('meshy-file').click());
    document.getElementById('meshy-file').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      st('Import du fichier…');
      try {
        const buf = await f.arrayBuffer();
        await this.world.addCustomProp(`file_${Date.now()}`, buf);
        st('Modèle importé et posé devant vous ✓');
      } catch (err) {
        st(`Fichier illisible : ${String(err.message || err).slice(0, 120)}`);
      }
      e.target.value = '';
    });
    document.getElementById('meshy-remove').addEventListener('click', () => {
      const p = this.world.removeLastCustomProp();
      st(p ? 'Modèle retiré.' : 'Aucun modèle posé.');
    });
    document.getElementById('meshy-generate').addEventListener('click', () => this.meshyGenerate());
  }

  async meshyGenerate() {
    const st = (t) => { const el = document.getElementById('meshy-status'); if (el) el.textContent = t; };
    const key = document.getElementById('meshy-key').value.trim();
    const prompt = document.getElementById('meshy-prompt').value.trim();
    if (!key) return st('Entrez votre clé API Meshy (meshy.ai → API).');
    if (!prompt) return st('Décrivez le modèle à générer.');
    localStorage.setItem('solitude-horizon:meshy-key', key);
    const btn = document.getElementById('meshy-generate');
    btn.disabled = true;
    try {
      st('Envoi à Meshy…');
      const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
      let res = await fetch('https://api.meshy.ai/openapi/v1/text-to-3d', {
        method: 'POST', headers,
        body: JSON.stringify({ prompt, art_style: 'realistic', should_remesh: true }),
      });
      if (res.status === 404 || res.status === 405) {
        res = await fetch('https://api.meshy.ai/openapi/v2/text-to-3d', {
          method: 'POST', headers,
          body: JSON.stringify({ prompt, art_style: 'realistic', topology: 'quad' }),
        });
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${txt ? ' — ' + txt.slice(0, 90) : ''}`);
      }
      const data = await res.json();
      const id = data.id || data.task_id;
      if (!id) throw new Error('réponse inattendue (pas d\'identifiant de tâche)');
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const poll = await fetch(`https://api.meshy.ai/openapi/v1/text-to-3d/${id}`, { headers: { Authorization: `Bearer ${key}` } });
        const j = await poll.json().catch(() => ({}));
        const pct = Math.round((j.progress ?? 0) * 100);
        st(`Génération… ${pct} % (${j.status || 'en cours'})`);
        if (j.status === 'SUCCEEDED' || j.status === 'SUCCESS') {
          const glb = j.result?.model_urls?.glb || j.result?.glb_url || j.result?.model_url;
          if (!glb) throw new Error('terminé mais aucune URL glb trouvée');
          st('Téléchargement du modèle…');
          const buf = await (await fetch(glb)).arrayBuffer();
          await this.world.addCustomProp(`meshy_${Date.now()}`, buf);
          st('Modèle généré et posé devant vous ✓');
          return;
        }
        if (j.status === 'FAILED' || j.status === 'EXPIRED') throw new Error(j.error_message || j.status);
      }
      throw new Error('délai dépassé (6 min) — retentez');
    } catch (e) {
      const msg = String(e.message || e);
      st(`Échec : ${msg.slice(0, 130)}. Sinon : générez sur meshy.ai puis importez le .glb téléchargé.`);
    } finally {
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------- lore
  openLore(entry) {
    const frag = loreFor(entry, this.selected, WORLD.seed);
    document.getElementById('lore-title').textContent = frag.title;
    const body = document.getElementById('lore-body');
    body.innerHTML = frag.body.split('\n\n').map((p) => `<p>${p}</p>`).join('');
    this.show('lore');
    bus.emit('audio:sfx', { name: 'page' });
  }

  // ------------------------------------------------------------- mort
  showDeath(cause) {
    document.getElementById('death-cause').textContent = `Cause : ${cause}.`;
    this.death.classList.remove('hidden');
    this.world.player.frozen = true;
    input.exitLock();
  }

  respawn() {
    const world = this.world;
    world.player.stats.respawn();
    const home = world.base.homePosition;
    if (home) {
      world.player.position.copy(home).setY(world.terrain.height(home.x, home.z) + 0.2);
    } else {
      // lieu "sûr" découvert le plus proche (ville, village, hameau, ferme, refuge)
      let best = null, bestD = Infinity;
      for (const id of world.state.discovered) {
        const def = world.poi.defs.get(id);
        if (!def || !['town', 'village', 'hamlet', 'farm', 'shelter', 'cabin'].includes(def.kind)) continue;
        const d = Math.hypot(def.x - world.player.position.x, def.z - world.player.position.z);
        if (d < bestD) { bestD = d; best = def; }
      }
      if (best) {
        world.player.position.set(best.x, world.terrain.height(best.x, best.z) + 0.2, best.z);
      } else {
        const spawn = world.findSpawn();
        world.player.spawn(spawn.x, spawn.z);
      }
    }
    world.player.velocity.set(0, 0, 0);
    world.sky.advance(6);
    this.death.classList.add('hidden');
    world.player.frozen = false;
    input.requestLock();
    bus.emit('notify', { text: 'Vous reprenez connaissance.', kind: 'info' });
  }

  refresh() {
    if (this.open === 'inventory') this.refreshInventory();
    else if (this.open === 'container') this.refreshContainer();
    else if (this.open === 'vehicle') this.refreshVehicle();
    else if (this.open === 'cook') this.refreshCook();
    else if (this.open === 'bench') this.refreshBench();
    else if (this.open === 'water') this.refreshWater();
  }
}
