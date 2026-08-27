import React, { useEffect, useState } from 'react';
import { Scene, Character, Environment } from '../types';
import { notifier } from '../services/notifications';
// La même règle de rapprochement des noms que le serveur, prise à sa source.
// Le fichier partagé ne fait aucun import et n'a aucun effet de bord : seules
// les deux fonctions utilisées ici partent dans le paquet du navigateur.
import { memePersonnage } from '../netlify/shared/analyse';
import AvertissementPlanche from './AvertissementPlanche';
import BarreVue, { useCollectionFiltree, useReglagesVue } from './BarreVue';
import VueCompacte, { focaliserFiche, type LigneCompacte } from './VueCompacte';
import { ancre } from '../services/vue';

interface SceneReviewProps {
  scenes: Scene[];
  /**
   * Etape en cours quand des scenes arrivent encore, chaine vide sinon.
   *
   * L'ecran s'ouvre des la premiere scene prete : sans ce bandeau, on croirait
   * que le decoupage n'a trouve que trois scenes alors qu'il en fabrique encore.
   */
  enCours?: string;
  allCharacters: Character[];
  allEnvironments: Environment[];
  onRemoveScene: (id: string) => void;
  onAddScene: (method: 'manual' | 'ai', data: any, insertIndex?: number) => Promise<void>;
  onUpdateScene: (id: string, data: Partial<Scene>) => void;
  onFindMoreScenes: (count?: number, hints?: string) => Promise<void>;
  onGenerateScenes: () => void;
  onMoveScene: (id: string, direction: 'up' | 'down') => void;
  onAutoSort: () => void;
  // New props for environment editing
  onAddEnvironment: (data: any) => Promise<string>; 
  onUpdateEnvironment: (id: string, data: Partial<Environment>) => void;
  /**
   * Le bloc de réglage du format, fourni tel quel par l'application.
   *
   * Trois props le décrivaient auparavant, `selectedFormat`, `onFormatChange`
   * et `bookFormats`, et cet écran dessinait lui-même la grille de dix boutons.
   * Il n'a aucune raison de connaître les formats : le réglage est désormais un
   * composant à part, posé aussi avant la génération des décors, et ce fichier
   * se contente de lui faire une place.
   */
  reglagesFormat?: React.ReactNode;
}

/**
 * Champ de saisie qui ne remonte sa valeur qu'en sortant.
 *
 * POURQUOI CE COMPOSANT EXISTE
 *
 * Les champs du séquencier écrivaient directement dans l'état du projet, à
 * chaque caractère tapé. Or cet état porte aussi les images encodées : sur un
 * projet de vingt scènes illustrées, taper une phrase dans le texte original
 * relançait le rendu complet de l'application vingt fois par seconde, et
 * remettait à zéro le minuteur de sauvegarde à chaque frappe.
 *
 * La frappe reste maintenant locale au champ. La valeur ne remonte qu'à la
 * sortie du champ, ou à la touche Entrée pour une ligne simple.
 */
