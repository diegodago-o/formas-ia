import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import Layout from '../../components/Layout';
import MeterField from '../../components/MeterField';
import styles from './NewVisit.module.css';

const STEPS = ['Ubicación', 'Medidores', 'Observaciones'];

export default function NewVisit() {
  const navigate = useNavigate();

  const [step, setStep]         = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]       = useState('');

  // Catálogos
  const [ciudades, setCiudades]   = useState([]);
  const [conjuntos, setConjuntos] = useState([]);
  const [torres, setTorres]       = useState([]);

  // Formulario sección 1
  const [latitud, setLatitud]   = useState('');
  const [longitud, setLongitud] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [ciudadId, setCiudadId]     = useState('');
  const [conjuntoId, setConjuntoId] = useState('');
  const [torreId, setTorreId]       = useState('');
  const [apartamento, setApartamento] = useState('');

  // Medidores
  const [medidores, setMedidores] = useState({
    luz:  { foto: null, preview: null, lectura: '' },
    agua: { foto: null, preview: null, lectura: '' },
    gas:  { foto: null, preview: null, lectura: '' },
  });

  // Observaciones
  const [observaciones, setObservaciones] = useState('');

  // Cargar ciudades
  useEffect(() => {
    api.get('/catalogs/ciudades').then(r => setCiudades(r.data)).catch(() => {});
  }, []);

  // Cargar conjuntos al cambiar ciudad
  useEffect(() => {
    if (!ciudadId) { setConjuntos([]); setConjuntoId(''); return; }
    api.get(`/catalogs/conjuntos?ciudad_id=${ciudadId}`).then(r => setConjuntos(r.data)).catch(() => {});
  }, [ciudadId]);

  // Cargar torres al cambiar conjunto
  useEffect(() => {
    if (!conjuntoId) { setTorres([]); setTorreId(''); return; }
    api.get(`/catalogs/torres?conjunto_id=${conjuntoId}`).then(r => setTorres(r.data)).catch(() => {});
  }, [conjuntoId]);

  const getGPS = () => {
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLatitud(pos.coords.latitude.toFixed(6));
        setLongitud(pos.coords.longitude.toFixed(6));
        setGpsLoading(false);
      },
      () => { setGpsLoading(false); setError('No se pudo obtener la ubicación'); }
    );
  };

  const updateMedidor = (tipo, field, value) => {
    setMedidores(prev => ({ ...prev, [tipo]: { ...prev[tipo], [field]: value } }));
  };

  const canNext = () => {
    if (step === 0) return ciudadId && conjuntoId && apartamento.trim();
    if (step === 1) return true; // medidores son opcionales (puede haber observación si no se tomó)
    return true;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('latitud', latitud);
      formData.append('longitud', longitud);
      formData.append('ciudad_id', ciudadId);
      formData.append('conjunto_id', conjuntoId);
      if (torreId) formData.append('torre_id', torreId);
      formData.append('apartamento', apartamento);
      formData.append('observaciones', observaciones);

      for (const tipo of ['luz', 'agua', 'gas']) {
        if (medidores[tipo].foto)    formData.append(`foto_${tipo}`, medidores[tipo].foto);
        if (medidores[tipo].lectura) formData.append(`lectura_${tipo}`, medidores[tipo].lectura);
      }

      await api.post('/visits', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      navigate('/mis-visitas');
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar la visita');
      setSubmitting(false);
    }
  };

  return (
    <Layout title="Nueva Visita" back="/">
      {/* Progress bar */}
      <div className={styles.progress}>
        {STEPS.map((s, i) => (
          <div key={s} className={`${styles.step} ${i <= step ? styles.active : ''} ${i < step ? styles.done : ''}`}>
            <div className={styles.stepDot}>{i < step ? '✓' : i + 1}</div>
            <span className={styles.stepLabel}>{s}</span>
          </div>
        ))}
      </div>

      {/* PASO 1: Ubicación */}
      {step === 0 && (
        <div className={styles.section}>
          <div className={styles.gpsRow}>
            <button className={styles.gpsBtn} onClick={getGPS} disabled={gpsLoading}>
              {gpsLoading ? '⏳ Obteniendo...' : '📍 Capturar ubicación GPS'}
            </button>
            {latitud && <span className={styles.gpsOk}>✓ {latitud}, {longitud}</span>}
          </div>

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
              onChange={e => setApartamento(e.target.value)}
              placeholder="Ej: 401, 12B"
              maxLength={20}
            />
          </div>
        </div>
      )}

      {/* PASO 2: Medidores */}
      {step === 1 && (
        <div className={styles.section}>
          <p className={styles.hint}>Toma la foto de cada medidor. El sistema leerá el número automáticamente.</p>
          {['luz', 'agua', 'gas'].map(tipo => (
            <MeterField
              key={tipo}
              tipo={tipo}
              data={medidores[tipo]}
              onChange={(field, val) => updateMedidor(tipo, field, val)}
            />
          ))}
        </div>
      )}

      {/* PASO 3: Observaciones */}
      {step === 2 && (
        <div className={styles.section}>
          <div className={styles.field}>
            <label>Observaciones</label>
            <textarea
              value={observaciones}
              onChange={e => setObservaciones(e.target.value)}
              placeholder="Ej: No se pudo acceder al medidor de gas porque estaba bloqueado. Medidor de luz con pantalla dañada."
              rows={6}
            />
          </div>
          <div className={styles.summary}>
            <h3>Resumen</h3>
            <p><strong>Ciudad:</strong> {ciudades.find(c => c.id == ciudadId)?.nombre}</p>
            <p><strong>Conjunto:</strong> {conjuntos.find(c => c.id == conjuntoId)?.nombre}</p>
            {torreId && <p><strong>Torre:</strong> {torres.find(t => t.id == torreId)?.nombre}</p>}
            <p><strong>Apartamento:</strong> {apartamento}</p>
            <p><strong>Medidores:</strong> {['luz','agua','gas'].filter(t => medidores[t].foto || medidores[t].lectura).join(', ') || 'Ninguno'}</p>
          </div>
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      {/* Navegación */}
      <div className={styles.nav}>
        {step > 0 && (
          <button className={styles.btnSecondary} onClick={() => setStep(s => s - 1)}>
            Anterior
          </button>
        )}
        {step < STEPS.length - 1
          ? <button className={styles.btnPrimary} onClick={() => setStep(s => s + 1)} disabled={!canNext()}>
              Siguiente
            </button>
          : <button className={styles.btnPrimary} onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Guardando...' : '✓ Guardar visita'}
            </button>
        }
      </div>
    </Layout>
  );
}
