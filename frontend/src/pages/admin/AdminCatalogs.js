import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import styles from './AdminCatalogs.module.css';

export default function AdminCatalogs() {
  const [ciudades, setCiudades]   = useState([]);
  const [conjuntos, setConjuntos] = useState([]);
  const [torres, setTorres]       = useState([]);
  const [tab, setTab] = useState('ciudades');

  const [newCiudad, setNewCiudad] = useState('');
  const [newConj, setNewConj]     = useState({ nombre: '', ciudad_id: '', direccion: '' });
  const [newTorre, setNewTorre]   = useState({ nombre: '', conjunto_id: '' });
  const [msg, setMsg] = useState('');

  const loadAll = () => {
    api.get('/catalogs/ciudades').then(r => setCiudades(r.data));
    api.get('/catalogs/conjuntos').then(r => setConjuntos(r.data));
  };

  useEffect(() => { loadAll(); }, []);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 3000); };

  const addCiudad = async () => {
    if (!newCiudad.trim()) return;
    await api.post('/catalogs/ciudades', { nombre: newCiudad });
    setNewCiudad(''); loadAll(); flash('Ciudad creada');
  };

  const addConj = async () => {
    if (!newConj.nombre || !newConj.ciudad_id) return;
    await api.post('/catalogs/conjuntos', newConj);
    setNewConj({ nombre: '', ciudad_id: '', direccion: '' }); loadAll(); flash('Conjunto creado');
  };

  const loadTorres = (conjId) => {
    if (!conjId) return;
    api.get(`/catalogs/torres?conjunto_id=${conjId}`).then(r => setTorres(r.data));
    setNewTorre(t => ({ ...t, conjunto_id: conjId }));
  };

  const addTorre = async () => {
    if (!newTorre.nombre || !newTorre.conjunto_id) return;
    await api.post('/catalogs/torres', newTorre);
    setNewTorre(t => ({ ...t, nombre: '' }));
    loadTorres(newTorre.conjunto_id);
    flash('Torre creada');
  };

  return (
    <div>
      {msg && <div className={styles.flash}>{msg}</div>}

      <div className={styles.tabs}>
        {['ciudades','conjuntos','torres'].map(t => (
          <button key={t} className={`${styles.tab} ${tab === t ? styles.active : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'ciudades' && (
        <div className={styles.section}>
          <div className={styles.addRow}>
            <input value={newCiudad} onChange={e => setNewCiudad(e.target.value)} placeholder="Nombre de ciudad" onKeyDown={e => e.key === 'Enter' && addCiudad()} />
            <button className={styles.addBtn} onClick={addCiudad}>+ Agregar</button>
          </div>
          <div className={styles.list}>
            {ciudades.map(c => <div key={c.id} className={styles.item}>{c.nombre}</div>)}
          </div>
        </div>
      )}

      {tab === 'conjuntos' && (
        <div className={styles.section}>
          <div className={styles.addForm}>
            <select value={newConj.ciudad_id} onChange={e => setNewConj(f => ({ ...f, ciudad_id: e.target.value }))}>
              <option value="">Ciudad *</option>
              {ciudades.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <input value={newConj.nombre} onChange={e => setNewConj(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre del conjunto *" />
            <input value={newConj.direccion} onChange={e => setNewConj(f => ({ ...f, direccion: e.target.value }))} placeholder="Dirección (opcional)" />
            <button className={styles.addBtn} onClick={addConj}>+ Agregar conjunto</button>
          </div>
          <div className={styles.list}>
            {conjuntos.map(c => (
              <div key={c.id} className={styles.item}>
                <strong>{c.nombre}</strong>
                <span>{c.ciudad} {c.direccion ? `· ${c.direccion}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'torres' && (
        <div className={styles.section}>
          <div className={styles.addForm}>
            <select onChange={e => loadTorres(e.target.value)}>
              <option value="">Seleccionar conjunto</option>
              {conjuntos.map(c => <option key={c.id} value={c.id}>{c.nombre} ({c.ciudad})</option>)}
            </select>
            {newTorre.conjunto_id && (
              <>
                <input value={newTorre.nombre} onChange={e => setNewTorre(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre de torre" />
                <button className={styles.addBtn} onClick={addTorre}>+ Agregar torre</button>
              </>
            )}
          </div>
          <div className={styles.list}>
            {torres.map(t => <div key={t.id} className={styles.item}>{t.nombre}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}