const ChampDiffere: React.FC<{
  valeur: string;
  onValider: (valeur: string) => void;
  multiligne?: boolean;
  className?: string;
  placeholder?: string;
  'aria-label'?: string;
}> = ({ valeur, onValider, multiligne, ...reste }) => {
  const [brouillon, setBrouillon] = useState(valeur);

  // La valeur peut changer sans passer par ce champ : réordonnancement des
  // scènes, import d'un projet, recherche de scènes manquantes.
  useEffect(() => setBrouillon(valeur), [valeur]);

  const valider = () => {
    if (brouillon !== valeur) onValider(brouillon);
  };

  if (multiligne) {
    return (
      <textarea
        {...reste}
        value={brouillon}
        onChange={(e) => setBrouillon(e.target.value)}
        onBlur={valider}
      />
    );
  }

  return (
    <input
      {...reste}
      value={brouillon}
      onChange={(e) => setBrouillon(e.target.value)}
      onBlur={valider}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
};

const SceneReview: React.FC<SceneReviewProps> = ({
  scenes,
  enCours = '',
  allCharacters,
  allEnvironments = [],
  onRemoveScene,
  onAddScene,
  onUpdateScene,
  onFindMoreScenes,
  onGenerateScenes,
  onMoveScene,
  onAutoSort,
  onAddEnvironment,
  onUpdateEnvironment,
  reglagesFormat
}) => {
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [addMethod, setAddMethod] = useState<'manual' | 'ai' | 'scan'>('ai');
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [insertIndex, setInsertIndex] = useState<number | undefined>(undefined);

  // Inline Character Edit State
  const [inlineCharEditId, setInlineCharEditId] = useState<string | null>(null);

  // Environment Modal State
  const [showEnvModal, setShowEnvModal] = useState(false);
  const [envForm, setEnvForm] = useState<{id?: string, name: string, type: any, description: string, mood: string}>({
      name: '', type: 'indoor', description: '', mood: ''
  });

  // Scan State
  const [scanCount, setScanCount] = useState<number>(1);
  const [scanHints, setScanHints] = useState<string>('');

  const [manualForm, setManualForm] = useState<{
    title: string, 
    location: string,
    environmentId?: string, 
    environmentDetail: string, 
    description: string, 
    originalTextExcerpt: string,
    charactersPresent: string[],
    customVisualPrompt: string
  }>({
    title: '',
    location: '',
    environmentId: undefined,
    environmentDetail: '',
    description: '',
    originalTextExcerpt: '',
    charactersPresent: [],
    customVisualPrompt: ''
  });

  const [aiPrompt, setAiPrompt] = useState('');

  /*
   * Le séquencier peut facilement dépasser cent scènes. Les cartes restent
   * l'espace de correction, mais la liste et le mur permettent d'abord de
   * repérer une scène, puis de revenir exactement sur sa fiche.
   */
  const vue = useReglagesVue('sequencier');
  const numeroDe = new Map(scenes.map((scene, index) => [scene.id, index + 1]));
  const { visibles, comptes } = useCollectionFiltree(
    scenes,
    vue.recherche,
    vue.etat,
    (scene) => [scene.title, scene.location, scene.description, ...(scene.charactersPresent || [])],
  );

  const lignes: LigneCompacte[] = visibles.map((scene) => {
    const personnages = (scene.charactersPresent || []).filter(Boolean);
    return {
      id: scene.id,
      rang: numeroDe.get(scene.id),
      nom: scene.title,
      sousTitre: scene.location,
      vignette: scene.imageUrl,
      statut: scene.status,
      detail: scene.status === 'error'
        ? scene.errorMessage
        : personnages.length > 0 ? `Avec ${personnages.join(', ')}` : undefined,
      etiquettes: [
        ...(personnages.length > 0
          ? [{ texte: `${personnages.length} pers.`, ton: 'lien' as const, titre: personnages.join(', ') }]
          : []),
        ...(scene.reperageIncertain ? [{ texte: 'reperage incertain', ton: 'alerte' as const }] : []),
      ],
    };
  });

  const ouvrirScene = (id: string) => {
    vue.setDensite('cartes');
    focaliserFiche('sequence', id);
  };

  const openAddModal = (index?: number) => {
      setModalMode('add');
      setAddMethod('ai');
      setInsertIndex(index);
      setManualForm({ 
        title: '', 
        location: '', 
        environmentId: undefined,
        environmentDetail: '', 
        description: '', 
        originalTextExcerpt: '', 
        charactersPresent: [],
        customVisualPrompt: ''
      });
      setAiPrompt('');
      setScanCount(1);
      setScanHints('');
      setShowModal(true);
  };

  const openEditModal = (scene: Scene) => {
      setModalMode('edit');
      setAddMethod('manual');
      setEditingSceneId(scene.id);
      setInsertIndex(undefined);
      setManualForm({
          title: scene.title,
          location: scene.location || '',
          environmentId: scene.environmentId,
          environmentDetail: scene.environmentDetail || '',
          description: scene.description,
          originalTextExcerpt: scene.originalTextExcerpt || '',
          // BUG FIX: Ensure charactersPresent is an array
          charactersPresent: [...(scene.charactersPresent || [])],
          customVisualPrompt: scene.customVisualPrompt || ''
      });
      setShowModal(true);
  };

  const openEnvModal = () => {
      if (manualForm.environmentId) {
          // Edit existing
          const env = allEnvironments.find(e => e.id === manualForm.environmentId);
          if (env) {
              setEnvForm({ id: env.id, name: env.name, type: env.type, description: env.description, mood: env.mood });
          }
      } else {
          // New
          setEnvForm({ name: manualForm.location || '', type: 'indoor', description: manualForm.environmentDetail || '', mood: '' });
      }
      setShowEnvModal(true);
  };

  const handleEnvSubmit = async () => {
      if (!envForm.name) { notifier("Donnez un nom à ce décor.", 'info'); return; }

      if (envForm.id) {
          onUpdateEnvironment(envForm.id, envForm);
          setShowEnvModal(false);
      } else {
          // Create new
          const newId = await onAddEnvironment(envForm);
          setManualForm(prev => ({ ...prev, environmentId: newId, location: envForm.name }));
          setShowEnvModal(false);
      }
  };

  const toggleCharInManual = (charName: string) => {
    setManualForm(prev => {
        const exists = prev.charactersPresent.includes(charName);
        return {
            ...prev,
            charactersPresent: exists 
                ? prev.charactersPresent.filter(c => c !== charName)
                : [...prev.charactersPresent, charName]
        };
    });
  };

  const toggleCharInScene = (scene: Scene, charName: string) => {
      const safeChars = scene.charactersPresent || [];
      const exists = safeChars.includes(charName);
      const newChars = exists 
          ? safeChars.filter(c => c !== charName)
          : [...safeChars, charName];
      onUpdateScene(scene.id, { charactersPresent: newChars });
  };

  const handleSubmit = async () => {
    if (modalMode === 'edit' && editingSceneId) {
        if (!manualForm.title || !manualForm.description) { notifier("Le titre et la description visuelle sont obligatoires.", 'info'); return; }
        onUpdateScene(editingSceneId, manualForm);
        setShowModal(false);
        return;
    }

    if (addMethod === 'scan') {
        setIsProcessing(true);
        await onFindMoreScenes(scanCount, scanHints);
        setIsProcessing(false);
        setShowModal(false);
        return;
    }

    if (addMethod === 'manual') {
      if (!manualForm.title || !manualForm.description) { notifier("Le titre et la description visuelle sont obligatoires.", 'info'); return; }
      await onAddScene('manual', manualForm, insertIndex);
      setShowModal(false);
    } else {
      if (!aiPrompt.trim()) { notifier("Décrivez la scène à créer.", 'info'); return; }
      setIsProcessing(true);
      await onAddScene('ai', { prompt: aiPrompt }, insertIndex);
      setIsProcessing(false);
      setShowModal(false);
    }
  };

  return (
    <div className="w-full space-y-8 animate-fade-in pb-32">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-white/5 pb-6 gap-4">
        <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <i className="fas fa-list-ol text-primary" aria-hidden="true"></i> Séquencier Complet
            </h2>
            <p className="text-xs text-slate-400 font-mono mt-1">{scenes.length} séquences (Couverture intégrale)</p>
        </div>
        <div className="flex gap-2">
            {/* Auto Sort removed or kept based on user request - kept placeholder for now */}
            <button 
                onClick={onAutoSort}
                className="px-4 py-2 bg-surface border border-slate-700 hover:border-primary hover:text-primary text-slate-300 text-xs font-bold uppercase rounded-lg transition flex items-center gap-2"
                title="Remettre dans l'ordre du texte original"
            >
                <i className="fas fa-sort-amount-down" aria-hidden="true"></i> Réordonner
            </button>
            <button 
                onClick={() => openAddModal()}
                className="px-4 py-2 border border-white/10 hover:border-white hover:bg-white/5 text-white text-xs font-bold uppercase rounded-lg transition flex items-center gap-2"
            >
                <i className="fas fa-plus" aria-hidden="true"></i> Ajouter / Scanner
            </button>
        </div>
      </div>

      {enCours && (
        <div
            className="flex items-center gap-3 p-4 rounded-xl bg-primary/10 border border-primary/40"
            role="status"
            aria-live="polite"
        >
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" aria-hidden="true"></div>
            <div>
                <p className="text-white text-sm font-bold">D'autres scènes sont encore en cours d'écriture</p>
                <p className="text-primary text-xs font-mono mt-0.5">{enCours}</p>
                <p className="text-slate-400 text-xs mt-1">
                    Vous pouvez déjà relire et corriger celles qui sont là, vos modifications sont conservées.
                </p>
            </div>
        </div>
      )}

      {/* Recherche, filtre d'état et densité. Voir components/BarreVue.tsx. */}
      <BarreVue
        recherche={vue.recherche}
        onRecherche={vue.setRecherche}
        etat={vue.etat}
        onEtat={vue.setEtat}
        densite={vue.densite}
        onDensite={vue.setDensite}
        comptes={comptes}
        visibles={visibles.length}
        nom="scène"
        exemple="Chercher un titre, un lieu, un personnage"
        planchesPossibles={scenes.some((s) => Boolean(s.imageUrl))}
        sansEtat={comptes.faits === 0 && comptes.erreurs === 0}
      />

      {vue.densite !== 'cartes' ? (
        <VueCompacte
          lignes={lignes}
          densite={vue.densite}
          onOuvrir={ouvrirScene}
          vide="Aucune scène ne correspond à cette recherche."
        />
      ) : (

      <div className="space-y-4">
        {visibles.map((scene) => {
            const index = (numeroDe.get(scene.id) || 1) - 1;
            // BUG FIX: Handle case where charactersPresent is undefined
            const safeCharsPresent = scene.charactersPresent || [];
            
            // Le rapprochement se faisait ici par inclusion croisée des noms en
            // minuscules. Un personnage nommé « Al » était donc reconnu dans
            // « Salazar », dans « Alice » et dans « journal » : l'écran annonçait
            // des présences que le serveur, lui, refuse depuis qu'il compare sur
            // une frontière de mot. Les deux côtés répondent maintenant pareil.
            const matchedChars = allCharacters.filter(c =>
                safeCharsPresent.some(name => typeof name === 'string' && memePersonnage(name, c.name))
            );
            const hasCustomPrompt = scene.customVisualPrompt && scene.customVisualPrompt.trim().length > 0;
            const wordCount = scene.originalTextExcerpt ? scene.originalTextExcerpt.trim().split(/\s+/).length : 0;
            const isEditingChars = inlineCharEditId === scene.id;

            return (
                <div key={scene.id} id={ancre('sequence', scene.id)} className="relative group/item">
                    {/* Insert Button (Hover) */}
                    <div className="h-6 -my-3 flex items-center justify-center opacity-0 group-hover/item:opacity-100 transition-opacity z-10 relative">
                        <button 
                            onClick={() => openAddModal(index)}
                            className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center shadow-lg hover:scale-110 transition transform"
                            title="Insérer une scène ici"
                        >
                            <i className="fas fa-plus text-[10px]" aria-hidden="true"></i>
                        </button>
                        <div className="absolute left-0 right-0 h-[1px] bg-primary/30 -z-10"></div>
                    </div>

                    <div className={`
                        relative bg-surface border border-white/5 rounded-xl p-5 hover:border-white/20 transition-all duration-300
                        ${hasCustomPrompt ? 'border-amber-500/30' : ''}
                        ${scene.reperageIncertain ? 'border-l-2 border-l-amber-400/70' : ''}
                    `}>
                         {/* Le serveur savait déjà que la borne de cette scène était
                             estimée, faute d'avoir retrouvé la citation dans le récit.
                             L'information ne sortait qu'en console : elle se voit
                             maintenant là où on peut agir dessus. */}
                         {scene.reperageIncertain && (
                            <p className="ml-6 mb-3 text-[11px] text-amber-300/90 flex items-start gap-2">
                                <i className="fas fa-scissors mt-0.5" aria-hidden="true"></i>
                                <span>
                                    Le début de cette scène a été estimé : la citation renvoyée par l'IA
                                    n'a pas été retrouvée telle quelle dans le récit. Vérifiez que le passage
                                    commence bien au bon endroit.
                                </span>
                            </p>
                         )}
                         {/* Controls Sidebar */}
                         <div className="absolute left-0 top-0 bottom-0 w-8 flex flex-col items-center justify-center gap-1 border-r border-white/5 bg-black/20 rounded-l-xl">
                            <button
                                onClick={() => onMoveScene(scene.id, 'up')}
                                disabled={index === 0}
                                aria-label={`Remonter la scène ${scene.title}`}
                                className="w-full h-8 flex items-center justify-center text-slate-400 hover:text-white disabled:opacity-20 transition"
                            >
                                <i className="fas fa-chevron-up text-xs" aria-hidden="true"></i>
                            </button>
                            <span className="text-[10px] font-mono text-slate-400 font-bold">{index + 1}</span>
                            <button
                                onClick={() => onMoveScene(scene.id, 'down')}
                                disabled={index === scenes.length - 1}
                                aria-label={`Descendre la scène ${scene.title}`}
                                className="w-full h-8 flex items-center justify-center text-slate-400 hover:text-white disabled:opacity-20 transition"
                            >
                                <i className="fas fa-chevron-down text-xs" aria-hidden="true"></i>
                            </button>
                         </div>

                        {/* Boutons nommés pour un lecteur d'écran, et visibles sans survol
                            sur écran tactile, où le survol n'existe pas. */}
                        <div className="absolute top-4 right-4 flex gap-3 opacity-0 max-sm:opacity-100 group-hover/item:opacity-100 group-focus-within/item:opacity-100 transition-opacity z-20">
                            <button
                                onClick={() => openEditModal(scene)}
                                aria-label={`Paramètres avancés de la scène ${scene.title}`}
                                title="Paramètres avancés"
                                className="w-8 h-8 rounded bg-black/50 text-slate-400 hover:text-white flex items-center justify-center hover:bg-black transition"
                            ><i className="fas fa-cog text-xs" aria-hidden="true"></i></button>
                            <button
                                onClick={() => onRemoveScene(scene.id)}
                                aria-label={`Supprimer la scène ${scene.title}`}
                                className="w-8 h-8 rounded bg-black/50 text-slate-400 hover:text-red-400 flex items-center justify-center hover:bg-black transition"
                            ><i className="fas fa-trash text-xs" aria-hidden="true"></i></button>
                        </div>

                        <div className="ml-8 flex flex-col gap-4">
                            {/* Header Inline Edit */}
                            <div className="flex flex-col sm:flex-row sm:items-center gap-3 border-b border-white/5 pb-3">
                                <ChampDiffere
                                    className="flex-1 bg-transparent border-none text-base font-bold text-white focus:ring-0 placeholder-slate-600 p-0"
                                    valeur={scene.title}
                                    onValider={(titre) => onUpdateScene(scene.id, { title: titre })}
                                    placeholder="Titre de la scène"
                                    aria-label={`Titre de la scène ${index + 1}`}
                                />
                                <div className="relative group/env shrink-0 min-w-[200px]">
                                    <select
                                        className="w-full appearance-none bg-dark/50 border border-white/10 text-[10px] text-green-400 uppercase tracking-wider font-mono rounded-lg px-3 py-1.5 pr-8 cursor-pointer hover:border-green-500/50 focus:border-green-500 focus:outline-none"
                                        value={scene.environmentId || ''}
                                        onChange={(e) => onUpdateScene(scene.id, { environmentId: e.target.value || undefined, location: e.target.options[e.target.selectedIndex].text })}
                                    >
                                        <option value="">-- Lieu Libre (Manuel) --</option>
                                        {allEnvironments.map(env => (
                                            <option key={env.id} value={env.id}>{env.name}</option>
                                        ))}
                                    </select>
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                        <i className="fas fa-map-marker-alt text-[10px] text-green-500" aria-hidden="true"></i>
                                    </div>
                                </div>
                            </div>

                            {/* Le décor part en description écrite, pas en image de
                                référence : une image pèse plus qu'une phrase qui dit
                                de ne pas en copier le cadrage, et le plan finissait
                                cadré comme le décor. Cette case rétablit l'ancien
                                comportement quand on veut vraiment la même pièce. */}
                            {scene.environmentId && (
                                <label className="flex items-start gap-2 mb-4 cursor-pointer text-slate-400 hover:text-slate-200 transition-colors w-fit">
                                    <input
                                        type="checkbox"
                                        checked={Boolean(scene.verrouillerDecor)}
                                        onChange={(e) => onUpdateScene(scene.id, { verrouillerDecor: e.target.checked })}
                                        className="mt-0.5 accent-primary w-4 h-4 shrink-0"
                                    />
                                    <span className="text-[11px] leading-snug max-w-md">
                                        <span className="font-semibold">Verrouiller ce décor sur son image</span>
                                        <span className="block opacity-70">
                                            Par défaut le décor sert de repère écrit, ce qui laisse la caméra suivre
                                            l'action. Cochez pour retrouver exactement la pièce du décor généré.
                                        </span>
                                    </span>
                                </label>
                            )}

                            <div className="grid lg:grid-cols-2 gap-6">
                                {/* Left Column: Visuals & Characters */}
                                <div className="space-y-4">
                                    {/* Description Inline Edit */}
                                    <div>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase mb-1 block flex justify-between">
                                            Description Visuelle (Prompt)
                                            <span className="text-[9px] opacity-50"><i className="fas fa-pen mr-1" aria-hidden="true"></i> Editable</span>
                                        </span>
                                        <ChampDiffere
                                            multiligne
                                            className="w-full bg-dark/50 rounded-lg p-3 border border-white/5 text-xs text-slate-300 leading-relaxed focus:border-primary focus:outline-none resize-none min-h-[100px] transition-colors hover:bg-dark/70"
                                            valeur={scene.description}
                                            onValider={(description) => onUpdateScene(scene.id, { description })}
                                            placeholder="Décrivez l'action et le visuel..."
                                            aria-label={`Description visuelle de la scène ${index + 1}`}
                                        />
                                    </div>
                                    
                                    {/* Characters Inline Toggle */}
                                    <div>
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase">Casting Présent</span>
                                            <button 
                                                onClick={() => setInlineCharEditId(isEditingChars ? null : scene.id)} 
                                                className={`text-[9px] font-bold uppercase transition px-2 py-0.5 rounded ${isEditingChars ? 'bg-primary text-white' : 'text-primary hover:bg-primary/10'}`}
                                            >
                                                {isEditingChars ? <><i className="fas fa-check mr-1" aria-hidden="true"></i> Terminé</> : <><i className="fas fa-user-plus mr-1" aria-hidden="true"></i> Modifier</>}
                                            </button>
                                        </div>
                                        
                                        {isEditingChars ? (
                                            <div className="flex flex-wrap gap-2 bg-black/40 p-3 rounded-lg border border-primary/30 animate-fade-in">
                                                 {allCharacters.map(char => {
                                                     const isPresent = safeCharsPresent.includes(char.name);
                                                     return (
                                                        <button 
                                                            key={char.id}
                                                            onClick={() => toggleCharInScene(scene, char.name)}
                                                            className={`px-3 py-1.5 text-[10px] rounded-full border transition-all flex items-center gap-2 ${isPresent ? 'bg-primary border-primary text-white shadow-lg shadow-primary/20' : 'bg-transparent border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300'}`}
                                                        >
                                                            <div className={`w-2 h-2 rounded-full ${isPresent ? 'bg-white' : 'bg-slate-600'}`}></div>
                                                            {char.name}
                                                        </button>
                                                     )
                                                 })}
                                            </div>
                                        ) : (
                                            <div className="flex flex-wrap gap-2">
                                                {matchedChars.length > 0 ? matchedChars.map(char => (
                                                    <span key={char.id} className="px-2 py-1 bg-black/30 border border-white/10 text-[10px] text-slate-300 rounded flex items-center gap-1">
                                                        <div className="w-2 h-2 rounded-full bg-primary/50"></div>
                                                        {char.name}
                                                    </span>
                                                )) : <span className="text-[10px] text-slate-400 italic px-2 py-1">Aucun personnage principal</span>}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Right Column: Original Text (Editable) */}
                                <div className="h-full flex flex-col">
                                     <div className="flex justify-between items-center mb-1">
                                         <span className="text-[10px] font-bold text-emerald-500 uppercase flex items-center gap-2">
                                            <i className="fas fa-book-open" aria-hidden="true"></i> Texte Original (Integral)
                                         </span>
                                         <span className="text-[9px] text-slate-400 uppercase">
                                             {wordCount} mots
                                         </span>
                                     </div>
                                     <ChampDiffere
                                        multiligne
                                        className="w-full flex-1 min-h-[160px] bg-[#fffbf0]/5 hover:bg-[#fffbf0]/10 focus:bg-[#fffbf0]/10 border border-emerald-500/30 rounded-lg p-4 text-sm font-serif text-slate-300 focus:outline-none focus:border-emerald-500/50 transition-colors resize-none leading-relaxed"
                                        valeur={scene.originalTextExcerpt}
                                        onValider={(texte) => onUpdateScene(scene.id, { originalTextExcerpt: texte })}
                                        placeholder="Le texte complet doit apparaître ici..."
                                        aria-label={`Texte original de la scène ${index + 1}`}
                                     />
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    {/* Insert Button (Bottom of last item) */}
                    {index === scenes.length - 1 && (
                         <div className="h-6 mt-2 flex items-center justify-center opacity-0 group-hover/item:opacity-100 transition-opacity z-10 relative">
                             <button 
                                 onClick={() => openAddModal(index + 1)}
                                 className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center shadow-lg hover:scale-110 transition transform"
                             >
                                 <i className="fas fa-plus text-[10px]" aria-hidden="true"></i>
                             </button>
                             <div className="absolute left-0 right-0 h-[1px] bg-primary/30 -z-10"></div>
                         </div>
                    )}
                </div>
            )
        })}
      </div>
      )}

      {/* Réglages du format, puis lancement du storyboard */}
      <div className="mt-12 flex flex-col gap-6">
         {reglagesFormat}

         <div className="p-8 bg-surface border border-white/5 rounded-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

            <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
                <AvertissementPlanche className="flex-1 w-full" />

                <div className="flex flex-col items-center gap-4 shrink-0">
                   <button
                       onClick={onGenerateScenes}
                       className="group relative px-8 py-4 bg-white text-black font-bold text-sm uppercase tracking-wide rounded-full overflow-hidden shadow-2xl hover:scale-105 transition-transform"
                   >
                       <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-slate-200 to-transparent translate-x-[-100%] group-hover:animate-[shimmer_1.5s_infinite]"></div>
                       <span className="relative flex items-center gap-2">
                           <i className="fas fa-film text-lg" aria-hidden="true"></i> Générer le Storyboard
                       </span>
                   </button>
                   <p className="text-[10px] text-slate-400 text-center max-w-[200px]">
                       Le format et le cadrage réglés ci-dessus s'appliquent à toutes les images.
                   </p>
                </div>
            </div>
         </div>
      </div>

       {/* Modal - Aligned to Top */}
       {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[80] flex items-start justify-center pt-24 p-4 overflow-y-auto">
          <div className="bg-surface border border-white/10 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col mb-20 animate-fade-in">
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
              <h3 className="text-white font-bold text-sm uppercase">
                  {modalMode === 'edit' ? 'Modifier la Scène' : (insertIndex !== undefined ? 'Insérer une Scène' : 'Ajouter une Scène')}
              </h3>
              <button onClick={() => setShowModal(false)} className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-white/10 transition" aria-label="Fermer">
                <i className="fas fa-times text-slate-400 hover:text-white" aria-hidden="true"></i>
              </button>
            </div>

            {/* Les trois modes d'ajout. Cette rangée manquait sur cet écran :
                le mode Scanner était codé mais restait inatteignable. */}
            {modalMode === 'add' && (
                <div className="grid grid-cols-3 border-b border-white/5 p-1 bg-black/20" role="tablist">
                    {(['ai', 'scan', 'manual'] as const).map((m) => (
                        <button
                            key={m}
                            role="tab"
                            aria-selected={addMethod === m}
                            className={`py-2.5 min-h-[44px] text-xs font-bold uppercase tracking-wide rounded-lg transition-all ${addMethod === m ? 'bg-primary text-white shadow-lg' : 'text-slate-300 hover:text-white hover:bg-white/5'}`}
                            onClick={() => setAddMethod(m)}
                        >
                            {m === 'ai' ? 'IA rapide' : m === 'scan' ? 'Scanner' : 'Manuel'}
                        </button>
                    ))}
                </div>
            )}

            <div className="p-6">
                {modalMode === 'add' && addMethod === 'ai' ? (
                     <div>
                         <label htmlFor="prompt-scene" className="text-xs font-bold text-slate-400 uppercase mb-2 block">Décrivez la scène</label>
                         <textarea
                            id="prompt-scene"
                            className="w-full bg-dark border border-white/10 rounded-xl p-4 text-white h-40 focus:border-primary focus:outline-none resize-none"
                            placeholder="Ex : le héros découvre la lettre cachée sous le plancher, à la lueur d'une bougie..."
                            value={aiPrompt}
                            onChange={e => setAiPrompt(e.target.value)}
                         ></textarea>
                         <p className="text-xs text-slate-400 mt-2">L'IA invente cette scène à partir de votre description, sans chercher dans le texte.</p>
                     </div>
                ) : modalMode === 'add' && addMethod === 'scan' ? (
                    <div className="space-y-6">
                        <div className="bg-primary/10 p-4 rounded-xl border border-primary/20 flex gap-4">
                             <div className="text-2xl text-primary" aria-hidden="true"><i className="fas fa-search" aria-hidden="true"></i></div>
                             <div>
                                <h4 className="font-bold text-white text-sm">Chercher dans le récit</h4>
                                <p className="text-xs text-slate-300 mt-1">L'IA relit votre texte et propose des scènes qui ne sont pas encore dans le séquencier.</p>
                             </div>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="scan-nb-scenes" className="text-xs font-bold text-slate-400 uppercase mb-2 block">Combien de scènes</label>
                                <input
                                    id="scan-nb-scenes"
                                    type="number"
                                    min={1}
                                    max={30}
                                    value={scanCount}
                                    onChange={(e) => setScanCount(Math.min(30, Math.max(1, parseInt(e.target.value) || 1)))}
                                    className="w-full bg-dark border border-white/10 rounded-lg p-3 min-h-[44px] text-white focus:border-primary focus:outline-none"
                                />
                            </div>
                            <div>
                                <label htmlFor="scan-indices" className="text-xs font-bold text-slate-400 uppercase mb-2 block">Indices (facultatif)</label>
                                <input
                                    id="scan-indices"
                                    type="text"
                                    className="w-full bg-dark border border-white/10 rounded-lg p-3 min-h-[44px] text-white focus:border-primary focus:outline-none"
                                    placeholder="Ex : la scène du naufrage..."
                                    value={scanHints}
                                    onChange={(e) => setScanHints(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Titre</label>
                                <input className="w-full bg-dark border border-white/10 rounded-lg p-3 text-white focus:border-primary focus:outline-none" placeholder="Titre de la scène" value={manualForm.title} onChange={e => setManualForm({...manualForm, title: e.target.value})} />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Lieu / Décor</label>
                                <div className="flex gap-2">
                                     <select 
                                        className="bg-dark border border-white/10 rounded-lg p-3 text-white text-xs w-full"
                                        value={manualForm.environmentId || ''}
                                        onChange={e => setManualForm({...manualForm, environmentId: e.target.value || undefined})}
                                     >
                                        <option value="">-- Texte Libre (Ci-dessous) --</option>
                                        {allEnvironments.map(env => (
                                            <option key={env.id} value={env.id}>{env.name}</option>
                                        ))}
                                     </select>
                                     <button 
                                        onClick={openEnvModal} 
                                        className="bg-surface-highlight border border-white/10 rounded-lg w-12 flex items-center justify-center hover:bg-white/10 text-white transition"
                                        title={manualForm.environmentId ? "Modifier ce décor" : "Créer un nouveau décor"}
                                     >
                                         <i className="fas fa-pen text-xs" aria-hidden="true"></i>
                                     </button>
                                </div>
                                {!manualForm.environmentId && (
                                     <input className="w-full bg-dark border border-white/10 rounded-lg p-3 text-white focus:border-primary focus:outline-none mt-2" placeholder="Nom du lieu manuel" value={manualForm.location} onChange={e => setManualForm({...manualForm, location: e.target.value})} />
                                )}
                            </div>
                        </div>
                        
                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Personnages présents</label>
                            <div className="flex gap-2 flex-wrap pb-2 bg-dark/30 p-2 rounded-lg border border-white/5">
                            {allCharacters.map(char => (
                                <button 
                                    key={char.id} 
                                    onClick={() => toggleCharInManual(char.name)} 
                                    className={`px-3 py-1.5 text-xs rounded-full border transition-all ${manualForm.charactersPresent.includes(char.name) ? 'bg-primary text-white border-primary' : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white'}`}
                                >
                                    {char.name}
                                </button>
                            ))}
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Description Visuelle</label>
                            <textarea className="w-full bg-dark border border-white/10 rounded-lg p-3 text-white h-24 focus:border-primary focus:outline-none text-sm" placeholder="Action..." value={manualForm.description} onChange={e => setManualForm({...manualForm, description: e.target.value})} />
                        </div>

                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Texte Original</label>
                            <textarea className="w-full bg-dark border border-white/10 rounded-lg p-3 text-white h-24 font-serif text-slate-400 mt-1 italic" placeholder="Passage du livre..." value={manualForm.originalTextExcerpt} onChange={e => setManualForm({...manualForm, originalTextExcerpt: e.target.value})} />
                        </div>
                    </div>
                )}
            </div>

            <div className="p-4 border-t border-white/10 flex justify-end gap-3 bg-white/5">
                <button onClick={() => setShowModal(false)} className="px-5 py-2 text-slate-400 hover:text-white text-sm font-medium transition">Annuler</button>
                <button onClick={handleSubmit} disabled={isProcessing} className="px-6 py-2 bg-primary hover:bg-primary-hover text-white text-sm font-bold rounded-lg shadow-lg">
                    {isProcessing ? <i className="fas fa-circle-notch fa-spin" aria-hidden="true"></i> : "Confirmer"}
                </button>
            </div>
          </div>
        </div>
      )}

      {/* Environment Quick Edit Modal */}
      {showEnvModal && (
          <div className="fixed inset-0 bg-black/90 z-[90] flex items-center justify-center p-4">
              <div className="bg-surface border border-white/10 rounded-xl w-full max-w-lg p-6 animate-fade-in shadow-2xl">
                  <h4 className="text-white font-bold mb-4">{envForm.id ? 'Modifier le Décor' : 'Nouveau Décor'}</h4>
                  <div className="space-y-4">
                       <input className="w-full bg-dark border border-white/10 rounded p-3 text-white" placeholder="Nom du lieu (ex: Le Salon)" value={envForm.name} onChange={e => setEnvForm({...envForm, name: e.target.value})} />
                       <div className="grid grid-cols-2 gap-4">
                           <select className="bg-dark border border-white/10 rounded p-3 text-white" value={envForm.type} onChange={e => setEnvForm({...envForm, type: e.target.value})}>
                               <option value="indoor">Intérieur</option>
                               <option value="outdoor">Extérieur</option>
                               <option value="space">Espace / SF</option>
                               <option value="abstract">Abstrait</option>
                           </select>
                           <input className="w-full bg-dark border border-white/10 rounded p-3 text-white" placeholder="Ambiance" value={envForm.mood} onChange={e => setEnvForm({...envForm, mood: e.target.value})} />
                       </div>
                       <textarea className="w-full bg-dark border border-white/10 rounded p-3 text-white h-32" placeholder="Description visuelle..." value={envForm.description} onChange={e => setEnvForm({...envForm, description: e.target.value})} />
                  </div>
                  <div className="flex justify-end gap-3 mt-6">
                       <button onClick={() => setShowEnvModal(false)} className="text-slate-400">Annuler</button>
                       <button onClick={handleEnvSubmit} className="bg-green-600 text-white px-4 py-2 rounded">Enregistrer</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default SceneReview;
