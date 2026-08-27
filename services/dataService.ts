import LZString from "lz-string";
import { Character, Scene, Environment, AppStep, Cadrage, GenConfig } from "../types";

/**
 * Sauvegarde du projet.
 *
 * Les images generees sont volumineuses : une seule planche en 1K pese 1 a 2 Mo
 * une fois encodee. localStorage plafonne vers 5 Mo, la sauvegarde echouait donc
 * des la troisieme image. Tout passe maintenant par IndexedDB, qui accepte
 * plusieurs centaines de megaoctets et stocke les donnees sans les convertir en texte.
 */

const NOM_BASE = "characgen";
const NOM_MAGASIN = "projets";
const CLE_PROJET = "projet_courant";
const ANCIENNE_CLE_LOCALSTORAGE = "characgen_local_save";
const VERSION_FICHIER = "2.0";

export interface ProjetEnregistre {
  titre: string;
  characters: Character[];
  environments: Environment[];
  scenes: Scene[];
  stylePrompt: string;
  fullText: string;
  currentStep: AppStep;
  formatId?: string;
  /**
   * Cadrage et résolution, enregistrés depuis le 2026-08-26.
   *
   * Seul `formatId` était conservé, alors qu'il ne suffit plus à décrire ce
   * qu'on demande à Gemini : la proportion vient du couple format plus cadrage,
   * et la résolution est devenue réglable. Un projet rouvert repartait donc en
   * pleine page 1K sans le dire. Les deux champs restent optionnels, pour que
   * les sauvegardes faites avant cette date se rechargent sans erreur.
   */
  cadrage?: Cadrage;
  resolution?: GenConfig['resolution'];
  misAJourLe: number;
}

// ---------------------------------------------------------------------------
// Acces bas niveau a IndexedDB
// ---------------------------------------------------------------------------

let basePromesse: Promise<IDBDatabase> | null = null;

/** Ouvre la base a la version demandee et cree le magasin s'il manque. */
const ouvrirVersion = (version?: number): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const requete = version ? indexedDB.open(NOM_BASE, version) : indexedDB.open(NOM_BASE);

    requete.onupgradeneeded = () => {
      const base = requete.result;
      if (!base.objectStoreNames.contains(NOM_MAGASIN)) base.createObjectStore(NOM_MAGASIN);
    };
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error || new Error("Ouverture de la base impossible."));
    requete.onblocked = () =>
      reject(new Error("Une autre fenetre de l'application bloque la sauvegarde. Fermez les autres onglets."));
  });

const ouvrirBase = (): Promise<IDBDatabase> => {
  if (basePromesse) return basePromesse;

  basePromesse = (async () => {
    if (typeof indexedDB === "undefined") {
      throw new Error("Ce navigateur ne permet pas la sauvegarde locale.");
    }

    let base = await ouvrirVersion();

    // Une base peut exister sans son magasin : version creee par un autre outil,
    // mise a jour interrompue, nettoyage partiel. Dans ce cas on relance une
    // montee de version, seul moment ou un magasin peut etre cree.
    if (!base.objectStoreNames.contains(NOM_MAGASIN)) {
      const versionSuivante = base.version + 1;
      base.close();
      base = await ouvrirVersion(versionSuivante);
    }

    return base;
  })();

  // Une ouverture ratee ne doit pas empoisonner toutes les tentatives suivantes.
  basePromesse.catch(() => {
    basePromesse = null;
  });

  return basePromesse;
};

const ecrire = async (cle: string, valeur: unknown): Promise<void> => {
  const base = await ouvrirBase();
  return new Promise((resolve, reject) => {
    const transaction = base.transaction(NOM_MAGASIN, "readwrite");
    transaction.objectStore(NOM_MAGASIN).put(valeur, cle);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Ecriture impossible."));
    transaction.onabort = () =>
      reject(
        new Error(
          transaction.error?.name === "QuotaExceededError"
            ? "L'espace de sauvegarde du navigateur est plein. Exportez votre projet puis liberez de la place."
            : "Sauvegarde interrompue."
        )
      );
  });
};

