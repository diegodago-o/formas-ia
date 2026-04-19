import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import {
  saveCatalog, getCatalog, savePendingVisit,
  saveDraft, getDraft, updateDraft, deleteDraft,
} from '../../services/localDB';
import useOnlineStatus from '../../hooks/useOnlineStatus';
import Layout from '../../components/Layout';
import MeterField from '../../components/MeterField';
import styles from './NewVisit.module.css';

const STEPS = ['Ubicación', 'Medidores', 'Observaciones'];
const GPS_KEY = 'lectura-ia-last-gps';

function getLastGPS() {
  try {
    const raw = localStorage.getItem(GPS_KEY);
    if (!raw) return null;
    const { lat, lng, ts } = JSON.parse(raw);
    const age = Date.now() - ts;
    if (age > 2 * 60 * 60 * 1000) return null;
    return { lat, lng, age };
  } catch { return null; }
}

function saveLastGPS(lat, lng) {
  localStorage.setItem(GPS_KEY, JSON.stringify({ lat, lng, ts: Date.now() }));
}

function formatGPSAge(ms) {
  const min = Math.round(ms / 60000);
  if (min < 2) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  return `hace ${Math.round(min / 60)}h`;
}

const EMPTY_MEDIDOR = {
  foto: null, preview: null, lectura: '', foto_path: null,
  foto_file: null, sin_acceso: false, motivo_sin_acceso: null,
};

