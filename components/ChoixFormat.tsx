import React from 'react';
import { BookFormat, Cadrage } from '../types';
import {
  LIBELLE_CADRAGE,
  LIBELLE_RESOLUTION,
  ecartDeCadrage,
  ratioDeLaPage,
  ratioPourCadrage,
  valeurDuRatio,
} from '../services/formats';

/**
 * Choix du format du livre et du cadrage des illustrations.
 *
 * CE QUI NE MARCHAIT PAS
 *
 * Le choix vivait tout en bas de l'ecran des scenes, en dix boutons minuscules
 * portant chacun une icone decorative, sans la moindre indication de ce que le
 * format allait changer. Or il arrivait trop tard : les decors sont generes
 * deux ecrans plus tot, donc toujours en 4:3, quel que soit le format choisi
 * ensuite. Et quatre de ces dix boutons produisaient exactement la meme image.
 *
 * CE QUI CHANGE
 *
 * Le format et le cadrage sont deux reglages distincts, chacun montre ce qu'il
 * fait : le rectangle plein est l'illustration, le rectangle en pointille est
 * la page. Quand les deux ne coincident pas, l'ecart est chiffre au lieu d'etre
 * tu. Le composant est pose avant la generation des decors, et reste
 * accessible ensuite.
 */

type Resolution = '1K' | '2K' | '4K';

interface ChoixFormatProps {
  formats: BookFormat[];
  formatId: string;
  cadrage: Cadrage;
  resolution: Resolution;
  onFormatChange: (id: string) => void;
  onCadrageChange: (cadrage: Cadrage) => void;
  onResolutionChange: (resolution: Resolution) => void;
  /**
   * Nombre d'images deja produites. Sert a prevenir : changer le format
   * maintenant ne les reprend pas, elles garderont leur cadrage.
   */
  imagesDejaGenerees?: number;
  /** Titre de la carte, pour dire pourquoi le reglage apparait a cet endroit. */
  titre?: string;
  sousTitre?: string;
}

const CADRAGES: Cadrage[] = ['pleine-page', 'portrait', 'carre', 'paysage'];
const RESOLUTIONS: Resolution[] = ['1K', '2K', '4K'];

/**
 * Dessine la page et l'illustration l'une dans l'autre, a l'echelle.
 *
 * C'est la seule facon de rendre visible ce qu'aucun libelle ne disait : que
 * l'image demandee n'a pas tout a fait la proportion de la page.
 */
const Apercu: React.FC<{ format: BookFormat; cadrage: Cadrage; hauteur?: number }> = ({
  format,
  cadrage,
  hauteur = 40,
}) => {
  const page = ratioDeLaPage(format);
  const image = valeurDuRatio(ratioPourCadrage(format, cadrage));

  return (
    <div
      className="flex items-center justify-center shrink-0"
      style={{ height: hauteur, width: hauteur * 1.5 }}
      aria-hidden="true"
    >
      <div
        className="relative flex items-center justify-center border border-dashed border-slate-400/50"
        style={{
          aspectRatio: `${format.largeurMm} / ${format.hauteurMm}`,
          ...(page >= 1 ? { width: '100%' } : { height: '100%' }),
        }}
      >
        <div
          className="bg-primary/70 border border-primary"
          style={{
            aspectRatio: String(image),
            ...(image >= page ? { width: '100%' } : { height: '100%' }),
          }}
        ></div>
      </div>
    </div>
  );
};

