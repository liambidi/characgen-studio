/**
 * Logique d'analyse d'un recit, partagee par les deux serveurs.
 *
 * Ce fichier ne connait NI Google NI Netlify : il ne fait aucun import. C'est
 * volontaire. L'Edge Function tourne sous Deno et charge le SDK Google depuis
 * esm.sh, la fonction d'arriere-plan tourne sous Node et le charge depuis
 * node_modules. Les deux ne peuvent donc pas partager un fichier qui importerait
 * ce SDK. On lui passe a la place ce dont il a besoin en parametre : la fabrique
 * de schemas `Type`, et une fonction `generer` qui sait parler au modele.
 *
 * LE RECIT PART ENTIER, IL N'EST JAMAIS RESUME (decide le 2026-08-25)
 *
 * Ce fichier a longtemps decoupe le recit en tranches de 12 000 caracteres,
 * resumait chaque tranche, puis analysait l'assemblage des resumes. C'etait une
 * precaution heritee de modeles qui ne savaient pas lire long. Elle coutait un
 * appel par tranche, et surtout elle jetait le detail : une description physique
 * ou une reprise de dialogue disparaissaient dans le resume, et l'analyse
 * travaillait ensuite sur un texte appauvri sans que rien ne le signale.
 *
 * Les modeles listes ci-dessous lisent le plafond de saisie complet, 400 000
 * caracteres, en un seul appel. Le recit leur est donc transmis tel quel,
 * partout. Si Google refusait un jour cette taille, l'erreur remonte a
 * l'utilisateur telle quelle : mieux vaut une phrase claire qu'un resume
 * silencieux qui ampute le livre.
 */

// ---------------------------------------------------------------------------
// Modeles : une seule liste, un seul endroit a mettre a jour.
// Chaque role liste ses modeles par ordre de preference. Si Google retire un
// modele, le code bascule tout seul sur le suivant au lieu de tomber en panne.
// ---------------------------------------------------------------------------
export const MODELES = {
  // Analyse fine du recit : comprehension longue, sortie structuree.
  texteExpert: ["gemini-3.1-pro-preview", "gemini-3.5-flash", "gemini-3-flash-preview"],
  // Taches courtes : inventer une fiche a partir de quelques mots.
  texteRapide: ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"],
  // Generation d'images.
  image: ["gemini-3-pro-image", "gemini-3-pro-image-preview", "gemini-3.1-flash-image"],
  // Retouche d'une image existante.
  imageEdition: ["gemini-3.1-flash-image", "gemini-2.5-flash-image", "gemini-3-pro-image"],
} as const;

/** Un modele retire du catalogue par Google, seul cas qui justifie d'essayer le suivant. */
export const estModeleIntrouvable = (e: any): boolean => {
  const msg = String(e?.message || e || "");
  return e?.status === 404 || /NOT_FOUND|no longer available|is not found/i.test(msg);
};

/**
 * Tiroir Netlify Blobs ou la fonction d'arriere-plan depose l'avancement puis le
 * resultat de chaque travail, et ou la fonction de statut vient les lire.
 * Le nom vit ici pour que les deux fonctions ne puissent pas diverger, sans que
 * l'une ait besoin d'importer l'autre.
 */
export const MAGASIN_ANALYSES = "analyses";

/**
 * Au dela de cet age, un enregistrement d'analyse ne sert plus a personne : le
 * navigateur qui l'attendait a abandonne depuis longtemps. Sans ce menage, le
 * magasin grossissait a chaque import et n'etait jamais vide.
 */
export const AGE_MAX_ANALYSE_MS = 60 * 60 * 1_000;

/** Prefixe des compteurs de debit, pour les distinguer des analyses dans le magasin. */
export const PREFIXE_LIMITE = "limite/";

/**
 * Prefixe du compteur de l'Edge Function, separe de celui de l'analyse.
 *
 * Les deux points d'entree n'ont rien a voir : generer vingt images est un usage
 * normal, lancer vingt analyses de roman ne l'est pas. Un compteur commun aurait
 * fait qu'une serie d'illustrations epuise le droit d'importer un recit.
 */
export const PREFIXE_LIMITE_EDGE = "limite-edge/";

/**
 * Plafonds de saisie, verifies avant tout appel facturable.
 * Le point d'entree est public et devinable : tout ce qui arrive du navigateur
 * est verifie avant de partir chez Google, pour que personne ne puisse faire
 * gonfler la facture avec des demandes fabriquees a la main.
 */
export const LIMITES = {
  texte: 400_000, // caracteres d'un recit importe
  prompt: 4_000, // consigne libre ecrite par l'utilisateur
  image: 12_000_000, // image en base64
  liste: 200, // nombre de noms ou de titres transmis
  messages: 60, // longueur d'historique de discussion
};

// ---------------------------------------------------------------------------
// Validation des entrees
// ---------------------------------------------------------------------------

/** Distingue une saisie invalide (a corriger par l'utilisateur) d'une panne serveur. */
export class ErreurDeSaisie extends Error {}

export const texteValide = (valeur: unknown, nom: string, max: number, obligatoire = true): string => {
  if (valeur === undefined || valeur === null || valeur === "") {
    if (obligatoire) throw new ErreurDeSaisie(`${nom} est vide. Importez d'abord un texte.`);
    return "";
  }
  if (typeof valeur !== "string") throw new ErreurDeSaisie(`${nom} n'a pas le format attendu.`);
  if (valeur.length > max) throw new ErreurDeSaisie(`${nom} depasse la taille acceptee (${max} caracteres).`);
  return valeur;
};

export const listeValide = (valeur: unknown, nom: string): string[] => {
  if (valeur === undefined || valeur === null) return [];
  if (!Array.isArray(valeur)) throw new ErreurDeSaisie(`${nom} n'a pas le format attendu.`);
  if (valeur.length > LIMITES.liste) throw new ErreurDeSaisie(`${nom} contient trop d'elements.`);
  return valeur.filter((v) => typeof v === "string").map((v) => v.slice(0, 300));
};

