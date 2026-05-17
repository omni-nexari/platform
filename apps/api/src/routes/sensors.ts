import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { db, sensorSources, sensorReadings, triggerRules, devices, workspaces, workspaceMembers, apiKeys, tagAssignments, workspaceTags } from '@signage/db';
import { eq, and, isNull, desc, asc, lt } from 'drizzle-orm';
import { sendCommand, isDeviceOnline } from '../services/ws.js';
import { dispatchWebhookEvent } from '../services/webhooks.js';
import { createNotifications, listWorkspaceAdminUserIds } from '../services/notifications.js';
import { writeAuditLog } from '../services/audit.js';

type AuthUser = { sub: string; orgId: string; role: string };

const ADMIN_ROLES = new Set(['prime_owner', 'owner', 'admin', 'a-manager', 'superadmin']);

// ─── Trigger rule evaluation ─────────────────────────────────────────────────

interface Condition {
  field: string;       // 'value' | 'hour' | 'day_of_week'
  operator: string;    // '>' | '<' | '>=' | '<=' | '==' | '!=' | 'between'
  value: number | [number, number];
  logic?: 'and' | 'or';
}

function evaluateCondition(cond: Condition, readingValue: number): boolean {
  const now = new Date();
  const actual = cond.field === 'hour'        ? now.getHours()
               : cond.field === 'day_of_week' ? now.getDay()
               : readingValue;

  switch (cond.operator) {
    case '>':       return actual > (cond.value as number);
    case '<':       return actual < (cond.value as number);
    case '>=':      return actual >= (cond.value as number);
    case '<=':      return actual <= (cond.value as number);
    case '==':      return actual === (cond.value as number);
    case '!=':      return actual !== (cond.value as number);
    case 'between': {
      const [lo, hi] = cond.value as [number, number];
      return actual >= lo && actual <= hi;
    }
    default: return false;
  }
}

function evaluateConditions(conditions: Condition[], value: number): boolean {
  if (!conditions || conditions.length === 0) return true;
  let result = evaluateCondition(conditions[0]!, value);
  for (let i = 1; i < conditions.length; i++) {
    const cond = conditions[i]!;
    const next = evaluateCondition(cond, value);
    result = (cond.logic === 'or') ? (result || next) : (result && next);
  }
  return result;
}

async function resolveScopeDeviceIds(
  rule: typeof triggerRules.$inferSelect,
  workspaceId: string,
): Promise<string[]> {
  if (rule.deviceScope === 'device_id' && rule.deviceScopeValue) {
    return [rule.deviceScopeValue];
  }
  if (rule.deviceScope === 'device_tag' && rule.deviceScopeValue) {
    // Look up tag by name within the workspace, then get assigned device IDs
    const tag = await db.query.workspaceTags.findFirst({
      where: and(eq(workspaceTags.workspaceId, workspaceId), eq(workspaceTags.name, rule.deviceScopeValue)),
      columns: { id: true },
    });
    if (!tag) return [];
    const assignments = await db.query.tagAssignments.findMany({
      where: and(
        eq(tagAssignments.workspaceId, workspaceId),
        eq(tagAssignments.tagId, tag.id),
        eq(tagAssignments.entityType, 'device'),
      ),
      columns: { entityId: true },
    });
    return assignments.map(a => a.entityId);
  }
  // 'all'
  const allDevices = await db.query.devices.findMany({
    where: and(eq(devices.workspaceId, workspaceId), isNull(devices.deletedAt)),
    columns: { id: true },
  });
  return allDevices.map(d => d.id);
}

