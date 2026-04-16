import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import styles from './AdminAlerts.module.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';
const TIPO_META = {
  luz:  { label: 'Luz',  emoji: '⚡' },
  agua: { label: 'Agua', emoji: '💧' },
  gas:  { label: 'Gas',  emoji: '🔥' },
};

export default function AdminAlerts() {
  const [alerts, setAlerts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // medidor_id
  const [newVal, setNewVal]   = useState('');
  const [saving, setSaving]   = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/admin/alerts').then(r => setAlerts(r.data)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const confirm = async (id) => {
    setSaving(true);
    try {
      await api.patch(`/admin/medidores/${id}`, { lectura_confirmada: newVal });
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
      <p className={styles.count}>{alerts.length} medidor{alerts.length !== 1 ? 'es' : ''} requiere{alerts.length === 1 ? '' : 'n'} revisión</p>
      <div className={styles.list}>
        {alerts.map(a => {
          const meta = TIPO_META[a.tipo];
          const isEditing = editing === a.medidor_id;
          return (
            <div key={a.medidor_id} className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.tipo}>{meta.emoji} Medidor de {meta.label}</span>
                <span className={`${styles.confianza} ${styles[a.confianza_ocr]}`}>{a.confianza_ocr}</span>
              </div>

              <div className={styles.info}>
                <span>📍 {a.ciudad} · {a.conjunto}{a.torre ? ` · Torre ${a.torre}` : ''} · Apto {a.apartamento}</span>
                <span>👤 {a.auditor}</span>
                <span>📅 {new Date(a.fecha).toLocaleDateString('es-CO')}</span>
              </div>

              {a.foto_path && (
                <img
                  src={`${API_URL.replace('/api', '')}/uploads/${a.foto_path}`}
                  alt="Foto medidor"
                  className={styles.foto}
                />
              )}

              <div className={styles.readings}>
                <div><strong>OCR detectó:</strong> <code>{a.lectura_ocr ?? 'No detectó'}</code></div>
                <div><strong>Manual auditor:</strong> <code>{a.lectura_manual ?? '–'}</code></div>
                {a.nota_ocr && <div className={styles.nota}>💬 {a.nota_ocr}</div>}
              </div>

              {isEditing
                ? <div className={styles.editRow}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={newVal}
                      onChange={e => setNewVal(e.target.value)}
                      placeholder="Lectura correcta"
                      autoFocus
                    />
                    <button className={styles.saveBtn} onClick={() => confirm(a.medidor_id)} disabled={!newVal || saving}>
                      {saving ? '...' : '✓ Confirmar'}
                    </button>
                    <button className={styles.cancelBtn} onClick={() => setEditing(null)}>Cancelar</button>
                  </div>
                : <button className={styles.reviewBtn} onClick={() => { setEditing(a.medidor_id); setNewVal(a.lectura_ocr || a.lectura_manual || ''); }}>
                    ✏️ Revisar y confirmar
                  </button>
              }
            </div>
          );
        })}
      </div>
    </div>
  );
}
