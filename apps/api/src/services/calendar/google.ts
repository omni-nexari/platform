/**
 * Google Calendar provider — OAuth 2.0 + Calendar v3 REST API.
 *
 * Required env:
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *
 * Required scopes for read-only operation:
 *   https://www.googleapis.com/auth/calendar.readonly
 *   https://www.googleapis.com/auth/calendar.events.readonly  (recurrence)
 *   openid email profile
 */
import { ensureAccessToken, callbackUrl } from './oauth.js';
import type {
  CalendarEvent,
  CalendarConnectionRow,
  FetchEventsRange,
  NormalizedCalendar,
} from './index.js';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const API = 'https://www.googleapis.com/calendar/v3';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
].join(' ');

function clientId() { return process.env['GOOGLE_OAUTH_CLIENT_ID'] ?? ''; }
function clientSecret() { return process.env['GOOGLE_OAUTH_CLIENT_SECRET'] ?? ''; }

/** Build the user-facing consent URL. */
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: callbackUrl('google'),
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** Exchange code for tokens. */
export async function exchangeCode(code: string): Promise<{
  accessToken: string;
  refreshToken?: string | undefined;
  expiresIn: number;
  email?: string | undefined;
}> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: callbackUrl('google'),
    }).toString(),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const tokens = await res.json() as {
    access_token: string; refresh_token?: string; expires_in: number; id_token?: string;
  };

  let email: string | undefined;
  // Pull email from userinfo (cheap and always works)
  try {
    const u = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (u.ok) {
      const info = await u.json() as { email?: string };
      email = info.email;
    }
  } catch { /* ignore */ }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    email,
  };
}

async function token(conn: CalendarConnectionRow): Promise<string> {
  return ensureAccessToken(conn, {
    tokenEndpoint: TOKEN_ENDPOINT,
    clientId: clientId(),
    clientSecret: clientSecret(),
  });
}

export async function fetchGoogleCalendars(
  conn: CalendarConnectionRow,
): Promise<NormalizedCalendar[]> {
  const t = await token(conn);
  const res = await fetch(`${API}/users/me/calendarList?maxResults=250`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(`Google calendarList failed: ${res.status}`);
  const json = await res.json() as { items?: Array<{
    id: string; summary: string; backgroundColor?: string; primary?: boolean;
  }> };
  return (json.items ?? []).map((c) => ({
    externalCalendarId: c.id,
    name: c.summary,
    colorHex: c.backgroundColor,
    isPrimary: !!c.primary,
    kind: 'user',
  }));
}

export async function fetchGoogleEvents(
  conn: CalendarConnectionRow,
  range: FetchEventsRange,
): Promise<CalendarEvent[]> {
  const t = await token(conn);
  const calendarIds = range.calendarIds && range.calendarIds.length
    ? range.calendarIds
    : ['primary'];
  const all: CalendarEvent[] = [];
  for (const calId of calendarIds) {
    const params = new URLSearchParams({
      timeMin: range.from.toISOString(),
      timeMax: range.to.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });
    const url = `${API}/calendars/${encodeURIComponent(calId)}/events?${params.toString()}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) {
      if (res.status === 404) continue;
      throw new Error(`Google events failed for ${calId}: ${res.status}`);
    }
    const json = await res.json() as { items?: any[]; summary?: string };
    for (const ev of (json.items ?? [])) {
      const allDay = !!ev.start?.date;
      const startStr = ev.start?.dateTime ?? ev.start?.date;
      const endStr = ev.end?.dateTime ?? ev.end?.date;
      if (!startStr || !endStr) continue;
      all.push({
        id: ev.id,
        calendarId: calId,
        calendarName: json.summary,
        title: ev.summary ?? '(No title)',
        location: ev.location ?? null,
        description: ev.description ?? null,
        start: new Date(startStr).toISOString(),
        end: new Date(endStr).toISOString(),
        allDay,
        organizerEmail: ev.organizer?.email ?? null,
        organizerName: ev.organizer?.displayName ?? null,
        attendeeCount: Array.isArray(ev.attendees) ? ev.attendees.length : null,
        isPrivate: ev.visibility === 'private' || ev.visibility === 'confidential',
        status: ev.status,
      });
    }
  }
  return all;
}
