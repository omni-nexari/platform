/**
 * api.ts — thin REST client wrapping the Nexari API.
 *
 * Mirrors the `API` global used by the Tizen player but works as an ES module
 * with a configurable base URL so it runs in any WebView host.
 */

export class Api {
  constructor(private base: string, private token: () => string | null) {}

  // ── Schedule / content ────────────────────────────────────────────────────

  /** Returns the schedule object for this device.  Throws on non-2xx. */
  async getCurrentContent(_deviceId: string): Promise<Schedule | null> {
    const t = this.token();
    // The server resolves device identity from the JWT; no :id in path.
    const url = `${this.base}/devices/device/schedule${t ? `?token=${encodeURIComponent(t)}` : ''}`;
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw Object.assign(new Error(`schedule HTTP ${res.status}`), { status: res.status });
    const body = await res.json() as { schedules?: unknown[] };
    if (!Array.isArray(body.schedules) || !body.schedules.length) return null;

    const raw = body.schedules[0] as Record<string, unknown>;
    // Server uses 'slots' not 'items' — normalize and enrich content URLs
    const slots = (raw.slots as Array<Record<string, unknown>> | undefined) ?? [];
    const items: ScheduleItem[] = slots.flatMap((slot): ScheduleItem[] => {
      const playlist = slot['playlist'] as { items?: Array<Record<string, unknown>> } | null;
      if (playlist?.items?.length) {
        // Playlist slot: expand into the playlist's individual items
        return playlist.items
          .map((pi): ScheduleItem | null => {
            const c = this.enrichContent(pi['content'] as Record<string, unknown> | null, t);
            if (!c) return null;
            return { id: pi['id'] as string, contentId: pi['contentId'] as string | undefined,
              duration: pi['duration'] as number | undefined, content: c };
          })
          .filter((x): x is ScheduleItem => x !== null);
      }
      // Direct content slot
      const c = this.enrichContent(slot['content'] as Record<string, unknown> | null, t);
      if (!c) return [];
      const contentRaw = slot['content'] as Record<string, unknown>;
      return [{ id: slot['id'] as string, contentId: slot['contentId'] as string | undefined,
        duration: contentRaw['duration'] as number | undefined, content: c }];
    });

    return { ...(raw as unknown as Schedule), items };
  }

