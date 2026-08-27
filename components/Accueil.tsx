import React from 'react';
import { FicheProjet } from '../services/dataService';
import { AppStep } from '../types';
import { confirmer } from '../services/notifications';

/**
 * La page d'accueil.
 *
 * POURQUOI ELLE N'EXISTAIT PAS
 *
 * L'application ouvrait directement sur la zone de depot de fichier, parce
 * qu'elle ne connaissait qu'un seul projet a la fois : il n'y avait rien a
 * choisir, donc rien a afficher avant. Depuis que chaque recit a son
 * identifiant, il y a une liste, et donc une premiere page.
 *
 * Le plus recent est mis en avant, seul, en grand : dans un outil ou une
 * seance dure une heure, la question posee neuf fois sur dix est « ou en
 * etais-je », pas « lequel ouvrir ». Les autres suivent en vignettes.
 */

interface AccueilProps {
  fiches: FicheProjet[];
  onOuvrir: (id: string) => void;
  onNouveau: () => void;
  onImporter: () => void;
  onSupprimer: (id: string) => void;
  libelleEtape: (etape: AppStep) => string;
  /** Le rang de l etape dans le parcours, de 1 a 7. Les valeurs de AppStep ne
   *  se suivent pas, elles valent 0, 2, 3, 4, 6, 8 et 9 : les employer comme
   *  rang affichait « etape 7 sur 7 » pour le Storyboard, qui est la sixieme. */
  rangEtape: (etape: AppStep) => number;
  nbEtapes: number;
}

const dateCourte = (t: number) => {
  try {
    return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  } catch {
    return '';
  }
};

/** Un cadre neutre quand aucune planche n'a encore ete produite. */
const Vignette: React.FC<{ apercu?: string; classe: string }> = ({ apercu, classe }) =>
  apercu ? (
    <img src={apercu} alt="" className={`${classe} object-cover`} />
  ) : (
    <div className={`${classe} bg-gradient-to-br from-surface-highlight to-dark border border-white/10 flex items-center justify-center`}>
      <i className="fas fa-image text-slate-500 text-xl" aria-hidden="true"></i>
    </div>
  );

const Accueil: React.FC<AccueilProps> = ({
  fiches, onOuvrir, onNouveau, onImporter, onSupprimer, libelleEtape, rangEtape, nbEtapes,
}) => {
  const [recent, ...autres] = fiches;

  const demanderSuppression = async (fiche: FicheProjet) => {
    const oui = await confirmer(
      `Supprimer « ${fiche.titre} » ?`,
      "Le récit, ses personnages et toutes ses planches seront effacés de ce navigateur. Cette action est définitive : exportez le projet d'abord si vous voulez le garder.",
      { libelleConfirmer: 'Supprimer', dangereux: true }
    );
    if (oui) onSupprimer(fiche.id);
  };

  return (
    <div className="flex-1 w-full max-w-[1100px] mx-auto px-6 py-12">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
        {fiches.length === 0 ? 'Premier récit' : `${fiches.length} récit${fiches.length > 1 ? 's' : ''}`}
      </p>
      <h2 className="text-3xl sm:text-4xl font-heading font-bold text-white mt-3 tracking-tight">
        {fiches.length === 0 ? 'Commencez par déposer un texte' : 'Reprendre où vous en étiez'}
      </h2>

      {fiches.length === 0 && (
        <p className="text-slate-300 mt-3 max-w-xl leading-relaxed">
          Importez un roman ou une nouvelle. CharacGen en tire les personnages, les décors et les
          scènes, puis les illustre pour composer un livre.
        </p>
      )}

      {recent && (
        <div className="mt-8 flex flex-col sm:flex-row gap-6 bg-surface border border-white/10 rounded-2xl p-5">
          <Vignette apercu={recent.apercu} classe="w-full sm:w-[210px] h-[150px] rounded-xl shrink-0" />
          <div className="flex-1 min-w-0 flex flex-col">
            <h3 className="text-xl font-heading font-bold text-white truncate">{recent.titre}</h3>
            <p className="text-sm text-slate-400 mt-1">
              Étape {rangEtape(recent.etape)} sur {nbEtapes} · {libelleEtape(recent.etape)}
              {' · '}modifié le {dateCourte(recent.misAJourLe)}
            </p>
            <p className="text-xs text-slate-400 mt-2 tabular-nums">
              {recent.nbPersonnages} personnage{recent.nbPersonnages > 1 ? 's' : ''} ·{' '}
              {recent.nbDecors} décor{recent.nbDecors > 1 ? 's' : ''} ·{' '}
              {recent.nbPlanches} planche{recent.nbPlanches > 1 ? 's' : ''} sur {recent.nbScenes} scène{recent.nbScenes > 1 ? 's' : ''}
            </p>

            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden mt-4" aria-hidden="true">
              <div
                className="h-full bg-primary rounded-full"
                style={{ width: `${Math.max(4, Math.round((recent.nbScenes ? recent.nbPlanches / recent.nbScenes : 0) * 100))}%` }}
              ></div>
            </div>

            <div className="flex flex-wrap gap-2 mt-auto pt-4">
              <button
                onClick={() => onOuvrir(recent.id)}
                className="px-5 py-2.5 min-h-[44px] bg-primary hover:bg-primary-hover text-white rounded-lg font-bold text-sm transition"
              >
                Continuer
              </button>
              <button
                onClick={() => demanderSuppression(recent)}
                className="px-4 py-2.5 min-h-[44px] text-slate-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg text-sm transition"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {autres.length > 0 && (
        <>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-10 mb-3">Autres récits</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {autres.map(fiche => (
              <div key={fiche.id} className="group bg-surface border border-white/10 rounded-xl overflow-hidden hover:border-white/25 transition">
                <button onClick={() => onOuvrir(fiche.id)} className="w-full text-left">
                  <Vignette apercu={fiche.apercu} classe="w-full h-[110px]" />
                  <div className="p-4">
                    <b className="block text-sm font-bold text-white truncate">{fiche.titre}</b>
                    <span className="block text-xs text-slate-400 mt-1">
                      Étape {rangEtape(fiche.etape)} sur {nbEtapes} · {fiche.nbPlanches} planche{fiche.nbPlanches > 1 ? 's' : ''}
                    </span>
                  </div>
                </button>
                <div className="px-4 pb-3 -mt-1">
                  <button
                    onClick={() => demanderSuppression(fiche)}
                    className="text-[11px] text-slate-500 hover:text-red-300 transition"
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="flex flex-wrap gap-3 mt-10 pt-8 border-t border-white/10">
        <button
          onClick={onNouveau}
          className={`px-5 py-3 min-h-[44px] rounded-lg font-bold text-sm transition flex items-center gap-2 ${
            fiches.length === 0
              ? 'bg-primary hover:bg-primary-hover text-white'
              : 'bg-white/5 hover:bg-white/10 text-white border border-white/10'
          }`}
        >
          <i className="fas fa-plus text-xs" aria-hidden="true"></i> Nouveau récit
        </button>
        <button
          onClick={onImporter}
          className="px-5 py-3 min-h-[44px] rounded-lg text-sm text-slate-300 hover:text-white hover:bg-white/5 border border-white/10 transition flex items-center gap-2"
        >
          <i className="fas fa-file-import text-xs" aria-hidden="true"></i> Importer un projet (.json)
        </button>
      </div>
    </div>
  );
};

export default Accueil;
