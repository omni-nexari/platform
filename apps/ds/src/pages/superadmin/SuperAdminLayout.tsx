import { NavLink, Outlet, useNavigate } from 'react-router';
import { Building2, BarChart2, Activity, Bell, LogOut, Layers, LayoutDashboard } from 'lucide-react';
import { useSAStore } from '../../lib/superadmin-auth.js';
import PortalNotificationTray from '../../components/PortalNotificationTray.js';

const NAV = [
  { to: '/superadmin', icon: LayoutDashboard, label: 'Dashboard', end: true as const },
  { to: '/superadmin/companies', icon: Layers, label: 'Resellers', end: false as const },
  { to: '/superadmin/orgs', icon: Building2, label: 'Client Organizations', end: false as const },
  { to: '/superadmin/system', icon: Activity, label: 'System Health', end: false as const },
  { to: '/superadmin/analytics', icon: BarChart2, label: 'Analytics', end: false as const },
  { to: '/superadmin/notifications', icon: Bell, label: 'Notifications', end: false as const },
];

export default function SuperAdminLayout() {
  const { user, clearAuth } = useSAStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    clearAuth();
    navigate('/superadmin/login');
  };

  const portalLabel = 'Platform Owner';

  return (
    <div className="flex min-h-dvh">
      {/* Sidebar */}
      <aside
        className="w-60 flex-shrink-0 flex flex-col border-r"
        style={{
          background: 'var(--bg2)',
          borderColor: 'var(--card-border)',
        }}
      >
        {/* Logo / brand */}
        <div className="flex items-center gap-2 px-5 py-5 border-b" style={{ borderColor: 'var(--card-border)' }}>
          <img src="/logo/nexari.png" alt="OmniHub" className="h-7" />
          <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            {portalLabel}
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
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
        <div className="p-3 border-t" style={{ borderColor: 'var(--card-border)' }}>
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-[var(--blue)] flex items-center justify-center text-white text-xs font-bold">
              {user?.email?.[0]?.toUpperCase() ?? 'S'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{user?.name ?? user?.email}</p>
              <p className="text-xs text-[var(--text-muted)] truncate">{user?.email}</p>
            </div>
            <PortalNotificationTray notificationsPath="/superadmin/notifications" />
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
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
