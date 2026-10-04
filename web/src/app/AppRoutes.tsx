import { Navigate, Route, Routes } from 'react-router-dom'
import { LoginPage } from '../features/auth/LoginPage'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { PlaceholderPage } from './PlaceholderPage'
import { ProtectedRoute } from './ProtectedRoute'
import { Shell } from './Shell'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Shell />}>
          <Route index element={<DashboardPage />} />
          <Route
            path="insights"
            element={
              <PlaceholderPage title="Insights">
                Chat with your health data is coming to the new app.
              </PlaceholderPage>
            }
          />
          <Route
            path="settings"
            element={
              <PlaceholderPage title="Settings">
                Account and AI settings are coming to the new app.
              </PlaceholderPage>
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
