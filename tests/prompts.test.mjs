/**
 * Tests des prompts envoyes a l'IA.
 *
 * Le premier test de ce fichier est celui qui aurait detecte immediatement le
 * bug le plus couteux du projet : les trois fonctions "Scanner" recevaient bien
 * le texte du recit mais oubliaient de le transmettre au modele, qui repondait
 * donc a partir de rien, en inventant des personnages.
 *
 * Lancement : npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), "utf8");

/** L'Edge Function : generation d'images et taches courtes. */
const SOURCE = lire("../netlify/edge-functions/gemini.ts");
/** La logique d'analyse d'un recit, partagee par les deux serveurs. */
const PARTAGE = lire("../netlify/shared/analyse.ts");
/** La fonction d'arriere-plan, qui dispose de 15 minutes au lieu de 35 secondes. */
const FOND = lire("../netlify/functions/analyse-background.mts");
/** Le service appele par le navigateur. */
const CLIENT = lire("../services/geminiService.ts");

/** Extrait le corps d'une fonction du fichier indique, pour l'inspecter. */
const corpsDeLaFonction = (nom, source = SOURCE) => {
  const debut = source.indexOf(`const ${nom} = async`);
  assert.notEqual(debut, -1, `La fonction ${nom} est introuvable`);

  // On s'arrete a la declaration suivante de meme niveau.
  const suite = source.slice(debut + 10);
  const fin = suite.search(/\n(?:const|export const|export default|\/\/ ---)/);
  return suite.slice(0, fin === -1 ? undefined : fin);
};

// ---------------------------------------------------------------------------

test("les fonctions de recherche transmettent le texte du recit au modele", () => {
  for (const nom of ["findMissingCharacters", "findMissingEnvironments", "findMissingScenes"]) {
    const corps = corpsDeLaFonction(nom);

    assert.match(
      corps,
      /texteALire\s*\(\s*text\s*\)/,
      `${nom} doit preparer le texte du recit avant d'interroger le modele`
    );
    assert.match(
      corps,
      /\$\{aLire\}/,
      `${nom} doit inserer le texte du recit dans le prompt, sinon le modele repond a partir de rien`
    );
  }
});

