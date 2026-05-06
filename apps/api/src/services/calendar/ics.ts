/**
 * ICS URL provider — fetches a single .ics file (Apple iCloud share, Google
 * public calendar, room systems) and parses it.
 *
 * URL is encrypted at rest; SSRF guards mirror the /content/import-url logic.
 */
import { decryptSecret } from '../crypto.js';
import { parseIcs } from './ics-parse.js';
import type {
  CalendarConnectionRow,
  CalendarEvent,
  FetchEventsRange,
  NormalizedCalendar,
} from './index.js';

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|0\.0\.0\.0)/;

export function validateIcsUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, error: 'Invalid URL' }; }
  // Apple webcal:// is just https.
  if (u.protocol === 'webcal:') u = new URL(`https:${raw.slice('webcal:'.length)}`);
  if (!['http:', 'https:'].includes(u.protocol)) {
    return { ok: false, error: 'Only http and https URLs are supported' };
  }
  if (PRIVATE_HOST.test(u.hostname.toLowerCase())) {
    return { ok: false, error: 'Private or loopback URLs are not allowed' };
  }
  return { ok: true, url: u };
}

const MAX_BYTES = 5 * 1024 * 1024;

async function fetchIcs(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`ICS fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('ICS file exceeds 5 MB');
  return buf.toString('utf8');
}

export async function fetchIcsCalendars(
  conn: CalendarConnectionRow,
): Promise<NormalizedCalendar[]> {
  // ICS URL = a single calendar.  Use the connection's display name.
  return [{
    externalCalendarId: 'default',
    name: conn.displayName,
    isPrimary: true,
    kind: 'user',
  }];
}

export async function fetchIcsEvents(
  conn: CalendarConnectionRow,
  range: FetchEventsRange,
): Promise<CalendarEvent[]> {
  const url = decryptSecret(conn.icsUrl);
  if (!url) throw new Error('ICS URL is not configured');
  const v = validateIcsUrl(url);
  if (!v.ok) throw new Error(v.error);
  const text = await fetchIcs(v.url.toString());
  return parseIcs(text, {
    calendarId: 'default',
    calendarName: conn.displayName,
    rangeFrom: range.from,
    rangeTo: range.to,
  });
}
