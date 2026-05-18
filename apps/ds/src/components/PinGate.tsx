import { useState, useEffect } from 'react';
import { buildApiUrl, setDisplayToken } from '../lib/api.js';

interface PinGateProps {
  wsId: string;
  /** 'waiter' — verifies PIN and obtains a display JWT for API calls.
   *  'display' — verifies PIN and marks the session unlocked (no JWT needed). */
  mode: 'waiter' | 'display';
  children: React.ReactNode;
}

const STORAGE_KEY_WAITER  = (wsId: string) => `pos_waiter_token_${wsId}`;
const STORAGE_KEY_DISPLAY = (wsId: string) => `pos_display_unlocked_${wsId}`;

/**
 * Full-screen PIN gate that protects POS display screens.
 *
 * - If the workspace has no PIN configured, the gate is transparent (auto-unlocks).
 * - On unlock, the waiter mode stores a 24-h JWT and injects it into the api client.
 */
export default function PinGate({ wsId, mode, children }: PinGateProps) {
  const [unlocked, setUnlocked] = useState(() => {
    if (mode === 'waiter') {
      return Boolean(sessionStorage.getItem(STORAGE_KEY_WAITER(wsId)));
    }
    return sessionStorage.getItem(STORAGE_KEY_DISPLAY(wsId)) === '1';
  });

  // On mount: restore display token if already unlocked
  useEffect(() => {
    if (mode === 'waiter' && unlocked) {
      const stored = sessionStorage.getItem(STORAGE_KEY_WAITER(wsId));
      if (stored) setDisplayToken(stored);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check if PIN is required; if not, auto-unlock
  useEffect(() => {
    if (unlocked) return;
    void (async () => {
      try {
        const res = await fetch(buildApiUrl(`/pos/display/pin-status?workspaceId=${wsId}`));
        const data = (await res.json()) as { required: boolean };
        if (!data.required) {
          await doVerify('');
        } else {
          setPinRequired(true);
        }
      } catch {
        // If the check fails, show PIN entry as fallback
        setPinRequired(true);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId]);

  const [pinRequired, setPinRequired] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function doVerify(value: string) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(buildApiUrl('/pos/display/verify-pin'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: wsId, pin: value }),
      });
      const data = (await res.json()) as { valid: boolean; token?: string };
      if (data.valid) {
        if (mode === 'waiter' && data.token) {
          sessionStorage.setItem(STORAGE_KEY_WAITER(wsId), data.token);
          setDisplayToken(data.token);
        } else if (mode === 'display') {
          sessionStorage.setItem(STORAGE_KEY_DISPLAY(wsId), '1');
        }
        setUnlocked(true);
      } else {
        setPinRequired(true);
        setError('Incorrect PIN. Please try again.');
      }
    } catch {
      setPinRequired(true);
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (unlocked) return <>{children}</>;

  // Still checking pin-status
  if (!pinRequired) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/90 z-50">
      <div className="w-full max-w-xs rounded-2xl bg-[var(--surface,#1a1a1a)] p-8 shadow-2xl border border-[var(--border,#333)] space-y-6">
        <div className="text-center space-y-1">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent,#6366f1)]/15">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-[var(--accent,#6366f1)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-[var(--text,#fff)]">Enter Display PIN</h2>
          <p className="text-xs text-[var(--text-muted,#888)]">This screen is PIN-protected</p>
        </div>

        {/* PIN dots display */}
        <div className="flex justify-center gap-3">
          {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
            <div
              key={i}
              className={`h-3 w-3 rounded-full border-2 transition-colors ${
                i < pin.length
                  ? 'border-[var(--accent,#6366f1)] bg-[var(--accent,#6366f1)]'
                  : 'border-[var(--border,#555)] bg-transparent'
              }`}
            />
          ))}
        </div>

        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={8}
          value={pin}
          autoFocus
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, ''));
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && pin.length >= 4) void doVerify(pin);
          }}
          className="w-full rounded-xl border border-[var(--border,#444)] bg-[var(--bg,#111)] px-4 py-3 text-center text-lg tracking-[0.5em] text-[var(--text,#fff)] outline-none focus:border-[var(--accent,#6366f1)]"
          placeholder="••••"
        />

        {error && (
          <p className="text-center text-xs text-red-400">{error}</p>
        )}

        <button
          className="w-full rounded-xl bg-[var(--accent,#6366f1)] py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          disabled={loading || pin.length < 4}
          onClick={() => void doVerify(pin)}
        >
          {loading ? 'Verifying…' : 'Unlock'}
        </button>
      </div>
    </div>
  );
}
