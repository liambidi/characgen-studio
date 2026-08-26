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

/**
 * Nombre de planches personnage envoyees en reference sur une meme scene.
 *
 * Il etait de deux, et les personnages suivants ne recevaient RIEN, ni image ni
 * description : le modele leur inventait un visage. Trois est un compromis
 * assume et non mesure : chaque planche supplementaire aide a tenir l'identite,
 * mais augmente aussi le risque que le modele melange deux visages. Les
 * personnages au dela partent en description ecrite, ce qui vaut mieux que rien.
 */
const REFERENCES_PERSONNAGE_MAX = 3;

/**
 * Consignes communes a toutes les images du livre.
 *
 * Elles sont placees en TETE du prompt, et non en queue comme avant. Un modele
 * d'image pondere davantage le debut de la consigne : le style arrivait en
 * derniere ligne, apres l'action et les references, et derivait d'une image a
 * l'autre.
 */
const enTeteArtistique = (style: string): string =>
  `ART DIRECTION, identical for every image of this book, never drift from it:\n${style}\n`;

/** Ce qu'aucune image du livre ne doit etre, quelle que soit la scene. */
const INTERDITS_COMMUNS =
  `Output a single finished illustration. NO text, NO caption, NO watermark, NO panel border, ` +
  `NO collage, NO split screen, NO grid of thumbnails, NO character sheet layout, ` +
  `NO multiple views of the same moment.`;

