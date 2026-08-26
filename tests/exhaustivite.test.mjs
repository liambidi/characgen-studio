/**
 * Tests de l'exhaustivite de l'analyse.
 *
 * CE QU'ILS GARDENT
 *
 * Le recit partait entier, en un seul appel, pour l'inventaire comme pour le
 * reperage des scenes. Un modele a qui on donne 300 000 caracteres d'un coup
 * rend une synthese et non un inventaire : il ecarte, et ne dit pas ce qu'il
 * ecarte. Pire pour les scenes, une scene sautee etait absorbee par la
 * precedente, sans trace nulle part.
 *
 * Ces tests font tourner le vrai code contre un modele factice, et verifient le
 * comportement plutot que le texte des prompts.
 *
 * Lancement : npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { analyserRecit, decouperEnScenes } from "../netlify/shared/analyse.ts";

const PARTAGE = readFileSync(new URL("../netlify/shared/analyse.ts", import.meta.url), "utf8");

/** Outils factices : capture ce qui part vers le modele et rejoue des reponses. */
const outilsFactices = (repondre) => {
  const requetes = [];
  return {
    requetes,
    outils: {
      Type: { OBJECT: "OBJECT", ARRAY: "ARRAY", STRING: "STRING", INTEGER: "INTEGER" },
      generer: async (role, requete) => {
        const contents = String(requete.contents);
        requetes.push({ role, contents });
        return { text: repondre(requetes.length, contents) };
      },
    },
  };
};

const estConsolidation = (contents) => contents.includes("Ne regroupe que si tu es sur");
const estReperage = (contents) => contents.includes("Tu es scenariste");
const estFiche = (contents) => contents.includes("Tu prepares l'illustration");

/** Un recit assez long pour depasser une tranche d'inventaire. */
const romanLong = "Il se passa quelque chose de notable dans la maison basse. ".repeat(1_200);

const personnage = (nom, description, importance) => ({
  name: nom,
  role: "Role",
  importance,
  shortDescription: "Une ligne",
  personality: "Discret",
  physicalDescription: description,
});

// ---------------------------------------------------------------------------
// L'inventaire par tranches
// ---------------------------------------------------------------------------

test("un recit long est inventorie en plusieurs passes, pas en une seule", async () => {
  const { requetes, outils } = outilsFactices(() =>
    JSON.stringify({ characters: [], environments: [], suggestedStyle: "test" })
  );

  await analyserRecit(outils, romanLong);

  const inventaires = requetes.filter((r) => !estConsolidation(r.contents));
  assert.ok(
    inventaires.length > 1,
    "un roman doit etre depouille par tranches, sinon le modele en ecarte sans le dire"
  );
});

test("une tranche en panne n'emporte pas tout l'inventaire", async () => {
  // C'est la difference entre perdre un vingtieme du recit et le perdre en
  // entier. La tranche perdue est journalisee, les autres arrivent quand meme.
  const { outils } = outilsFactices((n, contents) => {
    if (estConsolidation(contents)) return JSON.stringify({ personnages: [], decors: [] });
    if (n === 2) throw new Error("503 Service Unavailable");
    return JSON.stringify({
      characters: [personnage(`Temoin ${n}`, "Grand, manteau sombre", "secondaire")],
      environments: [],
      suggestedStyle: "gouache; trait souple; ocres; lumiere rasante; detail moyen",
    });
  });

  const resultat = await analyserRecit(outils, romanLong);

  assert.ok(resultat.characters.length > 0, "les tranches valides doivent survivre a une tranche en panne");
});

test("un doublon deguise est fusionne, et la fusion ne raccourcit rien", async () => {
  const courte = "Un vieil homme.";
  const longue = "Un vieil homme d'environ soixante-dix ans, chauve, barbe blanche taillee court, robe de bure grise usee aux coudes, baton de frene noueux.";

  const { outils } = outilsFactices((n, contents) => {
    if (estConsolidation(contents)) {
      return JSON.stringify({
        personnages: [{ nomRetenu: "Maitre Aldric", indices: [0, 1], importance: "principal" }],
        decors: [],
        style: "gouache; trait souple; ocres; lumiere rasante; detail moyen",
      });
    }
    return JSON.stringify({
      characters: [
        n === 1
          ? personnage("Le vieil homme", courte, "secondaire")
          : personnage("Maitre Aldric", longue, "principal"),
      ],
      environments: [],
      suggestedStyle: "gouache",
    });
  });

  const resultat = await analyserRecit(outils, romanLong);
  const aldric = resultat.characters.filter((c) => c.name === "Maitre Aldric");

  assert.equal(aldric.length, 1, "les deux appellations doivent donner une seule fiche");
  assert.equal(
    aldric[0].physicalDescription,
    longue,
    "la fusion garde le texte le plus complet, elle ne peut pas faire retrecir une description"
  );
  assert.equal(aldric[0].importance, "principal");
});

