import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, Users, Search, Building } from 'lucide-react';
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

export default function ManagementCompaniesListPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');

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

  const filtered = companies.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.slug.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-8 max-w-7xl mx-auto">
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
              {filtered.map((company) => (
                <tr key={company.id}>
                  <td>
                    <Link
                      to={`/superadmin/companies/${company.id}`}
                      className="font-medium hover:text-[var(--blue)] transition-colors"
                    >
                      {company.name}
                    </Link>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5 font-mono">{company.slug}</p>
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
                    <div className="flex items-center gap-2 justify-end">
                      <InlineActionButton
                        onClick={() => suspendCompany.mutate({ id: company.id, suspended: !company.suspendedAt })}
                      >
                        {company.suspendedAt ? 'Unsuspend' : 'Suspend'}
                      </InlineActionButton>
                      <Link to={`/superadmin/companies/${company.id}`} className="ui-inline-action-btn">
                        View
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
    </div>
  );
}
