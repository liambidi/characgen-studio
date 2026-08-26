import { v4 as uuidv4 } from "uuid";
import { Character, Environment, AnalysisResult, Scene, SceneAnalysisResult, GenConfig } from "../types";

/**
 * Ce fichier ne parle JAMAIS directement a Gemini : il appelle nos fonctions
 * Netlify, qui elles seules connaissent la cle API (gardee secrete cote serveur).
 *
 * DEUX RAILS, ET LA REGLE POUR CHOISIR
 *
 * `/api/gemini` est une Edge Function : elle demarre vite, mais Netlify la coupe
 * aux alentours de 35 secondes sans lui laisser le temps de repondre. Elle porte
 * donc les taches courtes : generer ou retoucher une image, inventer une fiche a
 * partir de quelques mots, repondre dans la discussion.
 *
 * `analyse-background` est une fonction d'arriere-plan : 15 minutes, mais elle ne
 * peut rien renvoyer directement, il faut aller chercher son resultat dans un
 * tiroir. Elle porte les six taches qui lisent le recit ENTIER, decoupage en
 * scenes compris. Toute nouvelle tache qui lit le recit va sur ce rail, sans
 * exception : c'est le raccourci inverse qui a produit le 500 muet du 25 aout.
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

/**
 * Duree au dela de laquelle une coupure ressemble a un depassement de temps.
 *
 * Netlify arrete une Edge Function aux alentours de 35 secondes. Le seuil est
 * place en dessous pour attraper aussi les coupures un peu plus precoces. Il ne
 * prouve rien : c'est un indice de duree, pas un diagnostic, et le message
 * ecrit plus bas prend soin de le dire a l'utilisateur.
 */
const SEUIL_COUPURE_MS = 25_000;

/**
 * Message affiche quand le serveur n'a rien repondu du tout.
 *
 * Ce cas se reconnait sans ambiguite : la reponse porte un code d'erreur mais
 * son corps ne contient aucun message. Or toutes les erreurs que le serveur
 * sait nommer, cle API absente, frein anti-abus, texte trop long, arrivent avec
 * leur phrase en francais et sont affichees telles quelles. Une reponse muette
 * signifie donc que la fonction est morte avant d'avoir pu ecrire quoi que ce soit.
 *
 * Depuis que les taches longues sont passees sur le rail d'arriere-plan, ce
 * message ne devrait plus concerner que la generation d'images. S'il reapparait
 * sur autre chose, c'est qu'une tache longue est revenue par erreur sur
 * `/api/gemini`.
 *
 * Regle d'ecriture de ce message : ce qui est constate est affirme, ce qui ne
 * l'est pas est annonce comme une piste.
 */
const messageServeurMuet = (statut: number, dureeMs: number): string => {
  const secondes = Math.max(1, Math.round(dureeMs / 1000));
  const desole = "Désolé, cette étape n'a pas pu aller au bout.";
  const rassurer = "Rien n'est perdu : votre récit, vos personnages et vos décors sont intacts.";

  if (statut >= 500 && dureeMs >= SEUIL_COUPURE_MS) {
    return [
      desole,
      `Le serveur a travaillé ${secondes} secondes, puis il s'est arrêté sans rien renvoyer. ` +
        "C'est ce qui arrive quand une opération dépasse le temps qui lui est accordé.",
      rassurer,
      "Vous pouvez réessayer. La cause exacte n'a pas été établie, il est possible que cela passe au second essai.",
    ].join("\n");
  }

  if (statut >= 500) {
    return [
      desole,
      `Le serveur s'est arrêté au bout de ${secondes} seconde${secondes > 1 ? "s" : ""}, sans dire pourquoi.`,
      rassurer,
      "Réessayez dans un instant. Si l'erreur revient à l'identique, c'est que le problème vient du serveur et non de votre récit.",
    ].join("\n");
  }

  return [
    desole,
    `Le serveur a refusé la demande (code ${statut}) sans donner de motif.`,
    rassurer,
    "Réessayez. Si l'erreur revient à l'identique, c'est que le problème vient du serveur et non de votre récit.",
  ].join("\n");
};

