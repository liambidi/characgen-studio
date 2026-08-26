/**
 * Tests des prompts d'images du storyboard.
 *
 * L'Edge Function ne peut pas etre importee ici : elle charge le SDK Google par
 * URL, ce que seul Deno sait faire. Ces tests lisent donc son texte, comme le
 * font deja ceux de prompts.test.mjs. C'est une garde faible sur la forme, mais
 * elle attrape ce qui compte : la disparition silencieuse d'une consigne.
 *
 * Chaque test nomme le defaut qu'il empeche de revenir.
 *
 * Lancement : npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), "utf8");

const SOURCE = lire("../netlify/edge-functions/gemini.ts");
const TYPES = lire("../types.ts");
const APP = lire("../App.tsx");

// ---------------------------------------------------------------------------
// Le personnage dedouble
// ---------------------------------------------------------------------------

test("le prompt dit que la planche montre une seule personne, pas trois", () => {
  // C'est la phrase qui manquait. On envoyait une image contenant trois fois le
  // meme personnage sans jamais dire que c'etait le meme, et le modele en
  // recopiait parfois deux dans la scene.
  assert.match(SOURCE, /THE SAME SINGLE PERSON drawn three times/);
  assert.match(SOURCE, /is ONE person, not three/);
});

test("la planche elle-meme se declare comme une seule personne vue trois fois", () => {
  assert.match(SOURCE, /CHARACTER MODEL SHEET for ONE single person/);
  assert.match(SOURCE, /three views of ONE individual, not three different characters/);
});

test("le prompt de scene compte le casting et interdit les doublons", () => {
  assert.match(SOURCE, /CASTING RULE/);
  assert.match(SOURCE, /appears EXACTLY ONCE/);
  assert.match(SOURCE, /no twin, no mirrored copy/);
});

test("le prompt interdit explicitement la mise en page d'une planche", () => {
  // Sans cela, le modele reprenait la structure en trois panneaux de l'image
  // de reference qu'on venait de lui donner.
  assert.match(SOURCE, /NO character sheet layout/);
  assert.match(SOURCE, /NO collage, NO split screen/);
});

// ---------------------------------------------------------------------------
// Les personnages oublies
// ---------------------------------------------------------------------------

test("la limite de deux personnages par scene a disparu", () => {
  assert.ok(
    !/slice\(0,\s*2\)/.test(SOURCE),
    "deux references maximum laissait les personnages suivants sans visage"
  );
  assert.match(SOURCE, /REFERENCES_PERSONNAGE_MAX = 3/);
});

test("les personnages sans planche recoivent leur description ecrite", () => {
  // Au dela de la limite, ils ne recevaient rien du tout : ni image, ni texte.
  assert.match(SOURCE, /NO REFERENCE IMAGE for the following characters/);
  assert.match(SOURCE, /physicalDescription/);
});

// ---------------------------------------------------------------------------
// Le decor impose
// ---------------------------------------------------------------------------

test("l'image du decor n'est envoyee que si l'utilisateur l'a verrouillee", () => {
  assert.match(SOURCE, /decorVerrouille/);
  assert.match(SOURCE, /scene\.verrouillerDecor/);
  // L'ancienne consigne, qui envoyait l'image en demandant de ne pas la suivre.
  assert.ok(
    !/DO NOT COPY THE LAYOUT/.test(SOURCE),
    "cette consigne accompagnait une image envoyee systematiquement, ce qui ne marchait pas"
  );
});

test("le decor a une existence ecrite, utilisable sans image", () => {
  assert.match(SOURCE, /decorEnMots/);
  assert.match(SOURCE, /never a layout to copy/);
});

test("le verrou du decor existe dans le type d'une scene", () => {
  assert.match(TYPES, /verrouillerDecor\?: boolean/);
});

// ---------------------------------------------------------------------------
// La derive de style
// ---------------------------------------------------------------------------

test("le style est place en tete de chaque prompt d'image, pas en queue", () => {
  assert.match(SOURCE, /const enTeteArtistique/);
  // Les trois generateurs d'images doivent l'appeler : decor, personnage, scene.
  const appels = SOURCE.match(/enTeteArtistique\(style\)/g) || [];
  assert.ok(
    appels.length >= 3,
    `le style doit ouvrir les trois prompts d'image, il n'en ouvre que ${appels.length}`
  );
});

test("l'ancien ART STYLE en fin de prompt a disparu", () => {
  assert.ok(
    !/ART STYLE: \$\{style\}/.test(SOURCE),
    "le style arrivait en derniere ligne, la ou un modele d'image le pondere le moins"
  );
});

// ---------------------------------------------------------------------------
// Le prompt personnalise
// ---------------------------------------------------------------------------

test("une consigne personnalisee s'ajoute a la hierarchie au lieu de l'effacer", () => {
  assert.match(SOURCE, /consigneUtilisateur/);
  assert.match(SOURCE, /PRIORITY ORDER, highest first/);
  // Le bloc qui remplacait tout le prompt et supprimait les garde-fous.
  assert.ok(
    !/CUSTOM USER PROMPT \(HIGHEST PRIORITY\)/.test(SOURCE),
    "ce bloc remplacait le prompt entier, hierarchie et regle de casting comprises"
  );
});

test("la regle de casting reste presente meme avec une consigne personnalisee", () => {
  // La regle est construite avant le prompt, hors de toute branche
  // conditionnelle : elle ne peut plus etre contournee.
  const avantPrompt = SOURCE.slice(0, SOURCE.indexOf("const textPrompt"));
  assert.match(avantPrompt, /const regleCasting/);
  assert.match(avantPrompt, /const consigneUtilisateur/);
});

// ---------------------------------------------------------------------------
// La planche coupee a l'affichage
// ---------------------------------------------------------------------------

test("la planche est demandee dans un format large, comme son prompt le reclame", () => {
  // Elle etait demandee en 1:1 alors que le prompt exigeait un format large,
  // et l'ecran la recadrait ensuite en 3/4 : on n'en voyait qu'un tiers.
  assert.match(APP, /RATIO_PLANCHE/);
  assert.match(APP, /const RATIO_PLANCHE: GenConfig\['aspectRatio'\] = '3:2'/);
  assert.ok(
    !/aspectRatio: '1:1'/.test(APP),
    "la planche a trois vues ne tient pas dans un carre"
  );
});

test("la galerie affiche la planche en entier, sans la rogner", () => {
  const galerie = lire("../components/Gallery.tsx");
  assert.match(galerie, /aspect-\[3\/2\]/);
  assert.match(galerie, /object-contain/);
});

// ---------------------------------------------------------------------------
// L'avertissement demande
// ---------------------------------------------------------------------------

test("l'avertissement sur le personnage dedouble est montre aux deux moments utiles", () => {
  const avertissement = lire("../components/AvertissementPlanche.tsx");
  assert.match(avertissement, /apparaître en double/);
  assert.match(lire("../components/SceneReview.tsx"), /AvertissementPlanche/);
  assert.match(lire("../components/SceneGallery.tsx"), /AvertissementPlanche/);
});

test("l'avertissement dit quoi faire, pas seulement que ca arrive", () => {
  const avertissement = lire("../components/AvertissementPlanche.tsx");
  assert.match(avertissement, /relancez cette vignette/i);
});
