import type { Config, Context } from "@netlify/edge-functions";
import { GoogleGenAI, Type } from "https://esm.sh/@google/genai@1.34.0";
import {
  MODELES,
  ErreurDeSaisie,
  estModeleIntrouvable,
  messageLisible,
} from "../shared/analyse.ts";


// La cle n'existe QUE cote serveur (variable d'environnement Netlify), jamais dans le bundle envoye au navigateur.
type Character = any;
type Environment = any;
type Scene = any;
type AnalysisResult = any;
type SceneAnalysisResult = any;
type GenConfig = any;

const getAi = () => new GoogleGenAI({ apiKey: Netlify.env.get("GEMINI_API_KEY") || "" });

// Les modeles et la traduction des erreurs vivent desormais dans netlify/shared/analyse.ts,
// partages avec la fonction d'arriere-plan qui analyse les recits.

/**
 * Lance une generation en essayant chaque modele du role jusqu'a ce que l'un
 * reponde. Seule une erreur "modele introuvable" declenche l'essai suivant :
 * un quota depasse ou un filtre de contenu doit remonter tel quel.
 */
const genererAvecRepli = async (
  role: keyof typeof MODELES,
  requete: { contents: any; config?: any }
) => {
  const modeles = MODELES[role];
  let derniereErreur: any;

  for (const model of modeles) {
    try {
      return await getAi().models.generateContent({ ...requete, model });
    } catch (e: any) {
      derniereErreur = e;
      if (!estModeleIntrouvable(e)) throw e;
      console.warn(`Modele ${model} indisponible, essai du suivant.`);
    }
  }
  throw new Error(
    `Aucun modele disponible pour cette tache. Modeles essayes : ${modeles.join(", ")}. ` +
      `Derniere reponse de Google : ${derniereErreur?.message || "inconnue"}`
  );
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
 * Analyse une reponse JSON du modele. Contrairement a la version precedente,
 * cette fonction ne renvoie plus un objet vide en silence : une reponse
 * tronquee ou illisible leve une erreur explicite, sinon l'utilisateur voyait
 * "0 personnage trouve" sans savoir que l'analyse avait echoue.
 */
const lireJson = (text: string, contexte: string): any => {
  const brut = cleanJsonText(text || "");
  if (!brut || brut === "{}") {
    throw new Error(`${contexte} : le modele n'a renvoye aucune donnee. Reessayez dans un instant.`);
  }
  try {
    return JSON.parse(brut);
  } catch {
    const tronquee = brut.length > 200 && !brut.trimEnd().endsWith("}") && !brut.trimEnd().endsWith("]");
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
// Validation des entrees
// Le point d'entree est public et devinable : tout ce qui arrive du navigateur
// est verifie avant de partir chez Google, pour que personne ne puisse faire
// gonfler la facture avec des demandes fabriquees a la main.
// ---------------------------------------------------------------------------

const LIMITES = {
  texte: 400_000, // caracteres d'un recit importe
  prompt: 4_000, // consigne libre ecrite par l'utilisateur
  image: 12_000_000, // image en base64
  liste: 200, // nombre de noms ou de titres transmis
  messages: 60, // longueur d'historique de discussion
};

// ErreurDeSaisie est importee du fichier partage : il faut que ce soit la meme
// classe des deux cotes, sinon le `instanceof` de messageLisible ne la reconnait plus.

const texteValide = (valeur: unknown, nom: string, max: number, obligatoire = true): string => {
  if (valeur === undefined || valeur === null || valeur === "") {
    if (obligatoire) throw new ErreurDeSaisie(`${nom} est vide. Importez d'abord un texte.`);
    return "";
  }
  if (typeof valeur !== "string") throw new ErreurDeSaisie(`${nom} n'a pas le format attendu.`);
  if (valeur.length > max) throw new ErreurDeSaisie(`${nom} depasse la taille acceptee (${max} caracteres).`);
  return valeur;
};

const listeValide = (valeur: unknown, nom: string): string[] => {
  if (valeur === undefined || valeur === null) return [];
  if (!Array.isArray(valeur)) throw new ErreurDeSaisie(`${nom} n'a pas le format attendu.`);
  if (valeur.length > LIMITES.liste) throw new ErreurDeSaisie(`${nom} contient trop d'elements.`);
  return valeur.filter((v) => typeof v === "string").map((v) => v.slice(0, 300));
};

const nombreValide = (valeur: unknown, nom: string, min: number, max: number): number | undefined => {
  if (valeur === undefined || valeur === null) return undefined;
  const n = Number(valeur);
  if (!Number.isFinite(n)) throw new ErreurDeSaisie(`${nom} doit etre un nombre.`);
  return Math.min(max, Math.max(min, Math.round(n)));
};

const imageValide = (valeur: unknown, nom: string, obligatoire = true): string => {
  const v = texteValide(valeur, nom, LIMITES.image, obligatoire);
  if (v && !v.startsWith("data:image/")) throw new ErreurDeSaisie(`${nom} n'est pas une image valide.`);
  return v;
};

// ---------------------------------------------------------------------------
// Decoupage du texte
// ---------------------------------------------------------------------------

const CHUNK_MAX = 12_000; // ce qu'un seul appel peut lire confortablement

/** Decoupe un texte en morceaux qui respectent les fins de paragraphe. */
const decouperEnParagraphes = (texte: string, tailleCible: number): string[] => {
  const paragraphes = texte.split("\n").filter((p) => p.trim().length > 0);
  if (paragraphes.length === 0) return [texte];

  const morceaux: string[] = [];
  let courant = "";

  for (const p of paragraphes) {
    if (courant.length > 0 && courant.length + p.length > tailleCible) {
      morceaux.push(courant);
      courant = p + "\n";
    } else {
      courant += p + "\n";
    }
  }
  if (courant.trim().length > 0) morceaux.push(courant);
  return morceaux;
};

/**
 * Repartit le recit en autant de segments que de scenes voulues.
 * Aucune troncature ici : chaque segment garde l'integralite de son texte, et
 * c'est l'analyse qui se charge de condenser les segments trop longs.
 */
const segmentTextForScenes = (text: string, targetSceneCount: number = 10): string[] => {
  const normalise = text.replace(/\r\n/g, "\n").replace(/\n\s*\n/g, "\n");
  const total = normalise.length;
  if (total < 500) return [normalise];

  const tailleCible = Math.ceil(total / targetSceneCount);
  const morceaux = decouperEnParagraphes(normalise, tailleCible);

  // Un texte sans retour a la ligne ne peut pas etre coupe proprement :
  // on le tranche alors a longueur fixe plutot que de tout garder en un bloc.
  if (morceaux.length === 1 && total > tailleCible * 1.5) {
    const forces: string[] = [];
    for (let i = 0; i < total; i += tailleCible) forces.push(normalise.slice(i, i + tailleCible));
    return forces;
  }

  // Le decoupage par paragraphes tombe rarement juste : on fusionne les
  // segments voisins les plus courts jusqu'a obtenir le nombre demande,
  // pour que "10 scenes" donne bien 10 scenes.
  while (morceaux.length > targetSceneCount && morceaux.length > 1) {
    let indexPlusCourt = 0;
    let sommeMin = Infinity;
    for (let i = 0; i < morceaux.length - 1; i++) {
      const somme = morceaux[i].length + morceaux[i + 1].length;
      if (somme < sommeMin) {
        sommeMin = somme;
        indexPlusCourt = i;
      }
    }
    morceaux.splice(indexPlusCourt, 2, morceaux[indexPlusCourt] + morceaux[indexPlusCourt + 1]);
  }

  return morceaux;
};

/**
 * Condense un segment trop long pour tenir dans un seul appel.
 * Le segment est lu par tranches, chaque tranche est resumee, et les resumes
 * sont recolles. Sans cela, les deux tiers d'un roman n'etaient jamais lus.
 */
const condenserSegment = async (segment: string): Promise<string> => {
  const tranches = decouperEnParagraphes(segment, CHUNK_MAX);
  if (tranches.length <= 1) return segment.slice(0, CHUNK_MAX);

  const resumes = await Promise.all(
    tranches.map(async (tranche, i) => {
      try {
        const r = await genererAvecRepli("texteRapide", {
          contents:
            `Resume ce passage de roman en 6 a 10 phrases. Garde les actions concretes, les personnages ` +
            `presents, les lieux et les details visuels. N'invente rien.\n\nPASSAGE :\n"${tranche.slice(0, CHUNK_MAX)}"`,
          config: { maxOutputTokens: 900 },
        });
        return r.text || tranche.slice(0, 1500);
      } catch (e) {
        console.error(`Resume de la tranche ${i} impossible`, e);
        return tranche.slice(0, 1500);
      }
    })
  );

  return resumes.join("\n\n");
};

// ---------------------------------------------------------------------------
// Schemas de reponse
// ---------------------------------------------------------------------------

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

// L'analyse d'un recit ne vit plus ici : elle demandait une trentaine de secondes
// pour le seul appel final, sur un budget d'environ 35 secondes, et tombait en
// timeout des qu'un vrai PDF s'y ajoutait. Elle est passee dans
// netlify/functions/analyse-background.mts, qui dispose de 15 minutes.

// ---------------------------------------------------------------------------
// Generation d'images
// ---------------------------------------------------------------------------

/**
 * Decompose une image encodee en son type reel et ses donnees.
 * Le type etait auparavant force a image/png alors que Google renvoie
 * souvent du JPEG : les images de reference partaient donc mal etiquetees.
 */
const decouperImage = (dataUrl: string): { mimeType: string; data: string } => {
  const correspondance = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || "");
  if (!correspondance) return { mimeType: "image/png", data: (dataUrl || "").split(",")[1] || "" };
  return { mimeType: correspondance[1], data: correspondance[2] };
};

const extraireImage = (response: any, quoi: string): string => {
  const candidate = response?.candidates?.[0];

  for (const part of candidate?.content?.parts || []) {
    if (part.inlineData) {
      // Google renvoie souvent du JPEG, pas du PNG. L'annoncer en PNG donnait
      // des fichiers telecharges avec la mauvaise extension et faisait echouer
      // l'insertion dans le PDF : on garde le type reellement recu.
      const type = part.inlineData.mimeType || "image/png";
      return `data:${type};base64,${part.inlineData.data}`;
    }
  }

  // Pas d'image : la raison est souvent un filtre de contenu, autant le dire.
  const raison = candidate?.finishReason;
  if (raison === "SAFETY" || raison === "PROHIBITED_CONTENT") {
    throw new Error(
      `${quoi} : la description a ete refusee par le filtre de contenu de Google. Reformulez-la en termes moins explicites.`
    );
  }
  if (raison === "MAX_TOKENS") throw new Error(`${quoi} : la generation a ete interrompue, reessayez.`);
  throw new Error(`${quoi} : aucune image n'a ete produite${raison ? ` (motif : ${raison})` : ""}.`);
};

const generateEnvironmentImage = async (env: Environment, stylePrompt: string, config: GenConfig): Promise<string> => {
  if (!env || typeof env !== "object") throw new Error("Le decor transmis est invalide.");
  const style = texteValide(stylePrompt, "Le style artistique", LIMITES.prompt, false) || "Concept art realiste";

  let descriptionPart = String(env.description || "").slice(0, LIMITES.prompt);
  if (env.customVisualPrompt && env.customVisualPrompt.trim().length > 0) {
    descriptionPart = `CUSTOM USER INSTRUCTION (PRIORITY):\n${env.customVisualPrompt.slice(0, LIMITES.prompt)}\n\n(Context: ${descriptionPart})`;
  }

  const fullPrompt = `
    Concept Art ENVIRONMENT DESIGN for: "${env.name}".
    VISUAL DESCRIPTION: ${descriptionPart}
    MOOD/ATMOSPHERE: ${env.mood}
    TYPE: ${env.type}
    ART STYLE: ${style}
    Quality: High detailed, cinematic, production background art.
    NO CHARACTERS. JUST THE SCENERY.
  `;

  const aspectRatio = config?.aspectRatio === "1:1" ? "16:9" : config?.aspectRatio || "4:3";

  const response = await genererAvecRepli("image", {
    contents: { parts: [{ text: fullPrompt }] },
    config: { imageConfig: { imageSize: config?.resolution || "1K", aspectRatio } },
  });

  return extraireImage(response, `Decor "${env.name}"`);
};

const generateCharacterImage = async (
  character: Character,
  stylePrompt: string,
  config: GenConfig = { resolution: "1K", aspectRatio: "1:1" }
): Promise<string> => {
  if (!character || typeof character !== "object") throw new Error("Le personnage transmis est invalide.");
  const style = texteValide(stylePrompt, "Le style artistique", LIMITES.prompt, false) || "Concept art realiste";

  let descriptionPart = String(character.physicalDescription || "").slice(0, LIMITES.prompt);
  if (character.customVisualPrompt && character.customVisualPrompt.trim().length > 0) {
    descriptionPart = `CUSTOM USER VISUAL INSTRUCTION (PRIORITY OVERRIDE):\n${character.customVisualPrompt.slice(0, LIMITES.prompt)}\n\n(Base physical description for context if needed: ${descriptionPart})`;
  }

  const fullPrompt = `
    Concept Art CHARACTER SHEET for: "${character.name}".
    Generate a wide Character Model Sheet showing THIS CHARACTER in THREE (3) distinct poses on the same image:
    1. Front View (Neutral standing). 2. Side Profile View. 3. Dynamic Action Pose (reflecting personality).
    PHYSICAL APPEARANCE & CLOTHING (Keep consistent across all 3 views): ${descriptionPart}
    PERSONALITY VIBE: ${character.personality}
    ART STYLE: ${style}
    BACKGROUND: Pure white background (#FFFFFF).
    FORMAT: Wide aspect ratio character sheet. High detail, ${config?.resolution || "1K"}.
    IMPORTANT: OUTPUT ONLY THE IMAGE. NO TEXT LABELS.
  `;

  const response = await genererAvecRepli("image", {
    contents: { parts: [{ text: fullPrompt }] },
    config: { imageConfig: { imageSize: config?.resolution || "1K", aspectRatio: config?.aspectRatio || "1:1" } },
  });

  return extraireImage(response, `Personnage "${character.name}"`);
};

const generateSceneImage = async (
  scene: Scene,
  stylePrompt: string,
  allCharacters: Character[],
  allEnvironments: Environment[],
  config: GenConfig = { resolution: "1K", aspectRatio: "16:9" }
): Promise<string> => {
  if (!scene || typeof scene !== "object") throw new Error("La scene transmise est invalide.");
  const style = texteValide(stylePrompt, "Le style artistique", LIMITES.prompt, false) || "Concept art realiste";
  const personnages = Array.isArray(allCharacters) ? allCharacters : [];
  const decors = Array.isArray(allEnvironments) ? allEnvironments : [];

  const parts: any[] = [];
  let refInstructions = "";
  let refIndex = 1;

  if (scene.environmentId) {
    const env = decors.find((e) => e.id === scene.environmentId);
    if (env && env.imageUrl) {
      parts.push({ inlineData: decouperImage(env.imageUrl) });
      refInstructions += `REFERENCE IMAGE #${refIndex} (DECOR/ENVIRONMENT) - LOW PRIORITY: Use only for color palette, texture and architectural style. DO NOT COPY THE LAYOUT if it conflicts with the action.\n`;
      refIndex++;
    }
  }

  const safeCharsPresent = scene.charactersPresent || [];
  const presentChars = personnages.filter(
    (c) =>
      safeCharsPresent.some(
        (name) =>
          name.toLowerCase().includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(name.toLowerCase())
      ) &&
      c.imageUrl &&
      c.status === "completed"
  );

  presentChars.slice(0, 2).forEach((char) => {
    if (char.imageUrl) {
      parts.push({ inlineData: decouperImage(char.imageUrl) });
      refInstructions += `REFERENCE IMAGE #${refIndex} (CHARACTER: ${char.name}) - MEDIUM PRIORITY: Use STRICTLY for facial features and clothing identity. IGNORE THE POSE in this reference image. The pose must come from the TEXT.\n`;
      refIndex++;
    }
  });

  let textPrompt = "";
  if (scene.customVisualPrompt && scene.customVisualPrompt.trim().length > 0) {
    textPrompt = `
      CUSTOM USER PROMPT (HIGHEST PRIORITY): ${scene.customVisualPrompt.slice(0, LIMITES.prompt)}
      VISUAL REFERENCES (Use for Style/Identity only): ${refInstructions}
      ART STYLE: ${style}
      OUTPUT ONLY THE IMAGE.
    `;
  } else {
    textPrompt = `
      ROLE: Director of Photography & Cinematic Concept Artist.
      *** CRITICAL PRIORITY HIERARCHY *** (1 is highest):
      1. THE NARRATIVE TEXT: the specific action described in "SCENE ACTION" below.
      2. VISUAL DESCRIPTION: camera angles, lighting, composition.
      3. CHARACTER IDENTITY (Reference Images): keep facial features/clothing, adapt pose to Priority #1.
      4. DECOR/ENVIRONMENT (Lowest Priority): use for palette/architecture/mood only.
      ---
      SCENE ACTION (THE ABSOLUTE TRUTH): "${String(scene.description || "").slice(0, LIMITES.prompt)}"
      CONTEXT (NUANCE & EMOTION): "${scene.originalTextExcerpt ? scene.originalTextExcerpt.slice(0, 600) : ""}"
      SETTING LOCATION: ${scene.location} - ${scene.environmentDetail}
      VISUAL REFERENCES PROVIDED: ${refInstructions}
      ART STYLE: ${style}
      Output: A single high-quality cinematic image.
    `;
  }

  parts.push({ text: textPrompt });

  const response = await genererAvecRepli("image", {
    contents: { parts },
    config: { imageConfig: { imageSize: config?.resolution || "1K", aspectRatio: config?.aspectRatio || "16:9" } },
  });

  return extraireImage(response, `Scene "${scene.title}"`);
};

const editGeneratedImage = async (base64Image: string, prompt: string, referenceImage?: string): Promise<string> => {
  const image = imageValide(base64Image, "L'image a modifier");
  const consigne = texteValide(prompt, "La consigne de retouche", LIMITES.prompt);
  const reference = imageValide(referenceImage, "L'image de reference", false);

  const parts: any[] = [{ inlineData: decouperImage(image) }];
  let fullPrompt = consigne;

  if (reference) {
    parts.push({ inlineData: decouperImage(reference) });
    fullPrompt += "\n\n(Use the second image provided as a STYLE/VISUAL REFERENCE for this edit).";
  }
  parts.push({ text: fullPrompt });

  const response = await genererAvecRepli("imageEdition", { contents: { parts } });
  return extraireImage(response, "Retouche");
};

// ---------------------------------------------------------------------------
// Fiches creees ou completees par l'IA
// ---------------------------------------------------------------------------

const regenerateCharacterDescription = async (text: string, characterName: string): Promise<Partial<Character>> => {
  const texte = texteValide(text, "Le texte a relire", LIMITES.texte);
  const nom = texteValide(characterName, "Le nom du personnage", 300);
  const aLire = texte.length > CHUNK_MAX * 3 ? await condenserSegment(texte) : texte;

  const response = await genererAvecRepli("texteExpert", {
    contents:
      `Agis comme un expert litteraire. Relis le texte ci-dessous et concentre-toi sur le personnage "${nom}". ` +
      `Extrais une description VISUELLE COMPLETE : age apparent, morphologie, visage, cheveux, yeux, peau, ` +
      `vetements, accessoires, signes distinctifs. Ajoute son role dans l'histoire et sa psychologie. ` +
      `Appuie-toi uniquement sur le texte, n'invente rien.\n\nTEXTE :\n"${aLire}"`,
    config: {
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          role: { type: Type.STRING },
          shortDescription: { type: Type.STRING },
          personality: { type: Type.STRING },
          physicalDescription: { type: Type.STRING },
        },
      },
    },
  });

  return lireJson(response.text || "", `Relecture de "${nom}"`);
};

