import React, { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
    saveProjectLocal,
    loadProjectLocal,
    hasLocalSave,
    supprimerSauvegardeLocale,
    exportProjectToJSON,
    importProjectFromJSON,
    exportAssetsToZip,
    mesurerEspace,
    formaterOctets,
    estimerPoidsProjet,
    type EspaceDisque
} from './services/dataService';
import { notifier, notifierErreur, confirmer } from './services/notifications';

import FileUpload from './components/FileUpload';
import CharacterReview from './components/CharacterReview';
import EnvironmentReview from './components/EnvironmentReview';
import Gallery from './components/Gallery';
import SceneReview from './components/SceneReview';
import SceneGallery from './components/SceneGallery';
import BookViewer from './components/BookViewer';
import HelpModal from './components/HelpModal';
import OnboardingTour from './components/OnboardingTour';
import AnalysisConfigModal from './components/AnalysisConfigModal';
import ChatAssistant from './components/ChatAssistant';
import ImageEditorModal from './components/ImageEditorModal';
import CentreNotifications from './components/CentreNotifications';

import { AppStep, Character, Environment, Scene, AnalysisResult, GenConfig, BookFormat } from './types';
import { extractTextFromFile } from './services/pdfService';
import {
  analyzeStory,
  generateCharacterImage,
  generateEnvironmentImage,
  analyzeScenes,
  generateSceneImage,
  regenerateCharacterDescription,
  createCharacterFromPrompt,
  findMissingCharacters,
  createSceneFromPrompt,
  findMissingScenes,
  findMissingEnvironments,
  createEnvironmentFromPrompt
} from './services/geminiService';

/**
 * Formats de livre proposés. Les dimensions en millimètres servent à fabriquer
 * un PDF au bon format : auparavant, le choix ne changeait que les proportions
 * des images et l'export restait bloqué en A4 portrait.
 */
export const BOOK_FORMATS: BookFormat[] = [
    { id: 'a4_p', label: 'Format A4 (21 x 29.7 cm)', ratio: '3:4', orientation: 'Portrait', icon: 'fa-file', largeurMm: 210, hauteurMm: 297 },
    { id: 'moyen_p', label: 'Format Moyen (16 x 24 cm)', ratio: '3:4', orientation: 'Portrait', icon: 'fa-book', largeurMm: 160, hauteurMm: 240 },
    { id: 'a5_p', label: 'Format Roman / A5 (15 x 21 cm)', ratio: '3:4', orientation: 'Portrait', icon: 'fa-book-open', largeurMm: 150, hauteurMm: 210 },
    { id: 'digest_p', label: 'Format Digest (14 x 21.6 cm)', ratio: '3:4', orientation: 'Portrait', icon: 'fa-passport', largeurMm: 140, hauteurMm: 216 },
    { id: 'poche_p', label: 'Livre de Poche (11 x 18 cm)', ratio: '9:16', orientation: 'Portrait', icon: 'fa-mobile-alt', largeurMm: 110, hauteurMm: 180 },
    { id: 'a4_l', label: 'A4 à l\'italienne (29.7 x 21 cm)', ratio: '4:3', orientation: 'Paysage', icon: 'fa-image', largeurMm: 297, hauteurMm: 210 },
    { id: 'moyen_l', label: 'Moyen à l\'italienne (24 x 16 cm)', ratio: '4:3', orientation: 'Paysage', icon: 'fa-image', largeurMm: 240, hauteurMm: 160 },
    { id: 'a5_l', label: 'Roman / A5 à l\'italienne (21 x 15 cm)', ratio: '4:3', orientation: 'Paysage', icon: 'fa-image', largeurMm: 210, hauteurMm: 150 },
    { id: 'digest_l', label: 'Digest à l\'italienne (21.6 x 14 cm)', ratio: '4:3', orientation: 'Paysage', icon: 'fa-image', largeurMm: 216, hauteurMm: 140 },
    { id: 'poche_l', label: 'Poche à l\'italienne (18 x 11 cm)', ratio: '16:9', orientation: 'Paysage', icon: 'fa-tv', largeurMm: 180, hauteurMm: 110 },
];

/** Message d'erreur lisible, quelle que soit la forme de l'exception. */
const messageDe = (e: unknown): string =>
    e instanceof Error ? e.message : typeof e === 'string' ? e : 'Erreur inconnue';

/** Ce qu'une sauvegarde enregistre, sans la date, ajoutée au moment de l'écriture. */
type ProjetASauvegarder = Parameters<typeof saveProjectLocal>[0];

/**
 * Nombre d'images générées de front.
 *
 * Les générations se faisaient strictement une par une : la boucle attendait la
 * fin de chaque image avant de lancer la suivante. Une image demande couramment
 * vingt secondes, ce qui faisait plus de dix minutes d'attente pour un projet de
 * trente illustrations, l'onglet devant rester ouvert du début à la fin.
 *
 * Trois, et pas davantage : le frein du serveur accepte trente requêtes par
 * minute, mais chaque image occupe aussi de la mémoire dans le navigateur, et
 * une rafale trop large ferait tomber le quota Google d'un coup, transformant
 * un ralentissement en série d'échecs.
 */
const GENERATIONS_SIMULTANEES = 3;

/**
 * Fait passer une liste dans une file à plusieurs voies.
 *
 * Chaque voie prend l'élément suivant dès qu'elle est libre, plutôt que de
 * traiter la liste par paquets : une image lente ne fait donc pas attendre
 * celles qui la suivent. Le travail s'arrête dès que `doitSArreter` répond oui,
 * ce qui rend le bouton « Arrêter » aussi réactif qu'avant.
 */
