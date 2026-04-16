import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import styles from './AdminVisits.module.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

export default function AdminVisits() {
  const [data, setData]     = useState({ data: [], total: 0 });
  const [page, setPage]     = useState(1);
  const [filters, setFilters] = useState({ desde: '', hasta: '', requiere_revision: '' });
  const [loading, setLoading] = useState(true);

  const load = (p = page, f = filters) => {
    setLoading(true);
    const params = new URLSearchParams({ page: p, limit: 20, ...Object.fromEntries(Object.entries(f).filter(([,v]) => v)) });
    api.get(`/admin/visits?${params}`).then(r => setData(r.data)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const applyFilters = () => { setPage(1); load(1, filters); };

  const downloadExcel = () => {
    const token = localStorage.getItem('token');
    const params = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([,v]) => v)));
    window.open(`${API_URL}/reports/excel?${params}&auth=${token}`);
  };

  return (
    <div>
      {/* Filtros */}
      <div className={styles.filters}>
        <input type="date" value={filters.desde} onChange={e => setFilters(f => ({...f, desde: e.target.value}))} />
        <input type="date" value={filters.hasta} onChange={e => setFilters(f => ({...f, hasta: e.target.value}))} />
        <select value={filters.requiere_revision} onChange={e => setFilters(f => ({...f, requiere_revision: e.target.value}))}>
          <option value="">Todas</option>
          <option value="1">Con alertas OCR</option>
        </select>
        <button className={styles.btnFilter} onClick={applyFilters}>Filtrar</button>
        <button className={styles.btnExcel} onClick={downloadExcel}>📥 Excel</button>
      </div>

      <div className={styles.count}>{data.total} visitas encontradas</div>

      {loading
        ? <div className={styles.loading}>Cargando...</div>
        : <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Fecha</th><th>Ciudad</th><th>Conjunto</th><th>Torre</th>
                  <th>Apto</th><th>Auditor</th><th>Alertas</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map(v => (
                  <tr key={v.id}>
                    <td>{new Date(v.fecha).toLocaleDateString('es-CO')}</td>
                    <td>{v.ciudad}</td>
                    <td>{v.conjunto}</td>
                    <td>{v.torre || '–'}</td>
                    <td><strong>{v.apartamento}</strong></td>
                    <td>{v.auditor}</td>
                    <td>{v.alertas_ocr > 0
                      ? <span className={styles.badge}>{v.alertas_ocr} ⚠️</span>
                      : <span className={styles.ok}>✓</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      }

      {/* Paginación */}
      <div className={styles.pagination}>
        <button disabled={page === 1} onClick={() => { setPage(p => p - 1); load(page - 1); }}>← Anterior</button>
        <span>Página {page} de {Math.ceil(data.total / 20) || 1}</span>
        <button disabled={page * 20 >= data.total} onClick={() => { setPage(p => p + 1); load(page + 1); }}>Siguiente →</button>
      </div>
    </div>
  );
}
