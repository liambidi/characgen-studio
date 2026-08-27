import React, { useCallback, useMemo, useState } from 'react';
import { lirePreference, ecrirePreference } from '../services/dataService';
import {
  DENSITES, ETATS, compterEtats, correspond, filtrerParEtat,
  type ComptesEtat, type Densite, type EtatVue, type AvecStatut,
} from '../services/vue';
import '../styles/vue.css';

/**
 * La barre d'outils du mode compact, posee au-dessus de chaque collection.
 *
 * ELLE PORTE TROIS REGLAGES, ET UN SEUL EST NOUVEAU DANS SON PRINCIPE
 *
 * La recherche et le filtre d'etat repondent a « ou est X » et « qu'est-ce qui
 * a rate ». La densite, elle, ne filtre rien : elle change la place que prend
 * ce qui est deja la. C'est la reponse au vrai probleme d'un gros projet, ou
 * l'on ne cherche pas un element precis mais ou l'on veut simplement voir
 * l'ensemble sans faire defiler cinquante ecrans.
 *
 * ELLE NE REMPLACE PAS LES CARTES
 *
 * La densite `cartes` reste le defaut et reste la seule ou l'on peut modifier
 * une fiche. Un mode compact qui interdirait de revenir aux cartes aurait
 * remplace un probleme par un autre.
 */

interface BarreVueProps {
  recherche: string;
  onRecherche: (valeur: string) => void;
  etat: EtatVue;
  onEtat: (etat: EtatVue) => void;
  densite: Densite;
  onDensite: (densite: Densite) => void;
  /** Les comptes portes par les etiquettes du filtre d'etat. */
  comptes: ComptesEtat;
  /** Combien de lignes le filtre laisse passer, pour l'annonce sous la barre. */
  visibles: number;
  /** Le nom de ce qu'on compte, au singulier : « personnage », « scene ». */
  nom: string;
  /** Ce qu'on tape dans le champ, adapte a l'etape. */
  exemple: string;
  /**
   * Sans une seule image produite, le mur de planches n'a rien a montrer :
   * le bouton reste visible mais desactive, plutot que d'apparaitre plus tard
   * a un endroit ou l'oeil ne l'attend plus.
   */
  planchesPossibles?: boolean;
  /**
   * Avant la premiere generation, tous les elements sont « restants » : le
   * filtre d'etat n'apprendrait rien et occuperait la moitie de la barre.
   */
  sansEtat?: boolean;
}

const BarreVue: React.FC<BarreVueProps> = ({
  recherche, onRecherche, etat, onEtat, densite, onDensite,
  comptes, visibles, nom, exemple, planchesPossibles = true, sansEtat = false,
}) => {
  const compteDe = (valeur: EtatVue): number =>
    valeur === 'tous' ? comptes.total
      : valeur === 'faits' ? comptes.faits
        : valeur === 'restants' ? comptes.restants
          : comptes.erreurs;

  const filtre = recherche.trim().length > 0 || etat !== 'tous';

  return (
    <div className="barre-vue" role="search">
      <label className="barre-vue__champ">
        <i className="fas fa-magnifying-glass" aria-hidden="true"></i>
        <input
          type="search"
          value={recherche}
          onChange={(e) => onRecherche(e.target.value)}
          placeholder={exemple}
          aria-label={`Chercher un ${nom} par son nom`}
        />
        {recherche && (
          <button
            type="button"
            className="barre-vue__vider"
            onClick={() => onRecherche('')}
            aria-label="Effacer la recherche"
          >
            <i className="fas fa-times" aria-hidden="true"></i>
          </button>
        )}
      </label>

      {!sansEtat && (
        <div className="barre-vue__groupe" role="group" aria-label="Filtrer par etat">
          {ETATS.map((choix) => {
            const compte = compteDe(choix.valeur);
            return (
              <button
                key={choix.valeur}
                type="button"
                className={`barre-vue__chip${choix.valeur === 'erreurs' ? ' est-erreur' : ''}`}
                aria-pressed={etat === choix.valeur}
                /* Un filtre qui ouvre une liste vide n'apprend rien : il se
                   desactive plutot que de laisser cliquer dans le vide. */
                disabled={compte === 0 && choix.valeur !== 'tous'}
                onClick={() => onEtat(choix.valeur)}
              >
                {choix.libelle}<b>{compte}</b>
              </button>
            );
          })}
        </div>
      )}

      <div className="barre-vue__densites" role="group" aria-label="Densite d'affichage">
        {DENSITES.map((choix) => {
          const bloquee = choix.valeur === 'planches' && !planchesPossibles;
          return (
            <button
              key={choix.valeur}
              type="button"
              className="barre-vue__densite"
              aria-pressed={densite === choix.valeur}
              disabled={bloquee}
              onClick={() => onDensite(choix.valeur)}
              title={bloquee ? 'Aucune image produite pour l instant' : choix.aide}
            >
              <i className={`fas ${choix.icone}`} aria-hidden="true"></i>
              <span>{choix.libelle}</span>
            </button>
          );
        })}
      </div>

      {/* L'annonce du resultat est en aria-live : sans elle, taper dans le champ
          ne produit aucun retour audible, la liste change en silence. */}
      <p className="barre-vue__resultat" aria-live="polite">
        {filtre
          ? `${visibles} ${nom}${visibles > 1 ? 's' : ''} sur ${comptes.total}`
          : `${comptes.total} ${nom}${comptes.total > 1 ? 's' : ''}`}
        {filtre && visibles === 0 && ' , rien ne correspond'}
      </p>
    </div>
  );
};

