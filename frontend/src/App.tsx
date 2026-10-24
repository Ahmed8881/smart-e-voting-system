import { Navigate, Route, Routes } from 'react-router'
import { AdminAuthProvider, RequireAdmin } from './auth/AdminAuth.tsx'
import AdminLayout from './pages/admin/AdminLayout.tsx'
import AdminLoginPage from './pages/admin/AdminLoginPage.tsx'
import AuditLogPage from './pages/admin/AuditLogPage.tsx'
import SettingsPage from './pages/admin/SettingsPage.tsx'
import VotersPage from './pages/admin/VotersPage.tsx'
import HomePage from './pages/HomePage.tsx'
import RegisterPage from './pages/RegisterPage.tsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/admin/*"
        element={
          <AdminAuthProvider>
            <Routes>
              <Route path="login" element={<AdminLoginPage />} />
              <Route
                element={
                  <RequireAdmin>
                    <AdminLayout />
                  </RequireAdmin>
                }
              >
                <Route index element={<Navigate to="voters" replace />} />
                <Route path="voters" element={<VotersPage />} />
                <Route path="audit-log" element={<AuditLogPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Routes>
          </AdminAuthProvider>
        }
      />
      <Route path="*" element={<p className="p-6">Page not found.</p>} />
    </Routes>
  )
}
