import React, { useRef, useState } from 'react';
import api from '../services/api';
import { compressImage } from '../services/compressImage';
import styles from './MeterField.module.css';

const META = {
  luz:  { label: 'Medidor de Luz',  emoji: '⚡', color: '#F59E0B' },
  agua: { label: 'Medidor de Agua', emoji: '💧', color: '#3B82F6' },
  gas:  { label: 'Medidor de Gas',  emoji: '🔥', color: '#EF4444' },
};

const MOTIVOS_SIN_ACCESO = [
  'Caja/cuarto cerrado con llave',
  'Medidor dañado o destruido',
  'Acceso bloqueado por obras',
  'Residente no permite el acceso',
  'Medidor no encontrado',
  'Mala iluminación — no es posible fotografiar',
  'Otro',
];

export default function MeterField({ tipo, data, onChange, onFile, isOnline = true }) {
  const inputRef = useRef();
  const meta     = META[tipo];

  const [uploading,   setUploading]   = useState(false);
  const [imgLoading,  setImgLoading]  = useState(() => !!data.preview);
  const [imgError,    setImgError]    = useState(false);
  const [sinAcceso,   setSinAcceso]   = useState(() => data.sin_acceso ? true : false);
  const [motivoAcceso, setMotivoAcceso] = useState(() => data.motivo_sin_acceso || '');

  const handleFile = async e => {
    const file = e.target.files[0];
    if (!file) return;

    onChange('preview', URL.createObjectURL(file));
    onChange('lectura', '');
    onChange('foto_path', null);
    setImgLoading(true);
    setImgError(false);
    setSinAcceso(false);
    setMotivoAcceso('');
    onChange('sin_acceso', false);
    onChange('motivo_sin_acceso', null);

    let fileToUpload = file;
    try { fileToUpload = await compressImage(file); } catch { /* usar original */ }

    onFile?.(fileToUpload);

    if (!isOnline) {
      // Offline: guardar archivo local, el auditor ingresa lectura manual
      onChange('foto', fileToUpload);
      return;
    }

    // Online: subir foto, obtener foto_path
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('foto', fileToUpload);
      const { data: result } = await api.post('/visits/upload-photo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onChange('foto_path', result.foto_path);
    } catch {
      // Fallo de red: guardar archivo local para sync offline
      onChange('foto', fileToUpload);
    } finally {
      setUploading(false);
    }
  };

  const remove = () => {
    onChange('foto', null);
    onChange('preview', null);
    onChange('lectura', '');
    onChange('foto_path', null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const confirmarSinAcceso = () => {
    if (!motivoAcceso) return;
    setSinAcceso(true);
    onChange('sin_acceso', true);
    onChange('motivo_sin_acceso', motivoAcceso);
  };

  const cancelarSinAcceso = () => {
    setSinAcceso(false);
    setMotivoAcceso('');
    onChange('sin_acceso', false);
    onChange('motivo_sin_acceso', null);
  };

  // Medidor confirmado sin acceso
  if (sinAcceso === true) {
    return (
      <div className={styles.card}>
        <div className={styles.header} style={{ borderColor: meta.color }}>
          <span className={styles.emoji}>{meta.emoji}</span>
          <span className={styles.label}>{meta.label}</span>
        </div>
        <div className={styles.sinAccesoBox}>
          <span className={styles.sinAccesoIcon}>📵</span>
          <div>
            <span className={styles.sinAccesoLabel}>No se puede capturar evidencia</span>
            <span className={styles.sinAccesoMotivo}>{motivoAcceso}</span>
          </div>
          <button className={styles.btnCancelarAcceso} onClick={cancelarSinAcceso}>✕</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.header} style={{ borderColor: meta.color }}>
        <span className={styles.emoji}>{meta.emoji}</span>
        <span className={styles.label}>{meta.label}</span>
      </div>

      {/* Foto o botón para tomar */}
      {data.preview ? (
        <div className={styles.previewWrap}>
          {imgLoading && !imgError && <div className={styles.imgSkeleton} />}
          {imgError ? (
            <div className={styles.imgError}>
              <span>📷</span>
              <span>No se pudo cargar la imagen</span>
            </div>
          ) : (
            <img
              src={data.preview}
              alt={`Foto ${tipo}`}
              className={styles.preview}
              style={{ display: imgLoading ? 'none' : 'block' }}
              onLoad={() => setImgLoading(false)}
              onError={() => {
                if (data.foto_file) {
                  onChange('preview', URL.createObjectURL(data.foto_file));
                  setImgLoading(true);
                  setImgError(false);
                } else {
                  setImgLoading(false);
                  setImgError(true);
                }
              }}
            />
          )}
          <button className={styles.removeBtn} onClick={remove}>✕ Cambiar foto</button>
        </div>
      ) : (
        <div className={styles.captureRow}>
          <button className={styles.photoBtn} onClick={() => inputRef.current?.click()}>
            <span>📷</span>
            <span>Tomar foto</span>
          </button>
          <button className={styles.sinAccesoBtn} onClick={() => setSinAcceso('seleccionar')}>
            📵 Sin evidencia
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        style={{ display: 'none' }}
      />

      {/* Seleccionar motivo sin acceso */}
      {sinAcceso === 'seleccionar' && (
        <div className={styles.sinAccesoForm}>
          <label className={styles.sinAccesoFormLabel}>¿Por qué no se puede capturar evidencia?</label>
          <select
            value={motivoAcceso}
            onChange={e => setMotivoAcceso(e.target.value)}
            className={styles.sinAccesoSelect}
          >
            <option value="">Seleccionar motivo...</option>
            {MOTIVOS_SIN_ACCESO.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <div className={styles.sinAccesoActions}>
            <button
              className={styles.btnConfirmarAcceso}
              onClick={confirmarSinAcceso}
              disabled={!motivoAcceso}
            >
              Confirmar
            </button>
            <button
              className={styles.btnCancelarAcceso}
              onClick={() => { setSinAcceso(false); setMotivoAcceso(''); }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Subiendo foto */}
      {uploading && (
        <div className={styles.ocrLoading}>
          <span className={styles.spinner} />
          Subiendo foto...
        </div>
      )}

      {/* Lectura: siempre visible cuando hay foto */}
      {data.preview && !uploading && (
        <div className={styles.manualFallback}>
          <label>Ingresa la lectura del medidor:</label>
          <input
            type="text"
            inputMode="decimal"
            value={data.lectura}
            onChange={e => onChange('lectura', e.target.value)}
            placeholder="Ej: 00201.2"
            autoFocus
          />
        </div>
      )}

      {/* Sin foto: campo manual simple */}
      {!data.preview && !uploading && sinAcceso !== 'seleccionar' && (
        <div className={styles.manualFallback}>
          <label>O ingresa la lectura manualmente:</label>
          <input
            type="text"
            inputMode="decimal"
            value={data.lectura}
            onChange={e => onChange('lectura', e.target.value)}
            placeholder="Ej: 00201.2"
          />
        </div>
      )}
    </div>
  );
}
