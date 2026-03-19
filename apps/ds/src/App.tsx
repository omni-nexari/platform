import { Routes, Route, Navigate } from 'react-router';
import { useAuthStore } from './lib/auth.js';
import { useSAStore } from './lib/superadmin-auth.js';
import LoginPage from './pages/auth/LoginPage.js';
import TwoFactorPage from './pages/auth/TwoFactorPage.js';
import AcceptInvitePage from './pages/auth/AcceptInvitePage.js';
import ResetPasswordPage from './pages/auth/ResetPasswordPage.js';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage.js';
import SuperAdminLoginPage from './pages/superadmin/SuperAdminLoginPage.js';
import SuperAdminLayout from './pages/superadmin/SuperAdminLayout.js';
import OrgsListPage from './pages/superadmin/OrgsListPage.js';
import OrgDetailPage from './pages/superadmin/OrgDetailPage.js';
import SystemHealthPage from './pages/superadmin/SystemHealthPage.js';
import SettingsPage from './pages/account/SettingsPage.js';
import AppLayout from './components/AppLayout.js';
import OrgDashboardPage from './pages/OrgDashboardPage.js';
import WorkspaceDashboardPage from './pages/workspace/WorkspaceDashboardPage.js';
import DeviceDetailPage from './pages/workspace/DeviceDetailPage.js';
import ContentPage from './pages/workspace/ContentPage.js';
import PlaylistPage from './pages/workspace/PlaylistPage.js';
import PlaylistEditorPage from './pages/workspace/PlaylistEditorPage.js';
import SchedulePage from './pages/workspace/SchedulePage.js';
import ScheduleEditorPage from './pages/workspace/ScheduleEditorPage.js';
import TagsPage from './pages/workspace/TagsPage.js';
import CanvasEditorPage from './pages/workspace/CanvasEditorPage.js';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

function RequireSuperAdmin({ children }: { children: React.ReactNode }) {
  const token = useSAStore((s) => s.accessToken);
  return token ? <>{children}</> : <Navigate to="/superadmin/login" replace />;
}

export default function App() {
  return (
    <Routes>
      {/* Public auth */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/login/2fa" element={<TwoFactorPage />} />
      <Route path="/accept-invite/:token" element={<AcceptInvitePage />} />
      <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />

      {/* Super Admin */}
      <Route path="/superadmin/login" element={<SuperAdminLoginPage />} />
      <Route
        path="/superadmin"
        element={
          <RequireSuperAdmin>
            <SuperAdminLayout />
          </RequireSuperAdmin>
        }
      >
        <Route index element={<Navigate to="/superadmin/orgs" replace />} />
        <Route path="orgs" element={<OrgsListPage />} />
        <Route path="orgs/:id" element={<OrgDetailPage />} />
        <Route path="system" element={<SystemHealthPage />} />
        <Route
          path="analytics"
          element={<div className="p-8 text-[var(--text-muted)]">Analytics — Phase 2+</div>}
        />
      </Route>

      {/* Authenticated user shell */}
      <Route
        path="/account/security"
        element={<Navigate to="/settings?section=security" replace />}
      />

      {/* Main app — dashboard + workspace/device pages */}
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/dashboard" element={<OrgDashboardPage />} />
        <Route path="/workspaces/:wsId" element={<WorkspaceDashboardPage />} />
        <Route path="/workspaces/:wsId/devices/:deviceId" element={<DeviceDetailPage />} />
        <Route path="/workspaces/:wsId/content" element={<ContentPage />} />
        <Route path="/workspaces/:wsId/playlist" element={<PlaylistPage />} />
        <Route path="/workspaces/:wsId/playlist/:id" element={<PlaylistEditorPage />} />
        <Route path="/workspaces/:wsId/schedule" element={<SchedulePage />} />
        <Route path="/workspaces/:wsId/schedule/:id" element={<ScheduleEditorPage />} />
        <Route path="/workspaces/:wsId/tags" element={<TagsPage />} />
        <Route path="/workspaces/:wsId/canvas/:id" element={<CanvasEditorPage />} />
      </Route>

      {/* Root redirect */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
