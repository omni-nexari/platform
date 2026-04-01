import { db, logEntries } from '@signage/db';
import { lt, sql } from 'drizzle-orm';

/**
 * Retention policy: delete log rows older than N days per level.
 * Runs every hour. Also enforces a hard cap of 100k rows per source
 * to guard against runaway debug logging.
 */
const RETENTION_DAYS: Record<string, number> = {
  debug: 1,
  info:  7,
  warn:  30,
  error: 90,
};

const ROW_CAP_PER_SOURCE = 100_000;

export function startLogCleanup(): void {
  void runCleanup();
  setInterval(() => void runCleanup(), 60 * 60 * 1000); // every hour
}

async function runCleanup(): Promise<void> {
  try {
    let totalDeleted = 0;

    // TTL-based deletion per level
    for (const [level, days] of Object.entries(RETENTION_DAYS)) {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const result = await db
        .delete(logEntries)
        .where(
          sql`${logEntries.level} = ${level} AND ${logEntries.createdAt} < ${cutoff}`,
        )
        .returning({ id: logEntries.id });
      totalDeleted += result.length;
    }

    // Hard row cap per source — keep the newest ROW_CAP_PER_SOURCE rows
    const sources = ['api', 'ds', 'tizen', 'tizen-sbb'] as const;
    for (const source of sources) {
      await db.execute(sql`
        DELETE FROM log_entries
        WHERE source = ${source}
          AND id NOT IN (
            SELECT id FROM log_entries
            WHERE source = ${source}
            ORDER BY id DESC
            LIMIT ${ROW_CAP_PER_SOURCE}
          )
      `);
    }

    if (totalDeleted > 0) {
      console.info(`[log-cleanup] Deleted ${totalDeleted} expired log entries.`);
    }
  } catch (err) {
    console.error('[log-cleanup] Cleanup error:', err);
  }
}