export const nombreValide = (
  valeur: unknown,
  nom: string,
  min: number,
  max: number
): number | undefined => {
  if (valeur === undefined || valeur === null) return undefined;
  const n = Number(valeur);
  if (!Number.isFinite(n)) throw new ErreurDeSaisie(`${nom} doit etre un nombre.`);
  return Math.min(max, Math.max(min, Math.round(n)));
};

/**
 * Types d'images acceptes en entree. Un SVG est un document executable deguise
 * en image : il n'a rien a faire dans une requete de generation, et le modele
 * ne sait pas le lire.
 */
const TYPES_IMAGE_ACCEPTES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];

export const imageValide = (valeur: unknown, nom: string, obligatoire = true): string => {
  const v = texteValide(valeur, nom, LIMITES.image, obligatoire);
  if (!v) return v;

  const entete = /^data:([^;]+);base64,/.exec(v);
  if (!entete) throw new ErreurDeSaisie(`${nom} n'est pas une image valide.`);
  if (!TYPES_IMAGE_ACCEPTES.includes(entete[1].toLowerCase())) {
    throw new ErreurDeSaisie(`${nom} est dans un format non accepte (${entete[1]}). Utilisez du PNG, du JPEG ou du WebP.`);
  }
  return v;
};

/**
 * Decompose une image encodee en son type reel et ses donnees.
 * Le type etait auparavant force a image/png alors que Google renvoie souvent
 * du JPEG : les images de reference partaient donc mal etiquetees.
 */
export const decouperImage = (dataUrl: string): { mimeType: string; data: string } => {
  const correspondance = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || "");
  if (!correspondance) return { mimeType: "image/png", data: (dataUrl || "").split(",")[1] || "" };
  return { mimeType: correspondance[1], data: correspondance[2] };
};

// ---------------------------------------------------------------------------
// Rapprochement des noms
// ---------------------------------------------------------------------------

/**
 * Deux noms designent-ils le meme personnage ?
 *
 * POURQUOI CE N'EST PAS UN SIMPLE `includes`
 *
 * La comparaison etait `a.includes(b) || b.includes(a)` sur les noms en
 * minuscules. Un personnage nomme "Al" etait donc reconnu dans "Salazar", dans
 * "Alice" et dans "journal" : sa fiche partait en image de reference pour des
 * scenes ou il n'apparait pas, et l'illustration montrait le mauvais visage.
 *
 * On compare donc sans accents ni casse, et une inclusion n'est retenue que si
 * elle tombe sur une frontiere de mot et porte sur au moins quatre caracteres,
 * de quoi reconnaitre "Marie" dans "Marie Dupont" sans reconnaitre "Al" partout.
 */
export const normaliserNom = (nom: string): string =>
  nom
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

export const memePersonnage = (a: string, b: string): boolean => {
  const gauche = normaliserNom(a);
  const droite = normaliserNom(b);
  if (!gauche || !droite) return false;
  if (gauche === droite) return true;

  const [court, long] = gauche.length <= droite.length ? [gauche, droite] : [droite, gauche];
  if (court.length < 4) return false;

  // Frontiere de mot : "marie" reconnu dans "marie dupont", pas dans "marierait".
  const echappe = court.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${echappe}([^a-z0-9]|$)`).test(long);
};

/**
 * Mots trop courants pour distinguer deux lieux. Sans cette liste, "la maison"
 * et "la foret" se ressembleraient par leur article.
 */
const MOTS_VIDES_LIEU = new Set([
  "le", "la", "les", "un", "une", "des", "du", "de", "d", "l",
  "dans", "vers", "sur", "sous", "chez", "au", "aux", "a", "et", "en", "par",
]);

/** Mots significatifs d'un nom de lieu, sans accents, sans articles. */
const motsDuLieu = (nom: string): string[] =>
  normaliserNom(nom)
    .replace(/['’]/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((mot) => mot.length >= 4 && !MOTS_VIDES_LIEU.has(mot));

/**
 * Le lieu d'une scene designe-t-il un decor deja genere ?
 *
 * Sert a relier automatiquement chaque scene a son decor. Le champ existait
 * depuis toujours, mais rien ne le remplissait : l'utilisateur devait faire la
 * liaison a la main, scene par scene, faute de quoi l'illustration ne
 * s'appuyait jamais sur l'image du decor.
 *
 * La regle est volontairement prudente : il faut un mot significatif commun.
 * Relier a tort serait pire que ne pas relier, l'image partirait avec la
 * mauvaise reference visuelle.
 */
export const memeLieu = (lieuScene: string, nomDecor: string): boolean => {
  const gauche = motsDuLieu(lieuScene || "");
  const droite = motsDuLieu(nomDecor || "");
  if (gauche.length === 0 || droite.length === 0) return false;
  return gauche.some((mot) => droite.includes(mot));
};

// ---------------------------------------------------------------------------
// Decoupage du texte
//
// Ces fonctions ne servent plus a resumer le recit, qui part desormais entier.
// Elles restent le filet du decoupage en scenes : quand le modele cite mal une
// borne, il faut bien couper quelque part, et couper a la fin d'une phrase vaut
// mieux que couper au milieu d'un mot.
// ---------------------------------------------------------------------------

/**
 * Coupe un paragraphe plus long que la taille cible.
 *
 * On coupe a la fin de phrase la plus proche, a defaut sur une espace, et
 * seulement en dernier recours au caractere pres.
 */
export const couperParagrapheLong = (paragraphe: string, tailleCible: number): string[] => {
  if (tailleCible < 1) return [paragraphe];

  const morceaux: string[] = [];
  let reste = paragraphe;
  // En dessous de ce seuil la coupure produirait des miettes : mieux vaut alors
  // couper plus loin, quitte a ce que ce soit au milieu d'une phrase.
  const minimum = Math.floor(tailleCible * 0.6);

  while (reste.length > tailleCible) {
    const fenetre = reste.slice(0, tailleCible);

    let coupure = -1;
    for (const fin of fenetre.matchAll(/[.!?…][")»']?\s/g)) {
      const position = (fin.index ?? 0) + fin[0].length;
      if (position >= minimum) coupure = position;
    }

    if (coupure < 0) {
      const espace = fenetre.lastIndexOf(" ");
      coupure = espace >= minimum ? espace + 1 : tailleCible;
    }

    morceaux.push(reste.slice(0, coupure));
    reste = reste.slice(coupure);
  }

  if (reste.length > 0) morceaux.push(reste);
  return morceaux;
};

/**
 * Decoupe un texte en morceaux qui respectent les fins de paragraphe.
 * Aucun morceau ne depasse la taille cible, y compris pour un texte sans le
 * moindre retour a la ligne.
 */
export const decouperEnParagraphes = (texte: string, tailleCible: number): string[] => {
  const paragraphes = texte.split("\n").filter((p) => p.trim().length > 0);
  if (paragraphes.length === 0) return couperParagrapheLong(texte, tailleCible);

  const morceaux: string[] = [];
  let courant = "";

  const deposer = () => {
    if (courant.length > 0) morceaux.push(courant);
    courant = "";
  };

  for (const p of paragraphes) {
    // Un paragraphe deja plus long que la cible ne peut pas etre accumule.
    if (p.length > tailleCible) {
      deposer();
      morceaux.push(...couperParagrapheLong(p, tailleCible));
      continue;
    }

    if (courant.length > 0 && courant.length + p.length + 1 > tailleCible) {
      deposer();
      courant = p;
    } else {
      courant = courant.length > 0 ? `${courant}\n${p}` : p;
    }
  }

  deposer();
  return morceaux;
};

// ---------------------------------------------------------------------------
// Lecture des reponses JSON
// ---------------------------------------------------------------------------

const cleanJsonText = (text: string): string => {
  if (!text) return "{}";
  let clean = text.replace(/```json\s*/g, "").replace(/```\s*$/g, "");
  clean = clean.replace(/```/g, "");
  return clean.trim();
};

