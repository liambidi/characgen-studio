/**
 * Etat d'une analyse lancee en arriere-plan.
 *
 * La fonction `analyse-background` ne peut rien renvoyer a celui qui l'appelle :
 * Netlify lui repond 202 tout de suite. Elle depose donc son avancement puis son
 * resultat dans Netlify Blobs, et le navigateur vient les lire ici, toutes les
 * deux secondes, jusqu'a ce que l'etat passe a "termine" ou "erreur".
 *
 * Cette fonction ne fait que lire un tiroir : elle repond en quelques
 * millisecondes et n'approche jamais des limites de duree.
 *
 * Elle sait aussi ranger. Avec `?fin=1`, le navigateur signale qu'il a bien recu
 * le resultat et que l'enregistrement peut disparaitre. Sans ce menage, chaque
 * import laissait derriere lui un resultat complet, garde indefiniment, et le
 * magasin ne faisait que grossir.
 */
import { getStore } from "@netlify/blobs";
import { AGE_MAX_ANALYSE_MS, MAGASIN_ANALYSES, PREFIXE_LIMITE } from "../shared/analyse.ts";

const IDENTIFIANT_VALIDE = /^[0-9a-f-]{16,64}$/i;

/**
 * Menage des enregistrements oublies.
 *
 * AGE_MAX_ANALYSE_MS existait avec un commentaire qui decrivait ce menage, mais
 * n'etait appele nulle part : le seul nettoyage venait du navigateur, avec
 * `?fin=1`, une fois son resultat recu. Un onglet ferme pendant l'analyse, une
 * coupure reseau ou une erreur laissaient donc l'enregistrement en place, avec
 * le recit entier dedans, et le magasin ne faisait que grossir. Les compteurs de
 * debit `limite/<ip>` n'etaient effaces par personne non plus.
 *
 * Le balayage est fait ici, a l'occasion d'un sondage, plutot que par une tache
 * planifiee : cette fonction est appelee toutes les deux secondes pendant une
 * analyse, il suffit donc de ne balayer qu'une fois de temps en temps.
 */
const INTERVALLE_MENAGE_MS = 10 * 60 * 1_000;
/** Plafond par passage, pour qu'un magasin encombre ne fasse pas trainer la reponse. */
const SUPPRESSIONS_MAX = 50;

let dernierMenage = 0;

const fairePeriodiquementLeMenage = async (magasin: ReturnType<typeof getStore>) => {
  const maintenant = Date.now();
  if (maintenant - dernierMenage < INTERVALLE_MENAGE_MS) return;
  dernierMenage = maintenant;

  try {
    const { blobs } = await magasin.list();
    let supprimes = 0;

    for (const blob of blobs) {
      if (supprimes >= SUPPRESSIONS_MAX) break;

      const enregistrement: any = await magasin.get(blob.key, { type: "json" }).catch(() => null);
      if (!enregistrement) continue;

      // Un compteur de debit est un tableau d'horodatages, une analyse un objet
      // portant sa date de derniere ecriture. Les deux vieillissent, pas pareil.
      const date = Array.isArray(enregistrement)
        ? Math.max(0, ...enregistrement)
        : Number(enregistrement.maj) || 0;

      const age = blob.key.startsWith(PREFIXE_LIMITE) ? AGE_MAX_ANALYSE_MS / 60 : AGE_MAX_ANALYSE_MS;
      if (maintenant - date > age) {
        await magasin.delete(blob.key);
        supprimes += 1;
      }
    }

    if (supprimes > 0) console.log(`Menage du magasin d'analyses : ${supprimes} enregistrement(s) perime(s) efface(s).`);
  } catch (e) {
    // Le menage est un confort : son echec ne doit jamais empecher un navigateur
    // de recuperer le resultat qu'il attend.
    console.error("Menage du magasin d'analyses impossible :", e);
  }
};

const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Une reponse mise en cache figerait l'avancement a sa premiere valeur.
      "Cache-Control": "no-store",
    },
  });

export default async (req: Request) => {
  const parametres = new URL(req.url).searchParams;
  const identifiant = parametres.get("id") || "";
  const aFini = parametres.get("fin") === "1";

  if (!IDENTIFIANT_VALIDE.test(identifiant)) {
    return json({ etat: "erreur", message: "Identifiant d'analyse invalide." }, 400);
  }

  try {
    const magasin = getStore(MAGASIN_ANALYSES);

    // Le navigateur a fini d'exploiter le resultat : on libere la place.
    // L'expression est validee plus haut, elle ne peut designer qu'un travail,
    // jamais un compteur de debit (qui porte un prefixe avec une barre oblique).
    if (aFini) {
      await magasin.delete(identifiant);
      return json({ etat: "efface" });
    }

    // Rattrape ce que le rangement volontaire ci-dessus ne peut pas attraper :
    // les analyses dont le navigateur n'est jamais revenu chercher le resultat.
    // Volontairement non attendu, un sondage ne doit pas ralentir pour cela.
    void fairePeriodiquementLeMenage(magasin);

    const etat = await magasin.get(identifiant, { type: "json" });

    // Rien dans le tiroir : la fonction d'arriere-plan n'a pas encore eu le temps
    // d'ecrire sa premiere ligne. Ce n'est pas une erreur, le navigateur repasse.
    if (!etat) return json({ etat: "attente" });

    return json(etat);
  } catch (e: any) {
    console.error("Lecture de l'etat d'analyse impossible :", e);
    return json(
      { etat: "erreur", message: "L'etat de l'analyse est illisible. Relancez l'import." },
      500
    );
  }
};
