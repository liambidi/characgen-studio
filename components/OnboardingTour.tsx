import React, { useState, useEffect } from 'react';
import { lirePreference, ecrirePreference } from '../services/dataService';
import { AppStep } from '../types';

interface OnboardingTourProps {
  step: AppStep;
}

/**
 * Un conseil par étape du parcours.
 *
 * Ce tableau en comptait six alors que la barre de navigation en propose sept :
 * l'étape Décors n'avait aucune explication, et la numérotation affichée ne
 * correspondait donc à rien. Le conseil de la dernière étape renvoyait par
 * ailleurs vers le bouton Imprimer du navigateur, alors qu'un bouton
 * « Télécharger en PDF » fabrique le livre au format de reliure choisi.
 */
const TUTORIAL_CONTENT: Record<number, { title: string; content: string; icon: string; stepNumber: number }> = {
  [AppStep.UPLOAD]: {
    title: "Bienvenue dans le Studio",
    content: "Tout commence ici. Importez un PDF ou un fichier texte. L'IA lit votre récit en entier pour en extraire les personnages et les lieux. Comptez une à deux minutes pour un roman.",
    icon: "fa-file-import",
    stepNumber: 1
  },
  [AppStep.REVIEW_CHARS]: {
    title: "Le casting",
    content: "Voici les personnages détectés. C'est le moment le plus important : vérifiez leur description physique, car c'est elle qui sera dessinée. Choisissez aussi le style artistique du livre, en haut de l'écran.",
    icon: "fa-users",
    stepNumber: 2
  },
  [AppStep.REVIEW_ENVIRONMENTS]: {
    title: "Les décors",
    content: "Les lieux où l'action revient plusieurs fois. Ils serviront de référence de couleur et d'architecture aux illustrations de scènes. Le bouton Chercher relit votre texte si un lieu manque.",
    icon: "fa-tree",
    stepNumber: 3
  },
  [AppStep.GENERATION_HUB]: {
    title: "La galerie",
    content: "Les fiches de personnages et de décors se dessinent ici. Ces images servent de référence à toutes les scènes qui suivent. Un visage ne vous plaît pas : régénérez la fiche, ou retouchez-la à la baguette.",
    icon: "fa-images",
    stepNumber: 4
  },
  [AppStep.SCENE_REVIEW]: {
    title: "Le séquencier",
    content: "Votre récit est découpé en scènes. Vérifiez que chacune porte les bons personnages et un décor, puis choisissez le format de reliure du livre, en bas de l'écran. Vous pouvez réordonner, insérer ou retirer des scènes.",
    icon: "fa-list-ol",
    stepNumber: 5
  },
  [AppStep.SCENE_GALLERY]: {
    title: "Le storyboard",
    content: "L'IA combine les visages de l'étape 4 avec les actions du séquencier. Chaque illustration peut être téléchargée, régénérée ou retouchée. Le bouton Arrêter interrompt la série sans rien perdre.",
    icon: "fa-film",
    stepNumber: 6
  },
  [AppStep.FINAL_BOOK]: {
    title: "Votre livre",
    content: "L'assemblage final, où le texte d'origine côtoie vos illustrations. Le bouton « Télécharger en PDF » fabrique le fichier au format de reliure choisi à l'étape 5. Le bouton Ebook produit une version web dans une archive.",
    icon: "fa-book-open",
    stepNumber: 7
  }
};

const TOTAL_STEPS = 7;

const OnboardingTour: React.FC<OnboardingTourProps> = ({ step }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [currentContent, setCurrentContent] = useState<{ title: string; content: string; icon: string; stepNumber: number } | null>(null);

  useEffect(() => {
    // Vérifier si cette étape a déjà été vue. La lecture passe par un accès
    // protégé : en navigation privée, un localStorage interdit levait une
    // exception ici même, et la page entière devenait blanche.
    const hasSeenStep = lirePreference(`characgen_tuto_step_${step}`);
    
    // Si on a du contenu pour cette étape et qu'elle n'a pas été vue
    if (TUTORIAL_CONTENT[step] && !hasSeenStep) {
        setCurrentContent(TUTORIAL_CONTENT[step]);
        const timer = setTimeout(() => setIsVisible(true), 800);
        return () => clearTimeout(timer);
    } else {
        setIsVisible(false);
    }
  }, [step]);

  const handleDismiss = () => {
      setIsVisible(false);
      ecrirePreference(`characgen_tuto_step_${step}`, 'true');
  };

  if (!isVisible || !currentContent) return null;

  return (
    <div className="fixed bottom-8 right-8 z-[100] max-w-sm animate-blob-bounce">
        <div className="bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden group hover:border-primary/50 transition-colors">
            
            {/* Header / Progress */}
            <div className="h-1 w-full bg-slate-800">
                <div 
                    className="h-full bg-gradient-to-r from-primary to-secondary transition-all duration-1000"
                    style={{ width: `${(currentContent.stepNumber / TOTAL_STEPS) * 100}%` }}
                ></div>
            </div>

            <div className="p-5 relative">
                <button 
                    onClick={handleDismiss}
                    aria-label="Fermer ce conseil"
                    className="absolute top-2 right-2 text-slate-400 hover:text-white transition w-11 h-11 flex items-center justify-center rounded-full hover:bg-white/10"
                >
                    <i className="fas fa-times" aria-hidden="true"></i>
                </button>

                <div className="flex gap-4">
                    <div className="shrink-0 mt-1">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-primary/30 animate-pulse-slow">
                            <i className={`fas ${currentContent.icon}`} aria-hidden="true"></i>
                        </div>
                    </div>
                    
                    <div className="flex-1 pr-4">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Étape {currentContent.stepNumber}/{TOTAL_STEPS}
                            </span>
                        </div>
                        <h3 className="font-heading font-bold text-white text-lg mb-2 leading-tight">
                            {currentContent.title}
                        </h3>
                        <p className="text-sm text-slate-300 leading-relaxed font-light">
                            {currentContent.content}
                        </p>
                    </div>
                </div>

                <div className="mt-4 pt-4 border-t border-white/5 flex justify-end">
                    <button 
                        onClick={handleDismiss}
                        className="text-xs font-bold text-white bg-white/10 hover:bg-white/20 px-5 py-3 min-h-[44px] rounded-full transition flex items-center gap-2"
                    >
                        Continuer <i className="fas fa-chevron-right text-[10px]" aria-hidden="true"></i>
                    </button>
                </div>
            </div>
        </div>
    </div>
  );
};

export default OnboardingTour;