/**
 * Analyse une reponse JSON du modele. Une reponse tronquee ou illisible leve une
 * erreur explicite : sans cela l'utilisateur voyait "0 personnage trouve" sans
 * savoir que l'analyse avait echoue.
 */
export const lireJson = (text: string, contexte: string): any => {
  const brut = cleanJsonText(text || "");
  if (!brut || brut === "{}") {
    throw new Error(`${contexte} : le modele n'a renvoye aucune donnee. Reessayez dans un instant.`);
  }
  try {
    return JSON.parse(brut);
  } catch {
    const tronquee =
      brut.length > 200 && !brut.trimEnd().endsWith("}") && !brut.trimEnd().endsWith("]");
    if (tronquee) {
      throw new Error(
        `${contexte} : la reponse a ete coupee avant la fin, il y a trop d'elements a decrire d'un coup. ` +
          `Relancez en demandant un nombre precis, plus petit.`
      );
    }
    console.error("Reponse illisible :", brut.slice(0, 400));
    throw new Error(`${contexte} : la reponse du modele est illisible. Reessayez.`);
  }
};

// ---------------------------------------------------------------------------
// Schemas de reponse
// ---------------------------------------------------------------------------

/**
 * Fabrique les schemas a partir du `Type` du SDK Google. Il faut le passer en
 * parametre : ce sont les memes valeurs des deux cotes, mais elles proviennent
 * de deux copies differentes du SDK.
 */
export const construireSchemas = (Type: any) => {
  const SCHEMA_PERSONNAGE = {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING },
      role: { type: Type.STRING },
      shortDescription: { type: Type.STRING },
      personality: { type: Type.STRING },
      physicalDescription: { type: Type.STRING },
    },
    required: ["name", "role", "shortDescription", "personality", "physicalDescription"],
  };

  const SCHEMA_ENVIRONNEMENT = {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING },
      type: { type: Type.STRING, enum: ["indoor", "outdoor", "space", "abstract"] },
      description: { type: Type.STRING },
      mood: { type: Type.STRING },
    },
    required: ["name", "type", "description", "mood"],
  };

  const SCHEMA_SCENE = {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      location: { type: Type.STRING },
      environmentDetail: { type: Type.STRING },
      description: { type: Type.STRING },
      originalTextExcerpt: { type: Type.STRING },
      charactersPresent: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
  };

  return { SCHEMA_PERSONNAGE, SCHEMA_ENVIRONNEMENT, SCHEMA_SCENE };
};

// ---------------------------------------------------------------------------
// Ce que le fichier a besoin de recevoir pour travailler
// ---------------------------------------------------------------------------

export interface OutilsAnalyse {
  /** Le `Type` du SDK Google, pour decrire les schemas de reponse. */
  Type: any;
  /** Envoie une requete au modele du role demande, avec repli sur les suivants. */
  generer: (role: "texteExpert" | "texteRapide", requete: { contents: any; config?: any }) => Promise<any>;
  /**
   * Signale l'avancement. Sert a alimenter la barre de progression du navigateur,
   * puisque le decoupage d'un roman entier peut durer plusieurs minutes.
   */
  progres?: (etape: string) => void | Promise<void>;
  /**
   * Depose un resultat partiel, deja exploitable. Les scenes sont livrees au fil
   * de l'eau : l'ecran de relecture s'ouvre des la premiere, au lieu d'attendre
   * que les vingt soient pretes.
   */
  partiel?: (donnees: { scenes: any[] }) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Localisation d'une citation dans le recit
//
// La premiere passe du decoupage en scenes renvoie, pour chaque scene, les
// premiers mots exacts de son passage. Il faut ensuite retrouver ou ces mots
// tombent dans le texte original, et c'est plus subtil qu'un `indexOf` : le
// modele recopie souvent en normalisant les apostrophes, en changeant la casse,
// ou en ecrasant un retour a la ligne. Une comparaison brute echouerait sur des
// citations pourtant justes.
// ---------------------------------------------------------------------------

/** En dessous, une citation est trop courte pour designer un endroit precis. */
const CITATION_MIN = 8;

/** Meme normalisation des deux cotes : c'est ce qui rend la recherche tolerante. */
const simplifierPourRecherche = (fragment: string): string =>
  fragment
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”«»]/g, '"');

