import { useState, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, MessageSquare, Search, Paperclip } from 'lucide-react';
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
const STATUS_TABS = ['all', 'open', 'in_progress', 'resolved', 'closed'] as const;
const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Bug', feature_request: 'Feature Request', billing: 'Billing', general: 'General',
};

interface CompanyRow { id: string; name: string }
interface OrgRow { id: string; name: string }

function TicketRow({ ticket, onClick }: { ticket: SupportTicketSummary; onClick: () => void }) {
  return (
    <tr
      className="border-b cursor-pointer hover:bg-[var(--bg2)] transition-colors"
      style={{ borderColor: 'var(--card-border)' }}
      onClick={onClick}
    >
      <td className="py-3 px-4">
        <div className="font-medium text-sm">{ticket.subject}</div>
        <div className="text-xs text-[var(--text-muted)] mt-0.5">{ticket.partyName} · {ticket.submittedByName}</div>
      </td>
      <td className="py-3 px-4 hidden md:table-cell">
        <Badge tone="neutral">{CATEGORY_LABELS[ticket.category] ?? ticket.category}</Badge>
      </td>
      <td className="py-3 px-4 hidden sm:table-cell">
        <Badge tone={PRIORITY_TONES[ticket.priority] ?? 'neutral'}>{ticket.priority}</Badge>
      </td>
      <td className="py-3 px-4">
        <Badge tone={STATUS_TONES[ticket.status] ?? 'neutral'}>{ticket.status.replace('_', ' ')}</Badge>
      </td>
      <td className="py-3 px-4 hidden lg:table-cell text-xs text-[var(--text-muted)]">
        {ticket.messageCount} msg{ticket.messageCount !== 1 ? 's' : ''}
      </td>
      <td className="py-3 px-4 hidden lg:table-cell text-xs text-[var(--text-muted)]">
        {new Date(ticket.updatedAt).toLocaleDateString()}
      </td>
    </tr>
  );
}

