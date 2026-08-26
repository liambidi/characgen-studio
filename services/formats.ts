/**
 * Formats de livre et cadrage des illustrations.
 *
 * CE QUI NE MARCHAIT PAS
 *
 * Le catalogue vivait dans `App.tsx` et chaque format y portait un ratio
 * d'image ecrit a la main. Deux consequences, toutes les deux invisibles a
 * l'usage :
 *
 * 1. Les ratios etaient faux. L'A4 mesure 210 sur 297, soit 0,707, et etait
 *    annonce en 3:4, soit 0,750. Le Digest, 0,648, portait le meme 3:4 : 16 %
 *    d'ecart. L'image ne remplissait donc jamais la page.
 * 2. Quatre formats portrait portaient la meme valeur, et quatre formats
 *    paysage aussi. Dix boutons produisaient quatre images differentes.
 *
 * CE QUI CHANGE
 *
 * Le format ne decrit plus qu'une page physique, en millimetres, seule donnee
 * vraie du catalogue. La proportion de l'illustration est calculee, et elle
 * depend d'un second reglage, le cadrage, que l'utilisateur choisit a part.
 *
 * Ce fichier ne fait aucun import de valeur, seulement des types, pour rester
 * lisible directement par le lanceur de tests de Node.
 */

import type { BookFormat, Cadrage, RatioImage } from '../types';

/**
 * Ratios acceptes par l'API Gemini, dans l'ordre de preference.
 *
 * Verifie le 2026-08-26 dans la documentation du SDK Google Gen AI, interface
 * `ImageConfig`. Le code precedent n'en connaissait que cinq et ignorait `2:3`
 * et `3:2`, qui sont pourtant les proportions des livres imprimes. C'est cette
 * ignorance qui obligeait a tordre l'A4 en 3:4.
 *
 * L'ordre compte : a distance egale, le premier de la liste gagne. Les
 * proportions de livre passent donc devant les proportions d'ecran.
 */
export const RATIOS_IMAGE: readonly RatioImage[] = [
  '2:3', '3:2', '3:4', '4:3', '1:1', '9:16', '16:9', '21:9',
];

/** Largeur divisee par hauteur, pour un ratio ecrit « l:h ». */
export const valeurDuRatio = (ratio: RatioImage): number => {
  const [l, h] = ratio.split(':').map(Number);
  return l / h;
};

/** Largeur divisee par hauteur, pour une page physique. */
export const ratioDeLaPage = (format: BookFormat): number =>
  format.largeurMm / format.hauteurMm;

/**
 * Deux ratios sont-ils separes par moins que le bruit du calcul flottant.
 *
 * Sert au departage : l'A4 tombe presque exactement a mi-chemin entre 2:3 et
 * 3:4, et sans ce seuil le gagnant dependrait du dernier chiffre binaire.
 */
const EGALITE = 1e-6;

/**
 * Choisit le ratio d'image a demander a Gemini.
 *
 * En pleine page, on cherche la proportion disponible la plus proche de celle
 * de la page. La distance est mesuree en logarithme, et non en soustraction :
 * c'est la seule facon qu'un format et son retourne, l'A4 portrait et l'A4 a
 * l'italienne, choisissent des ratios eux-memes retournes l'un de l'autre. Une
 * difference simple donnerait 2:3 au portrait et 4:3 au paysage, ce qui n'a
 * aucun sens pour deux fois la meme page.
 *
 * Pour les autres cadrages, le choix ne depend pas du format : c'est justement
 * ce qu'on demande quand on impose un cadrage.
 */
export const ratioPourCadrage = (format: BookFormat, cadrage: Cadrage): RatioImage => {
  if (cadrage === 'portrait') return '2:3';
  if (cadrage === 'carre') return '1:1';
  if (cadrage === 'paysage') return '3:2';

  const cible = ratioDeLaPage(format);
  let gagnant: RatioImage = RATIOS_IMAGE[0];
  let meilleure = Infinity;

  for (const candidat of RATIOS_IMAGE) {
    const distance = Math.abs(Math.log(valeurDuRatio(candidat) / cible));
    // Strictement inferieur : a egalite, le premier de la liste reste en place.
    if (distance < meilleure - EGALITE) {
      meilleure = distance;
      gagnant = candidat;
    }
  }

  return gagnant;
};

