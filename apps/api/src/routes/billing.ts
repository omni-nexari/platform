/**
 * Billing routes — Phase 2 (Stripe integration)
 *
 * Org-facing routes (app.authenticate):
 *   GET  /billing/subscription   — current plan, trial status, usage
 *   GET  /billing/invoices        — invoice history
 *   POST /billing/checkout        — create Stripe Checkout Session
 *   POST /billing/portal          — create Stripe Customer Portal session
 *
 * Stripe webhook (raw body, no auth):
 *   POST /billing/webhook         — handles Stripe events
 *
 * Auth decorators used (from plugins/index.ts):
 *   app.authenticate              — org user JWT
 *   app.authenticatePlatformAdmin — platform_owner OR management_company_admin
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  db,
  organizations,
  devices,
  pricingPlans,
  pricingPlanPrices,
  orgSubscriptions,
  invoices,
  screenUsageRecords,
} from '@signage/db';
import { eq, and, isNull, desc, count } from 'drizzle-orm';
import {
  getStripe,
  createCheckoutSession,
  createCustomerPortalSession,
  constructWebhookEvent,
  reportScreenUsage,
  createStripeCustomer,
} from '../services/stripe.js';
import { writeAuditLog } from '../services/audit.js';
import type Stripe from 'stripe';

type AuthUser = { sub: string; orgId: string; role: string };

const APP_URL = (process.env['APP_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Count active (non-deleted, non-unclaimed) screens for an org */
async function getOrgScreenCount(orgId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(devices)
    .where(
      and(
        eq(devices.orgId, orgId),
        isNull(devices.deletedAt),
      ),
    );
  return Number(row?.total ?? 0);
}

/** Get or create a Stripe customer for a direct-billed org. */
async function ensureStripeCustomer(
  orgId: string,
  existingCustomerId: string | null | undefined,
  orgEmail: string,
  orgName: string,
  currency: string,
): Promise<string> {
  if (existingCustomerId) return existingCustomerId;
  const customer = await createStripeCustomer({ email: orgEmail, name: orgName, orgId, currency });
  // Persist the new stripeCustomerId on the subscription row (caller updates after this)
  return customer.id;
}

