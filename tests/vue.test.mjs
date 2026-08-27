/**
 * Tests du mode d'affichage compact.
 *
 * POURQUOI CES TESTS EXISTENT
 *
 * Rien de ce que fait `services/vue.ts` ne se voit a l'oeil. Une recherche qui
 * ignore les accents rend « aucun resultat » sur une fiche qui existe, et
 * l'utilisateur en conclut que la fiche a disparu. Un filtre « en erreur » qui
 * se trompe de statut affiche une liste vide, et l'utilisateur en conclut que
 * tout va bien. Dans les deux cas l'ecran a l'air normal : c'est exactement le
 * genre de panne qu'un test doit attraper, parce qu'une relecture ne l'attrape
 * pas.
 *
 * Lancement : npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normaliser,
  correspond,
  filtrerParEtat,
  compterEtats,
  scenesParPersonnage,
  scenesParDecor,
  resumeScenes,
  detailScenes,
  ancre,
} from "../services/vue.ts";

// ---------------------------------------------------------------------------
// Recherche
// ---------------------------------------------------------------------------

test("normaliser retire les accents, la casse et les espaces de bord", () => {
  assert.equal(normaliser("  Maëlle Trévidic  "), "maelle trevidic");
  assert.equal(normaliser("ÉLÈVE"), "eleve");
  assert.equal(normaliser("Ça et Où"), "ca et ou");
  assert.equal(normaliser(""), "");
});

test("chercher sans accent trouve une fiche accentuee, et l'inverse", () => {
  const champs = ["Maëlle Trévidic", "Douanière"];
  assert.equal(correspond(champs, "maelle"), true);
  assert.equal(correspond(champs, "MAËLLE"), true);
  assert.equal(correspond(champs, "douaniere"), true);
});

test("chaque mot cherche doit se retrouver, meme dans deux champs differents", () => {
  const champs = ["La porte close", "Maison de la douane"];
  // Les deux mots existent, mais dans deux champs qui ne se suivent pas.
  assert.equal(correspond(champs, "porte douane"), true);
  assert.equal(correspond(champs, "porte grenier"), false);
});

test("un mot ne peut pas se former a cheval sur deux champs", () => {
  // « closemaison » n'existe nulle part : sans separateur, la concatenation
  // brute des deux champs le ferait apparaitre.
  assert.equal(correspond(["La porte close", "Maison de la douane"], "closemaison"), false);
});

test("une recherche vide ou faite d'espaces ne filtre rien", () => {
  assert.equal(correspond(["Yann"], ""), true);
  assert.equal(correspond(["Yann"], "   "), true);
});

test("les champs absents ne font pas echouer la recherche", () => {
  assert.equal(correspond(["Yann", undefined, null, ""], "yann"), true);
});

// ---------------------------------------------------------------------------
// Filtre d'etat
// ---------------------------------------------------------------------------

const collection = [
  { id: "a", status: "completed" },
  { id: "b", status: "error" },
  { id: "c", status: "pending" },
  { id: "d", status: "generating" },
  { id: "e" }, // sans statut, projet enregistre avant ce champ
];

test("le filtre d'etat separe faits, restants et erreurs", () => {
  assert.deepEqual(filtrerParEtat(collection, "faits").map((e) => e.id), ["a"]);
  assert.deepEqual(filtrerParEtat(collection, "erreurs").map((e) => e.id), ["b"]);
  // « restants » couvre ce qui attend, ce qui tourne, et ce qui n'a pas de statut.
  assert.deepEqual(filtrerParEtat(collection, "restants").map((e) => e.id), ["c", "d", "e"]);
  assert.equal(filtrerParEtat(collection, "tous").length, 5);
});

test("les comptes affiches correspondent au filtre applique", () => {
  const comptes = compterEtats(collection);
  assert.deepEqual(comptes, { total: 5, faits: 1, restants: 3, erreurs: 1 });
  // La promesse tenue par les etiquettes : un compte annonce ouvre bien ce nombre de lignes.
  assert.equal(filtrerParEtat(collection, "faits").length, comptes.faits);
  assert.equal(filtrerParEtat(collection, "restants").length, comptes.restants);
  assert.equal(filtrerParEtat(collection, "erreurs").length, comptes.erreurs);
});

// ---------------------------------------------------------------------------
// Qui apparait dans quelle scene
// ---------------------------------------------------------------------------

const personnages = [
  { id: "p1", name: "Maëlle Trévidic" },
  { id: "p2", name: "Yann Le Guen" },
  { id: "p3", name: "Le père" },
];

const scenes = [
  { id: "s1", charactersPresent: ["Maëlle"], location: "Le quai", environmentId: "d1" },
  { id: "s2", charactersPresent: ["Maëlle", "Yann Le Guen"], location: "Maison de la douane" },
  { id: "s3", charactersPresent: [], location: "Le grenier" },
  { id: "s4", charactersPresent: ["Yann"], location: "Le quai", environmentId: "d1" },
];

test("un personnage porte les numeros de scene, comptes a partir de 1", () => {
  const index = scenesParPersonnage(scenes, personnages);
  assert.deepEqual(index.p1, [1, 2]);
  assert.deepEqual(index.p2, [2, 4]);
  // Un personnage absent existe dans l'index, avec une liste vide.
  assert.deepEqual(index.p3, []);
});

test("le rapprochement des noms suit la frontiere de mot, comme le serveur", () => {
  // « Al » est trop court pour etre reconnu dans « Salazar » : la regle vient de
  // memePersonnage, et ce test verifie qu'on ne l'a pas contournee ici.
  const index = scenesParPersonnage(
    [{ charactersPresent: ["Salazar"] }],
    [{ id: "x", name: "Al" }]
  );
  assert.deepEqual(index.x, []);
});

test("une scene sans charactersPresent ne fait pas tomber le calcul", () => {
  const index = scenesParPersonnage([{ id: "s" }], personnages);
  assert.deepEqual(index.p1, []);
});

test("un decor se relie par identifiant, sinon par nom de lieu", () => {
  const decors = [
    { id: "d1", name: "Le quai" },
    { id: "d2", name: "Maison de la douane" },
  ];
  const index = scenesParDecor(scenes, decors);
  // s1 et s4 portent environmentId, s2 est rattachee par son nom de lieu.
  assert.deepEqual(index.d1, [1, 4]);
  assert.deepEqual(index.d2, [2]);
});

test("un environmentId qui ne designe aucun decor connu retombe sur le nom", () => {
  const decors = [{ id: "d2", name: "Maison de la douane" }];
  const index = scenesParDecor(
    [{ environmentId: "supprime", location: "Maison de la douane" }],
    decors
  );
  assert.deepEqual(index.d2, [1]);
});

// ---------------------------------------------------------------------------
// Etiquettes
// ---------------------------------------------------------------------------

test("l'etiquette reste vide quand il n'y a aucune scene", () => {
  // Quarante figurants a « 0 scene » feraient du bruit sans rien apprendre.
  assert.equal(resumeScenes([]), "");
  assert.equal(resumeScenes(undefined), "");
  assert.equal(resumeScenes([7]), "1 scene");
  assert.equal(resumeScenes([7, 9]), "2 scenes");
});

test("le detail cite les numeros et coupe au-dela de douze", () => {
  assert.equal(detailScenes([3]), "Scene 3");
  assert.equal(detailScenes([3, 9]), "Scenes 3, 9");

  const beaucoup = Array.from({ length: 15 }, (_, i) => i + 1);
  const texte = detailScenes(beaucoup);
  assert.ok(texte.includes("1, 2, 3"));
  assert.ok(texte.endsWith("et 3 autres"));
  assert.equal(texte.includes("13"), false);
});

test("l'ancre est prefixee par etape, deux collections ne se confondent pas", () => {
  assert.equal(ancre("scene", "abc"), "fiche-scene-abc");
  assert.notEqual(ancre("scene", "abc"), ancre("perso", "abc"));
});
