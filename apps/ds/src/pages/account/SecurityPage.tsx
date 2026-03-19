import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldCheck, ShieldOff, Download, Copy } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuthStore } from '../../lib/auth.js';

interface TwoFASetupResponse {
  secret: string;
  qrDataUrl: string;
}

interface BackupCodesResponse {
  backupCodes: string[];
}

function CodeGrid({ codes }: { codes: string[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 my-3">
      {codes.map((c) => (
        <code
          key={c}
          className="px-3 py-2 rounded-lg text-sm font-mono text-center"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--aqua)' }}
        >
          {c}
        </code>
      ))}
    </div>
  );
}

export default function SecurityPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  // Two-factor app state
  const [step, setStep] = useState<'idle' | 'scan' | 'confirm' | 'codes'>('idle');
  const [setupData, setSetupData] = useState<TwoFASetupResponse | null>(null);
  const [totpInput, setTotpInput] = useState('');
  const [newCodes, setNewCodes] = useState<string[]>([]);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableTotp, setDisableTotp] = useState('');

  // Get current 2FA status from user object (fetched from auth token)
  // We'll need a /me endpoint eventually; for now derive from auth store
  // and use a local state to optimistically track enabled status
  const [is2FAEnabled, setIs2FAEnabled] = useState<boolean | null>(null);

  // Setup 2FA
  const setupMut = useMutation({
    mutationFn: () => api.post<TwoFASetupResponse>('/auth/2fa/setup'),
    onSuccess: (data) => {
      setSetupData(data);
      setStep('scan');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Setup failed'),
  });

  // Verify and enable
  const verifyMut = useMutation({
    mutationFn: () => api.post<BackupCodesResponse>('/auth/2fa/verify', { token: totpInput }),
    onSuccess: (data) => {
      setNewCodes(data.backupCodes);
      setIs2FAEnabled(true);
      setStep('codes');
      toast.success('Two-factor authentication enabled!');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Invalid code'),
  });

  // Disable 2FA
  const disableMut = useMutation({
    mutationFn: () =>
      api.post('/auth/2fa/disable', { password: disablePassword, token: disableTotp }),
    onSuccess: () => {
      setIs2FAEnabled(false);
      setDisablePassword('');
      setDisableTotp('');
      toast.success('Two-factor authentication disabled');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Disable failed'),
  });

  // Regenerate backup codes
  const regenMut = useMutation({
    mutationFn: () => api.get<BackupCodesResponse>('/auth/2fa/backup-codes'),
    onSuccess: (data) => {
      setNewCodes(data.backupCodes);
      toast.success('New backup codes generated');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed'),
  });

  function downloadCodes(codes: string[]) {
    const text = codes.join('\n');
    const a = document.createElement('a');
    a.href = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
    a.download = 'omnihub-backup-codes.txt';
    a.click();
  }

  return (
    <div className="min-h-dvh p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Account Security</h1>
      <p className="text-sm text-[var(--text-muted)] mb-8">Manage two-factor authentication for your account.</p>

      {/* 2FA Card */}
      <div
        className="rounded-2xl border p-6"
        style={{ borderColor: 'var(--card-border)', background: 'var(--card)' }}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            {is2FAEnabled ? (
              <ShieldCheck size={22} className="text-green-400" />
            ) : (
              <ShieldOff size={22} className="text-[var(--text-muted)]" />
            )}
            <div>
              <h2 className="font-semibold">Two-Factor Authentication</h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {is2FAEnabled === true
                  ? 'Enabled — your account is protected with TOTP.'
                  : is2FAEnabled === false
                    ? 'Disabled — your account uses only a password.'
                    : 'Add an extra layer of security to your account.'}
              </p>
            </div>
          </div>
        </div>

        {/* ── Setup flow ── */}
        {step === 'idle' && is2FAEnabled !== true && (
          <button
            onClick={() => setupMut.mutate()}
            disabled={setupMut.isPending}
            className="btn-primary"
          >
            {setupMut.isPending ? 'Setting up…' : 'Enable 2FA'}
          </button>
        )}

        {step === 'scan' && setupData && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--text-muted)]">
              Scan this QR code with your authenticator app (e.g. Google Authenticator, Authy).
            </p>
            <img
              src={setupData.qrDataUrl}
              alt="TOTP QR code"
              className="w-44 h-44 rounded-xl"
              style={{ imageRendering: 'pixelated' }}
            />
            <p className="text-xs text-[var(--text-muted)]">
              Or enter the secret manually:&nbsp;
              <code
                className="px-2 py-0.5 rounded font-mono text-[var(--aqua)]"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              >
                {setupData.secret}
              </code>
            </p>
            <div className="flex gap-3 items-center">
              <input
                value={totpInput}
                onChange={(e) => setTotpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6-digit code"
                className="input w-36 text-center font-mono tracking-widest text-lg"
                maxLength={6}
              />
              <button
                onClick={() => verifyMut.mutate()}
                disabled={totpInput.length !== 6 || verifyMut.isPending}
                className="btn-primary"
              >
                {verifyMut.isPending ? 'Verifying…' : 'Confirm'}
              </button>
              <button
                onClick={() => { setStep('idle'); setSetupData(null); setTotpInput(''); }}
                className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {step === 'codes' && newCodes.length > 0 && (
          <div className="space-y-4">
            <div
              className="rounded-xl p-4 border border-amber-500/30 bg-amber-500/8"
            >
              <p className="text-sm font-semibold text-amber-400 mb-2">Save your backup codes</p>
              <p className="text-xs text-[var(--text-muted)]">
                Store these in a safe place. Each code can only be used once if you lose access to your authenticator.
              </p>
            </div>
            <CodeGrid codes={newCodes} />
            <div className="flex gap-3">
              <button
                onClick={() => downloadCodes(newCodes)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-white/5 transition-colors"
                style={{ borderColor: 'var(--card-border)' }}
              >
                <Download size={14} /> Download
              </button>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(newCodes.join('\n'));
                  toast.success('Copied to clipboard');
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-white/5 transition-colors"
                style={{ borderColor: 'var(--card-border)' }}
              >
                <Copy size={14} /> Copy
              </button>
              <button onClick={() => setStep('idle')} className="btn-primary ml-auto">
                Done
              </button>
            </div>
          </div>
        )}

        {/* ── Enabled state ── */}
        {step === 'idle' && is2FAEnabled === true && (
          <div className="space-y-6">
            {/* Regenerate backup codes */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Backup Codes</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                Regenerate all 8 backup codes. Old codes will be invalidated immediately.
              </p>
              {newCodes.length > 0 ? (
                <>
                  <CodeGrid codes={newCodes} />
                  <div className="flex gap-3">
                    <button
                      onClick={() => downloadCodes(newCodes)}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-white/5 transition-colors"
                      style={{ borderColor: 'var(--card-border)' }}
                    >
                      <Download size={14} /> Download
                    </button>
                    <button
                      onClick={() => {
                        void navigator.clipboard.writeText(newCodes.join('\n'));
                        toast.success('Copied');
                      }}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-white/5 transition-colors"
                      style={{ borderColor: 'var(--card-border)' }}
                    >
                      <Copy size={14} /> Copy
                    </button>
                  </div>
                </>
              ) : (
                <button
                  onClick={() => regenMut.mutate()}
                  disabled={regenMut.isPending}
                  className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-white/5 transition-colors"
                  style={{ borderColor: 'var(--card-border)' }}
                >
                  {regenMut.isPending ? 'Regenerating…' : 'Regenerate Backup Codes'}
                </button>
              )}
            </div>

            {/* Disable 2FA */}
            <div className="border-t pt-6" style={{ borderColor: 'var(--card-border)' }}>
              <h3 className="text-sm font-semibold mb-2 text-[var(--danger)]">Disable 2FA</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                Enter your current password and an authenticator code to disable two-factor authentication.
              </p>
              <div className="space-y-3">
                <input
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  type="password"
                  placeholder="Current password"
                  className="input w-full"
                />
                <input
                  value={disableTotp}
                  onChange={(e) => setDisableTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit code"
                  className="input w-36 text-center font-mono tracking-widest text-lg"
                  maxLength={6}
                />
                <button
                  onClick={() => disableMut.mutate()}
                  disabled={!disablePassword || disableTotp.length !== 6 || disableMut.isPending}
                  className="px-4 py-2 rounded-lg text-sm font-semibold border border-[var(--danger)]/30 text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
                >
                  {disableMut.isPending ? 'Disabling…' : 'Disable 2FA'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
