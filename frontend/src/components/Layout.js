import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import useOnlineStatus from '../hooks/useOnlineStatus';
import styles from './Layout.module.css';

export default function Layout({ children, title, back }) {
  const { user, logout } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const online    = useOnlineStatus();

  const auditorTabs = [
    { path: '/',            icon: '🏠', label: 'Inicio'   },
    { path: '/nueva-visita',icon: '📋', label: 'Registrar'},
    { path: '/mis-visitas', icon: '📂', label: 'Mis visitas'},
  ];

  return (
    <div className={styles.shell}>
      {/* Banner offline */}
      {!online && (
        <div className={styles.offlineBanner}>
          <span>📵</span> Sin conexión — los datos se guardarán localmente
        </div>
      )}

      {/* Header */}
      <header className={styles.header}>
        {back
          ? <button className={styles.backBtn} onClick={() => navigate(back)}>← Volver</button>
          : <span className={styles.logo}>LecturIA</span>
        }
        <h1 className={styles.title}>{title}</h1>
        <button className={styles.logoutBtn} onClick={logout} title="Cerrar sesión">⏻</button>
      </header>

      {/* Contenido */}
      <main className={styles.main}>{children}</main>

      {/* Footer */}
      <footer className={styles.footer}>Desarrollado por Tecnofactory SAS</footer>

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
