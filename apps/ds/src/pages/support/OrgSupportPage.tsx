import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, MessageSquare } from 'lucide-react';
import { CreateSupportTicketSchema } from '@signage/shared';
import type { CreateSupportTicketInput, SupportTicketSummary, SupportUnreadCount } from '@signage/shared';
import { api } from '../../lib/api.js';
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

const CreateSchema = CreateSupportTicketSchema.omit({ partyType: true, companyId: true, orgId: true });

export default function OrgSupportPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['org-support-tickets'],
    queryFn: () => api.get<{ tickets: SupportTicketSummary[] }>('/support/tickets'),
    refetchInterval: 30_000,
  });

  const { data: unread } = useQuery({
    queryKey: ['org-support-unread'],
    queryFn: () => api.get<SupportUnreadCount>('/support/unread-count'),
    refetchInterval: 30_000,
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<{
    category: CreateSupportTicketInput['category'];
    priority: CreateSupportTicketInput['priority'];
    subject: string;
    message?: string;
  }>({
    defaultValues: { category: 'general', priority: 'medium' },
  });

  const createMut = useMutation({
    mutationFn: (d: { category: string; priority: string; subject: string; message?: string }) =>
      api.post('/support/tickets', d),
    onSuccess: () => {
      toast.success('Support request submitted');
      void qc.invalidateQueries({ queryKey: ['org-support-tickets'] });
      void qc.invalidateQueries({ queryKey: ['org-support-unread'] });
      reset();
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
        subtitle="Contact the support team for help with your account or signage."
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
          <EmptyState icon={<MessageSquare size={32} />} title="No support requests" subtitle="No tickets yet. Click 'New Request' if you need help." />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b text-xs text-[var(--text-muted)] uppercase tracking-wide" style={{ borderColor: 'var(--card-border)' }}>
                <th className="py-3 px-4 text-left font-semibold">Subject</th>
                <th className="py-3 px-4 text-left font-semibold hidden md:table-cell">Category</th>
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
                  onClick={() => navigate(`/support/${t.id}`)}
                >
                  <td className="py-3 px-4">
                    <div className="font-medium text-sm">{t.subject}</div>
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">{t.submittedByName}</div>
                  </td>
                  <td className="py-3 px-4 hidden md:table-cell">
                    <Badge tone="neutral">{CATEGORY_LABELS[t.category] ?? t.category}</Badge>
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

      {showCreate && (
        <Modal onClose={() => { setShowCreate(false); reset(); }} size="md">
          <ModalHeader
            title="New Support Request"
            subtitle="Describe your issue and the team will get back to you."
            onClose={() => { setShowCreate(false); reset(); }}
          />
          <ModalBody>
            <form id="org-create-support" onSubmit={handleSubmit(d => createMut.mutate(d))} className="space-y-4">
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
                <input {...register('subject', { required: 'Required' })} placeholder="Brief summary…" className="input w-full" />
                {errors.subject && <p className="text-xs text-[var(--danger)] mt-1">{errors.subject.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description <span className="text-[var(--text-muted)]">(optional)</span></label>
                <textarea {...register('message')} rows={4} placeholder="Describe the issue in detail…" className="input w-full resize-none" />
              </div>
            </form>
          </ModalBody>
          <ModalFooter>
            <ModalSecondaryButton onClick={() => { setShowCreate(false); reset(); }} className="flex-1">Cancel</ModalSecondaryButton>
            <ModalPrimaryButton form="org-create-support" type="submit" disabled={createMut.isPending} className="flex-1">
              {createMut.isPending ? 'Submitting…' : 'Submit Request'}
            </ModalPrimaryButton>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
