import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router';
import { useAuthStore } from './lib/auth.js';
import { useSAStore, type SAUser } from './lib/superadmin-auth.js';
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
import ManagementCompaniesListPage from './pages/superadmin/ManagementCompaniesListPage.js';
import ManagementCompanyDetailPage from './pages/superadmin/ManagementCompanyDetailPage.js';
import PlatformOwnerDashboardPage from './pages/superadmin/PlatformOwnerDashboardPage.js';
import PlatformAnalyticsPage from './pages/superadmin/PlatformAnalyticsPage.js';
import PlatformNotificationsPage from './pages/superadmin/PlatformNotificationsPage.js';
import ManagementLoginPage from './pages/management/ManagementLoginPage.js';
import ManagementLayout from './pages/management/ManagementLayout.js';
import ManagementDashboardPage from './pages/management/ManagementDashboardPage.js';
import ManagementAnalyticsPage from './pages/management/ManagementAnalyticsPage.js';
import ManagementNotificationsPage from './pages/management/ManagementNotificationsPage.js';
import ManagementBrandingPage from './pages/management/ManagementBrandingPage.js';
import AcceptManagementCompanyInvitePage from './pages/auth/AcceptManagementCompanyInvitePage.js';
import AcceptClientOrgInvitePage from './pages/auth/AcceptClientOrgInvitePage.js';
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
import AnalyticsPage from './pages/workspace/AnalyticsPage.js';
import { api, buildApiUrl } from './lib/api.js';

function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const { user, setUser, clearAuth, bootstrapped, markBootstrapped } = useAuthStore();

  useEffect(() => {
    if (bootstrapped) return;
    let cancelled = false;

    async function bootstrap() {
      if (user) {
        markBootstrapped();
        return;
      }

      try {
        const me = await api.get<{
          user: {
            id: string;
            name: string;
            email: string;
            orgRole: string;
            impersonatedBy?: string | null;
          };
        }>('/auth/me');
        if (!cancelled) {
          setUser(me.user);
        }
      } catch {
        if (!cancelled) {
          clearAuth();
        }
      } finally {
        if (!cancelled) {
          markBootstrapped();
        }
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [bootstrapped, user, setUser, clearAuth, markBootstrapped]);

  if (!bootstrapped) return null;
  return <>{children}</>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

function RequirePlatformOwner({ children }: { children: React.ReactNode }) {
  const { bootstrapped, user } = useSAStore();
  if (!bootstrapped) return null;
  if (!user) return <Navigate to="/superadmin/login" replace />;
  if (user?.type !== 'platform_owner') return <Navigate to="/management" replace />;
  return <>{children}</>;
}

function RequireManagementAdmin({ children }: { children: React.ReactNode }) {
  const { bootstrapped, user } = useSAStore();
  if (!bootstrapped) return null;
  if (!user) return <Navigate to="/management/login" replace />;
  if (user?.type !== 'management_company_admin') return <Navigate to="/superadmin" replace />;
  return <>{children}</>;
}

function isPortalPath(pathname: string) {
  return pathname.startsWith('/superadmin') || pathname.startsWith('/management') || pathname.startsWith('/m/');
}

function PortalAuthBootstrap({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { user, setUser, clearAuth, bootstrapped, markBootstrapped } = useSAStore();

  useEffect(() => {
    if (!isPortalPath(location.pathname) || bootstrapped) return;
    let cancelled = false;

    async function bootstrap() {
      if (user) {
        markBootstrapped();
        return;
      }

      try {
        const response = await fetch(buildApiUrl('/superadmin/auth/me'), { credentials: 'include' });
        if (!response.ok) throw new Error('Unauthorized');
        const data = await response.json() as { user: SAUser };
        if (!cancelled) {
          setUser(data.user);
        }
      } catch {
        if (!cancelled) {
          clearAuth();
        }
      } finally {
        if (!cancelled) {
          markBootstrapped();
        }
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [bootstrapped, clearAuth, location.pathname, markBootstrapped, setUser, user]);

  if (isPortalPath(location.pathname) && !bootstrapped) return null;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthBootstrap>
      <PortalAuthBootstrap>
        <Routes>
      {/* Public auth */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/login/2fa" element={<TwoFactorPage />} />
      <Route path="/accept-invite/:token" element={<AcceptInvitePage />} />
      <Route path="/accept-management-company-invite/:token" element={<AcceptManagementCompanyInvitePage />} />
      <Route path="/accept-client-org-invite/:token" element={<AcceptClientOrgInvitePage />} />
      <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />

      {/* Platform Owner portal */}
      <Route path="/superadmin/login" element={<SuperAdminLoginPage />} />
      <Route
        path="/superadmin"
        element={
          <RequirePlatformOwner>
            <SuperAdminLayout />
          </RequirePlatformOwner>
        }
      >
        <Route index element={<PlatformOwnerDashboardPage />} />
        <Route path="orgs" element={<OrgsListPage />} />
        <Route path="orgs/:id" element={<OrgDetailPage />} />
        <Route path="companies" element={<ManagementCompaniesListPage />} />
        <Route path="companies/:id" element={<ManagementCompanyDetailPage />} />
        <Route path="system" element={<SystemHealthPage />} />
        <Route path="analytics" element={<PlatformAnalyticsPage />} />
        <Route path="notifications" element={<PlatformNotificationsPage />} />
      </Route>

      {/* Management Company portal */}
      <Route path="/m/:slug" element={<Navigate to="login" replace />} />
      <Route path="/m/:slug/login" element={<ManagementLoginPage />} />
      <Route path="/management/login" element={<ManagementLoginPage />} />
      <Route
        path="/management"
        element={
          <RequireManagementAdmin>
            <ManagementLayout />
          </RequireManagementAdmin>
        }
      >
        <Route index element={<ManagementDashboardPage />} />
        <Route path="orgs" element={<OrgsListPage />} />
        <Route path="orgs/:id" element={<OrgDetailPage />} />
        <Route path="settings/branding" element={<ManagementBrandingPage />} />
        <Route path="analytics" element={<ManagementAnalyticsPage />} />
        <Route path="notifications" element={<ManagementNotificationsPage />} />
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
        <Route path="/workspaces/:wsId/analytics" element={<AnalyticsPage />} />
      </Route>

      {/* Root redirect */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </PortalAuthBootstrap>
    </AuthBootstrap>
  );
}
