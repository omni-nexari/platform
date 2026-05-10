/**
 * api.ts — thin REST client wrapping the Nexari API.
 *
 * Mirrors the `API` global used by the Tizen player but works as an ES module
 * with a configurable base URL so it runs in any WebView host.
 */
export declare class Api {
    private base;
    private token;
    constructor(base: string, token: () => string | null);
    /** Returns the schedule object for this device.  Throws on non-2xx. */
    getCurrentContent(_deviceId: string): Promise<Schedule | null>;
    private enrichContent;
    /**
     * Sends a heartbeat.  The server processes heartbeats only via WebSocket
     * (type='heartbeat' message).  This method is kept as a no-op HTTP stub;
     * the Player class sends heartbeats directly over the WS connection instead.
     */
    sendHeartbeat(_deviceId: string, _payload: Record<string, unknown>): Promise<void>;
    /** Uploads a base64-encoded screenshot. Best-effort (never throws). */
    uploadScreenshot(deviceId: string, jpegBase64: string, trigger?: string): Promise<void>;
    /** Fetches NTP server time. Returns epoch-ms or null on failure. */
    getServerTime(): Promise<number | null>;
    /** POST /devices/pair/request */
    pairDevice(info: PairInfo): Promise<{
        code?: string;
        deviceToken?: string;
        status?: string;
        deviceId?: string;
    }>;
    /** GET /devices/pair/status?code=… */
    pairStatus(code: string): Promise<{
        claimed: boolean;
        token?: string;
    }>;
    /** GET /pos/menu?workspaceId=… */
    getPosMenu(workspaceId: string): Promise<PosMenu | null>;
    /** GET /devices/device/:id/content/:contentId/calendar/events */
    getCalendarEvents(_deviceId: string, contentId: string, from: Date, to: Date): Promise<CalendarEvent[]>;
    sendLogs(deviceId: string, entries: LogEntry[]): Promise<void>;
}
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
//# sourceMappingURL=api.d.ts.map