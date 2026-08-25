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
 * Interet concret : les consignes envoyees au modele n'existent qu'a un seul
 * endroit. Les modifier ici les modifie partout.
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

/** Plafonds de saisie, verifies avant tout appel facturable. */
export const LIMITES = {
  texte: 400_000, // caracteres d'un recit importe
};

/** Distingue une saisie invalide (a corriger par l'utilisateur) d'une panne serveur. */
export class ErreurDeSaisie extends Error {}

export const texteValide = (valeur: unknown, nom: string, max: number): string => {
  if (valeur === undefined || valeur === null || valeur === "") {
    throw new ErreurDeSaisie(`${nom} est vide. Importez d'abord un texte.`);
  }
  if (typeof valeur !== "string") throw new ErreurDeSaisie(`${nom} n'a pas le format attendu.`);
  if (valeur.length > max) throw new ErreurDeSaisie(`${nom} depasse la taille acceptee (${max} caracteres).`);
  return valeur;
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

// ---------------------------------------------------------------------------
// Decoupage du texte
// ---------------------------------------------------------------------------

export const CHUNK_MAX = 12_000; // ce qu'un seul appel peut lire confortablement

/** Decoupe un texte en morceaux qui respectent les fins de paragraphe. */
export const decouperEnParagraphes = (texte: string, tailleCible: number): string[] => {
  const paragraphes = texte.split("\n").filter((p) => p.trim().length > 0);
  if (paragraphes.length === 0) return [texte];

  const morceaux: string[] = [];
  let courant = "";

  for (const p of paragraphes) {
    if (courant.length > 0 && courant.length + p.length > tailleCible) {
      morceaux.push(courant);
      courant = p;
    } else {
      courant = courant.length > 0 ? `${courant}\n${p}` : p;
    }
  }
  if (courant.length > 0) morceaux.push(courant);
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

  return { SCHEMA_PERSONNAGE, SCHEMA_ENVIRONNEMENT };
};

// ---------------------------------------------------------------------------
// Analyse du recit
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

/**
 * Condense un long recit avant de l'analyser.
 *
 * Un roman entier ne tient pas dans un seul appel. Plutot que de le couper net,
 * ce qui ferait disparaitre toute la fin du livre, on resume chaque tranche puis
 * on analyse l'assemblage des resumes.
 *
 * Les resumes partent en parallele : c'est la partie la plus longue, et les
 * tranches sont independantes les unes des autres.
 */
const condenserSegment = async (outils: OutilsAnalyse, segment: string): Promise<string> => {
  const tranches = decouperEnParagraphes(segment, CHUNK_MAX);
  if (tranches.length <= 1) return segment.slice(0, CHUNK_MAX);

  let faites = 0;
  await outils.progres?.(`Lecture du recit : 0 tranche sur ${tranches.length}`);

  const resumes = await Promise.all(
    tranches.map(async (tranche, i) => {
      try {
        const r = await outils.generer("texteRapide", {
          contents:
            `Resume ce passage de roman en 6 a 10 phrases. Garde les actions concretes, les personnages ` +
            `presents, les lieux et les details visuels. N'invente rien.\n\nPASSAGE :\n"${tranche.slice(0, CHUNK_MAX)}"`,
          config: { maxOutputTokens: 900 },
        });
        return r.text || tranche.slice(0, 1500);
      } catch (e) {
        // Une tranche ratee ne doit pas faire echouer tout le livre : on garde
        // son debut brut, l'analyse finale s'en accommodera.
        console.error(`Resume de la tranche ${i} impossible`, e);
        return tranche.slice(0, 1500);
      } finally {
        faites += 1;
        void outils.progres?.(`Lecture du recit : ${faites} tranches sur ${tranches.length}`);
      }
    })
  );

  return resumes.join("\n\n");
};

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

  const aAnalyser =
    texte.length > CHUNK_MAX * 3 ? await condenserSegment(outils, texte) : texte;

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
