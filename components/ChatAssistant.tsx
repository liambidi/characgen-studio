import React, { useState, useRef, useEffect } from 'react';
import { sendChatMessage, type ContexteProjet } from '../services/geminiService';
import { ChatMessage } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface ChatAssistantProps {
  /** Etat du projet, transmis a l'assistant pour qu'il sache de quoi on parle. */
  contexte?: ContexteProjet;
}

const MESSAGE_ACCUEIL: ChatMessage = {
  id: 'accueil',
  role: 'model',
  text: "Bonjour. Je connais votre projet : personnages, décors, scènes et style. Demandez-moi par exemple comment enrichir la description d'un personnage, ou envoyez-moi une image à analyser.",
  timestamp: 0,
};

const ChatAssistant: React.FC<ChatAssistantProps> = ({ contexte }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([MESSAGE_ACCUEIL]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const zoneSaisieRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  // Le focus arrive dans le champ a l'ouverture, la touche Echap referme.
  useEffect(() => {
    if (!isOpen) return;
    zoneSaisieRef.current?.focus();
    const auClavier = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    window.addEventListener('keydown', auClavier);
    return () => window.removeEventListener('keydown', auClavier);
  }, [isOpen]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => setSelectedImage(ev.target?.result as string);
      reader.readAsDataURL(file);
      e.target.value = '';
  };

  const handleSend = async () => {
    if ((!input.trim() && !selectedImage) || isLoading) return;

    const userMsg: ChatMessage = {
        id: uuidv4(),
        role: 'user',
        text: input,
        image: selectedImage || undefined,
        timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSelectedImage(null);
    setIsLoading(true);

    try {
        // Le message d'accueil n'appartient pas a la conversation reelle.
        const history = messages
            .filter(m => m.id !== 'accueil')
            .map(m => ({
                role: m.role,
                parts: m.image
                    ? [{ text: m.text }, { inlineData: { data: m.image.split(',')[1], mimeType: 'image/png' } }]
                    : [{ text: m.text }]
            }));

        const responseText = await sendChatMessage(history, userMsg.text, userMsg.image, contexte);

        setMessages(prev => [...prev, {
            id: uuidv4(),
            role: 'model',
            text: responseText || "Je n'ai pas de réponse à donner.",
            timestamp: Date.now()
        }]);
    } catch (e: any) {
        setMessages(prev => [...prev, {
            id: uuidv4(),
            role: 'model',
            text: `Je n'ai pas pu répondre : ${e?.message || 'erreur inconnue'}`,
            timestamp: Date.now()
        }]);
    } finally {
        setIsLoading(false);
    }
  };

  const nbPersonnages = contexte?.personnages?.length || 0;

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? "Fermer l'assistant" : "Ouvrir l'assistant créatif"}
        aria-expanded={isOpen}
        className="fixed bottom-6 left-6 z-[90] w-14 h-14 bg-white text-black rounded-full shadow-2xl flex items-center justify-center hover:bg-slate-200 transition print:hidden"
      >
        <i className={`fas ${isOpen ? 'fa-times' : 'fa-comment-dots'} text-lg`} aria-hidden="true"></i>
      </button>

      {isOpen && (
        <div
          className="fixed bottom-24 left-4 sm:left-6 z-[90] w-[min(24rem,calc(100vw-2rem))] h-[min(32rem,calc(100vh-9rem))] bg-surface border border-white/10 rounded-2xl shadow-2xl flex flex-col animate-fade-in overflow-hidden print:hidden"
          role="dialog"
          aria-label="Assistant créatif"
        >
            <div className="p-4 border-b border-white/10 bg-white/5 flex justify-between items-center shrink-0">
                <h3 className="text-white font-heading font-bold text-sm flex items-center gap-2">
                    <i className="fas fa-wand-magic-sparkles text-amber-400" aria-hidden="true"></i> Assistant créatif
                </h3>
                <span className="text-[10px] text-slate-400 font-mono uppercase">
                  {nbPersonnages > 0 ? `${nbPersonnages} perso${nbPersonnages > 1 ? 's' : ''} connus` : 'Projet vide'}
                </span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                {messages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-xl p-3 text-sm ${msg.role === 'user' ? 'bg-primary text-white' : 'bg-white/5 border border-white/10 text-slate-200'}`}>
                            {msg.image && (
                                <img src={msg.image} className="w-full h-auto rounded-lg mb-2 border border-black/20" alt="Image envoyée par vous" />
                            )}
                            <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                        </div>
                    </div>
                ))}

                {isLoading && (
                     <div className="flex justify-start" role="status" aria-label="L'assistant rédige sa réponse">
                        <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center gap-1.5">
                            <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></span>
                            <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '120ms' }}></span>
                            <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '240ms' }}></span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="p-3 border-t border-white/10 bg-white/5 shrink-0">
                {selectedImage && (
                    <div className="mb-2 flex items-center gap-2 bg-black/40 p-2 rounded-lg">
                        <img src={selectedImage} alt="" className="w-8 h-8 object-cover rounded" />
                        <span className="text-xs text-slate-300 truncate flex-1">Image jointe</span>
                        <button onClick={() => setSelectedImage(null)} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-white" aria-label="Retirer l'image jointe">
                            <i className="fas fa-times text-xs" aria-hidden="true"></i>
                        </button>
                    </div>
                )}
                <div className="flex items-end gap-2">
                    <label className="cursor-pointer text-slate-400 hover:text-white w-11 h-11 flex items-center justify-center rounded-lg hover:bg-white/5 transition shrink-0">
                        <input type="file" accept="image/*" className="sr-only" onChange={handleImageSelect} />
                        <i className="fas fa-image" aria-hidden="true"></i>
                        <span className="sr-only">Joindre une image</span>
                    </label>

                    <textarea
                        ref={zoneSaisieRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                        className="flex-1 bg-dark border border-white/10 rounded-lg p-2.5 text-sm text-white resize-none h-11 focus:h-24 transition-all focus:outline-none focus:border-primary"
                        placeholder="Poser une question..."
                        aria-label="Votre message"
                    />

                    <button
                        onClick={handleSend}
                        disabled={isLoading || (!input.trim() && !selectedImage)}
                        className="w-11 h-11 flex items-center justify-center text-white hover:text-amber-400 disabled:opacity-40 disabled:hover:text-white transition shrink-0 rounded-lg hover:bg-white/5"
                        aria-label="Envoyer le message"
                    >
                        <i className="fas fa-paper-plane" aria-hidden="true"></i>
                    </button>
                </div>
            </div>
        </div>
      )}
    </>
  );
};

export default ChatAssistant;
