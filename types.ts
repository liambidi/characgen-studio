/**
 * Poids d'un personnage ou d'un décor dans le récit.
 *
 * POURQUOI CE CHAMP EXISTE
 *
 * Les consignes envoyées au modèle demandaient « TOUS les personnages
 * importants » et « les décors récurrents ». Ces deux adjectifs lui confiaient
 * le tri, et un modèle qui trie sur un roman entier écarte beaucoup. On lui
 * demande maintenant l'inventaire complet, et c'est l'interface qui filtre :
 * le tri revient à celui qui connaît le récit.
 */
export type Importance = 'principal' | 'secondaire' | 'figurant';

export const LIBELLE_IMPORTANCE: Record<Importance, string> = {
  principal: 'Principal',
  secondaire: 'Secondaire',
  figurant: 'Figurant',
};

export interface Character {
  id: string;
  name: string;
  role: string;
  /** Absent des projets enregistrés avant le 2026-08-26, d'où l'optionnel. */
  importance?: Importance;
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
  /** Même raison que pour les personnages, voir `Importance`. */
  importance?: Importance;
  type: 'indoor' | 'outdoor' | 'space' | 'abstract';
  description: string; // Detailed visual description
  mood: string; // Lighting, atmosphere
  customVisualPrompt?: string;
  imageUrl?: string;
  status: 'pending' | 'generating' | 'completed' | 'error';
  errorMessage?: string;
}

/**
 * Libellé français des types de décor.
 *
 * Le modèle répond en anglais, parce que le schéma envoyé chez Google impose
 * ces quatre valeurs. Elles étaient affichées telles quelles sur les cartes :
 * on lisait « indoor » au milieu d'une interface entièrement en français.
 */
export const LIBELLE_TYPE_DECOR: Record<Environment['type'], string> = {
  indoor: 'Intérieur',
  outdoor: 'Extérieur',
  space: 'Espace',
  abstract: 'Abstrait',
};

export interface Scene {
  id: string;
  title: string;
  location: string; // Nom du lieu (ex: "Cuisine du Château")
  environmentId?: string; // Link to a generated Environment
  environmentDetail: string; // Description visuelle du décor (sans persos)
  description: string; // Action qui se passe (Prompt pour l'image)
  originalTextExcerpt: string; // Le texte original du livre/PDF correspondant à la scène
  /**
   * Le repérage de cette scène n'était pas franc : citation introuvable dans le
   * récit, ou passage anormalement long, signe qu'une autre scène s'y cache.
   *
   * L'information existait déjà côté serveur mais ne sortait qu'en `console.warn`,
   * donc nulle part pour l'utilisateur. Un découpage douteux se voit désormais
   * sur la carte de la scène.
   */
  reperageIncertain?: boolean;
  charactersPresent: string[]; // List of character names present in scene
  /**
   * Envoyer l'image du décor comme référence, au lieu de sa seule description.
   *
   * L'image partait systématiquement, avec la consigne de ne pas en copier la
   * composition. Dans un modèle image vers image, une image pèse plus qu'une
   * phrase qui dit de ne pas la suivre : le plan se retrouvait cadré comme le
   * décor, quelle que soit l'action. Le décor est donc devenu un repère écrit,
   * et cette case rétablit le comportement d'avant quand on veut vraiment
   * retrouver la même pièce.
   */
  verrouillerDecor?: boolean;
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
  aspectRatio: RatioImage;
}

/**
 * Ratios acceptés par l'API Gemini, champ `ImageConfig.aspectRatio`.
 *
 * Vérifié le 2026-08-26 dans la documentation du SDK Google Gen AI : il y en a
 * huit, et non cinq comme le déclarait ce fichier. Les deux qui manquaient,
 * `2:3` et `3:2`, sont justement celles qui collent aux formats de livre
 * courants. Le format Digest, annoncé en 3:4 alors qu'il vaut 0,648, tombait à
 * 16 % d'écart ; en 2:3 il n'en fait plus que 3.
 */
export type RatioImage = '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '9:16' | '16:9' | '21:9';

/**
 * Ce que l'illustration occupe dans la page, indépendamment de la taille du livre.
 *
 * Ces deux notions étaient confondues : chaque format de livre portait un ratio
 * d'image figé, si bien que quatre tailles différentes produisaient exactement
 * la même image. Elles sont désormais séparées, le format décide de la page, le
 * cadrage décide de l'illustration.
 */
export type Cadrage = 'pleine-page' | 'portrait' | 'carre' | 'paysage';

// Types pour le Chatbot
export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  image?: string; // Base64 image pour l'analyse
  timestamp: number;
}

/**
 * Un format de livre, c'est-à-dire une page physique et rien d'autre.
 *
 * Le champ `ratio` a disparu le 2026-08-26. Il figeait une proportion d'image
 * par format, choisie à la main et fausse : l'A4 vaut 0,707 et était annoncé
 * 0,750. Surtout, quatre formats portaient la même valeur, donc produisaient la
 * même image. La proportion se calcule maintenant à partir des millimètres, qui
 * sont la seule donnée vraie du catalogue.
 */
export interface BookFormat {
  id: string;
  /** Nom court, celui qu'on lit sur la vignette. */
  nom: string;
  /** Dimensions lisibles, par exemple « 21 x 29,7 cm ». */
  dimensions: string;
  famille: 'portrait' | 'paysage';
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