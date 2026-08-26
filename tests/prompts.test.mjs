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

// Node 24 sait lire un module TypeScript directement : le fichier partage est
// donc teste sur son comportement reel, pas seulement sur ce que son texte
// contient. Une lecture de chaine ne voit pas un decoupage qui perd la moitie
// d'un roman, une assertion sur la sortie, si.
import {
  couperParagrapheLong,
  decouperEnParagraphes,
  lireJson,
  imageValide,
  memePersonnage,
  memeLieu,
  creerLocalisateur,
  construireSegmentsDepuisCarte,
  decouperEnScenes,
  trouverPersonnagesManquants,
  trouverDecorsManquants,
  trouverScenesManquantes,
  analyserRecit,
  ErreurDeSaisie,
} from "../netlify/shared/analyse.ts";

const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), "utf8");

/** L'Edge Function : generation d'images et taches courtes. */
const SOURCE = lire("../netlify/edge-functions/gemini.ts");
/** La logique d'analyse d'un recit, partagee par les deux serveurs. */
const PARTAGE = lire("../netlify/shared/analyse.ts");
/** La fonction d'arriere-plan, qui dispose de 15 minutes au lieu de 35 secondes. */
const FOND = lire("../netlify/functions/analyse-background.mts");
/** Le service appele par le navigateur. */
const CLIENT = lire("../services/geminiService.ts");

/** Taille de morceau utilisee par les tests de decoupage. */
const TAILLE_MORCEAU = 12_000;

/** Extrait le corps d'une fonction du fichier indique, pour l'inspecter. */
const corpsDeLaFonction = (nom, source = SOURCE) => {
  const debut = source.indexOf(`const ${nom} = async`);
  assert.notEqual(debut, -1, `La fonction ${nom} est introuvable`);

  // On s'arrete a la declaration suivante de meme niveau.
  const suite = source.slice(debut + 10);
  const fin = suite.search(/\n(?:const|export const|export default|\/\/ ---)/);
  return suite.slice(0, fin === -1 ? undefined : fin);
};

/** Outils factices : capture ce qui part vers le modele et rejoue des reponses. */
const outilsFactices = (repondre) => {
  const requetes = [];
  return {
    requetes,
    outils: {
      Type: { OBJECT: "OBJECT", ARRAY: "ARRAY", STRING: "STRING" },
      generer: async (role, requete) => {
        requetes.push({ role, contents: String(requete.contents) });
        return { text: repondre(requetes.length, String(requete.contents)) };
      },
    },
  };
};

// ---------------------------------------------------------------------------
// Le recit part entier chez le modele : plus aucune condensation
//
// Decision du 25 aout 2026 : les modeles actuels lisent un recit de 400 000
// caracteres en un appel. Resumer par tranches perdait du detail et coutait des
// appels. Ces tests garantissent qu'aucun resume intermediaire ne revient.
// ---------------------------------------------------------------------------

test("la condensation a disparu de tout le code serveur", () => {
  for (const [nom, source] of [["le fichier partage", PARTAGE], ["l'Edge Function", SOURCE], ["la fonction d'arriere-plan", FOND]]) {
    assert.ok(
      !source.includes("condenserSegment"),
      `${nom} ne doit plus condenser le recit : il part entier chez le modele`
    );
    assert.ok(
      !source.includes("preparerTexte"),
      `${nom} ne doit plus preparer/resumer le texte avant l'analyse`
    );
  }
});

test("l'analyse du recit transmet le texte integral au modele", async () => {
  const roman = "Un evenement se produisit dans la maison basse. ".repeat(1_000); // ~47 000 caracteres
  const { requetes, outils } = outilsFactices(() =>
    JSON.stringify({ characters: [], environments: [], suggestedStyle: "test" })
  );

  await analyserRecit(outils, roman);

  assert.equal(requetes.length, 1, "L'analyse doit tenir en un seul appel, sans resume prealable");
  assert.ok(
    requetes[0].contents.includes(roman),
    "Le prompt doit contenir le roman entier, sans troncature ni resume"
  );
});

test("aucun prompt ne tronque brutalement le texte du recit", () => {
  const mauvaisesTroncatures = (SOURCE + PARTAGE + FOND).match(/text\.slice\(0,\s*\d{4,}\)/g) || [];
  assert.equal(
    mauvaisesTroncatures.length,
    0,
    `Le texte du recit ne doit pas etre tronque a longueur fixe. Trouve : ${mauvaisesTroncatures.join(", ")}`
  );
});

