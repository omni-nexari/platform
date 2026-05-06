/**
 * Minimal RFC 5545 (iCalendar) parser sufficient for our calendar preview.
 *
 * Supports:
 *  - VEVENT with SUMMARY / DESCRIPTION / LOCATION / DTSTART / DTEND / UID /
 *    ORGANIZER / STATUS / CLASS (PRIVATE/CONFIDENTIAL detection)
 *  - All-day events (DATE-only DTSTART)
 *  - Time-zone-aware DTSTART;TZID=America/New_York:20250101T093000 (best-effort —
 *    we treat TZID as opaque metadata and assume floating local; the wizard
 *    re-renders in the workspace TZ so this is acceptable for preview)
 *  - Single RRULE expansion for FREQ=DAILY/WEEKLY/MONTHLY/YEARLY with COUNT or
 *    UNTIL.  More exotic rules are passed through as a single occurrence — we
 *    explicitly do NOT try to be a full RRULE engine.
 *
 * Returned events include a `calendarId` field set by the caller.
 */
import type { CalendarEvent } from './index.js';

interface VEvent {
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  organizerEmail?: string;
  organizerName?: string;
  classVal?: string;
  status?: string;
  dtstart?: { value: string; isDate: boolean };
  dtend?: { value: string; isDate: boolean };
  rrule?: string;
}

/** Unfold continuation lines (RFC 5545 §3.1). */
function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function unescapeText(s: string): string {
  return s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

/** Parse `20250115T143000Z` / `20250115T143000` / `20250115` to a Date. */
function parseIcsDate(value: string, isDate: boolean): Date | null {
  if (isDate) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    if (!m) return null;
    return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!m) return null;
  const [, Y, M, D, h, mi, s, z] = m;
  if (z) {
    return new Date(Date.UTC(+Y!, +M! - 1, +D!, +h!, +mi!, +s!));
  }
  // Floating / TZID — treat as UTC for preview.  TODO: TZID lookup if needed.
  return new Date(Date.UTC(+Y!, +M! - 1, +D!, +h!, +mi!, +s!));
}

function expandRrule(
  ev: VEvent,
  start: Date,
  end: Date,
  rangeFrom: Date,
  rangeTo: Date,
): { start: Date; end: Date }[] {
  if (!ev.rrule) return [{ start, end }];
  const parts: Record<string, string> = {};
  for (const seg of ev.rrule.split(';')) {
    const [k, v] = seg.split('=');
    if (k && v) parts[k.toUpperCase()] = v;
  }
  const freq = parts['FREQ'];
  if (!freq) return [{ start, end }];
  const interval = Math.max(1, +(parts['INTERVAL'] ?? '1') || 1);
  const count = parts['COUNT'] ? +parts['COUNT'] : Infinity;
  const until = parts['UNTIL'] ? parseIcsDate(parts['UNTIL'], parts['UNTIL'].length === 8) : null;

  const stepMs = (() => {
    switch (freq) {
      case 'DAILY':   return 86_400_000 * interval;
      case 'WEEKLY':  return 604_800_000 * interval;
      // Month/year are non-uniform; approximate with calendar-add.
      case 'MONTHLY': return null;
      case 'YEARLY':  return null;
      default:        return null;
    }
  })();

  const out: { start: Date; end: Date }[] = [];
  const duration = end.getTime() - start.getTime();
  const max = 366; // safety bound
  let cur = new Date(start);
  for (let i = 0; i < Math.min(count, max); i++) {
    if (until && cur.getTime() > until.getTime()) break;
    if (cur.getTime() + duration >= rangeFrom.getTime() && cur.getTime() <= rangeTo.getTime()) {
      out.push({ start: new Date(cur), end: new Date(cur.getTime() + duration) });
    } else if (cur.getTime() > rangeTo.getTime()) {
      break;
    }
    if (stepMs != null) {
      cur = new Date(cur.getTime() + stepMs);
    } else if (freq === 'MONTHLY') {
      cur = new Date(cur);
      cur.setUTCMonth(cur.getUTCMonth() + interval);
    } else if (freq === 'YEARLY') {
      cur = new Date(cur);
      cur.setUTCFullYear(cur.getUTCFullYear() + interval);
    } else {
      break;
    }
  }
  return out;
}

export function parseIcs(text: string, opts: {
  calendarId: string;
  calendarName?: string;
  rangeFrom: Date;
  rangeTo: Date;
}): CalendarEvent[] {
  const lines = unfold(text);
  const events: CalendarEvent[] = [];

  let cur: VEvent | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur && cur.dtstart) {
        const startD = parseIcsDate(cur.dtstart.value, cur.dtstart.isDate);
        const endD = cur.dtend
          ? parseIcsDate(cur.dtend.value, cur.dtend.isDate)
          : startD;
        if (startD && endD) {
          const occurrences = expandRrule(cur, startD, endD, opts.rangeFrom, opts.rangeTo);
          for (const occ of occurrences) {
            events.push({
              id: `${cur.uid ?? Math.random().toString(36).slice(2)}_${occ.start.toISOString()}`,
              calendarId: opts.calendarId,
              calendarName: opts.calendarName,
              title: cur.summary ?? '(No title)',
              location: cur.location ?? null,
              description: cur.description ?? null,
              start: occ.start.toISOString(),
              end: occ.end.toISOString(),
              allDay: !!cur.dtstart.isDate,
              organizerEmail: cur.organizerEmail ?? null,
              organizerName: cur.organizerName ?? null,
              attendeeCount: null,
              isPrivate: cur.classVal === 'PRIVATE' || cur.classVal === 'CONFIDENTIAL',
              status: cur.status,
            });
          }
        }
      }
      cur = null;
      continue;
    }
    if (!cur) continue;

    // Property line: NAME[;PARAMS]:VALUE
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const semi = head.indexOf(';');
    const name = (semi < 0 ? head : head.slice(0, semi)).toUpperCase();
    const paramsStr = semi < 0 ? '' : head.slice(semi + 1);
    const params: Record<string, string> = {};
    for (const seg of paramsStr.split(';').filter(Boolean)) {
      const [k, v] = seg.split('=');
      if (k && v) params[k.toUpperCase()] = v.replace(/^"|"$/g, '');
    }

    switch (name) {
      case 'UID':         cur.uid = value; break;
      case 'SUMMARY':     cur.summary = unescapeText(value); break;
      case 'DESCRIPTION': cur.description = unescapeText(value); break;
      case 'LOCATION':    cur.location = unescapeText(value); break;
      case 'CLASS':       cur.classVal = value; break;
      case 'STATUS':      cur.status = value.toLowerCase(); break;
      case 'RRULE':       cur.rrule = value; break;
      case 'ORGANIZER': {
        const m = /mailto:([^;]+)/i.exec(value);
        if (m) cur.organizerEmail = m[1]!.trim();
        if (params['CN']) cur.organizerName = params['CN'];
        break;
      }
      case 'DTSTART':     cur.dtstart = { value, isDate: params['VALUE'] === 'DATE' }; break;
      case 'DTEND':       cur.dtend = { value, isDate: params['VALUE'] === 'DATE' }; break;
      default: break;
    }
  }
  return events;
}
