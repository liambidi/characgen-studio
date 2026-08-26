/**
 * Les taches longues, en arriere-plan.
 *
 * POURQUOI CETTE FONCTION EXISTE
 *
 * Tout ce qui lit le recit entier passait par l'Edge Function `/api/gemini`, que
 * Netlify coupe au bout d'environ 35 secondes. Or le seul appel au modele le
 * plus fin coute deja une trentaine de secondes sur un texte court. L'import
 * tombait en "the edge function timed out", que le navigateur affichait en
 * "Erreur serveur (500)", et le decoupage en scenes, qui enchaine un appel par
 * scene, echouait des la dizaine de scenes.
 *
 * Une fonction dont le nom se termine par `-background` dispose de 15 minutes au
 * lieu de 35 secondes. En echange elle ne peut rien renvoyer a celui qui l'appelle :
 * Netlify repond 202 immediatement, et le travail continue tout seul. On depose
 * donc l'avancement, les resultats partiels puis le resultat final dans Netlify
 * Blobs, et le navigateur vient les lire via `analyse-statut`.
 *
 * SIX TACHES PARTAGENT CE RAIL. Une seule fonction plutot que six fichiers : le
 * lancement, le frein anti-rafale, l'ecriture de l'avancement et la traduction
 * des erreurs sont identiques pour toutes, et les dupliquer six fois etait la
 * garantie qu'elles finiraient par diverger.
 */
import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { GoogleGenAI, Type } from "@google/genai";
import {
  LIMITES,
  MAGASIN_ANALYSES,
  MODELES,
  PREFIXE_LIMITE,
  ErreurDeSaisie,
  analyserRecit,
  decouperEnScenes,
  estModeleIntrouvable,
  messageLisible,
  relirePersonnage,
  trouverDecorsManquants,
  trouverPersonnagesManquants,
  trouverScenesManquantes,
} from "../shared/analyse.ts";

/** Un identifiant de travail est un UUID fabrique par le navigateur. */
const IDENTIFIANT_VALIDE = /^[0-9a-f-]{16,64}$/i;

const RATE_LIMIT = 30; // travaux lances
const RATE_WINDOW_MS = 60_000; // par minute et par adresse

/**
 * Freine les rafales venant d'une meme adresse.
 *
 * Contrairement au compteur en memoire de l'Edge Function, celui-ci passe par
 * Blobs : une fonction d'arriere-plan demarre a froid a chaque appel et ne garde
 * rien entre deux executions. En cas de panne du stockage on laisse passer :
 * bloquer un utilisateur legitime serait pire que de rater un frein, et le
 * plafond de depense fixe sur la console Google reste la protection ultime.
 */
const estLimite = async (ip: string): Promise<boolean> => {
  try {
    const magasin = getStore(MAGASIN_ANALYSES);
    const cle = `${PREFIXE_LIMITE}${ip}`;
    const maintenant = Date.now();
    const anciennes: number[] = (await magasin.get(cle, { type: "json" })) || [];
    const recentes = anciennes.filter((t) => maintenant - t < RATE_WINDOW_MS);
    recentes.push(maintenant);
    await magasin.setJSON(cle, recentes);
    return recentes.length > RATE_LIMIT;
  } catch (e) {
    console.error("Compteur de debit indisponible, requete laissee passer :", e);
    return false;
  }
};

const getAi = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

/**
 * Lance une generation en essayant chaque modele du role jusqu'a ce que l'un
 * reponde. Seule une erreur "modele introuvable" declenche l'essai suivant :
 * un quota depasse ou un filtre de contenu doit remonter tel quel.
 */
