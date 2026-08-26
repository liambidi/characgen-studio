import React, { useEffect, useRef, useState } from 'react';

interface AnalysisConfigModalProps {
  type: 'character' | 'scene';
  /** Longueur du récit importé, en caractères. Sert à proposer un nombre de scènes. */
  longueurRecit?: number;
  onConfirm: (count: number | null) => void;
  onCancel: () => void;
}

/**
 * Le serveur ramène silencieusement toute demande hors bornes dans cet
 * intervalle. Les afficher ici évite qu'on saisisse 500 scènes et qu'on en
 * obtienne 60 sans comprendre pourquoi.
 *
 * Le plafond de 9 scènes qui figurait ici a disparu le 2026-08-25. Il gardait
 * l'ancien découpage, qui tournait sur une fonction coupée vers 35 secondes.
 * Depuis que l'étape est passée sur la fonction d'arrière-plan et ses 15
 * minutes, ce seuil n'avait plus de fondement : le laisser aurait fait dire à
 * l'interface le contraire de ce que le serveur sait faire.
 */
const QUANTITE_MIN = 1;
const QUANTITE_MAX = 60;

/**
 * Longueur de récit qui justifie en gros une scène.
 *
 * Sert seulement à proposer un ordre de grandeur dans le mode « Automatique
 * chiffré ». Le vrai découpage ne divise plus le texte : c'est le modèle qui
 * repère où les scènes commencent, au changement de lieu, de moment ou de
 * personnages.
 */
const CARACTERES_PAR_SCENE = 7_000;

/** Conversion approximative en pages, pour que le chiffre parle à quelqu'un. */
const CARACTERES_PAR_PAGE = 1_800;

/** Ce que la longueur du récit laisse attendre, à titre indicatif. */
const scenesJustifiees = (longueur: number) =>
  Math.max(4, Math.min(QUANTITE_MAX, Math.round(longueur / CARACTERES_PAR_SCENE)));