test("une fiche que le rapprochement oublie de citer est conservee quand meme", async () => {
  // Cette etape ne peut que fusionner. Si le modele oublie une entree, elle doit
  // rester dans la bible : on ne remplace pas un tri invisible par un autre.
  const { outils } = outilsFactices((n, contents) => {
    if (estConsolidation(contents)) {
      return JSON.stringify({
        personnages: [{ nomRetenu: "Premier", indices: [0] }],
        decors: [],
        style: "gouache",
      });
    }
    return JSON.stringify({
      characters: [personnage(n === 1 ? "Premier" : "Oublie", "Description", "secondaire")],
      environments: [],
      suggestedStyle: "gouache",
    });
  });

  const resultat = await analyserRecit(outils, romanLong);
  const noms = resultat.characters.map((c) => c.name);

  assert.ok(noms.includes("Premier"));
  assert.ok(noms.includes("Oublie"), "une fiche non citee par le plan de fusion ne doit pas disparaitre");
});

test("un rapprochement en panne rend les fiches telles quelles, sans perdre l'analyse", async () => {
  const { outils } = outilsFactices((n, contents) => {
    if (estConsolidation(contents)) throw new Error("503 Service Unavailable");
    return JSON.stringify({
      characters: [personnage(`Temoin ${n}`, "Description", "secondaire")],
      environments: [],
      suggestedStyle: "gouache",
    });
  });

  const resultat = await analyserRecit(outils, romanLong);
  assert.ok(resultat.characters.length > 0, "quelques doublons valent mieux qu'une analyse perdue");
});

test("un nombre precis de personnages coupe par importance, pas au hasard", async () => {
  const { outils } = outilsFactices((n, contents) => {
    if (estConsolidation(contents)) {
      return JSON.stringify({
        personnages: [
          { nomRetenu: "Figurant", indices: [0], importance: "figurant" },
          { nomRetenu: "Heroine", indices: [1], importance: "principal" },
        ],
        decors: [],
        style: "gouache",
      });
    }
    return JSON.stringify({
      characters: [
        n === 1
          ? personnage("Figurant", "Silhouette", "figurant")
          : personnage("Heroine", "Jeune femme rousse", "principal"),
      ],
      environments: [],
      suggestedStyle: "gouache",
    });
  });

  const resultat = await analyserRecit(outils, romanLong, 1);

  assert.equal(resultat.characters.length, 1);
  assert.equal(
    resultat.characters[0].name,
    "Heroine",
    "quand il faut choisir, on garde le principal et pas le premier venu"
  );
});

// ---------------------------------------------------------------------------
// Les consignes qui triaient a notre place
// ---------------------------------------------------------------------------

test("aucune consigne ne demande plus au modele d'ecarter lui-meme", () => {
  // Les commentaires sont retires avant l'examen : ils citent volontairement
  // les anciennes formulations pour expliquer ce qui a change, et un test qui
  // les compterait interdirait d'expliquer le correctif.
  const sansCommentaires = PARTAGE.split("\n")
    .filter((ligne) => !/^\s*(\/\/|\*|\/\*)/.test(ligne))
    .join("\n");

  assert.ok(
    !/personnages importants/i.test(sansCommentaires),
    "« les personnages importants » laissait le modele decider qui compte"
  );
  assert.ok(
    !/decors recurrents/i.test(sansCommentaires),
    "« les decors recurrents » ecartait tout lieu traverse une seule fois"
  );
  assert.match(PARTAGE, /Recense TOUS les personnages/);
  assert.match(PARTAGE, /importance "principal"/);
});

// ---------------------------------------------------------------------------
// Le reperage des scenes et le controle de couverture
// ---------------------------------------------------------------------------

/** Un bloc de recit reconnaissable, dont on maitrise la longueur. */
const bloc = (nom, repetitions) =>
  `${nom} commence ici, et le recit se poursuit sans interruption. ` +
  `${nom.toLowerCase()}ien `.repeat(repetitions);

const citationDe = (nom) => `${nom} commence ici, et le recit se poursuit`;

const ficheFactice = JSON.stringify({
  title: "Titre",
  location: "Lieu",
  environmentDetail: "Un decor",
  description: "Une action",
  charactersPresent: [],
});

