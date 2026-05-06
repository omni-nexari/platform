/**
 * Apple iCloud CalDAV provider.
 *
 * Apple does NOT offer OAuth for calendars.  The user must generate an
 * app-specific password at https://appleid.apple.com and supply that here.
 *
 * Discovery flow:
 *   1. PROPFIND https://caldav.icloud.com/ → current-user-principal
 *   2. PROPFIND <principal> → calendar-home-set
 *   3. PROPFIND <home> Depth: 1 → list of calendar collections
 *
 * Event fetch (per calendar):
 *   REPORT <calendar-url> with calendar-query VEVENT in [from, to].
 *   We parse the response by extracting <C:calendar-data>...VCALENDAR...</> and
 *   running it through the shared ICS parser.
 *
 * This implementation is deliberately minimal and tolerant: it uses regex to
 * extract the few values it needs from the XML responses to avoid pulling in a
 * full XML parser dependency.  iCloud's responses are stable enough for this
 * approach in practice.
 */
import { decryptSecret } from '../crypto.js';
import { parseIcs } from './ics-parse.js';
import type {
  CalendarConnectionRow,
  CalendarEvent,
  FetchEventsRange,
  NormalizedCalendar,
} from './index.js';

const DEFAULT_BASE = 'https://caldav.icloud.com';

interface AppleCreds {
  baseUrl: string;
  username: string;
  password: string;
}

function loadCreds(conn: CalendarConnectionRow): AppleCreds {
  const username = decryptSecret(conn.caldavUsername);
  const password = decryptSecret(conn.caldavAppPassword);
  const baseUrl = decryptSecret(conn.caldavUrl) ?? DEFAULT_BASE;
  if (!username || !password) throw new Error('CalDAV credentials missing');
  return { baseUrl, username, password };
}

function authHeader(creds: AppleCreds): string {
  return 'Basic ' + Buffer.from(`${creds.username}:${creds.password}`, 'utf8').toString('base64');
}

async function propfind(url: string, depth: '0' | '1', body: string, creds: AppleCreds): Promise<string> {
  const res = await fetch(url, {
    method: 'PROPFIND',
    headers: {
      Authorization: authHeader(creds),
      Depth: depth,
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body,
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
  });
  if (res.status !== 207 && !res.ok) {
    throw new Error(`CalDAV PROPFIND ${url} failed: ${res.status}`);
  }
  return await res.text();
}

function extract(xml: string, tag: string): string[] {
  // Tolerant of namespace prefixes.
  const re = new RegExp(`<(?:[a-zA-Z0-9]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9]+:)?${tag}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]!);
  return out;
}

function absUrl(base: string, href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  const b = new URL(base);
  if (href.startsWith('/')) return `${b.protocol}//${b.host}${href}`;
  return new URL(href, base).toString();
}

/**
 * Test the credentials by fetching the principal URL.  Returns the principal
 * URL on success, throws on failure.
 */
export async function appleProbe(creds: AppleCreds): Promise<string> {
  const xml = await propfind(creds.baseUrl, '0',
    `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
    creds);
  const hrefs = extract(xml, 'href');
  const principal = hrefs.find((h) => /\/principals?\//i.test(h));
  if (!principal) throw new Error('Could not resolve current-user-principal');
  return absUrl(creds.baseUrl, principal.trim());
}

async function calendarHomeSet(principal: string, creds: AppleCreds): Promise<string> {
  const xml = await propfind(principal, '0',
    `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-home-set/></d:prop></d:propfind>`,
    creds);
  const homes = extract(xml, 'calendar-home-set');
  if (!homes[0]) throw new Error('Could not resolve calendar-home-set');
  const href = extract(homes[0], 'href')[0];
  if (!href) throw new Error('No href in calendar-home-set');
  return absUrl(creds.baseUrl, href.trim());
}

export async function fetchAppleCalendars(
  conn: CalendarConnectionRow,
): Promise<NormalizedCalendar[]> {
  const creds = loadCreds(conn);
  const principal = await appleProbe(creds);
  const home = await calendarHomeSet(principal, creds);

  const xml = await propfind(home, '1',
    `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <ic:calendar-color/>
    <c:supported-calendar-component-set/>
  </d:prop>
</d:propfind>`,
    creds);

  // Each <response> is one collection.
  const responses = extract(xml, 'response');
  const out: NormalizedCalendar[] = [];
  for (const r of responses) {
    const href = extract(r, 'href')[0]?.trim();
    if (!href) continue;
    const isCal = /<(?:[a-zA-Z0-9]+:)?calendar\b/i.test(r);
    if (!isCal) continue;
    const supports = extract(r, 'supported-calendar-component-set').join(' ');
    if (supports && !/name="VEVENT"/i.test(supports)) continue;
    const display = extract(r, 'displayname')[0]?.trim();
    const color = extract(r, 'calendar-color')[0]?.trim();
    out.push({
      externalCalendarId: absUrl(creds.baseUrl, href),
      name: display || 'Calendar',
      colorHex: color || null,
      isPrimary: false,
      kind: 'user',
    });
  }
  return out;
}

export async function fetchAppleEvents(
  conn: CalendarConnectionRow,
  range: FetchEventsRange,
): Promise<CalendarEvent[]> {
  const creds = loadCreds(conn);
  const calendarIds = range.calendarIds && range.calendarIds.length
    ? range.calendarIds
    : (await fetchAppleCalendars(conn)).map((c) => c.externalCalendarId);

  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const reqXml = (from: Date, to: Date) => `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${fmt(from)}" end="${fmt(to)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

  const all: CalendarEvent[] = [];
  for (const calId of calendarIds) {
    const res = await fetch(calId, {
      method: 'REPORT',
      headers: {
        Authorization: authHeader(creds),
        Depth: '1',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: reqXml(range.from, range.to),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status !== 207 && !res.ok) continue;
    const xml = await res.text();
    for (const block of extract(xml, 'calendar-data')) {
      const decoded = block
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
      const events = parseIcs(decoded, {
        calendarId: calId,
        rangeFrom: range.from,
        rangeTo: range.to,
      });
      all.push(...events);
    }
  }
  return all;
}
