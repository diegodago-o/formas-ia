import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import './services/installPrompt'; // captura beforeinstallprompt antes de React
import { registerSyncListener } from './services/syncService';

// ── Registrar Service Worker ──────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch(err => console.warn('SW registro fallido:', err));
  });
}

// ── Sincronizar visitas pendientes al recuperar conexión ──────────
registerSyncListener();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App /></React.StrictMode>);
