import React, { useState } from 'react';
import { Scene, BookFormat } from '../types';
import { detailImage } from '../services/dataService';
import { notifier, notifierErreur } from '../services/notifications';

interface BookViewerProps {
  scenes: Scene[];
  titre: string;
  onTitreChange: (titre: string) => void;
  format: BookFormat;
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

const BookViewer: React.FC<BookViewerProps> = ({ scenes, titre, onTitreChange, format, onRestart }) => {
  const completedScenes = scenes.filter(s => s.status === 'completed' && s.imageUrl);

  // Mise en page alternée et stable : elle ne doit pas changer entre deux rendus.
  // Seules les inversions demandées à la main sont mémorisées ; l'alternance de
  // départ se déduit du rang de la planche. L'ancienne version figeait la liste
  // au montage : une scène illustrée après coup n'y figurait pas et repassait
  // toutes les suivantes en « image en haut ».
  const [inversions, setInversions] = useState<Record<string, boolean>>({});

  const dispositionDe = (id: string, index: number): 'image-top' | 'text-top' => {
      const parDefaut = index % 2 === 0 ? 'image-top' : 'text-top';
      if (!inversions[id]) return parDefaut;
      return parDefaut === 'image-top' ? 'text-top' : 'image-top';
  };

  const [exportEnCours, setExportEnCours] = useState(false);
  const [progression, setProgression] = useState(0);
  const [editionTitre, setEditionTitre] = useState(false);

  const titreAffiche = titre.trim() || "Sans titre";

  const toggleLayout = (id: string) => {
      setInversions(prev => ({ ...prev, [id]: !prev[id] }));
  };

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
      notifier(`PDF créé au format ${format.label}.`);
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

  return (
    <div className="w-full animate-fade-in pb-20">

      <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-4 mb-8 print:hidden max-w-5xl mx-auto px-4">
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
            {completedScenes.length} planches · format {format.label}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={onRestart} className="px-4 py-2.5 min-h-[44px] bg-surface border border-white/10 hover:bg-white/5 text-slate-200 rounded-lg text-sm font-medium transition">
             Nouveau projet
          </button>

          <button onClick={handleDownloadHTML} className="px-4 py-2.5 min-h-[44px] bg-surface hover:bg-white/10 border border-white/10 text-white rounded-lg text-sm font-bold shadow-lg flex items-center gap-2 transition">
            <i className="fas fa-file-code" aria-hidden="true"></i> Ebook (HTML)
          </button>

          <button
            onClick={handleDownloadPDF}
            disabled={exportEnCours}
            className="px-5 py-2.5 min-h-[44px] bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-bold shadow-lg flex items-center gap-2 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {exportEnCours
              ? <><i className="fas fa-circle-notch fa-spin" aria-hidden="true"></i> {progression}%</>
              : <><i className="fas fa-file-pdf" aria-hidden="true"></i> Télécharger en PDF</>}
          </button>

          <button onClick={handlePrint} className="w-11 h-11 flex items-center justify-center bg-white text-dark hover:bg-slate-200 rounded-lg font-bold shadow-lg transition" aria-label="Imprimer le livre">
            <i className="fas fa-print" aria-hidden="true"></i>
          </button>
        </div>
      </div>

      <div className="w-full bg-[#1c1917] p-0 md:p-8 rounded-3xl shadow-[inset_0_0_100px_rgba(0,0,0,0.8)] border border-white/5 print:p-0 print:bg-white print:border-none print:shadow-none">

          <div id="book-content" className="bg-[#fcfbf9] text-slate-900 shadow-2xl max-w-[1200px] mx-auto overflow-hidden print:shadow-none print:w-full">

            {/* Couverture */}
            <div className="min-h-screen flex flex-col items-center justify-center p-12 text-center border-b border-slate-200 relative overflow-hidden print:break-after-page">
                <div className="relative z-10 max-w-3xl w-full border-[12px] border-double border-slate-900 p-8 md:p-20 bg-white shadow-xl">
                    <span className="block text-xs font-bold tracking-[0.4em] uppercase mb-10 text-slate-400">Collection Studio</span>
                    <h1 className="text-4xl md:text-7xl font-serif font-black mb-8 text-slate-900 leading-none tracking-tight break-words">
                        {titreAffiche}
                    </h1>
                    <div className="w-32 h-2 bg-red-700 mx-auto mb-10"></div>

                    {completedScenes[0]?.imageUrl && (
                        <div className="w-full max-w-md mx-auto aspect-video mb-10 shadow-2xl overflow-hidden border-4 border-slate-900">
                            <img src={completedScenes[0].imageUrl} alt={`Illustration de couverture : ${completedScenes[0].title}`} className="w-full h-full object-cover" />
                        </div>
                    )}

                    <p className="font-serif italic text-slate-400 text-xl md:text-2xl">Une création graphique assistée par IA</p>
                </div>
            </div>

            {/* Planches */}
            <div className="flex flex-col bg-white">
                {completedScenes.map((scene, index) => {
                    const isImgTop = dispositionDe(scene.id, index) === 'image-top';

                    return (
                        <div key={scene.id} className="min-h-screen w-full flex flex-col relative group print:break-after-page border-b-8 border-slate-100">

                            <button
                                onClick={() => toggleLayout(scene.id)}
                                className="absolute top-4 right-4 z-50 px-4 py-2 min-h-[44px] bg-black/80 hover:bg-black text-white rounded-full text-xs font-bold uppercase tracking-wide opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity print:hidden shadow-lg backdrop-blur"
                            >
                                <i className="fas fa-arrows-up-down mr-2" aria-hidden="true"></i> Inverser image et texte
                            </button>

                            <div className={`w-full h-[65vh] md:h-[75vh] bg-slate-50 relative print:h-[60vh] ${isImgTop ? 'order-1' : 'order-2'}`}>
                                <div className="w-full h-full flex items-center justify-center p-4 md:p-8">
                                    <img
                                        src={scene.imageUrl}
                                        alt={scene.title}
                                        className="w-full h-full object-contain shadow-2xl print:shadow-none max-w-5xl mx-auto"
                                    />
                                    <div className="absolute bottom-4 left-4 md:left-8 text-[10px] font-sans font-bold text-slate-400 uppercase tracking-widest bg-white/90 backdrop-blur px-3 py-1.5 rounded border border-slate-200 shadow-sm">
                                        Planche {index + 1}
                                    </div>
                                </div>
                            </div>

                            <div className={`w-full min-h-[30vh] p-8 md:p-16 flex flex-col justify-center bg-white print:h-auto print:py-8 ${isImgTop ? 'order-2' : 'order-1 border-b border-slate-100'}`}>
                                <div className="max-w-3xl mx-auto w-full text-center">

                                    <div className="flex items-center justify-center gap-4 mb-6">
                                        <div className="h-[1px] w-12 bg-slate-300"></div>
                                        <div className="text-xs font-bold tracking-[0.2em] text-slate-400 uppercase">
                                            {scene.location}
                                        </div>
                                        <div className="h-[1px] w-12 bg-slate-300"></div>
                                    </div>

                                    <h2 className="text-3xl md:text-5xl font-serif font-black text-slate-900 mb-8 leading-tight">
                                        {scene.title}
                                    </h2>

                                    <div className="font-serif text-lg md:text-xl leading-loose text-slate-400">
                                        {scene.originalTextExcerpt ? (
                                            <p className="max-w-2xl mx-auto whitespace-pre-wrap text-left">{scene.originalTextExcerpt}</p>
                                        ) : (
                                            <p className="text-slate-400 italic text-base">{scene.description}</p>
                                        )}
                                    </div>

                                </div>
                            </div>

                        </div>
                    );
                })}
            </div>

            {/* Quatrième de couverture */}
            <div className="min-h-screen bg-slate-900 text-slate-300 flex flex-col items-center justify-center p-12 text-center print:break-before-page">
                <div className="w-24 h-24 border border-slate-700 flex items-center justify-center rounded-full mb-8">
                    <i className="fas fa-feather-alt text-4xl text-slate-400" aria-hidden="true"></i>
                </div>
                <p className="font-serif italic text-2xl md:text-3xl mb-16 max-w-2xl leading-relaxed text-slate-300">
                    {titreAffiche}
                </p>
                <div className="flex items-center gap-6 text-sm font-sans uppercase tracking-[0.3em] text-slate-400">
                    <div className="h-[1px] w-16 bg-slate-600"></div>
                    <span>CharacGen Studio</span>
                    <div className="h-[1px] w-16 bg-slate-600"></div>
                </div>
                <div className="mt-6 text-xs font-mono text-slate-400">
                    Édition générée le {new Date().toLocaleDateString('fr-FR')}
                </div>
            </div>

          </div>
      </div>

      <style>{`
        @media print {
            @page { margin: 0; size: auto; }
            body * { visibility: hidden; }
            .print\\:hidden { display: none !important; }

            #book-content {
                width: 100% !important;
                margin: 0 !important;
                box-shadow: none !important;
                position: absolute;
                left: 0;
                top: 0;
            }
            #book-content * { visibility: visible; }

            img { max-height: 60vh !important; page-break-inside: avoid; }
            .text-slate-900 { color: #000000 !important; }
            .text-slate-400 { color: #1a1a1a !important; }
        }
      `}</style>
    </div>
  );
};

export default BookViewer;
