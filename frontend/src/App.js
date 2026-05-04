import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';

import LoginPage      from './pages/auth/LoginPage';
import AuditorHome    from './pages/auditor/AuditorHome';
import NewVisit       from './pages/auditor/NewVisit';
import MyVisits       from './pages/auditor/MyVisits';
import AdminLayout    from './pages/admin/AdminLayout';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminVisits    from './pages/admin/AdminVisits';
import AdminAlerts    from './pages/admin/AdminAlerts';
import AdminCatalogs  from './pages/admin/AdminCatalogs';
import AdminUsers     from './pages/admin/AdminUsers';

// ── Error Boundary ────────────────────────────────────────────────
// Captura errores de render en cualquier componente hijo y evita
// la pantalla en blanco total. Muestra un mensaje legible en su lugar.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Error inesperado' };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', minHeight: '100vh', padding: '24px',
          background: '#F9FAFB', textAlign: 'center', gap: '16px',
        }}>
          <span style={{ fontSize: '3rem' }}>⚠️</span>
          <h2 style={{ color: '#1E3A5F', fontSize: '1.2rem' }}>Algo salió mal</h2>
          <p style={{ color: '#6B7280', fontSize: '0.9rem', maxWidth: '320px' }}>
            {this.state.message}
          </p>
          <button
            onClick={() => window.location.href = '/'}
            style={{
              background: '#1E3A5F', color: '#fff', padding: '12px 24px',
              borderRadius: '8px', fontSize: '0.95rem', fontWeight: '700',
            }}
          >
            Volver al inicio
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Private Route ─────────────────────────────────────────────────
// adminOnly  → permite admin y consulta (acceso al layout)
// strictAdmin→ solo admin (visitas, alertas, catálogos, usuarios)
function PrivateRoute({ children, adminOnly = false, strictAdmin = false }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div style={{
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      height: '100vh', color: '#6B7280', fontSize: '1rem',
    }}>
      Cargando...
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly  && !['admin', 'consulta'].includes(user.rol)) return <Navigate to="/" replace />;
  if (strictAdmin && user.rol !== 'admin') return <Navigate to="/admin" replace />;
  return children;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            {/* Auditor */}
            <Route path="/" element={
              <PrivateRoute><ErrorBoundary><AuditorHome /></ErrorBoundary></PrivateRoute>
            } />
            <Route path="/nueva-visita" element={
              <PrivateRoute><ErrorBoundary><NewVisit /></ErrorBoundary></PrivateRoute>
            } />
            <Route path="/mis-visitas" element={
              <PrivateRoute><ErrorBoundary><MyVisits /></ErrorBoundary></PrivateRoute>
            } />

            {/* Admin + Consulta — layout compartido */}
            <Route path="/admin" element={
              <PrivateRoute adminOnly><ErrorBoundary><AdminLayout /></ErrorBoundary></PrivateRoute>
            }>
              <Route index element={<AdminDashboard />} />
              {/* Solo admin completo puede acceder a estas secciones */}
              <Route path="visitas"   element={<PrivateRoute strictAdmin><AdminVisits /></PrivateRoute>} />
              <Route path="alertas"   element={<PrivateRoute strictAdmin><AdminAlerts /></PrivateRoute>} />
              <Route path="catalogos" element={<PrivateRoute strictAdmin><AdminCatalogs /></PrivateRoute>} />
              <Route path="usuarios"  element={<PrivateRoute strictAdmin><AdminUsers /></PrivateRoute>} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
