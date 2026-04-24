import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import styles from './VisitModal.module.css';

const API_BASE = '';

function formatDuracion(inicio, fin) {
  if (!inicio || !fin) return null;
  const ms = new Date(fin) - new Date(inicio);
  if (ms <= 0) return null;
  const seg = Math.round(ms / 1000);
  if (seg < 60) return `${seg} seg`;
  const min = Math.floor(seg / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

const TIPO_META = {
  luz:  { emoji: '⚡', label: 'Luz',  color: '#F59E0B' },
  agua: { emoji: '💧', label: 'Agua', color: '#3B82F6' },
  gas:  { emoji: '🔥', label: 'Gas',  color: '#EF4444' },
};

const CONF_STYLE = {
  alta:  { bg: '#D1FAE5', color: '#065F46' },
  media: { bg: '#FEF3C7', color: '#92400E' },
  baja:  { bg: '#FEE2E2', color: '#991B1B' },
};

export default function VisitModal({ visitId, onClose, onUpdated }) {
  const [visit, setVisit]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [action, setAction]     = useState(null);
  const [motivo, setMotivo]     = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [lightbox, setLightbox] = useState(null);

  // ── Edición de ubicación ───────────────────────────────────────────────────
  const [editingUbic, setEditingUbic]   = useState(false);
  const [ubicForm, setUbicForm]         = useState({ ciudad_id: '', conjunto_id: '', torre_id: '', apartamento: '' });
  const [ubicCiudades, setUbicCiudades] = useState([]);
  const [ubicConjuntos, setUbicConjuntos] = useState([]);
  const [ubicTorres, setUbicTorres]     = useState([]);
  const [ubicSaving, setUbicSaving]     = useState(false);
  const [ubicError, setUbicError]       = useState('');

  const openEditUbic = async () => {
    setUbicError('');
    // Cargar ciudades
    const { data: ciudades } = await api.get('/catalogs/ciudades');
    setUbicCiudades(ciudades);
    // Cargar conjuntos de la ciudad actual
    const { data: conjuntos } = await api.get(`/catalogs/conjuntos?ciudad_id=${visit.ciudad_id}`);
    setUbicConjuntos(conjuntos);
    // Cargar torres del conjunto actual (si tiene)
    if (visit.conjunto_id) {
      const { data: torres } = await api.get(`/catalogs/torres?conjunto_id=${visit.conjunto_id}`);
      setUbicTorres(torres);
    } else {
      setUbicTorres([]);
    }
    setUbicForm({
      ciudad_id:   visit.ciudad_id   || '',
      conjunto_id: visit.conjunto_id || '',
      torre_id:    visit.torre_id    || '',
      apartamento: visit.apartamento || '',
    });
    setEditingUbic(true);
  };

  const handleUbicCiudad = async (ciudad_id) => {
    setUbicForm(f => ({ ...f, ciudad_id, conjunto_id: '', torre_id: '' }));
    setUbicConjuntos([]);
    setUbicTorres([]);
    if (ciudad_id) {
      const { data } = await api.get(`/catalogs/conjuntos?ciudad_id=${ciudad_id}`);
      setUbicConjuntos(data);
    }
  };

  const handleUbicConjunto = async (conjunto_id) => {
    setUbicForm(f => ({ ...f, conjunto_id, torre_id: '' }));
    setUbicTorres([]);
    if (conjunto_id) {
      const { data } = await api.get(`/catalogs/torres?conjunto_id=${conjunto_id}`);
      setUbicTorres(data);
    }
  };

  const saveUbicacion = async () => {
    if (!ubicForm.ciudad_id || !ubicForm.conjunto_id || !ubicForm.apartamento.trim()) {
      setUbicError('Ciudad, conjunto y apartamento son obligatorios');
      return;
    }
    setUbicSaving(true);
    setUbicError('');
    try {
      await api.patch(`/admin/visits/${visitId}/ubicacion`, {
        ciudad_id:   parseInt(ubicForm.ciudad_id),
        conjunto_id: parseInt(ubicForm.conjunto_id),
        torre_id:    ubicForm.torre_id ? parseInt(ubicForm.torre_id) : null,
        apartamento: ubicForm.apartamento.trim(),
      });
      // Recargar visita y refrescar lista
      const { data } = await api.get(`/admin/visits/${visitId}`);
      setVisit(data);
      setEditingUbic(false);
      if (onUpdated) onUpdated();
    } catch (e) {
      setUbicError(e.response?.data?.error || 'Error al guardar');
    } finally {
      setUbicSaving(false);
    }
  };

  useEffect(() => {
    api.get(`/admin/visits/${visitId}`)
      .then(r => setVisit(r.data))
      .finally(() => setLoading(false));
  }, [visitId]);

  const handleEstado = async (estado) => {
    if (estado === 'rechazada' && !motivo.trim()) {
      setError('Debes indicar el motivo del rechazo');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.patch(`/admin/visits/${visitId}/estado`, { estado, motivo_rechazo: motivo });
      onUpdated();
    } catch (e) {
      setError(e.response?.data?.error || 'Error al guardar');
      setSaving(false);
    }
  };

  const canEdit = !visit || !['aprobada', 'rechazada', 'anulada'].includes(visit.estado);
  const alertasPendientes = visit?.medidores?.filter(m => m.requiere_revision === 1) ?? [];

  return (
    <>
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <h2>Detalle de visita #{visitId}</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {loading
          ? <div className={styles.loading}>Cargando...</div>
          : visit && (
            <div className={styles.body}>

              {/* Info general */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h3>Información general</h3>
                  {!editingUbic && visit.estado !== 'anulada' && (
                    <button className={styles.btnEditUbic} onClick={openEditUbic}>✏️ Editar ubicación</button>
                  )}
                </div>

                {/* Modo edición de ubicación */}
                {editingUbic ? (
                  <div className={styles.ubicForm}>
                    <div className={styles.ubicGrid}>
                      <div className={styles.ubicField}>
                        <label>Ciudad *</label>
                        <select
                          value={ubicForm.ciudad_id}
                          onChange={e => handleUbicCiudad(e.target.value)}
                        >
                          <option value="">— Seleccione ciudad —</option>
                          {ubicCiudades.map(c => (
                            <option key={c.id} value={c.id}>{c.nombre}</option>
                          ))}
                        </select>
                      </div>

                      <div className={styles.ubicField}>
                        <label>Conjunto *</label>
                        <select
                          value={ubicForm.conjunto_id}
                          onChange={e => handleUbicConjunto(e.target.value)}
                          disabled={!ubicForm.ciudad_id}
                        >
                          <option value="">— Seleccione conjunto —</option>
                          {ubicConjuntos.map(c => (
                            <option key={c.id} value={c.id}>{c.nombre}</option>
                          ))}
                        </select>
                      </div>

                      <div className={styles.ubicField}>
                        <label>Torre</label>
                        <select
                          value={ubicForm.torre_id}
                          onChange={e => setUbicForm(f => ({ ...f, torre_id: e.target.value }))}
                          disabled={!ubicForm.conjunto_id}
                        >
                          <option value="">— Sin torre —</option>
                          {ubicTorres.map(t => (
                            <option key={t.id} value={t.id}>{t.nombre}</option>
                          ))}
                        </select>
                      </div>

                      <div className={styles.ubicField}>
                        <label>Apartamento *</label>
                        <input
                          type="text"
                          value={ubicForm.apartamento}
                          onChange={e => setUbicForm(f => ({ ...f, apartamento: e.target.value }))}
                          placeholder="Ej: 301"
                        />
                      </div>
                    </div>

                    {ubicError && <p className={styles.ubicError}>{ubicError}</p>}

                    <div className={styles.ubicActions}>
                      <button
                        className={styles.btnGuardarUbic}
                        onClick={saveUbicacion}
                        disabled={ubicSaving}
                      >
                        {ubicSaving ? 'Guardando...' : '✓ Guardar cambios'}
                      </button>
                      <button
                        className={styles.btnCancelarUbic}
                        onClick={() => { setEditingUbic(false); setUbicError(''); }}
                        disabled={ubicSaving}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.grid}>
                    <div className={styles.field}><label>Fecha</label><span>{new Date(visit.fecha).toLocaleString('es-CO')}</span></div>
                    {visit.hora_inicio && (
                      <div className={styles.field}><label>Hora inicio</label><span>{new Date(visit.hora_inicio).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span></div>
                    )}
                    {visit.hora_fin && (
                      <div className={styles.field}><label>Hora fin</label><span>{new Date(visit.hora_fin).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span></div>
                    )}
                    {formatDuracion(visit.hora_inicio, visit.hora_fin) && (
                      <div className={styles.field}><label>Duración</label><span>{formatDuracion(visit.hora_inicio, visit.hora_fin)}</span></div>
                    )}
                    <div className={styles.field}><label>Auditor</label><span>{visit.auditor}</span></div>
                    <div className={styles.field}><label>Ciudad</label><span>{visit.ciudad}</span></div>
                    <div className={styles.field}><label>Conjunto</label><span>{visit.conjunto}</span></div>
                    <div className={styles.field}><label>Torre</label><span>{visit.torre || '–'}</span></div>
                    <div className={styles.field}><label>Apartamento</label><span><strong>{visit.apartamento}</strong></span></div>
                    {visit.latitud && (
                      <div className={styles.field}>
                        <label>Georreferenciación</label>
                        <a
                          href={`https://www.google.com/maps?q=${visit.latitud},${visit.longitud}`}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.mapLink}
                        >
                          📍 {visit.latitud}, {visit.longitud}
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {visit.observaciones && (
                  <div className={styles.obs}>
                    <label>Observaciones del auditor</label>
                    <p>{visit.observaciones}</p>
                  </div>
                )}
              </div>

              {/* Medidores — siempre los 3 tipos */}
              <div className={styles.section}>
                <h3>Medidores</h3>
                <div className={styles.medidores}>
                  {['luz', 'agua', 'gas'].map(tipo => {
                    const meta  = TIPO_META[tipo];
                    const m     = (visit.medidores || []).find(x => x.tipo === tipo);
                    const conf  = m ? (CONF_STYLE[m.confianza_ocr] || CONF_STYLE.baja) : null;
                    const delta = m && m.delta !== null && m.delta !== undefined ? parseFloat(m.delta) : null;
                    const deltaAnomalo = delta !== null && delta <= 0;
                    const hayDiscrepancia = m && m.lectura_ocr && m.lectura_confirmada &&
                      m.lectura_ocr !== m.lectura_confirmada;
                    const sinEvidencia = m && (m.sin_acceso == 1 || m.sin_acceso === true);

                    // Banner: hallazgo pendiente o tag de resolución
                    const estadoRevision = m?.estado_revision_ocr;
                    const hallazgo = m?.requiere_revision ? (() => {
                      if (sinEvidencia)             return { icon: '🚫', msg: 'Sin evidencia — auditor no pudo acceder' };
                      if (m.es_medidor === 0)       return { icon: '🚫', msg: 'La IA detectó que la foto no es un medidor' };
                      if (hayDiscrepancia)          return { icon: '⚠️', msg: `Discrepancia: IA detectó ${m.lectura_ocr} pero el auditor registró ${m.lectura_confirmada}` };
                      if (!m.lectura_confirmada)    return { icon: '📸', msg: 'La IA no pudo leer el número del medidor' };
                      if (deltaAnomalo)             return { icon: '📉', msg: delta < 0 ? 'Lectura inferior a la visita anterior' : 'Sin variación respecto a la visita anterior' };
                      if (m.calidad_foto === 'mala') return { icon: '📷', msg: 'Foto de mala calidad' };
                      return { icon: '⚠️', msg: 'Requiere revisión' };
                    })() : null;
                    const revisionTag = !m?.requiere_revision && estadoRevision && estadoRevision !== 'pendiente'
                      ? estadoRevision : null;

                    const cardExtra = m?.requiere_revision
                      ? styles.medCardAlerta
                      : estadoRevision === 'rechazado' ? styles.medCardRechazado
                      : estadoRevision === 'aprobado'  ? styles.medCardAprobado
                      : estadoRevision === 'corregido' ? styles.medCardCorregido
                      : '';

                    return (
                      <div key={tipo} className={`${styles.medCard} ${cardExtra}`}>
                        {/* Cabecera */}
                        <div className={styles.medHeader} style={{ borderColor: meta?.color }}>
                          <span>{meta?.emoji} {meta?.label}</span>
                          <div className={styles.medBadges}>
                            {m && m.calidad_foto && m.calidad_foto !== 'buena' && (
                              <span className={styles[`calidad_${m.calidad_foto}`]}>
                                {m.calidad_foto === 'mala' ? '📷 Foto mala' : '📷 Foto aceptable'}
                              </span>
                            )}
                            {m && m.confianza_ocr && (
                              <span className={styles.confBadge} style={conf}>
                                IA {m.confianza_ocr}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Banner: hallazgo pendiente */}
                        {hallazgo && (
                          <div className={styles.hallazgoOcr}>
                            <span>{hallazgo.icon}</span>
                            <span>{hallazgo.msg}</span>
                          </div>
                        )}
                        {/* Tag: resolución del admin */}
                        {revisionTag && (
                          <div className={`${styles.revisionTag} ${styles[`revision_${revisionTag}`]}`}>
                            {revisionTag === 'aprobado'  && '✓ Lectura aprobada'}
                            {revisionTag === 'rechazado' && '✕ Lectura rechazada'}
                            {revisionTag === 'corregido' && '✏️ Lectura corregida por administrador'}
                          </div>
                        )}

                        {/* Sin medidor registrado */}
                        {!m ? (
                          <div className={styles.noFotoBox}>
                            <span className={styles.noFotoIcon}>📋</span>
                            <span>No se registró este medidor</span>
                          </div>
                        ) : sinEvidencia ? (
                          <div className={styles.sinAccesoAlert}>
                            <span>📵</span>
                            <div>
                              <strong>No se pudo capturar evidencia</strong>
                              {m.motivo_sin_acceso && ` — ${m.motivo_sin_acceso}`}
                            </div>
                          </div>
                        ) : (
                          <>
                            {m.foto_path ? (
                              <img
                                src={`/uploads/${m.foto_path}`}
                                alt={`Medidor ${tipo}`}
                                className={styles.medFoto}
                                onClick={() => setLightbox(`/uploads/${m.foto_path}`)}
                              />
                            ) : (
                              <div className={styles.noFotoBox}>
                                <span className={styles.noFotoIcon}>📷</span>
                                <span>No se capturó foto para este medidor</span>
                              </div>
                            )}

                            <div className={styles.medData}>
                              {m.primera_lectura ? (
                                <div className={styles.deltaInfo}>📋 Primera lectura registrada</div>
                              ) : m.lectura_anterior ? (
                                <div className={`${styles.deltaInfo} ${deltaAnomalo ? styles.deltaAnomalo : styles.deltaOk}`}>
                                  <span>Anterior: <strong>{m.lectura_anterior}</strong></span>
                                  <span>Delta: <strong>{delta > 0 ? `+${delta}` : delta}</strong></span>
                                  {deltaAnomalo && <span className={styles.deltaAlerta}>⚠️ {delta < 0 ? 'Lectura inferior a anterior' : 'Sin variación'}</span>}
                                </div>
                              ) : null}

                              {hayDiscrepancia ? (
                                <div className={styles.discrepanciaBox}>
                                  <div><label>IA detectó:</label> <code>{m.lectura_ocr}</code></div>
                                  <div><label>Auditor corrigió a:</label> <strong className={styles.lecturaVal}>{m.lectura_confirmada}</strong></div>
                                </div>
                              ) : (
                                <div className={styles.lecturaRow}>
                                  {m.lectura_ocr && <div><label>OCR:</label> <code>{m.lectura_ocr}</code></div>}
                                  <div><label>Lectura:</label> <strong className={styles.lecturaVal}>{m.lectura_confirmada || '–'}</strong></div>
                                </div>
                              )}

                              {m.motivo_calidad && <div className={styles.notaOcr}>📷 {m.motivo_calidad}</div>}
                              {m.nota_ocr && <div className={styles.notaOcr}>💬 {m.nota_ocr}</div>}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Estado actual */}
              <div className={styles.section}>
                <h3>Estado de la visita</h3>
                {visit.estado === 'rechazada' && visit.motivo_rechazo && (
                  <div className={styles.motivoBox}>
                    <strong>Motivo de rechazo:</strong> {visit.motivo_rechazo}
                  </div>
                )}
                {visit.revisado_por_nombre && (
                  <p className={styles.revisadoPor}>
                    Revisado por {visit.revisado_por_nombre} · {new Date(visit.revisado_en).toLocaleString('es-CO')}
                  </p>
                )}

                {/* Acciones — solo si está pendiente */}
                {canEdit && !action && alertasPendientes.length > 0 && (
                  <div className={styles.alertasBloqueo}>
                    ⚠️ Esta visita tiene <strong>{alertasPendientes.length} hallazgo{alertasPendientes.length !== 1 ? 's' : ''} OCR pendiente{alertasPendientes.length !== 1 ? 's' : ''}</strong>.
                    Resuélvelos en <strong>Alertas OCR</strong> antes de aprobar o rechazar.
                  </div>
                )}
                {canEdit && !action && alertasPendientes.length === 0 && (
                  <div className={styles.actions}>
                    <button className={styles.btnAprobar} onClick={() => handleEstado('aprobada')} disabled={saving}>
                      ✓ Aprobar visita
                    </button>
                    <button className={styles.btnRechazar} onClick={() => setAction('rechazar')}>
                      ✕ Rechazar visita
                    </button>
                  </div>
                )}

                {action === 'rechazar' && (
                  <div className={styles.rechazarForm}>
                    <label>Motivo del rechazo *</label>
                    <textarea
                      value={motivo}
                      onChange={e => setMotivo(e.target.value)}
                      placeholder="Describe el motivo del rechazo..."
                      rows={3}
                      autoFocus
                    />
                    {error && <p className={styles.error}>{error}</p>}
                    <div className={styles.rechazarBtns}>
                      <button className={styles.btnRechazar} onClick={() => handleEstado('rechazada')} disabled={saving || !motivo.trim()}>
                        {saving ? 'Guardando...' : 'Confirmar rechazo'}
                      </button>
                      <button className={styles.btnCancelar} onClick={() => { setAction(null); setError(''); }}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {!canEdit && (
                  <div className={`${styles.estadoFinal} ${styles[visit.estado]}`}>
                    {visit.estado === 'aprobada'  ? '✓ Visita aprobada'
                     : visit.estado === 'anulada' ? '🚫 Visita anulada'
                     : '✕ Visita rechazada'}
                  </div>
                )}
              </div>

            </div>
          )
        }
      </div>
    </div>

    {/* Lightbox */}
    {lightbox && (
      <div className={styles.lightboxOverlay} onClick={() => setLightbox(null)}>
        <button className={styles.lightboxClose} onClick={() => setLightbox(null)}>✕</button>
        <img src={lightbox} alt="Foto ampliada" className={styles.lightboxImg} onClick={e => e.stopPropagation()} />
      </div>
    )}
  </>
  );
}
