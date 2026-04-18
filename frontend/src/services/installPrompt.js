/**
 * installPrompt.js
 * Captura el evento beforeinstallprompt de Android Chrome lo antes posible.
 * Importar en index.js antes de montar React.
 */

let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); // evita el banner automático del navegador
  deferredPrompt = e;
});

/** Retorna el prompt guardado (solo Android Chrome) */
export function getInstallPrompt() {
  return deferredPrompt;
}

/** Limpiar después de que el usuario instala */
export function clearInstallPrompt() {
  deferredPrompt = null;
}

/** True si la app ya está instalada como PWA */
export function isInstalled() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

/** Detección de sistema operativo */
export function getOS() {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}
