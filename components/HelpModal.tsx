import React, { useState } from 'react';

interface HelpModalProps {
  onClose: () => void;
}

const HelpModal: React.FC<HelpModalProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<'tuto' | 'tips' | 'faq'>('tuto');

  /**
   * Les sept étapes réelles du parcours, celles de la barre de navigation.
   * Cette liste n'en décrivait que cinq : Décors et Storyboard n'apparaissaient
   * nulle part, et le tutoriel flottant en annonçait six de son côté.
   */
  const steps = [
    {
      icon: "fa-file-upload",
      title: "1. Importer",
      desc: "Chargez votre roman en PDF ou vos notes en fichier texte. L'IA lit le texte en entier, jusqu'à 500 pages, et en extrait les personnages et les lieux."
    },
    {
      icon: "fa-users",
      title: "2. Casting",
      desc: "Vérifiez les fiches de personnages. C'est la description physique qui sera dessinée : plus elle est précise, plus l'image est fidèle. Le style artistique du livre se choisit ici aussi."
    },
    {
      icon: "fa-tree",
      title: "3. Décors",
      desc: "Les lieux où l'action revient. Ils donnent aux illustrations de scènes leur palette et leur architecture. Le bouton Chercher relit votre texte si un lieu manque."
    },
    {
      icon: "fa-images",
      title: "4. Galerie",
      desc: "Les fiches de personnages et de décors se dessinent. Ce sont ces images qui servent de référence à toutes les scènes, pour que les visages restent les mêmes d'une planche à l'autre."
    },
    {
      icon: "fa-list-ol",
      title: "5. Script",
      desc: "Votre récit est découpé en scènes. Vérifiez les personnages présents et le décor de chacune, réordonnez si besoin, et choisissez le format de reliure du livre."
    },
    {
      icon: "fa-film",
      title: "6. Storyboard",
      desc: "Chaque scène est illustrée, en combinant les visages de l'étape 4 et l'action du script. Une illustration peut être régénérée ou retouchée à la baguette."
    },
    {
      icon: "fa-book-open",
      title: "7. Livre",
      desc: "L'assemblage final, texte d'origine et illustrations. Le bouton « Télécharger en PDF » fabrique le fichier au format de reliure choisi à l'étape 5."
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
                        <p className="text-slate-300">Transformez votre texte en livre illustré, en sept étapes.</p>
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
                            <i className="fas fa-hdd text-2xl" aria-hidden="true"></i>
                            <h3 className="font-bold text-lg text-white">Où va votre travail</h3>
                        </div>
                        <p className="text-sm text-slate-300 leading-relaxed">
                            Votre projet s'enregistre tout seul dans ce navigateur, après chaque modification. Rien ne part sur un serveur. Pour le garder ailleurs, ou l'ouvrir sur une autre machine, passez par <strong>Sauvegarder puis Exporter le projet</strong> : vous obtenez un fichier que vous rangez où vous voulez.
                        </p>
                    </div>

                    <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-xl border border-slate-700">
                        <div className="flex items-center gap-3 mb-4 text-purple-400">
                            <i className="fas fa-magic text-2xl" aria-hidden="true"></i>
                            <h3 className="font-bold text-lg text-white">Style Artistique</h3>
                        </div>
                        <p className="text-sm text-slate-300 leading-relaxed">
                            À l'étape Casting, le champ « Direction artistique » s'applique à toutes les images du projet. Soyez précis : « aquarelle, couleurs pastel, traits doux » ou « cyberpunk, néons, sombre et contrasté ». Les huit boutons en dessous remplissent le champ pour vous.
                        </p>
                    </div>

                    <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-xl border border-slate-700">
                        <div className="flex items-center gap-3 mb-4 text-red-400">
                            <i className="fas fa-file-pdf text-2xl" aria-hidden="true"></i>
                            <h3 className="font-bold text-lg text-white">PDF volumineux</h3>
                        </div>
                        <p className="text-sm text-slate-300 leading-relaxed">
                            La lecture s'arrête à 500 pages, et un message vous le dit quand c'est le cas : découpez alors le document pour analyser la suite. Un PDF scanné, fait d'images de pages, ne contient pas de texte lisible et sera refusé.
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
                        <p className="text-sm text-slate-300 pl-6">
                            Oui, pour vous : rien ne vous est demandé, ni compte ni clé. Les appels à l'IA passent par le serveur du site, qui utilise sa propre clé Google. Le nombre de demandes est donc limité, et un message vous prévient si la limite est atteinte.
                        </p>
                    </div>
                    
                    <div className="bg-dark/30 rounded-lg p-4 border border-slate-700">
                        <h4 className="font-bold text-white mb-2 flex items-center gap-2">
                            <i className="fas fa-chevron-right text-xs text-primary" aria-hidden="true"></i>
                            Mes données sont-elles privées ?
                        </h4>
                        <p className="text-sm text-slate-300 pl-6">
                            Votre projet, personnages et illustrations compris, reste dans ce navigateur : il n'est envoyé sur aucun serveur et personne d'autre n'y a accès. En revanche, le texte de votre récit est bien transmis à Google pour être analysé, puisque c'est son modèle qui travaille. Le temps de l'analyse, ce texte transite donc par leurs serveurs.
                        </p>
                    </div>

                    <div className="bg-dark/30 rounded-lg p-4 border border-slate-700">
                        <h4 className="font-bold text-white mb-2 flex items-center gap-2">
                            <i className="fas fa-chevron-right text-xs text-primary" aria-hidden="true"></i>
                            Puis-je imprimer le livre ?
                        </h4>
                        <p className="text-sm text-slate-300 pl-6">
                            Oui. À la dernière étape, le bouton « Télécharger en PDF » fabrique le fichier au format de reliure choisi au Script, prêt pour l'impression. Le bouton Ebook produit une version web, et l'icône imprimante envoie directement à votre imprimante.
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