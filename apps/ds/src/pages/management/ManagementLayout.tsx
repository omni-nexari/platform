import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { Building2, BarChart2, LogOut, LayoutDashboard, Palette } from 'lucide-react';
import { useSAStore } from '../../lib/superadmin-auth.js';
import {
  applyManagementBrandingDocument,
  getManagementBrandingStyle,
} from '../../lib/management-branding.js';

const NAV = [
  { to: '/management', icon: LayoutDashboard, label: 'Dashboard', end: true as const },
  { to: '/management/orgs', icon: Building2, label: 'Client Organisations', end: false as const },
  { to: '/management/analytics', icon: BarChart2, label: 'Analytics', end: false as const },
  { to: '/management/settings/branding', icon: Palette, label: 'Branding', end: false as const },
];

export default function ManagementLayout() {
  const { user, clearAuth } = useSAStore();
  const navigate = useNavigate();

  useEffect(() => {
    return applyManagementBrandingDocument(user ?? undefined);
  }, [user]);

  const handleLogout = () => {
    const slug = user?.companySlug;
    clearAuth();
    navigate(slug ? `/m/${slug}/login` : '/management/login');
  };

  return (
    <div className="management-portal flex min-h-dvh" style={getManagementBrandingStyle(user)}>
      {/* Sidebar */}
      <aside
        className="w-60 flex-shrink-0 flex flex-col border-r"
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
              {user?.email?.[0]?.toUpperCase() ?? 'M'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{user?.name ?? user?.email}</p>
              <p className="text-xs text-[var(--text-muted)] truncate">{user?.email}</p>
            </div>
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
