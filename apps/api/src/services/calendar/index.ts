/**
 * Provider-agnostic calendar types and a single dispatcher used by the API
 * routes.  Each provider implementation lives in its own file:
 *
 *   - google.ts        OAuth 2.0 + Google Calendar v3
 *   - microsoft.ts     OAuth 2.0 + Microsoft Graph
 *   - apple.ts         CalDAV (Apple ID + app-specific password)
 *   - ics.ts           plain HTTPS GET of an .ics file
 *
 * All four return a normalised `CalendarEvent[]` so the wizard preview and the
 * player render path don't need to care about the source.
 */
import type { calendarConnections } from '@signage/db';
import { fetchGoogleCalendars, fetchGoogleEvents } from './google.js';
import { fetchMicrosoftCalendars, fetchMicrosoftEvents } from './microsoft.js';
import { fetchAppleCalendars, fetchAppleEvents } from './apple.js';
import { fetchIcsCalendars, fetchIcsEvents } from './ics.js';

export type CalendarConnectionRow = typeof calendarConnections.$inferSelect;

export interface NormalizedCalendar {
  externalCalendarId: string;
  name: string;
  colorHex?: string | null | undefined;
  isPrimary?: boolean | undefined;
  kind?: 'user' | 'room' | 'equipment' | 'group' | undefined;
  capacity?: number | null | undefined;
  locationLabel?: string | null | undefined;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  calendarName?: string | undefined;
  title: string;
  location?: string | null | undefined;
  description?: string | null | undefined;
  start: string;       // ISO 8601 (UTC, with TZ)
  end: string;         // ISO 8601
  allDay: boolean;
  organizerEmail?: string | null | undefined;
  organizerName?: string | null | undefined;
  attendeeCount?: number | null | undefined;
  isPrivate: boolean;
  status?: string | undefined;     // confirmed | tentative | cancelled
}

export interface FetchEventsRange {
  from: Date;
  to: Date;
  /** Optional list of external calendar IDs to filter to. */
  calendarIds?: string[] | undefined;
  /** Optional case-insensitive substring filter on title/location/description. */
  keyword?: string | undefined;
}

export async function listCalendarsForConnection(
  conn: CalendarConnectionRow,
): Promise<NormalizedCalendar[]> {
  switch (conn.provider) {
    case 'google':       return fetchGoogleCalendars(conn);
    case 'microsoft':    return fetchMicrosoftCalendars(conn);
    case 'apple_caldav': return fetchAppleCalendars(conn);
    case 'ics':          return fetchIcsCalendars(conn);
    default: throw new Error(`Unknown calendar provider: ${conn.provider}`);
  }
}

export async function listEventsForConnection(
  conn: CalendarConnectionRow,
  range: FetchEventsRange,
): Promise<CalendarEvent[]> {
  let events: CalendarEvent[];
  switch (conn.provider) {
    case 'google':       events = await fetchGoogleEvents(conn, range); break;
    case 'microsoft':    events = await fetchMicrosoftEvents(conn, range); break;
    case 'apple_caldav': events = await fetchAppleEvents(conn, range); break;
    case 'ics':          events = await fetchIcsEvents(conn, range); break;
    default: throw new Error(`Unknown calendar provider: ${conn.provider}`);
  }

  if (range.calendarIds && range.calendarIds.length > 0) {
    const allow = new Set(range.calendarIds);
    events = events.filter((e) => allow.has(e.calendarId));
  }
  if (range.keyword && range.keyword.trim()) {
    const kw = range.keyword.trim().toLowerCase();
    events = events.filter((e) =>
      (e.title ?? '').toLowerCase().includes(kw)
      || (e.location ?? '').toLowerCase().includes(kw)
      || (e.description ?? '').toLowerCase().includes(kw),
    );
  }
  // Always sort by start
  events.sort((a, b) => a.start.localeCompare(b.start));
  return events;
}
