import React, { useState, useEffect } from 'react';
import { getInstallPrompt, clearInstallPrompt, isInstalled, getOS } from '../services/installPrompt';
import styles from './InstallBanner.module.css';

const DISMISSED_KEY = 'lectura-ia-install-dismissed';

export default function InstallBanner() {
  const [visible, setVisible]       = useState(false);
  const [sheetOpen, setSheetOpen]   = useState(false);
  const [installing, setInstalling] = useState(false);
  const os = getOS();

  useEffect(() => {
    if (isInstalled()) return;
    if (localStorage.getItem(DISMISSED_KEY) === 'true') return;
    setVisible(true);
  }, []);

  useEffect(() => {
    const handler = () => setVisible(false);
    window.addEventListener('appinstalled', handler);
    return () => window.removeEventListener('appinstalled', handler);
  }, []);

  const handleInstallAndroid = async () => {
    const prompt = getInstallPrompt();
    if (!prompt) return;
    setInstalling(true);
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    clearInstallPrompt();
    setInstalling(false);
    if (outcome === 'accepted') { setVisible(false); setSheetOpen(false); }
  };

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, 'true');
    setVisible(false);
    setSheetOpen(false);
  };

  if (!visible) return null;

  return (
    <>
      {/* Ícono discreto */}
      <button className={styles.chip} onClick={() => setSheetOpen(true)}>
        📲 Instalar app
      </button>

      {/* Bottom-sheet con instrucciones */}
      {sheetOpen && (
        <div className={styles.overlay} onClick={() => setSheetOpen(false)}>
          <div className={styles.sheet} onClick={e => e.stopPropagation()}>
            <div className={styles.sheetHandle} />

            <h3 className={styles.sheetTitle}>📲 Instalar LecturIA</h3>
            <p className={styles.sheetDesc}>
              Instala la app para registrar visitas aunque no tengas señal en sótanos o zonas sin cobertura.
            </p>

            {os === 'android' && getInstallPrompt() && (
              <button
                className={styles.btnInstall}
                onClick={handleInstallAndroid}
                disabled={installing}
              >
                {installing ? '⏳ Instalando...' : '📲 Instalar en este dispositivo'}
              </button>
            )}

            {os === 'android' && !getInstallPrompt() && (
              <div className={styles.steps}>
                <div className={styles.step}><span className={styles.num}>1</span><span>Toca el menú <strong>⋮</strong> en Chrome</span></div>
                <div className={styles.step}><span className={styles.num}>2</span><span>Selecciona <strong>"Instalar aplicación"</strong></span></div>
                <div className={styles.step}><span className={styles.num}>3</span><span>Toca <strong>Instalar</strong></span></div>
              </div>
            )}

            {os === 'ios' && (
              <div className={styles.steps}>
                <div className={styles.step}><span className={styles.num}>1</span><span>Abre en <strong>Safari</strong></span></div>
                <div className={styles.step}><span className={styles.num}>2</span><span>Toca <strong>Compartir</strong> <span className={styles.shareIcon}>⬆</span> abajo</span></div>
                <div className={styles.step}><span className={styles.num}>3</span><span>Selecciona <strong>"Agregar a inicio"</strong></span></div>
                <div className={styles.step}><span className={styles.num}>4</span><span>Toca <strong>Agregar</strong></span></div>
              </div>
            )}

            {os === 'other' && (
              <p className={styles.sheetDesc}>
                Ábrela en Chrome (Android) o Safari (iOS) para instalarla en tu pantalla de inicio.
              </p>
            )}

            <div className={styles.sheetActions}>
              <button className={styles.btnClose} onClick={() => setSheetOpen(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
