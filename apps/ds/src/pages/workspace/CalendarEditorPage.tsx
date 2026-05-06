/**
 * Calendar wizard — pick a connection + view + filters + style and save as a
 * `calendar` content item.  After save the player polls events server-side.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft, ArrowRight, Save, CalendarDays, CalendarRange,
  Calendar, MapPin, Filter, Lock, Palette, Clock,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { ActionButton, Skeleton, Badge, Callout, SectionCard, SectionCardHeader, SectionCardBody } from '../../components/UiPrimitives.js';

interface ContentItem {
  id: string;
  name: string;
  type: string;
  metadata: string;
  duration: number | null;
}

interface Connection {
  id: string;
  scope: 'workspace' | 'personal';
  provider: 'google' | 'microsoft' | 'apple_caldav' | 'ics';
  displayName: string;
  accountEmail: string | null;
  status: string;
}

interface RemoteCalendar {
  externalCalendarId: string;
  name: string;
  colorHex: string | null;
  isPrimary: boolean;
  kind: 'user' | 'room' | 'equipment' | 'group';
  capacity: number | null;
  locationLabel: string | null;
}

interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  location?: string | null;
  start: string;
  end: string;
  allDay: boolean;
  isPrivate: boolean;
  status?: string;
}

type View = 'day' | 'week' | 'month' | 'meeting_room';
type RenderMode = 'native' | 'image';
type Privacy = 'titles' | 'busy_only';

interface Form {
  name: string;
  connectionId: string | null;
  view: View;
  selectedCalendarIds: string[];
  keywordFilter: string;
  privacyMode: Privacy;
  timezone: string;
  renderMode: RenderMode;
  refreshSeconds: number;
  duration: number;
  roomMeta: {
    name: string;
    capacity: string;
    location: string;
    bookingUrl: string;
  };
  theme: {
    accentColor: string;
    background: 'light' | 'dark';
  };
}

const DEFAULTS: Form = {
  name: 'Calendar',
  connectionId: null,
  view: 'week',
  selectedCalendarIds: [],
  keywordFilter: '',
  privacyMode: 'titles',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  renderMode: 'native',
  refreshSeconds: 60,
  duration: 30,
  roomMeta: { name: '', capacity: '', location: '', bookingUrl: '' },
  theme: { accentColor: '#4f46e5', background: 'light' },
};

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Singapore', 'Asia/Kolkata', 'Asia/Dubai',
  'Australia/Sydney',
];

export default function CalendarEditorPage() {
  const { wsId, id } = useParams<{ wsId: string; id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(DEFAULTS);
  const [saving, setSaving] = useState(false);

  const itemQuery = useQuery<ContentItem>({
    queryKey: ['content-item', id],
    enabled: !!id && !isNew,
    queryFn: () => api.get(`/content/${id}`),
  });

  // Hydrate form from existing content item.
  useEffect(() => {
    const item = itemQuery.data;
    if (!item) return;
    setForm((f) => {
      let meta: Partial<Form> & Record<string, unknown> = {};
      try { meta = JSON.parse(item.metadata ?? '{}'); } catch { /* ignore */ }
      return {
        ...f,
        name: item.name,
        duration: item.duration ?? f.duration,
        connectionId: (meta as any).connectionId ?? f.connectionId,
        view: ((meta as any).view as View) ?? f.view,
        selectedCalendarIds: (meta as any).selectedCalendarIds ?? f.selectedCalendarIds,
        keywordFilter: (meta as any).keywordFilter ?? '',
        privacyMode: ((meta as any).privacyMode as Privacy) ?? f.privacyMode,
        timezone: (meta as any).timezone ?? f.timezone,
        renderMode: ((meta as any).renderMode as RenderMode) ?? f.renderMode,
        refreshSeconds: (meta as any).refreshSeconds ?? f.refreshSeconds,
        roomMeta: { ...f.roomMeta, ...((meta as any).roomMeta ?? {}) } as Form['roomMeta'],
        theme: { ...f.theme, ...((meta as any).theme ?? {}) } as Form['theme'],
      };
    });
  }, [itemQuery.data]);

  const connectionsQuery = useQuery<Connection[]>({
    queryKey: ['calendar-connections', wsId],
    enabled: !!wsId,
    queryFn: () => api.get(`/integrations/calendar/connections?workspaceId=${wsId}`),
  });

  const calendarsQuery = useQuery<RemoteCalendar[]>({
    queryKey: ['calendar-connection-calendars', form.connectionId],
    enabled: !!form.connectionId,
    queryFn: () => api.get(`/integrations/calendar/connections/${form.connectionId}/calendars`),
  });

  const previewQuery = useQuery<{ events: CalendarEvent[] }>({
    queryKey: ['calendar-preview', form.connectionId, form.selectedCalendarIds.join(','), form.keywordFilter],
    enabled: !!form.connectionId,
    queryFn: () => {
      const params = new URLSearchParams();
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const to = new Date(from); to.setDate(to.getDate() + 7);
      params.set('from', from.toISOString());
      params.set('to', to.toISOString());
      if (form.selectedCalendarIds.length) params.set('calendarIds', form.selectedCalendarIds.join(','));
      if (form.keywordFilter.trim()) params.set('keyword', form.keywordFilter.trim());
      return api.get(`/integrations/calendar/connections/${form.connectionId}/preview?${params.toString()}`);
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.connectionId) throw new Error('Pick a calendar connection first');
      const body = {
        workspaceId: wsId,
        name: form.name.trim() || 'Calendar',
        connectionId: form.connectionId,
        view: form.view,
        selectedCalendarIds: form.selectedCalendarIds,
        keywordFilter: form.keywordFilter.trim() || null,
        privacyMode: form.privacyMode,
        timezone: form.timezone,
        renderMode: form.renderMode,
        refreshSeconds: form.refreshSeconds,
        duration: form.duration,
        roomMeta: form.view === 'meeting_room' ? {
          name: form.roomMeta.name.trim() || null,
          capacity: form.roomMeta.capacity ? Number(form.roomMeta.capacity) : null,
          location: form.roomMeta.location.trim() || null,
          bookingUrl: form.roomMeta.bookingUrl.trim() || null,
        } : null,
        theme: form.theme,
      };
      if (isNew) {
        return api.post<ContentItem>('/content/calendar', body);
      }
      return api.patch<ContentItem>(`/content/${id}/calendar`, body);
    },
    onSuccess: (created) => {
      toast.success(isNew ? 'Calendar content created' : 'Calendar saved');
      const cid = (created as ContentItem)?.id ?? id;
      navigate(`/workspaces/${wsId}/content?openId=${cid}`);
    },
    onError: (err: unknown) => {
      let detail: string | null = null;
      const m = err instanceof Error ? err.message : String(err);
      try { const j = JSON.parse(m); detail = j?.detail ?? j?.error ?? null; } catch { /* not json */ }
      toast.error(detail ?? m ?? 'Save failed');
    },
  });

  const totalSteps = 5;
  const stepNames = ['Source', 'View', 'Timezone', 'Render', 'Style'];

  function patch<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const canNext = useMemo(() => {
    if (step === 0) return !!form.connectionId;
    return true;
  }, [step, form.connectionId]);

  if (!wsId) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)] bg-[var(--card)]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/workspaces/${wsId}/content`)}
            className="p-1.5 rounded hover:bg-[var(--surface)] text-[var(--text-muted)]"
          >
            <ArrowLeft size={16} />
          </button>
          <input
            value={form.name}
            onChange={(e) => patch('name', e.target.value)}
            className="text-base font-semibold bg-transparent text-[var(--text)] focus:outline-none focus:bg-[var(--surface)] px-2 py-1 rounded"
          />
          <Badge tone="accent">Calendar</Badge>
        </div>
        <div className="flex items-center gap-2">
          {stepNames.map((n, i) => (
            <button
              key={n}
              onClick={() => setStep(i)}
              className={`px-2 py-1 rounded text-xs ${i === step ? 'bg-[var(--blue)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--surface)]'}`}
            >
              {i + 1}. {n}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {step > 0 && <ActionButton onClick={() => setStep((s) => s - 1)}>Back</ActionButton>}
          {step < totalSteps - 1 ? (
            <ActionButton onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
              Next <ArrowRight size={14} />
            </ActionButton>
          ) : (
            <ActionButton
              onClick={() => { setSaving(true); save.mutate(undefined, { onSettled: () => setSaving(false) }); }}
              disabled={saving || !form.connectionId}
            >
              <Save size={14} /> {isNew ? 'Save' : 'Update'}
            </ActionButton>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto bg-[var(--bg)]">
        <div className="max-w-3xl mx-auto p-6 space-y-6">
          {/* Step 0 — Source */}
          {step === 0 && (
            <SectionCard>
              <SectionCardHeader>
                <h3 className="text-sm font-semibold"><CalendarDays size={14} className="inline mr-1.5 mb-0.5" />Source</h3>
              </SectionCardHeader>
              <SectionCardBody>
                {connectionsQuery.isLoading && <Skeleton className="h-12" />}
                {connectionsQuery.data?.length === 0 && (
                  <Callout tone="warning">
                    No calendar connections yet.{' '}
                    <a href="/settings?section=integrations" className="underline">Add one in Settings → Integrations</a>.
                  </Callout>
                )}
                <div className="grid grid-cols-1 gap-2">
                  {(connectionsQuery.data ?? []).map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { patch('connectionId', c.id); patch('selectedCalendarIds', []); }}
                      className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                        form.connectionId === c.id
                          ? 'border-[var(--blue)] bg-[var(--blue)]/10'
                          : 'border-[var(--border)] hover:bg-[var(--surface)]'
                      }`}
                    >
                      <CalendarDays size={16} className="text-[var(--text-muted)]" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text)] truncate">{c.displayName}</p>
                        <p className="text-xs text-[var(--text-muted)] truncate">
                          {c.provider} · {c.scope === 'workspace' ? 'Workspace' : 'Just you'}
                        </p>
                      </div>
                      <Badge tone={c.status === 'active' ? 'success' : 'danger'}>{c.status}</Badge>
                    </button>
                  ))}
                </div>

                {form.connectionId && (
                  <div className="mt-5">
                    <p className="text-xs font-semibold uppercase text-[var(--text-muted)] mb-2">
                      Calendars to include
                    </p>
                    {calendarsQuery.isLoading && <Skeleton className="h-10" />}
                    {!calendarsQuery.isLoading && (calendarsQuery.data ?? []).length === 0 && (
                      <p className="text-xs text-[var(--text-muted)]">
                        No calendars synced. Open Settings → Integrations and click refresh on this connection.
                      </p>
                    )}
                    <div className="space-y-1">
                      {(calendarsQuery.data ?? []).map((rc) => {
                        const checked = form.selectedCalendarIds.includes(rc.externalCalendarId);
                        return (
                          <label key={rc.externalCalendarId} className="flex items-center gap-2 p-2 rounded hover:bg-[var(--surface)] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const next = checked
                                  ? form.selectedCalendarIds.filter((x) => x !== rc.externalCalendarId)
                                  : [...form.selectedCalendarIds, rc.externalCalendarId];
                                patch('selectedCalendarIds', next);
                              }}
                            />
                            {rc.colorHex && (
                              <span className="w-3 h-3 rounded-full" style={{ background: rc.colorHex }} />
                            )}
                            <span className="text-sm text-[var(--text)] flex-1">{rc.name}</span>
                            {rc.kind === 'room' && <Badge tone="info">Room</Badge>}
                            {rc.capacity && <span className="text-xs text-[var(--text-muted)]">cap {rc.capacity}</span>}
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-2">
                      Leave all unchecked to include the primary calendar only.
                    </p>
                  </div>
                )}
              </SectionCardBody>
            </SectionCard>
          )}

          {/* Step 1 — View */}
          {step === 1 && (
            <SectionCard>
              <SectionCardHeader>
                <h3 className="text-sm font-semibold"><Calendar size={14} className="inline mr-1.5 mb-0.5" />View</h3>
              </SectionCardHeader>
              <SectionCardBody>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { id: 'day', label: 'Day', desc: 'Today\'s schedule', icon: <Calendar size={18} /> },
                    { id: 'week', label: 'Week', desc: 'Mon–Sun', icon: <CalendarRange size={18} /> },
                    { id: 'month', label: 'Month', desc: 'Whole month grid', icon: <CalendarDays size={18} /> },
                    { id: 'meeting_room', label: 'Meeting room', desc: 'Room status + next meetings', icon: <MapPin size={18} /> },
                  ] as { id: View; label: string; desc: string; icon: React.ReactNode }[]).map((v) => (
                    <button
                      key={v.id}
                      onClick={() => patch('view', v.id)}
                      className={`flex flex-col items-start gap-1 p-4 rounded-lg border text-left ${
                        form.view === v.id
                          ? 'border-[var(--blue)] bg-[var(--blue)]/10'
                          : 'border-[var(--border)] hover:bg-[var(--surface)]'
                      }`}
                    >
                      <div className="flex items-center gap-2">{v.icon}<span className="text-sm font-medium text-[var(--text)]">{v.label}</span></div>
                      <p className="text-xs text-[var(--text-muted)]">{v.desc}</p>
                    </button>
                  ))}
                </div>

                {form.view === 'meeting_room' && (
                  <div className="mt-5 space-y-3">
                    <p className="text-xs font-semibold uppercase text-[var(--text-muted)]">Room metadata</p>
                    <div className="grid grid-cols-2 gap-3">
                      <input className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)]"
                        placeholder="Room name" value={form.roomMeta.name}
                        onChange={(e) => patch('roomMeta', { ...form.roomMeta, name: e.target.value })} />
                      <input type="number" min="0" className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)]"
                        placeholder="Capacity" value={form.roomMeta.capacity}
                        onChange={(e) => patch('roomMeta', { ...form.roomMeta, capacity: e.target.value })} />
                      <input className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)]"
                        placeholder="Location / floor" value={form.roomMeta.location}
                        onChange={(e) => patch('roomMeta', { ...form.roomMeta, location: e.target.value })} />
                      <input className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)]"
                        placeholder="Booking URL (optional)" value={form.roomMeta.bookingUrl}
                        onChange={(e) => patch('roomMeta', { ...form.roomMeta, bookingUrl: e.target.value })} />
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">
                      The booking URL becomes a QR code on the player so guests can scan to book the room.
                    </p>
                  </div>
                )}

                <div className="mt-5 space-y-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-[var(--text-muted)] mb-1 flex items-center gap-1">
                      <Filter size={12} /> Keyword filter (optional)
                    </label>
                    <input
                      placeholder="Only show events containing…"
                      value={form.keywordFilter}
                      onChange={(e) => patch('keywordFilter', e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase text-[var(--text-muted)] mb-1 flex items-center gap-1">
                      <Lock size={12} /> Privacy
                    </label>
                    <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden">
                      <button
                        onClick={() => patch('privacyMode', 'titles')}
                        className={`px-3 py-1.5 text-xs ${form.privacyMode === 'titles' ? 'bg-[var(--blue)] text-white' : 'text-[var(--text-muted)]'}`}
                      >Show titles</button>
                      <button
                        onClick={() => patch('privacyMode', 'busy_only')}
                        className={`px-3 py-1.5 text-xs ${form.privacyMode === 'busy_only' ? 'bg-[var(--blue)] text-white' : 'text-[var(--text-muted)]'}`}
                      >Busy only</button>
                    </div>
                  </div>
                </div>
              </SectionCardBody>
            </SectionCard>
          )}

          {/* Step 2 — Timezone */}
          {step === 2 && (
            <SectionCard>
              <SectionCardHeader>
                <h3 className="text-sm font-semibold"><Clock size={14} className="inline mr-1.5 mb-0.5" />Timezone</h3>
              </SectionCardHeader>
              <SectionCardBody>
                <select
                  value={form.timezone}
                  onChange={(e) => patch('timezone', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)]"
                >
                  {!COMMON_TIMEZONES.includes(form.timezone) && <option value={form.timezone}>{form.timezone}</option>}
                  {COMMON_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
                <p className="text-xs text-[var(--text-muted)] mt-2">
                  Pick the building's local time. The player converts each event into this timezone for display.
                </p>
              </SectionCardBody>
            </SectionCard>
          )}

          {/* Step 3 — Render mode */}
          {step === 3 && (
            <SectionCard>
              <SectionCardHeader>
                <h3 className="text-sm font-semibold"><Calendar size={14} className="inline mr-1.5 mb-0.5" />Render mode</h3>
              </SectionCardHeader>
              <SectionCardBody>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => patch('renderMode', 'native')}
                    className={`p-4 rounded-lg border text-left ${form.renderMode === 'native' ? 'border-[var(--blue)] bg-[var(--blue)]/10' : 'border-[var(--border)] hover:bg-[var(--surface)]'}`}
                  >
                    <p className="text-sm font-medium text-[var(--text)]">Native</p>
                    <p className="text-xs text-[var(--text-muted)]">Player renders HTML/Canvas locally — best on Tizen / Pi.</p>
                  </button>
                  <button
                    onClick={() => patch('renderMode', 'image')}
                    className={`p-4 rounded-lg border text-left ${form.renderMode === 'image' ? 'border-[var(--blue)] bg-[var(--blue)]/10' : 'border-[var(--border)] hover:bg-[var(--surface)]'}`}
                  >
                    <p className="text-sm font-medium text-[var(--text)]">Image</p>
                    <p className="text-xs text-[var(--text-muted)]">Server pre-renders a PNG — useful for low-powered displays.</p>
                  </button>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-[var(--text-muted)] mb-1">Refresh (sec)</label>
                    <input
                      type="number" min="15" max="3600"
                      value={form.refreshSeconds}
                      onChange={(e) => patch('refreshSeconds', Math.max(15, Number(e.target.value) || 60))}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase text-[var(--text-muted)] mb-1">Slot duration (sec)</label>
                    <input
                      type="number" min="5" max="3600"
                      value={form.duration}
                      onChange={(e) => patch('duration', Math.max(5, Number(e.target.value) || 30))}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)]"
                    />
                  </div>
                </div>
              </SectionCardBody>
            </SectionCard>
          )}

          {/* Step 4 — Style + preview */}
          {step === 4 && (
            <SectionCard>
              <SectionCardHeader>
                <h3 className="text-sm font-semibold"><Palette size={14} className="inline mr-1.5 mb-0.5" />Style & preview</h3>
              </SectionCardHeader>
              <SectionCardBody>
                <div className="grid grid-cols-2 gap-3 mb-5">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-[var(--text-muted)] mb-1">Accent color</label>
                    <input
                      type="color" value={form.theme.accentColor}
                      onChange={(e) => patch('theme', { ...form.theme, accentColor: e.target.value })}
                      className="w-full h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase text-[var(--text-muted)] mb-1">Background</label>
                    <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden">
                      <button onClick={() => patch('theme', { ...form.theme, background: 'light' })} className={`px-3 py-1.5 text-xs ${form.theme.background === 'light' ? 'bg-[var(--blue)] text-white' : 'text-[var(--text-muted)]'}`}>Light</button>
                      <button onClick={() => patch('theme', { ...form.theme, background: 'dark' })} className={`px-3 py-1.5 text-xs ${form.theme.background === 'dark' ? 'bg-[var(--blue)] text-white' : 'text-[var(--text-muted)]'}`}>Dark</button>
                    </div>
                  </div>
                </div>

                <p className="text-xs font-semibold uppercase text-[var(--text-muted)] mb-2">Next 7 days</p>
                {previewQuery.isLoading && <Skeleton className="h-32" />}
                {previewQuery.isError && (
                  <Callout tone="danger">
                    Could not load events: {(previewQuery.error as any)?.response?.data?.detail ?? 'Unknown error'}
                  </Callout>
                )}
                {previewQuery.data && (
                  <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
                    {previewQuery.data.events.length === 0 && (
                      <div className="p-4 text-sm text-[var(--text-muted)]">No upcoming events in the next 7 days.</div>
                    )}
                    {previewQuery.data.events.slice(0, 12).map((e) => {
                      const start = new Date(e.start);
                      const end = new Date(e.end);
                      return (
                        <div key={e.id} className="flex items-start gap-3 p-3">
                          <div
                            className="w-1 self-stretch rounded-full"
                            style={{ background: form.theme.accentColor }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[var(--text)] truncate">
                              {form.privacyMode === 'busy_only' ? 'Busy' : (e.title || '(no title)')}
                            </p>
                            <p className="text-xs text-[var(--text-muted)]">
                              {e.allDay
                                ? 'All day'
                                : `${start.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleString([], { hour: 'numeric', minute: '2-digit' })}`}
                              {e.location && form.privacyMode === 'titles' ? ` · ${e.location}` : ''}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionCardBody>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}