const createCharacterFromPrompt = async (userPrompt: string): Promise<Omit<Character, "id" | "status" | "imageUrl">> => {
  const consigne = texteValide(userPrompt, "La description du personnage", LIMITES.prompt);
  const response = await genererAvecRepli("texteRapide", {
    contents: `Genere un profil de personnage JSON pour : "${consigne}". Invente les details manquants de facon coherente. La description physique doit etre tres precise et exploitable par un illustrateur.`,
    config: { maxOutputTokens: 2048, responseMimeType: "application/json", responseSchema: SCHEMA_PERSONNAGE },
  });
  return lireJson(response.text || "", "Creation du personnage");
};

const createSceneFromPrompt = async (
  userPrompt: string,
  availableCharacters: string[]
): Promise<Omit<Scene, "id" | "status" | "imageUrl">> => {
  const consigne = texteValide(userPrompt, "La description de la scene", LIMITES.prompt);
  const persos = listeValide(availableCharacters, "La liste des personnages");
  const response = await genererAvecRepli("texteRapide", {
    contents: `Genere une scene JSON pour : "${consigne}". Personnages disponibles : ${persos.join(", ") || "aucun"}. N'utilise dans charactersPresent que des noms de cette liste.`,
    config: { maxOutputTokens: 2048, responseMimeType: "application/json", responseSchema: SCHEMA_SCENE },
  });
  return lireJson(response.text || "", "Creation de la scene");
};

