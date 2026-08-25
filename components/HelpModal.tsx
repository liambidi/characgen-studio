import React, { useState } from 'react';

interface HelpModalProps {
  onClose: () => void;
}

const HelpModal: React.FC<HelpModalProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<'tuto' | 'tips' | 'faq'>('tuto');

  const steps = [
    {
      icon: "fa-file-upload",
      title: "1. Importation",
      desc: "Chargez votre roman (PDF) ou vos notes (TXT). L'IA va lire le texte pour en extraire l'essence."
    },
    {
      icon: "fa-users",
      title: "2. Casting (Persos)",
      desc: "Révisez les fiches personnages générées. Modifiez les descriptions physiques ou ajoutez des détails manquants avant de générer les images."
    },
    {
      icon: "fa-images",
      title: "3. Galerie",
      desc: "Générez les portraits de référence. Ce sont ces visages qui seront utilisés pour assurer la cohérence dans les scènes."
    },
    {
      icon: "fa-list-ol",
      title: "4. Scénario",
      desc: "L'IA découpe l'histoire en scènes clés (Storyboard). Elle associe les personnages présents et prépare les descriptions de décors."
    },
    {
      icon: "fa-book-open",
      title: "5. Livre Final",
      desc: "Assemblez le tout dans une mise en page 'Beau Livre' avec le texte original et vos illustrations, prêt à être imprimé."
    }
  ];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-slate-600 rounded-2xl w-full max-w-4xl h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-fade-in">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-dark/50">
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                    <i className="fas fa-question text-white" aria-hidden="true"></i>
                </div>
                <h2 className="text-xl font-bold text-white">Centre d'Aide</h2>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white transition">
                <i className="fas fa-times text-xl" aria-hidden="true"></i>
            </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-700 bg-dark/30">
            <button 
                onClick={() => setActiveTab('tuto')}
                className={`flex-1 py-4 font-bold text-sm transition border-b-2 ${activeTab === 'tuto' ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-slate-400 hover:text-white'}`}
            >
                <i className="fas fa-graduation-cap mr-2" aria-hidden="true"></i> Tutoriel
            </button>
            <button 
                onClick={() => setActiveTab('tips')}
                className={`flex-1 py-4 font-bold text-sm transition border-b-2 ${activeTab === 'tips' ? 'border-secondary text-secondary bg-secondary/5' : 'border-transparent text-slate-400 hover:text-white'}`}
            >
                <i className="fas fa-lightbulb mr-2" aria-hidden="true"></i> Astuces Pro
            </button>
            <button 
                onClick={() => setActiveTab('faq')}
                className={`flex-1 py-4 font-bold text-sm transition border-b-2 ${activeTab === 'faq' ? 'border-green-500 text-green-400 bg-green-500/5' : 'border-transparent text-slate-400 hover:text-white'}`}
            >
                <i className="fas fa-life-ring mr-2" aria-hidden="true"></i> FAQ
            </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-surface">
            
            {activeTab === 'tuto' && (
                <div className="space-y-8">
                    <div className="text-center mb-10">
                        <h3 className="text-2xl font-bold text-white mb-2">Comment ça marche ?</h3>
                        <p className="text-slate-400">Transformez votre texte en roman graphique en 5 étapes simples.</p>
                    </div>
                    
                    <div className="space-y-6 relative before:absolute before:left-6 before:top-4 before:bottom-4 before:w-0.5 before:bg-slate-700">
                        {steps.map((step, idx) => (
                            <div key={idx} className="relative pl-20 group">
                                <div className="absolute left-0 top-0 w-12 h-12 bg-slate-800 border-2 border-slate-600 group-hover:border-primary rounded-full flex items-center justify-center z-10 transition-colors">
                                    <i className={`fas ${step.icon} text-slate-400 group-hover:text-white`} aria-hidden="true"></i>
                                </div>
                                <div className="bg-dark/40 p-5 rounded-xl border border-slate-700 group-hover:border-slate-600 transition">
                                    <h4 className="text-lg font-bold text-white mb-2">{step.title}</h4>
                                    <p className="text-sm text-slate-400 leading-relaxed">{step.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {activeTab === 'tips' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-xl border border-slate-700">
                        <div className="flex items-center gap-3 mb-4 text-yellow-400">
                            <i className="fas fa-star text-2xl" aria-hidden="true"></i>
                            <h3 className="font-bold text-lg text-white">Cohérence des personnages</h3>
                        </div>
                        <p className="text-sm text-slate-300 leading-relaxed">
                            Pour que l'IA reconnaisse bien vos personnages d'une scène à l'autre, <strong>ne changez pas leur nom</strong> et assurez-vous que la fiche personnage (étape 2) contient une description physique très précise (couleur cheveux, style vêtements, cicatrices).
                        </p>
                    </div>

                    <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-xl border border-slate-700">
                        <div className="flex items-center gap-3 mb-4 text-blue-400">
                            <i className="fas fa-cloud-upload-alt text-2xl" aria-hidden="true"></i>
                            <h3 className="font-bold text-lg text-white">Sauvegardez souvent</h3>
                        </div>
                        <p className="text-sm text-slate-300 leading-relaxed">
                            Créez un compte pour sauvegarder votre progression. Vos projets sont stockés de manière chiffrée. N'oubliez pas de cliquer sur l'icône <i className="fas fa-cloud-upload-alt mx-1" aria-hidden="true"></i> après avoir généré des images importantes.
                        </p>
                    </div>

                    <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-xl border border-slate-700">
                        <div className="flex items-center gap-3 mb-4 text-purple-400">
                            <i className="fas fa-magic text-2xl" aria-hidden="true"></i>
                            <h3 className="font-bold text-lg text-white">Style Artistique</h3>
                        </div>
                        <p className="text-sm text-slate-300 leading-relaxed">
                            Dans l'étape "Persos", le champ "Style Artistique" influence tout le projet. Soyez précis : "Aquarelle, couleurs pastels, doux" ou "Cyberpunk, néon, sombre, contrasté".
                        </p>
                    </div>

                    <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-xl border border-slate-700">
                        <div className="flex items-center gap-3 mb-4 text-red-400">
                            <i className="fas fa-file-pdf text-2xl" aria-hidden="true"></i>
                            <h3 className="font-bold text-lg text-white">PDF volumineux</h3>
                        </div>
                        <p className="text-sm text-slate-300 leading-relaxed">
                            Si votre PDF est très long (+500 pages), l'analyse peut prendre du temps. CharacGen limite l'analyse aux éléments clés pour éviter de surcharger le navigateur.
                        </p>
                    </div>
                </div>
            )}

            {activeTab === 'faq' && (
                 <div className="space-y-4">
                    <div className="bg-dark/30 rounded-lg p-4 border border-slate-700">
                        <h4 className="font-bold text-white mb-2 flex items-center gap-2">
                            <i className="fas fa-chevron-right text-xs text-primary" aria-hidden="true"></i>
                            Est-ce gratuit ?
                        </h4>
                        <p className="text-sm text-slate-400 pl-6">
                            L'application utilise votre propre clé API Google Gemini. Les coûts dépendent de votre utilisation personnelle de l'API Google (qui offre un niveau gratuit généreux).
                        </p>
                    </div>
                    
                    <div className="bg-dark/30 rounded-lg p-4 border border-slate-700">
                        <h4 className="font-bold text-white mb-2 flex items-center gap-2">
                            <i className="fas fa-chevron-right text-xs text-primary" aria-hidden="true"></i>
                            Mes données sont-elles privées ?
                        </h4>
                        <p className="text-sm text-slate-400 pl-6">
                            Oui. Le texte est analysé par l'IA via l'API, mais nous ne stockons rien sur nos serveurs sauf si vous utilisez la fonction de sauvegarde (qui est chiffrée et liée à votre compte).
                        </p>
                    </div>

                    <div className="bg-dark/30 rounded-lg p-4 border border-slate-700">
                        <h4 className="font-bold text-white mb-2 flex items-center gap-2">
                            <i className="fas fa-chevron-right text-xs text-primary" aria-hidden="true"></i>
                            Puis-je imprimer le livre ?
                        </h4>
                        <p className="text-sm text-slate-400 pl-6">
                            Absolument. À la dernière étape, cliquez sur "Imprimer / PDF". Utilisez les paramètres de votre navigateur pour "Enregistrer au format PDF". La mise en page est optimisée pour le papier.
                        </p>
                    </div>
                 </div>
            )}

        </div>
        
        <div className="p-4 bg-dark/50 border-t border-slate-700 text-center">
             <button 
                onClick={onClose}
                className="px-8 py-2 bg-slate-700 hover:bg-white hover:text-dark text-white rounded-full font-bold transition"
             >
                J'ai compris !
             </button>
        </div>
      </div>
    </div>
  );
};

export default HelpModal;