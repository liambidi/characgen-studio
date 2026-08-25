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
 */
import { getStore } from "@netlify/blobs";
import { MAGASIN_ANALYSES } from "../shared/analyse.ts";

const IDENTIFIANT_VALIDE = /^[0-9a-f-]{16,64}$/i;

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
  const identifiant = new URL(req.url).searchParams.get("id") || "";

  if (!IDENTIFIANT_VALIDE.test(identifiant)) {
    return json({ etat: "erreur", message: "Identifiant d'analyse invalide." }, 400);
  }

  try {
    const magasin = getStore(MAGASIN_ANALYSES);
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
