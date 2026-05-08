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
  Calendar, MapPin, Filter, Lock, Palette, Clock, Settings2,
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
  attendeeCount?: number;
}

type View = 'day' | 'week' | 'month' | 'meeting_room';
type Privacy = 'titles' | 'busy_only';
type ClockStyle = 'digital-12' | 'digital-24' | 'analog' | 'none';
type HeaderStyle = 'full' | 'compact' | 'none';
type FontStyle = 'sans' | 'mono' | 'rounded';

interface Form {
  name: string;
  connectionId: string | null;
  view: View;
  selectedCalendarIds: string[];
  keywordFilter: string;
  privacyMode: Privacy;
  timezone: string;
  refreshSeconds: number;
  duration: number;
  roomMeta: {
    name: string;
    capacity: string;
    location: string;
    bookingUrl: string;
    backgroundUrl: string;
    logoUrl: string;
  };
  theme: {
    accentColor: string;
    background: 'light' | 'dark';
    clockStyle: ClockStyle;
    headerStyle: HeaderStyle;
    fontStyle: FontStyle;
    showCurrentTimeLine: boolean;
    showWeekNumbers: boolean;
    showLocation: boolean;
    showAttendeeCount: boolean;
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
  refreshSeconds: 60,
  duration: 30,
  roomMeta: { name: '', capacity: '', location: '', bookingUrl: '', backgroundUrl: '', logoUrl: '' },
  theme: {
    accentColor: '#4f46e5',
    background: 'light',
    clockStyle: 'digital-24',
    headerStyle: 'full',
    fontStyle: 'sans',
    showCurrentTimeLine: true,
    showWeekNumbers: false,
    showLocation: true,
    showAttendeeCount: false,
  },
};

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Singapore', 'Asia/Kolkata', 'Asia/Dubai',
  'Australia/Sydney',
];

