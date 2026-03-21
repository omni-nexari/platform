import { Outlet, NavLink, useNavigate, useLocation } from 'react-router';
import { useAuthStore } from '../lib/auth.js';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, buildWebSocketUrl } from '../lib/api.js';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useTheme } from '../contexts/ThemeContext.js';
import SearchModal from './SearchModal.js';
import NotificationTray from './NotificationTray.js';
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalPrimaryButton,
  ModalSecondaryButton,
} from './UiPrimitives.js';
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
  Bug,
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
  const { user, clearAuth } = useAuthStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();

  const isImpersonating = Boolean(user?.impersonatedBy);

  // Detect current workspace from URL
  const wsMatch = pathname.match(/^\/workspaces\/([^/]+)/);
  const currentWsId = wsMatch?.[1] ?? null;

  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [emergencyMsg, setEmergencyMsg] = useState('');
  const [emergencyScope, setEmergencyScope] = useState('org');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
    if (!user) return;

    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (cancelled) return;
      socket = new WebSocket(buildWebSocketUrl('/notifications/ws'));

      socket.onopen = () => {
        if (!cancelled) return;
        socket?.close();
      };

      socket.onmessage = (event) => {
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
        if (cancelled) return;
        reconnectTimer = setTimeout(connect, 3000);
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
  }, [user, queryClient]);

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: () => api.get('/workspaces'),
  });

  const { data: activeOverrides = [] } = useQuery<EmergencyOverride[]>({
    queryKey: ['emergency'],
    queryFn: () => api.get('/emergency'),
    refetchInterval: 30_000,
  });

  const { data: currentWs } = useQuery<Workspace>({
    queryKey: ['workspace', currentWsId],
    queryFn: () => api.get(`/workspaces/${currentWsId}`),
    enabled: !!currentWsId,
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
          <span className="text-lg font-bold tracking-tight text-[var(--text)]">OmniHub</span>
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
            to="/tizen-test"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-[var(--blue)] text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
              }`
            }
          >
            <Bug className="w-4 h-4" />
            Tizen Test
          </NavLink>

          {/* Workspace-specific nav */}
          {currentWsId && (
            <>
              <div className="pt-2 pb-1 px-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] truncate">
                  {currentWs?.name ?? 'Workspace'}
                </p>
              </div>
              <NavLink
                to={`/workspaces/${currentWsId}`}
                end
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-[var(--blue)] text-white'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                  }`
                }
              >
                <Monitor className="w-4 h-4" />
                Devices
              </NavLink>
              <NavLink
                to={`/workspaces/${currentWsId}/content`}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-[var(--blue)] text-white'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                  }`
                }
              >
                <Image className="w-4 h-4" />
                Content
              </NavLink>
              <NavLink
                to={`/workspaces/${currentWsId}/playlist`}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
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
                to={`/workspaces/${currentWsId}/schedule`}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
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
                to={`/workspaces/${currentWsId}/canvas/new`}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
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
                to={`/workspaces/${currentWsId}/tags`}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
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
                to={`/workspaces/${currentWsId}/analytics`}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
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

          {/* Workspace picker */}
          {workspaces.length > 0 && !currentWsId && (
            <div className="pt-2">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Workspaces
              </p>
              {workspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => navigate(`/workspaces/${ws.id}`)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors text-left"
                >
                  <Monitor className="w-4 h-4" />
                  <span className="truncate">{ws.name}</span>
                </button>
              ))}
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
                  className="hover:text-[var(--text)] transition-colors"
                >
                  <ChevronDown className="w-3 h-3 rotate-90" />
                </button>
                <span className="font-medium text-[var(--text)]">{currentWs.name}</span>
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
        <main className="flex-1 overflow-y-auto">
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
