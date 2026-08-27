import React from 'react';
import { ancre, type Densite, type Statut } from '../services/vue';
import '../styles/vue.css';

/**
 * Les deux mises en page compactes, partagees par les cinq etapes.
 *
 * POURQUOI UN SEUL COMPOSANT POUR CINQ ECRANS
 *
 * Le casting, les decors, la galerie, le sequencier et le storyboard listent
 * des choses differentes, mais la question posee dans un gros projet est la
 * meme partout : lequel, ou en est-il, et ou est-il. Ecrire cinq listes
 * compactes aurait produit cinq comportements de recherche legerement
 * differents, cinq facons d'annoncer un echec, et cinq endroits a corriger.
 *
 * Chaque etape traduit donc sa collection en `LigneCompacte`, et c'est tout ce
 * qu'elle a a faire.
 */

export interface LigneCompacte {
  id: string;
  /** Le numero affiche en tete, quand l'ordre a un sens : les scenes. */
  rang?: number;
  nom: string;
  /** Le role, le type de decor, le lieu. Premier element sacrifie si l'ecran est etroit. */
  sousTitre?: string;
  vignette?: string;
  statut: Statut;
  /** Courtes etiquettes : importance, nombre de scenes, reperage incertain. */
  etiquettes?: { texte: string; ton?: 'neutre' | 'lien' | 'alerte'; titre?: string }[];
  /** Ce que le survol et le lecteur d'ecran ajoutent, par exemple les numeros de scene. */
  detail?: string;
  /** Les boutons de fin de ligne, propres a chaque etape. */
  actions?: React.ReactNode;
}

const LIBELLE_STATUT: Record<Statut, string> = {
  completed: 'terminee',
  error: 'en erreur',
  generating: 'en cours',
  pending: 'en attente',
};

const CLASSE_STATUT: Record<Statut, string> = {
  completed: 'est-fait',
  error: 'est-erreur',
  generating: 'est-encours',
  pending: 'est-attente',
};

const ICONE_STATUT: Record<Statut, string> = {
  completed: 'fa-check',
  error: 'fa-triangle-exclamation',
  generating: 'fa-spinner fa-spin',
  pending: 'fa-hourglass-half',
};

/**
 * L'etat d'un element, lisible sans distinguer les couleurs.
 *
 * La forme, l'icone et le texte masque changent en meme temps que la teinte :
 * une coche verte et un triangle ambre se distinguent en niveaux de gris, pas
 * le vert de l'ambre.
 */
export const PastilleEtat: React.FC<{ statut: Statut }> = ({ statut }) => (
  <span className={`pastille-etat ${CLASSE_STATUT[statut]}`}>
    <i className={`fas ${ICONE_STATUT[statut]}`} aria-hidden="true"></i>
    <span className="sr-only">{LIBELLE_STATUT[statut]}</span>
  </span>
);

/**
 * Ramene a la fiche complete et la designe.
 *
 * POURQUOI LE HALO N'EST PAS UNE COQUETTERIE
 *
 * Faire defiler jusqu'a la bonne carte ne suffit pas : la page se pose au milieu
 * de dix cartes qui se ressemblent, et rien ne dit laquelle on cherchait. Le
 * halo dure le temps de la designer, puis s'efface.
 *
 * Le double `requestAnimationFrame` laisse a React le temps de peindre les
 * cartes avant qu'on cherche l'ancre : sans lui, l'element n'existe pas encore
 * dans le document au moment ou on le demande, et rien ne se passe.
 */
export const focaliserFiche = (prefixe: string, id: string): void => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const cible = document.getElementById(ancre(prefixe, id));
      if (!cible) return;
      const doux = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      cible.scrollIntoView({ behavior: doux ? 'auto' : 'smooth', block: 'center' });
      cible.classList.remove('fiche-visee');
      // Relance l'animation meme si la meme fiche est visee deux fois de suite.
      void cible.offsetWidth;
      cible.classList.add('fiche-visee');
      window.setTimeout(() => cible.classList.remove('fiche-visee'), 1700);
    });
  });
};

interface VueCompacteProps {
  lignes: LigneCompacte[];
  /** `cartes` n'est jamais passe ici : l'appelant garde alors son propre rendu. */
  densite: Exclude<Densite, 'cartes'>;
  /**
   * Ce que fait un clic. Il ramene toujours aux cartes, cadrees sur l'element :
   * une ligne compacte se lit, elle ne se modifie pas.
   */
  onOuvrir: (id: string) => void;
  /** La proportion des vignettes du mur, celle demandee au modele. */
  ratioImage?: string;
  /** Le message quand le filtre ne laisse rien passer. */
  vide: string;
}

