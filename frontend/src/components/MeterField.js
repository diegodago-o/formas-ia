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
  const inputRef        = useRef();
  const meta            = META[tipo];
  const [ocrLoading, setOcrLoading]       = useState(false);
  const [ocrResult, setOcrResult]         = useState(null);
  const [editando, setEditando]           = useState(false);
  const [sinAcceso, setSinAcceso]         = useState(() => data.sin_acceso ? true : false);
  const [motivoAcceso, setMotivoAcceso]   = useState(() => data.motivo_sin_acceso || '');
  const [fotoMala, setFotoMala]           = useState(false);

  const handleFile = async e => {
    const file = e.target.files[0];
    if (!file) return;

    onChange('preview', URL.createObjectURL(file));
    onChange('lectura', '');
    setOcrResult(null);
    setEditando(false);
    setFotoMala(false);
    // Si tenía "sin acceso" seleccionado, la foto lo cancela
    setSinAcceso(false);
    setMotivoAcceso('');
    onChange('sin_acceso', false);
    onChange('motivo_sin_acceso', null);

    let fileToUpload = file;
    try { fileToUpload = await compressImage(file); } catch { /* usar original */ }
    onChange('foto', fileToUpload);
    onFile?.(fileToUpload); // guardar referencia para sync offline

    // ── Sin conexión: guardar foto y pedir entrada manual ──
    if (!isOnline) {
      setOcrResult({ lectura: null, confianza: 'baja', calidad_foto: 'buena', nota: 'Sin conexión — lectura manual' });
      setEditando(true);
      return;
    }

    // ── Con conexión: subir y correr OCR ──
    setOcrLoading(true);
    try {
      const formData = new FormData();
      formData.append('foto', fileToUpload);
      formData.append('tipo', tipo);
      const { data: result } = await api.post('/visits/ocr-preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setOcrResult(result);
      onChange('lectura', result.lectura || '');
      onChange('foto_path', result.foto_path);
      onChange('ocr_meta', {
        lectura_ocr:    result.lectura,
        confianza_ocr:  result.confianza,
        calidad_foto:   result.calidad_foto,
        motivo_calidad: result.motivo_calidad,
        nota_ocr:       result.nota,
        requiere_revision: result.requiere_revision,
        es_medidor:     result.es_medidor,
      });

      if (result.calidad_foto === 'mala') setFotoMala(true);
      if (!result.lectura && result.calidad_foto !== 'mala') setEditando(true);
    } catch {
      setOcrResult({ lectura: null, confianza: 'baja', calidad_foto: 'mala', nota: 'Error al procesar' });
      setFotoMala(true);
    } finally {
      setOcrLoading(false);
    }
  };

  const remove = () => {
    onChange('foto', null);
    onChange('preview', null);
    onChange('lectura', '');
    onChange('foto_path', null);
    onChange('ocr_meta', null);
    setOcrResult(null);
    setEditando(false);
    setFotoMala(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const confirmarSinAcceso = () => {
    if (!motivoAcceso) return;
    setSinAcceso(true);
    onChange('sin_acceso', true);
    onChange('motivo_sin_acceso', motivoAcceso);
    onChange('ocr_meta', { requiere_revision: true });
  };

  const cancelarSinAcceso = () => {
    setSinAcceso(false);
    setMotivoAcceso('');
    onChange('sin_acceso', false);
    onChange('motivo_sin_acceso', null);
    onChange('ocr_meta', null);
  };

  // ── Si el medidor fue marcado sin acceso (confirmado, no en selección) ─
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
          <img src={data.preview} alt={`Foto ${tipo}`} className={styles.preview} />
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

      {/* Procesando */}
      {ocrLoading && (
        <div className={styles.ocrLoading}>
          <span className={styles.spinner} />
          Leyendo medidor con IA...
        </div>
      )}

      {/* Alerta: foto mala → retomar */}
      {!ocrLoading && fotoMala && ocrResult && (
        <div className={styles.fotoMalaBox}>
          <div className={styles.fotoMalaHeader}>
            <span>{ocrResult.es_medidor === false ? '🚫 No es un medidor' : '📷 Foto no válida'}</span>
            {ocrResult.motivo_calidad && (
              <span className={styles.fotoMalaMotivo}>{ocrResult.motivo_calidad}</span>
            )}
          </div>
          <p className={styles.fotoMalaTexto}>
            {ocrResult.es_medidor === false
              ? 'La imagen no contiene un medidor. Debes fotografiar el medidor correspondiente.'
              : 'La foto no cumple los requisitos contractuales. Por favor retoma con mejor iluminación y encuadre.'}
          </p>
          <div className={styles.fotoMalaAcciones}>
            <button className={styles.btnRetomar} onClick={remove}>
              📷 Retomar foto
            </button>
            {ocrResult.es_medidor !== false && (
              <button
                className={styles.btnContinuarMala}
                onClick={() => {
                  setFotoMala(false);
                  if (!ocrResult.lectura) setEditando(true);
                }}
              >
                Continuar igual
              </button>
            )}
          </div>
        </div>
      )}

      {/* Resultado OCR: IA detectó */}
      {!ocrLoading && !fotoMala && ocrResult && ocrResult.lectura && !editando && (
        <div className={styles.resultOk}>
          {ocrResult.calidad_foto === 'aceptable' && (
            <div className={styles.calidadAceptable}>
              ⚠️ Foto con calidad aceptable{ocrResult.motivo_calidad ? ` — ${ocrResult.motivo_calidad}` : ''}
            </div>
          )}
          <div className={styles.resultRow}>
            <div className={styles.resultValor}>
              <span className={styles.resultLabel}>IA detectó</span>
              <span className={styles.resultNum}>{data.lectura || ocrResult.lectura}</span>
            </div>
            <button className={styles.btnCorregir} onClick={() => setEditando(true)}>
              ✏️ Está mal
            </button>
          </div>
        </div>
      )}

      {/* Edición: corregir o ingresar cuando no detectó */}
      {!ocrLoading && !fotoMala && ocrResult && editando && (
        <div className={styles.editBox}>
          <label className={styles.editLabel}>
            {ocrResult.lectura
              ? `IA leyó "${ocrResult.lectura}" — ingresa el valor correcto:`
              : 'IA no pudo leer — ingresa la lectura:'}
          </label>
          <div className={styles.inputRow}>
            <input
              type="text"
              inputMode="decimal"
              value={data.lectura}
              onChange={e => onChange('lectura', e.target.value)}
              placeholder="Ej: 00201.2"
              autoFocus
            />
            <button
              className={styles.btnGuardar}
              onClick={() => setEditando(false)}
              disabled={!data.lectura}
            >
              ✓
            </button>
          </div>
          {ocrResult.nota && <p className={styles.ocrNota}>💬 {ocrResult.nota}</p>}
        </div>
      )}

      {/* Sin foto: campo manual simple */}
      {!data.preview && !ocrLoading && sinAcceso !== 'seleccionar' && (
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
