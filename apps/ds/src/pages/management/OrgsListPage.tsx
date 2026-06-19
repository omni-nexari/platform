import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, Users, Calendar, Search } from 'lucide-react';
import { z } from 'zod';
import { saApi, useSAStore } from '../../lib/superadmin-auth.js';
import {
  Badge,
  InlineActionButton,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalPrimaryButton,
  ModalSecondaryButton,
  PageHeader,
  Skeleton,
} from '../../components/UiPrimitives.js';

// Management company admins create client orgs under their own company

// Mode A: invite an owner via email
const InviteOrgSchema = z.object({
  ownerName: z.string().min(1, 'Full name is required').max(120),
  ownerEmail: z.string().email('Enter a valid email'),
});
type InviteOrgData = z.infer<typeof InviteOrgSchema>;

// Mode B: create directly without sending any email
const DirectCreateSchema = z.object({
  orgName: z.string().min(2, 'Organization name is required').max(100),
});
type DirectCreateData = z.infer<typeof DirectCreateSchema>;

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  plan: 'starter' | 'pro' | 'enterprise';
  status: 'pending' | 'active' | 'suspended';
  suspendedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  memberCount: number;
  managementCompanyId: string | null;
  settings: string;
}

const PLAN_TONES = {
  starter: 'neutral',
  pro: 'accent',
  enterprise: 'success',
} as const;

const MODULE_TONES = {
  signage: 'neutral',
  pos: 'accent',
  both: 'success',
} as const;

const MODULE_LABELS = {
  signage: 'CMS Only',
  pos:     'POS Only',
  both:    'CMS + POS',
} as const;

function getOrgModules(settings: string): 'signage' | 'pos' | 'both' {
  try {
    const s = JSON.parse(settings || '{}') as { modules?: string };
    if (s.modules === 'pos' || s.modules === 'both') return s.modules;
  } catch { /* ignore */ }
  return 'signage';
}

const ORG_STATUS_TONES = {
  active: 'success',
  suspended: 'warning',
  pending: 'neutral',
} as const;

function getOrgStatus(org: OrgRow) {
  if (org.suspendedAt) return 'suspended';
  if (org.status === 'pending') return 'pending';
  return 'active';
}

