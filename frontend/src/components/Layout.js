import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import styles from './Layout.module.css';

export default function Layout({ children, title, back }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const auditorTabs = [
    { path: '/',            icon: '🏠', label: 'Inicio'   },
    { path: '/nueva-visita',icon: '📋', label: 'Registrar'},
    { path: '/mis-visitas', icon: '📂', label: 'Mis visitas'},
  ];

  return (
    <div className={styles.shell}>
      {/* Header */}
      <header className={styles.header}>
        {back
          ? <button className={styles.backBtn} onClick={() => navigate(back)}>← Volver</button>
          : <span className={styles.logo}>Formas IA</span>
        }
        <h1 className={styles.title}>{title}</h1>
        <button className={styles.logoutBtn} onClick={logout} title="Cerrar sesión">⏻</button>
      </header>

      {/* Contenido */}
      <main className={styles.main}>{children}</main>

      {/* Bottom nav (solo auditor) */}
      {user?.rol === 'auditor' && (
        <nav className={styles.bottomNav}>
          {auditorTabs.map(t => (
            <button
              key={t.path}
              className={`${styles.navBtn} ${location.pathname === t.path ? styles.active : ''}`}
              onClick={() => navigate(t.path)}
            >
              <span className={styles.navIcon}>{t.icon}</span>
              <span className={styles.navLabel}>{t.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
