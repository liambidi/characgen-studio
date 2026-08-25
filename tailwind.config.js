/**
 * Configuration Tailwind.
 *
 * Elle vivait auparavant dans une balise script d'index.html, avec la version
 * navigateur de Tailwind : les styles etaient recalcules a chaque visite, ce qui
 * ralentissait l'affichage et faisait dependre le site d'un service exterieur.
 * Ils sont maintenant calcules une fois, a la compilation.
 */
export default {
  content: ['./index.html', './index.tsx', './App.tsx', './components/**/*.{ts,tsx}', './services/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#6366f1',
        'primary-hover': '#4f46e5',
        secondary: '#d946ef',
        dark: '#020617',
        surface: '#0f172a',
        'surface-highlight': '#1e293b',
        glass: 'rgba(15, 23, 42, 0.7)',
        // Utilisee sept fois dans le code sans avoir jamais ete definie :
        // les bordures concernees ne s'affichaient pas.
        border: 'rgba(255, 255, 255, 0.10)',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        heading: ['Outfit', 'sans-serif'],
      },
      animation: {
        blob: 'blob 7s infinite',
        'fade-in': 'fadeIn 0.4s ease-out forwards',
        // Les cinq suivantes etaient reclamees par les composants sans exister.
        'blob-bounce': 'blobBounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        'bounce-short': 'bounceShort 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        'pulse-slow': 'pulseSlow 3s ease-in-out infinite',
        'zoom-in': 'zoomIn 0.25s ease-out forwards',
        shimmer: 'shimmer 1.5s infinite',
      },
      keyframes: {
        blob: {
          '0%': { transform: 'translate(0px, 0px) scale(1)' },
          '33%': { transform: 'translate(30px, -50px) scale(1.1)' },
          '66%': { transform: 'translate(-20px, 20px) scale(0.9)' },
          '100%': { transform: 'translate(0px, 0px) scale(1)' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        blobBounce: {
          '0%': { opacity: '0', transform: 'translateY(24px) scale(0.94)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        bounceShort: {
          '0%': { opacity: '0', transform: 'scale(0.9)' },
          '60%': { opacity: '1', transform: 'scale(1.03)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        pulseSlow: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        zoomIn: {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
    },
  },
  plugins: [],
};
