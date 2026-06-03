/**
 * Pricing management routes — Phase 3
 *
 * Auth tiers:
 *   authenticatePlatformOwner   — Nexari platform owner only
 *   authenticatePlatformAdmin   — platform_owner OR management_company_admin
 *
 * Superadmin-only endpoints (platform_owner):
 *   GET    /pricing/plans                         — list all plans
 *   POST   /pricing/plans                         — create plan
 *   PATCH  /pricing/plans/:planId                 — update plan metadata
 *   DELETE /pricing/plans/:planId                 — soft-deactivate plan
 *
 *   GET    /pricing/plans/:planId/prices           — list prices for a plan
 *   POST   /pricing/plans/:planId/prices           — add a currency price
 *   PATCH  /pricing/plans/:planId/prices/:priceId  — update a currency price
 *   DELETE /pricing/plans/:planId/prices/:priceId  — soft-deactivate a price
 *
 *   GET    /pricing/mc/:mcId/pricing               — view MC wholesale overrides
 *   PUT    /pricing/mc/:mcId/pricing               — upsert MC wholesale override (per plan)
 *   DELETE /pricing/mc/:mcId/pricing/:overrideId   — remove MC override
 *
 *   GET    /pricing/orgs/:orgId/overrides           — view org price overrides
 *   POST   /pricing/orgs/:orgId/overrides           — create org override
 *   DELETE /pricing/orgs/:orgId/overrides/:id       — remove org override
 *
 *   GET    /pricing/orgs/:orgId/subscription        — view org subscription (admin view)
 *   PATCH  /pricing/orgs/:orgId/subscription/trial  — extend trial
 *   PATCH  /pricing/orgs/:orgId/subscription/status — update subscription status
 *
 * MC admin endpoints (management_company_admin — own MC only):
 *   GET    /pricing/plans                          — lists public plans (same endpoint, scoped)
 *   GET    /pricing/my-mc/pricing                  — MC admin: view own wholesale pricing
 *   GET    /pricing/mc-orgs/:orgId/overrides        — view override for org they manage
 *   POST   /pricing/mc-orgs/:orgId/overrides        — set override for org they manage
 *   DELETE /pricing/mc-orgs/:orgId/overrides/:id    — remove override for org they manage
 *   PATCH  /pricing/mc-orgs/:orgId/subscription/trial — MC admin extends trial on managed org
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  db,
  pricingPlans,
  pricingPlanPrices,
  managementCompanyPricing,
  orgPricingOverrides,
  orgSubscriptions,
  managementCompanies,
  organisations,
  clientOrgOwnerInvitations,
} from '@signage/db';
import { eq, and, asc, desc } from 'drizzle-orm';
import { writeAuditLog } from '../services/audit.js';

// ── Auth types (mirrors superadmin.ts) ────────────────────────────────────────

type PlatformAdminCaller =
  | { sub: string; type: 'platform_owner'; email: string; name: string }
  | {
      sub: string;
      type: 'management_company_admin';
      managementCompanyId: string;
      email: string;
      name: string;
      role: string;
    };

function isOwnerCaller(
  caller: PlatformAdminCaller,
): caller is Extract<PlatformAdminCaller, { type: 'platform_owner' }> {
  return caller.type === 'platform_owner';
}

// ── Input schemas ─────────────────────────────────────────────────────────────

const CURRENCIES = ['CAD', 'USD', 'GBP', 'EUR', 'AUD'] as const;
const MODULES = ['signage', 'pos', 'both'] as const;

const CreatePlanSchema = z.object({
  planKey:          z.string().min(2).max(50).regex(/^[a-z0-9_]+$/),
  name:             z.string().min(1).max(100),
  module:           z.enum(MODULES).default('signage'),
  screensIncluded:  z.number().int().min(1).default(1),
  billingPeriod:    z.enum(['monthly', 'annual']).default('monthly'),
  isPublic:         z.boolean().default(true),
  sortOrder:        z.number().int().default(0),
  description:      z.string().optional(),
});

const UpdatePlanSchema = CreatePlanSchema.partial().omit({ planKey: true });

const CreatePriceSchema = z.object({
  currency:              z.enum(CURRENCIES),
  amountCents:           z.number().int().min(0),
  extraScreenCents:      z.number().int().min(0).default(0),
  stripePriceId:         z.string().optional(),
  stripeExtraScreenPriceId: z.string().optional(),
});

const UpdatePriceSchema = CreatePriceSchema.partial().omit({ currency: true });

const MCPricingUpsertSchema = z.object({
  planId:         z.string().uuid(),
  currency:       z.enum(CURRENCIES),
  wholesaleCents: z.number().int().min(0).optional(),
  maxMarkupPct:   z.number().min(0).max(999.99).optional(),
  commissionPct:  z.number().min(0).max(100).optional(),
});

const OrgOverrideSchema = z.object({
  planId:         z.string().uuid(),
  currency:       z.enum(CURRENCIES),
  overrideCents:  z.number().int().min(0),
  reason:         z.string().optional(),
  expiresAt:      z.string().datetime({ offset: true }).optional(),
});

const ExtendTrialSchema = z.object({
  trialEndsAt:      z.string().datetime({ offset: true }),
  trialScreenLimit: z.number().int().min(1).max(1000).optional(),
  reason:           z.string().optional(),
});

const UpdateSubStatusSchema = z.object({
  status: z.enum(['trialing', 'active', 'past_due', 'canceled', 'paused']),
  reason: z.string().optional(),
});

// ── Helper: verify MC admin owns the org ──────────────────────────────────────

async function mcOwnsOrg(managementCompanyId: string, orgId: string): Promise<boolean> {
  const org = await db.query.organisations.findFirst({
    where: eq(organisations.id, orgId),
    columns: { id: true, managementCompanyId: true },
  });
  return org?.managementCompanyId === managementCompanyId;
}

// =============================================================================
// Plugin
// =============================================================================

export async function pricingRoutes(app: FastifyInstance) {

  // ── GET /pricing/plans ─────────────────────────────────────────────────────
  // Owner: all plans including inactive.
  // MC admin: only public, active plans.
  app.get('/plans', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;

    const plans = await db.query.pricingPlans.findMany({
      orderBy: [asc(pricingPlans.sortOrder), asc(pricingPlans.billingPeriod)],
    });

    const filtered = isOwnerCaller(caller)
      ? plans
      : plans.filter((p) => p.isActive && p.isPublic);

    return reply.send(filtered);
  });

  // ── POST /pricing/plans ────────────────────────────────────────────────────
  app.post('/plans', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const body = CreatePlanSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    // Guard against duplicate planKey
    const existing = await db.query.pricingPlans.findFirst({
      where: eq(pricingPlans.planKey, body.data.planKey),
    });
    if (existing) return reply.status(409).send({ error: `Plan key "${body.data.planKey}" already exists` });

    const [plan] = await db.insert(pricingPlans).values(body.data).returning();

    await writeAuditLog({
      actorId: caller.sub,
      actorType: 'system',
      action: 'PRICING_PLAN_CREATED',
      entityType: 'pricing_plan',
      entityId: plan!.id,
      meta: { planKey: body.data.planKey },
    });

    return reply.status(201).send(plan);
  });

  // ── PATCH /pricing/plans/:planId ───────────────────────────────────────────
  app.patch('/plans/:planId', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const { planId } = req.params as { planId: string };
    const body = UpdatePlanSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const plan = await db.query.pricingPlans.findFirst({ where: eq(pricingPlans.id, planId) });
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });

    const [updated] = await db.update(pricingPlans)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(pricingPlans.id, planId))
      .returning();

    await writeAuditLog({
      actorId: caller.sub,
      actorType: 'system',
      action: 'PRICING_PLAN_UPDATED',
      entityType: 'pricing_plan',
      entityId: planId,
      meta: body.data,
    });

    return reply.send(updated);
  });

  // ── DELETE /pricing/plans/:planId ──────────────────────────────────────────
  // Soft-deactivates — does not delete to preserve history on existing subs.
  app.delete('/plans/:planId', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const { planId } = req.params as { planId: string };

    const plan = await db.query.pricingPlans.findFirst({ where: eq(pricingPlans.id, planId) });
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });
    if (!plan.isActive) return reply.status(409).send({ error: 'Plan is already inactive' });

    await db.update(pricingPlans)
      .set({ isActive: false, isPublic: false, updatedAt: new Date() })
      .where(eq(pricingPlans.id, planId));

    await writeAuditLog({
      actorId: caller.sub,
      actorType: 'system',
      action: 'PRICING_PLAN_DEACTIVATED',
      entityType: 'pricing_plan',
      entityId: planId,
    });

    return reply.status(204).send();
  });

  // ── GET /pricing/plans/:planId/prices ──────────────────────────────────────
  app.get('/plans/:planId/prices', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const { planId } = req.params as { planId: string };
    const plan = await db.query.pricingPlans.findFirst({ where: eq(pricingPlans.id, planId) });
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });

    const prices = await db.query.pricingPlanPrices.findMany({
      where: eq(pricingPlanPrices.planId, planId),
      orderBy: [asc(pricingPlanPrices.currency)],
    });
    return reply.send(prices);
  });

  // ── POST /pricing/plans/:planId/prices ─────────────────────────────────────
  app.post('/plans/:planId/prices', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const { planId } = req.params as { planId: string };
    const body = CreatePriceSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const plan = await db.query.pricingPlans.findFirst({ where: eq(pricingPlans.id, planId) });
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });

    // One active price per currency per plan
    const existing = await db.query.pricingPlanPrices.findFirst({
      where: and(
        eq(pricingPlanPrices.planId, planId),
        eq(pricingPlanPrices.currency, body.data.currency),
        eq(pricingPlanPrices.isActive, true),
      ),
    });
    if (existing) {
      return reply.status(409).send({
        error: `An active price for ${body.data.currency} already exists on this plan. Use PATCH to update it.`,
      });
    }

    const [price] = await db.insert(pricingPlanPrices).values({ planId, ...body.data }).returning();

    await writeAuditLog({
      actorId: caller.sub,
      actorType: 'system',
      action: 'PRICING_PRICE_CREATED',
      entityType: 'pricing_plan_price',
      entityId: price!.id,
      meta: { planKey: plan.planKey, currency: body.data.currency, amountCents: body.data.amountCents },
    });

    return reply.status(201).send(price);
  });

  // ── PATCH /pricing/plans/:planId/prices/:priceId ───────────────────────────
  app.patch('/plans/:planId/prices/:priceId', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const { planId, priceId } = req.params as { planId: string; priceId: string };
    const body = UpdatePriceSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const price = await db.query.pricingPlanPrices.findFirst({
      where: and(eq(pricingPlanPrices.id, priceId), eq(pricingPlanPrices.planId, planId)),
    });
    if (!price) return reply.status(404).send({ error: 'Price not found' });

    const [updated] = await db.update(pricingPlanPrices)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(pricingPlanPrices.id, priceId))
      .returning();

    await writeAuditLog({
      actorId: caller.sub,
      actorType: 'system',
      action: 'PRICING_PRICE_UPDATED',
      entityType: 'pricing_plan_price',
      entityId: priceId,
      meta: body.data,
    });

    return reply.send(updated);
  });

  // ── DELETE /pricing/plans/:planId/prices/:priceId ──────────────────────────
  app.delete('/plans/:planId/prices/:priceId', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const { planId, priceId } = req.params as { planId: string; priceId: string };

    const price = await db.query.pricingPlanPrices.findFirst({
      where: and(eq(pricingPlanPrices.id, priceId), eq(pricingPlanPrices.planId, planId)),
    });
    if (!price) return reply.status(404).send({ error: 'Price not found' });

    await db.update(pricingPlanPrices)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(pricingPlanPrices.id, priceId));

    await writeAuditLog({
      actorId: caller.sub,
      actorType: 'system',
      action: 'PRICING_PRICE_DEACTIVATED',
      entityType: 'pricing_plan_price',
      entityId: priceId,
    });

    return reply.status(204).send();
  });

  // ==========================================================================
  // Management company wholesale pricing (platform_owner only)
  // ==========================================================================

  // ── GET /pricing/mc/:mcId/pricing ──────────────────────────────────────────
  app.get('/mc/:mcId/pricing', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const { mcId } = req.params as { mcId: string };
    const mc = await db.query.managementCompanies.findFirst({
      where: eq(managementCompanies.id, mcId),
      columns: { id: true, name: true, billingModel: true },
    });
    if (!mc) return reply.status(404).send({ error: 'Management company not found' });

    const pricing = await db.query.managementCompanyPricing.findMany({
      where: eq(managementCompanyPricing.managementCompanyId, mcId),
      orderBy: [asc(managementCompanyPricing.currency)],
    });

    return reply.send({ mc, pricing });
  });

  // ── PUT /pricing/mc/:mcId/pricing ──────────────────────────────────────────
  // Upserts one wholesale pricing row for a plan+currency combination.
  app.put('/mc/:mcId/pricing', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const { mcId } = req.params as { mcId: string };
    const body = MCPricingUpsertSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const mc = await db.query.managementCompanies.findFirst({
      where: eq(managementCompanies.id, mcId),
      columns: { id: true, name: true },
    });
    if (!mc) return reply.status(404).send({ error: 'Management company not found' });

    const plan = await db.query.pricingPlans.findFirst({
      where: eq(pricingPlans.id, body.data.planId),
      columns: { id: true, planKey: true },
    });
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });

    const existing = await db.query.managementCompanyPricing.findFirst({
      where: and(
        eq(managementCompanyPricing.managementCompanyId, mcId),
        eq(managementCompanyPricing.planId, body.data.planId),
        eq(managementCompanyPricing.currency, body.data.currency),
      ),
    });

    let row;
    if (existing) {
      [row] = await db.update(managementCompanyPricing).set({
        wholesaleCents: body.data.wholesaleCents ?? existing.wholesaleCents,
        maxMarkupPct: body.data.maxMarkupPct?.toString() ?? existing.maxMarkupPct,
        commissionPct: body.data.commissionPct?.toString() ?? existing.commissionPct,
        updatedAt: new Date(),
      }).where(eq(managementCompanyPricing.id, existing.id)).returning();
    } else {
      [row] = await db.insert(managementCompanyPricing).values({
        managementCompanyId: mcId,
        planId: body.data.planId,
        currency: body.data.currency,
        wholesaleCents: body.data.wholesaleCents,
        maxMarkupPct: body.data.maxMarkupPct?.toString(),
        commissionPct: body.data.commissionPct?.toString(),
        createdByOwnerId: caller.sub,
      }).returning();
    }

    await writeAuditLog({
      actorId: caller.sub,
      actorType: 'system',
      action: existing ? 'MC_PRICING_UPDATED' : 'MC_PRICING_CREATED',
      entityType: 'management_company_pricing',
      entityId: row!.id,
      meta: { mcId, planKey: plan.planKey, currency: body.data.currency },
    });

    return reply.status(existing ? 200 : 201).send(row);
  });

  // ── DELETE /pricing/mc/:mcId/pricing/:overrideId ───────────────────────────
  app.delete('/mc/:mcId/pricing/:overrideId', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const { mcId, overrideId } = req.params as { mcId: string; overrideId: string };

    const override = await db.query.managementCompanyPricing.findFirst({
      where: and(
        eq(managementCompanyPricing.id, overrideId),
        eq(managementCompanyPricing.managementCompanyId, mcId),
      ),
    });
    if (!override) return reply.status(404).send({ error: 'Pricing override not found' });

    await db.delete(managementCompanyPricing).where(eq(managementCompanyPricing.id, overrideId));

    await writeAuditLog({
      actorId: caller.sub,
      actorType: 'system',
      action: 'MC_PRICING_DELETED',
      entityType: 'management_company_pricing',
      entityId: overrideId,
      meta: { mcId },
    });

    return reply.status(204).send();
  });

  // ==========================================================================
  // Org pricing overrides
  // Owner: any org. MC admin: only orgs they manage.
  // ==========================================================================

  // ── GET /pricing/orgs/:orgId/overrides ─────────────────────────────────────
  app.get('/orgs/:orgId/overrides', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const { orgId } = req.params as { orgId: string };

    if (!isOwnerCaller(caller)) {
      const owns = await mcOwnsOrg(caller.managementCompanyId, orgId);
      if (!owns) return reply.status(403).send({ error: 'Access denied' });
    }

    const overrides = await db.query.orgPricingOverrides.findMany({
      where: eq(orgPricingOverrides.orgId, orgId),
      orderBy: [desc(orgPricingOverrides.createdAt)],
    });
    return reply.send(overrides);
  });

  // ── POST /pricing/orgs/:orgId/overrides ────────────────────────────────────
  app.post('/orgs/:orgId/overrides', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const { orgId } = req.params as { orgId: string };
    const body = OrgOverrideSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    if (!isOwnerCaller(caller)) {
      const owns = await mcOwnsOrg(caller.managementCompanyId, orgId);
      if (!owns) return reply.status(403).send({ error: 'Access denied' });
    }

    const org = await db.query.organisations.findFirst({
      where: eq(organisations.id, orgId),
      columns: { id: true, name: true },
    });
    if (!org) return reply.status(404).send({ error: 'Organisation not found' });

    const plan = await db.query.pricingPlans.findFirst({
      where: eq(pricingPlans.id, body.data.planId),
      columns: { id: true, planKey: true },
    });
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });

    const [override] = await db.insert(orgPricingOverrides).values({
      orgId,
      planId: body.data.planId,
      currency: body.data.currency,
      overrideCents: body.data.overrideCents,
      reason: body.data.reason,
      expiresAt: body.data.expiresAt ? new Date(body.data.expiresAt) : null,
      createdByType: isOwnerCaller(caller) ? 'owner' : 'management_company_admin',
      createdById: caller.sub,
    }).returning();

    await writeAuditLog({
      actorId: caller.sub,
      actorType: 'system',
      action: 'ORG_PRICING_OVERRIDE_CREATED',
      entityType: 'org_pricing_override',
      entityId: override!.id,
      meta: {
        orgId,
        planKey: plan.planKey,
        currency: body.data.currency,
        overrideCents: body.data.overrideCents,
        reason: body.data.reason,
      },
    });

    return reply.status(201).send(override);
  });

  // ── DELETE /pricing/orgs/:orgId/overrides/:id ──────────────────────────────
  app.delete('/orgs/:orgId/overrides/:id', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const { orgId, id } = req.params as { orgId: string; id: string };

    if (!isOwnerCaller(caller)) {
      const owns = await mcOwnsOrg(caller.managementCompanyId, orgId);
      if (!owns) return reply.status(403).send({ error: 'Access denied' });
    }

    const override = await db.query.orgPricingOverrides.findFirst({
      where: and(eq(orgPricingOverrides.id, id), eq(orgPricingOverrides.orgId, orgId)),
    });
    if (!override) return reply.status(404).send({ error: 'Override not found' });

    await db.delete(orgPricingOverrides).where(eq(orgPricingOverrides.id, id));

    await writeAuditLog({
      actorId: caller.sub,
      actorType: 'system',
      action: 'ORG_PRICING_OVERRIDE_DELETED',
      entityType: 'org_pricing_override',
      entityId: id,
      meta: { orgId },
    });

    return reply.status(204).send();
  });

  // ==========================================================================
  // Subscription management (admin views + trial extension)
  // ==========================================================================

  // ── GET /pricing/orgs/:orgId/subscription ─────────────────────────────────
  app.get('/orgs/:orgId/subscription', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const { orgId } = req.params as { orgId: string };

    if (!isOwnerCaller(caller)) {
      const owns = await mcOwnsOrg(caller.managementCompanyId, orgId);
      if (!owns) return reply.status(403).send({ error: 'Access denied' });
    }

    const sub = await db.query.orgSubscriptions.findFirst({
      where: eq(orgSubscriptions.orgId, orgId),
    });
    const org = await db.query.organisations.findFirst({
      where: eq(organisations.id, orgId),
      columns: { id: true, name: true, status: true, plan: true },
    });
    if (!org) return reply.status(404).send({ error: 'Organisation not found' });

    let plan = null;
    if (sub?.planId) {
      plan = await db.query.pricingPlans.findFirst({
        where: eq(pricingPlans.id, sub.planId),
        columns: { id: true, name: true, planKey: true, screensIncluded: true },
      });
    }

    const trialDaysLeft = sub?.status === 'trialing' && sub.trialEndsAt
      ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - Date.now()) / 86_400_000))
      : null;

    return reply.send({ org, subscription: sub ?? null, plan, trialDaysLeft });
  });

  // ── PATCH /pricing/orgs/:orgId/subscription/trial ─────────────────────────
  // Extend (or shorten) an org's trial period and/or screen limit.
  app.patch('/orgs/:orgId/subscription/trial', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const { orgId } = req.params as { orgId: string };
    const body = ExtendTrialSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    if (!isOwnerCaller(caller)) {
      const owns = await mcOwnsOrg(caller.managementCompanyId, orgId);
      if (!owns) return reply.status(403).send({ error: 'Access denied' });
    }

    const sub = await db.query.orgSubscriptions.findFirst({
      where: eq(orgSubscriptions.orgId, orgId),
    });
    if (!sub) return reply.status(404).send({ error: 'No subscription found for this org' });

    const updates: Partial<typeof orgSubscriptions.$inferInsert> = {
      trialEndsAt: new Date(body.data.trialEndsAt),
      trialExtendedByType: isOwnerCaller(caller) ? 'owner' : 'management_company_admin',
      trialExtendedById: caller.sub,
      updatedAt: new Date(),
    };
    if (body.data.trialScreenLimit !== undefined) {
      updates.trialScreenLimit = body.data.trialScreenLimit;
    }

    const [updated] = await db.update(orgSubscriptions)
      .set(updates)
      .where(eq(orgSubscriptions.id, sub.id))
      .returning();

    await writeAuditLog({
      actorId: caller.sub,
      actorType: 'system',
      action: 'TRIAL_EXTENDED',
      entityType: 'subscription',
      entityId: sub.id,
      meta: {
        orgId,
        newTrialEndsAt: body.data.trialEndsAt,
        trialScreenLimit: body.data.trialScreenLimit,
        reason: body.data.reason,
      },
    });

    return reply.send(updated);
  });

  // ── PATCH /pricing/orgs/:orgId/subscription/status (owner only) ────────────
  // Force-set subscription status — useful for manual overrides.
  app.patch('/orgs/:orgId/subscription/status', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const { orgId } = req.params as { orgId: string };
    const body = UpdateSubStatusSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const sub = await db.query.orgSubscriptions.findFirst({
      where: eq(orgSubscriptions.orgId, orgId),
    });
    if (!sub) return reply.status(404).send({ error: 'No subscription found for this org' });

    const [updated] = await db.update(orgSubscriptions)
      .set({ status: body.data.status, updatedAt: new Date() })
      .where(eq(orgSubscriptions.id, sub.id))
      .returning();

    await writeAuditLog({
      actorId: caller.sub,
      actorType: 'system',
      action: 'SUBSCRIPTION_STATUS_OVERRIDE',
      entityType: 'subscription',
      entityId: sub.id,
      meta: { orgId, newStatus: body.data.status, reason: body.data.reason },
    });

    return reply.send(updated);
  });

  // ==========================================================================
  // MC admin self-service endpoints (scoped to their own MC)
  // ==========================================================================

  // ── GET /pricing/my-mc/pricing ─────────────────────────────────────────────
  // MC admin views their own wholesale rates (read-only).
  app.get('/my-mc/pricing', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    if (isOwnerCaller(caller)) {
      return reply.status(400).send({ error: 'Use /mc/:mcId/pricing for platform owner access' });
    }

    const pricing = await db.query.managementCompanyPricing.findMany({
      where: eq(managementCompanyPricing.managementCompanyId, caller.managementCompanyId),
      orderBy: [asc(managementCompanyPricing.currency)],
    });

    return reply.send(pricing);
  });
}
