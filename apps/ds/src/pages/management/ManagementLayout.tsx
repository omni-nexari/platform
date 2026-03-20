import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Building2, BarChart2, Bell, LogOut, LayoutDashboard, Palette, Menu, X } from 'lucide-react';
import { useSAStore } from '../../lib/superadmin-auth.js';
import {
  applyManagementBrandingDocument,
  getManagementBrandingStyle,
} from '../../lib/management-branding.js';
import PortalNotificationTray from '../../components/PortalNotificationTray.js';

const NAV = [
  { to: '/management', icon: LayoutDashboard, label: 'Dashboard', end: true as const },
  { to: '/management/orgs', icon: Building2, label: 'Client Organisations', end: false as const },
  { to: '/management/analytics', icon: BarChart2, label: 'Analytics', end: false as const },
  { to: '/management/notifications', icon: Bell, label: 'Notifications', end: false as const },
  { to: '/management/settings/branding', icon: Palette, label: 'Branding', end: false as const },
];

export default function ManagementLayout() {
  const { user, clearAuth } = useSAStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    return applyManagementBrandingDocument(user ?? undefined);
  }, [user]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const handleLogout = () => {
    const slug = user?.companySlug;
    clearAuth();
    navigate(slug ? `/m/${slug}/login` : '/management/login');
  };

  return (
    <div className="management-portal flex min-h-dvh overflow-hidden" style={getManagementBrandingStyle(user)}>
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        />
      ) : null}

      {/* Sidebar */}
      <aside
        className={`ui-mobile-drawer fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r transition-transform duration-200 lg:static lg:z-auto lg:w-60 lg:max-w-none lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ background: 'var(--management-sidebar-bg, var(--bg2))', borderColor: 'var(--card-border)' }}
      >
        {/* Logo / brand */}
        <div
          className="flex items-center gap-2 px-5 py-5 border-b"
          style={{ borderColor: 'var(--card-border)' }}
        >
          <img
            src={user?.companyLogoUrl ?? '/logo/nexari.png'}
            alt={user?.companyName ?? 'OmniHub'}
            className="h-7 object-contain flex-shrink-0"
          />
          <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider truncate">
            {user?.companyName && !user.companyName.startsWith('(pending')
              ? user.companyName
              : 'Management Co.'}
          </span>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-white/5 hover:text-[var(--text)] lg:hidden"
          >
            <X size={16} />
          </button>
        </div>

        {/* Nav */}
        <nav className="ui-mobile-drawer-nav flex-1 overflow-y-auto p-3 space-y-1">
          {NAV.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[var(--blue)] text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-white/5'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User / logout */}
        <div className="ui-mobile-drawer-footer border-t p-3" style={{ borderColor: 'var(--card-border)' }}>
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-[var(--blue)] flex items-center justify-center text-white text-xs font-bold">
              {user?.email?.[0]?.toUpperCase() ?? 'M'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{user?.name ?? user?.email}</p>
              <p className="text-xs text-[var(--text-muted)] truncate">{user?.email}</p>
            </div>
            <PortalNotificationTray notificationsPath="/management/notifications" />
            <button
              onClick={handleLogout}
              className="text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
              title="Sign out"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-3 sm:px-6 lg:hidden" style={{ borderColor: 'var(--card-border)', background: 'var(--management-sidebar-bg, var(--bg2))' }}>
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-white/5 hover:text-[var(--text)]"
              aria-label="Open navigation"
            >
              <Menu size={16} />
            </button>
            <span className="truncate text-sm font-medium text-[var(--text)]">
              {user?.companyName && !user.companyName.startsWith('(pending') ? user.companyName : 'Management Co.'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <PortalNotificationTray notificationsPath="/management/notifications" />
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
