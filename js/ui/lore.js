/**
 * lore.js — Fragments de vie d'avant, lus dans les carnets et photographies
 * trouvés en fouillant.
 *
 * Aucun grand récit : des traces du quotidien brutalement interrompu.
 * Le texte est choisi de façon stable (graine + objet), jamais aléatoire
 * d'une ouverture à l'autre.
 */

export const LORE = [
  // --- carnets / journaux intimes ---
  { t: 'carnet', title: 'Carnet de bord', body: `12 mars. Les oiseaux ne sont pas revenus ce matin. Mme Roussel dit que c'est le froid. Il ne fait pas froid.

16 mars. La radio ne diffuse plus que le bip. Le gendarme est passé : « Gardez les portes fermées. » Il ne savait pas dire pour combien de temps.

19 mars. Les corbeaux, eux, sont là. Trop, même. Hier soir, la ville au loin n'avait aucune lumière. Pas une.` },
  { t: 'carnet', title: 'Journal d\'Adèle', body: `Le petit dort mal. Il demande pourquoi les voisins sont partis sans dire au revoir. Je lui ai répondu qu'ils reviendraient. Il m'a regardée comme on regarde quelqu'un qui ment mal.

J'ai compté les conserves : quarante-deux. Si on mange peu, ça fait trois mois. Il faut que je trouve des piles pour la lampe du grenier.` },
  { t: 'carnet', title: 'Agenda de travail', body: `Lundi : réunion 9 h, relancer l'architecte.
Mardi : banque, anniversary Marthe.
Mercredi : LE camion est enfin venu chercher les fûts. Il ne reviendra pas avant mai, ils disent. Personne ne revient avant mai.
Jeudi —` },
  { t: 'carnet', title: 'Cahier d\'école', body: `Les lignes s'arrêtent au milieu de la page. L'encre change de couleur, la main a tremblé :

« Ma maîtresse dit que l'école ferme pour les vacances. Maman dit que ce n'est pas des vacances. Papa charge la voiture. J'ai le droit de prendre un seul jouet. J'ai pris le mauvais, je crois. »` },
  { t: 'carnet', title: 'Registre de la station', body: `Plein diesel : 54 L — réglé.
Ravitaillement prévu le 14 : ANNULÉ.
Dernière entrée, à la hâte : « Les pompes ne fonctionnent plus. Le distributeur est vide. Que celui qui lit ceci prenne l'extincteur derrière le comptoir, on en aura peut-être besoin sur la route. »` },
  { t: 'carnet', title: 'Notes de l\'atelier', body: `Client : Bertrand, tracteur bleu — courroie à changer, commandée.
Autre client : personne. Plus personne depuis quinze jours.
Je laisse la clé sur le rail de la porte. Les outils sont à qui en a besoin. Servez-vous. Fermez en partant, par respect.` },
  { t: 'carnet', title: 'Carnet de chasse', body: `Sanglier, mâle, 90 kg environ, Bellevue. 5 h 30, poste 4.
Renard borgne, encore lui. Loup ? Non confirmé.
Dernière page : « Les traces autour du campement ne sont pas celles d'un sanglier. Trop larges. Je rentre plus tôt. »` },
  { t: 'carnet', title: 'Liste de courses', body: `Pâtes, riz, lait longue conservation, bougies (beaucoup), allumettes, piles AA, bandages, aspirine, eau — 30 bouteilles si possible, essence JerryCan 20 L, chaînes.

En dessous, d'une écriture différente : « Si tu lis cette liste, la moitié est déjà partie. Prends le reste. »` },
  { t: 'carnet', title: 'Registre paroissial', body: `Baptême : Aurore V., fille de… (l'encre a coulé)
Mariage : reporté.
Enterrement : dix-sept, ce mois-ci. Le curé a cessé d'écrire les noms à partir du douzième. La dernière ligne : « Que Dieu nous garde de compter. »` },
  { t: 'carnet', title: 'Carnet du garde forestier', body: `Repérage crête : traces multiples, orientation sud → nord, intrus dans la réserve ?
Le silentium de 6 h n'a pas eu lieu. Aucun chant. Vingt ans que je le note chaque matin. Aujourd'hui, la colonne « oiseaux » reste vide. Je n'écrirai plus cette colonne.` },
  { t: 'carnet', title: 'Livre de comptes de la ferme', body: `Lait livré : 380 L. Lait détruit (ramassage suspendu) : 410 L.
Les vaches ne comprennent pas qu'on ne les traye plus. Leur plainte s'entend jusqu'à la route.
Vendu les deux tracteurs au ferrailleur. Gardé le fusil et l'essence.` },

  // --- photographies ---
  { t: 'photo', title: 'Photographie', body: `Un repas d'anniversaire. Onze personnes autour d'une table, un gâteau — bougies allumées. Au fond, par la fenêtre, la route est déjà barrée de sacs de sable. Personne sur la photo ne regarde la route. Tout le monde sourit très fort.` },
  { t: 'photo', title: 'Photographie', body: `Une classe devant l'école, dans les années 90 visiblement. Au dos, au crayon : « Ils sont partis si vite que les cahiers sont restés ouverts sur les pupitres. La maîtresse a laissé les plantes. J'ai arrosé les plantes une dernière fois. »` },
  { t: 'photo', title: 'Photographie', body: `Un couple devant une voiture chargée jusqu'au toit, toiles bâchées. Le coffre est ouvert : on devine des boîtes, une cage. L'homme a la main levée, pas tout à fait un au revoir, presque un salut. Derrière eux, la maison a toutes ses fenêtres ouvertes — ils n'ont pas voulu fermer, ou pas eu le temps.` },
  { t: 'photo', title: 'Photographie abîmée', body: `Le visage a été effacé par l'humidité ; il ne reste qu'un manteau, une écharpe, et une main posée sur une rambarde de pont. Au dos : « Promis, je reviens au printemps. — V. » Le printemps est arrivé, la rambarde rouille, personne n'est revenu.` },
  { t: 'photo', title: 'Photographie de chantier', body: `Des ouvriers posent devant une halle industrielle en construction, casques à la main, fiers. La légende : « Livraison prévue en juin. » La charpente, sur le cliché, n'a jamais reçu sa tôle — elle se dresse encore, incomplète, de l'autre côté de la vallée.` },

  // --- affiches et avis officiels ---
  { t: 'avis', title: 'Avis à la population', body: `PAR ARRÊTÉ PRÉFECTORAL

Évacuation organisée le 14, 7 h 00, convois depuis la place. Un bagage par personne. Les animaux domestiques ne seront pas admis.

Les services resteront alimentés « aussi longtemps que nécessaire ».

[le reste de l'affiche est déchiré]` },
  { t: 'avis', title: 'Note manuscrite punaisée', body: `« Nous sommes partis chez la mère de Julien, à l'est. Si vous êtes de ceux qui restent : le puits du village ne tarit pas, l'eau est bonne. La clé de la cave est sous le seau. Il y a des pommes. Prenez ce que vous voulez, mais laissez la clé pour le suivant. »` },
  { t: 'avis', title: 'Feuille de consignes', body: `CONSIGLES INTÉRIEURES — ne pas afficher à l'extérieur.
1. Bander les fenêtres du rez-de-chaussée.
2. Compter l'eau, toujours, avant de boire.
3. La radio, une fois par heure, canal 4. Si le bip s'arrête, ne pas sortir pour « vérifier ».
4. Ceux qui frappent après minuit : ne pas ouvrir. Ceux qui frappent avant : écouter d'abord.` },
  { t: 'avis', title: 'Étiquette de colis', body: `Destinataire : « À qui trouvera ».
Expéditeur : le relais postal de la vallée.
Contenu : deux boîtes d'allumettes, une carte de la région annotée (les passages barrés d'une croix le sont pour de bonnes raisons), et ce mot : « Le colis suivant n'arrivera pas. »` },
];

/** Index de lore stable pour un objet donné (jamais aléatoire à l'ouverture). */
export function loreIndexFor(itemId, slot, seed = 0) {
  let h = seed ^ 0x51f0;
  const key = `${itemId}:${slot}`;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) & 0x7fffffff;
  }
  return h % LORE.length;
}

/** Regroupe le texte à afficher pour un objet d'inventaire. */
export function loreFor(entry, slot, seed = 0) {
  const pool = entry.id === 'photo' ? LORE.filter((l) => l.t === 'photo') : LORE.filter((l) => l.t !== 'photo');
  const idx = loreIndexFor(entry.id + (entry.loreOffset || 0), slot, seed) % pool.length;
  return pool[idx];
}
