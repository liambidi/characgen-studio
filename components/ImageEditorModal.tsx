import React, { useEffect, useRef, useState } from 'react';
import { editGeneratedImage } from '../services/geminiService';
import { lireImageChoisie } from '../services/fichiers';
import { notifierErreur } from '../services/notifications';

interface ImageEditorModalProps {
  imageUrl: string;
  onClose: () => void;
  onSave: (newUrl: string) => void;
}

/**
 * Retouche d'une image deja generee, par consigne ecrite.
 *
 * Cette fenetre etait la seule de l'application redigee en anglais, et son titre
 * annoncait « Gemini 2.5 » alors que le code demande des modeles Gemini 3. Elle
 * ne reagissait pas non plus a la touche Echap, ne rendait jamais le focus, et
 * ses images n'avaient pas de texte alternatif.
 */
const ImageEditorModal: React.FC<ImageEditorModalProps> = ({ imageUrl, onClose, onSave }) => {
  const [prompt, setPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentImage, setCurrentImage] = useState(imageUrl);
  const [historique, setHistorique] = useState<string[]>([imageUrl]);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);

  const fenetreRef = useRef<HTMLDivElement>(null);
  const champConsigneRef = useRef<HTMLTextAreaElement>(null);
  const focusDepart = useRef<HTMLElement | null>(null);

  // Echap ferme, le focus arrive dans le champ de consigne, et il revient a son
  // point de depart en sortant : sans cela, la navigation au clavier repartait
  // du haut de la page a chaque fermeture.
  useEffect(() => {
    focusDepart.current = document.activeElement as HTMLElement | null;
    champConsigneRef.current?.focus();

    const auClavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isProcessing) {
        onClose();
        return;
      }
      // Piege a focus : la tabulation ne doit pas sortir de la fenetre modale.
      if (e.key !== 'Tab' || !fenetreRef.current) return;

      const focusables = fenetreRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea, input, [href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;

      const premier = focusables[0];
      const dernier = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === premier) {
        e.preventDefault();
        dernier.focus();
      } else if (!e.shiftKey && document.activeElement === dernier) {
        e.preventDefault();
        premier.focus();
      }
    };

    window.addEventListener('keydown', auClavier);
    return () => {
      window.removeEventListener('keydown', auClavier);
      focusDepart.current?.focus?.();
    };
  }, [onClose, isProcessing]);

  const handleRefUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      setReferenceImage(await lireImageChoisie(file));
    } catch (erreur) {
      notifierErreur('Image de référence non utilisable.', erreur);
    }
  };

  const handleEdit = async () => {
    const consigne = prompt.trim();
    if (!consigne || isProcessing) return;

    setIsProcessing(true);
    try {
      const nouvelleUrl = await editGeneratedImage(currentImage, consigne, referenceImage || undefined);
      setCurrentImage(nouvelleUrl);
      setHistorique((prev) => [...prev, nouvelleUrl]);
      setPrompt('');
      setReferenceImage(null); // La référence ne vaut que pour la retouche demandée.
    } catch (e) {
      notifierErreur('Retouche impossible.', e);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAnnuler = () => {
    setHistorique((prev) => {
      if (prev.length <= 1) return prev;
      const reduit = prev.slice(0, -1);
      setCurrentImage(reduit[reduit.length - 1]);
      return reduit;
    });
  };

  const nbRetouches = historique.length - 1;

  return (
    <div
      className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titre-retouche"
    >
      <div
        ref={fenetreRef}
        className="bg-surface border border-white/10 rounded-xl w-full max-w-5xl h-[90vh] flex flex-col shadow-2xl overflow-hidden"
      >
        <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5 shrink-0">
          <h3 id="titre-retouche" className="text-white font-bold font-heading text-sm flex items-center gap-2">
            <i className="fas fa-wand-magic-sparkles text-amber-400" aria-hidden="true"></i>
            Retouche de l'image
          </h3>
          <button
            onClick={onClose}
            className="w-11 h-11 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
            aria-label="Fermer la retouche"
          >
            <i className="fas fa-times" aria-hidden="true"></i>
          </button>
        </div>

        {/* En colonne sur petit écran : le panneau latéral fixe rendait la
            fenêtre inutilisable sur téléphone, l'image étant réduite à rien. */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
          <div className="flex-1 bg-black flex items-center justify-center p-4 relative min-h-0">
            <img
              src={currentImage}
              className="max-w-full max-h-full object-contain"
              alt={nbRetouches > 0 ? `Image après ${nbRetouches} retouche${nbRetouches > 1 ? 's' : ''}` : "Image d'origine, avant retouche"}
            />
            {isProcessing && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center" role="status">
                <div className="text-center">
                  <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin mb-3 mx-auto" aria-hidden="true"></div>
                  <span className="text-white text-xs font-semibold">Retouche en cours...</span>
                </div>
              </div>
            )}
          </div>

          <div className="w-full md:w-80 shrink-0 bg-dark/60 border-t md:border-t-0 md:border-l border-white/10 p-4 flex flex-col gap-4 overflow-y-auto">
            <div>
              <label htmlFor="image-reference" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">
                Image de référence (facultatif)
              </label>
              <div className="border border-white/15 border-dashed rounded-lg p-4 text-center hover:bg-white/5 transition relative">
                <input
                  id="image-reference"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={handleRefUpload}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
                {referenceImage ? (
                  <img src={referenceImage} className="h-20 mx-auto object-contain" alt="Référence de style choisie" />
                ) : (
                  <div className="text-slate-400 text-xs">
                    <i className="fas fa-image text-xl mb-1 block" aria-hidden="true"></i>
                    Choisir une image de style
                  </div>
                )}
              </div>
              {referenceImage && (
                <button
                  onClick={() => setReferenceImage(null)}
                  className="mt-2 text-[11px] text-slate-400 hover:text-white underline underline-offset-2"
                >
                  Retirer la référence
                </button>
              )}
            </div>

            <div className="flex-1">
              <label htmlFor="consigne-retouche" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">
                Consigne
              </label>
              <textarea
                id="consigne-retouche"
                ref={champConsigneRef}
                className="w-full bg-dark border border-white/15 rounded-lg p-3 text-sm text-white h-32 resize-none focus:border-primary focus:outline-none"
                placeholder="Par exemple : passe l'éclairage en fin de journée, ajoute une écharpe rouge."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>

            <button
              onClick={handleEdit}
              disabled={isProcessing || !prompt.trim()}
              className="w-full py-3 min-h-[44px] bg-primary hover:bg-primary-hover text-white font-bold text-sm rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Appliquer la retouche
            </button>

            <button
              onClick={handleAnnuler}
              disabled={historique.length <= 1 || isProcessing}
              className="w-full py-2.5 min-h-[44px] border border-white/15 text-slate-300 hover:text-white hover:bg-white/5 rounded-lg text-xs font-medium transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <i className="fas fa-rotate-left mr-2" aria-hidden="true"></i>
              Annuler la dernière retouche
            </button>

            <button
              onClick={() => onSave(currentImage)}
              disabled={isProcessing}
              className="w-full py-3 min-h-[44px] bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-lg transition mt-auto disabled:opacity-50"
            >
              Enregistrer et fermer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageEditorModal;
