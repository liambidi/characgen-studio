/**
 * Lecture des fichiers importés.
 *
 * La bibliothèque PDF est chargée à la demande, au moment où l'on ouvre
 * réellement un PDF : elle pèse plusieurs centaines de kilooctets et n'a pas
 * à ralentir le premier affichage de la page.
 */

/** Nombre de pages lues au maximum, pour ne pas saturer la mémoire du navigateur. */
const PAGES_MAX = 500;

export const extractTextFromFile = async (file: File): Promise<string> => {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return extraireDepuisPdf(file);
  }
  return extraireDepuisTexte(file);
};

const extraireDepuisTexte = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onload = (event) => resolve((event.target?.result as string) || '');
    lecteur.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    lecteur.readAsText(file);
  });

const extraireDepuisPdf = async (file: File): Promise<string> => {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    // Le "worker" décode le PDF en arrière-plan, sans figer la page.
    // Vite l'intègre au projet ; il était auparavant téléchargé sur un CDN.
    const { default: urlWorker } = await import('pdfjs-dist/build/pdf.worker.min.js?url');
    pdfjsLib.GlobalWorkerOptions.workerSrc = urlWorker;

    const donnees = await file.arrayBuffer();

    const tache = pdfjsLib.getDocument({
      data: donnees,
      // Ces tables servent à décoder les polices non latines : elles évitent
      // que les accents ressortent en caractères illisibles. Elles sont copiées
      // dans les fichiers statiques du site par un greffon de vite.config.ts,
      // et servies à cette adresse en développement comme en production.
      cMapUrl: '/cmaps/',
      cMapPacked: true,
    });

    const pdf = await tache.promise;
    const pages = Math.min(pdf.numPages, PAGES_MAX);
    const morceaux: string[] = [];

    for (let i = 1; i <= pages; i++) {
      const page = await pdf.getPage(i);
      const contenu = await page.getTextContent();
      morceaux.push(contenu.items.map((item: any) => item.str ?? '').join(' '));
      page.cleanup();
    }

    if (pdf.numPages > PAGES_MAX) {
      console.warn(`PDF de ${pdf.numPages} pages : seules les ${PAGES_MAX} premières ont été lues.`);
    }

    const texte = morceaux.join('\n');

    if (texte.trim().length < 50) {
      throw new Error(
        "Ce PDF ne contient pas de texte lisible. S'il s'agit d'un document scanné, il faut d'abord le passer par un outil de reconnaissance de caractères."
      );
    }

    return texte;
  } catch (erreur: any) {
    console.error('Lecture du PDF impossible :', erreur);

    const brut = String(erreur?.message || '');
    if (/password/i.test(brut)) throw new Error('Ce PDF est protégé par un mot de passe.');
    if (/Invalid PDF|corrupt/i.test(brut)) throw new Error('Ce fichier PDF est illisible ou endommagé.');

    throw new Error(brut || 'Impossible de lire ce fichier PDF.');
  }
};
