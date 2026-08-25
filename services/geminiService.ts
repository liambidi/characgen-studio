import { v4 as uuidv4 } from "uuid";
import { Character, Environment, AnalysisResult, Scene, SceneAnalysisResult, GenConfig } from "../types";

/**
 * Ce fichier ne parle JAMAIS directement a Gemini : il appelle notre fonction
 * Netlify, qui elle seule connait la cle API (gardee secrete cote serveur).
 *
 * C'est une Edge Function et non une fonction classique : ces dernieres sont
 * coupees au bout de dix secondes, alors qu'une generation d'image en demande
 * couramment vingt. Toutes les requetes auraient echoue en production.
 */

/** Contexte du projet transmis a l'assistant, pour qu'il sache de quoi on parle. */
export interface ContexteProjet {
  etape?: string;
  style?: string;
  personnages?: Pick<Character, "name" | "role" | "physicalDescription">[];
  decors?: Pick<Environment, "name" | "type" | "description">[];
  scenes?: Pick<Scene, "title" | "description">[];
  extraitTexte?: string;
}

const callGemini = async (fn: string, args: unknown[], signal?: AbortSignal): Promise<any> => {
  let res: Response;

  try {
    res = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fn, args }),
      signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    throw new Error("Le serveur est injoignable. Verifiez votre connexion internet.");
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.error) {
    throw new Error(data.error || `Erreur serveur (${res.status})`);
  }
  return data.result;
};

// ---------------------------------------------------------------------------
// Analyse du recit : lancement puis attente
//
// L'analyse ne passe plus par /api/gemini. Netlify coupe une Edge Function au
// bout d'environ 35 secondes, or le seul appel final au modele en demande une
// trentaine, et un vrai PDF ajoute par dessus le resume de chaque tranche :
// l'import tombait en "Erreur serveur (500)".
//
// Elle passe donc par une fonction d'arriere-plan, qui dispose de 15 minutes.
// En echange cette fonction ne peut rien renvoyer directement : elle repond 202
// tout de suite, puis depose son avancement et son resultat dans un tiroir que
// l'on vient consulter toutes les deux secondes.
// ---------------------------------------------------------------------------

const URL_LANCEMENT = "/.netlify/functions/analyse-background";
const URL_STATUT = "/.netlify/functions/analyse-statut";

const DELAI_SONDAGE_MS = 2_000;
/** Au dela, on considere que la fonction d'arriere-plan n'a jamais demarre. */
const ATTENTE_DEMARRAGE_MS = 90_000;
/** Budget total de la fonction d'arriere-plan chez Netlify. */
const ATTENTE_MAX_MS = 15 * 60 * 1_000;

const erreurAnnulation = () => {
  const e = new Error("Analyse annulee.");
  e.name = "AbortError";
  return e;
};

/** Pause interruptible : une annulation ne doit pas attendre la fin du delai. */
const patienter = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(erreurAnnulation());
    const minuteur = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    function stop() {
      clearTimeout(minuteur);
      reject(erreurAnnulation());
    }
    signal?.addEventListener("abort", stop, { once: true });
  });

/**
 * Analyse un recit et renvoie la bible graphique.
 *
 * `onProgress` recoit l'etape en cours ("Lecture du recit : 4 tranches sur 12"),
 * pour que l'attente reste lisible : sur un roman entier elle peut durer
 * plusieurs minutes.
 */
