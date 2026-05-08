/**
 * Calendar live-push broker.
 *
 * Fan-out model: many devices may render the same calendar content item
 * (meeting-room sign in 50 conference rooms, etc.). Instead of every device
 * polling Microsoft Graph / Google / CalDAV directly, the API server polls
 * upstream once per content item and pushes diff'd event lists to every
 * subscribed device over the existing /ws/device socket.
 *
 *   device  ─── calendar_subscribe(contentId)   ──►  server
 *   server  ─── calendar_events(contentId, evs) ──►  device  (on change only)
 *   device  ─── calendar_unsubscribe(contentId) ──►  server
 *
 * Single-process state. If the API ever scales to multiple replicas, swap the
 * Maps below for Redis pub/sub — same logic, different storage.
 */
import { db, contentItems, calendarConnections } from '@signage/db';
import { eq, and, isNull } from 'drizzle-orm';
import { listEventsForConnection, type CalendarEvent } from './calendar/index.js';
import { sendCommand } from './ws.js';

// contentId → set of subscribed deviceIds.
const subscribers = new Map<string, Set<string>>();
// contentId → upstream poll timer.
const timers = new Map<string, ReturnType<typeof setInterval>>();
// contentId → last-pushed signature; suppresses no-op re-renders downstream.
const lastSigs = new Map<string, string>();
// contentId → last successful poll timestamp (ms) — for backoff bookkeeping.
const lastOkAt = new Map<string, number>();
// contentId → consecutive upstream errors — drives exponential backoff.
const errorStreak = new Map<string, number>();

const MIN_INTERVAL_SEC = 30;        // floor — protect upstream APIs
const MAX_INTERVAL_SEC = 600;       // 10 min ceiling on backoff
const MAX_SUBS_PER_CONTENT = 500;   // sanity guard

/** Build a stable signature so identical event sets skip the push. */
function eventsSignature(events: CalendarEvent[]): string {
  return events
    .map((e) => `${e.id}|${e.start}|${e.end}|${e.title ?? ''}|${e.location ?? ''}`)
    .join('\n');
}

/** Apply busy_only privacy mask if configured on the content item. */
function applyPrivacy(events: CalendarEvent[], privacyMode: string | undefined): CalendarEvent[] {
  if (privacyMode !== 'busy_only') return events;
  return events.map((e) => ({
    ...e,
    title: 'Busy',
    location: null,
    description: null,
    organizerEmail: null,
    organizerName: null,
    attendeeCount: null,
  }));
}

/** Read content + connection rows; returns null if the item is stale/invalid. */
async function loadContext(contentId: string): Promise<{
  meta: {
    connectionId?: string;
    selectedCalendarIds?: string[];
    keywordFilter?: string | null;
    privacyMode?: 'titles' | 'busy_only';
    view?: string;
    refreshSeconds?: number;
  };
  conn: typeof calendarConnections.$inferSelect;
} | null> {
  const item = await db.query.contentItems.findFirst({ where: eq(contentItems.id, contentId) });
  if (!item || item.type !== 'calendar') return null;

  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse(item.metadata ?? '{}'); } catch { /* ignore */ }
  const connectionId = meta['connectionId'];
  if (typeof connectionId !== 'string' || !connectionId) return null;

  const conn = await db.query.calendarConnections.findFirst({
    where: and(eq(calendarConnections.id, connectionId), isNull(calendarConnections.deletedAt)),
  });
  if (!conn) return null;
  return { meta: meta as never, conn };
}

/** Compute the current poll interval (ms) for a content item, with backoff. */
function intervalMs(refreshSeconds: number | undefined, contentId: string): number {
  const base = Math.max(MIN_INTERVAL_SEC, Number(refreshSeconds) || 60);
  const errs = errorStreak.get(contentId) ?? 0;
  const backed = Math.min(MAX_INTERVAL_SEC, base * Math.pow(2, Math.min(errs, 5)));
  // Add up to 10 % jitter so 50 contents don't fire at the same second.
  return Math.round((backed + Math.random() * (backed * 0.1)) * 1000);
}