/**
 * Prepare une recherche tolerante dans un texte donne.
 *
 * Le texte est normalise une seule fois (sans accents, en minuscules,
 * apostrophes uniformisees, suites d'espaces reduites a une), en gardant la
 * correspondance entre chaque caractere normalise et sa position d'origine.
 * La fonction rendue accepte ensuite n'importe quelle citation et renvoie sa
 * position dans le texte ORIGINAL, ou -1 si elle est introuvable.
 */
export const creerLocalisateur = (texte: string) => {
  let normalise = "";
  const positions: number[] = []; // positions[i] = index d'origine du i-eme caractere normalise
  let dansEspaces = false;

  for (let i = 0; i < texte.length; i++) {
    const caractere = texte[i];

    if (/\s/.test(caractere)) {
      // Une suite d'espaces, de tabulations ou de sauts de ligne compte pour un
      // seul espace : c'est ce qui permet de retrouver une citation que le
      // modele a recopiee sur une seule ligne.
      if (!dansEspaces) {
        normalise += " ";
        positions.push(i);
        dansEspaces = true;
      }
      continue;
    }

    dansEspaces = false;

    // Un caractere accentue se decompose parfois en plusieurs : chacun garde la
    // meme position d'origine, sans quoi la correspondance se decalerait.
    for (const morceau of simplifierPourRecherche(caractere)) {
      normalise += morceau;
      positions.push(i);
    }
  }

  /** Premier index normalise dont la position d'origine atteint `depuis`. */
  const indexNormaliseDepuis = (depuis: number): number => {
    if (depuis <= 0) return 0;
    let bas = 0;
    let haut = positions.length;
    while (bas < haut) {
      const milieu = (bas + haut) >> 1;
      if (positions[milieu] < depuis) bas = milieu + 1;
      else haut = milieu;
    }
    return bas;
  };

  return (citation: string, depuis = 0): number => {
    const cible = simplifierPourRecherche(citation || "").replace(/\s+/g, " ").trim();
    if (cible.length < CITATION_MIN) return -1;

    const trouve = normalise.indexOf(cible, indexNormaliseDepuis(depuis));
    return trouve === -1 ? -1 : positions[trouve];
  };
};

/**
 * Rapproche une position d'une vraie frontiere de lecture.
 *
 * Sert uniquement aux bornes approchees : quand une citation est introuvable, la
 * position est calculee par regle de trois, et tomberait donc au hasard, souvent
 * au milieu d'un mot. On cherche la fin de phrase ou le saut de paragraphe le
 * plus proche, dans une fenetre limitee pour ne pas deplacer la coupure loin de
 * la ou elle etait estimee.
 */
