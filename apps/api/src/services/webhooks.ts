/**
 * Outbound Webhook delivery service.
 *
 * Call dispatchWebhookEvent() from any route or service when a platform event
 * occurs. It enqueues delivery records that the retry job picks up.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { db, outboundWebhooks, webhookDeliveries } from '@signage/db';
import { and, eq, inArray, sql, lte } from 'drizzle-orm';
import { getQueue, QUEUE_NAMES } from '../queues/index.js';

/** All event types the platform can emit to outbound webhooks */
export type WebhookEventType =
  | 'device.offline'
  | 'device.online'
  | 'device.command'
  | 'content.published'
  | 'playlist.published'
  | 'schedule.activated'
  | 'schedule.deactivated'
  | 'emergency.activated'
  | 'emergency.cleared'
  | 'sensor.reading'
  | 'trigger.fired'
  | 'play_event.created';

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Compute HMAC-SHA256 signature over the serialised payload.
 * Header format: `X-Signage-Signature: sha256=<hex>`
 */
export function signWebhookPayload(secret: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Persist delivery records for all active webhooks of this org that subscribe
 * to this event type. The retry job will attempt the actual HTTP POST.
 */
export async function dispatchWebhookEvent(
  orgId: string,
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const hooks = await db.query.outboundWebhooks.findMany({
      where: and(
        eq(outboundWebhooks.orgId, orgId),
        eq(outboundWebhooks.isActive, true),
        sql`${eventType} = ANY(${outboundWebhooks.events})`,
      ),
    });

    if (hooks.length === 0) return;

    const envelope = { event: eventType, timestamp: new Date().toISOString(), ...payload };

    const inserted = await db.insert(webhookDeliveries).values(
      hooks.map((hook) => ({
        webhookId:     hook.id,
        eventType,
        payload:       envelope,
        status:        'pending' as const,
        attemptCount:  0,
        nextAttemptAt: new Date(),
      })),
    ).returning({ id: webhookDeliveries.id });

    // Enqueue BullMQ jobs for native retry/backoff (Step 10). Falls back to
    // the setInterval-driven `runWebhookDeliveryJob` if Redis is unavailable.
    const queue = getQueue<{ deliveryId: string }>(QUEUE_NAMES.webhookDelivery);
    if (queue) {
      for (const row of inserted) {
        await queue.add('deliver', { deliveryId: row.id }, {
          jobId: `delivery-${row.id}`,
          attempts: MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: 30_000 }, // 30s, 60s, 2m, 4m, 8m
        });
      }
    }
  } catch (err) {
    console.error('[webhooks/dispatch] Failed to queue deliveries:', err);
  }
}

/** Maximum delivery attempts before marking as abandoned */
const MAX_ATTEMPTS = 5;

/** Exponential backoff delays in seconds: 30s, 2m, 10m, 30m, 2h */
const BACKOFF_SECONDS = [30, 120, 600, 1800, 7200];

/**
 * Attempt a single webhook delivery by id. Updates the delivery row to
 * `success` / `failed` (with backoff) / `abandoned` based on the outcome.
 *
 * Returns `true` if delivered successfully. Throws on transient failure when
 * `throwOnFail` is set so BullMQ can retry with its own backoff.
 */
export async function attemptWebhookDelivery(
  deliveryId: string,
  opts: { throwOnFail?: boolean } = {},
): Promise<boolean> {
  const delivery = await db.query.webhookDeliveries.findFirst({
    where: eq(webhookDeliveries.id, deliveryId),
    with: { webhook: true },
  });
  if (!delivery) return false;

  const webhook = delivery.webhook;
  if (!webhook || !webhook.isActive) {
    await db.update(webhookDeliveries)
      .set({ status: 'abandoned' })
      .where(eq(webhookDeliveries.id, delivery.id));
    return false;
  }

  const body = JSON.stringify(delivery.payload);
  const signature = signWebhookPayload(webhook.secret, body);
  const attempt = Number(delivery.attemptCount ?? 0) + 1;

  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let succeeded = false;
  let networkErr: Error | null = null;

  try {
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type':        'application/json',
        'X-Signage-Signature': signature,
        'X-Signage-Event':     delivery.eventType,
        'X-Signage-Attempt':   String(attempt),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    responseStatus = res.status;
    responseBody   = await res.text().catch(() => null);
    succeeded      = res.ok;
  } catch (err) {
    networkErr = err as Error;
  }

  if (succeeded) {
    await db.update(webhookDeliveries).set({
      status:       'success',
      responseStatus,
      responseBody,
      attemptCount: attempt,
      deliveredAt:  new Date(),
    }).where(eq(webhookDeliveries.id, delivery.id));
    return true;
  }

  if (attempt >= MAX_ATTEMPTS) {
    await db.update(webhookDeliveries).set({
      status:       'abandoned',
      responseStatus,
      responseBody,
      attemptCount: attempt,
    }).where(eq(webhookDeliveries.id, delivery.id));
    return false;
  }

  const backoff = (BACKOFF_SECONDS[attempt - 1] ?? 7200) * 1000;
  await db.update(webhookDeliveries).set({
    status:        'failed',
    responseStatus,
    responseBody,
    attemptCount:  attempt,
    nextAttemptAt: new Date(Date.now() + backoff),
  }).where(eq(webhookDeliveries.id, delivery.id));

  if (opts.throwOnFail) {
    throw networkErr ?? new Error(`Webhook delivery failed (status=${responseStatus ?? 'n/a'})`);
  }
  return false;
}

/**
 * Background job: attempt all pending deliveries and retry failed ones.
 * Called from jobs.ts on a short interval (e.g. every 30 s).
 *
 * When BullMQ is active, deliveries are enqueued at dispatch time and this
 * job becomes a safety-net for rows that pre-date the queue (e.g. created
 * during a Redis outage).
 */
export async function runWebhookDeliveryJob(): Promise<void> {
  try {
    const due = await db.query.webhookDeliveries.findMany({
      where: and(
        inArray(webhookDeliveries.status, ['pending', 'failed']),
        lte(webhookDeliveries.nextAttemptAt, new Date()),
      ),
      limit: 50,
    });

    if (due.length === 0) return;

    await Promise.allSettled(due.map((d) => attemptWebhookDelivery(d.id)));
  } catch (err) {
    console.error('[webhooks/delivery-job] Error:', err);
  }
}
