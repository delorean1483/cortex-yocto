import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx'
import Layout from './components/Layout.jsx'
import LoginPage from './pages/LoginPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import RemoteControlPage from './pages/RemoteControlPage.jsx'
import AlertsPage from './pages/AlertsPage.jsx'
import APUHistoryPage from './pages/APUHistoryPage.jsx'
import FirmwarePage from './pages/FirmwarePage.jsx'
import MaintenancePage from './pages/MaintenancePage.jsx'
import UsersPage from './pages/UsersPage.jsx'
import ReportsPage from './pages/ReportsPage.jsx'
import StubPage from './pages/StubPage.jsx'

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/*" element={
            <Protected>
              <Layout>
                <Routes>
                  <Route path="/"            element={<DashboardPage />} />
                  <Route path="/remote"      element={<RemoteControlPage />} />
                  <Route path="/alerts"      element={<AlertsPage />} />
                  <Route path="/history"     element={<APUHistoryPage />} />
                  <Route path="/firmware"    element={<FirmwarePage />} />
                  <Route path="/maintenance" element={<MaintenancePage />} />
                  <Route path="/map"         element={<StubPage page="map" />} />
                  <Route path="/users"       element={<UsersPage />} />
                  <Route path="/config"      element={<StubPage page="config" />} />
                  <Route path="/reports"     element={<ReportsPage />} />
                  <Route path="*"            element={<Navigate to="/" replace />} />
                </Routes>
              </Layout>
            </Protected>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
