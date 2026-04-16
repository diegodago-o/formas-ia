import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import styles from './AdminDashboard.module.css';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get('/admin/visits?limit=1'),
      api.get('/admin/alerts'),
    ]).then(([visits, alerts]) => {
      setStats({ totalVisitas: visits.data.total, alertas: alerts.data.length });
    }).catch(() => {});
  }, []);

  const cards = [
    { label: 'Total visitas',   value: stats?.totalVisitas ?? '–', icon: '📋', path: '/admin/visitas', color: '#1E3A5F' },
    { label: 'Alertas OCR pendientes', value: stats?.alertas ?? '–', icon: '⚠️', path: '/admin/alertas', color: stats?.alertas > 0 ? '#F59E0B' : '#10B981' },
  ];

  return (
    <div>
      <h2 className={styles.heading}>Panel de control</h2>
      <div className={styles.grid}>
        {cards.map(c => (
          <button key={c.label} className={styles.card} onClick={() => navigate(c.path)} style={{ '--card-color': c.color }}>
            <span className={styles.cardIcon}>{c.icon}</span>
            <div className={styles.cardValue}>{c.value}</div>
            <div className={styles.cardLabel}>{c.label}</div>
          </button>
        ))}
      </div>

      <div className={styles.quickLinks}>
        <h3>Accesos rápidos</h3>
        <div className={styles.links}>
          <button onClick={() => navigate('/admin/catalogos')}>🏢 Gestionar conjuntos</button>
          <button onClick={() => navigate('/admin/usuarios')}>👥 Gestionar usuarios</button>
          <button onClick={() => {
            const url = `${process.env.REACT_APP_API_URL || 'http://localhost:4000/api'}/reports/excel`;
            const token = localStorage.getItem('token');
            window.open(`${url}?token=${token}`);
          }}>📥 Descargar reporte Excel</button>
        </div>
      </div>
    </div>
  );
}