export default function NewVisit() {
  const navigate      = useNavigate();
  const [searchParams] = useSearchParams();
  const online        = useOnlineStatus();

  // URL param: ?draft=<id> para continuar un borrador
  const urlDraftId = searchParams.get('draft');

  const [step, setStep]               = useState(0);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');
  const [savedOffline, setSavedOffline] = useState(false);

  // Estado de borrador
  const [currentDraftId, setCurrentDraftId] = useState(null);
  const [locationLocked, setLocationLocked]  = useState(false); // true al continuar borrador
  const autoSaveTimer  = useRef(null);
  const horaInicioRef  = useRef(new Date().toISOString()); // capturado al montar

  // Catálogos
  const [ciudades, setCiudades]         = useState([]);
  const [conjuntos, setConjuntos]       = useState([]);
  const [torres, setTorres]             = useState([]);
  const [allConjuntos, setAllConjuntos] = useState([]);
  const [allTorres, setAllTorres]       = useState([]);

  // Paso 0
  const [latitud, setLatitud]           = useState('');
  const [longitud, setLongitud]         = useState('');
  const [gpsLoading, setGpsLoading]     = useState(false);
  const [gpsMode, setGpsMode]           = useState(null);
  const [lastGPS, setLastGPS]           = useState(null);
  const [ciudadId, setCiudadId]         = useState('');
  const [conjuntoId, setConjuntoId]     = useState('');
  const [torreId, setTorreId]           = useState('');
  const [apartamento, setApartamento]   = useState('');

  // Duplicado
  const [duplicado, setDuplicado]               = useState(null);
  const [duplicadoIgnorado, setDuplicadoIgnorado] = useState(false);

  // Medidores
  const [medidores, setMedidores] = useState({
    luz:  { ...EMPTY_MEDIDOR },
    agua: { ...EMPTY_MEDIDOR },
    gas:  { ...EMPTY_MEDIDOR },
  });

  const [observaciones, setObservaciones] = useState('');

  // ── Catálogos ─────────────────────────────────────────────────────
  const loadCatalogos = useCallback(async () => {
    if (online) {
      try {
        const [ciRes, cjRes, tRes] = await Promise.all([
          api.get('/catalogs/ciudades'),
          api.get('/catalogs/conjuntos/all').catch(() => ({ data: [] })),
          api.get('/catalogs/torres/all').catch(() => ({ data: [] })),
        ]);
        setCiudades(ciRes.data);
        setAllConjuntos(cjRes.data);
        setAllTorres(tRes.data);
        await Promise.all([
          saveCatalog('ciudades',      ciRes.data),
          saveCatalog('conjuntos_all', cjRes.data),
          saveCatalog('torres_all',    tRes.data),
        ]);
      } catch {
        await loadFromCache();
      }
    } else {
      await loadFromCache();
    }
  }, [online]); // eslint-disable-line

  const loadFromCache = async () => {
    const [ci, cj, to] = await Promise.all([
      getCatalog('ciudades'),
      getCatalog('conjuntos_all'),
      getCatalog('torres_all'),
    ]);
    if (ci) setCiudades(ci);
    if (cj) setAllConjuntos(cj);
    if (to) setAllTorres(to);
  };

  useEffect(() => { loadCatalogos(); }, [loadCatalogos]);

  // Filtrar conjuntos y torres
  useEffect(() => {
    if (!ciudadId) { setConjuntos([]); setConjuntoId(''); return; }
    if (online) {
      api.get(`/catalogs/conjuntos?ciudad_id=${ciudadId}`)
        .then(r => setConjuntos(r.data))
        .catch(() => setConjuntos(allConjuntos.filter(c => String(c.ciudad_id) === String(ciudadId))));
    } else {
      setConjuntos(allConjuntos.filter(c => String(c.ciudad_id) === String(ciudadId)));
    }
  }, [ciudadId, online, allConjuntos]); // eslint-disable-line

  useEffect(() => {
    if (!conjuntoId) { setTorres([]); setTorreId(''); return; }
    if (online) {
      api.get(`/catalogs/torres?conjunto_id=${conjuntoId}`)
        .then(r => setTorres(r.data))
        .catch(() => setTorres(allTorres.filter(t => String(t.conjunto_id) === String(conjuntoId))));
    } else {
      setTorres(allTorres.filter(t => String(t.conjunto_id) === String(conjuntoId)));
    }
  }, [conjuntoId, online, allTorres]); // eslint-disable-line

  // ── Cargar borrador (si viene con ?draft=id) ───────────────────────
  useEffect(() => {
    if (!urlDraftId) return;
    loadDraftById(urlDraftId);
  }, []); // eslint-disable-line

  const loadDraftById = async (id) => {
    try {
      const draft = await getDraft(id);
      if (!draft) return; // borrador no encontrado, flujo normal

      // Restaurar ubicación
      setCiudadId(draft.ciudadId     || '');
      setConjuntoId(draft.conjuntoId || '');
      setTorreId(draft.torreId       || '');
      setApartamento(draft.apartamento || '');
      setLatitud(draft.latitud         || '');
      setLongitud(draft.longitud        || '');
      setGpsMode(draft.gpsMode         || null);
      setObservaciones(draft.observaciones || '');

      // Restaurar medidores — recrear preview desde foto_file
      if (draft.medidores) {
        const restored = {};
        for (const tipo of ['luz', 'agua', 'gas']) {
          const m = draft.medidores[tipo] || { ...EMPTY_MEDIDOR };
          // Prioridad: URL del servidor (online) > blob desde foto_file (offline)
          let preview = null;
          if (m.foto_path) {
            preview = `/uploads/${m.foto_path}`;
          } else if (m.foto_file) {
            preview = URL.createObjectURL(m.foto_file);
          }
          restored[tipo] = { ...m, preview };
        }
        setMedidores(restored);
      }

      setCurrentDraftId(id);
      setLocationLocked(true);
      setStep(1); // saltar paso 0: ubicación ya está configurada
    } catch (err) {
      console.error('Error cargando borrador:', err);
    }
  };

  // ── Auto-guardado del borrador ─────────────────────────────────────
  // Se dispara cuando cambia cualquier dato relevante y hay un draft activo.
  // Debounce de 800ms para no saturar IndexedDB.
  useEffect(() => {
    if (!currentDraftId) return;

    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      try {
        // Quitar preview (blob URL no sobrevive entre sesiones)
        const medidoresForSave = {};
        for (const tipo of ['luz', 'agua', 'gas']) {
          medidoresForSave[tipo] = { ...medidores[tipo], preview: null };
        }

        // Intentar obtener nombres desde arrays cargados, fallback al catálogo global
        const conjuntoNombre =
          conjuntos.find(c => String(c.id) === String(conjuntoId))?.nombre ||
          allConjuntos.find(c => String(c.id) === String(conjuntoId))?.nombre || '';
        const torreNombre =
          torres.find(t => String(t.id) === String(torreId))?.nombre ||
          allTorres.find(t => String(t.id) === String(torreId))?.nombre || '';

        await updateDraft(currentDraftId, {
          ciudadId, conjuntoId, torreId, apartamento,
          latitud, longitud, gpsMode,
          observaciones,
          medidores: medidoresForSave,
          _meta: {
            ciudadNombre:   ciudades.find(c => String(c.id) === String(ciudadId))?.nombre || '',
            conjuntoNombre,
            torreNombre,
          },
        });
      } catch { /* fallo silencioso — el borrador se guardó antes */ }
    }, 800);

    return () => clearTimeout(autoSaveTimer.current);
  }, [ // eslint-disable-line
    currentDraftId,
    ciudadId, conjuntoId, torreId, apartamento,
    latitud, longitud, gpsMode,
    medidores, observaciones,
  ]);

  // Scroll al top en cada cambio de paso
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [step]);

  // Último GPS conocido
  useEffect(() => { setLastGPS(getLastGPS()); }, []);

  // ── GPS ───────────────────────────────────────────────────────────
  const getGPS = () => {
    setGpsLoading(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude.toFixed(6);
        const lng = pos.coords.longitude.toFixed(6);
        setLatitud(lat);
        setLongitud(lng);
        setGpsMode('direct');
        saveLastGPS(lat, lng);
        setLastGPS(getLastGPS());
        setGpsLoading(false);
      },
      () => {
        setGpsLoading(false);
        const last = getLastGPS();
        if (last) {
          setLastGPS(last);
        } else {
          setError('No se pudo obtener GPS. Intenta desde la entrada del edificio.');
        }
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  const useLastGPS = () => {
    if (!lastGPS) return;
    setLatitud(lastGPS.lat);
    setLongitud(lastGPS.lng);
    setGpsMode('last_known');
  };

  // ── Medidores ─────────────────────────────────────────────────────
  const updateMedidor = (tipo, field, value) => {
    setMedidores(prev => ({ ...prev, [tipo]: { ...prev[tipo], [field]: value } }));
  };

  const handleMedidorFile = (tipo, file) => {
    setMedidores(prev => ({ ...prev, [tipo]: { ...prev[tipo], foto_file: file } }));
  };

  const canNext = () => {
    if (step === 0) return ciudadId && conjuntoId && apartamento.trim();
    return true;
  };

  // ── Avanzar paso ──────────────────────────────────────────────────
  const handleNext = async () => {
    setError('');

    if (step === 0) {
      // Verificar duplicado si online
      if (online) {
        try {
          const params = new URLSearchParams({
            conjunto_id: conjuntoId,
            apartamento: apartamento.trim(),
            ...(torreId ? { torre_id: torreId } : {}),
          });
          const { data } = await api.get(`/visits/check-duplicate?${params}`);
          if (data.count > 0) { setDuplicado(data); return; }
        } catch { /* si falla la verificación, continuar */ }
      }
      setDuplicado(null);
      setDuplicadoIgnorado(false);

      // Crear borrador al entrar al paso de medidores
      if (!currentDraftId) {
        try {
          const medidoresForSave = {};
          for (const tipo of ['luz', 'agua', 'gas']) {
            medidoresForSave[tipo] = { ...medidores[tipo], preview: null };
          }
          const id = await saveDraft({
            ciudadId, conjuntoId, torreId, apartamento,
            latitud, longitud, gpsMode,
            observaciones,
            medidores: medidoresForSave,
            _meta: {
              ciudadNombre:   ciudades.find(c => String(c.id) === String(ciudadId))?.nombre || '',
              conjuntoNombre: conjuntos.find(c => String(c.id) === String(conjuntoId))?.nombre || '',
              torreNombre:    torres.find(t => String(t.id) === String(torreId))?.nombre || '',
            },
          });
          setCurrentDraftId(id);
        } catch { /* fallo no crítico */ }
      }
    }

    setStep(s => s + 1);
  };

  // ── Guardar progreso y salir (vuelve a Mis Visitas) ───────────────
  const handleSaveDraft = async () => {
    clearTimeout(autoSaveTimer.current);
    if (currentDraftId) {
      const medidoresForSave = {};
      for (const tipo of ['luz', 'agua', 'gas']) {
        medidoresForSave[tipo] = { ...medidores[tipo], preview: null };
      }
      // Await para que IDB termine de escribir antes de navegar
      await updateDraft(currentDraftId, {
        ciudadId, conjuntoId, torreId, apartamento,
        latitud, longitud, gpsMode,
        observaciones,
        medidores: medidoresForSave,
      }).catch(() => {});
    }
    navigate('/mis-visitas');
  };

  // ── Guardar visita final ───────────────────────────────────────────
  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');

    const medidoresPayload = ['luz', 'agua', 'gas'].reduce((acc, tipo) => {
      const m = medidores[tipo];
      if (m.foto_path || m.lectura || m.sin_acceso || m.foto_file) {
        acc[tipo] = {
          foto_path:         m.foto_path         || null,
          foto_file:         m.foto_file         || null,
          lectura:           m.lectura           || null,
          sin_acceso:        m.sin_acceso        || false,
          motivo_sin_acceso: m.motivo_sin_acceso || null,
        };
      }
      return acc;
    }, {});

    const cleanDraft = async () => {
      if (currentDraftId) {
        await deleteDraft(currentDraftId).catch(() => {});
      }
    };

    if (online) {
      try {
        await api.post('/visits', {
          latitud, longitud,
          ciudad_id:   ciudadId,
          conjunto_id: conjuntoId,
          torre_id:    torreId || null,
          apartamento, observaciones,
          medidores:   medidoresPayload,
          hora_inicio: horaInicioRef.current,
          hora_fin:    new Date().toISOString(),
        });
        await cleanDraft();
        navigate('/mis-visitas');
      } catch (err) {
        setError(err.response?.data?.error || 'Error al guardar la visita');
        setSubmitting(false);
      }
    } else {
      try {
        // Convertir foto_file a base64 string para almacenamiento confiable en IndexedDB.
        // Los File/Blob objects pueden quedar vacíos al serializar en algunos navegadores móviles.
        const medidoresParaIDB = {};
        for (const [tipo, m] of Object.entries(medidoresPayload)) {
          if (m?.foto_file) {
            const base64 = await new Promise((res, rej) => {
              const reader = new FileReader();
              reader.onload  = () => res(reader.result); // data:image/jpeg;base64,...
              reader.onerror = rej;
              reader.readAsDataURL(m.foto_file);
            }).catch(() => null);
            medidoresParaIDB[tipo] = { ...m, foto_file: null, foto_base64: base64 };
          } else {
            medidoresParaIDB[tipo] = m;
          }
        }

        await savePendingVisit({
          latitud, longitud,
          ciudad_id:   ciudadId,
          conjunto_id: conjuntoId,
          torre_id:    torreId || null,
          apartamento, observaciones,
          medidores:   medidoresParaIDB,
          hora_inicio: horaInicioRef.current,
          hora_fin:    new Date().toISOString(),
          _meta: {
            ciudadNombre:   ciudades.find(c => String(c.id) === String(ciudadId))?.nombre || '',
            conjuntoNombre: conjuntos.find(c => String(c.id) === String(conjuntoId))?.nombre || '',
            torreNombre:    torres.find(t => String(t.id) === String(torreId))?.nombre || '',
          },
        });
        await cleanDraft();
        setSavedOffline(true);
      } catch {
        setError('Error al guardar localmente');
        setSubmitting(false);
      }
    }
  };

  // ── Helpers de display ────────────────────────────────────────────
  const conjuntoNombre = conjuntos.find(c => String(c.id) === String(conjuntoId))?.nombre
                      || allConjuntos.find(c => String(c.id) === String(conjuntoId))?.nombre || '';
  const torreNombre    = torres.find(t => String(t.id) === String(torreId))?.nombre
                      || allTorres.find(t => String(t.id) === String(torreId))?.nombre || '';

  const meterDoneCount = ['luz', 'agua', 'gas'].filter(
    t => medidores[t].lectura || medidores[t].sin_acceso || medidores[t].foto_path
  ).length;

  // ── Pantalla éxito offline ─────────────────────────────────────────
  if (savedOffline) {
    return (
      <Layout title="Visita guardada" back="/mis-visitas">
        <div className={styles.offlineSuccess}>
          <span className={styles.offlineSuccessIcon}>📥</span>
          <h2>Guardado localmente</h2>
          <p>
            La visita se sincronizará automáticamente cuando recuperes conexión.
            Puedes verla en "Mis Visitas" con el badge <strong>Por sincronizar</strong>.
          </p>
          <button className={styles.btnPrimary} onClick={() => navigate('/mis-visitas')}>
            Ver mis visitas
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Nueva Visita" back="/">
      {/* Progreso */}
      <div className={styles.progress}>
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={`${styles.step} ${i <= step ? styles.active : ''} ${i < step ? styles.done : ''}`}
          >
            <div className={styles.stepDot}>{i < step ? '✓' : i + 1}</div>
            <span className={styles.stepLabel}>{s}</span>
          </div>
        ))}
      </div>

      {/* Banner de borrador (continuar visita) */}
      {locationLocked && (
        <div className={styles.draftBanner}>
          <div className={styles.draftBannerInfo}>
            <span className={styles.draftBannerTitle}>
              📝 Continuando borrador — Apto <strong>{apartamento}</strong>
              {torreNombre ? ` · Torre ${torreNombre}` : ''}
              {conjuntoNombre ? ` · ${conjuntoNombre}` : ''}
            </span>
            <span className={styles.draftBannerGps}>
              📍 {latitud ? `${latitud}, ${longitud}${gpsMode === 'last_known' ? ' (últ. conocida)' : ''}` : '⚠️ Sin GPS'}
            </span>
          </div>
          <button
            className={styles.draftBannerGpsBtn}
            onClick={getGPS}
            disabled={gpsLoading}
          >
            {gpsLoading ? '⏳' : '🔄 GPS'}
          </button>
        </div>
      )}

      {/* ── PASO 0: Ubicación ─────────────────────────────────────── */}
      {step === 0 && (
        <div className={styles.section}>
          <div className={styles.gpsRow}>
            <button className={styles.gpsBtn} onClick={getGPS} disabled={gpsLoading}>
              {gpsLoading ? '⏳ Obteniendo...' : '📍 Capturar ubicación GPS'}
            </button>
            {latitud && gpsMode === 'direct' && (
              <span className={styles.gpsOk}>✓ {latitud}, {longitud}</span>
            )}
            {latitud && gpsMode === 'last_known' && (
              <span className={styles.gpsWarn}>
                📍 Última ubicación ({formatGPSAge(lastGPS?.age || 0)})
              </span>
            )}
          </div>

          {!latitud && lastGPS && (
            <div className={styles.lastGpsBox}>
              <p>No se detectó GPS aquí. ¿Usar la última ubicación capturada ({formatGPSAge(lastGPS.age)})?</p>
              <button className={styles.btnLastGps} onClick={useLastGPS}>
                Usar última ubicación conocida
              </button>
            </div>
          )}

          <div className={styles.field}>
            <label>Ciudad *</label>
            <select value={ciudadId} onChange={e => setCiudadId(e.target.value)}>
              <option value="">Seleccionar ciudad</option>
              {ciudades.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label>Conjunto *</label>
            <select value={conjuntoId} onChange={e => setConjuntoId(e.target.value)} disabled={!ciudadId}>
              <option value="">Seleccionar conjunto</option>
              {conjuntos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label>Torre</label>
            <select value={torreId} onChange={e => setTorreId(e.target.value)} disabled={!conjuntoId}>
              <option value="">Sin torre / No aplica</option>
              {torres.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label>Apartamento *</label>
            <input
              type="text"
              value={apartamento}
              onChange={e => { setApartamento(e.target.value); setDuplicado(null); }}
              placeholder="Ej: 401, 12B"
              maxLength={20}
            />
          </div>

          {/* Alerta duplicado */}
          {duplicado && !duplicadoIgnorado && (
            <div className={styles.duplicadoBox}>
              <strong>⚠️ Ya existe una visita este mes para este apartamento</strong>
              {duplicado.visitas.map(v => (
                <div key={v.id} className={styles.duplicadoItem}>
                  {new Date(v.fecha).toLocaleDateString('es-CO')} — {v.auditor} —
                  <span className={styles.duplicadoEstado}> {v.estado}</span>
                </div>
              ))}
              {duplicado.count >= 2 ? (
                <p className={styles.duplicadoBloqueo}>
                  Con {duplicado.count} visitas este mes no se permite crear otra. Contacta al administrador.
                </p>
              ) : (
                <div className={styles.duplicadoAcciones}>
                  <p className={styles.duplicadoTexto}>¿Deseas continuar de todas formas?</p>
                  <button className={styles.btnDuplicadoContinuar} onClick={() => {
                    setDuplicadoIgnorado(true);
                    setDuplicado(null);
                    setStep(s => s + 1);
                  }}>Sí, continuar</button>
                  <button className={styles.btnDuplicadoCancelar} onClick={() => setDuplicado(null)}>
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── PASO 1: Medidores ─────────────────────────────────────── */}
      {step === 1 && (
        <div className={styles.section}>
          {/* Estado de progreso en medidores */}
          <div className={styles.meterProgress}>
            {['luz', 'agua', 'gas'].map(tipo => {
              const m = medidores[tipo];
              const done = m.lectura || m.sin_acceso || m.foto_path;
              return (
                <span key={tipo} className={`${styles.meterPill} ${done ? styles.meterPillDone : styles.meterPillPending}`}>
                  {tipo === 'luz' ? '💡' : tipo === 'agua' ? '💧' : '🔥'} {tipo}
                  {done ? ' ✓' : ''}
                </span>
              );
            })}
            <span className={styles.meterCount}>{meterDoneCount}/3</span>
          </div>

          {online
            ? <p className={styles.hint}>Toma la foto de cada medidor e ingresa la lectura. La IA verificará los datos al guardar.</p>
            : <p className={`${styles.hint} ${styles.hintOffline}`}>
                📵 Sin conexión — ingresa las lecturas manualmente. La IA analizará las fotos al sincronizar.
              </p>
          }

          {['luz', 'agua', 'gas'].map(tipo => (
            <MeterField
              key={tipo}
              tipo={tipo}
              data={medidores[tipo]}
              isOnline={online}
              onChange={(field, val) => updateMedidor(tipo, field, val)}
              onFile={file => handleMedidorFile(tipo, file)}
            />
          ))}
        </div>
      )}

      {/* ── PASO 2: Observaciones ─────────────────────────────────── */}
      {step === 2 && (
        <div className={styles.section}>
          <div className={styles.field}>
            <label>Observaciones generales</label>
            <textarea
              value={observaciones}
              onChange={e => setObservaciones(e.target.value)}
              placeholder="Ej: Se solicitó llave al portero para acceso. Medidor de luz sin pantalla."
              rows={5}
            />
          </div>
          <div className={styles.summary}>
            <h3>Resumen</h3>
            {!online && <p className={styles.offlineNote}>📵 Se guardará localmente y sincronizará al recuperar señal</p>}
            <p><strong>Ciudad:</strong> {ciudades.find(c => String(c.id) === String(ciudadId))?.nombre}</p>
            <p><strong>Conjunto:</strong> {conjuntoNombre}</p>
            {torreId && <p><strong>Torre:</strong> {torreNombre}</p>}
            <p><strong>Apartamento:</strong> {apartamento}</p>
            <p><strong>GPS:</strong> {latitud ? `${latitud}, ${longitud}${gpsMode === 'last_known' ? ' (última conocida)' : ''}` : '⚠️ Sin GPS'}</p>
            <p><strong>Medidores:</strong> {
              ['luz','agua','gas']
                .filter(t => medidores[t].foto_path || medidores[t].lectura || medidores[t].sin_acceso || medidores[t].foto_file)
                .map(t => medidores[t].sin_acceso ? `${t} (sin acceso)` : t)
                .join(', ') || 'Ninguno registrado'
            }</p>
          </div>
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      {/* Botón guardar progreso (aparece cuando hay borrador activo, paso 1 o 2) */}
      {currentDraftId && step >= 1 && (
        <div className={styles.saveDraftRow}>
          <button className={styles.btnSaveDraft} onClick={handleSaveDraft}>
            💾 Guardar progreso y continuar luego
          </button>
        </div>
      )}

      {/* Navegación */}
      <div className={styles.nav}>
        {step > 0 && !locationLocked && (
          <button className={styles.btnSecondary} onClick={() => setStep(s => s - 1)}>
            Anterior
          </button>
        )}
        {step > 0 && locationLocked && step > 1 && (
          <button className={styles.btnSecondary} onClick={() => setStep(s => s - 1)}>
            Anterior
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button className={styles.btnPrimary} onClick={handleNext} disabled={!canNext()}>
            Siguiente
          </button>
        ) : (
          <button className={styles.btnPrimary} onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Guardando...' : online ? '✓ Guardar visita' : '📥 Guardar localmente'}
          </button>
        )}
      </div>
    </Layout>
  );
}
