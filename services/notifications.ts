/**
 * Petit centre de notifications maison.
 *
 * Il remplace les 25 appels a alert() qui bloquaient la page, ne ressemblaient
 * pas au reste de l'interface et n'etaient pas lisibles par un lecteur d'ecran.
 *
 * Deux usages :
 *   notifier("Projet sauvegarde")             pour informer sans interrompre
 *   await confirmer("Ecraser le projet ?")    pour demander une decision
 */

export type TypeNotification = "succes" | "erreur" | "info";

export interface Notification {
  id: string;
  type: TypeNotification;
  message: string;
  /** Detail technique repliable, pour les erreurs. */
  detail?: string;
}

export interface DemandeConfirmation {
  id: string;
  titre: string;
  message: string;
  libelleConfirmer: string;
  libelleAnnuler: string;
  dangereux: boolean;
  resoudre: (accepte: boolean) => void;
}

type Ecouteur = () => void;

const ecouteurs = new Set<Ecouteur>();
let notifications: Notification[] = [];
let confirmation: DemandeConfirmation | null = null;

const prevenir = () => ecouteurs.forEach((e) => e());

const identifiant = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const sAbonner = (ecouteur: Ecouteur): (() => void) => {
  ecouteurs.add(ecouteur);
  return () => ecouteurs.delete(ecouteur);
};

export const lireNotifications = (): Notification[] => notifications;
export const lireConfirmation = (): DemandeConfirmation | null => confirmation;

/** Affiche un message passager en haut a droite. */
export const notifier = (message: string, type: TypeNotification = "succes", detail?: string): string => {
  const id = identifiant();
  notifications = [...notifications, { id, type, message, detail }];
  prevenir();

  // Les erreurs restent plus longtemps : il y a quelque chose a lire.
  const duree = type === "erreur" ? 9000 : 4000;
  setTimeout(() => fermerNotification(id), duree);
  return id;
};

/** Raccourci pour signaler un echec, avec le detail technique conserve. */
export const notifierErreur = (message: string, erreur?: unknown): string => {
  const detail = erreur instanceof Error ? erreur.message : erreur ? String(erreur) : undefined;
  // Quand le serveur renvoie deja une phrase claire, inutile de la repeter en dessous.
  const detailUtile = detail && detail !== message ? detail : undefined;
  console.error(message, erreur);
  return notifier(message, "erreur", detailUtile);
};

export const fermerNotification = (id: string) => {
  const avant = notifications.length;
  notifications = notifications.filter((n) => n.id !== id);
  if (notifications.length !== avant) prevenir();
};

/**
 * Demande une confirmation et attend la reponse.
 * Remplace window.confirm, qui gelait la page entiere.
 */
export const confirmer = (
  titre: string,
  message: string,
  options: { libelleConfirmer?: string; libelleAnnuler?: string; dangereux?: boolean } = {}
): Promise<boolean> => {
  return new Promise((resolve) => {
    confirmation = {
      id: identifiant(),
      titre,
      message,
      libelleConfirmer: options.libelleConfirmer || "Confirmer",
      libelleAnnuler: options.libelleAnnuler || "Annuler",
      dangereux: options.dangereux ?? false,
      resoudre: (accepte: boolean) => {
        confirmation = null;
        prevenir();
        resolve(accepte);
      },
    };
    prevenir();
  });
};