test("les fonctions de recherche tiennent compte de la quantite demandee", () => {
  for (const nom of ["findMissingCharacters", "findMissingEnvironments", "findMissingScenes"]) {
    const corps = corpsDeLaFonction(nom);

    assert.match(corps, /nombreValide\s*\(\s*countHint/, `${nom} doit valider la quantite demandee`);
    assert.match(corps, /\$\{combien/, `${nom} doit transmettre la quantite au modele, pas seulement la recevoir`);
  }
});

test("les fonctions de recherche excluent les elements deja trouves", () => {
  for (const nom of ["findMissingCharacters", "findMissingEnvironments", "findMissingScenes"]) {
    const corps = corpsDeLaFonction(nom);
    assert.match(corps, /connus\.join|connues\.join/, `${nom} doit lister les elements deja trouves dans le prompt`);
  }
});

test("l'analyse du recit transmet bien le texte", () => {
  const corps = corpsDeLaFonction("analyserRecit", PARTAGE);
  assert.match(corps, /\$\{aAnalyser\}/, "analyserRecit doit inserer le texte dans le prompt");
});

test("aucun prompt ne tronque brutalement le texte du recit", () => {
  // Une troncature a longueur fixe faisait perdre jusqu'aux deux tiers d'un roman.
  // Les textes longs doivent passer par condenserSegment, qui lit tout.
  assert.match(SOURCE, /const condenserSegment/, "La fonction de condensation doit exister");
  assert.match(PARTAGE, /const condenserSegment/, "L'analyse partagee doit condenser au lieu de couper");

  const mauvaisesTroncatures = (SOURCE + PARTAGE).match(/text\.slice\(0,\s*\d{4,}\)/g) || [];
  assert.equal(
    mauvaisesTroncatures.length,
    0,
    `Le texte du recit ne doit plus etre tronque a longueur fixe. Trouve : ${mauvaisesTroncatures.join(", ")}`
  );
});

test("chaque appel au modele passe par le systeme de repli", () => {
  // Un nom de modele ecrit en dur reproduit la panne du 24 aout, quand Google a
  // retire gemini-3-pro-preview : tout le site est tombe d'un coup.
  for (const [nom, source] of [["l'Edge Function", SOURCE], ["la fonction d'arriere-plan", FOND]]) {
    const appelsDirects = source.match(/getAi\(\)\.models\.generateContent/g) || [];
    assert.equal(
      appelsDirects.length,
      1,
      `Dans ${nom}, seul genererAvecRepli doit appeler generateContent directement`
    );
  }
});

test("la liste des modeles ne contient aucun modele retire par Google", () => {
  const retires = ["gemini-3-pro-preview", "gemini-2.5-flash-lite-latest", "gemini-1.5-pro", "gemini-pro"];
  const debutListe = PARTAGE.indexOf("const MODELES");
  assert.notEqual(debutListe, -1, "La liste des modeles doit vivre dans netlify/shared/analyse.ts");
  const finListe = PARTAGE.indexOf("} as const;", debutListe);
  const liste = PARTAGE.slice(debutListe, finListe);

  for (const modele of retires) {
    assert.ok(
      !liste.includes(`"${modele}"`),
      `Le modele ${modele} a ete retire par Google, il ne doit plus figurer dans la liste`
    );
  }
});

test("les entrees venant du navigateur sont validees avant d'atteindre Google", () => {
  assert.match(
    corpsDeLaFonction("analyserRecit", PARTAGE),
    /texteValide/,
    "analyserRecit doit valider ses entrees : le point d'appel est public et devinable"
  );

  for (const nom of ["analyzeScenes", "createCharacterFromPrompt", "editGeneratedImage"]) {
    const corps = corpsDeLaFonction(nom);
    assert.match(
      corps,
      /texteValide|imageValide|texteALire/,
      `${nom} doit valider ses entrees : le point d'appel est public et devinable`
    );
  }
});

test("le type reel des images est conserve, jamais force a PNG", () => {
  // Google renvoie souvent du JPEG. Annoncer "image/png" produisait des fichiers
  // dont l'extension mentait sur le contenu, et faisait echouer l'insertion PDF.
  const forcages = SOURCE.match(/data:image\/png;base64,\$\{/g) || [];
  assert.equal(forcages.length, 0, "Le type d'image ne doit pas etre force a PNG dans la reponse");

  const enDur = SOURCE.match(/mimeType:\s*"image\/png"/g) || [];
  assert.ok(
    enDur.length <= 1,
    `Les images renvoyees au modele doivent porter leur vrai type. Trouve ${enDur.length} occurrences forcees`
  );
  assert.match(SOURCE, /const decouperImage/, "decouperImage doit extraire le type reel des images");
});

test("une reponse illisible leve une erreur au lieu de renvoyer du vide", () => {
  // L'ancienne version renvoyait une liste vide en silence : l'utilisateur
  // voyait "0 personnage" sans savoir que l'analyse avait echoue.
  assert.ok(!SOURCE.includes("safeJsonParse"), "safeJsonParse renvoyait un repli vide en silence");
  assert.match(SOURCE, /const lireJson/, "lireJson doit remplacer safeJsonParse");
  assert.match(SOURCE, /la reponse a ete coupee avant la fin/, "Une reponse tronquee doit etre signalee clairement");
});

test("le traitement reste une Edge Function", () => {
  // Les fonctions Netlify classiques sont coupees au bout de dix secondes.
  // Une generation d'image en demande couramment vingt : toute la chaine
  // echouait en production avant cette migration.
  assert.ok(
    SOURCE.includes("@netlify/edge-functions"),
    "Le fichier doit importer les types Edge Functions, pas ceux des fonctions classiques"
  );
  assert.ok(SOURCE.includes('path: "/api/gemini"'), "La fonction doit etre exposee sur /api/gemini");
});

// ---------------------------------------------------------------------------
// Le budget de 35 secondes
//
// Ces trois tests gardent la correction du 25 aout. L'analyse d'un recit vivait
// dans l'Edge Function, que Netlify coupe au bout d'environ 35 secondes. Le seul
// appel final au modele en demandait une trentaine, et le resume des tranches
// d'un vrai PDF faisait deborder : l'import tombait en "Erreur serveur (500)",
// dont le corps disait "the edge function timed out".
// ---------------------------------------------------------------------------

test("l'analyse d'un recit ne tourne plus dans l'Edge Function", () => {
  assert.ok(
    !SOURCE.includes("const analyzeStory"),
    "analyzeStory ne doit plus etre definie dans l'Edge Function : son budget est d'environ 35 secondes"
  );
  assert.ok(
    !/\n\s*analyzeStory,/.test(SOURCE),
    "L'Edge Function ne doit plus exposer analyzeStory dans son routeur"
  );
});

test("l'analyse tourne dans une fonction d'arriere-plan qui depose son resultat", () => {
  // Le suffixe "-background" du nom de fichier est ce qui donne 15 minutes au
  // lieu de 35 secondes. Le renommer casserait la correction en silence.
  assert.ok(
    existsSync(new URL("../netlify/functions/analyse-background.mts", import.meta.url)),
    "Le fichier doit garder le suffixe -background, c'est lui qui declenche les 15 minutes"
  );
  assert.match(FOND, /analyserRecit/, "La fonction d'arriere-plan doit appeler l'analyse partagee");
  assert.match(
    FOND,
    /etat: "termine", resultat/,
    "Elle ne peut rien renvoyer a l'appelant : elle doit deposer son resultat dans le magasin"
  );
  assert.match(
    FOND,
    /etat: "erreur"/,
    "Une panne doit aussi etre deposee, sinon le navigateur attend indefiniment"
  );
});

test("le navigateur suit l'avancement au lieu d'attendre une reponse directe", () => {
  const corps = corpsDeLaFonction("analyzeStory", CLIENT);
  assert.match(corps, /URL_LANCEMENT/, "Le navigateur doit lancer la fonction d'arriere-plan");
  assert.match(corps, /URL_STATUT/, "Puis venir consulter l'etat, la reponse ne lui arrive pas toute seule");
  assert.match(corps, /onProgress/, "L'attente peut durer des minutes : elle doit rester lisible");
});
