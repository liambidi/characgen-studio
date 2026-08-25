/**
 * Analyse d'un recit, en arriere-plan.
 *
 * POURQUOI CETTE FONCTION EXISTE
 *
 * L'analyse passait par l'Edge Function `/api/gemini`, que Netlify coupe au bout
 * d'environ 35 secondes. Or l'appel final au modele le plus fin coute a lui seul
 * une trentaine de secondes, meme sur un texte court, et un vrai PDF ajoute par
 * dessus le resume de chaque tranche. L'import tombait donc en
 * "the edge function timed out", que le navigateur affichait en "Erreur serveur (500)".
 *
 * Une fonction dont le nom se termine par `-background` dispose de 15 minutes au
 * lieu de 35 secondes. En echange elle ne peut rien renvoyer a celui qui l'appelle :
 * Netlify repond 202 immediatement, et le travail continue tout seul. On depose
 * donc l'avancement puis le resultat dans Netlify Blobs, et le navigateur vient
 * les lire via `analyse-statut`.
 */
import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { GoogleGenAI, Type } from "@google/genai";
import {
  MAGASIN_ANALYSES,
  MODELES,
  ErreurDeSaisie,
  analyserRecit,
  estModeleIntrouvable,
  messageLisible,
} from "../shared/analyse.ts";

/** Un identifiant de travail est un UUID fabrique par le navigateur. */
const IDENTIFIANT_VALIDE = /^[0-9a-f-]{16,64}$/i;

const RATE_LIMIT = 30; // analyses lancees
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
    const cle = `limite/${ip}`;
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

    const { jobId, text, charCount } = corps as {
      jobId?: string;
      text?: string;
      charCount?: number;
    };

    if (!jobId || !IDENTIFIANT_VALIDE.test(jobId)) {
      console.error("Identifiant de travail absent ou mal forme.");
      return;
    }
    identifiant = jobId;

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

    await ecrire({ etat: "encours", etape: "Demarrage de l'analyse" });

    // L'avancement est cosmetique : on n'ecrit qu'une fois par seconde au plus,
    // sinon douze tranches qui finissent ensemble declenchent douze ecritures.
    let derniereEcriture = 0;
    const progres = async (etape: string) => {
      const maintenant = Date.now();
      if (maintenant - derniereEcriture < 1000) return;
      derniereEcriture = maintenant;
      await ecrire({ etat: "encours", etape });
    };

    const resultat = await analyserRecit({ Type, generer: genererAvecRepli, progres }, text, charCount);

    await ecrire({ etat: "termine", resultat });
  } catch (e: any) {
    if (e instanceof ErreurDeSaisie) {
      await ecrire({ etat: "erreur", message: e.message });
      return;
    }
    console.error("Analyse en arriere-plan impossible :", e);
    await ecrire({ etat: "erreur", message: messageLisible(e).message });
  }
};
