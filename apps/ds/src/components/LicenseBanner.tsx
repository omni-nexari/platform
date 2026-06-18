/**
 * LicenseBanner — overlays or banners shown when the platform license is not
 * in an 'ok' state.
 *
 * Revoked / expired-trial:  full-screen blocking overlay (no dismiss)
 * Grace / overlimit:        dismissible warning banner at top of layout
 * Trial (active):           dismissible info banner at top of layout
 *
 * This component is rendered inside AppLayout so it appears for every
 * authenticated screen.  It fetches /license/status on mount and refreshes
 * every 5 minutes.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '../lib/api.js';
import { AlertTriangle, X, ShieldOff, Clock } from 'lucide-react';

interface LicenseStatus {
  configured: boolean;
  status: 'ok' | 'trial' | 'grace' | 'overlimit' | 'suspended' | 'revoked';
  planType?: string | null;
  source?: string;
  expiresAt?: string | null;
  trial?: { maxScreens: number; days: number; expiresAt: string | null };
}

function getRemainingDays(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export default function LicenseBanner() {
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();

  const { data: license } = useQuery<LicenseStatus>({
    queryKey: ['license-status'],
    queryFn: () => api.get<LicenseStatus>('/license/status'),
    // Refresh every 5 minutes; stale after 4 minutes
    staleTime: 4 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    // Don't retry aggressively on failure — the server-side gate handles it
    retry: 1,
  });

  if (!license) return null;

  const { status, trial, expiresAt } = license;

  // ── Blocking overlays (non-dismissible) ──────────────────────────────────

  if (status === 'revoked') {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="max-w-md w-full mx-4 rounded-xl bg-[var(--card)] border border-[var(--red)] p-8 text-center space-y-4 shadow-2xl">
          <ShieldOff className="w-12 h-12 text-[var(--red)] mx-auto" />
          <h2 className="text-xl font-bold text-[var(--text)]">License Revoked</h2>
          <p className="text-[var(--muted)] text-sm">
            This instance license has been revoked. Access to all features has been
            suspended. Please contact your provider to restore access.
          </p>
          <button
            type="button"
            onClick={() => void navigate('/management/license')}
            className="mt-2 px-4 py-2 rounded-lg bg-[var(--blue)] text-white text-sm font-medium hover:opacity-90"
          >
            View License
          </button>
        </div>
      </div>
    );
  }

  if (status === 'suspended' && license.source === 'trial') {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="max-w-md w-full mx-4 rounded-xl bg-[var(--card)] border border-[var(--yellow)] p-8 text-center space-y-4 shadow-2xl">
          <Clock className="w-12 h-12 text-[var(--yellow)] mx-auto" />
          <h2 className="text-xl font-bold text-[var(--text)]">Trial Expired</h2>
          <p className="text-[var(--muted)] text-sm">
            Your 60-day free trial has ended. Activate your license to continue
            using Nexari.
          </p>
          <button
            type="button"
            onClick={() => void navigate('/management/license')}
            className="mt-2 px-4 py-2 rounded-lg bg-[var(--blue)] text-white text-sm font-medium hover:opacity-90"
          >
            Activate License
          </button>
        </div>
      </div>
    );
  }

  // ── Dismissible banners ────────────────────────────────────────────────────

  if (dismissed) return null;

  if (status === 'trial') {
    const daysLeft = getRemainingDays(trial?.expiresAt ?? expiresAt);
    const maxScreens = trial?.maxScreens ?? 3;
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-[var(--blue)]/10 border-b border-[var(--blue)]/30 text-sm text-[var(--blue)]">
        <Clock className="w-4 h-4 shrink-0" />
        <span className="flex-1">
          <strong>Trial mode</strong> — up to {maxScreens} screens, signage features only.
          {daysLeft !== null && daysLeft > 0
            ? ` ${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining.`
            : null}
          {' '}
          <button
            type="button"
            onClick={() => void navigate('/management/license')}
            className="underline font-medium"
          >
            Activate your license
          </button>
        </span>
        <button type="button" aria-label="Dismiss" onClick={() => setDismissed(true)}>
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  if (status === 'grace') {
    const daysLeft = getRemainingDays(expiresAt);
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-yellow-500/10 border-b border-yellow-500/30 text-sm text-yellow-700 dark:text-yellow-400">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span className="flex-1">
          <strong>License in grace period</strong>
          {daysLeft !== null ? ` — ${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining` : ''}.
          Renew now to avoid service interruption.{' '}
          <button
            type="button"
            onClick={() => void navigate('/management/license')}
            className="underline font-medium"
          >
            View license
          </button>
        </span>
        <button type="button" aria-label="Dismiss" onClick={() => setDismissed(true)}>
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  if (status === 'overlimit') {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-red-500/10 border-b border-red-500/30 text-sm text-red-700 dark:text-red-400">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span className="flex-1">
          <strong>Screen limit exceeded</strong> — some screens may have been deactivated.
          {' '}
          <button
            type="button"
            onClick={() => void navigate('/management/license')}
            className="underline font-medium"
          >
            Upgrade your license
          </button>
        </span>
        <button type="button" aria-label="Dismiss" onClick={() => setDismissed(true)}>
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return null;
}
