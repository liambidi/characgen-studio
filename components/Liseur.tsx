import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Scene } from '../types';
import { RATIO_DOUBLE_PAGE } from '../services/formats';
import { Feuillet, construireFeuillets, disposerFeuillets, positionDeLaPlanche } from '../services/liseur';
import { lirePreference, ecrirePreference } from '../services/dataService';

/**
 * Le liseur : l'etape Livre en objet feuilletable.
 *
 * CE QUI NE MARCHAIT PAS
 *
 * L'etape Livre etait un defilement vertical. Une planche par ecran, l'image
 * en haut, le texte en dessous, et un bouton pour inverser les deux. C'etait
 * une galerie mise en page, pas un livre : on ne feuilletait rien, on ne
 * voyait jamais deux pages ensemble, et le rythme d'un album illustre, une
 * image en regard de son texte, n'existait nulle part.
 *
 * CE QUI CHANGE
 *
 * Le livre est ouvert. Deux feuillets cote a cote, une pliure au milieu, une
 * tranche qui maigrit d'un cote et grossit de l'autre, et une feuille qui
 * pivote vraiment quand on tourne la page.
 *
 * LE MODELE, ET OU IL VIT
 *
 * Un feuillet physique a deux faces, et c'est cette evidence qui organise tout
 * le liseur. Elle ne vit pas dans ce fichier : elle est dans
 * services/liseur.ts, en deux fonctions pures que les tests verifient. Ce
 * composant ne fait que les appeler et peindre le resultat.
 *
 * L'INVERSION A CHAQUE TOUR
 *
 * L'image passe de gauche a droite d'une planche a la suivante. Ce n'est pas
 * un effet : c'est ainsi que se compose un album illustre, pour que deux pages
 * de texte ne se retrouvent jamais collees l'une a l'autre et que l'oeil
 * change de cote a chaque ouverture. L'alternance se deduit du rang de la
 * planche, et une inversion decidee a la main la retourne sans etre perdue.
 *
 * SUR PETIT ECRAN
 *
 * Sous 900 pixels, deux pages cote a cote donneraient des colonnes de 170
 * pixels, illisibles. Le liseur passe alors a un feuillet a la fois, en
 * gardant le meme decompte et le meme rythme d'alternance.
 */

interface LiseurProps {
  /** Planches illustrees, deja filtrees par l'appelant. */
  scenes: Scene[];
  titre: string;
  /** L'illustration occupe-t-elle le premier feuillet de la double page. */
  imageEnPremier: (sceneId: string, index: number) => boolean;
  onInverser: (sceneId: string) => void;
}

/** Largeur au-dessus de laquelle la double page tient sans devenir illisible. */
const SEUIL_DOUBLE_PAGE = 900;

/** Duree des deux animations de tour de page, en millisecondes. Doit suivre le CSS. */
const DUREE_TOUR = { double: 780, simple: 580 };

/**
 * Retient que les reperes de feuilletage ont ete lus.
 *
 * Ils ne se montrent qu'une fois, a la premiere ouverture d'un livre. Le
 * bouton en point d'interrogation, dans la barre de lecture, les rappelle
 * ensuite a la demande : sans lui, un lecteur qui decouvre le liseur sur la
 * machine de quelqu'un d'autre n'aurait aucun moyen de les retrouver.
 */
const CLE_REPERES = 'characgen_liseur_reperes';

const lireDouble = (): boolean =>
  typeof window === 'undefined' ? true : window.matchMedia(`(min-width: ${SEUIL_DOUBLE_PAGE}px)`).matches;

const mouvementReduit = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Corps de depart du texte, en fraction de la largeur de page.
 *
 * Ce n'est qu'un point d'entree, choisi sur la longueur du passage pour eviter
 * a la boucle d'ajustement de Recit de partir de trop loin. C'est elle qui
 * arrete la valeur finale.
 */
const tailleDuRecit = (longueur: number): number => {
  if (longueur > 1500) return 0.0330;
  if (longueur > 1000) return 0.0360;
  if (longueur > 600) return 0.0390;
  if (longueur > 300) return 0.0415;
  return 0.0440;
};

/**
 * Place a reserver sous le livre pour la barre de lecture et sa marge.
 *
 * Mesuree dans le navigateur, pas estimee : 44 pixels pour la rangee des
 * fleches, 10 d'ecart, 38 pour la rangee des reperes, sommaire replie, plus
 * 24 de marge haute et 22 de respiration en bas.
 */
