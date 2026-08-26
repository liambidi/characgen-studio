/**
 * Lecture des fichiers importés.
 *
 * La bibliothèque PDF est chargée à la demande, au moment où l'on ouvre
 * réellement un PDF : elle pèse plusieurs centaines de kilooctets et n'a pas
 * à ralentir le premier affichage de la page.
 */

import { notifier } from './notifications';

/** Nombre de pages lues au maximum, pour ne pas saturer la mémoire du navigateur. */
const PAGES_MAX = 500;

/**
 * `octets` est le contenu deja lu par `verifierFichierRecit`. Il est transmis
 * plutot que relu : le fichier peut avoir disparu ou changer d'etat entre les
 * deux lectures, et relire un roman de 20 Mo ne sert a rien. Le parametre reste
 * facultatif pour les appels qui n'ont que le fichier sous la main.
 */
export const extractTextFromFile = async (file: File, octets?: Uint8Array): Promise<string> => {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return extraireDepuisPdf(file, octets);
  }
  return extraireDepuisTexte(file, octets);
};

const extraireDepuisTexte = (file: File, octets?: Uint8Array): Promise<string> => {
  // `readAsText` decode en UTF-8 par defaut : le TextDecoder fait donc la meme
  // chose, sans relire le fichier.
  if (octets) return Promise.resolve(new TextDecoder('utf-8').decode(octets));

  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onload = (event) => resolve((event.target?.result as string) || '');
    lecteur.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    lecteur.readAsText(file);
  });
};

const extraireDepuisPdf = async (file: File, octets?: Uint8Array): Promise<string> => {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    // Le "worker" décode le PDF en arrière-plan, sans figer la page.
    // Vite l'intègre au projet ; il était auparavant téléchargé sur un CDN.
    // Le fichier porte l'extension .mjs depuis la version 4 de pdf.js, qui est
    // passée aux modules ES : le chemin en .js ne existe plus.
    const { default: urlWorker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjsLib.GlobalWorkerOptions.workerSrc = urlWorker;

    const donnees = octets ?? new Uint8Array(await file.arrayBuffer());

    const tache = pdfjsLib.getDocument({
      data: donnees,
      // NOTE DE SÉCURITÉ, à ne pas effacer par mégarde.
      //
      // La version 3, installée ici jusqu'au 25 août 2026, était concernée par
      // CVE-2024-4367 : un PDF fabriqué exprès pouvait faire exécuter du
      // JavaScript de son choix dans la page, par le chemin de rendu des
      // polices. Or l'application consiste précisément à ouvrir un PDF fourni
      // par l'utilisateur. Le contournement était alors `isEvalSupported: false`.
      //
      // La faille est corrigée à la source depuis la version 4, et l'option a
      // disparu de l'interface en version 6 : la passer est maintenant une
      // erreur de typage. C'est donc la version installée qui protège, et rien
      // d'autre. Un test vérifie que pdfjs-dist reste au-delà de la version 4.
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
      // Dit à l'utilisateur ce qui a été laissé de côté. Ce message n'existait
      // que dans la console : un document de 800 pages était amputé de moitié
      // sans que rien ne l'indique à l'écran.
      const message =
        `Ce PDF compte ${pdf.numPages} pages : seules les ${PAGES_MAX} premières ont été lues. ` +
        `Découpez le document pour analyser la suite.`;
      console.warn(message);
      notifier(message, 'info');
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
