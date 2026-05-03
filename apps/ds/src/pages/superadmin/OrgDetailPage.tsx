import { useState } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ArrowLeft, Mail, Users, Clock, Trash2, HardDrive, LogIn, Settings2 } from 'lucide-react';
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

type OrgModules = 'signage' | 'pos' | 'both';
type OrgPlan = 'starter' | 'pro' | 'enterprise';

function parseModules(settingsJson: string | undefined): OrgModules {
  try {
    const s = JSON.parse(settingsJson ?? '{}') as { modules?: string };
    if (s.modules === 'pos' || s.modules === 'both') return s.modules;
  } catch { /* ignore */ }
  return 'signage';
}

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

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// Parse strings like "5 GB", "500 MB", "100 GB" → bytes
function parseGigabytes(str: string): number | null {
  const cleaned = str.trim().replace(/,/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num) || num <= 0) return null;
  const lower = cleaned.toLowerCase();
  if (lower.includes('tb')) return Math.round(num * 1_099_511_627_776);
  if (lower.includes('gb') || lower === cleaned) return Math.round(num * 1_073_741_824);
  if (lower.includes('mb')) return Math.round(num * 1_048_576);
  return Math.round(num * 1_073_741_824); // default: GB
}

const ORG_PLAN_TONES = {
  starter: 'neutral',
  pro: 'accent',
  enterprise: 'success',
} as const;

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
};

