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

// ── MVP conditions ────────────────────────────────────────────────────────────

const COMP_OP = z.enum(['>', '<', '>=', '<=', '==', '!=']);
const NUM_OP  = z.enum(['>', '<', '>=', '<=']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const WeatherConditionSchema = z.object({
  type: z.literal('weather'),
  field: z.enum(['temperature_c', 'humidity_pct', 'wind_kph', 'condition']),
  operator: COMP_OP,
  value: z.union([z.number(), z.string()]),
  locationId: z.string().optional(),
});

export const DateRangeConditionSchema = z.object({
  type: z.literal('date_range'),
  start: z.string().regex(DATE_RE, 'Must be YYYY-MM-DD'),
  end:   z.string().regex(DATE_RE, 'Must be YYYY-MM-DD'),
});

export const OccupancyConditionSchema = z.object({
  type: z.literal('occupancy'),
  sourceId: z.string().optional(),
  operator: z.enum(['>', '<', '>=', '<=', '==']),
  count: z.number().int().min(0),
});

export const DeviceIdleConditionSchema = z.object({
  type: z.literal('device_idle'),
  idleSeconds: z.number().int().min(1),
});

export const ScheduleActiveConditionSchema = z.object({
  type: z.literal('schedule_active'),
  scheduleId: z.string().uuid(),
  negate: z.boolean().optional(),
});

export const ContentFinishedConditionSchema = z.object({
  type: z.literal('content_finished'),
  contentId: z.string().uuid().optional(),
});

// ── Nice-to-have conditions ───────────────────────────────────────────────────

export const HolidayConditionSchema = z.object({
  type: z.literal('holiday'),
  countryCode: z.string().min(2).max(3),
  region: z.string().optional(),
});

export const SunConditionSchema = z.object({
  type: z.literal('sun'),
  phase: z.enum(['sunrise', 'sunset', 'before_sunrise', 'after_sunset', 'daytime', 'nighttime']),
  offsetMinutes: z.number().int().optional(),
});

export const DeviceGroupStateConditionSchema = z.object({
  type: z.literal('device_group_state'),
  groupId: z.string().uuid(),
  state: z.enum(['all_online', 'any_offline', 'all_offline', 'any_online']),
});

export const TagMatchConditionSchema = z.object({
  type: z.literal('tag_match'),
  tagIds: z.array(z.string().uuid()).min(1),
  logic: z.enum(['any', 'all']).optional(),
});

export const NetworkSpeedConditionSchema = z.object({
  type: z.literal('network_speed'),
  operator: NUM_OP,
  mbps: z.number().min(0),
});

export const AudioLevelConditionSchema = z.object({
  type: z.literal('audio_level'),
  operator: NUM_OP,
  db: z.number(),
});

export const WebhookConditionSchema = z.object({
  type: z.literal('webhook'),
  webhookKey: z.string().min(1).max(100),
});

export const BatteryLevelConditionSchema = z.object({
  type: z.literal('battery_level'),
  operator: NUM_OP,
  percent: z.number().min(0).max(100),
});

export const DeviceOrientationConditionSchema = z.object({
  type: z.literal('device_orientation'),
  orientation: z.enum(['portrait', 'landscape']),
});

export const RecurringCronConditionSchema = z.object({
  type: z.literal('recurring_cron'),
  cron: z.string().min(1),
  timezone: z.string().optional(),
});

export const TemperatureConditionSchema = z.object({
  type: z.literal('temperature'),
  sensorId: z.string().uuid().optional(),
  operator: NUM_OP,
  celsius: z.number(),
});

export const HumidityConditionSchema = z.object({
  type: z.literal('humidity'),
  sensorId: z.string().uuid().optional(),
  operator: NUM_OP,
  percent: z.number().min(0).max(100),
});

// ── Good-to-have conditions ───────────────────────────────────────────────────

export const FaceDetectedConditionSchema = z.object({
  type: z.literal('face_detected'),
  minCount: z.number().int().min(1).optional(),
  ageMin: z.number().int().min(0).max(120).optional(),
  ageMax: z.number().int().min(0).max(120).optional(),
  gender: z.enum(['male', 'female', 'any']).optional(),
});

export const GestureConditionSchema = z.object({
  type: z.literal('gesture'),
  gesture: z.enum(['wave', 'swipe_left', 'swipe_right', 'point', 'thumbs_up']),
});

export const QrScanConditionSchema = z.object({
  type: z.literal('qr_scan'),
  qrCodeId: z.string().optional(),
});

export const NfcTapConditionSchema = z.object({
  type: z.literal('nfc_tap'),
  tagId: z.string().optional(),
});

export const StockLevelConditionSchema = z.object({
  type: z.literal('stock_level'),
  sku: z.string().min(1),
  operator: COMP_OP,
  quantity: z.number().min(0),
});

export const PosSaleConditionSchema = z.object({
  type: z.literal('pos_sale'),
  metric: z.enum(['total_amount', 'transaction_count', 'avg_ticket']),
  window: z.enum(['minute', 'hour', 'today']),
  operator: NUM_OP,
  value: z.number(),
});

export const TrafficConditionSchema = z.object({
  type: z.literal('traffic'),
  routeId: z.string().min(1),
  operator: NUM_OP,
  delayMinutes: z.number().min(0),
});

export const FlightStatusConditionSchema = z.object({
  type: z.literal('flight_status'),
  flightNumber: z.string().optional(),
  gate: z.string().optional(),
  status: z.enum(['on_time', 'delayed', 'cancelled', 'boarding', 'departed']),
});

export const SocialMentionConditionSchema = z.object({
  type: z.literal('social_mention'),
  platform: z.enum(['twitter', 'instagram', 'facebook', 'tiktok']),
  handle: z.string().min(1),
  keyword: z.string().optional(),
});

export const CalendarEventConditionSchema = z.object({
  type: z.literal('calendar_event'),
  calendarId: z.string().min(1),
  eventType: z.enum(['event_active', 'event_starting_soon', 'event_ended']),
  windowMinutes: z.number().int().min(0).optional(),
});

export const StreamHealthConditionSchema = z.object({
  type: z.literal('stream_health'),
  streamId: z.string().min(1),
  state: z.enum(['healthy', 'unhealthy']),
});

export const GeofenceConditionSchema = z.object({
  type: z.literal('geofence'),
  geofenceId: z.string().min(1),
  transition: z.enum(['enter', 'exit', 'inside', 'outside']),
});

export const RuleSetConditionLeafSchema = z.discriminatedUnion('type', [
  BleBeaconConditionSchema,
  TimeWindowConditionSchema,
  DayOfWeekConditionSchema,
  SensorValueConditionSchema,
  DeviceOnlineConditionSchema,
  DeviceOfflineConditionSchema,
  // MVP
  WeatherConditionSchema,
  DateRangeConditionSchema,
  OccupancyConditionSchema,
  DeviceIdleConditionSchema,
  ScheduleActiveConditionSchema,
  ContentFinishedConditionSchema,
  // Nice-to-have
  HolidayConditionSchema,
  SunConditionSchema,
  DeviceGroupStateConditionSchema,
  TagMatchConditionSchema,
  NetworkSpeedConditionSchema,
  AudioLevelConditionSchema,
  WebhookConditionSchema,
  BatteryLevelConditionSchema,
  DeviceOrientationConditionSchema,
  RecurringCronConditionSchema,
  TemperatureConditionSchema,
  HumidityConditionSchema,
  // Good-to-have
  FaceDetectedConditionSchema,
  GestureConditionSchema,
  QrScanConditionSchema,
  NfcTapConditionSchema,
  StockLevelConditionSchema,
  PosSaleConditionSchema,
  TrafficConditionSchema,
  FlightStatusConditionSchema,
  SocialMentionConditionSchema,
  CalendarEventConditionSchema,
  StreamHealthConditionSchema,
  GeofenceConditionSchema,
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

// ── MVP actions ───────────────────────────────────────────────────────────────

export const SetBrightnessScheduleActionSchema = z.object({
  type: z.literal('set_brightness_schedule'),
  mode: z.enum(['auto', 'manual', 'follow_sun']),
  manualValue: z.number().int().min(0).max(100).optional(),
});

export const LogEventActionSchema = z.object({
  type: z.literal('log_event'),
  eventName: z.string().min(1).max(100),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const WebhookCallActionSchema = z.object({
  type: z.literal('webhook_call'),
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
  body: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const SwitchZoneContentActionSchema = z.object({
  type: z.literal('switch_zone_content'),
  zoneId: z.string().min(1),
  contentId: z.string().uuid(),
});

// ── Nice-to-have actions ──────────────────────────────────────────────────────

export const RecordAnalyticsActionSchema = z.object({
  type: z.literal('record_analytics'),
  metric: z.string().min(1).max(100),
  value: z.number(),
  tags: z.record(z.string(), z.string()).optional(),
});

export const ChainRuleSetActionSchema = z.object({
  type: z.literal('chain_rule_set'),
  ruleSetId: z.string().uuid(),
});

export const DelayActionSchema = z.object({
  type: z.literal('delay'),
  seconds: z.number().min(0),
});

export const StopPlaybackActionSchema = z.object({ type: z.literal('stop_playback') });
export const PausePlaybackActionSchema = z.object({ type: z.literal('pause_playback') });

export const FadeVolumeActionSchema = z.object({
  type: z.literal('fade_volume'),
  targetVolume: z.number().int().min(0).max(100),
  durationSeconds: z.number().min(0),
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
  // MVP
  SetBrightnessScheduleActionSchema,
  LogEventActionSchema,
  WebhookCallActionSchema,
  SwitchZoneContentActionSchema,
  // Nice-to-have
  RecordAnalyticsActionSchema,
  ChainRuleSetActionSchema,
  DelayActionSchema,
  StopPlaybackActionSchema,
  PausePlaybackActionSchema,
  FadeVolumeActionSchema,
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
