import React, { useCallback, useState } from 'react';
import { Scene, BookFormat, Cadrage } from '../types';
import { detailImage } from '../services/dataService';
import { notifier, notifierErreur } from '../services/notifications';
import {
  FORMAT_LISEUR,
  estFormatDuLiseur,
  libelleFormat,
  ratioPourCadrage,
  remplissageDuLiseur,
} from '../services/formats';
import Liseur from './Liseur';

interface BookViewerProps {
  scenes: Scene[];
  titre: string;
  onTitreChange: (titre: string) => void;
  format: BookFormat;
  /**
   * Le cadrage sert ici a une seule chose : dire la verite sur ce que le liseur
   * va montrer. Sans lui, l'avertissement de format ne pourrait qu'affirmer
   * qu'il y aura des marges, sans savoir combien.
   */
  cadrage: Cadrage;
  onRestart: () => void;
}

/** Dimensions réelles d'une image encodée, nécessaires pour la placer sans la déformer. */
const mesurerImage = (url: string): Promise<{ largeur: number; hauteur: number }> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ largeur: img.naturalWidth, hauteur: img.naturalHeight });
    img.onerror = () => resolve({ largeur: 1024, hauteur: 768 });
    img.src = url;
  });

/**
 * Correspondance entre l'extension réelle d'une image et le nom que jsPDF attend.
 * Tout ce qui n'est pas listé retombe sur PNG.
 */
const FORMATS_JSPDF: Record<string, string> = {
  jpg: 'JPEG',
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WEBP',
};

