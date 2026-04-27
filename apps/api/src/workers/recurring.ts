/**
 * BullMQ worker + repeatable scheduler for recurring background jobs.
 *
 * Replaces the `setInterval`-driven scheduling in `services/jobs.ts` when
 * Redis is available. Survives API restarts because the schedule lives in
 * Redis rather than process memory.
 *
 * Each repeatable triggers a job named after the work to perform; the worker
 * dispatches to the correct service function.
 */

import { Worker, type ConnectionOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUE_NAMES, getQueue } from '../queues/index.js';
import {
  runFileCleanup,
  runContentExpiryNotifier,
  runHeartbeatCleanup,
  runPlayEventsPartition,
  runSensorReadingCleanup,
  runWebhookDeliveryCleanup,
} from '../services/jobs.js';

export interface RecurringJobData {
  name: string;
}

/** Job name → handler. Webhook delivery is enqueued at dispatch time, not as a recurring job. */
const HANDLERS: Record<string, () => Promise<void>> = {
  'file-cleanup':            runFileCleanup,
  'content-expiry':          runContentExpiryNotifier,
  'heartbeat-cleanup':       runHeartbeatCleanup,
  'play-events-partition':   runPlayEventsPartition,
  'sensor-reading-cleanup':  runSensorReadingCleanup,
  'webhook-delivery-cleanup': runWebhookDeliveryCleanup,
};

/** Cron schedules — UTC. */
const SCHEDULES: Record<string, string> = {
  'file-cleanup':             '0 * * * *',     // hourly
  'content-expiry':           '*/5 * * * *',   // every 5 minutes
  'heartbeat-cleanup':        '0 3 * * *',     // 03:00 UTC
  'play-events-partition':    '0 2 * * *',     // 02:00 UTC
  'sensor-reading-cleanup':   '0 4 * * *',     // 04:00 UTC
  'webhook-delivery-cleanup': '0 5 * * *',     // 05:00 UTC
};

/** Register one BullMQ repeatable per recurring job. Idempotent. */
export async function registerRecurringJobs(): Promise<void> {
  const queue = getQueue<RecurringJobData>(QUEUE_NAMES.recurring);
  if (!queue) return;

  for (const [name, cron] of Object.entries(SCHEDULES)) {
    await queue.add(
      name,
      { name },
      {
        repeat: { pattern: cron },
        // Stable jobId so re-registering doesn't create duplicates.
        jobId: `repeat-${name}`,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 50 },
      },
    );
  }
}

export function startRecurringWorker(connection: Redis): Worker<RecurringJobData> {
  const worker = new Worker<RecurringJobData>(
    QUEUE_NAMES.recurring,
    async (job) => {
      const handler = HANDLERS[job.name] ?? HANDLERS[job.data.name];
      if (!handler) throw new Error(`No handler for recurring job: ${job.name}`);
      await handler();
    },
    {
      connection: connection as unknown as ConnectionOptions,
      concurrency: 1, // recurring jobs are admin/maintenance — serialise
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[recurring/${job?.name}] failed:`, err.message);
  });

  return worker;
}

export const RECURRING_JOB_NAMES = Object.keys(SCHEDULES);
