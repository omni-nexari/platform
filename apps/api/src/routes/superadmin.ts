import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, superAdmins, organisations, users, orgInvitations, orgStorageQuotas } from '@signage/db';
import { eq, isNull, count, sql, desc, and, inArray } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { CreateOrgSchema } from '@signage/shared';
import { sendInviteEmail } from '../services/email.js';
import { writeAuditLog } from '../services/audit.js';

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

function inviteExpiry(days = 7): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

export async function superAdminRoutes(app: FastifyInstance) {
  // ── POST /superadmin/auth/login ─────────────────────────────────────────────
  app.post('/auth/login', async (req, reply) => {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const sa = await db.query.superAdmins.findFirst({
      where: eq(superAdmins.email, body.data.email.toLowerCase()),
    });
    if (!sa) return reply.status(401).send({ error: 'Invalid credentials' });

    const valid = await argon2.verify(sa.passwordHash, body.data.password);
    if (!valid) return reply.status(401).send({ error: 'Invalid credentials' });

    await db
      .update(superAdmins)
      .set({ lastLogin: new Date() })
      .where(eq(superAdmins.id, sa.id));

    // 8 h access token — SA portal is an internal tool, no refresh needed
    const accessToken = app.jwt.sign(
      { sub: sa.id, type: 'super_admin', email: sa.email, name: sa.name ?? '' },
      { expiresIn: '8h' },
    );

    return reply.send({ accessToken, user: { id: sa.id, email: sa.email, name: sa.name } });
  });

  // ── GET /superadmin/orgs ────────────────────────────────────────────────────
  app.get('/orgs', { onRequest: [app.authenticateSuperAdmin] }, async (_req, reply) => {
    const orgs = await db.query.organisations.findMany({
      where: isNull(organisations.deletedAt),
      orderBy: [desc(organisations.createdAt)],
    });

    const memberCounts = await db
      .select({ orgId: users.orgId, cnt: count() })
      .from(users)
      .where(isNull(users.deletedAt))
      .groupBy(users.orgId);

    const countMap = Object.fromEntries(memberCounts.map((r) => [r.orgId, Number(r.cnt)]));

    return reply.send(
      orgs.map((o) => ({ ...o, memberCount: countMap[o.id] ?? 0 })),
    );
  });

  // ── GET /superadmin/orgs/:id ────────────────────────────────────────────────
  app.get('/orgs/:id', { onRequest: [app.authenticateSuperAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const org = await db.query.organisations.findFirst({
      where: eq(organisations.id, id),
    });
    if (!org || org.deletedAt) return reply.status(404).send({ error: 'Not found' });

    const members = await db.query.users.findMany({
      where: eq(users.orgId, id),
      columns: { id: true, name: true, email: true, orgRole: true, status: true, createdAt: true },
    });

    const pendingInvites = await db.query.orgInvitations.findMany({
      where: eq(orgInvitations.orgId, id),
      columns: { id: true, email: true, orgRole: true, expiresAt: true, acceptedAt: true, createdAt: true },
    });

    return reply.send({ org, members, pendingInvites });
  });

  // ── POST /superadmin/orgs ───────────────────────────────────────────────────
  app.post('/orgs', { onRequest: [app.authenticateSuperAdmin] }, async (req, reply) => {
    const body = CreateOrgSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const { ownerEmail, ownerName } = body.data;
    const saPayload = req.user as { sub: string };

    // Create a placeholder org — the owner will name it during invite acceptance
    const tempSlug = `pending-${randomToken(4)}`;
    const [org] = await db.insert(organisations).values({ name: '(pending)', slug: tempSlug, plan: 'starter' }).returning();
    if (!org) return reply.status(500).send({ error: 'Failed to create org' });

    const ownerToken = randomToken();
    await db.insert(orgInvitations).values({
      orgId: org.id,
      invitedBy: saPayload.sub,
      email: ownerEmail.toLowerCase(),
      orgRole: 'owner',
      token: ownerToken,
      expiresAt: inviteExpiry(7),
    });

    try {
      await sendInviteEmail(ownerEmail, ownerToken, {
        recipientName: ownerName,
        orgRole: 'owner',
      });
    } catch (err) {
      app.log.error({ err }, 'Failed to send owner invite email');
    }

    await writeAuditLog({
      orgId: org.id,
      actorId: saPayload.sub,
      actorType: 'system',
      action: 'ORG_CREATED',
      entityType: 'organisation',
      entityId: org.id,
      meta: { ownerEmail, ownerName },
    });

    return reply.status(201).send({
      org: { id: org.id, name: org.name, slug: org.slug, plan: org.plan, suspendedAt: null, deletedAt: null, createdAt: org.createdAt, memberCount: 0 },
    });
  });

  // ── PATCH /superadmin/orgs/:id ──────────────────────────────────────────────
  app.patch('/orgs/:id', { onRequest: [app.authenticateSuperAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        name: z.string().min(2).max(100).optional(),
        plan: z.enum(['starter', 'pro', 'enterprise']).optional(),
        suspended: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const org = await db.query.organisations.findFirst({
      where: eq(organisations.id, id),
    });
    if (!org || org.deletedAt) return reply.status(404).send({ error: 'Not found' });

    const newSuspendedAt: Date | null =
      body.data.suspended === true
        ? new Date()
        : body.data.suspended === false
          ? null
          : (org.suspendedAt ?? null);

    const [updated] = await db
      .update(organisations)
      .set({
        name: body.data.name ?? org.name,
        plan: body.data.plan ?? org.plan,
        suspendedAt: newSuspendedAt,
        updatedAt: new Date(),
      })
      .where(eq(organisations.id, id))
      .returning();

    return reply.send(updated);
  });

  // ── DELETE /superadmin/orgs/:id ─────────────────────────────────────────────
  app.delete('/orgs/:id', { onRequest: [app.authenticateSuperAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const org = await db.query.organisations.findFirst({
      where: eq(organisations.id, id),
    });
    if (!org || org.deletedAt) return reply.status(404).send({ error: 'Not found' });

    await db
      .update(organisations)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(organisations.id, id));

    await writeAuditLog({
      orgId: id,
      actorId: (req.user as { sub: string }).sub,
      actorType: 'system',
      action: 'ORG_DELETED',
      entityType: 'organisation',
      entityId: id,
    });

    return reply.status(204).send();
  });

  // ── POST /superadmin/orgs/:id/invite ───────────────────────────────────────
  app.post('/orgs/:id/invite', { onRequest: [app.authenticateSuperAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        email: z.string().email(),
        orgRole: z.enum(['owner', 'admin', 'member']).default('owner'),
      })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const org = await db.query.organisations.findFirst({
      where: eq(organisations.id, id),
    });
    if (!org || org.deletedAt) return reply.status(404).send({ error: 'Org not found' });

    const saPayload = req.user as { sub: string };
    const token = randomToken();

    await db.insert(orgInvitations).values({
      orgId: org.id,
      invitedBy: saPayload.sub,
      email: body.data.email.toLowerCase(),
      orgRole: body.data.orgRole,
      token,
      expiresAt: inviteExpiry(7),
    });

    try {
      await sendInviteEmail(body.data.email, token, { orgName: org.name, orgRole: body.data.orgRole });
    } catch (err) {
      app.log.error({ err }, 'Failed to send invite email');
    }

    return reply.status(201).send({ email: body.data.email, orgRole: body.data.orgRole });
  });

  // ── DELETE /superadmin/orgs/:id/invites/:inviteId ──────────────────────────
  app.delete('/orgs/:id/invites/:inviteId', { onRequest: [app.authenticateSuperAdmin] }, async (req, reply) => {
    const { id, inviteId } = req.params as { id: string; inviteId: string };
    const invite = await db.query.orgInvitations.findFirst({
      where: and(eq(orgInvitations.id, inviteId), eq(orgInvitations.orgId, id)),
    });
    if (!invite) return reply.status(404).send({ error: 'Invitation not found' });
    if (invite.acceptedAt) return reply.status(409).send({ error: 'Invitation already accepted' });

    await db.delete(orgInvitations).where(eq(orgInvitations.id, inviteId));
    return reply.status(204).send();
  });
  app.get('/analytics', { onRequest: [app.authenticateSuperAdmin] }, async (_req, reply) => {
    const [orgsRow] = await db
      .select({ total: count() })
      .from(organisations)
      .where(isNull(organisations.deletedAt));

    const [suspRow] = await db
      .select({ suspended: count() })
      .from(organisations)
      .where(
        sql`${organisations.suspendedAt} IS NOT NULL AND ${organisations.deletedAt} IS NULL`,
      );

    const [usersRow] = await db
      .select({ total: count() })
      .from(users)
      .where(isNull(users.deletedAt));

    return reply.send({
      totalOrgs: Number(orgsRow?.total ?? 0),
      suspendedOrgs: Number(suspRow?.suspended ?? 0),
      totalUsers: Number(usersRow?.total ?? 0),
    });
  });

  // ── GET /superadmin/orgs/:id/quota ─────────────────────────────────────────
  app.get('/orgs/:id/quota', { onRequest: [app.authenticateSuperAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const org = await db.query.organisations.findFirst({ where: eq(organisations.id, id) });
    if (!org || org.deletedAt) return reply.status(404).send({ error: 'Not found' });

    const quota = await db.query.orgStorageQuotas.findFirst({
      where: eq(orgStorageQuotas.orgId, id),
    });

    // Return quota or computed defaults for plans (bytes)
    const defaults: Record<string, number> = {
      starter: 5_368_709_120,   // 5 GB
      pro: 53_687_091_200,      // 50 GB
      enterprise: 536_870_912_000, // 500 GB
    };

    return reply.send(
      quota ?? {
        orgId: id,
        limitBytes: defaults[org.plan] ?? defaults.starter,
        usedBytes: 0,
        alertThresholdPct: 90,
      },
    );
  });

  // ── PATCH /superadmin/orgs/:id/quota ───────────────────────────────────────
  app.patch('/orgs/:id/quota', { onRequest: [app.authenticateSuperAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        limitBytes: z.number().int().positive(),
        alertThresholdPct: z.number().int().min(50).max(99).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const org = await db.query.organisations.findFirst({ where: eq(organisations.id, id) });
    if (!org || org.deletedAt) return reply.status(404).send({ error: 'Not found' });

    const existing = await db.query.orgStorageQuotas.findFirst({
      where: eq(orgStorageQuotas.orgId, id),
    });

    let quota;
    if (existing) {
      [quota] = await db
        .update(orgStorageQuotas)
        .set({
          limitBytes: body.data.limitBytes,
          alertThresholdPct: body.data.alertThresholdPct ?? existing.alertThresholdPct,
          updatedAt: new Date(),
        })
        .where(eq(orgStorageQuotas.orgId, id))
        .returning();
    } else {
      [quota] = await db
        .insert(orgStorageQuotas)
        .values({
          orgId: id,
          limitBytes: body.data.limitBytes,
          alertThresholdPct: body.data.alertThresholdPct ?? 90,
        })
        .returning();
    }

    await writeAuditLog({
      orgId: id,
      actorId: (req.user as { sub: string }).sub,
      actorType: 'system',
      action: 'QUOTA_UPDATED',
      entityType: 'organisation',
      entityId: id,
      meta: { limitBytes: body.data.limitBytes },
    });

    return reply.send(quota);
  });

  // ── GET /superadmin/system/health ───────────────────────────────────────────
  app.get('/system/health', { onRequest: [app.authenticateSuperAdmin] }, async (_req, reply) => {
    const mem = process.memoryUsage();
    const load = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    const [orgsRow] = await db
      .select({ total: count() })
      .from(organisations)
      .where(isNull(organisations.deletedAt));

    const [usersRow] = await db
      .select({ total: count() })
      .from(users)
      .where(isNull(users.deletedAt));

    return reply.send({
      process: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
        external: mem.external,
        uptime: process.uptime(),
        nodeVersion: process.version,
      },
      os: {
        platform: os.platform(),
        arch: os.arch(),
        totalMem,
        freeMem,
        usedMem: totalMem - freeMem,
        loadAvg1: load[0],
        loadAvg5: load[1],
        loadAvg15: load[2],
        uptime: os.uptime(),
        cpus: os.cpus().length,
      },
      db: {
        totalOrgs: Number(orgsRow?.total ?? 0),
        totalUsers: Number(usersRow?.total ?? 0),
      },
    });
  });

  // ── POST /superadmin/orgs/:id/impersonate ───────────────────────────────────
  app.post('/orgs/:id/impersonate', { onRequest: [app.authenticateSuperAdmin] }, async (req, reply) => {
    const sa = req.user as { sub: string; type: string };
    const { id } = req.params as { id: string };

    const org = await db.query.organisations.findFirst({
      where: eq(organisations.id, id),
    });
    if (!org || org.deletedAt) return reply.status(404).send({ error: 'Organization not found' });
    if (org.suspendedAt) return reply.status(409).send({ error: 'Organization is suspended' });

    // Find the highest-role user — prefer prime_owner > owner > admin
    const owner = await db.query.users.findFirst({
      where: and(eq(users.orgId, id), inArray(users.orgRole, ['prime_owner', 'owner', 'admin']), isNull(users.deletedAt)),
      orderBy: [
        sql`CASE
          WHEN ${users.orgRole} = 'prime_owner' THEN 1
          WHEN ${users.orgRole} = 'owner' THEN 2
          WHEN ${users.orgRole} = 'admin' THEN 3
          ELSE 4
        END`,
      ],
    });
    if (!owner) return reply.status(404).send({ error: 'No admin-level user found in organization' });

    const accessToken = app.jwt.sign(
      {
        sub: owner.id,
        orgId: id,
        role: owner.orgRole,
        email: owner.email,
        name: owner.name ?? '',
        type: 'user',
        impersonatedBy: sa.sub,
      },
      { expiresIn: '2h' },
    );

    await writeAuditLog({
      orgId: id,
      actorId: sa.sub,
      actorType: 'system',
      action: 'IMPERSONATE_ORG',
      entityType: 'organisation',
      entityId: id,
      ipAddress: req.ip,
      meta: { impersonatedUserId: owner.id, impersonatedEmail: owner.email },
    });

    return reply.send({
      accessToken,
      org: { id: org.id, name: org.name, slug: org.slug },
      user: { id: owner.id, email: owner.email, name: owner.name, role: owner.orgRole },
    });
  });
}
