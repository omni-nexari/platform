import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router';
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
import InfraMonitoringPage from './pages/superadmin/InfraMonitoringPage.js';
import ManagementCompaniesListPage from './pages/superadmin/ManagementCompaniesListPage.js';
import ManagementCompanyDetailPage from './pages/superadmin/ManagementCompanyDetailPage.js';
import PlatformOwnerDashboardPage from './pages/superadmin/PlatformOwnerDashboardPage.js';
import PlatformAnalyticsPage from './pages/superadmin/PlatformAnalyticsPage.js';
import PlatformNotificationsPage from './pages/superadmin/PlatformNotificationsPage.js';
import PlatformLogsPage from './pages/superadmin/PlatformLogsPage.js';
import PlayerReleasesPage from './pages/superadmin/PlayerReleasesPage.js';
import SuperAdminSupportPage from './pages/superadmin/SuperAdminSupportPage.js';
import SuperAdminSupportTicketDetailPage from './pages/superadmin/SuperAdminSupportTicketDetailPage.js';
import ManagementLoginPage from './pages/management/ManagementLoginPage.js';
import ManagementLayout from './pages/management/ManagementLayout.js';
import ManagementDashboardPage from './pages/management/ManagementDashboardPage.js';
import ManagementAnalyticsPage from './pages/management/ManagementAnalyticsPage.js';
import ManagementNotificationsPage from './pages/management/ManagementNotificationsPage.js';
import ManagementSupportPage from './pages/management/ManagementSupportPage.js';
import ManagementSupportTicketDetailPage from './pages/management/ManagementSupportTicketDetailPage.js';
import ManagementBrandingPage from './pages/management/ManagementBrandingPage.js';
import ManagementLogsPage from './pages/management/ManagementLogsPage.js';
import ManagementReleasesPage from './pages/management/ManagementReleasesPage.js';
import OrgSupportPage from './pages/support/OrgSupportPage.js';
import OrgSupportTicketDetailPage from './pages/support/OrgSupportTicketDetailPage.js';
import AcceptManagementCompanyInvitePage from './pages/auth/AcceptManagementCompanyInvitePage.js';
import AcceptClientOrgInvitePage from './pages/auth/AcceptClientOrgInvitePage.js';
import SettingsPage from './pages/account/SettingsPage.js';
import AppLayout from './components/AppLayout.js';
import OrgDashboardPage from './pages/OrgDashboardPage.js';
import WorkspaceDashboardPage from './pages/workspace/WorkspaceDashboardPage.js';
import DevicesPage from './pages/workspace/DevicesPage.js';
import DeviceDetailPage from './pages/workspace/DeviceDetailPage.js';
import DeviceGroupsPage from './pages/workspace/DeviceGroupsPage.js';
import DeviceGroupDetailPage from './pages/workspace/DeviceGroupDetailPage.js';
import TizenTestPage from './pages/workspace/TizenTestPage.js';
import TestSyncPage from './pages/TestSyncPage.js';
import B2BTestPage from './pages/workspace/B2BTestPage.js';
import PosMenuPage from './pages/workspace/PosMenuPage.js';
import PosOrderPage from './pages/workspace/PosOrderPage.js';
import PosPaymentPage from './pages/workspace/PosPaymentPage.js';
import PosOrdersPage from './pages/workspace/PosOrdersPage.js';
import PosKioskPage from './pages/workspace/PosKioskPage.js';
import PosKitchenPage from './pages/workspace/PosKitchenPage.js';
import PosInventoryPage from './pages/workspace/PosInventoryPage.js';
import PosEmployeesPage from './pages/workspace/PosEmployeesPage.js';
import PosLoyaltyPage from './pages/workspace/PosLoyaltyPage.js';
import PosAnalyticsPage from './pages/workspace/PosAnalyticsPage.js';
import PosExpensesPage from './pages/workspace/PosExpensesPage.js';
import PosPurchaseOrdersPage from './pages/workspace/PosPurchaseOrdersPage.js';
import PosMenuBoardsPage from './pages/workspace/PosMenuBoardsPage.js';
import ContentPage from './pages/workspace/ContentPage.js';
import PlaylistPage from './pages/workspace/PlaylistPage.js';
import PlaylistEditorPage from './pages/workspace/PlaylistEditorPage.js';
import SchedulePage from './pages/workspace/SchedulePage.js';
import ScheduleEditorPage from './pages/workspace/ScheduleEditorPage.js';
import TagsPage from './pages/workspace/TagsPage.js';
import CanvasEditorPage from './pages/workspace/CanvasEditorPage.js';
import AnalyticsPage from './pages/workspace/AnalyticsPage.js';
import SyncPlaylistEditorPage from './pages/workspace/SyncPlaylistEditorPage.js';
import ZoneLayoutEditorPage from './pages/workspace/ZoneLayoutEditorPage.js';
import CalendarEditorPage from './pages/workspace/CalendarEditorPage.js';
import LiveLinkFaceEditorPage from './pages/workspace/LiveLinkFaceEditorPage.js';
import { buildApiUrl } from './lib/api.js';
import KioskDisplayPage from './pages/kiosk/KioskDisplayPage.js';
import KitchenDisplayPage from './pages/kitchen/KitchenDisplayPage.js';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSessionUser<T>(path: string, retryCount = 0): Promise<T> {
  let attempts = 0;

  while (true) {
    const response = await fetch(buildApiUrl(path), { credentials: 'include' });
    if (response.ok) {
      return response.json() as Promise<T>;
    }

    if (attempts >= retryCount || (response.status !== 401 && response.status !== 404)) {
      throw new Error('Unauthorized');
    }

    attempts += 1;
    await sleep(150);
  }
}

