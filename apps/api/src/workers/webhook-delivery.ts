/**
 * BullMQ worker — webhook-delivery queue.
 *
 * Processes one delivery at a time using `attemptWebhookDelivery()`.
 * BullMQ owns the retry/backoff schedule per the job's `attempts` and
 * `backoff` options set in `dispatchWebhookEvent()`.
 *
 * Concurrency = 5 — webhook delivery is IO-bound (HTTP roundtrip), not CPU.
 */

import { Worker, type ConnectionOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { attemptWebhookDelivery } from '../services/webhooks.js';
import { QUEUE_NAMES } from '../queues/index.js';

export interface WebhookDeliveryJobData {
  deliveryId: string;
}

export function startWebhookDeliveryWorker(connection: Redis): Worker<WebhookDeliveryJobData> {
  const worker = new Worker<WebhookDeliveryJobData>(
    QUEUE_NAMES.webhookDelivery,
    async (job) => {
      // Throw on transient failure so BullMQ schedules the next retry.
      const ok = await attemptWebhookDelivery(job.data.deliveryId, { throwOnFail: true });
      return { ok };
    },
    {
      connection: connection as unknown as ConnectionOptions,
      concurrency: 5,
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 200 },
    },
  );

  worker.on('failed', (job, err) => {
    if ((job?.attemptsMade ?? 0) >= (job?.opts.attempts ?? 5)) {
      console.warn(`[webhook-delivery] giving up on delivery ${job?.data.deliveryId}: ${err.message}`);
    }
  });

  return worker;
}
