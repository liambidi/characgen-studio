import React, { useState } from 'react';
import { editGeneratedImage } from '../services/geminiService';
import { notifierErreur } from '../services/notifications';

interface ImageEditorModalProps {
  imageUrl: string;
  onClose: () => void;
  onSave: (newUrl: string) => void;
}

const ImageEditorModal: React.FC<ImageEditorModalProps> = ({ imageUrl, onClose, onSave }) => {
  const [prompt, setPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentImage, setCurrentImage] = useState(imageUrl);
  const [history, setHistory] = useState<string[]>([imageUrl]);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);

  const handleRefUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const reader = new FileReader();
          reader.onload = (ev) => {
              setReferenceImage(ev.target?.result as string);
          };
          reader.readAsDataURL(e.target.files[0]);
      }
  };

  const handleEdit = async () => {
    if (!prompt.trim()) return;
    setIsProcessing(true);
    try {
        const newUrl = await editGeneratedImage(currentImage, prompt, referenceImage || undefined);
        setCurrentImage(newUrl);
        setHistory([...history, newUrl]);
        setPrompt('');
        setReferenceImage(null); // Clear ref after use
    } catch (e: any) {
        notifierErreur("Retouche impossible.", e);
    } finally {
        setIsProcessing(false);
    }
  };

  const handleUndo = () => {
      if (history.length > 1) {
          const newHistory = [...history];
          newHistory.pop();
          setHistory(newHistory);
          setCurrentImage(newHistory[newHistory.length - 1]);
      }
  };

  return (
    <div className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-lg w-full max-w-5xl h-[90vh] flex flex-col shadow-2xl overflow-hidden">
         <div className="p-4 border-b border-border flex justify-between items-center bg-zinc-900">
             <h3 className="text-white font-bold font-mono text-sm uppercase"><i className="fas fa-magic text-amber-500 mr-2" aria-hidden="true"></i> Magic Editor (Gemini 2.5)</h3>
             <button onClick={onClose}><i className="fas fa-times text-zinc-400 hover:text-white" aria-hidden="true"></i></button>
         </div>

         <div className="flex-1 flex overflow-hidden">
             {/* Image Preview */}
             <div className="flex-1 bg-black flex items-center justify-center p-4 relative">
                 <img src={currentImage} className="max-w-full max-h-full object-contain" alt="Editing" />
                 {isProcessing && (
                     <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                         <div className="text-center">
                             <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin mb-2 mx-auto"></div>
                             <span className="text-white font-mono text-xs uppercase">Processing Edit...</span>
                         </div>
                     </div>
                 )}
             </div>

             {/* Sidebar */}
             <div className="w-80 bg-zinc-900 border-l border-border p-4 flex flex-col gap-4 overflow-y-auto">
                 <div>
                     <label className="text-[10px] font-bold text-zinc-400 uppercase mb-2 block">Reference Image (Optional)</label>
                     <div className="border border-zinc-700 border-dashed rounded p-4 text-center hover:bg-zinc-800 transition relative">
                         <input type="file" accept="image/*" onChange={handleRefUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                         {referenceImage ? (
                             <img src={referenceImage} className="h-20 mx-auto object-contain" />
                         ) : (
                             <div className="text-zinc-400 text-xs">
                                 <i className="fas fa-image text-xl mb-1 block" aria-hidden="true"></i>
                                 Click to upload reference
                             </div>
                         )}
                     </div>
                 </div>

                 <div className="flex-1">
                     <label className="text-[10px] font-bold text-zinc-400 uppercase mb-2 block">Instruction</label>
                     <textarea 
                        className="w-full bg-black border border-zinc-700 rounded p-3 text-sm text-white h-32 resize-none focus:border-white focus:outline-none"
                        placeholder="Ex: Change the lighting to sunset..."
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                     />
                 </div>
                 
                 <button 
                    onClick={handleEdit}
                    disabled={isProcessing || !prompt}
                    className="w-full py-3 bg-white text-black font-bold uppercase text-xs rounded hover:bg-zinc-200 transition disabled:opacity-50"
                 >
                     Apply Edit
                 </button>

                 <div className="flex gap-2">
                     <button onClick={handleUndo} disabled={history.length <= 1} className="flex-1 py-2 border border-zinc-700 text-zinc-400 hover:text-white rounded text-xs disabled:opacity-30">
                         <i className="fas fa-undo" aria-hidden="true"></i> Undo
                     </button>
                 </div>

                 <button 
                    onClick={() => onSave(currentImage)}
                    className="w-full py-3 bg-green-600 hover:bg-green-500 text-white font-bold uppercase text-xs rounded transition mt-auto"
                 >
                     Save & Close
                 </button>
             </div>
         </div>
      </div>
    </div>
  );
};

export default ImageEditorModal;