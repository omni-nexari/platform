import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Paperclip, Send, X } from 'lucide-react';
import type { SupportTicketDetail, SupportTicketMessage } from '@signage/shared';
import { saApi, saFetch } from '../../lib/superadmin-auth.js';
import {
  Badge, SectionCard, SectionCardBody, SectionCardHeader, Skeleton,
} from '../../components/UiPrimitives.js';

const STATUS_TONES: Record<string, 'neutral' | 'accent' | 'success' | 'danger'> = {
  open: 'accent', in_progress: 'neutral', resolved: 'success', closed: 'neutral',
};

function MessageBubble({ msg, isMine }: { msg: SupportTicketMessage; isMine: boolean }) {
  return (
    <div className={`flex gap-3 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
        style={{ background: isMine ? 'var(--blue)' : 'var(--accent, #4ff2d1)', color: isMine ? '#fff' : '#0f1115' }}
      >
        {msg.senderName[0]?.toUpperCase()}
      </div>
      <div className={`max-w-[75%] space-y-1 ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span className="font-medium">{msg.senderName}</span>
          <span>·</span>
          <span>{new Date(msg.createdAt).toLocaleString()}</span>
        </div>
        <div
          className="rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap"
          style={{
            background: isMine ? 'var(--blue)' : 'var(--bg2)',
            color: isMine ? '#fff' : 'var(--text)',
            borderRadius: isMine ? '18px 4px 18px 18px' : '4px 18px 18px 18px',
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

export default function ManagementSupportTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [reply, setReply] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['mgmt-support-ticket', id],
    queryFn: () => saApi.get<SupportTicketDetail>(`/superadmin/support/reseller/tickets/${id}`),
    refetchInterval: 30_000,
    enabled: !!id,
  });

  const replyMut = useMutation({
    mutationFn: async (payload: { body: string; attachmentUrls?: string[] }) =>
      saApi.post(`/superadmin/support/reseller/tickets/${id}/messages`, payload),
    onSuccess: () => {
      setReply('');
      setPendingFiles([]);
      void qc.invalidateQueries({ queryKey: ['mgmt-support-ticket', id] });
      void qc.invalidateQueries({ queryKey: ['mgmt-support-tickets'] });
      void qc.invalidateQueries({ queryKey: ['mgmt-support-unread'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to send'),
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
          const res = await saFetch<{ url: string }>(`/superadmin/support/reseller/tickets/${id}/attachments`, { method: 'POST', body: fd });
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
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/management/support')} className="text-[var(--text-muted)] hover:text-[var(--text)]">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate">{ticket.subject}</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">Submitted by {ticket.submittedByName}</p>
          </div>
        </div>
        <Badge tone={STATUS_TONES[ticket.status] ?? 'neutral'}>{ticket.status.replace('_', ' ')}</Badge>
      </div>

      <SectionCard>
        <SectionCardHeader>Conversation</SectionCardHeader>
        <SectionCardBody className="space-y-6">
          {ticket.messages.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No messages yet. Start the conversation below.</p>
          ) : (
            ticket.messages.map(msg => (
              <MessageBubble key={msg.id} msg={msg} isMine={msg.senderType === 'reseller'} />
            ))
          )}
        </SectionCardBody>
      </SectionCard>

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
                    <Paperclip size={11} /><span>{f.name}</span>
                    <button onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))} className="text-[var(--text-muted)] hover:text-[var(--danger)]"><X size={11} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => fileInputRef.current?.click()} className="workspace-page-action flex items-center gap-1.5">
                <Paperclip size={14} /> Attach
              </button>
              <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.txt,.csv,.zip" className="hidden"
                onChange={e => setPendingFiles(prev => [...prev, ...Array.from(e.target.files ?? [])])} />
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
