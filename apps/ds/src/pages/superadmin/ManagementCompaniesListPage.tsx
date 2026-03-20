import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { CircleHelp, Plus, Users, Search, Building } from 'lucide-react';
import { CreateManagementCompanySchema } from '@signage/shared';
import type { CreateManagementCompanyInput } from '@signage/shared';
import { saApi } from '../../lib/superadmin-auth.js';
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

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  billingEmail: string | null;
  suspendedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  adminCount: number;
  orgCount: number;
}

function getResellerPortalPath(slug: string): string | null {
  if (!slug || slug.startsWith('pending-')) return null;
  return `/m/${slug}/login`;
}

export default function ManagementCompaniesListPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [companyToDelete, setCompanyToDelete] = useState<CompanyRow | null>(null);

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['sa-companies'],
    queryFn: () => saApi.get<CompanyRow[]>('/superadmin/management-companies'),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateManagementCompanyInput>({ resolver: zodResolver(CreateManagementCompanySchema) });

  const createCompany = useMutation({
    mutationFn: (data: CreateManagementCompanyInput) =>
      saApi.post<{ company: CompanyRow; initialInviteSent: boolean }>(
        '/superadmin/management-companies',
        data,
      ),
    onSuccess: () => {
      toast.success('Reseller created and invite sent');
      void qc.invalidateQueries({ queryKey: ['sa-companies'] });
      reset();
      setShowCreate(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create reseller');
    },
  });

  const suspendCompany = useMutation({
    mutationFn: ({ id, suspended }: { id: string; suspended: boolean }) =>
      saApi.patch<CompanyRow>(`/superadmin/management-companies/${id}`, { suspended }),
    onSuccess: (_, vars) => {
      toast.success(vars.suspended ? 'Company suspended' : 'Company unsuspended');
      void qc.invalidateQueries({ queryKey: ['sa-companies'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Action failed'),
  });

  const deleteCompany = useMutation({
    mutationFn: (id: string) => saApi.delete(`/superadmin/management-companies/${id}`),
    onSuccess: () => {
      toast.success('Reseller deleted');
      void qc.invalidateQueries({ queryKey: ['sa-companies'] });
      setCompanyToDelete(null);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete reseller');
    },
  });

  const filtered = companies.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.slug.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredWithPortal = filtered.map((company) => ({
    ...company,
    portalPath: getResellerPortalPath(company.slug),
  }));

  const deleteBlockedReason = 'Remove client orgs before delete';

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
      <PageHeader
        className="workspace-page-header"
        title="Resellers"
        subtitle={`${companies.length} total`}
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
            New Reseller
          </button>
        )}
      />

      <div className="ui-data-surface">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-[var(--text-muted)]">No resellers found</div>
        ) : (
          <>
            <div className="space-y-3 p-3 md:hidden">
              {filteredWithPortal.map((company) => (
                <div
                  key={company.id}
                  className="rounded-2xl border p-4"
                  style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        to={`/superadmin/companies/${company.id}`}
                        className="font-medium transition-colors hover:text-[var(--blue)]"
                      >
                        {company.name}
                      </Link>
                      <p className="mt-0.5 truncate font-mono text-xs text-[var(--text-muted)]">{company.slug}</p>
                      {company.portalPath ? (
                        <Link
                          to={company.portalPath}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 block truncate text-xs text-[var(--blue)] hover:underline"
                        >
                          {company.portalPath}
                        </Link>
                      ) : (
                        <p className="mt-1 truncate text-xs text-[var(--text-muted)]">Portal link appears after first-time setup</p>
                      )}
                    </div>
                    <Badge tone={company.suspendedAt ? 'warning' : 'success'}>
                      {company.suspendedAt ? 'Suspended' : 'Active'}
                    </Badge>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Admins</p>
                      <p className="mt-1 tabular-nums text-[var(--text)]">{company.adminCount}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Client Orgs</p>
                      <p className="mt-1 tabular-nums text-[var(--text)]">{company.orgCount}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Billing Email</p>
                      <p className="mt-1 break-all text-[var(--text-muted)]">{company.billingEmail ?? '—'}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Created</p>
                      <p className="mt-1 text-[var(--text-muted)]">{new Date(company.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>

                  {company.orgCount > 0 ? (
                    <div className="mt-3 flex items-center gap-1 text-xs text-[var(--text-muted)]">
                      <span title={deleteBlockedReason} aria-label={deleteBlockedReason}>
                        <CircleHelp size={13} />
                      </span>
                      <p>{deleteBlockedReason}.</p>
                    </div>
                  ) : null}

                  <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <InlineActionButton
                      onClick={() => suspendCompany.mutate({ id: company.id, suspended: !company.suspendedAt })}
                      className="justify-center"
                    >
                      {company.suspendedAt ? 'Unsuspend' : 'Suspend'}
                    </InlineActionButton>
                    <InlineActionButton
                      tone="danger"
                      onClick={() => setCompanyToDelete(company)}
                      disabled={company.orgCount > 0}
                      title={company.orgCount > 0 ? deleteBlockedReason : 'Delete reseller'}
                      className="justify-center"
                    >
                      Delete
                    </InlineActionButton>
                    {company.orgCount > 0 ? (
                      <span className="inline-flex items-center justify-center rounded-full border border-[var(--card-border)] p-1 text-[var(--text-muted)]" title={deleteBlockedReason} aria-label={deleteBlockedReason}>
                        <CircleHelp size={13} />
                      </span>
                    ) : null}
                    <Link to={`/superadmin/companies/${company.id}`} className="ui-inline-action-btn justify-center text-center">
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
                    <th>Reseller</th>
                    <th>
                      <span className="flex items-center gap-1">
                        <Users size={13} /> Admins
                      </span>
                    </th>
                    <th>
                      <span className="flex items-center gap-1">
                        <Building size={13} /> Client Orgs
                      </span>
                    </th>
                    <th>Status</th>
                    <th>Billing Email</th>
                    <th>Created</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWithPortal.map((company) => (
                    <tr key={company.id}>
                      <td>
                        <Link
                          to={`/superadmin/companies/${company.id}`}
                          className="font-medium hover:text-[var(--blue)] transition-colors"
                        >
                          {company.name}
                        </Link>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5 font-mono">{company.slug}</p>
                        {company.portalPath ? (
                          <Link
                            to={company.portalPath}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 block text-xs text-[var(--blue)] hover:underline"
                          >
                            {company.portalPath}
                          </Link>
                        ) : (
                          <p className="mt-1 text-xs text-[var(--text-muted)]">Portal link appears after first-time setup</p>
                        )}
                      </td>
                      <td className="tabular-nums">{company.adminCount}</td>
                      <td className="tabular-nums">{company.orgCount}</td>
                      <td>
                        <Badge tone={company.suspendedAt ? 'warning' : 'success'}>
                          {company.suspendedAt ? 'Suspended' : 'Active'}
                        </Badge>
                      </td>
                      <td className="text-[var(--text-muted)] text-sm">{company.billingEmail ?? '—'}</td>
                      <td className="text-[var(--text-muted)]">
                        {new Date(company.createdAt).toLocaleDateString()}
                      </td>
                      <td>
                        <div className="flex flex-col items-end gap-2">
                          <div className="flex items-center gap-2 justify-end flex-wrap">
                            <InlineActionButton
                              onClick={() => suspendCompany.mutate({ id: company.id, suspended: !company.suspendedAt })}
                            >
                              {company.suspendedAt ? 'Unsuspend' : 'Suspend'}
                            </InlineActionButton>
                            <InlineActionButton
                              tone="danger"
                              onClick={() => setCompanyToDelete(company)}
                              disabled={company.orgCount > 0}
                              title={company.orgCount > 0 ? deleteBlockedReason : 'Delete reseller'}
                            >
                              Delete
                            </InlineActionButton>
                            {company.orgCount > 0 ? (
                              <span className="inline-flex items-center justify-center rounded-full border border-[var(--card-border)] p-1 text-[var(--text-muted)]" title={deleteBlockedReason} aria-label={deleteBlockedReason}>
                                <CircleHelp size={13} />
                              </span>
                            ) : null}
                            <Link to={`/superadmin/companies/${company.id}`} className="ui-inline-action-btn">
                              View
                            </Link>
                          </div>
                          {company.orgCount > 0 ? (
                            <div className="flex items-center gap-1 text-right text-xs text-[var(--text-muted)]">
                              <span title={deleteBlockedReason} aria-label={deleteBlockedReason}>
                                <CircleHelp size={13} />
                              </span>
                              <p>{deleteBlockedReason}.</p>
                            </div>
                          ) : null}
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

      {/* Create company modal */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} size="sm">
          <ModalHeader
            title="New Reseller"
            subtitle="An invite will be sent to the initial admin immediately."
            onClose={() => setShowCreate(false)}
          />
          <ModalBody>
            <form
              id="create-company-form"
              onSubmit={handleSubmit((d) => createCompany.mutate(d))}
              className="space-y-4"
            >
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Initial Admin</p>

              <div>
                <label className="block text-sm font-medium mb-1">Admin name</label>
                <input
                  {...register('initialAdminName')}
                  placeholder="Alice Johnson"
                  className="input w-full"
                />
                {errors.initialAdminName && <p className="text-xs text-[var(--danger)] mt-1">{errors.initialAdminName.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Admin email</label>
                <input
                  {...register('initialAdminEmail')}
                  type="email"
                  placeholder="alice@acme.com"
                  className="input w-full"
                />
                {errors.initialAdminEmail && <p className="text-xs text-[var(--danger)] mt-1">{errors.initialAdminEmail.message}</p>}
              </div>

              <p className="text-xs text-[var(--text-muted)]">
                The invited admin will set the reseller name, portal address, billing email, and logo during first-time setup.
              </p>
            </form>
          </ModalBody>
          <ModalFooter>
            <ModalSecondaryButton type="button" onClick={() => setShowCreate(false)} className="flex-1">
              Cancel
            </ModalSecondaryButton>
            <ModalPrimaryButton
              form="create-company-form"
              type="submit"
              disabled={createCompany.isPending}
              className="flex-1"
            >
              {createCompany.isPending ? 'Creating…' : 'Create Reseller & Send Invite'}
            </ModalPrimaryButton>
          </ModalFooter>
        </Modal>
      )}

      {companyToDelete && (
        <Modal onClose={() => setCompanyToDelete(null)} size="sm">
          <ModalHeader
            title="Delete Reseller"
            subtitle="This performs a soft delete and revokes outstanding reseller invites."
            onClose={() => setCompanyToDelete(null)}
          />
          <ModalBody>
            <div className="space-y-3 text-sm text-[var(--text-muted)]">
              <p>
                Delete <span className="font-semibold text-[var(--text)]">{companyToDelete.name}</span>?
              </p>
              <p>
                This only works when the reseller has no client organizations. Current client org count: <span className="font-semibold text-[var(--text)]">{companyToDelete.orgCount}</span>.
              </p>
              <p>
                Active admins will be suspended and any pending reseller admin invites will be revoked.
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <ModalSecondaryButton type="button" onClick={() => setCompanyToDelete(null)} className="flex-1">
              Cancel
            </ModalSecondaryButton>
            <ModalPrimaryButton
              type="button"
              onClick={() => deleteCompany.mutate(companyToDelete.id)}
              disabled={deleteCompany.isPending || companyToDelete.orgCount > 0}
              className="flex-1"
            >
              {deleteCompany.isPending ? 'Deleting…' : 'Delete Reseller'}
            </ModalPrimaryButton>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
