/**
 * Floating AI Assistant widget — mounted in AppLayout so it's available on
 * every page. Uses Server-Sent Events for streaming responses from /ai/chat.
 *
 * Phase 2: navigation help + Q&A. Phase 3 will add tool-calling for
 * playlist / schedule creation.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Send, X, Plus, MessageSquare, Loader2, AlertCircle, Sparkles } from 'lucide-react';
import { api } from '../lib/api.js';

interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt: string;
}

interface ChatSession {
  id: string;
  workspaceId: string;
  userId: string;
  title: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AiAssistantProps {
  workspaceId: string;
}

type DraftMessage = { id: string; role: 'user' | 'assistant'; content: string; pending?: boolean };

const STREAM_URL = '/api/v1/ai/chat';

export default function AiAssistant({ workspaceId }: AiAssistantProps) {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const [liveMessages, setLiveMessages] = useState<DraftMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // ── AI health ping (drives "unavailable" banner) ────────────────────────
  const { data: health } = useQuery<{ available: boolean; model: string }>({
    queryKey: ['ai', 'health'],
    queryFn: () => api.get('/ai/health'),
    enabled: open,
    refetchInterval: open ? 30_000 : false,
    refetchOnWindowFocus: false,
  });

  // ── Sessions list ────────────────────────────────────────────────────────
  const { data: sessionsData } = useQuery<{ sessions: ChatSession[] }>({
    queryKey: ['ai', 'sessions', workspaceId],
    queryFn: () => api.get(`/ai/sessions?workspaceId=${workspaceId}`),
    enabled: open,
  });

  // ── Messages for active session ──────────────────────────────────────────
  const { data: messagesData } = useQuery<{ session: ChatSession; messages: ChatMessage[] }>({
    queryKey: ['ai', 'messages', sessionId],
    queryFn: () => api.get(`/ai/sessions/${sessionId}/messages`),
    enabled: !!sessionId && open,
  });

  // Merge persisted messages with in-flight streaming ones.
  const persisted: DraftMessage[] = (messagesData?.messages ?? [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ id: m.id, role: m.role as 'user' | 'assistant', content: m.content }));
  const visibleMessages: DraftMessage[] = streaming || liveMessages.length > 0
    ? [...persisted, ...liveMessages]
    : persisted;

  // Auto-scroll to bottom on new content.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleMessages.length, liveMessages, open]);

  function newChat() {
    abortRef.current?.abort();
    setSessionId(null);
    setLiveMessages([]);
    setError(null);
    setShowSessions(false);
  }

  function selectSession(id: string) {
    abortRef.current?.abort();
    setSessionId(id);
    setLiveMessages([]);
    setError(null);
    setShowSessions(false);
  }

  async function sendMessage() {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft('');
    setError(null);

    const userId = `live-user-${Date.now()}`;
    const assistantId = `live-asst-${Date.now()}`;
    setLiveMessages([
      { id: userId, role: 'user', content: text },
      { id: assistantId, role: 'assistant', content: '', pending: true },
    ]);
    setStreaming(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let currentSessionId = sessionId;
    let assistantText = '';

    try {
      // Manually fetch SSE so we can use cookies + handle aborts cleanly.
      const csrf = document.cookie.match(/(?:^|; )csrf_token=([^;]+)/)?.[1];
      const res = await fetch(STREAM_URL, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {}),
        },
        body: JSON.stringify({
          workspaceId,
          sessionId: currentSessionId ?? undefined,
          message: text,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const body = await res.text();
        if (res.status === 503) {
          throw new Error('AI assistant is temporarily unavailable. Please try again in a moment.');
        }
        throw new Error(body || `Request failed with ${res.status}`);
      }
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line.
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const rawFrame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);

          for (const line of rawFrame.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            try {
              const evt = JSON.parse(data) as
                | { type: 'session'; sessionId: string }
                | { type: 'delta'; text: string }
                | { type: 'done'; messageId?: string }
                | { type: 'error'; message: string };

              if (evt.type === 'session') {
                if (!currentSessionId) {
                  currentSessionId = evt.sessionId;
                  setSessionId(evt.sessionId);
                }
              } else if (evt.type === 'delta') {
                assistantText += evt.text;
                setLiveMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, content: assistantText, pending: true } : m)),
                );
              } else if (evt.type === 'done') {
                setLiveMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, content: assistantText, pending: false } : m)),
                );
              } else if (evt.type === 'error') {
                throw new Error(evt.message);
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) continue;
              throw parseErr;
            }
          }
        }
      }

      // Invalidate queries so persisted history shows up; clear live overlay.
      await queryClient.invalidateQueries({ queryKey: ['ai', 'sessions', workspaceId] });
      if (currentSessionId) {
        await queryClient.invalidateQueries({ queryKey: ['ai', 'messages', currentSessionId] });
      }
      setLiveMessages([]);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // Cancelled by user — keep partial assistant text but stop the spinner.
        setLiveMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: assistantText || '(cancelled)', pending: false } : m)),
        );
      } else {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(msg);
        setLiveMessages([]);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <>
      {/* ── Floating button ─────────────────────────────────────────────── */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open AI assistant"
          className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-gradient-to-br from-[var(--blue)] to-purple-600 text-white shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center"
        >
          <Bot className="w-6 h-6" />
        </button>
      )}

      {/* ── Slide-in panel ───────────────────────────────────────────────── */}
      {open && (
        <div className="fixed bottom-6 right-6 z-40 w-[400px] max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-6rem)] flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-elevated,var(--surface))]">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--blue)] to-purple-600 flex items-center justify-center text-white">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-[var(--text)]">AI Assistant</div>
              <div className="text-[11px] text-[var(--text-muted)] truncate">
                {health?.available === false ? 'Offline' : (health?.model ?? 'Local model')}
              </div>
            </div>
            <button
              onClick={() => setShowSessions((s) => !s)}
              aria-label="Chat history"
              title="Chat history"
              className="p-1.5 rounded hover:bg-[var(--surface-hover,rgba(0,0,0,0.05))] text-[var(--text-muted)]"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
            <button
              onClick={newChat}
              aria-label="New chat"
              title="New chat"
              className="p-1.5 rounded hover:bg-[var(--surface-hover,rgba(0,0,0,0.05))] text-[var(--text-muted)]"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="p-1.5 rounded hover:bg-[var(--surface-hover,rgba(0,0,0,0.05))] text-[var(--text-muted)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Unavailable banner */}
          {health?.available === false && (
            <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              AI assistant is temporarily unavailable.
            </div>
          )}

          {/* Sessions dropdown */}
          {showSessions && (
            <div className="border-b border-[var(--border)] max-h-48 overflow-y-auto bg-[var(--surface-elevated,var(--surface))]">
              {sessionsData?.sessions.length === 0 && (
                <div className="px-4 py-3 text-xs text-[var(--text-muted)]">No previous chats.</div>
              )}
              {sessionsData?.sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => selectSession(s.id)}
                  className={`w-full text-left px-4 py-2 text-xs hover:bg-[var(--surface-hover,rgba(0,0,0,0.05))] border-b border-[var(--border)] last:border-0 ${
                    s.id === sessionId ? 'bg-[var(--surface-hover,rgba(0,0,0,0.05))]' : ''
                  }`}
                >
                  <div className="font-medium text-[var(--text)] truncate">{s.title ?? 'Untitled chat'}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">
                    {new Date(s.updatedAt).toLocaleString()}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {visibleMessages.length === 0 && !streaming && (
              <div className="text-center text-[var(--text-muted)] text-sm py-12">
                <Bot className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <div className="font-medium mb-1">How can I help?</div>
                <div className="text-xs">
                  Ask about playlists, schedules, devices, or how to do anything in Omni Signage.
                </div>
              </div>
            )}

            {visibleMessages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${
                    m.role === 'user'
                      ? 'bg-[var(--blue)] text-white rounded-br-sm'
                      : 'bg-[var(--surface-elevated,rgba(0,0,0,0.04))] text-[var(--text)] rounded-bl-sm'
                  }`}
                >
                  {m.content || (m.pending ? <Loader2 className="w-4 h-4 animate-spin" /> : '')}
                </div>
              </div>
            ))}

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-[var(--border)] p-3 bg-[var(--surface-elevated,var(--surface))]">
            <div className="flex gap-2 items-end">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask anything…"
                rows={1}
                disabled={streaming || health?.available === false}
                className="flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--blue)] disabled:opacity-50 max-h-32"
                style={{ minHeight: '38px' }}
              />
              <button
                onClick={sendMessage}
                disabled={!draft.trim() || streaming || health?.available === false}
                aria-label="Send"
                className="shrink-0 w-9 h-9 rounded-lg bg-[var(--blue)] text-white flex items-center justify-center hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
