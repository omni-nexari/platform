/**
 * sync-coordinator.ts — Connects the Windows player to the centralized
 * sync relay when the active playlist belongs to a sync group.
 *
 * Uses the same engine.ts + sync.ts from apps/nexari-html5-sync/src/ verbatim,
 * so the WS protocol (WS_REGISTER, PING/PONG, LOAD_URL, READY, GO,
 * LOOP_READY, LOOP_GO, PLAYHEAD) is identical across Tizen/Windows/ePaper.
 *
 * Call `startSync(config)` when a syncGroupId is detected on the active
 * playlist and `stopSync()` when the playlist changes.
 */
import { init as syncInit, stop as syncStop } from '@sync/sync.js';
import type { SyncConfig } from '@sync/sync.js';
import { setPlaylist, getPlaylistUrls, getDuration } from '@sync/engine.js';

let _active = false;

export interface WindowsSyncConfig {
  apiBase:        string;
  token:          string;
  deviceId:       string;
  groupId:        string;
  expectedPeers:  number;
  /** Pre-elected leader deviceId from manifest leaderPriority[0]. Skips lexicographic election. */
  pinnedLeaderId?: string;
  /** Relay mode: 'cloud' uses the centralised API relay, 'lan' uses ws://leaderIp:9616 built-in relay. */
  syncRelayMode?: string;
  /** LAN relay URL (used when syncRelayMode === 'lan'). */
  relayUrl?: string | null;
  /**
   * Platform startup-latency compensation in ms. Positive = hold this device back
   * (use for fast decoders like Windows/Chromium that render the first frame earlier
   * than Tizen WebKit). Negative = advance this device (slow decoders).
   * Tune in 20 ms increments until all screens are frame-aligned.
   */
  selfLatency?: number;
  container:      HTMLElement;
  playlist:       string[];          // array of video URLs
  onStatus:       (msg: string) => void;
}

export async function startSync(cfg: WindowsSyncConfig): Promise<void> {
  if (_active) await stopSync();
  _active = true;

  // Build the WS relay URL based on the configured relay mode.
  // LAN mode: connect directly to the leader's built-in relay (ws://leaderIp:9616, no auth).
  // Cloud mode (default): use the centralised API relay with token auth.
  const wsBase = cfg.apiBase.replace(/^http/, 'ws');
  let wsUrl: string;
  if ((cfg.syncRelayMode ?? 'cloud') === 'lan' && cfg.relayUrl) {
    wsUrl = cfg.relayUrl;
  } else {
    wsUrl = `${wsBase}/sync-relay/ws?token=${encodeURIComponent(cfg.token)}`;
  }

  // Dynamically import the engine so it attaches to the passed container
  const { initEngine, prepare, schedulePlayAt, destroyEngine } = await import('@sync/engine.js');
  await initEngine(cfg.container);

  // Seed the engine playlist with Windows-local video URLs *before* syncInit.
  // Without this, _fetchPlaylistUrls() falls back to Tizen bundled file paths
  // (file:///opt/usr/apps/…) which are unusable on Windows and get broadcast
  // to all followers via LOAD_URL.
  if (cfg.playlist.length > 0) {
    setPlaylist(cfg.playlist);
  }

  const syncCfg: SyncConfig = {
    wsUrl,
    groupId:        cfg.groupId,
    deviceId:       cfg.deviceId,
    selfIp:         '',            // not used by centralized relay
    expectedPeers:  cfg.expectedPeers,
    pinnedLeaderId: cfg.pinnedLeaderId,
    selfLatency:    cfg.selfLatency,
    onStatus:       cfg.onStatus,
    // OS-specific URL resolver: Windows uses its own local file paths so the
    // leader always broadcasts a valid local path + playlist index.
    fetchVideoUrl: () => {
      const urls = getPlaylistUrls();
      return Promise.resolve(urls[0] ?? cfg.playlist[0] ?? '');
    },
    prepareEngine:     (url: string) => prepare(url),
    schedulePlay:      (epochMs: number) => schedulePlayAt(epochMs),
    getEngineDuration: () => {
      return getDuration();
    },
    restartEngine: () => {
      destroyEngine();
      initEngine(cfg.container);
    },
  };

  await syncInit(syncCfg);
}

export async function stopSync(): Promise<void> {
  _active = false;
  try { syncStop(); } catch { /* ignore */ }
}