const RESERVE_BARRE = 138;

/**
 * Le bloc de texte d'une page, ajuste pour tenir dans la page.
 *
 * POURQUOI CE N'EST PAS UN SIMPLE DIV
 *
 * Un passage de recit peut faire trois lignes ou trois cents mots, et la page,
 * elle, ne change pas de taille. Trois issues existaient :
 *
 * - tronquer, comme le fait le PDF faute de place. Sur un ecran, rien ne
 *   justifie de cacher du texte qu'on a la place de composer plus petit ;
 * - laisser deborder derriere un defilement. Une page de livre qui defile
 *   annule l'objet qu'on vient de fabriquer ;
 * - composer plus petit jusqu'a ce que ca rentre, ce que fait un typographe
 *   depuis toujours quand un texte doit occuper une surface donnee.
 *
 * C'est la troisieme. La boucle descend par pas de 4 %, jusqu'a 78 % du corps
 * nominal, ce qui absorbe des passages deux fois plus longs que la page. En
 * dessous de ce plancher le texte deviendrait illisible : le defilement reprend
 * alors la main, comme filet, avec sa barre discrete.
 *
 * La boucle lit `scrollHeight` apres chaque changement, donc force un calcul de
 * mise en page a chaque tour. Six tours au maximum, sur une ou deux pages
 * visibles, au montage et au redimensionnement seulement.
 */
const Recit: React.FC<{ texte: string; base: number; largeurPage: number }> = ({
  texte,
  base,
  largeurPage,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const bloc = ref.current;
    if (!bloc) return;

    let ajuste = 1;
    bloc.style.setProperty('--ajuste', '1');
    while (bloc.scrollHeight > bloc.clientHeight + 2 && ajuste > 0.78) {
      ajuste -= 0.04;
      bloc.style.setProperty('--ajuste', ajuste.toFixed(2));
    }
  }, [texte, base, largeurPage]);

  return (
    <div
      ref={ref}
      className="liseur-recit"
      style={{ '--taille-recit': base } as React.CSSProperties}
    >
      {texte}
    </div>
  );
};

/** Fleuron du colophon, dessine plutot qu'emprunte a une police de symboles. */
const Fleuron: React.FC = () => (
  <svg className="liseur-fleuron" viewBox="0 0 60 22" fill="none" aria-hidden="true">
    <path d="M30 3l4 8-4 8-4-8 4-8z" fill="currentColor" opacity="0.9" />
    <path d="M12 7l3 4-3 4-3-4 3-4z" fill="currentColor" opacity="0.55" />
    <path d="M48 7l3 4-3 4-3-4 3-4z" fill="currentColor" opacity="0.55" />
  </svg>
);

/**
 * Les gestes du feuilletage, montres une seule fois.
 *
 * POURQUOI UNE SURCOUCHE ET PAS DU TEXTE SUR LE PAPIER
 *
 * Un livre n'explique pas comment on le tient. Ecrire « cliquez ici » sur une
 * page annulerait l'objet que le liseur passe tant d'efforts a fabriquer. Le
 * partage est donc net : ce qui dit OU L'ON EST, folio, page de garde,
 * colophon, est de la typographie et vit sur le papier ; ce qui dit QUOI FAIRE
 * appartient a l'ecran, se pose au-dessus, et s'en va.
 *
 * CE CALQUE NE BLOQUE RIEN
 *
 * `pointer-events` vaut `none` sur le calque et `auto` sur la seule carte :
 * quelqu'un qui a compris avant d'avoir lu peut tourner la page tout de suite,
 * et ce premier tour referme les reperes. C'est l'inverse d'une visite guidee,
 * qui exige d'etre terminee avant de laisser toucher a quoi que ce soit.
 */