async function fireTriggerRule(
  rule: typeof triggerRules.$inferSelect,
  readingValue: number,
  orgId: string,
): Promise<void> {
  const deviceIds = await resolveScopeDeviceIds(rule, rule.workspaceId);
  if (deviceIds.length === 0) return;

  switch (rule.actionType) {
    case 'switch_playlist': {
      for (const deviceId of deviceIds) {
        if (!isDeviceOnline(deviceId)) continue;
        sendCommand(deviceId, { type: 'switch_playlist', payload: { playlistId: rule.actionTargetId } });
      }
      break;
    }
    case 'switch_content': {
      for (const deviceId of deviceIds) {
        if (!isDeviceOnline(deviceId)) continue;
        sendCommand(deviceId, { type: 'switch_content', payload: { contentId: rule.actionTargetId } });
      }
      break;
    }
    case 'send_device_command': {
      const cmd = rule.actionPayload as Record<string, unknown> | null;
      if (!cmd) break;
      for (const deviceId of deviceIds) {
        if (!isDeviceOnline(deviceId)) continue;
        sendCommand(deviceId, cmd as Parameters<typeof sendCommand>[1]);
      }
      break;
    }
    case 'send_notification': {
      const adminIds = await listWorkspaceAdminUserIds(rule.workspaceId);
      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, rule.workspaceId),
        columns: { orgId: true },
      });
      if (ws && adminIds.length > 0) {
        await createNotifications({
          orgId: ws.orgId,
          userIds: adminIds,
          type: 'sensor_rule_fired',
          title: `Trigger rule fired: ${rule.name}`,
          body: `Reading value ${readingValue} triggered rule "${rule.name}".`,
          entityType: 'trigger_rule',
          entityId: rule.id,
        });
      }
      break;
    }
    case 'webhook_out': {
      void dispatchWebhookEvent(orgId, 'trigger.fired', {
        ruleId:   rule.id,
        ruleName: rule.name,
        sensorId: rule.sensorId,
        value:    readingValue,
      });
      break;
    }
  }

  // Update fireCount + lastFiredAt
  await db.update(triggerRules)
    .set({ lastFiredAt: new Date(), fireCount: (rule.fireCount ?? 0) + 1, updatedAt: new Date() })
    .where(eq(triggerRules.id, rule.id));
}

export async function evaluateTriggerRulesForSensor(
  sensorId: string,
  value: number,
  orgId: string,
): Promise<void> {
  const rules = await db.query.triggerRules.findMany({
    where: and(eq(triggerRules.sensorId, sensorId), eq(triggerRules.isActive, true)),
  });

  const now = Date.now();
  for (const rule of rules) {
    // Enforce cooldown
    if (rule.lastFiredAt) {
      const elapsed = now - new Date(rule.lastFiredAt).getTime();
      if (elapsed < (rule.cooldownSeconds ?? 300) * 1000) continue;
    }

    const conditions = (rule.conditions ?? []) as Condition[];
    if (evaluateConditions(conditions, value)) {
      await fireTriggerRule(rule, value, orgId);
    }
  }
}

// ─── Route handlers ──────────────────────────────────────────────────────────

