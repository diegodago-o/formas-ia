import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import {
  getPendingVisits, deletePendingVisit,
  getDrafts, deleteDraft,
  saveVisitsCache, getVisitsCache,
  getPendingSubsanaciones,
} from '../../services/localDB';
import { syncPendingVisits, syncPendingSubsanaciones } from '../../services/syncService';
import useOnlineStatus from '../../hooks/useOnlineStatus';
import Layout from '../../components/Layout';
import AuditorVisitModal from './AuditorVisitModal';
import styles from './MyVisits.module.css';

const ESTADO_STYLE = {
  pendiente:         { bg: '#FEF3C7', color: '#92400E', label: 'Pendiente' },
  aprobada:          { bg: '#D1FAE5', color: '#065F46', label: 'Aprobada'  },
  rechazada:         { bg: '#FEE2E2', color: '#991B1B', label: 'Rechazada' },
  anulada:           { bg: '#F3F4F6', color: '#6B7280', label: 'Anulada'   },
  sync:              { bg: '#EDE9FE', color: '#5B21B6', label: 'Por sincronizar' },
  error:             { bg: '#FEE2E2', color: '#991B1B', label: 'Error al sincronizar' },
  subsanar_pendiente:{ bg: '#FEF3C7', color: '#92400E', label: '📤 Subsanación pendiente' },
};

const METER_ICONS = { luz: '💡', agua: '💧', gas: '🔥' };

function formatAge(ts) {
  const diff = Date.now() - ts;
  const min  = Math.round(diff / 60000);
  if (min < 2)  return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24)  return `hace ${h}h`;
  return `hace ${Math.round(h / 24)}d`;
}