const calerSurUneFrontiere = (texte: string, position: number, marge: number): number => {
  const debut = Math.max(0, position - marge);
  const fin = Math.min(texte.length, position + marge);
  if (fin <= debut) return position;

  const fenetre = texte.slice(debut, fin);
  let meilleure = -1;
  let meilleureDistance = Infinity;

  const retenir = (candidate: number) => {
    const distance = Math.abs(candidate - position);
    if (distance < meilleureDistance) {
      meilleureDistance = distance;
      meilleure = candidate;
    }
  };

  // Un saut de ligne est la meilleure frontiere possible : c'est une vraie
  // respiration du texte, pas seulement une fin de phrase.
  for (const saut of fenetre.matchAll(/\n+/g)) {
    retenir(debut + (saut.index ?? 0) + saut[0].length);
  }
  if (meilleure !== -1) return meilleure;

  for (const phrase of fenetre.matchAll(/[.!?…]["»')\]]?\s/g)) {
    retenir(debut + (phrase.index ?? 0) + phrase[0].length);
  }

  return meilleure === -1 ? position : meilleure;
};

/** Un segment de recit correspondant a une scene. */
export interface SegmentDeScene {
  debut: number;
  fin: number;
  /** Vrai quand la borne a ete estimee faute de citation retrouvee dans le texte. */
  approche: boolean;
}

/**
 * Transforme la carte des scenes en segments de texte, sans jamais perdre un
 * caractere du recit.
 *
 * GARANTIE TENUE ICI : les segments se suivent bout a bout, du premier
 * caractere au dernier. Meme si le modele cite mal, meme s'il cite dans le
 * desordre, meme s'il invente une phrase absente du livre, le recoupage des
 * segments rend exactement le texte de depart. C'est ce qui distingue ce
 * decoupage de l'ancien : une borne ratee deplace une frontiere, elle ne fait
 * jamais disparaitre un passage.
 */
export const construireSegmentsDepuisCarte = (texte: string, citations: string[]): SegmentDeScene[] => {
  const nombre = citations.length;
  if (nombre === 0) return [{ debut: 0, fin: texte.length, approche: false }];

  const localiser = creerLocalisateur(texte);
  const bornes: number[] = new Array(nombre).fill(-1);
  const approchees: boolean[] = new Array(nombre).fill(false);

  // La premiere scene commence toujours au debut du recit, quoi que le modele
  // ait cite : rien ne doit exister avant la premiere scene.
  bornes[0] = 0;
  let dernierConnu = 0;

  for (let i = 1; i < nombre; i++) {
    // La recherche repart de la derniere borne connue : une citation qui
    // pointerait en arriere est traitee comme introuvable, sans quoi les scenes
    // se chevaucheraient et le recit ne serait plus couvert dans l'ordre.
    const position = localiser(citations[i], dernierConnu + 1);
    if (position > dernierConnu) {
      bornes[i] = position;
      dernierConnu = position;
    } else {
      approchees[i] = true;
    }
  }

  // Les bornes manquantes sont reparties entre les deux bornes connues qui les
  // encadrent, puis calees sur une fin de phrase.
  for (let i = 1; i < nombre; i++) {
    if (!approchees[i]) continue;

    let suivantConnu = i + 1;
    while (suivantConnu < nombre && approchees[suivantConnu]) suivantConnu++;

    const gauche = bornes[i - 1];
    const droite = suivantConnu < nombre ? bornes[suivantConnu] : texte.length;
    const pas = (droite - gauche) / (suivantConnu - (i - 1));

    const estimee = Math.round(gauche + pas);
    const marge = Math.min(400, Math.max(0, Math.floor(pas * 0.25)));
    const calee = calerSurUneFrontiere(texte, estimee, marge);

    // Une borne doit toujours avancer, et rester dans le texte.
    bornes[i] = Math.min(texte.length, Math.max(gauche, calee));
  }

  return bornes.map((debut, i) => ({
    debut,
    fin: i + 1 < nombre ? bornes[i + 1] : texte.length,
    approche: approchees[i],
  }));
};

// ---------------------------------------------------------------------------
// Analyse du recit : la bible graphique
// ---------------------------------------------------------------------------

/**
 * Construit la "bible graphique" du recit : personnages, decors, style suggere.
 * Le recit part entier, en un seul appel.
 */
export const analyserRecit = async (
  outils: OutilsAnalyse,
  text: string,
  charCount?: number
): Promise<any> => {
  const texte = texteValide(text, "Le texte a analyser", LIMITES.texte);
  const nombre = nombreValide(charCount, "Le nombre de personnages", 1, 60);

  const consigneNombre = nombre
    ? `Identifie exactement ${nombre} personnages, les plus importants, et 5 a 10 lieux cles.`
    : "Identifie TOUS les personnages importants et les Lieux/Decors recurrents.";

  await outils.progres?.("Lecture du recit et redaction de la bible graphique");

  const prompt = `
    Tu es le Directeur Artistique d'un studio d'animation.
    Ta mission : creer une "Bible Graphique" complete (Personnages + Decors).
    1. ${consigneNombre}
    2. PERSONNAGES : Nom, Role, Personnalite. Description physique EXTREMEMENT PRECISE
       (age apparent, morphologie, cheveux, yeux, peau, vetements, signes distinctifs).
    3. ENVIRONNEMENTS (Decors) : Nom, Description visuelle, Type ('indoor'|'outdoor'|'space'|'abstract'), Mood.
    4. Suggere un style artistique global adapte au ton du recit.
    N'invente aucun personnage absent du texte.

    TEXTE :
    "${texte}"
  `;

  const { SCHEMA_PERSONNAGE, SCHEMA_ENVIRONNEMENT } = construireSchemas(outils.Type);

  const response = await outils.generer("texteExpert", {
    contents: prompt,
    config: {
      maxOutputTokens: 32768,
      responseMimeType: "application/json",
      responseSchema: {
        type: outils.Type.OBJECT,
        properties: {
          characters: { type: outils.Type.ARRAY, items: SCHEMA_PERSONNAGE },
          environments: { type: outils.Type.ARRAY, items: SCHEMA_ENVIRONNEMENT },
          suggestedStyle: { type: outils.Type.STRING },
        },
        required: ["characters", "environments", "suggestedStyle"],
      },
    },
  });

  const parsed = lireJson(response.text || "", "Analyse du recit");
  return {
    characters: parsed.characters || [],
    environments: parsed.environments || [],
    suggestedStyle: parsed.suggestedStyle || "Concept art realiste",
  };
};

// ---------------------------------------------------------------------------
// Decoupage en scenes, en deux passes
//
// L'ancien decoupage coupait le recit a la regle, longueur totale divisee par le
// nombre de scenes demande, puis demandait UNE scene par morceau. Deux defauts
// que reglage ne pouvait pas corriger : une scene a cheval sur deux morceaux
// etait racontee deux fois, et deux scenes dans le meme morceau n'en donnaient
// qu'une, l'autre disparaissait sans trace.
//
// Passe 1, la carte : un seul appel lit le recit entier et dit ou les scenes
// commencent VRAIMENT, en citant les premiers mots de chacune. C'est le
// changement de lieu, de moment ou de personnages qui fait la coupure.
// Passe 2, les fiches : chaque scene est decrite a partir de son passage
// original exact, celui que les bornes ont delimite.
// ---------------------------------------------------------------------------

/**
 * Nombre de fiches redigees en parallele. Assez pour aller vite, assez peu pour
 * ne pas declencher le frein anti-rafale de Google.
 */
const FICHES_EN_PARALLELE = 4;

/** Une scene ne descend pas en dessous, sinon le decoupage produit des miettes. */
const SCENES_MIN = 1;
/** Plafond de securite, aligne sur ce que l'interface autorise. */
const SCENES_MAX = 60;

export const decouperEnScenes = async (
  outils: OutilsAnalyse,
  text: string,
  knownCharacters: string[],
  knownEnvironments: Array<{ id: string; name: string }> = [],
  sceneCount?: number
): Promise<{ scenes: any[] }> => {
  const texte = texteValide(text, "Le texte a decouper", LIMITES.texte);
  const persos = listeValide(knownCharacters, "Les personnages connus");
  const voulu = nombreValide(sceneCount, "Le nombre de scenes", SCENES_MIN, SCENES_MAX);
  const decors = Array.isArray(knownEnvironments)
    ? knownEnvironments.filter((e) => e && typeof e.id === "string" && typeof e.name === "string")
    : [];

  // --- Passe 1 : la carte des scenes ---------------------------------------

  await outils.progres?.("Reperage des scenes dans le recit");

  const consigneNombre = voulu
    ? `Decoupe le recit en EXACTEMENT ${voulu} scenes, en choisissant les ${voulu} moments les plus marquants.`
    : `Decoupe le recit en autant de scenes qu'il en contient reellement, sans quota impose. ` +
      `Une scene = une unite d'action continue. Vise entre 5 et 40 scenes selon la longueur.`;

  const carteBrute = await outils.generer("texteExpert", {
    contents: `
      Tu es scenariste et tu etablis le sequencier d'un recit, avant tout travail d'illustration.

      ${consigneNombre}

      QU'EST-CE QU'UNE SCENE : un bloc de recit continu, dans un meme lieu, un meme moment,
      avec les memes personnages. Une nouvelle scene commence quand le lieu change, quand le
      temps saute, ou quand la configuration des personnages change nettement.
      Ne coupe JAMAIS au milieu d'une action en cours.

      POUR CHAQUE SCENE, donne :
      - title : un titre court et evocateur
      - location : le nom du lieu, tel qu'un lecteur le nommerait
      - charactersPresent : les personnages presents. Personnages connus, a reutiliser tels
        quels quand c'est la meme personne : ${persos.join(", ") || "aucun"}
      - debutCitation : les 8 a 15 PREMIERS MOTS EXACTS de la scene, recopies mot pour mot
        depuis le texte ci-dessous, sans rien changer ni resumer. C'est ce qui permet de
        retrouver le passage : une citation approximative fait rater le decoupage.

      Les scenes doivent se suivre dans l'ordre du texte et couvrir tout le recit,
      du debut a la fin, sans trou.

      TEXTE :
      "${texte}"
    `,
    config: {
      maxOutputTokens: 32768,
      responseMimeType: "application/json",
      responseSchema: {
        type: outils.Type.OBJECT,
        properties: {
          scenes: {
            type: outils.Type.ARRAY,
            items: {
              type: outils.Type.OBJECT,
              properties: {
                title: { type: outils.Type.STRING },
                location: { type: outils.Type.STRING },
                charactersPresent: { type: outils.Type.ARRAY, items: { type: outils.Type.STRING } },
                debutCitation: { type: outils.Type.STRING },
              },
              required: ["title", "debutCitation"],
            },
          },
        },
        required: ["scenes"],
      },
    },
  });

  const carte = lireJson(carteBrute.text || "", "Reperage des scenes");
  const reperees: any[] = Array.isArray(carte.scenes)
    ? carte.scenes.filter((s: any) => s && typeof s === "object")
    : [];

  if (reperees.length === 0) {
    throw new Error(
      "Le reperage des scenes n'a rien renvoye. Relancez, ou demandez un nombre de scenes precis."
    );
  }

  const segments = construireSegmentsDepuisCarte(
    texte,
    reperees.map((s) => String(s.debutCitation || ""))
  );

  const nombreApprochees = segments.filter((s) => s.approche).length;
  if (nombreApprochees > 0) {
    console.warn(
      `Decoupage : ${nombreApprochees} borne(s) sur ${segments.length} estimee(s), citation introuvable dans le texte.`
    );
  }

  // --- Passe 2 : une fiche par scene, sur son passage original --------------

  const total = segments.length;
  const fiches: any[] = new Array(total);
  let terminees = 0;

  await outils.progres?.(`Redaction des scenes : 0 sur ${total}`);

  const { SCHEMA_SCENE } = construireSchemas(outils.Type);

  /** Rattache la scene au decor deja genere qui porte le meme lieu. */
  const decorCorrespondant = (lieu: string): string | undefined =>
    decors.find((d) => memeLieu(lieu, d.name))?.id;

  const redigerFiche = async (index: number) => {
    const segment = segments[index];
    const passage = texte.slice(segment.debut, segment.fin);
    const repere = reperees[index] || {};
    let fiche: any;

    try {
      const response = await outils.generer("texteExpert", {
        contents:
          `Tu prepares l'illustration d'une scene precise d'un recit (scene ${index + 1} sur ${total}).\n` +
          `Titre provisoire donne par le sequencier : "${repere.title || `Scene ${index + 1}`}".\n\n` +
          `Extrais de ce passage :\n` +
          `- title : un titre court et evocateur\n` +
          `- location : le nom du lieu\n` +
          `- environmentDetail : la description visuelle du decor, SANS les personnages\n` +
          `- description : l'action a illustrer, exploitable telle quelle par un illustrateur ` +
          `(qui fait quoi, cadrage, lumiere, emotion)\n` +
          `- charactersPresent : les personnages presents. Personnages connus, a reutiliser ` +
          `tels quels quand c'est la meme personne : ${persos.join(", ") || "aucun"}\n\n` +
          `N'invente rien qui ne soit pas dans le passage. Ne resume pas le recit entier, ` +
          `ce passage seul est ta matiere.\n\n` +
          `PASSAGE ORIGINAL DE LA SCENE :\n"${passage}"`,
        config: {
          maxOutputTokens: 4000,
          responseMimeType: "application/json",
          responseSchema: SCHEMA_SCENE,
        },
      });

      const meta = lireJson(response.text || "", `Scene ${index + 1}`);
      const lieu = meta.location || repere.location || "Inconnu";

      fiche = {
        title: meta.title || repere.title || `Scene ${index + 1}`,
        location: lieu,
        environmentId: decorCorrespondant(lieu),
        environmentDetail: meta.environmentDetail || "",
        description: meta.description || "Description non generee.",
        // Le passage original est conserve tel quel : c'est lui qui sera imprime
        // dans le livre, il ne doit jamais etre remplace par une reformulation.
        originalTextExcerpt: passage,
        charactersPresent: Array.isArray(meta.charactersPresent)
          ? meta.charactersPresent
          : Array.isArray(repere.charactersPresent)
            ? repere.charactersPresent
            : [],
      };
    } catch (e: any) {
      console.error(`Redaction de la scene ${index + 1} impossible`, e);
      const lieu = repere.location || "Inconnu";
      // La scene reste dans la liste, avec son passage : l'utilisateur peut la
      // reprendre a la main, rien du recit n'est perdu.
      fiche = {
        title: `${repere.title || `Scene ${index + 1}`} (a reprendre)`,
        location: lieu,
        environmentId: decorCorrespondant(lieu),
        environmentDetail: "",
        description: `Redaction impossible : ${e?.message || "erreur inconnue"}. Modifiez cette scene a la main ou relancez.`,
        originalTextExcerpt: passage,
        charactersPresent: Array.isArray(repere.charactersPresent) ? repere.charactersPresent : [],
      };
    }

    // Rangement et photo de la liste dans le MEME bloc synchrone, sans `await`
    // entre les deux. Autrement, deux fiches qui se terminent presque ensemble
    // livrent la meme photo : le navigateur verrait alors une scene apparaitre,
    // puis plus rien pendant que le compteur avance quand meme.
    fiches[index] = fiche;
    terminees += 1;

    // POURQUOI LE PASSAGE ORIGINAL EST RETIRE DES LIVRAISONS INTERMEDIAIRES
    //
    // Les scenes portent chacune leur passage du recit, et leur somme fait donc
    // le livre entier, jusqu'a 400 000 caracteres. Le navigateur relit ce tiroir
    // toutes les deux secondes : le laisser dedans lui aurait fait retelecharger
    // le roman complet a chaque sondage, soit des dizaines de megaoctets sur une
    // longue redaction, pour un texte qu'il recevra de toute facon a la fin.
    //
    // Les fiches allegees suffisent a afficher les cartes. Le resultat final,
    // lui, porte les passages complets.
    const livraison = fiches
      .filter(Boolean)
      .map(({ originalTextExcerpt, ...reste }) => ({ ...reste, originalTextExcerpt: "" }));

    await outils.progres?.(`Redaction des scenes : ${terminees} sur ${total}`);
    // Livraison au fil de l'eau : tout ce qui est pret part vers le navigateur,
    // dans l'ordre du recit, sans attendre les scenes restantes.
    await outils.partiel?.({ scenes: livraison });
  };

  // Une file d'attente plutot qu'un Promise.all sur tout : vingt appels lances
  // ensemble declencheraient le frein anti-rafale de Google.
  let prochaine = 0;
  const ouvriers = Array.from({ length: Math.min(FICHES_EN_PARALLELE, total) }, async () => {
    while (prochaine < total) {
      const index = prochaine;
      prochaine += 1;
      await redigerFiche(index);
    }
  });
  await Promise.all(ouvriers);

  return { scenes: fiches };
};

// ---------------------------------------------------------------------------
// Recherche d'elements oublies dans le recit
//
// Ces fonctions vivaient dans l'Edge Function, coupee vers 35 secondes. Elles
// lisent pourtant le recit entier : elles sont passees sur le rail de 15
// minutes le 2026-08-25, en meme temps que le decoupage en scenes.
// ---------------------------------------------------------------------------

export const trouverPersonnagesManquants = async (
  outils: OutilsAnalyse,
  text: string,
  existingNames: string[],
  countHint?: number,
  nameHints?: string
): Promise<any[]> => {
  const texte = texteValide(text, "Le texte a analyser", LIMITES.texte);
  const connus = listeValide(existingNames, "Les personnages deja trouves");
  const combien = nombreValide(countHint, "Le nombre de personnages", 1, 30);
  const indices = texteValide(nameHints, "Les indices", 1000, false);

  await outils.progres?.("Relecture du recit, recherche de personnages");

  const { SCHEMA_PERSONNAGE } = construireSchemas(outils.Type);

  const response = await outils.generer("texteExpert", {
    contents: `
      Analyse le TEXTE ci-dessous et trouve ${combien ? `exactement ${combien}` : "les"} personnages
      qui ne figurent PAS dans cette liste : ${connus.join(", ") || "(aucun pour l'instant)"}.
      Attention aux doublons deguises : un personnage deja liste sous un surnom ou un titre ne doit pas etre repropose.
      ${indices ? `Indices donnes par l'utilisateur, a suivre en priorite : ${indices}` : ""}
      Pour chacun, donne une description physique tres precise, exploitable par un illustrateur.
      N'invente aucun personnage absent du texte. Si tu n'en trouves aucun, renvoie une liste vide.

      TEXTE :
      "${texte}"
    `,
    config: {
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: {
        type: outils.Type.OBJECT,
        properties: { characters: { type: outils.Type.ARRAY, items: SCHEMA_PERSONNAGE } },
        required: ["characters"],
      },
    },
  });

  return lireJson(response.text || "", "Recherche de personnages").characters || [];
};

export const trouverDecorsManquants = async (
  outils: OutilsAnalyse,
  text: string,
  existingNames: string[],
  countHint?: number,
  nameHints?: string
): Promise<any[]> => {
  const texte = texteValide(text, "Le texte a analyser", LIMITES.texte);
  const connus = listeValide(existingNames, "Les decors deja trouves");
  const combien = nombreValide(countHint, "Le nombre de decors", 1, 30);
  const indices = texteValide(nameHints, "Les indices", 1000, false);

  await outils.progres?.("Relecture du recit, recherche de decors");

  const { SCHEMA_ENVIRONNEMENT } = construireSchemas(outils.Type);

  const response = await outils.generer("texteExpert", {
    contents: `
      Analyse le TEXTE ci-dessous et trouve ${combien ? `exactement ${combien}` : "les"} lieux ou decors importants
      qui ne figurent PAS dans cette liste : ${connus.join(", ") || "(aucun pour l'instant)"}.
      Privilegie les decors recurrents, ceux ou l'action revient plusieurs fois.
      ${indices ? `Indices donnes par l'utilisateur, a suivre en priorite : ${indices}` : ""}
      N'invente aucun lieu absent du texte. Si tu n'en trouves aucun, renvoie une liste vide.

      TEXTE :
      "${texte}"
    `,
    config: {
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: {
        type: outils.Type.OBJECT,
        properties: { environments: { type: outils.Type.ARRAY, items: SCHEMA_ENVIRONNEMENT } },
        required: ["environments"],
      },
    },
  });

  return lireJson(response.text || "", "Recherche de decors").environments || [];
};

export const trouverScenesManquantes = async (
  outils: OutilsAnalyse,
  text: string,
  existingTitles: string[],
  knownCharacters: string[],
  knownEnvironments: Array<{ id: string; name: string }> = [],
  countHint?: number,
  contentHints?: string
): Promise<any[]> => {
  const texte = texteValide(text, "Le texte a analyser", LIMITES.texte);
  const connues = listeValide(existingTitles, "Les scenes deja trouvees");
  const persos = listeValide(knownCharacters, "Les personnages connus");
  const combien = nombreValide(countHint, "Le nombre de scenes", 1, 30);
  const indices = texteValide(contentHints, "Les indices", 1000, false);
  const decors = Array.isArray(knownEnvironments)
    ? knownEnvironments.filter((e) => e && typeof e.id === "string" && typeof e.name === "string")
    : [];

  await outils.progres?.("Relecture du recit, recherche de scenes");

  const { SCHEMA_SCENE } = construireSchemas(outils.Type);

  const response = await outils.generer("texteExpert", {
    contents: `
      Analyse le TEXTE ci-dessous et trouve ${combien ? `exactement ${combien}` : "les"} scenes marquantes
      qui ne figurent PAS dans cette liste : ${connues.join(" | ") || "(aucune pour l'instant)"}.
      Personnages connus, a utiliser dans charactersPresent : ${persos.join(", ") || "aucun"}.
      ${indices ? `Indices donnes par l'utilisateur, a suivre en priorite : ${indices}` : ""}
      Pour chaque scene, recopie dans originalTextExcerpt le passage exact du texte qui lui correspond,
      mot pour mot, sans le resumer.
      N'invente aucune scene absente du texte. Si tu n'en trouves aucune, renvoie une liste vide.

      TEXTE :
      "${texte}"
    `,
    config: {
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: {
        type: outils.Type.OBJECT,
        properties: { scenes: { type: outils.Type.ARRAY, items: SCHEMA_SCENE } },
        required: ["scenes"],
      },
    },
  });

  const trouvees = lireJson(response.text || "", "Recherche de scenes").scenes || [];

  // Meme liaison automatique au decor que le decoupage complet : une scene
  // ajoutee apres coup ne doit pas etre moins bien traitee que les autres.
  return trouvees.map((scene: any) => ({
    ...scene,
    environmentId: decors.find((d) => memeLieu(String(scene?.location || ""), d.name))?.id,
  }));
};

/** Relit le recit pour completer la fiche d'un personnage precis. */
export const relirePersonnage = async (
  outils: OutilsAnalyse,
  text: string,
  characterName: string
): Promise<any> => {
  const texte = texteValide(text, "Le texte a relire", LIMITES.texte);
  const nom = texteValide(characterName, "Le nom du personnage", 300);

  await outils.progres?.(`Relecture du recit pour "${nom}"`);

  const response = await outils.generer("texteExpert", {
    contents:
      `Agis comme un expert litteraire. Relis le texte ci-dessous et concentre-toi sur le personnage "${nom}". ` +
      `Extrais une description VISUELLE COMPLETE : age apparent, morphologie, visage, cheveux, yeux, peau, ` +
      `vetements, accessoires, signes distinctifs. Ajoute son role dans l'histoire et sa psychologie. ` +
      `Appuie-toi uniquement sur le texte, n'invente rien.\n\nTEXTE :\n"${texte}"`,
    config: {
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseSchema: {
        type: outils.Type.OBJECT,
        properties: {
          role: { type: outils.Type.STRING },
          shortDescription: { type: outils.Type.STRING },
          personality: { type: outils.Type.STRING },
          physicalDescription: { type: outils.Type.STRING },
        },
      },
    },
  });

  return lireJson(response.text || "", `Relecture de "${nom}"`);
};

// ---------------------------------------------------------------------------
// Traduction des erreurs
// ---------------------------------------------------------------------------

/** Traduit les erreurs techniques de Google en phrases actionnables. */
export const messageLisible = (e: any): { message: string; status: number } => {
  const brut = String(e?.message || e || "Erreur inconnue");

  if (e instanceof ErreurDeSaisie) {
    return { message: brut, status: 400 };
  }
  if (/RESOURCE_EXHAUSTED|quota|rate limit|429/i.test(brut)) {
    return {
      message:
        "Le quota Google est atteint. Attendez une minute, ou verifiez votre plafond sur la console Google AI Studio.",
      status: 429,
    };
  }
  if (/API key|API_KEY_INVALID|PERMISSION_DENIED|401|403/i.test(brut)) {
    return {
      message: "La cle API Google est absente ou refusee. Verifiez la variable GEMINI_API_KEY sur Netlify.",
      status: 500,
    };
  }
  if (/SAFETY|PROHIBITED|blocked|filtre de contenu/i.test(brut)) {
    return { message: brut, status: 422 };
  }
  if (/Aucun modele disponible|no longer available|NOT_FOUND/i.test(brut)) {
    return {
      message: `Le modele demande n'est plus disponible chez Google. Detail : ${brut}`,
      status: 502,
    };
  }
  if (/DEADLINE_EXCEEDED|timeout|ETIMEDOUT/i.test(brut)) {
    return { message: "Google a mis trop de temps a repondre. Reessayez.", status: 504 };
  }
  // Un recit trop volumineux pour le modele doit le dire, jamais etre resume en
  // douce : c'est exactement la panne silencieuse qu'on a supprimee.
  if (/too large|exceeds the maximum|token count|input is too long/i.test(brut)) {
    return {
      message:
        "Le recit depasse ce que le modele accepte de lire en une fois. Importez-le en plusieurs parties.",
      status: 413,
    };
  }
  return { message: brut, status: 500 };
};
