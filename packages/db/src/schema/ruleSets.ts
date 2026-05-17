import { pgTable, uuid, text, boolean, integer, timestamp, jsonb, index, unique, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { workspaces } from './workspaces.js';
import { devices } from './devices.js';
import { deviceGroups } from './device-groups.js';
import { sensorSources } from './sensors.js';

// ── Condition tree types ──────────────────────────────────────────────────────
// Shares the same ConditionGroup/ConditionNode structure as device_rules,
// plus adds sensor_value, device_online, device_offline leaf types.

export type BleBeaconCondition = {
  type: 'ble_beacon';
  uuid: string;
  major?: number;
  minor?: number;
  name?: string;
  rssiThreshold?: number;
  distanceMinCm?: number | null;
  distanceMaxCm?: number | null;
};

export type TimeWindowCondition = {
  type: 'time_window';
  /** HH:MM (24-hour) */
  start: string;
  /** HH:MM (24-hour) */
  end: string;
};

export type DayOfWeekCondition = {
  type: 'day_of_week';
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
};

export type SensorValueCondition = {
  type: 'sensor_value';
  sensorId: string;
  /** 'value' = latest reading value; 'hour' = current hour; 'day_of_week' = current day */
  field: 'value' | 'hour' | 'day_of_week';
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  value: number;
};

export type DeviceOnlineCondition = {
  type: 'device_online';
};

export type DeviceOfflineCondition = {
  type: 'device_offline';
};

export type RuleSetConditionLeaf =
  | BleBeaconCondition
  | TimeWindowCondition
  | DayOfWeekCondition
  | SensorValueCondition
  | DeviceOnlineCondition
  | DeviceOfflineCondition;

export type RuleSetConditionGroup = {
  type: 'group';
  logic: 'AND' | 'OR';
  children: RuleSetConditionNode[];
};

export type RuleSetConditionNode = RuleSetConditionLeaf | RuleSetConditionGroup;

// ── Action types ──────────────────────────────────────────────────────────────

export type PlayContentAction = {
  type: 'play_content';
  contentId: string;
};

export type PlayPlaylistAction = {
  type: 'play_playlist';
  playlistId: string;
};

export type PlayScheduleAction = {
  type: 'play_schedule';
  scheduleId: string;
};

export type MessageOverlayAction = {
  type: 'message_overlay';
  text: string;
  bgColor: string;
  textColor: string;
  fontSize: number;
  position: 'top' | 'bottom' | 'center' | 'full';
  durationSec: number;
};

export type DeviceControlAction = {
  type: 'device_control';
  command: 'volume' | 'brightness' | 'input_source' | 'power';
  value: number | string;
};

export type SendNotificationAction = {
  type: 'send_notification';
  message: string;
  severity?: 'info' | 'warn' | 'critical';
};

export type EmergencyOverrideAction = {
  type: 'emergency_override';
  contentId: string;
  /** Seconds until emergency override auto-expires; 0 = manual only */
  expireAfterSec?: number;
};

export type LaunchAppAction = {
  type: 'launch_app';
  appId: string;
  appName?: string;
};

export type RuleSetAction =
  | PlayContentAction
  | PlayPlaylistAction
  | PlayScheduleAction
  | MessageOverlayAction
  | DeviceControlAction
  | SendNotificationAction
  | EmergencyOverrideAction
  | LaunchAppAction;

// ── Compiled device payload ───────────────────────────────────────────────────
/** Sent to device via WS set_rule_sets command. */
export type CompiledRuleSet = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  conditions: RuleSetConditionGroup;
  action: RuleSetAction;
  cooldownSeconds: number;
};

// ── Tables ────────────────────────────────────────────────────────────────────

export const ruleSetTargetTypeEnum = pgEnum('rule_set_target_type', ['device', 'group', 'workspace']);

export const workspaceRuleSets = pgTable('workspace_rule_sets', {
  id:             uuid('id').primaryKey().defaultRandom(),
  workspaceId:    uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name:           text('name').notNull(),
  description:    text('description'),
  enabled:        boolean('enabled').notNull().default(true),
  /**
   * Priority 0–100. Higher number wins when multiple rule sets match.
   * Ties broken by updatedAt (most recently saved wins).
   */
  priority:       integer('priority').notNull().default(0),
  /** Root ConditionGroup for this rule set. Must be type='group'. */
  conditions:     jsonb('conditions').$type<RuleSetConditionGroup>().notNull(),
  /** Action to execute when conditions are met. */
  action:         jsonb('action').$type<RuleSetAction>().notNull(),
  cooldownSeconds: integer('cooldown_seconds').notNull().default(0),
  lastFiredAt:    timestamp('last_fired_at', { withTimezone: true }),
  fireCount:      integer('fire_count').notNull().default(0),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  wsIdx: index('workspace_rule_sets_workspace_id_idx').on(t.workspaceId),
}));

export const ruleSetTargets = pgTable('rule_set_targets', {
  id:         uuid('id').primaryKey().defaultRandom(),
  ruleSetId:  uuid('rule_set_id').notNull().references(() => workspaceRuleSets.id, { onDelete: 'cascade' }),
  targetType: ruleSetTargetTypeEnum('target_type').notNull(),
  /** uuid of the device/group, or workspaceId for workspace-wide target. */
  targetId:   uuid('target_id').notNull(),
}, (t) => ({
  uniq:      unique('rule_set_targets_uniq').on(t.ruleSetId, t.targetType, t.targetId),
  ruleSetIdx: index('rule_set_targets_rule_set_id_idx').on(t.ruleSetId),
  targetIdx:  index('rule_set_targets_target_id_idx').on(t.targetId),
}));

// ── Relations ─────────────────────────────────────────────────────────────────

export const workspaceRuleSetsRelations = relations(workspaceRuleSets, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [workspaceRuleSets.workspaceId], references: [workspaces.id] }),
  targets:   many(ruleSetTargets),
}));

export const ruleSetTargetsRelations = relations(ruleSetTargets, ({ one }) => ({
  ruleSet: one(workspaceRuleSets, { fields: [ruleSetTargets.ruleSetId], references: [workspaceRuleSets.id] }),
}));

// ── Inferred types ────────────────────────────────────────────────────────────

export type WorkspaceRuleSet       = typeof workspaceRuleSets.$inferSelect;
export type WorkspaceRuleSetInsert = typeof workspaceRuleSets.$inferInsert;
export type RuleSetTarget          = typeof ruleSetTargets.$inferSelect;
export type RuleSetTargetInsert    = typeof ruleSetTargets.$inferInsert;