// ---------------------------------------------------------------------------
// Les fonctions de recherche, desormais sur le rail d'arriere-plan
// ---------------------------------------------------------------------------

test("les recherches d'elements manquants transmettent le texte entier, la quantite et les elements connus", async () => {
  const roman = "Le chevalier traversa la lande grise vers le donjon. ".repeat(400); // ~21 000 caracteres

  const cas = [
    {
      nom: "trouverPersonnagesManquants",
      lancer: (outils) => trouverPersonnagesManquants(outils, roman, ["Aldric", "Maeve"], 3, "cherche le forgeron"),
      reponse: JSON.stringify({ characters: [] }),
    },
    {
      nom: "trouverDecorsManquants",
      lancer: (outils) => trouverDecorsManquants(outils, roman, ["Aldric", "Maeve"], 3, "cherche le forgeron"),
      reponse: JSON.stringify({ environments: [] }),
    },
    {
      nom: "trouverScenesManquantes",
      lancer: (outils) => trouverScenesManquantes(outils, roman, ["Aldric", "Maeve"], ["Paul"], [], 3, "cherche le forgeron"),
      reponse: JSON.stringify({ scenes: [] }),
    },
  ];

  for (const { nom, lancer, reponse } of cas) {
    const { requetes, outils } = outilsFactices(() => reponse);
    await lancer(outils);

    assert.equal(requetes.length, 1, `${nom} doit lire le recit en un seul appel`);
    assert.ok(requetes[0].contents.includes(roman), `${nom} doit envoyer le recit ENTIER au modele`);
    assert.ok(/exactement 3/.test(requetes[0].contents), `${nom} doit transmettre la quantite demandee`);
    assert.ok(requetes[0].contents.includes("Aldric"), `${nom} doit lister les elements deja trouves`);
    assert.ok(requetes[0].contents.includes("forgeron"), `${nom} doit transmettre les indices de l'utilisateur`);
  }
});

// ---------------------------------------------------------------------------
// La carte des scenes : localisation des citations dans le recit
//
// La passe 1 renvoie, pour chaque scene, une citation exacte de ses premiers
// mots. Ces fonctions retrouvent la position de la citation dans le texte
// original. Elles sont pures : testables sans cle API.
// ---------------------------------------------------------------------------

test("une citation exacte est retrouvee a sa position", () => {
  const recit = "Il marcha vers l'Épée du Roi. Puis il dormit longtemps.";
  const localiser = creerLocalisateur(recit);
  assert.equal(localiser("Puis il dormit"), recit.indexOf("Puis il dormit"));
});

test("une citation aux accents ou a la casse pres est quand meme retrouvee", () => {
  const recit = "Il marcha vers l'Épée du Roi. Puis il dormit longtemps.";
  const localiser = creerLocalisateur(recit);
  assert.equal(localiser("l'epee du roi"), recit.indexOf("l'Épée"));
  assert.equal(localiser("PUIS IL DORMIT"), recit.indexOf("Puis il dormit"));
});

test("une apostrophe typographique ne fait pas rater la citation", () => {
  const recit = "Il marcha vers l'Épée du Roi. Puis il dormit longtemps.";
  const localiser = creerLocalisateur(recit);
  assert.equal(localiser("l’epee du roi"), recit.indexOf("l'Épée"));
});

test("les retours a la ligne du recit ne font pas rater la citation", () => {
  const recit = "Le vent tomba.\n  La mer se calma d'un coup.";
  const localiser = creerLocalisateur(recit);
  const position = localiser("La mer se calma");
  assert.equal(position, recit.indexOf("La mer"));
});

test("une citation absente du recit renvoie -1", () => {
  const localiser = creerLocalisateur("Il ne se passa rien ce jour-la.");
  assert.equal(localiser("le dragon invisible"), -1);
});

