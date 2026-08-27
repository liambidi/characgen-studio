/**
 * Tests du feuilletage.
 *
 * Ces tests existent parce que la seule chose qui peut vraiment casser dans le
 * liseur est invisible a l'oeil : le rapport entre la feuille qu'on retourne et
 * la double page qui apparait ensuite. Si le verso de la feuille n'est pas
 * exactement la page qui doit se poser a gauche, on ne voit pas une erreur, on
 * voit un livre qui se lit a contretemps, une page en retard ou en avance,
 * pendant trente planches, sans jamais rien afficher d'anormal.
 *
 * Lancement : npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  construireFeuillets,
  disposerFeuillets,
  positionDeLaPlanche,
} from "../services/liseur.ts";

const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), "utf8");

/** Des planches minimales : seul l'identifiant compte pour le feuilletage. */
const planches = (combien) =>
  Array.from({ length: combien }, (_, i) => ({
    id: `s${i + 1}`,
    title: `Planche ${i + 1}`,
    location: "",
    environmentDetail: "",
    description: "",
    originalTextExcerpt: "",
    charactersPresent: [],
    status: "completed",
    imageUrl: "data:image/png;base64,xx",
  }));

/** L'alternance par defaut : l'illustration a gauche une planche sur deux. */
const alternance = (_id, index) => index % 2 === 0;

// ---------------------------------------------------------------------------
// La liste des feuillets
// ---------------------------------------------------------------------------

test("la liste vaut toujours 2N + 4 feuillets, donc un nombre pair", () => {
  for (const combien of [0, 1, 2, 3, 7, 30]) {
    const feuillets = construireFeuillets(planches(combien), alternance);
    assert.equal(feuillets.length, 2 * combien + 4, `${combien} planches`);
    assert.equal(feuillets.length % 2, 0, "une liste impaire laisserait une double page bancale");
  }
});

test("les gardes encadrent le livre, la couverture et le colophon sont a leur place", () => {
  const feuillets = construireFeuillets(planches(3), alternance);
  assert.equal(feuillets[0].nature, "garde");
  assert.equal(feuillets[0].cote, "avant");
  assert.equal(feuillets[1].nature, "couverture");
  assert.equal(feuillets[feuillets.length - 2].nature, "colophon");
  assert.equal(feuillets[feuillets.length - 1].nature, "garde");
  assert.equal(feuillets[feuillets.length - 1].cote, "arriere");
});

test("chaque planche occupe une double page entiere, jamais a cheval sur deux", () => {
  const feuillets = construireFeuillets(planches(5), alternance);
  for (let i = 0; i < 5; i += 1) {
    const gauche = feuillets[positionDeLaPlanche(i)];
    const droite = feuillets[positionDeLaPlanche(i) + 1];
    assert.equal(gauche.numero, i + 1, `la page gauche de la planche ${i + 1}`);
    assert.equal(droite.numero, i + 1, `la page droite de la planche ${i + 1}`);
    assert.notEqual(gauche.nature, droite.nature, "une planche montre une image et un texte, pas deux fois la meme chose");
  }
});

test("l'illustration change de cote a chaque planche", () => {
  const feuillets = construireFeuillets(planches(4), alternance);
  const cotes = [0, 1, 2, 3].map((i) => feuillets[positionDeLaPlanche(i)].nature);
  assert.deepEqual(cotes, ["image", "texte", "image", "texte"]);
});

test("une inversion demandee a la main retourne une seule planche, pas les suivantes", () => {
  const inverseeSeulement2 = (id, index) => (id === "s2" ? index % 2 !== 0 : index % 2 === 0);
  const feuillets = construireFeuillets(planches(4), inverseeSeulement2);
  const cotes = [0, 1, 2, 3].map((i) => feuillets[positionDeLaPlanche(i)].nature);
  assert.deepEqual(cotes, ["image", "image", "image", "texte"]);
});

test("le sommaire ouvre toujours sur un rang pair, donc sur une vraie double page", () => {
  for (let i = 0; i < 12; i += 1) {
    assert.equal(positionDeLaPlanche(i) % 2, 0, `planche ${i + 1}`);
  }
});

// ---------------------------------------------------------------------------
// Le tour de page, en double page
// ---------------------------------------------------------------------------

