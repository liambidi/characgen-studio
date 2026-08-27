import React, { useState } from 'react';
import { Scene } from '../types';
import { detailImage } from '../services/dataService';
import AvertissementPlanche from './AvertissementPlanche';
import BarreVue, { useCollectionFiltree, useReglagesVue } from './BarreVue';
import VueCompacte, { focaliserFiche, type LigneCompacte } from './VueCompacte';
import { ancre } from '../services/vue';

interface SceneGalleryProps {
  scenes: Scene[];
  onRestart: () => void;
  onRetry: (id: string) => void;
  onNextStep?: () => void;
  onEditImage?: (id: string) => void;
  onStop?: () => void;
  isGenerating: boolean;
  /**
   * Proportion réellement demandée à Gemini, par exemple « 2:3 ».
   *
   * Les vignettes étaient figées en 16:9 avec un recadrage plein cadre. Depuis
   * qu'un livre portrait produit des images portrait, ce cadre coupait la
   * moitié de chaque plan sans le dire.
   */
  ratioImage?: string;
}

const SceneGallery: React.FC<SceneGalleryProps> = ({ scenes, onRestart, onRetry, onNextStep, onEditImage, onStop, isGenerating, ratioImage = '16:9' }) => {
  const [erreurOuverte, setErreurOuverte] = useState<string | null>(null);

  /*
   * C'EST ICI QUE LE MODE COMPACT COMPTE LE PLUS
   *
   * Le storyboard empile des cartes pleine largeur separees de trois rem. Sur un
   * roman decoupe en cent scenes, le parcourir une fois demande une cinquantaine
   * d'ecrans de defilement, et rien ne permettait de sauter a la scene 62 ni de
   * voir si deux planches voisines se ressemblent. Le mur de vignettes fait
   * tenir ces cent scenes en un ecran ou deux.
   *
   * Le numero de scene est conserve sur chaque ligne : il vient du rang dans le
   * tableau complet, pas dans la liste filtree. Filtrer sur les erreurs et lire
   * « 03 » sur la troisieme erreur, au lieu du vrai numero de la scene, ferait
   * chercher longtemps.
   */
  const vue = useReglagesVue('storyboard');
  const numeroDe = new Map(scenes.map((scene, index) => [scene.id, index + 1]));

  const { visibles, comptes } = useCollectionFiltree(
    scenes,
    vue.recherche,
    vue.etat,
    (scene) => [scene.title, scene.location, scene.description, ...(scene.charactersPresent || [])],
  );

  const lignes: LigneCompacte[] = visibles.map((scene) => {
    const presents = (scene.charactersPresent || []).filter(Boolean);
    return {
      id: scene.id,
      rang: numeroDe.get(scene.id),
      nom: scene.title,
      sousTitre: scene.location,
      vignette: scene.imageUrl,
      statut: scene.status,
      detail: scene.status === 'error'
        ? scene.errorMessage
        : presents.length > 0 ? `Avec ${presents.join(', ')}` : undefined,
      etiquettes: [
        ...(presents.length > 0
          ? [{ texte: `${presents.length} pers.`, ton: 'lien' as const, titre: presents.join(', ') }]
          : []),
        ...(scene.reperageIncertain ? [{ texte: 'reperage incertain', ton: 'alerte' as const }] : []),
      ],
      actions: (
        <>
          {scene.status === 'error' && (
            <button
              onClick={() => onRetry(scene.id)}
              aria-label={`Relancer l'illustration de ${scene.title}`}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-amber-300 hover:text-white hover:bg-amber-500 transition"
            >
              <i className="fas fa-rotate-right text-xs" aria-hidden="true"></i>
            </button>
          )}
          {scene.imageUrl && (
            <button
              onClick={() => downloadImage(scene)}
              aria-label={`Telecharger l'illustration de ${scene.title}`}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition"
            >
              <i className="fas fa-download text-xs" aria-hidden="true"></i>
            </button>
          )}
        </>
      ),
    };
  });

  /** La regle unique de l'application : un clic ramene a la carte, et la designe. */
  const ouvrirScene = (id: string) => {
    vue.setDensite('cartes');
    focaliserFiche('scene', id);
  };

  const downloadImage = (scene: Scene) => {
    if (!scene.imageUrl) return;
    // L'extension suit le type réel de l'image, qui n'est pas toujours du PNG.
    const { extension } = detailImage(scene.imageUrl);
    const link = document.createElement('a');
    link.href = scene.imageUrl;
    link.download = `Scene_${scene.title.replace(/\s+/g, '_')}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const faites = scenes.filter(s => s.status === 'completed' || s.status === 'error').length;
  const enErreur = scenes.filter(s => s.status === 'error').length;
  const allCompleted = scenes.length > 0 && faites === scenes.length && !isGenerating;

  return (
    <div className="w-full max-w-7xl mx-auto p-4 pb-20">
      <div className="flex flex-col md:flex-row justify-between md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-heading font-bold text-white">Storyboard</h2>
          <p className="text-slate-300">
            {isGenerating
              ? `Illustration en cours, ${faites} sur ${scenes.length} terminées.`
              : "Votre histoire est illustrée."}
          </p>

          {isGenerating && (
            <div className="mt-4 max-w-md h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${scenes.length > 0 ? (faites / scenes.length) * 100 : 0}%` }}></div>
            </div>
          )}

          {!isGenerating && enErreur > 0 && (
            <p className="text-amber-300 text-sm mt-3">
              <i className="fas fa-triangle-exclamation mr-2" aria-hidden="true"></i>
              {enErreur} scène{enErreur > 1 ? 's' : ''} n'a pas pu être illustrée.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
            {isGenerating && onStop && (
              <button
                onClick={onStop}
                className="px-5 py-2.5 min-h-[44px] bg-red-500/15 border border-red-500/30 hover:bg-red-500/25 text-red-300 rounded-lg transition text-sm font-bold flex items-center gap-2"
              >
                <i className="fas fa-stop" aria-hidden="true"></i> Arrêter
              </button>
            )}

            {!isGenerating && (
              <button
                  onClick={onRestart}
                  className="px-4 py-2.5 min-h-[44px] bg-surface border border-white/10 hover:bg-white/5 text-slate-200 rounded-lg transition text-sm font-medium"
              >
                  <i className="fas fa-undo mr-2" aria-hidden="true"></i>
                  Nouveau projet
              </button>
            )}

            {allCompleted && onNextStep && (
                <button
                    onClick={onNextStep}
                    className="px-6 py-2.5 min-h-[44px] bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white rounded-lg transition text-sm font-bold shadow-lg shadow-amber-500/20 flex items-center gap-2"
                >
                    <i className="fas fa-book-open" aria-hidden="true"></i>
                    Voir le livre
                </button>
            )}
        </div>
      </div>

      <AvertissementPlanche className="mb-8" avecRelance />

      {/* Recherche, filtre d'état et densité. Voir components/BarreVue.tsx. */}
      <div className="mb-8">
        <BarreVue
          recherche={vue.recherche}
          onRecherche={vue.setRecherche}
          etat={vue.etat}
          onEtat={vue.setEtat}
          densite={vue.densite}
          onDensite={vue.setDensite}
          comptes={comptes}
          visibles={visibles.length}
          nom="scène"
          exemple="Chercher un titre, un lieu, un personnage"
          planchesPossibles={scenes.some((s) => Boolean(s.imageUrl))}
        />
      </div>

      {vue.densite !== 'cartes' ? (
        <VueCompacte
          lignes={lignes}
          densite={vue.densite}
          onOuvrir={ouvrirScene}
          ratioImage={ratioImage}
          vide="Aucune scène ne correspond à cette recherche."
        />
      ) : (

      <div className="space-y-12">
        {visibles.map((scene) => {
          const index = (numeroDe.get(scene.id) || 1) - 1;
          return (
          <div
            key={scene.id}
            id={ancre('scene', scene.id)}
            className={`bg-surface rounded-2xl overflow-hidden shadow-2xl border border-slate-700 transition-all duration-500
              ${scene.status === 'generating' ? 'ring-2 ring-emerald-500' : ''}`}
          >
             <div className="grid md:grid-cols-2 gap-0">
                <div
                  className="bg-black relative group overflow-hidden"
                  style={{ aspectRatio: ratioImage.replace(':', ' / ') }}
                >
                    {scene.status === 'completed' && scene.imageUrl ? (
                        <>
                            <img
                                src={scene.imageUrl}
                                alt={`Illustration de la scène : ${scene.title}`}
                                loading="lazy"
                                className="w-full h-full object-contain transition-transform duration-700 group-hover:scale-105"
                            />
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center justify-center gap-3">
                                <button
                                  onClick={() => downloadImage(scene)}
                                  className="w-11 h-11 bg-white rounded-full flex items-center justify-center text-dark hover:bg-emerald-500 hover:text-white transition shadow-lg"
                                  aria-label={`Télécharger l'illustration de ${scene.title}`}
                                >
                                  <i className="fas fa-download" aria-hidden="true"></i>
                                </button>
                                <button
                                  onClick={() => onRetry(scene.id)}
                                  className="w-11 h-11 bg-white rounded-full flex items-center justify-center text-dark hover:bg-blue-500 hover:text-white transition shadow-lg"
                                  aria-label={`Régénérer l'illustration de ${scene.title}`}
                                >
                                  <i className="fas fa-sync-alt" aria-hidden="true"></i>
                                </button>
                                {onEditImage && (
                                    <button
                                        onClick={() => onEditImage(scene.id)}
                                        className="w-11 h-11 bg-white rounded-full flex items-center justify-center text-dark hover:bg-amber-500 hover:text-white transition shadow-lg"
                                        aria-label={`Retoucher l'illustration de ${scene.title}`}
                                    >
                                        <i className="fas fa-magic" aria-hidden="true"></i>
                                    </button>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                             {scene.status === 'generating' ? (
                                <>
                                  <div className="w-12 h-12 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" aria-hidden="true"></div>
                                  <span className="text-slate-300 text-lg">Illustration en cours</span>
                                  <span className="text-slate-400 text-xs mt-2">Intégration des personnages</span>
                                </>
                              ) : scene.status === 'error' ? (
                                <div className="text-red-300 flex flex-col items-center max-w-xs">
                                    <i className="fas fa-times-circle text-4xl mb-2" aria-hidden="true"></i>
                                    <p className="mb-3 font-semibold">Illustration impossible</p>

                                    {scene.errorMessage && (
                                      <>
                                        <button
                                          onClick={() => setErreurOuverte(erreurOuverte === scene.id ? null : scene.id)}
                                          className="text-[11px] text-slate-300 hover:text-white underline underline-offset-2 mb-2"
                                        >
                                          {erreurOuverte === scene.id ? 'Masquer la raison' : 'Pourquoi ?'}
                                        </button>
                                        {erreurOuverte === scene.id && (
                                          <p className="text-[11px] text-slate-200 bg-black/60 rounded-lg p-2 mb-3 max-h-24 overflow-y-auto text-left">
                                            {scene.errorMessage}
                                          </p>
                                        )}
                                      </>
                                    )}

                                    <button
                                        onClick={() => onRetry(scene.id)}
                                        className="px-4 py-2 min-h-[44px] bg-red-500 hover:bg-red-600 text-white rounded-full text-sm font-bold transition flex items-center gap-2"
                                    >
                                        <i className="fas fa-rotate-right" aria-hidden="true"></i> Réessayer
                                    </button>
                                </div>
                              ) : (
                                <div className="text-slate-400">
                                    <i className="fas fa-clock text-4xl mb-2" aria-hidden="true"></i>
                                    <p>En attente</p>
                                </div>
                              )}
                        </div>
                    )}
                </div>

                <div className="p-8 flex flex-col justify-center">
                    <div className="flex items-center gap-3 mb-4">
                        <span className="bg-slate-700 text-slate-200 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0">
                            {index + 1}
                        </span>
                        <h3 className="text-2xl font-heading font-bold text-white">{scene.title}</h3>
                    </div>

                    <p className="text-slate-300 leading-relaxed text-lg mb-6">
                        {scene.description}
                    </p>

                    <div className="mt-auto pt-6 border-t border-slate-700">
                        <span className="text-xs text-slate-400 uppercase tracking-widest font-semibold block mb-3">
                            Personnages présents
                        </span>
                        <div className="flex flex-wrap gap-2">
                            {(scene.charactersPresent || []).length > 0
                              ? (scene.charactersPresent || []).map((charName, i) => (
                                  <span key={i} className="text-xs bg-slate-800 text-slate-300 px-3 py-1 rounded-full border border-slate-700">
                                      {charName}
                                  </span>
                                ))
                              : <span className="text-xs text-slate-400 italic">Aucun personnage identifié</span>}
                        </div>
                    </div>
                </div>
             </div>
          </div>
          );
        })}
      </div>
      )}
    </div>
  );
};

export default SceneGallery;
