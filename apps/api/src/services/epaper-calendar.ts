/**
 * E-paper calendar rasteriser.
 *
 * Renders a calendar agenda view to a panel-sized JPEG using SVG (rendered via
 * sharp/librsvg). Supports colour e-paper panels — no grayscale conversion.
 * contrast b&w layout with no animations.
 *
 * Output cache path:
 *   {STORAGE_ROOT}/epaper/<deviceId>/<contentId>-cal-<hash>-WxH.jpg
 *
 * The hash is derived from the event payload + day bucket so the variant is
 * stable while events don't change but is invalidated as soon as anything is
 * added/removed/edited (or the day rolls over).
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import type { CalendarEvent } from './calendar/index.js';

const STORAGE_ROOT = process.env['STORAGE_ROOT'] ?? './signage_uploads';

export interface CalendarVariantSpec {
  deviceId: string;
  contentId: string;
  panelW: number;
  panelH: number;
  events: CalendarEvent[];
  title: string;
  /** Caller-supplied "now" so tests can pin the rendered date. */
  now?: Date;
  /** Privacy mode applied by the route layer; we only rely on already-redacted titles. */
}

export interface CalendarVariantResult {
  absPath: string;
  relPath: string;
  generated: boolean;
  hash: string;
}

/** XML-escape user supplied text. SVG is XML so the same rules apply. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Truncate a string to `max` chars, adding an ellipsis if cut. */
function trunc(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '\u2026';
}

/** YYYY-MM-DD bucket of an ISO timestamp in the local TZ of the server. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtDayHeading(key: string, today: string, tomorrow: string): string {
  if (key === today) return 'Today';
  if (key === tomorrow) return 'Tomorrow';
  // Parse YYYY-MM-DD locally to avoid UTC drift.
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function fmtTime(iso: string, allDay: boolean): string {
  if (allDay) return 'All day';
  const d = new Date(iso);
  const h = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  const period = h >= 12 ? 'p' : 'a';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm}${period}`;
}

// Bump this when the SVG layout changes to invalidate stale cached variants.
const LAYOUT_VERSION = '2';

function hashEvents(events: CalendarEvent[], dayBucket: string, panelW: number, panelH: number, title: string): string {
  const h = crypto.createHash('sha1');
  h.update(LAYOUT_VERSION); h.update('|');
  h.update(dayBucket); h.update('|');
  h.update(`${panelW}x${panelH}`); h.update('|');
  h.update(title); h.update('|');
  for (const e of events) {
    h.update(e.id); h.update('|');
    h.update(e.start); h.update('|');
    h.update(e.end); h.update('|');
    h.update(e.title ?? ''); h.update('|');
    h.update(e.location ?? ''); h.update('|');
    h.update(String(e.allDay)); h.update('|');
    h.update(e.status ?? ''); h.update('\n');
  }
  return h.digest('hex').slice(0, 12);
}

interface RenderedRow {
  kind: 'heading' | 'event' | 'empty';
  text: string;
  sub?: string;
  time?: string;
}

function buildRows(events: CalendarEvent[], now: Date): RenderedRow[] {
  const today = dayKey(now.toISOString());
  const tomorrowDate = new Date(now); tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = dayKey(tomorrowDate.toISOString());

  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  const rows: RenderedRow[] = [];

  let lastDay: string | null = null;
  for (const e of sorted) {
    const k = dayKey(e.start);
    if (k !== lastDay) {
      rows.push({ kind: 'heading', text: fmtDayHeading(k, today, tomorrow) });
      lastDay = k;
    }
    rows.push({
      kind: 'event',
      time: e.allDay ? 'All day' : `${fmtTime(e.start, false)}\u2013${fmtTime(e.end, false)}`,
      text: e.title || '(no title)',
      ...(e.location ? { sub: e.location } : {}),
    });
  }

  if (rows.length === 0) rows.push({ kind: 'empty', text: 'No upcoming events' });
  return rows;
}

/**
 * Build the calendar SVG document.
 * Layout is intentionally simple, monochrome, large-text — optimised for
 * Tizen e-paper panels that are read at distance.
 */
