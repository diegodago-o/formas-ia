import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import styles from './AdminUsers.module.css';

export default function AdminUsers() {
  const [users, setUsers]   = useState([]);
  const [form, setForm]     = useState({ nombre: '', email: '', password: '', rol: 'auditor' });
  const [msg, setMsg]       = useState('');
  const [error, setError]   = useState('');

  // Estado para el formulario de cambio de contraseña por usuario
  const [pwdUserId, setPwdUserId]   = useState(null); // id del usuario con form abierto
  const [pwdForm, setPwdForm]       = useState({ nueva: '', confirmar: '' });
  const [pwdSaving, setPwdSaving]   = useState(false);

  const load = () => api.get('/admin/users').then(r => setUsers(r.data));
  useEffect(() => { load(); }, []);

  const flash = m => { setMsg(m);   setTimeout(() => setMsg(''),   3000); };
  const boom  = m => { setError(m); setTimeout(() => setError(''), 5000); };

  const submit = async e => {
    e.preventDefault();
    try {
      await api.post('/admin/users', form);
      setForm({ nombre: '', email: '', password: '', rol: 'auditor' });
      load();
      flash('Usuario creado correctamente');
    } catch (err) {
      boom(err.response?.data?.error || 'Error al crear usuario');
    }
  };

  const toggle = async (u) => {
    try {
      await api.patch(`/admin/users/${u.id}`, { activo: u.activo ? 0 : 1 });
      load();
    } catch (err) {
      boom(err.response?.data?.error || 'Error al cambiar estado');
    }
  };

  const openPwd = (id) => {
    setPwdUserId(id);
    setPwdForm({ nueva: '', confirmar: '' });
  };

  const savePwd = async (userId) => {
    if (!pwdForm.nueva.trim()) { boom('Ingresa la nueva contraseña'); return; }
    if (pwdForm.nueva.length < 6) { boom('La contraseña debe tener al menos 6 caracteres'); return; }
    if (pwdForm.nueva !== pwdForm.confirmar) { boom('Las contraseñas no coinciden'); return; }
    setPwdSaving(true);
    try {
      await api.patch(`/admin/users/${userId}`, { password: pwdForm.nueva });
      setPwdUserId(null);
      flash('Contraseña actualizada correctamente');
    } catch (err) {
      boom(err.response?.data?.error || 'Error al cambiar contraseña');
    } finally {
      setPwdSaving(false);
    }
  };

  return (
    <div>
      {msg   && <div className={styles.flash}>{msg}</div>}
      {error && <div className={styles.flashError}>{error}</div>}

      <div className={styles.addCard}>
        <h3>Nuevo usuario</h3>
        <form onSubmit={submit} className={styles.form}>
          <input required placeholder="Nombre completo" value={form.nombre} onChange={e => setForm(f => ({...f, nombre: e.target.value}))} />
          <input required type="email" placeholder="Correo electrónico" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} />
          <input required type="password" placeholder="Contraseña inicial" value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))} />
          <select value={form.rol} onChange={e => setForm(f => ({...f, rol: e.target.value}))}>
            <option value="auditor">Auditor</option>
            <option value="admin">Administrador</option>
            <option value="consulta">Consulta (solo Dashboard)</option>
          </select>
          <button type="submit">+ Crear usuario</button>
        </form>
      </div>

      <div className={styles.list}>
        {users.map(u => (
          <div key={u.id} className={`${styles.userCard} ${!u.activo ? styles.inactive : ''}`}>
            <div className={styles.userInfo}>
              <div className={styles.userName}>{u.nombre}</div>
              <div className={styles.userMeta}>{u.email} · <span className={styles.rol}>{u.rol}</span></div>
            </div>

            <div className={styles.userActions}>
              <button
                className={styles.btnPwd}
                onClick={() => pwdUserId === u.id ? setPwdUserId(null) : openPwd(u.id)}
                title="Cambiar contraseña"
              >
                🔑
              </button>
              <button
                className={`${styles.toggleBtn} ${u.activo ? styles.active : ''}`}
                onClick={() => toggle(u)}
              >
                {u.activo ? 'Activo' : 'Inactivo'}
              </button>
            </div>

            {/* Formulario inline de cambio de contraseña */}
            {pwdUserId === u.id && (
              <div className={styles.pwdForm}>
                <input
                  type="password"
                  placeholder="Nueva contraseña (mín. 6 caracteres)"
                  value={pwdForm.nueva}
                  onChange={e => setPwdForm(f => ({ ...f, nueva: e.target.value }))}
                  autoFocus
                />
                <input
                  type="password"
                  placeholder="Confirmar contraseña"
                  value={pwdForm.confirmar}
                  onChange={e => setPwdForm(f => ({ ...f, confirmar: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && savePwd(u.id)}
                />
                <div className={styles.pwdActions}>
                  <button
                    className={styles.btnSavePwd}
                    onClick={() => savePwd(u.id)}
                    disabled={pwdSaving}
                  >
                    {pwdSaving ? 'Guardando...' : '✓ Guardar contraseña'}
                  </button>
                  <button
                    className={styles.btnCancelPwd}
                    onClick={() => setPwdUserId(null)}
                    disabled={pwdSaving}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