export default function OrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const backPath = pathname.startsWith('/management') ? '/management/orgs' : '/superadmin/orgs';
  const qc = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [quotaInput, setQuotaInput] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<OrgPlan | null>(null);
  const [selectedModules, setSelectedModules] = useState<OrgModules | null>(null);
  const [showImpersonateConfirm, setShowImpersonateConfirm] = useState(false);

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

  const planModulesMut = useMutation({
    mutationFn: (payload: { plan?: OrgPlan; modules?: OrgModules }) =>
      saApi.patch<Org>(`/superadmin/orgs/${id}`, payload),
    onSuccess: () => {
      toast.success('Plan & modules updated');
      setSelectedPlan(null);
      setSelectedModules(null);
      void qc.invalidateQueries({ queryKey: ['sa-org', id] });
      void qc.invalidateQueries({ queryKey: ['sa-orgs'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Update failed'),
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
      navigate(backPath);
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
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center text-[var(--text-muted)]">Organization not found.</div>
    );
  }

  const { org, members, pendingInvites } = data;

  const currentModules = parseModules(org.settings);
  const activePlan   = (selectedPlan   ?? org.plan)    as OrgPlan;
  const activeModules = (selectedModules ?? currentModules) as OrgModules;
  const planDirty    = selectedPlan !== null && selectedPlan !== org.plan;
  const modulesDirty = selectedModules !== null && selectedModules !== currentModules;

  const PLANS: { value: OrgPlan; label: string }[] = [
    { value: 'starter',    label: 'Starter' },
    { value: 'pro',        label: 'Pro' },
    { value: 'enterprise', label: 'Enterprise' },
  ];
  const MODULE_OPTIONS: { value: OrgModules; label: string; sub: string }[] = [
    { value: 'signage', label: 'CMS Only',    sub: 'Signage & content management' },
    { value: 'pos',     label: 'POS Only',    sub: 'Point of sale & kiosk' },
    { value: 'both',    label: 'Both',        sub: 'Full platform access' },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-8">
      {/* Back */}
      <Link
        to={backPath}
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
            <InlineActionButton
              onClick={() => setShowImpersonateConfirm(true)}
              disabled={impersonateMut.isPending}
            >
              <LogIn size={14} /> Impersonate
            </InlineActionButton>
            <InlineActionButton
              onClick={() => suspendMut.mutate(!org.suspendedAt)}
              disabled={suspendMut.isPending}
            >
              {org.suspendedAt ? 'Unsuspend' : 'Suspend'}
            </InlineActionButton>
            <InlineActionButton
              onClick={() => setShowDelete(true)}
              tone="danger"
            >
              <Trash2 size={14} />
            </InlineActionButton>
          </div>
        )}
      />

      {/* Details card */}
      <SectionCard>
        <SectionCardBody className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <div>
          <p className="text-xs text-[var(--text-muted)] mb-1">Plan</p>
          <Badge tone={ORG_PLAN_TONES[org.plan as keyof typeof ORG_PLAN_TONES] ?? 'neutral'} className="capitalize">{org.plan}</Badge>
          </div>
          <div>
          <p className="text-xs text-[var(--text-muted)] mb-1">Modules</p>
          <Badge tone={currentModules === 'both' ? 'success' : currentModules === 'pos' ? 'accent' : 'neutral'}>
            {currentModules === 'both' ? 'CMS + POS' : currentModules === 'pos' ? 'POS Only' : 'CMS Only'}
          </Badge>
          </div>
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

      {/* Plan & Modules */}
      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Settings2 size={16} /> Plan &amp; Modules
          </h2>
        </SectionCardHeader>
        <SectionCardBody className="space-y-6">
          {/* Plan selector */}
          <div>
            <p className="text-sm font-medium mb-3">Subscription plan</p>
            <div className="flex flex-wrap gap-2">
              {PLANS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setSelectedPlan(p.value)}
                  className={
                    activePlan === p.value
                      ? 'btn-primary text-sm px-4 py-2'
                      : 'workspace-page-action text-sm px-4 py-2'
                  }
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Module selector */}
          <div>
            <p className="text-sm font-medium mb-3">Active modules</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {MODULE_OPTIONS.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setSelectedModules(m.value)}
                  className="text-left rounded-xl border p-4 transition-colors"
                  style={{
                    background: activeModules === m.value ? 'rgba(58,123,255,0.12)' : 'var(--card)',
                    borderColor: activeModules === m.value ? 'var(--blue)' : 'var(--card-border)',
                  }}
                >
                  <div className="font-semibold text-sm mb-1">{m.label}</div>
                  <div className="text-xs text-[var(--text-muted)]">{m.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Save */}
          {(planDirty || modulesDirty) && (
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => planModulesMut.mutate({
                  ...(planDirty    ? { plan: activePlan }     : {}),
                  ...(modulesDirty ? { modules: activeModules } : {}),
                })}
                disabled={planModulesMut.isPending}
                className="btn-primary"
              >
                {planModulesMut.isPending ? 'Saving…' : 'Save Changes'}
              </button>
              <button
                onClick={() => { setSelectedPlan(null); setSelectedModules(null); }}
                className="workspace-page-action"
              >
                Cancel
              </button>
            </div>
          )}
        </SectionCardBody>
      </SectionCard>

      {/* Invite section */}
      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Mail size={16} /> Send Invitation
          </h2>
        </SectionCardHeader>
        <SectionCardBody>
          <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            type="email"
            placeholder="email@example.com"
            className="input flex-1"
          />
          <button
            onClick={() => inviteMut.mutate()}
            disabled={!inviteEmail || inviteMut.isPending}
            className="btn-primary whitespace-nowrap w-full sm:w-auto"
          >
            {inviteMut.isPending ? 'Sending…' : 'Send Invite'}
          </button>
          </div>
        </SectionCardBody>
      </SectionCard>

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <div className="ui-data-surface">
          <div className="ui-data-surface-header">
            <div className="ui-data-surface-title">
              <Clock size={15} className="text-[var(--text-muted)]" />
              <h2>Pending Invitations ({pendingInvites.length})</h2>
            </div>
          </div>
          <div className="space-y-3 p-3 md:hidden">
            {pendingInvites.map((inv) => (
              <div
                key={inv.id}
                className="rounded-2xl border p-4"
                style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}
              >
                <p className="break-all font-medium">{inv.email}</p>
                <div className="mt-3">
                  <Badge tone="neutral" className="capitalize">
                    Owner
                  </Badge>
                </div>
                <p className="mt-3 text-xs text-[var(--text-muted)]">
                  {inv.acceptedAt
                    ? `Accepted ${new Date(inv.acceptedAt).toLocaleDateString()}`
                    : `Expires ${new Date(inv.expiresAt).toLocaleDateString()}`}
                </p>
                {!inv.acceptedAt ? (
                  <button
                    onClick={() => revokeInviteMut.mutate(inv.id)}
                    disabled={revokeInviteMut.isPending}
                    className="ui-inline-action-btn ui-inline-action-btn-danger mt-4 w-full justify-center"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <div className="hidden md:block">
            <table className="ui-data-table">
              <tbody>
                {pendingInvites.map((inv) => (
                    <tr key={inv.id}>
                      <td>{inv.email}</td>
                      <td>
                        <Badge tone="neutral" className="capitalize">
                        Owner
                        </Badge>
                    </td>
                    <td className="text-[var(--text-muted)] text-xs">
                      {inv.acceptedAt
                        ? `Accepted ${new Date(inv.acceptedAt).toLocaleDateString()}`
                        : `Expires ${new Date(inv.expiresAt).toLocaleDateString()}`}
                    </td>
                    <td className="text-right">
                      {!inv.acceptedAt && (
                        <button
                          onClick={() => revokeInviteMut.mutate(inv.id)}
                          disabled={revokeInviteMut.isPending}
                          className="ui-inline-action-btn ui-inline-action-btn-danger"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Storage Quota */}
      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <HardDrive size={16} /> Storage Quota
          </h2>
        </SectionCardHeader>
        <SectionCardBody>
        {quota && (
          <>
            {/* Usage bar */}
            <div className="mb-4">
              <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                <span>{formatBytes(quota.usedBytes)} used</span>
                <span>{formatBytes(quota.limitBytes)} limit</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--card-border)' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (quota.usedBytes / quota.limitBytes) * 100).toFixed(1)}%`,
                    background:
                      quota.usedBytes / quota.limitBytes >= quota.alertThresholdPct / 100
                        ? 'var(--danger)'
                        : 'var(--blue)',
                  }}
                />
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Alert at {quota.alertThresholdPct}% ({formatBytes((quota.limitBytes * quota.alertThresholdPct) / 100)})
              </p>
            </div>
            {/* Set new limit */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="block text-xs text-[var(--text-muted)] mb-1">
                  New limit (e.g. 50 GB, 200 GB)
                </label>
                <input
                  value={quotaInput}
                  onChange={(e) => setQuotaInput(e.target.value)}
                  placeholder={formatBytes(quota.limitBytes)}
                  className="input w-full"
                />
              </div>
              <button
                onClick={() => {
                  const bytes = parseGigabytes(quotaInput);
                  if (!bytes) { toast.error('Enter a valid size e.g. "50 GB"'); return; }
                  quotaMut.mutate(bytes);
                }}
                disabled={!quotaInput || quotaMut.isPending}
                className="btn-primary whitespace-nowrap w-full sm:w-auto"
              >
                {quotaMut.isPending ? 'Saving…' : 'Update Quota'}
              </button>
            </div>
          </>
        )}
        {!quota && <p className="text-sm text-[var(--text-muted)]">Loading quota…</p>}
        </SectionCardBody>
      </SectionCard>

      {/* Members */}
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
          <>
            <div className="space-y-3 p-3 md:hidden">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="rounded-2xl border p-4"
                  style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}
                >
                  <p className="font-medium break-words">{m.name || '—'}</p>
                  <p className="mt-1 break-all text-sm text-[var(--text-muted)]">{m.email}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Role</p>
                      <div className="mt-1">
                        <Badge tone={getRoleTone(m.orgRole)} className="capitalize">
                          {m.orgRole}
                        </Badge>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Status</p>
                      <div className="mt-1">
                        <Badge tone={getMemberStatusTone(m.status)} className="capitalize">
                          {m.status}
                        </Badge>
                      </div>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Joined</p>
                      <p className="mt-1 text-[var(--text-muted)]">{new Date(m.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden md:block">
              <table className="ui-data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td className="font-medium">{m.name || '—'}</td>
                      <td className="text-[var(--text-muted)]">{m.email}</td>
                      <td>
                        <Badge tone={getRoleTone(m.orgRole)} className="capitalize">
                          {m.orgRole}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone={getMemberStatusTone(m.status)} className="capitalize">
                          {m.status}
                        </Badge>
                      </td>
                      <td className="text-[var(--text-muted)]">
                        {new Date(m.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={showDelete}
        title="Delete Organization"
        message={`Are you sure you want to delete ${org.name}? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmPendingLabel="Deleting…"
        isConfirming={deleteMut.isPending}
        closeOnConfirm={false}
        onConfirm={() => deleteMut.mutate()}
        onClose={() => setShowDelete(false)}
      />

      <ConfirmDialog
        open={showImpersonateConfirm}
        title="Impersonate Organization"
        message={`You will be logged in as the highest-role user of ${org.name}. This action is audit-logged. A 2-hour session token will be issued. Proceed?`}
        confirmLabel="Impersonate"
        confirmPendingLabel="Impersonating…"
        isConfirming={impersonateMut.isPending}
        closeOnConfirm={false}
        onConfirm={() => impersonateMut.mutate()}
        onClose={() => setShowImpersonateConfirm(false)}
      />
    </div>
  );
}
