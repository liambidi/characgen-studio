import React from 'react';
import { FicheProjet } from '../services/dataService';
import { AppStep } from '../types';
import { confirmer } from '../services/notifications';

interface AccueilProps {
  fiches: FicheProjet[];
  onOuvrir: (id: string) => void;
  onNouveau: () => void;
  onImporter: () => void;
  onAide: () => void;
  onSupprimer: (id: string) => void;
  libelleEtape: (etape: AppStep) => string;
  rangEtape: (etape: AppStep) => number;
  nbEtapes: number;
}

const dateCourte = (t: number) => {
  try { return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }); }
  catch { return ''; }
};

const pluriel = (nombre: number, singulier: string) => `${nombre} ${singulier}${nombre > 1 ? 's' : ''}`;

/** Une image manque parfois sur un projet encore au début de sa fabrication. */
const Vignette: React.FC<{ apercu?: string; classe: string }> = ({ apercu, classe }) =>
  apercu ? <img src={apercu} alt="" className={`${classe} object-cover`} /> : (
    <div className={`${classe} accueil__vignette-vide`}><i className="fas fa-book-open" aria-hidden="true"></i></div>
  );

const ActionNouvelle: React.FC<{ onClick: () => void; principale?: boolean }> = ({ onClick, principale = false }) => (
  <button onClick={onClick} className={principale ? 'accueil__bouton accueil__bouton--principal' : 'accueil__bouton accueil__bouton--secondaire'}>
    <i className="fas fa-plus" aria-hidden="true"></i> Nouveau récit
  </button>
);

const RepereParcours: React.FC<{ onAide: () => void }> = ({ onAide }) => (
  <section className="accueil__repere" aria-labelledby="parcours-titre">
    <div className="accueil__repere-intro">
      <h2 id="parcours-titre">Votre texte garde le premier rôle</h2>
      <p>CharacGen vous accompagne de la lecture du récit jusqu’au livre illustré, en vous laissant vérifier chaque étape.</p>
    </div>
    <ol className="accueil__parcours">
      <li><i className="fas fa-file-arrow-up" aria-hidden="true"></i><span><strong>Importer</strong> un roman, une nouvelle ou des notes.</span></li>
      <li><i className="fas fa-people-group" aria-hidden="true"></i><span><strong>Vérifier</strong> les personnages, les décors et les scènes.</span></li>
      <li><i className="fas fa-book-open" aria-hidden="true"></i><span><strong>Composer</strong> le livre à partir des illustrations.</span></li>
    </ol>
    <button onClick={onAide} className="accueil__lien-aide">Voir le parcours complet <i className="fas fa-arrow-right" aria-hidden="true"></i></button>
  </section>
);

