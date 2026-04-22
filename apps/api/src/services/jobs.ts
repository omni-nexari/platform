import { db } from '@signage/db';
import {
  contentItems,
  deviceHeartbeats,
  workspaces,
  sensorReadings,
  webhookDeliveries,
} from '@signage/db';
import { and, lt, gte, eq, sql, isNull, inArray } from 'drizzle-orm';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  createNotifications,
  listWorkspaceAdminUserIds,
} from './notifications.js';
import { runWebhookDeliveryJob } from './webhooks.js';

const STORAGE_ROOT = process.env['STORAGE_ROOT'] ?? './signage_uploads';
const TRASH_RETENTION_DAYS = Number(process.env['TRASH_RETENTION_DAYS'] ?? '7');

// ─── Job metrics ─────────────────────────────────────────────────────────────

interface JobMetric {
  lastRunAt:     Date | null;
  lastDurationMs: number | null;
  errorCount:    number;
  runCount:      number;
}

const _jobMetrics = new Map<string, JobMetric>();

function recordJobRun(name: string, durationMs: number, error?: boolean): void {
  const prev = _jobMetrics.get(name) ?? { lastRunAt: null, lastDurationMs: null, errorCount: 0, runCount: 0 };
  _jobMetrics.set(name, {
    lastRunAt:      error ? prev.lastRunAt : new Date(),
    lastDurationMs: error ? prev.lastDurationMs : durationMs,
    errorCount:     prev.errorCount + (error ? 1 : 0),
    runCount:       prev.runCount + 1,
  });
}

/** Returns a snapshot of per-job runtime metrics (for the /health/jobs endpoint). */
export function getJobMetrics(): Record<string, JobMetric> {
  return Object.fromEntries(_jobMetrics);
}

// Wraps an async job function so timing + error counts are recorded automatically.
function wrapJob(name: string, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const start = Date.now();
    try {
      await fn();
      recordJobRun(name, Date.now() - start);
    } catch (err) {
      recordJobRun(name, Date.now() - start, true);
      console.error(`[jobs/${name}] Error:`, err);
    }
  };
}

export function startJobs(): void {
  // Stagger initial runs to avoid hammering the DB at startup
  setTimeout(wrapJob('play-events-partition', runPlayEventsPartition), 5_000);
  setTimeout(wrapJob('file-cleanup',          runFileCleanup),          10_000);
  setTimeout(wrapJob('content-expiry',        runContentExpiryNotifier), 20_000);
  setTimeout(wrapJob('heartbeat-cleanup',     runHeartbeatCleanup),      30_000);
  setTimeout(wrapJob('webhook-delivery',      runWebhookDeliveryJob),    35_000);

  setInterval(wrapJob('file-cleanup',              runFileCleanup),              60 * 60 * 1000);
  setInterval(wrapJob('content-expiry',            runContentExpiryNotifier),    5 * 60 * 1000);
  setInterval(wrapJob('heartbeat-cleanup',         runHeartbeatCleanup),         24 * 60 * 60 * 1000);
  setInterval(wrapJob('play-events-partition',     runPlayEventsPartition),      24 * 60 * 60 * 1000);
  setInterval(wrapJob('webhook-delivery',          runWebhookDeliveryJob),       30 * 1000);
  setInterval(wrapJob('sensor-reading-cleanup',    runSensorReadingCleanup),     24 * 60 * 60 * 1000);
  setInterval(wrapJob('webhook-delivery-cleanup',  runWebhookDeliveryCleanup),   24 * 60 * 60 * 1000);
}

// Hard-delete content DB rows (and files from disk) after the trash retention window
async function runFileCleanup(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const expired = await db.query.contentItems.findMany({
      where: lt(contentItems.deletedAt, cutoff),
    });
    if (expired.length === 0) return;

    let cleaned = 0;
    for (const item of expired) {
      if (item.filePath) {
        await fs.unlink(path.resolve(STORAGE_ROOT, item.filePath)).catch(() => {});
      }
      if (item.thumbnailPath) {
        await fs.unlink(path.resolve(STORAGE_ROOT, item.thumbnailPath)).catch(() => {});
      }
      await db.delete(contentItems).where(eq(contentItems.id, item.id));
      cleaned++;
    }

    if (cleaned > 0) {
      console.info(`[jobs/file-cleanup] Permanently deleted ${cleaned} expired content item(s).`);
    }
  } catch (err) {
    console.error('[jobs/file-cleanup] Error:', err);
  }
}

