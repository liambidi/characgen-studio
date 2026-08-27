/**
 * Le mode d'affichage compact, partage par les cinq etapes qui listent quelque chose.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * Chaque etape affiche sa collection en cartes, et une carte occupe entre un
 * tiers et la totalite de la largeur. Sur un roman, l'analyse rend quarante
 * personnages et cent scenes : le Storyboard, qui empile des cartes pleine
 * largeur separees de trois rem, demande alors une cinquantaine d'ecrans de
 * defilement pour etre parcouru une fois. Rien ne permettait de chercher un nom,
 * de ne montrer que ce qui a echoue, ni de voir dix planches cote a cote.
 *
 * Ce fichier porte la logique, et rien d'autre : pas de React, pas d'import.
 * C'est la condition pour que `tests/vue.test.mjs` puisse la verifier sans
 * navigateur, et c'est ce qui compte ici, parce qu'une recherche qui ignore les
 * accents ou un filtre qui se trompe d'etat ne se voient pas a l'oeil.
 */

// L'extension `.ts` est explicite, comme dans les tests : c'est la seule forme
// que Node resout sans etape de compilation, et `allowImportingTsExtensions` est
// active dans tsconfig.json. Le fichier partage ne fait aucun import et n'a aucun
// effet de bord, seules les deux fonctions employees ici partent dans le paquet.
import { memePersonnage, memeLieu } from '../netlify/shared/analyse.ts';

/**
 * Les trois densites d'affichage.
 *
 * `cartes` est l'existant, on ne le remplace pas : c'est la seule densite ou
 * l'on peut modifier une fiche. `liste` sert a retrouver, `planches` a comparer.
 */
export type Densite = 'cartes' | 'liste' | 'planches';

export const DENSITES: { valeur: Densite; libelle: string; icone: string; aide: string }[] = [
  { valeur: 'cartes', libelle: 'Cartes', icone: 'fa-table-cells-large', aide: 'Fiches completes, modifiables' },
  { valeur: 'liste', libelle: 'Liste', icone: 'fa-list', aide: 'Une ligne par element, pour retrouver' },
  { valeur: 'planches', libelle: 'Planches', icone: 'fa-border-all', aide: 'Vignettes serrees, pour comparer' },
];

/** Le filtre d'etat. `restants` couvre aussi bien ce qui attend que ce qui est en cours. */
export type EtatVue = 'tous' | 'faits' | 'restants' | 'erreurs';

export const ETATS: { valeur: EtatVue; libelle: string }[] = [
  { valeur: 'tous', libelle: 'Tout' },
  { valeur: 'faits', libelle: 'Faits' },
  { valeur: 'restants', libelle: 'Restants' },
  { valeur: 'erreurs', libelle: 'En erreur' },
];

export type Statut = 'pending' | 'generating' | 'completed' | 'error';

export interface AvecStatut {
  status?: Statut;
}

/**
 * Met un texte a plat pour le comparer : minuscules, sans accent, sans espace
 * en trop.
 *
 * Sans cette etape, chercher « maelle » ne trouverait pas « Maelle » ecrit avec
 * son trema, et l'utilisateur conclurait que la fiche n'existe pas. C'est le
 * genre d'erreur qui se paie en confiance : on ne cherche plus un outil qui
 * repond « aucun resultat » a une question dont on connait la reponse.
 */
