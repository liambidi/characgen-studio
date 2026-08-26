import React, { useState } from 'react';
import { Character } from '../types';
import { notifier, notifierErreur } from '../services/notifications';

interface CharacterReviewProps {
  characters: Character[];
  stylePrompt: string;
  onStyleChange: (style: string) => void;
  onRemoveCharacter: (id: string) => void;
  onAddCharacter: (method: 'manual' | 'ai', data: any) => Promise<void>;
  onUpdateCharacter: (id: string, data: Partial<Character>) => void;
  onFindMoreCharacters: (count?: number, hints?: string) => Promise<void>;
  onRegenerateText: (id: string, name: string) => Promise<Partial<Character>>;
  onGenerate: () => void;
}

const ART_STYLES = [
  { label: "Cinématique Réaliste", value: "Cinematic concept art, highly detailed, photorealistic, 8k, dramatic lighting, movie still" },
  { label: "Animation 3D (Pixar)", value: "3D render style, cute, expressive, Pixar style, Disney animation, vibrant colors, soft lighting, 4k" },
  { label: "Anime / Manga", value: "Anime style, Studio Ghibli inspired, detailed line art, vibrant colors, cel shaded" },
  { label: "Aquarelle & Encre", value: "Soft watercolor painting, storybook illustration, ink lines, pastel colors, whimsical" },
  { label: "Dark Fantasy", value: "Dark fantasy, oil painting style, grim, textured, Frank Frazetta style, mysterious atmosphere" },
  { label: "Cyberpunk", value: "Cyberpunk, neon lights, futuristic, high tech, digital art, sharp focus, synthwave colors" },
  { label: "Comics US", value: "Comic book style, bold outlines, flat colors, dynamic shading, Marvel/DC style illustration" },
  { label: "Croquis Fusain", value: "Charcoal sketch, pencil drawing, rough texture, artistic, monochrome with splash of color" }
];

