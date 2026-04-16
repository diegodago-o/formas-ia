import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';

import LoginPage    from './pages/auth/LoginPage';
import AuditorHome  from './pages/auditor/AuditorHome';
import NewVisit     from './pages/auditor/NewVisit';
import MyVisits     from './pages/auditor/MyVisits';
import AdminLayout  from './pages/admin/AdminLayout';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminVisits  from './pages/admin/AdminVisits';
import AdminAlerts  from './pages/admin/AdminAlerts';
import AdminCatalogs from './pages/admin/AdminCatalogs';
import AdminUsers   from './pages/admin/AdminUsers';

function PrivateRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', color:'#6B7280' }}>Cargando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.rol !== 'admin') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Auditor */}
          <Route path="/" element={<PrivateRoute><AuditorHome /></PrivateRoute>} />
          <Route path="/nueva-visita" element={<PrivateRoute><NewVisit /></PrivateRoute>} />
          <Route path="/mis-visitas" element={<PrivateRoute><MyVisits /></PrivateRoute>} />

          {/* Admin */}
          <Route path="/admin" element={<PrivateRoute adminOnly><AdminLayout /></PrivateRoute>}>
            <Route index element={<AdminDashboard />} />
            <Route path="visitas"   element={<AdminVisits />} />
            <Route path="alertas"   element={<AdminAlerts />} />
            <Route path="catalogos" element={<AdminCatalogs />} />
            <Route path="usuarios"  element={<AdminUsers />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