const Accueil: React.FC<AccueilProps> = ({ fiches, onOuvrir, onNouveau, onImporter, onAide, onSupprimer, libelleEtape, rangEtape, nbEtapes }) => {
  const [recent, ...autres] = fiches;
  const progression = recent?.nbScenes ? Math.round((recent.nbPlanches / recent.nbScenes) * 100) : 0;

  const demanderSuppression = async (fiche: FicheProjet) => {
    const oui = await confirmer(
      `Supprimer « ${fiche.titre} » ?`,
      "Le récit, ses personnages et toutes ses planches seront effacés de ce navigateur. Cette action est définitive : exportez le projet d'abord si vous voulez le garder.",
      { libelleConfirmer: 'Supprimer', dangereux: true }
    );
    if (oui) onSupprimer(fiche.id);
  };

  return (
    <main id="contenu-principal" className="accueil">
      <header className="accueil__entete">
        <div className="accueil__marque" aria-label="CharacGen Studio">
          <span className="accueil__sceau" aria-hidden="true"><i className="fas fa-feather-pointed"></i></span>
          <span>CharacGen <em>Studio</em></span>
        </div>
        <div className="accueil__entete-actions">
          <button onClick={onAide} className="accueil__aide"><i className="fas fa-circle-question" aria-hidden="true"></i><span>Aide</span></button>
          {fiches.length > 0 && <ActionNouvelle onClick={onNouveau} />}
        </div>
      </header>

      {recent ? (
        <>
          <section className="accueil__introduction" aria-labelledby="accueil-titre">
            <div><h1 id="accueil-titre">Reprendre là où vous en étiez</h1><p>Retrouvez votre récit, son avancement et les éléments déjà créés.</p></div>
            <span className="accueil__compteur">{pluriel(fiches.length, 'récit')}</span>
          </section>

          <article className="accueil__recit-principal">
            <div className="accueil__image-principale">
              <Vignette apercu={recent.apercu} classe="accueil__image" />
              <div className="accueil__image-voile" aria-hidden="true"></div>
              <span className="accueil__date">Modifié le {dateCourte(recent.misAJourLe)}</span>
            </div>
            <div className="accueil__recit-corps">
              <div><p className="accueil__etape">Étape {rangEtape(recent.etape)} sur {nbEtapes}</p><h2 title={recent.titre}>{recent.titre}</h2><p className="accueil__etape-nom">{libelleEtape(recent.etape)}</p></div>
              <div className="accueil__avancement">
                <div className="accueil__avancement-ligne"><span>Planches illustrées</span><strong>{recent.nbScenes ? `${recent.nbPlanches} sur ${recent.nbScenes}` : 'À venir'}</strong></div>
                <div className="accueil__jauge" aria-label={recent.nbScenes ? `${progression}% des scènes illustrées` : 'Aucune scène à illustrer'}><span style={{ width: `${Math.max(recent.nbScenes ? 0 : 4, Math.min(100, progression))}%` }}></span></div>
              </div>
              <ul className="accueil__faits" aria-label="Contenu du récit">
                <li><i className="fas fa-user" aria-hidden="true"></i>{pluriel(recent.nbPersonnages, 'personnage')}</li>
                <li><i className="fas fa-mountain-sun" aria-hidden="true"></i>{pluriel(recent.nbDecors, 'décor')}</li>
                <li><i className="fas fa-images" aria-hidden="true"></i>{pluriel(recent.nbPlanches, 'planche')}</li>
              </ul>
              <div className="accueil__actions-recits">
                <button onClick={() => onOuvrir(recent.id)} className="accueil__bouton accueil__bouton--principal">Continuer <i className="fas fa-arrow-right" aria-hidden="true"></i></button>
                <button onClick={() => demanderSuppression(recent)} className="accueil__supprimer">Supprimer ce récit</button>
              </div>
            </div>
          </article>

          <RepereParcours onAide={onAide} />

          {autres.length > 0 && <section className="accueil__bibliotheque" aria-labelledby="autres-recits">
            <div className="accueil__section-titre"><h2 id="autres-recits">Autres récits</h2><span>{pluriel(autres.length, 'récit')}</span></div>
            <div className="accueil__grille">
              {autres.map(fiche => <article key={fiche.id} className="accueil__carte">
                <button onClick={() => onOuvrir(fiche.id)} className="accueil__carte-ouverture" aria-label={`Ouvrir ${fiche.titre}`}>
                  <Vignette apercu={fiche.apercu} classe="accueil__carte-image" />
                  <div className="accueil__carte-corps"><h3 title={fiche.titre}>{fiche.titre}</h3><p>Étape {rangEtape(fiche.etape)} sur {nbEtapes} · {libelleEtape(fiche.etape)}</p><span>{pluriel(fiche.nbPlanches, 'planche')}</span></div>
                  <i className="fas fa-arrow-up-right-from-square accueil__carte-fleche" aria-hidden="true"></i>
                </button>
                <button onClick={() => demanderSuppression(fiche)} className="accueil__carte-supprimer">Supprimer</button>
              </article>)}
            </div>
          </section>}

          <footer className="accueil__pied">
            <div><h2>Un récit de plus ?</h2><p>Commencez avec un nouveau texte ou reprenez une sauvegarde exportée.</p><p className="accueil__stockage"><i className="fas fa-hard-drive" aria-hidden="true"></i> Vos récits sont enregistrés dans ce navigateur.</p></div>
            <div className="accueil__pied-actions"><ActionNouvelle onClick={onNouveau} /><button onClick={onImporter} className="accueil__bouton accueil__bouton--secondaire"><i className="fas fa-file-import" aria-hidden="true"></i> Importer un projet</button></div>
          </footer>
        </>
      ) : (
        <section className="accueil__vide" aria-labelledby="accueil-titre">
          <div className="accueil__vide-sceau" aria-hidden="true"><i className="fas fa-book-open"></i></div>
          <h1 id="accueil-titre">Du récit au livre illustré</h1>
          <p>Importez un roman ou une nouvelle. CharacGen en tire les personnages, les décors et les scènes, puis les illustre pour composer un livre.</p>
          <div className="accueil__vide-actions"><ActionNouvelle onClick={onNouveau} principale /><button onClick={onImporter} className="accueil__bouton accueil__bouton--secondaire"><i className="fas fa-file-import" aria-hidden="true"></i> Importer un projet</button></div>
          <RepereParcours onAide={onAide} />
          <p className="accueil__stockage"><i className="fas fa-hard-drive" aria-hidden="true"></i> Vos récits sont enregistrés dans ce navigateur.</p>
        </section>
      )}
    </main>
  );
};

export default Accueil;
