import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import styles from './AdminUsers.module.css';

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [form, setForm]   = useState({ nombre: '', email: '', password: '', rol: 'auditor' });
  const [msg, setMsg]     = useState('');

  const load = () => api.get('/admin/users').then(r => setUsers(r.data));
  useEffect(() => { load(); }, []);

  const flash = m => { setMsg(m); setTimeout(() => setMsg(''), 3000); };

  const submit = async e => {
    e.preventDefault();
    try {
      await api.post('/admin/users', form);
      setForm({ nombre: '', email: '', password: '', rol: 'auditor' });
      load();
      flash('Usuario creado correctamente');
    } catch (err) {
      flash(err.response?.data?.error || 'Error al crear usuario');
    }
  };

  const toggle = async (u) => {
    await api.patch(`/admin/users/${u.id}`, { activo: u.activo ? 0 : 1 });
    load();
  };

  return (
    <div>
      {msg && <div className={styles.flash}>{msg}</div>}

      <div className={styles.addCard}>
        <h3>Nuevo usuario</h3>
        <form onSubmit={submit} className={styles.form}>
          <input required placeholder="Nombre completo" value={form.nombre} onChange={e => setForm(f => ({...f, nombre: e.target.value}))} />
          <input required type="email" placeholder="Correo electrónico" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} />
          <input required type="password" placeholder="Contraseña" value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))} />
          <select value={form.rol} onChange={e => setForm(f => ({...f, rol: e.target.value}))}>
            <option value="auditor">Auditor</option>
            <option value="admin">Administrador</option>
          </select>
          <button type="submit">+ Crear usuario</button>
        </form>
      </div>

      <div className={styles.list}>
        {users.map(u => (
          <div key={u.id} className={`${styles.userCard} ${!u.activo ? styles.inactive : ''}`}>
            <div>
              <div className={styles.userName}>{u.nombre}</div>
              <div className={styles.userMeta}>{u.email} · <span className={styles.rol}>{u.rol}</span></div>
            </div>
            <button className={`${styles.toggleBtn} ${u.activo ? styles.active : ''}`} onClick={() => toggle(u)}>
              {u.activo ? 'Activo' : 'Inactivo'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
