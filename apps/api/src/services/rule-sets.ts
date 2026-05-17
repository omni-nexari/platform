import { db, workspaceRuleSets, ruleSetTargets, devices, deviceGroups, deviceGroupMembers } from '@signage/db';
import type { CompiledRuleSet } from '@signage/db';
import { eq, and, inArray } from 'drizzle-orm';
import { sendCommand } from './ws.js';

/**
 * Compiles a DB rule set row into the lean payload sent to devices.
 */
export function compileRuleSet(rs: typeof workspaceRuleSets.$inferSelect): CompiledRuleSet {
  return {
    id:              rs.id,
    name:            rs.name,
    enabled:         rs.enabled,
    priority:        rs.priority,
    conditions:      rs.conditions,
    action:          rs.action,
    cooldownSeconds: rs.cooldownSeconds,
  };
}

/**
 * Resolves all device IDs that should receive a given rule set, based on
 * its targets (device / group / workspace).
 */
async function resolveDeviceIds(ruleSetId: string): Promise<string[]> {
  const targets = await db.query.ruleSetTargets.findMany({
    where: eq(ruleSetTargets.ruleSetId, ruleSetId),
  });

  const deviceIds   = new Set<string>();
  const groupIds:    string[] = [];
  const workspaceIds: string[] = [];

  for (const t of targets) {
    if (t.targetType === 'device')    deviceIds.add(t.targetId);
    else if (t.targetType === 'group')     groupIds.push(t.targetId);
    else if (t.targetType === 'workspace') workspaceIds.push(t.targetId);
  }

  // Expand groups → device IDs
  if (groupIds.length > 0) {
    const members = await db.query.deviceGroupMembers.findMany({
      where: inArray(deviceGroupMembers.groupId, groupIds),
    });
    for (const m of members) deviceIds.add(m.deviceId);
  }

  // Expand workspace-wide → all devices in workspace
  if (workspaceIds.length > 0) {
    const ws_devices = await db.query.devices.findMany({
      where: inArray(devices.workspaceId, workspaceIds),
      columns: { id: true },
    });
    for (const d of ws_devices) deviceIds.add(d.id);
  }

  return [...deviceIds];
}

/**
 * Gathers all active rule sets assigned to a device and sends them via WS.
 * Called on device connect and whenever a rule set targeting the device is saved.
 */
export async function publishRuleSetsToDevice(deviceId: string): Promise<void> {
  // Find all rule set IDs that target this device (direct, group, workspace)
  const device = await db.query.devices.findFirst({
    where: eq(devices.id, deviceId),
    columns: { workspaceId: true },
  });
  if (!device?.workspaceId) return;

  // Get all group memberships for this device
  const groupMemberships = await db.query.deviceGroupMembers.findMany({
    where: eq(deviceGroupMembers.deviceId, deviceId),
    columns: { groupId: true },
  });
  const groupIds = groupMemberships.map(m => m.groupId);

  // Build the target ID list (device + groups + workspace)
  const targetIds = [deviceId, ...groupIds, device.workspaceId];

  // Find all rule set targets that match any of those IDs
  const matchingTargets = await db.query.ruleSetTargets.findMany({
    where: inArray(ruleSetTargets.targetId, targetIds),
    columns: { ruleSetId: true },
  });
  const ruleSetIds = [...new Set(matchingTargets.map(t => t.ruleSetId))];

  if (ruleSetIds.length === 0) {
    sendCommand(deviceId, { type: 'set_rule_sets', payload: { ruleSets: [] } });
    return;
  }

  const rows = await db.query.workspaceRuleSets.findMany({
    where: and(
      inArray(workspaceRuleSets.id, ruleSetIds),
      eq(workspaceRuleSets.enabled, true),
    ),
  });

  const compiled = rows.map(compileRuleSet);
  sendCommand(deviceId, { type: 'set_rule_sets', payload: { ruleSets: compiled } });
}

/**
 * Publishes a specific rule set to all of its target devices.
 * Called when a rule set is created/updated/enabled/disabled.
 */
