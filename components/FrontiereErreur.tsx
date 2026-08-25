// `Component` est importe nommement : avec l'import par defaut, TypeScript ne
// retrouve pas les membres d'instance (`this.props`, `this.state`) sous la
// configuration `moduleResolution: bundler` de ce projet.
import React, { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Dernier filet de sécurité de l'application.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * Une erreur pendant le rendu d'un composant React démonte tout l'arbre. Sans
 * frontière d'erreur, l'utilisateur ne voyait pas un message : il voyait une
 * page entièrement blanche, sans bouton, sans explication, et sans savoir que
 * son travail était toujours sauvegardé dans le navigateur. Une seule ligne
 * fautive dans une vignette suffisait.
 *
 * C'est écrit avec une classe et non un composant à fonction : React n'offre
 * aucun autre moyen d'attraper une erreur de rendu. `componentDidCatch` n'existe
 * pas sous forme de hook.
 */

interface Props {
  children: ReactNode;
}

interface State {
  erreur: Error | null;
}

class FrontiereErreur extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { erreur: null };
  }

  /** Appelée par React quand un composant enfant lève pendant son rendu. */
  static getDerivedStateFromError(erreur: Error): State {
    return { erreur };
  }

  componentDidCatch(erreur: Error, infos: ErrorInfo) {
    // La trace reste dans la console : c'est elle qui permet de corriger la cause.
    console.error('Erreur de rendu non rattrapée :', erreur, infos.componentStack);
  }

  private recharger() {
    window.location.reload();
  }

  render() {
    const { erreur } = this.state;
    if (!erreur) return this.props.children;

    return (
      <div className="min-h-screen bg-dark text-slate-200 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-surface border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-full bg-red-500/15 text-red-400 flex items-center justify-center shrink-0">
                <i className="fas fa-triangle-exclamation" aria-hidden="true"></i>
              </div>
              <div className="flex-1">
                <h1 className="font-heading font-bold text-white text-xl leading-tight mb-2">
                  L'affichage s'est interrompu
                </h1>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Un problème a empêché la page de se dessiner. Votre projet reste enregistré dans ce
                  navigateur : rechargez la page, puis utilisez « Restaurer la sauvegarde » dans le menu
                  Sauvegarder pour retrouver votre travail.
                </p>
              </div>
            </div>

            <details className="mt-5">
              <summary className="text-[11px] text-slate-400 hover:text-white cursor-pointer underline underline-offset-2">
                Voir le détail technique
              </summary>
              <p className="mt-2 text-[11px] font-mono text-slate-300 bg-black/40 rounded-lg p-3 break-words max-h-40 overflow-y-auto">
                {erreur.message || String(erreur)}
              </p>
            </details>
          </div>

          <div className="p-4 bg-white/5 border-t border-white/5 flex justify-end">
            <button
              onClick={() => this.recharger()}
              className="px-6 py-2.5 min-h-[44px] rounded-lg text-sm font-bold bg-primary hover:bg-primary-hover text-white shadow-lg transition"
            >
              Recharger la page
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default FrontiereErreur;