const traiterEnParallele = async <T,>(
  elements: T[],
  voies: number,
  traiter: (element: T) => Promise<void>,
  doitSArreter: () => boolean
): Promise<void> => {
  let prochain = 0;

  const uneVoie = async () => {
    while (!doitSArreter()) {
      const index = prochain++;
      if (index >= elements.length) return;
      await traiter(elements[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(voies, elements.length) }, uneVoie));
};

/** Délai d'inactivité avant d'enregistrer automatiquement. */
const DELAI_SAUVEGARDE_MS = 1_500;
/** Le même, pendant une génération : l'état change à chaque image terminée. */
const DELAI_SAUVEGARDE_GENERATION_MS = 8_000;

const App: React.FC = () => {
  const [step, setStep] = useState<AppStep>(AppStep.UPLOAD);
  const [titre, setTitre] = useState<string>("");
  const [fullText, setFullText] = useState<string>("");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [stylePrompt, setStylePrompt] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Etape en cours de l'analyse, alimentee par la fonction d'arriere-plan.
  const [progression, setProgression] = useState<string>("");

  const [genConfig, setGenConfig] = useState<GenConfig>({ resolution: '1K', aspectRatio: '4:3' });
  const [currentFormatId, setCurrentFormatId] = useState<string>('a4_l');

  const [showHelpModal, setShowHelpModal] = useState(false);
  const [hasLocal, setHasLocal] = useState(false);
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const [espace, setEspace] = useState<EspaceDisque | null>(null);
  const [sauvegardeAuto, setSauvegardeAuto] = useState<'inactive' | 'en-cours' | 'faite'>('inactive');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuSauvegardeRef = useRef<HTMLDivElement>(null);

  const [editingImage, setEditingImage] = useState<{url: string, type: 'char' | 'scene' | 'env', id: string} | null>(null);
  const [showSceneAnalysisConfig, setShowSceneAnalysisConfig] = useState(false);

  // Génération en cours : permet de tout arrêter proprement sans fermer l'onglet.
  const [generationEnCours, setGenerationEnCours] = useState(false);
  const arretDemandeRef = useRef(false);
  const controleurRef = useRef<AbortController | null>(null);
  /**
   * Suivi du decoupage en scenes pendant qu'il arrive au fil de l'eau.
   *
   * `scenesArrivees` compte ce qui a deja ete ajoute, et `idsScenesArrivees`
   * retient quel identifiant a ete donne a la scene de chaque rang. Le second
   * sert a rendre son passage du recit a la bonne scene une fois le travail
   * fini, meme si l'utilisateur a reordonne la liste entre temps.
   */
  const scenesArrivees = useRef(0);
  const idsScenesArrivees = useRef<string[]>([]);

  /**
   * Rend le contrôleur d'annulation, mais seulement s'il est encore le nôtre.
   *
   * Le champ était remis à null sans condition en fin d'opération. Relancer une
   * vignette pendant une génération de série suffisait donc à faire perdre au
   * bouton « Arrêter » la requête qu'il devait interrompre : le clic marquait
   * bien l'arrêt, mais l'image en cours continuait jusqu'au bout.
   */
  const relacherControleur = useCallback((controleur: AbortController) => {
      if (controleurRef.current === controleur) controleurRef.current = null;
  }, []);


  const format = BOOK_FORMATS.find(f => f.id === currentFormatId) || BOOK_FORMATS[0];

  useEffect(() => {
    hasLocalSave().then(setHasLocal).catch(() => setHasLocal(false));
    mesurerEspace().then(setEspace).catch(() => setEspace(null));
  }, []);

  // --- Sauvegarde automatique -------------------------------------------------
  // Le travail était perdu au moindre rechargement : plus rien n'était enregistré
  // pendant les quinze minutes que dure une génération complète.

  const projetVide = step === AppStep.UPLOAD && characters.length === 0 && scenes.length === 0;

  // Photographie du projet, tenue à jour après chaque rendu. L'écriture s'en sert
  // au lieu de capturer les variables : elle repart ainsi toujours de l'état le
  // plus récent, même si elle a été mise en attente.
  const projetRef = useRef<ProjetASauvegarder | null>(null);
  useEffect(() => {
    projetRef.current = { titre, characters, environments, scenes, stylePrompt, fullText, currentStep: step, formatId: currentFormatId };
  });

  // Verrou d'écriture. Une sauvegarde recopie TOUT le projet, images comprises,
  // ce qui représente plusieurs dizaines de mégaoctets en fin de parcours. Sans
  // ce verrou, une génération qui enchaîne les images empilait autant d'écritures
  // concurrentes dans IndexedDB, chacune plus lourde que la précédente.
  const ecritureEnCoursRef = useRef(false);
  const ecritureADemanderRef = useRef(false);

  const enregistrerProjet = useCallback(async () => {
    if (ecritureEnCoursRef.current) {
      // Une écriture tourne déjà : elle reprendra la photographie à jour en sortant.
      ecritureADemanderRef.current = true;
      return;
    }

    ecritureEnCoursRef.current = true;
    try {
      do {
        ecritureADemanderRef.current = false;
        const instantane = projetRef.current;
        if (!instantane) break;
        await saveProjectLocal(instantane);
      } while (ecritureADemanderRef.current);

      setHasLocal(true);
      setSauvegardeAuto('faite');
      mesurerEspace().then(setEspace).catch(() => {});
    } catch (e) {
      setSauvegardeAuto('inactive');
      console.error("Sauvegarde automatique impossible", e);
    } finally {
      ecritureEnCoursRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (projetVide) return;

    setSauvegardeAuto('en-cours');
    // Pendant une génération, l'état change à chaque image terminée. On espace
    // alors les écritures : le travail est de toute façon repris en entier à
    // chaque fois, et rien ne serait perdu entre deux images.
    const delai = generationEnCours ? DELAI_SAUVEGARDE_GENERATION_MS : DELAI_SAUVEGARDE_MS;
    const minuterie = setTimeout(() => { void enregistrerProjet(); }, delai);

    return () => clearTimeout(minuterie);
  }, [titre, characters, environments, scenes, stylePrompt, fullText, step, currentFormatId, projetVide, generationEnCours, enregistrerProjet]);

  // Filet de sécurité : prévenir avant de fermer pendant une génération.
  useEffect(() => {
    if (!generationEnCours) return;
    const avantFermeture = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', avantFermeture);
    return () => window.removeEventListener('beforeunload', avantFermeture);
  }, [generationEnCours]);

  // Fermeture du menu de sauvegarde à la touche Échap et au clic extérieur.
  useEffect(() => {
    if (!showSaveMenu) return;
    const auClavier = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowSaveMenu(false); };
    const auClic = (e: MouseEvent) => {
      if (menuSauvegardeRef.current && !menuSauvegardeRef.current.contains(e.target as Node)) setShowSaveMenu(false);
    };
    window.addEventListener('keydown', auClavier);
    window.addEventListener('mousedown', auClic);
    return () => { window.removeEventListener('keydown', auClavier); window.removeEventListener('mousedown', auClic); };
  }, [showSaveMenu]);

  const handleFormatChange = (formatId: string) => {
      const f = BOOK_FORMATS.find(item => item.id === formatId);
      if (f) {
          setCurrentFormatId(formatId);
          setGenConfig(prev => ({ ...prev, aspectRatio: f.ratio }));
      }
  };

  // --- Sauvegarde et fichiers -------------------------------------------------

  const handleSaveLocal = async () => {
    if (projetVide) { notifier("Il n'y a rien à sauvegarder pour l'instant.", 'info'); return; }
    try {
        await saveProjectLocal({ titre, characters, environments, scenes, stylePrompt, fullText, currentStep: step, formatId: currentFormatId });
        setHasLocal(true);
        notifier("Projet sauvegardé dans ce navigateur.");
        setShowSaveMenu(false);
    } catch (e) {
        notifierErreur("Sauvegarde impossible.", e);
    }
  };

  const handleExportJSON = async () => {
      if (projetVide) { notifier("Il n'y a rien à exporter pour l'instant.", 'info'); return; }
      try {
        await exportProjectToJSON({ titre, characters, environments, scenes, stylePrompt, fullText, currentStep: step, formatId: currentFormatId });
        const poids = estimerPoidsProjet(characters, environments, scenes, fullText);
        notifier(`Fichier projet téléchargé (${formaterOctets(poids)} environ).`);
        setShowSaveMenu(false);
      } catch (e) {
        notifierErreur("Export impossible.", e);
      }
  };

  const handleExportZIP = async () => {
      if (projetVide) { notifier("Il n'y a rien à télécharger pour l'instant.", 'info'); return; }
      setLoading(true);
      try {
        await exportAssetsToZip(characters, environments, scenes, titre);
        notifier("Images téléchargées au format ZIP.");
        setShowSaveMenu(false);
      } catch (e) {
        notifierErreur("Téléchargement impossible.", e);
      } finally {
        setLoading(false);
      }
  };

  const handleImportClick = () => {
      fileInputRef.current?.click();
      setShowSaveMenu(false);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!projetVide) {
          const remplacer = await confirmer(
              "Remplacer le projet en cours ?",
              "Le projet actuellement ouvert sera remplacé par le contenu du fichier. Pensez à l'exporter d'abord si vous voulez le conserver.",
              { libelleConfirmer: "Remplacer", dangereux: true }
          );
          if (!remplacer) { if (fileInputRef.current) fileInputRef.current.value = ""; return; }
      }

      setLoading(true);
      try {
          const data = await importProjectFromJSON(file);
          setTitre(data.titre || "");
          setCharacters(data.characters || []);
          setScenes(data.scenes || []);
          setEnvironments(data.environments || []);
          setStylePrompt(data.stylePrompt || "");
          setFullText(data.fullText || "");
          if (data.formatId) handleFormatChange(data.formatId);
          setStep(data.currentStep ?? AppStep.REVIEW_CHARS);
          notifier("Projet importé.");
      } catch (err) {
          notifierErreur("Import impossible.", err);
      } finally {
          setLoading(false);
          if (fileInputRef.current) fileInputRef.current.value = "";
      }
  };

  const handleLoadLocal = async () => {
      if (!projetVide) {
          const ecraser = await confirmer(
              "Restaurer la sauvegarde ?",
              "Le projet en cours sera remplacé par la dernière sauvegarde de ce navigateur.",
              { libelleConfirmer: "Restaurer", dangereux: true }
          );
          if (!ecraser) return;
      }
      try {
        setLoading(true);
        const data = await loadProjectLocal();
        if (data) {
            setTitre(data.titre || "");
            setCharacters(data.characters || []);
            setScenes(data.scenes || []);
            setEnvironments(data.environments || []);
            setStylePrompt(data.stylePrompt || "");
            setFullText(data.fullText || "");
            if (data.formatId) handleFormatChange(data.formatId);
            setStep(data.currentStep ?? AppStep.REVIEW_CHARS);
            notifier("Sauvegarde restaurée.");
        } else {
            notifier("Aucune sauvegarde trouvée dans ce navigateur.", 'info');
        }
      } catch (e) {
        notifierErreur("Restauration impossible.", e);
      } finally {
        setLoading(false);
      }
      setShowSaveMenu(false);
  };

  /** Repart de zéro, après confirmation. Remplace les boutons qui ne faisaient rien. */
  const handleRestart = async () => {
      const confirme = await confirmer(
          "Commencer un nouveau projet ?",
          "Les personnages, décors et illustrations générés seront effacés de cet écran. Exportez-les d'abord si vous voulez les garder.",
          { libelleConfirmer: "Tout effacer", dangereux: true }
      );
      if (!confirme) return;

      arreterGeneration();
      setTitre("");
      setFullText("");
      setCharacters([]);
      setEnvironments([]);
      setScenes([]);
      setStylePrompt("");
      setError(null);
      setStep(AppStep.UPLOAD);
      await supprimerSauvegardeLocale().catch(() => {});
      setHasLocal(false);
      notifier("Nouveau projet.", 'info');
  };

  // --- Import du récit --------------------------------------------------------

  // `octets` a deja ete lu par la verification d'import : on ne relit pas le
  // fichier, qui peut avoir change d'etat entre-temps.
  const handleFileSelect = async (file: File, octets: Uint8Array) => {
    try {
      setLoading(true);
      setError(null);
      const text = await extractTextFromFile(file, octets);
      if (!text || text.trim().length < 50) throw new Error("Le texte extrait est trop court. Vérifiez que le PDF contient bien du texte et non des images scannées.");

      // Le nom du fichier sert de titre de départ, modifiable ensuite.
      const titreDeduit = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      setTitre(titreDeduit);
      setFullText(text);
      // Volontairement non attendu : l'analyse gère son propre indicateur de
      // chargement et ses propres erreurs, et peut durer plusieurs minutes.
      void handleStartAnalysis(null, text);
    } catch (err) {
      setError(messageDe(err));
      notifierErreur("Lecture du fichier impossible.", err);
      setLoading(false);
    }
  };

  const handleStartAnalysis = async (count: number | null, textOverride?: string) => {
    const textToAnalyze = textOverride || fullText;
    setLoading(true);
    setError(null);
    setProgression("");
    setStep(AppStep.ANALYZING);

    const controleur = new AbortController();
    controleurRef.current = controleur;

    try {
      const analysis: AnalysisResult = await analyzeStory(
        textToAnalyze,
        count || undefined,
        controleur.signal,
        setProgression
      );

      const persos = (analysis.characters || []).map(c => ({...c, id: uuidv4(), status: 'pending' as const}));
      const decors = (analysis.environments || []).map(e => ({...e, id: uuidv4(), status: 'pending' as const}));

      setCharacters(persos);
      setEnvironments(decors);
      setStylePrompt(analysis.suggestedStyle || "Concept art réaliste");
      setStep(AppStep.REVIEW_CHARS);
      notifier(`${persos.length} personnages et ${decors.length} décors détectés.`);
    } catch (err) {
      if ((err as any)?.name === 'AbortError') { setStep(AppStep.UPLOAD); return; }
      setError(messageDe(err));
      notifierErreur("L'analyse du récit a échoué.", err);
      setStep(AppStep.UPLOAD);
    } finally {
      setLoading(false);
      setProgression("");
      relacherControleur(controleur);
    }
  };

  // --- Personnages ------------------------------------------------------------

  /**
   * Supprime un personnage, après confirmation.
   *
   * Remplacer un projet, restaurer une sauvegarde et repartir de zéro demandaient
   * tous confirmation ; supprimer une fiche ne demandait rien, et emportait
   * pourtant l'image déjà générée avec elle. Le bouton est une petite croix qui
   * apparaît au survol, juste à côté du crayon.
   */
  const handleRemoveCharacter = async (id: string) => {
      const perso = characters.find(c => c.id === id);
      if (!perso) return;

      const avecImage = Boolean(perso.imageUrl);
      const confirme = await confirmer(
          `Supprimer « ${perso.name} » ?`,
          avecImage
              ? "Sa fiche et l'illustration déjà générée seront effacées. Cette action ne peut pas être annulée."
              : "Sa fiche sera effacée. Cette action ne peut pas être annulée.",
          { libelleConfirmer: "Supprimer", dangereux: true }
      );
      if (!confirme) return;

      setCharacters(prev => prev.filter(c => c.id !== id));
      notifier(`Personnage « ${perso.name} » supprimé.`, 'info');
  };
  const handleUpdateCharacter = (id: string, data: Partial<Character>) => setCharacters(prev => prev.map(c => c.id === id ? { ...c, ...data } : c));

  const handleAddCharacter = async (method: 'manual'|'ai', data: any) => {
      setLoading(true);
      try {
          const nouveau: Character = method === 'manual'
              ? { ...data, id: uuidv4(), status: 'pending' }
              : { ...(await createCharacterFromPrompt(data.prompt)), id: uuidv4(), status: 'pending' };
          setCharacters(prev => [...prev, nouveau]);
          notifier(`Personnage « ${nouveau.name} » ajouté.`);
      } catch (e) {
          notifierErreur("Ajout du personnage impossible.", e);
      } finally {
          setLoading(false);
      }
  };

  const handleRegenerateCharacterText = async (_id: string, name: string) => await regenerateCharacterDescription(fullText, name);

  const handleFindMoreCharacters = async (count?: number, hints?: string) => {
      setLoading(true);
      try {
          const nouveaux = await findMissingCharacters(fullText, characters.map(c => c.name), count, hints);
          const ajoutes: Character[] = nouveaux.map((c: any) => ({ ...c, id: uuidv4(), status: 'pending' }));
          setCharacters(prev => [...prev, ...ajoutes]);
          notifier(ajoutes.length > 0
              ? `${ajoutes.length} personnage${ajoutes.length > 1 ? 's' : ''} trouvé${ajoutes.length > 1 ? 's' : ''}.`
              : "Aucun nouveau personnage trouvé dans le texte.", ajoutes.length > 0 ? 'succes' : 'info');
      } catch(e) {
          notifierErreur("Recherche de personnages impossible.", e);
      } finally {
          setLoading(false);
      }
  };

  // --- Décors -----------------------------------------------------------------

  /**
   * Supprime un décor, après confirmation.
   *
   * Un décor n'est pas isolé : les scènes le désignent par son identifiant pour
   * s'en servir d'image de référence. Le message dit donc combien de scènes
   * perdent leur décor, information que l'écran ne donnait nulle part.
   */
  const handleRemoveEnvironment = async (id: string) => {
      const decor = environments.find(e => e.id === id);
      if (!decor) return;

      const scenesLiees = scenes.filter(s => s.environmentId === id).length;
      const detail = [
          decor.imageUrl ? "L'illustration déjà générée sera effacée." : null,
          scenesLiees > 0
              ? `${scenesLiees} scène${scenesLiees > 1 ? 's' : ''} qui s'y déroule${scenesLiees > 1 ? 'nt' : ''} perdra${scenesLiees > 1 ? 'ont' : ''} son décor de référence.`
              : null,
          "Cette action ne peut pas être annulée.",
      ].filter(Boolean).join(' ');

      const confirme = await confirmer(
          `Supprimer le décor « ${decor.name} » ?`,
          detail,
          { libelleConfirmer: "Supprimer", dangereux: true }
      );
      if (!confirme) return;

      setEnvironments(prev => prev.filter(e => e.id !== id));
      // Les scènes gardent leur description écrite du lieu, elles perdent seulement
      // le renvoi vers une fiche qui n'existe plus.
      setScenes(prev => prev.map(s => s.environmentId === id ? { ...s, environmentId: undefined } : s));
      notifier(`Décor « ${decor.name} » supprimé.`, 'info');
  };
  const handleUpdateEnvironment = (id: string, data: Partial<Environment>) => setEnvironments(prev => prev.map(e => e.id === id ? { ...e, ...data } : e));

  const handleAddEnvironment = async (method: 'manual'|'ai', data: any): Promise<string | void> => {
      setLoading(true);
      try {
          const nouveau: Environment = method === 'manual'
              ? { ...data, id: uuidv4(), status: 'pending' }
              : { ...(await createEnvironmentFromPrompt(data.prompt)), id: uuidv4(), status: 'pending' };
          setEnvironments(prev => [...prev, nouveau]);
          notifier(`Décor « ${nouveau.name} » ajouté.`);
          return nouveau.id;
      } catch(e) {
          notifierErreur("Ajout du décor impossible.", e);
      } finally {
          setLoading(false);
      }
  };

  const handleFindMoreEnvironments = async (count?: number, hints?: string) => {
      setLoading(true);
      try {
          const nouveaux = await findMissingEnvironments(fullText, environments.map(e => e.name), count, hints);
          const ajoutes: Environment[] = nouveaux.map((e: any) => ({ ...e, id: uuidv4(), status: 'pending' }));
          setEnvironments(prev => [...prev, ...ajoutes]);
          notifier(ajoutes.length > 0
              ? `${ajoutes.length} décor${ajoutes.length > 1 ? 's' : ''} trouvé${ajoutes.length > 1 ? 's' : ''}.`
              : "Aucun nouveau décor trouvé dans le texte.", ajoutes.length > 0 ? 'succes' : 'info');
      } catch(e) {
          notifierErreur("Recherche de décors impossible.", e);
      } finally {
          setLoading(false);
      }
  };

  // --- Génération des images --------------------------------------------------

  /** Interrompt la file d'attente en cours, en gardant ce qui est déjà produit. */
  const arreterGeneration = useCallback(() => {
      arretDemandeRef.current = true;
      controleurRef.current?.abort();
      controleurRef.current = null;
      setGenerationEnCours(false);
      setCharacters(p => p.map(c => c.status === 'generating' ? { ...c, status: 'pending' } : c));
      setEnvironments(p => p.map(e => e.status === 'generating' ? { ...e, status: 'pending' } : e));
      setScenes(p => p.map(s => s.status === 'generating' ? { ...s, status: 'pending' } : s));
  }, []);

  const handleArretDemande = () => {
      arreterGeneration();
      notifier("Génération interrompue. Les images déjà produites sont conservées.", 'info');
  };

  const handleGenerateAssets = async () => {
    setStep(AppStep.GENERATION_HUB);
    arretDemandeRef.current = false;
    setGenerationEnCours(true);

    let echecs = 0;
    const controleur = new AbortController();
    controleurRef.current = controleur;

    const enAttente = () => arretDemandeRef.current;

    try {
      // Les personnages d'abord, en entier : leurs fiches servent d'image de
      // référence aux scènes, l'ordre entre les deux familles compte donc.
      await traiterEnParallele(
        characters.filter(c => c.status !== 'completed'),
        GENERATIONS_SIMULTANEES,
        async (char) => {
          setCharacters(p => p.map(c => c.id === char.id ? { ...c, status: 'generating', errorMessage: undefined } : c));
          try {
            const imageUrl = await generateCharacterImage(char, stylePrompt, { ...genConfig, aspectRatio: '1:1' }, controleur.signal);
            setCharacters(p => p.map(c => c.id === char.id ? { ...c, imageUrl, status: 'completed', errorMessage: undefined } : c));
          } catch (e) {
            // Une annulation n'est pas un échec : la vignette est remise en
            // attente par arreterGeneration, il n'y a rien à signaler.
            if ((e as any)?.name === 'AbortError') return;
            echecs++;
            setCharacters(p => p.map(c => c.id === char.id ? { ...c, status: 'error', errorMessage: messageDe(e) } : c));
          }
        },
        enAttente
      );

      await traiterEnParallele(
        environments.filter(e => e.status !== 'completed'),
        GENERATIONS_SIMULTANEES,
        async (env) => {
          setEnvironments(p => p.map(e => e.id === env.id ? { ...e, status: 'generating', errorMessage: undefined } : e));
          try {
            const imageUrl = await generateEnvironmentImage(env, stylePrompt, genConfig, controleur.signal);
            setEnvironments(p => p.map(e => e.id === env.id ? { ...e, imageUrl, status: 'completed', errorMessage: undefined } : e));
          } catch(e) {
            if ((e as any)?.name === 'AbortError') return;
            echecs++;
            setEnvironments(p => p.map(e => e.id === env.id ? { ...e, status: 'error', errorMessage: messageDe(e) } : e));
          }
        },
        enAttente
      );

      if (!arretDemandeRef.current) {
        notifier(echecs === 0
            ? "Toutes les images sont prêtes."
            : `Génération terminée, ${echecs} image${echecs > 1 ? 's ont' : ' a'} échoué. Survolez les vignettes rouges pour savoir pourquoi.`,
            echecs === 0 ? 'succes' : 'info');
      }
    } finally {
      setGenerationEnCours(false);
      relacherControleur(controleur);
    }
  };

  const handleRetryAsset = async (id: string, type: 'char' | 'env') => {
      const controleur = new AbortController();
      controleurRef.current = controleur;

      try {
        if (type === 'char') {
            const char = characters.find(c => c.id === id);
            if (!char) return;
            setCharacters(p => p.map(c => c.id === id ? {...c, status: 'generating', errorMessage: undefined} : c));
            try {
              const url = await generateCharacterImage(char, stylePrompt, {...genConfig, aspectRatio: '1:1'}, controleur.signal);
              setCharacters(p => p.map(c => c.id === id ? {...c, imageUrl: url, status: 'completed', errorMessage: undefined} : c));
            } catch(e) {
              if ((e as any)?.name === 'AbortError') return;
              setCharacters(p => p.map(c => c.id === id ? {...c, status: 'error', errorMessage: messageDe(e)} : c));
              notifierErreur(`Génération de « ${char.name} » impossible.`, e);
            }
        } else {
            const env = environments.find(e => e.id === id);
            if (!env) return;
            setEnvironments(p => p.map(e => e.id === id ? {...e, status: 'generating', errorMessage: undefined} : e));
            try {
                const url = await generateEnvironmentImage(env, stylePrompt, genConfig, controleur.signal);
                setEnvironments(p => p.map(e => e.id === id ? {...e, imageUrl: url, status: 'completed', errorMessage: undefined} : e));
            } catch(e) {
                if ((e as any)?.name === 'AbortError') return;
                setEnvironments(p => p.map(e => e.id === id ? {...e, status: 'error', errorMessage: messageDe(e)} : e));
                notifierErreur(`Génération de « ${env.name} » impossible.`, e);
            }
        }
      } finally {
          relacherControleur(controleur);
      }
  };

  // --- Scènes -----------------------------------------------------------------

  /**
   * Lance le decoupage en scenes.
   *
   * Les scenes arrivent au fil de l'eau : l'ecran de relecture s'ouvre des la
   * premiere, et les suivantes s'ajoutent pendant que l'utilisateur relit deja.
   * Seules les scenes NOUVELLES sont ajoutees, jamais la liste entiere : sans
   * cela, une correction faite pendant l'attente serait ecrasee au sondage
   * suivant.
   */
  const handleStartSceneExtraction = async (count: number | null) => {
    setShowSceneAnalysisConfig(false);
    setLoading(true);
    setScenes([]);
    setProgression("");
    scenesArrivees.current = 0;
    idsScenesArrivees.current = [];
    setStep(AppStep.EXTRACTING_SCENES);

    const controleur = new AbortController();
    controleurRef.current = controleur;

    // Les identifiants sont fabriques hors du setState : une fonction de mise a
    // jour peut etre rejouee par React, et rejouer un uuidv4 donnerait deux
    // identifiants differents pour la meme scene.
    const ajouterLesNouvelles = (arrivees: any[]) => {
        if (arrivees.length <= scenesArrivees.current) return;

        const nouvelles: Scene[] = arrivees.slice(scenesArrivees.current).map((s: any, k: number) => {
            const id = uuidv4();
            idsScenesArrivees.current[scenesArrivees.current + k] = id;
            return { ...s, id, status: 'pending' as const };
        });

        scenesArrivees.current = arrivees.length;
        setScenes(prev => [...prev, ...nouvelles]);
    };

    /**
     * Rend a chaque scene le passage du recit qui lui revient.
     *
     * Les livraisons intermediaires arrivent sans leur texte, qui pese le roman
     * entier et serait retelecharge a chaque sondage. Le resultat final le
     * porte : on le recolle ici, scene par scene, en respectant ce que
     * l'utilisateur a pu corriger pendant l'attente.
     */
    const rendreLesPassages = (completes: any[]) => {
        setScenes(prev => prev.map(scene => {
            const rang = idsScenesArrivees.current.indexOf(scene.id);
            if (rang === -1) return scene;

            const complete = completes[rang];
            // Une correction faite pendant l'attente prime sur le texte du serveur.
            if (!complete || scene.originalTextExcerpt) return scene;

            return { ...scene, originalTextExcerpt: complete.originalTextExcerpt || "" };
        }));
    };

    try {
        const result = await analyzeScenes(
            fullText,
            characters.map(c => c.name),
            count || undefined,
            controleur.signal,
            setProgression,
            (partiel) => {
                ajouterLesNouvelles(partiel.scenes || []);
                // Des la premiere scene prete, on quitte l'ecran d'attente.
                setStep(AppStep.SCENE_REVIEW);
            },
            environments.map(e => ({ id: e.id, name: e.name }))
        );
        ajouterLesNouvelles(result.scenes);
        rendreLesPassages(result.scenes);
        setStep(AppStep.SCENE_REVIEW);
        notifier(`${result.scenes.length} scènes extraites du récit.`);
    } catch (err) {
        if ((err as any)?.name === 'AbortError') {
            // Les scenes deja affichees n'ont pas encore recu leur passage du
            // recit : les garder donnerait un sequencier dont les pages seraient
            // vides au moment de fabriquer le livre. On repart propre.
            setScenes([]);
            setStep(AppStep.GENERATION_HUB);
            return;
        }
        // Meme raison qu'au dessus : des scenes sans leur passage ne servent a
        // rien, et le message d'erreur promet justement que rien d'autre n'a bouge.
        setScenes([]);
        setError(messageDe(err));
        notifierErreur("Le découpage en scènes a échoué.", err);
        setStep(AppStep.GENERATION_HUB);
    } finally {
        setLoading(false);
        setProgression("");
        relacherControleur(controleur);
    }
  };

  const handleAddScene = async (method: 'manual'|'ai', data: any, insertIndex?: number) => {
      setLoading(true);
      try {
          const nouvelle: Scene = method === 'manual'
              ? { ...data, id: uuidv4(), status: 'pending' }
              : { ...(await createSceneFromPrompt(data.prompt, characters.map(c => c.name))), id: uuidv4(), status: 'pending' };

          setScenes(prev => {
              const liste = [...prev];
              if (insertIndex !== undefined && insertIndex >= 0) liste.splice(insertIndex, 0, nouvelle);
              else liste.push(nouvelle);
              return liste;
          });
          notifier(`Scène « ${nouvelle.title} » ajoutée.`);
      } catch(e) {
          notifierErreur("Ajout de la scène impossible.", e);
      } finally {
          setLoading(false);
      }
  };

  const handleFindMoreScenes = async (count?: number, hints?: string) => {
      setLoading(true);
      try {
          const nouvelles = await findMissingScenes(
              fullText, scenes.map(s => s.title), characters.map(c => c.name), count, hints,
              environments.map(e => ({ id: e.id, name: e.name })), setProgression
          );
          const ajoutees: Scene[] = nouvelles.map((s: any) => ({ ...s, id: uuidv4(), status: 'pending' }));
          setScenes(prev => [...prev, ...ajoutees]);
          notifier(ajoutees.length > 0
              ? `${ajoutees.length} scène${ajoutees.length > 1 ? 's' : ''} trouvée${ajoutees.length > 1 ? 's' : ''}.`
              : "Aucune nouvelle scène trouvée dans le texte.", ajoutees.length > 0 ? 'succes' : 'info');
      } catch (e) {
          notifierErreur("Recherche de scènes impossible.", e);
      } finally {
          setLoading(false);
          setProgression("");
      }
  };

  /**
   * Supprime une scène, après confirmation. Une scène porte le passage du récit
   * qui lui correspond, en plus de son illustration : les deux disparaissent.
   */
  const handleRemoveScene = async (id: string) => {
      const scene = scenes.find(s => s.id === id);
      if (!scene) return;

      const confirme = await confirmer(
          `Supprimer la scène « ${scene.title} » ?`,
          scene.imageUrl
              ? "Le passage du récit et l'illustration déjà générée seront effacés. Cette action ne peut pas être annulée."
              : "Le passage du récit qu'elle contient sera effacé. Cette action ne peut pas être annulée.",
          { libelleConfirmer: "Supprimer", dangereux: true }
      );
      if (!confirme) return;

      setScenes(prev => prev.filter(s => s.id !== id));
      notifier(`Scène « ${scene.title} » supprimée.`, 'info');
  };

  const handleMoveScene = (id: string, direction: 'up' | 'down') => {
      setScenes(prev => {
          const index = prev.findIndex(s => s.id === id);
          if (index < 0) return prev;
          const newIndex = direction === 'up' ? index - 1 : index + 1;
          if (newIndex < 0 || newIndex >= prev.length) return prev;

          const liste = [...prev];
          const [deplacee] = liste.splice(index, 1);
          liste.splice(newIndex, 0, deplacee);
          return liste;
      });
  };

  /**
   * Remet les scènes dans l'ordre du récit d'origine, en cherchant la position
   * de chaque extrait dans le texte importé. Ce bouton ne faisait rien auparavant.
   */
  const handleAutoSort = async () => {
      if (!fullText) { notifier("Aucun texte de référence : importez d'abord un récit.", 'info'); return; }

      const positions = new Map<string, number>();
      scenes.forEach((scene, index) => {
          const repere = (scene.originalTextExcerpt || '').trim().slice(0, 150);
          const position = repere.length > 20 ? fullText.indexOf(repere) : -1;
          // Une scène ajoutée à la main n'existe pas dans le texte : elle garde sa place relative.
          positions.set(scene.id, position >= 0 ? position : Number.MAX_SAFE_INTEGER - scenes.length + index);
      });

      const triees = [...scenes].sort((a, b) => (positions.get(a.id) ?? 0) - (positions.get(b.id) ?? 0));
      const dejaDansLOrdre = triees.every((s, i) => s.id === scenes[i].id);

      if (dejaDansLOrdre) { notifier("Les scènes sont déjà dans l'ordre du texte.", 'info'); return; }

      const introuvables = [...positions.values()].filter(v => v >= Number.MAX_SAFE_INTEGER - scenes.length).length;
      setScenes(triees);
      notifier(introuvables > 0
          ? `Scènes réordonnées. ${introuvables} scène${introuvables > 1 ? 's ajoutées à la main ont' : ' ajoutée à la main a'} été placée${introuvables > 1 ? 's' : ''} à la fin.`
          : "Scènes remises dans l'ordre du récit.");
  };

  const handleGenerateScenes = async () => {
      setStep(AppStep.SCENE_GALLERY);
      arretDemandeRef.current = false;
      setGenerationEnCours(true);

      let echecs = 0;
      const controleur = new AbortController();
      controleurRef.current = controleur;

      try {
        await traiterEnParallele(
            scenes.filter(s => s.status !== 'completed'),
            GENERATIONS_SIMULTANEES,
            async (scene) => {
                setScenes(p => p.map(s => s.id === scene.id ? { ...s, status: 'generating', errorMessage: undefined } : s));
                try {
                    const imageUrl = await generateSceneImage(scene, stylePrompt, characters, environments, genConfig, controleur.signal);
                    setScenes(p => p.map(s => s.id === scene.id ? { ...s, imageUrl, status: 'completed', errorMessage: undefined } : s));
                } catch (e) {
                    if ((e as any)?.name === 'AbortError') return;
                    echecs++;
                    setScenes(p => p.map(s => s.id === scene.id ? { ...s, status: 'error', errorMessage: messageDe(e) } : s));
                }
            },
            () => arretDemandeRef.current
        );

        if (!arretDemandeRef.current) {
          notifier(echecs === 0
              ? "Storyboard terminé."
              : `Storyboard terminé, ${echecs} scène${echecs > 1 ? 's ont' : ' a'} échoué.`,
              echecs === 0 ? 'succes' : 'info');
        }
      } finally {
        setGenerationEnCours(false);
        relacherControleur(controleur);
      }
  };

  const handleRetryScene = async (id: string) => {
      const scene = scenes.find(s => s.id === id);
      if (!scene) return;

      const controleur = new AbortController();
      controleurRef.current = controleur;

      setScenes(p => p.map(s => s.id === id ? { ...s, status: 'generating', errorMessage: undefined } : s));
      try {
          const url = await generateSceneImage(scene, stylePrompt, characters, environments, genConfig, controleur.signal);
          setScenes(p => p.map(s => s.id === id ? { ...s, imageUrl: url, status: 'completed', errorMessage: undefined } : s));
      } catch(e) {
          if ((e as any)?.name === 'AbortError') return;
          setScenes(p => p.map(s => s.id === id ? { ...s, status: 'error', errorMessage: messageDe(e) } : s));
          notifierErreur(`Génération de « ${scene.title} » impossible.`, e);
      } finally {
          relacherControleur(controleur);
      }
  };

  // --- Retouche d'image -------------------------------------------------------

  const handleEditImageRequest = (url: string, type: 'char'|'scene'|'env', id: string) => {
      if (!url) { notifier("Cette image n'a pas encore été générée.", 'info'); return; }
      setEditingImage({ url, type, id });
  };

  const handleSaveEditedImage = (newUrl: string) => {
      if (!editingImage) return;
      if (editingImage.type === 'char') setCharacters(p => p.map(c => c.id === editingImage.id ? { ...c, imageUrl: newUrl } : c));
      else if (editingImage.type === 'env') setEnvironments(p => p.map(e => e.id === editingImage.id ? { ...e, imageUrl: newUrl } : e));
      else setScenes(p => p.map(s => s.id === editingImage.id ? { ...s, imageUrl: newUrl } : s));
      setEditingImage(null);
      notifier("Image mise à jour.");
  };

  // --- Navigation -------------------------------------------------------------

  const isStepAccessible = (targetStep: AppStep) => {
      if (loading) return false;
      if (targetStep === AppStep.UPLOAD) return true;
      if (targetStep === AppStep.REVIEW_CHARS) return characters.length > 0;
      if (targetStep === AppStep.REVIEW_ENVIRONMENTS) return characters.length > 0;
      if (targetStep === AppStep.GENERATION_HUB) return characters.length > 0;
      if (targetStep === AppStep.SCENE_REVIEW) return scenes.length > 0;
      if (targetStep === AppStep.SCENE_GALLERY) return scenes.some(s => s.status !== 'pending');
      if (targetStep === AppStep.FINAL_BOOK) return scenes.some(s => s.status === 'completed');
      return false;
  };

  const navItems = [
    { label: "Importer", value: AppStep.UPLOAD, icon: "fa-file-upload" },
    { label: "Casting", value: AppStep.REVIEW_CHARS, icon: "fa-users" },
    { label: "Décors", value: AppStep.REVIEW_ENVIRONMENTS, icon: "fa-tree" },
    { label: "Galerie", value: AppStep.GENERATION_HUB, icon: "fa-images" },
    { label: "Script", value: AppStep.SCENE_REVIEW, icon: "fa-list-ol" },
    { label: "Storyboard", value: AppStep.SCENE_GALLERY, icon: "fa-film" },
    { label: "Livre", value: AppStep.FINAL_BOOK, icon: "fa-book-open" },
  ];

  const etapeCourante = navItems.find(item => item.value === step)?.label || "";
  const indexEtape = navItems.findIndex(item => item.value === step);

  /** Contexte transmis à l'assistant pour qu'il connaisse le projet en cours. */
  const contexteAssistant = {
      etape: etapeCourante,
      style: stylePrompt,
      personnages: characters.map(c => ({ name: c.name, role: c.role, physicalDescription: c.physicalDescription })),
      decors: environments.map(e => ({ name: e.name, type: e.type, description: e.description })),
      scenes: scenes.map(s => ({ title: s.title, description: s.description })),
      extraitTexte: fullText.slice(0, 4000),
  };

  return (
    <div className="min-h-screen bg-dark flex flex-col font-sans text-slate-200">
      <a href="#contenu-principal" className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[200] focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:rounded-lg focus:font-bold">
        Aller au contenu
      </a>

      <header className="sticky top-0 z-50 border-b border-white/5 bg-dark/70 backdrop-blur-xl print:hidden">
        <div className="max-w-[1400px] mx-auto px-4 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 shrink-0 md:mr-8">
            <h1 className="text-lg sm:text-xl font-bold font-heading whitespace-nowrap">CharacGen <span className="text-primary">Studio</span></h1>
          </div>

          {/* Sur petit écran, la barre défile : un dégradé sur le bord droit signale
              qu'il y a d'autres étapes, la barre de défilement étant masquée. */}
          <div className="relative flex-1 min-w-0 hidden sm:block">
            <nav aria-label="Étapes du projet" className="flex items-center gap-1 overflow-x-auto no-scrollbar scroll-smooth">
               {navItems.map((item) => {
                  const accessible = isStepAccessible(item.value);
                  const active = step === item.value;
                  return (
                      <button
                        key={item.value}
                        onClick={() => accessible && setStep(item.value)}
                        disabled={!accessible}
                        aria-current={active ? 'step' : undefined}
                        title={accessible ? item.label : `${item.label} : étape pas encore accessible`}
                        className={`px-4 py-2 min-h-[44px] rounded-full flex items-center gap-2 text-xs font-semibold whitespace-nowrap transition-colors
                          ${active ? 'bg-white/10 text-white' : accessible ? 'text-slate-300 hover:text-white hover:bg-white/5' : 'text-slate-400 cursor-not-allowed'}`}
                      >
                          {/* Une étape verrouillée porte un cadenas : l'information ne repose
                              pas seulement sur la couleur, et le libellé reste lisible. */}
                          <i className={`fas ${accessible ? item.icon : 'fa-lock'} ${active ? 'text-primary' : ''}`} aria-hidden="true"></i>
                          {item.label}
                          {!accessible && <span className="sr-only">, étape pas encore accessible</span>}
                      </button>
                  )
               })}
            </nav>
            <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-dark to-transparent lg:hidden" aria-hidden="true"></div>
          </div>

          {/* Sur téléphone, la barre entière ne tient pas : on affiche l'étape en cours. */}
          <div className="sm:hidden flex-1 min-w-0 text-center">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Étape {indexEtape + 1} sur {navItems.length}</span>
            <span className="text-sm font-semibold text-white truncate block">{etapeCourante}</span>
          </div>

          <div className="flex items-center gap-1 sm:gap-3 md:ml-6 shrink-0">
             {generationEnCours && (
                <button
                  onClick={handleArretDemande}
                  aria-label="Arrêter la génération en cours"
                  className="px-3 sm:px-4 py-2 min-h-[44px] min-w-[44px] justify-center bg-red-500/15 hover:bg-red-500/25 text-red-300 hover:text-red-200 rounded-lg transition font-bold text-xs border border-red-500/30 flex items-center gap-2"
                >
                    <i className="fas fa-stop" aria-hidden="true"></i> <span className="hidden sm:inline">Arrêter</span>
                </button>
             )}

             <button
                onClick={() => setShowHelpModal(true)}
                className="w-11 h-11 flex items-center justify-center hover:text-white text-slate-300 hover:bg-white/5 rounded-lg transition"
                aria-label="Ouvrir l'aide"
             >
                <i className="fas fa-question" aria-hidden="true"></i>
             </button>

             <div className="relative" ref={menuSauvegardeRef}>
                 <button
                    onClick={() => setShowSaveMenu(!showSaveMenu)}
                    aria-expanded={showSaveMenu}
                    aria-haspopup="menu"
                    aria-label="Sauvegarder le projet"
                    className="flex items-center gap-2 px-3 sm:px-4 py-2 min-h-[44px] min-w-[44px] justify-center bg-primary/20 hover:bg-primary/30 text-primary hover:text-white rounded-lg transition font-bold text-xs border border-primary/20"
                 >
                     <i className="fas fa-save" aria-hidden="true"></i>
                     <span className="hidden sm:inline">Sauvegarder</span>
                     {sauvegardeAuto === 'faite' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Projet enregistré" aria-hidden="true"></span>}
                 </button>

                 {showSaveMenu && (
                     <div role="menu" className="absolute top-full right-0 mt-2 w-[min(17rem,calc(100vw-2rem))] bg-surface border border-white/10 rounded-xl shadow-2xl overflow-hidden z-[60] animate-fade-in">
                         <div className="p-3 border-b border-white/5 bg-white/5">
                             <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Projet</p>
                             {sauvegardeAuto !== 'inactive' && (
                                <p className="text-[11px] text-emerald-400 mt-1">
                                    <i className="fas fa-circle-check mr-1" aria-hidden="true"></i>
                                    {sauvegardeAuto === 'faite' ? 'Enregistré automatiquement' : 'Enregistrement...'}
                                </p>
                             )}
                         </div>
                         <button role="menuitem" onClick={handleSaveLocal} className="w-full text-left px-4 py-3 min-h-[44px] hover:bg-white/10 flex items-center gap-3 text-sm text-slate-200 hover:text-white transition">
                             <i className="fas fa-hdd w-5" aria-hidden="true"></i> Enregistrer maintenant
                         </button>
                         {hasLocal && (
                            <button role="menuitem" onClick={handleLoadLocal} className="w-full text-left px-4 py-3 min-h-[44px] hover:bg-white/10 flex items-center gap-3 text-sm text-slate-200 hover:text-white transition">
                                <i className="fas fa-rotate-left w-5" aria-hidden="true"></i> Restaurer la sauvegarde
                            </button>
                         )}
                         <button role="menuitem" onClick={handleExportJSON} className="w-full text-left px-4 py-3 min-h-[44px] hover:bg-white/10 flex items-center gap-3 text-sm text-slate-200 hover:text-white transition">
                             <i className="fas fa-file-export w-5" aria-hidden="true"></i> Exporter le projet (.json)
                         </button>
                         <button role="menuitem" onClick={handleImportClick} className="w-full text-left px-4 py-3 min-h-[44px] hover:bg-white/10 flex items-center gap-3 text-sm text-slate-200 hover:text-white transition">
                             <i className="fas fa-file-import w-5" aria-hidden="true"></i> Importer un projet (.json)
                         </button>

                         <div className="p-3 border-t border-b border-white/5 bg-white/5 mt-1">
                             <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Téléchargement</p>
                         </div>
                         <button role="menuitem" onClick={handleExportZIP} className="w-full text-left px-4 py-3 min-h-[44px] hover:bg-white/10 flex items-center gap-3 text-sm text-emerald-400 hover:text-emerald-300 transition">
                             <i className="fas fa-file-zipper w-5" aria-hidden="true"></i> Toutes les images (.zip)
                         </button>

                         {espace && espace.disponibleOctets > 0 && (
                            <div className="px-4 py-3 border-t border-white/5">
                                <div className="flex justify-between text-[10px] text-slate-400 mb-1.5">
                                    <span>Espace utilisé</span>
                                    <span className="tabular-nums">{formaterOctets(espace.utiliseOctets)} sur {formaterOctets(espace.disponibleOctets)}</span>
                                </div>
                                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all ${espace.pourcentage > 85 ? 'bg-red-500' : espace.pourcentage > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                        style={{ width: `${Math.max(2, espace.pourcentage)}%` }}
                                    ></div>
                                </div>
                            </div>
                         )}
                     </div>
                 )}
             </div>

             <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleImportFile} aria-label="Choisir un fichier projet à importer" />
          </div>
        </div>
      </header>

      <main id="contenu-principal" className="flex-1 flex flex-col relative z-10 w-full max-w-[1400px] mx-auto px-4 sm:px-6">
          {error && (
            <div role="alert" className="bg-red-500/15 border border-red-500/30 text-red-200 p-4 rounded-xl mt-4 flex items-start gap-3">
                <i className="fas fa-circle-exclamation mt-0.5" aria-hidden="true"></i>
                <div className="flex-1">
                    {/* Un message d'erreur qui explique tient rarement sur une ligne.
                        Chaque retour a la ligne devient un paragraphe, sinon tout
                        arrive en un seul bloc que personne ne lit jusqu'au bout. */}
                    {error.split('\n').map((ligne, i) => (
                        <p key={i} className={`text-sm ${i > 0 ? 'mt-2' : ''}`}>{ligne}</p>
                    ))}
                </div>
                <button onClick={() => setError(null)} className="w-11 h-11 -m-2 flex items-center justify-center text-red-300 hover:text-white transition" aria-label="Masquer ce message">
                    <i className="fas fa-times text-xs" aria-hidden="true"></i>
                </button>
            </div>
          )}

          {step === AppStep.UPLOAD || step === AppStep.ANALYZING ? (
            <div className="flex-1 flex items-center justify-center py-12">
                <FileUpload onFileSelect={handleFileSelect} isLoading={step === AppStep.ANALYZING} progression={progression} />
            </div>
          ) : step === AppStep.REVIEW_CHARS ? (
            <div className="py-8">
                <CharacterReview
                    characters={characters}
                    stylePrompt={stylePrompt}
                    onStyleChange={setStylePrompt}
                    onRemoveCharacter={handleRemoveCharacter}
                    onAddCharacter={handleAddCharacter}
                    onUpdateCharacter={handleUpdateCharacter}
                    onRegenerateText={handleRegenerateCharacterText}
                    onFindMoreCharacters={handleFindMoreCharacters}
                    onGenerate={() => setStep(AppStep.REVIEW_ENVIRONMENTS)}
                />
            </div>
          ) : step === AppStep.REVIEW_ENVIRONMENTS ? (
            <div className="py-8">
                <EnvironmentReview
                    environments={environments}
                    onRemoveEnvironment={handleRemoveEnvironment}
                    onUpdateEnvironment={handleUpdateEnvironment}
                    onAddEnvironment={handleAddEnvironment}
                    onFindMoreEnvironments={handleFindMoreEnvironments}
                    onNext={handleGenerateAssets}
                />
            </div>
          ) : step === AppStep.GENERATION_HUB ? (
            <div className="py-8">
                <Gallery
                    characters={characters}
                    environments={environments}
                    titre={titre}
                    onRestart={handleRestart}
                    onNextStep={() => setShowSceneAnalysisConfig(true)}
                    onRetry={handleRetryAsset}
                    isGenerating={generationEnCours}
                    onStop={handleArretDemande}
                    onEditImage={(id, type) => handleEditImageRequest(
                        (type === 'char' ? characters.find(c => c.id === id) : environments.find(e => e.id === id))?.imageUrl || '', type, id
                    )}
                />
            </div>
          ) : (step === AppStep.EXTRACTING_SCENES || step === AppStep.SCENE_REVIEW) ? (
              step === AppStep.EXTRACTING_SCENES ? (
                <div className="flex-1 flex flex-col items-center justify-center p-20 text-center gap-4">
                    <div className="w-12 h-12 border-2 border-primary border-t-transparent rounded-full animate-spin" aria-hidden="true"></div>
                    <p className="text-white font-heading text-lg">Découpage du récit en scènes</p>
                    {/* L'avancement vient du serveur : sans lui, l'écran restait
                        muet pendant plusieurs minutes et rien ne distinguait un
                        travail en cours d'une panne. */}
                    <p className="text-primary text-sm font-mono min-h-[1.25rem]" aria-live="polite">
                        {progression || "Lecture du récit en entier"}
                    </p>
                    <p className="text-slate-400 text-sm max-w-sm">
                        L'IA repère d'abord où les scènes commencent vraiment, puis rédige chaque
                        fiche. Les premières scènes s'affichent dès qu'elles sont prêtes.
                    </p>
                </div>
              ) : (
                <div className="py-8">
                    <SceneReview
                        scenes={scenes}
                        enCours={loading ? progression : ""}
                        allCharacters={characters}
                        allEnvironments={environments}
                        onRemoveScene={handleRemoveScene}
                        onAddScene={handleAddScene}
                        onUpdateScene={(id, d) => setScenes(p => p.map(s => s.id === id ? {...s, ...d} : s))}
                        onFindMoreScenes={handleFindMoreScenes}
                        onGenerateScenes={handleGenerateScenes}
                        onMoveScene={handleMoveScene}
                        onAutoSort={handleAutoSort}
                        onAddEnvironment={async (data) => (await handleAddEnvironment('manual', data)) as string}
                        onUpdateEnvironment={handleUpdateEnvironment}
                        selectedFormat={currentFormatId}
                        onFormatChange={handleFormatChange}
                        bookFormats={BOOK_FORMATS}
                    />
                </div>
              )
          ) : step === AppStep.FINAL_BOOK ? (
             <div className="py-8">
                <BookViewer
                    scenes={scenes}
                    titre={titre}
                    onTitreChange={setTitre}
                    format={format}
                    onRestart={handleRestart}
                />
             </div>
          ) : (
             <div className="py-8">
                <SceneGallery
                    scenes={scenes}
                    onRestart={handleRestart}
                    onRetry={handleRetryScene}
                    onNextStep={() => setStep(AppStep.FINAL_BOOK)}
                    isGenerating={generationEnCours}
                    onStop={handleArretDemande}
                    onEditImage={(id) => handleEditImageRequest(scenes.find(s => s.id === id)?.imageUrl || '', 'scene', id)}
                />
             </div>
          )}
      </main>

      <ChatAssistant contexte={contexteAssistant} />
      <CentreNotifications />
      {showHelpModal && <HelpModal onClose={() => setShowHelpModal(false)} />}
      {showSceneAnalysisConfig && <AnalysisConfigModal type="scene" longueurRecit={fullText.length} onConfirm={handleStartSceneExtraction} onCancel={() => setShowSceneAnalysisConfig(false)} />}
      {editingImage && <ImageEditorModal imageUrl={editingImage.url} onClose={() => setEditingImage(null)} onSave={handleSaveEditedImage} />}
      <OnboardingTour step={step} />
    </div>
  );
};

export default App;