export default function OrgsListPage() {
  const qc = useQueryClient();
  const { user } = useSAStore();
  const [showCreate, setShowCreate] = useState(false);
  const [createMode, setCreateMode] = useState<'invite' | 'direct'>('invite');
  const [search, setSearch] = useState('');

  const { data: orgs = [], isLoading } = useQuery({
    queryKey: ['sa-orgs'],
    queryFn: () => saApi.get<OrgRow[]>('/superadmin/orgs'),
  });

  const inviteForm = useForm<InviteOrgData>({ resolver: zodResolver(InviteOrgSchema) });
  const directForm = useForm<DirectCreateData>({ resolver: zodResolver(DirectCreateSchema) });

  const createOrg = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      saApi.post<{ org: OrgRow }>('/superadmin/orgs', {
        ...payload,
        managementCompanyId: user?.managementCompanyId,
      }),
    onSuccess: (_, vars) => {
      const msg = vars['skipInvite'] ? 'Organization created' : 'Invite sent to organization owner';
      toast.success(msg);
      void qc.invalidateQueries({ queryKey: ['sa-orgs'] });
      inviteForm.reset();
      directForm.reset();
      setShowCreate(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create organization');
    },
  });

  const handleCloseCreate = () => {
    setShowCreate(false);
    setCreateMode('invite');
    inviteForm.reset();
    directForm.reset();
  };

  const suspendOrg = useMutation({
    mutationFn: ({ id, suspended }: { id: string; suspended: boolean }) =>
      saApi.patch<OrgRow>(`/superadmin/orgs/${id}`, { suspended }),
    onSuccess: (_, vars) => {
      toast.success(vars.suspended ? 'Organization suspended' : 'Organization unsuspended');
      void qc.invalidateQueries({ queryKey: ['sa-orgs'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Action failed'),
  });

  function displayOrgName(org: OrgRow) {
    return org.name === '(pending)' ? (
      <span className="text-[var(--text-muted)] italic">Pending setup…</span>
    ) : (
      org.name
    );
  }

  const filtered = orgs.filter(
    (o) =>
      o.name.toLowerCase().includes(search.toLowerCase()) ||
      o.slug.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
      <PageHeader
        className="workspace-page-header"
        title="Client Organizations"
        subtitle={`${orgs.length} total`}
        trailing={(
          <label className="workspace-page-search w-full max-w-sm">
            <Search size={15} className="text-[var(--text-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or slug"
              className="w-full bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
            />
          </label>
        )}
        action={(
          <button onClick={() => setShowCreate(true)} className="workspace-page-action">
            <Plus size={16} />
            New Client Organization
          </button>
        )}
      />

      <div className="ui-data-surface">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-[var(--text-muted)]">No client organizations found</div>
        ) : (
          <>
            <div className="space-y-3 p-3 md:hidden">
              {filtered.map((org) => (
                <div
                  key={org.id}
                  className="rounded-2xl border p-4"
                  style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        to={`/management/orgs/${org.id}`}
                        className="font-medium transition-colors hover:text-[var(--blue)]"
                      >
                        {displayOrgName(org)}
                      </Link>
                      <p className="mt-0.5 truncate font-mono text-xs text-[var(--text-muted)]">
                        {org.name === '(pending)' ? '' : org.slug}
                      </p>
                    </div>
                    <Badge tone={ORG_STATUS_TONES[getOrgStatus(org)]}>{getOrgStatus(org)}</Badge>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Plan</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge tone={PLAN_TONES[org.plan as keyof typeof PLAN_TONES] ?? 'neutral'} className="capitalize">
                          {org.plan}
                        </Badge>
                        <Badge tone={MODULE_TONES[getOrgModules(org.settings)]}>
                          {MODULE_LABELS[getOrgModules(org.settings)]}
                        </Badge>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Members</p>
                      <p className="mt-1 tabular-nums text-[var(--text)]">{org.memberCount}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <InlineActionButton
                      onClick={() => suspendOrg.mutate({ id: org.id, suspended: !org.suspendedAt })}
                      className="justify-center"
                    >
                      {org.suspendedAt ? 'Unsuspend' : 'Suspend'}
                    </InlineActionButton>
                    <Link to={`/management/orgs/${org.id}`} className="ui-inline-action-btn justify-center text-center">
                      View
                    </Link>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden md:block">
              <table className="ui-data-table">
                <thead>
                  <tr>
                    <th>Client Organization</th>
                    <th>Plan &amp; Modules</th>
                    <th>
                      <span className="flex items-center gap-1">
                        <Users size={13} /> Members
                      </span>
                    </th>
                    <th>Status</th>
                    <th>
                      <span className="flex items-center gap-1">
                        <Calendar size={13} /> Created
                      </span>
                    </th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((org) => (
                    <tr key={org.id}>
                      <td>
                        <Link
                          to={`/management/orgs/${org.id}`}
                          className="font-medium hover:text-[var(--blue)] transition-colors"
                        >
                          {displayOrgName(org)}
                        </Link>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5 font-mono">{org.name === '(pending)' ? '' : org.slug}</p>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={PLAN_TONES[org.plan as keyof typeof PLAN_TONES] ?? 'neutral'} className="capitalize">
                            {org.plan}
                          </Badge>
                          <Badge tone={MODULE_TONES[getOrgModules(org.settings)]}>
                            {MODULE_LABELS[getOrgModules(org.settings)]}
                          </Badge>
                        </div>
                      </td>
                      <td className="tabular-nums">{org.memberCount}</td>
                      <td>
                        <Badge tone={ORG_STATUS_TONES[getOrgStatus(org)]}>
                          {getOrgStatus(org)}
                        </Badge>
                      </td>
                      <td className="text-[var(--text-muted)]">
                        {new Date(org.createdAt).toLocaleDateString()}
                      </td>
                      <td>
                        <div className="flex items-center gap-2 justify-end">
                          <InlineActionButton
                            onClick={() => suspendOrg.mutate({ id: org.id, suspended: !org.suspendedAt })}
                          >
                            {org.suspendedAt ? 'Unsuspend' : 'Suspend'}
                          </InlineActionButton>
                          <Link to={`/management/orgs/${org.id}`} className="ui-inline-action-btn">
                            View
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showCreate && (
        <Modal onClose={handleCloseCreate} size="sm">
          <ModalHeader
            title={createMode === 'invite' ? 'Invite Organization Owner' : 'Create Organization'}
            subtitle={
              createMode === 'invite'
                ? "They'll receive an email to set up their organization."
                : 'Create an organization directly — no email sent. You manage it on their behalf.'
            }
            onClose={handleCloseCreate}
          />
          <ModalBody>
            {/* Mode toggle */}
            <div className="flex rounded-lg overflow-hidden border mb-4" style={{ borderColor: 'var(--card-border)' }}>
              <button
                type="button"
                onClick={() => setCreateMode('invite')}
                className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                  createMode === 'invite'
                    ? 'bg-[var(--blue)] text-white'
                    : 'text-[var(--text-muted)] hover:bg-white/5'
                }`}
              >
                Email Invite
              </button>
              <button
                type="button"
                onClick={() => setCreateMode('direct')}
                className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                  createMode === 'direct'
                    ? 'bg-[var(--blue)] text-white'
                    : 'text-[var(--text-muted)] hover:bg-white/5'
                }`}
              >
                Create Directly
              </button>
            </div>

            {createMode === 'invite' ? (
              <form
                id="create-org-form"
                onSubmit={inviteForm.handleSubmit((d) =>
                  createOrg.mutate({ ownerName: d.ownerName, ownerEmail: d.ownerEmail }),
                )}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm font-medium mb-1">Full name</label>
                  <input {...inviteForm.register('ownerName')} placeholder="Jane Smith" className="input w-full" />
                  {inviteForm.formState.errors.ownerName && (
                    <p className="text-xs text-[var(--danger)] mt-1">{inviteForm.formState.errors.ownerName.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Email address</label>
                  <input {...inviteForm.register('ownerEmail')} type="email" placeholder="jane@acme.com" className="input w-full" />
                  {inviteForm.formState.errors.ownerEmail && (
                    <p className="text-xs text-[var(--danger)] mt-1">{inviteForm.formState.errors.ownerEmail.message}</p>
                  )}
                </div>
              </form>
            ) : (
              <form
                id="create-org-form"
                onSubmit={directForm.handleSubmit((d) =>
                  createOrg.mutate({ orgName: d.orgName, skipInvite: true }),
                )}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm font-medium mb-1">Organization name</label>
                  <input {...directForm.register('orgName')} placeholder="Acme Corp" className="input w-full" />
                  {directForm.formState.errors.orgName && (
                    <p className="text-xs text-[var(--danger)] mt-1">{directForm.formState.errors.orgName.message}</p>
                  )}
                </div>
                <p className="text-xs text-[var(--text-muted)]">
                  The organization will be created and activated immediately. You can invite the client owner later from the organization detail page.
                </p>
              </form>
            )}
          </ModalBody>
          <ModalFooter>
            <ModalSecondaryButton type="button" onClick={handleCloseCreate} className="flex-1">
              Cancel
            </ModalSecondaryButton>
            <ModalPrimaryButton
              form="create-org-form"
              type="submit"
              disabled={createOrg.isPending}
              className="flex-1"
            >
              {createOrg.isPending
                ? createMode === 'invite' ? 'Sending…' : 'Creating…'
                : createMode === 'invite' ? 'Send Invite' : 'Create Organization'}
            </ModalPrimaryButton>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
