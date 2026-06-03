/**
 * Public routes — no authentication required
 *
 * GET  /public/pricing        — active, public plans + prices grouped by currency
 * POST /public/signup         — self-service signup: creates pending org + invite,
 *                               sends invite email; user completes setup via
 *                               the standard /auth/accept-invite/:token flow
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  db,
  organisations,
  orgInvitations,
  orgSubscriptions,
  pricingPlans,
  pricingPlanPrices,
  users,
} from '@signage/db';
import { eq, and, isNull, asc, gt } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { sendInviteEmail } from '../services/email.js';
import { writeAuditLog } from '../services/audit.js';

// UUID used as `invitedBy` for system-initiated invitations (no human inviter).
const SYSTEM_INVITER_ID = '00000000-0000-0000-0000-000000000000';

// Default trial: 60 days, 3 screens.
const TRIAL_DAYS = 60;
const TRIAL_SCREEN_LIMIT = 3;

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

function trialExpiry(): Date {
  const d = new Date();
  d.setDate(d.getDate() + TRIAL_DAYS);
  return d;
}

function inviteExpiry(days = 7): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

// ── Input schema ──────────────────────────────────────────────────────────────

const SignupSchema = z.object({
  name:     z.string().min(2).max(120),
  email:    z.string().email().max(254).transform((v) => v.toLowerCase().trim()),
  orgName:  z.string().min(2).max(120),
  // Optional — if omitted we use the first active public plan
  planId:   z.string().uuid().optional(),
  // Optional — if omitted we default to CAD
  currency: z.enum(['CAD', 'USD', 'GBP', 'EUR', 'AUD']).optional().default('CAD'),
});

// =============================================================================
// Plugin
// =============================================================================

export async function publicRoutes(app: FastifyInstance) {

  // ── GET /public/pricing ────────────────────────────────────────────────────
  // Returns all active, public plans each with their prices array.
  // Intentionally strips internal Stripe IDs from the response.
  app.get('/pricing', async (_req, reply) => {
    const plans = await db.query.pricingPlans.findMany({
      where: and(
        eq(pricingPlans.isActive, true),
        eq(pricingPlans.isPublic, true),
      ),
      orderBy: [asc(pricingPlans.sortOrder), asc(pricingPlans.billingPeriod)],
    });

    const prices = await db.query.pricingPlanPrices.findMany({
      where: eq(pricingPlanPrices.isActive, true),
      orderBy: [asc(pricingPlanPrices.currency)],
    });

    // Group prices by planId — strip Stripe IDs before exposing publicly
    const pricesByPlan = new Map<string, Array<{
      id: string;
      currency: string;
      amountCents: number;
      extraScreenCents: number;
    }>>();
    for (const price of prices) {
      const list = pricesByPlan.get(price.planId) ?? [];
      list.push({
        id: price.id,
        currency: price.currency,
        amountCents: price.amountCents,
        extraScreenCents: price.extraScreenCents,
      });
      pricesByPlan.set(price.planId, list);
    }

    const result = plans.map((plan) => ({
      id: plan.id,
      planKey: plan.planKey,
      name: plan.name,
      module: plan.module,
      screensIncluded: plan.screensIncluded,
      billingPeriod: plan.billingPeriod,
      description: plan.description,
      sortOrder: plan.sortOrder,
      prices: pricesByPlan.get(plan.id) ?? [],
    }));

    return reply.send(result);
  });

  // ── POST /public/signup ────────────────────────────────────────────────────
  // Rate-limited: 5 requests per hour per IP.
  app.post('/signup', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 hour',
      },
    },
  }, async (req, reply) => {
    const body = SignupSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const { name, email, orgName, planId, currency } = body.data;

    // ── 1. Guard: email already has an active account ────────────────────────
    const existingUser = await db.query.users.findFirst({
      where: and(eq(users.email, email), isNull(users.deletedAt)),
      columns: { id: true },
    });
    if (existingUser) {
      // Respond with 200 and a generic message — avoid leaking whether the
      // email exists (anti-enumeration).
      return reply.send({ message: 'If this email is new, check your inbox for an invitation.' });
    }

    // ── 2. Guard: email already has a pending invite ──────────────────────────
    const existingInvite = await db.query.orgInvitations.findFirst({
      where: and(
        eq(orgInvitations.email, email),
        isNull(orgInvitations.acceptedAt),
        gt(orgInvitations.expiresAt, new Date()),
      ),
      columns: { id: true },
    });
    if (existingInvite) {
      // Same generic message — don't reveal invite state
      return reply.send({ message: 'If this email is new, check your inbox for an invitation.' });
    }

    // ── 3. Resolve plan ───────────────────────────────────────────────────────
    let resolvedPlan: typeof pricingPlans.$inferSelect | undefined;
    if (planId) {
      resolvedPlan = await db.query.pricingPlans.findFirst({
        where: and(
          eq(pricingPlans.id, planId),
          eq(pricingPlans.isActive, true),
        ),
      });
      if (!resolvedPlan) return reply.status(400).send({ error: 'Selected plan is not available' });
    } else {
      resolvedPlan = await db.query.pricingPlans.findFirst({
        where: and(eq(pricingPlans.isActive, true), eq(pricingPlans.isPublic, true)),
        orderBy: [asc(pricingPlans.sortOrder)],
      });
    }

    // ── 4. Create pending organisation ────────────────────────────────────────
    // Slug is temporary — the user finalises it during invite acceptance.
    // The org name is pre-filled with what they entered; they can change it
    // during setup.
    const tempSlug = `pending-${randomToken(8)}`;
    const [org] = await db.insert(organisations).values({
      name: orgName,
      slug: tempSlug,
      plan: resolvedPlan?.planKey ?? 'starter',
      status: 'active',
    }).returning();
    if (!org) return reply.status(500).send({ error: 'Failed to create organisation' });

    // ── 5. Create trial subscription ─────────────────────────────────────────
    if (resolvedPlan) {
      await db.insert(orgSubscriptions).values({
        orgId: org.id,
        planId: resolvedPlan.id,
        currency,
        status: 'trialing',
        billingModel: 'direct',
        trialEndsAt: trialExpiry(),
        trialScreenLimit: TRIAL_SCREEN_LIMIT,
      });
    }

    // ── 6. Create org invitation ─────────────────────────────────────────────
    const token = randomToken();
    await db.insert(orgInvitations).values({
      orgId: org.id,
      invitedBy: SYSTEM_INVITER_ID,
      email,
      orgRole: 'owner',
      token,
      expiresAt: inviteExpiry(7),
    });

    // ── 7. Send invite email ──────────────────────────────────────────────────
    // Uses the standard /accept-invite/ flow — the frontend sees `isPendingSetup:
    // true` because the org slug starts with 'pending-', and shows the org
    // name / slug / workspace setup fields.
    try {
      await sendInviteEmail(email, token, {
        recipientName: name,
        orgRole: 'owner',
        // inviteType intentionally omitted → routes to /accept-invite/
      });
    } catch (err) {
      app.log.error({ err, orgId: org.id }, 'Failed to send self-service invite email');
      // Don't fail the request — invite row is created; email can be resent manually.
    }

    // ── 8. Audit log ─────────────────────────────────────────────────────────
    await writeAuditLog({
      actorType: 'system',
      action: 'SELF_SERVICE_SIGNUP',
      entityType: 'organisation',
      entityId: org.id,
      meta: { email, orgName, planKey: resolvedPlan?.planKey ?? null, currency },
      ipAddress: req.ip,
    });

    return reply.status(201).send({
      message: 'Check your inbox — we\'ve sent you an invitation to complete your setup.',
    });
  });
}
