import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { saveCatalog, getCatalog, getDrafts } from '../../services/localDB';
import useOnlineStatus from '../../hooks/useOnlineStatus';
import Layout from '../../components/Layout';
import styles from './AuditorHome.module.css';

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 horas — refrescar catálogos si están viejos

export default function AuditorHome() {
  const { user }  = useAuth();
  const navigate  = useNavigate();
  const online    = useOnlineStatus();

  const [cacheStatus, setCacheStatus] = useState(null);
  // null = no verificado | 'loading' | 'ok' | 'offline' | 'error'

  const [draftCount, setDraftCount] = useState(0);

  useEffect(() => {
    getDrafts().then(d => setDraftCount(d.length)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!online) {
      setCacheStatus('offline');
      return;
    }
    preloadCatalogs();
  }, [online]); // eslint-disable-line

  const preloadCatalogs = async () => {
    // Verificar si el caché es reciente
    try {
      const cached = await getCatalog('_last_sync');
      const age = cached ? Date.now() - cached : Infinity;
      if (age < CACHE_TTL) {
        setCacheStatus('ok');
        return; // caché vigente, no hace falta refrescar
      }
    } catch { /* continuar */ }

    setCacheStatus('loading');
    try {
      const [ciRes, cjRes, tRes] = await Promise.all([
        api.get('/catalogs/ciudades'),
        api.get('/catalogs/conjuntos/all').catch(() => ({ data: [] })),
        api.get('/catalogs/torres/all').catch(() => ({ data: [] })),
      ]);

      await Promise.all([
        saveCatalog('ciudades',      ciRes.data),
        saveCatalog('conjuntos_all', cjRes.data),
        saveCatalog('torres_all',    tRes.data),
        saveCatalog('_last_sync',    Date.now()),
      ]);

      setCacheStatus('ok');
    } catch {
      setCacheStatus('error');
    }
  };

  return (
    <Layout title="Inicio">
      {/* Indicador de caché */}
      {cacheStatus === 'loading' && (
        <div className={styles.cacheBar}>
          <span className={styles.cacheSpinner} />
          Descargando datos para uso sin conexión...
        </div>
      )}
      {cacheStatus === 'ok' && (
        <div className={`${styles.cacheBar} ${styles.cacheOk}`}>
          ✓ Datos disponibles sin conexión
        </div>
      )}
      {cacheStatus === 'offline' && (
        <div className={`${styles.cacheBar} ${styles.cacheOffline}`}>
          📵 Sin conexión — usando datos guardados localmente
        </div>
      )}
      {cacheStatus === 'error' && (
        <div className={`${styles.cacheBar} ${styles.cacheError}`}>
          ⚠️ No se pudieron descargar los datos offline
        </div>
      )}

      <div className={styles.welcome}>
        <p className={styles.greeting}>Hola, {user?.nombre?.split(' ')[0]} 👋</p>
        <p className={styles.date}>
          {new Date().toLocaleDateString('es-CO', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
          })}
        </p>
      </div>

      <div className={styles.actions}>
        <button
          className={`${styles.card} ${styles.primary}`}
          onClick={() => navigate('/nueva-visita')}
        >
          <span className={styles.icon}>📋</span>
          <div>
            <div className={styles.cardTitle}>Nueva visita</div>
            <div className={styles.cardDesc}>Registrar medidores de un apartamento</div>
          </div>
        </button>

        <button className={styles.card} onClick={() => navigate('/mis-visitas')}>
          <span className={styles.icon}>📂</span>
          <div style={{ flex: 1 }}>
            <div className={styles.cardTitle}>
              Mis visitas
              {draftCount > 0 && (
                <span className={styles.draftBadge}>{draftCount} borrador{draftCount > 1 ? 'es' : ''}</span>
              )}
            </div>
            <div className={styles.cardDesc}>Ver historial de registros</div>
          </div>
        </button>
      </div>
    </Layout>
  );
}
