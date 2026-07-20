import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Clock, Trash2, Users } from 'lucide-react';
import { saApi, useSAStore } from '../../lib/superadmin-auth.js';
import {
  Badge,
  InlineActionButton,
  PageHeader,
  SectionCard,
  SectionCardBody,
  SectionCardHeader,
} from '../../components/UiPrimitives.js';

interface Admin {
  id: string;
  name: string | null;
  email: string;
  role: 'owner' | 'admin' | 'billing';
  lastLogin: string | null;
  createdAt: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  recipientName: string | null;
  expiresAt: string;
  createdAt: string;
}

interface AdminsResponse {
  admins: Admin[];
  pendingInvites: PendingInvite[];
}

const ROLE_TONES = {
  owner: 'success',
  admin: 'accent',
  billing: 'neutral',
} as const;

function roleLabel(role: string) {
  const map: Record<string, string> = { owner: 'Owner', admin: 'Admin', billing: 'Billing' };
  return map[role] ?? role;
}

export default function ManagementTeamPage() {
  const user = useSAStore((s) => s.user);
  const qc = useQueryClient();
  const mcId = user?.managementCompanyId ?? '';

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'owner' | 'billing'>('admin');

  const { data, isLoading } = useQuery({
    queryKey: ['management-team', mcId],
    queryFn: () => saApi.get<AdminsResponse>(`/superadmin/management-companies/${mcId}/admins`),
    enabled: !!mcId,
  });

  const inviteMut = useMutation({
    mutationFn: () =>
      saApi.post(`/superadmin/management-companies/${mcId}/admins`, {
        email: inviteEmail.trim(),
        name: inviteName.trim() || undefined,
        role: inviteRole,
      }),
    onSuccess: () => {
      toast.success(`Invitation sent to ${inviteEmail}`);
      setInviteEmail('');
      setInviteName('');
      setInviteRole('admin');
      void qc.invalidateQueries({ queryKey: ['management-team', mcId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to send invitation'),
  });

  const revokeInviteMut = useMutation({
    mutationFn: (inviteId: string) =>
      saApi.delete(`/superadmin/management-companies/${mcId}/invites/${inviteId}`),
    onSuccess: () => {
      toast.success('Invitation cancelled');
      void qc.invalidateQueries({ queryKey: ['management-team', mcId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to cancel invitation'),
  });

  const canInvite = /^[^@]+@[^@]+\.[^@]+$/.test(inviteEmail);

  return (
    <div>
      <PageHeader title="Team" subtitle="Invite and manage management portal admins for your company" />

      {/* Invite */}
      <SectionCard className="mb-6">
        <SectionCardHeader>
          <h2 className="text-base font-semibold">Invite team member</h2>
        </SectionCardHeader>
        <SectionCardBody>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Email address</label>
              <input
                type="email"
                className="input w-full"
                placeholder="admin@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Name (optional)</label>
              <input
                type="text"
                className="input w-full"
                placeholder="Full name"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Role</label>
              <select
                className="input w-full"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)}
              >
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
                <option value="billing">Billing</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={() => inviteMut.mutate()}
                disabled={!canInvite || inviteMut.isPending}
                className="btn-primary whitespace-nowrap w-full"
              >
                {inviteMut.isPending ? 'Sending…' : 'Send Invite'}
              </button>
            </div>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-3">
            <strong className="text-[var(--text)]">Owner</strong> — full access including team and branding.{' '}
            <strong className="text-[var(--text)]">Admin</strong> — manage client organizations and content.{' '}
            <strong className="text-[var(--text)]">Billing</strong> — view analytics and pricing only.
          </p>
        </SectionCardBody>
      </SectionCard>

      {/* Current admins */}
      <div className="ui-data-surface mb-6">
        <div className="ui-data-surface-header">
          <div className="ui-data-surface-title">
            <Users size={15} className="text-[var(--text-muted)]" />
            <h2>Team members {data ? `(${data.admins.length})` : ''}</h2>
          </div>
        </div>
        {isLoading ? (
          <p className="px-5 py-6 text-sm text-[var(--text-muted)]">Loading…</p>
        ) : !data?.admins.length ? (
          <p className="px-5 py-6 text-sm text-[var(--text-muted)]">No admins yet.</p>
        ) : (
          <div className="hidden md:block">
            <table className="ui-data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Last login</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {data.admins.map((admin) => (
                  <tr key={admin.id}>
                    <td className="font-medium">{admin.name ?? '—'}</td>
                    <td className="text-[var(--text-muted)]">{admin.email}</td>
                    <td>
                      <Badge tone={ROLE_TONES[admin.role] ?? 'neutral'}>
                        {roleLabel(admin.role)}
                      </Badge>
                    </td>
                    <td className="text-[var(--text-muted)] text-xs">
                      {admin.lastLogin ? new Date(admin.lastLogin).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="text-[var(--text-muted)] text-xs">
                      {new Date(admin.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pending invites */}
      {!!data?.pendingInvites.length && (
        <div className="ui-data-surface">
          <div className="ui-data-surface-header">
            <div className="ui-data-surface-title">
              <Clock size={15} className="text-[var(--text-muted)]" />
              <h2>Pending invitations ({data.pendingInvites.length})</h2>
            </div>
          </div>
          <div className="hidden md:block">
            <table className="ui-data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Expires</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.pendingInvites.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.email}</td>
                    <td>
                      <Badge tone={ROLE_TONES[inv.role as keyof typeof ROLE_TONES] ?? 'neutral'}>
                        {roleLabel(inv.role)}
                      </Badge>
                    </td>
                    <td className="text-[var(--text-muted)] text-xs">
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </td>
                    <td className="text-right">
                      <InlineActionButton
                        tone="danger"
                        onClick={() => revokeInviteMut.mutate(inv.id)}
                        disabled={revokeInviteMut.isPending}
                      >
                        <Trash2 size={12} /> Cancel
                      </InlineActionButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
