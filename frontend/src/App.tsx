import { Suspense, lazy } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router'
import type { Role } from '@/types/api'
import { useAuth } from '@/hooks/useAuth'
import { hasRole, homePath } from '@/lib/roles'
import { AppShell, Wordmark } from '@/components/shell/AppShell'
import { LoginPage } from '@/pages/Login'
import { ChangePasswordPage, ForbiddenPage, NotFoundPage } from '@/pages/Misc'
import { RegisterPage } from '@/pages/reception/Register'
import { DuesPage, RegistrationsPage } from '@/pages/reception/Registrations'
import { FloorBoardPage, MyShiftPage } from '@/pages/volunteer/VolunteerPages'
import { LoadingRows } from '@/components/common/common'

// Admin screens (and Recharts) load on demand; reception and volunteers never pay for them.
const DashboardPage = lazy(() => import('@/pages/admin/Dashboard').then((m) => ({ default: m.DashboardPage })))
const DevicesPage = lazy(() => import('@/pages/admin/Config').then((m) => ({ default: m.DevicesPage })))
const PlansPage = lazy(() => import('@/pages/admin/Config').then((m) => ({ default: m.PlansPage })))
const StaffPage = lazy(() => import('@/pages/admin/Config').then((m) => ({ default: m.StaffPage })))
const SettingsPage = lazy(() => import('@/pages/admin/Config').then((m) => ({ default: m.SettingsPage })))
const ReportsPage = lazy(() => import('@/pages/admin/Reports').then((m) => ({ default: m.ReportsPage })))
const AuditLogPage = lazy(() => import('@/pages/admin/Reports').then((m) => ({ default: m.AuditLogPage })))

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Wordmark className="animate-pulse text-lg" />
    </div>
  )
}

function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  // The seeded admin and every new account must pick a password first (07 §4.8).
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />
  return <AppShell />
}

/** UI courtesy only — the server enforces roles on every call. */
function RequireRole({ roles }: { roles: Role[] }) {
  const { user } = useAuth()
  if (!hasRole(user?.role, roles)) return <ForbiddenPage />
  return (
    <Suspense fallback={<LoadingRows rows={6} />}>
      <Outlet />
    </Suspense>
  )
}

function Home() {
  const { user } = useAuth()
  return <Navigate to={user ? homePath(user.role) : '/login'} replace />
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />
      <Route element={<RequireAuth />}>
        <Route index element={<Home />} />
        <Route path="floor" element={<FloorBoardPage />} />
        <Route element={<RequireRole roles={['VOLUNTEER']} />}>
          <Route path="volunteer/shift" element={<MyShiftPage />} />
        </Route>
        <Route element={<RequireRole roles={['RECEPTION']} />}>
          <Route path="reception/register" element={<RegisterPage />} />
          <Route path="reception/registrations" element={<RegistrationsPage />} />
          <Route path="reception/dues" element={<DuesPage />} />
        </Route>
        <Route element={<RequireRole roles={['ADMIN']} />}>
          <Route path="admin" element={<DashboardPage />} />
          <Route path="admin/devices" element={<DevicesPage />} />
          <Route path="admin/plans" element={<PlansPage />} />
          <Route path="admin/staff" element={<StaffPage />} />
          <Route path="admin/reports" element={<ReportsPage />} />
          <Route path="admin/settings" element={<SettingsPage />} />
          <Route path="admin/audit" element={<AuditLogPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