const genererAvecRepli = async (
  role: "texteExpert" | "texteRapide",
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

/** Ce que le navigateur peut demander a ce rail. */
type Tache = "recit" | "scenes" | "scenesManquantes" | "personnagesManquants" | "decorsManquants" | "relecturePersonnage";

const TACHES_CONNUES: Tache[] = [
  "recit",
  "scenes",
  "scenesManquantes",
  "personnagesManquants",
  "decorsManquants",
  "relecturePersonnage",
];

export default async (req: Request, context: Context) => {
  // Netlify a deja repondu 202 au navigateur. Tout ce qui suit ne peut donc plus
  // communiquer que par le magasin : la moindre sortie non ecrite serait un
  // navigateur qui attend indefiniment.
  const magasin = getStore(MAGASIN_ANALYSES);
  let identifiant = "";

  const ecrire = async (etat: Record<string, unknown>) => {
    if (!identifiant) return;
    try {
      await magasin.setJSON(identifiant, { ...etat, maj: Date.now() });
    } catch (e) {
      console.error("Ecriture de l'avancement impossible :", e);
    }
  };

  try {
    const corps = await req.json().catch(() => null);
    if (!corps || typeof corps !== "object") {
      console.error("Requete illisible, aucun identifiant a qui repondre.");
      return;
    }

    const {
      jobId,
      tache = "recit",
      text,
      charCount,
      sceneCount,
      knownCharacters,
      knownEnvironments,
      existingNames,
      existingTitles,
      characterName,
      countHint,
      hints,
    } = corps as Record<string, any>;

    if (!jobId || !IDENTIFIANT_VALIDE.test(jobId)) {
      console.error("Identifiant de travail absent ou mal forme.");
      return;
    }
    identifiant = jobId;

    if (!TACHES_CONNUES.includes(tache)) {
      await ecrire({ etat: "erreur", message: `Tache inconnue : ${String(tache).slice(0, 40)}.` });
      return;
    }

    if (!process.env.GEMINI_API_KEY) {
      await ecrire({
        etat: "erreur",
        message: "La cle GEMINI_API_KEY n'est pas configuree sur le serveur.",
      });
      return;
    }

    if (await estLimite(context.ip || "inconnue")) {
      await ecrire({ etat: "erreur", message: "Trop de requetes, reessayez dans une minute." });
      return;
    }

    // Verifie avant toute depense. Les fonctions d'analyse refuseraient aussi ce
    // texte, mais seulement apres avoir demarre : autant le dire tout de suite.
    if (typeof text !== "string" || text.trim().length < 50) {
      await ecrire({
        etat: "erreur",
        message: "Le texte recu est vide ou trop court pour etre analyse.",
      });
      return;
    }
    if (text.length > LIMITES.texte) {
      await ecrire({
        etat: "erreur",
        message: `Le recit depasse la taille acceptee (${LIMITES.texte} caracteres). Importez un extrait plus court.`,
      });
      return;
    }

    await ecrire({ etat: "encours", etape: "Demarrage" });

    // L'avancement est cosmetique : on n'ecrit qu'une fois par seconde au plus,
    // sinon quatre scenes qui finissent ensemble declenchent quatre ecritures.
    let derniereEcriture = 0;
    let dernierEtape = "Demarrage";
    const progres = async (etape: string) => {
      dernierEtape = etape;
      const maintenant = Date.now();
      if (maintenant - derniereEcriture < 1000) return;
      derniereEcriture = maintenant;
      await ecrire({ etat: "encours", etape });
    };

    /**
     * Depose les scenes deja pretes, sans attendre les autres.
     *
     * C'est ce qui permet a l'ecran de relecture de s'ouvrir des la premiere
     * scene : l'utilisateur corrige les premieres pendant que les dernieres se
     * fabriquent. Ces ecritures ne sont pas freinees comme l'avancement, une
     * scene perdue en route ne se rattraperait qu'a la fin du travail.
     */
    const partiel = async (donnees: { scenes: any[] }) => {
      derniereEcriture = Date.now();
      await ecrire({ etat: "encours", etape: dernierEtape, partiel: donnees });
    };

    const outils = { Type, generer: genererAvecRepli, progres, partiel };

    let resultat: unknown;

    switch (tache) {
      case "recit":
        resultat = await analyserRecit(outils, text, charCount);
        break;

      case "scenes":
        resultat = await decouperEnScenes(outils, text, knownCharacters, knownEnvironments, sceneCount);
        break;

      case "scenesManquantes":
        resultat = {
          scenes: await trouverScenesManquantes(
            outils,
            text,
            existingTitles,
            knownCharacters,
            knownEnvironments,
            countHint,
            hints
          ),
        };
        break;

      case "personnagesManquants":
        resultat = {
          characters: await trouverPersonnagesManquants(outils, text, existingNames, countHint, hints),
        };
        break;

      case "decorsManquants":
        resultat = {
          environments: await trouverDecorsManquants(outils, text, existingNames, countHint, hints),
        };
        break;

      case "relecturePersonnage":
        resultat = await relirePersonnage(outils, text, characterName);
        break;
    }

    await ecrire({ etat: "termine", resultat });
  } catch (e: any) {
    if (e instanceof ErreurDeSaisie) {
      await ecrire({ etat: "erreur", message: e.message });
      return;
    }
    console.error("Tache en arriere-plan impossible :", e);
    await ecrire({ etat: "erreur", message: messageLisible(e).message });
  }
};
