import { Outlet, NavLink, useNavigate, useLocation } from 'react-router';
import { useAuthStore } from '../lib/auth.js';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, buildWebSocketUrl } from '../lib/api.js';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useTheme } from '../contexts/ThemeContext.js';
import SearchModal from './SearchModal.js';
import NotificationTray from './NotificationTray.js';
import AiAssistant from './AiAssistant.js';
import { usePageTracking } from '../lib/usePageTracking.js';
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalPrimaryButton,
  ModalSecondaryButton,
} from './UiPrimitives.js';
import { useCmsEnabled, usePosEnabled } from '../lib/modules.js';
import {
  LayoutDashboard,
  Monitor,
  LogOut,
  User,
  AlertTriangle,
  X,
  ChevronDown,
  Shield,
  Sun,
  Moon,
  Zap,
  Image,
  Layers,
  CalendarDays,
  Tag,
  Eye,
  Search,
  Paintbrush,
  Menu,
  BarChart2,
  ClipboardList,
  ChefHat,
  Heart,
  Package,
  Smartphone,
  Users,
  CloudSun,
  UtensilsCrossed,
  DollarSign,
  FileText,
  Receipt,
  MessageSquare,
  ImageIcon,
} from 'lucide-react';

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

interface EmergencyOverride {
  id: string;
  contentText: string | null;
  scope: string;
  createdAt: string;
}

