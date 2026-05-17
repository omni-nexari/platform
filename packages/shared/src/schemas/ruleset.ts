import { z } from 'zod';

// ── Condition leaf schemas ────────────────────────────────────────────────────

export const BleBeaconConditionSchema = z.object({
  type: z.literal('ble_beacon'),
  uuid: z.string().uuid(),
  major: z.number().int().optional(),
  minor: z.number().int().optional(),
  name: z.string().optional(),
  rssiThreshold: z.number().optional(),
  distanceMinCm: z.number().nullable().optional(),
  distanceMaxCm: z.number().nullable().optional(),
});

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const TimeWindowConditionSchema = z.object({
  type: z.literal('time_window'),
  start: z.string().regex(TIME_RE, 'Must be HH:MM'),
  end: z.string().regex(TIME_RE, 'Must be HH:MM'),
});

export const DayOfWeekConditionSchema = z.object({
  type: z.literal('day_of_week'),
  days: z.array(z.number().int().min(0).max(6)),
});

export const SensorValueConditionSchema = z.object({
  type: z.literal('sensor_value'),
  sensorId: z.string().uuid(),
  field: z.enum(['value', 'hour', 'day_of_week']),
  operator: z.enum(['>', '<', '>=', '<=', '==', '!=']),
  value: z.number(),
});

export const DeviceOnlineConditionSchema = z.object({ type: z.literal('device_online') });
export const DeviceOfflineConditionSchema = z.object({ type: z.literal('device_offline') });

export const RuleSetConditionLeafSchema = z.discriminatedUnion('type', [
  BleBeaconConditionSchema,
  TimeWindowConditionSchema,
  DayOfWeekConditionSchema,
  SensorValueConditionSchema,
  DeviceOnlineConditionSchema,
  DeviceOfflineConditionSchema,
]);

// Recursive ConditionGroup — z.lazy() for self-referential schema
export type RuleSetConditionGroupInput = {
  type: 'group';
  logic: 'AND' | 'OR';
  children: (z.infer<typeof RuleSetConditionLeafSchema> | RuleSetConditionGroupInput)[];
};

export const RuleSetConditionGroupSchema: z.ZodType<RuleSetConditionGroupInput> = z.lazy(() =>
  z.object({
    type: z.literal('group'),
    logic: z.enum(['AND', 'OR']),
    children: z.array(z.union([RuleSetConditionLeafSchema, RuleSetConditionGroupSchema])).min(1),
  })
);

// ── Action schemas ────────────────────────────────────────────────────────────

export const PlayContentActionSchema = z.object({
  type: z.literal('play_content'),
  contentId: z.string().uuid(),
});

export const PlayPlaylistActionSchema = z.object({
  type: z.literal('play_playlist'),
  playlistId: z.string().uuid(),
});

export const PlayScheduleActionSchema = z.object({
  type: z.literal('play_schedule'),
  scheduleId: z.string().uuid(),
});

export const MessageOverlayActionSchema = z.object({
  type: z.literal('message_overlay'),
  text: z.string().min(1).max(500),
  bgColor: z.string(),
  textColor: z.string(),
  fontSize: z.number().int().min(8).max(200),
  position: z.enum(['top', 'bottom', 'center', 'full']),
  durationSec: z.number().int().min(0),
});

export const DeviceControlActionSchema = z.object({
  type: z.literal('device_control'),
  command: z.enum(['volume', 'brightness', 'input_source', 'power']),
  value: z.union([z.number(), z.string()]),
});

export const SendNotificationActionSchema = z.object({
  type: z.literal('send_notification'),
  message: z.string().min(1).max(1000),
  severity: z.enum(['info', 'warn', 'critical']).optional(),
});

export const EmergencyOverrideActionSchema = z.object({
  type: z.literal('emergency_override'),
  contentId: z.string().uuid(),
  expireAfterSec: z.number().int().min(0).optional(),
});

export const LaunchAppActionSchema = z.object({
  type: z.literal('launch_app'),
  appId: z.string().min(1),
  appName: z.string().optional(),
});

export const RuleSetActionSchema = z.discriminatedUnion('type', [
  PlayContentActionSchema,
  PlayPlaylistActionSchema,
  PlayScheduleActionSchema,
  MessageOverlayActionSchema,
  DeviceControlActionSchema,
  SendNotificationActionSchema,
  EmergencyOverrideActionSchema,
  LaunchAppActionSchema,
]);

export type RuleSetAction = z.infer<typeof RuleSetActionSchema>;

// ── Top-level create / update body schemas ────────────────────────────────────

export const CreateRuleSetSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  enabled: z.boolean().optional().default(true),
  priority: z.number().int().min(0).max(100).optional().default(0),
  conditions: RuleSetConditionGroupSchema,
  action: RuleSetActionSchema,
  cooldownSeconds: z.number().int().min(0).optional().default(0),
  /** Initial target list — optional on create */
  targets: z.array(z.object({
    targetType: z.enum(['device', 'group', 'workspace']),
    targetId: z.string().uuid(),
  })).optional().default([]),
});

export const UpdateRuleSetSchema = CreateRuleSetSchema.omit({ workspaceId: true }).partial();

export const SetRuleSetTargetsSchema = z.object({
  targets: z.array(z.object({
    targetType: z.enum(['device', 'group', 'workspace']),
    targetId: z.string().uuid(),
  })),
});

export type CreateRuleSetInput = z.infer<typeof CreateRuleSetSchema>;
export type UpdateRuleSetInput = z.infer<typeof UpdateRuleSetSchema>;

// ── Compiled device payload ───────────────────────────────────────────────────
export const CompiledRuleSetSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  enabled: z.boolean(),
  priority: z.number().int(),
  conditions: RuleSetConditionGroupSchema,
  action: RuleSetActionSchema,
  cooldownSeconds: z.number().int(),
});

export type CompiledRuleSet = z.infer<typeof CompiledRuleSetSchema>;
