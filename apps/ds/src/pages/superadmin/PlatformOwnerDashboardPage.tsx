import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, Building2, Users, Layers } from 'lucide-react';
import { CreateManagementCompanySchema } from '@signage/shared';
import type { CreateManagementCompanyInput } from '@signage/shared';
import { saApi } from '../../lib/superadmin-auth.js';
import type { PortalAnalyticsResponse } from '../../lib/portal-analytics.js';
import {
  Badge,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalPrimaryButton,
  ModalSecondaryButton,
  Skeleton,
} from '../../components/UiPrimitives.js';

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  billingEmail: string | null;
  suspendedAt: string | null;
  createdAt: string;
  adminCount: number;
  orgCount: number;
}

// ── stat card ───────────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  loading,
  icon: Icon,
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
  icon: React.ElementType;
}) {
  return (
    <div
      className="rounded-xl border p-5 flex items-start gap-4"
      style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}
    >
      <div className="w-10 h-10 rounded-lg bg-[var(--blue)]/10 flex items-center justify-center flex-shrink-0">
        <Icon size={18} className="text-[var(--blue)]" />
      </div>
      <div>
        <p className="text-xs text-[var(--text-muted)] mb-1">{label}</p>
        {loading ? (
          <Skeleton className="h-7 w-16 rounded" />
        ) : (
          <p className="text-2xl font-bold tabular-nums">{value?.toLocaleString() ?? '—'}</p>
        )}
      </div>
    </div>
  );
}