export function renderCalendarSvg(opts: {
  panelW: number;
  panelH: number;
  title: string;
  events: CalendarEvent[];
  now: Date;
}): string {
  const { panelW, panelH, title, events, now } = opts;

  // Scale paddings & font sizes from panel size.
  const pad = Math.round(Math.min(panelW, panelH) * 0.04);
  const headerSize = Math.round(Math.min(panelW, panelH) * 0.05);
  const dateSize = Math.round(headerSize * 0.55);
  const dayHeadingSize = Math.round(Math.min(panelW, panelH) * 0.038);
  const eventTitleSize = Math.round(Math.min(panelW, panelH) * 0.034);
  const eventSubSize = Math.round(eventTitleSize * 0.78);
  // Time font is slightly smaller than title — makes time subordinate visually.
  const timeFont = Math.round(eventTitleSize * 0.82);
  // Column width derived from font metrics: max time string "12:00p–12:00a" ≈ 12 chars.
  // Using 0.62 as character width factor (digits/colons are narrower than average).
  const timeColW = Math.round(timeFont * 12 * 0.62) + pad;
  const ruleStroke = Math.max(2, Math.round(panelH * 0.0025));

  const rows = buildRows(events, now);

  const headerY = pad + headerSize;
  const dateY = headerY + dateSize + Math.round(pad * 0.3);
  const ruleY = dateY + Math.round(pad * 0.5);
  const bodyTop = ruleY + Math.round(pad * 0.8);
  const bodyBottom = panelH - pad;

  const titleMaxChars = Math.floor(panelW / (headerSize * 0.5));
  const eventTitleMaxChars = Math.floor((panelW - timeColW - pad * 2) / (eventTitleSize * 0.5));
  const subMaxChars = Math.floor((panelW - timeColW - pad * 2) / (eventSubSize * 0.5));

  // Lay rows out vertically until we run out of space.
  const lineH = Math.round(eventTitleSize * 1.35);
  const headingLineH = Math.round(dayHeadingSize * 1.6);
  const eventBlockH = (r: RenderedRow): number => (r.sub ? lineH + Math.round(eventSubSize * 1.25) + Math.round(pad * 0.3) : lineH + Math.round(pad * 0.3));

  let y = bodyTop;
  const placed: Array<RenderedRow & { y: number }> = [];
  for (const r of rows) {
    const h = r.kind === 'heading' ? headingLineH : eventBlockH(r);
    if (y + h > bodyBottom) break;
    placed.push({ ...r, y });
    y += h;
  }

  const dateLine = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${panelW}" height="${panelH}" viewBox="0 0 ${panelW} ${panelH}">`);
  parts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  parts.push(`<style>text{font-family:'DejaVu Sans','Liberation Sans','Helvetica','Arial',sans-serif;fill:#000000;}</style>`);

  // Header
  parts.push(`<text x="${pad}" y="${headerY}" font-size="${headerSize}" font-weight="700">${esc(trunc(title, titleMaxChars))}</text>`);
  parts.push(`<text x="${pad}" y="${dateY}" font-size="${dateSize}" fill="#444444">${esc(dateLine)}</text>`);
  parts.push(`<line x1="${pad}" y1="${ruleY}" x2="${panelW - pad}" y2="${ruleY}" stroke="#000000" stroke-width="${ruleStroke}"/>`);

  // Body rows
  for (const r of placed) {
    if (r.kind === 'heading') {
      parts.push(`<text x="${pad}" y="${r.y + dayHeadingSize}" font-size="${dayHeadingSize}" font-weight="700">${esc(r.text)}</text>`);
      parts.push(`<line x1="${pad}" y1="${r.y + dayHeadingSize + Math.round(pad * 0.2)}" x2="${panelW - pad}" y2="${r.y + dayHeadingSize + Math.round(pad * 0.2)}" stroke="#888888" stroke-width="1"/>`);
    } else if (r.kind === 'empty') {
      parts.push(`<text x="${panelW / 2}" y="${r.y + lineH}" text-anchor="middle" font-size="${eventTitleSize}" fill="#666666">${esc(r.text)}</text>`);
    } else {
      const tx = r.time ?? '';
      const titleX = pad + timeColW;
      parts.push(`<text x="${pad}" y="${r.y + eventTitleSize}" font-size="${timeFont}" fill="#555555">${esc(trunc(tx, 13))}</text>`);
      parts.push(`<text x="${titleX}" y="${r.y + eventTitleSize}" font-size="${eventTitleSize}" font-weight="600">${esc(trunc(r.text, eventTitleMaxChars))}</text>`);
      if (r.sub) {
        parts.push(`<text x="${titleX}" y="${r.y + eventTitleSize + Math.round(eventSubSize * 1.25)}" font-size="${eventSubSize}" fill="#555555">${esc(trunc(r.sub, subMaxChars))}</text>`);
      }
    }
  }

  // Truncation note if events were dropped.
  if (placed.filter((p) => p.kind === 'event').length < rows.filter((r) => r.kind === 'event').length) {
    parts.push(`<text x="${panelW - pad}" y="${panelH - Math.round(pad * 0.4)}" text-anchor="end" font-size="${Math.round(eventSubSize * 0.9)}" fill="#777777">${esc('More events not shown')}</text>`);
  }

  parts.push(`</svg>`);
  return parts.join('');
}

