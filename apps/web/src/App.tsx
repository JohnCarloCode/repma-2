import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider, useSession } from './auth/AuthContext';
import { RouteGuard } from './auth/guards';
import { AppShell } from './components/shell/AppShell';
import { roleHome } from './auth/session';
import { createQueryClient } from './lib/queryClient';
import { ToastProvider } from './lib/toast';
import { ActivityPage } from './pages/ActivityPage';
import { AvailabilityDetailPage } from './pages/AvailabilityDetailPage';
import { AvailabilityPage } from './pages/AvailabilityPage';
import { CatalogPage } from './pages/CatalogPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { PlatformTenantsPage } from './pages/PlatformTenantsPage';
import { PlatformUsersPage } from './pages/PlatformUsersPage';
import { ReplenishmentDetailPage } from './pages/ReplenishmentDetailPage';
import { ReplenishmentPage } from './pages/ReplenishmentPage';
import { UnauthorizedPage } from './pages/UnauthorizedPage';

/** layout.md §Route guards rule 4: unknown routes land on the role home. */
function RoleHomeRedirect() {
  return <Navigate to={roleHome(useSession()).path} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      {/* DP-01 interim: the landing page ships in the polish phase (9.1). */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />

      {/* The shell wraps every guarded route, and /unauthorized when there is a session (layout.md). */}
      <Route element={<AppShell />}>
        <Route path="/unauthorized" element={<UnauthorizedPage />} />

        <Route element={<RouteGuard permission="activity:read" store />}>
          <Route path="/activity" element={<ActivityPage />} />
        </Route>
        <Route element={<RouteGuard permission="replenishment:read" store />}>
          <Route path="/replenishment" element={<ReplenishmentPage />} />
          <Route path="/replenishment/:id" element={<ReplenishmentDetailPage />} />
        </Route>
        <Route element={<RouteGuard permission="availability:read" store />}>
          <Route path="/home" element={<HomePage />} />
          <Route path="/availability" element={<AvailabilityPage />} />
          <Route path="/availability/:id" element={<AvailabilityDetailPage />} />
        </Route>
        <Route element={<RouteGuard permission="assortment:manage" store />}>
          <Route path="/catalog" element={<CatalogPage />} />
        </Route>

        {/* Platform zone: global routes, no store needed (layout.md §Route guards). */}
        <Route element={<RouteGuard permission="tenant:manage" />}>
          <Route path="/platform/tenants" element={<PlatformTenantsPage />} />
        </Route>
        <Route element={<RouteGuard permission="user:manage" />}>
          <Route path="/platform/users" element={<PlatformUsersPage />} />
        </Route>
      </Route>

      <Route path="*" element={<RoleHomeRedirect />} />
    </Routes>
  );
}

const queryClient = createQueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
