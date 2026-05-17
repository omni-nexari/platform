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

// ── MVP conditions ────────────────────────────────────────────────────────────

export type WeatherCondition = {
  type: 'weather';
  /** Which weather attribute to compare. */
  field: 'temperature_c' | 'humidity_pct' | 'wind_kph' | 'condition';
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  /** Numeric for temperature/humidity/wind; string code for `condition` (e.g. 'rain','snow','sunny','cloudy'). */
  value: number | string;
  /** Optional weather location id; defaults to device location. */
  locationId?: string;
};

export type DateRangeCondition = {
  type: 'date_range';
  /** YYYY-MM-DD */
  start: string;
  /** YYYY-MM-DD */
  end: string;
};

export type OccupancyCondition = {
  type: 'occupancy';
  /** Optional explicit occupancy source (camera/sensor); defaults to device's primary. */
  sourceId?: string;
  operator: '>' | '<' | '>=' | '<=' | '==';
  count: number;
};

export type DeviceIdleCondition = {
  type: 'device_idle';
  idleSeconds: number;
};

export type ScheduleActiveCondition = {
  type: 'schedule_active';
  scheduleId: string;
  /** If true, fires when schedule is NOT active. */
  negate?: boolean;
};

export type ContentFinishedCondition = {
  type: 'content_finished';
  /** Optional — fires for any content if omitted. */
  contentId?: string;
};

// ── Nice-to-have conditions ───────────────────────────────────────────────────

export type HolidayCondition = {
  type: 'holiday';
  /** ISO country code (e.g. 'HK', 'US', 'JP'). */
  countryCode: string;
  /** Optional subdivision (e.g. state). */
  region?: string;
};

export type SunCondition = {
  type: 'sun';
  phase: 'sunrise' | 'sunset' | 'before_sunrise' | 'after_sunset' | 'daytime' | 'nighttime';
  /** Minutes offset from sun event (e.g. -30 = 30min before sunset). */
  offsetMinutes?: number;
};

export type DeviceGroupStateCondition = {
  type: 'device_group_state';
  groupId: string;
  state: 'all_online' | 'any_offline' | 'all_offline' | 'any_online';
};

export type TagMatchCondition = {
  type: 'tag_match';
  tagIds: string[];
  /** any = OR; all = AND. Default any. */
  logic?: 'any' | 'all';
};

export type NetworkSpeedCondition = {
  type: 'network_speed';
  operator: '>' | '<' | '>=' | '<=';
  mbps: number;
};

export type AudioLevelCondition = {
  type: 'audio_level';
  operator: '>' | '<' | '>=' | '<=';
  /** Ambient noise in dBA. */
  db: number;
};

export type WebhookCondition = {
  type: 'webhook';
  /** Unique key matched against POST /rule-sets/webhook/:key. */
  webhookKey: string;
};

export type BatteryLevelCondition = {
  type: 'battery_level';
  operator: '>' | '<' | '>=' | '<=';
  percent: number;
};

export type DeviceOrientationCondition = {
  type: 'device_orientation';
  orientation: 'portrait' | 'landscape';
};

export type RecurringCronCondition = {
  type: 'recurring_cron';
  /** Standard 5-field cron expression (min hour dom mon dow). */
  cron: string;
  /** IANA timezone for cron evaluation. Default device timezone. */
  timezone?: string;
};

export type TemperatureCondition = {
  type: 'temperature';
  sensorId?: string;
  operator: '>' | '<' | '>=' | '<=';
  celsius: number;
};

export type HumidityCondition = {
  type: 'humidity';
  sensorId?: string;
  operator: '>' | '<' | '>=' | '<=';
  percent: number;
};

// ── Good-to-have conditions (external integrations) ───────────────────────────

export type FaceDetectedCondition = {
  type: 'face_detected';
  minCount?: number;
  ageMin?: number;
  ageMax?: number;
  gender?: 'male' | 'female' | 'any';
};

export type GestureCondition = {
  type: 'gesture';
  gesture: 'wave' | 'swipe_left' | 'swipe_right' | 'point' | 'thumbs_up';
};

export type QrScanCondition = {
  type: 'qr_scan';
  /** Optional — match a specific QR payload/id. */
  qrCodeId?: string;
};

export type NfcTapCondition = {
  type: 'nfc_tap';
  tagId?: string;
};

export type StockLevelCondition = {
  type: 'stock_level';
  sku: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  quantity: number;
};

