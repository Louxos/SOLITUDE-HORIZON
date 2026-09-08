# SOLITUDE HORIZON

Jeu d'exploration et de survie à la première personne, **entièrement jouable dans un navigateur**,
sans serveur de jeu, sans build, sans dépendance à installer. Monde ouvert de 5 × 5 km généré
procéduralement à partir d'une graine fixe (`WORLD_SEED = 847291`) : le même monde pour tout le
monde, à chaque partie, sans jamais stocker la carte.

> Pas de PNJ, pas de quêtes, pas d'histoire imposée. Des routes qui ne mènent nulle part, des
> maisons vides, une voiture rouillée dans un garage — et le silence.

---

## 1. Lancer le jeu

Le jeu a besoin d'un serveur HTTP local (les modules ES et le service worker ne fonctionnent pas
depuis `file://`). Depuis la racine du dépôt :

```bash
python3 -m http.server 3000
# puis ouvrir http://localhost:3000
```

Autres options équivalentes :

```bash
npx serve .          # Node
php -S localhost:3000
```

**Navigateurs supportés :** Chrome / Edge / Firefox / Safari récents avec WebGL 2.
Cliquer sur la fenêtre pour capturer la souris (pointer lock). `Échap` la libère.

### Hors ligne

Au premier chargement, un *service worker* (`sw.js`) met en cache la totalité du jeu
(HTML, CSS, 34 modules JS, Three.js). Les visites suivantes fonctionnent **sans connexion**.
Le jeu est aussi installable comme application (PWA) via `manifest.webmanifest`.
Toutes les textures, géométries, sons et le monde sont générés à l'exécution : aucun asset binaire.

---

## 2. Contrôles

| Touche | Action |
| --- | --- |
| `Z Q S D` / `W A S D` / flèches | Se déplacer |
| `Maj` | Courir (consomme l'endurance) |
| `Ctrl` / `C` | S'accroupir |
| `Espace` | Sauter / nager vers la surface |
| Souris | Regarder · clic gauche : utiliser / frapper |
| `E` | Interagir (portes, conteneurs, véhicules, feux, lits, eau) |
| `R` | Diagnostic / réparation du véhicule visé |
| `F` | Lampe torche |
| `I` / `Tab` | Inventaire · `M` : carte · `Échap` : menu |
| `G` | Jeter l'objet sélectionné |
| `F3` | Mode debug (FPS, position, chunks, biome, appels de rendu) |

Toutes les touches sont **remappables** dans `Menu → Contrôles` (persistées en LocalStorage).

---

## 3. Ce qu'il y a dans le monde

**Terrain.** Bruit fractal multi-octaves (relief mesuré : −32 m à +598 m), crêtes, vallées, plaines,
falaises, érosion, plages. **10 biomes** mélangés en continu : prairie, forêt de feuillus,
forêt de conifères, alpin, roche, marais, lande, friche agricole, rivage, éboulis.

**Routes.** 11 axes (asphalte fissuré et chemins de terre) tracés par A\*-like sur le coût de pente,
lissés jusqu'à 17 % de déclivité maximum, avec bas-côtés, gravats et végétation qui reconquiert
le bitume.

**Streaming.** Chunks de 256 m avec 4 niveaux de LOD (4 485 → 117 sommets), chargés/déchargés en
fonction de la position ; 225 chunks résidents. Végétation en `InstancedMesh` (arbres, buissons,
rochers) avec vent dans le vertex shader, et jusqu'à **14 000 brins d'herbe** animés autour du
joueur. Forêts plus denses, sous-bois envahis : la nature reconquiert tout.

**Villes et villages.** Trois **villes abandonnées** et quatre villages s'égrennent le long des
routes, dont une ville à ~500 m du point d'apparition : une place centrale aplatie (le terrain est localement re-nivelé sous chaque
bâtiment — les seuils de porte affleurent le sol), un anneau de bâtiments tournés vers la place,
puits ou fontaine, lampadaires, bancs, panneaux de direction, épaves garées. On y trouve
église à clocher, commerces en brique, station-service, ateliers. Chaque lieu a un **nom unique**,
révélé par une notification à l'approche et tracé sur la carte. Les villes et villages sont
**toujours indiqués sur la carte** (`M`) — comme sur une vraie carte papier, plus nets une fois
discovered — et restent directionnels sur la minimap.