const callGemini = async (fn: string, args: unknown[], signal?: AbortSignal): Promise<any> => {
  let res: Response;
  const depart = Date.now();

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

  // Le serveur a nomme son erreur : c'est sa phrase qui compte, elle est plus
  // precise que tout ce qu'on pourrait deviner ici.
  if (data.error) throw new Error(data.error);

  if (!res.ok) throw new Error(messageServeurMuet(res.status, Date.now() - depart));

  return data.result;
};

// ---------------------------------------------------------------------------
// Le rail des taches longues : lancement, puis attente
//
// Netlify coupe une Edge Function au bout d'environ 35 secondes, sans lui
// laisser le temps de repondre : le navigateur recevait un 500 vide. Or six
// taches lisent le recit entier et demandent bien davantage, le decoupage en
// scenes plus que toutes les autres puisqu'il enchaine un appel par scene.
//
// Elles passent donc par une fonction d'arriere-plan, qui dispose de 15
// minutes. En echange cette fonction ne peut rien renvoyer directement : elle
// repond 202 tout de suite, puis depose son avancement, ses resultats partiels
// et son resultat final dans un tiroir que l'on vient consulter toutes les deux
// secondes.
// ---------------------------------------------------------------------------

const URL_LANCEMENT = "/.netlify/functions/analyse-background";
const URL_STATUT = "/.netlify/functions/analyse-statut";

const DELAI_SONDAGE_MS = 2_000;
/** Au dela, on considere que la fonction d'arriere-plan n'a jamais demarre. */
const ATTENTE_DEMARRAGE_MS = 90_000;
/** Budget total de la fonction d'arriere-plan chez Netlify. */
const ATTENTE_MAX_MS = 15 * 60 * 1_000;
/**
 * Nombre de sondages rates d'affilee tolere. Un trou de reseau passager ne doit
 * pas jeter un travail en cours, mais une connexion reellement coupee ne doit
 * pas non plus laisser tourner une barre de progression pendant un quart d'heure.
 */
const ECHECS_SONDAGE_MAX = 10;
/** Taille maximale acceptee cote serveur, verifiee ici pour repondre tout de suite. */
const TAILLE_TEXTE_MAX = 400_000;