const CharacterReview: React.FC<CharacterReviewProps> = ({
  characters,
  stylePrompt,
  onStyleChange,
  onRemoveCharacter,
  onAddCharacter,
  onUpdateCharacter,
  onFindMoreCharacters,
  onRegenerateText,
  onGenerate
}) => {
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [addMethod, setAddMethod] = useState<'manual' | 'ai' | 'scan'>('ai');
  const [isProcessing, setIsProcessing] = useState(false);

  // Edit State
  const [editingCharId, setEditingCharId] = useState<string | null>(null);

  // Scan State
  const [scanCount, setScanCount] = useState<number>(1);
  const [scanNames, setScanNames] = useState<string>('');

  // Form State
  const [form, setForm] = useState({
    name: '',
    role: '',
    shortDescription: '',
    personality: '',
    physicalDescription: '',
    customVisualPrompt: ''
  });

  const [aiPrompt, setAiPrompt] = useState('');

  const openAddModal = () => {
      setModalMode('add');
      setAddMethod('ai');
      setForm({ name: '', role: '', shortDescription: '', personality: '', physicalDescription: '', customVisualPrompt: '' });
      setAiPrompt('');
      setScanCount(1);
      setScanNames('');
      setShowModal(true);
  };

  const openEditModal = (char: Character) => {
      setModalMode('edit');
      setEditingCharId(char.id);
      setForm({
          name: char.name,
          role: char.role,
          shortDescription: char.shortDescription,
          personality: char.personality,
          physicalDescription: char.physicalDescription,
          customVisualPrompt: char.customVisualPrompt || ''
      });
      setShowModal(true);
  };

  const handleRegenerateDescription = async () => {
      if (!editingCharId || !form.name) return;
      setIsProcessing(true);
      try {
        const newData = await onRegenerateText(editingCharId, form.name);
        setForm(prev => ({
            ...prev,
            role: newData.role || prev.role,
            shortDescription: newData.shortDescription || prev.shortDescription,
            personality: newData.personality || prev.personality,
            physicalDescription: newData.physicalDescription || prev.physicalDescription
        }));
      } catch (e: any) {
          notifierErreur("Relecture du texte impossible.", e);
      } finally {
          setIsProcessing(false);
      }
  };

  const handleSubmit = async () => {
    if (modalMode === 'edit' && editingCharId) {
        if (!form.name.trim()) { notifier("Le nom du personnage est obligatoire.", 'info'); return; }
        onUpdateCharacter(editingCharId, form);
        setShowModal(false);
        return;
    }

    if (addMethod === 'scan') {
        setIsProcessing(true);
        await onFindMoreCharacters(scanCount, scanNames);
        setIsProcessing(false);
        setShowModal(false);
        return;
    }

    if (addMethod === 'manual') {
      if (!form.name || !form.physicalDescription) {
        notifier("Le nom et la description physique sont obligatoires.", 'info');
        return;
      }
      await onAddCharacter('manual', form);
      setShowModal(false);
    } else {
      if (!aiPrompt) return;
      setIsProcessing(true);
      await onAddCharacter('ai', { prompt: aiPrompt });
      setIsProcessing(false);
      setShowModal(false);
    }
  };

  return (
    <div className="w-full space-y-10 animate-fade-in pb-32">
      
      {/* Style Section */}
      <div className="glass-panel p-8 rounded-3xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl pointer-events-none -translate-y-1/2 translate-x-1/2"></div>
        
        <div className="relative z-10">
            <h2 className="text-2xl font-heading font-bold text-white mb-6 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-secondary/20 flex items-center justify-center text-secondary">
                 <i className="fas fa-palette" aria-hidden="true"></i>
            </div>
            Direction Artistique
            </h2>
            
            <div className="space-y-6">
                <div>
                    <input
                        type="text"
                        value={stylePrompt}
                        onChange={(e) => onStyleChange(e.target.value)}
                        className="w-full bg-dark/50 border border-white/10 rounded-xl px-5 py-4 text-white placeholder-slate-400 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition shadow-inner"
                        placeholder="Ex: Cyberpunk 2077 style, neon lights..."
                    />
                </div>
                
                <div className="flex flex-wrap gap-2">
                    {ART_STYLES.map((style) => (
                        <button
                            key={style.label}
                            onClick={() => onStyleChange(style.value)}
                            className={`px-4 py-2 rounded-full text-xs font-semibold border transition-all duration-300
                                ${stylePrompt === style.value 
                                    ? 'bg-white text-dark border-white shadow-[0_0_15px_rgba(255,255,255,0.3)]' 
                                    : 'bg-transparent text-slate-400 border-slate-700 hover:border-slate-500 hover:text-white'}
                            `}
                        >
                            {style.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
      </div>

      {/* Characters Header */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-4 border-b border-white/5 pb-4">
        <div>
             <h2 className="text-3xl font-heading font-bold text-white mb-2">
                Casting <span className="text-xl text-slate-400 font-normal ml-2">({characters.length})</span>
             </h2>
             <p className="text-slate-400">Gérez les profils qui composeront votre histoire.</p>
        </div>
        <button 
            onClick={openAddModal}
            className="px-6 py-3 bg-surface-highlight hover:bg-white/10 text-white rounded-xl text-sm font-semibold border border-white/10 transition flex items-center gap-2 group"
        >
            <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors">
                <i className="fas fa-plus text-xs" aria-hidden="true"></i>
            </span> 
            Ajouter un personnage
        </button>
      </div>
        
      {/* Characters Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {characters.map((char) => (
            <div key={char.id} className="group glass-card rounded-2xl p-6 hover:bg-surface-highlight/60 transition-all duration-300 relative overflow-hidden">
              
              {/* Actions Overlay */}
              {/* Ces deux boutons n'avaient ni libellé ni texte masqué, seulement une
                  icône marquée décorative : un lecteur d'écran annonçait « bouton »
                  deux fois de suite, sans dire lequel supprime. Ils restaient aussi
                  invisibles sur écran tactile, faute de survol : ils apparaissent
                  maintenant dès que le focus entre dans la carte. */}
              <div className="absolute top-4 right-4 flex gap-2 z-20 opacity-0 max-sm:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity transform translate-x-2 group-hover:translate-x-0 duration-300">
                 <button
                    onClick={() => openEditModal(char)}
                    aria-label={`Modifier la fiche de ${char.name}`}
                    className="w-8 h-8 bg-black/50 hover:bg-primary backdrop-blur rounded-lg flex items-center justify-center text-white/70 hover:text-white transition"
                  >
                    <i className="fas fa-pen text-xs" aria-hidden="true"></i>
                  </button>
                  <button
                    onClick={() => onRemoveCharacter(char.id)}
                    aria-label={`Supprimer le personnage ${char.name}`}
                    className="w-8 h-8 bg-black/50 hover:bg-red-500 backdrop-blur rounded-lg flex items-center justify-center text-white/70 hover:text-white transition"
                  >
                    <i className="fas fa-times text-xs" aria-hidden="true"></i>
                  </button>
              </div>
              
              {/* Header */}
              <div className="flex items-start gap-4 mb-6 relative z-10">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-b from-surface-highlight to-dark border border-white/10 flex items-center justify-center shrink-0 shadow-lg text-2xl font-heading font-bold text-white/50 group-hover:text-primary transition-colors">
                  {char.name.charAt(0)}
                </div>
                <div>
                  <h3 className="font-heading font-bold text-xl text-white leading-tight mb-1 group-hover:text-primary transition-colors">{char.name}</h3>
                  <span className="text-xs font-bold text-secondary uppercase tracking-wider bg-secondary/10 px-2 py-0.5 rounded">
                    {char.role}
                  </span>
                </div>
              </div>
              
              {/* Content */}
              <div className="space-y-4 relative z-10">
                 <p className="text-sm text-slate-300 italic border-l-2 border-primary/30 pl-3">
                    "{char.shortDescription}"
                 </p>

                 <div className="grid grid-cols-2 gap-3 mt-4">
                    <div className="bg-dark/40 rounded-xl p-3 border border-white/5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Traits</span>
                        <p className="text-xs text-slate-300 line-clamp-4 leading-relaxed">
                           {char.personality || "Non défini"}
                        </p>
                    </div>
                    <div className="bg-dark/40 rounded-xl p-3 border border-white/5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Visuel</span>
                        <p className="text-xs text-slate-300 line-clamp-4 leading-relaxed">
                           {char.physicalDescription}
                        </p>
                    </div>
                 </div>

                 {char.customVisualPrompt && (
                     <div className="mt-2 p-2 bg-amber-500/5 border border-amber-500/20 rounded">
                        <div className="flex items-center gap-2 mb-1">
                            <i className="fas fa-terminal text-[10px] text-amber-500" aria-hidden="true"></i>
                            <span className="text-[9px] font-mono text-amber-500 uppercase">Consigne imposée</span>
                        </div>
                        <p className="text-[9px] text-amber-500/70 font-mono line-clamp-1 truncate">
                            {char.customVisualPrompt}
                        </p>
                    </div>
                 )}
              </div>
            </div>
          ))}
      </div>

      <div className="flex justify-center pt-12">
        <button
          onClick={onGenerate}
          className="group relative px-8 py-4 bg-primary text-white font-bold rounded-full overflow-hidden shadow-[0_0_20px_rgba(99,102,241,0.4)] transition-transform hover:scale-105"
        >
          <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:animate-[shimmer_1.5s_infinite]"></div>
          <span className="relative flex items-center gap-3">
              <i className="fas fa-wand-magic-sparkles" aria-hidden="true"></i>
              Générer les Fiches Personnages
          </span>
        </button>
      </div>

      {/* Modal - Aligned to Top */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[80] flex items-start justify-center pt-24 p-4 overflow-y-auto">
          <div className="bg-[#0f172a] border border-white/10 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col animate-fade-in mb-20">
            
            <div className="p-5 border-b border-white/5 flex justify-between items-center bg-white/5">
              <h3 className="text-white font-heading font-bold text-lg">
                  {modalMode === 'edit' ? 'Modifier le personnage' : 'Nouveau Profil'}
              </h3>
              <button onClick={() => setShowModal(false)} className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-slate-400 transition">
                <i className="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>
            
            {modalMode === 'add' && (
                <div className="grid grid-cols-3 border-b border-white/5 p-1 bg-black/20">
                    {['ai', 'scan', 'manual'].map((m) => (
                        <button 
                            key={m}
                            className={`py-2 text-xs font-bold uppercase tracking-wide rounded-lg transition-all ${addMethod === m ? 'bg-primary text-white shadow-lg' : 'text-slate-400 hover:text-slate-300'}`}
                            onClick={() => setAddMethod(m as any)}
                        >
                            {m === 'ai' ? 'IA rapide' : m === 'scan' ? 'Chercher' : 'Manuel'}
                        </button>
                    ))}
                </div>
            )}

            <div className="p-6">
                {modalMode === 'add' && addMethod === 'scan' ? (
                     <div className="space-y-6">
                        <div className="bg-purple-500/10 p-4 rounded-xl border border-purple-500/20 flex gap-4">
                             <div className="text-2xl text-purple-400"><i className="fas fa-search" aria-hidden="true"></i></div>
                             <div>
                                <h4 className="font-bold text-white text-sm">Chercher dans le récit</h4>
                                <p className="text-xs text-slate-300 mt-1">Indiquez ce qui manque, l'IA relit votre texte pour le trouver.</p>
                             </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Quantité</label>
                                <input 
                                    type="number" 
                                    value={scanCount} 
                                    onChange={(e) => setScanCount(parseInt(e.target.value) || 1)}
                                    className="w-full bg-dark border border-white/10 rounded-lg p-3 text-white focus:border-primary focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Noms / Indices</label>
                                <input
                                    type="text"
                                    className="w-full bg-dark border border-white/10 rounded-lg p-3 text-white focus:border-purple-500 focus:outline-none"
                                    placeholder="Ex: Le frère du héros..."
                                    value={scanNames}
                                    onChange={(e) => setScanNames(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                ) : modalMode === 'add' && addMethod === 'ai' ? (
                    <div>
                         <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Prompt rapide</label>
                        <textarea
                            className="w-full bg-dark border border-white/10 rounded-xl p-4 text-white h-40 focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none resize-none"
                            placeholder="Décrivez le personnage en quelques mots..."
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                        ></textarea>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {modalMode === 'edit' && (
                             <button 
                                onClick={handleRegenerateDescription}
                                disabled={isProcessing}
                                className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold text-primary uppercase tracking-wider transition flex items-center justify-center gap-2"
                            >
                                <i className="fas fa-sync-alt" aria-hidden="true"></i> Re-scanner le texte pour ce perso
                            </button>
                        )}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="col-span-1">
                                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Nom</label>
                                <input 
                                    type="text" 
                                    className="w-full bg-dark border border-white/10 rounded-lg p-3 text-white focus:border-primary focus:outline-none"
                                    value={form.name}
                                    onChange={(e) => setForm({...form, name: e.target.value})}
                                />
                            </div>
                            <div className="col-span-1">
                                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Rôle</label>
                                <input 
                                    type="text" 
                                    className="w-full bg-dark border border-white/10 rounded-lg p-3 text-white focus:border-primary focus:outline-none"
                                    value={form.role}
                                    onChange={(e) => setForm({...form, role: e.target.value})}
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Accroche</label>
                            <input 
                                type="text" 
                                className="w-full bg-dark border border-white/10 rounded-lg p-3 text-white focus:border-primary focus:outline-none"
                                value={form.shortDescription}
                                onChange={(e) => setForm({...form, shortDescription: e.target.value})}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Psychologie</label>
                                <textarea 
                                    className="w-full bg-dark border border-white/10 rounded-lg p-3 text-white h-32 text-sm focus:border-primary focus:outline-none resize-none"
                                    value={form.personality}
                                    onChange={(e) => setForm({...form, personality: e.target.value})}
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Physique</label>
                                <textarea 
                                    className="w-full bg-dark border border-white/10 rounded-lg p-3 text-white h-32 text-sm focus:border-primary focus:outline-none resize-none"
                                    value={form.physicalDescription}
                                    onChange={(e) => setForm({...form, physicalDescription: e.target.value})}
                                />
                            </div>
                        </div>

                         {/* Consigne libre, qui remplace la description au moment de générer l'image */}
                        <div className="pt-4 border-t border-white/10 mt-4">
                             <div className="flex justify-between items-center mb-2">
                                <label htmlFor="consigne-perso" className="text-[10px] font-bold text-amber-500 uppercase flex items-center gap-2">
                                    <i className="fas fa-terminal" aria-hidden="true"></i> Consigne imposée à l'IA
                                </label>
                                <span className="text-[9px] text-zinc-400 uppercase font-mono">Avancé</span>
                             </div>
                             <textarea
                                id="consigne-perso"
                                className="w-full bg-amber-950/10 border border-amber-900/30 rounded-lg p-3 text-amber-100 placeholder-amber-900/50 text-xs font-mono h-24 focus:border-amber-500 focus:outline-none resize-none"
                                placeholder="Texte envoyé tel quel à l'IA. Il remplace la description physique ci-dessus au moment de dessiner."
                                value={form.customVisualPrompt}
                                onChange={(e) => setForm({...form, customVisualPrompt: e.target.value})}
                             />
                        </div>
                    </div>
                )}
            </div>

            <div className="p-4 bg-white/5 border-t border-white/5 flex justify-end gap-3">
                <button 
                    onClick={() => setShowModal(false)}
                    className="px-5 py-2.5 text-slate-400 hover:text-white text-sm font-medium transition"
                >
                    Annuler
                </button>
                <button 
                    onClick={handleSubmit}
                    disabled={isProcessing}
                    className="px-6 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-bold shadow-lg shadow-primary/25 transition flex items-center gap-2"
                >
                    {isProcessing && <i className="fas fa-circle-notch fa-spin" aria-hidden="true"></i>}
                    Confirmer
                </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CharacterReview;