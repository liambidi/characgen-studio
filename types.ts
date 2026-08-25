export interface Character {
  id: string;
  name: string;
  role: string;
  shortDescription: string; // One liner
  personality: string; // New: Deeper psychological traits
  physicalDescription: string; // Detailed for AI
  customVisualPrompt?: string; // New: Manual override for image generation
  imageUrl?: string;
  status: 'pending' | 'generating' | 'completed' | 'error';
  /** Raison de l'echec, conservee pour etre affichee au lieu d'un simple carre rouge. */
  errorMessage?: string;
}

export interface Environment {
  id: string;
  name: string;
  type: 'indoor' | 'outdoor' | 'space' | 'abstract';
  description: string; // Detailed visual description
  mood: string; // Lighting, atmosphere
  customVisualPrompt?: string;
  imageUrl?: string;
  status: 'pending' | 'generating' | 'completed' | 'error';
  errorMessage?: string;
}

export interface Scene {
  id: string;
  title: string;
  location: string; // Nom du lieu (ex: "Cuisine du Château")
  environmentId?: string; // Link to a generated Environment
  environmentDetail: string; // Description visuelle du décor (sans persos)
  description: string; // Action qui se passe (Prompt pour l'image)
  originalTextExcerpt: string; // Le texte original du livre/PDF correspondant à la scène
  charactersPresent: string[]; // List of character names present in scene
  customVisualPrompt?: string; // New: Manual override for image generation
  imageUrl?: string;
  status: 'pending' | 'generating' | 'completed' | 'error';
  errorMessage?: string;
}

export enum AppStep {
  UPLOAD = 0,
  ANALYZING = 1,
  REVIEW_CHARS = 2,
  REVIEW_ENVIRONMENTS = 3, // New Step
  GENERATION_HUB = 4, // Combined Gallery (Chars + Envs)
  EXTRACTING_SCENES = 5,
  SCENE_REVIEW = 6,
  GENERATING_SCENES = 7,
  SCENE_GALLERY = 8,
  FINAL_BOOK = 9
}

export interface AnalysisResult {
  characters: Omit<Character, 'id' | 'status' | 'imageUrl'>[];
  environments: Omit<Environment, 'id' | 'status' | 'imageUrl'>[];
  suggestedStyle: string;
}

export interface SceneAnalysisResult {
  scenes: Omit<Scene, 'id' | 'status' | 'imageUrl'>[];
}

export interface GenConfig {
  resolution: '1K' | '2K' | '4K';
  aspectRatio: '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
}

// Types pour le Chatbot
export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  image?: string; // Base64 image pour l'analyse
  timestamp: number;
}

// Dimensions physiques d'un format de livre, utilisées pour l'export PDF.
export interface BookFormat {
  id: string;
  label: string;
  ratio: '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
  orientation: 'Portrait' | 'Paysage';
  icon: string;
  /** Largeur et hauteur en millimètres, pour fabriquer un PDF au bon format. */
  largeurMm: number;
  hauteurMm: number;
}

// Global definition for PDF.js loaded via CDN
declare global {
  interface Window {
    pdfjsLib: any;
  }
}