export async function sensorsRoutes(app: FastifyInstance) {

  // ── GET /sensors?workspaceId= ─────────────────────────────────────────────
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const member = await db.query.workspaceMembers.findFirst({
      where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.sub)),
    });
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const sensors = await db.query.sensorSources.findMany({
      where: eq(sensorSources.workspaceId, workspaceId),
      orderBy: [asc(sensorSources.name)],
    });
    return reply.send(sensors);
  });

  // ── POST /sensors ─────────────────────────────────────────────────────────
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId?: string; name?: string; type?: string; unit?: string; config?: Record<string, unknown> };
    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.name?.trim())  return reply.status(400).send({ error: 'name required' });

    if (!ADMIN_ROLES.has(user.role)) {
      const member = await db.query.workspaceMembers.findFirst({
        where: and(eq(workspaceMembers.workspaceId, body.workspaceId), eq(workspaceMembers.userId, user.sub)),
      });
      if (!member || !['admin', 'owner'].includes(member.role)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
    }

    const [sensor] = await db.insert(sensorSources).values({
      workspaceId: body.workspaceId,
      name:        body.name.trim(),
      type:        body.type ?? 'webhook',
      unit:        body.unit ?? null,
      config:      body.config ?? {},
    }).returning();

    void writeAuditLog({ actorId: user.sub, action: 'SENSOR_CREATED', entityType: 'sensor_source', entityId: sensor?.id ?? null, meta: { name: body.name, workspaceId: body.workspaceId }, ipAddress: req.ip });
    return reply.status(201).send(sensor);
  });

  // ── PATCH /sensors/:id ────────────────────────────────────────────────────
  app.patch('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; type?: string; unit?: string; config?: Record<string, unknown> };

    const sensor = await db.query.sensorSources.findFirst({ where: eq(sensorSources.id, id) });
    if (!sensor) return reply.status(404).send({ error: 'Not found' });

    const member = await db.query.workspaceMembers.findFirst({
      where: and(eq(workspaceMembers.workspaceId, sensor.workspaceId), eq(workspaceMembers.userId, user.sub)),
    });
    if (!member && !ADMIN_ROLES.has(user.role)) return reply.status(403).send({ error: 'Forbidden' });

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name   !== undefined) patch['name']   = body.name.trim();
    if (body.type   !== undefined) patch['type']   = body.type;
    if (body.unit   !== undefined) patch['unit']   = body.unit;
    if (body.config !== undefined) patch['config'] = body.config;

    const [updated] = await db.update(sensorSources).set(patch).where(eq(sensorSources.id, id)).returning();
    return reply.send(updated);
  });

  // ── DELETE /sensors/:id ───────────────────────────────────────────────────
  app.delete('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const sensor = await db.query.sensorSources.findFirst({ where: eq(sensorSources.id, id) });
    if (!sensor) return reply.status(404).send({ error: 'Not found' });

    if (!ADMIN_ROLES.has(user.role)) {
      const member = await db.query.workspaceMembers.findFirst({
        where: and(eq(workspaceMembers.workspaceId, sensor.workspaceId), eq(workspaceMembers.userId, user.sub)),
      });
      if (!member || !['admin', 'owner'].includes(member.role)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
    }

    await db.delete(sensorSources).where(eq(sensorSources.id, id));
    void writeAuditLog({ actorId: user.sub, action: 'SENSOR_DELETED', entityType: 'sensor_source', entityId: id, meta: { name: sensor.name }, ipAddress: req.ip });
    return reply.send({ ok: true });
  });

  // ── POST /sensors/:id/reading — ingest a sensor reading ──────────────────
  // Accepts JWT auth OR API key (Bearer signage_...) with write/sensor:write scope.
  app.post('/:id/reading', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { value?: unknown; unit?: string; metadata?: Record<string, unknown> };

    // ── Resolve orgId from either API key or JWT ──────────────────────────
    let orgId: string;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer signage_')) {
      const rawKey = authHeader.slice(7);
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      const keyRow = await db.query.apiKeys.findFirst({ where: eq(apiKeys.keyHash, keyHash) });
      if (!keyRow || keyRow.revokedAt || (keyRow.expiresAt && keyRow.expiresAt < new Date())) {
        return reply.status(401).send({ error: 'Invalid or expired API key' });
      }
      const scopes = keyRow.scopes.split(' ');
      if (!scopes.some(s => ['write', 'sensor:write'].includes(s))) {
        return reply.status(403).send({ error: 'API key lacks write scope' });
      }
      orgId = keyRow.orgId;
      void db.update(apiKeys).set({ lastUsedAt: new Date(), updatedAt: new Date() }).where(eq(apiKeys.id, keyRow.id));
    } else {
      try {
        await req.jwtVerify();
        orgId = (req.user as AuthUser).orgId;
      } catch {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    }

    const value = Number(body.value);
    if (isNaN(value)) return reply.status(400).send({ error: 'value must be a number' });

    const sensor = await db.query.sensorSources.findFirst({ where: eq(sensorSources.id, id) });
    if (!sensor) return reply.status(404).send({ error: 'Sensor not found' });

    // Verify workspace still exists (sensors can outlive their workspace deletion)
    const wsExists = await db.query.workspaces.findFirst({
      where: and(eq(workspaces.id, sensor.workspaceId), isNull(workspaces.deletedAt)),
      columns: { id: true },
    });
    if (!wsExists) return reply.status(404).send({ error: 'Workspace not found' });

    const [reading] = await db.insert(sensorReadings).values({
      sensorId:   id,
      value,
      unit:       body.unit ?? sensor.unit ?? null,
      metadata:   body.metadata ?? null,
    }).returning();

    // Update lastReadingAt
    await db.update(sensorSources)
      .set({ lastReadingAt: new Date(), updatedAt: new Date() })
      .where(eq(sensorSources.id, id));

    // Evaluate trigger rules asynchronously (legacy)
    void evaluateTriggerRulesForSensor(id, value, orgId);

    // Evaluate workspace rule sets with sensor_value conditions
    void import('../services/rule-sets.js').then(({ evaluateSensorReading }) =>
      evaluateSensorReading(sensor.workspaceId, id, value)
    );

    // Dispatch outbound webhook event
    void dispatchWebhookEvent(orgId, 'sensor.reading', {
      sensorId:   id,
      sensorName: sensor.name,
      value,
      unit:       body.unit ?? sensor.unit ?? null,
      recordedAt: new Date().toISOString(),
    });

    return reply.status(201).send(reading);
  });

  // ── GET /sensors/:id/readings — reading history ───────────────────────────
  app.get('/:id/readings', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const q = req.query as { from?: string; to?: string; limit?: string };

    const sensor = await db.query.sensorSources.findFirst({ where: eq(sensorSources.id, id) });
    if (!sensor) return reply.status(404).send({ error: 'Not found' });

    const member = await db.query.workspaceMembers.findFirst({
      where: and(eq(workspaceMembers.workspaceId, sensor.workspaceId), eq(workspaceMembers.userId, user.sub)),
    });
    if (!member && !ADMIN_ROLES.has(user.role)) return reply.status(403).send({ error: 'Forbidden' });

    const limit = Math.min(Number(q.limit ?? 200), 1000);
    const rows = await db.query.sensorReadings.findMany({
      where: eq(sensorReadings.sensorId, id),
      orderBy: [desc(sensorReadings.recordedAt)],
      limit,
    });

    return reply.send({ sensorId: id, readings: rows });
  });

  // ── GET /sensors/:id/trigger-rules ────────────────────────────────────────
  app.get('/:id/trigger-rules', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const sensor = await db.query.sensorSources.findFirst({ where: eq(sensorSources.id, id) });
    if (!sensor) return reply.status(404).send({ error: 'Not found' });

    const member = await db.query.workspaceMembers.findFirst({
      where: and(eq(workspaceMembers.workspaceId, sensor.workspaceId), eq(workspaceMembers.userId, user.sub)),
    });
    if (!member && !ADMIN_ROLES.has(user.role)) return reply.status(403).send({ error: 'Forbidden' });

    const rules = await db.query.triggerRules.findMany({
      where: eq(triggerRules.sensorId, id),
      orderBy: [asc(triggerRules.createdAt)],
    });
    return reply.send(rules);
  });

  // ── POST /sensors/:id/trigger-rules — create a rule ──────────────────────
  app.post('/:id/trigger-rules', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string;
      conditions?: unknown;
      actionType?: string;
      actionTargetId?: string;
      actionPayload?: Record<string, unknown>;
      deviceScope?: string;
      deviceScopeValue?: string;
      cooldownSeconds?: number;
    };

    if (!body.name?.trim())  return reply.status(400).send({ error: 'name required' });
    if (!body.actionType)    return reply.status(400).send({ error: 'actionType required' });

    const VALID_ACTIONS = ['switch_playlist', 'switch_content', 'send_notification', 'send_device_command', 'webhook_out'];
    if (!VALID_ACTIONS.includes(body.actionType)) {
      return reply.status(400).send({ error: `actionType must be one of: ${VALID_ACTIONS.join(', ')}` });
    }

    const sensor = await db.query.sensorSources.findFirst({ where: eq(sensorSources.id, id) });
    if (!sensor) return reply.status(404).send({ error: 'Sensor not found' });

    if (!ADMIN_ROLES.has(user.role)) {
      const member = await db.query.workspaceMembers.findFirst({
        where: and(eq(workspaceMembers.workspaceId, sensor.workspaceId), eq(workspaceMembers.userId, user.sub)),
      });
      if (!member || !['admin', 'owner'].includes(member.role)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
    }

    const [rule] = await db.insert(triggerRules).values({
      workspaceId:      sensor.workspaceId,
      sensorId:         id,
      name:             body.name.trim(),
      conditions:       body.conditions ?? [],
      actionType:       body.actionType,
      actionTargetId:   body.actionTargetId ?? null,
      actionPayload:    body.actionPayload ?? null,
      deviceScope:      body.deviceScope ?? 'all',
      deviceScopeValue: body.deviceScopeValue ?? null,
      cooldownSeconds:  body.cooldownSeconds ?? 300,
    }).returning();

    void writeAuditLog({ actorId: user.sub, action: 'TRIGGER_RULE_CREATED', entityType: 'trigger_rule', entityId: rule?.id ?? null, meta: { name: body.name, sensorId: id }, ipAddress: req.ip });
    return reply.status(201).send(rule);
  });

  // ── PATCH /trigger-rules/:id ──────────────────────────────────────────────
  app.patch('/trigger-rules/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string;
      conditions?: unknown;
      actionType?: string;
      actionTargetId?: string;
      actionPayload?: Record<string, unknown>;
      deviceScope?: string;
      deviceScopeValue?: string;
      cooldownSeconds?: number;
      isActive?: boolean;
    };

    const rule = await db.query.triggerRules.findFirst({ where: eq(triggerRules.id, id) });
    if (!rule) return reply.status(404).send({ error: 'Not found' });

    if (!ADMIN_ROLES.has(user.role)) {
      const member = await db.query.workspaceMembers.findFirst({
        where: and(eq(workspaceMembers.workspaceId, rule.workspaceId), eq(workspaceMembers.userId, user.sub)),
      });
      if (!member || !['admin', 'owner'].includes(member.role)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name             !== undefined) patch['name']             = body.name.trim();
    if (body.conditions       !== undefined) patch['conditions']       = body.conditions;
    if (body.actionType       !== undefined) patch['actionType']       = body.actionType;
    if (body.actionTargetId   !== undefined) patch['actionTargetId']   = body.actionTargetId;
    if (body.actionPayload    !== undefined) patch['actionPayload']    = body.actionPayload;
    if (body.deviceScope      !== undefined) patch['deviceScope']      = body.deviceScope;
    if (body.deviceScopeValue !== undefined) patch['deviceScopeValue'] = body.deviceScopeValue;
    if (body.cooldownSeconds  !== undefined) patch['cooldownSeconds']  = body.cooldownSeconds;
    if (body.isActive         !== undefined) patch['isActive']         = body.isActive;

    const [updated] = await db.update(triggerRules).set(patch).where(eq(triggerRules.id, id)).returning();
    return reply.send(updated);
  });

  // ── DELETE /trigger-rules/:id ─────────────────────────────────────────────
  app.delete('/trigger-rules/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const rule = await db.query.triggerRules.findFirst({ where: eq(triggerRules.id, id) });
    if (!rule) return reply.status(404).send({ error: 'Not found' });

    if (!ADMIN_ROLES.has(user.role)) {
      const member = await db.query.workspaceMembers.findFirst({
        where: and(eq(workspaceMembers.workspaceId, rule.workspaceId), eq(workspaceMembers.userId, user.sub)),
      });
      if (!member || !['admin', 'owner'].includes(member.role)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
    }

    await db.delete(triggerRules).where(eq(triggerRules.id, id));
    void writeAuditLog({ actorId: user.sub, action: 'TRIGGER_RULE_DELETED', entityType: 'trigger_rule', entityId: id, meta: { name: rule.name }, ipAddress: req.ip });
    return reply.send({ ok: true });
  });

  // ── POST /trigger-rules/:id/fire — manual fire ────────────────────────────
  app.post('/trigger-rules/:id/fire', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as { value?: number };
    const value = body.value ?? 1;

    const rule = await db.query.triggerRules.findFirst({ where: eq(triggerRules.id, id) });
    if (!rule) return reply.status(404).send({ error: 'Not found' });

    if (!ADMIN_ROLES.has(user.role)) {
      const member = await db.query.workspaceMembers.findFirst({
        where: and(eq(workspaceMembers.workspaceId, rule.workspaceId), eq(workspaceMembers.userId, user.sub)),
      });
      if (!member || !['admin', 'owner'].includes(member.role)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
    }

    const ws = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, rule.workspaceId),
      columns: { orgId: true },
    });
    if (!ws) return reply.status(404).send({ error: 'Workspace not found' });

    await fireTriggerRule(rule, value, ws.orgId);
    return reply.send({ ok: true, ruleId: id, value });
  });

  // ── GET /trigger-rules?workspaceId= — list all workspace rules ────────────
  app.get('/trigger-rules', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const member = await db.query.workspaceMembers.findFirst({
      where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.sub)),
    });
    if (!member && !ADMIN_ROLES.has(user.role)) return reply.status(403).send({ error: 'Forbidden' });

    const rules = await db.query.triggerRules.findMany({
      where: eq(triggerRules.workspaceId, workspaceId),
      orderBy: [asc(triggerRules.createdAt)],
    });
    return reply.send(rules);
  });
}
