import React, { useState, useEffect } from 'react';
import { lirePreference, ecrirePreference } from '../services/dataService';
import { AppStep } from '../types';

interface OnboardingTourProps {
  step: AppStep;
}

const TUTORIAL_CONTENT: Record<number, { title: string; content: string; icon: string; stepNumber: number }> = {
  [AppStep.UPLOAD]: {
    title: "Bienvenue dans le Studio",
    content: "Tout commence ici. Importez votre fichier PDF ou Texte. L'IA va analyser votre récit pour en extraire l'ADN : personnages, lieux et scènes clés.",
    icon: "fa-file-import",
    stepNumber: 1
  },
  [AppStep.REVIEW_CHARS]: {
    title: "Le Casting",
    content: "L'IA a détecté ces personnages. C'est le moment crucial : vérifiez leurs descriptions physiques. Plus c'est détaillé, plus l'image sera fidèle. Vous pouvez aussi définir le style artistique global ici.",
    icon: "fa-users",
    stepNumber: 2
  },
  [AppStep.GENERATION_HUB]: {
    title: "La Galerie de Portraits",
    content: "Voici les visages de votre histoire. Ces images serviront de RÉFÉRENCE pour toutes les scènes suivantes. Si un visage ne vous plaît pas, cliquez sur 'Régénérer' ou éditez-le avec la baguette magique.",
    icon: "fa-portrait",
    stepNumber: 3
  },
  [AppStep.SCENE_REVIEW]: {
    title: "Le Scénario Découpé",
    content: "L'histoire est maintenant découpée en plans (storyboard). Vérifiez que chaque scène contient bien les bons personnages et un décor décrit. Vous pouvez ajouter manuellement des plans de coupe.",
    icon: "fa-list-ol",
    stepNumber: 4
  },
  [AppStep.SCENE_GALLERY]: {
    title: "Le Storyboard Final",
    content: "La magie opère ! L'IA combine vos personnages (étape 2) avec les actions du scénario (étape 4). Vous pouvez télécharger les images ou les retoucher si nécessaire.",
    icon: "fa-film",
    stepNumber: 5
  },
  [AppStep.FINAL_BOOK]: {
    title: "Votre Œuvre",
    content: "L'assemblage final. Le texte original côtoie vos illustrations. Utilisez le bouton 'Imprimer' de votre navigateur pour sauvegarder le tout en PDF.",
    icon: "fa-book-open",
    stepNumber: 6
  }
};

const TOTAL_STEPS = 6;

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