const Reperes: React.FC<{ double: boolean; onFermer: () => void }> = ({ double, onFermer }) => (
  <div className="liseur-reperes" role="note" aria-label="Comment feuilleter ce livre">
    <span className="liseur-repere liseur-repere-gauche" aria-hidden="true">
      <i className="fas fa-arrow-left"></i>
      Reculer
    </span>
    <span className="liseur-repere liseur-repere-droite" aria-hidden="true">
      Avancer
      <i className="fas fa-arrow-right"></i>
    </span>

    <div className="liseur-reperes-carte">
      <p className="liseur-reperes-titre">Ceci est un livre, il se feuillette</p>
      <ul className="liseur-reperes-liste">
        <li>
          <i className="fas fa-hand-pointer" aria-hidden="true"></i>
          <span>
            {double ? 'Cliquez une moitié du livre' : 'Cliquez la page'}, glissez au doigt, ou
            utilisez les flèches du clavier. Début et Fin sautent aux extrémités.
          </span>
        </li>
        <li>
          <i className="fas fa-list" aria-hidden="true"></i>
          <span>
            <strong>Sommaire</strong>, sous le livre, montre toutes les planches et saute
            directement à l'une d'elles.
          </span>
        </li>
        <li>
          <i className="fas fa-right-left" aria-hidden="true"></i>
          <span>
            <strong>Inverser</strong> fait passer l'illustration de l'autre côté de la double
            page, quand le texte vous semble mieux à droite.
          </span>
        </li>
      </ul>
      <button type="button" className="liseur-reperes-bouton" onClick={onFermer}>
        J'ai compris, ouvrir le livre
      </button>
    </div>
  </div>
);

