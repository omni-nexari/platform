import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, Building2, Users, Layers, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { z } from 'zod';
import { saApi, useSAStore } from '../../lib/superadmin-auth.js';
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

const InviteClientSchema = z.object({
  ownerName: z.string().min(1, 'Full name is required').max(120),
  ownerEmail: z.string().email('Enter a valid email'),
});
type InviteClientData = z.infer<typeof InviteClientSchema>;

// ── Stat card ────────────────────────────────────────────────────────────────
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

// ── Dashboard ────────────────────────────────────────────────────────────────
export default function ManagementDashboardPage() {
  const qc = useQueryClient();
  const user = useSAStore((s) => s.user);
  const [showInvite, setShowInvite] = useState(false);
  const mcaId = user?.managementCompanyId ?? '';

  const { data: company, isLoading: companyLoading } = useQuery({
    queryKey: ['mca-company', mcaId],
    queryFn: () => saApi.get<CompanyRow>(`/superadmin/management-companies/${mcaId}`),
    enabled: !!mcaId,
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['mca-analytics'],
    queryFn: () => saApi.get<PortalAnalyticsResponse>('/superadmin/analytics'),
  });

  const inviteForm = useForm<InviteClientData>({ resolver: zodResolver(InviteClientSchema) });

  const inviteClient = useMutation({
    mutationFn: (data: InviteClientData) =>
      saApi.post<{ org: unknown }>('/superadmin/orgs', data),
    onSuccess: () => {
      toast.success('Invite sent to client org owner');
      void qc.invalidateQueries({ queryKey: ['mca-analytics'] });
      inviteForm.reset();
      setShowInvite(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to send invite'),
  });

  const { errors: inviteErrors } = inviteForm.formState;
  const summary = analytics?.summary;
  const activeAlerts = analytics?.alerts ?? [];

  return (
    <>
      <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-6 lg:p-8">
        {/* Company header card */}
        <div
          className="rounded-xl border p-5 sm:p-6 flex flex-col items-start gap-5 sm:flex-row sm:items-center"
          style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}
        >
          <div className="w-12 h-12 rounded-xl bg-[var(--blue)]/10 flex items-center justify-center flex-shrink-0">
            <Layers size={20} className="text-[var(--blue)]" />
          </div>
          <div className="flex-1 min-w-0">
            {companyLoading ? (
              <Skeleton className="h-7 w-48 rounded mb-2" />
            ) : (
              <h1 className="text-xl font-bold truncate">{company?.name ?? 'Your Company'}</h1>
            )}
            <div className="flex items-center gap-3 mt-1">
              {companyLoading ? (
                <Skeleton className="h-5 w-24 rounded" />
              ) : (
                <Badge tone={company?.suspendedAt ? 'warning' : 'success'}>
                  {company?.suspendedAt ? 'Suspended' : 'Active'}
                </Badge>
              )}
              <span className="text-xs text-[var(--text-muted)] capitalize">
                {user?.role ?? 'admin'}
              </span>
            </div>
          </div>
          <button
            onClick={() => setShowInvite(true)}
            className="workspace-page-action w-full justify-center sm:w-auto sm:flex-shrink-0"
          >
            <Plus size={16} />
            Invite New Client
          </button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="Client Organizations"
            value={summary?.totalOrganizations}
            loading={analyticsLoading}
            icon={Building2}
          />
          <StatCard
            label="Suspended"
            value={summary?.suspendedOrganizations}
            loading={analyticsLoading}
            icon={AlertTriangle}
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

        {/* Quick action tiles */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Link
            to="/management/orgs"
            className="rounded-xl border p-5 flex items-center gap-4 hover:bg-white/5 transition-colors"
            style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}
          >
            <div className="w-10 h-10 rounded-lg bg-[var(--blue)]/10 flex items-center justify-center flex-shrink-0">
              <Building2 size={18} className="text-[var(--blue)]" />
            </div>
            <div>
              <p className="font-medium">Manage Client Orgs</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                View, manage and suspend client organizations
              </p>
            </div>
          </Link>
          <button
            onClick={() => setShowInvite(true)}
            className="rounded-xl border p-5 flex items-center gap-4 hover:bg-white/5 transition-colors text-left"
            style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}
          >
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 size={18} className="text-emerald-500" />
            </div>
            <div>
              <p className="font-medium">Invite New Client</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Send an email invitation to a new client org owner
              </p>
            </div>
          </button>
        </div>
      </div>

      {/* Invite client modal */}
      {showInvite && (
        <Modal onClose={() => setShowInvite(false)} size="sm">
          <ModalHeader
            title="Invite New Client"
            subtitle="An email invitation will be sent to set up their organization."
            onClose={() => setShowInvite(false)}
          />
          <ModalBody>
            <form
              id="invite-client-form"
              onSubmit={inviteForm.handleSubmit((d) => inviteClient.mutate(d))}
              className="space-y-4"
            >
              <div>
                <label className="ui-label">Client's Full Name</label>
                <input
                  {...inviteForm.register('ownerName')}
                  className="ui-input"
                  placeholder="Jane Smith"
                />
                {inviteErrors.ownerName && (
                  <p className="ui-field-error">{inviteErrors.ownerName.message}</p>
                )}
              </div>
              <div>
                <label className="ui-label">Client's Email</label>
                <input
                  {...inviteForm.register('ownerEmail')}
                  type="email"
                  className="ui-input"
                  placeholder="jane@clientco.com"
                />
                {inviteErrors.ownerEmail && (
                  <p className="ui-field-error">{inviteErrors.ownerEmail.message}</p>
                )}
              </div>
            </form>
          </ModalBody>
          <ModalFooter>
            <ModalSecondaryButton onClick={() => setShowInvite(false)}>
              Cancel
            </ModalSecondaryButton>
            <ModalPrimaryButton
              form="invite-client-form"
              type="submit"
              disabled={inviteClient.isPending}
            >
              {inviteClient.isPending ? 'Sending…' : 'Send Invite'}
            </ModalPrimaryButton>
          </ModalFooter>
        </Modal>
      )}
    </>
  );
}