function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { user, setUser, clearAuth, bootstrapped, pendingBootstrap, markBootstrapped } = useAuthStore();

  useEffect(() => {
    if (bootstrapped) return;
    if (!pendingBootstrap && (isMainPublicAuthPath(location.pathname) || isPortalPath(location.pathname))) {
      markBootstrapped();
      return;
    }
    let cancelled = false;

    async function bootstrap() {
      try {
        const me = await fetchSessionUser<{
          user: {
            id: string;
            name: string;
            email: string;
            orgRole: string;
            impersonatedBy?: string | null;
          };
          org: {
            id: string;
            name: string;
            slug: string;
            plan: string;
            settings: string;
          } | null;
        }>('/auth/me', pendingBootstrap ? 2 : 0);
        if (!cancelled) {
          setUser(me.user, me.org);
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
  }, [bootstrapped, pendingBootstrap, user, setUser, clearAuth, markBootstrapped, location.pathname]);

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
  // Not logged in OR logged in as platform_owner → send to generic management login.
  if (!user || user.type !== 'management_company_admin') {
    return <Navigate to="/management/login" replace />;
  }
  return <>{children}</>;
}

function isPortalPath(pathname: string) {
  return (
    pathname.startsWith('/superadmin') ||
    pathname.startsWith('/management') ||
    pathname.startsWith('/m/') ||
    // /:slug/login — management portal login via short URL
    /^\/[a-z0-9][a-z0-9-]*\/login(?:\/.*)?$/.test(pathname)
  );
}

function isMainPublicAuthPath(pathname: string) {
  return pathname === '/login'
    || pathname === '/login/2fa'
    || pathname === '/forgot-password'
    || pathname.startsWith('/reset-password/')
    || pathname.startsWith('/accept-invite/')
    || pathname.startsWith('/accept-management-company-invite/')
    || pathname.startsWith('/accept-client-org-invite/')
    // Public device display pages — no session auth needed
    || pathname.startsWith('/kiosk/')
    || pathname.startsWith('/kitchen/');
}

function isPortalPublicAuthPath(pathname: string) {
  return pathname === '/superadmin/login'
    || pathname === '/management/login'
    || /^\/m\/[^/]+(?:\/login)?$/.test(pathname)
    || /^\/[a-z0-9][a-z0-9-]*\/login$/.test(pathname); // /:slug/login short URL
}

function PortalAuthBootstrap({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { user, setUser, clearAuth, bootstrapped, pendingBootstrap, markBootstrapped } = useSAStore();

  useEffect(() => {
    if (!isPortalPath(location.pathname) || bootstrapped) return;
    if (!pendingBootstrap && isPortalPublicAuthPath(location.pathname)) {
      markBootstrapped();
      return;
    }
    let cancelled = false;

    async function bootstrap() {
      try {
        const data = await fetchSessionUser<{ user: SAUser }>(
          '/superadmin/auth/me',
          pendingBootstrap ? 2 : 0,
        );
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
  }, [bootstrapped, pendingBootstrap, clearAuth, location.pathname, markBootstrapped, setUser, user]);

  if (isPortalPath(location.pathname) && !bootstrapped) return null;
  return <>{children}</>;
}

/** Redirects /m/:slug/login → /:slug/login (backward compat for old links) */
function MSlugLoginRedirect() {
  const { slug } = useParams<{ slug: string }>();
  return <Navigate to={`/${slug}/login`} replace />;
}

export default function App() {
  return (
    <AuthBootstrap>
      <PortalAuthBootstrap>
        <Routes>
      {/* Public device display pages — no auth */}
      <Route path="/kiosk/:wsId/:orientation" element={<KioskDisplayPage />} />
      <Route path="/kitchen/:wsId" element={<KitchenDisplayPage />} />

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
        <Route path="monitoring" element={<InfraMonitoringPage />} />
        <Route path="analytics" element={<PlatformAnalyticsPage />} />
        <Route path="notifications" element={<PlatformNotificationsPage />} />
        <Route path="logs" element={<PlatformLogsPage />} />
        <Route path="player-releases" element={<PlayerReleasesPage />} />
        <Route path="support" element={<SuperAdminSupportPage />} />
        <Route path="support/:id" element={<SuperAdminSupportTicketDetailPage />} />
      </Route>

      {/* Management Company portal — short URL: /:slug/login */}
      <Route path="/:slug/login" element={<ManagementLoginPage />} />
      {/* Backward compat: /m/:slug/login → /:slug/login */}
      <Route path="/m/:slug/login" element={<MSlugLoginRedirect />} />
      <Route path="/m/:slug" element={<MSlugLoginRedirect />} />
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
        <Route path="logs" element={<ManagementLogsPage />} />
        <Route path="releases" element={<ManagementReleasesPage />} />
        <Route path="support" element={<ManagementSupportPage />} />
        <Route path="support/:id" element={<ManagementSupportTicketDetailPage />} />
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
        <Route path="/support" element={<OrgSupportPage />} />
        <Route path="/support/:id" element={<OrgSupportTicketDetailPage />} />
        <Route path="/tizen-test" element={<TizenTestPage />} />
        <Route path="/test-sync" element={<TestSyncPage />} />
        <Route path="/workspaces/:wsId" element={<WorkspaceDashboardPage />} />
        <Route path="/workspaces/:wsId/devices" element={<DevicesPage />} />
        <Route path="/workspaces/:wsId/devices/groups" element={<DeviceGroupsPage />} />
        <Route path="/workspaces/:wsId/devices/groups/:groupId" element={<DeviceGroupDetailPage />} />
        <Route path="/workspaces/:wsId/devices/b2b-test" element={<B2BTestPage />} />
        <Route path="/workspaces/:wsId/devices/:deviceId" element={<DeviceDetailPage />} />
        <Route path="/workspaces/:wsId/pos/menu" element={<PosMenuPage />} />
        <Route path="/workspaces/:wsId/pos" element={<PosOrderPage />} />
        <Route path="/workspaces/:wsId/pos/payment" element={<PosPaymentPage />} />
        <Route path="/workspaces/:wsId/pos/orders" element={<PosOrdersPage />} />
        <Route path="/workspaces/:wsId/pos/kiosk" element={<PosKioskPage />} />
        <Route path="/workspaces/:wsId/pos/kitchen" element={<PosKitchenPage />} />
        <Route path="/workspaces/:wsId/pos/inventory" element={<PosInventoryPage />} />
        <Route path="/workspaces/:wsId/pos/employees" element={<PosEmployeesPage />} />
        <Route path="/workspaces/:wsId/pos/loyalty" element={<PosLoyaltyPage />} />
        <Route path="/workspaces/:wsId/pos/analytics" element={<PosAnalyticsPage />} />
        <Route path="/workspaces/:wsId/pos/expenses" element={<PosExpensesPage />} />
        <Route path="/workspaces/:wsId/pos/purchase-orders" element={<PosPurchaseOrdersPage />} />
        <Route path="/workspaces/:wsId/pos/menu-boards" element={<PosMenuBoardsPage />} />
        <Route path="/workspaces/:wsId/content" element={<ContentPage />} />
        <Route path="/workspaces/:wsId/playlist" element={<PlaylistPage />} />
        <Route path="/workspaces/:wsId/playlist/sync/:id" element={<SyncPlaylistEditorPage />} />
        <Route path="/workspaces/:wsId/playlist/:id" element={<PlaylistEditorPage />} />
        <Route path="/workspaces/:wsId/schedule" element={<SchedulePage />} />
        <Route path="/workspaces/:wsId/schedule/:id" element={<ScheduleEditorPage />} />
        <Route path="/workspaces/:wsId/tags" element={<TagsPage />} />
        <Route path="/workspaces/:wsId/canvas/:id" element={<CanvasEditorPage />} />
        <Route path="/workspaces/:wsId/analytics" element={<AnalyticsPage />} />
        {/* Legacy redirects: sync playlists/groups merged into Playlists & Device Groups */}
        <Route path="/workspaces/:wsId/sync-playlists" element={<Navigate to="../playlist" replace />} />
        <Route path="/workspaces/:wsId/sync-playlists/:id" element={<SyncPlaylistEditorPage />} />
        <Route path="/workspaces/:wsId/sync-groups" element={<Navigate to="../devices/groups" replace />} />
        <Route path="/workspaces/:wsId/zone-layout/:id" element={<ZoneLayoutEditorPage />} />
        <Route path="/workspaces/:wsId/calendar/:id" element={<CalendarEditorPage />} />
        <Route path="/workspaces/:wsId/live-link-face/:id" element={<LiveLinkFaceEditorPage />} />
      </Route>

      {/* Root redirect */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </PortalAuthBootstrap>
    </AuthBootstrap>
  );
}
