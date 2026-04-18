import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import styles from './AuditorVisitModal.module.css';

const TIPO_META = {
  luz:  { emoji: '⚡', label: 'Luz',  color: '#F59E0B' },
  agua: { emoji: '💧', label: 'Agua', color: '#3B82F6' },
  gas:  { emoji: '🔥', label: 'Gas',  color: '#EF4444' },
};

const ESTADO_STYLE = {
  pendiente: { bg: '#FEF3C7', color: '#92400E', label: 'Pendiente' },
  aprobada:  { bg: '#D1FAE5', color: '#065F46', label: 'Aprobada'  },
  rechazada: { bg: '#FEE2E2', color: '#991B1B', label: 'Rechazada' },
  anulada:   { bg: '#F3F4F6', color: '#6B7280', label: 'Anulada'   },
};

export default function AuditorVisitModal({ visitId, autoAnular, onClose, onUpdated }) {
  const [visit, setVisit]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [confirming, setConfirming] = useState(autoAnular);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => {
    api.get(`/visits/${visitId}`)
      .then(r => setVisit(r.data))
      .finally(() => setLoading(false));
  }, [visitId]);

  const anular = async () => {
    setSaving(true);
    setError('');
    try {
      await api.patch(`/visits/${visitId}/anular`);
      onUpdated();
    } catch (e) {
      setError(e.response?.data?.error || 'Error al anular la visita');
      setSaving(false);
    }
  };

  const est = visit ? (ESTADO_STYLE[visit.estado] || ESTADO_STYLE.pendiente) : null;

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2>Detalle de visita</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {loading
          ? <div className={styles.loading}>Cargando...</div>
          : visit && (
            <div className={styles.body}>

              {/* Estado */}
              <div className={styles.estadoRow}>
                <span className={styles.estadoBadge} style={{ background: est.bg, color: est.color }}>
                  {est.label}
                </span>
                {visit.estado === 'rechazada' && visit.motivo_rechazo && (
                  <span className={styles.motivoRechazo}>Motivo: {visit.motivo_rechazo}</span>
                )}
              </div>

              {/* Info general */}
              <div className={styles.section}>
                <div className={styles.grid}>
                  <div className={styles.field}><label>Fecha</label><span>{new Date(visit.fecha).toLocaleString('es-CO')}</span></div>
                  <div className={styles.field}><label>Ciudad</label><span>{visit.ciudad}</span></div>
                  <div className={styles.field}><label>Conjunto</label><span>{visit.conjunto}</span></div>
                  <div className={styles.field}><label>Torre</label><span>{visit.torre || '–'}</span></div>
                  <div className={styles.field}><label>Apartamento</label><span><strong>{visit.apartamento}</strong></span></div>
                  {visit.latitud && (
                    <div className={styles.field}>
                      <label>Ubicación GPS</label>
                      <span>{visit.latitud}, {visit.longitud}</span>
                    </div>
                  )}
                </div>
                {visit.observaciones && (
                  <div className={styles.obs}>💬 {visit.observaciones}</div>
                )}
              </div>

              {/* Medidores — siempre los 3 tipos */}
              <div className={styles.section}>
                <h3>Medidores registrados</h3>
                {['luz', 'agua', 'gas'].map(tipo => {
                  const meta = TIPO_META[tipo];
                  const m    = (visit.medidores || []).find(x => x.tipo === tipo);
                  const lectura = m ? (m.lectura_confirmada || m.lectura || null) : null;
                  const sinEvidencia = m && (m.sin_acceso == 1 || m.sin_acceso === true);

                  return (
                    <div key={tipo} className={styles.medCard}>
                      <div className={styles.medHeader} style={{ borderColor: meta.color }}>
                        <span>{meta.emoji} {meta.label}</span>
                        <strong className={styles.lectura}>
                          {!m || sinEvidencia ? '–' : (lectura || '–')}
                        </strong>
                      </div>

                      {!m ? (
                        <div className={styles.noFotoBox}>
                          <span className={styles.noFotoIcon}>📋</span>
                          <span>No se registró este medidor</span>
                        </div>
                      ) : sinEvidencia ? (
                        <div className={styles.sinAccesoBox}>
                          <span>📵</span>
                          <div>
                            <strong>No se pudo capturar evidencia</strong>
                            {m.motivo_sin_acceso && (
                              <span className={styles.sinAccesoMotivo}>{m.motivo_sin_acceso}</span>
                            )}
                          </div>
                        </div>
                      ) : m.foto_path ? (
                        <img
                          src={`/uploads/${m.foto_path}`}
                          alt={`Medidor ${tipo}`}
                          className={styles.foto}
                        />
                      ) : (
                        <div className={styles.noFotoBox}>
                          <span className={styles.noFotoIcon}>📷</span>
                          {lectura
                            ? <>Lectura sin foto: <strong className={styles.lecturaInline}>{lectura}</strong></>
                            : 'No se capturó foto para este medidor'}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Anular */}
              {visit.estado === 'pendiente' && (
                <div className={styles.section}>
                  {!confirming
                    ? <button className={styles.btnAnular} onClick={() => setConfirming(true)}>
                        ✕ Anular esta visita
                      </button>
                    : <div className={styles.confirmBox}>
                        <p>¿Estás seguro que deseas anular esta visita? Esta acción no se puede deshacer.</p>
                        {error && <span className={styles.error}>{error}</span>}
                        <div className={styles.confirmBtns}>
                          <button className={styles.btnAnularConfirm} onClick={anular} disabled={saving}>
                            {saving ? 'Anulando...' : 'Sí, anular visita'}
                          </button>
                          <button className={styles.btnCancelar} onClick={() => { setConfirming(false); setError(''); }}>
                            Cancelar
                          </button>
                        </div>
                      </div>
                  }
                </div>
              )}

            </div>
          )
        }
      </div>
    </div>
  );
}
