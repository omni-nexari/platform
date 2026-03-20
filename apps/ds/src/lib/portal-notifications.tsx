import type { ReactNode } from 'react';
import { AlertTriangle, Bell, HardDrive, TrendingDown } from 'lucide-react';

export function getPortalNotificationIcon(type: string): ReactNode {
  if (type === 'analytics_storage_growth') return <HardDrive size={13} className="text-amber-400" />;
  if (type === 'analytics_device_drop') return <AlertTriangle size={13} className="text-[var(--danger)]" />;
  if (type === 'analytics_play_anomaly') return <TrendingDown size={13} className="text-[var(--blue)]" />;
  return <Bell size={13} className="text-[var(--text-muted)]" />;
}

export function formatPortalNotificationAge(d: string) {
  const seconds = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}