export default function SuperAdminSupportPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<typeof STATUS_TABS[number]>('all');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [partyType, setPartyType] = useState<'management_company' | 'client_org'>('management_company');

  const { data, isLoading } = useQuery({
    queryKey: ['sa-support-tickets', activeTab],
    queryFn: () => saApi.get<{ tickets: SupportTicketSummary[]; total: number }>(
      `/superadmin/support/tickets${activeTab !== 'all' ? `?status=${activeTab}` : ''}`,
    ),
    refetchInterval: 30_000,
  });

  const { data: unread } = useQuery({
    queryKey: ['sa-support-unread'],
    queryFn: () => saApi.get<SupportUnreadCount>('/superadmin/support/unread-count'),
    refetchInterval: 30_000,
  });

  const { data: companies = [] } = useQuery({
    queryKey: ['sa-companies-slim'],
    queryFn: () => saApi.get<CompanyRow[]>('/superadmin/management-companies'),
    select: (d: { id: string; name: string }[]) => d.map(c => ({ id: c.id, name: c.name })),
  });

  const { data: orgs = [] } = useQuery({
    queryKey: ['sa-orgs-slim'],
    queryFn: () => saApi.get<{ orgs: OrgRow[] }>('/superadmin/orgs'),
    select: (d: { orgs: OrgRow[] }) => d.orgs,
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateSupportTicketInput & { message?: string }>({
    resolver: zodResolver(CreateSupportTicketSchema) as any,
    defaultValues: { partyType: 'management_company', category: 'general', priority: 'medium' },
  });

  const createMut = useMutation({
    mutationFn: (d: CreateSupportTicketInput & { message?: string }) =>
      saApi.post('/superadmin/support/tickets', d),
    onSuccess: () => {
      toast.success('Ticket created');
      void qc.invalidateQueries({ queryKey: ['sa-support-tickets'] });
      void qc.invalidateQueries({ queryKey: ['sa-support-unread'] });
      reset();
      setShowCreate(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed'),
  });

  const filtered = (data?.tickets ?? []).filter(t =>
    !search || t.subject.toLowerCase().includes(search.toLowerCase()) || t.partyName.toLowerCase().includes(search.toLowerCase()),
  );

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
        subtitle="Manage support tickets from resellers and client organizations."
        actions={
          <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> New Ticket
          </button>
        }
      />

      {/* Tab bar */}
      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={activeTab === tab ? 'btn-primary text-sm px-4 py-1.5' : 'workspace-page-action text-sm px-4 py-1.5'}
          >
            {tab === 'all' ? 'All' : tab.replace('_', ' ').replace(/^\w/, c => c.toUpperCase())}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tickets…"
          className="input pl-9 w-full"
        />
      </div>

      {/* Table */}
      <div className="max-w-2xl mx-auto w-full">
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--card-border)', background: 'var(--card)' }}>
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<MessageSquare size={32} />} title="No tickets" subtitle={search ? 'No results match your search.' : 'No support tickets yet.'} />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b text-xs text-[var(--text-muted)] uppercase tracking-wide" style={{ borderColor: 'var(--card-border)' }}>
                <th className="py-3 px-4 text-left font-semibold">Subject</th>
                <th className="py-3 px-4 text-left font-semibold hidden md:table-cell">Category</th>
                <th className="py-3 px-4 text-left font-semibold hidden sm:table-cell">Priority</th>
                <th className="py-3 px-4 text-left font-semibold">Status</th>
                <th className="py-3 px-4 text-left font-semibold hidden lg:table-cell">Messages</th>
                <th className="py-3 px-4 text-left font-semibold hidden lg:table-cell">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <TicketRow key={t.id} ticket={t} onClick={() => navigate(`/superadmin/support/${t.id}`)} />
              ))}
            </tbody>
          </table>
        )}
      </div>
      </div>

      {/* Create ticket modal */}
      {showCreate && (
        <Modal onClose={() => { setShowCreate(false); reset(); }} size="md">
          <ModalHeader
            title="New Support Ticket"
            subtitle="Open a conversation with a reseller or client org."
            onClose={() => { setShowCreate(false); reset(); }}
          />
          <ModalBody>
            <form id="create-ticket-form" onSubmit={handleSubmit(d => createMut.mutate({ ...d, partyType } as any))} className="space-y-4">
              {/* Party type */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">Send to</p>
                <div className="flex gap-2">
                  {(['management_company', 'client_org'] as const).map(pt => (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => setPartyType(pt)}
                      className={partyType === pt ? 'btn-primary text-sm px-4 py-1.5' : 'workspace-page-action text-sm px-4 py-1.5'}
                    >
                      {pt === 'management_company' ? 'Reseller' : 'Client Org'}
                    </button>
                  ))}
                </div>
              </div>

              {partyType === 'management_company' ? (
                <div>
                  <label className="block text-sm font-medium mb-1">Reseller</label>
                  <select {...register('companyId')} className="input w-full">
                    <option value="">Select reseller…</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {errors.companyId && <p className="text-xs text-[var(--danger)] mt-1">{errors.companyId.message}</p>}
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium mb-1">Client Organization</label>
                  <select {...register('orgId')} className="input w-full">
                    <option value="">Select org…</option>
                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  {errors.orgId && <p className="text-xs text-[var(--danger)] mt-1">{errors.orgId.message}</p>}
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
                <input {...register('subject')} placeholder="Brief description of the issue…" className="input w-full" />
                {errors.subject && <p className="text-xs text-[var(--danger)] mt-1">{errors.subject.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Initial message <span className="text-[var(--text-muted)]">(optional)</span></label>
                <textarea {...register('message')} rows={4} placeholder="Describe the issue in detail…" className="input w-full resize-none" />
              </div>
            </form>
          </ModalBody>
          <ModalFooter>
            <ModalSecondaryButton onClick={() => { setShowCreate(false); reset(); }} className="flex-1">Cancel</ModalSecondaryButton>
            <ModalPrimaryButton form="create-ticket-form" type="submit" disabled={createMut.isPending} className="flex-1">
              {createMut.isPending ? 'Creating…' : 'Create Ticket'}
            </ModalPrimaryButton>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
