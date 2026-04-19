import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import VisitModal from './VisitModal';
import styles from './AdminAlerts.module.css';

const TIPO_META = {
  luz:  { label: 'Luz',  emoji: '⚡' },
  agua: { label: 'Agua', emoji: '💧' },
  gas:  { label: 'Gas',  emoji: '🔥' },
};

function tipoAlerta(a) {
  if (a.sin_acceso)       return 'sin_acceso';
  if (a.es_medidor === 0) return 'no_es_medidor';
  if (!a.lectura_ocr)     return 'sin_deteccion';
  if (a.lectura_ocr && a.lectura_confirmada && a.lectura_ocr !== a.lectura_confirmada)
                          return 'discrepancia';
  return 'baja_confianza';
}

export default function AdminAlerts() {
  const [alerts, setAlerts]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [viewVisitId, setViewVisitId] = useState(null);
  const [lightbox, setLightbox]       = useState(null);
  const [editing, setEditing]         = useState(null); // medidor_id en edición
  const [newVal, setNewVal]           = useState('');
  const [saving, setSaving]           = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/admin/alerts')
      .then(r => setAlerts(r.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Resolver un hallazgo a nivel de medidor
  const resolver = async (id, estado_revision_ocr, lectura_confirmada = null) => {
    setSaving(true);
    try {
      await api.patch(`/admin/medidores/${id}`, { estado_revision_ocr, lectura_confirmada });
      load();
    } finally {
      setSaving(false);
    }
  };

  // Guardar lectura corregida manualmente
  const confirmarLectura = async (id) => {
    if (!newVal.trim()) return;
    setSaving(true);
    try {
      await api.patch(`/admin/medidores/${id}`, {
        estado_revision_ocr: 'corregido',
        lectura_confirmada: newVal.trim(),
      });
      setEditing(null);
      setNewVal('');
      load();
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className={styles.loading}>Cargando alertas...</div>;

  if (!alerts.length) return (
    <div className={styles.empty}>
      <span>✅</span>
      <p>No hay alertas OCR pendientes</p>
    </div>
  );

  return (
    <div>
      <p className={styles.count}>
        {alerts.length} medidor{alerts.length !== 1 ? 'es' : ''} requiere{alerts.length === 1 ? '' : 'n'} revisión
      </p>

      <div className={styles.list}>
        {alerts.map(a => {
          const meta        = TIPO_META[a.tipo];
          const tipo        = tipoAlerta(a);
          const sinDet      = tipo === 'sin_deteccion';
          const sinAcceso   = tipo === 'sin_acceso';
          const noEsMedidor = tipo === 'no_es_medidor';
          const discrepancia = tipo === 'discrepancia';
          const isEditing   = editing === a.medidor_id;

          return (
            <div
              key={a.medidor_id}
              className={`${styles.card} ${(sinDet || noEsMedidor) ? styles.cardSinDeteccion : ''} ${sinAcceso ? styles.cardSinAcceso : ''}`}
            >
              {/* Cabecera */}
              <div className={styles.cardHeader}>
                <span className={styles.tipo}>{meta.emoji} Medidor de {meta.label}</span>
                {sinAcceso
                  ? <span className={styles.badgeSinAcceso}>🚫 Sin acceso</span>
                  : noEsMedidor
                    ? <span className={styles.badgeSinDeteccion}>🚫 No es medidor</span>
                    : sinDet
                      ? <span className={styles.badgeSinDeteccion}>📸 Sin detección</span>
                      : discrepancia
                        ? <span className={styles.badgeDiscrepancia}>⚠️ Discrepancia</span>
                        : <span className={`${styles.confianza} ${styles[a.confianza_ocr]}`}>
                            {a.confianza_ocr?.toUpperCase()}
                          </span>
                }
              </div>

              {/* Info ubicación */}
              <div className={styles.info}>
                <span>🆔 Visita #{a.visita_id}</span>
                <span>📍 {a.ciudad} · {a.conjunto}{a.torre ? ` · Torre ${a.torre}` : ''} · Apto {a.apartamento}</span>
                <span>👤 {a.auditor}</span>
                <span>📅 {new Date(a.fecha).toLocaleDateString('es-CO')}</span>
              </div>
              <button className={styles.btnVerVisita} onClick={() => setViewVisitId(a.visita_id)}>
                🔍 Ver visita #{a.visita_id}
              </button>

              {/* Foto */}
              {a.foto_path && (
                <img
                  src={`/uploads/${a.foto_path}`}
                  alt="Foto medidor"
                  className={styles.foto}
                  onClick={() => setLightbox(`/uploads/${a.foto_path}`)}
                />
              )}

              {/* ── Sin acceso ── */}
              {sinAcceso && (
                <div className={styles.sinAccesoBox}>
                  <div className={styles.sinDeteccionTitle}>🚫 El auditor no pudo acceder a este medidor</div>
                  {a.motivo_sin_acceso && (
                    <div className={styles.sinDeteccionNota}>💬 {a.motivo_sin_acceso}</div>
                  )}
                  <div className={styles.sinDeteccionDesc}>
                    Aprueba si el motivo es válido, o rechaza esta lectura para que el auditor vuelva a intentarlo.
                  </div>
                </div>
              )}

              {/* ── No es medidor ── */}
              {noEsMedidor && (
                <div className={styles.sinDeteccionBox}>
                  <div className={styles.sinDeteccionTitle}>🚫 La IA detectó que esta foto no corresponde a un medidor</div>
                  {a.nota_ocr && (
                    <div className={styles.sinDeteccionNota}>💬 {a.nota_ocr}</div>
                  )}
                  <div className={styles.sinDeteccionDesc}>
                    El auditor registró la visita offline sin poder verificar la foto con IA.
                    Aprueba si el contexto lo justifica, o rechaza esta lectura para que se vuelva a registrar.
                  </div>
                </div>
              )}

              {/* ── Sin detección ── */}
              {sinDet && (
                <div className={styles.sinDeteccionBox}>
                  <div className={styles.sinDeteccionTitle}>⚠️ La IA no pudo leer el número del medidor</div>
                  {a.nota_ocr && (
                    <div className={styles.sinDeteccionNota}>💬 {a.nota_ocr}</div>
                  )}
                  <div className={styles.sinDeteccionDesc}>
                    Ingresa la lectura correcta revisando la foto, o rechaza esta lectura para que el auditor retome la foto.
                  </div>
                </div>
              )}

              {/* ── Discrepancia / baja confianza ── */}
              {!sinDet && !sinAcceso && !noEsMedidor && (
                <div className={styles.readings}>
                  {discrepancia && (
                    <div className={styles.discrepanciaAlert}>
                      ⚠️ <strong>Discrepancia:</strong> el auditor registró un valor diferente al detectado por la IA.
                      Verifica la foto para confirmar cuál es el valor correcto.
                    </div>
                  )}
                  <div><strong>IA detectó:</strong> <code>{a.lectura_ocr ?? '–'}</code></div>
                  <div>
                    <strong>Auditor registró:</strong>{' '}
                    <code className={discrepancia ? styles.discrepanciaVal : ''}>{a.lectura_confirmada ?? '–'}</code>
                  </div>
                  {a.nota_ocr && <div className={styles.nota}>💬 {a.nota_ocr}</div>}
                  {a.calidad_foto && a.calidad_foto !== 'buena' && (
                    <div className={`${styles.nota} ${a.calidad_foto === 'mala' ? styles.notaMala : ''}`}>
                      📷 Calidad de foto: <strong>{a.calidad_foto}</strong>
                      {a.motivo_calidad && ` — ${a.motivo_calidad}`}
                    </div>
                  )}
                </div>
              )}

              {/* Formulario: ingresar / corregir lectura */}
              {isEditing && (
                <div className={styles.editRow}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={newVal}
                    onChange={e => setNewVal(e.target.value)}
                    placeholder="Ej: 00123.45"
                    autoFocus
                  />
                  <button
                    className={styles.saveBtn}
                    onClick={() => confirmarLectura(a.medidor_id)}
                    disabled={!newVal.trim() || saving}
                  >
                    {saving ? '...' : '✓ Guardar'}
                  </button>
                  <button
                    className={styles.cancelBtn}
                    onClick={() => { setEditing(null); setNewVal(''); }}
                  >
                    Cancelar
                  </button>
                </div>
              )}

              {/* ── Botones de acción ── */}
              {!isEditing && (
                <div className={styles.actionRow}>
                  {/* Sin acceso / No es medidor */}
                  {(sinAcceso || noEsMedidor) && (
                    <>
                      <button
                        className={styles.btnAprobar}
                        onClick={() => resolver(a.medidor_id, 'aprobado')}
                        disabled={saving}
                      >
                        ✓ Aprobar lectura
                      </button>
                      <button
                        className={styles.btnRechazar}
                        onClick={() => resolver(a.medidor_id, 'rechazado')}
                        disabled={saving}
                      >
                        ✕ Rechazar lectura
                      </button>
                    </>
                  )}

                  {/* Sin detección */}
                  {sinDet && (
                    <>
                      <button
                        className={styles.btnManual}
                        onClick={() => { setEditing(a.medidor_id); setNewVal(''); }}
                      >
                        📝 Ingresar lectura
                      </button>
                      <button
                        className={styles.btnRechazar}
                        onClick={() => resolver(a.medidor_id, 'rechazado')}
                        disabled={saving}
                      >
                        ✕ Rechazar lectura
                      </button>
                    </>
                  )}

                  {/* Discrepancia */}
                  {discrepancia && (
                    <>
                      <button
                        className={styles.btnAprobarLectura}
                        onClick={() => resolver(a.medidor_id, 'aprobado', a.lectura_confirmada)}
                        disabled={saving}
                      >
                        ✓ Confirmar valor del auditor ({a.lectura_confirmada})
                      </button>
                      <button
                        className={styles.reviewBtn}
                        onClick={() => { setEditing(a.medidor_id); setNewVal(a.lectura_confirmada || a.lectura_ocr || ''); }}
                      >
                        ✏️ Corregir
                      </button>
                      <button
                        className={styles.btnRechazar}
                        onClick={() => resolver(a.medidor_id, 'rechazado')}
                        disabled={saving}
                      >
                        ✕ Rechazar lectura
                      </button>
                    </>
                  )}

                  {/* Baja confianza */}
                  {!sinDet && !sinAcceso && !noEsMedidor && !discrepancia && (
                    <>
                      <button
                        className={styles.btnAprobar}
                        onClick={() => resolver(a.medidor_id, 'aprobado', a.lectura_confirmada)}
                        disabled={saving}
                      >
                        ✓ Confirmar lectura
                      </button>
                      <button
                        className={styles.reviewBtn}
                        onClick={() => { setEditing(a.medidor_id); setNewVal(a.lectura_confirmada || a.lectura_ocr || ''); }}
                      >
                        ✏️ Corregir lectura
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {viewVisitId && (
        <VisitModal
          visitId={viewVisitId}
          onClose={() => setViewVisitId(null)}
          onUpdated={() => { setViewVisitId(null); load(); }}
        />
      )}

      {lightbox && (
        <div className={styles.lightboxOverlay} onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="Foto ampliada" className={styles.lightboxImg} />
          <button className={styles.lightboxClose} onClick={() => setLightbox(null)}>✕</button>
        </div>
      )}
    </div>
  );
}
