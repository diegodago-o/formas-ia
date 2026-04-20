import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import InstallBanner from '../../components/InstallBanner';
import styles from './LoginPage.module.css';

export default function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm]     = useState({ email: '', password: '' });
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  // Redirigir en useEffect (nunca durante el render — anti-patrón en React 18)
  useEffect(() => {
    if (user) {
      navigate(user.rol === 'admin' ? '/admin' : '/', { replace: true });
    }
  }, [user, navigate]);

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const u = await login(form.email, form.password);
      navigate(u.rol === 'admin' ? '/admin' : '/', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  // Mientras se determina si hay sesión activa, no mostrar nada (evita flash)
  if (user) return null;

  return (
    <div className={styles.page}>
      <InstallBanner />
      <div className={styles.center}>
        <div className={styles.card}>
          <div className={styles.logo}>
            <span className={styles.logoIcon}>📊</span>
            <h1 className={styles.logoText}>LecturIA</h1>
            <p className={styles.subtitle}>Auditoría de Medidores</p>
          </div>

          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label>Correo electrónico</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="usuario@ejemplo.com"
                required
                autoComplete="email"
              />
            </div>

            <div className={styles.field}>
              <label>Contraseña</label>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <button type="submit" className={styles.btn} disabled={loading}>
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>
        </div>
      </div>
      <p className={styles.brand}>Desarrollado por Tecnofactory SAS</p>
    </div>
  );
}