  private enrichContent(content: Record<string, unknown> | null, token: string | null): ContentRecord | null {
    if (!content) return null;
    const id = content['id'] as string;
    const type = ((content['type'] as string) ?? '').toLowerCase();
    let url: string | undefined;
    if (type === 'web_url') {
      url = content['webUrl'] as string | undefined;
    } else if (type === 'html5') {
      // Token is embedded in path so relative asset requests carry it automatically
      url = token
        ? `${this.base}/devices/device/content/${id}/html5/${encodeURIComponent(token)}/`
        : undefined;
    } else {
      url = `${this.base}/devices/device/content/${id}/file${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    }
    return { ...(content as unknown as ContentRecord), url };
  }

  /**
   * Sends a heartbeat.  The server processes heartbeats only via WebSocket
   * (type='heartbeat' message).  This method is kept as a no-op HTTP stub;
   * the Player class sends heartbeats directly over the WS connection instead.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async sendHeartbeat(_deviceId: string, _payload: Record<string, unknown>): Promise<void> {
    // No-op: heartbeats are sent over WebSocket in Player.sendHeartbeat()
  }

  /** Uploads a base64-encoded screenshot. Best-effort (never throws). */
  async uploadScreenshot(deviceId: string, jpegBase64: string, trigger = 'manual'): Promise<void> {
    try {
      const t = this.token();
      await fetch(`${this.base}/devices/device/${encodeURIComponent(deviceId)}/screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jpegBase64, trigger, ...(t ? { token: t } : {}) }),
      });
    } catch { /* best-effort */ }
  }

  /** Fetches NTP server time. Returns epoch-ms or null on failure. */
  async getServerTime(): Promise<number | null> {
    try {
      const res = await fetch(`${this.base}/devices/time`);
      if (!res.ok) return null;
      const body = await res.json() as { timestamp?: number; serverTime?: number };
      return body.timestamp ?? body.serverTime ?? null;
    } catch { return null; }
  }

  /** POST /devices/pair/request */
  async pairDevice(info: PairInfo): Promise<{ code?: string; deviceToken?: string; status?: string; deviceId?: string }> {
    const url = `${this.base}/devices/pair/request`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(info),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        let body = '';
        try { body = await res.text(); } catch { /* ignore */ }
        throw new Error(`pair HTTP ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
      }
      return res.json();
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error(`pair timed out after 15s (is the API running at ${this.base}?)`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET /devices/pair/status?code=… */
  async pairStatus(code: string): Promise<{ claimed: boolean; token?: string }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(`${this.base}/devices/pair/status?code=${encodeURIComponent(code)}`, { signal: ctrl.signal });
      if (!res.ok) return { claimed: false };
      const body = await res.json() as { status?: string; deviceToken?: string };
      return { claimed: body.status === 'claimed', token: body.deviceToken };
    } catch {
      return { claimed: false };
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET /pos/menu?workspaceId=… */
  async getPosMenu(workspaceId: string): Promise<PosMenu | null> {
    try {
      const t = this.token();
      const res = await fetch(
        `${this.base}/pos/menu?workspaceId=${encodeURIComponent(workspaceId)}${t ? `&token=${encodeURIComponent(t)}` : ''}`,
      );
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  }

  /** GET /devices/device/:id/content/:contentId/calendar/events */
  async getCalendarEvents(
    _deviceId: string,
    contentId: string,
    from: Date,
    to: Date,
  ): Promise<CalendarEvent[]> {
    const t = this.token();
    // Route: /device/content/:id/calendar/events — device identity comes from the JWT, no :deviceId in path.
    // Tizen player uses the same path. The old path (/device/:deviceId/content/...) returned 404.
    const res = await fetch(
      `${this.base}/devices/device/content/${encodeURIComponent(contentId)}/calendar/events`
        + `?from=${encodeURIComponent(from.toISOString())}`
        + `&to=${encodeURIComponent(to.toISOString())}`
        + (t ? `&token=${encodeURIComponent(t)}` : ''),
    );
    if (!res.ok) return [];
    const body = await res.json() as { events?: CalendarEvent[] };
    return body.events ?? [];
  }

  // ── Logging ───────────────────────────────────────────────────────────────

  async sendLogs(deviceId: string, entries: LogEntry[]): Promise<void> {
    try {
      const t = this.token();
      await fetch(`${this.base}/devices/device/${encodeURIComponent(deviceId)}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries, ...(t ? { token: t } : {}) }),
      });
    } catch { /* best-effort */ }
  }
}

// ── Domain types ─────────────────────────────────────────────────────────────

export interface PairInfo {
  duid: string;
  modelName?: string;
  modelCode?: string;
  serialNumber?: string;
  firmwareVersion?: string;
  kind: string;
  platform: string;
  playerVersion?: string;
  resolution?: string;
}

export interface ScheduleItem {
  id: string;
  contentId?: string;
  duration?: number;
  transition?: unknown;
  content: ContentRecord;
}

export interface ContentRecord {
  id: string;
  name?: string;
  type: string;
  url?: string;
  metadata?: string | Record<string, unknown>;
  channels?: unknown[];
  [key: string]: unknown;
}

export interface Schedule {
  id?: string;
  playlistId?: string;
  playlistName?: string;
  syncGroupId?: string;
  syncPlay?: unknown;
  items: ScheduleItem[];
}

export interface PosMenu {
  id: string;
  name?: string;
  description?: string;
  currency?: string;
  categories?: PosCategory[];
}
export interface PosCategory {
  id: string;
  name: string;
  description?: string;
  color?: string;
  items: PosItem[];
}
export interface PosItem {
  id: string;
  name: string;
  description?: string;
  priceCents?: number;
  imageUrl?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string | null;
  isPrivate: boolean;
  status?: string;
  attendeeCount?: number | null;
  organizerName?: string | null;
  organizerEmail?: string | null;
}

export interface LogEntry {
  level: string;
  message: string;
  timestamp: number;
  data?: unknown;
}
