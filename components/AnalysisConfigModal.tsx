import React, { useState } from 'react';

interface AnalysisConfigModalProps {
  type: 'character' | 'scene';
  onConfirm: (count: number | null) => void;
  onCancel: () => void;
}

const AnalysisConfigModal: React.FC<AnalysisConfigModalProps> = ({ type, onConfirm, onCancel }) => {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [count, setCount] = useState<number>(type === 'character' ? 5 : 10);

  const handleConfirm = () => {
      onConfirm(mode === 'auto' ? null : count);
  };

  return (
    <div className="fixed inset-0 bg-dark/90 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <div className="bg-surface border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl animate-bounce-short overflow-hidden">
        
        <div className="p-6 bg-gradient-to-r from-slate-800 to-slate-900 border-b border-slate-700 text-center">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 ${type === 'character' ? 'bg-primary/20 text-primary' : 'bg-green-500/20 text-green-500'}`}>
                <i className={`fas ${type === 'character' ? 'fa-users' : 'fa-film'} text-2xl`} aria-hidden="true"></i>
            </div>
            <h3 className="text-xl font-bold text-white">
                {type === 'character' ? 'Analyse des Personnages' : 'Analyse des Scènes'}
            </h3>
            <p className="text-slate-400 text-sm mt-1">
                Comment souhaitez-vous que l'IA procède ?
            </p>
        </div>

        <div className="p-6 space-y-4">
            {/* Auto Option */}
            <div 
                onClick={() => setMode('auto')}
                className={`p-4 rounded-xl border cursor-pointer transition flex items-center gap-4 ${mode === 'auto' ? 'bg-primary/10 border-primary' : 'bg-dark/50 border-slate-700 hover:border-slate-500'}`}
            >
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${mode === 'auto' ? 'border-primary' : 'border-slate-500'}`}>
                    {mode === 'auto' && <div className="w-3 h-3 rounded-full bg-primary"></div>}
                </div>
                <div>
                    <h4 className="text-white font-bold text-sm">Automatique (Recommandé)</h4>
                    <p className="text-xs text-slate-400">L'IA détecte tous les éléments importants.</p>
                </div>
            </div>

            {/* Manual Option */}
            <div 
                onClick={() => setMode('manual')}
                className={`p-4 rounded-xl border cursor-pointer transition flex items-center gap-4 ${mode === 'manual' ? 'bg-primary/10 border-primary' : 'bg-dark/50 border-slate-700 hover:border-slate-500'}`}
            >
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${mode === 'manual' ? 'border-primary' : 'border-slate-500'}`}>
                    {mode === 'manual' && <div className="w-3 h-3 rounded-full bg-primary"></div>}
                </div>
                <div className="flex-1">
                    <h4 className="text-white font-bold text-sm">Définir une quantité</h4>
                    <p className="text-xs text-slate-400 mb-2">Force l'IA à trouver un nombre précis.</p>
                    
                    {mode === 'manual' && (
                        <div className="flex items-center gap-3 mt-2" onClick={(e) => e.stopPropagation()}>
                            <button 
                                onClick={() => setCount(Math.max(1, count - 1))}
                                className="w-8 h-8 rounded bg-slate-700 text-white hover:bg-slate-600"
                            >-</button>
                            <input 
                                type="number" 
                                value={count} 
                                onChange={(e) => setCount(parseInt(e.target.value) || 1)}
                                className="w-16 bg-dark border border-slate-600 rounded p-1 text-center text-white"
                            />
                            <button 
                                onClick={() => setCount(count + 1)}
                                className="w-8 h-8 rounded bg-slate-700 text-white hover:bg-slate-600"
                            >+</button>
                        </div>
                    )}
                </div>
            </div>
        </div>

        <div className="p-4 bg-dark/30 border-t border-slate-700 flex justify-end gap-3">
            <button onClick={onCancel} className="px-4 py-2 text-slate-400 hover:text-white text-sm">
                Annuler
            </button>
            <button 
                onClick={handleConfirm}
                className="px-6 py-2 bg-primary hover:bg-primary/80 text-white rounded-lg font-bold shadow-lg flex items-center gap-2"
            >
                {type === 'character' ? 'Lancer Casting' : 'Lancer Storyboard'} <i className="fas fa-arrow-right" aria-hidden="true"></i>
            </button>
        </div>
      </div>
    </div>
  );
};

export default AnalysisConfigModal;