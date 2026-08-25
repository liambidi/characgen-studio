/// <reference types="vite/client" />

/**
 * Vite sait importer un fichier en tant qu'URL grace au suffixe "?url".
 * TypeScript l'ignore par defaut : cette declaration lui apprend.
 */
declare module '*?url' {
  const url: string;
  export default url;
}