/**
 * De combien l'image manque la page, en pourcentage.
 *
 * Ce chiffre etait tu jusqu'ici. Il est desormais affiche a cote de chaque
 * format, parce qu'un ecart de 8 % sur un livre de poche se voit a
 * l'impression, et qu'il vaut mieux le savoir avant de generer trente images.
 */
export const ecartDeCadrage = (format: BookFormat, cadrage: Cadrage): number => {
  const page = ratioDeLaPage(format);
  const image = valeurDuRatio(ratioPourCadrage(format, cadrage));
  return Math.abs(image - page) / page * 100;
};

/**
 * Le catalogue.
 *
 * Les millimetres sont les vraies dimensions commerciales de chaque format.
 * Rien d'autre n'est saisi a la main : la proportion, l'orientation et le ratio
 * demande a Gemini en decoulent tous.
 */
export const BOOK_FORMATS: BookFormat[] = [
  { id: 'a4_p',     nom: 'A4',                   dimensions: '21 x 29,7 cm',   famille: 'portrait', largeurMm: 210, hauteurMm: 297 },
  { id: 'moyen_p',  nom: 'Moyen',                dimensions: '16 x 24 cm',     famille: 'portrait', largeurMm: 160, hauteurMm: 240 },
  { id: 'a5_p',     nom: 'Roman, A5',            dimensions: '15 x 21 cm',     famille: 'portrait', largeurMm: 150, hauteurMm: 210 },
  { id: 'digest_p', nom: 'Digest',               dimensions: '14 x 21,6 cm',   famille: 'portrait', largeurMm: 140, hauteurMm: 216 },
  { id: 'poche_p',  nom: 'Poche',                dimensions: '11 x 18 cm',     famille: 'portrait', largeurMm: 110, hauteurMm: 180 },
  { id: 'a4_l',     nom: 'A4 italienne',         dimensions: '29,7 x 21 cm',   famille: 'paysage',  largeurMm: 297, hauteurMm: 210 },
  { id: 'moyen_l',  nom: 'Moyen italienne',      dimensions: '24 x 16 cm',     famille: 'paysage',  largeurMm: 240, hauteurMm: 160 },
  { id: 'a5_l',     nom: 'Roman italienne',      dimensions: '21 x 15 cm',     famille: 'paysage',  largeurMm: 210, hauteurMm: 150 },
  { id: 'digest_l', nom: 'Digest italienne',     dimensions: '21,6 x 14 cm',   famille: 'paysage',  largeurMm: 216, hauteurMm: 140 },
  { id: 'poche_l',  nom: 'Poche italienne',      dimensions: '18 x 11 cm',     famille: 'paysage',  largeurMm: 180, hauteurMm: 110 },
];

/** Retrouve un format, en retombant sur le premier plutot que sur `undefined`. */
export const formatParId = (id: string): BookFormat =>
  BOOK_FORMATS.find((f) => f.id === id) || BOOK_FORMATS[0];

/** Libelle complet, pour le PDF et les messages. */
export const libelleFormat = (format: BookFormat): string =>
  `${format.nom} (${format.dimensions})`;

/** Ce que chaque cadrage veut dire, en une phrase, pour l'interface. */
export const LIBELLE_CADRAGE: Record<Cadrage, { titre: string; explication: string }> = {
  'pleine-page': {
    titre: 'Pleine page',
    explication: "L'image prend la proportion de la page, au plus près de ce que Gemini sait produire.",
  },
  portrait: {
    titre: 'Portrait',
    explication: 'Image debout, quelle que soit la taille du livre.',
  },
  carre: {
    titre: 'Carré',
    explication: 'Image carrée, centrée dans la page.',
  },
  paysage: {
    titre: 'Paysage',
    explication: 'Image couchée, même dans un livre portrait.',
  },
};

/** Ce que chaque résolution coûte, dit en clair au lieu d'être passé sous silence. */
export const LIBELLE_RESOLUTION: Record<'1K' | '2K' | '4K', { titre: string; explication: string }> = {
  '1K': { titre: '1K', explication: 'Rapide. Suffisant à l\'écran, un peu juste à l\'impression.' },
  '2K': { titre: '2K', explication: 'Deux fois plus long. Le bon choix pour un livre imprimé.' },
  '4K': { titre: '4K', explication: 'Le plus long, et un PDF nettement plus lourd.' },
};