test("la carte des scenes couvre toujours le recit en entier, sans perte", () => {
  const recit = "AAA premiere scene. BBB deuxieme scene. CCC troisieme scene. DDD quatrieme scene.";
  const segments = construireSegmentsDepuisCarte(recit, ["AAA premiere", "BBB deuxieme", "CCC troisieme", "DDD quatrieme"]);

  assert.equal(segments.length, 4);
  assert.equal(segments[0].debut, 0, "La premiere scene commence toujours au debut du recit");
  const recolle = segments.map((s) => recit.slice(s.debut, s.fin)).join("");
  assert.equal(recolle, recit, "Les segments doivent recouvrir exactement le recit");
  assert.ok(segments.every((s) => !s.approche), "Toutes les citations etaient exactes : aucune borne approchee");
});

test("une citation introuvable donne une borne approchee, jamais un trou", () => {
  const phrase = "Le vieux marin regarda la mer grise et compta les vagues du soir. ";
  const recit = phrase.repeat(60); // assez long pour que l'interpolation ait la place de couper
  const citations = ["Le vieux marin", "CETTE PHRASE N'EXISTE PAS DU TOUT", phrase.repeat(40).slice(0, 40)];
  const segments = construireSegmentsDepuisCarte(recit, citations);

  assert.equal(segments.length, 3);
  const recolle = segments.map((s) => recit.slice(s.debut, s.fin)).join("");
  assert.equal(recolle, recit, "Meme avec une citation fausse, rien ne doit disparaitre");
  assert.ok(segments[1].approche, "La borne de la citation introuvable doit etre marquee approchee");
  assert.ok(segments[1].debut > 0 && segments[1].debut < recit.length, "La borne approchee doit tomber dans le recit");
});

test("une citation dans le desordre est traitee comme introuvable", () => {
  const recit = "Premiere partie du texte. Deuxieme partie du texte. Troisieme partie du texte.";
  // La troisieme citation pointe AVANT la deuxieme : elle doit etre ignoree et approchee.
  const segments = construireSegmentsDepuisCarte(recit, ["Premiere", "Troisieme partie", "Deuxieme partie"]);

  const recolle = segments.map((s) => recit.slice(s.debut, s.fin)).join("");
  assert.equal(recolle, recit);
  assert.ok(segments[2].approche, "Une borne qui reculerait doit etre recalculee, pas acceptee");
  for (let i = 1; i < segments.length; i++) {
    assert.ok(segments[i].debut >= segments[i - 1].debut, "Les bornes doivent rester dans l'ordre du texte");
  }
});

// ---------------------------------------------------------------------------
// Le decoupage en scenes, en deux passes, teste de bout en bout
// ---------------------------------------------------------------------------

const RECIT_QUATRE_SCENES = [
  "Marie ouvrit la porte de la cuisine et posa son panier sur la grande table de bois.",
  "Plus tard, dans la foret sombre, Paul cherchait un abri pour passer la nuit qui venait.",
  "Au matin, Marie et Paul se retrouverent sur la place du village, devant la fontaine.",
  "Le soir venu, tous deux regagnerent la cuisine ou les attendait un repas fumant.",
].join("\n");

const CARTE_QUATRE_SCENES = {
  scenes: [
    { title: "Le panier", location: "Cuisine", charactersPresent: ["Marie"], debutCitation: "Marie ouvrit la porte de la cuisine" },
    { title: "La nuit", location: "Foret sombre", charactersPresent: ["Paul"], debutCitation: "Plus tard, dans la foret sombre" },
    { title: "La fontaine", location: "Place du village", charactersPresent: ["Marie", "Paul"], debutCitation: "Au matin, Marie et Paul" },
    { title: "Le repas", location: "Cuisine", charactersPresent: ["Marie", "Paul"], debutCitation: "Le soir venu, tous deux" },
  ],
};

/** Rejoue une carte en passe 1, puis des fiches qui citent le passage recu. */
const repondeurDeuxPasses = (appel, contents) => {
  if (appel === 1) return JSON.stringify(CARTE_QUATRE_SCENES);
  const passage = /PASSAGE[\s\S]*?:\n"([\s\S]*)"/.exec(contents);
  return JSON.stringify({
    title: "Fiche",
    location: /Foret/i.test(passage ? passage[1] : "") ? "Foret sombre" : "Cuisine",
    environmentDetail: "decor",
    description: `fiche du passage recu (${passage ? passage[1].length : 0} caracteres)`,
    charactersPresent: ["Marie"],
  });
};