const createEnvironmentFromPrompt = async (
  userPrompt: string
): Promise<Omit<Environment, "id" | "status" | "imageUrl">> => {
  const consigne = texteValide(userPrompt, "La description du lieu", LIMITES.prompt);
  const response = await genererAvecRepli("texteRapide", {
    contents: `Genere un profil de lieu/decor JSON pour : "${consigne}". Invente les details visuels de facon coherente.`,
    config: { maxOutputTokens: 2048, responseMimeType: "application/json", responseSchema: SCHEMA_ENVIRONNEMENT },
  });
  return lireJson(response.text || "", "Creation du decor");
};

// ---------------------------------------------------------------------------
// Recherche d'elements oublies dans le recit
//
// Ces trois fonctions recevaient bien le texte mais ne le transmettaient jamais
// au modele : il repondait donc a partir de rien, en inventant. Le texte, la
// quantite demandee et les elements deja trouves sont maintenant tous fournis.
// ---------------------------------------------------------------------------

/** Prepare le texte du recit pour une recherche ciblee. */
const texteALire = async (text: string): Promise<string> => {
  const texte = texteValide(text, "Le texte a analyser", LIMITES.texte);
  return texte.length > CHUNK_MAX * 3 ? await condenserSegment(texte) : texte;
};

const findMissingEnvironments = async (
  text: string,
  existingNames: string[],
  countHint?: number,
  nameHints?: string
): Promise<Omit<Environment, "id" | "status" | "imageUrl">[]> => {
  const aLire = await texteALire(text);
  const connus = listeValide(existingNames, "Les decors deja trouves");
  const combien = nombreValide(countHint, "Le nombre de decors", 1, 30);
  const indices = texteValide(nameHints, "Les indices", 1000, false);

  const response = await genererAvecRepli("texteExpert", {
    contents: `
      Analyse le TEXTE ci-dessous et trouve ${combien ? `exactement ${combien}` : "les"} lieux ou decors importants
      qui ne figurent PAS dans cette liste : ${connus.join(", ") || "(aucun pour l'instant)"}.
      Privilegie les decors recurrents, ceux ou l'action revient plusieurs fois.
      ${indices ? `Indices donnes par l'utilisateur, a suivre en priorite : ${indices}` : ""}
      N'invente aucun lieu absent du texte. Si tu n'en trouves aucun, renvoie une liste vide.

      TEXTE :
      "${aLire}"
    `,
    config: {
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: { environments: { type: Type.ARRAY, items: SCHEMA_ENVIRONNEMENT } },
        required: ["environments"],
      },
    },
  });

  return lireJson(response.text || "", "Recherche de decors").environments || [];
};

const findMissingCharacters = async (
  text: string,
  existingNames: string[],
  countHint?: number,
  nameHints?: string
): Promise<Omit<Character, "id" | "status" | "imageUrl">[]> => {
  const aLire = await texteALire(text);
  const connus = listeValide(existingNames, "Les personnages deja trouves");
  const combien = nombreValide(countHint, "Le nombre de personnages", 1, 30);
  const indices = texteValide(nameHints, "Les indices", 1000, false);

  const response = await genererAvecRepli("texteExpert", {
    contents: `
      Analyse le TEXTE ci-dessous et trouve ${combien ? `exactement ${combien}` : "les"} personnages
      qui ne figurent PAS dans cette liste : ${connus.join(", ") || "(aucun pour l'instant)"}.
      Attention aux doublons deguises : un personnage deja liste sous un surnom ou un titre ne doit pas etre repropose.
      ${indices ? `Indices donnes par l'utilisateur, a suivre en priorite : ${indices}` : ""}
      Pour chacun, donne une description physique tres precise, exploitable par un illustrateur.
      N'invente aucun personnage absent du texte. Si tu n'en trouves aucun, renvoie une liste vide.

      TEXTE :
      "${aLire}"
    `,
    config: {
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: { characters: { type: Type.ARRAY, items: SCHEMA_PERSONNAGE } },
        required: ["characters"],
      },
    },
  });

  return lireJson(response.text || "", "Recherche de personnages").characters || [];
};

const findMissingScenes = async (
  text: string,
  existingTitles: string[],
  knownCharacters: string[],
  countHint?: number,
  contentHints?: string
): Promise<Omit<Scene, "id" | "status" | "imageUrl">[]> => {
  const aLire = await texteALire(text);
  const connues = listeValide(existingTitles, "Les scenes deja trouvees");
  const persos = listeValide(knownCharacters, "Les personnages connus");
  const combien = nombreValide(countHint, "Le nombre de scenes", 1, 30);
  const indices = texteValide(contentHints, "Les indices", 1000, false);

  const response = await genererAvecRepli("texteExpert", {
    contents: `
      Analyse le TEXTE ci-dessous et trouve ${combien ? `exactement ${combien}` : "les"} scenes marquantes
      qui ne figurent PAS dans cette liste : ${connues.join(" | ") || "(aucune pour l'instant)"}.
      Personnages connus, a utiliser dans charactersPresent : ${persos.join(", ") || "aucun"}.
      ${indices ? `Indices donnes par l'utilisateur, a suivre en priorite : ${indices}` : ""}
      Pour chaque scene, recopie dans originalTextExcerpt le passage exact du texte qui lui correspond.
      N'invente aucune scene absente du texte. Si tu n'en trouves aucune, renvoie une liste vide.

      TEXTE :
      "${aLire}"
    `,
    config: {
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: { scenes: { type: Type.ARRAY, items: SCHEMA_SCENE } },
        required: ["scenes"],
      },
    },
  });

  return lireJson(response.text || "", "Recherche de scenes").scenes || [];
};

// ---------------------------------------------------------------------------
// Assistant de discussion
// Il recoit desormais l'etat du projet : sans cela, il ne savait pas qui etait
// "Paul" quand on lui posait une question sur un personnage.
// ---------------------------------------------------------------------------

const sendChatMessage = async (history: any[], message: string, image?: string, projet?: any): Promise<string> => {
  const texte = texteValide(message, "Le message", LIMITES.prompt, false);
  const img = imageValide(image, "L'image jointe", false);
  if (!texte && !img) throw new Error("Le message est vide.");

  const historique = Array.isArray(history) ? history.slice(-LIMITES.messages) : [];

  let contexte =
    "Tu es l'assistant creatif de CharacGen Studio, un outil qui transforme un recit en livre illustre. " +
    "Tu reponds en francais, de facon concise et concrete. Tu aides a affiner les descriptions de personnages, " +
    "de decors et de scenes pour obtenir de meilleures images.";

  if (projet && typeof projet === "object") {
    const persos = Array.isArray(projet.personnages) ? projet.personnages.slice(0, 40) : [];
    const decors = Array.isArray(projet.decors) ? projet.decors.slice(0, 40) : [];
    const scenes = Array.isArray(projet.scenes) ? projet.scenes.slice(0, 40) : [];

    contexte += "\n\nETAT ACTUEL DU PROJET DE L'UTILISATEUR :";
    if (projet.etape) contexte += `\nEtape en cours : ${String(projet.etape).slice(0, 80)}`;
    if (projet.style) contexte += `\nStyle artistique retenu : ${String(projet.style).slice(0, 500)}`;
    if (persos.length) {
      contexte += `\n\nPERSONNAGES (${persos.length}) :\n`;
      contexte += persos
        .map((c: any) => `- ${c.name} (${c.role || "role non defini"}) : ${String(c.physicalDescription || "").slice(0, 300)}`)
        .join("\n");
    }
    if (decors.length) {
      contexte += `\n\nDECORS (${decors.length}) :\n`;
      contexte += decors.map((e: any) => `- ${e.name} (${e.type}) : ${String(e.description || "").slice(0, 200)}`).join("\n");
    }
    if (scenes.length) {
      contexte += `\n\nSCENES (${scenes.length}) :\n`;
      contexte += scenes.map((s: any, i: number) => `${i + 1}. ${s.title} - ${String(s.description || "").slice(0, 160)}`).join("\n");
    }
    if (projet.extraitTexte) {
      contexte += `\n\nDEBUT DU RECIT IMPORTE :\n"${String(projet.extraitTexte).slice(0, 4000)}"`;
    }
    contexte += "\n\nAppuie-toi sur ces elements pour repondre. Si l'utilisateur parle d'un personnage, c'est l'un de ceux ci-dessus.";
  } else {
    contexte += "\n\nL'utilisateur n'a pas encore importe de recit.";
  }

  const parts: any[] = [{ text: texte || "Analyse cette image." }];
  if (img) parts.push({ inlineData: decouperImage(img) });

  for (const modele of MODELES.texteExpert) {
    try {
      const chat = getAi().chats.create({
        model: modele,
        history: historique,
        config: { systemInstruction: contexte },
      });
      const res = await chat.sendMessage({ message: parts });
      return res.text || "";
    } catch (e: any) {
      if (!estModeleIntrouvable(e)) throw e;
    }
  }
  throw new Error("Aucun modele de discussion n'est disponible actuellement.");
};

// ---------------------------------------------------------------------------
// Decoupage en scenes
// ---------------------------------------------------------------------------

const analyzeScenes = async (text: string, knownCharacters: string[], sceneCount?: number): Promise<SceneAnalysisResult> => {
  const texte = texteValide(text, "Le texte a decouper", LIMITES.texte);
  const persos = listeValide(knownCharacters, "Les personnages connus");
  const targetCount = nombreValide(sceneCount, "Le nombre de scenes", 1, 60) || 10;

  const segments = segmentTextForScenes(texte, targetCount);
  const allScenes: Omit<Scene, "id" | "status" | "imageUrl">[] = [];

  const BATCH_SIZE = 3;
  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async (segment, batchIndex) => {
        const globalIndex = i + batchIndex;
        try {
          await wait(batchIndex * 300);

          // Un segment plus long que ce qu'un appel peut lire est condense,
          // jamais tronque : aucune partie du recit n'est ignoree.
          const aLire = segment.length > CHUNK_MAX ? await condenserSegment(segment) : segment;

          const response = await genererAvecRepli("texteExpert", {
            contents:
              `Analyse ce segment de recit (${globalIndex + 1} sur ${segments.length}). ` +
              `Cree UNE SEULE scene principale qui resume l'action de ce segment. ` +
              `Extrais : un titre court, le lieu, une description visuelle exploitable par un illustrateur, ` +
              `et les personnages presents. Personnages connus : ${persos.join(", ") || "aucun"}. ` +
              `N'utilise que des noms de cette liste quand c'est possible.\n\nSEGMENT :\n"${aLire}"`,
            config: {
              maxOutputTokens: 4000,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  location: { type: Type.STRING },
                  environmentDetail: { type: Type.STRING },
                  description: { type: Type.STRING },
                  charactersPresent: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
              },
            },
          });

          const meta = lireJson(response.text || "", `Scene ${globalIndex + 1}`);
          return {
            title: meta.title || `Scene ${globalIndex + 1}`,
            location: meta.location || "Inconnu",
            environmentDetail: meta.environmentDetail || "",
            description: meta.description || "Description non generee.",
            originalTextExcerpt: segment, // le texte integral du segment est conserve pour le livre
            charactersPresent: meta.charactersPresent || [],
          };
        } catch (e: any) {
          console.error(`Analyse du segment ${globalIndex} impossible`, e);
          return {
            title: `Scene ${globalIndex + 1} (a reprendre)`,
            location: "Inconnu",
            environmentDetail: "",
            description: `Analyse impossible : ${e?.message || "erreur inconnue"}. Modifiez cette scene a la main ou relancez.`,
            originalTextExcerpt: segment,
            charactersPresent: [],
          };
        }
      })
    );

    allScenes.push(...batchResults);
  }

  return { scenes: allScenes };
};

