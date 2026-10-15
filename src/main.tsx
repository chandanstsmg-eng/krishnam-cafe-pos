import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setLanguage, currentLanguage } from './i18n';
import './styles.css';

setLanguage(currentLanguage());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Keep the till's screens available when the server can't be reached.
// (Service workers need https or localhost; tablets on plain http skip this.)
if ('serviceWorker' in navigator && import.meta.env.PROD && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[sw] not registered', err));
  });
}
