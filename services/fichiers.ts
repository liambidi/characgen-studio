/**
 * Gardes communes a tout fichier choisi par l'utilisateur.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * Trois endroits acceptaient un fichier sans rien verifier : l'import du recit,
 * l'image jointe a l'assistant, et l'image de reference de la retouche. Trois
 * consequences concretes :
 *
 *   - un PDF de 300 Mo etait charge entier en memoire, l'onglet se figeait sans
 *     un mot d'explication ;
 *   - un fichier depose par glisser-deposer echappait au filtre `accept` du
 *     champ : un .docx etait lu comme du texte et partait chez Google en
 *     caracteres illisibles, factures au passage ;
 *   - une image de 30 Mo etait refusee par le serveur apres l'envoi, donc apres
 *     une longue attente, avec un message technique.
 *
 * Les plafonds sont volontairement en dessous de ceux du serveur : mieux vaut un
 * refus immediat et lisible qu'un aller-retour perdu.
 */

/** Extensions acceptees pour un recit. Le glisser-deposer ignore l'attribut `accept`. */
export const EXTENSIONS_RECIT = [".pdf", ".txt", ".md", ".markdown", ".text"];

/** Types MIME d'images acceptes, cote serveur comme cote navigateur. */
export const TYPES_IMAGE_ACCEPTES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * 25 Mo pour un recit. Un roman en texte brut pese quelques centaines de
 * kilooctets ; au dela, c'est un PDF lourd en images, dont on n'extraira
 * de toute facon presque pas de texte.
 */
export const TAILLE_MAX_RECIT = 25 * 1024 * 1024;

/**
 * 8 Mo pour une image. Le serveur refuse au dela de 12 millions de caracteres
 * encodes, soit environ 9 Mo de binaire : on s'arrete avant.
 */
export const TAILLE_MAX_IMAGE = 8 * 1024 * 1024;

export const formaterTaille = (octets: number): string =>
  octets < 1024 * 1024 ? `${Math.round(octets / 1024)} Ko` : `${(octets / (1024 * 1024)).toFixed(1)} Mo`;

/**
 * Verifie qu'un fichier peut servir de recit. Leve une erreur lisible sinon.
 * Le type MIME n'est pas fiable (Windows annonce souvent un .md en vide) :
 * on se fie a l'extension, et au type seulement quand il est renseigne.
 */
export const verifierFichierRecit = (file: File): void => {
  const nom = file.name.toLowerCase();
  const extensionConnue = EXTENSIONS_RECIT.some((ext) => nom.endsWith(ext));
  const typePdf = file.type === "application/pdf";
  const typeTexte = file.type.startsWith("text/");

  if (!extensionConnue && !typePdf && !typeTexte) {
    throw new Error(
      `« ${file.name} » n'est pas un format accepté. Importez un PDF, un fichier .txt ou un fichier .md.`
    );
  }

  if (file.size === 0) {
    throw new Error(`« ${file.name} » est vide.`);
  }

  if (file.size > TAILLE_MAX_RECIT) {
    throw new Error(
      `« ${file.name} » pèse ${formaterTaille(file.size)}, au-delà des ${formaterTaille(TAILLE_MAX_RECIT)} acceptés. ` +
        `Découpez le document, ou exportez-le en texte brut.`
    );
  }
};

/**
 * Lit une image choisie par l'utilisateur et la renvoie encodee.
 * Refuse d'emblee un format ou un poids que le serveur rejetterait.
 */
export const lireImageChoisie = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!TYPES_IMAGE_ACCEPTES.includes(file.type)) {
      reject(
        new Error(
          `« ${file.name} » n'est pas une image utilisable (${file.type || "type inconnu"}). ` +
            `Utilisez du PNG, du JPEG ou du WebP.`
        )
      );
      return;
    }

    if (file.size > TAILLE_MAX_IMAGE) {
      reject(
        new Error(
          `Cette image pèse ${formaterTaille(file.size)}, au-delà des ${formaterTaille(TAILLE_MAX_IMAGE)} acceptés. ` +
            `Réduisez-la avant de l'envoyer.`
        )
      );
      return;
    }

    const lecteur = new FileReader();
    lecteur.onload = () => {
      const resultat = lecteur.result;
      if (typeof resultat !== "string") {
        reject(new Error("Lecture de l'image impossible."));
        return;
      }
      resolve(resultat);
    };
    lecteur.onerror = () => reject(new Error("Lecture de l'image impossible."));
    lecteur.readAsDataURL(file);
  });

/**
 * Separe une image encodee en son type reel et ses donnees, au format attendu
 * par le SDK Google. Le type etait auparavant annonce en `image/png` quoi qu'il
 * arrive : une photo JPEG partait donc mal etiquetee dans l'historique de
 * discussion, et le modele pouvait la refuser.
 */
export const partieImage = (dataUrl: string): { data: string; mimeType: string } => {
  const correspondance = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || "");
  if (!correspondance) return { mimeType: "image/png", data: (dataUrl || "").split(",")[1] || "" };
  return { mimeType: correspondance[1], data: correspondance[2] };
};