// ── CalendarPreview ──────────────────────────────────────────────────────────
function CalendarPreview({
  form, events, loading, error,
}: {
  form: Form;
  events: CalendarEvent[];
  loading: boolean;
  error: string | null;
}) {
  const isDark = form.theme.background === 'dark';
  const bg    = isDark ? '#111827' : '#ffffff';
  const card  = isDark ? '#1f2937' : '#f9fafb';
  const text  = isDark ? '#f3f4f6' : '#111827';
  const muted = isDark ? '#9ca3af' : '#6b7280';
  const border= isDark ? '#374151' : '#e5e7eb';
  const accent = form.theme.accentColor;

  const fontFamily =
    form.theme.fontStyle === 'mono'    ? 'monospace' :
    form.theme.fontStyle === 'rounded' ? 'ui-rounded, system-ui, sans-serif' :
                                         'system-ui, sans-serif';

  const now = new Date();
  const timeLabel = form.theme.clockStyle === 'digital-24'
    ? now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    : form.theme.clockStyle === 'digital-12'
    ? now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
    : form.theme.clockStyle === 'analog'
    ? '◷'
    : null;

  const dateLabel = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  const upcoming = events.slice(0, 8);

  return (
    <div
      className="min-h-[340px] p-4 space-y-3 transition-colors duration-200"
      style={{ background: bg, fontFamily }}
    >
      {/* Header */}
      {form.theme.headerStyle !== 'none' && (
        <div className="flex items-start justify-between">
          <div>
            {form.theme.headerStyle === 'full' && (
              <p className="text-xs font-medium" style={{ color: muted }}>{dateLabel}</p>
            )}
            <p className="text-lg font-bold leading-tight" style={{ color: text }}>
              {form.theme.headerStyle === 'compact' ? now.toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'Upcoming events'}
            </p>
          </div>
          {timeLabel && (
            <div
              className="text-xl font-bold tabular-nums px-2 py-1 rounded-lg"
              style={{ color: accent, background: `${accent}18` }}
            >
              {timeLabel}
            </div>
          )}
        </div>
      )}
      {!form.theme.headerStyle || form.theme.headerStyle === 'none' && timeLabel && (
        <div className="flex justify-end">
          <div className="text-xl font-bold tabular-nums px-2 py-1 rounded-lg" style={{ color: accent, background: `${accent}18` }}>
            {timeLabel}
          </div>
        </div>
      )}

      {/* Body */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: card }} />
          ))}
        </div>
      )}
      {error && (
        <div className="rounded-lg p-3 text-xs" style={{ background: '#fef2f2', color: '#dc2626' }}>
          {error}
        </div>
      )}
      {!loading && !error && upcoming.length === 0 && (
        <div className="text-sm text-center py-8" style={{ color: muted }}>No upcoming events</div>
      )}
      {!loading && !error && upcoming.map((ev) => {
        const start = new Date(ev.start);
        const end   = new Date(ev.end);
        const title = form.privacyMode === 'busy_only' ? 'Busy' : (ev.title || '(no title)');
        const timeStr = ev.allDay
          ? 'All day'
          : `${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
        return (
          <div
            key={ev.id}
            className="flex items-stretch gap-2 rounded-lg p-2.5"
            style={{ background: card, border: `1px solid ${border}` }}
          >
            <div className="w-1 rounded-full shrink-0" style={{ background: accent }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: text }}>{title}</p>
              <p className="text-xs truncate" style={{ color: muted }}>
                {timeStr}
                {form.theme.showLocation && ev.location && form.privacyMode === 'titles' ? ` · ${ev.location}` : ''}
                {form.theme.showAttendeeCount && typeof ev.attendeeCount === 'number' ? ` · ${ev.attendeeCount} attendees` : ''}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

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
        refreshSeconds: form.refreshSeconds,
        duration: form.duration,
        roomMeta: form.view === 'meeting_room' ? {
          name: form.roomMeta.name.trim() || null,
          capacity: form.roomMeta.capacity ? Number(form.roomMeta.capacity) : null,
          location: form.roomMeta.location.trim() || null,
          bookingUrl: form.roomMeta.bookingUrl.trim() || null,
          backgroundUrl: form.roomMeta.backgroundUrl.trim() || null,
          logoUrl: form.roomMeta.logoUrl.trim() || null,
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

  const totalSteps = 4;
  const stepNames = ['Source', 'View', 'Settings', 'Style'];

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
                    <div className="grid grid-cols-2 gap-3">
                      <input className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] font-mono"
                        placeholder="Logo image URL (optional)" value={form.roomMeta.logoUrl}
                        onChange={(e) => patch('roomMeta', { ...form.roomMeta, logoUrl: e.target.value })} />
                      <input className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] font-mono"
                        placeholder="Background image URL (optional)" value={form.roomMeta.backgroundUrl}
                        onChange={(e) => patch('roomMeta', { ...form.roomMeta, backgroundUrl: e.target.value })} />
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">
                      Bookable: when a Booking URL is set, the action buttons on the player become tappable and open the URL on touch displays.
                      Background image is shown faded behind the meeting list (light or dark theme).
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

          {/* Step 2 — Settings (timezone + refresh) */}
          {step === 2 && (
            <SectionCard>
              <SectionCardHeader>
                <h3 className="text-sm font-semibold"><Settings2 size={14} className="inline mr-1.5 mb-0.5" />Settings</h3>
              </SectionCardHeader>
              <SectionCardBody>
                <div className="space-y-5">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-[var(--text-muted)] mb-1 flex items-center gap-1">
                      <Clock size={12} /> Timezone
                    </label>
                    <select
                      value={form.timezone}
                      onChange={(e) => patch('timezone', e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)]"
                    >
                      {!COMMON_TIMEZONES.includes(form.timezone) && <option value={form.timezone}>{form.timezone}</option>}
                      {COMMON_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                    </select>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      Pick the building's local time. The player converts each event into this timezone for display.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase text-[var(--text-muted)] mb-1">Refresh interval (sec)</label>
                    <input
                      type="number" min="15" max="3600"
                      value={form.refreshSeconds}
                      onChange={(e) => patch('refreshSeconds', Math.max(15, Number(e.target.value) || 60))}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)]"
                    />
                    <p className="text-xs text-[var(--text-muted)] mt-1">How often the server checks for new events and pushes changes to the display.</p>
                  </div>
                </div>
              </SectionCardBody>
            </SectionCard>
          )}

          {/* Step 3 — Style + preview */}
          {step === 3 && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
              {/* Controls */}
              <div className="space-y-4">
                <SectionCard>
                  <SectionCardHeader>
                    <h3 className="text-sm font-semibold"><Palette size={14} className="inline mr-1.5 mb-0.5" />Colours</h3>
                  </SectionCardHeader>
                  <SectionCardBody>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold uppercase text-[var(--text-muted)] mb-1">Accent colour</label>
                        <input
                          type="color" value={form.theme.accentColor}
                          onChange={(e) => patch('theme', { ...form.theme, accentColor: e.target.value })}
                          className="w-full h-10 rounded-lg border border-[var(--border)] cursor-pointer"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold uppercase text-[var(--text-muted)] mb-1">Background</label>
                        <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden">
                          <button onClick={() => patch('theme', { ...form.theme, background: 'light' })} className={`px-3 py-1.5 text-xs ${form.theme.background === 'light' ? 'bg-[var(--blue)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--surface)]'}`}>Light</button>
                          <button onClick={() => patch('theme', { ...form.theme, background: 'dark' })} className={`px-3 py-1.5 text-xs ${form.theme.background === 'dark' ? 'bg-[var(--blue)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--surface)]'}`}>Dark</button>
                        </div>
                      </div>
                    </div>
                  </SectionCardBody>
                </SectionCard>

                <SectionCard>
                  <SectionCardHeader>
                    <h3 className="text-sm font-semibold"><Clock size={14} className="inline mr-1.5 mb-0.5" />Clock style</h3>
                  </SectionCardHeader>
                  <SectionCardBody>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { id: 'digital-24', label: 'Digital 24h', sub: '14:35' },
                        { id: 'digital-12', label: 'Digital 12h', sub: '2:35 PM' },
                        { id: 'analog',     label: 'Analog',      sub: '◷' },
                        { id: 'none',       label: 'Hidden',      sub: '—' },
                      ] as { id: ClockStyle; label: string; sub: string }[]).map((c) => (
                        <button
                          key={c.id}
                          onClick={() => patch('theme', { ...form.theme, clockStyle: c.id })}
                          className={`flex flex-col items-center gap-0.5 p-3 rounded-lg border text-center transition-colors ${form.theme.clockStyle === c.id ? 'border-[var(--blue)] bg-[var(--blue)]/10' : 'border-[var(--border)] hover:bg-[var(--surface)]'}`}
                        >
                          <span className="text-xs font-medium text-[var(--text)]">{c.label}</span>
                          <span className="text-[10px] text-[var(--text-muted)]">{c.sub}</span>
                        </button>
                      ))}
                    </div>
                  </SectionCardBody>
                </SectionCard>

                <SectionCard>
                  <SectionCardHeader>
                    <h3 className="text-sm font-semibold"><CalendarDays size={14} className="inline mr-1.5 mb-0.5" />Header style</h3>
                  </SectionCardHeader>
                  <SectionCardBody>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { id: 'full',    label: 'Full',    sub: 'Day names + date' },
                        { id: 'compact', label: 'Compact', sub: 'Abbreviated' },
                        { id: 'none',    label: 'Hidden',  sub: 'No header' },
                      ] as { id: HeaderStyle; label: string; sub: string }[]).map((h) => (
                        <button
                          key={h.id}
                          onClick={() => patch('theme', { ...form.theme, headerStyle: h.id })}
                          className={`flex flex-col items-center gap-0.5 p-3 rounded-lg border text-center transition-colors ${form.theme.headerStyle === h.id ? 'border-[var(--blue)] bg-[var(--blue)]/10' : 'border-[var(--border)] hover:bg-[var(--surface)]'}`}
                        >
                          <span className="text-xs font-medium text-[var(--text)]">{h.label}</span>
                          <span className="text-[10px] text-[var(--text-muted)]">{h.sub}</span>
                        </button>
                      ))}
                    </div>
                  </SectionCardBody>
                </SectionCard>

                <SectionCard>
                  <SectionCardHeader>
                    <h3 className="text-sm font-semibold">Font style</h3>
                  </SectionCardHeader>
                  <SectionCardBody>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { id: 'sans',    label: 'Sans-serif', sample: 'Aa' },
                        { id: 'mono',    label: 'Monospace',  sample: 'Aa' },
                        { id: 'rounded', label: 'Rounded',    sample: 'Aa' },
                      ] as { id: FontStyle; label: string; sample: string }[]).map((f) => (
                        <button
                          key={f.id}
                          onClick={() => patch('theme', { ...form.theme, fontStyle: f.id })}
                          className={`flex flex-col items-center gap-0.5 p-3 rounded-lg border text-center transition-colors ${form.theme.fontStyle === f.id ? 'border-[var(--blue)] bg-[var(--blue)]/10' : 'border-[var(--border)] hover:bg-[var(--surface)]'}`}
                        >
                          <span
                            className="text-base font-bold text-[var(--text)]"
                            style={{ fontFamily: f.id === 'mono' ? 'monospace' : f.id === 'rounded' ? 'ui-rounded, system-ui' : 'sans-serif' }}
                          >{f.sample}</span>
                          <span className="text-[10px] text-[var(--text-muted)]">{f.label}</span>
                        </button>
                      ))}
                    </div>
                  </SectionCardBody>
                </SectionCard>

                <SectionCard>
                  <SectionCardHeader>
                    <h3 className="text-sm font-semibold">Display options</h3>
                  </SectionCardHeader>
                  <SectionCardBody>
                    <div className="space-y-2">
                      {([
                        { key: 'showCurrentTimeLine', label: 'Current-time red line', desc: 'Shows where "now" is in day/week view' },
                        { key: 'showWeekNumbers',     label: 'Week numbers',           desc: 'Show ISO week number in month view' },
                        { key: 'showLocation',        label: 'Event location',         desc: 'Show location text on each event' },
                        { key: 'showAttendeeCount',   label: 'Attendee count',         desc: 'Show how many attendees' },
                      ] as { key: keyof typeof form.theme; label: string; desc: string }[]).map((opt) => (
                        <label key={opt.key} className="flex items-start gap-3 p-2 rounded hover:bg-[var(--surface)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!form.theme[opt.key]}
                            onChange={(e) => patch('theme', { ...form.theme, [opt.key]: e.target.checked })}
                            className="mt-0.5"
                          />
                          <div>
                            <p className="text-sm font-medium text-[var(--text)]">{opt.label}</p>
                            <p className="text-xs text-[var(--text-muted)]">{opt.desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </SectionCardBody>
                </SectionCard>
              </div>

              {/* Live preview */}
              <div className="sticky top-6">
                <SectionCard>
                  <SectionCardHeader>
                    <h3 className="text-sm font-semibold">Preview</h3>
                    <span className="text-xs text-[var(--text-muted)]">Upcoming events</span>
                  </SectionCardHeader>
                  <SectionCardBody className="p-0 overflow-hidden rounded-b-xl">
                    <CalendarPreview
                      form={form}
                      events={previewQuery.data?.events ?? []}
                      loading={previewQuery.isLoading}
                      error={previewQuery.isError ? ((previewQuery.error as any)?.response?.data?.detail ?? 'Could not load events') : null}
                    />
                  </SectionCardBody>
                </SectionCard>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
