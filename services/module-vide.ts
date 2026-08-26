/**
 * Module vide, mis a la place de bibliotheques qui ne servent jamais.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * jsPDF sait fabriquer un PDF a partir d'une page HTML, avec sa methode `.html()`.
 * Cette methode s'appuie sur html2canvas, dompurify et canvg, que jsPDF importe
 * donc systematiquement. Le projet ne l'utilise pas : le livre est compose page
 * par page avec `addImage` et `text`, aucune capture d'ecran n'est faite.
 *
 * Ces trois bibliotheques partaient pourtant dans le paquet, soit environ 390 ko
 * telecharges au premier clic sur « Telecharger en PDF » pour du code qui ne
 * s'executerait jamais. `vite.config.ts` les fait pointer ici a la place.
 *
 * Si un jour quelqu'un appelle `pdf.html(...)`, l'appel echouera de facon
 * lisible plutot que de produire une page blanche sans explication.
 */

const refuser = () => {
  throw new Error(
    "Cette bibliotheque a ete volontairement retiree du paquet (voir services/module-vide.ts). " +
      "Le PDF du livre est compose page par page dans components/BookViewer.tsx, sans capture d'ecran. " +
      "Pour utiliser jsPDF.html(), retirez l'aiguillage correspondant dans vite.config.ts."
  );
};

export default refuser;
export const sanitize = refuser;
