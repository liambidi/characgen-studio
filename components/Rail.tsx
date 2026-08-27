import React, { useCallback, useEffect, useState } from 'react';
import { AppStep } from '../types';
import { lirePreference, ecrirePreference } from '../services/dataService';
import '../styles/rail.css';

/**
 * La navigation du projet, en colonne.
 *
 * CE QU'ELLE REMPLACE
 *
 * Un bandeau colle en haut, haut de 64 pixels, qui portait sept gelules dans
 * une barre a defilement horizontal. Sur une fenetre etroite, quatre etapes
 * sur sept sortaient du cadre et un degrade servait a le signaler.
 *
 * CE QU'ELLE AJOUTE, ET QUE LE BANDEAU NE POUVAIT PAS PORTER
 *
 * L'etat de chaque etape. Une rangee de gelules dit ou l'on est ; une colonne
 * dit en plus ce qui est fait, ce qui est encore ferme, et combien il y a de
 * choses dans chaque etape. L'information ne repose jamais sur la seule
 * couleur : une etape faite porte une coche, une etape fermee porte un cadenas
 * et l'attribut disabled, l'etape en cours porte une barre et aria-current.
 */

export interface EtapeRail {
  value: AppStep;
  label: string;
  /** Classe Font Awesome, affichee quand le rail est replie. */
  icon: string;
  accessible: boolean;
  faite: boolean;
  /** Combien il y a dans cette etape. Jamais une repetition de l'etat. */
  compte?: string;
}

export interface SousActionRail {
  libelle: string;
  compte?: string;
  actif: boolean;
  onClick: () => void;
}

interface RailProps {
  etapes: EtapeRail[];
  courante: AppStep;
  onEtape: (etape: AppStep) => void;
  titreProjet: string;
  sousTitre: string;
  onAccueil: () => void;
  /** Sous-actions de l'etape en cours, depliees sous elle. */
  sousActions?: SousActionRail[];
  /** Boutons du bas : sauvegarde, aide, arret de generation. */
  pied: React.ReactNode;
}

const CLE_REPLI = 'characgen_rail_replie';

const Rail: React.FC<RailProps> = ({
  etapes, courante, onEtape, titreProjet, sousTitre, onAccueil, sousActions, pied,
}) => {
  const [replie, setReplie] = useState(() => lirePreference(CLE_REPLI) === 'oui');

  const basculerRepli = useCallback(() => {
    setReplie(prec => {
      ecrirePreference(CLE_REPLI, prec ? 'non' : 'oui');
      return !prec;
    });
  }, []);

  /**
   * Les raccourcis. Alt plutot que les chiffres nus : le projet est fait de
   * champs de saisie, et taper « 3 » dans la description d'un personnage ne
   * doit pas changer d'etape. Le filtre sur la cible reste malgre tout, parce
   * qu'un raccourci qui depend d'une seule condition finit toujours par se
   * declencher au mauvais moment.
   */
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const cible = e.target as HTMLElement | null;
      if (cible) {
        const balise = cible.tagName;
        if (balise === 'INPUT' || balise === 'TEXTAREA' || balise === 'SELECT' || cible.isContentEditable) return;
      }

      if (e.key.toLowerCase() === 'b') { e.preventDefault(); basculerRepli(); return; }

      const rang = Number(e.key);
      if (Number.isInteger(rang) && rang >= 1 && rang <= etapes.length) {
        const cherchee = etapes[rang - 1];
        if (cherchee.accessible) { e.preventDefault(); onEtape(cherchee.value); }
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const ouvertes = etapes.filter(et => et.accessible);
        const index = ouvertes.findIndex(et => et.value === courante);
        const suivante = ouvertes[index + (e.key === 'ArrowDown' ? 1 : -1)];
        if (suivante) { e.preventDefault(); onEtape(suivante.value); }
      }
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [etapes, courante, onEtape, basculerRepli]);

  return (
    /* Pas de style en ligne ici : il l'emporterait sur la requete de media qui
       transforme la colonne en barre basse sous 900 pixels. Le position:sticky
       declare dans rail.css suffit a ancrer le bouton de repli. */
    <div className={`rail${replie ? ' rail--replie' : ''}`}>
      <button
        type="button"
        className="rail__replier"
        onClick={basculerRepli}
        aria-label={replie ? "Deplier la navigation (Alt B)" : "Replier la navigation (Alt B)"}
        title={replie ? "Deplier, Alt B" : "Replier, Alt B"}
      >
        <i className={`fas ${replie ? 'fa-angle-right' : 'fa-angle-left'}`} aria-hidden="true"></i>
      </button>

      <div className="rail__marque">
        <span className="rail__sceau" aria-hidden="true"><i className="fas fa-feather-pointed"></i></span>
        <span className="rail__nom">CharacGen <span>Studio</span></span>
      </div>

      <button type="button" className="rail__projet" onClick={onAccueil} title="Revenir a la liste des projets">
        <b>{titreProjet || 'Recit sans titre'}</b>
        <small>{sousTitre}</small>
      </button>

      <nav className="rail__nav" aria-label="Etapes du projet">
        {etapes.map((etape, i) => {
          const courant = etape.value === courante;
          const etat = !etape.accessible
            ? ', pas encore accessible'
            : etape.faite ? ', terminee' : '';
          return (
            <React.Fragment key={etape.value}>
              <button
                type="button"
                className={`rail__etape${courant ? ' est-courante' : ''}${etape.faite && !courant ? ' est-faite' : ''}`}
                onClick={() => etape.accessible && onEtape(etape.value)}
                disabled={!etape.accessible}
                aria-current={courant ? 'step' : undefined}
                aria-label={`${etape.label}, etape ${i + 1} sur ${etapes.length}${etat}${etape.compte ? `, ${etape.compte}` : ''}`}
                title={replie ? `${etape.label}${etape.compte ? ` · ${etape.compte}` : ''}` : undefined}
              >
                <span className="rail__rang" aria-hidden="true">
                  {replie
                    ? <i className={`fas ${etape.accessible ? etape.icon : 'fa-lock'}`}></i>
                    : !etape.accessible
                      ? <i className="fas fa-lock"></i>
                      : etape.faite && !courant
                        ? <i className="fas fa-check"></i>
                        : String(i + 1).padStart(2, '0')}
                </span>
                <span className="rail__libelle">{etape.label}</span>
                {etape.compte && <span className="rail__compte">{etape.compte}</span>}
              </button>

              {courant && sousActions && sousActions.length > 0 && (
                <div className="rail__sous">
                  {sousActions.map(action => (
                    <button
                      key={action.libelle}
                      type="button"
                      onClick={action.onClick}
                      aria-pressed={action.actif}
                    >
                      {action.libelle}
                      {action.compte !== undefined && <span>{action.compte}</span>}
                    </button>
                  ))}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </nav>

      <div className="rail__pied">{pied}</div>
    </div>
  );
};

export default Rail;
