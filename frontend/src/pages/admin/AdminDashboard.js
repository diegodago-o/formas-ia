import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import styles from './AdminDashboard.module.css';

const ESTADO_META = {
  pendiente: { label: 'Pendientes',  icon: '⏳', color: '#F59E0B', bg: '#FEF3C7' },
  aprobada:  { label: 'Aprobadas',   icon: '✅', color: '#10B981', bg: '#D1FAE5' },
  rechazada: { label: 'Rechazadas',  icon: '❌', color: '#EF4444', bg: '#FEE2E2' },
  anulada:   { label: 'Anuladas',    icon: '🚫', color: '#6B7280', bg: '#F3F4F6' },
};

// Helpers de fecha
const fmtISO = d => d.toISOString().split('T')[0];
const hoy = () => fmtISO(new Date());

export default function AdminDashboard() {
  const navigate    = useNavigate();
  const { user }    = useAuth();
  const isConsulta  = user?.rol === 'consulta';

  const [stats,        setStats]        = useState(null);
  const [loading,      setLoading]      = useState(true);
  // Valores pendientes (lo que el usuario escribe en los inputs)
  const [pendingDesde, setPendingDesde] = useState('');
  const [pendingHasta, setPendingHasta] = useState('');
  // Valores aplicados (los que disparan la consulta al servidor)
  const [desde,        setDesde]        = useState('');
  const [hasta,        setHasta]        = useState('');

  const filtroActivo  = desde || hasta;
  const filtroPendiente = pendingDesde !== desde || pendingHasta !== hasta;

  useEffect(() => {
    setLoading(true);
    const params = {};
    if (desde) params.desde = desde;
    if (hasta) params.hasta = hasta;
    api.get('/admin/stats', { params })
      .then(r => setStats(r.data))
      .finally(() => setLoading(false));
  }, [desde, hasta]);

  const aplicarFiltro = () => { setDesde(pendingDesde); setHasta(pendingHasta); };

  const limpiarFiltro = () => {
    setPendingDesde(''); setPendingHasta('');
    setDesde('');        setHasta('');
  };

  // Agrupa el listado plano ciudad+conjunto en estructura jerárquica
  const ciudadesAgrupadas = useMemo(() => {
    if (!stats?.por_ciudad?.length) return [];
    const map = {};
    stats.por_ciudad.forEach(row => {
      if (!map[row.ciudad]) {
        map[row.ciudad] = { ciudad: row.ciudad, totalCiudad: 0, conjuntos: [] };
      }
      map[row.ciudad].totalCiudad += Number(row.total);
      map[row.ciudad].conjuntos.push(row);
    });
    return Object.values(map).sort((a, b) => b.totalCiudad - a.totalCiudad);
  }, [stats?.por_ciudad]);

  const s         = stats;
  const granTotal = Number(s?.total ?? 0);

  return (
    <div className={styles.root}>

      {/* ── Filtro de rango de fechas ─────────────────── */}
      <div className={styles.dateRow}>
        <span className={styles.dateLabel}>Período</span>
        <div className={styles.datePickers}>
          <input
            type="date"
            className={styles.datePicker}
            value={pendingDesde}
            max={pendingHasta || hoy()}
            onChange={e => setPendingDesde(e.target.value)}
          />
          <span className={styles.dateSep}>—</span>
          <input
            type="date"
            className={styles.datePicker}
            value={pendingHasta}
            min={pendingDesde || undefined}
            max={hoy()}
            onChange={e => setPendingHasta(e.target.value)}
          />
        </div>
        <button
          className={styles.btnAplicar}
          onClick={aplicarFiltro}
          disabled={!filtroPendiente && !filtroActivo || (!pendingDesde && !pendingHasta)}
        >
          Aplicar
        </button>
        {filtroActivo && (
          <button className={styles.btnLimpiar} onClick={limpiarFiltro}>
            ✕ Todo
          </button>
        )}
      </div>

      {/* ── Fila 1: métricas principales ─────────────── */}
      <div className={styles.topRow}>
        <button
          className={`${styles.metricCard} ${styles.total}`}
          onClick={() => !isConsulta && navigate('/admin/visitas')}
          style={isConsulta ? { cursor: 'default' } : {}}
        >
          <span className={styles.metricIcon}>📋</span>
          <span className={styles.metricValue}>{loading ? '–' : granTotal}</span>
          <span className={styles.metricLabel}>Total visitas (hogares)</span>
        </button>

        <button
          className={`${styles.metricCard} ${styles.alertasPendientes}`}
          onClick={() => !isConsulta && navigate('/admin/alertas')}
          style={isConsulta ? { cursor: 'default' } : {}}
        >
          <span className={styles.metricIcon}>⚠️</span>
          <span className={styles.metricValue}>{loading ? '–' : s?.alertas_pendientes ?? 0}</span>
          <span className={styles.metricLabel}>Alertas OCR pendientes</span>
        </button>

        <button
          className={`${styles.metricCard} ${styles.revisadas}`}
          onClick={() => !isConsulta && navigate('/admin/visitas')}
          style={isConsulta ? { cursor: 'default' } : {}}
        >
          <span className={styles.metricIcon}>🔍</span>
          <span className={styles.metricValue}>{loading ? '–' : s?.revisadas ?? 0}</span>
          <span className={styles.metricLabel}>Visitas revisadas (hogares)</span>
        </button>
      </div>

      {/* ── Fila 2: visitas por estado (consulta no ve anuladas) ─── */}
      <div className={styles.sectionTitle}>Visitas por estado</div>
      <div className={styles.estadosRow}>
        {Object.entries(ESTADO_META)
          .filter(([key]) => !(isConsulta && key === 'anulada'))
          .map(([key, meta]) => (
            <button
              key={key}
              className={styles.estadoCard}
              style={{ '--estado-color': meta.color, '--estado-bg': meta.bg,
                       ...(isConsulta ? { cursor: 'default' } : {}) }}
              onClick={() => !isConsulta && navigate(`/admin/visitas?estado=${key}`)}
            >
              <span className={styles.estadoIcon}>{meta.icon}</span>
              <span className={styles.estadoValue}>{loading ? '–' : s?.[key] ?? 0}</span>
              <span className={styles.estadoLabel}>{meta.label}</span>
            </button>
          ))}
      </div>

      {/* ── Fila 3: visitas por ciudad → conjunto ─────── */}
      <div className={styles.sectionTitle}>Visitas por ciudad</div>
      <div className={styles.ciudadesTable}>
        {loading ? (
          <div className={styles.tableLoading}>Cargando...</div>
        ) : !ciudadesAgrupadas.length ? (
          <div className={styles.tableEmpty}>Sin visitas en el período seleccionado</div>
        ) : (
          ciudadesAgrupadas.map((grupo, gi) => {
            const pct = granTotal > 0 ? Math.round((grupo.totalCiudad / granTotal) * 100) : 0;
            return (
              <div key={gi} className={styles.ciudadGroup}>

                {/* Cabecera ciudad */}
                <div className={styles.ciudadHeader}>
                  <span className={styles.ciudadNombre}>🏙️ {grupo.ciudad}</span>
                  <div className={styles.ciudadBar}>
                    <div className={styles.ciudadBarFill} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={styles.ciudadTotal}>{grupo.totalCiudad}</span>
                  <span className={styles.ciudadPct}>{pct}%</span>
                </div>

                {/* Filas de conjuntos */}
                {grupo.conjuntos.map((c, ci) => (
                  <div key={ci} className={styles.conjuntoRow}>
                    <span className={styles.conjuntoNombre}>└ {c.conjunto}</span>
                    <span className={styles.conjuntoTotal}>{c.total}</span>
                    <span className={`${styles.conjuntoBadge} ${styles.badgeAprobada}`}>
                      ✅ {c.aprobadas ?? 0}
                    </span>
                    <span className={`${styles.conjuntoBadge} ${styles.badgeRechazada}`}>
                      ❌ {c.rechazadas ?? 0}
                    </span>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>

    </div>
  );
}