const relire = async <T>(cle: string): Promise<T | null> => {
  const base = await ouvrirBase();
  return new Promise((resolve, reject) => {
    const transaction = base.transaction(NOM_MAGASIN, "readonly");
    const requete = transaction.objectStore(NOM_MAGASIN).get(cle);
    requete.onsuccess = () => resolve((requete.result as T) ?? null);
    requete.onerror = () => reject(requete.error || new Error("Lecture impossible."));
  });
};

const effacer = async (cle: string): Promise<void> => {
  const base = await ouvrirBase();
  return new Promise((resolve, reject) => {
    const transaction = base.transaction(NOM_MAGASIN, "readwrite");
    transaction.objectStore(NOM_MAGASIN).delete(cle);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

// ---------------------------------------------------------------------------
// Les projets
//
// L'application n'a longtemps connu qu'un seul projet, ecrit sous une clef
// fixe. Le magasin IndexedDB acceptait deja plusieurs clefs, c'est l'usage qui
// s'en tenait a une. Chaque recit a maintenant son identifiant et sa propre
// entree, plus un index qui les recense pour que la page d'accueil puisse les
// afficher sans avoir a charger les images de chacun.
// ---------------------------------------------------------------------------

const CLE_INDEX = "index_projets";
const clePourProjet = (id: string) => `projet:${id}`;

/**
 * Ce que la page d'accueil a besoin de savoir d'un projet sans l'ouvrir.
 *
 * L'index est volontairement leger : quelques compteurs et une vignette
 * reduite. Charger les huit projets pour en afficher la liste reviendrait a
 * relire des dizaines de megaoctets d'illustrations a chaque ouverture.
 */
export interface FicheProjet {
  id: string;
  titre: string;
  misAJourLe: number;
  etape: AppStep;
  nbPersonnages: number;
  nbDecors: number;
  nbScenes: number;
  /** Scenes reellement illustrees, ce qui fait le nombre de planches du livre. */
  nbPlanches: number;
  /** Vignette de 320 px de large, refabriquee seulement quand le compte change. */
  apercu?: string;
}

const nouvelId = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
};

/**
 * Reduit une planche a 320 px de large.
 *
 * Une illustration en 2K pese un a deux megaoctets. Recopiee telle quelle dans
 * l'index, elle rendrait la simple lecture de la liste aussi couteuse que
 * l'ouverture des projets eux-memes, ce que cet index existe justement pour
 * eviter. La reduction echoue silencieusement : une vignette absente est un
 * defaut d'affichage, jamais une sauvegarde perdue.
 */
const fabriquerApercu = (source?: string): Promise<string | undefined> =>
  new Promise((resolve) => {
    if (!source || typeof document === "undefined") return resolve(undefined);
    const image = new Image();
    image.onload = () => {
      try {
        const largeur = 320;
        const hauteur = Math.max(1, Math.round((image.naturalHeight / image.naturalWidth) * largeur));
        const toile = document.createElement("canvas");
        toile.width = largeur;
        toile.height = hauteur;
        const ctx = toile.getContext("2d");
        if (!ctx) return resolve(undefined);
        ctx.drawImage(image, 0, 0, largeur, hauteur);
        resolve(toile.toDataURL("image/webp", 0.72));
      } catch {
        resolve(undefined);
      }
    };
    image.onerror = () => resolve(undefined);
    image.src = source;
  });

const lireIndex = async (): Promise<FicheProjet[]> => (await relire<FicheProjet[]>(CLE_INDEX)) ?? [];
const ecrireIndex = (fiches: FicheProjet[]) => ecrire(CLE_INDEX, fiches);

/**
 * Fait passer une sauvegarde de l'ancien monde au nouveau.
 *
 * L'ordre compte : on ecrit d'abord la copie, ensuite l'index, et seulement
 * apres on efface l'ancienne clef. Interrompue au milieu, la migration laisse
 * au pire un doublon, jamais un projet perdu. La presence de l'index sert de
 * marqueur : une fois ecrit, meme vide, la migration ne se rejoue plus.
 */
const migrerSiNecessaire = async (): Promise<void> => {
  if ((await relire<FicheProjet[]>(CLE_INDEX)) !== null) return;

  const ancien = (await relire<ProjetEnregistre>(CLE_PROJET)) ?? recupererAncienneSauvegarde();
  if (!ancien) {
    await ecrireIndex([]);
    return;
  }

  const id = nouvelId();
  await ecrire(clePourProjet(id), ancien);
  await ecrireIndex([await construireFiche(id, ancien, undefined)]);

  await effacer(CLE_PROJET).catch(() => {});
  try {
    localStorage.removeItem(ANCIENNE_CLE_LOCALSTORAGE);
  } catch {
    /* rien a faire si localStorage est inaccessible */
  }
};

const construireFiche = async (
  id: string,
  projet: ProjetEnregistre,
  precedente: FicheProjet | undefined
): Promise<FicheProjet> => {
  const illustrees = projet.scenes.filter((s) => s.status === "completed");
  const nbPlanches = illustrees.length;

  // La vignette n'est refabriquee que si le nombre de planches a bouge : sans
  // cette garde, chaque enregistrement automatique redecoderait une image.
  const apercu =
    precedente && precedente.apercu && precedente.nbPlanches === nbPlanches
      ? precedente.apercu
      : await fabriquerApercu(illustrees[0]?.imageUrl ?? projet.characters.find((c) => c.imageUrl)?.imageUrl);

  return {
    id,
    titre: projet.titre || "Recit sans titre",
    misAJourLe: projet.misAJourLe,
    etape: projet.currentStep,
    nbPersonnages: projet.characters.length,
    nbDecors: projet.environments.length,
    nbScenes: projet.scenes.length,
    nbPlanches,
    apercu,
  };
};

/** La liste, du plus recemment touche au plus ancien. */
export const listerProjets = async (): Promise<FicheProjet[]> => {
  try {
    await migrerSiNecessaire();
    const fiches = await lireIndex();
    return [...fiches].sort((a, b) => b.misAJourLe - a.misAJourLe);
  } catch (e) {
    console.error("Liste des projets illisible", e);
    return [];
  }
};

export const chargerProjet = async (id: string): Promise<ProjetEnregistre | null> => {
  await migrerSiNecessaire();
  return relire<ProjetEnregistre>(clePourProjet(id));
};

export const enregistrerProjet = async (
  id: string,
  projet: Omit<ProjetEnregistre, "misAJourLe">
): Promise<void> => {
  const complet: ProjetEnregistre = { ...projet, misAJourLe: Date.now() };
  await ecrire(clePourProjet(id), complet);

  const fiches = await lireIndex();
  const fiche = await construireFiche(id, complet, fiches.find((f) => f.id === id));
  await ecrireIndex([fiche, ...fiches.filter((f) => f.id !== id)]);
};

export const supprimerProjet = async (id: string): Promise<void> => {
  await effacer(clePourProjet(id));
  await ecrireIndex((await lireIndex()).filter((f) => f.id !== id));
};

export const renommerProjet = async (id: string, titre: string): Promise<void> => {
  const projet = await relire<ProjetEnregistre>(clePourProjet(id));
  if (projet) await ecrire(clePourProjet(id), { ...projet, titre });
  await ecrireIndex((await lireIndex()).map((f) => (f.id === id ? { ...f, titre } : f)));
};

/** Un identifiant pour un recit qui n'existe pas encore. */
export const creerIdProjet = (): string => nouvelId();

/** Recupere une sauvegarde faite par l'ancienne version, dans localStorage. */
const recupererAncienneSauvegarde = (): ProjetEnregistre | null => {
  try {
    const brut = localStorage.getItem(ANCIENNE_CLE_LOCALSTORAGE);
    if (!brut) return null;

    const data = JSON.parse(brut);
    const texte = data.fullText ? LZString.decompressFromUTF16(data.fullText) || data.fullText : "";

    return {
      titre: data.titre || "",
      characters: data.characters || [],
      environments: data.environments || [],
      scenes: data.scenes || [],
      stylePrompt: data.stylePrompt || "",
      fullText: texte,
      currentStep: data.currentStep ?? AppStep.REVIEW_CHARS,
      misAJourLe: data.updatedAt || Date.now(),
    };
  } catch (e) {
    console.error("Ancienne sauvegarde illisible", e);
    return null;
  }
};

// ---------------------------------------------------------------------------
// Petites preferences d'interface
//
// localStorage n'est pas toujours disponible : navigation privee de Safari,
// cookies bloques, page ouverte dans une iframe tierce. Un simple `getItem` y
// LEVE une exception. Appelee depuis un effet React sans protection, elle faisait
// tomber toute l'application sur une page blanche, pour un simple compteur de
// tutoriel. Ces deux fonctions ne peuvent pas echouer.
// ---------------------------------------------------------------------------

export const lirePreference = (cle: string): string | null => {
  try {
    return localStorage.getItem(cle);
  } catch {
    return null;
  }
};

export const ecrirePreference = (cle: string, valeur: string): void => {
  try {
    localStorage.setItem(cle, valeur);
  } catch {
    /* Espace plein ou stockage interdit : une preference perdue n'a pas d'importance. */
  }
};

// ---------------------------------------------------------------------------
// Espace occupe
// ---------------------------------------------------------------------------

export interface EspaceDisque {
  utiliseOctets: number;
  disponibleOctets: number;
  pourcentage: number;
}

/** Renvoie l'espace occupe par l'application, pour l'afficher avant saturation. */
export const mesurerEspace = async (): Promise<EspaceDisque | null> => {
  try {
    if (!navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return {
      utiliseOctets: usage,
      disponibleOctets: quota,
      pourcentage: quota > 0 ? Math.round((usage / quota) * 100) : 0,
    };
  } catch {
    return null;
  }
};

export const formaterOctets = (octets: number): string => {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  if (octets < 1024 * 1024 * 1024) return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(octets / (1024 * 1024 * 1024)).toFixed(2)} Go`;
};

/** Poids approximatif du projet, calcule sans tout serialiser. */
export const estimerPoidsProjet = (
  characters: Character[],
  environments: Environment[],
  scenes: Scene[],
  fullText: string
): number => {
  const poidsImage = (url?: string) => (url ? Math.round(url.length * 0.75) : 0);
  return (
    fullText.length +
    characters.reduce((total, c) => total + poidsImage(c.imageUrl) + 500, 0) +
    environments.reduce((total, e) => total + poidsImage(e.imageUrl) + 500, 0) +
    scenes.reduce((total, s) => total + poidsImage(s.imageUrl) + (s.originalTextExcerpt?.length || 0) + 500, 0)
  );
};

// ---------------------------------------------------------------------------
// Export et import de fichier projet
// ---------------------------------------------------------------------------

export const exportProjectToJSON = async (projet: Omit<ProjetEnregistre, "misAJourLe">): Promise<void> => {
  const { default: saveAs } = await import("file-saver");

  const data = {
    version: VERSION_FICHIER,
    timestamp: Date.now(),
    project: {
      ...projet,
      // Le texte du recit est compresse : c'est la partie la plus repetitive du fichier.
      fullText: LZString.compressToBase64(projet.fullText || ""),
    },
  };

  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const nomFichier = `${(projet.titre || "CharacGen_Projet").replace(/[^\w\-]+/g, "_")}_${new Date()
    .toISOString()
    .slice(0, 10)}.json`;
  saveAs(blob, nomFichier);
};

export const importProjectFromJSON = (file: File): Promise<ProjetEnregistre> => {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();

    lecteur.onload = (event) => {
      try {
        const contenu = event.target?.result as string;
        if (!contenu) throw new Error("Le fichier est vide.");

        const json = JSON.parse(contenu);
        const projet = json.project;
        if (!projet) throw new Error("Ce fichier n'est pas un projet CharacGen.");

        // Le texte a ete compresse en base64 depuis la version 1.1, en UTF16 avant.
        let texte: string = projet.fullText || "";
        if (texte) {
          const essaiBase64 = LZString.decompressFromBase64(texte);
          const essaiUtf16 = essaiBase64 ? null : LZString.decompressFromUTF16(texte);
          texte = essaiBase64 || essaiUtf16 || texte;
        }

        resolve({
          titre: projet.titre || "",
          characters: projet.characters || [],
          environments: projet.environments || [],
          scenes: projet.scenes || [],
          stylePrompt: projet.stylePrompt || "",
          fullText: texte,
          currentStep: projet.currentStep ?? AppStep.REVIEW_CHARS,
          formatId: projet.formatId,
          cadrage: projet.cadrage,
          resolution: projet.resolution,
          misAJourLe: json.timestamp || Date.now(),
        });
      } catch (e: any) {
        console.error("Import impossible", e);
        reject(new Error(e?.message || "Fichier corrompu ou illisible."));
      }
    };

    lecteur.onerror = () => reject(new Error("Lecture du fichier impossible."));
    lecteur.readAsText(file);
  });
};

// ---------------------------------------------------------------------------
// Export des images
// ---------------------------------------------------------------------------

const nomDeFichierSur = (nom: string, secours: string): string => {
  const propre = (nom || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // retire les accents
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return propre || secours;
};

/**
 * Extension et donnees reelles d'une image encodee.
 * Google renvoie souvent du JPEG : nommer tous les fichiers ".png" produisait
 * des images dont l'extension mentait sur leur contenu.
 */
export const detailImage = (dataUrl?: string): { extension: string; donnees: string; type: string } => {
  const correspondance = /^data:(image\/([a-z+]+));base64,(.*)$/s.exec(dataUrl || "");
  if (!correspondance) {
    return { extension: "png", donnees: (dataUrl || "").split(",")[1] || "", type: "image/png" };
  }
  const sousType = correspondance[2];
  return {
    extension: sousType === "jpeg" ? "jpg" : sousType,
    donnees: correspondance[3],
    type: correspondance[1],
  };
};

export const exportAssetsToZip = async (
  characters: Character[],
  environments: Environment[],
  scenes: Scene[],
  titre = "CharacGen"
): Promise<void> => {
  // Chargees a la demande : ces deux bibliotheques ne servent qu'a l'export.
  const [{ default: JSZip }, { default: saveAs }] = await Promise.all([import("jszip"), import("file-saver")]);
  const zip = new JSZip();
  let compte = 0;

  const dossierPersos = zip.folder("Personnages");
  characters.forEach((char, i) => {
    if (!char.imageUrl) return;
    const img = detailImage(char.imageUrl);
    dossierPersos?.file(`${nomDeFichierSur(char.name, `personnage_${i + 1}`)}.${img.extension}`, img.donnees, {
      base64: true,
    });
    compte++;
  });

  const dossierDecors = zip.folder("Decors");
  environments.forEach((env, i) => {
    if (!env.imageUrl) return;
    const img = detailImage(env.imageUrl);
    dossierDecors?.file(`${nomDeFichierSur(env.name, `decor_${i + 1}`)}.${img.extension}`, img.donnees, {
      base64: true,
    });
    compte++;
  });

  const dossierStoryboard = zip.folder("Storyboard");
  scenes.forEach((scene, i) => {
    if (!scene.imageUrl) return;
    const img = detailImage(scene.imageUrl);
    const numero = String(i + 1).padStart(2, "0");
    dossierStoryboard?.file(
      `${numero}_${nomDeFichierSur(scene.title, "scene")}.${img.extension}`,
      img.donnees,
      { base64: true }
    );
    compte++;
  });

  if (compte === 0) throw new Error("Aucune image generee pour l'instant.");

  const contenu = await zip.generateAsync({ type: "blob" });
  saveAs(contenu, `${nomDeFichierSur(titre, "CharacGen")}_Images_${new Date().toISOString().slice(0, 10)}.zip`);
};
