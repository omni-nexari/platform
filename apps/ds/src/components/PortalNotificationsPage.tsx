import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Filter, Inbox, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { saApi } from '../lib/superadmin-auth.js';
import type { PlatformAdminNotification, PlatformAdminNotificationResponse } from '../lib/portal-analytics.js';
import { formatPortalNotificationAge, getPortalNotificationIcon } from '../lib/portal-notifications.js';
import { Badge, EmptyState, FilterChip, PageHeader, Skeleton } from './UiPrimitives.js';

const PAGE_SIZE = 25;

function NotificationRow({
  notification,
  onMarkRead,
  onDismiss,
  pendingReadId,
  pendingDismissId,
}: {
  notification: PlatformAdminNotification;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  pendingReadId: string | null;
  pendingDismissId: string | null;
}) {
  return (
    <div
      className={`group flex gap-4 rounded-2xl border px-5 py-4 transition-colors ${notification.readAt ? '' : 'bg-[var(--blue)]/5'}`}
      style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}
    >
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--surface)' }}>
        {getPortalNotificationIcon(notification.type)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className={`truncate text-sm text-[var(--text)] ${notification.readAt ? 'font-medium' : 'font-semibold'}`}>
                {notification.title}
              </p>
              {!notification.readAt ? <Badge tone="accent">Unread</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{notification.body}</p>
          </div>
          <p className="whitespace-nowrap text-xs text-[var(--text-muted)]">{formatPortalNotificationAge(notification.createdAt)}</p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!notification.readAt ? (
            <button
              type="button"
              onClick={() => onMarkRead(notification.id)}
              disabled={pendingReadId === notification.id}
              className="workspace-page-action"
            >
              <CheckCheck size={14} />
              {pendingReadId === notification.id ? 'Marking...' : 'Mark read'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onDismiss(notification.id)}
            disabled={pendingDismissId === notification.id}
            className="workspace-page-action !text-[var(--danger)]"
          >
            <X size={14} />
            {pendingDismissId === notification.id ? 'Dismissing...' : 'Dismiss'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PortalNotificationsPage({
  title,
  subtitle,
  analyticsPath,
}: {
  title: string;
  subtitle: string;
  analyticsPath: string;
}) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const { data, isLoading, isFetching } = useQuery<PlatformAdminNotificationResponse>({
    queryKey: ['portal-notifications-page', page],
    queryFn: () => saApi.get(`/superadmin/notifications?page=${page}&limit=${PAGE_SIZE}`),
    placeholderData: (previousData) => previousData,
  });

  function invalidateNotifications() {
    void qc.invalidateQueries({ queryKey: ['portal-notifications-page'] });
    void qc.invalidateQueries({ queryKey: ['portal-notifications-tray'] });
  }

  const markRead = useMutation({
    mutationFn: (id: string) => saApi.patch(`/superadmin/notifications/${id}/read`),
    onSuccess: invalidateNotifications,
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to mark notification as read');
    },
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => saApi.delete(`/superadmin/notifications/${id}`),
    onSuccess: invalidateNotifications,
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to dismiss notification');
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => saApi.post('/superadmin/notifications/mark-all-read'),
    onSuccess: () => {
      toast.success('All analytics notifications marked as read');
      invalidateNotifications();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to mark notifications as read');
    },
  });

  const notifications = data?.notifications ?? [];
  const filteredNotifications = useMemo(
    () => filter === 'unread' ? notifications.filter((notification) => !notification.readAt) : notifications,
    [filter, notifications],
  );
  const total = data?.total ?? 0;
  const unreadCount = data?.unreadCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <PageHeader
        icon={<Inbox size={22} />}
        title={title}
        subtitle={subtitle}
        trailing={(
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{total.toLocaleString()} total</Badge>
            <Badge tone={unreadCount > 0 ? 'accent' : 'neutral'}>{unreadCount.toLocaleString()} unread</Badge>
            {isFetching && !isLoading ? <Badge tone="neutral">Refreshing…</Badge> : null}
          </div>
        )}
        action={(
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void qc.invalidateQueries({ queryKey: ['portal-notifications-page'] })} className="workspace-page-action">
              <RefreshCw size={14} />
              Refresh
            </button>
            <button type="button" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending || unreadCount === 0} className="workspace-page-action">
              <CheckCheck size={14} />
              {markAllRead.isPending ? 'Marking...' : 'Mark all read'}
            </button>
            <a href={analyticsPath} className="workspace-page-action">
              <Bell size={14} />
              Open analytics
            </a>
          </div>
        )}
      />

      <div className="rounded-2xl border p-4" style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            <Filter size={14} />
            Filter
          </span>
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All notifications</FilterChip>
          <FilterChip active={filter === 'unread'} onClick={() => setFilter('unread')}>Unread only</FilterChip>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : filteredNotifications.length === 0 ? (
        <EmptyState
          icon={<Bell size={24} />}
          title={filter === 'unread' ? 'No unread analytics notifications' : 'No analytics notifications yet'}
          description={filter === 'unread'
            ? 'Everything in the current page is already read or dismissed.'
            : 'Threshold-based analytics alerts will appear here for this portal as they are routed into the inbox.'}
        />
      ) : (
        <div className="space-y-4">
          {filteredNotifications.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              onMarkRead={(id) => markRead.mutate(id)}
              onDismiss={(id) => dismiss.mutate(id)}
              pendingReadId={markRead.isPending ? markRead.variables ?? null : null}
              pendingDismissId={dismiss.isPending ? dismiss.variables ?? null : null}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-4" style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}>
        <p className="text-sm text-[var(--text-muted)]">Page {page} of {totalPages}</p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1} className="workspace-page-action">
            Previous
          </button>
          <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages} className="workspace-page-action">
            Next
          </button>
        </div>
      </div>
    </div>
  );
}