/**
 * Build the canonical relative cache path for a calendar variant.
 */
export function calendarVariantRelPath(spec: { deviceId: string; contentId: string; hash: string; panelW: number; panelH: number }): string {
  return path
    .join('epaper', spec.deviceId, `${spec.contentId}-cal-${spec.hash}-${spec.panelW}x${spec.panelH}.jpg`)
    .replace(/\\/g, '/');
}

/**
 * Generate (if missing) and return a calendar JPEG variant for the device.
 * Stale variants for the same contentId are pruned opportunistically.
 */
export async function ensureCalendarVariant(spec: CalendarVariantSpec): Promise<CalendarVariantResult> {
  const now = spec.now ?? new Date();
  const dayBucket = dayKey(now.toISOString());
  const hash = hashEvents(spec.events, dayBucket, spec.panelW, spec.panelH, spec.title);

  const relPath = calendarVariantRelPath({
    deviceId: spec.deviceId,
    contentId: spec.contentId,
    hash,
    panelW: spec.panelW,
    panelH: spec.panelH,
  });
  const absPath = path.resolve(STORAGE_ROOT, relPath);

  if (existsSync(absPath)) {
    return { absPath, relPath, generated: false, hash };
  }

  await fs.mkdir(path.dirname(absPath), { recursive: true });

  const svg = renderCalendarSvg({
    panelW: spec.panelW,
    panelH: spec.panelH,
    title: spec.title,
    events: spec.events,
    now,
  });

  await sharp(Buffer.from(svg, 'utf8'))
    .jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toFile(absPath);

  // Drop stale variants for the same content (different hashes).
  await pruneStaleCalendarVariants(spec.deviceId, spec.contentId, hash).catch(() => undefined);

  return { absPath, relPath, generated: true, hash };
}

async function pruneStaleCalendarVariants(deviceId: string, contentId: string, keepHash: string): Promise<void> {
  const dir = path.resolve(STORAGE_ROOT, 'epaper', deviceId);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  const prefix = `${contentId}-cal-`;
  for (const name of entries) {
    if (!name.startsWith(prefix)) continue;
    if (name.includes(`-cal-${keepHash}-`)) continue;
    await fs.rm(path.join(dir, name), { force: true }).catch(() => undefined);
  }
}
