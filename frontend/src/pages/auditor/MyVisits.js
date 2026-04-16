import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import Layout from '../../components/Layout';
import styles from './MyVisits.module.css';

export default function MyVisits() {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/visits/mine')
      .then(r => setVisits(r.data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Layout title="Mis Visitas">
      {loading
        ? <div className={styles.loading}>Cargando...</div>
        : visits.length === 0
          ? <div className={styles.empty}>
              <span>📭</span>
              <p>Aún no tienes visitas registradas</p>
            </div>
          : <div className={styles.list}>
              {visits.map(v => (
                <div key={v.id} className={styles.card}>
                  <div className={styles.top}>
                    <span className={styles.apt}>Apto {v.apartamento}</span>
                    <span className={styles.date}>
                      {new Date(v.fecha).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' })}
                    </span>
                  </div>
                  <div className={styles.location}>
                    📍 {v.ciudad} · {v.conjunto}{v.torre ? ` · Torre ${v.torre}` : ''}
                  </div>
                  {v.observaciones && (
                    <div className={styles.obs}>💬 {v.observaciones}</div>
                  )}
                </div>
              ))}
            </div>
      }
    </Layout>
  );
}