// ── Platform Owner view ─────────────────────────────────────────────────────
function PlatformOwnerView() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['sa-analytics'],
    queryFn: () => saApi.get<PortalAnalyticsResponse>('/superadmin/analytics'),
  });

  const { data: companies = [], isLoading: companiesLoading } = useQuery({
    queryKey: ['sa-companies'],
    queryFn: () => saApi.get<CompanyRow[]>('/superadmin/management-companies'),
  });

  const form = useForm<CreateManagementCompanyInput>({
    resolver: zodResolver(CreateManagementCompanySchema),
  });

  const createCompany = useMutation({
    mutationFn: (data: CreateManagementCompanyInput) =>
      saApi.post<{ company: CompanyRow; initialInviteSent: boolean }>(
        '/superadmin/management-companies',
        data,
      ),
    onSuccess: () => {
      toast.success('Invite sent — admin will set up the company on first login');
      void qc.invalidateQueries({ queryKey: ['sa-companies'] });
      void qc.invalidateQueries({ queryKey: ['sa-analytics'] });
      form.reset();
      setShowCreate(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to create company'),
  });

  const suspendCompany = useMutation({
    mutationFn: ({ id, suspended }: { id: string; suspended: boolean }) =>
      saApi.patch<CompanyRow>(`/superadmin/management-companies/${id}`, { suspended }),
    onSuccess: (_, vars) => {
      toast.success(vars.suspended ? 'Company suspended' : 'Company activated');
      void qc.invalidateQueries({ queryKey: ['sa-companies'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Action failed'),
  });

  const { errors, isSubmitting } = form.formState;
  const summary = analytics?.summary;
  const activeAlerts = analytics?.alerts ?? [];

  return (
    <>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Platform Dashboard</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              Overview of all resellers and client organizations
            </p>
          </div>
          <button onClick={() => setShowCreate(true)} className="workspace-page-action">
            <Plus size={16} />
            New Reseller
          </button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard
            label="Resellers"
            value={summary?.totalResellers}
            loading={analyticsLoading}
            icon={Layers}
          />
          <StatCard
            label="Client Organizations"
            value={summary?.totalOrganizations}
            loading={analyticsLoading}
            icon={Building2}
          />
          <StatCard
            label="Total Users"
            value={summary?.totalUsers}
            loading={analyticsLoading}
            icon={Users}
          />
        </div>

        {!analyticsLoading && activeAlerts.length > 0 && (
          <div
            className="rounded-xl border p-4 flex flex-wrap items-center gap-3"
            style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}
          >
            <Badge tone="warning">{activeAlerts.length} active alert{activeAlerts.length === 1 ? '' : 's'}</Badge>
            <p className="text-sm text-[var(--text-muted)]">
              {activeAlerts.map((alert) => alert.title).join(' · ')}
            </p>
          </div>
        )}

        {/* Companies grid */}
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">
            Resellers
          </h2>
          {companiesLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-44 rounded-xl" />
              ))}
            </div>
          ) : companies.length === 0 ? (
            <div
              className="rounded-xl border p-12 text-center text-[var(--text-muted)]"
              style={{ borderColor: 'var(--card-border)', background: 'var(--bg2)' }}
            >
              No resellers yet - create one to get started.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {companies.map((company) => (
                <div
                  key={company.id}
                  className="rounded-xl border p-5 flex flex-col gap-4"
                  style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{company.name}</p>
                      <p className="text-xs text-[var(--text-muted)] font-mono mt-0.5 truncate">
                        {company.slug}
                      </p>
                    </div>
                    <Badge
                      tone={company.suspendedAt ? 'warning' : 'success'}
                      className="flex-shrink-0"
                    >
                      {company.suspendedAt ? 'Suspended' : 'Active'}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                      <Building2 size={13} />
                      <span className="tabular-nums font-medium text-[var(--text)]">
                        {company.orgCount}
                      </span>
                      <span>orgs</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                      <Users size={13} />
                      <span className="tabular-nums font-medium text-[var(--text)]">
                        {company.adminCount}
                      </span>
                      <span>admins</span>
                    </div>
                  </div>

                  {company.billingEmail && (
                    <p className="text-xs text-[var(--text-muted)] truncate">{company.billingEmail}</p>
                  )}

                  <div
                    className="flex items-center gap-2 mt-auto pt-3 border-t"
                    style={{ borderColor: 'var(--card-border)' }}
                  >
                    <Link
                      to={`/superadmin/companies/${company.id}`}
                      className="flex-1 text-center text-xs font-medium py-1.5 rounded-lg transition-colors bg-[var(--blue)]/10 text-[var(--blue)] hover:bg-[var(--blue)]/20"
                    >
                      View Details
                    </Link>
                    <button
                      onClick={() =>
                        suspendCompany.mutate({ id: company.id, suspended: !company.suspendedAt })
                      }
                      className="text-xs font-medium py-1.5 px-3 rounded-lg transition-colors text-[var(--text-muted)] hover:bg-white/5"
                    >
                      {company.suspendedAt ? 'Activate' : 'Suspend'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create company modal */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} size="sm">
          <ModalHeader
            title="New Management Company"
            subtitle="An invite will be sent to the initial admin immediately."
            onClose={() => setShowCreate(false)}
          />
          <ModalBody>
            <form
              id="create-company-form"
              onSubmit={form.handleSubmit((d) => createCompany.mutate(d))}
              className="space-y-4"
            >
              <div>
                <label className="ui-label">Admin's Full Name</label>
                <input
                  {...form.register('initialAdminName')}
                  className="ui-input"
                  placeholder="Jane Smith"
                />
                {errors.initialAdminName && (
                  <p className="ui-field-error">{errors.initialAdminName.message}</p>
                )}
              </div>
              <div>
                <label className="ui-label">Admin's Email</label>
                <input
                  {...form.register('initialAdminEmail')}
                  type="email"
                  className="ui-input"
                  placeholder="jane@acme.com"
                />
                {errors.initialAdminEmail && (
                  <p className="ui-field-error">{errors.initialAdminEmail.message}</p>
                )}
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                The admin will set up their company name, portal address and logo when they accept the invite.
              </p>
            </form>
          </ModalBody>
          <ModalFooter>
            <ModalSecondaryButton onClick={() => setShowCreate(false)}>
              Cancel
            </ModalSecondaryButton>
            <ModalPrimaryButton
              form="create-company-form"
              type="submit"
              disabled={isSubmitting || createCompany.isPending}
            >
              {createCompany.isPending ? 'Creating…' : 'Create & Send Invite'}
            </ModalPrimaryButton>
          </ModalFooter>
        </Modal>
      )}
    </>
  );
}

export default function PlatformOwnerDashboardPage() {
  return <PlatformOwnerView />;
}