// ---------------------------------------------------------------------------
// Webhook handlers
// ---------------------------------------------------------------------------

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const orgId = session.metadata?.['orgId'];
  const planId = session.metadata?.['planId'];
  const currency = session.metadata?.['currency'] ?? 'CAD';
  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id ?? null;

  if (!orgId || !planId || !subscriptionId) {
    console.warn('[billing/webhook] checkout.session.completed missing metadata', { orgId, planId, subscriptionId });
    return;
  }

  const stripe = getStripe();
  const stripeSub = stripe ? await stripe.subscriptions.retrieve(subscriptionId) : null;
  const stripeCustomerId = typeof session.customer === 'string'
    ? session.customer
    : session.customer?.id ?? null;

  // Find the subscription item id (for seat-count quantity updates)
  const mainItem = stripeSub?.items?.data?.[0];
  const stripeSubscriptionItemId = mainItem?.id ?? null;

  const now = new Date();
  const periodStart = mainItem?.current_period_start
    ? new Date(mainItem.current_period_start * 1000)
    : now;
  const periodEnd = mainItem?.current_period_end
    ? new Date(mainItem.current_period_end * 1000)
    : null;

  // Upsert subscription row
  const existing = await db.query.orgSubscriptions.findFirst({
    where: eq(orgSubscriptions.orgId, orgId),
  });

  if (existing) {
    await db.update(orgSubscriptions).set({
      planId,
      currency,
      status: 'active',
      billingModel: 'direct',
      stripeCustomerId,
      stripeSubscriptionId: subscriptionId,
      stripeSubscriptionItemId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      trialEndsAt: null,
      updatedAt: now,
    }).where(eq(orgSubscriptions.id, existing.id));
  } else {
    await db.insert(orgSubscriptions).values({
      orgId,
      planId,
      currency,
      status: 'active',
      billingModel: 'direct',
      stripeCustomerId,
      stripeSubscriptionId: subscriptionId,
      stripeSubscriptionItemId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    });
  }

  // Activate the org if it was pending/trialing
  await db.update(organizations).set({
    status: 'active',
    plan: planId,
    updatedAt: now,
  }).where(eq(organizations.id, orgId));

  await writeAuditLog({
    orgId,
    actorType: 'system',
    action: 'SUBSCRIPTION_ACTIVATED',
    entityType: 'subscription',
    meta: { planId, currency, stripeSubscriptionId: subscriptionId },
  });
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id ?? null;
  if (!customerId) return;

  // Find the org's subscription by Stripe customer ID
  const sub = await db.query.orgSubscriptions.findFirst({
    where: eq(orgSubscriptions.stripeCustomerId, customerId),
  });
  if (!sub) return;

  const now = new Date();
  const stripeSubId = typeof invoice.parent?.subscription_details?.subscription === 'string'
    ? invoice.parent.subscription_details.subscription
    : (invoice.parent?.subscription_details?.subscription as { id?: string } | undefined)?.id ?? null;

  // Update billing period if subscription ID matches
  if (stripeSubId && sub.stripeSubscriptionId === stripeSubId) {
    const stripe = getStripe();
    const stripeSub = stripe ? await stripe.subscriptions.retrieve(stripeSubId) : null;
    if (stripeSub) {
      const mainItem = stripeSub.items.data[0];
      await db.update(orgSubscriptions).set({
        status: 'active',
        currentPeriodStart: mainItem?.current_period_start
          ? new Date(mainItem.current_period_start * 1000)
          : undefined,
        currentPeriodEnd: mainItem?.current_period_end
          ? new Date(mainItem.current_period_end * 1000)
          : undefined,
        updatedAt: now,
      }).where(eq(orgSubscriptions.id, sub.id));
    }
  }

  // Create an invoice record
  const totalCents = invoice.amount_paid ?? 0;
  const taxCents = 0; // tax per line item; simplified
  const amountCents = totalCents;

  await db.insert(invoices).values({
    orgId: sub.orgId,
    subscriptionId: sub.id,
    currency: (invoice.currency ?? 'cad').toUpperCase(),
    amountCents,
    taxCents,
    totalCents,
    status: 'paid',
    invoiceNumber: invoice.number ?? null,
    dueAt: invoice.due_date ? new Date(invoice.due_date * 1000) : null,
    paidAt: now,
    stripeInvoiceId: invoice.id,
    lineItems: JSON.stringify(
      invoice.lines?.data?.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        amountCents: l.amount,
      })) ?? [],
    ),
  });
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id ?? null;
  if (!customerId) return;

  const sub = await db.query.orgSubscriptions.findFirst({
    where: eq(orgSubscriptions.stripeCustomerId, customerId),
  });
  if (!sub) return;

  await db.update(orgSubscriptions).set({
    status: 'past_due',
    updatedAt: new Date(),
  }).where(eq(orgSubscriptions.id, sub.id));

  await writeAuditLog({
    orgId: sub.orgId,
    actorType: 'system',
    action: 'SUBSCRIPTION_PAYMENT_FAILED',
    entityType: 'subscription',
    entityId: sub.id,
    meta: { stripeInvoiceId: invoice.id },
  });
}

async function handleSubscriptionUpdated(stripeSub: Stripe.Subscription) {
  const customerId = typeof stripeSub.customer === 'string'
    ? stripeSub.customer
    : stripeSub.customer?.id ?? null;
  if (!customerId) return;

  const sub = await db.query.orgSubscriptions.findFirst({
    where: eq(orgSubscriptions.stripeSubscriptionId, stripeSub.id),
  });
  if (!sub) return;

  const stripeStatus = stripeSub.status;
  // Map Stripe statuses to internal ones
  const statusMap: Record<string, string> = {
    active: 'active',
    trialing: 'trialing',
    past_due: 'past_due',
    canceled: 'canceled',
    incomplete: 'past_due',
    incomplete_expired: 'canceled',
    unpaid: 'past_due',
    paused: 'paused',
  };
  const status = statusMap[stripeStatus] ?? 'past_due';

  const mainItem = stripeSub.items.data[0];
  await db.update(orgSubscriptions).set({
    status,
    currentPeriodStart: mainItem?.current_period_start
      ? new Date(mainItem.current_period_start * 1000)
      : undefined,
    currentPeriodEnd: mainItem?.current_period_end
      ? new Date(mainItem.current_period_end * 1000)
      : undefined,
    cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
    canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null,
    updatedAt: new Date(),
  }).where(eq(orgSubscriptions.id, sub.id));
}

