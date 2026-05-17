import type { FastifyInstance } from 'fastify';
import {
  db, workspaceRuleSets, ruleSetTargets, workspaceMembers, devices, deviceGroups,
  type RuleSetConditionGroup, type RuleSetAction,
} from '@signage/db';
import { eq, and, isNull, desc, asc, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CreateRuleSetSchema, UpdateRuleSetSchema, SetRuleSetTargetsSchema } from '@signage/shared';
import { publishRuleSet, publishRuleSetsToDevice } from '../services/rule-sets.js';
import { writeAuditLog } from '../services/audit.js';

type AuthUser = { sub: string; orgId: string; role: string };

const ADMIN_ROLES = new Set(['prime_owner', 'owner', 'admin', 'a-manager', 'superadmin']);

async function checkAccess(workspaceId: string, userId: string, role: string) {
  if (ADMIN_ROLES.has(role)) return true;
  const m = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
  });
  return !!m;
}

export async function ruleSetsRoutes(app: FastifyInstance) {
  // ── GET / — list rule sets for a workspace ─────────────────────────────────
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!await checkAccess(workspaceId, user.sub, user.role)) return reply.status(403).send({ error: 'Forbidden' });

    const rows = await db.query.workspaceRuleSets.findMany({
      where: eq(workspaceRuleSets.workspaceId, workspaceId),
      orderBy: [desc(workspaceRuleSets.priority), asc(workspaceRuleSets.createdAt)],
      with: { targets: true },
    });

    return reply.send({ ruleSets: rows });
  });

  // ── POST / — create rule set ───────────────────────────────────────────────
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const parsed = CreateRuleSetSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const body = parsed.data;

    if (!await checkAccess(body.workspaceId, user.sub, user.role)) return reply.status(403).send({ error: 'Forbidden' });

    const [rs] = await db.insert(workspaceRuleSets).values({
      workspaceId:     body.workspaceId,
      name:            body.name,
      description:     body.description ?? null,
      enabled:         body.enabled,
      priority:        body.priority,
      conditions:      body.conditions as unknown as RuleSetConditionGroup,
      action:          body.action as unknown as RuleSetAction,
      cooldownSeconds: body.cooldownSeconds,
    }).returning();

    if (!rs) return reply.status(500).send({ error: 'Insert failed' });

    // Insert targets
    if (body.targets.length > 0) {
      await db.insert(ruleSetTargets).values(
        body.targets.map(t => ({ ruleSetId: rs.id, targetType: t.targetType, targetId: t.targetId }))
      );
    }

    void writeAuditLog({
      orgId: user.orgId, actorId: user.sub, action: 'rule_set.create',
      entityType: 'rule_set', entityId: rs.id, meta: { name: rs.name },
    });

    // Publish to assigned devices
    void publishRuleSet(rs.id);

    return reply.status(201).send(rs);
  });

  // ── GET /:id ───────────────────────────────────────────────────────────────
  app.get('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const rs = await db.query.workspaceRuleSets.findFirst({
      where: eq(workspaceRuleSets.id, id),
      with: { targets: true },
    });
    if (!rs) return reply.status(404).send({ error: 'Not found' });
    if (!await checkAccess(rs.workspaceId, user.sub, user.role)) return reply.status(403).send({ error: 'Forbidden' });

    return reply.send(rs);
  });

  // ── PATCH /:id ─────────────────────────────────────────────────────────────
  app.patch('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const parsed = UpdateRuleSetSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const body = parsed.data;

    const existing = await db.query.workspaceRuleSets.findFirst({ where: eq(workspaceRuleSets.id, id) });
    if (!existing) return reply.status(404).send({ error: 'Not found' });
    if (!await checkAccess(existing.workspaceId, user.sub, user.role)) return reply.status(403).send({ error: 'Forbidden' });

    const [updated] = await db.update(workspaceRuleSets)
      .set({
        ...(body.name        !== undefined ? { name:            body.name }        : {}),
        ...(body.description !== undefined ? { description:     body.description } : {}),
        ...(body.enabled     !== undefined ? { enabled:         body.enabled }     : {}),
        ...(body.priority    !== undefined ? { priority:        body.priority }    : {}),
        ...(body.conditions  !== undefined ? { conditions: body.conditions as unknown as RuleSetConditionGroup } : {}),
        ...(body.action      !== undefined ? { action: body.action as unknown as RuleSetAction }      : {}),
        ...(body.cooldownSeconds !== undefined ? { cooldownSeconds: body.cooldownSeconds } : {}),
        updatedAt: new Date(),
      })
      .where(eq(workspaceRuleSets.id, id))
      .returning();

    if (!updated) return reply.status(500).send({ error: 'Update failed' });

    // Replace targets if provided
    if (body.targets !== undefined) {
      await db.delete(ruleSetTargets).where(eq(ruleSetTargets.ruleSetId, id));
      if (body.targets.length > 0) {
        await db.insert(ruleSetTargets).values(
          body.targets.map(t => ({ ruleSetId: id, targetType: t.targetType, targetId: t.targetId }))
        );
      }
    }

    void writeAuditLog({
      orgId: user.orgId, actorId: user.sub, action: 'rule_set.update',
      entityType: 'rule_set', entityId: id, meta: { name: updated.name },
    });

    void publishRuleSet(id);

    return reply.send(updated);
  });

  // ── DELETE /:id ────────────────────────────────────────────────────────────
  app.delete('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const existing = await db.query.workspaceRuleSets.findFirst({
      where: eq(workspaceRuleSets.id, id),
      with: { targets: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Not found' });
    if (!await checkAccess(existing.workspaceId, user.sub, user.role)) return reply.status(403).send({ error: 'Forbidden' });

    // Resolve devices BEFORE deleting so we can push empty rule sets
    const deviceIds = await resolveDeviceIdsForTargets(existing.targets);

    await db.delete(workspaceRuleSets).where(eq(workspaceRuleSets.id, id));

    void writeAuditLog({
      orgId: user.orgId, actorId: user.sub, action: 'rule_set.delete',
      entityType: 'rule_set', entityId: id, meta: { name: existing.name },
    });

    // Push updated rule sets to affected devices
    void Promise.all(deviceIds.map(did => publishRuleSetsToDevice(did)));

    return reply.send({ ok: true });
  });

  // ── PUT /:id/targets — replace target list ─────────────────────────────────
  app.put('/:id/targets', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const parsed = SetRuleSetTargetsSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const existing = await db.query.workspaceRuleSets.findFirst({
      where: eq(workspaceRuleSets.id, id),
      with: { targets: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Not found' });
    if (!await checkAccess(existing.workspaceId, user.sub, user.role)) return reply.status(403).send({ error: 'Forbidden' });

    // Devices before change
    const oldDeviceIds = await resolveDeviceIdsForTargets(existing.targets);

    await db.delete(ruleSetTargets).where(eq(ruleSetTargets.ruleSetId, id));
    if (parsed.data.targets.length > 0) {
      await db.insert(ruleSetTargets).values(
        parsed.data.targets.map(t => ({ ruleSetId: id, targetType: t.targetType, targetId: t.targetId }))
      );
    }

    // Devices after change
    const newDeviceIds = await resolveDeviceIdsForTargets(parsed.data.targets);
    const allAffected = [...new Set([...oldDeviceIds, ...newDeviceIds])];
    void Promise.all(allAffected.map(did => publishRuleSetsToDevice(did)));

    const targets = await db.query.ruleSetTargets.findMany({ where: eq(ruleSetTargets.ruleSetId, id) });
    return reply.send({ targets });
  });

  // ── POST /:id/publish — force publish to all targets ──────────────────────
  app.post('/:id/publish', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const existing = await db.query.workspaceRuleSets.findFirst({ where: eq(workspaceRuleSets.id, id) });
    if (!existing) return reply.status(404).send({ error: 'Not found' });
    if (!await checkAccess(existing.workspaceId, user.sub, user.role)) return reply.status(403).send({ error: 'Forbidden' });

    await publishRuleSet(id);
    return reply.send({ ok: true, message: 'Rule set published to all target devices' });
  });

  // ── POST /:id/fire — manual test trigger ──────────────────────────────────
  app.post('/:id/fire', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const rs = await db.query.workspaceRuleSets.findFirst({
      where: eq(workspaceRuleSets.id, id),
      with: { targets: true },
    });
    if (!rs) return reply.status(404).send({ error: 'Not found' });
    if (!await checkAccess(rs.workspaceId, user.sub, user.role)) return reply.status(403).send({ error: 'Forbidden' });

    const { compileRuleSet } = await import('../services/rule-sets.js');
    const { sendCommand } = await import('../services/ws.js');

    const compiled = compileRuleSet(rs);
    const deviceIds = await resolveDeviceIdsForTargets(rs.targets);

    for (const deviceId of deviceIds) {
      sendCommand(deviceId, { type: 'rule_set_trigger', payload: { ruleSet: compiled } });
    }

    // Update fire stats
    const now = new Date();
    await db.update(workspaceRuleSets)
      .set({ lastFiredAt: now, fireCount: rs.fireCount + 1, updatedAt: now })
      .where(eq(workspaceRuleSets.id, id));

    return reply.send({ ok: true, firedTo: deviceIds.length });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveDeviceIdsForTargets(
  targets: Array<{ targetType: string; targetId: string }>,
): Promise<string[]> {
  const ids = new Set<string>();
  const groupIds: string[] = [];
  const workspaceIds: string[] = [];

  for (const t of targets) {
    if (t.targetType === 'device')    ids.add(t.targetId);
    else if (t.targetType === 'group')     groupIds.push(t.targetId);
    else if (t.targetType === 'workspace') workspaceIds.push(t.targetId);
  }

  if (groupIds.length > 0) {
    const { deviceGroupMembers } = await import('@signage/db');
    const members = await db.query.deviceGroupMembers.findMany({
      where: inArray(deviceGroupMembers.groupId, groupIds),
    });
    for (const m of members) ids.add(m.deviceId);
  }

  if (workspaceIds.length > 0) {
    const wsDevices = await db.query.devices.findMany({
      where: inArray(devices.workspaceId, workspaceIds),
      columns: { id: true },
    });
    for (const d of wsDevices) ids.add(d.id);
  }

  return [...ids];
}
