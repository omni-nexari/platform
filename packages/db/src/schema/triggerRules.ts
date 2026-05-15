import { pgTable, uuid, text, boolean, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';
import { devices } from './devices.js';

// ── Condition tree types ──────────────────────────────────────────────────────
// Conditions are stored as a recursive tree. The root is always a ConditionGroup.
// Leaf nodes are individual predicates; group nodes combine children with AND/OR.
//
// Example — (beaconA OR beaconB) AND 09:00–17:00:
// {
//   type: 'group', logic: 'AND', children: [
//     { type: 'group', logic: 'OR', children: [
//       { type: 'ble_beacon', uuid: '...', rssiThreshold: -75 },
//       { type: 'ble_beacon', uuid: '...', rssiThreshold: -75 },
//     ]},
//     { type: 'time_window', start: '09:00', end: '17:00' },
//   ]
// }

export type BleBeaconCondition = {
  type: 'ble_beacon';
  uuid: string;
  major?: number;
  minor?: number;
  /** RSSI floor in dBm — beacon must be stronger than this to match. Default -75. */
  rssiThreshold?: number;
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

export type ConditionLeaf = BleBeaconCondition | TimeWindowCondition | DayOfWeekCondition;

export type ConditionGroup = {
  type: 'group';
  logic: 'AND' | 'OR';
  children: ConditionNode[];
};

export type ConditionNode = ConditionLeaf | ConditionGroup;

// ── Action types ──────────────────────────────────────────────────────────────

export type PlayPlaylistAction = {
  type: 'play_playlist';
  playlistId: string;
};

export type TriggerAction = PlayPlaylistAction;

// ── Table ─────────────────────────────────────────────────────────────────────
// NOTE: The sensor-based 'trigger_rules' table already exists in sensors.ts.
// This table is 'device_rules' — device-side condition trees evaluated by the
// TV player (BLE beacons, time windows, day-of-week, and nested AND/OR groups).

export const deviceRules = pgTable('device_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** The workspace this rule belongs to. */
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  /** Optional device scope — null means the rule applies to all devices in the workspace. */
  deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  /**
   * Root ConditionGroup for this rule. Must be type='group'.
   * TV evaluates this tree on every BLE scan / time tick.
   */
  conditions: jsonb('conditions').$type<ConditionGroup>().notNull(),
  /**
   * What to do when conditions are met.
   * Currently only 'play_playlist' is supported.
   */
  action: jsonb('action').$type<TriggerAction>().notNull(),
  /**
   * Tie-break priority. Higher number wins when multiple rules match simultaneously.
   * Default 0.
   */
  priority: integer('priority').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type DeviceRule        = typeof deviceRules.$inferSelect;
export type DeviceRuleInsert  = typeof deviceRules.$inferInsert;
