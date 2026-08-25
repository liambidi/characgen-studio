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
 * Interet concret : les consignes envoyees au modele, le decoupage du texte, les
 * plafonds de saisie et la lecture des reponses n'existent qu'a un seul endroit.
 * Tant qu'ils vivaient en double, les deux copies divergeaient sans que rien ne
 * le signale, et le bug de troncature silencieuse n'etait corrige que d'un cote.
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
 * resultat de chaque analyse, et ou la fonction de statut vient les lire.
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

// ---------------------------------------------------------------------------
// Decoupage du texte
// ---------------------------------------------------------------------------

export const CHUNK_MAX = 12_000; // ce qu'un seul appel peut lire confortablement

/**
 * Coupe un paragraphe plus long que la taille cible.
 *
 * POURQUOI CETTE FONCTION EXISTE
 *
 * Le decoupage se faisait uniquement sur les retours a la ligne. Un fichier texte
 * colle d'un seul bloc, ou un PDF dont l'extraction n'a produit aucun saut de
 * ligne, donnait donc UN seul morceau contenant tout le roman. Ce morceau etait
 * ensuite ramene a 12 000 caracteres par un `slice`, en silence : sur un recit
 * de 400 000 caracteres, 97 % du livre n'etait jamais lu, et rien ne le disait.
 *
 * On coupe donc a la fin de phrase la plus proche, a defaut sur une espace, et
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
 * Aucun morceau ne depasse la taille cible : c'est cette garantie qui empeche
 * la troncature silencieuse decrite dans `couperParagrapheLong`.
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
    // Un paragraphe deja plus long que la cible ne peut pas etre accumule :
    // c'est exactement le cas qui produisait un morceau geant, puis tronque.
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
// Condensation d'un long passage
// ---------------------------------------------------------------------------

/** Ce que le fichier a besoin de recevoir pour travailler. */
export interface OutilsAnalyse {
  /** Le `Type` du SDK Google, pour decrire les schemas de reponse. */
  Type: any;
  /** Envoie une requete au modele du role demande, avec repli sur les suivants. */
  generer: (role: "texteExpert" | "texteRapide", requete: { contents: any; config?: any }) => Promise<any>;
  /**
   * Signale l'avancement. Sert a alimenter la barre de progression du navigateur,
   * puisque l'analyse d'un roman entier peut durer plusieurs minutes.
   */
  progres?: (etape: string) => void | Promise<void>;
}

/** Ce qu'on garde d'une tranche dont le resume a echoue deux fois de suite. */
const REPLI_TRANCHE = 2_500;

const CONSIGNE_RESUME =
  `Resume ce passage de roman en 6 a 10 phrases. Garde les actions concretes, les personnages ` +
  `presents, les lieux et les details visuels. N'invente rien.`;

/**
 * Condense un long recit avant de l'analyser.
 *
 * Un roman entier ne tient pas dans un seul appel. Plutot que de le couper net,
 * ce qui ferait disparaitre toute la fin du livre, on resume chaque tranche puis
 * on analyse l'assemblage des resumes.
 *
 * Les resumes partent en parallele : c'est la partie la plus longue, et les
 * tranches sont independantes les unes des autres.
 *
 * `libelle` sert a nommer l'avancement affiche au navigateur.
 */
export const condenserSegment = async (
  outils: OutilsAnalyse,
  segment: string,
  libelle = "Lecture du recit"
): Promise<string> => {
  const tranches = decouperEnParagraphes(segment, CHUNK_MAX);

  // Une seule tranche : elle tient deja dans un appel, il n'y a rien a condenser.
  // Aucun `slice` ici, c'est lui qui faisait disparaitre les romans d'un bloc.
  if (tranches.length <= 1) return tranches[0] ?? segment;

  let faites = 0;
  await outils.progres?.(`${libelle} : 0 tranche sur ${tranches.length}`);

  const resumes = await Promise.all(
    tranches.map(async (tranche, i) => {
      // Un echec passager de Google ne doit pas amputer le livre d'une tranche
      // entiere : on retente une fois avant de se rabattre sur le texte brut.
      for (let essai = 0; essai < 2; essai++) {
        try {
          const r = await outils.generer("texteRapide", {
            contents: `${CONSIGNE_RESUME}\n\nPASSAGE :\n"${tranche}"`,
            config: { maxOutputTokens: 900 },
          });
          const resume = r?.text?.trim();
          if (resume) {
            faites += 1;
            void outils.progres?.(`${libelle} : ${faites} tranches sur ${tranches.length}`);
            return resume;
          }
        } catch (e) {
          console.error(`Resume de la tranche ${i} impossible (essai ${essai + 1})`, e);
        }
      }

      faites += 1;
      void outils.progres?.(`${libelle} : ${faites} tranches sur ${tranches.length}`);
      // Repli : on garde le debut brut de la tranche, l'analyse finale s'en accommode.
      return tranche.slice(0, REPLI_TRANCHE);
    })
  );

  return resumes.join("\n\n");
};

/**
 * Prepare un texte pour un appel unique : condense s'il est trop long, tel quel sinon.
 * Le seuil vaut trois tranches, en dessous duquel resumer couterait plus cher que lire.
 */
export const preparerTexte = (
  outils: OutilsAnalyse,
  texte: string,
  libelle?: string
): Promise<string> | string => (texte.length > CHUNK_MAX * 3 ? condenserSegment(outils, texte, libelle) : texte);

// ---------------------------------------------------------------------------
// Analyse du recit
// ---------------------------------------------------------------------------

/**
 * Construit la "bible graphique" du recit : personnages, decors, style suggere.
 */
export const analyserRecit = async (
  outils: OutilsAnalyse,
  text: string,
  charCount?: number
): Promise<any> => {
  const texte = texteValide(text, "Le texte a analyser", LIMITES.texte);
  const nombre = nombreValide(charCount, "Le nombre de personnages", 1, 60);

  const aAnalyser = await preparerTexte(outils, texte);

  const consigneNombre = nombre
    ? `Identifie exactement ${nombre} personnages, les plus importants, et 5 a 10 lieux cles.`
    : "Identifie TOUS les personnages importants et les Lieux/Decors recurrents.";

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
    "${aAnalyser}"
  `;

  await outils.progres?.("Redaction de la bible graphique");

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
  return { message: brut, status: 500 };
};