const erreurAnnulation = () => {
  const e = new Error("Operation annulee.");
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

/** Ce que le navigateur peut demander au rail des taches longues. */
export type TacheLongue =
  | "recit"
  | "scenes"
  | "scenesManquantes"
  | "personnagesManquants"
  | "decorsManquants"
  | "relecturePersonnage";

export interface SuiviTacheLongue {
  signal?: AbortSignal;
  /** Recoit l'etape en cours, par exemple "Redaction des scenes : 4 sur 12". */
  onProgress?: (etape: string) => void;
  /** Recoit les scenes deja pretes, avant la fin du travail. */
  onPartial?: (partiel: { scenes: any[] }) => void;
}

/**
 * Lance une tache longue et attend son resultat.
 *
 * Le meme mecanisme sert aux six taches : seul le corps de la requete change.
 * En ecrire six copies aurait garanti qu'elles finissent par diverger, comme
 * cela s'etait deja produit entre les deux serveurs.
 */
const executerEnArrierePlan = async (
  corps: Record<string, unknown> & { tache: TacheLongue; text: string },
  suivi: SuiviTacheLongue = {}
): Promise<any> => {
  const { signal, onProgress, onPartial } = suivi;
  const text = corps.text;

  // Verifie ici plutot qu'apres un aller-retour : le serveur refuserait de toute
  // facon, mais l'utilisateur attendrait plusieurs secondes pour l'apprendre.
  if (!text || text.trim().length < 50) {
    throw new Error("Le texte a analyser est vide ou trop court.");
  }
  if (text.length > TAILLE_TEXTE_MAX) {
    throw new Error(
      `Ce recit fait ${text.length.toLocaleString("fr-FR")} caracteres, au dela des ` +
        `${TAILLE_TEXTE_MAX.toLocaleString("fr-FR")} acceptes. Importez-le en plusieurs parties.`
    );
  }

  const jobId = uuidv4();

  let lancement: Response;
  try {
    lancement = await fetch(URL_LANCEMENT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, ...corps }),
      signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    throw new Error("Le serveur est injoignable. Verifiez votre connexion internet.");
  }

  // Netlify repond 202 sans corps. Tout autre code signifie que la fonction n'a
  // meme pas ete jointe, il est inutile d'aller sonder un resultat inexistant.
  if (!lancement.ok) {
    throw new Error(`L'operation n'a pas pu etre lancee (erreur ${lancement.status}).`);
  }

  /**
   * Libere l'enregistrement laisse par la fonction d'arriere-plan. Sans appel,
   * chaque import laissait un resultat complet dans le magasin, indefiniment.
   * Tir sans retour : le resultat est deja entre nos mains, un echec ici n'a
   * aucune consequence pour l'utilisateur.
   */
  const ranger = () => {
    void fetch(`${URL_STATUT}?id=${encodeURIComponent(jobId)}&fin=1`, {
      method: "GET",
      keepalive: true,
    }).catch(() => {});
  };

  const debut = Date.now();
  let demarree = false;
  let echecsDaffilee = 0;
  // Un partiel deja transmis ne doit pas etre rejoue a chaque sondage : l'ecran
  // de relecture se reconstruirait entierement toutes les deux secondes, et
  // ecraserait ce que l'utilisateur est en train d'y corriger.
  let dernierPartiel = 0;

  while (true) {
    await patienter(DELAI_SONDAGE_MS, signal);

    const ecoule = Date.now() - debut;
    if (ecoule > ATTENTE_MAX_MS) {
      throw new Error("L'operation a depasse le temps maximal. Reessayez avec un texte plus court.");
    }

    let statut: any;
    try {
      const reponse = await fetch(`${URL_STATUT}?id=${encodeURIComponent(jobId)}`, { signal });
      statut = await reponse.json();
      echecsDaffilee = 0;
    } catch (e: any) {
      if (e?.name === "AbortError") throw e;
      // Un trou de reseau passager ne doit pas jeter un travail en cours,
      // mais une connexion coupee ne doit pas non plus faire attendre un quart d'heure.
      echecsDaffilee += 1;
      if (echecsDaffilee >= ECHECS_SONDAGE_MAX) {
        throw new Error("La connexion au serveur est perdue. Verifiez votre reseau puis relancez.");
      }
      continue;
    }

    if (statut?.etat === "termine") {
      ranger();
      return statut.resultat;
    }
    if (statut?.etat === "erreur") {
      ranger();
      throw new Error(statut.message || "L'operation a echoue.");
    }

    if (statut?.etat === "encours") {
      demarree = true;
      if (statut.etape && onProgress) onProgress(statut.etape);

      const scenes = statut.partiel?.scenes;
      if (onPartial && Array.isArray(scenes) && scenes.length > dernierPartiel) {
        dernierPartiel = scenes.length;
        onPartial(statut.partiel);
      }
    }

    if (!demarree && ecoule > ATTENTE_DEMARRAGE_MS) {
      throw new Error("L'operation n'a jamais demarre cote serveur. Reessayez dans un instant.");
    }
  }
};

// ---------------------------------------------------------------------------
// Les six taches longues
// ---------------------------------------------------------------------------

/**
 * Analyse un recit et renvoie la bible graphique.
 *
 * `onProgress` recoit l'etape en cours, pour que l'attente reste lisible : sur
 * un roman entier elle peut durer plusieurs minutes.
 */
