import type { Config, Context } from "@netlify/edge-functions";
import { GoogleGenAI, Type } from "https://esm.sh/@google/genai@1.34.0";
// Meme magasin que la fonction d'arriere-plan, charge par URL comme le SDK
// Google : sous Deno, il n'y a pas de node_modules a interroger.
import { getStore } from "https://esm.sh/@netlify/blobs@11.0.1";
import {
  LIMITES,
  MAGASIN_ANALYSES,
  MODELES,
  PREFIXE_LIMITE_EDGE,
  construireSchemas,
  decouperImage,
  memePersonnage,
  estModeleIntrouvable,
  imageValide,
  listeValide,
  lireJson,
  messageLisible,
  texteValide,
} from "../shared/analyse.ts";

// La cle n'existe QUE cote serveur (variable d'environnement Netlify), jamais dans le bundle envoye au navigateur.
type Character = any;
type Environment = any;
type Scene = any;
type AnalysisResult = any;
type SceneAnalysisResult = any;
type GenConfig = any;

const getAi = () => new GoogleGenAI({ apiKey: Netlify.env.get("GEMINI_API_KEY") || "" });

// Les modeles, la traduction des erreurs, le decoupage du texte, les plafonds de
// saisie et la lecture des reponses vivent tous dans netlify/shared/analyse.ts,
// partages avec la fonction d'arriere-plan qui analyse les recits.
//
// Ils y ont ete deplaces le 2026-08-25 : ce fichier en gardait sa propre copie,
// et les deux avaient deja diverge. Le decoupage en paragraphes n'etait pas le
// meme des deux cotes, et le bug de troncature silencieuse devait donc etre
// corrige deux fois. Une seule definition rend cette classe de panne impossible.

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

// ---------------------------------------------------------------------------
// Schemas de reponse
// ---------------------------------------------------------------------------

const { SCHEMA_PERSONNAGE, SCHEMA_ENVIRONNEMENT, SCHEMA_SCENE } = construireSchemas(Type);

// CE QUI N'EST PLUS ICI, ET POURQUOI
//
// Netlify coupe une Edge Function aux alentours de 35 secondes, sans lui laisser
// le temps de repondre : le navigateur recoit un 500 vide, impossible a
// expliquer a l'utilisateur. Toute tache qui lit le recit entier a donc migre
// vers netlify/functions/analyse-background.mts et ses 15 minutes :
// l'analyse a l'import le 2026-08-25 au matin, puis le decoupage en scenes, les
// trois recherches d'elements manquants et la relecture d'un personnage le meme
// jour. Elles enchainaient plusieurs appels au modele sur un budget unique, et
// le depassaient des que le recit etait un peu long.

// ---------------------------------------------------------------------------
// Generation d'images
// ---------------------------------------------------------------------------

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

  // Les noms viennent du modele : rien ne garantit que ce sont tous des chaines.
  // Un `null` dans la liste faisait echouer toute la generation de la scene sur
  // un "Cannot read properties of null", que l'utilisateur voyait en erreur
  // technique incomprehensible sur sa vignette.
  const safeCharsPresent: string[] = Array.isArray(scene.charactersPresent)
    ? scene.charactersPresent.filter((n: unknown): n is string => typeof n === "string" && n.trim().length > 0)
    : [];

  const presentChars = personnages.filter(
    (c) =>
      typeof c?.name === "string" &&
      c.imageUrl &&
      c.status === "completed" &&
      safeCharsPresent.some((nom: string) => memePersonnage(nom, c.name))
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
// Routage
// ---------------------------------------------------------------------------

// Ne restent ici que les taches courtes : generer ou retoucher une image, et
// inventer une fiche a partir de quelques mots. Tout ce qui lit un recit entier
// est passe sur la fonction d'arriere-plan le 2026-08-25, elle dispose de 15
// minutes la ou celle-ci est coupee vers 35 secondes.
const handlers: Record<string, (...args: any[]) => Promise<any>> = {
  generateEnvironmentImage,
  generateCharacterImage,
  generateSceneImage,
  editGeneratedImage,
  createCharacterFromPrompt,
  createSceneFromPrompt,
  createEnvironmentFromPrompt,
  sendChatMessage,
};

// ---------------------------------------------------------------------------
// Limitation du nombre de requetes
//
// CE QUE CE COMPTEUR FAIT VRAIMENT
//
// Le commentaire qui figurait ici annoncait "un stockage partage entre toutes
// les instances de la fonction". C'etait faux : le code n'appelait que la table
// en memoire ci-dessous, locale au processus. Netlify fait tourner une Edge
// Function dans plusieurs regions et plusieurs instances, le plafond reel
// n'etait donc pas trente requetes par minute, mais trente par minute et par
// instance vivante. Un commentaire qui decrit une protection inexistante est
// pire que pas de commentaire du tout : il empeche de voir le trou.
//
// Le compteur passe maintenant par Netlify Blobs, comme celui de la fonction
// d'arriere-plan, avec la table en memoire conservee en premiere barriere. Si
// le stockage est indisponible, on laisse passer plutot que de bloquer quelqu'un
// de legitime : le plafond de depense fixe sur la console Google reste la seule
// protection qu'aucun contournement ne peut faire sauter.
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

/**
 * Le magasin partage, obtenu une seule fois.
 *
 * `undefined` signifie "pas encore essaye", `null` "essaye, indisponible". Sans
 * cette distinction, une premiere tentative ratee serait rejouee a chaque
 * requete, sur une fonction appelee des centaines de fois par generation.
 */
let magasinPartage: ReturnType<typeof getStore> | null | undefined;

const obtenirMagasin = (): ReturnType<typeof getStore> | null => {
  if (magasinPartage !== undefined) return magasinPartage;
  try {
    magasinPartage = getStore(MAGASIN_ANALYSES);
  } catch (e) {
    console.error("Netlify Blobs indisponible ici, le compteur de debit reste local :", e);
    magasinPartage = null;
  }
  return magasinPartage;
};

const estLimite = async (ip: string): Promise<boolean> => {
  // Premiere barriere, instantanee : elle suffit a arreter une rafale venant
  // d'une meme instance, sans le moindre aller-retour reseau.
  if (compterEnMemoire(ip)) return true;

  const magasin = obtenirMagasin();
  if (!magasin) return false;

  try {
    const cle = `${PREFIXE_LIMITE_EDGE}${ip}`;
    const maintenant = Date.now();
    const anciennes: number[] = (await magasin.get(cle, { type: "json" })) || [];
    const recentes = anciennes.filter((t: number) => maintenant - t < RATE_WINDOW_MS);
    recentes.push(maintenant);
    await magasin.setJSON(cle, recentes);
    return recentes.length > RATE_LIMIT;
  } catch (e) {
    // Bloquer un utilisateur legitime serait pire que de rater un frein.
    console.error("Compteur de debit partage indisponible, requete laissee passer :", e);
    return false;
  }
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