export const analyzeStory = async (
  text: string,
  charCount?: number,
  signal?: AbortSignal,
  onProgress?: (etape: string) => void
): Promise<AnalysisResult> => {
  const jobId = uuidv4();

  let lancement: Response;
  try {
    lancement = await fetch(URL_LANCEMENT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, text, charCount }),
      signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    throw new Error("Le serveur est injoignable. Verifiez votre connexion internet.");
  }

  // Netlify repond 202 sans corps. Tout autre code signifie que la fonction n'a
  // meme pas ete jointe, il est inutile d'aller sonder un resultat inexistant.
  if (!lancement.ok) {
    throw new Error(`L'analyse n'a pas pu etre lancee (erreur ${lancement.status}).`);
  }

  const debut = Date.now();
  let demarree = false;

  while (true) {
    await patienter(DELAI_SONDAGE_MS, signal);

    const ecoule = Date.now() - debut;
    if (ecoule > ATTENTE_MAX_MS) {
      throw new Error("L'analyse a depasse le temps maximal. Reessayez avec un texte plus court.");
    }

    let statut: any;
    try {
      const reponse = await fetch(`${URL_STATUT}?id=${encodeURIComponent(jobId)}`, { signal });
      statut = await reponse.json();
    } catch (e: any) {
      if (e?.name === "AbortError") throw e;
      // Un trou de reseau passager ne doit pas jeter une analyse en cours.
      continue;
    }

    if (statut?.etat === "termine") return statut.resultat as AnalysisResult;
    if (statut?.etat === "erreur") throw new Error(statut.message || "L'analyse a echoue.");

    if (statut?.etat === "encours") {
      demarree = true;
      if (statut.etape && onProgress) onProgress(statut.etape);
    }

    if (!demarree && ecoule > ATTENTE_DEMARRAGE_MS) {
      throw new Error("L'analyse n'a jamais demarre cote serveur. Reessayez dans un instant.");
    }
  }
};

export const generateEnvironmentImage = (
  env: Environment,
  stylePrompt: string,
  config: GenConfig,
  signal?: AbortSignal
): Promise<string> => callGemini("generateEnvironmentImage", [env, stylePrompt, config], signal);

export const generateCharacterImage = (
  character: Character,
  stylePrompt: string,
  config: GenConfig = { resolution: "1K", aspectRatio: "1:1" },
  signal?: AbortSignal
): Promise<string> => callGemini("generateCharacterImage", [character, stylePrompt, config], signal);

export const generateSceneImage = (
  scene: Scene,
  stylePrompt: string,
  allCharacters: Character[],
  allEnvironments: Environment[],
  config: GenConfig = { resolution: "1K", aspectRatio: "16:9" },
  signal?: AbortSignal
): Promise<string> => callGemini("generateSceneImage", [scene, stylePrompt, allCharacters, allEnvironments, config], signal);

export const editGeneratedImage = (base64Image: string, prompt: string, referenceImage?: string): Promise<string> =>
  callGemini("editGeneratedImage", [base64Image, prompt, referenceImage]);

export const regenerateCharacterDescription = (text: string, characterName: string): Promise<Partial<Character>> =>
  callGemini("regenerateCharacterDescription", [text, characterName]);

export const createCharacterFromPrompt = (userPrompt: string): Promise<Omit<Character, "id" | "status" | "imageUrl">> =>
  callGemini("createCharacterFromPrompt", [userPrompt]);

export const createSceneFromPrompt = (
  userPrompt: string,
  availableCharacters: string[]
): Promise<Omit<Scene, "id" | "status" | "imageUrl">> => callGemini("createSceneFromPrompt", [userPrompt, availableCharacters]);

export const createEnvironmentFromPrompt = (
  userPrompt: string
): Promise<Omit<Environment, "id" | "status" | "imageUrl">> => callGemini("createEnvironmentFromPrompt", [userPrompt]);

export const findMissingEnvironments = (
  text: string,
  existingNames: string[],
  countHint?: number,
  nameHints?: string
): Promise<Omit<Environment, "id" | "status" | "imageUrl">[]> =>
  callGemini("findMissingEnvironments", [text, existingNames, countHint, nameHints]);

export const findMissingCharacters = (
  text: string,
  existingNames: string[],
  countHint?: number,
  nameHints?: string
): Promise<Omit<Character, "id" | "status" | "imageUrl">[]> =>
  callGemini("findMissingCharacters", [text, existingNames, countHint, nameHints]);

export const findMissingScenes = (
  text: string,
  existingTitles: string[],
  knownCharacters: string[],
  countHint?: number,
  contentHints?: string
): Promise<Omit<Scene, "id" | "status" | "imageUrl">[]> =>
  callGemini("findMissingScenes", [text, existingTitles, knownCharacters, countHint, contentHints]);

export const sendChatMessage = (
  history: any[],
  message: string,
  image?: string,
  projet?: ContexteProjet
): Promise<string> => callGemini("sendChatMessage", [history, message, image, projet]);

export const analyzeScenes = (
  text: string,
  knownCharacters: string[],
  sceneCount?: number,
  signal?: AbortSignal
): Promise<SceneAnalysisResult> => callGemini("analyzeScenes", [text, knownCharacters, sceneCount], signal);
