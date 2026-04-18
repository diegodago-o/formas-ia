import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import styles from './AdminAlerts.module.css';

const TIPO_META = {
  luz:  { label: 'Luz',  emoji: '⚡' },
  agua: { label: 'Agua', emoji: '💧' },
  gas:  { label: 'Gas',  emoji: '🔥' },
};

// Determina el tipo de alerta para bifurcar el flujo
function tipoAlerta(a) {
  if (!a.lectura_ocr) return 'sin_deteccion';   // OCR no encontró ningún número
  return 'baja_confianza';                        // OCR lo leyó pero con baja confianza / diferencia
}

export default function AdminAlerts() {
  const [alerts, setAlerts]     = useState([]);
  const [loading, setLoading]   = useState(true);

  // Estado para "ingresar lectura manual"
  const [editing, setEditing]   = useState(null); // medidor_id
  const [newVal, setNewVal]     = useState('');
  const [saving, setSaving]     = useState(false);

  // Estado para "rechazar visita"
  const [rejecting, setRejecting] = useState(null); // { visita_id, tipo, medidor_id }
  const [rejectMotivo, setRejectMotivo] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/admin/alerts')
      .then(r => setAlerts(r.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Confirmar lectura manual
  const confirmLectura = async (id) => {
    if (!newVal.trim()) return;
    setSaving(true);
    try {
      await api.patch(`/admin/medidores/${id}`, { lectura_confirmada: newVal.trim() });
      setEditing(null);
      setNewVal('');
      load();
    } finally {
      setSaving(false);
    }
  };

  // Rechazar la visita completa (foto no corresponde al medidor)
  const rechazarVisita = async () => {
    if (!rejecting) return;
    setSaving(true);
    const motivo = rejectMotivo.trim() ||
      `Foto incorrecta en medidor de ${TIPO_META[rejecting.tipo]?.label || rejecting.tipo}. La foto no muestra el medidor. Se requiere nueva visita.`;
    try {
      await api.patch(`/admin/visits/${rejecting.visita_id}/estado`, {
        estado: 'rechazada',
        motivo_rechazo: motivo,
      });
      setRejecting(null);
      setRejectMotivo('');
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
          const meta      = TIPO_META[a.tipo];
          const tipo      = tipoAlerta(a);
          const sinDet    = tipo === 'sin_deteccion';
          const isEditing   = editing === a.medidor_id;
          const isRejecting = rejecting?.medidor_id === a.medidor_id;

          return (
            <div
              key={a.medidor_id}
              className={`${styles.card} ${sinDet ? styles.cardSinDeteccion : ''}`}
            >
              {/* Cabecera */}
              <div className={styles.cardHeader}>
                <span className={styles.tipo}>{meta.emoji} Medidor de {meta.label}</span>
                {sinDet
                  ? <span className={styles.badgeSinDeteccion}>📸 Sin detección</span>
                  : <span className={`${styles.confianza} ${styles[a.confianza_ocr]}`}>
                      {a.confianza_ocr?.toUpperCase()}
                    </span>
                }
              </div>

              {/* Info ubicación */}
              <div className={styles.info}>
                <span>📍 {a.ciudad} · {a.conjunto}{a.torre ? ` · Torre ${a.torre}` : ''} · Apto {a.apartamento}</span>
                <span>👤 {a.auditor}</span>
                <span>📅 {new Date(a.fecha).toLocaleDateString('es-CO')}</span>
              </div>

              {/* Foto */}
              {a.foto_path && (
                <a href={`/uploads/${a.foto_path}`} target="_blank" rel="noreferrer">
                  <img
                    src={`/uploads/${a.foto_path}`}
                    alt="Foto medidor"
                    className={styles.foto}
                  />
                </a>
              )}

              {/* ── Caso A: Sin detección — foto no es un medidor ── */}
              {sinDet && (
                <div className={styles.sinDeteccionBox}>
                  <div className={styles.sinDeteccionTitle}>
                    ⚠️ La IA no encontró un medidor en esta foto
                  </div>
                  {a.nota_ocr && (
                    <div className={styles.sinDeteccionNota}>💬 {a.nota_ocr}</div>
                  )}
                  <div className={styles.sinDeteccionDesc}>
                    El auditor fue alertado y decidió continuar con esta foto. Puedes ingresar
                    la lectura si la conoces por otro medio, o rechazar la visita para que el
                    auditor vuelva a registrar este medidor.
                  </div>
                </div>
              )}

              {/* ── Caso B: Lectura con baja confianza / discrepancia ── */}
              {!sinDet && (
                <div className={styles.readings}>
                  <div>
                    <strong>OCR detectó:</strong>{' '}
                    <code>{a.lectura_ocr ?? '–'}</code>
                  </div>
                  <div>
                    <strong>Confirmado por auditor:</strong>{' '}
                    <code>{a.lectura_confirmada ?? '–'}</code>
                  </div>
                  {a.nota_ocr && (
                    <div className={styles.nota}>💬 {a.nota_ocr}</div>
                  )}
                  {a.calidad_foto && a.calidad_foto !== 'buena' && (
                    <div className={`${styles.nota} ${a.calidad_foto === 'mala' ? styles.notaMala : ''}`}>
                      📷 Calidad de foto: <strong>{a.calidad_foto}</strong>
                      {a.motivo_calidad && ` — ${a.motivo_calidad}`}
                    </div>
                  )}
                </div>
              )}

              {/* ── Acciones ── */}

              {/* Formulario: ingresar lectura manual */}
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
                    onClick={() => confirmLectura(a.medidor_id)}
                    disabled={!newVal.trim() || saving}
                  >
                    {saving ? '...' : '✓ Confirmar'}
                  </button>
                  <button
                    className={styles.cancelBtn}
                    onClick={() => { setEditing(null); setNewVal(''); }}
                  >
                    Cancelar
                  </button>
                </div>
              )}

              {/* Formulario: rechazar visita */}
              {isRejecting && (
                <div className={styles.rejectBox}>
                  <p className={styles.rejectTitle}>
                    ↩ Rechazar visita — el auditor deberá registrar este apartamento de nuevo
                  </p>
                  <textarea
                    className={styles.rejectTextarea}
                    rows={3}
                    value={rejectMotivo}
                    onChange={e => setRejectMotivo(e.target.value)}
                    placeholder={`Motivo (opcional). Por defecto: "Foto incorrecta en medidor de ${meta.label}. La foto no muestra el medidor. Se requiere nueva visita."`}
                  />
                  <div className={styles.rejectBtns}>
                    <button
                      className={styles.rejectConfirmBtn}
                      onClick={rechazarVisita}
                      disabled={saving}
                    >
                      {saving ? 'Rechazando...' : '↩ Confirmar rechazo'}
                    </button>
                    <button
                      className={styles.cancelBtn}
                      onClick={() => { setRejecting(null); setRejectMotivo(''); }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {/* Botones iniciales (sin formulario abierto) */}
              {!isEditing && !isRejecting && (
                <div className={styles.actionRow}>
                  {sinDet ? (
                    /* Foto incorrecta: dos opciones */
                    <>
                      <button
                        className={styles.btnManual}
                        onClick={() => {
                          setEditing(a.medidor_id);
                          setNewVal('');
                        }}
                      >
                        📝 Ingresar lectura manualmente
                      </button>
                      <button
                        className={styles.btnRechazar}
                        onClick={() => setRejecting({
                          visita_id:  a.visita_id,
                          tipo:       a.tipo,
                          medidor_id: a.medidor_id,
                        })}
                      >
                        ↩ Rechazar visita
                      </button>
                    </>
                  ) : (
                    /* Baja confianza: corregir o confirmar */
                    <button
                      className={styles.reviewBtn}
                      onClick={() => {
                        setEditing(a.medidor_id);
                        setNewVal(a.lectura_confirmada || a.lectura_ocr || '');
                      }}
                    >
                      ✏️ Revisar y confirmar lectura
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
