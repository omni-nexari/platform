/**
 * BullMQ worker bootstrap.
 *
 * Phase 1 scaffolding — `startWorkers()` is wired into the API boot sequence
 * but currently registers zero workers. Subsequent phases will add:
 *   - media-processing worker (Phase 2)
 *   - webhook-delivery worker (Phase 3)
 *   - recurring jobs worker (Phase 4)
 *
 * Design notes:
 * - If Redis is unavailable, `startWorkers()` is a no-op and the legacy inline
 *   / setInterval code paths continue to handle work as before.
 * - Workers are tracked in `_workers` so `stopWorkers()` can close them on
 *   graceful shutdown.
 */

import type { Worker } from 'bullmq';
import { getBullConnection } from '../queues/index.js';
import { startMediaProcessingWorker } from './media-processing.js';
import { startWebhookDeliveryWorker } from './webhook-delivery.js';
import { startRecurringWorker, registerRecurringJobs } from './recurring.js';

const _workers: Worker[] = [];

/**
 * Register a worker so it is closed during graceful shutdown.
 * Used by individual worker modules added in later phases.
 */
export function registerWorker(worker: Worker): void {
  _workers.push(worker);
}

/**
 * Start all BullMQ workers. No-op when Redis is not configured.
 * Safe to call once during API startup.
 */
export function startWorkers(logger?: { info: (msg: string) => void; warn: (msg: string) => void }): void {
  const conn = getBullConnection();
  if (!conn) {
    logger?.warn('[workers] REDIS_URL not set — BullMQ workers disabled, falling back to inline processing');
    return;
  }

  // Phase 2 — media-processing worker (consumed by upload handler).
  registerWorker(startMediaProcessingWorker(conn));

  // Phase 3 — webhook delivery worker (consumed by dispatchWebhookEvent).
  registerWorker(startWebhookDeliveryWorker(conn));

  // Phase 4 — recurring jobs as BullMQ repeatables.
  registerWorker(startRecurringWorker(conn));
  registerRecurringJobs().catch((err) => {
    logger?.warn(`[workers] failed to register recurring jobs: ${(err as Error).message}`);
  });

  logger?.info(`[workers] BullMQ worker host ready (registered=${_workers.length})`);
}

/**
 * Close all registered workers. Called during API graceful shutdown.
 */
export async function stopWorkers(): Promise<void> {
  await Promise.all(
    _workers.map(async (w) => {
      try { await w.close(); } catch { /* non-fatal */ }
    }),
  );
  _workers.length = 0;
}
