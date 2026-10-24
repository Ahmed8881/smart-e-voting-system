import { Navigate, Route, Routes } from 'react-router'
import { AdminAuthProvider, RequireAdmin } from './auth/AdminAuth.tsx'
import { RequireVoter, VoterAuthProvider } from './auth/VoterAuth.tsx'
import AdminLayout from './pages/admin/AdminLayout.tsx'
import AdminLoginPage from './pages/admin/AdminLoginPage.tsx'
import AuditLogPage from './pages/admin/AuditLogPage.tsx'
import ElectionDetailPage from './pages/admin/ElectionDetailPage.tsx'
import ElectionsPage from './pages/admin/ElectionsPage.tsx'
import FraudAlertsPage from './pages/admin/FraudAlertsPage.tsx'
import RecoveryPage from './pages/admin/RecoveryPage.tsx'
import SettingsPage from './pages/admin/SettingsPage.tsx'
import VotersPage from './pages/admin/VotersPage.tsx'
import HomePage from './pages/HomePage.tsx'
import LoginPage from './pages/LoginPage.tsx'
import RegisterPage from './pages/RegisterPage.tsx'
import BallotPage from './pages/voter/BallotPage.tsx'
import ResultsPage from './pages/voter/ResultsPage.tsx'
import VoterHomePage from './pages/voter/VoterHomePage.tsx'
import VoterLayout from './pages/voter/VoterLayout.tsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/login"
        element={
          <VoterAuthProvider>
            <LoginPage />
          </VoterAuthProvider>
        }
      />
      <Route
        path="/voter/*"
        element={
          <VoterAuthProvider>
            <RequireVoter>
              <Routes>
                <Route element={<VoterLayout />}>
                  <Route index element={<VoterHomePage />} />
                  <Route path="elections/:id" element={<BallotPage />} />
                  <Route path="elections/:id/results" element={<ResultsPage />} />
                </Route>
              </Routes>
            </RequireVoter>
          </VoterAuthProvider>
        }
      />
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
                <Route index element={<Navigate to="elections" replace />} />
                <Route path="elections" element={<ElectionsPage />} />
                <Route path="elections/:id" element={<ElectionDetailPage />} />
                <Route path="voters" element={<VotersPage />} />
                <Route path="fraud" element={<FraudAlertsPage />} />
                <Route path="recovery" element={<RecoveryPage />} />
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
