/**
 * calendar.ts — Calendar widget renderer for player-web.
 *
 * Ported from apps/nexari-tizen/src/player.ts `renderCalendar()` method.
 * Supports views: day, week, workweek, month, meeting_room.
 * Fetches events from the API and subscribes to WS push updates.
 */
import type { ContentRecord, CalendarEvent as Ev } from '../api.js';
import type { Api } from '../api.js';
export interface CalendarHandle {
    destroy(): void;
}
export declare function renderCalendar(container: HTMLElement, content: ContentRecord, api: Api, deviceId: string, ws: WebSocket | null, 
/** Called when a calendar_events push arrives on the main WS — pass the raw msg.events array */
registerPushHandler: (contentId: string, handler: (events: Ev[]) => void) => (() => void)): CalendarHandle;
//# sourceMappingURL=calendar.d.ts.map