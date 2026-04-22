import React, { useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import styles from './AdminCatalogs.module.css';

export default function AdminCatalogs() {
  const [ciudades,  setCiudades]  = useState([]);
  const [conjuntos, setConjuntos] = useState([]);
  const [torres,    setTorres]    = useState([]);

  const [expandedCities, setExpandedCities] = useState(new Set());
  const [expandedConjs,  setExpandedConjs]  = useState(new Set());

  const [addingCiudad, setAddingCiudad] = useState(false);
  const [addingConj,   setAddingConj]   = useState(null); // ciudad_id
  const [addingTorre,  setAddingTorre]  = useState(null); // conjunto_id

  const [newCiudad, setNewCiudad] = useState('');
  // Conjunto form includes inline towers list
  const [newConj,   setNewConj]   = useState({ nombre: '', direccion: '', torres: [''] });
  const [newTorre,  setNewTorre]  = useState('');

  const [importing,    setImporting]    = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [msg,   setMsg]   = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef();

  const loadAll = async () => {
    const [c, conj, t] = await Promise.all([
      api.get('/catalogs/ciudades').then(r => r.data),
      api.get('/catalogs/conjuntos').then(r => r.data),
      api.get('/catalogs/torres/all').then(r => r.data),
    ]);
    setCiudades(c);
    setConjuntos(conj);
    setTorres(t);
  };

  useEffect(() => { loadAll(); }, []);

  const flash = m => { setMsg(m);   setTimeout(() => setMsg(''),   3000); };
  const boom  = m => { setError(m); setTimeout(() => setError(''), 5000); };

  const toggleCity = id => setExpandedCities(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleConj = id => setExpandedConjs(s  => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── Agregar ────────────────────────────────────────
  const addCiudad = async () => {
    if (!newCiudad.trim()) return;
    try {
      await api.post('/catalogs/ciudades', { nombre: newCiudad.trim() });
      setNewCiudad(''); setAddingCiudad(false); loadAll(); flash('Ciudad creada');
    } catch (e) { boom(e.response?.data?.error || 'Error al crear la ciudad'); }
  };

  const addConj = async () => {
    if (!newConj.nombre.trim() || !addingConj) return;
    try {
      const torresValidas = newConj.torres.map(t => t.trim()).filter(Boolean);
      await api.post('/catalogs/conjuntos', {
        nombre:    newConj.nombre.trim(),
        ciudad_id: addingConj,
        direccion: newConj.direccion || null,
        torres:    torresValidas,
      });
      setNewConj({ nombre: '', direccion: '', torres: [''] });
      setAddingConj(null);
      loadAll();
      flash(`Conjunto creado${torresValidas.length ? ` con ${torresValidas.length} torre(s)` : ''}`);
    } catch (e) { boom(e.response?.data?.error || 'Error al crear el conjunto'); }
  };

  const addTorre = async () => {
    if (!newTorre.trim() || !addingTorre) return;
    try {
      await api.post('/catalogs/torres', { nombre: newTorre.trim(), conjunto_id: addingTorre });
      setNewTorre(''); setAddingTorre(null); loadAll(); flash('Torre creada');
    } catch (e) { boom(e.response?.data?.error || 'Error al crear la torre'); }
  };

  // ── Eliminar ───────────────────────────────────────
  const delCiudad = async (id, nombre) => {
    if (!window.confirm(`¿Eliminar la ciudad "${nombre}"?`)) return;
    try {
      await api.delete(`/catalogs/ciudades/${id}`);
      loadAll(); flash('Ciudad eliminada');
    } catch (e) { boom(e.response?.data?.error || 'Error al eliminar'); }
  };

  const delConj = async (id, nombre) => {
    if (!window.confirm(`¿Eliminar el conjunto "${nombre}" y todas sus torres?`)) return;
    try {
      await api.delete(`/catalogs/conjuntos/${id}`);
      loadAll(); flash('Conjunto eliminado');
    } catch (e) { boom(e.response?.data?.error || 'Error al eliminar'); }
  };

  const delTorre = async (id, nombre) => {
    if (!window.confirm(`¿Eliminar la torre "${nombre}"?`)) return;
    try {
      await api.delete(`/catalogs/torres/${id}`);
      loadAll(); flash('Torre eliminada');
    } catch (e) { boom(e.response?.data?.error || 'Error al eliminar'); }
  };

  // ── Importar ───────────────────────────────────────
  const handleImport = async e => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true); setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/catalogs/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setImportResult(data);
      loadAll();
    } catch (err) {
      setImportResult({ error: err.response?.data?.error || 'Error al importar' });
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  // Torres inline en el form de conjunto
  const setTorreAt = (i, val) => setNewConj(f => {
    const t = [...f.torres];
    t[i] = val;
    return { ...f, torres: t };
  });
  const addTorreField   = () => setNewConj(f => ({ ...f, torres: [...f.torres, ''] }));
  const removeTorreField = i => setNewConj(f => ({ ...f, torres: f.torres.filter((_, j) => j !== i) }));

  // Build tree
  const tree = ciudades.map(city => ({
    ...city,
    conjuntos: conjuntos
      .filter(c => c.ciudad_id === city.id)
      .map(conj => ({ ...conj, torres: torres.filter(t => t.conjunto_id === conj.id) })),
  }));

  return (
    <div className={styles.root}>
      {msg   && <div className={styles.flash}>{msg}</div>}
      {error && <div className={styles.flashError}>{error}</div>}

      {/* Barra superior */}
      <div className={styles.topBar}>
        <button className={styles.btnImport} onClick={() => fileRef.current?.click()} disabled={importing}>
          {importing ? '⏳ Importando...' : '📂 Importar CSV / Excel'}
        </button>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleImport} style={{ display: 'none' }} />
        <button className={styles.btnTemplate} onClick={downloadTemplate}>⬇ Plantilla CSV</button>
      </div>

      {/* Resultado importación */}
      {importResult && (
        <div className={importResult.error ? styles.importError : styles.importOk}>
          {importResult.error
            ? `❌ ${importResult.error}`
            : <>
                ✅ {importResult.total_filas} filas — creados:
                <strong> {importResult.created.ciudades} ciudades</strong>,
                <strong> {importResult.created.conjuntos} conjuntos</strong>,
                <strong> {importResult.created.torres} torres</strong>.
                {importResult.errors.length > 0 && (
                  <ul className={styles.importErrors}>
                    {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                )}
              </>
          }
          <button className={styles.importClose} onClick={() => setImportResult(null)}>✕</button>
        </div>
      )}

      {/* Árbol */}
      <div className={styles.tree}>
        {tree.map(city => (
          <div key={city.id} className={styles.cityBlock}>

            <div className={styles.cityRow}>
              <button className={styles.cityToggle} onClick={() => toggleCity(city.id)}>
                {expandedCities.has(city.id) ? '▾' : '▸'}
              </button>
              <span className={styles.cityIcon}>🏙️</span>
              <span className={styles.cityName}>{city.nombre}</span>
              <span className={styles.cityMeta}>{city.conjuntos?.length || 0} conjunto{city.conjuntos?.length !== 1 ? 's' : ''}</span>
              <button className={styles.btnAddSmall}
                onClick={() => { setAddingConj(city.id); setExpandedCities(s => new Set([...s, city.id])); }}>
                + Conjunto
              </button>
              <button className={styles.btnDel} onClick={() => delCiudad(city.id, city.nombre)} title="Eliminar ciudad">🗑</button>
            </div>

            {expandedCities.has(city.id) && (
              <div className={styles.cityChildren}>

                {/* Form agregar conjunto + torres */}
                {addingConj === city.id && (
                  <div className={styles.inlineForm}>
                    <input autoFocus value={newConj.nombre}
                      onChange={e => setNewConj(f => ({ ...f, nombre: e.target.value }))}
                      placeholder="Nombre del conjunto *" />
                    <input value={newConj.direccion}
                      onChange={e => setNewConj(f => ({ ...f, direccion: e.target.value }))}
                      placeholder="Dirección (opcional)" />

                    <div className={styles.torresSection}>
                      <span className={styles.torresSectionLabel}>Torres del conjunto (opcional)</span>
                      {newConj.torres.map((t, i) => (
                        <div key={i} className={styles.torreInputRow}>
                          <input value={t} onChange={e => setTorreAt(i, e.target.value)}
                            placeholder={`Torre ${i + 1}`}
                            onKeyDown={e => e.key === 'Enter' && addTorreField()} />
                          {newConj.torres.length > 1 && (
                            <button className={styles.btnRemoveTorre} onClick={() => removeTorreField(i)}>✕</button>
                          )}
                        </div>
                      ))}
                      <button className={styles.btnAddTorreField} onClick={addTorreField}>+ otra torre</button>
                    </div>

                    <div className={styles.inlineActions}>
                      <button className={styles.btnConfirm} onClick={addConj} disabled={!newConj.nombre.trim()}>✓ Guardar</button>
                      <button className={styles.btnCancel} onClick={() => { setAddingConj(null); setNewConj({ nombre: '', direccion: '', torres: [''] }); }}>Cancelar</button>
                    </div>
                  </div>
                )}

                {city.conjuntos.length === 0 && addingConj !== city.id && (
                  <div className={styles.empty}>Sin conjuntos — presiona + Conjunto para agregar</div>
                )}

                {city.conjuntos.map(conj => (
                  <div key={conj.id} className={styles.conjBlock}>
                    <div className={styles.conjRow}>
                      <button className={styles.conjToggle} onClick={() => toggleConj(conj.id)}>
                        {expandedConjs.has(conj.id) ? '▾' : '▸'}
                      </button>
                      <span className={styles.conjIcon}>🏘️</span>
                      <div className={styles.conjInfo}>
                        <span className={styles.conjName}>{conj.nombre}</span>
                        {conj.direccion && <span className={styles.conjDir}>{conj.direccion}</span>}
                      </div>
                      <span className={styles.conjMeta}>{conj.torres?.length || 0} torre{conj.torres?.length !== 1 ? 's' : ''}</span>
                      <button className={styles.btnAddSmall}
                        onClick={() => { setAddingTorre(conj.id); setExpandedConjs(s => new Set([...s, conj.id])); }}>
                        + Torre
                      </button>
                      <button className={styles.btnDel} onClick={() => delConj(conj.id, conj.nombre)} title="Eliminar conjunto">🗑</button>
                    </div>

                    {expandedConjs.has(conj.id) && (
                      <div className={styles.conjChildren}>
                        {addingTorre === conj.id && (
                          <div className={styles.inlineForm}>
                            <input autoFocus value={newTorre}
                              onChange={e => setNewTorre(e.target.value)}
                              placeholder="Nombre de la torre"
                              onKeyDown={e => e.key === 'Enter' && addTorre()} />
                            <div className={styles.inlineActions}>
                              <button className={styles.btnConfirm} onClick={addTorre} disabled={!newTorre.trim()}>✓ Guardar</button>
                              <button className={styles.btnCancel} onClick={() => { setAddingTorre(null); setNewTorre(''); }}>Cancelar</button>
                            </div>
                          </div>
                        )}

                        {conj.torres.length === 0 && addingTorre !== conj.id && (
                          <div className={styles.empty}>Sin torres</div>
                        )}

                        {conj.torres.map(t => (
                          <div key={t.id} className={styles.torreRow}>
                            <span className={styles.torreIcon}>🏢</span>
                            <span className={styles.torreName}>Torre {t.nombre}</span>
                            <button className={styles.btnDelTorre} onClick={() => delTorre(t.id, t.nombre)} title="Eliminar torre">🗑</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {addingCiudad ? (
          <div className={styles.inlineForm} style={{ marginTop: 12 }}>
            <input autoFocus value={newCiudad} onChange={e => setNewCiudad(e.target.value)}
              placeholder="Nombre de la ciudad" onKeyDown={e => e.key === 'Enter' && addCiudad()} />
            <div className={styles.inlineActions}>
              <button className={styles.btnConfirm} onClick={addCiudad} disabled={!newCiudad.trim()}>✓ Guardar</button>
              <button className={styles.btnCancel} onClick={() => { setAddingCiudad(false); setNewCiudad(''); }}>Cancelar</button>
            </div>
          </div>
        ) : (
          <button className={styles.btnAddCity} onClick={() => setAddingCiudad(true)}>+ Agregar ciudad</button>
        )}
      </div>
    </div>
  );
}

function downloadTemplate() {
  const csv = 'Ciudad,Conjunto,Torre\nBogotá,Torres del Norte,Torre 1\nBogotá,Torres del Norte,Torre 2\nMedellín,Conjunto El Prado,\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'plantilla_catalogos.csv'; a.click();
  URL.revokeObjectURL(url);
}
