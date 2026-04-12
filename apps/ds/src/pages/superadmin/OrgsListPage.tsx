import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, Users, Calendar, Search } from 'lucide-react';
import { z } from 'zod';
import { saApi, useIsPlatformOwner } from '../../lib/superadmin-auth.js';
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

// The superadmin org creation endpoint accepts ownerEmail + ownerName + optional managementCompanyId
const CreateOrgFormSchema = z.object({
  ownerName: z.string().min(1, 'Full name is required').max(120),
  ownerEmail: z.string().email('Enter a valid email'),
  managementCompanyId: z.string().uuid('Select a management company').optional(),
});
type CreateOrgFormData = z.infer<typeof CreateOrgFormSchema>;

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

interface CompanyOption {
  id: string;
  name: string;
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
  const isPO = useIsPlatformOwner();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');

  const { data: orgs = [], isLoading } = useQuery({
    queryKey: ['sa-orgs'],
    queryFn: () => saApi.get<OrgRow[]>('/superadmin/orgs'),
  });

  // Only needed for platform owners who must pick a management company
  const { data: companies = [] } = useQuery({
    queryKey: ['sa-companies-options'],
    queryFn: () => saApi.get<CompanyOption[]>('/superadmin/management-companies'),
    enabled: !!isPO,
    select: (rows: CompanyOption[]) => rows,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateOrgFormData>({ resolver: zodResolver(CreateOrgFormSchema) });

  const createOrg = useMutation({
    mutationFn: (data: CreateOrgFormData) =>
      saApi.post<{ org: OrgRow }>('/superadmin/orgs', data),
    onSuccess: () => {
      toast.success('Invite sent to organization owner');
      void qc.invalidateQueries({ queryKey: ['sa-orgs'] });
      reset();
      setShowCreate(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to send invite');
    },
  });

  const suspendOrg = useMutation({
    mutationFn: ({ id, suspended }: { id: string; suspended: boolean }) =>
      saApi.patch<OrgRow>(`/superadmin/orgs/${id}`, { suspended }),
    onSuccess: (_, vars) => {
      toast.success(vars.suspended ? 'Organization suspended' : 'Organization unsuspended');
      void qc.invalidateQueries({ queryKey: ['sa-orgs'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Action failed'),
  });

  // Pending-setup orgs show a placeholder name — display them differently
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

      {/* Table */}
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
                        to={`/superadmin/orgs/${org.id}`}
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
                    <div className="col-span-2">
                      <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Created</p>
                      <p className="mt-1 text-[var(--text-muted)]">{new Date(org.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <InlineActionButton
                      onClick={() => suspendOrg.mutate({ id: org.id, suspended: !org.suspendedAt })}
                      className="justify-center"
                    >
                      {org.suspendedAt ? 'Unsuspend' : 'Suspend'}
                    </InlineActionButton>
                    <Link to={`/superadmin/orgs/${org.id}`} className="ui-inline-action-btn justify-center text-center">
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
                          to={`/superadmin/orgs/${org.id}`}
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
                          <Link
                            to={`/superadmin/orgs/${org.id}`}
                            className="ui-inline-action-btn"
                          >
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

      {/* Invite Owner Modal */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} size="sm">
          <ModalHeader
            title="Invite Organization Owner"
            subtitle="They'll receive an email to set up their organization."
            onClose={() => setShowCreate(false)}
          />

          <ModalBody>
            <form
              id="create-org-form"
              onSubmit={handleSubmit((d) => createOrg.mutate(d))}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium mb-1">Full name</label>
                <input {...register('ownerName')} placeholder="Jane Smith" className="input w-full" />
                {errors.ownerName && <p className="text-xs text-[var(--danger)] mt-1">{errors.ownerName.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email address</label>
                <input {...register('ownerEmail')} type="email" placeholder="jane@acme.com" className="input w-full" />
                {errors.ownerEmail && <p className="text-xs text-[var(--danger)] mt-1">{errors.ownerEmail.message}</p>}
              </div>
              {isPO && (
                <div>
                  <label className="block text-sm font-medium mb-1">Management Company</label>
                  <select {...register('managementCompanyId')} className="input w-full">
                    <option value="">None (direct client)</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {errors.managementCompanyId && (
                    <p className="text-xs text-[var(--danger)] mt-1">{errors.managementCompanyId.message}</p>
                  )}
                </div>
              )}
            </form>
          </ModalBody>

            <ModalFooter>
              <ModalSecondaryButton
                type="button"
                onClick={() => setShowCreate(false)}
                className="flex-1"
              >
                Cancel
              </ModalSecondaryButton>
              <ModalPrimaryButton
                form="create-org-form"
                type="submit"
                disabled={createOrg.isPending}
                className="flex-1"
              >
                {createOrg.isPending ? 'Sending…' : 'Send Invite'}
              </ModalPrimaryButton>
            </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