const VueCompacte: React.FC<VueCompacteProps> = ({ lignes, densite, onOuvrir, ratioImage = '3 / 2', vide }) => {
  if (lignes.length === 0) {
    return (
      <p className="vue-vide" role="status">
        <i className="fas fa-filter-circle-xmark mr-2" aria-hidden="true"></i>
        {vide}
      </p>
    );
  }

  if (densite === 'planches') {
    const proportion = ratioImage.includes(':') ? ratioImage.replace(':', ' / ') : ratioImage;
    return (
      <div className="mur-planches">
        {lignes.map((ligne) => (
          <button
            key={ligne.id}
            type="button"
            className="planche-vignette"
            onClick={() => onOuvrir(ligne.id)}
            title={ligne.detail || ligne.sousTitre || ligne.nom}
            aria-label={`${ligne.rang ? `${ligne.rang}. ` : ''}${ligne.nom}, ${LIBELLE_STATUT[ligne.statut]}. Ouvrir la fiche`}
          >
            <span className="planche-vignette__cadre" style={{ aspectRatio: proportion }}>
              {ligne.vignette ? (
                /* `loading="lazy"` compte ici : un mur peut porter cent images
                   encodees en base64, toutes chargees d'un coup sinon. */
                <img src={ligne.vignette} alt="" loading="lazy" decoding="async" />
              ) : (
                <span className="planche-vignette__vide" style={{ aspectRatio: proportion }}>
                  <i className={`fas ${ICONE_STATUT[ligne.statut]}`} aria-hidden="true"></i>
                  {LIBELLE_STATUT[ligne.statut]}
                </span>
              )}
            </span>
            <span className="planche-vignette__legende">
              {ligne.rang !== undefined && <b>{String(ligne.rang).padStart(2, '0')}</b>}
              <span>{ligne.nom}</span>
              <PastilleEtat statut={ligne.statut} />
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="liste-compacte">
      {lignes.map((ligne) => (
        <div key={ligne.id} className="ligne-compacte">
          {/*
            Le bouton ne couvre que le corps de la ligne, pas les actions : un
            bouton dans un bouton n'est pas un balisage valide, et un clic sur
            « supprimer » ouvrirait aussi la fiche.
          */}
          <button
            type="button"
            onClick={() => onOuvrir(ligne.id)}
            className="ligne-compacte__ouvrir"
            title={ligne.detail || undefined}
            aria-label={`${ligne.rang ? `${ligne.rang}. ` : ''}${ligne.nom}${ligne.sousTitre ? `, ${ligne.sousTitre}` : ''}, ${LIBELLE_STATUT[ligne.statut]}${ligne.detail ? `, ${ligne.detail}` : ''}. Ouvrir la fiche`}
          >
            {ligne.rang !== undefined && (
              <span className="ligne-compacte__rang" aria-hidden="true">{String(ligne.rang).padStart(2, '0')}</span>
            )}

            <span className="ligne-compacte__vignette" aria-hidden="true">
              {ligne.vignette
                ? <img src={ligne.vignette} alt="" loading="lazy" decoding="async" />
                : ligne.nom.charAt(0).toUpperCase()}
            </span>

            <span className="ligne-compacte__corps">
              <span className="ligne-compacte__nom">{ligne.nom}</span>
              {ligne.sousTitre && <span className="ligne-compacte__sous">{ligne.sousTitre}</span>}
            </span>

            {ligne.etiquettes && ligne.etiquettes.length > 0 && (
              <span className="ligne-compacte__etiquettes" aria-hidden="true">
                {ligne.etiquettes.map((etiquette) => (
                  <span
                    key={etiquette.texte}
                    className={`ligne-compacte__etiquette${etiquette.ton === 'lien' ? ' est-lien' : etiquette.ton === 'alerte' ? ' est-alerte' : ''}`}
                    title={etiquette.titre}
                  >
                    {etiquette.texte}
                  </span>
                ))}
              </span>
            )}

            <PastilleEtat statut={ligne.statut} />
          </button>

          {ligne.actions && <span className="ligne-compacte__actions">{ligne.actions}</span>}
        </div>
      ))}
    </div>
  );
};

export default VueCompacte;