test("les fiches de scenes recoivent chacune leur passage original entier", async () => {
  const { requetes, outils } = outilsFactices(repondeurDeuxPasses);
  const resultat = await decouperEnScenes(outils, RECIT_QUATRE_SCENES, ["Marie", "Paul"], []);

  assert.equal(resultat.scenes.length, 4);
  assert.equal(requetes.length, 5, "Une passe de carte, puis une fiche par scene");

  // Chaque extrait est le passage original, et leur assemblage rend le recit entier.
  const recolle = resultat.scenes.map((s) => s.originalTextExcerpt).join("");
  assert.equal(recolle, RECIT_QUATRE_SCENES, "Les extraits doivent recouvrir exactement le recit");

  // Les fiches ont bien recu le passage brut, pas un resume.
  for (const scene of resultat.scenes) {
    const fiche = requetes.find((r) => r.contents.includes(scene.originalTextExcerpt.slice(0, 40)));
    assert.ok(fiche, "Le passage original de chaque scene doit figurer dans un prompt de fiche");
  }
});

test("une scene est reliee toute seule au decor deja genere qui correspond", async () => {
  const { outils } = outilsFactices(repondeurDeuxPasses);
  const decors = [{ id: "env-foret", name: "La Foret Sombre" }];
  const resultat = await decouperEnScenes(outils, RECIT_QUATRE_SCENES, ["Marie", "Paul"], decors);

  const sceneForet = resultat.scenes.find((s) => /foret/i.test(s.location));
  assert.ok(sceneForet, "La scene de la foret doit exister");
  assert.equal(sceneForet.environmentId, "env-foret", "Le decor correspondant doit etre relie automatiquement");

  const sceneCuisine = resultat.scenes.find((s) => /cuisine/i.test(s.location));
  assert.equal(sceneCuisine.environmentId, undefined, "Sans decor correspondant, pas de liaison inventee");
});

test("les scenes sont livrees au fil de l'eau, dans l'ordre du recit", async () => {
  const { outils } = outilsFactices(repondeurDeuxPasses);
  const livraisons = [];
  outils.partiel = (donnees) => { livraisons.push(donnees.scenes.length); };

  const resultat = await decouperEnScenes(outils, RECIT_QUATRE_SCENES, ["Marie", "Paul"], []);

  assert.ok(livraisons.length >= 2, "Les scenes doivent etre deposees en plusieurs fois, pas d'un bloc final");
  for (let i = 1; i < livraisons.length; i++) {
    assert.ok(livraisons[i] > livraisons[i - 1], "Chaque livraison doit contenir plus de scenes que la precedente");
  }
  assert.equal(livraisons[livraisons.length - 1], 4, "La derniere livraison doit contenir toutes les scenes");
  assert.equal(resultat.scenes[0].originalTextExcerpt.slice(0, 5), "Marie", "L'ordre du recit doit etre conserve");
});

test("les livraisons intermediaires ne transportent pas le recit entier", async () => {
  // Le navigateur relit ce tiroir toutes les deux secondes. Y laisser le passage
  // de chaque scene lui ferait retelecharger le roman complet a chaque sondage.
  const { outils } = outilsFactices(repondeurDeuxPasses);
  const livraisons = [];
  outils.partiel = (donnees) => { livraisons.push(donnees.scenes); };

  const resultat = await decouperEnScenes(outils, RECIT_QUATRE_SCENES, ["Marie", "Paul"], []);

  for (const livraison of livraisons) {
    for (const scene of livraison) {
      assert.equal(scene.originalTextExcerpt, "", "Une livraison intermediaire ne porte aucun passage du recit");
      assert.ok(scene.title, "Elle porte en revanche de quoi afficher la carte");
    }
  }

  // Le resultat final, lui, porte bien le recit entier.
  assert.equal(
    resultat.scenes.map((s) => s.originalTextExcerpt).join(""),
    RECIT_QUATRE_SCENES,
    "Le resultat final doit rendre exactement le recit de depart"
  );
});

