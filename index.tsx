import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import FrontiereErreur from './components/FrontiereErreur';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Élément racine introuvable : la page n'a pas pu démarrer.");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {/* Une erreur de rendu donnait une page entièrement blanche, sans un mot.
        La frontière affiche le message et rappelle que le projet est sauvegardé. */}
    <FrontiereErreur>
      <App />
    </FrontiereErreur>
  </React.StrictMode>
);
