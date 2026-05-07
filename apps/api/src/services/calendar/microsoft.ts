/**
 * Microsoft Graph (Outlook / Microsoft 365) calendar provider.
 *
 * Required env:
 *   MICROSOFT_OAUTH_CLIENT_ID
 *   MICROSOFT_OAUTH_CLIENT_SECRET
 *   MICROSOFT_OAUTH_TENANT  (default 'common' = personal + any work account)
 *
 * Scopes:
 *   Calendars.Read
 *   offline_access   (so we get a refresh_token)
 *   User.Read
 *   Place.Read.All   (optional — needed to enumerate room mailboxes)
 */
import { ensureAccessToken, callbackUrl } from './oauth.js';
import type {
  CalendarEvent,
  CalendarConnectionRow,
  FetchEventsRange,
  NormalizedCalendar,
} from './index.js';

function tenant() { return process.env['MICROSOFT_OAUTH_TENANT'] ?? process.env['MICROSOFT_TENANT_ID'] ?? 'common'; }
function clientId() { return process.env['MICROSOFT_OAUTH_CLIENT_ID'] ?? process.env['MICROSOFT_CLIENT_ID'] ?? ''; }
function clientSecret() { return process.env['MICROSOFT_OAUTH_CLIENT_SECRET'] ?? process.env['MICROSOFT_CLIENT_SECRET'] ?? ''; }

function authEndpoint() {
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize`;
}
function tokenEndpoint() {
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`;
}

const GRAPH = 'https://graph.microsoft.com/v1.0';

export const MS_SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',
  'User.Read',
  'Calendars.Read',
  'Place.Read.All',
].join(' ');

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    redirect_uri: callbackUrl('microsoft'),
    response_mode: 'query',
    scope: MS_SCOPES,
    state,
    prompt: 'consent',
  });
  return `${authEndpoint()}?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<{
  accessToken: string;
  refreshToken?: string | undefined;
  expiresIn: number;
  email?: string | undefined;
}> {
  const res = await fetch(tokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl('microsoft'),
      scope: MS_SCOPES,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Microsoft token exchange failed: ${res.status} ${await res.text()}`);
  const tokens = await res.json() as {
    access_token: string; refresh_token?: string; expires_in: number;
  };

  let email: string | undefined;
  try {
    const me = await fetch(`${GRAPH}/me`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (me.ok) {
      const info = await me.json() as { mail?: string; userPrincipalName?: string };
      email = info.mail ?? info.userPrincipalName;
    }
  } catch { /* ignore */ }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    email,
  };
}

async function token(conn: CalendarConnectionRow, force = false): Promise<string> {
  return ensureAccessToken(conn, {
    tokenEndpoint: tokenEndpoint(),
    clientId: clientId(),
    clientSecret: clientSecret(),
  }, { force });
}

export async function fetchMicrosoftCalendars(
  conn: CalendarConnectionRow,
): Promise<NormalizedCalendar[]> {
  let t = await token(conn);
  let res = await fetch(`${GRAPH}/me/calendars?$top=200`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  // On 401, force-refresh the token and retry once
  if (res.status === 401) {
    t = await token(conn, true);
    res = await fetch(`${GRAPH}/me/calendars?$top=200`, {
      headers: { Authorization: `Bearer ${t}` },
    });
  }
  if (!res.ok) throw new Error(`Graph /me/calendars failed: ${res.status}`);
  const json = await res.json() as { value?: Array<{
    id: string; name: string; hexColor?: string; isDefaultCalendar?: boolean; owner?: { name?: string; address?: string };
  }> };
  const userCals: NormalizedCalendar[] = (json.value ?? []).map((c) => ({
    externalCalendarId: c.id,
    name: c.name,
    colorHex: c.hexColor,
    isPrimary: !!c.isDefaultCalendar,
    kind: 'user',
  }));

  // Best-effort: list room mailboxes (requires Place.Read.All scope).
  const rooms: NormalizedCalendar[] = [];
  try {
    const r = await fetch(`${GRAPH}/places/microsoft.graph.room?$top=200`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    if (r.ok) {
      const rJson = await r.json() as { value?: Array<{
        id: string; displayName: string; emailAddress?: string; capacity?: number;
        building?: string; floorLabel?: string;
      }> };
      for (const room of (rJson.value ?? [])) {
        rooms.push({
          // For events, /users/{email}/calendar uses the email as the lookup key.
          externalCalendarId: room.emailAddress ?? room.id,
          name: room.displayName,
          colorHex: null,
          isPrimary: false,
          kind: 'room',
          capacity: room.capacity ?? null,
          locationLabel: [room.building, room.floorLabel].filter(Boolean).join(' · ') || null,
        });
      }
    }
  } catch { /* Place.Read.All may not be granted; ignore. */ }

  return [...userCals, ...rooms];
}

export async function fetchMicrosoftEvents(
  conn: CalendarConnectionRow,
  range: FetchEventsRange,
): Promise<CalendarEvent[]> {
  let t = await token(conn);
  const calendarIds = range.calendarIds && range.calendarIds.length
    ? range.calendarIds
    : ['primary'];
  const all: CalendarEvent[] = [];

  for (const calId of calendarIds) {
    const isEmailRoom = calId.includes('@');
    // For room mailboxes we use /users/{email}/calendarView; for personal
    // calendars we use /me/calendars/{id}/calendarView.
    const path = isEmailRoom
      ? `/users/${encodeURIComponent(calId)}/calendarView`
      : calId === 'primary'
        ? `/me/calendarView`
        : `/me/calendars/${encodeURIComponent(calId)}/calendarView`;
    const params = new URLSearchParams({
      startDateTime: range.from.toISOString(),
      endDateTime: range.to.toISOString(),
      $top: '250',
    });
    let res = await fetch(`${GRAPH}${path}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${t}`,
        Prefer: 'outlook.timezone="UTC"',
      },
    });
    // On 401, force-refresh the token and retry once
    if (res.status === 401) {
      t = await token(conn, true);
      res = await fetch(`${GRAPH}${path}?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${t}`,
          Prefer: 'outlook.timezone="UTC"',
        },
      });
    }
    if (!res.ok) {
      if (res.status === 403 || res.status === 404) continue;
      const errBody = await res.text().catch(() => '');
      throw new Error(`Graph calendarView failed: ${res.status} ${errBody.slice(0, 300)}`);
    }
    const json = await res.json() as { value?: any[] };
    for (const ev of (json.value ?? [])) {
      const startStr = ev.start?.dateTime;
      const endStr = ev.end?.dateTime;
      if (!startStr || !endStr) continue;
      all.push({
        id: ev.id,
        calendarId: calId,
        title: ev.subject ?? '(No title)',
        location: ev.location?.displayName ?? null,
        description: typeof ev.bodyPreview === 'string' ? ev.bodyPreview : null,
        start: new Date(startStr + (startStr.endsWith('Z') ? '' : 'Z')).toISOString(),
        end: new Date(endStr + (endStr.endsWith('Z') ? '' : 'Z')).toISOString(),
        allDay: !!ev.isAllDay,
        organizerEmail: ev.organizer?.emailAddress?.address ?? null,
        organizerName: ev.organizer?.emailAddress?.name ?? null,
        attendeeCount: Array.isArray(ev.attendees) ? ev.attendees.length : null,
        isPrivate: ev.sensitivity === 'private' || ev.sensitivity === 'confidential',
        status: ev.showAs,
      });
    }
  }
  return all;
}
