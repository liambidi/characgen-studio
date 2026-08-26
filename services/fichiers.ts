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

/** Signale en interne un fichier dont la lecture a depasse le plafond. */
class TropVolumineux extends Error {}

/**
 * Lit un fichier en s'arretant net des que le plafond est franchi.
 *
 * Le flux est consomme morceau par morceau plutot que d'un bloc : c'est ce qui
 * permet d'abandonner un fichier de 300 Mo apres 25 Mo lus, au lieu de le
 * charger entier en memoire et de figer l'onglet. C'est exactement la
 * protection que l'ancien controle sur `file.size` assurait, sauf que celui-ci
 * ne peut plus rien assurer quand la taille annoncee est fausse.
 */
const lireAuPlusPlafond = async (file: File, plafond: number): Promise<Uint8Array> => {
  // Navigateur sans `File.stream()`. Le plafond est alors verifie apres coup,
  // faute de mieux, mais ce chemin ne sert plus a aucun navigateur courant.
  if (typeof file.stream !== "function") {
    const tampon = await file.arrayBuffer();
    if (tampon.byteLength > plafond) throw new TropVolumineux();
    return new Uint8Array(tampon);
  }

  const lecteur = file.stream().getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await lecteur.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > plafond) {
      await lecteur.cancel();
      throw new TropVolumineux();
    }
    morceaux.push(value);
  }

  const assemble = new Uint8Array(total);
  let position = 0;
  for (const morceau of morceaux) {
    assemble.set(morceau, position);
    position += morceau.byteLength;
  }
  return assemble;
};

/**
 * Verifie qu'un fichier peut servir de recit, et renvoie ses octets.
 * Leve une erreur lisible sinon.
 *
 * Le type MIME n'est pas fiable (Windows annonce souvent un .md en vide) :
 * on se fie a l'extension, et au type seulement quand il est renseigne.
 *
 * POURQUOI CETTE FONCTION LIT LE FICHIER AU LIEU DE SE FIER A SA TAILLE
 *
 * Elle refusait auparavant tout fichier des que `file.size` valait zero, avec
 * le message « est vide ». Le 26 aout 2026, ce refus est tombe sur un PDF de
 * 64 621 octets parfaitement lisible, range dans un dossier OneDrive. Verifie
 * a ce moment-la sur le disque : `fsutil file queryvaliddata` renvoyait bien
 * 64 621 octets valides, et les premiers octets etaient `%PDF-1.4`. Le meme
 * import a refonctionne peu apres, sans modification du code : le defaut est
 * donc intermittent.
 *
 * `file.size` est une declaration du navigateur, pas une mesure. Elle peut
 * valoir zero pour un fichier lisible, et le message d'erreur envoyait alors
 * l'utilisateur chercher un probleme qui n'existait pas. On ne conclut donc au
 * fichier vide qu'apres avoir tente la lecture et compte les octets obtenus.
 *
 * La taille annoncee sert encore, mais seulement dans le sens ou une erreur est
 * sans consequence : si elle depasse deja le plafond, refuser tout de suite
 * evite une lecture inutile.
 */
export const verifierFichierRecit = async (file: File): Promise<Uint8Array> => {
  const nom = file.name.toLowerCase();
  const extensionConnue = EXTENSIONS_RECIT.some((ext) => nom.endsWith(ext));
  const typePdf = file.type === "application/pdf";
  const typeTexte = file.type.startsWith("text/");

  if (!extensionConnue && !typePdf && !typeTexte) {
    throw new Error(
      `« ${file.name} » n'est pas un format accepté. Importez un PDF, un fichier .txt ou un fichier .md.`
    );
  }

  if (file.size > TAILLE_MAX_RECIT) {
    throw new Error(
      `« ${file.name} » pèse ${formaterTaille(file.size)}, au-delà des ${formaterTaille(TAILLE_MAX_RECIT)} acceptés. ` +
        `Découpez le document, ou exportez-le en texte brut.`
    );
  }

  let octets: Uint8Array;
  try {
    octets = await lireAuPlusPlafond(file, TAILLE_MAX_RECIT);
  } catch (erreur) {
    if (erreur instanceof TropVolumineux) {
      throw new Error(
        `« ${file.name} » dépasse les ${formaterTaille(TAILLE_MAX_RECIT)} acceptés : la lecture a été interrompue. ` +
          `Découpez le document, ou exportez-le en texte brut.`
      );
    }
    // Ne pas conclure au fichier vide : ce qu'on sait, c'est que la lecture a
    // echoue, et le motif exact vient du navigateur.
    const motif = String((erreur as Error)?.message || erreur || "motif inconnu");
    throw new Error(
      `Le navigateur n'a pas réussi à lire « ${file.name} » (${motif}). ` +
        `Le fichier a peut-être été déplacé, renommé, ou est en cours de synchronisation. ` +
        `Rouvrez-le pour vérifier qu'il s'ouvre, puis réessayez.`
    );
  }

  if (octets.byteLength === 0) {
    throw new Error(
      `« ${file.name} » a été lu en entier et ne contient aucun octet. ` +
        `Le fichier est vide à la source : rouvrez-le pour vérifier, ou réexportez-le.`
    );
  }

  // Trace volontaire. C'est l'ecart qui provoquait le refus a tort, et il est
  // intermittent : sans cette ligne, la prochaine occurrence serait de nouveau
  // impossible a mesurer apres coup.
  if (file.size !== octets.byteLength) {
    console.warn(
      `Taille annoncée par le navigateur pour « ${file.name} » : ${file.size} octet(s). ` +
        `Octets réellement lus : ${octets.byteLength}. Le fichier est accepté sur la mesure, pas sur l'annonce.`
    );
  }

  return octets;
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
