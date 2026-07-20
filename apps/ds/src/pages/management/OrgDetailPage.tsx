import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Mail, Users, Clock, Trash2, HardDrive, LogIn, Globe } from 'lucide-react';
import { saApi, saImpersonateOrg } from '../../lib/superadmin-auth.js';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import {
  Badge,
  InlineActionButton,
  PageHeader,
  SectionCard,
  SectionCardBody,
  SectionCardHeader,
  Skeleton,
} from '../../components/UiPrimitives.js';

interface Org {
  id: string;
  name: string;
  slug: string;
  plan: string;
  settings: string;
  suspendedAt: string | null;
  createdAt: string;
}

interface Member {
  id: string;
  name: string;
  email: string;
  orgRole: string;
  status: string;
  createdAt: string;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

interface OrgDetail {
  org: Org;
  members: Member[];
  pendingInvites: Invite[];
}

interface OrgQuota {
  orgId: string;
  limitBytes: number;
  usedBytes: number;
  alertThresholdPct: number;
}

interface TenantRoute {
  id: string;
  hostname: string;
  pathPrefix: string;
  routeType: 'management' | 'client_org' | 'workspace';
  status: 'pending_dns' | 'verified' | 'active' | 'failed';
  verificationToken: string;
  tlsStatus: 'pending' | 'ready' | 'failed' | 'external';
  createdAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function parseGigabytes(str: string): number | null {
  const cleaned = str.trim().replace(/,/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num) || num <= 0) return null;
  const lower = cleaned.toLowerCase();
  if (lower.includes('tb')) return Math.round(num * 1_099_511_627_776);
  if (lower.includes('gb') || lower === cleaned) return Math.round(num * 1_073_741_824);
  if (lower.includes('mb')) return Math.round(num * 1_048_576);
  return Math.round(num * 1_073_741_824);
}

const ORG_ROLE_TONES = {
  owner: 'success',
  admin: 'accent',
  member: 'neutral',
} as const;

const MEMBER_STATUS_TONES = {
  active: 'success',
  invited: 'warning',
  pending: 'warning',
  suspended: 'danger',
} as const;

function getOrgStatusTone(suspendedAt: string | null) {
  return suspendedAt ? 'warning' : 'success';
}

function getRoleTone(role: string) {
  return ORG_ROLE_TONES[role as keyof typeof ORG_ROLE_TONES] ?? 'neutral';
}

function getMemberStatusTone(status: string) {
  return MEMBER_STATUS_TONES[status as keyof typeof MEMBER_STATUS_TONES] ?? 'neutral';
}

export default function OrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [quotaInput, setQuotaInput] = useState('');
  const [showImpersonateConfirm, setShowImpersonateConfirm] = useState(false);
  const [routeHostname, setRouteHostname] = useState('');
  const [routePathPrefix, setRoutePathPrefix] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['sa-org', id],
    queryFn: () => saApi.get<OrgDetail>(`/superadmin/orgs/${id}`),
    enabled: !!id,
  });

  const { data: quota } = useQuery({
    queryKey: ['sa-org-quota', id],
    queryFn: () => saApi.get<OrgQuota>(`/superadmin/orgs/${id}/quota`),
    enabled: !!id,
  });

  const { data: tenantRoutes = [] } = useQuery({
    queryKey: ['sa-org-tenant-routes', id],
    queryFn: () => saApi.get<TenantRoute[]>(`/superadmin/orgs/${id}/tenant-routes`),
    enabled: !!id,
  });

  const quotaMut = useMutation({
    mutationFn: (limitBytes: number) =>
      saApi.patch<OrgQuota>(`/superadmin/orgs/${id}/quota`, { limitBytes }),
    onSuccess: (updated) => {
      toast.success(`Quota updated to ${formatBytes(updated.limitBytes)}`);
      setQuotaInput('');
      void qc.invalidateQueries({ queryKey: ['sa-org-quota', id] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to update quota'),
  });

  const suspendMut = useMutation({
    mutationFn: (suspended: boolean) =>
      saApi.patch<Org>(`/superadmin/orgs/${id}`, { suspended }),
    onSuccess: (org) => {
      toast.success(org.suspendedAt ? 'Organization suspended' : 'Organization unsuspended');
      void qc.invalidateQueries({ queryKey: ['sa-org', id] });
      void qc.invalidateQueries({ queryKey: ['sa-orgs'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Action failed'),
  });

  const inviteMut = useMutation({
    mutationFn: () =>
      saApi.post(`/superadmin/orgs/${id}/invite`, { email: inviteEmail }),
    onSuccess: () => {
      toast.success(`Invitation sent to ${inviteEmail}`);
      setInviteEmail('');
      void qc.invalidateQueries({ queryKey: ['sa-org', id] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to send invite'),
  });

  const createTenantRouteMut = useMutation({
    mutationFn: () => saApi.post<TenantRoute>(`/superadmin/orgs/${id}/tenant-routes`, {
      hostname: routeHostname.trim(),
      pathPrefix: routePathPrefix.trim(),
      routeType: 'client_org',
    }),
    onSuccess: () => {
      toast.success('Client route added');
      setRouteHostname('');
      setRoutePathPrefix('');
      void qc.invalidateQueries({ queryKey: ['sa-org-tenant-routes', id] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to add route'),
  });

  const deleteTenantRouteMut = useMutation({
    mutationFn: (routeId: string) => saApi.delete(`/superadmin/orgs/${id}/tenant-routes/${routeId}`),
    onSuccess: () => {
      toast.success('Client route removed');
      void qc.invalidateQueries({ queryKey: ['sa-org-tenant-routes', id] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to remove route'),
  });

  const verifyTenantRouteMut = useMutation({
    mutationFn: (routeId: string) =>
      saApi.post<{ verified: boolean; reason: string }>(`/superadmin/orgs/${id}/tenant-routes/${routeId}/verify`, {}),
    onSuccess: (result) => {
      if (result.verified) {
        toast.success('Domain verified!');
      } else {
        toast.error(`Verification failed: ${result.reason}`);
      }
      void qc.invalidateQueries({ queryKey: ['sa-org-tenant-routes', id] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Verification failed'),
  });

  const revokeInviteMut = useMutation({
    mutationFn: (inviteId: string) => saApi.delete(`/superadmin/orgs/${id}/invites/${inviteId}`),
    onSuccess: () => {
      toast.success('Invitation cancelled');
      void qc.invalidateQueries({ queryKey: ['sa-org', id] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to cancel invitation'),
  });

  const deleteMut = useMutation({
    mutationFn: () => saApi.delete(`/superadmin/orgs/${id}`),
    onSuccess: () => {
      toast.success('Organization deleted');
      navigate('/management/orgs');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Delete failed'),
  });

  const impersonateMut = useMutation({
    mutationFn: () => {
      if (!id) throw new Error('Organization not found');
      return saImpersonateOrg(id);
    },
    onSuccess: (result) => {
      toast.success(`Impersonating ${result.org.name} as ${result.user.email}`);
      navigate('/dashboard');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Impersonation failed'),
  });

  if (isLoading) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="p-8 text-center text-[var(--text-muted)]">Organization not found.</div>;
  }

  const { org, members, pendingInvites } = data;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-8">
      <Link
        to="/management/orgs"
        className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
      >
        <ArrowLeft size={15} /> All Client Organizations
      </Link>

      <PageHeader
        className="workspace-page-header mb-0"
        title={org.name}
        subtitle={<span className="font-mono">{org.slug}</span>}
        trailing={<Badge tone={getOrgStatusTone(org.suspendedAt)}>{org.suspendedAt ? 'Suspended' : 'Active'}</Badge>}
        action={(
          <div className="flex flex-wrap items-center gap-2">
            <InlineActionButton onClick={() => setShowImpersonateConfirm(true)} disabled={impersonateMut.isPending}>
              <LogIn size={14} /> Impersonate
            </InlineActionButton>
            <InlineActionButton onClick={() => suspendMut.mutate(!org.suspendedAt)} disabled={suspendMut.isPending}>
              {org.suspendedAt ? 'Unsuspend' : 'Suspend'}
            </InlineActionButton>
            <InlineActionButton onClick={() => setShowDelete(true)} tone="danger">
              <Trash2 size={14} />
            </InlineActionButton>
          </div>
        )}
      />

      <SectionCard>
        <SectionCardBody className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <div>
            <p className="text-xs text-[var(--text-muted)] mb-1">Members</p>
            <p className="font-semibold">{members.length}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)] mb-1">Created</p>
            <p className="font-semibold">{new Date(org.createdAt).toLocaleDateString()}</p>
          </div>
        </SectionCardBody>
      </SectionCard>

      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-base font-semibold flex items-center gap-2"><Globe size={16} /> Domains & Routes</h2>
        </SectionCardHeader>
        <SectionCardBody className="space-y-5">
          <div className="grid gap-3 lg:grid-cols-[1fr_0.8fr_auto] lg:items-end">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Hostname</label>
              <input
                value={routeHostname}
                onChange={(e) => setRouteHostname(e.target.value)}
                placeholder="client1.partner.com or partner.com"
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Path alias optional</label>
              <input
                value={routePathPrefix}
                onChange={(e) => setRoutePathPrefix(e.target.value)}
                placeholder="client1"
                className="input w-full"
              />
            </div>
            <button
              onClick={() => createTenantRouteMut.mutate()}
              disabled={!routeHostname.trim() || createTenantRouteMut.isPending}
              className="btn-primary whitespace-nowrap w-full lg:w-auto"
            >
              {createTenantRouteMut.isPending ? 'Adding…' : 'Add Route'}
            </button>
          </div>

          <p className="text-xs text-[var(--text-muted)]">
            Use a subdomain like <span className="font-mono text-[var(--text)]">client1.partner.com</span> for strongest client isolation. Use a path alias like <span className="font-mono text-[var(--text)]">partner.com/client1</span> when the partner prefers one shared hostname.
          </p>

          {tenantRoutes.length === 0 ? (
            <div className="rounded-xl border border-dashed p-5 text-sm text-[var(--text-muted)]" style={{ borderColor: 'var(--card-border)' }}>
              No client routes yet.
            </div>
          ) : (
            <div className="space-y-3">
              {tenantRoutes.map((route) => {
                const publicUrl = route.pathPrefix ? `https://${route.hostname}/${route.pathPrefix}` : `https://${route.hostname}`;
                return (
                  <div key={route.id} className="rounded-xl border p-4" style={{ borderColor: 'var(--card-border)', background: 'var(--surface)' }}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-mono text-sm text-[var(--text)] break-all">{publicUrl}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Badge tone={route.status === 'active' || route.status === 'verified' ? 'success' : route.status === 'failed' ? 'danger' : 'warning'}>
                            {route.status.replace('_', ' ')}
                          </Badge>
                          <Badge tone={route.tlsStatus === 'ready' || route.tlsStatus === 'external' ? 'success' : route.tlsStatus === 'failed' ? 'danger' : 'warning'}>
                            TLS {route.tlsStatus}
                          </Badge>
                        </div>
                        <div className="mt-3 space-y-1 text-xs text-[var(--text-muted)]">
                          <p>DNS: point <span className="font-mono text-[var(--text)]">{route.hostname}</span> to this Nexari server.</p>
                          <p>TXT: <span className="font-mono text-[var(--text)]">_nexari.{route.hostname}</span> = <span className="font-mono text-[var(--text)] break-all">{route.verificationToken}</span></p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 self-start">
                        {route.status !== 'active' && (
                          <button
                            onClick={() => verifyTenantRouteMut.mutate(route.id)}
                            disabled={verifyTenantRouteMut.isPending}
                            className="ui-inline-action-btn"
                            title="Check DNS and verify domain"
                          >
                            {verifyTenantRouteMut.isPending ? 'Checking…' : 'Verify'}
                          </button>
                        )}
                        <button
                          onClick={() => deleteTenantRouteMut.mutate(route.id)}
                          disabled={deleteTenantRouteMut.isPending}
                          className="ui-inline-action-btn ui-inline-action-btn-danger"
                          title="Remove route"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCardBody>
      </SectionCard>

      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-base font-semibold flex items-center gap-2"><Mail size={16} /> Send Invitation</h2>
        </SectionCardHeader>
        <SectionCardBody>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} type="email"
              placeholder="email@example.com" className="input flex-1" />
            <button onClick={() => inviteMut.mutate()} disabled={!inviteEmail || inviteMut.isPending}
              className="btn-primary whitespace-nowrap w-full sm:w-auto">
              {inviteMut.isPending ? 'Sending…' : 'Send Invite'}
            </button>
          </div>
        </SectionCardBody>
      </SectionCard>

      {pendingInvites.length > 0 && (
        <div className="ui-data-surface">
          <div className="ui-data-surface-header">
            <div className="ui-data-surface-title">
              <Clock size={15} className="text-[var(--text-muted)]" />
              <h2>Pending Invitations ({pendingInvites.length})</h2>
            </div>
          </div>
          <div className="hidden md:block">
            <table className="ui-data-table">
              <tbody>
                {pendingInvites.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.email}</td>
                    <td><Badge tone="neutral">Owner</Badge></td>
                    <td className="text-[var(--text-muted)] text-xs">
                      {inv.acceptedAt ? `Accepted ${new Date(inv.acceptedAt).toLocaleDateString()}` : `Expires ${new Date(inv.expiresAt).toLocaleDateString()}`}
                    </td>
                    <td className="text-right">
                      {!inv.acceptedAt && (
                        <button onClick={() => revokeInviteMut.mutate(inv.id)} disabled={revokeInviteMut.isPending}
                          className="ui-inline-action-btn ui-inline-action-btn-danger">Cancel</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-base font-semibold flex items-center gap-2"><HardDrive size={16} /> Storage Quota</h2>
        </SectionCardHeader>
        <SectionCardBody>
          {quota ? (
            <>
              <div className="mb-4">
                <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                  <span>{formatBytes(quota.usedBytes)} used</span>
                  <span>{formatBytes(quota.limitBytes)} limit</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--card-border)' }}>
                  <div className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (quota.usedBytes / quota.limitBytes) * 100).toFixed(1)}%`,
                      background: quota.usedBytes / quota.limitBytes >= quota.alertThresholdPct / 100 ? 'var(--danger)' : 'var(--blue)',
                    }} />
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label className="block text-xs text-[var(--text-muted)] mb-1">New limit (e.g. 50 GB)</label>
                  <input value={quotaInput} onChange={(e) => setQuotaInput(e.target.value)}
                    placeholder={formatBytes(quota.limitBytes)} className="input w-full" />
                </div>
                <button onClick={() => {
                  const bytes = parseGigabytes(quotaInput);
                  if (!bytes) { toast.error('Enter a valid size e.g. "50 GB"'); return; }
                  quotaMut.mutate(bytes);
                }} disabled={!quotaInput || quotaMut.isPending} className="btn-primary whitespace-nowrap w-full sm:w-auto">
                  {quotaMut.isPending ? 'Saving…' : 'Update Quota'}
                </button>
              </div>
            </>
          ) : <p className="text-sm text-[var(--text-muted)]">Loading quota…</p>}
        </SectionCardBody>
      </SectionCard>

      <div className="ui-data-surface">
        <div className="ui-data-surface-header">
          <div className="ui-data-surface-title">
            <Users size={15} className="text-[var(--text-muted)]" />
            <h2>Members ({members.length})</h2>
          </div>
        </div>
        {members.length === 0 ? (
          <p className="px-5 py-6 text-sm text-[var(--text-muted)]">No members yet.</p>
        ) : (
          <div className="hidden md:block">
            <table className="ui-data-table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th></tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td className="font-medium">{m.name || '—'}</td>
                    <td className="text-[var(--text-muted)]">{m.email}</td>
                    <td><Badge tone={getRoleTone(m.orgRole)} className="capitalize">{m.orgRole}</Badge></td>
                    <td><Badge tone={getMemberStatusTone(m.status)} className="capitalize">{m.status}</Badge></td>
                    <td className="text-[var(--text-muted)]">{new Date(m.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog open={showDelete} title="Delete Organization"
        message={`Are you sure you want to delete ${org.name}? This action cannot be undone.`}
        confirmLabel="Delete" confirmPendingLabel="Deleting…" isConfirming={deleteMut.isPending}
        closeOnConfirm={false} onConfirm={() => deleteMut.mutate()} onClose={() => setShowDelete(false)} />

      <ConfirmDialog open={showImpersonateConfirm} title="Impersonate Organization"
        message={`You will be logged in as the highest-role user of ${org.name}. This action is audit-logged. Proceed?`}
        confirmLabel="Impersonate" confirmPendingLabel="Impersonating…" isConfirming={impersonateMut.isPending}
        closeOnConfirm={false} onConfirm={() => impersonateMut.mutate()} onClose={() => setShowImpersonateConfirm(false)} />
    </div>
  );
}