// ---------------------------------------------------------------------------
// Routage
// ---------------------------------------------------------------------------

const handlers: Record<string, (...args: any[]) => Promise<any>> = {
  generateEnvironmentImage,
  generateCharacterImage,
  generateSceneImage,
  editGeneratedImage,
  regenerateCharacterDescription,
  createCharacterFromPrompt,
  createSceneFromPrompt,
  createEnvironmentFromPrompt,
  findMissingEnvironments,
  findMissingCharacters,
  findMissingScenes,
  sendChatMessage,
  analyzeScenes,
};

// ---------------------------------------------------------------------------
// Limitation du nombre de requetes
//
// Le compteur vit dans un stockage partage entre toutes les instances de la
// fonction : un compteur garde en memoire vive repartait de zero a chaque
// demarrage, et ne comptait donc presque rien.
// Le plafond de depense fixe sur la console Google reste la protection ultime.
// ---------------------------------------------------------------------------

const RATE_LIMIT = 30; // requetes
const RATE_WINDOW_MS = 60_000; // par minute

const compteurLocal = new Map<string, number[]>();

const compterEnMemoire = (ip: string): boolean => {
  const now = Date.now();
  const marques = (compteurLocal.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  marques.push(now);
  compteurLocal.set(ip, marques);

  // Purge des adresses inactives, sinon la table grossit indefiniment.
  if (compteurLocal.size > 500) {
    for (const [cle, valeurs] of compteurLocal) {
      if (valeurs.every((t) => now - t >= RATE_WINDOW_MS)) compteurLocal.delete(cle);
    }
  }
  return marques.length > RATE_LIMIT;
};

const estLimite = async (ip: string): Promise<boolean> => {
  // Une Edge Function garde son etat plus longtemps qu'une fonction classique,
  // qui repartait de zero a chaque demarrage : ce compteur freine reellement les
  // rafales. Le plafond de depense fixe sur la console Google reste toutefois la
  // seule protection qu'aucun contournement ne peut faire sauter.
  return compterEnMemoire(ip);
};

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Methode non autorisee" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!Netlify.env.get("GEMINI_API_KEY")) {
    return new Response(
      JSON.stringify({ error: "La cle GEMINI_API_KEY n'est pas configuree sur le serveur." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const ip = context.ip || "unknown";
  if (await estLimite(ip)) {
    return new Response(JSON.stringify({ error: "Trop de requetes, reessayez dans une minute." }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const corps = await req.json().catch(() => null);
    if (!corps || typeof corps !== "object") {
      return new Response(JSON.stringify({ error: "Requete illisible." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { fn, args } = corps as { fn: string; args: unknown[] };

    if (typeof fn !== "string" || !Object.prototype.hasOwnProperty.call(handlers, fn)) {
      return new Response(JSON.stringify({ error: `Fonction inconnue : ${fn}` }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (args !== undefined && !Array.isArray(args)) {
      return new Response(JSON.stringify({ error: "Arguments invalides." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const result = await handlers[fn](...(args || []));
    return new Response(JSON.stringify({ result }), { headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("Erreur fonction gemini :", e);
    const { message, status } = messageLisible(e);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = {
  path: "/api/gemini",
};
