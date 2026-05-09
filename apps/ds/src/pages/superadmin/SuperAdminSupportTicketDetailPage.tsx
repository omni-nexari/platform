import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Paperclip, Send, X } from 'lucide-react';
import type { SupportTicketDetail, SupportTicketMessage, SupportStatus, SupportPriority } from '@signage/shared';
import { saApi, saFetch } from '../../lib/superadmin-auth.js';
import {
  Badge, InlineActionButton, SectionCard, SectionCardBody, SectionCardHeader, Skeleton,
} from '../../components/UiPrimitives.js';

const STATUS_TONES: Record<string, 'neutral' | 'accent' | 'success' | 'danger'> = {
  open: 'accent', in_progress: 'neutral', resolved: 'success', closed: 'neutral',
};
const PRIORITY_TONES: Record<string, 'neutral' | 'accent' | 'danger'> = {
  low: 'neutral', medium: 'neutral', high: 'accent', urgent: 'danger',
};

function MessageBubble({ msg }: { msg: SupportTicketMessage }) {
  const isSA = msg.senderType === 'superadmin';
  return (
    <div className={`flex gap-3 ${isSA ? 'flex-row-reverse' : 'flex-row'}`}>
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
        style={{ background: isSA ? 'var(--blue)' : 'var(--accent, #4ff2d1)', color: isSA ? '#fff' : '#0f1115' }}
      >
        {msg.senderName[0]?.toUpperCase()}
      </div>
      <div className={`max-w-[75%] space-y-1 ${isSA ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span className="font-medium">{msg.senderName}</span>
          <span>·</span>
          <span>{new Date(msg.createdAt).toLocaleString()}</span>
        </div>
        <div
          className="rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap"
          style={{
            background: isSA ? 'var(--blue)' : 'var(--bg2)',
            color: isSA ? '#fff' : 'var(--text)',
            borderRadius: isSA ? '18px 4px 18px 18px' : '4px 18px 18px 18px',
          }}
        >
          {msg.body}
        </div>
        {msg.attachmentUrls.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1">
            {msg.attachmentUrls.map(url => (
              <a key={url} href={url} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-xs text-[var(--blue)] hover:underline"
              >
                <Paperclip size={11} /> Attachment
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SuperAdminSupportTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [reply, setReply] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['sa-support-ticket', id],
    queryFn: () => saApi.get<SupportTicketDetail>(`/superadmin/support/tickets/${id}`),
    refetchInterval: 30_000,
    enabled: !!id,
  });

  const replyMut = useMutation({
    mutationFn: async (payload: { body: string; attachmentUrls?: string[] }) =>
      saApi.post(`/superadmin/support/tickets/${id}/messages`, payload),
    onSuccess: () => {
      setReply('');
      setPendingFiles([]);
      void qc.invalidateQueries({ queryKey: ['sa-support-ticket', id] });
      void qc.invalidateQueries({ queryKey: ['sa-support-tickets'] });
      void qc.invalidateQueries({ queryKey: ['sa-support-unread'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to send'),
  });

  const patchMut = useMutation({
    mutationFn: (payload: { status?: SupportStatus; priority?: SupportPriority }) =>
      saApi.patch(`/superadmin/support/tickets/${id}`, payload),
    onSuccess: () => {
      toast.success('Updated');
      void qc.invalidateQueries({ queryKey: ['sa-support-ticket', id] });
      void qc.invalidateQueries({ queryKey: ['sa-support-tickets'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed'),
  });

  const handleSend = async () => {
    if (!reply.trim() && pendingFiles.length === 0) return;
    let attachmentUrls: string[] = [];
    if (pendingFiles.length > 0) {
      setUploading(true);
      try {
        const uploads = await Promise.all(pendingFiles.map(async (file) => {
          const fd = new FormData();
          fd.append('file', file);
          const res = await saFetch<{ url: string }>(`/superadmin/support/tickets/${id}/attachments`, { method: 'POST', body: fd });
          return res.url;
        }));
        attachmentUrls = uploads;
      } catch {
        toast.error('Failed to upload attachments');
        setUploading(false);
        return;
      }
      setUploading(false);
    }
    replyMut.mutate({ body: reply.trim() || '(attachment)', attachmentUrls });
  };

  if (isLoading) {
    return <div className="page-container space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (!ticket) return <div className="page-container"><p className="text-[var(--text-muted)]">Ticket not found.</p></div>;

  return (
    <div className="page-container space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/superadmin/support')} className="text-[var(--text-muted)] hover:text-[var(--text)]">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate">{ticket.subject}</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">{ticket.partyName} · {ticket.submittedByName}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Badge tone={STATUS_TONES[ticket.status] ?? 'neutral'}>{ticket.status.replace('_', ' ')}</Badge>
          <Badge tone={PRIORITY_TONES[ticket.priority] ?? 'neutral'}>{ticket.priority}</Badge>
        </div>
      </div>

      {/* Inline controls */}
      <SectionCard>
        <SectionCardHeader>Ticket Settings</SectionCardHeader>
        <SectionCardBody className="flex flex-wrap gap-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Status</label>
            <select
              value={ticket.status}
              onChange={e => patchMut.mutate({ status: e.target.value as SupportStatus })}
              className="input"
            >
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Priority</label>
            <select
              value={ticket.priority}
              onChange={e => patchMut.mutate({ priority: e.target.value as SupportPriority })}
              className="input"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
        </SectionCardBody>
      </SectionCard>

      {/* Thread */}
      <SectionCard>
        <SectionCardHeader>Conversation</SectionCardHeader>
        <SectionCardBody className="space-y-6">
          {ticket.messages.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No messages yet. Start the conversation below.</p>
          ) : (
            ticket.messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)
          )}
        </SectionCardBody>
      </SectionCard>

      {/* Reply box */}
      {ticket.status !== 'closed' && (
        <SectionCard>
          <SectionCardHeader>Reply</SectionCardHeader>
          <SectionCardBody className="space-y-3">
            <textarea
              value={reply}
              onChange={e => setReply(e.target.value)}
              rows={4}
              placeholder="Write your reply…"
              className="input w-full resize-none"
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend(); }}
            />
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {pendingFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-1 rounded-lg border px-2 py-1 text-xs" style={{ borderColor: 'var(--card-border)' }}>
                    <Paperclip size={11} />
                    <span>{f.name}</span>
                    <button onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))} className="text-[var(--text-muted)] hover:text-[var(--danger)]"><X size={11} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="workspace-page-action flex items-center gap-1.5"
              >
                <Paperclip size={14} /> Attach
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.csv,.zip"
                className="hidden"
                onChange={e => setPendingFiles(prev => [...prev, ...Array.from(e.target.files ?? [])])}
              />
              <button
                onClick={handleSend}
                disabled={replyMut.isPending || uploading || (!reply.trim() && pendingFiles.length === 0)}
                className="btn-primary flex items-center gap-1.5 ml-auto"
              >
                <Send size={14} />
                {uploading ? 'Uploading…' : replyMut.isPending ? 'Sending…' : 'Send'}
              </button>
            </div>
            <p className="text-[10px] text-[var(--text-muted)]">Ctrl+Enter to send</p>
          </SectionCardBody>
        </SectionCard>
      )}
    </div>
  );
}