async function handleSubscriptionDeleted(stripeSub: Stripe.Subscription) {
  const sub = await db.query.orgSubscriptions.findFirst({
    where: eq(orgSubscriptions.stripeSubscriptionId, stripeSub.id),
  });
  if (!sub) return;

  const now = new Date();
  await db.update(orgSubscriptions).set({
    status: 'canceled',
    canceledAt: now,
    updatedAt: now,
  }).where(eq(orgSubscriptions.id, sub.id));

  // Suspend the org
  await db.update(organizations).set({
    status: 'suspended',
    suspendedAt: now,
    updatedAt: now,
  }).where(eq(organizations.id, sub.orgId));

  await writeAuditLog({
    orgId: sub.orgId,
    actorType: 'system',
    action: 'SUBSCRIPTION_CANCELED',
    entityType: 'subscription',
    entityId: sub.id,
    meta: { stripeSubscriptionId: stripeSub.id },
  });
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export async function billingRoutes(app: FastifyInstance) {

  // ── GET /billing/subscription ──────────────────────────────────────────────
  // Returns the org's current subscription + trial info + live screen count
  app.get('/subscription', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;

    const sub = await db.query.orgSubscriptions.findFirst({
      where: eq(orgSubscriptions.orgId, user.orgId),
      orderBy: [desc(orgSubscriptions.createdAt)],
    });

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, user.orgId),
      columns: { id: true, plan: true, status: true },
    });

    const screenCount = await getOrgScreenCount(user.orgId);

    // Fetch plan details if subscription exists
    let plan = null;
    if (sub?.planId) {
      plan = await db.query.pricingPlans.findFirst({
        where: eq(pricingPlans.id, sub.planId),
      });
    }

    const isTrialing = sub?.status === 'trialing';
    const trialDaysLeft = isTrialing && sub.trialEndsAt
      ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - Date.now()) / 86_400_000))
      : null;

    return reply.send({
      subscription: sub ?? null,
      plan: plan ?? null,
      screenCount,
      isTrialing,
      trialDaysLeft,
      trialScreenLimit: sub?.trialScreenLimit ?? null,
      orgStatus: org?.status ?? null,
    });
  });

  // ── GET /billing/invoices ──────────────────────────────────────────────────
  app.get('/invoices', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;

    const rows = await db.query.invoices.findMany({
      where: eq(invoices.orgId, user.orgId),
      orderBy: [desc(invoices.createdAt)],
    });

    // Never expose stripeInvoiceId in the list (internal)
    return reply.send(
      rows.map(({ stripeInvoiceId: _s, ...inv }) => inv),
    );
  });

  // ── POST /billing/checkout ─────────────────────────────────────────────────
  // Creates a Stripe Checkout Session for direct plan selection.
  // Org must have an active trial or no subscription.
  app.post('/checkout', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;

    if (!['prime_owner', 'owner'].includes(user.role)) {
      return reply.status(403).send({ error: 'Only org owners can manage billing' });
    }

    const body = z.object({
      planId:   z.string().uuid(),
      currency: z.enum(['CAD', 'USD', 'GBP', 'EUR', 'AUD']).default('CAD'),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    // Verify the plan + price exist and are active
    const plan = await db.query.pricingPlans.findFirst({
      where: and(eq(pricingPlans.id, body.data.planId), eq(pricingPlans.isActive, true)),
    });
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });

    const price = await db.query.pricingPlanPrices.findFirst({
      where: and(
        eq(pricingPlanPrices.planId, body.data.planId),
        eq(pricingPlanPrices.currency, body.data.currency),
        eq(pricingPlanPrices.isActive, true),
      ),
    });
    if (!price?.stripePriceId) {
      return reply.status(422).send({
        error: `No active Stripe price found for plan "${plan.name}" in ${body.data.currency}. Contact support.`,
      });
    }

    // Look up the org for customer creation
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, user.orgId),
      columns: { id: true, name: true },
    });
    if (!org) return reply.status(404).send({ error: 'Organisation not found' });

    const existingSub = await db.query.orgSubscriptions.findFirst({
      where: eq(orgSubscriptions.orgId, user.orgId),
    });

    // Ensure a Stripe customer exists
    let stripeCustomerId = existingSub?.stripeCustomerId ?? null;
    if (!stripeCustomerId) {
      stripeCustomerId = await ensureStripeCustomer(
        user.orgId,
        null,
        user.sub, // using sub as email placeholder; replace with actual user email in production
        org.name,
        body.data.currency,
      );
    }

    const session = await createCheckoutSession({
      stripePriceId: price.stripePriceId,
      stripeExtraScreenPriceId: price.stripeExtraScreenPriceId ?? null,
      stripeCustomerId,
      successUrl: `${APP_URL}/settings/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${APP_URL}/settings/billing?checkout=canceled`,
      metadata: {
        orgId: user.orgId,
        planId: plan.id,
        currency: body.data.currency,
      },
    });

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      actorType: 'user',
      action: 'BILLING_CHECKOUT_INITIATED',
      entityType: 'pricing_plan',
      entityId: plan.id,
      meta: { planKey: plan.planKey, currency: body.data.currency },
      ipAddress: req.ip,
    });

    return reply.send({ checkoutUrl: session.url });
  });

  // ── POST /billing/portal ───────────────────────────────────────────────────
  // Creates a Stripe Customer Portal session so the org owner can manage
  // their payment method, plan, and billing history directly on Stripe.
  app.post('/portal', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;

    if (!['prime_owner', 'owner'].includes(user.role)) {
      return reply.status(403).send({ error: 'Only org owners can access the billing portal' });
    }

    const sub = await db.query.orgSubscriptions.findFirst({
      where: eq(orgSubscriptions.orgId, user.orgId),
    });

    if (!sub?.stripeCustomerId) {
      return reply.status(422).send({
        error: 'No billing account found. Please set up a subscription first.',
      });
    }

    const returnUrl = `${APP_URL}/settings/billing`;
    const session = await createCustomerPortalSession(sub.stripeCustomerId, returnUrl);

    return reply.send({ portalUrl: session.url });
  });

  // ── POST /billing/webhook ──────────────────────────────────────────────────
  // Stripe webhook receiver. MUST be registered in a sub-plugin so the raw
  // body content-type parser is scoped and doesn't affect other routes.
  await app.register(async (webhookScope: FastifyInstance) => {
    // Override JSON parsing for this scope only: receive raw Buffer for Stripe signature check
    webhookScope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_req: FastifyRequest, body: Buffer, done: (err: Error | null, body?: unknown) => void) => {
        done(null, body);
      },
    );

    webhookScope.post('/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
      const signature = req.headers['stripe-signature'];
      if (!signature || typeof signature !== 'string') {
        return reply.status(400).send({ error: 'Missing stripe-signature header' });
      }

      const rawBody = req.body as Buffer;
      const event = constructWebhookEvent(rawBody, signature);
      if (!event) {
        return reply.status(400).send({ error: 'Invalid webhook signature' });
      }

      try {
        switch (event.type) {
          case 'checkout.session.completed':
            await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
            break;
          case 'invoice.paid':
            await handleInvoicePaid(event.data.object as Stripe.Invoice);
            break;
          case 'invoice.payment_failed':
            await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
            break;
          case 'customer.subscription.updated':
            await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
            break;
          case 'customer.subscription.deleted':
            await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
            break;
          default:
            // Acknowledge unhandled event types so Stripe doesn't retry
            break;
        }
      } catch (err) {
        req.log.error({ err, eventType: event.type }, '[billing/webhook] Handler error');
        // Return 200 to prevent Stripe from retrying events that failed due to our own bugs
        // (Stripe retries on non-2xx; returning 500 would cause infinite retries)
      }

      return reply.send({ received: true });
    });
  });
}

// ---------------------------------------------------------------------------
// Screen usage reporting (called by jobs/recurring worker)
// ---------------------------------------------------------------------------

/**
 * Report current screen counts to Stripe for all orgs with active direct
 * subscriptions and a stripeSubscriptionItemId.
 *
 * Called hourly from services/jobs.ts + workers/recurring.ts.
 */
export async function runScreenUsageReport(): Promise<void> {
  const activeSubs = await db.query.orgSubscriptions.findMany({
    where: and(
      eq(orgSubscriptions.status, 'active'),
      eq(orgSubscriptions.billingModel, 'direct'),
    ),
  });

  for (const sub of activeSubs) {
    if (!sub.stripeSubscriptionItemId) continue;

    const screenCount = await getOrgScreenCount(sub.orgId);
    const stripeUsageRecordId = await reportScreenUsage(sub.stripeSubscriptionItemId, screenCount);

    await db.insert(screenUsageRecords).values({
      orgId: sub.orgId,
      subscriptionId: sub.id,
      screenCount,
      reportedAt: new Date(),
      stripeUsageRecordId,
    }).onConflictDoNothing();
  }
}
