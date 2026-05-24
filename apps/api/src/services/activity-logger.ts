/**
 * Activity logger — records user interactions for Phase 4 personalisation.
 *
 * Usage (fire-and-forget, never awaited in route handlers):
 *   logActivity({ userId, workspaceId, eventType, eventData });
 *
 * All writes are fire-and-forget so they never block or fail a response.
 */

import { db, userActivityEvents } from '@signage/db';

export type ActivityEventType =
  | 'playlist_created'
  | 'playlist_deleted'
  | 'schedule_created'
  | 'schedule_deleted'
  | 'content_uploaded'
  | 'device_assigned'
  | 'page_view';

export interface LogActivityOptions {
  userId: string;
  workspaceId: string;
  eventType: ActivityEventType;
  eventData?: Record<string, unknown>;
}

export function logActivity(opts: LogActivityOptions): void {
  // Intentionally not awaited — a logging failure must never affect the user response.
  db.insert(userActivityEvents)
    .values({
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      eventType: opts.eventType,
      eventData: opts.eventData ?? null,
    })
    .catch(() => {
      // Silently discard — the table not existing (e.g. migration not yet run)
      // should not surface as an error to callers.
    });
}
