/**
 * Tests des formats de livre et du cadrage des illustrations.
 *
 * Ces tests existent parce que le defaut qu'ils gardent etait invisible : dix
 * formats etaient proposes, quatre images differentes en sortaient, et rien
 * dans l'interface ne le disait. Un test qui compte les ratios distincts le
 * voit tout de suite, un oeil humain non.
 *
 * Lancement : npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BOOK_FORMATS,
  RATIOS_IMAGE,
  valeurDuRatio,
  ratioDeLaPage,
  ratioPourCadrage,
  ecartDeCadrage,
  formatParId,
  libelleFormat,
} from "../services/formats.ts";

const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// Le catalogue
// ---------------------------------------------------------------------------

test("chaque format porte de vraies dimensions, et rien qui les contredise", () => {
  for (const f of BOOK_FORMATS) {
    assert.ok(f.largeurMm > 0 && f.hauteurMm > 0, `${f.id} doit avoir des millimetres`);
    assert.equal(
      f.famille,
      f.largeurMm < f.hauteurMm ? "portrait" : "paysage",
      `${f.id} : la famille annoncee contredit les millimetres`
    );
    assert.ok(f.nom && f.dimensions, `${f.id} doit avoir un nom et des dimensions lisibles`);
  }
});

test("plus aucun format ne transporte un ratio ecrit a la main", () => {
  const source = lire("../services/formats.ts");
  const catalogue = source.slice(source.indexOf("export const BOOK_FORMATS"));
  assert.ok(
    !/\bratio:/.test(catalogue),
    "un ratio fige dans le catalogue est exactement le bug qu'on vient de retirer"
  );
});

test("les identifiants des formats n'ont pas change, les projets sauvegardes restent lisibles", () => {
  const attendus = [
    "a4_p", "moyen_p", "a5_p", "digest_p", "poche_p",
    "a4_l", "moyen_l", "a5_l", "digest_l", "poche_l",
  ];
  assert.deepEqual(BOOK_FORMATS.map((f) => f.id), attendus);
});

test("un identifiant inconnu retombe sur un format, jamais sur undefined", () => {
  assert.equal(formatParId("nawak").id, BOOK_FORMATS[0].id);
  assert.equal(formatParId("poche_p").id, "poche_p");
});

// ---------------------------------------------------------------------------
// Les ratios acceptes par Gemini
// ---------------------------------------------------------------------------

test("les huit ratios de l'API sont connus, y compris les deux qui manquaient", () => {
  for (const attendu of ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"]) {
    assert.ok(RATIOS_IMAGE.includes(attendu), `${attendu} doit figurer dans la liste`);
  }
  // 2:3 et 3:2 sont les proportions des livres imprimes. Leur absence obligeait
  // a annoncer l'A4 en 3:4, d'ou 6 % d'ecart, et le Digest a 16 %.
  assert.ok(RATIOS_IMAGE.includes("2:3") && RATIOS_IMAGE.includes("3:2"));
});

test("un ratio se convertit en nombre dans le bon sens", () => {
  assert.equal(valeurDuRatio("1:1"), 1);
  assert.ok(Math.abs(valeurDuRatio("2:3") - 0.6667) < 0.001);
  assert.ok(Math.abs(valeurDuRatio("16:9") - 1.7778) < 0.001);
});

// ---------------------------------------------------------------------------
// Le coeur du correctif
// ---------------------------------------------------------------------------

test("en pleine page, dix formats ne donnent plus quatre images mais six", () => {
  const distincts = new Set(BOOK_FORMATS.map((f) => ratioPourCadrage(f, "pleine-page")));
  assert.ok(
    distincts.size >= 6,
    `dix formats devraient donner au moins six proportions, ils en donnent ${distincts.size}`
  );
});

test("le Digest, qui etait le pire ecart, tombe sous les 5 %", () => {
  // Il reste sur la meme proportion que l'A4, et c'est correct : 2:3 est ce que
  // les deux pages ont de plus proche. Ce qui a change n'est pas qu'ils se
  // separent, c'est que la proportion choisie ne soit plus fausse pour les deux.
  // Avant : 3:4 impose au Digest, 16 % d'ecart. Apres : moins de 5 %.
  const digest = formatParId("digest_p");
  assert.ok(
    ecartDeCadrage(digest, "pleine-page") < 5,
    `le Digest est encore a ${ecartDeCadrage(digest, "pleine-page").toFixed(1)} % de sa page`
  );
  // La preuve que l'ancien choix etait le mauvais : 3:4 ferait bien pire.
  const ancien = Math.abs(0.75 - ratioDeLaPage(digest)) / ratioDeLaPage(digest) * 100;
  assert.ok(ancien > 15, "l'ancien 3:4 mettait bien le Digest a plus de 15 % de sa page");
});

test("aucun format n'est plus a plus de 9 % de sa propre page", () => {
  for (const f of BOOK_FORMATS) {
    const ecart = ecartDeCadrage(f, "pleine-page");
    assert.ok(ecart < 9, `${f.id} est a ${ecart.toFixed(1)} % de sa page`);
  }
});

test("un format et sa version italienne choisissent des proportions retournees", () => {
  // C'est le test qui impose la distance logarithmique. Avec une soustraction
  // simple, l'A4 portrait tombait sur 2:3 et l'A4 paysage sur 4:3, alors que
  // c'est deux fois la meme page.
  const paires = [["a4_p", "a4_l"], ["moyen_p", "moyen_l"], ["a5_p", "a5_l"], ["digest_p", "digest_l"], ["poche_p", "poche_l"]];
  for (const [idPortrait, idPaysage] of paires) {
    const rp = valeurDuRatio(ratioPourCadrage(formatParId(idPortrait), "pleine-page"));
    const rl = valeurDuRatio(ratioPourCadrage(formatParId(idPaysage), "pleine-page"));
    assert.ok(
      Math.abs(rp * rl - 1) < 1e-9,
      `${idPortrait} et ${idPaysage} devraient donner des proportions inverses, ils donnent ${rp} et ${rl}`
    );
  }
});

test("le format Moyen tombe exactement sur sa proportion, sans recadrage", () => {
  assert.equal(ratioPourCadrage(formatParId("moyen_p"), "pleine-page"), "2:3");
  assert.ok(ecartDeCadrage(formatParId("moyen_p"), "pleine-page") < 0.001);
});

test("un cadrage impose ne depend pas du format, c'est ce qu'on lui demande", () => {
  for (const f of BOOK_FORMATS) {
    assert.equal(ratioPourCadrage(f, "portrait"), "2:3");
    assert.equal(ratioPourCadrage(f, "carre"), "1:1");
    assert.equal(ratioPourCadrage(f, "paysage"), "3:2");
  }
});

test("le choix est stable : deux appels sur le meme format donnent la meme chose", () => {
  for (const f of BOOK_FORMATS) {
    assert.equal(
      ratioPourCadrage(f, "pleine-page"),
      ratioPourCadrage(f, "pleine-page"),
      `${f.id} doit choisir la meme proportion a chaque appel`
    );
  }
});

test("la proportion de la page se calcule, elle n'est plus saisie", () => {
  assert.ok(Math.abs(ratioDeLaPage(formatParId("a4_p")) - 210 / 297) < 1e-12);
  assert.ok(Math.abs(ratioDeLaPage(formatParId("a4_l")) - 297 / 210) < 1e-12);
});

test("le libelle complet garde le nom et les dimensions", () => {
  assert.equal(libelleFormat(formatParId("a4_p")), "A4 (21 x 29,7 cm)");
});