test("une fiche qui echoue laisse une scene a reprendre, avec son passage intact", async () => {
  const { outils } = outilsFactices((appel, contents) => {
    if (appel === 1) return JSON.stringify(CARTE_QUATRE_SCENES);
    if (/foret sombre, Paul/.test(contents)) throw new Error("503 Service Unavailable");
    return repondeurDeuxPasses(appel, contents);
  });

  const resultat = await decouperEnScenes(outils, RECIT_QUATRE_SCENES, ["Marie", "Paul"], []);

  assert.equal(resultat.scenes.length, 4, "Un echec de fiche ne doit pas faire disparaitre la scene");
  const enPanne = resultat.scenes.find((s) => /reprendre/.test(s.title));
  assert.ok(enPanne, "La scene en echec doit etre marquee a reprendre");
  assert.ok(enPanne.originalTextExcerpt.includes("foret sombre"), "Son passage du recit doit etre conserve");
});

// ---------------------------------------------------------------------------
// Le rapprochement des lieux, pour relier une scene a un decor genere
// ---------------------------------------------------------------------------

test("un lieu se reconnait dans un nom de decor qui partage un mot significatif", () => {
  assert.equal(memeLieu("Cuisine du chateau", "Chateau de Salazar"), true);
  assert.equal(memeLieu("La Foret Sombre", "foret sombre"), true);
  assert.equal(memeLieu("dans la cave", "La Cave aux vins"), true);
});

test("deux lieux sans mot commun ne sont pas rapproches", () => {
  assert.equal(memeLieu("Cuisine", "Foret"), false);
  assert.equal(memeLieu("dans la maison", "vers le rivage"), false);
});

// ---------------------------------------------------------------------------
// Les modeles et le systeme de repli
// ---------------------------------------------------------------------------

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
  assert.match(
    corpsDeLaFonction("decouperEnScenes", PARTAGE),
    /texteValide/,
    "decouperEnScenes doit valider ses entrees : le point d'appel est public et devinable"
  );

  for (const nom of ["createSceneFromPrompt", "createCharacterFromPrompt", "editGeneratedImage"]) {
    const corps = corpsDeLaFonction(nom);
    assert.match(
      corps,
      /texteValide|imageValide/,
      `${nom} doit valider ses entrees : le point d'appel est public et devinable`
    );
  }
});

