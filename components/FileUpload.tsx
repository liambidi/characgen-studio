import React, { useCallback, useState } from 'react';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  isLoading: boolean;
  /**
   * Etape en cours de l'analyse, par exemple "Lecture du recit : 4 tranches sur 12".
   * L'analyse d'un roman entier peut durer plusieurs minutes : sans ce texte,
   * l'attente ressemble a une application figee.
   */
  progression?: string;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileSelect, isLoading, progression }) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragging(true);
    } else if (e.type === 'dragleave') {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onFileSelect(e.dataTransfer.files[0]);
    }
  }, [onFileSelect]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
    }
  };

  return (
    <div id="upload-area" className="w-full max-w-2xl mx-auto px-4">
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={`
          relative group cursor-pointer overflow-hidden rounded-3xl transition-all duration-500 ease-out
          ${isDragging 
            ? 'bg-primary/5 ring-2 ring-primary scale-[1.02]' 
            : 'bg-surface-highlight/30 hover:bg-surface-highlight/50 ring-1 ring-white/10 hover:ring-white/20'}
          ${isLoading ? 'opacity-50 pointer-events-none' : ''}
        `}
      >
        <input
          type="file"
          id="file-upload"
          className="hidden"
          accept=".pdf,.txt,.md"
          onChange={handleChange}
          disabled={isLoading}
        />

        {/* Decorative Grid Background */}
        <div className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none" 
             style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
        </div>
        
        <div className="relative z-10 flex flex-col items-center justify-center py-20 px-8 text-center">
          
          {/* Icon Container with Glow */}
          <div className={`
             relative w-24 h-24 mb-8 rounded-full flex items-center justify-center transition-all duration-500
             ${isDragging ? 'bg-primary/20 shadow-[0_0_40px_rgba(99,102,241,0.3)]' : 'bg-white/5 group-hover:bg-white/10'}
          `}>
            {isLoading ? (
               <div className="absolute inset-0 rounded-full border-t-2 border-primary animate-spin"></div>
            ) : null}
            
            <i className={`fas fa-file-import text-4xl transition-colors duration-300 ${isDragging || isLoading ? 'text-primary' : 'text-slate-400 group-hover:text-white'}`} aria-hidden="true"></i>
          </div>
          
          <h2 className="text-3xl font-heading font-bold text-white mb-3 tracking-tight">
            {isLoading ? 'Analyse en cours...' : 'Importez votre Histoire'}
          </h2>
          
          <p className="text-slate-400 max-w-sm mx-auto text-base leading-relaxed mb-8">
            {isLoading
              ? progression || "Préparation de l'analyse..."
              : <>Glissez-déposez votre PDF ou fichier texte ici. <br/>Notre IA se chargera d'extraire le casting et les lieux.</>}
          </p>
          
          <label
            htmlFor="file-upload"
            className="px-8 py-3.5 bg-white hover:bg-slate-200 text-dark font-bold rounded-full transition-all duration-300 transform hover:scale-105 shadow-lg shadow-white/5 flex items-center gap-2 cursor-pointer"
          >
            <i className="fas fa-plus" aria-hidden="true"></i>
            Sélectionner un fichier
          </label>
        </div>
      </div>
    </div>
  );
};

export default FileUpload;