/**
 * Tests des gardes posees sur un fichier choisi par l'utilisateur.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * Le 26 aout 2026, l'import refusait « situation-jeter-ses-poubelles.pdf » avec
 * le message « est vide », alors que le fichier faisait bel et bien 64 621
 * octets sur le disque, entierement presents, et commencait par %PDF-1.4.
 * Mesure faite au moment du diagnostic :
 *
 *   fsutil file queryvaliddata  -> 0xfc6d (64621)
 *   head -c 16 ... | od -c      -> % P D F - 1 . 4
 *
 * La cause etait une confiance aveugle : le code refusait des que
 * `file.size === 0`, c'est-a-dire des que le NAVIGATEUR annoncait zero. Or
 * cette taille est une declaration, pas une mesure. Les fichiers du dossier
 * OneDrive de Liam portent l'attribut ReparsePoint, et le navigateur y annonce
 * parfois zero pour un fichier parfaitement lisible.
 *
 * La regle appliquee depuis : on ne refuse un fichier pour cause de vide
 * qu'apres avoir tente la lecture et compte les octets obtenus.
 *
 * Lancement : npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { verifierFichierRecit, TAILLE_MAX_RECIT } from "../services/fichiers.ts";

/**
 * Un faux fichier qui imite l'interface `File` sur les seuls points utilises.
 * `tailleAnnoncee` est volontairement independante du contenu reel : c'est tout
 * l'objet de ces tests que de les faire diverger.
 */
const fauxFichier = ({ nom, type = "", tailleAnnoncee, contenu = new Uint8Array(0) }) => {
  let lectureDemandee = false;
  return {
    name: nom,
    type,
    size: tailleAnnoncee,
    get lectureDemandee() {
      return lectureDemandee;
    },
    stream() {
      lectureDemandee = true;
      let envoye = false;
      return new ReadableStream({
        pull(controleur) {
          if (envoye) {
            controleur.close();
            return;
          }
          envoye = true;
          if (contenu.byteLength > 0) controleur.enqueue(contenu);
          else controleur.close();
        },
      });
    },
  };
};

/** Un fichier qui debite indefiniment, pour verifier que la lecture s'arrete. */
const fichierSansFin = (nom, tailleMorceau) => {
  let morceauxProduits = 0;
  return {
    name: nom,
    type: "application/pdf",
    size: 0,
    get morceauxProduits() {
      return morceauxProduits;
    },
    stream() {
      return new ReadableStream({
        pull(controleur) {
          morceauxProduits++;
          controleur.enqueue(new Uint8Array(tailleMorceau));
        },
      });
    },
  };
};

const PDF_MINIMAL = new TextEncoder().encode("%PDF-1.4\nContenu de test.\n%%EOF\n");

test("le fichier passe quand le navigateur annonce 0 octet mais que les octets sont la", async () => {
  // Le cas exact du 26 aout 2026 : taille annoncee nulle, contenu bien present.
  const fichier = fauxFichier({
    nom: "situation-jeter-ses-poubelles.pdf",
    type: "application/pdf",
    tailleAnnoncee: 0,
    contenu: PDF_MINIMAL,
  });

  const octets = await verifierFichierRecit(fichier);

  assert.equal(octets.byteLength, PDF_MINIMAL.byteLength);
  assert.deepEqual(octets, PDF_MINIMAL);
});

test("un fichier reellement vide est refuse, en disant ce qui a ete mesure", async () => {
  const fichier = fauxFichier({
    nom: "vraiment-vide.pdf",
    type: "application/pdf",
    tailleAnnoncee: 0,
    contenu: new Uint8Array(0),
  });

  await assert.rejects(
    () => verifierFichierRecit(fichier),
    (erreur) => {
      assert.match(erreur.message, /aucun octet/);
      assert.match(erreur.message, /vraiment-vide\.pdf/);
      return true;
    }
  );
});

test("une extension refusee ne declenche aucune lecture", async () => {
  const fichier = fauxFichier({
    nom: "tableur.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    tailleAnnoncee: 4096,
    contenu: PDF_MINIMAL,
  });

  await assert.rejects(() => verifierFichierRecit(fichier), /n'est pas un format accepté/);
  assert.equal(fichier.lectureDemandee, false, "le fichier ne devait pas etre lu du tout");
});

test("une taille annoncee au-dela du plafond refuse sans rien lire", async () => {
  const fichier = fauxFichier({
    nom: "enorme.pdf",
    type: "application/pdf",
    tailleAnnoncee: TAILLE_MAX_RECIT + 1,
    contenu: PDF_MINIMAL,
  });

  await assert.rejects(() => verifierFichierRecit(fichier), /au-delà des/);
  assert.equal(fichier.lectureDemandee, false, "le refus doit etre immediat, sans charger la memoire");
});

test("un fichier volumineux qui ment sur sa taille est arrete en cours de lecture", async () => {
  // Taille annoncee nulle : le plafond ne peut donc plus etre verifie d'avance.
  // La lecture doit s'arreter d'elle-meme, sinon un PDF de 300 Mo figerait
  // l'onglet, ce que la garde d'origine servait justement a eviter.
  const morceau = 4 * 1024 * 1024;
  const fichier = fichierSansFin("sans-fin.pdf", morceau);

  await assert.rejects(() => verifierFichierRecit(fichier), /dépasse les 25\.0 Mo/);

  const maximumAttendu = Math.ceil(TAILLE_MAX_RECIT / morceau) + 1;
  assert.ok(
    fichier.morceauxProduits <= maximumAttendu,
    `lecture non bornee : ${fichier.morceauxProduits} morceaux lus, ${maximumAttendu} au plus attendus`
  );
});

test("une lecture impossible ne se fait pas passer pour un fichier vide", async () => {
  const fichier = {
    name: "deplace-entre-temps.pdf",
    type: "application/pdf",
    size: 0,
    stream() {
      throw new DOMException("The requested file could not be read", "NotReadableError");
    },
  };

  await assert.rejects(
    () => verifierFichierRecit(fichier),
    (erreur) => {
      assert.doesNotMatch(erreur.message, /aucun octet/);
      assert.match(erreur.message, /n'a pas réussi à lire/);
      return true;
    }
  );
});
