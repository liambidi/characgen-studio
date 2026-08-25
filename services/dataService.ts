import LZString from "lz-string";
import { Character, Scene, Environment, AppStep } from "../types";

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
// Sauvegarde du projet
// ---------------------------------------------------------------------------

export const saveProjectLocal = async (projet: Omit<ProjetEnregistre, "misAJourLe">): Promise<void> => {
  await ecrire(CLE_PROJET, { ...projet, misAJourLe: Date.now() });
};

export const loadProjectLocal = async (): Promise<ProjetEnregistre | null> => {
  const projet = await relire<ProjetEnregistre>(CLE_PROJET);
  if (projet) return projet;
  return recupererAncienneSauvegarde();
};

export const hasLocalSave = async (): Promise<boolean> => {
  try {
    if (await relire<ProjetEnregistre>(CLE_PROJET)) return true;
    return !!localStorage.getItem(ANCIENNE_CLE_LOCALSTORAGE);
  } catch {
    return false;
  }
};

export const supprimerSauvegardeLocale = async (): Promise<void> => {
  await effacer(CLE_PROJET);
  try {
    localStorage.removeItem(ANCIENNE_CLE_LOCALSTORAGE);
  } catch {
    /* rien a faire si localStorage est inaccessible */
  }
};

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
