import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import useOnlineStatus from '../../hooks/useOnlineStatus';
import {
  saveVisitDetailCache,
  getVisitDetailCache,
  savePendingSubsanacion,
} from '../../services/localDB';
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
  const online = useOnlineStatus();

  const [visit, setVisit]           = useState(null);
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState('');
  const [confirming, setConfirming] = useState(autoAnular);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  // ── Subsanar ──────────────────────────────────────────────────
  const [subsanarMode, setSubsanarMode]     = useState(false);
  const [subsanarData, setSubsanarData]     = useState({}); // { [medidorId]: { foto_path?, foto_file?, preview?, uploading?, lectura? } }
  const [subsanarSaving, setSubsanarSaving] = useState(false);
  const [subsanarDone, setSubsanarDone]     = useState(false);
  const [subsanarOffline, setSubsanarOffline] = useState(false); // true si se guardó sin red
  const [subsanarError, setSubsanarError]   = useState('');

  // ── Cargar visita (online → servidor + caché; offline → caché) ─
  useEffect(() => {
    let cancelled = false;

    const fetchVisit = async () => {
      setLoading(true);
      setLoadError('');

      if (navigator.onLine) {
        try {
          const r = await api.get(`/visits/${visitId}`);
          if (cancelled) return;
          setVisit(r.data);
          // Cachear visitas rechazadas para poder subsanar offline
          if (r.data.estado === 'rechazada') {
            saveVisitDetailCache(r.data).catch(() => {}); // no bloquear si falla
          }
        } catch {
          // Red disponible pero request falló → intentar caché
          const cached = await getVisitDetailCache(visitId).catch(() => null);
          if (!cancelled) {
            if (cached) setVisit(cached);
            else setLoadError('No se pudo cargar la visita.');
          }
        }
      } else {
        // Sin red → usar caché
        const cached = await getVisitDetailCache(visitId).catch(() => null);
        if (!cancelled) {
          if (cached) setVisit(cached);
          else setLoadError('Sin conexión. Abre esta visita primero con internet para poder subsanarla offline.');
        }
      }

      if (!cancelled) setLoading(false);
    };

    fetchVisit();
    return () => { cancelled = true; };
  }, [visitId]); // eslint-disable-line

  // ── Anular ────────────────────────────────────────────────────
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

  // ── Subsanar: captura de foto ─────────────────────────────────
  // Online → sube inmediatamente y guarda foto_path
  // Offline → guarda el File localmente en el estado
  const handleFotoChange = async (medidorId, file) => {
    if (!file) return;
    setSubsanarError('');
    const preview = URL.createObjectURL(file);

    if (navigator.onLine) {
      // Subir foto inmediatamente
      setSubsanarData(prev => ({
        ...prev,
        [medidorId]: { ...prev[medidorId], preview, uploading: true, foto_path: null, foto_file: null },
      }));
      try {
        const form = new FormData();
        form.append('foto', file);
        const r = await api.post('/visits/upload-photo', form);
        setSubsanarData(prev => ({
          ...prev,
          [medidorId]: { ...prev[medidorId], foto_path: r.data.foto_path, uploading: false },
        }));
      } catch {
        setSubsanarData(prev => ({
          ...prev,
          [medidorId]: { ...prev[medidorId], uploading: false, preview: null },
        }));
        setSubsanarError('Error al subir la foto. Inténtalo de nuevo.');
      }
    } else {
      // Sin red: guardar File en estado (se subirá al sincronizar)
      setSubsanarData(prev => ({
        ...prev,
        [medidorId]: { ...prev[medidorId], preview, foto_file: file, foto_path: null, uploading: false },
      }));
    }
  };

  // ── Subsanar: cambiar lectura ─────────────────────────────────
  const handleLecturaChange = (medidorId, value) => {
    setSubsanarData(prev => ({
      ...prev,
      [medidorId]: { ...prev[medidorId], lectura: value },
    }));
  };

  // ── Subsanar: enviar ─────────────────────────────────────────
  const handleSubmitSubsanar = async () => {
    setSubsanarError('');

    // Validar que hay al menos un cambio
    const hasData = Object.values(subsanarData).some(
      d => d.foto_path || d.foto_file || d.lectura?.trim()
    );
    if (!hasData) {
      setSubsanarError('Debes subir al menos una foto o ingresar una lectura para continuar.');
      return;
    }

    // Verificar que no hay fotos subiendo
    if (Object.values(subsanarData).some(d => d.uploading)) {
      setSubsanarError('Espera a que terminen de subir las fotos.');
      return;
    }

    setSubsanarSaving(true);

    if (!navigator.onLine) {
      // ── OFFLINE: guardar en IndexedDB para sync posterior ──────
      try {
        // Serializar solo los campos necesarios (no blob: URLs ni estado transitorio)
        const medidoresParaStorage = {};
        for (const [id, datos] of Object.entries(subsanarData)) {
          if (datos.foto_file || datos.foto_path || datos.lectura?.trim()) {
            medidoresParaStorage[id] = {
              foto_path: datos.foto_path || null,
              foto_file: datos.foto_file || null, // File es serializable en IndexedDB
              lectura:   datos.lectura?.trim() || null,
            };
          }
        }
        await savePendingSubsanacion({ visitId, medidores: medidoresParaStorage });
        setSubsanarOffline(true);
        setSubsanarDone(true);
      } catch {
        setSubsanarError('No se pudo guardar localmente. Inténtalo de nuevo.');
      } finally {
        setSubsanarSaving(false);
      }
      return;
    }

    // ── ONLINE: flujo normal ────────────────────────────────────
    try {
      const medidoresPayload = {};
      for (const [id, datos] of Object.entries(subsanarData)) {
        if (datos.foto_path || datos.lectura?.trim()) {
          medidoresPayload[id] = {
            foto_path: datos.foto_path || null,
            lectura:   datos.lectura?.trim() || null,
          };
        }
      }
      if (!Object.keys(medidoresPayload).length) {
        setSubsanarError('Debes subir al menos una foto o ingresar una lectura para continuar.');
        setSubsanarSaving(false);
        return;
      }
      await api.post(`/visits/${visitId}/subsanar`, { medidores: medidoresPayload });
      setSubsanarDone(true);
    } catch (e) {
      setSubsanarError(e.response?.data?.error || 'Error al enviar la subsanación. Inténtalo de nuevo.');
    } finally {
      setSubsanarSaving(false);
    }
  };

  const est                 = visit ? (ESTADO_STYLE[visit.estado] || ESTADO_STYLE.pendiente) : null;
  const medidoresRechazados = visit
    ? (visit.medidores || []).filter(m => m.estado_revision_ocr === 'rechazado')
    : [];

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>

        {/* ── Header ─────────────────────────────────────────── */}
        <div className={styles.header}>
          <h2>{subsanarMode ? 'Subsanar visita' : 'Detalle de visita'}</h2>
          <button
            className={styles.closeBtn}
            onClick={subsanarMode && !subsanarDone ? () => setSubsanarMode(false) : onClose}
          >
            {subsanarMode && !subsanarDone ? '← Volver' : '✕'}
          </button>
        </div>

        {loading ? (
          <div className={styles.loading}>Cargando...</div>
        ) : loadError ? (
          <div className={styles.body}>
            <div className={styles.loadErrorBox}>{loadError}</div>
          </div>
        ) : visit && (
          <div className={styles.body}>

            {/* ════════════════════════════════════════════════
                VISTA NORMAL
            ════════════════════════════════════════════════ */}
            {!subsanarMode && (
              <>
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

                {/* Medidores */}
                <div className={styles.section}>
                  <h3>Medidores registrados</h3>
                  {['luz', 'agua', 'gas'].map(tipo => {
                    const meta         = TIPO_META[tipo];
                    const m            = (visit.medidores || []).find(x => x.tipo === tipo);
                    const lectura      = m ? (m.lectura_confirmada || m.lectura || null) : null;
                    const sinEvidencia = m && (m.sin_acceso == 1 || m.sin_acceso === true);
                    const rechazado    = m?.estado_revision_ocr === 'rechazado';

                    return (
                      <div key={tipo} className={`${styles.medCard} ${rechazado ? styles.medCardRechazado : ''}`}>
                        <div className={styles.medHeader} style={{ borderColor: meta.color }}>
                          <span>{meta.emoji} {meta.label}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {rechazado && <span className={styles.rechazadoBadge}>Rechazado</span>}
                            <strong className={styles.lectura}>
                              {!m || sinEvidencia ? '–' : (lectura || '–')}
                            </strong>
                          </div>
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
                          <img src={`/uploads/${m.foto_path}`} alt={`Medidor ${tipo}`} className={styles.foto} />
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

                {/* Botón Subsanar */}
                {visit.estado === 'rechazada' && medidoresRechazados.length > 0 && (
                  <div className={styles.section}>
                    <button className={styles.btnSubsanar} onClick={() => setSubsanarMode(true)}>
                      🔧 Subsanar visita rechazada
                    </button>
                    <p className={styles.subsanarHint}>
                      {medidoresRechazados.length} medidor{medidoresRechazados.length !== 1 ? 'es' : ''} necesita{medidoresRechazados.length !== 1 ? 'n' : ''} corrección
                    </p>
                  </div>
                )}

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
              </>
            )}

            {/* ════════════════════════════════════════════════
                VISTA SUBSANAR
            ════════════════════════════════════════════════ */}
            {subsanarMode && (
              <>
                {subsanarDone ? (
                  /* ── Éxito ── */
                  <div className={styles.subsanarSuccess}>
                    <div className={styles.subsanarSuccessIcon}>
                      {subsanarOffline ? '📱' : '✅'}
                    </div>
                    <h3>
                      {subsanarOffline ? 'Subsanación guardada' : 'Subsanación enviada'}
                    </h3>
                    <p>
                      {subsanarOffline
                        ? 'No había conexión, pero tu subsanación quedó guardada en el dispositivo. Se enviará automáticamente cuando recuperes señal.'
                        : 'Tu visita está siendo reprocesada. En unos momentos verás el resultado actualizado en tu listado de visitas.'}
                    </p>
                    <button className={styles.btnSubsanarOk} onClick={onUpdated}>
                      Entendido
                    </button>
                  </div>
                ) : (
                  /* ── Formulario ── */
                  <>
                    {/* Banner offline */}
                    {!online && (
                      <div className={styles.offlineBanner}>
                        📵 Sin conexión — las fotos se guardarán localmente y se enviarán al recuperar señal
                      </div>
                    )}

                    <div className={styles.subsanarInfo}>
                      <p>Corrige los medidores rechazados subiendo una nueva foto o ingresando la lectura correcta. Los medidores ya aprobados no serán modificados.</p>
                    </div>

                    {medidoresRechazados.map(m => {
                      const meta  = TIPO_META[m.tipo];
                      const datos = subsanarData[m.id] || {};

                      return (
                        <div key={m.id} className={styles.subsanarCard}>

                          {/* Cabecera */}
                          <div className={styles.subsanarCardHeader} style={{ borderColor: meta.color }}>
                            <span className={styles.subsanarCardTipo}>
                              {meta.emoji} Medidor de {meta.label}
                            </span>
                            <span className={styles.subsanarBadge}>Rechazado</span>
                          </div>

                          {/* Motivo */}
                          {m.nota_ocr && (
                            <div className={styles.subsanarMotivo}>
                              💬 {m.nota_ocr}
                            </div>
                          )}

                          {/* Fotos */}
                          <div className={styles.subsanarFotoRow}>
                            {m.foto_path && !datos.preview && (
                              <div className={styles.subsanarFotoBox}>
                                <span className={styles.subsanarFotoLabel}>Foto actual</span>
                                <img src={`/uploads/${m.foto_path}`} alt="actual" className={styles.subsanarFotoImg} />
                              </div>
                            )}
                            {datos.preview && (
                              <div className={styles.subsanarFotoBox}>
                                <span className={styles.subsanarFotoLabel}>
                                  {datos.uploading
                                    ? '⏳ Subiendo...'
                                    : datos.foto_file
                                      ? '💾 Guardada localmente'
                                      : '✓ Lista'}
                                </span>
                                <img
                                  src={datos.preview}
                                  alt="nueva"
                                  className={`${styles.subsanarFotoImg} ${datos.uploading ? styles.subsanarFotoUploading : ''}`}
                                />
                              </div>
                            )}
                          </div>

                          {/* Botón capturar */}
                          <label className={`${styles.btnCapturar} ${datos.uploading ? styles.btnCapturarDisabled : ''}`}>
                            📷 {datos.foto_path || datos.foto_file ? 'Cambiar foto' : 'Capturar nueva foto'}
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              style={{ display: 'none' }}
                              disabled={datos.uploading}
                              onChange={e => e.target.files[0] && handleFotoChange(m.id, e.target.files[0])}
                            />
                          </label>

                          {/* Lectura */}
                          <div className={styles.subsanarLecturaRow}>
                            <label className={styles.subsanarLecturaLabel}>
                              Lectura del medidor
                              <span className={styles.subsanarLecturaOpc}> (opcional si es visible en la foto)</span>
                            </label>
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="Ej: 00201.126"
                              value={datos.lectura || ''}
                              onChange={e => handleLecturaChange(m.id, e.target.value)}
                              className={styles.subsanarInput}
                            />
                          </div>

                        </div>
                      );
                    })}

                    {subsanarError && (
                      <div className={styles.subsanarErrorBox}>{subsanarError}</div>
                    )}

                    <button
                      className={styles.btnEnviarSubsanar}
                      onClick={handleSubmitSubsanar}
                      disabled={subsanarSaving || Object.values(subsanarData).some(d => d.uploading)}
                    >
                      {subsanarSaving
                        ? '⏳ Guardando...'
                        : online
                          ? '✓ Enviar subsanación'
                          : '💾 Guardar para enviar después'}
                    </button>
                  </>
                )}
              </>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