test("le type reel des images est conserve, jamais force a PNG", () => {
  // Google renvoie souvent du JPEG. Annoncer "image/png" produisait des fichiers
  // dont l'extension mentait sur le contenu, et faisait echouer l'insertion PDF.
  const forcages = (SOURCE + PARTAGE).match(/data:image\/png;base64,\$\{/g) || [];
  assert.equal(forcages.length, 0, "Le type d'image ne doit pas etre force a PNG dans la reponse");

  const enDur = (SOURCE + PARTAGE).match(/mimeType:\s*"image\/png"/g) || [];
  assert.ok(
    enDur.length <= 1,
    `Les images renvoyees au modele doivent porter leur vrai type. Trouve ${enDur.length} occurrences forcees`
  );
  assert.match(PARTAGE, /export const decouperImage/, "decouperImage doit extraire le type reel des images");

  // Le navigateur aussi : l'assistant de discussion annoncait toute piece jointe
  // en image/png, y compris une photo JPEG, dans l'historique envoye au modele.
  const CHAT = lire("../components/ChatAssistant.tsx");
  assert.ok(
    !/mimeType:\s*'image\/png'/.test(CHAT),
    "L'historique de discussion doit porter le vrai type de l'image jointe"
  );
});

test("une reponse illisible leve une erreur au lieu de renvoyer du vide", () => {
  // L'ancienne version renvoyait une liste vide en silence : l'utilisateur
  // voyait "0 personnage" sans savoir que l'analyse avait echoue.
  assert.ok(!SOURCE.includes("safeJsonParse"), "safeJsonParse renvoyait un repli vide en silence");
  assert.match(PARTAGE, /export const lireJson/, "lireJson doit remplacer safeJsonParse");

  assert.throws(() => lireJson("", "Analyse"), /aucune donnee/, "Une reponse vide doit lever une erreur");
  assert.throws(
    () => lireJson(`{"characters":[${'{"name":"x"},'.repeat(30)}`, "Analyse"),
    /coupee avant la fin/,
    "Une reponse tronquee doit etre signalee clairement, pas rendue en liste vide"
  );
  assert.deepEqual(
    lireJson("```json\n{\"a\":1}\n```", "Analyse"),
    { a: 1 },
    "Les balises de code du modele doivent etre retirees avant lecture"
  );
});

test("le traitement des images reste une Edge Function", () => {
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
// L'Edge Function est coupee par Netlify au bout d'environ 35 secondes, sans
// pouvoir repondre. Tout ce qui lit un recit entier doit donc vivre dans la
// fonction d'arriere-plan, qui dispose de 15 minutes. L'analyse a l'import y
// est passee le 25 aout au matin ; le decoupage en scenes, les recherches
// d'elements manquants et la relecture d'un personnage le 25 aout au soir.
// ---------------------------------------------------------------------------

test("plus aucune lecture de recit entier ne tourne dans l'Edge Function", () => {
  for (const nom of ["analyzeStory", "analyzeScenes", "findMissingScenes", "findMissingCharacters", "findMissingEnvironments", "regenerateCharacterDescription", "segmentTextForScenes"]) {
    assert.ok(
      !SOURCE.includes(`const ${nom}`),
      `${nom} ne doit plus etre definie dans l'Edge Function : son budget est d'environ 35 secondes`
    );
  }
});

test("les taches longues tournent dans la fonction d'arriere-plan et deposent leur resultat", () => {
  // Le suffixe "-background" du nom de fichier est ce qui donne 15 minutes au
  // lieu de 35 secondes. Le renommer casserait la correction en silence.
  assert.ok(
    existsSync(new URL("../netlify/functions/analyse-background.mts", import.meta.url)),
    "Le fichier doit garder le suffixe -background, c'est lui qui declenche les 15 minutes"
  );
  for (const nom of ["analyserRecit", "decouperEnScenes", "trouverScenesManquantes", "trouverPersonnagesManquants", "trouverDecorsManquants", "relirePersonnage"]) {
    assert.match(FOND, new RegExp(nom), `La fonction d'arriere-plan doit savoir lancer ${nom}`);
  }
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
  assert.match(
    FOND,
    /partiel/,
    "Les scenes doivent etre deposees au fil de l'eau, pas seulement en bloc final"
  );
});

test("le navigateur suit l'avancement au lieu d'attendre une reponse directe", () => {
  const corps = corpsDeLaFonction("executerEnArrierePlan", CLIENT);
  assert.match(corps, /URL_LANCEMENT/, "Le navigateur doit lancer la fonction d'arriere-plan");
  assert.match(corps, /URL_STATUT/, "Puis venir consulter l'etat, la reponse ne lui arrive pas toute seule");
  assert.match(corps, /onProgress/, "L'attente peut durer des minutes : elle doit rester lisible");
  assert.match(corps, /onPartial/, "Les scenes deja pretes doivent remonter avant la fin");

  const scenes = corpsDeLaFonction("analyzeScenes", CLIENT);
  assert.match(scenes, /tache: "scenes"/, "Le decoupage en scenes doit passer par le rail d'arriere-plan");
});

// ---------------------------------------------------------------------------
// La troncature silencieuse
//
// Le decoupage ne se faisait que sur les retours a la ligne : un fichier texte
// colle d'un seul bloc donnait UN morceau contenant tout le roman. Ces tests
// portent sur le comportement reel des fonctions, pas sur le texte du fichier.
// Le decoupage sert desormais de filet : bornes approchees de la carte des
// scenes quand une citation est introuvable.
// ---------------------------------------------------------------------------

test("un texte sans le moindre retour a la ligne est decoupe, jamais tronque", () => {
  const roman = "Il etait une fois. ".repeat(20_000); // 380 000 caracteres, zero saut de ligne
  const morceaux = decouperEnParagraphes(roman, TAILLE_MORCEAU);

  assert.ok(morceaux.length > 1, "Un texte de 380 000 caracteres doit produire plusieurs morceaux");
  assert.equal(morceaux.join(""), roman, "Le recoupage doit rendre exactement le texte de depart, sans perte");

  const plusGrand = Math.max(...morceaux.map((m) => m.length));
  assert.ok(
    plusGrand <= TAILLE_MORCEAU,
    `Aucun morceau ne doit depasser ${TAILLE_MORCEAU} caracteres. Trouve : ${plusGrand}`
  );
});

test("un paragraphe trop long est coupe a la fin d'une phrase", () => {
  const phrase = "Le vieux marin regarda la mer grise. ";
  const morceaux = couperParagrapheLong(phrase.repeat(200), 1_000);

  assert.ok(morceaux.length > 1, "Le paragraphe doit etre coupe");
  assert.equal(morceaux.join(""), phrase.repeat(200), "Rien ne doit disparaitre a la coupure");

  // Chaque morceau sauf le dernier doit se terminer sur une fin de phrase.
  for (const m of morceaux.slice(0, -1)) {
    assert.match(m, /[.!?…]["»')\]]?\s*$/, `Coupure au milieu d'une phrase : "...${m.slice(-40)}"`);
  }
});

test("un texte normalement paragraphe garde ses paragraphes entiers", () => {
  const texte = ["Premier paragraphe.", "Deuxieme paragraphe.", "Troisieme paragraphe."].join("\n");
  assert.deepEqual(
    decouperEnParagraphes(texte, TAILLE_MORCEAU),
    [texte],
    "Un texte court doit rester en un seul morceau"
  );
});

// ---------------------------------------------------------------------------
// Une seule definition, pour que les deux serveurs ne divergent plus
// ---------------------------------------------------------------------------

test("le fichier partage ne fait aucun import", () => {
  // L'Edge Function tourne sous Deno et charge le SDK depuis esm.sh, la fonction
  // d'arriere-plan tourne sous Node et le charge depuis node_modules. Un seul
  // import ici casserait l'un des deux, et seulement au deploiement.
  const imports = PARTAGE.match(/^\s*import\s/gm) || [];
  assert.equal(imports.length, 0, "netlify/shared/analyse.ts doit rester sans aucun import");
});

test("le decoupage et la validation n'existent qu'a un seul endroit", () => {
  // Les deux serveurs en gardaient chacun une copie, et elles avaient deja
  // diverge : le decoupage en paragraphes n'etait pas le meme des deux cotes.
  const apresImports = SOURCE.split('from "../shared/analyse.ts";')[1] || "";
  for (const nom of ["decouperEnParagraphes", "texteValide", "lireJson", "decouperImage", "LIMITES"]) {
    assert.ok(
      !new RegExp(`const ${nom}\\s*=`).test(apresImports),
      `${nom} ne doit plus etre redefini dans l'Edge Function : il vient du fichier partage`
    );
  }
  assert.match(SOURCE, /from "\.\.\/shared\/analyse\.ts"/, "L'Edge Function doit importer le fichier partage");
});

// ---------------------------------------------------------------------------
// Les entrees venant de l'utilisateur
// ---------------------------------------------------------------------------

test("une image d'un format non prevu est refusee avant d'atteindre Google", () => {
  assert.throws(
    () => imageValide("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "L'image"),
    ErreurDeSaisie,
    "Un SVG est un document executable : il n'a rien a faire dans une requete de generation"
  );
  assert.throws(() => imageValide("pas une image du tout", "L'image"), ErreurDeSaisie);

  const jpeg = "data:image/jpeg;base64,/9j/4AAQ";
  assert.equal(imageValide(jpeg, "L'image"), jpeg, "Une photo JPEG doit passer");
  assert.equal(imageValide(undefined, "L'image", false), "", "Une image facultative absente ne doit pas lever");
});

// ---------------------------------------------------------------------------
// Le navigateur
// ---------------------------------------------------------------------------

test("aucun composant ne touche localStorage sans protection", () => {
  // En navigation privee ou avec les cookies bloques, un simple getItem LEVE.
  // Appele depuis un effet React sans protection, il faisait tomber toute
  // l'application sur une page blanche, pour un compteur de tutoriel.
  const composants = ["OnboardingTour", "ChatAssistant", "BookViewer", "Gallery", "SceneGallery"];
  for (const nom of composants) {
    const source = lire(`../components/${nom}.tsx`);
    assert.ok(
      !/localStorage\./.test(source),
      `${nom} doit passer par lirePreference / ecrirePreference, qui ne peuvent pas echouer`
    );
  }
});

test("une erreur de rendu affiche un message, pas une page blanche", () => {
  const RACINE = lire("../index.tsx");
  assert.match(RACINE, /FrontiereErreur/, "L'application doit etre entouree d'une frontiere d'erreur");

  const FRONTIERE = lire("../components/FrontiereErreur.tsx");
  assert.match(FRONTIERE, /getDerivedStateFromError/, "La frontiere doit attraper l'erreur de rendu");
  assert.match(FRONTIERE, /componentDidCatch/, "Et la consigner, pour pouvoir corriger la cause");
});

test("le lecteur de PDF est dans une version corrigee de CVE-2024-4367", () => {
  // La version 3 de pdf.js est concernee par CVE-2024-4367 : un PDF fabrique
  // expres peut faire executer du JavaScript dans la page. Or l'application
  // consiste a ouvrir un PDF fourni par l'utilisateur.
  const paquet = JSON.parse(lire("../package.json"));
  const demandee = paquet.dependencies["pdfjs-dist"] || "";
  const majeure = Number((demandee.match(/(\d+)/) || [])[1]);

  assert.ok(
    Number.isFinite(majeure) && majeure >= 4,
    `pdfjs-dist doit rester en version 4 ou plus (demandee : ${demandee || "aucune"})`
  );
});

test("les fichiers importes sont verifies avant d'etre lus", () => {
  // L'attribut `accept` d'un champ ne s'applique pas au glisser-deposer : un
  // .docx lache sur la zone etait lu comme du texte et envoye chez Google.
  const UPLOAD = lire("../components/FileUpload.tsx");
  assert.match(UPLOAD, /verifierFichierRecit/, "Le depot de fichier doit passer par la verification commune");

  const FICHIERS = lire("../services/fichiers.ts");
  assert.match(FICHIERS, /TAILLE_MAX_RECIT/, "Un plafond de poids doit exister pour les recits");
  assert.match(FICHIERS, /TAILLE_MAX_IMAGE/, "Un plafond de poids doit exister pour les images");
});

// ---------------------------------------------------------------------------
// Le rapprochement des noms de personnages
//
// La comparaison etait `a.includes(b) || b.includes(a)` sur les noms en
// minuscules. Consequence visible dans les images produites : un personnage
// nomme "Al" etait reconnu dans "Salazar" comme dans "journal", et sa fiche
// partait en image de reference pour des scenes ou il n'apparait pas. Le
// storyboard montrait alors le mauvais visage, sans que rien ne l'explique.
// ---------------------------------------------------------------------------

test("un nom court ne se reconnait pas dans un mot qui le contient", () => {
  assert.equal(memePersonnage("Salazar", "Al"), false, '"Al" ne doit pas etre reconnu dans "Salazar"');
  assert.equal(memePersonnage("Alice", "Al"), false, '"Al" ne doit pas etre reconnu dans "Alice"');
  assert.equal(memePersonnage("le journal", "Al"), false, '"Al" ne doit pas etre reconnu dans "journal"');
});

test("un prenom se reconnait dans un nom complet", () => {
  assert.equal(memePersonnage("Marie Dupont", "Marie"), true);
  assert.equal(memePersonnage("Marie", "Marie Dupont"), true);
  assert.equal(memePersonnage("le capitaine Nemo", "Nemo"), true);
});

test("un nom ne se reconnait pas au milieu d'un autre mot", () => {
  assert.equal(memePersonnage("marierait", "Marie"), false, "La coupure doit tomber sur une frontiere de mot");
});

test("les accents et la casse ne changent rien", () => {
  assert.equal(memePersonnage("HÉLÈNE", "Helene"), true);
  assert.equal(memePersonnage("hélène de troie", "Hélène"), true);
});

test("un nom vide ne se reconnait nulle part", () => {
  assert.equal(memePersonnage("", "Marie"), false);
  assert.equal(memePersonnage("Marie", "   "), false);
});

test("l'Edge Function passe le controle de types de Deno", () => {
  // Le tsconfig du projet exclut netlify/edge-functions : ce fichier, le seul a
  // manipuler la cle API, n'etait verifie par rien avant d'etre deploye. La
  // configuration ci-dessous rend `npm run check:edge` possible.
  assert.ok(
    existsSync(new URL("../netlify/edge-functions/deno.check.json", import.meta.url)),
    "La configuration de verification Deno doit exister, sinon npm run check:edge ne peut plus tourner"
  );

  const PKG = JSON.parse(lire("../package.json"));
  assert.ok(PKG.scripts["check:edge"], "Le script check:edge doit rester declare");
  assert.match(PKG.scripts.verify, /check:edge/, "La verification complete doit inclure l'Edge Function");
});