// Notify workspace admins when content passes its validUntil date.
// Uses a 6-minute sliding window (wider than the 5-min interval) to catch
// items that crossed the threshold since the last run.
async function runContentExpiryNotifier(): Promise<void> {
  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 6 * 60 * 1000);

    const expiredItems = await db
      .select({
        id: contentItems.id,
        name: contentItems.name,
        workspaceId: contentItems.workspaceId,
        orgId: workspaces.orgId,
      })
      .from(contentItems)
      .innerJoin(workspaces, eq(contentItems.workspaceId, workspaces.id))
      .where(
        and(
          isNull(contentItems.deletedAt),
          eq(contentItems.approvalState, 'approved'),
          lt(contentItems.validUntil, now),
          gte(contentItems.validUntil, windowStart),
        ),
      );

    for (const item of expiredItems) {
      const adminIds = await listWorkspaceAdminUserIds(item.workspaceId);
      if (adminIds.length === 0) continue;
      await createNotifications({
        orgId: item.orgId,
        userIds: adminIds,
        type: 'content_expiring',
        title: 'Content expired',
        body: `"${item.name}" has passed its valid-until date and may no longer display.`,
        entityType: 'content',
        entityId: item.id,
      });
    }

    if (expiredItems.length > 0) {
      console.info(`[jobs/content-expiry] Notified for ${expiredItems.length} expired item(s).`);
    }
  } catch (err) {
    console.error('[jobs/content-expiry] Error:', err);
  }
}

// Prune device heartbeat rows older than 48 hours
async function runHeartbeatCleanup(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const result = await db
      .delete(deviceHeartbeats)
      .where(lt(deviceHeartbeats.createdAt, cutoff))
      .returning({ id: deviceHeartbeats.id });

    if (result.length > 0) {
      console.info(`[jobs/heartbeat-cleanup] Deleted ${result.length} old heartbeat row(s).`);
    }
  } catch (err) {
    console.error('[jobs/heartbeat-cleanup] Error:', err);
  }
}

// Ensure the next 2 months of play_events partitions exist (idempotent)
async function runPlayEventsPartition(): Promise<void> {
  try {
    const today = new Date();
    for (let offset = 1; offset <= 2; offset++) {
      const target = new Date(today.getFullYear(), today.getMonth() + offset, 1);
      const next = new Date(today.getFullYear(), today.getMonth() + offset + 1, 1);

      const year = target.getFullYear();
      const month = String(target.getMonth() + 1).padStart(2, '0');
      const tableName = `play_events_${year}_${month}`;
      const fromDate = `${year}-${month}-01`;

      const toYear = next.getFullYear();
      const toMonth = String(next.getMonth() + 1).padStart(2, '0');
      const toDate = `${toYear}-${toMonth}-01`;

      await db.execute(
        sql`CREATE TABLE IF NOT EXISTS ${sql.raw(`"${tableName}"`)} PARTITION OF play_events FOR VALUES FROM (${fromDate}) TO (${toDate})`,
      );
    }
  } catch (err) {
    console.error('[jobs/play-events-partition] Error:', err);
  }
}

// Prune sensor readings older than 30 days (raw retention policy)
async function runSensorReadingCleanup(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await db
      .delete(sensorReadings)
      .where(lt(sensorReadings.recordedAt, cutoff))
      .returning({ id: sensorReadings.id });
    if (result.length > 0) {
      console.info(`[jobs/sensor-cleanup] Pruned ${result.length} old sensor reading(s).`);
    }
  } catch (err) {
    console.error('[jobs/sensor-cleanup] Error:', err);
  }
}

// Prune old webhook deliveries (keep 30 days of history)
async function runWebhookDeliveryCleanup(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await db
      .delete(webhookDeliveries)
      .where(
        and(
          lt(webhookDeliveries.createdAt, cutoff),
          inArray(webhookDeliveries.status, ['success', 'abandoned']),
        ),
      )
      .returning({ id: webhookDeliveries.id });
    if (result.length > 0) {
      console.info(`[jobs/webhook-delivery-cleanup] Pruned ${result.length} old delivery record(s).`);
    }
  } catch (err) {
    console.error('[jobs/webhook-delivery-cleanup] Error:', err);
  }
}
