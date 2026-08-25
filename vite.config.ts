import path from 'path';
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Adresse du site deploye, seul endroit ou l'Edge Function /api/gemini existe reellement. */
const SITE_EN_LIGNE = 'https://characgen-ai-deploy.netlify.app';

const SOURCE_CMAPS = path.resolve(__dirname, 'node_modules/pdfjs-dist/cmaps');
const CIBLE_CMAPS = path.resolve(__dirname, 'public/cmaps');

/**
 * Recopie les tables cmaps de pdf.js dans les fichiers statiques du site.
 *
 * Ces tables servent a decoder les polices non latines d'un PDF. Le code les
 * demandait auparavant a l'adresse `new URL('pdfjs-dist/cmaps/', import.meta.url)`,
 * mais Vite ne transforme ce genre d'appel que pour un chemin relatif, jamais pour
 * un nom de paquet : la chaine partait telle quelle dans le bundle et l'adresse
 * obtenue n'existait pas, d'ou un 404 silencieux sur les PDF en cyrillique,
 * en grec, en arabe ou en CJK.
 *
 * En les copiant ici, elles sont servies a `/cmaps/` en developpement comme en
 * production. Le dossier est regenere a chaque demarrage, il n'est donc pas versionne.
 */
const copierLesCmaps = () => ({
  name: 'copier-les-cmaps-de-pdfjs',
  buildStart() {
    if (!existsSync(SOURCE_CMAPS)) {
      this.warn("Tables cmaps de pdfjs-dist introuvables : les PDF non latins seront mal decodes.");
      return;
    }
    const dejaCopiees =
      existsSync(CIBLE_CMAPS) && readdirSync(CIBLE_CMAPS).length === readdirSync(SOURCE_CMAPS).length;
    if (!dejaCopiees) cpSync(SOURCE_CMAPS, CIBLE_CMAPS, { recursive: true });
  },
});

// Aucune cle API n'est injectee ici : toutes les requetes Gemini passent par
// l'Edge Function Netlify (netlify/edge-functions/gemini.ts), qui seule connait la cle.
export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
    // `npm run dev` ne lance que Vite, qui ignore tout des Edge Functions Netlify :
    // /api/gemini n'existait donc pas en local et repondait 404 des qu'on importait
    // un recit. On renvoie ces appels vers le site deploye, ou la fonction tourne
    // pour de bon. A savoir : ces appels consomment le quota Gemini du site en ligne,
    // et une modification de l'Edge Function elle-meme doit etre deployee pour etre testee.
    // `/.netlify` couvre l'analyse des recits, passee en fonction d'arriere-plan
    // parce qu'une Edge Function est coupee au bout d'environ 35 secondes.
    proxy: {
      '/api': {
        target: SITE_EN_LIGNE,
        changeOrigin: true,
      },
      '/.netlify': {
        target: SITE_EN_LIGNE,
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), copierLesCmaps()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  }
});
