import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import VisitModal from './VisitModal';
import styles from './AdminVisits.module.css';

const ESTADO_STYLE = {
  pendiente: { bg: '#FEF3C7', color: '#92400E' },
  aprobada:  { bg: '#D1FAE5', color: '#065F46' },
  rechazada: { bg: '#FEE2E2', color: '#991B1B' },
  anulada:   { bg: '#F3F4F6', color: '#6B7280' },
};

const SUPERADMIN_EMAIL = 'admin@formas-ia.com';

export default function AdminVisits() {
  const { user }                    = useAuth();
  const isSuperAdmin                = user?.email?.toLowerCase() === SUPERADMIN_EMAIL;
  const [data, setData]             = useState({ data: [], total: 0 });
  const [page, setPage]             = useState(1);
  const [filters, setFilters]       = useState({ desde: '', hasta: '', estado: '', requiere_revision: '' });
  const [loading, setLoading]       = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [sort, setSort]             = useState({ col: null, dir: 'desc' }); // default: fecha desc

  const load = (p = page, f = filters, s = sort) => {
    setLoading(true);
    const params = new URLSearchParams({
      page: p, limit: 20,
      ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')),
      ...(s.col ? { sort_by: s.col, sort_dir: s.dir } : {}),
    });
    api.get(`/admin/visits?${params}`).then(r => setData(r.data)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const applyFilters = () => { setPage(1); load(1, filters, sort); };

  const handleSort = (col) => {
    const newSort = {
      col,
      dir: sort.col === col && sort.dir === 'asc' ? 'desc' : 'asc',
    };
    setSort(newSort);
    setPage(1);
    load(1, filters, newSort);
  };

  const handleDelete = async (id, apartamento) => {
    if (!window.confirm(`¿Eliminar permanentemente la visita #${id} (Apto ${apartamento})?\nEsta acción no se puede deshacer.`)) return;
    try {
      await api.delete(`/admin/visits/${id}`);
      load();
    } catch (e) {
      alert(e.response?.data?.error || 'Error al eliminar la visita');
    }
  };

  const downloadExcel = async () => {
    const params = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')));
    const resp = await api.get(`/reports/excel?${params}`, { responseType: 'blob' });
    const url  = URL.createObjectURL(resp.data);
    const a    = document.createElement('a');
    a.href = url; a.download = `lectura-ia-${Date.now()}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  // Encabezado de columna ordenable
  const Th = ({ col, children }) => {
    const active = sort.col === col;
    return (
      <th
        className={`${styles.thSortable} ${active ? styles.thSorted : ''}`}
        onClick={() => handleSort(col)}
      >
        <span className={styles.thContent}>
          {children}
          <span className={styles.sortIcon}>
            {active ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
          </span>
        </span>
      </th>
    );
  };

  return (
    <div>
      {/* Filtros */}
      <div className={styles.filters}>
        <input type="date" value={filters.desde} onChange={e => setFilters(f => ({ ...f, desde: e.target.value }))} />
        <input type="date" value={filters.hasta} onChange={e => setFilters(f => ({ ...f, hasta: e.target.value }))} />
        <select value={filters.estado} onChange={e => setFilters(f => ({ ...f, estado: e.target.value }))}>
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="aprobada">Aprobada</option>
          <option value="rechazada">Rechazada</option>
          <option value="anulada">Anulada</option>
        </select>
        <select value={filters.requiere_revision} onChange={e => setFilters(f => ({ ...f, requiere_revision: e.target.value }))}>
          <option value="">Todas</option>
          <option value="1">Con alertas OCR</option>
          <option value="0">Sin alertas OCR</option>
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
                  <Th col="id">#</Th>
                  <Th col="fecha">Fecha</Th>
                  <Th col="hinicio">H. Inicio</Th>
                  <Th col="hfin">H. Fin</Th>
                  <Th col="ciudad">Ciudad</Th>
                  <Th col="conjunto">Conjunto</Th>
                  <Th col="torre">Torre</Th>
                  <Th col="apto">Apto</Th>
                  <Th col="auditor">Auditor</Th>
                  <Th col="estado">Estado</Th>
                  <Th col="alertas">Alertas</Th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.data.map(v => {
                  const est = ESTADO_STYLE[v.estado || 'pendiente'];
                  return (
                    <tr key={v.id}>
                      <td><span className={styles.visitId}>#{v.id}</span></td>
                      <td>{new Date(v.fecha).toLocaleDateString('es-CO')}</td>
                      <td>{v.hora_inicio ? new Date(v.hora_inicio).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '–'}</td>
                      <td>{v.hora_fin   ? new Date(v.hora_fin  ).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '–'}</td>
                      <td>{v.ciudad}</td>
                      <td>{v.conjunto}</td>
                      <td>{v.torre || '–'}</td>
                      <td><strong>{v.apartamento}</strong></td>
                      <td>{v.auditor}</td>
                      <td>
                        <span className={styles.estadoBadge} style={{ background: est.bg, color: est.color }}>
                          {v.estado || 'pendiente'}
                        </span>
                      </td>
                      <td>
                        {v.alertas_ocr > 0
                          ? <span className={styles.badge}>{v.alertas_ocr} ⚠️</span>
                          : <span className={styles.ok}>✓</span>}
                      </td>
                      <td className={styles.actionsCell}>
                        <button className={styles.btnVer} onClick={() => setSelectedId(v.id)}>
                          👁 Ver
                        </button>
                        {isSuperAdmin && (
                          <button
                            className={styles.btnDelete}
                            onClick={() => handleDelete(v.id, v.apartamento)}
                            title="Eliminar visita permanentemente"
                          >
                            🗑
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
      }

      <div className={styles.pagination}>
        <button disabled={page === 1} onClick={() => { const p = page - 1; setPage(p); load(p); }}>← Anterior</button>
        <span>Página {page} de {Math.ceil(data.total / 20) || 1}</span>
        <button disabled={page * 20 >= data.total} onClick={() => { const p = page + 1; setPage(p); load(p); }}>Siguiente →</button>
      </div>

      {selectedId && (
        <VisitModal
          visitId={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdated={() => { setSelectedId(null); load(); }}
        />
      )}
    </div>
  );
}