**Lieux.** ~109 points d'intérêt persistants : villes, villages, hameaux, fermes, cabanes,
garages, sites industriels, abris de chasse, campements, grottes, points de vue, belvédères,
épaves. **Douze types de bâtiments** générés procéduralement, **tous pénétrables** : portes qui
s'ouvrent (certaines verrouillées ou coincées — deux poussées à l'épaule viennent à bout des
secondes), portes de service, **fenêtres brisées franchissables au rez-de-chaussée**, étages,
escaliers, meubles, toitures effondrées selon un état de dégradation, mousse, lierre et plinthes
de soubassement. Les boîtes à gants des épaves se fouillent.

**Eau.** Lacs et rivières : on patauge, puis on nage au-delà de 1,25 m ; l'endurance descend,
la température corporelle aussi.

**Faune.** Cerfs, sangliers, renards, lapins, oiseaux, poissons, loups rares. États AI
(broute / vigilant / fuite / approche), détection par distance et vent, danger évitable.

**Ciel & météo.** Cycle jour/nuit complet (`TIME_SCALE = 60`, un jour ≈ 24 min) avec ciel en
shader (Rayleigh/Mie), lune, étoiles, **nuits réellement sombres**. Météo enchaînée par chaînes de
Markov : dégagé, voilé, nuageux, bruine, pluie, orage (éclairs + tonnerre retardé par la distance),
brouillard, vent — avec inertie, humidité et températures cohérentes.

**Audio.** 100 % procédural (WebAudio) : pas, dont le timbre change selon la surface (herbe, terre,
gravier, bois, roche, eau), ambiances de biome, oiseaux à l'aube, pluie filtrée, tonnerre,
moteur à régime variable, nappes musicales rares. Le silence est un parti pris.

---

## 4. Les systèmes, et comment ils s'imbriquent

Tout est relié : **fouiller → poids → réparer → conduire → sauvegarder**.

- **Survie** : santé, endurance, faim, soif, fatigue, température corporelle (mouillé + vent =
  hypothermie). Dégradation lente et lisible ; la privation totale tue en ~3,5 min réelles, jamais
  par surprise.
- **Inventaire** : 24 emplacements, **38 kg** de charge — au-delà, on ralentit. 51 objets répartis
  en nourriture, boisson, soin, outil, pièce mécanique, ressource, mobilier, carburant.
- **Butin crédible** : rien n'apparaît par magie. Le contenu est tiré paresseusement (déterministe,
  fonction du lieu et de la graine) **dans** les placards, tiroirs, boîtes à outils, coffres de
  voiture, casiers d'atelier — une seule ville abrite près de 80 conteneurs, ~2 à 3 objets chacun.
  Tables de butin dédiées : cuisine, chambre, salle de bain, garage, atelier, appentis, commerce,
  station-service, chapelle, véhicule, grotte.
- **Réparation** : chaque véhicule a batterie, bougies, courroie, alternateur, durite, pneus,
  freins, plein de carburant. `R` lance un **diagnostic** qui liste ce qui manque ; chaque pièce
  demande l'objet **et** l'outil adapté (clé, cric, tournevis) et plusieurs étapes. Quand les
  pièces critiques sont saines et qu'il reste du carburant, la voiture démarre et se conduit
  (accélération, freinage, adhérence, phares, consommation).
- **Base** : n'importe quel bâtiment devient un camp. Caisses de rangement, lit (dormir jusqu'à
  l'aube), feu de camp (cuisiner, se réchauffer, faire bouillir l'eau), lanternes, établi.
  Chaque objet posé est persisté avec son contenu.
- **Découvertes** : approcher un lieu le révèle sur la carte et affiche une notification discrète
  (160 m pour une ville, 100 m pour un village, 55–85 m pour le reste) ; la carte (`M`) se remplit
  par cellules de 64 m au fil de l'exploration. En cas de mort, le réapparition propose le refuge,
  sinon **le lieu sûr découvert le plus proche**.