const Liseur: React.FC<LiseurProps> = ({ scenes, titre, imageEnPremier, onInverser }) => {
  const titreAffiche = titre.trim() || 'Sans titre';

  // --- La liste plate des feuillets --------------------------------------

  const feuillets = useMemo<Feuillet[]>(
    () => construireFeuillets(scenes, imageEnPremier),
    [scenes, imageEnPremier]
  );

  // --- Etat de lecture ----------------------------------------------------

  const [double, setDouble] = useState<boolean>(lireDouble);
  const [position, setPosition] = useState(0);
  const [tour, setTour] = useState<1 | -1 | null>(null);
  const [sommaireOuvert, setSommaireOuvert] = useState(false);
  /*
    Les reperes de geste ne s'ouvrent qu'a la premiere visite, et le premier
    tour de page suffit a les fermer : quelqu'un qui a deja compris n'a pas a
    cliquer sur un bouton pour le prouver.
  */
  const [reperesOuverts, setReperesOuverts] = useState<boolean>(
    () => scenes.length > 0 && lirePreference(CLE_REPERES) !== 'vus'
  );
  const tourEnCours = useRef(false);
  /*
    Le sens du tour est double : une fois dans l'etat, pour declencher le rendu
    de la feuille mobile, une fois dans une reference, pour que `finDuTour`
    puisse le lire sans le chercher dans une fonction de mise a jour. React
    peut appeler ces fonctions deux fois en mode strict ; y loger un effet de
    bord, ici l'avancement de la position, ferait sauter deux pages au lieu
    d'une, une fois sur deux, et seulement en developpement.
  */
  const sensDuTour = useRef<1 | -1 | null>(null);

  /*
    L'ecriture de la preference est faite hors de la fonction de mise a jour,
    volontairement. React appelle ces fonctions deux fois en mode strict, et y
    loger un effet de bord est exactement l'erreur documentee plus haut a
    propos du sens du tour.
  */
  const fermerReperes = useCallback(() => {
    ecrirePreference(CLE_REPERES, 'vus');
    setReperesOuverts(false);
  }, []);

  const pas = double ? 2 : 1;
  const positionMax = double ? Math.max(0, feuillets.length - 2) : feuillets.length - 1;

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${SEUIL_DOUBLE_PAGE}px)`);
    const surChangement = () => setDouble(mq.matches);
    mq.addEventListener('change', surChangement);
    return () => mq.removeEventListener('change', surChangement);
  }, []);

  /*
    La position se recale quand le mode change ou quand une planche apparait.
    En double page elle doit rester paire, sinon la feuille qui tourne prendrait
    un feuillet pour l'autre et le livre se lirait a contretemps.
  */
  useEffect(() => {
    setPosition((p) => {
      const alignee = double ? p - (p % 2) : p;
      return Math.min(Math.max(alignee, 0), double ? Math.max(0, feuillets.length - 2) : feuillets.length - 1);
    });
  }, [double, feuillets.length]);

  // --- Tourner la page ----------------------------------------------------

  const finDuTour = useCallback(() => {
    const sens = sensDuTour.current;
    if (sens === null) return;
    sensDuTour.current = null;
    setPosition((p) => Math.min(Math.max(p + sens * pas, 0), positionMax));
    setTour(null);
    tourEnCours.current = false;
  }, [pas, positionMax]);

  const tourner = useCallback(
    (sens: 1 | -1) => {
      if (tourEnCours.current) return;
      if (reperesOuverts) fermerReperes();
      const cible = position + sens * pas;
      if (cible < 0 || cible > positionMax) return;
      if (mouvementReduit()) {
        setPosition(cible);
        return;
      }
      tourEnCours.current = true;
      sensDuTour.current = sens;
      setTour(sens);
    },
    [position, pas, positionMax, reperesOuverts, fermerReperes]
  );

  const allerA = useCallback(
    (cible: number) => {
      if (tourEnCours.current) return;
      if (reperesOuverts) fermerReperes();
      const alignee = double ? cible - (cible % 2) : cible;
      setPosition(Math.min(Math.max(alignee, 0), positionMax));
    },
    [double, positionMax, reperesOuverts, fermerReperes]
  );

  /*
    Filet de securite. `animationend` ne se declenche pas si l'element est
    demonte en cours de route, par exemple quand l'ecran passe de la double
    page a la page simple pendant un tour. Sans ce delai, `tourEnCours`
    resterait vrai et le liseur se bloquerait definitivement.
  */
  useEffect(() => {
    if (tour === null) return;
    const duree = (double ? DUREE_TOUR.double : DUREE_TOUR.simple) + 400;
    const minuterie = window.setTimeout(finDuTour, duree);
    return () => window.clearTimeout(minuterie);
  }, [tour, double, finDuTour]);

  // --- Clavier ------------------------------------------------------------

  useEffect(() => {
    const surTouche = (evenement: KeyboardEvent) => {
      const cible = evenement.target as HTMLElement | null;
      if (cible && (cible.tagName === 'INPUT' || cible.tagName === 'TEXTAREA' || cible.isContentEditable)) return;

      if (evenement.key === 'ArrowRight' || evenement.key === 'PageDown') {
        evenement.preventDefault();
        tourner(1);
      } else if (evenement.key === 'ArrowLeft' || evenement.key === 'PageUp') {
        evenement.preventDefault();
        tourner(-1);
      } else if (evenement.key === 'Home') {
        evenement.preventDefault();
        allerA(0);
      } else if (evenement.key === 'End') {
        evenement.preventDefault();
        allerA(positionMax);
      }
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [tourner, allerA, positionMax]);

  // --- Mesure du livre ----------------------------------------------------

  const cadreRef = useRef<HTMLDivElement>(null);
  const racineRef = useRef<HTMLDivElement>(null);
  const [taille, setTaille] = useState({ largeur: 0, hauteur: 0 });
  const [hauteurCadre, setHauteurCadre] = useState<number | null>(null);
  const [pleinEcran, setPleinEcran] = useState(false);

  useEffect(() => {
    const surChangement = () => setPleinEcran(document.fullscreenElement === racineRef.current);
    document.addEventListener('fullscreenchange', surChangement);
    return () => document.removeEventListener('fullscreenchange', surChangement);
  }, []);

  /*
    La hauteur du livre se mesure, elle ne se devine pas.

    Une valeur en vh ne sait pas ce qu'il y a au-dessus. Des qu'un avertissement
    de format s'inserait entre l'en-tete et le livre, la barre de lecture
    passait sous le bord de l'ecran : les boutons existaient mais on ne les
    voyait pas, ce qui est la pire des deux facons de perdre une commande.

    Le calcul part donc de la distance reelle entre le haut du document et le
    haut du cadre, a laquelle on retire la place de la barre. En plein ecran,
    la feuille de style reprend la main et le cadre occupe ce qui reste.
  */
  useEffect(() => {
    const cadre = cadreRef.current;
    if (!cadre) return;

    const proportionCadre = double ? RATIO_DOUBLE_PAGE : RATIO_DOUBLE_PAGE / 2;

    const mesurer = () => {
      if (!pleinEcran) {
        const hautDansLeDocument = cadre.getBoundingClientRect().top + window.scrollY;

        /*
          Trois bornes, dans cet ordre.

          1. Jamais plus haut que ce qu'il faut pour occuper toute la largeur
             disponible. C'est la borne qui a manque au premier essai : sur un
             telephone, ou la page est etroite et haute, reserver la place de la
             barre laissait un livre de 259 pixels de large sur un ecran de 420.
          2. Sur petit ecran, on s'autorise 72 % de la hauteur visible, quitte a
             ce que la barre demande un petit defilement. C'est le comportement
             normal d'une page mobile, et un livre lisible vaut mieux qu'une
             vignette entierement visible.
          3. Sur grand ecran, la place qui reste sous l'en-tete, avec un plancher
             a 58 % de la hauteur pour que le livre ne s'ecrase pas quand un
             avertissement de format s'ajoute au-dessus.
        */
        const pourOccuperLaLargeur = cadre.clientWidth / proportionCadre;
        const restant = window.innerHeight - hautDansLeDocument - RESERVE_BARRE;
        const plafond = double
          ? Math.max(restant, window.innerHeight * 0.58)
          : window.innerHeight * 0.72;

        setHauteurCadre(Math.round(Math.min(pourOccuperLaLargeur, Math.max(plafond, 300), 900)));
      } else {
        setHauteurCadre(null);
      }

      const boite = cadre.getBoundingClientRect();
      if (boite.width <= 0 || boite.height <= 0) return;
      const proportion = double ? RATIO_DOUBLE_PAGE : RATIO_DOUBLE_PAGE / 2;
      const largeur = Math.min(boite.width, boite.height * proportion);
      setTaille({ largeur: Math.round(largeur), hauteur: Math.round(largeur / proportion) });
    };

    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(cadre);
    window.addEventListener('resize', mesurer);
    return () => {
      observateur.disconnect();
      window.removeEventListener('resize', mesurer);
    };
  }, [double, pleinEcran]);

  const largeurPage = double ? taille.largeur / 2 : taille.largeur;

  // --- Prechargement des voisines ----------------------------------------

  /*
    Les illustrations sont des donnees encodees, parfois lourdes. Sans cette
    avance, la page suivante apparait blanche pendant le tour puis se remplit
    d'un coup, ce qui casse net l'illusion du papier.
  */
  useEffect(() => {
    [position + 2, position + 3, position - 1, position - 2].forEach((rang) => {
      const feuillet = feuillets[rang];
      if (feuillet && feuillet.nature === 'image' && feuillet.scene.imageUrl) {
        const image = new Image();
        image.src = feuillet.scene.imageUrl;
      }
    });
  }, [position, feuillets]);

  // --- Quels feuillets sont visibles, et ou -------------------------------

  const disposition = disposerFeuillets(position, double, tour);

  // --- Reperage pour l'utilisateur ----------------------------------------

  const feuilletsVisibles = double ? [feuillets[position], feuillets[position + 1]] : [feuillets[position]];

  const plancheCourante = feuilletsVisibles.find(
    (f): f is Extract<Feuillet, { nature: 'image' | 'texte' }> =>
      !!f && (f.nature === 'image' || f.nature === 'texte')
  );

  const reperage = plancheCourante
    ? `Planche ${plancheCourante.numero} sur ${scenes.length}`
    : feuilletsVisibles.some((f) => f && f.nature === 'couverture')
      ? 'Couverture'
      : 'Fin du livre';

  const avancement = positionMax > 0 ? position / positionMax : 0;
  const epaisseur = Math.max(7, Math.min(24, feuillets.length * 0.8));
  const trancheGauche = 2 + epaisseur * avancement;
  const trancheDroite = 2 + epaisseur * (1 - avancement);

  // --- Glissement au doigt et clic sur les moities ------------------------

  const depart = useRef<{ x: number; y: number } | null>(null);
  const dernierGlissement = useRef(0);

  const surPointeurBas = (evenement: React.PointerEvent) => {
    depart.current = { x: evenement.clientX, y: evenement.clientY };
  };

  const surPointeurHaut = (evenement: React.PointerEvent) => {
    const origine = depart.current;
    depart.current = null;
    if (!origine) return;
    const dx = evenement.clientX - origine.x;
    const dy = evenement.clientY - origine.y;
    dernierGlissement.current = Math.abs(dx);
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) tourner(dx < 0 ? 1 : -1);
  };

  /** Un glissement vient de tourner la page ; le clic qui suit ne doit pas rejouer. */
  const clicUtile = () => dernierGlissement.current < 10;

  // --- Plein ecran ---------------------------------------------------------

  const basculerPleinEcran = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else racineRef.current?.requestFullscreen().catch(() => undefined);
  };

  // --- Rendu d'un feuillet -------------------------------------------------

  const rendreFeuillet = (rang: number | null) => {
    const feuillet = rang === null ? undefined : feuillets[rang];
    if (!feuillet) return null;
    const cote = rang !== null && rang % 2 === 0 ? 'gauche' : 'droite';

    /*
      LES GARDES NE SONT PLUS MUETTES

      Dans un livre imprime, une garde est une page blanche : on la tourne sans
      la lire, et c'est tres bien ainsi. A l'ecran, c'est la premiere chose
      qu'un nouveau venu voit, puisque le livre s'ouvre garde a gauche et
      couverture a droite. Une page vide en guise d'accueil ne disait ni ou
      l'on etait, ni ce que le livre contenait, ni comment on avance : elle
      etait meme `aria-hidden`, donc invisible aussi aux lecteurs d'ecran.

      La garde avant devient donc un faux-titre : le contenu du livre, et le
      geste qui l'ouvre. C'est le seul endroit du papier ou le liseur parle
      d'un geste, et il y a une raison : cette page precede le livre, elle n'en
      fait pas partie. Une fois la couverture passee, plus aucune page ne donne
      d'instruction.
    */
    if (feuillet.nature === 'garde') {
      if (feuillet.cote === 'arriere') {
        return (
          <div className="liseur-page liseur-garde">
            <div className="liseur-garde-corps">
              <Fleuron />
              <p className="liseur-garde-mention">Fin du livre</p>
            </div>
          </div>
        );
      }

      return (
        <div className="liseur-page liseur-garde">
          <div className="liseur-garde-corps">
            <p className="liseur-garde-sur-titre">CharacGen Studio</p>
            <h3 className="liseur-garde-titre">{titreAffiche}</h3>
            <span className="liseur-garde-filet" aria-hidden="true" />
            <p className="liseur-garde-detail">
              {scenes.length} planche{scenes.length > 1 ? 's' : ''}. Chacune occupe une double
              page : le passage de votre récit d'un côté, son illustration en regard.
            </p>
            <p className="liseur-garde-geste">
              {double
                ? 'Cliquez la page de droite pour ouvrir.'
                : 'Cliquez la page, ou glissez, pour ouvrir.'}
            </p>
          </div>
        </div>
      );
    }

    if (feuillet.nature === 'couverture') {
      const vignette = scenes[0]?.imageUrl;
      return (
        <div className="liseur-page liseur-couverture">
          <span className="liseur-cadre-laiton" aria-hidden="true" />
          <div className="liseur-couverture-corps">
            {vignette && (
              <div className="liseur-vignette">
                <img src={vignette} alt="" aria-hidden="true" />
              </div>
            )}
            <div className="liseur-couverture-texte">
              <h3 className="liseur-couverture-titre">{titreAffiche}</h3>
              <span className="liseur-couverture-filet" aria-hidden="true" />
              <p className="liseur-couverture-mention">Une création graphique assistée par IA</p>
              <p className="liseur-couverture-compte">
                {scenes.length} planche{scenes.length > 1 ? 's' : ''} illustrée
                {scenes.length > 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (feuillet.nature === 'colophon') {
      return (
        <div className="liseur-page liseur-colophon liseur-papier">
          <div className="liseur-colophon-corps">
            <p className="liseur-fin">Fin</p>
            <Fleuron />
            <h3 className="liseur-colophon-titre">{titreAffiche}</h3>
            <p className="liseur-colophon-detail">
              {scenes.length} planche{scenes.length > 1 ? 's' : ''} illustrée
              {scenes.length > 1 ? 's' : ''}
              <br />
              CharacGen Studio
              <br />
              {new Date().toLocaleDateString('fr-FR')}
            </p>
            <span className="liseur-colophon-filet" aria-hidden="true" />
            {/*
              Le colophon disait « Fin » et s'arretait la. Un lecteur arrive au
              bout du livre n'avait alors plus rien a faire, alors que c'est
              precisement le moment ou la sortie l'attend, sous le livre, hors
              de son champ de vision.
            */}
            <p className="liseur-colophon-suite">
              Sous le livre, <strong>Télécharger en PDF</strong> fabrique le fichier au format de
              reliure choisi. <strong>Sommaire</strong> ramène à n'importe quelle planche.
            </p>
          </div>
        </div>
      );
    }

    /*
      LE FOLIO SUR L'ILLUSTRATION

      La page illustree ne portait aucun repere : ni numero, ni total. Sur un
      ecran ou l'image occupe le feuillet entier, un lecteur qui arrive au
      milieu du livre ne savait donc pas combien de planches il avait devant
      lui. En page simple, sur telephone, l'illustration est seule a l'ecran :
      il n'y avait plus rien du tout a lire.

      Le numero se pose donc sur l'image, au bord exterieur, comme le fait un
      album a fond perdu.
    */
    if (feuillet.nature === 'image') {
      return (
        <div className="liseur-page">
          <div className="liseur-illustration">
            <img
              src={feuillet.scene.imageUrl}
              alt={`Planche ${feuillet.numero}, ${feuillet.scene.title}`}
              decoding="async"
            />
          </div>
          <p className={`liseur-folio-image liseur-folio-image-${cote}`}>
            Planche {feuillet.numero} sur {scenes.length}
          </p>
        </div>
      );
    }

    const recit = feuillet.scene.originalTextExcerpt?.trim() || feuillet.scene.description || '';

    return (
      <div className={`liseur-page liseur-papier liseur-page-texte liseur-page-${cote}`}>
        {feuillet.scene.location && <p className="liseur-lieu">{feuillet.scene.location}</p>}
        <h3 className="liseur-titre">{feuillet.scene.title}</h3>
        <span className="liseur-filet" aria-hidden="true" />
        <Recit texte={recit} base={tailleDuRecit(recit.length)} largeurPage={largeurPage} />
        {/*
          Le folio portait le numero seul. « Planche 3 » ne dit pas si le livre
          en compte quatre ou quarante, et c'est exactement ce qu'un lecteur
          cherche a savoir quand il decide de continuer ou de s'arreter.
        */}
        <p className="liseur-folio">
          <span>
            Planche {feuillet.numero} sur {scenes.length}
          </span>
        </p>
      </div>
    );
  };

  // --- Rendu ---------------------------------------------------------------

  const dureeAnimation = double ? DUREE_TOUR.double : DUREE_TOUR.simple;

  return (
    <div ref={racineRef} className={`liseur ${double ? '' : 'liseur-simple'} print:hidden`}>
      <div
        ref={cadreRef}
        className="liseur-cadre"
        style={hauteurCadre !== null ? { height: hauteurCadre } : undefined}
      >
        <div
          className="liseur-scene"
          style={
            {
              width: taille.largeur || undefined,
              height: taille.hauteur || undefined,
              '--pw': `${largeurPage}px`,
            } as React.CSSProperties
          }
          onPointerDown={surPointeurBas}
          onPointerUp={surPointeurHaut}
          role="region"
          aria-roledescription="livre feuilletable"
          aria-label={`${titreAffiche}, ${reperage}`}
        >
          <span className="liseur-socle" aria-hidden="true" />

          {double && (
            <>
              <span
                className="liseur-tranche liseur-tranche-gauche"
                style={{ width: trancheGauche }}
                aria-hidden="true"
              />
              <span
                className="liseur-tranche liseur-tranche-droite"
                style={{ width: trancheDroite }}
                aria-hidden="true"
              />
            </>
          )}

          <div className="liseur-feuillet liseur-gauche">{rendreFeuillet(disposition.gauche)}</div>
          {double && <div className="liseur-feuillet liseur-droite">{rendreFeuillet(disposition.droite)}</div>}

          {double && <span className="liseur-pliure" aria-hidden="true" />}

          {tour !== null && (
            <div
              key={`${position}-${tour}`}
              className={`liseur-mobile ${tour === 1 ? 'liseur-mobile-droite' : 'liseur-mobile-gauche'}`}
              style={{ animationDuration: `${dureeAnimation}ms` }}
              aria-hidden="true"
              onAnimationEnd={(evenement) => {
                // L'evenement remonte aussi depuis les voiles d'ombre, qui sont
                // animes eux aussi. Sans ce filtre, la page tournerait trois fois.
                if (evenement.target !== evenement.currentTarget) return;
                finDuTour();
              }}
            >
              <div className="liseur-face liseur-recto">
                {rendreFeuillet(disposition.recto)}
                <span className="liseur-ombre-face" style={{ animationDuration: `${dureeAnimation}ms` }} />
              </div>
              {double && (
                <div className="liseur-face liseur-verso">
                  {rendreFeuillet(disposition.verso)}
                  <span className="liseur-ombre-face" style={{ animationDuration: `${dureeAnimation}ms` }} />
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            className="liseur-zone liseur-zone-precedent"
            onClick={() => clicUtile() && tourner(-1)}
            tabIndex={-1}
            aria-hidden="true"
          />
          <button
            type="button"
            className="liseur-zone liseur-zone-suivant"
            onClick={() => clicUtile() && tourner(1)}
            tabIndex={-1}
            aria-hidden="true"
          />

          {reperesOuverts && <Reperes double={double} onFermer={fermerReperes} />}
        </div>
      </div>

      {/* --- La barre de lecture ------------------------------------------ */}

      <div className="mt-6 max-w-3xl mx-auto px-4 flex flex-col gap-2.5">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => tourner(-1)}
            disabled={position <= 0}
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full border border-white/10 bg-surface text-slate-200 hover:bg-white/10 hover:border-white/25 transition disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Page précédente"
          >
            <i className="fas fa-chevron-left" aria-hidden="true"></i>
          </button>

          <div className="flex-1 min-w-0">
            <input
              type="range"
              className="liseur-rail"
              min={0}
              max={positionMax}
              step={pas}
              value={position}
              onChange={(evenement) => allerA(Number(evenement.target.value))}
              aria-label="Position dans le livre"
              aria-valuetext={reperage}
            />
          </div>

          <button
            type="button"
            onClick={() => tourner(1)}
            disabled={position >= positionMax}
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full border border-white/10 bg-surface text-slate-200 hover:bg-white/10 hover:border-white/25 transition disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Page suivante"
          >
            <i className="fas fa-chevron-right" aria-hidden="true"></i>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-sm text-slate-300 font-medium min-w-0" aria-live="polite">
            <span className="tabular-nums">{reperage}</span>
            <span className="text-slate-500 text-[12px] font-normal">
              {'  '}· {double ? 'cliquez une moitié du livre' : 'cliquez la page'}, glissez, ou
              utilisez les flèches
            </span>
          </p>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSommaireOuvert((ouvert) => !ouvert)}
              aria-expanded={sommaireOuvert}
              className={`px-3 py-2 min-h-[38px] rounded-lg text-xs font-semibold transition border ${
                sommaireOuvert
                  ? 'bg-white/10 border-white/25 text-white'
                  : 'bg-transparent border-white/10 text-slate-400 hover:text-white hover:border-white/25'
              }`}
            >
              <i className="fas fa-list mr-2" aria-hidden="true"></i>
              Sommaire
            </button>

            {plancheCourante && (
              <button
                type="button"
                onClick={() => onInverser(plancheCourante.scene.id)}
                className="px-3 py-2 min-h-[38px] rounded-lg text-xs font-semibold border border-white/10 text-slate-400 hover:text-white hover:border-white/25 transition"
                title="Faire passer l'illustration de l'autre côté de la double page"
              >
                <i className="fas fa-right-left mr-2" aria-hidden="true"></i>
                Inverser
              </button>
            )}

            <button
              type="button"
              onClick={() => setReperesOuverts(true)}
              className="w-[38px] h-[38px] flex items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:text-white hover:border-white/25 transition"
              aria-label="Revoir comment feuilleter le livre"
              title="Comment feuilleter ce livre"
            >
              <i className="fas fa-circle-question" aria-hidden="true"></i>
            </button>

            <button
              type="button"
              onClick={basculerPleinEcran}
              className="w-[38px] h-[38px] flex items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:text-white hover:border-white/25 transition"
              aria-label={pleinEcran ? 'Quitter le plein écran' : 'Lire en plein écran'}
            >
              <i className={`fas ${pleinEcran ? 'fa-compress' : 'fa-expand'}`} aria-hidden="true"></i>
            </button>
          </div>
        </div>

        {sommaireOuvert && (
          <div className="flex gap-2 overflow-x-auto pb-2 pt-1 no-scrollbar animate-fade-in">
            {scenes.map((scene, index) => (
              <button
                key={scene.id}
                type="button"
                onClick={() => allerA(positionDeLaPlanche(index))}
                className="liseur-vignette-sommaire"
                aria-current={plancheCourante?.numero === index + 1}
                aria-label={`Aller à la planche ${index + 1}, ${scene.title}`}
                title={`${index + 1}. ${scene.title}`}
              >
                <img src={scene.imageUrl} alt="" aria-hidden="true" loading="lazy" />
              </button>
            ))}
          </div>
        )}

      </div>
    </div>
  );
};

export default Liseur;