const AnalysisConfigModal: React.FC<AnalysisConfigModalProps> = ({ type, longueurRecit, onConfirm, onCancel }) => {
  const pourScenes = type === 'scene';
  const longueur = longueurRecit ?? 0;
  const connaitLeRecit = pourScenes && longueur > 0;

  // Un ordre de grandeur, plus un plafond de sécurité : depuis que le découpage
  // tourne sur la fonction d'arrière-plan et ses 15 minutes, le nombre de scènes
  // n'est plus limité par le temps accordé au serveur.
  const justifiees = scenesJustifiees(longueur);
  const pages = Math.max(1, Math.round(longueur / CARACTERES_PAR_PAGE));

  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [count, setCount] = useState<number>(
    type === 'character' ? 5 : connaitLeRecit ? justifiees : 10
  );

  const boutonRef = useRef<HTMLButtonElement>(null);

  // La touche Échap annule, et le focus arrive sur le bouton principal. Cette
  // fenêtre était la seule modale de l'application à ne rien faire des deux :
  // au clavier, on ne pouvait ni en sortir ni y entrer.
  useEffect(() => {
    boutonRef.current?.focus();
    const auClavier = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', auClavier);
    return () => window.removeEventListener('keydown', auClavier);
  }, [onCancel]);

  const borner = (valeur: number) => Math.min(QUANTITE_MAX, Math.max(QUANTITE_MIN, valeur));

  const handleConfirm = () => {
      if (mode === 'manual') return onConfirm(borner(count));

      // « Automatique » renvoie null : le serveur laisse alors le modèle décider
      // du nombre de scènes d'après la structure du récit. Un nombre calculé ici
      // par division redonnerait le découpage arithmétique qu'on vient de
      // supprimer, et couperait des scènes en deux.
      onConfirm(null);
  };

  const titre = type === 'character' ? 'Analyse des personnages' : 'Analyse des scènes';

  return (
    <div
      className="fixed inset-0 bg-dark/90 backdrop-blur-sm z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titre-analyse"
    >
      <div className="bg-surface border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl animate-bounce-short overflow-hidden">

        <div className="p-6 bg-gradient-to-r from-slate-800 to-slate-900 border-b border-slate-700 text-center">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 ${type === 'character' ? 'bg-primary/20 text-primary' : 'bg-green-500/20 text-green-500'}`}>
                <i className={`fas ${type === 'character' ? 'fa-users' : 'fa-film'} text-2xl`} aria-hidden="true"></i>
            </div>
            <h3 id="titre-analyse" className="text-xl font-bold text-white">{titre}</h3>
            <p className="text-slate-400 text-sm mt-1">
                Comment souhaitez-vous que l'IA procède ?
            </p>
        </div>

        {/* Des vrais boutons radio plutôt que des div cliquables : les anciennes
            options n'étaient atteignables ni au clavier ni au lecteur d'écran. */}
        <fieldset className="p-6 space-y-4 border-0">
            <legend className="sr-only">Méthode d'analyse</legend>

            <label
                className={`p-4 rounded-xl border cursor-pointer transition flex items-center gap-4 ${mode === 'auto' ? 'bg-primary/10 border-primary' : 'bg-dark/50 border-slate-700 hover:border-slate-500'}`}
            >
                <input
                    type="radio"
                    name="mode-analyse"
                    value="auto"
                    checked={mode === 'auto'}
                    onChange={() => setMode('auto')}
                    className="sr-only peer"
                />
                <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface ${mode === 'auto' ? 'border-primary' : 'border-slate-500'}`} aria-hidden="true">
                    {mode === 'auto' && <span className="w-3 h-3 rounded-full bg-primary"></span>}
                </span>
                <span>
                    <span className="text-white font-bold text-sm block">Automatique (recommandé)</span>
                    <span className="text-xs text-slate-400">
                        {pourScenes
                            ? connaitLeRecit
                                ? `L'IA découpe où les scènes commencent vraiment. Votre récit fait ${pages} page${pages > 1 ? 's' : ''} environ, comptez ${justifiees} scènes à peu près.`
                                : "L'IA découpe le récit là où les scènes commencent vraiment."
                            : "L'IA détecte tous les éléments importants."}
                    </span>
                    {pourScenes && (
                        <span className="text-xs text-slate-500 block mt-2">
                            Recommandé : le nombre suit alors la structure de l'histoire au lieu d'être
                            imposé, ce qui évite qu'une scène soit coupée en deux pour tenir le compte.
                        </span>
                    )}
                </span>
            </label>

            <div
                className={`p-4 rounded-xl border transition ${mode === 'manual' ? 'bg-primary/10 border-primary' : 'bg-dark/50 border-slate-700 hover:border-slate-500'}`}
            >
                <label className="flex items-center gap-4 cursor-pointer">
                    <input
                        type="radio"
                        name="mode-analyse"
                        value="manual"
                        checked={mode === 'manual'}
                        onChange={() => setMode('manual')}
                        className="sr-only peer"
                    />
                    <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface ${mode === 'manual' ? 'border-primary' : 'border-slate-500'}`} aria-hidden="true">
                        {mode === 'manual' && <span className="w-3 h-3 rounded-full bg-primary"></span>}
                    </span>
                    <span>
                        <span className="text-white font-bold text-sm block">Définir une quantité</span>
                        <span className="text-xs text-slate-400">Force l'IA à trouver un nombre précis.</span>
                    </span>
                </label>

                {mode === 'manual' && (
                    <div className="flex items-center gap-3 mt-3 pl-10">
                        <button
                            type="button"
                            onClick={() => setCount((c) => borner(c - 1))}
                            disabled={count <= QUANTITE_MIN}
                            className="w-9 h-9 rounded bg-slate-700 text-white hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
                            aria-label="Un de moins"
                        >-</button>

                        <label htmlFor="quantite-analyse" className="sr-only">
                            Nombre d'éléments à trouver, entre {QUANTITE_MIN} et {QUANTITE_MAX}
                        </label>
                        <input
                            id="quantite-analyse"
                            type="number"
                            min={QUANTITE_MIN}
                            max={QUANTITE_MAX}
                            value={count}
                            onChange={(e) => setCount(parseInt(e.target.value, 10) || QUANTITE_MIN)}
                            // La correction se fait à la sortie du champ, sinon effacer
                            // le contenu pour retaper un nombre remettait 1 à chaque frappe.
                            onBlur={() => setCount((c) => borner(c))}
                            className="w-16 bg-dark border border-slate-600 rounded p-1 text-center text-white tabular-nums"
                        />

                        <button
                            type="button"
                            onClick={() => setCount((c) => borner(c + 1))}
                            disabled={count >= QUANTITE_MAX}
                            className="w-9 h-9 rounded bg-slate-700 text-white hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
                            aria-label="Un de plus"
                        >+</button>

                        <span className="text-[11px] text-slate-400">sur {QUANTITE_MAX} au maximum</span>
                    </div>
                )}

                {/* Un nombre imposé force le découpage à respecter le compte,
                    quitte à réunir deux scènes ou à en couper une. Le dire, sans
                    l'interdire : c'est parfois exactement ce qu'on veut. */}
                {pourScenes && mode === 'manual' && (
                    <p className="text-xs text-amber-300/90 mt-3 pl-10">
                        Avec un nombre imposé, l'IA s'y tient : elle regroupe ou divise des moments du
                        récit pour tomber juste. Le découpage automatique suit mieux l'histoire.
                    </p>
                )}
            </div>
        </fieldset>

        <div className="p-4 bg-dark/30 border-t border-slate-700 flex justify-end gap-3">
            <button onClick={onCancel} className="px-4 py-2.5 min-h-[44px] text-slate-300 hover:text-white text-sm">
                Annuler
            </button>
            <button
                ref={boutonRef}
                onClick={handleConfirm}
                className="px-6 py-2.5 min-h-[44px] bg-primary hover:bg-primary-hover text-white rounded-lg font-bold shadow-lg flex items-center gap-2"
            >
                {type === 'character' ? 'Lancer le casting' : 'Lancer le storyboard'}
                <i className="fas fa-arrow-right" aria-hidden="true"></i>
            </button>
        </div>
      </div>
    </div>
  );
};

export default AnalysisConfigModal;