const generateEnvironmentImage = async (env: Environment, stylePrompt: string, config: GenConfig): Promise<string> => {
  if (!env || typeof env !== "object") throw new Error("Le decor transmis est invalide.");
  const style = texteValide(stylePrompt, "Le style artistique", LIMITES.prompt, false) || "Concept art realiste";

  let descriptionPart = String(env.description || "").slice(0, LIMITES.prompt);
  if (env.customVisualPrompt && env.customVisualPrompt.trim().length > 0) {
    descriptionPart = `CUSTOM USER INSTRUCTION (PRIORITY):\n${env.customVisualPrompt.slice(0, LIMITES.prompt)}\n\n(Context: ${descriptionPart})`;
  }

  const fullPrompt = `
    ${enTeteArtistique(style)}
    ENVIRONMENT DESIGN for: "${env.name}".
    VISUAL DESCRIPTION: ${descriptionPart}
    MOOD/ATMOSPHERE: ${env.mood}
    TYPE: ${env.type}
    Quality: High detailed, cinematic, production background art.
    NO CHARACTERS. JUST THE SCENERY.
    ${INTERDITS_COMMUNS}
  `;

  // Le decor suit le cadrage demande, sans exception. Cette ligne remplacait
  // silencieusement un cadrage carre par du 16:9, et retombait sur 4:3 des que
  // rien n'etait transmis. Comme le format n'etait choisi que deux ecrans plus
  // loin, ce repli etait le cas courant : tous les decors sortaient en 4:3,
  // quel que soit le format du livre choisi ensuite.
  const aspectRatio = config?.aspectRatio || "4:3";

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

  // La planche est explicitement decrite comme UNE personne vue trois fois.
  // C'est la meme formulation que celle envoyee aux scenes : le modele doit
  // comprendre des deux cotes qu'il n'y a qu'un individu sur cette image.
  const fullPrompt = `
    ${enTeteArtistique(style)}
    CHARACTER MODEL SHEET for ONE single person named "${character.name}".
    Draw THE SAME PERSON three times, side by side on one wide horizontal image:
    1. Front view, neutral standing. 2. Side profile view. 3. Action pose reflecting personality.
    These are three views of ONE individual, not three different characters.
    PHYSICAL APPEARANCE & CLOTHING, strictly identical in the three views: ${descriptionPart}
    PERSONALITY VIBE: ${character.personality}
    BACKGROUND: plain white (#FFFFFF), no scenery, no props beyond what the person wears or holds.
    LAYOUT: the three figures aligned horizontally, full body, evenly spaced, none cropped.
    Output only the image, no text labels, no name plate, no annotation.
  `;

  const response = await genererAvecRepli("image", {
    contents: { parts: [{ text: fullPrompt }] },
    // Une planche a trois figures cote a cote a besoin de largeur. Elle etait
    // demandee en 1:1 alors que le prompt reclamait un format large, et les
    // trois vues se marchaient dessus.
    config: { imageConfig: { imageSize: config?.resolution || "1K", aspectRatio: config?.aspectRatio || "3:2" } },
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
  const consignesReferences: string[] = [];
  let refIndex = 1;

  // --- Le casting ---------------------------------------------------------
  //
  // Les noms viennent du modele : rien ne garantit que ce sont tous des chaines.
  // Un `null` dans la liste faisait echouer toute la generation de la scene sur
  // un "Cannot read properties of null", que l'utilisateur voyait en erreur
  // technique incomprehensible sur sa vignette.
  const safeCharsPresent: string[] = Array.isArray(scene.charactersPresent)
    ? scene.charactersPresent.filter((n: unknown): n is string => typeof n === "string" && n.trim().length > 0)
    : [];

  const presents = personnages.filter(
    (c) =>
      typeof c?.name === "string" &&
      safeCharsPresent.some((nom: string) => memePersonnage(nom, c.name))
  );

  const avecPlanche = presents.filter((c) => c.imageUrl && c.status === "completed");
  const references = avecPlanche.slice(0, REFERENCES_PERSONNAGE_MAX);
  // Ceux qui ne rentrent pas dans les references partent en description ecrite.
  // Avant, au dela de deux personnages, ils ne recevaient rien du tout et le
  // modele leur inventait un visage.
  const decrits = presents.filter((c) => !references.includes(c));

  references.forEach((char) => {
    parts.push({ inlineData: decouperImage(char.imageUrl) });
    // LA phrase qui manquait. La planche montre trois fois la meme personne, et
    // le prompt ne le disait nulle part : le modele recopiait donc parfois deux
    // de ces vues dans la scene, et le personnage se retrouvait dedouble.
    consignesReferences.push(
      `REFERENCE #${refIndex} is the CHARACTER MODEL SHEET of ${char.name}. ` +
        `It shows THE SAME SINGLE PERSON drawn three times (front, profile, action) for identification only. ` +
        `${char.name} is ONE person, not three. ` +
        `Take from it the face, the hair and the clothing identity. ` +
        `Do NOT reproduce its poses, its white background, its layout, or its number of figures.`
    );
    refIndex++;
  });

  // --- Le decor -----------------------------------------------------------
  //
  // Par defaut il n'est plus envoye en image. Une image de decor pese bien plus
  // qu'une phrase demandant de ne pas en copier la composition : le plan se
  // retrouvait cadre comme le decor, quelle que soit l'action. Il repart en
  // image seulement si l'utilisateur a coche le verrou sur cette scene.
  const decor = scene.environmentId ? decors.find((e) => e.id === scene.environmentId) : undefined;
  const decorVerrouille = Boolean(scene.verrouillerDecor) && Boolean(decor?.imageUrl);

  if (decorVerrouille && decor?.imageUrl) {
    parts.push({ inlineData: decouperImage(decor.imageUrl) });
    consignesReferences.push(
      `REFERENCE #${refIndex} is the LOCKED SET of "${decor.name}". ` +
        `The user asked for this exact place: keep its architecture, its palette and its materials. ` +
        `The camera angle and the staging still come from the SCENE ACTION.`
    );
    refIndex++;
  }

  const decorEnMots = [
    scene.location ? `Place: ${scene.location}.` : "",
    scene.environmentDetail ? `${scene.environmentDetail}` : "",
    decor && !decorVerrouille ? `${decor.description || ""} Atmosphere: ${decor.mood || ""}` : "",
  ]
    .filter((m) => m && m.trim().length > 0)
    .join(" ")
    .slice(0, LIMITES.prompt);

  // --- La regle de casting, comptee ---------------------------------------
  const nomsDuPlan = safeCharsPresent.length > 0 ? safeCharsPresent : presents.map((c) => c.name);
  const regleCasting =
    nomsDuPlan.length > 0
      ? `CASTING RULE, non negotiable: this shot contains exactly ${nomsDuPlan.length} named ` +
        `character${nomsDuPlan.length > 1 ? "s" : ""}: ${nomsDuPlan.join(", ")}. ` +
        `Each of them appears EXACTLY ONCE. No duplicate of the same person, no twin, no mirrored copy, ` +
        `no extra background figure that resembles any of them.`
      : `CASTING RULE: no named character in this shot. Do not add people unless the action requires them.`;

  const descriptionsEcrites =
    decrits.length > 0
      ? `NO REFERENCE IMAGE for the following characters, follow these written descriptions strictly:\n` +
        decrits
          .map((c) => `- ${c.name}: ${String(c.physicalDescription || "").slice(0, 600)}`)
          .join("\n")
      : "";

  // --- La consigne de l'utilisateur ---------------------------------------
  //
  // Elle etait un REMPLACEMENT du prompt entier : ecrire trois mots dans ce
  // champ effacait la hierarchie de priorite, la regle de casting et les
  // consignes de reference. C'est desormais un ajout, place au sommet.
  const consigneUtilisateur = String(scene.customVisualPrompt || "").trim().slice(0, LIMITES.prompt);

  const priorites = [
    consigneUtilisateur ? "0. USER INSTRUCTION below. It overrides anything that contradicts it." : "",
    "1. SCENE ACTION below. It is what the image shows.",
    "2. CASTING RULE below. Never break it.",
    "3. Character identity taken from the model sheets: face, hair, clothes.",
    "4. Setting: a place to stage the action in, never a layout to copy.",
  ].filter(Boolean);

  const textPrompt = `
${enTeteArtistique(style)}
ROLE: director of photography and cinematic concept artist.

PRIORITY ORDER, highest first:
${priorites.join("\n")}
${consigneUtilisateur ? `\nUSER INSTRUCTION: ${consigneUtilisateur}\n` : ""}
SCENE ACTION: "${String(scene.description || "").slice(0, LIMITES.prompt)}"
NARRATIVE CONTEXT, for nuance and emotion only: "${scene.originalTextExcerpt ? scene.originalTextExcerpt.slice(0, 600) : ""}"
SETTING: ${decorEnMots || "unspecified, infer it from the scene action"}

${regleCasting}
${descriptionsEcrites}
${consignesReferences.length > 0 ? `\nREFERENCE IMAGES PROVIDED:\n${consignesReferences.join("\n")}` : ""}

${INTERDITS_COMMUNS}
  `;

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
