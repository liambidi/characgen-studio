import React, { useEffect, useState, useRef } from 'react';
import {
  sAbonner,
  lireNotifications,
  lireConfirmation,
  fermerNotification,
  type Notification,
  type DemandeConfirmation,
} from '../services/notifications';

/** Icone et couleurs selon le type de message. */
const APPARENCE = {
  succes: { icone: 'fa-circle-check', texte: 'text-emerald-300', bord: 'border-emerald-500/40', fond: 'bg-emerald-950/90' },
  erreur: { icone: 'fa-circle-exclamation', texte: 'text-red-300', bord: 'border-red-500/40', fond: 'bg-red-950/90' },
  info: { icone: 'fa-circle-info', texte: 'text-sky-300', bord: 'border-sky-500/40', fond: 'bg-sky-950/90' },
} as const;

const Message: React.FC<{ notification: Notification }> = ({ notification }) => {
  const [detailOuvert, setDetailOuvert] = useState(false);
  const apparence = APPARENCE[notification.type];

  return (
    <div
      className={`${apparence.fond} ${apparence.bord} border rounded-xl shadow-2xl backdrop-blur-xl px-4 py-3 flex items-start gap-3 animate-fade-in pointer-events-auto`}
    >
      <i className={`fas ${apparence.icone} ${apparence.texte} mt-0.5 shrink-0`} aria-hidden="true"></i>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-white leading-snug">{notification.message}</p>

        {notification.detail && (
          <>
            <button
              onClick={() => setDetailOuvert((v) => !v)}
              className="text-[11px] text-slate-400 hover:text-white underline underline-offset-2 mt-1.5 transition"
            >
              {detailOuvert ? 'Masquer le détail' : 'Voir le détail technique'}
            </button>
            {detailOuvert && (
              <p className="mt-2 text-[11px] font-mono text-slate-300 bg-black/40 rounded-lg p-2 break-words max-h-40 overflow-y-auto">
                {notification.detail}
              </p>
            )}
          </>
        )}
      </div>

      <button
        onClick={() => fermerNotification(notification.id)}
        className="text-slate-400 hover:text-white transition shrink-0 w-11 h-11 -m-2 flex items-center justify-center rounded-lg"
        aria-label="Fermer ce message"
      >
        <i className="fas fa-times text-xs" aria-hidden="true"></i>
      </button>
    </div>
  );
};

const FenetreConfirmation: React.FC<{ demande: DemandeConfirmation }> = ({ demande }) => {
  const boutonRef = useRef<HTMLButtonElement>(null);

  // La touche Echap annule, et le focus arrive directement sur le bouton principal.
  useEffect(() => {
    boutonRef.current?.focus();
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape') demande.resoudre(false);
    };
    window.addEventListener('keydown', auClavier);
    return () => window.removeEventListener('keydown', auClavier);
  }, [demande]);

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[120] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titre-confirmation"
    >
      <div className="bg-surface border border-white/10 rounded-2xl w-full max-w-md shadow-2xl animate-fade-in overflow-hidden">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div
              className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${
                demande.dangereux ? 'bg-red-500/15 text-red-400' : 'bg-primary/15 text-primary'
              }`}
            >
              <i className={`fas ${demande.dangereux ? 'fa-triangle-exclamation' : 'fa-circle-question'}`} aria-hidden="true"></i>
            </div>
            <div className="flex-1">
              <h3 id="titre-confirmation" className="font-heading font-bold text-white text-lg leading-tight mb-2">
                {demande.titre}
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed">{demande.message}</p>
            </div>
          </div>
        </div>

        <div className="p-4 bg-white/5 border-t border-white/5 flex justify-end gap-3">
          <button
            onClick={() => demande.resoudre(false)}
            className="px-5 py-2.5 min-h-[44px] text-slate-300 hover:text-white hover:bg-white/5 rounded-lg text-sm font-medium transition"
          >
            {demande.libelleAnnuler}
          </button>
          <button
            ref={boutonRef}
            onClick={() => demande.resoudre(true)}
            className={`px-6 py-2.5 min-h-[44px] rounded-lg text-sm font-bold shadow-lg transition text-white ${
              demande.dangereux ? 'bg-red-600 hover:bg-red-500' : 'bg-primary hover:bg-primary-hover'
            }`}
          >
            {demande.libelleConfirmer}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Monte une seule fois dans l'application. Affiche la pile de notifications
 * et la fenetre de confirmation quand il y en a une.
 */
const CentreNotifications: React.FC = () => {
  const [, forcerRendu] = useState(0);

  useEffect(() => sAbonner(() => forcerRendu((n) => n + 1)), []);

  const notifications = lireNotifications();
  const confirmation = lireConfirmation();

  return (
    <>
      <div
        className="fixed top-20 right-4 sm:right-6 z-[110] flex flex-col gap-3 w-[min(24rem,calc(100vw-2rem))] pointer-events-none print:hidden"
        role="status"
        aria-live="polite"
      >
        {notifications.map((n) => (
          <Message key={n.id} notification={n} />
        ))}
      </div>

      {confirmation && <FenetreConfirmation demande={confirmation} />}
    </>
  );
};

export default CentreNotifications;
