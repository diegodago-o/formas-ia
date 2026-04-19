import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

// localStorage seguro — no lanza excepciones en iOS privado / WebViews restringidos
function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
function lsRemove(key) {
  try { localStorage.removeItem(key); } catch {}
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(() => {
    try { return JSON.parse(lsGet('user') || 'null'); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = lsGet('token');
    if (!token) { setLoading(false); return; }

    // Timeout de 8 s — si la red no responde, desbloquear la app de todas formas
    const timer = setTimeout(() => {
      lsRemove('token'); lsRemove('user');
      setUser(null); setLoading(false);
    }, 8000);

    api.get('/auth/me')
      .then(r => { setUser(r.data); })
      .catch(() => { lsRemove('token'); lsRemove('user'); setUser(null); })
      .finally(() => { clearTimeout(timer); setLoading(false); });

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handle = () => {
      lsRemove('token'); lsRemove('user');
      setUser(null);
    };
    window.addEventListener('auth:logout', handle);
    return () => window.removeEventListener('auth:logout', handle);
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    lsSet('token', data.token);
    lsSet('user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    lsRemove('token'); lsRemove('user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAdmin: user?.rol === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