export async function publishRuleSet(ruleSetId: string): Promise<void> {
  const deviceIds = await resolveDeviceIds(ruleSetId);
  await Promise.all(deviceIds.map(id => publishRuleSetsToDevice(id)));
}

/**
 * Evaluates sensor_value conditions for rule sets when a new sensor reading arrives.
 * For each active rule set in the workspace that contains a sensor_value condition
 * matching this sensor, checks if the condition passes and if so triggers the action
 * on all target devices via rule_set_trigger.
 */
export async function evaluateSensorReading(
  workspaceId: string,
  sensorId: string,
  value: number,
): Promise<void> {
  // Get all enabled rule sets for this workspace
  const ruleSets = await db.query.workspaceRuleSets.findMany({
    where: and(
      eq(workspaceRuleSets.workspaceId, workspaceId),
      eq(workspaceRuleSets.enabled, true),
    ),
  });

  const now = new Date();

  for (const rs of ruleSets) {
    if (!hasSensorCondition(rs.conditions, sensorId)) continue;
    if (!evaluateConditionGroup(rs.conditions, value, sensorId)) continue;

    // Respect cooldown
    if (rs.cooldownSeconds > 0 && rs.lastFiredAt) {
      const elapsed = (now.getTime() - rs.lastFiredAt.getTime()) / 1000;
      if (elapsed < rs.cooldownSeconds) continue;
    }

    // Update fire stats
    await db
      .update(workspaceRuleSets)
      .set({ lastFiredAt: now, fireCount: rs.fireCount + 1, updatedAt: now })
      .where(eq(workspaceRuleSets.id, rs.id));

    // Push trigger to all target devices
    const deviceIds = await resolveDeviceIds(rs.id);
    const compiled = compileRuleSet({ ...rs, lastFiredAt: now, fireCount: rs.fireCount + 1 });
    for (const deviceId of deviceIds) {
      sendCommand(deviceId, { type: 'rule_set_trigger', payload: { ruleSet: compiled } });
    }
  }
}

// ── Condition evaluation helpers ──────────────────────────────────────────────

type ConditionNode = {
  type: string;
  logic?: 'AND' | 'OR';
  children?: ConditionNode[];
  sensorId?: string;
  field?: string;
  operator?: string;
  value?: number;
};

function hasSensorCondition(node: ConditionNode, sensorId: string): boolean {
  if (node.type === 'sensor_value') return node.sensorId === sensorId;
  if (node.type === 'group' && node.children) {
    return node.children.some(c => hasSensorCondition(c, sensorId));
  }
  return false;
}

function evaluateConditionGroup(node: ConditionNode, reading: number, sensorId: string): boolean {
  if (node.type === 'sensor_value') {
    if (node.sensorId !== sensorId) return true; // non-matching sensor leaf — treat as pass
    return evaluateSensorLeaf(node, reading);
  }
  if (node.type === 'time_window') return evaluateTimeWindow(node as unknown as { start: string; end: string });
  if (node.type === 'day_of_week') return evaluateDayOfWeek(node as unknown as { days: number[] });
  if (node.type === 'group' && node.children) {
    const results = node.children.map(c => evaluateConditionGroup(c, reading, sensorId));
    return node.logic === 'OR' ? results.some(Boolean) : results.every(Boolean);
  }
  return true; // unknown leaf types pass (ble_beacon, device_online etc. = device evaluates)
}

function evaluateSensorLeaf(node: { operator?: string; value?: number }, reading: number): boolean {
  const v = node.value ?? 0;
  switch (node.operator) {
    case '>':  return reading > v;
    case '<':  return reading < v;
    case '>=': return reading >= v;
    case '<=': return reading <= v;
    case '==': return reading === v;
    case '!=': return reading !== v;
    default:   return false;
  }
}

function evaluateTimeWindow(node: { start: string; end: string }): boolean {
  const now    = new Date();
  const h = now.getHours(), m = now.getMinutes();
  const pad  = (x: number) => x.toString().padStart(2, '0');
  const cur  = `${pad(h)}:${pad(m)}`;
  return cur >= node.start && cur <= node.end;
}

function evaluateDayOfWeek(node: { days: number[] }): boolean {
  return node.days.includes(new Date().getDay());
}
