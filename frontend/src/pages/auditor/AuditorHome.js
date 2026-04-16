import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';
import styles from './AuditorHome.module.css';

export default function AuditorHome() {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <Layout title="Inicio">
      <div className={styles.welcome}>
        <p className={styles.greeting}>Hola, {user?.nombre?.split(' ')[0]} 👋</p>
        <p className={styles.date}>{new Date().toLocaleDateString('es-CO', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p>
      </div>

      <div className={styles.actions}>
        <button className={`${styles.card} ${styles.primary}`} onClick={() => navigate('/nueva-visita')}>
          <span className={styles.icon}>📋</span>
          <div>
            <div className={styles.cardTitle}>Nueva visita</div>
            <div className={styles.cardDesc}>Registrar medidores de un apartamento</div>
          </div>
        </button>

        <button className={styles.card} onClick={() => navigate('/mis-visitas')}>
          <span className={styles.icon}>📂</span>
          <div>
            <div className={styles.cardTitle}>Mis visitas</div>
            <div className={styles.cardDesc}>Ver historial de registros</div>
          </div>
        </button>
      </div>
    </Layout>
  );
}
