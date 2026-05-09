import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, MessageSquare } from 'lucide-react';
import { CreateSupportTicketSchema } from '@signage/shared';
import type { CreateSupportTicketInput, SupportTicketSummary, SupportUnreadCount } from '@signage/shared';
import { saApi } from '../../lib/superadmin-auth.js';
import {
  Badge, EmptyState, Modal, ModalBody, ModalFooter, ModalHeader,
  ModalPrimaryButton, ModalSecondaryButton, PageHeader, Skeleton,
} from '../../components/UiPrimitives.js';

const STATUS_TONES: Record<string, 'neutral' | 'accent' | 'success' | 'danger'> = {
  open: 'accent', in_progress: 'neutral', resolved: 'success', closed: 'neutral',
};
const PRIORITY_TONES: Record<string, 'neutral' | 'accent' | 'danger'> = {
  low: 'neutral', medium: 'neutral', high: 'accent', urgent: 'danger',
};
const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Bug', feature_request: 'Feature Request', billing: 'Billing', general: 'General',
};

interface OrgRow { id: string; name: string }

export default function ManagementSupportPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useSAStore(s => s.user);
  const [showCreate, setShowCreate] = useState(false);
  const [onBehalf, setOnBehalf] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['mgmt-support-tickets'],
    queryFn: () => saApi.get<{ tickets: SupportTicketSummary[] }>('/superadmin/support/reseller/tickets'),
    refetchInterval: 30_000,
  });

  const { data: unread } = useQuery({
    queryKey: ['mgmt-support-unread'],
    queryFn: () => saApi.get<SupportUnreadCount>('/superadmin/support/reseller/unread-count'),
    refetchInterval: 30_000,
  });

  const { data: orgs = [] } = useQuery({
    queryKey: ['mgmt-orgs-slim'],
    queryFn: () => saApi.get<{ orgs: OrgRow[] }>('/orgs'),
    select: (d: { orgs: OrgRow[] }) => d.orgs,
    enabled: showCreate,
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateSupportTicketInput & { message?: string }>({
    resolver: zodResolver(CreateSupportTicketSchema),
    defaultValues: { partyType: 'management_company', category: 'general', priority: 'medium' },
  });

  const createMut = useMutation({
    mutationFn: (d: CreateSupportTicketInput & { message?: string }) =>
      saApi.post('/superadmin/support/reseller/tickets', {
        ...d,
        partyType: onBehalf ? 'client_org' : 'management_company',
      }),
    onSuccess: () => {
      toast.success('Support ticket submitted');
      void qc.invalidateQueries({ queryKey: ['mgmt-support-tickets'] });
      void qc.invalidateQueries({ queryKey: ['mgmt-support-unread'] });
      reset();
      setOnBehalf(false);
      setShowCreate(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed'),
  });

  const tickets = data?.tickets ?? [];

  return (
    <div className="page-container space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Support
            {(unread?.unread ?? 0) > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--danger)] text-white text-[10px] font-bold">
                {unread!.unread}
              </span>
            )}
          </span>
        }
        subtitle="Submit and track support requests with the OmniHub platform team."
        actions={
          <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> New Request
          </button>
        }
      />

      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--card-border)', background: 'var(--card)' }}>
        {isLoading ? (
          <div className="p-6 space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : tickets.length === 0 ? (
          <EmptyState icon={<MessageSquare size={32} />} title="No tickets" subtitle="No support requests yet. Click 'New Request' to get started." />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b text-xs text-[var(--text-muted)] uppercase tracking-wide" style={{ borderColor: 'var(--card-border)' }}>
                <th className="py-3 px-4 text-left font-semibold">Subject</th>
                <th className="py-3 px-4 text-left font-semibold hidden md:table-cell">Category</th>
                <th className="py-3 px-4 text-left font-semibold hidden sm:table-cell">Priority</th>
                <th className="py-3 px-4 text-left font-semibold">Status</th>
                <th className="py-3 px-4 text-left font-semibold hidden lg:table-cell">Updated</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map(t => (
                <tr
                  key={t.id}
                  className="border-b cursor-pointer hover:bg-[var(--bg2)] transition-colors"
                  style={{ borderColor: 'var(--card-border)' }}
                  onClick={() => navigate(`/management/support/${t.id}`)}
                >
                  <td className="py-3 px-4">
                    <div className="font-medium text-sm">{t.subject}</div>
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">{t.submittedByName}</div>
                  </td>
                  <td className="py-3 px-4 hidden md:table-cell">
                    <Badge tone="neutral">{CATEGORY_LABELS[t.category] ?? t.category}</Badge>
                  </td>
                  <td className="py-3 px-4 hidden sm:table-cell">
                    <Badge tone={PRIORITY_TONES[t.priority] ?? 'neutral'}>{t.priority}</Badge>
                  </td>
                  <td className="py-3 px-4">
                    <Badge tone={STATUS_TONES[t.status] ?? 'neutral'}>{t.status.replace('_', ' ')}</Badge>
                  </td>
                  <td className="py-3 px-4 hidden lg:table-cell text-xs text-[var(--text-muted)]">
                    {new Date(t.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <Modal onClose={() => { setShowCreate(false); reset(); setOnBehalf(false); }} size="md">
          <ModalHeader
            title="New Support Request"
            subtitle="The OmniHub platform team will respond as soon as possible."
            onClose={() => { setShowCreate(false); reset(); setOnBehalf(false); }}
          />
          <ModalBody>
            <form id="create-support-form" onSubmit={handleSubmit(d => createMut.mutate(d))} className="space-y-4">
              {/* On behalf of client org toggle */}
              <div className="rounded-xl border p-3 flex items-center justify-between" style={{ borderColor: 'var(--card-border)', background: 'var(--bg2)' }}>
                <div>
                  <p className="text-sm font-medium">Submit on behalf of a client org</p>
                  <p className="text-xs text-[var(--text-muted)]">Forward an issue from one of your client organizations</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOnBehalf(v => !v)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${onBehalf ? 'bg-[var(--blue)]' : 'bg-[var(--card-border)]'}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${onBehalf ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              {onBehalf && (
                <div>
                  <label className="block text-sm font-medium mb-1">Client Organization</label>
                  <select {...register('orgId')} className="input w-full">
                    <option value="">Select org…</option>
                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">Category</label>
                <select {...register('category')} className="input w-full">
                  <option value="general">General</option>
                  <option value="bug">Bug / Issue</option>
                  <option value="feature_request">Feature Request</option>
                  <option value="billing">Billing</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Priority</label>
                <select {...register('priority')} className="input w-full">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Subject</label>
                <input {...register('subject')} placeholder="Brief description…" className="input w-full" />
                {errors.subject && <p className="text-xs text-[var(--danger)] mt-1">{errors.subject.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Description <span className="text-[var(--text-muted)]">(optional)</span></label>
                <textarea {...register('message')} rows={4} placeholder="Please describe the issue or request in detail…" className="input w-full resize-none" />
              </div>
            </form>
          </ModalBody>
          <ModalFooter>
            <ModalSecondaryButton onClick={() => { setShowCreate(false); reset(); setOnBehalf(false); }} className="flex-1">Cancel</ModalSecondaryButton>
            <ModalPrimaryButton form="create-support-form" type="submit" disabled={createMut.isPending} className="flex-1">
              {createMut.isPending ? 'Submitting…' : 'Submit Request'}
            </ModalPrimaryButton>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
