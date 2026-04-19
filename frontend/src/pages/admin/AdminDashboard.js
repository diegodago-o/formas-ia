import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import styles from './AdminDashboard.module.css';

async function downloadExcel() {
  const resp = await api.get('/reports/excel', { responseType: 'blob' });
  const url  = URL.createObjectURL(resp.data);
  const a    = document.createElement('a');
  a.href = url; a.download = `lectura-ia-${Date.now()}.xlsx`; a.click();
  URL.revokeObjectURL(url);
}

const ESTADO_META = {
  pendiente: { label: 'Pendientes',  icon: '⏳', color: '#F59E0B', bg: '#FEF3C7' },
  aprobada:  { label: 'Aprobadas',   icon: '✅', color: '#10B981', bg: '#D1FAE5' },
  rechazada: { label: 'Rechazadas',  icon: '❌', color: '#EF4444', bg: '#FEE2E2' },
  anulada:   { label: 'Anuladas',    icon: '🚫', color: '#6B7280', bg: '#F3F4F6' },
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/stats')
      .then(r => setStats(r.data))
      .finally(() => setLoading(false));
  }, []);

  const s = stats;

  return (
    <div className={styles.root}>

      {/* ── Fila 1: métricas principales ─────────────── */}
      <div className={styles.topRow}>
        <button className={`${styles.metricCard} ${styles.total}`} onClick={() => navigate('/admin/visitas')}>
          <span className={styles.metricIcon}>📋</span>
          <span className={styles.metricValue}>{loading ? '–' : s?.total ?? 0}</span>
          <span className={styles.metricLabel}>Total visitas</span>
        </button>

        <button className={`${styles.metricCard} ${styles.alertasPendientes}`} onClick={() => navigate('/admin/alertas')}>
          <span className={styles.metricIcon}>⚠️</span>
          <span className={styles.metricValue}>{loading ? '–' : s?.alertas_pendientes ?? 0}</span>
          <span className={styles.metricLabel}>Alertas OCR pendientes</span>
        </button>

        <button className={`${styles.metricCard} ${styles.revisadas}`} onClick={() => navigate('/admin/visitas')}>
          <span className={styles.metricIcon}>🔍</span>
          <span className={styles.metricValue}>{loading ? '–' : s?.revisadas ?? 0}</span>
          <span className={styles.metricLabel}>Visitas revisadas</span>
        </button>
      </div>

      {/* ── Fila 2: visitas por estado ────────────────── */}
      <div className={styles.sectionTitle}>Visitas por estado</div>
      <div className={styles.estadosRow}>
        {Object.entries(ESTADO_META).map(([key, meta]) => (
          <button
            key={key}
            className={styles.estadoCard}
            style={{ '--estado-color': meta.color, '--estado-bg': meta.bg }}
            onClick={() => navigate(`/admin/visitas?estado=${key}`)}
          >
            <span className={styles.estadoIcon}>{meta.icon}</span>
            <span className={styles.estadoValue}>{loading ? '–' : s?.[key] ?? 0}</span>
            <span className={styles.estadoLabel}>{meta.label}</span>
          </button>
        ))}
      </div>

      {/* ── Fila 3: visitas por ciudad ────────────────── */}
      <div className={styles.sectionTitle}>Visitas por ciudad</div>
      <div className={styles.ciudadesTable}>
        {loading ? (
          <div className={styles.tableLoading}>Cargando...</div>
        ) : !s?.por_ciudad?.length ? (
          <div className={styles.tableEmpty}>Sin visitas registradas</div>
        ) : (
          s.por_ciudad.map((c, i) => {
            const pct = s.total > 0 ? Math.round((c.total / s.total) * 100) : 0;
            return (
              <div key={i} className={styles.ciudadRow}>
                <span className={styles.ciudadNombre}>🏙️ {c.ciudad}</span>
                <div className={styles.ciudadBar}>
                  <div className={styles.ciudadBarFill} style={{ width: `${pct}%` }} />
                </div>
                <span className={styles.ciudadTotal}>{c.total}</span>
                <span className={styles.ciudadPct}>{pct}%</span>
              </div>
            );
          })
        )}
      </div>

      {/* ── Accesos rápidos ───────────────────────────── */}
      <div className={styles.sectionTitle}>Accesos rápidos</div>
      <div className={styles.links}>
        <button onClick={() => navigate('/admin/catalogos')}>🏢 Gestionar catálogos</button>
        <button onClick={() => navigate('/admin/usuarios')}>👥 Gestionar usuarios</button>
        <button onClick={downloadExcel}>📥 Descargar reporte Excel</button>
      </div>
    </div>
  );
}
