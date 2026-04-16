import React, { useRef } from 'react';
import styles from './MeterField.module.css';

const META = {
  luz:  { label: 'Medidor de Luz',  emoji: '⚡', color: '#F59E0B' },
  agua: { label: 'Medidor de Agua', emoji: '💧', color: '#3B82F6' },
  gas:  { label: 'Medidor de Gas',  emoji: '🔥', color: '#EF4444' },
};

export default function MeterField({ tipo, data, onChange }) {
  const inputRef = useRef();
  const meta = META[tipo];

  const handleFile = e => {
    const file = e.target.files[0];
    if (!file) return;
    onChange('foto', file);
    onChange('preview', URL.createObjectURL(file));
  };

  const remove = () => {
    onChange('foto', null);
    onChange('preview', null);
    onChange('lectura', '');
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className={styles.card}>
      <div className={styles.header} style={{ borderColor: meta.color }}>
        <span className={styles.emoji}>{meta.emoji}</span>
        <span className={styles.label}>{meta.label}</span>
      </div>

      {data.preview ? (
        <div className={styles.previewWrap}>
          <img src={data.preview} alt={`Foto ${tipo}`} className={styles.preview} />
          <button className={styles.removeBtn} onClick={remove}>✕ Cambiar foto</button>
        </div>
      ) : (
        <button className={styles.photoBtn} onClick={() => inputRef.current?.click()}>
          <span>📷</span>
          <span>Tomar foto del medidor</span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        style={{ display: 'none' }}
      />

      <div className={styles.readingRow}>
        <label>Lectura manual</label>
        <input
          type="text"
          inputMode="decimal"
          value={data.lectura}
          onChange={e => onChange('lectura', e.target.value)}
          placeholder="Ej: 01234.5"
        />
        <span className={styles.readingHint}>El sistema intentará leerlo automáticamente de la foto</span>
      </div>
    </div>
  );
}