export default function MyVisits() {
  const navigate = useNavigate();
  const online   = useOnlineStatus();

  const [visits, setVisits]           = useState([]);
  const [pending, setPending]         = useState([]);
  const [drafts, setDrafts]           = useState([]);
  const [pendingSubs, setPendingSubs] = useState([]); // subsanaciones offline pendientes
  const [loading, setLoading]         = useState(true);
  const [syncing, setSyncing]         = useState(false);
  const [selectedId, setSelectedId]   = useState(null);
  const initialSyncDone = useRef(false);

  const loadServer = useCallback(async () => {
    if (!online) {
      // Sin red → cargar desde caché
      const cached = await getVisitsCache().catch(() => null);
      if (cached) setVisits(cached);
      return;
    }
    try {
      const r = await api.get('/visits/mine');
      setVisits(r.data);
      // Persistir para uso offline
      saveVisitsCache(r.data).catch(() => {});
    } catch {
      // Falló con red → intentar caché como respaldo
      const cached = await getVisitsCache().catch(() => null);
      if (cached) setVisits(cached);
    }
  }, [online]);

  const loadLocal = useCallback(async () => {
    const local = await getPendingVisits();
    setPending(local);
  }, []);

  const loadDraftsLocal = useCallback(async () => {
    const d = await getDrafts();
    setDrafts(d);
  }, []);

  const loadPendingSubs = useCallback(async () => {
    const subs = await getPendingSubsanaciones().catch(() => []);
    setPendingSubs(subs);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadServer(), loadLocal(), loadDraftsLocal(), loadPendingSubs()]);
    setLoading(false);
  }, [loadServer, loadLocal, loadDraftsLocal, loadPendingSubs]);

  useEffect(() => { load(); }, [load]);

  // Sync automático al recuperar señal
  useEffect(() => {
    if (online && pending.length > 0) {
      handleSync();
    }
  }, [online]); // eslint-disable-line

  // Sync automático al montar si ya hay conexión (el efecto [online] no dispara en mount)
  useEffect(() => {
    if (!loading && online && pending.length > 0 && !initialSyncDone.current) {
      initialSyncDone.current = true;
      handleSync();
    }
  }, [loading]); // eslint-disable-line

  const handleSync = async () => {
    if (syncing || !online) return;
    setSyncing(true);
    await syncPendingVisits();
    await syncPendingSubsanaciones(); // también sincroniza subsanaciones offline
    await load();
    setSyncing(false);
  };

  const discardLocal = async (localId) => {
    if (!window.confirm('¿Eliminar esta visita local? No se podrá recuperar.')) return;
    await deletePendingVisit(localId);
    await loadLocal();
  };

  const discardDraft = async (localId) => {
    if (!window.confirm('¿Descartar este borrador? Se perderán los medidores ya capturados.')) return;
    await deleteDraft(localId);
    await loadDraftsLocal();
  };

  const continueDraft = (localId) => {
    navigate(`/nueva-visita?draft=${localId}`);
  };

  const allServerItems  = visits;
  const pendingSubsCount = pendingSubs.filter(s => s.status === 'pending' || s.status === 'error').length;
  const totalPending     = pending.length + pendingSubsCount;

  return (
    <Layout title="Mis Visitas">

      {/* ── Barra de sync ──────────────────────────────────────── */}
      {totalPending > 0 && (
        <div className={styles.syncBar}>
          <span>
            📥 {totalPending} elemento{totalPending > 1 ? 's' : ''} por sincronizar
          </span>
          {online ? (
            <button className={styles.btnSync} onClick={handleSync} disabled={syncing}>
              {syncing ? '⏳ Sincronizando...' : '↑ Sincronizar'}
            </button>
          ) : (
            <span className={styles.syncOffline}>Sin señal</span>
          )}
        </div>
      )}

      {loading ? (
        <div className={styles.loading}>Cargando...</div>
      ) : (
        <div className={styles.list}>

          {/* ── Sección borradores ─────────────────────────────── */}
          {drafts.length > 0 && (
            <>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionHeaderIcon}>📝</span>
                Borradores en progreso
                <span className={styles.sectionHeaderCount}>{drafts.length}</span>
              </div>

              {drafts.map(d => {
                const meta = d._meta || {};
                return (
                  <div key={d.localId} className={`${styles.card} ${styles.cardDraft}`}>
                    <div className={styles.top}>
                      <span className={styles.apt}>Apto {d.apartamento}</span>
                      <span className={styles.estadoBadge} style={{ background: '#FEF3C7', color: '#92400E' }}>
                        Borrador
                      </span>
                    </div>

                    <div className={styles.location}>
                      📍 {meta.ciudadNombre} · {meta.conjuntoNombre}
                      {meta.torreNombre ? ` · Torre ${meta.torreNombre}` : ''}
                    </div>

                    {/* Progreso de medidores */}
                    <div className={styles.meterPills}>
                      {['luz', 'agua', 'gas'].map(tipo => {
                        const m    = d.medidores?.[tipo];
                        const done = m?.lectura || m?.sin_acceso || m?.foto_path || m?.foto_base64 || m?.foto_file || m?.foto;
                        return (
                          <span
                            key={tipo}
                            className={`${styles.meterPill} ${done ? styles.meterPillDone : styles.meterPillPending}`}
                          >
                            {METER_ICONS[tipo]} {tipo}{done ? ' ✓' : ''}
                          </span>
                        );
                      })}
                    </div>

                    <div className={styles.date}>
                      Actualizado {formatAge(d.updatedAt || d.createdAt)}
                    </div>

                    <div className={styles.actions}>
                      <button
                        className={styles.btnContinue}
                        onClick={() => continueDraft(d.localId)}
                      >
                        ▶ Continuar
                      </button>
                      <button
                        className={styles.btnAnular}
                        onClick={() => discardDraft(d.localId)}
                      >
                        🗑 Descartar
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* ── Visitas locales pendientes de sync ─────────────── */}
          {pending.length > 0 && (
            <>
              {drafts.length > 0 && <div className={styles.sectionDivider} />}
              {pending.map(v => {
                const est = ESTADO_STYLE[v.status === 'error' ? 'error' : 'sync'];
                return (
                  <div key={v.localId} className={`${styles.card} ${styles.cardLocal}`}>
                    <div className={styles.top}>
                      <span className={styles.apt}>Apto {v.apartamento}</span>
                      <span className={styles.estadoBadge} style={{ background: est.bg, color: est.color }}>
                        {est.label}
                      </span>
                    </div>
                    <div className={styles.location}>
                      📍 {v._meta?.ciudadNombre} · {v._meta?.conjuntoNombre}
                      {v._meta?.torreNombre ? ` · Torre ${v._meta.torreNombre}` : ''}
                    </div>
                    <div className={styles.date}>
                      {new Date(v.createdAt).toLocaleDateString('es-CO', {
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </div>
                    {v.syncError && (
                      <div className={styles.syncError}>⚠️ {v.syncError}</div>
                    )}
                    <div className={styles.actions}>
                      <button className={styles.btnAnular} onClick={() => discardLocal(v.localId)}>
                        🗑 Descartar
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* ── Visitas del servidor ────────────────────────────── */}
          {allServerItems.length === 0 && drafts.length === 0 && pending.length === 0 && (
            <div className={styles.empty}>
              <span>📭</span>
              <p>Aún no tienes visitas registradas</p>
            </div>
          )}

          {allServerItems.map(v => {
            const hasPendingSub = pendingSubs.some(
              s => s.visitId === v.id && (s.status === 'pending' || s.status === 'error')
            );
            const estadoKey = hasPendingSub ? 'subsanar_pendiente' : (v.estado || 'pendiente');
            const est       = ESTADO_STYLE[estadoKey] || ESTADO_STYLE.pendiente;
            return (
              <div key={v.id} className={`${styles.card} ${v.estado === 'anulada' ? styles.anulada : ''}`}>
                <div className={styles.top}>
                  <span className={styles.apt}>Apto {v.apartamento}</span>
                  <span className={styles.estadoBadge} style={{ background: est.bg, color: est.color }}>
                    {est.label}
                  </span>
                </div>
                <div className={styles.location}>
                  📍 {v.ciudad} · {v.conjunto}{v.torre ? ` · Torre ${v.torre}` : ''}
                </div>
                <div className={styles.date}>
                  {new Date(v.fecha).toLocaleDateString('es-CO', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </div>
                {v.observaciones && <div className={styles.obs}>💬 {v.observaciones}</div>}
                <div className={styles.actions}>
                  <button className={styles.btnVer} onClick={() => setSelectedId(v.id)}>
                    👁 Ver detalle
                  </button>
                  {v.estado === 'pendiente' && (
                    <button className={styles.btnAnular} onClick={() => setSelectedId(`anular-${v.id}`)}>
                      ✕ Anular
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedId && (
        <AuditorVisitModal
          visitId={typeof selectedId === 'string' && selectedId.startsWith('anular-')
            ? parseInt(selectedId.replace('anular-', ''))
            : selectedId}
          autoAnular={typeof selectedId === 'string' && selectedId.startsWith('anular-')}
          onClose={() => setSelectedId(null)}
          onUpdated={() => { setSelectedId(null); load(); }}
        />
      )}
    </Layout>
  );
}
