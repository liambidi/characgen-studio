import React from 'react';
import { Importance, LIBELLE_IMPORTANCE } from '../types';

/**
 * Filtre par importance, partagé par le casting et les décors.
 *
 * POURQUOI IL EXISTE
 *
 * L'analyse demandait au modèle « TOUS les personnages importants » et « les
 * décors récurrents ». Ces deux adjectifs lui confiaient le tri, et il écartait
 * sans dire quoi : c'était la cause première du manque d'exhaustivité. On lui
 * demande maintenant l'inventaire complet, ce qui déplace le problème plutôt
 * que de le supprimer : un roman peut donner quarante personnages dont vingt
 * figurants, et l'écran devient illisible.
 *
 * Ce filtre est la contrepartie. Le tri ne disparaît pas, il change de mains :
 * c'est celui qui connaît le récit qui décide, et il peut revenir sur sa
 * décision, ce que le modèle ne permettait pas.
 */

/** Un élément sans importance date d'avant ce champ : il compte comme secondaire. */
const importanceDe = (element: { importance?: Importance }): Importance =>
  element.importance || 'secondaire';

export const ORDRE_IMPORTANCE: Importance[] = ['principal', 'secondaire', 'figurant'];

/** Combien d'éléments dans chaque catégorie. */
export const compterParImportance = <T extends { importance?: Importance }>(
  elements: T[]
): Record<Importance, number> => {
  const compte: Record<Importance, number> = { principal: 0, secondaire: 0, figurant: 0 };
  elements.forEach((e) => { compte[importanceDe(e)] += 1; });
  return compte;
};

/** Une sélection vide veut dire « tout montrer », jamais « ne rien montrer ». */
export const filtrerParImportance = <T extends { importance?: Importance }>(
  elements: T[],
  actives: Importance[]
): T[] => (actives.length === 0 ? elements : elements.filter((e) => actives.includes(importanceDe(e))));

/**
 * Le filtre ne s'affiche que si le classement existe. Un projet enregistré
 * avant ce champ n'a que des fiches sans importance : lui montrer trois cases
 * dont deux à zéro n'apprendrait rien.
 */
export const classementDisponible = <T extends { importance?: Importance }>(elements: T[]): boolean =>
  elements.some((e) => Boolean(e.importance));

interface FiltreImportanceProps<T extends { importance?: Importance }> {
  elements: T[];
  actives: Importance[];
  onChange: (actives: Importance[]) => void;
}

function FiltreImportance<T extends { importance?: Importance }>({
  elements,
  actives,
  onChange,
}: FiltreImportanceProps<T>) {
  if (!classementDisponible(elements)) return null;

  const compte = compterParImportance(elements);

  const basculer = (importance: Importance) => {
    onChange(
      actives.includes(importance)
        ? actives.filter((i) => i !== importance)
        : [...actives, importance]
    );
  };

  return (
    <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Filtrer par importance">
      <button
        type="button"
        onClick={() => onChange([])}
        aria-pressed={actives.length === 0}
        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors
          ${actives.length === 0
            ? 'bg-primary/20 border-primary text-white'
            : 'bg-black/20 border-white/5 text-slate-400 hover:text-white hover:border-white/25'}`}
      >
        Tout <span className="font-mono opacity-60">{elements.length}</span>
      </button>

      {ORDRE_IMPORTANCE.map((importance) => (
        <button
          key={importance}
          type="button"
          onClick={() => basculer(importance)}
          aria-pressed={actives.includes(importance)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors
            ${actives.includes(importance)
              ? 'bg-primary/20 border-primary text-white'
              : 'bg-black/20 border-white/5 text-slate-400 hover:text-white hover:border-white/25'}`}
        >
          {LIBELLE_IMPORTANCE[importance]}{' '}
          <span className="font-mono opacity-60">{compte[importance]}</span>
        </button>
      ))}
    </div>
  );
}

/** Pastille posée sur une carte, pour lire le classement sans filtrer. */
export const PastilleImportance: React.FC<{ importance?: Importance }> = ({ importance }) => {
  if (!importance) return null;
  const teinte =
    importance === 'principal'
      ? 'bg-primary/20 text-primary-100 border-primary/40'
      : importance === 'secondaire'
        ? 'bg-white/5 text-slate-300 border-white/10'
        : 'bg-white/5 text-slate-500 border-white/10';

  return (
    <span className={`px-2 py-0.5 rounded-md border text-[10px] font-mono uppercase tracking-wider ${teinte}`}>
      {LIBELLE_IMPORTANCE[importance]}
    </span>
  );
};

export default FiltreImportance;