/**
 * Le petit etat partage par les cinq etapes : recherche, filtre, densite.
 *
 * La densite est retenue d'une seance a l'autre, par etape. Quelqu'un qui
 * travaille en liste sur le sequencier veut y revenir en liste, et cette
 * preference n'a aucune raison de valoir pour le casting. La recherche, elle,
 * n'est jamais retenue : rouvrir un projet sur une liste filtree, sans se
 * souvenir d'avoir tape quoi que ce soit, donnerait a croire que des fiches ont
 * disparu.
 */
export const useReglagesVue = (cle: string) => {
  const clePref = `characgen_densite_${cle}`;

  const [recherche, setRecherche] = useState('');
  const [etat, setEtat] = useState<EtatVue>('tous');
  const [densite, poserDensite] = useState<Densite>(() => {
    const memorisee = lirePreference(clePref);
    return memorisee === 'liste' || memorisee === 'planches' ? memorisee : 'cartes';
  });

  const setDensite = useCallback((valeur: Densite) => {
    ecrirePreference(clePref, valeur);
    poserDensite(valeur);
  }, [clePref]);

  return { recherche, setRecherche, etat, setEtat, densite, setDensite };
};

/**
 * Applique la recherche puis le filtre d'etat, et rend au passage les comptes
 * affiches sur les etiquettes.
 *
 * L'ORDRE COMPTE, ET IL N'EST PAS EVIDENT
 *
 * Les comptes sont calcules APRES la recherche mais AVANT le filtre d'etat.
 * Autrement dit, chercher « Maelle » puis lire « En erreur 2 » veut dire deux
 * erreurs parmi les fiches de Maelle, pas deux dans tout le projet. C'est ce que
 * promet un bouton pose a cote d'une recherche active : cliquer dessus doit
 * ouvrir exactement le nombre annonce.
 */
export function useCollectionFiltree<T extends AvecStatut>(
  elements: T[],
  recherche: string,
  etat: EtatVue,
  champsDe: (element: T) => Array<string | undefined | null>
): { visibles: T[]; comptes: ComptesEtat } {
  return useMemo(() => {
    const cherches = recherche.trim()
      ? elements.filter((element) => correspond(champsDe(element), recherche))
      : elements;

    return { visibles: filtrerParEtat(cherches, etat), comptes: compterEtats(cherches) };
    // `champsDe` est redefinie a chaque rendu par les appelants : la mettre en
    // dependance relancerait le calcul a chaque fois, ce que ce memo evite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, recherche, etat]);
}

export default BarreVue;
