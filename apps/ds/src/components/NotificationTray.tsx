import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import {
  Bell, X, Monitor, Image, AlertTriangle, HardDrive,
  Clock, Wifi, WifiOff, Zap, UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api.js';
import { useAuthStore } from '../lib/auth.js';

interface NotifItem {
  id: string;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  dismissed: boolean;
  createdAt: string;
}

interface NotifResponse {
  notifications: NotifItem[];
  total: number;
  unreadCount: number;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  device_offline:       <WifiOff size={13} className="text-[var(--danger)]" />,
  device_online:        <Wifi size={13} className="text-[var(--success,#10b981)]" />,
  content_failed:       <Image size={13} className="text-[var(--danger)]" />,
  storage_warning:      <HardDrive size={13} className="text-amber-400" />,
  content_expiring:     <Clock size={13} className="text-amber-400" />,
  emergency_activated:  <AlertTriangle size={13} className="text-[var(--danger)]" />,
  sensor_rule_fired:    <Zap size={13} className="text-[var(--blue)]" />,
  invitation_accepted:  <UserCheck size={13} className="text-[var(--blue)]" />,
  monitor:              <Monitor size={13} className="text-[var(--text-muted)]" />,
};

function timeAgo(d: string) {
  const seconds = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (seconds < 60)  return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function NotificationTray() {
  const [open, setOpen] = useState(false);
  const trayRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, bootstrapped } = useAuthStore();

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (trayRef.current && !trayRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const { data } = useQuery<NotifResponse>({
    queryKey: ['notifications-tray'],
    queryFn: () => api.get('/notifications?page=1&limit=10'),
    enabled: bootstrapped && !!user,
    refetchInterval: (query) => (query.state.status === 'error' ? false : open ? 15_000 : 30_000),
    retry: false,
  });

  const unreadCount = data?.unreadCount ?? 0;
  const notifications = data?.notifications ?? [];

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['notifications-tray'] });
  }

  const markRead = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: invalidate,
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/${id}`),
    onSuccess: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: () => api.post('/notifications/mark-all-read'),
    onSuccess: () => {
      toast.success('All notifications marked as read');
      invalidate();
    },
  });

  return (
    <div className="relative" ref={trayRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
        title="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-[var(--blue)] text-white text-[9px] font-bold flex items-center justify-center px-1 leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown tray */}
      {open && (
        <div
          className="absolute right-0 top-10 z-50 w-80 sm:w-[360px] rounded-2xl border shadow-2xl overflow-hidden"
          style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 border-b"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="flex items-center gap-2">
              <Bell size={14} className="text-[var(--text-muted)]" />
              <span className="text-sm font-semibold text-[var(--text)]">Notifications</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-[var(--blue)] text-white text-[9px] font-bold leading-none">
                  {unreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllRead.mutate()}
                  disabled={markAllRead.isPending}
                  className="text-[10px] text-[var(--blue)] hover:underline px-1 disabled:opacity-50"
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <div className="overflow-y-auto max-h-96">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-[var(--text-muted)]">
                <Bell size={24} className="opacity-20" />
                <p className="text-sm">You're all caught up</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`flex gap-3 px-4 py-3 border-b last:border-b-0 group hover:bg-[var(--surface)] transition-colors cursor-pointer ${
                    !n.readAt ? 'bg-[var(--blue)]/5' : ''
                  }`}
                  style={{ borderColor: 'var(--border)' }}
                  onClick={() => { if (!n.readAt) markRead.mutate(n.id); }}
                >
                  {/* Type icon */}
                  <div
                    className="shrink-0 mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{ background: 'var(--surface)' }}
                  >
                    {TYPE_ICONS[n.type] ?? <Bell size={13} className="text-[var(--text-muted)]" />}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-1.5">
                      <p className={`text-xs leading-tight text-[var(--text)] flex-1 ${!n.readAt ? 'font-semibold' : ''}`}>
                        {n.title}
                      </p>
                      {!n.readAt && (
                        <div className="w-1.5 h-1.5 rounded-full bg-[var(--blue)] shrink-0 mt-1" />
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5 line-clamp-2">{n.body}</p>
                    <p className="text-[10px] text-[var(--text-muted)] mt-1 opacity-60">{timeAgo(n.createdAt)}</p>
                  </div>

                  {/* Dismiss */}
                  <button
                    onClick={(e) => { e.stopPropagation(); dismiss.mutate(n.id); }}
                    className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--danger)] transition-all"
                    title="Dismiss"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t text-center" style={{ borderColor: 'var(--border)' }}>
            <button
              onClick={() => { navigate('/settings?section=notifications'); setOpen(false); }}
              className="text-xs text-[var(--blue)] hover:underline font-medium"
            >
              View all &amp; manage preferences
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
