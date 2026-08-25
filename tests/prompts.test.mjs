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
  CHUNK_MAX,
  couperParagrapheLong,
  decouperEnParagraphes,
  condenserSegment,
  lireJson,
  imageValide,
  memePersonnage,
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
  assert.match(PARTAGE, /export const condenserSegment/, "L'analyse partagee doit condenser au lieu de couper");
  assert.match(
    SOURCE,
    /condenserSegment/,
    "L'Edge Function doit utiliser la condensation partagee, pas sa propre copie"
  );

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

// ---------------------------------------------------------------------------
// La troncature silencieuse
//
// Ces tests gardent la correction du 25 aout. Le decoupage ne se faisait que sur
// les retours a la ligne : un fichier texte colle d'un seul bloc, ou un PDF dont
// l'extraction n'en produit aucun, donnait UN morceau contenant tout le roman,
// aussitot ramene a 12 000 caracteres par un `slice`. Sur un recit de 400 000
// caracteres, 97 % du livre n'etait jamais lu, et rien ne le disait.
//
// Ils portent sur le comportement reel des fonctions, pas sur le texte du
// fichier : c'est la seule facon de detecter une perte de contenu.
// ---------------------------------------------------------------------------

test("un texte sans le moindre retour a la ligne est decoupe, jamais tronque", () => {
  const roman = "Il etait une fois. ".repeat(20_000); // 380 000 caracteres, zero saut de ligne
  const morceaux = decouperEnParagraphes(roman, CHUNK_MAX);

  assert.ok(morceaux.length > 1, "Un texte de 380 000 caracteres doit produire plusieurs morceaux");
  assert.equal(morceaux.join(""), roman, "Le recoupage doit rendre exactement le texte de depart, sans perte");

  const plusGrand = Math.max(...morceaux.map((m) => m.length));
  assert.ok(
    plusGrand <= CHUNK_MAX,
    `Aucun morceau ne doit depasser ${CHUNK_MAX} caracteres, sinon il sera tronque plus loin. Trouve : ${plusGrand}`
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
    decouperEnParagraphes(texte, CHUNK_MAX),
    [texte],
    "Un texte court doit rester en un seul morceau"
  );
});

test("la condensation envoie la totalite du recit au modele", async () => {
  const roman = "Un evenement se produisit dans la maison basse. ".repeat(1_000); // ~47 000 caracteres
  const passagesRecus = [];

  const outils = {
    Type: {},
    generer: async (_role, requete) => {
      const passage = /PASSAGE :\n"([\s\S]*)"$/.exec(requete.contents);
      assert.ok(passage, "Le prompt de resume doit contenir le passage a resumer");
      passagesRecus.push(passage[1]);
      return { text: `resume ${passagesRecus.length}` };
    },
  };

  const condense = await condenserSegment(outils, roman);

  assert.ok(passagesRecus.length > 1, "Un texte de 47 000 caracteres doit partir en plusieurs appels");
  assert.equal(
    passagesRecus.join(""),
    roman,
    "Le modele doit avoir recu l'integralite du recit, sans qu'aucune tranche soit ignoree"
  );
  assert.match(condense, /resume 1/, "Le resultat doit assembler les resumes");
});

test("une tranche qui echoue une fois est retentee avant d'etre abandonnee", async () => {
  const roman = "Le vent tomba sur la lande deserte. ".repeat(1_000);
  let appels = 0;

  const outils = {
    Type: {},
    generer: async () => {
      appels += 1;
      // Le tout premier appel echoue, comme une coupure passagere chez Google.
      if (appels === 1) throw new Error("503 Service Unavailable");
      return { text: "resume" };
    },
  };

  const condense = await condenserSegment(outils, roman);

  assert.ok(appels > 1, "Un echec passager doit declencher un nouvel essai");
  assert.ok(
    !condense.includes("Le vent tomba sur la lande deserte. Le vent tomba"),
    "Apres un nouvel essai reussi, le repli en texte brut ne doit pas etre utilise"
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

test("le lecteur de PDF n'evalue pas le code contenu dans un document", () => {
  // La version 3 de pdf.js est concernee par CVE-2024-4367 : un PDF fabrique
  // expres peut faire executer du JavaScript dans la page. Or l'application
  // consiste a ouvrir un PDF fourni par l'utilisateur.
  const PDF = lire("../services/pdfService.ts");
  assert.match(PDF, /isEvalSupported:\s*false/, "getDocument doit couper l'evaluation de code");
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
