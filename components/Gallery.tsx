import React, { useState } from 'react';
import { Character, Environment, LIBELLE_TYPE_DECOR } from '../types';
import { exportAssetsToZip, detailImage } from '../services/dataService';
import { notifier, notifierErreur } from '../services/notifications';
import BarreVue, { useCollectionFiltree, useReglagesVue } from './BarreVue';
import VueCompacte, { focaliserFiche, type LigneCompacte } from './VueCompacte';
import { ancre } from '../services/vue';

interface GalleryProps {
  characters: Character[];
  environments?: Environment[];
  titre?: string;
  onRestart: () => void;
  onNextStep: () => void;
  onRetry: (id: string, type: 'char' | 'env') => void;
  onEditImage?: (id: string, type: 'char' | 'env') => void;
  onStop?: () => void;
  isGenerating: boolean;
}

const Gallery: React.FC<GalleryProps> = ({
  characters, environments = [], titre = '', onRestart, onNextStep, onRetry, onEditImage, onStop, isGenerating
}) => {
  const [selectedImage, setSelectedImage] = useState<{ url: string; nom: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'chars' | 'envs'>('chars');
  const [isZipping, setIsZipping] = useState(false);
  const [erreurOuverte, setErreurOuverte] = useState<string | null>(null);

  const downloadImage = (url: string, name: string) => {
    if (!url) return;
    // L'extension suit le type réel de l'image, qui n'est pas toujours du PNG.
    const { extension } = detailImage(url);
    const link = document.createElement('a');
    link.href = url;
    link.download = `CharacGen_${name.replace(/\s+/g, '_')}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadAll = async () => {
      setIsZipping(true);
      try {
        await exportAssetsToZip(characters, environments, [], titre);
        notifier("Images téléchargées.");
      } catch (e) {
        notifierErreur("Téléchargement impossible.", e);
      } finally {
        setIsZipping(false);
      }
  };

  const charsCompleted = characters.length > 0 && characters.every(c => c.status === 'completed' || c.status === 'error');
  const envsCompleted = environments.length === 0 || environments.every(e => e.status === 'completed' || e.status === 'error');
  const allCompleted = charsCompleted && envsCompleted && !isGenerating;
  const anyImages = characters.some(c => c.imageUrl) || environments.some(e => e.imageUrl);

  const tousLesItems: (Character | Environment)[] = activeTab === 'chars' ? characters : environments;

  /*
   * La galerie est l'ecran ou les images arrivent une par une : la recherche y
   * sert moins que le filtre d'etat, qui repond a « qu'est-ce qui a rate » sans
   * avoir a chercher un carre ambre au milieu de quarante vignettes.
   */
  const vue = useReglagesVue('galerie');
  const { visibles: currentItems, comptes } = useCollectionFiltree(
    tousLesItems,
    vue.recherche,
    vue.etat,
    (item: any) => [
      item.name,
      item.role,
      item.type ? LIBELLE_TYPE_DECOR[item.type as Environment['type']] : undefined,
      item.shortDescription,
      item.description,
    ],
  );

  const lignes: LigneCompacte[] = currentItems.map((item: any) => ({
    id: item.id,
    nom: item.name,
    sousTitre: activeTab === 'chars'
      ? item.role
      : (LIBELLE_TYPE_DECOR[item.type as Environment['type']] || item.type),
    vignette: item.imageUrl,
    statut: item.status,
    detail: item.status === 'error' ? item.errorMessage : undefined,
    etiquettes: item.status === 'error' ? [{ texte: 'a relancer', ton: 'alerte' as const }] : [],
    actions: (
      <>
        {item.status === 'error' && (
          <button
            onClick={() => onRetry(item.id, activeTab === 'chars' ? 'char' : 'env')}
            aria-label={`Relancer la generation de ${item.name}`}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-amber-300 hover:text-white hover:bg-amber-500 transition"
          >
            <i className="fas fa-rotate-right text-xs" aria-hidden="true"></i>
          </button>
        )}
        {item.imageUrl && (
          <>
            {/*
              L'agrandissement est un bouton, pas le clic sur la ligne.
              La regle du clic est la meme partout dans l'application, il ramene
              a la carte complete : deux gestes identiques qui feraient deux
              choses selon l'etape rendraient l'interface imprevisible. Le besoin
              de regarder une image de pres reste, il a juste son propre bouton.
            */}
            <button
              onClick={() => setSelectedImage({ url: item.imageUrl, nom: item.name })}
              aria-label={`Agrandir l'image de ${item.name}`}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition"
            >
              <i className="fas fa-magnifying-glass-plus text-xs" aria-hidden="true"></i>
            </button>
            <button
              onClick={() => downloadImage(item.imageUrl, item.name)}
              aria-label={`Telecharger l'image de ${item.name}`}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition"
            >
              <i className="fas fa-download text-xs" aria-hidden="true"></i>
            </button>
          </>
        )}
      </>
    ),
  }));

  /** La regle unique de l'application : un clic ramene a la carte, et la designe. */
  const ouvrirElement = (id: string) => {
    vue.setDensite('cartes');
    focaliserFiche('asset', id);
  };

  // Progression réelle, pour ne pas laisser l'utilisateur devant une attente aveugle.
  const total = characters.length + environments.length;
  const faits = characters.filter(c => c.status === 'completed' || c.status === 'error').length
              + environments.filter(e => e.status === 'completed' || e.status === 'error').length;
  const enErreur = characters.filter(c => c.status === 'error').length + environments.filter(e => e.status === 'error').length;

  return (
    <div className="w-full space-y-8 animate-fade-in pb-20">

      <div className="flex flex-col md:flex-row justify-between md:items-end gap-6 pb-6 border-b border-white/5">
        <div>
          <h2 className="text-3xl font-heading font-bold text-white mb-2">Galerie de production</h2>
          <p className="text-slate-300 max-w-xl">
            {isGenerating
              ? `Génération en cours, ${faits} sur ${total} terminées.`
              : "Vos fiches personnages et décors sont prêtes pour le storyboard."}
          </p>

          {isGenerating && (
            <div className="mt-4 max-w-md">
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${total > 0 ? (faits / total) * 100 : 0}%` }}></div>
              </div>
            </div>
          )}

          {!isGenerating && enErreur > 0 && (
            <p className="text-amber-300 text-sm mt-3">
              <i className="fas fa-triangle-exclamation mr-2" aria-hidden="true"></i>
              {enErreur} image{enErreur > 1 ? 's' : ''} n'a pas pu être générée. Cliquez sur la vignette pour savoir pourquoi.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          {isGenerating && onStop && (
            <button
              onClick={onStop}
              className="px-5 py-2.5 min-h-[44px] bg-red-500/15 border border-red-500/30 hover:bg-red-500/25 text-red-300 rounded-xl transition text-sm font-bold flex items-center gap-2"
            >
              <i className="fas fa-stop" aria-hidden="true"></i> Arrêter
            </button>
          )}

          {anyImages && (
              <button
                onClick={handleDownloadAll}
                disabled={isZipping || isGenerating}
                className="px-5 py-2.5 min-h-[44px] bg-surface border border-white/10 hover:bg-white/5 text-emerald-300 rounded-xl transition text-sm font-medium disabled:opacity-50"
              >
                 {isZipping
                    ? <i className="fas fa-spinner fa-spin mr-2" aria-hidden="true"></i>
                    : <i className="fas fa-file-zipper mr-2" aria-hidden="true"></i>}
                 Tout télécharger
              </button>
          )}

          {!isGenerating && (
            <button
              onClick={onRestart}
              className="px-5 py-2.5 min-h-[44px] bg-surface border border-white/10 hover:bg-white/5 text-slate-200 rounded-xl transition text-sm font-medium"
            >
              Nouveau projet
            </button>
          )}

          {allCompleted && (
            <button
              onClick={onNextStep}
              className="px-6 py-2.5 min-h-[44px] bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl transition text-sm font-bold shadow-lg shadow-emerald-600/20 flex items-center gap-2"
            >
              Étape suivante <i className="fas fa-arrow-right" aria-hidden="true"></i>
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-4 border-b border-white/10" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'chars'}
            onClick={() => setActiveTab('chars')}
            className={`pb-3 pt-2 px-1 min-h-[44px] text-sm font-bold transition border-b-2 ${activeTab === 'chars' ? 'text-primary border-primary' : 'text-slate-300 border-transparent hover:text-white'}`}
          >
              Personnages ({characters.length})
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'envs'}
            onClick={() => setActiveTab('envs')}
            className={`pb-3 pt-2 px-1 min-h-[44px] text-sm font-bold transition border-b-2 ${activeTab === 'envs' ? 'text-emerald-400 border-emerald-400' : 'text-slate-300 border-transparent hover:text-white'}`}
          >
              Décors ({environments.length})
          </button>
      </div>

      {/* Recherche, filtre d'état et densité. Voir components/BarreVue.tsx. */}
      <BarreVue
        recherche={vue.recherche}
        onRecherche={vue.setRecherche}
        etat={vue.etat}
        onEtat={vue.setEtat}
        densite={vue.densite}
        onDensite={vue.setDensite}
        comptes={comptes}
        visibles={currentItems.length}
        nom={activeTab === 'chars' ? 'personnage' : 'décor'}
        exemple={activeTab === 'chars' ? 'Chercher un nom, un rôle' : 'Chercher un lieu, une ambiance'}
        planchesPossibles={tousLesItems.some((e) => Boolean(e.imageUrl))}
      />

      {tousLesItems.length === 0 ? (
        <p className="text-slate-400 text-center py-16">
          {activeTab === 'chars' ? "Aucun personnage dans ce projet." : "Aucun décor dans ce projet."}
        </p>
      ) : vue.densite !== 'cartes' ? (
        <VueCompacte
          lignes={lignes}
          densite={vue.densite}
          onOuvrir={ouvrirElement}
          ratioImage={activeTab === 'envs' ? '16 / 9' : '3 / 2'}
          vide="Rien ne correspond à cette recherche."
        />
      ) : currentItems.length === 0 ? (
        <p className="text-slate-400 text-center py-16">Rien ne correspond à cette recherche.</p>
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {currentItems.map((item: any) => (
          <div
            key={item.id}
            id={ancre('asset', item.id)}
            className={`group bg-surface-highlight/30 border border-white/5 rounded-2xl overflow-hidden shadow-lg transition-all duration-500 hover:shadow-2xl hover:border-white/10
              ${item.status === 'generating' ? 'ring-1 ring-primary/50' : ''}`}
          >
            {/* La carte d'un personnage suit désormais la proportion de sa
                planche, qui est large parce qu'elle aligne trois vues. Elle
                était affichée en 3/4 avec un recadrage plein cadre : on ne
                voyait que la vue du milieu, les deux autres étaient coupées. */}
            <div className={`relative overflow-hidden bg-dark ${activeTab === 'envs' ? 'aspect-video' : 'aspect-[3/2]'}`}>
              {item.status === 'completed' && item.imageUrl ? (
                <>
                  <img
                    src={item.imageUrl}
                    alt={activeTab === 'chars' ? `Fiche du personnage ${item.name}` : `Décor ${item.name}`}
                    loading="lazy"
                    className={`w-full h-full transition-transform duration-700 group-hover:scale-105 ${activeTab === 'chars' ? 'object-contain' : 'object-cover'}`}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-dark via-transparent to-transparent opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
                     <div className="flex justify-center gap-2 flex-wrap">
                        <button
                          onClick={() => setSelectedImage({ url: item.imageUrl, nom: item.name })}
                          className="w-11 h-11 bg-white/20 backdrop-blur hover:bg-white text-white hover:text-dark rounded-full flex items-center justify-center transition"
                          aria-label={`Agrandir l'image de ${item.name}`}
                        >
                          <i className="fas fa-expand-alt text-xs" aria-hidden="true"></i>
                        </button>
                        <button
                          onClick={() => downloadImage(item.imageUrl, item.name)}
                          className="w-11 h-11 bg-white/20 backdrop-blur hover:bg-primary text-white rounded-full flex items-center justify-center transition"
                          aria-label={`Télécharger l'image de ${item.name}`}
                        >
                          <i className="fas fa-download text-xs" aria-hidden="true"></i>
                        </button>
                        <button
                          onClick={() => onRetry(item.id, activeTab === 'chars' ? 'char' : 'env')}
                          className="w-11 h-11 bg-white/20 backdrop-blur hover:bg-secondary text-white rounded-full flex items-center justify-center transition"
                          aria-label={`Régénérer l'image de ${item.name}`}
                        >
                          <i className="fas fa-sync-alt text-xs" aria-hidden="true"></i>
                        </button>
                        {onEditImage && (
                            <button
                                onClick={() => onEditImage(item.id, activeTab === 'chars' ? 'char' : 'env')}
                                className="w-11 h-11 bg-white/20 backdrop-blur hover:bg-amber-500 text-white rounded-full flex items-center justify-center transition"
                                aria-label={`Retoucher l'image de ${item.name} avec l'IA`}
                            >
                                <i className="fas fa-magic text-xs" aria-hidden="true"></i>
                            </button>
                        )}
                     </div>
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                  {item.status === 'generating' ? (
                    <>
                      <div className="w-12 h-12 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" aria-hidden="true"></div>
                      <span className="text-primary text-xs font-bold uppercase tracking-widest">Génération...</span>
                    </>
                  ) : item.status === 'error' ? (
                    <>
                      <i className="fas fa-exclamation-circle text-red-400 text-3xl mb-3" aria-hidden="true"></i>
                      <span className="text-red-300 text-xs mb-3 block font-semibold">Génération impossible</span>

                      {item.errorMessage && (
                        <>
                          <button
                            onClick={() => setErreurOuverte(erreurOuverte === item.id ? null : item.id)}
                            className="text-[11px] text-slate-300 hover:text-white underline underline-offset-2 mb-3"
                          >
                            {erreurOuverte === item.id ? 'Masquer la raison' : 'Pourquoi ?'}
                          </button>
                          {erreurOuverte === item.id && (
                            <p className="text-[11px] text-slate-200 bg-black/60 rounded-lg p-2 mb-3 max-h-28 overflow-y-auto text-left">
                              {item.errorMessage}
                            </p>
                          )}
                        </>
                      )}

                      <button
                        onClick={() => onRetry(item.id, activeTab === 'chars' ? 'char' : 'env')}
                        className="px-4 py-2 min-h-[44px] bg-red-500/15 hover:bg-red-500 text-red-300 hover:text-white rounded-lg text-xs font-bold transition border border-red-500/30"
                      >
                        Réessayer
                      </button>
                    </>
                  ) : (
                    <>
                      <i className="fas fa-hourglass-start text-slate-400 text-3xl mb-3" aria-hidden="true"></i>
                      <span className="text-slate-300 text-xs uppercase tracking-wide">En attente</span>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="p-4 bg-white/5 border-t border-white/5">
                <h3 className="font-heading font-bold text-white text-lg truncate" title={item.name}>{item.name}</h3>
                <p className="text-xs text-primary font-bold uppercase tracking-wider">
                    {activeTab === 'chars' ? item.role : (LIBELLE_TYPE_DECOR[item.type as Environment['type']] || item.type)}
                </p>
            </div>
          </div>
        ))}
      </div>
      )}

      {selectedImage && (
        <div
            className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 animate-fade-in"
            onClick={() => setSelectedImage(null)}
            role="dialog"
            aria-modal="true"
            aria-label={`Image agrandie : ${selectedImage.nom}`}
        >
            <button
                onClick={() => setSelectedImage(null)}
                className="absolute top-6 right-6 text-slate-300 hover:text-white transition z-10 w-12 h-12 flex items-center justify-center rounded-full hover:bg-white/10"
                aria-label="Fermer l'aperçu"
            >
                <i className="fas fa-times text-2xl" aria-hidden="true"></i>
            </button>
            <img
                src={selectedImage.url}
                alt={selectedImage.nom}
                className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            />
        </div>
      )}
    </div>
  );
};

export default Gallery;