export const normaliser = (texte: string): string =>
  (texte || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/**
 * Un element correspond si CHAQUE mot cherche se retrouve dans au moins un de
 * ses champs.
 *
 * Le decoupage en mots est volontaire : « maelle douane » doit trouver la scene
 * qui associe le personnage et le lieu, meme si les deux mots ne se suivent pas
 * dans la meme phrase. Une recherche qui exigerait la chaine complete obligerait
 * a se souvenir du titre exact, c'est-a-dire de ce qu'on cherche justement.
 */
export const correspond = (champs: Array<string | undefined | null>, recherche: string): boolean => {
  const mots = normaliser(recherche).split(/\s+/).filter(Boolean);
  if (mots.length === 0) return true;

  // Le saut de ligne separe les champs : sans lui, la fin d'un champ et le debut
  // du suivant formeraient un mot qui n'existe nulle part.
  const botte = champs.filter(Boolean).map((c) => normaliser(String(c))).join('\n');
  return mots.every((mot) => botte.includes(mot));
};

/** Un element sans statut n'a jamais ete lance : il compte comme en attente. */
const statutDe = (element: AvecStatut): Statut => element.status || 'pending';

export const filtrerParEtat = <T extends AvecStatut>(elements: T[], etat: EtatVue): T[] => {
  if (etat === 'tous') return elements;
  return elements.filter((element) => {
    const statut = statutDe(element);
    if (etat === 'faits') return statut === 'completed';
    if (etat === 'erreurs') return statut === 'error';
    return statut === 'pending' || statut === 'generating';
  });
};

export interface ComptesEtat {
  total: number;
  faits: number;
  restants: number;
  erreurs: number;
}

export const compterEtats = (elements: AvecStatut[]): ComptesEtat => {
  const comptes: ComptesEtat = { total: elements.length, faits: 0, restants: 0, erreurs: 0 };
  elements.forEach((element) => {
    const statut = statutDe(element);
    if (statut === 'completed') comptes.faits += 1;
    else if (statut === 'error') comptes.erreurs += 1;
    else comptes.restants += 1;
  });
  return comptes;
};

// ---------------------------------------------------------------------------
// Qui apparait ou
// ---------------------------------------------------------------------------

/**
 * Pour chaque personnage, les numeros des scenes ou il apparait.
 *
 * CE QUE CELA AJOUTE
 *
 * Le lien existe deja dans les donnees, `Scene.charactersPresent`, mais il ne se
 * lit que dans un sens : ouvrir une scene apprend qui s'y trouve. Personne ne
 * pouvait repondre a « dans combien de scenes Maelle apparait-elle », qui est
 * pourtant la question qu'on se pose quand on relit un casting de quarante
 * fiches et qu'on cherche lesquelles meritent une illustration soignee.
 *
 * Le rapprochement des noms passe par `memePersonnage`, la meme fonction que le
 * serveur et que le sequencier. Un rapprochement fait ici a sa facon donnerait
 * deux comptes differents pour la meme scene, sur deux ecrans voisins.
 *
 * Le numero rendu est le rang dans le tableau, a partir de 1 : c'est celui qui
 * est affiche sur les cartes, pas l'identifiant interne.
 */
export const scenesParPersonnage = (
  scenes: Array<{ charactersPresent?: string[] }>,
  personnages: Array<{ id: string; name: string }>
): Record<string, number[]> => {
  const index: Record<string, number[]> = {};
  personnages.forEach((personnage) => { index[personnage.id] = []; });

  scenes.forEach((scene, rang) => {
    const presents = (scene.charactersPresent || []).filter((nom) => typeof nom === 'string');
    personnages.forEach((personnage) => {
      if (presents.some((nom) => memePersonnage(nom, personnage.name))) {
        index[personnage.id].push(rang + 1);
      }
    });
  });

  return index;
};

/**
 * Pour chaque decor, les numeros des scenes qui s'y deroulent.
 *
 * Le lien franc est `Scene.environmentId`, pose quand le sequencier reconnait le
 * decor. Il manque souvent : une scene ajoutee a la main n'en a pas. On retombe
 * alors sur le nom du lieu, avec `memeLieu`, la meme regle que le serveur.
 */
export const scenesParDecor = (
  scenes: Array<{ environmentId?: string; location?: string }>,
  decors: Array<{ id: string; name: string }>
): Record<string, number[]> => {
  const index: Record<string, number[]> = {};
  decors.forEach((decor) => { index[decor.id] = []; });

  scenes.forEach((scene, rang) => {
    const parIdentifiant = scene.environmentId && index[scene.environmentId] !== undefined
      ? scene.environmentId
      : undefined;

    if (parIdentifiant) {
      index[parIdentifiant].push(rang + 1);
      return;
    }

    const lieu = scene.location || '';
    if (!lieu) return;
    const trouve = decors.find((decor) => memeLieu(lieu, decor.name));
    if (trouve) index[trouve.id].push(rang + 1);
  });

  return index;
};

/**
 * L'etiquette courte, celle qui tient sur une ligne compacte.
 *
 * Un element qui n'apparait nulle part rend une chaine vide plutot que
 * « 0 scene » : sur une liste de quarante figurants, quarante zeros feraient du
 * bruit sans rien apprendre. L'absence se lit deja a l'absence d'etiquette.
 */
export const resumeScenes = (numeros: number[]): string => {
  if (!numeros || numeros.length === 0) return '';
  return numeros.length === 1 ? '1 scene' : `${numeros.length} scenes`;
};

/**
 * Le detail, pour l'infobulle et pour le lecteur d'ecran : les numeros eux-memes.
 * Au-dela de douze, on coupe, parce qu'une infobulle de cent nombres ne se lit pas.
 */
export const detailScenes = (numeros: number[]): string => {
  if (!numeros || numeros.length === 0) return '';
  const debut = numeros.slice(0, 12).join(', ');
  return numeros.length > 12
    ? `Scenes ${debut}, et ${numeros.length - 12} autres`
    : `Scene${numeros.length > 1 ? 's' : ''} ${debut}`;
};

// ---------------------------------------------------------------------------
// Retour a la fiche complete
// ---------------------------------------------------------------------------

/**
 * L'identifiant d'ancre pose sur une carte, pour qu'une ligne compacte puisse y
 * ramener. Prefixe par etape : deux collections peuvent porter le meme
 * identifiant d'element si un projet a ete importe deux fois.
 */
export const ancre = (prefixe: string, id: string): string => `fiche-${prefixe}-${id}`;