export const analyzeStory = async (
  text: string,
  charCount?: number,
  signal?: AbortSignal,
  onProgress?: (etape: string) => void
): Promise<AnalysisResult> =>
  executerEnArrierePlan({ tache: "recit", text, charCount }, { signal, onProgress });

/**
 * Decoupe le recit en scenes, en deux passes cote serveur.
 *
 * `knownEnvironments` sert a relier chaque scene au decor deja genere qui lui
 * correspond : sans cette liste, la liaison resterait a faire a la main, scene
 * par scene, et l'illustration ne s'appuierait pas sur l'image du decor.
 *
 * `onPartial` recoit les scenes au fur et a mesure qu'elles sont pretes.
 */
export const analyzeScenes = async (
  text: string,
  knownCharacters: string[],
  sceneCount?: number,
  signal?: AbortSignal,
  onProgress?: (etape: string) => void,
  onPartial?: (partiel: { scenes: any[] }) => void,
  knownEnvironments: Array<{ id: string; name: string }> = []
): Promise<SceneAnalysisResult> =>
  executerEnArrierePlan(
    { tache: "scenes", text, knownCharacters, knownEnvironments, sceneCount },
    { signal, onProgress, onPartial }
  );

export const findMissingScenes = async (
  text: string,
  existingTitles: string[],
  knownCharacters: string[],
  countHint?: number,
  contentHints?: string,
  knownEnvironments: Array<{ id: string; name: string }> = [],
  onProgress?: (etape: string) => void
): Promise<Omit<Scene, "id" | "status" | "imageUrl">[]> =>
  (
    await executerEnArrierePlan(
      {
        tache: "scenesManquantes",
        text,
        existingTitles,
        knownCharacters,
        knownEnvironments,
        countHint,
        hints: contentHints,
      },
      { onProgress }
    )
  ).scenes || [];

export const findMissingCharacters = async (
  text: string,
  existingNames: string[],
  countHint?: number,
  nameHints?: string,
  onProgress?: (etape: string) => void
): Promise<Omit<Character, "id" | "status" | "imageUrl">[]> =>
  (
    await executerEnArrierePlan(
      { tache: "personnagesManquants", text, existingNames, countHint, hints: nameHints },
      { onProgress }
    )
  ).characters || [];

export const findMissingEnvironments = async (
  text: string,
  existingNames: string[],
  countHint?: number,
  nameHints?: string,
  onProgress?: (etape: string) => void
): Promise<Omit<Environment, "id" | "status" | "imageUrl">[]> =>
  (
    await executerEnArrierePlan(
      { tache: "decorsManquants", text, existingNames, countHint, hints: nameHints },
      { onProgress }
    )
  ).environments || [];

export const regenerateCharacterDescription = async (
  text: string,
  characterName: string,
  onProgress?: (etape: string) => void
): Promise<Partial<Character>> =>
  executerEnArrierePlan({ tache: "relecturePersonnage", text, characterName }, { onProgress });

// ---------------------------------------------------------------------------
// Les taches courtes, sur l'Edge Function
// ---------------------------------------------------------------------------

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

export const createCharacterFromPrompt = (userPrompt: string): Promise<Omit<Character, "id" | "status" | "imageUrl">> =>
  callGemini("createCharacterFromPrompt", [userPrompt]);

export const createSceneFromPrompt = (
  userPrompt: string,
  availableCharacters: string[]
): Promise<Omit<Scene, "id" | "status" | "imageUrl">> => callGemini("createSceneFromPrompt", [userPrompt, availableCharacters]);

export const createEnvironmentFromPrompt = (
  userPrompt: string
): Promise<Omit<Environment, "id" | "status" | "imageUrl">> => callGemini("createEnvironmentFromPrompt", [userPrompt]);

export const sendChatMessage = (
  history: any[],
  message: string,
  image?: string,
  projet?: ContexteProjet
): Promise<string> => callGemini("sendChatMessage", [history, message, image, projet]);