export type PosSaleCondition = {
  type: 'pos_sale';
  metric: 'total_amount' | 'transaction_count' | 'avg_ticket';
  window: 'minute' | 'hour' | 'today';
  operator: '>' | '<' | '>=' | '<=';
  value: number;
};

export type TrafficCondition = {
  type: 'traffic';
  routeId: string;
  operator: '>' | '<' | '>=' | '<=';
  delayMinutes: number;
};

export type FlightStatusCondition = {
  type: 'flight_status';
  flightNumber?: string;
  gate?: string;
  status: 'on_time' | 'delayed' | 'cancelled' | 'boarding' | 'departed';
};

export type SocialMentionCondition = {
  type: 'social_mention';
  platform: 'twitter' | 'instagram' | 'facebook' | 'tiktok';
  handle: string;
  /** Optional keyword filter. */
  keyword?: string;
};

export type CalendarEventCondition = {
  type: 'calendar_event';
  calendarId: string;
  eventType: 'event_active' | 'event_starting_soon' | 'event_ended';
  /** Minutes before/after event for *_starting_soon / *_ended. */
  windowMinutes?: number;
};

export type StreamHealthCondition = {
  type: 'stream_health';
  streamId: string;
  state: 'healthy' | 'unhealthy';
};

export type GeofenceCondition = {
  type: 'geofence';
  geofenceId: string;
  transition: 'enter' | 'exit' | 'inside' | 'outside';
};

export type RuleSetConditionLeaf =
  | BleBeaconCondition
  | TimeWindowCondition
  | DayOfWeekCondition
  | SensorValueCondition
  | DeviceOnlineCondition
  | DeviceOfflineCondition
  // MVP
  | WeatherCondition
  | DateRangeCondition
  | OccupancyCondition
  | DeviceIdleCondition
  | ScheduleActiveCondition
  | ContentFinishedCondition
  // Nice-to-have
  | HolidayCondition
  | SunCondition
  | DeviceGroupStateCondition
  | TagMatchCondition
  | NetworkSpeedCondition
  | AudioLevelCondition
  | WebhookCondition
  | BatteryLevelCondition
  | DeviceOrientationCondition
  | RecurringCronCondition
  | TemperatureCondition
  | HumidityCondition
  // Good-to-have
  | FaceDetectedCondition
  | GestureCondition
  | QrScanCondition
  | NfcTapCondition
  | StockLevelCondition
  | PosSaleCondition
  | TrafficCondition
  | FlightStatusCondition
  | SocialMentionCondition
  | CalendarEventCondition
  | StreamHealthCondition
  | GeofenceCondition;

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

// ── MVP actions ───────────────────────────────────────────────────────────────

export type SetBrightnessScheduleAction = {
  type: 'set_brightness_schedule';
  mode: 'auto' | 'manual' | 'follow_sun';
  /** 0–100, used when mode='manual'. */
  manualValue?: number;
};

export type LogEventAction = {
  type: 'log_event';
  eventName: string;
  meta?: Record<string, unknown>;
};

export type WebhookCallAction = {
  type: 'webhook_call';
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: string;
  headers?: Record<string, string>;
};

export type SwitchZoneContentAction = {
  type: 'switch_zone_content';
  zoneId: string;
  contentId: string;
};

// ── Nice-to-have actions ──────────────────────────────────────────────────────

export type RecordAnalyticsAction = {
  type: 'record_analytics';
  metric: string;
  value: number;
  tags?: Record<string, string>;
};

export type ChainRuleSetAction = {
  type: 'chain_rule_set';
  ruleSetId: string;
};

export type DelayAction = {
  type: 'delay';
  seconds: number;
};

export type StopPlaybackAction = {
  type: 'stop_playback';
};

export type PausePlaybackAction = {
  type: 'pause_playback';
};

export type FadeVolumeAction = {
  type: 'fade_volume';
  /** 0–100 */
  targetVolume: number;
  durationSeconds: number;
};

export type RuleSetAction =
  | PlayContentAction
  | PlayPlaylistAction
  | PlayScheduleAction
  | MessageOverlayAction
  | DeviceControlAction
  | SendNotificationAction
  | EmergencyOverrideAction
  | LaunchAppAction
  // MVP
  | SetBrightnessScheduleAction
  | LogEventAction
  | WebhookCallAction
  | SwitchZoneContentAction
  // Nice-to-have
  | RecordAnalyticsAction
  | ChainRuleSetAction
  | DelayAction
  | StopPlaybackAction
  | PausePlaybackAction
  | FadeVolumeAction;

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