test("un passage anormalement long est relu, et les scenes oubliees sont retrouvees", async () => {
  // Alpha, Beta et Charlie sont courts, Delta est tres long. La premiere carte
  // ne repere que les trois premiers : le passage Delta est donc avale par la
  // scene Charlie, qui devient dix fois trop longue. C'est exactement l'oubli
  // invisible que le controle de couverture doit rattraper.
  const recit = bloc("Alpha", 20) + bloc("Beta", 20) + bloc("Charlie", 20) + bloc("Delta", 500);

  let relectures = 0;
  const { outils } = outilsFactices((n, contents) => {
    if (estFiche(contents)) return ficheFactice;
    if (estReperage(contents)) {
      const cible = contents.includes("passage trop long") || contents.includes("Delta commence ici");
      // Le reperage cible ne recoit QUE le passage suspect.
      if (cible && !contents.includes(citationDe("Alpha"))) {
        relectures += 1;
        return JSON.stringify({
          scenes: [
            { title: "Charlie", debutCitation: citationDe("Charlie") },
            { title: "Delta", debutCitation: citationDe("Delta") },
          ],
        });
      }
      return JSON.stringify({
        scenes: [
          { title: "Alpha", debutCitation: citationDe("Alpha") },
          { title: "Beta", debutCitation: citationDe("Beta") },
          { title: "Charlie", debutCitation: citationDe("Charlie") },
        ],
      });
    }
    return "{}";
  });

  const resultat = await decouperEnScenes(outils, recit, []);

  assert.equal(relectures, 1, "le passage trop long doit declencher exactement une relecture");
  assert.equal(
    resultat.scenes.length,
    4,
    `la scene Delta doit reapparaitre, ${resultat.scenes.length} scenes trouvees au lieu de 4`
  );
});

test("le controle de couverture ne tourne pas quand un nombre exact de scenes est demande", async () => {
  // Ajouter des scenes reviendrait a ne pas tenir la promesse faite a
  // l'utilisateur, qui en a demande un nombre precis.
  const recit = bloc("Alpha", 20) + bloc("Beta", 20) + bloc("Charlie", 20) + bloc("Delta", 500);

  let reperages = 0;
  const { outils } = outilsFactices((n, contents) => {
    if (estFiche(contents)) return ficheFactice;
    if (estReperage(contents)) {
      reperages += 1;
      return JSON.stringify({
        scenes: [
          { title: "Alpha", debutCitation: citationDe("Alpha") },
          { title: "Beta", debutCitation: citationDe("Beta") },
          { title: "Charlie", debutCitation: citationDe("Charlie") },
        ],
      });
    }
    return "{}";
  });

  const resultat = await decouperEnScenes(outils, recit, [], [], 3);

  assert.equal(reperages, 1, "aucune relecture ne doit s'ajouter quand la quantite est imposee");
  assert.equal(resultat.scenes.length, 3, "le nombre demande doit etre tenu");
});

test("une borne estimee est signalee sur la scene, plus seulement dans les logs", async () => {
  const recit = bloc("Alpha", 20) + bloc("Beta", 20) + bloc("Charlie", 400);

  const { outils } = outilsFactices((n, contents) => {
    if (estFiche(contents)) return ficheFactice;
    if (estReperage(contents)) {
      return JSON.stringify({
        scenes: [
          { title: "Alpha", debutCitation: citationDe("Alpha") },
          // Cette citation ne figure nulle part dans le recit : sa borne sera
          // estimee, et la scene doit le dire.
          { title: "Fantome", debutCitation: "Une phrase qui n'existe pas dans ce recit du tout" },
        ],
      });
    }
    return "{}";
  });

  const resultat = await decouperEnScenes(outils, recit, [], [], 2);
  const incertaines = resultat.scenes.filter((s) => s.reperageIncertain);

  assert.ok(
    incertaines.length > 0,
    "une borne estimee doit remonter jusqu'a la scene, pour qu'on puisse la verifier"
  );
});

test("un recit long est repere par tranches, chacune recevant son passage", async () => {
  const romanTresLong = "Le vent tourna sur la lande, et personne ne bougea. ".repeat(2_000);

  const { requetes, outils } = outilsFactices((n, contents) => {
    if (estFiche(contents)) return ficheFactice;
    return JSON.stringify({ scenes: [{ title: `Scene ${n}`, debutCitation: "Le vent tourna sur la lande" }] });
  });

  await decouperEnScenes(outils, romanTresLong, [], [], 4);

  const reperages = requetes.filter((r) => estReperage(r.contents));
  assert.ok(
    reperages.length > 1,
    "un recit de 100 000 caracteres doit etre parcouru en plusieurs passes de reperage"
  );
});
