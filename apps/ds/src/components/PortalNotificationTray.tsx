import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { AlertTriangle, Bell, HardDrive, TrendingDown, X } from 'lucide-react';
import { toast } from 'sonner';
import { saApi } from '../lib/superadmin-auth.js';
import type { PlatformAdminNotificationResponse } from '../lib/portal-analytics.js';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  analytics_storage_growth: <HardDrive size={13} className="text-amber-400" />,
  analytics_device_drop: <AlertTriangle size={13} className="text-[var(--danger)]" />,
  analytics_play_anomaly: <TrendingDown size={13} className="text-[var(--blue)]" />,
};

function timeAgo(d: string) {
  const seconds = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function PortalNotificationTray({ analyticsPath }: { analyticsPath: string }) {
  const [open, setOpen] = useState(false);
  const trayRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) return;
    function handler(event: MouseEvent) {
      if (trayRef.current && !trayRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const { data } = useQuery<PlatformAdminNotificationResponse>({
    queryKey: ['portal-notifications-tray'],
    queryFn: () => saApi.get('/superadmin/notifications?page=1&limit=10'),
    refetchInterval: open ? 15_000 : 30_000,
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['portal-notifications-tray'] });
  }

  const markRead = useMutation({
    mutationFn: (id: string) => saApi.patch(`/superadmin/notifications/${id}/read`),
    onSuccess: invalidate,
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => saApi.delete(`/superadmin/notifications/${id}`),
    onSuccess: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: () => saApi.post('/superadmin/notifications/mark-all-read'),
    onSuccess: () => {
      toast.success('All analytics notifications marked as read');
      invalidate();
    },
  });

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  return (
    <div className="relative" ref={trayRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)]"
        title="Analytics notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--blue)] px-1 text-[9px] font-bold leading-none text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="absolute right-0 top-10 z-50 w-80 overflow-hidden rounded-2xl border shadow-2xl sm:w-[360px]"
          style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2">
              <Bell size={14} className="text-[var(--text-muted)]" />
              <span className="text-sm font-semibold text-[var(--text)]">Analytics Alerts</span>
              {unreadCount > 0 ? (
                <span className="rounded-full bg-[var(--blue)] px-1.5 py-0.5 text-[9px] font-bold leading-none text-white">{unreadCount}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={() => markAllRead.mutate()}
                  disabled={markAllRead.isPending}
                  className="px-1 text-[10px] text-[var(--blue)] hover:underline disabled:opacity-50"
                >
                  Mark all read
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
              >
                <X size={12} />
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-[var(--text-muted)]">
                <Bell size={24} className="opacity-20" />
                <p className="text-sm">No analytics alerts yet</p>
              </div>
            ) : notifications.map((notification) => (
              <div
                key={notification.id}
                className={`group flex cursor-pointer gap-3 border-b px-4 py-3 transition-colors hover:bg-[var(--surface)] ${notification.readAt ? '' : 'bg-[var(--blue)]/5'}`}
                style={{ borderColor: 'var(--border)' }}
                onClick={() => { if (!notification.readAt) markRead.mutate(notification.id); }}
              >
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--surface)' }}>
                  {TYPE_ICONS[notification.type] ?? <Bell size={13} className="text-[var(--text-muted)]" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-1.5">
                    <p className={`flex-1 text-xs leading-tight text-[var(--text)] ${notification.readAt ? '' : 'font-semibold'}`}>
                      {notification.title}
                    </p>
                    {notification.readAt ? null : <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--blue)]" />}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--text-muted)]">{notification.body}</p>
                  <p className="mt-1 text-[10px] text-[var(--text-muted)] opacity-60">{timeAgo(notification.createdAt)}</p>
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    dismiss.mutate(notification.id);
                  }}
                  className="mt-0.5 shrink-0 text-[var(--text-muted)] opacity-0 transition-all hover:text-[var(--danger)] group-hover:opacity-100"
                  title="Dismiss"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>

          <div className="border-t px-4 py-2.5 text-center" style={{ borderColor: 'var(--border)' }}>
            <button
              type="button"
              onClick={() => {
                navigate(analyticsPath);
                setOpen(false);
              }}
              className="text-xs font-medium text-[var(--blue)] hover:underline"
            >
              Open analytics workspace
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}