/** Fetch upstream once and push to every subscriber if anything changed. */
async function pollAndPush(contentId: string): Promise<void> {
  const subs = subscribers.get(contentId);
  if (!subs || subs.size === 0) return;

  const ctx = await loadContext(contentId);
  if (!ctx) return; // content deleted or connection removed; subscription will be cleaned on next event

  const view = ctx.meta.view ?? 'week';
  const days = view === 'day' || view === 'meeting_room' ? 1 : view === 'month' ? 31 : 7;
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + days);

  try {
    const events = await listEventsForConnection(ctx.conn, {
      from,
      to,
      ...(ctx.meta.selectedCalendarIds ? { calendarIds: ctx.meta.selectedCalendarIds } : {}),
      ...(ctx.meta.keywordFilter ? { keyword: ctx.meta.keywordFilter } : {}),
    });
    const safe = applyPrivacy(events, ctx.meta.privacyMode);
    const sig = eventsSignature(safe);

    const wasInBackoff = (errorStreak.get(contentId) ?? 0) > 0;
    errorStreak.delete(contentId);
    lastOkAt.set(contentId, Date.now());

    if (sig === lastSigs.get(contentId)) {
      // Unchanged — if we were in backoff, restore normal poll rate now
      if (wasInBackoff) rescheduleTimer(contentId, ctx.meta.refreshSeconds);
      return;
    }
    lastSigs.set(contentId, sig);

    const updatedAt = new Date().toISOString();
    console.log(`[calendar-broker] push ${events.length} events → ${subs.size} device(s) for content ${contentId}`);
    for (const deviceId of subs) {
      sendCommand(deviceId, {
        type: 'calendar_events',
        payload: { contentId, events: safe as unknown[], updatedAt },
      });
    }
    // Restore normal poll rate after recovering from backoff
    if (wasInBackoff) rescheduleTimer(contentId, ctx.meta.refreshSeconds);
  } catch (err) {
    const next = (errorStreak.get(contentId) ?? 0) + 1;
    errorStreak.set(contentId, next);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[calendar-broker] poll error for ${contentId} (streak=${next}): ${msg}`);
    // Only notify devices on the first failure of a streak; subsequent silent.
    if (next === 1) {
      for (const deviceId of subs) {
        sendCommand(deviceId, { type: 'calendar_unavailable', payload: { contentId, error: msg } });
      }
    }
    rescheduleTimer(contentId, ctx.meta.refreshSeconds);
  }
}

/** (Re)create the interval for a content item with current backoff. */
function rescheduleTimer(contentId: string, refreshSeconds: number | undefined): void {
  const existing = timers.get(contentId);
  if (existing) clearInterval(existing);
  const t = setInterval(() => { void pollAndPush(contentId); }, intervalMs(refreshSeconds, contentId));
  timers.set(contentId, t);
}

/** Force the broker to re-fetch on next tick (e.g. after the editor saves). */
export function invalidate(contentId: string): void {
  lastSigs.delete(contentId);
  errorStreak.delete(contentId);
  if (subscribers.has(contentId)) void pollAndPush(contentId);
}

/** Subscribe a device to live updates for a content item. */
export async function subscribe(deviceId: string, contentId: string): Promise<void> {
  let set = subscribers.get(contentId);
  if (!set) { set = new Set(); subscribers.set(contentId, set); }
  if (set.size >= MAX_SUBS_PER_CONTENT) return;
  const wasEmpty = set.size === 0;
  set.add(deviceId);

  // First subscriber starts the timer; later ones piggy-back.
  if (wasEmpty) {
    const ctx = await loadContext(contentId);
    rescheduleTimer(contentId, ctx?.meta.refreshSeconds);
  }
  // Always force an immediate push so the new subscriber gets data right away,
  // even if the cached signature already matches what other devices have.
  lastSigs.delete(contentId);
  void pollAndPush(contentId);
}

/** Unsubscribe a single device from one content item. */
export function unsubscribe(deviceId: string, contentId: string): void {
  const set = subscribers.get(contentId);
  if (!set) return;
  set.delete(deviceId);
  if (set.size === 0) {
    subscribers.delete(contentId);
    const t = timers.get(contentId);
    if (t) clearInterval(t);
    timers.delete(contentId);
    lastSigs.delete(contentId);
    errorStreak.delete(contentId);
    lastOkAt.delete(contentId);
  }
}

/** Drop every subscription owned by a device (called on WS close). */
export function unsubscribeDevice(deviceId: string): void {
  for (const [contentId, set] of subscribers) {
    if (!set.delete(deviceId)) continue;
    if (set.size === 0) {
      subscribers.delete(contentId);
      const t = timers.get(contentId);
      if (t) clearInterval(t);
      timers.delete(contentId);
      lastSigs.delete(contentId);
      errorStreak.delete(contentId);
      lastOkAt.delete(contentId);
    }
  }
}