const BookViewer: React.FC<BookViewerProps> = ({ scenes, titre, onTitreChange, format, cadrage, onRestart }) => {
  const completedScenes = scenes.filter(s => s.status === 'completed' && s.imageUrl);

  /*
    Mise en page alternée et stable : elle ne doit pas changer entre deux rendus.
    Seules les inversions demandées à la main sont mémorisées ; l'alternance de
    départ se déduit du rang de la planche. L'ancienne version figeait la liste
    au montage : une scène illustrée après coup n'y figurait pas et repassait
    toutes les suivantes de l'autre côté.

    Dans le liseur, « en premier » veut dire à gauche de la double page. À
    l'impression, faute de page voisine, cela veut dire en haut.
  */
  const [inversions, setInversions] = useState<Record<string, boolean>>({});

  const imageEnPremier = useCallback(
    (sceneId: string, index: number): boolean => {
      const parDefaut = index % 2 === 0;
      return inversions[sceneId] ? !parDefaut : parDefaut;
    },
    [inversions]
  );

  const inverser = useCallback((sceneId: string) => {
    setInversions(prev => ({ ...prev, [sceneId]: !prev[sceneId] }));
  }, []);

  const [exportEnCours, setExportEnCours] = useState(false);
  const [progression, setProgression] = useState(0);
  const [editionTitre, setEditionTitre] = useState(false);
  const [autresSorties, setAutresSorties] = useState(false);

  const titreAffiche = titre.trim() || "Sans titre";

  const handlePrint = () => window.print();

  /**
   * Fabrique le PDF directement, page par page, au format de livre choisi.
   * L'ancienne version appelait une bibliothèque jamais chargée : le bouton
   * affichait donc éternellement « librairie en cours de chargement ».
   */
  const handleDownloadPDF = async () => {
    if (completedScenes.length === 0) return;

    setExportEnCours(true);
    setProgression(0);

    try {
      // Chargé seulement au moment de l'export : cette bibliothèque pèse lourd
      // et n'a aucune raison de ralentir le premier affichage de la page.
      const { jsPDF } = await import('jspdf');

      const largeur = format.largeurMm;
      const hauteur = format.hauteurMm;
      const marge = Math.round(Math.min(largeur, hauteur) * 0.08);

      const pdf = new jsPDF({
        orientation: largeur > hauteur ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [largeur, hauteur],
        compress: true,
      });

      // --- Couverture ---
      pdf.setFillColor(252, 251, 249);
      pdf.rect(0, 0, largeur, hauteur, 'F');

      pdf.setDrawColor(24, 24, 27);
      pdf.setLineWidth(1.2);
      pdf.rect(marge * 0.6, marge * 0.6, largeur - marge * 1.2, hauteur - marge * 1.2);

      pdf.setFont('times', 'bold');
      pdf.setTextColor(24, 24, 27);
      const tailleTitre = Math.min(42, Math.max(20, largeur / 6));
      pdf.setFontSize(tailleTitre);

      const lignesTitre = pdf.splitTextToSize(titreAffiche.toUpperCase(), largeur - marge * 3);
      const hauteurTitre = lignesTitre.length * tailleTitre * 0.4;
      pdf.text(lignesTitre, largeur / 2, hauteur * 0.38 - hauteurTitre / 2, { align: 'center' });

      pdf.setFillColor(178, 34, 34);
      pdf.rect(largeur / 2 - 15, hauteur * 0.38 + hauteurTitre / 2 + 6, 30, 1.5, 'F');

      pdf.setFont('times', 'italic');
      pdf.setFontSize(11);
      pdf.setTextColor(90, 90, 95);
      pdf.text("Une création graphique assistée par IA", largeur / 2, hauteur * 0.86, { align: 'center' });

      // --- Planches ---
      for (let i = 0; i < completedScenes.length; i++) {
        const scene = completedScenes[i];
        setProgression(Math.round(((i + 1) / (completedScenes.length + 1)) * 100));

        pdf.addPage([largeur, hauteur], largeur > hauteur ? 'landscape' : 'portrait');
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, largeur, hauteur, 'F');

        // L'image occupe les deux tiers hauts, sans déformation.
        const zoneImageHauteur = hauteur * 0.62 - marge;
        const zoneImageLargeur = largeur - marge * 2;

        if (scene.imageUrl) {
          const { largeur: lNat, hauteur: hNat } = await mesurerImage(scene.imageUrl);
          const echelle = Math.min(zoneImageLargeur / lNat, zoneImageHauteur / hNat);
          const lFinale = lNat * echelle;
          const hFinale = hNat * echelle;

          // Le format annoncé doit correspondre au contenu réel, sinon
          // l'insertion échoue ou produit une image illisible. Google renvoie
          // parfois du WebP, qui était jusqu'ici déclaré en PNG.
          // Autre point : la variable s'appelait `format`, comme le format de
          // livre reçu en propriété. Deux choses différentes sous un même nom
          // dans la même fonction, c'était une confusion en attente.
          const formatImage = FORMATS_JSPDF[detailImage(scene.imageUrl).extension] || 'PNG';

          pdf.addImage(
            scene.imageUrl,
            formatImage,
            (largeur - lFinale) / 2,
            marge + (zoneImageHauteur - hFinale) / 2,
            lFinale,
            hFinale,
            undefined,
            'MEDIUM'
          );
        }

        // Lieu, en petites capitales
        let curseurY = hauteur * 0.62 + marge * 0.5;
        if (scene.location) {
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(7);
          pdf.setTextColor(120, 120, 125);
          pdf.text(scene.location.toUpperCase(), largeur / 2, curseurY, { align: 'center' });
          curseurY += 6;
        }

        // Titre de la planche
        pdf.setFont('times', 'bold');
        pdf.setFontSize(Math.min(20, largeur / 12));
        pdf.setTextColor(24, 24, 27);
        const lignesTitrePlanche = pdf.splitTextToSize(scene.title, largeur - marge * 2);
        pdf.text(lignesTitrePlanche.slice(0, 2), largeur / 2, curseurY, { align: 'center' });
        curseurY += lignesTitrePlanche.slice(0, 2).length * 7 + 4;

        // Texte original du passage
        const texte = scene.originalTextExcerpt?.trim() || scene.description || '';
        if (texte) {
          pdf.setFont('times', 'normal');
          pdf.setFontSize(9.5);
          pdf.setTextColor(45, 45, 50);

          const lignes = pdf.splitTextToSize(texte, largeur - marge * 2.4);
          const lignesDisponibles = Math.max(0, Math.floor((hauteur - marge - curseurY) / 4.6));
          const aAfficher = lignes.slice(0, lignesDisponibles);
          if (lignes.length > lignesDisponibles && aAfficher.length > 0) {
            aAfficher[aAfficher.length - 1] = aAfficher[aAfficher.length - 1] + ' [...]';
          }
          pdf.text(aAfficher, largeur / 2, curseurY, { align: 'center', lineHeightFactor: 1.45 });
        }

        // Numéro de planche
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(150, 150, 155);
        pdf.text(String(i + 1), largeur / 2, hauteur - marge * 0.35, { align: 'center' });
      }

      const nomFichier = `${titreAffiche.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'Livre'}_${format.id}.pdf`;
      pdf.save(nomFichier);
      setProgression(100);
      notifier(`PDF créé au format ${libelleFormat(format)}.`);
    } catch (e) {
      notifierErreur("Création du PDF impossible.", e);
    } finally {
      setExportEnCours(false);
      setProgression(0);
    }
  };

  /**
   * Exporte le livre en HTML dans une archive ZIP : images à part, page légère.
   * En un seul fichier, les images encodées produisaient plusieurs dizaines de mégaoctets.
   */
  const handleDownloadHTML = async () => {
    try {
      // Chargées seulement au moment de l'export. Importées en haut du fichier,
      // ces deux bibliothèques partaient dans le paquet principal et ralentissaient
      // le premier affichage, alors qu'elles ne servent qu'au bouton Ebook.
      const [{ default: JSZip }, { default: saveAs }] = await Promise.all([
        import('jszip'),
        import('file-saver'),
      ]);

      const zip = new JSZip();
      const dossierImages = zip.folder('images');

      const planches = completedScenes.map((scene, index) => {
        const img = detailImage(scene.imageUrl);
        const nomImage = `planche_${String(index + 1).padStart(2, '0')}.${img.extension}`;
        if (scene.imageUrl) dossierImages?.file(nomImage, img.donnees, { base64: true });

        const echapper = (t: string) => (t || '').replace(/[&<>"]/g, (c) =>
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));

        return `
    <section class="planche">
      <figure><img src="images/${nomImage}" alt="${echapper(scene.title)}" loading="lazy"></figure>
      <div class="texte">
        ${scene.location ? `<p class="lieu">${echapper(scene.location)}</p>` : ''}
        <h2>${echapper(scene.title)}</h2>
        <p class="recit">${echapper(scene.originalTextExcerpt || scene.description)}</p>
      </div>
    </section>`;
      }).join('\n');

      // Les styles sont écrits dans le fichier : il reste lisible sans connexion.
      const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${titreAffiche}</title>
<style>
  :root { --papier: #fcfbf9; --encre: #1a1a1d; --discret: #6b6b70; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #1c1917; font-family: Georgia, "Times New Roman", serif; color: var(--encre); }
  .livre { max-width: 900px; margin: 0 auto; background: var(--papier); }
  .couverture { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;
                text-align: center; padding: 3rem 2rem; border-bottom: 1px solid #e5e3df; }
  .couverture h1 { font-size: clamp(2.5rem, 8vw, 5rem); margin: 0 0 1.5rem; letter-spacing: -0.02em; line-height: 1.05; }
  .filet { width: 120px; height: 4px; background: #b22222; margin: 0 auto 2rem; }
  .couverture p { font-style: italic; color: var(--discret); font-size: 1.1rem; }
  .planche { min-height: 100vh; display: flex; flex-direction: column; justify-content: center;
             padding: 2rem; border-bottom: 6px solid #f0eeea; page-break-after: always; }
  figure { margin: 0 0 2rem; }
  img { max-width: 100%; height: auto; display: block; margin: 0 auto; box-shadow: 0 10px 40px rgba(0,0,0,.18); }
  .texte { max-width: 62ch; margin: 0 auto; text-align: center; }
  .lieu { font-family: system-ui, sans-serif; font-size: .7rem; letter-spacing: .2em; text-transform: uppercase;
          color: var(--discret); margin: 0 0 .75rem; }
  h2 { font-size: clamp(1.5rem, 4vw, 2.5rem); margin: 0 0 1.5rem; line-height: 1.15; }
  .recit { font-size: 1.05rem; line-height: 1.9; text-align: left; white-space: pre-wrap; }
  @media print { body { background: #fff; } .planche { min-height: auto; } }
</style>
</head>
<body>
  <div class="livre">
    <header class="couverture">
      <h1>${titreAffiche}</h1>
      <div class="filet"></div>
      <p>Une création graphique assistée par IA</p>
    </header>
${planches}
  </div>
</body>
</html>`;

      zip.file('livre.html', html);
      const contenu = await zip.generateAsync({ type: 'blob' });
      saveAs(contenu, `${titreAffiche.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'Livre'}_HTML.zip`);
      notifier("Archive HTML téléchargée. Ouvrez livre.html dans le dossier.");
    } catch (e) {
      notifierErreur("Export HTML impossible.", e);
    }
  };

  if (completedScenes.length === 0) {
    return (
      <div className="text-center text-slate-300 mt-20">
        <i className="fas fa-book-open text-4xl mb-4 opacity-30" aria-hidden="true"></i>
        <p className="text-lg">Le livre est vide.</p>
        <p className="text-sm text-slate-400 mt-2">Générez d'abord le storyboard pour voir les planches ici.</p>
      </div>
    );
  }

  const auFormatDuLiseur = estFormatDuLiseur(format);
  const remplissage = remplissageDuLiseur(format, cadrage);
  const ratioDemande = ratioPourCadrage(format, cadrage);

  return (
    <div className="w-full animate-fade-in pb-16">

      {/* --- En-tête ---------------------------------------------------- */}

      <div className="flex flex-col lg:flex-row justify-between lg:items-end gap-5 mb-6 print:hidden max-w-5xl mx-auto px-4">
        <div className="min-w-0">
          {editionTitre ? (
            <input
              autoFocus
              value={titre}
              onChange={(e) => onTitreChange(e.target.value)}
              onBlur={() => setEditionTitre(false)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditionTitre(false); }}
              placeholder="Titre du livre"
              aria-label="Titre du livre"
              className="text-2xl font-heading font-bold bg-dark/50 border border-primary/50 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:ring-2 focus:ring-primary w-full max-w-md"
            />
          ) : (
            <button
              onClick={() => setEditionTitre(true)}
              className="group text-left"
              title="Modifier le titre du livre"
            >
              <h2 className="text-2xl font-heading font-bold text-white flex items-center gap-2">
                <span className="truncate">{titreAffiche}</span>
                <i className="fas fa-pen text-xs text-slate-400 group-hover:text-primary transition" aria-hidden="true"></i>
              </h2>
            </button>
          )}
          <p className="text-slate-400 text-sm mt-1">
            {completedScenes.length} planche{completedScenes.length > 1 ? 's' : ''} · liseur au format{' '}
            {libelleFormat(FORMAT_LISEUR)} · PDF au format {libelleFormat(format)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={onRestart} className="px-4 py-2.5 min-h-[44px] bg-transparent border border-white/10 hover:bg-white/5 text-slate-300 rounded-lg text-sm font-medium transition">
            Nouveau projet
          </button>

          <button
            onClick={handleDownloadPDF}
            disabled={exportEnCours}
            className="px-5 py-2.5 min-h-[44px] bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-bold shadow-lg shadow-primary/20 flex items-center gap-2 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {exportEnCours
              ? <><i className="fas fa-circle-notch fa-spin" aria-hidden="true"></i> {progression}%</>
              : <><i className="fas fa-file-pdf" aria-hidden="true"></i> Télécharger en PDF</>}
          </button>

          <div className="relative">
            <button
              onClick={() => setAutresSorties(o => !o)}
              aria-expanded={autresSorties}
              className="w-11 h-11 flex items-center justify-center bg-transparent border border-white/10 hover:bg-white/5 text-slate-300 rounded-lg transition"
              aria-label="Autres façons de sortir le livre"
            >
              <i className="fas fa-ellipsis" aria-hidden="true"></i>
            </button>

            {autresSorties && (
              <div className="absolute right-0 top-full mt-2 z-40 w-64 bg-surface border border-white/10 rounded-xl shadow-2xl p-1.5 animate-fade-in">
                <button
                  onClick={() => { setAutresSorties(false); handleDownloadHTML(); }}
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white/5 transition flex items-start gap-3"
                >
                  <i className="fas fa-file-code text-slate-400 mt-1 w-4 text-center" aria-hidden="true"></i>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-white">Ebook HTML</span>
                    <span className="block text-[11px] text-slate-400 leading-snug">Archive ZIP, images à part, lisible hors connexion.</span>
                  </span>
                </button>
                <button
                  onClick={() => { setAutresSorties(false); handlePrint(); }}
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white/5 transition flex items-start gap-3"
                >
                  <i className="fas fa-print text-slate-400 mt-1 w-4 text-center" aria-hidden="true"></i>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-white">Imprimer</span>
                    <span className="block text-[11px] text-slate-400 leading-snug">Une planche par page, via le navigateur.</span>
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* --- Avertissement de format ------------------------------------ */}

      {!auFormatDuLiseur && (
        <div
          role="status"
          className="max-w-5xl mx-auto px-4 mb-6 print:hidden"
        >
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3">
            <i className="fas fa-triangle-exclamation text-amber-300 mt-0.5" aria-hidden="true"></i>
            <div className="text-sm text-amber-100/90 leading-relaxed">
              <p className="font-semibold text-amber-200">
                Ce projet est réglé sur {libelleFormat(format)}, le liseur feuillette en {libelleFormat(FORMAT_LISEUR)}.
              </p>
              <p className="mt-1">
                {remplissage > 0.995 ? (
                  <>
                    Vos illustrations, demandées en {ratioDemande}, remplissent quand même la page du liseur :
                    rien ne se perd à l'écran. Seul le PDF sortira au format {format.nom}.
                  </>
                ) : (
                  <>
                    Vos illustrations, demandées en {ratioDemande}, occuperont{' '}
                    <span className="font-mono">{Math.round(remplissage * 100)}&nbsp;%</span> de la page du liseur,
                    le reste restera blanc. Le liseur montre l'image entière plutôt que de la rogner sans le dire.
                    Le PDF, lui, sort toujours au format {format.nom}.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* --- Le liseur --------------------------------------------------- */}

      <Liseur
        scenes={completedScenes}
        titre={titreAffiche}
        imageEnPremier={imageEnPremier}
        onInverser={inverser}
      />

      {/* --- Version imprimable ------------------------------------------
          Le liseur est un objet d'écran : il n'a pas de sens sur du papier,
          où l'on ne tourne pas les pages avec un bouton. L'impression garde
          donc la forme linéaire, une planche par page, dans l'ordre et avec
          l'alternance choisis dans le liseur. */}

      <div id="book-content" className="hidden print:block bg-white text-slate-900">
        <div className="print-couverture text-center py-24 px-12 break-after-page">
          <h1 className="text-6xl font-serif font-black mb-8 leading-none">{titreAffiche}</h1>
          <div className="w-28 h-1.5 bg-red-700 mx-auto mb-8"></div>
          <p className="font-serif italic text-xl text-slate-500">Une création graphique assistée par IA</p>
        </div>

        {completedScenes.map((scene, index) => {
          const hautDeLaPage = imageEnPremier(scene.id, index);

          const illustration = (
            <div key="img" className="w-full flex items-center justify-center py-4">
              <img src={scene.imageUrl} alt={scene.title} className="max-w-full max-h-[58vh] object-contain" />
            </div>
          );

          const texte = (
            <div key="txt" className="w-full max-w-3xl mx-auto text-center py-4">
              {scene.location && (
                <p className="text-[10px] font-sans font-bold tracking-[0.25em] uppercase text-slate-500 mb-3">
                  {scene.location}
                </p>
              )}
              <h2 className="text-3xl font-serif font-black mb-5 leading-tight">{scene.title}</h2>
              <p className="font-serif text-base leading-loose text-left whitespace-pre-wrap text-slate-800">
                {scene.originalTextExcerpt || scene.description}
              </p>
              <p className="mt-6 text-[10px] font-sans tracking-[0.2em] uppercase text-slate-400">
                Planche {index + 1}
              </p>
            </div>
          );

          return (
            <div key={scene.id} className="px-10 py-8 break-after-page flex flex-col justify-center">
              {hautDeLaPage ? [illustration, texte] : [texte, illustration]}
            </div>
          );
        })}

        <div className="text-center py-24 px-12">
          <p className="font-serif italic text-2xl mb-10">{titreAffiche}</p>
          <p className="text-xs font-sans tracking-[0.3em] uppercase text-slate-500">CharacGen Studio</p>
          <p className="mt-3 text-[10px] font-mono text-slate-400">
            Édition générée le {new Date().toLocaleDateString('fr-FR')}
          </p>
        </div>
      </div>

      <style>{`
        @media print {
            @page { margin: 0; size: auto; }

            /* Le fond de l'application est presque noir. Sans ces deux lignes,
               l'apercu avant impression montrait des titres noirs sur fond
               noir : la page papier reste blanche parce que les navigateurs
               n'impriment pas les fonds par defaut, mais l'apercu, lui, donnait
               un livre illisible, et le reglage « imprimer les couleurs
               d'arriere-plan » suffisait a le rendre vrai sur le papier. */
            html, body { background: #ffffff !important; }

            body * { visibility: hidden; }
            .print\\:hidden { display: none !important; }

            /* #book-content descend de body : la regle ci-dessus le masquait
               lui aussi, donc son propre fond blanc ne se peignait pas, seuls
               ses enfants reapparaissaient. */
            #book-content,
            #book-content * { visibility: visible; }

            #book-content {
                width: 100% !important;
                margin: 0 !important;
                box-shadow: none !important;
                background: #ffffff !important;
                position: absolute;
                left: 0;
                top: 0;
            }

            #book-content img { page-break-inside: avoid; }
            #book-content .text-slate-800,
            #book-content h1,
            #book-content h2 { color: #000000 !important; }
        }
      `}</style>
    </div>
  );
};

export default BookViewer;
