/**
 * L'arithmetique du feuilletage.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * Le liseur repose entierement sur une idee de menuisier : un feuillet de
 * papier a deux faces, et quand on le retourne, sa face cachee vient se poser
 * exactement a la place que l'autre page occupait. Tout le reste, la rotation,
 * l'ombre, le grain, n'est que de la peinture par-dessus.
 *
 * Cette idee tient en deux fonctions pures, ecrites ici plutot que dans le
 * composant. Elles ne dessinent rien, elles ne dependent d'aucun navigateur, et
 * elles se verifient donc pour de vrai, ce qui n'aurait pas ete le cas enfouies
 * au milieu du rendu React. Voir tests/liseur.test.mjs.
 *
 * LA CONVENTION
 *
 * La liste des feuillets est plate et de longueur paire. La double page numero
 * k montre les feuillets 2k et 2k+1, c'est a dire un rang pair a gauche et un
 * rang impair a droite, toujours.
 *
 *   0            garde avant
 *   1            couverture
 *   2 et 3       planche 1
 *   4 et 5       planche 2
 *   ...
 *   2N+2         colophon
 *   2N+3         garde arriere
 *
 * Ce fichier n'importe que des types, comme services/formats.ts, pour rester
 * lisible directement par le lanceur de tests de Node.
 */

import type { Scene } from '../types';

/** Un feuillet, c'est a dire une face de page. */
export type Feuillet =
  | { cle: string; nature: 'garde'; cote: 'avant' | 'arriere' }
  | { cle: string; nature: 'couverture' }
  | { cle: string; nature: 'colophon' }
  | { cle: string; nature: 'image'; scene: Scene; numero: number }
  | { cle: string; nature: 'texte'; scene: Scene; numero: number };

/**
 * Construit la liste des feuillets a partir des planches.
 *
 * Les deux gardes et la couverture ne sont pas de la decoration : ce sont elles
 * qui font tomber le compte juste. Avec N planches, la liste vaut 2N + 4
 * feuillets, donc un nombre pair, donc chaque planche occupe une double page
 * complete et aucune ne se retrouve a cheval sur deux ouvertures.
 *
 * `imageEnPremier` decide, planche par planche, si l'illustration occupe le
 * feuillet de gauche. L'alternance vient de l'appelant : elle depend du rang de
 * la planche et des inversions decidees a la main, deux choses qui ne
 * regardent pas cette fonction.
 */
export const construireFeuillets = (
  scenes: Scene[],
  imageEnPremier: (sceneId: string, index: number) => boolean
): Feuillet[] => {
  const liste: Feuillet[] = [
    { cle: 'garde-avant', nature: 'garde', cote: 'avant' },
    { cle: 'couverture', nature: 'couverture' },
  ];

  scenes.forEach((scene, index) => {
    const image: Feuillet = { cle: `${scene.id}-image`, nature: 'image', scene, numero: index + 1 };
    const texte: Feuillet = { cle: `${scene.id}-texte`, nature: 'texte', scene, numero: index + 1 };
    if (imageEnPremier(scene.id, index)) liste.push(image, texte);
    else liste.push(texte, image);
  });

  liste.push({ cle: 'colophon', nature: 'colophon' });
  liste.push({ cle: 'garde-arriere', nature: 'garde', cote: 'arriere' });

  return liste;
};

/**
 * Quels feuillets sont a l'ecran, et a quelle place.
 *
 * `gauche` et `droite` sont les pages posees a plat. `recto` et `verso` sont
 * les deux faces de la feuille en train de tourner, `null` quand rien ne
 * tourne.
 */
export interface Disposition {
  gauche: number | null;
  droite: number | null;
  recto: number | null;
  verso: number | null;
}

/**
 * Place les feuillets pour une position et un mouvement donnes.
 *
 * LE POINT DELICAT, ET IL N'Y EN A QU'UN
 *
 * Quand on avance depuis la double page qui montre les feuillets p et p+1, la
 * feuille qu'on soulve porte p+1 au recto. Son verso est p+2, parce que c'est
 * la meme feuille de papier vue de l'autre cote. Pendant qu'elle tourne, on
 * decouvre p+3 en dessous, a droite. Quand elle retombe, p+2 se retrouve a
 * gauche et p+3 a droite : exactement la double page suivante.
 *
 * Cette coincidence n'est pas un heureux hasard qu'il faudrait entretenir a la
 * main, c'est la geometrie du papier. Les tests la verifient comme telle : la
 * disposition d'apres un tour doit etre identique a la disposition au repos de
 * la position d'arrivee.
 *
 * En page simple, il n'y a pas de verso : une seule page est visible a la fois,
 * la feuille pivote pour sortir du champ ou pour y revenir.
 */
export const disposerFeuillets = (
  position: number,
  double: boolean,
  tour: 1 | -1 | null
): Disposition => {
  if (double) {
    if (tour === 1) {
      return { gauche: position, droite: position + 3, recto: position + 1, verso: position + 2 };
    }
    if (tour === -1) {
      return { gauche: position - 2, droite: position + 1, recto: position, verso: position - 1 };
    }
    return { gauche: position, droite: position + 1, recto: null, verso: null };
  }

  if (tour === 1) {
    return { gauche: position + 1, droite: null, recto: position, verso: null };
  }
  if (tour === -1) {
    return { gauche: position, droite: null, recto: position - 1, verso: null };
  }
  return { gauche: position, droite: null, recto: null, verso: null };
};

/**
 * Le rang du premier feuillet de la planche numero `index`, compte a partir de zero.
 *
 * Sert au sommaire, qui doit ouvrir le livre a la bonne double page et non a un
 * feuillet impair, ce qui decalerait toute la lecture d'une page.
 */
export const positionDeLaPlanche = (index: number): number => 2 + index * 2;