const ChoixFormat: React.FC<ChoixFormatProps> = ({
  formats,
  formatId,
  cadrage,
  resolution,
  onFormatChange,
  onCadrageChange,
  onResolutionChange,
  imagesDejaGenerees = 0,
  titre = 'Format du livre',
  sousTitre = "Ce reglage decide de la page du PDF et de la proportion de toutes les illustrations. Il vaut mieux le fixer avant de generer quoi que ce soit.",
}) => {
  const familles: Array<{ cle: BookFormat['famille']; libelle: string }> = [
    { cle: 'portrait', libelle: 'Portrait' },
    { cle: 'paysage', libelle: 'Paysage, à l\'italienne' },
  ];

  const formatChoisi = formats.find((f) => f.id === formatId) || formats[0];
  const ecart = ecartDeCadrage(formatChoisi, cadrage);
  const ratioDemande = ratioPourCadrage(formatChoisi, cadrage);

  return (
    <section className="bg-surface border border-white/5 rounded-2xl p-6 sm:p-8 flex flex-col gap-7">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-bold text-white font-heading flex items-center gap-2">
          <i className="fas fa-book-open text-primary" aria-hidden="true"></i> {titre}
        </h3>
        <p className="text-sm text-slate-400 max-w-2xl">{sousTitre}</p>
      </div>

      {/* --- La page ------------------------------------------------------ */}
      <div className="flex flex-col gap-3">
        <p className="text-[11px] uppercase tracking-widest text-slate-500 font-mono">
          1. La page imprimée
        </p>

        {familles.map((famille) => {
          const dedans = formats.filter((f) => f.famille === famille.cle);
          if (dedans.length === 0) return null;

          return (
            <div key={famille.cle} className="flex flex-col gap-2">
              <p className="text-xs text-slate-500">{famille.libelle}</p>
              <div
                role="radiogroup"
                aria-label={`Format ${famille.libelle}`}
                className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2"
              >
                {dedans.map((f) => {
                  const actif = f.id === formatId;
                  const ecartFormat = ecartDeCadrage(f, cadrage);

                  return (
                    <button
                      key={f.id}
                      type="button"
                      role="radio"
                      aria-checked={actif}
                      onClick={() => onFormatChange(f.id)}
                      className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-colors duration-200
                        ${actif
                          ? 'bg-primary/15 border-primary text-white'
                          : 'bg-black/20 border-white/5 text-slate-300 hover:border-white/25 hover:text-white'}`}
                    >
                      <Apercu format={f} cadrage={cadrage} />
                      <span className="flex flex-col min-w-0">
                        <span className="text-sm font-semibold leading-tight truncate">{f.nom}</span>
                        <span className="text-[11px] text-slate-400 font-mono">{f.dimensions}</span>
                        <span className="text-[11px] text-slate-500 font-mono">
                          {ecartFormat < 0.5
                            ? 'proportion exacte'
                            : `recadrage ${ecartFormat.toFixed(0)} %`}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* --- Le cadrage --------------------------------------------------- */}
      <div className="flex flex-col gap-3">
        <p className="text-[11px] uppercase tracking-widest text-slate-500 font-mono">
          2. Ce que l'illustration occupe
        </p>
        <div role="radiogroup" aria-label="Cadrage de l'illustration" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
          {CADRAGES.map((c) => {
            const actif = c === cadrage;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={actif}
                onClick={() => onCadrageChange(c)}
                className={`flex flex-col gap-1 p-3 rounded-xl border text-left transition-colors duration-200
                  ${actif
                    ? 'bg-primary/15 border-primary text-white'
                    : 'bg-black/20 border-white/5 text-slate-300 hover:border-white/25 hover:text-white'}`}
              >
                <span className="text-sm font-semibold">{LIBELLE_CADRAGE[c].titre}</span>
                <span className="text-[11px] text-slate-400 leading-snug">{LIBELLE_CADRAGE[c].explication}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* --- La résolution ------------------------------------------------ */}
      <div className="flex flex-col gap-3">
        <p className="text-[11px] uppercase tracking-widest text-slate-500 font-mono">
          3. La finesse des images
        </p>
        <div role="radiogroup" aria-label="Résolution des images" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {RESOLUTIONS.map((r) => {
            const actif = r === resolution;
            return (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={actif}
                onClick={() => onResolutionChange(r)}
                className={`flex flex-col gap-1 p-3 rounded-xl border text-left transition-colors duration-200
                  ${actif
                    ? 'bg-primary/15 border-primary text-white'
                    : 'bg-black/20 border-white/5 text-slate-300 hover:border-white/25 hover:text-white'}`}
              >
                <span className="text-sm font-semibold font-mono">{LIBELLE_RESOLUTION[r].titre}</span>
                <span className="text-[11px] text-slate-400 leading-snug">{LIBELLE_RESOLUTION[r].explication}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* --- Ce que ça donne, dit en toutes lettres ------------------------ */}
      <div className="flex flex-col gap-2 border-t border-white/5 pt-5">
        <p className="text-sm text-slate-300">
          Page de <span className="font-mono text-white">{formatChoisi.dimensions}</span>, illustrations
          demandées en <span className="font-mono text-white">{ratioDemande}</span> et{' '}
          <span className="font-mono text-white">{resolution}</span>.
          {ecart < 0.5
            ? ' La proportion tombe juste, rien ne sera rogné.'
            : ` L'écart avec la page est de ${ecart.toFixed(0)} %, le PDF rognera ou laissera cette marge.`}
        </p>
        <p className="text-[11px] text-slate-500">
          Gemini n'accepte qu'une liste fermée de proportions. CharacGen retient la plus proche de
          votre page, et affiche l'écart plutôt que de le passer sous silence.
        </p>

        {imagesDejaGenerees > 0 && (
          <p role="status" className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2 mt-1">
            <i className="fas fa-triangle-exclamation mr-2" aria-hidden="true"></i>
            {imagesDejaGenerees} image{imagesDejaGenerees > 1 ? 's ont' : ' a'} déjà été générée
            {imagesDejaGenerees > 1 ? 's' : ''}. Changer ce réglage maintenant ne{' '}
            {imagesDejaGenerees > 1 ? 'les' : 'la'} reprend pas : {imagesDejaGenerees > 1 ? 'elles garderont' : 'elle gardera'}{' '}
            l'ancien cadrage. Relancez-{imagesDejaGenerees > 1 ? 'les' : 'la'} une par une si besoin.
          </p>
        )}
      </div>
    </section>
  );
};

export default ChoixFormat;