test("au repos, la double page montre un rang pair a gauche et son suivant a droite", () => {
  const vue = disposerFeuillets(6, true, null);
  assert.deepEqual(vue, { gauche: 6, droite: 7, recto: null, verso: null });
});

test("la feuille qui tourne porte bien les deux faces d'une meme feuille de papier", () => {
  const vue = disposerFeuillets(4, true, 1);
  // Le recto est la page de droite qu'on soulve ; le verso est le feuillet
  // immediatement suivant, parce que c'est le dos de cette meme page.
  assert.equal(vue.recto, 5);
  assert.equal(vue.verso, 6);
});

test("apres un tour en avant, on retombe exactement sur la double page suivante", () => {
  for (let position = 0; position <= 20; position += 2) {
    const pendant = disposerFeuillets(position, true, 1);
    const apres = disposerFeuillets(position + 2, true, null);

    // Le verso de la feuille se pose a gauche, et la page decouverte en dessous
    // reste a droite. C'est toute la mecanique du papier, et c'est ce qui doit
    // tenir : sinon le livre se lit avec une page de decalage.
    assert.equal(pendant.verso, apres.gauche, `depuis ${position}, le verso doit devenir la page de gauche`);
    assert.equal(pendant.droite, apres.droite, `depuis ${position}, la page decouverte doit rester a droite`);
  }
});

test("apres un tour en arriere, on retombe exactement sur la double page precedente", () => {
  for (let position = 2; position <= 20; position += 2) {
    const pendant = disposerFeuillets(position, true, -1);
    const apres = disposerFeuillets(position - 2, true, null);

    assert.equal(pendant.verso, apres.droite, `depuis ${position}, le verso doit devenir la page de droite`);
    assert.equal(pendant.gauche, apres.gauche, `depuis ${position}, la page decouverte doit rester a gauche`);
  }
});

test("avancer puis reculer ramene au point de depart", () => {
  const depart = 8;
  const apresAvant = disposerFeuillets(depart, true, 1).verso;
  const revenu = disposerFeuillets(apresAvant, true, -1);
  assert.equal(revenu.verso, disposerFeuillets(depart, true, null).droite);
  assert.equal(revenu.gauche, depart);
});

// ---------------------------------------------------------------------------
// Le tour de page, en page simple
// ---------------------------------------------------------------------------

test("en page simple, une seule page est posee et il n'y a pas de verso", () => {
  assert.deepEqual(disposerFeuillets(5, false, null), { gauche: 5, droite: null, recto: null, verso: null });
  assert.equal(disposerFeuillets(5, false, 1).verso, null);
  assert.equal(disposerFeuillets(5, false, -1).verso, null);
});

test("en page simple, la feuille qui sort decouvre la suivante, celle qui entre couvre la courante", () => {
  const avant = disposerFeuillets(5, false, 1);
  assert.equal(avant.recto, 5, "la page qu'on quitte est celle qui pivote");
  assert.equal(avant.gauche, 6, "la page qu'on decouvre est posee dessous");

  const arriere = disposerFeuillets(5, false, -1);
  assert.equal(arriere.recto, 4, "la page qui revient est celle qui pivote");
  assert.equal(arriere.gauche, 5, "la page courante reste posee dessous");
});

// ---------------------------------------------------------------------------
// Ce que le composant ne doit pas refaire dans son coin
// ---------------------------------------------------------------------------

test("le composant appelle le service au lieu de recalculer les rangs a la main", () => {
  const source = lire("../components/Liseur.tsx");
  assert.ok(
    source.includes("disposerFeuillets(position, double, tour)"),
    "la disposition doit venir du service, c'est la seule version verifiee par ces tests"
  );
  assert.ok(
    source.includes("construireFeuillets(scenes, imageEnPremier)"),
    "la liste des feuillets aussi, sinon le compte pair ne serait plus garanti que par relecture"
  );
  // Le composant garde le droit de calculer des rangs pour precharger les
  // images voisines. Ce qu'il ne doit plus faire, c'est nommer lui-meme les
  // quatre places de la double page : c'est la que le decalage se glissait.
  assert.ok(
    !/\brangVerso\b/.test(source),
    "les quatre places viennent du service, le composant ne les redeclare pas"
  );
});
