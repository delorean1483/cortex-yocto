import { Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx'
import Layout from './components/Layout.jsx'
import LoginPage from './pages/LoginPage.jsx'
import { lazyPage } from './components/lazyPage.js'

// Each page is its own chunk, so the first load only fetches the shell and the
// page you land on; recharts (Telemetry) and leaflet (Map) load when opened.
const DashboardPage    = lazyPage(() => import('./pages/DashboardPage.jsx'))
const AlertsPage       = lazyPage(() => import('./pages/AlertsPage.jsx'))
const APUHistoryPage   = lazyPage(() => import('./pages/APUHistoryPage.jsx'))
const MaintenancePage  = lazyPage(() => import('./pages/MaintenancePage.jsx'))
const UsersPage        = lazyPage(() => import('./pages/UsersPage.jsx'))
const ReportsPage      = lazyPage(() => import('./pages/ReportsPage.jsx'))
const UnitDetailPage   = lazyPage(() => import('./pages/UnitDetailPage.jsx'))
const SystemConfigPage = lazyPage(() => import('./pages/SystemConfigPage.jsx'))
const FleetMapPage     = lazyPage(() => import('./pages/FleetMapPage.jsx'))

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
                {/* inside Layout so the nav stays put while a page chunk loads */}
                <Suspense fallback={null}>
                <Routes>
                  <Route path="/"            element={<DashboardPage />} />
                  <Route path="/units/:id"   element={<UnitDetailPage />} />
                  <Route path="/alerts"      element={<AlertsPage />} />
                  <Route path="/history"     element={<APUHistoryPage />} />
                  <Route path="/maintenance" element={<MaintenancePage />} />
                  <Route path="/map"         element={<FleetMapPage />} />
                  <Route path="/users"       element={<UsersPage />} />
                  <Route path="/config"      element={<SystemConfigPage />} />
                  <Route path="/reports"     element={<ReportsPage />} />
                  <Route path="*"            element={<Navigate to="/" replace />} />
                </Routes>
                </Suspense>
              </Layout>
            </Protected>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
