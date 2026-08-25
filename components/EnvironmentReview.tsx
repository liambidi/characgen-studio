import React, { useState } from 'react';
import { Environment } from '../types';
import { notifier } from '../services/notifications';

interface EnvironmentReviewProps {
  environments: Environment[];
  onRemoveEnvironment: (id: string) => void;
  onUpdateEnvironment: (id: string, data: Partial<Environment>) => void;
  onAddEnvironment: (method: 'manual'|'ai', data: any) => Promise<string | void>;
  onFindMoreEnvironments: (count?: number, hints?: string) => Promise<void>;
  onNext: () => void;
}

const EnvironmentReview: React.FC<EnvironmentReviewProps> = ({
  environments,
  onRemoveEnvironment,
  onUpdateEnvironment,
  onAddEnvironment,
  onFindMoreEnvironments,
  onNext
}) => {
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [addMethod, setAddMethod] = useState<'manual' | 'ai' | 'scan'>('ai');
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Scan State
  const [scanCount, setScanCount] = useState<number>(1);
  const [scanHints, setScanHints] = useState<string>('');
  
  // AI Prompt
  const [aiPrompt, setAiPrompt] = useState('');
  
  const [form, setForm] = useState<{name: string, type: any, description: string, mood: string}>({
      name: '', type: 'indoor', description: '', mood: ''
  });

  const openAdd = () => {
      setModalMode('add');
      setAddMethod('ai');
      setEditingId(null);
      setForm({ name: '', type: 'indoor', description: '', mood: '' });
      setAiPrompt('');
      setScanCount(1);
      setScanHints('');
      setShowModal(true);
  };

  const openEdit = (env: Environment) => {
      setModalMode('edit');
      setEditingId(env.id);
      setForm({
          name: env.name,
          type: env.type,
          description: env.description,
          mood: env.mood
      });
      setShowModal(true);
  };

  const handleSubmit = async () => {
      if (modalMode === 'edit' && editingId) {
          if (!form.name || !form.description) { notifier("Le nom et la description sont obligatoires.", 'info'); return; }
          onUpdateEnvironment(editingId, form);
          setShowModal(false);
          return;
      }

      if (addMethod === 'scan') {
          setIsProcessing(true);
          await onFindMoreEnvironments(scanCount, scanHints);
          setIsProcessing(false);
          setShowModal(false);
          return;
      }

      if (addMethod === 'manual') {
          if (!form.name || !form.description) { notifier("Le nom et la description sont obligatoires.", 'info'); return; }
          await onAddEnvironment('manual', form);
          setShowModal(false);
      } else {
          if (!aiPrompt) return;
          setIsProcessing(true);
          await onAddEnvironment('ai', { prompt: aiPrompt });
          setIsProcessing(false);
          setShowModal(false);
      }
  };

  return (
    <div className="w-full space-y-10 animate-fade-in pb-32">
       <div className="flex justify-between items-end border-b border-white/5 pb-4">
            <div>
                <h2 className="text-3xl font-heading font-bold text-white mb-2">
                    Lieux & Décors <span className="text-xl text-slate-400 font-normal ml-2">({environments.length})</span>
                </h2>
                <p className="text-slate-400">Définissez les environnements récurrents où l'action se déroule.</p>
            </div>
            <button onClick={openAdd} className="px-6 py-3 bg-surface-highlight hover:bg-white/10 text-white rounded-xl text-sm font-semibold border border-white/10 transition flex items-center gap-2 group">
                <span className="w-6 h-6 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center group-hover:bg-green-500 group-hover:text-white transition-colors">
                    <i className="fas fa-plus text-xs" aria-hidden="true"></i>
                </span>
                Ajouter / Scanner
            </button>
       </div>

       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
           {environments.map(env => (
               <div key={env.id} className="bg-surface/50 border border-white/5 rounded-2xl p-6 hover:border-green-500/30 transition group relative">
                   <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition">
                       <button onClick={() => openEdit(env)} className="w-8 h-8 bg-black/50 hover:bg-white text-white hover:text-black rounded flex items-center justify-center"><i className="fas fa-pen text-xs" aria-hidden="true"></i></button>
                       <button onClick={() => onRemoveEnvironment(env.id)} className="w-8 h-8 bg-black/50 hover:bg-red-500 text-white rounded flex items-center justify-center"><i className="fas fa-trash text-xs" aria-hidden="true"></i></button>
                   </div>
                   
                   <div className="flex items-center gap-3 mb-4">
                       <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-xl ${env.type === 'indoor' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-green-500/20 text-green-400'}`}>
                           <i className={`fas ${env.type === 'indoor' ? 'fa-home' : env.type === 'space' ? 'fa-rocket' : 'fa-tree'}`} aria-hidden="true"></i>
                       </div>
                       <div>
                           <h3 className="font-bold text-white text-lg leading-tight">{env.name}</h3>
                           <span className="text-xs text-slate-400 uppercase tracking-wider">{env.type} • {env.mood}</span>
                       </div>
                   </div>
                   
                   <div className="bg-black/20 p-3 rounded-lg border border-white/5">
                       <p className="text-xs text-slate-300 line-clamp-4">{env.description}</p>
                   </div>
               </div>
           ))}
       </div>

       <div className="flex justify-center pt-8">
            <button onClick={onNext} className="px-8 py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-full shadow-lg transition">
                Valider & Aller à la Galerie <i className="fas fa-arrow-right ml-2" aria-hidden="true"></i>
            </button>
       </div>

       {showModal && (
           <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[80] flex items-start justify-center pt-24 p-4 overflow-y-auto">
               <div className="bg-surface border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col mb-20">
                   <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
                       <h3 className="text-white font-bold mb-0">{modalMode === 'edit' ? 'Modifier le Lieu' : 'Nouveau Lieu'}</h3>
                       <button onClick={() => setShowModal(false)}><i className="fas fa-times text-slate-400 hover:text-white" aria-hidden="true"></i></button>
                   </div>
                   
                   {modalMode === 'add' && (
                        <div className="grid grid-cols-3 border-b border-white/5 p-1 bg-black/20">
                            {['ai', 'scan', 'manual'].map((m) => (
                                <button 
                                    key={m}
                                    className={`py-2 text-xs font-bold uppercase tracking-wide rounded-lg transition-all ${addMethod === m ? 'bg-green-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-300'}`}
                                    onClick={() => setAddMethod(m as any)}
                                >
                                    {m === 'ai' ? 'IA Magic' : m === 'scan' ? 'Scanner' : 'Manuel'}
                                </button>
                            ))}
                        </div>
                   )}

                   <div className="p-6">
                        {modalMode === 'add' && addMethod === 'scan' ? (
                             <div className="space-y-6">
                                <div className="bg-green-500/10 p-4 rounded-xl border border-green-500/20 flex gap-4">
                                     <div className="text-2xl text-green-400"><i className="fas fa-search" aria-hidden="true"></i></div>
                                     <div>
                                        <h4 className="font-bold text-white text-sm">Scan de Lieux</h4>
                                        <p className="text-xs text-slate-400 mt-1">L'IA analyse le texte pour trouver des décors récurrents manquants.</p>
                                     </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Quantité</label>
                                        <input 
                                            type="number" 
                                            value={scanCount} 
                                            onChange={(e) => setScanCount(parseInt(e.target.value) || 1)}
                                            className="w-full bg-dark border border-white/10 rounded-lg p-3 text-white focus:border-green-500 focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Mots-clés / Type</label>
                                        <input
                                            type="text"
                                            className="w-full bg-dark border border-white/10 rounded-lg p-3 text-white focus:border-green-500 focus:outline-none"
                                            placeholder="Ex: extérieurs, forêt..."
                                            value={scanHints}
                                            onChange={(e) => setScanHints(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>
                        ) : modalMode === 'add' && addMethod === 'ai' ? (
                             <div>
                                 <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Prompt rapide</label>
                                 <textarea 
                                    className="w-full bg-dark border border-white/10 rounded-xl p-4 text-white h-40 focus:border-green-500 focus:outline-none resize-none" 
                                    placeholder="Décrivez le lieu en quelques mots (ex: Une station spatiale abandonnée et rouillée)..." 
                                    value={aiPrompt} 
                                    onChange={e => setAiPrompt(e.target.value)}
                                 ></textarea>
                             </div>
                        ) : (
                           <div className="space-y-4">
                               <input className="w-full bg-dark border border-white/10 rounded p-3 text-white" placeholder="Nom du lieu (ex: Le Salon)" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
                               
                               <div className="grid grid-cols-2 gap-4">
                                   <select className="bg-dark border border-white/10 rounded p-3 text-white" value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
                                       <option value="indoor">Intérieur</option>
                                       <option value="outdoor">Extérieur</option>
                                       <option value="space">Espace / SF</option>
                                       <option value="abstract">Abstrait</option>
                                   </select>
                                   <input className="w-full bg-dark border border-white/10 rounded p-3 text-white" placeholder="Ambiance (Mood)" value={form.mood} onChange={e => setForm({...form, mood: e.target.value})} />
                               </div>

                               <textarea className="w-full bg-dark border border-white/10 rounded p-3 text-white h-32" placeholder="Description visuelle..." value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
                           </div>
                        )}
                   </div>

                   <div className="p-4 bg-white/5 border-t border-white/5 flex justify-end gap-3">
                       <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white px-4 py-2 text-sm">Annuler</button>
                       <button onClick={handleSubmit} disabled={isProcessing} className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded font-bold text-sm flex items-center gap-2">
                           {isProcessing && <i className="fas fa-circle-notch fa-spin" aria-hidden="true"></i>} Confirmer
                       </button>
                   </div>
               </div>
           </div>
       )}
    </div>
  );
};

export default EnvironmentReview;