---

## 5. Sauvegarde

Sauvegarde complète en **LocalStorage + IndexedDB**, autosauvegarde toutes les 120 s et à chaque
sortie. Le monde n'est jamais stocké (il est déterministe) : seuls le joueur, l'heure, la météo,
les conteneurs fouillés, les portes ouvertes, l'état de chaque véhicule, la base et la carte
explorée le sont — soit ~5 ko. Après rechargement, la partie reprend exactement où elle s'était
arrêtée. Export/import du fichier de sauvegarde depuis le menu.

---

## 6. Performance

Cible : **1080p / 60 FPS sur PC milieu de gamme**.

- Trois préréglages **Bas / Moyen / Élevé** + **qualité automatique** (ajuste la distance de vue,
  la densité de végétation, les ombres et la résolution interne en fonction du FPS mesuré).
- Frustum culling, LOD, instanciation, géométries fusionnées, matériaux partagés, textures
  générées une seule fois et mises en cache, streaming étalé sur plusieurs frames, aucune
  allocation dans la boucle chaude.
- Boucle logique mesurée à ~1,3 ms par frame hors rendu (784 mises à jour/s en Node).
- `F3` affiche FPS, frame time, chunks chargés/en attente, appels de rendu, triangles.

---

## 7. Architecture

Aucun fichier monolithique : 34 modules ES, ~9 200 lignes, zéro dépendance npm
(Three.js r180 est *vendored* dans `vendor/`).

```
index.html · manifest.webmanifest · sw.js
css/         main.css · ui.css
vendor/three/ three.module.min.js (r180, MIT)
js/
  main.js            amorçage, écran de chargement, boucle, service worker
  core/              config, rng, noise, events (bus), input, settings, engine, textures (22 gabarits procéduraux, dont brique), geometry
  world/             terrain, roads, chunks, vegetation, water, buildings, vehicles, poi, world
  environment/       sky (shader), weather
  player/            player (déplacement, collisions, nage, escalade, head bob)
  survival/          stats
  inventory/         items (base de données), inventory
  animals/           animals
  interaction/       interaction (raycast + prompts contextuels)
  base/              base (construction, coffres, lit, feu)
  save/              save (LocalStorage + IndexedDB, autosave, export/import)
  ui/                hud, panels, map, menu
tools/               headless-test.mjs · headless-shim.mjs
```

Les modules communiquent par un **bus d'événements** (`js/core/events.js`) plutôt que par
références croisées : l'UI ne connaît pas le moteur, le moteur ne connaît pas l'UI.

---

## 8. Tests

Un harnais de test hors navigateur exécute les vrais modules du jeu dans Node (DOM et canvas
simulés par `tools/headless-shim.mjs`) :

```bash
node tools/headless-test.mjs      # 78 assertions, ~3 s, code de sortie 1 si échec
```

Il couvre : déterminisme du terrain, relief et biomes, routes et déclivité, chunks et LOD,
les **12 types de bâtiments** (colliders, conteneurs, portes, fenêtres), le butin et le poids,
la chaîne complète diagnostic → réparation → conduite → sérialisation d'un véhicule, la survie
sur plusieurs minutes simulées, la physique du joueur (chute et dégâts, murs, planchers, nage),
la météo sur 40 minutes simulées, la sauvegarde/rechargement et la base d'objets — plus la
**génération des villes/villages** (aplatissement de la place, portes, butin, clocher, boîtes à
gants) et le test critique : *un joueur qui marche réellement jusqu'à une porte ouverte et entre
dans la maison* (vitesse, collisions et seuil vérifiés frame par frame).

Vérification des imports et de la syntaxe de l'ensemble du graphe de modules :

```bash
npx --yes esbuild@0.23.1 js/main.js --bundle --outfile=/tmp/out.js --format=esm
```

---

## 9. Licence

Code du jeu : usage libre. Three.js r180 sous licence MIT (voir `vendor/three/LICENSE`).
