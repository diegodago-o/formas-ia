import React, { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import VisitModal from './VisitModal';
import styles from './AdminAlerts.module.css';

const TIPO_META = {
  luz:  { label: 'Electricidad', emoji: '⚡', color: '#F59E0B' },
  agua: { label: 'Agua',         emoji: '💧', color: '#3B82F6' },
  gas:  { label: 'Gas',          emoji: '🔥', color: '#EF4444' },
};

const SEVERIDAD = { sin_deteccion: 0, no_es_medidor: 1, discrepancia: 2, sin_acceso: 3, baja_confianza: 4 };

function tipoAlerta(a) {
  if (a.sin_acceso)       return 'sin_acceso';
  if (a.es_medidor === 0) return 'no_es_medidor';
  if (!a.lectura_ocr)     return 'sin_deteccion';
  if (a.lectura_ocr && a.lectura_confirmada && a.lectura_ocr !== a.lectura_confirmada)
                          return 'discrepancia';
  return 'baja_confianza';
}

const BADGE_META = {
  sin_deteccion:  { label: 'Sin detección',  cls: 'badgeRojo',     icon: '📷' },
  no_es_medidor:  { label: 'No es medidor',  cls: 'badgeRojo',     icon: '🚫' },
  discrepancia:   { label: 'Discrepancia',   cls: 'badgeAmbar',    icon: '⚠️' },
  sin_acceso:     { label: 'Sin acceso',     cls: 'badgeMorado',   icon: '🔒' },
  baja_confianza: { label: 'Baja confianza', cls: 'badgeAmarillo', icon: '🔍' },
};

// Color del borde izquierdo de la tarjeta de visita según la alerta más grave
function severidadVisita(alertas) {
  const tipos = alertas.map(tipoAlerta);
  const min = Math.min(...tipos.map(t => SEVERIDAD[t]));
  if (min <= 1) return 'visita-roja';
  if (min === 2) return 'visita-ambar';
  if (min === 3) return 'visita-morada';
  return 'visita-amarilla';
}

export default function AdminAlerts() {
  const [alerts, setAlerts]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [viewVisitId, setViewVisitId] = useState(null);
  const [lightbox, setLightbox]       = useState(null);
  const [editing, setEditing]         = useState(null);
  const [newVal, setNewVal]           = useState('');
  const [saving, setSaving]           = useState(false);
  const [openVisits, setOpenVisits]   = useState(new Set());

  const load = () => {
    setLoading(true);
    api.get('/admin/alerts')
      .then(r => {
        setAlerts(r.data);
        // Abrir todos los grupos por defecto
        const ids = new Set([...new Set(r.data.map(a => a.visita_id))]);
        setOpenVisits(ids);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const resolver = async (id, estado_revision_ocr, lectura_confirmada = null) => {
    setSaving(true);
    try {
      await api.patch(`/admin/medidores/${id}`, { estado_revision_ocr, lectura_confirmada });
      load();
    } finally { setSaving(false); }
  };

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
    } finally { setSaving(false); }
  };

  const toggleVisit = (id) => {
    setOpenVisits(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Agrupar alertas por visita
  const grupos = useMemo(() => {
    const map = {};
    alerts.forEach(a => {
      if (!map[a.visita_id]) {
        map[a.visita_id] = {
          visita_id: a.visita_id, ciudad: a.ciudad, conjunto: a.conjunto,
          torre: a.torre, apartamento: a.apartamento, auditor: a.auditor,
          fecha: a.fecha, alertas: [],
        };
      }
      map[a.visita_id].alertas.push(a);
    });
    return Object.values(map).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  }, [alerts]);

  if (loading) return (
    <div className={styles.loadingWrap}>
      <div className={styles.spinner} />
      <span>Cargando alertas OCR...</span>
    </div>
  );

  if (!alerts.length) return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIcon}>✅</div>
      <h3 className={styles.emptyTitle}>Sin alertas pendientes</h3>
      <p className={styles.emptyDesc}>Todos los medidores han sido revisados.</p>
    </div>
  );

  return (
    <div className={styles.page}>
      {/* Encabezado */}
      <div className={styles.pageHeader}>
        <div>
          <h2 className={styles.pageTitle}>Alertas OCR</h2>
          <p className={styles.pageSubtitle}>Revisión de medidores con hallazgos pendientes</p>
        </div>
        <div className={styles.pageStats}>
          <div className={styles.statChip}>
            <span className={styles.statNum}>{grupos.length}</span>
            <span className={styles.statLabel}>visitas</span>
          </div>
          <div className={`${styles.statChip} ${styles.statChipAlert}`}>
            <span className={styles.statNum}>{alerts.length}</span>
            <span className={styles.statLabel}>medidores</span>
          </div>
        </div>
      </div>

      {/* Lista acordeón por visita */}
      <div className={styles.list}>
        {grupos.map(grupo => {
          const isOpen  = openVisits.has(grupo.visita_id);
          const sevCls  = severidadVisita(grupo.alertas);

          return (
            <div key={grupo.visita_id} className={`${styles.visitCard} ${styles[sevCls]}`}>

              {/* ── Header acordeón ── */}
              <button
                className={`${styles.visitHeader} ${isOpen ? styles.visitHeaderOpen : ''}`}
                onClick={() => toggleVisit(grupo.visita_id)}
              >
                <div className={styles.visitHeaderLeft}>
                  <div className={styles.visitTitulo}>
                    <span className={styles.visitId}>Visita #{grupo.visita_id}</span>
                    <span className={styles.visitApto}>
                      Apto {grupo.apartamento}{grupo.torre ? ` · Torre ${grupo.torre}` : ''}
                    </span>
                  </div>
                  <div className={styles.visitMeta}>
                    <span className={styles.metaChip}>🏘️ {grupo.conjunto} · {grupo.ciudad}</span>
                    <span className={styles.metaChip}>👤 {grupo.auditor}</span>
                    <span className={styles.metaChip}>
                      📅 {new Date(grupo.fecha).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                </div>
                <div className={styles.visitHeaderRight}>
                  <span className={styles.alertCountBadge}>
                    {grupo.alertas.length} alerta{grupo.alertas.length !== 1 ? 's' : ''}
                  </span>
                  <span className={`${styles.toggleBtn} ${isOpen ? styles.toggleBtnOpen : ''}`}>
                    {isOpen ? 'Ocultar' : 'Ver hallazgos'}
                    <span className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}>▼</span>
                  </span>
                </div>
              </button>

              {/* ── Cuerpo acordeón ── */}
              {isOpen && (
                <div className={styles.visitBody}>
                  <button
                    className={styles.btnVerVisita}
                    onClick={() => setViewVisitId(grupo.visita_id)}
                  >
                    <span className={styles.btnVerIcon}>🔍</span>
                    Ver visita completa
                  </button>

                  {/* Tarjetas de medidor */}
                  <div className={styles.medList}>
                    {grupo.alertas.map(a => {
                      const meta       = TIPO_META[a.tipo];
                      const tipo       = tipoAlerta(a);
                      const badge      = BADGE_META[tipo];
                      const sinDet     = tipo === 'sin_deteccion';
                      const sinAcceso  = tipo === 'sin_acceso';
                      const noEsMed    = tipo === 'no_es_medidor';
                      const discrep    = tipo === 'discrepancia';
                      const isEditing  = editing === a.medidor_id;

                      return (
                        <div key={a.medidor_id} className={`${styles.medCard} ${styles[`med-${tipo}`]}`}>

                          {/* Cabecera medidor */}
                          <div className={styles.medHeader}>
                            <div className={styles.medTipo}>
                              <span className={styles.medEmoji} style={{ color: meta.color }}>{meta.emoji}</span>
                              <span className={styles.medLabel}>Medidor de {meta.label}</span>
                            </div>
                            <span className={`${styles.badge} ${styles[badge.cls]}`}>
                              {badge.icon} {badge.label}
                            </span>
                          </div>

                          {/* Foto */}
                          {a.foto_path && (
                            <div className={styles.fotoWrap}>
                              <img
                                src={`/uploads/${a.foto_path}`}
                                alt="Foto medidor"
                                className={styles.foto}
                                onClick={() => setLightbox(`/uploads/${a.foto_path}`)}
                              />
                              <span className={styles.fotoHint}>Toca para ampliar</span>
                            </div>
                          )}

                          {/* ── Sin acceso ── */}
                          {sinAcceso && (
                            <div className={`${styles.alertBox} ${styles.alertBoxMorado}`}>
                              <p className={styles.alertBoxTitle}>El auditor no pudo acceder a este medidor</p>
                              {a.motivo_sin_acceso && (
                                <p className={styles.alertBoxNota}>"{a.motivo_sin_acceso}"</p>
                              )}
                              <p className={styles.alertBoxDesc}>
                                Aprueba si el motivo es válido, o rechaza para que el auditor vuelva a intentarlo.
                              </p>
                            </div>
                          )}

                          {/* ── No es medidor ── */}
                          {noEsMed && (
                            <div className={`${styles.alertBox} ${styles.alertBoxRojo}`}>
                              <p className={styles.alertBoxTitle}>La IA detectó que esta foto no corresponde a un medidor</p>
                              {a.nota_ocr && (
                                <p className={styles.alertBoxNota}>"{a.nota_ocr}"</p>
                              )}
                              <p className={styles.alertBoxDesc}>
                                Aprueba si el contexto lo justifica, o rechaza para que se vuelva a registrar.
                              </p>
                            </div>
                          )}

                          {/* ── Sin detección ── */}
                          {sinDet && (
                            <div className={`${styles.alertBox} ${styles.alertBoxRojo}`}>
                              <p className={styles.alertBoxTitle}>La IA no pudo leer el número del medidor</p>
                              {a.nota_ocr && (
                                <p className={styles.alertBoxNota}>"{a.nota_ocr}"</p>
                              )}
                              <p className={styles.alertBoxDesc}>
                                Ingresa la lectura correcta revisando la foto, o rechaza para que el auditor retome la foto.
                              </p>
                            </div>
                          )}

                          {/* ── Lecturas: discrepancia / baja confianza ── */}
                          {!sinDet && !sinAcceso && !noEsMed && (
                            <div className={styles.lecturas}>
                              {discrep && (
                                <div className={`${styles.alertBox} ${styles.alertBoxAmbar}`}>
                                  <p className={styles.alertBoxTitle}>
                                    La IA y el auditor registraron valores diferentes
                                  </p>
                                  <p className={styles.alertBoxDesc}>Verifica la foto y confirma el valor correcto.</p>
                                </div>
                              )}
                              <div className={styles.lecturaGrid}>
                                <div className={styles.lecturaItem}>
                                  <span className={styles.lecturaLabel}>Lectura IA</span>
                                  <code className={styles.lecturaVal}>{a.lectura_ocr ?? '—'}</code>
                                </div>
                                <div className={discrep ? styles.lecturaItemDest : styles.lecturaItem}>
                                  <span className={styles.lecturaLabel}>Lectura Auditor</span>
                                  <code className={`${styles.lecturaVal} ${discrep ? styles.lecturaValDest : ''}`}>
                                    {a.lectura_confirmada ?? '—'}
                                  </code>
                                </div>
                              </div>
                              {a.nota_ocr && (
                                <div className={styles.notaOcr}>
                                  <span className={styles.notaOcrIcon}>💬</span>
                                  <span>{a.nota_ocr}</span>
                                </div>
                              )}
                              {a.calidad_foto && a.calidad_foto !== 'buena' && (
                                <div className={`${styles.notaOcr} ${a.calidad_foto === 'mala' ? styles.notaOcrMala : ''}`}>
                                  <span className={styles.notaOcrIcon}>📷</span>
                                  <span>Calidad: <strong>{a.calidad_foto}</strong>{a.motivo_calidad && ` — ${a.motivo_calidad}`}</span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* ── Formulario corrección ── */}
                          {isEditing && (
                            <div className={styles.editForm}>
                              <label className={styles.editLabel}>Ingresa la lectura correcta:</label>
                              <div className={styles.editRow}>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={newVal}
                                  onChange={e => setNewVal(e.target.value)}
                                  placeholder="Ej: 00201.126"
                                  className={styles.editInput}
                                  autoFocus
                                />
                                <button
                                  className={styles.btnGuardar}
                                  onClick={() => confirmarLectura(a.medidor_id)}
                                  disabled={!newVal.trim() || saving}
                                >
                                  {saving ? '...' : '✓ Guardar'}
                                </button>
                                <button
                                  className={styles.btnCancelar}
                                  onClick={() => { setEditing(null); setNewVal(''); }}
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          )}

                          {/* ── Botones de acción ── */}
                          {!isEditing && (
                            <div className={styles.actions}>
                              {/* Sin acceso / No es medidor */}
                              {(sinAcceso || noEsMed) && (
                                <>
                                  <button
                                    className={styles.btnConfirmar}
                                    onClick={() => resolver(a.medidor_id, 'aprobado')}
                                    disabled={saving}
                                  >
                                    ✓ Aprobar
                                  </button>
                                  <button
                                    className={styles.btnRechazar}
                                    onClick={() => resolver(a.medidor_id, 'rechazado')}
                                    disabled={saving}
                                  >
                                    ✕ Rechazar
                                  </button>
                                </>
                              )}

                              {/* Sin detección */}
                              {sinDet && (
                                <>
                                  <button
                                    className={styles.btnCorregir}
                                    onClick={() => { setEditing(a.medidor_id); setNewVal(''); }}
                                  >
                                    📝 Ingresar lectura
                                  </button>
                                  <button
                                    className={styles.btnRechazar}
                                    onClick={() => resolver(a.medidor_id, 'rechazado')}
                                    disabled={saving}
                                  >
                                    ✕ Rechazar
                                  </button>
                                </>
                              )}

                              {/* Discrepancia */}
                              {discrep && (
                                <>
                                  <button
                                    className={styles.btnConfirmar}
                                    onClick={() => resolver(a.medidor_id, 'aprobado', a.lectura_confirmada)}
                                    disabled={saving}
                                  >
                                    ✓ Confirmar auditor
                                  </button>
                                  <button
                                    className={styles.btnCorregir}
                                    onClick={() => { setEditing(a.medidor_id); setNewVal(a.lectura_confirmada || a.lectura_ocr || ''); }}
                                  >
                                    ✏️ Corregir
                                  </button>
                                  <button
                                    className={styles.btnRechazar}
                                    onClick={() => resolver(a.medidor_id, 'rechazado')}
                                    disabled={saving}
                                  >
                                    ✕ Rechazar
                                  </button>
                                </>
                              )}

                              {/* Baja confianza */}
                              {!sinDet && !sinAcceso && !noEsMed && !discrep && (
                                <>
                                  <button
                                    className={styles.btnConfirmar}
                                    onClick={() => resolver(a.medidor_id, 'aprobado', a.lectura_confirmada)}
                                    disabled={saving}
                                  >
                                    ✓ Confirmar lectura
                                  </button>
                                  <button
                                    className={styles.btnCorregir}
                                    onClick={() => { setEditing(a.medidor_id); setNewVal(a.lectura_confirmada || a.lectura_ocr || ''); }}
                                  >
                                    ✏️ Corregir
                                  </button>
                                </>
                              )}
                            </div>
                          )}

                        </div>
                      );
                    })}
                  </div>
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
