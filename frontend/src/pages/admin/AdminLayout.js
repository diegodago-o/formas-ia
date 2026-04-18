import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import styles from './AdminLayout.module.css';

const NAV = [
  { path: '/admin',           icon: '📊', label: 'Dashboard'  },
  { path: '/admin/visitas',   icon: '📋', label: 'Visitas'    },
  { path: '/admin/alertas',   icon: '⚠️',  label: 'Alertas OCR'},
  { path: '/admin/catalogos', icon: '🏢', label: 'Catálogos'  },
  { path: '/admin/usuarios',  icon: '👥', label: 'Usuarios'   },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sideOpen, setSideOpen] = useState(false);

  return (
    <div className={styles.shell}>
      {/* Sidebar */}
      <aside className={`${styles.sidebar} ${sideOpen ? styles.open : ''}`}>
        <div className={styles.sideHeader}>
          <span className={styles.logo}>LecturIA</span>
          <button className={styles.closeBtn} onClick={() => setSideOpen(false)}>✕</button>
        </div>
        <div className={styles.userInfo}>
          <div className={styles.userName}>{user?.nombre}</div>
          <div className={styles.userRole}>Administrador</div>
        </div>
        <nav className={styles.nav}>
          {NAV.map(n => (
            <button
              key={n.path}
              className={`${styles.navItem} ${location.pathname === n.path ? styles.active : ''}`}
              onClick={() => { navigate(n.path); setSideOpen(false); }}
            >
              <span>{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <button className={styles.logoutBtn} onClick={logout}>⏻ Cerrar sesión</button>
      </aside>

      {sideOpen && <div className={styles.overlay} onClick={() => setSideOpen(false)} />}

      {/* Contenido */}
      <div className={styles.content}>
        <header className={styles.topbar}>
          <button className={styles.menuBtn} onClick={() => setSideOpen(true)}>☰</button>
          <span className={styles.topTitle}>{NAV.find(n => location.pathname === n.path)?.label || 'Admin'}</span>
        </header>
        <main className={styles.main}><Outlet /></main>
      </div>
    </div>
  );
}
