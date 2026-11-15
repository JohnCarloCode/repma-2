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
import { LoginPage } from './pages/LoginPage';
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
        <Route element={<RouteGuard permission="availability:read" store />}>
          <Route path="/availability" element={<AvailabilityPage />} />
          <Route path="/availability/:id" element={<AvailabilityDetailPage />} />
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