export default function AppLayout() {
  const { user, bootstrapped, clearAuth, setUser } = useAuthStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();

  // Keep org.settings fresh — re-fetch /auth/me on window focus so module
  // changes made by an admin are reflected without requiring a full logout.
  const { data: meData } = useQuery<{ user: typeof user; org: { id: string; name: string; slug: string; plan: string; settings: string } | null }>({
    queryKey: ['me'],
    queryFn: () => api.get('/auth/me'),
    enabled: bootstrapped && !!user,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });
  useEffect(() => {
    if (meData?.user && meData.org !== undefined) {
      setUser(meData.user, meData.org);
    }
  }, [meData, setUser]);

  const isImpersonating = Boolean(user?.impersonatedBy);

  // Detect current workspace from URL
  const wsMatch = pathname.match(/^\/workspaces\/([^/]+)/);
  const currentWsId = wsMatch?.[1] ?? null;

  // Track page views for AI personalisation (fire-and-forget)
  usePageTracking(currentWsId);

  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [emergencyMsg, setEmergencyMsg] = useState('');
  const [emergencyScope, setEmergencyScope] = useState('org');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [geoCoords, setGeoCoords] = useState<{ lat: number; lon: number } | null>(null);

  // Request geolocation once on mount
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeoCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => { /* silently ignore if denied */ },
      { timeout: 5000, maximumAge: 3_600_000 },
    );
  }, []);

  interface WeatherData { temp: number | null; unit: string; code: number; label: string; icon: string }
  const { data: weather } = useQuery<WeatherData>({
    queryKey: ['weather', geoCoords?.lat?.toFixed(2), geoCoords?.lon?.toFixed(2)],
    queryFn: () => api.get(`/content/widgets/weather?lat=${geoCoords!.lat}&lon=${geoCoords!.lon}&units=metric`),
    enabled: !!geoCoords && bootstrapped && !!user,
    staleTime: 15 * 60 * 1000,
    retry: false,
  });

  // Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (currentWsId) setSearchOpen((o) => !o);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [currentWsId]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!bootstrapped || !user) return;

    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (cancelled) return;
      socket = new WebSocket(buildWebSocketUrl('/notifications/ws'));

      socket.onopen = () => {
        if (cancelled) {
          socket?.close();
        }
      };

      socket.onmessage = (event) => {
        if (!useAuthStore.getState().user) return;
        try {
          const payload = JSON.parse(event.data) as { type?: string };
          if (payload.type === 'notifications.invalidate') {
            void queryClient.invalidateQueries({ queryKey: ['notifications-tray'] });
            void queryClient.invalidateQueries({ queryKey: ['notifications'] });
          }
        } catch {
          // Ignore malformed realtime payloads.
        }
      };

      socket.onclose = () => {
        if (cancelled || !useAuthStore.getState().user) return;
        // Refresh the session before reconnecting so an expired access_token
        // cookie doesn't cause an immediate 4001 close again.
        reconnectTimer = setTimeout(async () => {
          try {
            await api.post('/auth/refresh', {});
          } catch {
            // If refresh fails the user will be logged out by api.ts; stop reconnecting.
            return;
          }
          if (!cancelled) connect();
        }, 3000);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    // Delay the initial connect so React Strict Mode's dev-only mount/unmount
    // cycle does not create a noisy "closed before established" warning.
    connectTimer = setTimeout(connect, isLocalDev ? 250 : 0);

    return () => {
      cancelled = true;
      if (connectTimer) clearTimeout(connectTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket?.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, [bootstrapped, user, queryClient]);

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: () => api.get('/workspaces'),
    enabled: bootstrapped && !!user,
    retry: false,
  });

  const { data: activeOverrides = [] } = useQuery<EmergencyOverride[]>({
    queryKey: ['emergency'],
    queryFn: () => api.get('/emergency'),
    enabled: bootstrapped && !!user,
    refetchInterval: (query) => (query.state.status === 'error' ? false : 30_000),
    retry: false,
  });

  const { data: currentWs } = useQuery<Workspace>({
    queryKey: ['workspace', currentWsId],
    queryFn: () => api.get(`/workspaces/${currentWsId}`),
    enabled: bootstrapped && !!user && !!currentWsId,
    retry: false,
  });

  const activateEmergency = useMutation({
    mutationFn: (data: { contentText: string; scope: string }) =>
      api.post('/emergency', { contentType: 'text', contentText: data.contentText, scope: data.scope }),
    onSuccess: () => {
      toast.error('Emergency override activated');
      setEmergencyOpen(false);
      setEmergencyMsg('');
      void queryClient.invalidateQueries({ queryKey: ['emergency'] });
    },
    onError: () => toast.error('Failed to activate emergency override'),
  });

  const clearOverride = useMutation({
    mutationFn: (id: string) => api.delete(`/emergency/${id}`),
    onSuccess: () => {
      toast.success('Emergency override cleared');
      void queryClient.invalidateQueries({ queryKey: ['emergency'] });
    },
    onError: () => toast.error('Failed to clear override'),
  });

  function handleLogout() {
    void api.post('/auth/logout');
    clearAuth();
    navigate('/login');
  }

  const canManageEmergency = user?.orgRole === 'owner' || user?.orgRole === 'admin';
  const cmsEnabled = useCmsEnabled();
  const posEnabled = usePosEnabled();
  const contentEnabled = cmsEnabled;

  return (
    <div className="flex h-screen bg-[var(--surface)] overflow-hidden">
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        />
      )}

      {/* ---------- Sidebar ---------- */}
      <aside className={`ui-mobile-drawer fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-[var(--border)] bg-[var(--card)] transition-transform duration-200 lg:static lg:z-auto lg:w-56 lg:max-w-none lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Logo */}
        <div className="px-4 py-5 border-b border-[var(--border)]">
          <span className="text-lg font-bold tracking-tight text-[var(--text)]">Nexari</span>
          <span className="text-[var(--blue)] text-lg font-bold">.</span>
        </div>

        {/* Nav */}
        <nav className="ui-mobile-drawer-nav flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-[var(--blue)] text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
              }`
            }
          >
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </NavLink>
          <NavLink
            to="/support"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-[var(--blue)] text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
              }`
            }
          >
            <MessageSquare className="w-4 h-4" />
            Support
          </NavLink>
          {/* Workspaces — always visible; clicking a workspace enters it */}
          {workspaces.length > 0 && (
            <div className="pt-2">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Workspaces
              </p>
              {workspaces.map((ws) => {
                const isActiveWs = ws.id === currentWsId;
                const wsLanding = posEnabled && !cmsEnabled
                  ? `/workspaces/${ws.id}/pos/orders`
                  : `/workspaces/${ws.id}/devices`;
                return (
                  <div key={ws.id}>
                    <button
                      onClick={() => navigate(wsLanding)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                        isActiveWs
                          ? 'text-[var(--text)] bg-[var(--surface)]'
                          : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                      }`}
                    >
                      <Monitor className="w-4 h-4 shrink-0" />
                      <span className="truncate">{ws.name}</span>
                    </button>

                    {/* Nav items for the active workspace */}
                    {isActiveWs && (
                      <div className="mt-0.5 space-y-0.5">
                        {/* Devices — always visible */}
                        <NavLink
                          to={`/workspaces/${ws.id}/devices`}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 pl-8 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                              isActive
                                ? 'bg-[var(--blue)] text-white'
                                : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                            }`
                          }
                        >
                          <Monitor className="w-4 h-4" />
                          Devices
                        </NavLink>

                        {/* CMS — Content */}
                        {contentEnabled && (
                          <NavLink
                            to={`/workspaces/${ws.id}/content`}
                            className={({ isActive }) =>
                              `flex items-center gap-2.5 pl-8 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                isActive
                                  ? 'bg-[var(--blue)] text-white'
                                  : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                              }`
                            }
                          >
                            <Image className="w-4 h-4" />
                            Content
                          </NavLink>
                        )}

                        {/* CMS / Signage section */}
                        {cmsEnabled && (
                          <>
                            <div className="pt-2 pb-1 pl-8 pr-3">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Signage</p>
                            </div>
                            <NavLink
                              to={`/workspaces/${ws.id}/rule-sets`}
                              className={({ isActive }) =>
                                `flex items-center gap-2.5 pl-8 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                  isActive
                                    ? 'bg-[var(--blue)] text-white'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                }`
                              }
                            >
                              <Zap className="w-4 h-4" />
                              Rule Sets
                            </NavLink>
                            <NavLink
                              to={`/workspaces/${ws.id}/playlist`}
                              className={({ isActive }) =>
                                `flex items-center gap-2.5 pl-8 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                  isActive
                                    ? 'bg-[var(--blue)] text-white'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                }`
                              }
                            >
                              <Layers className="w-4 h-4" />
                              Playlists
                            </NavLink>
                            <NavLink
                              to={`/workspaces/${ws.id}/schedule`}
                              className={({ isActive }) =>
                                `flex items-center gap-2.5 pl-8 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                  isActive
                                    ? 'bg-[var(--blue)] text-white'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                }`
                              }
                            >
                              <CalendarDays className="w-4 h-4" />
                              Schedules
                            </NavLink>
                            <NavLink
                              to={`/workspaces/${ws.id}/canvas/new`}
                              className={({ isActive }) =>
                                `flex items-center gap-2.5 pl-8 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                  isActive
                                    ? 'bg-[var(--blue)] text-white'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                }`
                              }
                            >
                              <Paintbrush className="w-4 h-4" />
                              Canvas
                            </NavLink>
                            <NavLink
                              to={`/workspaces/${ws.id}/tags`}
                              className={({ isActive }) =>
                                `flex items-center gap-2.5 pl-8 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                  isActive
                                    ? 'bg-[var(--blue)] text-white'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                }`
                              }
                            >
                              <Tag className="w-4 h-4" />
                              Tags
                            </NavLink>
                            <NavLink
                              to={`/workspaces/${ws.id}/analytics`}
                              className={({ isActive }) =>
                                `flex items-center gap-2.5 pl-8 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                  isActive
                                    ? 'bg-[var(--blue)] text-white'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                }`
                              }
                            >
                              <BarChart2 className="w-4 h-4" />
                              Analytics
                            </NavLink>
                          </>
                        )}

                        {/* POS section */}
                        {posEnabled && (
                          <>
                            <div className="pt-2 pb-1 pl-8 pr-3">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Point of Sale</p>
                            </div>
                            <NavLink
                              to={`/workspaces/${ws.id}/pos/orders`}
                              className={({ isActive }) =>
                                `flex items-center gap-2.5 pl-8 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                  isActive
                                    ? 'bg-[var(--blue)] text-white'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                }`
                              }
                            >
                              <ClipboardList className="w-4 h-4" />
                              Orders
                            </NavLink>
                            <NavLink
                              to={`/workspaces/${ws.id}/pos/kiosk`}
                              className={({ isActive }) =>
                                `flex items-center gap-2.5 pl-8 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                  isActive
                                    ? 'bg-[var(--blue)] text-white'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                }`
                              }
                            >
                              <Smartphone className="w-4 h-4" />
                              Kiosk
                            </NavLink>
                            <NavLink
                              to={`/workspaces/${ws.id}/pos/kitchen`}
                              className={({ isActive }) =>
                                `flex items-center gap-2.5 pl-8 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                  isActive
                                    ? 'bg-[var(--blue)] text-white'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                }`
                              }
                            >
                              <ChefHat className="w-4 h-4" />
                              Kitchen
                            </NavLink>
                            <NavLink
                              to={`/workspaces/${ws.id}/pos/inventory`}
                              className={({ isActive }) =>
                                `flex items-center gap-2.5 pl-8 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                  isActive
                                    ? 'bg-[var(--blue)] text-white'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                }`
                              }
                            >
                              <Package className="w-4 h-4" />
                              Inventory
                            </NavLink>
                            <NavLink
                              to={`/workspaces/${ws.id}/pos/employees`}
                              className={({ isActive }) =>
                                `flex items-center gap-2.5 pl-8 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                  isActive
                                    ? 'bg-[var(--blue)] text-white'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                }`
                              }
                            >
                              <Users className="w-4 h-4" />
                              Employees
                            </NavLink>
                            <NavLink
                              to={`/workspaces/${ws.id}/pos/loyalty`}
                              className={({ isActive }) =>
                                `flex items-center gap-2.5 pl-8 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                  isActive
                                    ? 'bg-[var(--blue)] text-white'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                }`
                              }
                            >
                              <Heart className="w-4 h-4" />
                              Loyalty
                            </NavLink>
                            <NavLink
                              to={`/workspaces/${ws.id}/pos/analytics`}
                              className={({ isActive }) =>
                                `flex items-center gap-2.5 pl-8 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                  isActive
                                    ? 'bg-[var(--blue)] text-white'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                }`
                              }
                            >
                              <BarChart2 className="w-4 h-4" />
                              Analytics
                            </NavLink>
                            <NavLink
                              to={`/workspaces/${ws.id}/pos/menu`}
                              className={({ isActive }) =>
                                `flex items-center gap-2.5 pl-8 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                  isActive
                                    ? 'bg-[var(--blue)] text-white'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                }`
                              }
                            >
                              <UtensilsCrossed className="w-4 h-4" />
                              Menu Builder
                            </NavLink>
                            <NavLink
                              to={`/workspaces/${ws.id}/pos/menu-boards`}
                              className={({ isActive }) =>
                                `flex items-center gap-2.5 pl-8 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                  isActive
                                    ? 'bg-[var(--blue)] text-white'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                }`
                              }
                            >
                              <Menu className="w-4 h-4" />
                              Menu Boards
                            </NavLink>
                            <NavLink
                              to={`/workspaces/${ws.id}/pos/media`}
                              className={({ isActive }) =>
                                `flex items-center gap-2.5 pl-8 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                  isActive
                                    ? 'bg-[var(--blue)] text-white'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                }`
                              }
                            >
                              <ImageIcon className="w-4 h-4" />
                              Media Library
                            </NavLink>
                            <NavLink
                              to={`/workspaces/${ws.id}/pos/expenses`}
                              className={({ isActive }) =>
                                `flex items-center gap-2.5 pl-8 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                  isActive
                                    ? 'bg-[var(--blue)] text-white'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                }`
                              }
                            >
                              <DollarSign className="w-4 h-4" />
                              Expenses
                            </NavLink>
                            <NavLink
                              to={`/workspaces/${ws.id}/pos/purchase-orders`}
                              className={({ isActive }) =>
                                `flex items-center gap-2.5 pl-8 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                  isActive
                                    ? 'bg-[var(--blue)] text-white'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                }`
                              }
                            >
                              <FileText className="w-4 h-4" />
                              Purchase Orders
                            </NavLink>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </nav>

        {/* Bottom: user + logout */}
        <div className="ui-mobile-drawer-footer border-t border-[var(--border)] p-3 space-y-1">
          <NavLink
            to="/settings"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
          >
            <Shield className="w-3.5 h-3.5" />
            Settings
          </NavLink>
          <div className="flex items-center gap-2 px-3 py-1.5">
            <div className="w-6 h-6 rounded-full bg-[var(--blue)] flex items-center justify-center text-white text-xs font-bold shrink-0">
              {user?.name?.[0]?.toUpperCase() ?? 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[var(--text)] truncate">{user?.name}</p>
              <p className="text-[10px] text-[var(--text-muted)] truncate capitalize">{user?.orgRole}</p>
            </div>
            <button
              onClick={handleLogout}
              className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              title="Logout"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* ---------- Main content ---------- */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-12 shrink-0 flex items-center justify-between gap-3 px-3 sm:px-6 border-b border-[var(--border)] bg-[var(--card)]">
          <div className="flex items-center gap-2 text-[var(--text-muted)] text-xs">
            <button
              onClick={() => setSidebarOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)] lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="w-4 h-4" />
            </button>
            {currentWs && (
              <>
                <button
                  onClick={() => navigate('/dashboard')}
                  className="flex items-center gap-1 hover:text-[var(--text)] transition-colors text-sm font-medium"
                >
                  <ChevronDown className="w-4 h-4 rotate-90" />
                  <span>{currentWs.name}</span>
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Search button (only shown when in a workspace) */}
            {currentWsId && (
              <button
                onClick={() => setSearchOpen(true)}
                className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs text-[var(--text-muted)] border transition-colors hover:text-[var(--text)] hover:bg-[var(--surface)]"
                style={{ borderColor: 'var(--card-border)' }}
                title="Search (Ctrl+K)"
              >
                <Search className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Search</span>
                <kbd className="hidden sm:inline ml-1 text-[10px] bg-white/10 px-1 rounded font-mono">⌘K</kbd>
              </button>
            )}
            {/* Theme toggle */}
            <div className="flex items-center rounded-lg overflow-hidden border" style={{ borderColor: 'var(--card-border)' }}>
              <button
                onClick={() => setTheme('brand')}
                title="Dark"
                className={`p-1.5 transition-colors ${theme === 'brand' ? 'bg-[var(--blue)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
              >
                <Moon className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setTheme('brand-light')}
                title="Light"
                className={`p-1.5 transition-colors ${theme === 'brand-light' ? 'bg-[var(--blue)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
              >
                <Sun className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setTheme('cyberpunk')}
                title="Cyberpunk"
                className={`p-1.5 transition-colors ${theme === 'cyberpunk' ? 'bg-[var(--blue)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
              >
                <Zap className="w-3.5 h-3.5" />
              </button>
            </div>
            <NotificationTray />
            {/* Weather chip */}
            {weather && weather.temp !== null && (
              <div
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border"
                style={{ borderColor: 'var(--card-border)', color: 'var(--text-muted)' }}
                title={weather.label}
              >
                <span className="text-sm leading-none">{weather.icon}</span>
                <span className="tabular-nums font-medium text-[var(--text)]">{Math.round(weather.temp)}{weather.unit}</span>
              </div>
            )}
            <button
              onClick={() => navigate('/settings')}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
              title="Settings"
            >
              <User className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Emergency active banner */}
        {activeOverrides.length > 0 && (
          <div className="bg-red-600 text-white px-6 py-2 flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="font-semibold">Emergency Override Active</span>
              {activeOverrides[0]?.contentText && (
                <span className="opacity-90">— {activeOverrides[0].contentText}</span>
              )}
            </div>
            {canManageEmergency && (
              <button
                onClick={() => clearOverride.mutate(activeOverrides[0]!.id)}
                className="flex items-center gap-1 underline underline-offset-2 hover:no-underline text-xs"
              >
                <X className="w-3.5 h-3.5" />
                Clear
              </button>
            )}
          </div>
        )}

        {/* Impersonation banner */}
        {isImpersonating && (
          <div className="bg-amber-500 text-amber-950 px-6 py-2 flex items-center justify-between text-sm font-medium">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 shrink-0" />
              <span>Impersonation session — you are acting as <strong>{user?.email}</strong></span>
            </div>
            <button
              onClick={() => { clearAuth(); navigate('/superadmin/orgs'); }}
              className="flex items-center gap-1 underline underline-offset-2 hover:no-underline text-xs"
            >
              <X className="w-3.5 h-3.5" />
              End session
            </button>
          </div>
        )}

        {/* Page content */}
        <main id="main-content" className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      {/* ---------- Search modal ---------- */}
      {searchOpen && currentWsId && (
        <SearchModal
          workspaceId={currentWsId}
          wsId={currentWsId}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {/* ---------- AI Assistant (workspace-scoped) ---------- */}
      {currentWsId && <AiAssistant workspaceId={currentWsId} />}

      {/* ---------- Emergency override modal ---------- */}
      {emergencyOpen && (
        <Modal onClose={() => setEmergencyOpen(false)} size="sm">
          <ModalHeader
            title="Emergency Override"
            subtitle="Interrupts all device playback immediately"
            icon={<div className="w-10 h-10 rounded-full bg-red-600/20 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-red-500" /></div>}
            onClose={() => setEmergencyOpen(false)}
          />

          <ModalBody className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                  Scope
                </label>
                <select
                  value={emergencyScope}
                  onChange={(e) => setEmergencyScope(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm focus:outline-none focus:border-[var(--blue)]"
                >
                  <option value="org">Entire Organization</option>
                  {workspaces.map((ws) => (
                    <option key={ws.id} value="workspace" data-id={ws.id}>
                      Workspace: {ws.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                  Message
                </label>
                <textarea
                  value={emergencyMsg}
                  onChange={(e) => setEmergencyMsg(e.target.value)}
                  rows={3}
                  placeholder="Emergency message shown on all displays…"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm resize-none focus:outline-none focus:border-[var(--blue)]"
                />
              </div>
          </ModalBody>

          <ModalFooter className="modal-footer-plain">
              <ModalSecondaryButton
                onClick={() => setEmergencyOpen(false)}
                className="flex-1"
              >
                Cancel
              </ModalSecondaryButton>
              <ModalPrimaryButton
                onClick={() => {
                  if (!emergencyMsg.trim()) return toast.error('Message is required');
                  activateEmergency.mutate({ contentText: emergencyMsg.trim(), scope: emergencyScope });
                }}
                disabled={activateEmergency.isPending}
                className="flex-1 !bg-red-600 hover:!opacity-100"
              >
                {activateEmergency.isPending ? 'Activating…' : 'Activate Override'}
              </ModalPrimaryButton>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
