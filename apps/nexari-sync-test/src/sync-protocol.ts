/**
 * sync-protocol.ts
 * Shared message type definitions for the WebRTC DataChannel P2P sync protocol.
 */

export type EngineMode = 'mse' | 'wasm' | 'avplay';

// ── Outbound (sender → peer) ───────────────────────────────────────────────────

/** Leader → Follower: URL of the video to load/decode */
export interface MsgVideoUrl {
  type: 'VIDEO_URL';
  url: string;
  durationMs: number;
  engineMode: EngineMode;
}

/** Follower → Leader: video is loaded/decoded and ready to start */
export interface MsgReady {
  type: 'READY';
  deviceId: string;
  engineMode: EngineMode;
}

/** Follower → Leader: NTP-style local clock probe. */
export interface MsgClockProbe {
  type: 'CLOCK_PROBE';
  probeId: number;
  clientSendMs: number;
}

/** Leader → Follower: clock response using leader getSyncedTime() values. */
export interface MsgClockReply {
  type: 'CLOCK_REPLY';
  probeId: number;
  clientSendMs: number;
  leaderReceiveMs: number;
  leaderSendMs: number;
}

/** Leader → Follower: switch engine mode; both must reload and re-sync */
export interface MsgSetEngine {
  type: 'SET_ENGINE';
  engineMode: EngineMode;
}

/**
 * Leader → Follower: start playback at the given synced wall-clock time.
 * syncedStartMs is a getSyncedTime() value in the leader-calibrated monotonic
 * clock domain.
 */
export interface MsgSyncPlay {
  type: 'SYNC_PLAY';
  syncedStartMs: number;
  videoDurationMs?: number;  // shared so both TVs use identical modulo divisor
  itemIndex: number;
}

/** Follower → Leader: periodic playback position report */
export interface MsgHeartbeat {
  type: 'HEARTBEAT';
  deviceId: string;
  itemIndex: number;
  currentTimeMs: number;  // stable timeline position, modulo videoDurationMs when known
  timelineMs?: number;    // stable unwrapped timeline: getSyncedTime() - syncedStartMs
  actualTimeMs?: number;  // decoder position from video/AVPlay, for diagnostics only
  syncedTime: number;     // getSyncedTime() at the instant of measurement
  engineMode: EngineMode;
}

/**
 * Leader → Follower: drift correction.
 * - action 'nudge': adjust video.playbackRate to driftRate
 * - action 'snap':  seek to targetMs immediately
 * - action 'noop':  no action needed (within tolerance)
 */
export interface MsgSyncAdjust {
  type: 'SYNC_ADJUST';
  itemIndex: number;
  driftMs: number;
  action: 'nudge' | 'snap' | 'noop';
  driftRate?: number;   // e.g. 0.995 or 1.005
  targetMs?: number;    // for snap action
}

export type SyncMessage =
  | MsgVideoUrl
  | MsgReady
  | MsgClockProbe
  | MsgClockReply
  | MsgSetEngine
  | MsgSyncPlay
  | MsgHeartbeat
  | MsgSyncAdjust;
