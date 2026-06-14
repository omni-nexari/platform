import type { FastifyInstance } from 'fastify';
import { db, users, organizations, orgInvitations } from '@signage/db';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { sendInviteEmail } from '../services/email.js';

type AuthUser = { sub: string; orgId: string; role: string };

const ALLOWED_ROLES = ['owner', 'admin', 'a-manager', 's-manager', 'c-manager', 'viewer', 'installer', 'tag-bound'] as const;

function inviteExpiry(days = 7): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function canManageRole(actorRole: string, targetRole: string): boolean {
  if (actorRole === 'prime_owner') return true;
  if (actorRole === 'owner') return targetRole !== 'prime_owner';
  if (actorRole === 'admin') return ['a-manager', 's-manager', 'c-manager', 'viewer', 'installer', 'tag-bound'].includes(targetRole);
  return false;
}

export async function orgRoutes(app: FastifyInstance) {

  // ── GET /org/members ────────────────────────────────────────────────────────
  // Returns all active members + pending invites
  app.get('/members', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;

    const members = await db.query.users.findMany({
      where: and(eq(users.orgId, actor.orgId), isNull(users.deletedAt)),
      columns: { id: true, name: true, email: true, orgRole: true, status: true, lastLogin: true, createdAt: true },
    });

    const pendingInvites = await db.query.orgInvitations.findMany({
      where: and(
        eq(orgInvitations.orgId, actor.orgId),
        isNull(orgInvitations.acceptedAt),
        gt(orgInvitations.expiresAt, new Date()),
      ),
      columns: { id: true, email: true, orgRole: true, expiresAt: true, createdAt: true },
    });

    return reply.send({ members, pendingInvites });
  });

  // ── POST /org/members/invite ────────────────────────────────────────────────
  app.post('/members/invite', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;

    if (!['prime_owner', 'owner', 'admin'].includes(actor.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = z.object({
      email: z.string().email(),
      orgRole: z.enum(ALLOWED_ROLES),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    if (!canManageRole(actor.role, body.data.orgRole)) {
      return reply.status(403).send({ error: 'Cannot assign that role' });
    }

    // Check not already a member
    const existing = await db.query.users.findFirst({
      where: and(eq(users.orgId, actor.orgId), eq(users.email, body.data.email), isNull(users.deletedAt)),
    });
    if (existing) return reply.status(409).send({ error: 'User is already a member' });

    const org = await db.query.organizations.findFirst({
      where: and(eq(organizations.id, actor.orgId), isNull(organizations.deletedAt)),
    });
    if (!org) return reply.status(404).send({ error: 'Organisation not found' });

    const token = randomBytes(32).toString('hex');
    const [invite] = await db.insert(orgInvitations).values({
      orgId: actor.orgId,
      invitedBy: actor.sub,
      email: body.data.email,
      orgRole: body.data.orgRole,
      token,
      expiresAt: inviteExpiry(7),
    }).returning();

    try {
      await sendInviteEmail(body.data.email, token, { orgName: org.name, orgRole: body.data.orgRole });
    } catch (err) {
      app.log.error({ err }, 'Failed to send invite email');
    }

    return reply.status(201).send(invite);
  });

  // ── PATCH /org/members/:userId/role ────────────────────────────────────────
  app.patch('/members/:userId/role', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const { userId } = req.params as { userId: string };

    if (!['prime_owner', 'owner', 'admin'].includes(actor.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = z.object({ orgRole: z.enum(ALLOWED_ROLES) }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    if (userId === actor.sub) return reply.status(400).send({ error: 'Cannot change your own role' });

    const target = await db.query.users.findFirst({
      where: and(eq(users.id, userId), eq(users.orgId, actor.orgId), isNull(users.deletedAt)),
    });
    if (!target) return reply.status(404).send({ error: 'Member not found' });

    if (!canManageRole(actor.role, body.data.orgRole)) {
      return reply.status(403).send({ error: 'Cannot assign that role' });
    }
    if (!canManageRole(actor.role, target.orgRole)) {
      return reply.status(403).send({ error: 'Cannot modify that member\'s role' });
    }

    const [updated] = await db.update(users)
      .set({ orgRole: body.data.orgRole, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ id: users.id, orgRole: users.orgRole });

    return reply.send(updated);
  });

  // ── DELETE /org/members/:userId ─────────────────────────────────────────────
  app.delete('/members/:userId', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const { userId } = req.params as { userId: string };

    if (!['prime_owner', 'owner', 'admin'].includes(actor.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    if (userId === actor.sub) return reply.status(400).send({ error: 'Cannot remove yourself' });

    const target = await db.query.users.findFirst({
      where: and(eq(users.id, userId), eq(users.orgId, actor.orgId), isNull(users.deletedAt)),
    });
    if (!target) return reply.status(404).send({ error: 'Member not found' });

    if (!canManageRole(actor.role, target.orgRole)) {
      return reply.status(403).send({ error: 'Cannot remove that member' });
    }

    await db.update(users)
      .set({ deletedAt: new Date(), status: 'suspended', updatedAt: new Date() })
      .where(eq(users.id, userId));

    return reply.send({ success: true });
  });

  // ── DELETE /org/invites/:inviteId ───────────────────────────────────────────
  app.delete('/invites/:inviteId', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const { inviteId } = req.params as { inviteId: string };

    if (!['prime_owner', 'owner', 'admin'].includes(actor.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const invite = await db.query.orgInvitations.findFirst({
      where: and(eq(orgInvitations.id, inviteId), eq(orgInvitations.orgId, actor.orgId)),
    });
    if (!invite) return reply.status(404).send({ error: 'Invite not found' });

    await db.delete(orgInvitations).where(eq(orgInvitations.id, inviteId));
    return reply.send({ success: true });
  });
}
