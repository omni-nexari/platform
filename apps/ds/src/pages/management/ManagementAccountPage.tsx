import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, User } from 'lucide-react';
import { saApi, useSAStore } from '../../lib/superadmin-auth.js';
import { PageHeader, SectionCard, SectionCardBody, SectionCardHeader } from '../../components/UiPrimitives.js';

function ChangePasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const mut = useMutation({
    mutationFn: () =>
      saApi.post('/superadmin/auth/change-password', {
        currentPassword: current,
        newPassword: next,
      }),
    onSuccess: () => {
      toast.success('Password changed');
      setCurrent(''); setNext(''); setConfirm('');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to change password'),
  });

  const canSubmit = current.length > 0 && next.length >= 8 && next === confirm;

  return (
    <SectionCard>
      <SectionCardHeader>
        <div className="flex items-center gap-2">
          <KeyRound size={16} className="text-[var(--text-muted)]" />
          <h2 className="text-base font-semibold">Change Password</h2>
        </div>
      </SectionCardHeader>
      <SectionCardBody>
        <div className="space-y-3 max-w-sm">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Current password</label>
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="input w-full"
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">New password</label>
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="input w-full"
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Confirm new password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="input w-full"
              placeholder="••••••••"
            />
            {confirm && next !== confirm && (
              <p className="text-xs text-[var(--danger)] mt-1">Passwords do not match</p>
            )}
          </div>
          <button
            onClick={() => mut.mutate()}
            disabled={!canSubmit || mut.isPending}
            className="btn-primary mt-1"
          >
            {mut.isPending ? 'Saving…' : 'Update Password'}
          </button>
        </div>
      </SectionCardBody>
    </SectionCard>
  );
}

export default function ManagementAccountPage() {
  const user = useSAStore((s) => s.user);

  return (
    <div>
      <PageHeader title="My Account" subtitle="Manage your profile and password" />

      <SectionCard>
        <SectionCardHeader>
          <div className="flex items-center gap-2">
            <User size={16} className="text-[var(--text-muted)]" />
            <h2 className="text-base font-semibold">Profile</h2>
          </div>
        </SectionCardHeader>
        <SectionCardBody>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--text-muted)]">Name</dt>
              <dd className="font-medium">{user?.name ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--text-muted)]">Email</dt>
              <dd className="font-medium">{user?.email ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--text-muted)]">Role</dt>
              <dd className="font-medium capitalize">{user?.role ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--text-muted)]">Company</dt>
              <dd className="font-medium">{user?.companyName ?? '—'}</dd>
            </div>
          </dl>
        </SectionCardBody>
      </SectionCard>

      <div className="mt-6">
        <ChangePasswordSection />
      </div>
    </div>
  );
}
