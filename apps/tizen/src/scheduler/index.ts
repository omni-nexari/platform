import { send } from '../ws/manager.js';
import { state } from '../state.js';
import { fetchSchedule, fetchWorkspace } from '../api/schedule.js';
import { getTemperature, getTelemetry } from '../device/system.js';
import { evaluateSlots } from './slotMatcher.js';
import { PlaylistRunner } from './playlistRunner.js';
import { showIdle, hideIdle } from '../ui/idle.js';
import { renderer } from '../renderer/index.js';

// ── play-log buffer (flushed every 5 min) ────────────────────────────────────
interface PlayLogEntry {
  contentId: string | null;
  zoneId?: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  completedFull: boolean;
  source: 'schedule' | 'playlist' | 'default' | 'emergency';
}
const playLogBuffer: PlayLogEntry[] = [];

export function logPlay(entry: PlayLogEntry): void {
  playLogBuffer.push(entry);
}

function flushPlayLog(): void {
  if (playLogBuffer.length === 0) return;
  const entries = playLogBuffer.splice(0);
  send({ type: 'play_log', payload: { entries } });
}

// ── scheduler state ───────────────────────────────────────────────────────────
let scheduleData: Awaited<ReturnType<typeof fetchSchedule>> | null = null;
let workspaceData: Awaited<ReturnType<typeof fetchWorkspace>> | null = null;
let currentRunner: PlaylistRunner | null = null;
let screenshotIntervalMin = 60;
let screenshotTimer: ReturnType<typeof setInterval> | null = null;
let zones: unknown[] = [];

// ── heartbeat ─────────────────────────────────────────────────────────────────
async function sendHeartbeat(): Promise<void> {
  const { cpuLoad, storageFreeBytes } = await getTelemetry();
  const temperatureCelsius = getTemperature();

  send({
    type: 'heartbeat',
    payload: {
      playerVersion: '1.0.0',
      cpuLoad,
      storageFreeBytes,
      temperatureCelsius,
      currentContentId: state.currentContentId,
      nextContentId: state.nextContentId,
      nextStartsAt: state.nextStartsAt?.toISOString() ?? null,
      wsConnected: state.wsConnected,
    },
  });
}

// ── tick (10 s) ───────────────────────────────────────────────────────────────
async function tick(): Promise<void> {
  if (state.emergencyActive) return; // emergency gate

  if (!scheduleData) return; // not loaded yet

  const now = new Date();
  const allSlots: unknown[] = (scheduleData.schedules as Array<{ slots: unknown[] }>)
    .flatMap((s) => s.slots);

  const activeSlot = evaluateSlots(allSlots as Parameters<typeof evaluateSlots>[0], now);

  if (activeSlot) {
    // Schedule slot active — hide idle, run the slot's content
    hideIdle();
    if (activeSlot.playlistId) {
      if (currentRunner?.playlistId !== activeSlot.playlistId) {
        currentRunner?.stop();
        currentRunner = new PlaylistRunner(activeSlot.playlistId, activeSlot.playlist, 'schedule');
        currentRunner.start();
      }
    } else if (activeSlot.contentId) {
      if (state.currentContentId !== activeSlot.contentId) {
        currentRunner?.stop();
        currentRunner = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await renderer.play({ id: activeSlot.contentId, ...(activeSlot.content as any) });
        state.currentContentId = activeSlot.contentId;
      }
    }
    return;
  }

  // ── No active schedule slot: fallback chain ───────────────────────────────
  // 1. device.defaultPlaylistId
  // 2. workspace.defaultPlaylistId
  // 3. built-in idle screen

  // TODO: device.defaultPlaylistId is set on the device record — for now we
  // read it from the workspace response which carries the resolved playlist.
  const deviceDefaultPlaylist = null; // Phase 2: load from device record API
  const wsDefault = workspaceData?.defaultPlaylist ?? null;
  const fallbackPlaylist = deviceDefaultPlaylist ?? wsDefault;

  if (fallbackPlaylist) {
    hideIdle();
    if (currentRunner?.playlistId !== (fallbackPlaylist as { id: string }).id) {
      currentRunner?.stop();
      currentRunner = new PlaylistRunner(
        (fallbackPlaylist as { id: string }).id,
        fallbackPlaylist,
        'default',
      );
      currentRunner.start();
    }
    return;
  }

  // 3. Built-in idle screen
  currentRunner?.stop();
  currentRunner = null;
  renderer.stop();
  showIdle();
}

// ── Scheduler public API ──────────────────────────────────────────────────────

export const scheduler = {
  async init(): Promise<void> {
    await this.refresh();
    setInterval(() => { void tick(); }, 10_000);
    setInterval(() => { void sendHeartbeat(); }, 30_000);
    setInterval(() => { flushPlayLog(); }, 5 * 60 * 1000);
    void tick();
    void sendHeartbeat();
  },

  async refresh(): Promise<void> {
    try {
      [scheduleData, workspaceData] = await Promise.all([fetchSchedule(), fetchWorkspace()]);
    } catch (e) {
      console.error('[scheduler] refresh failed:', e);
    }
  },

  setScreenshotInterval(minutes: number): void {
    screenshotIntervalMin = minutes;
    if (screenshotTimer) clearInterval(screenshotTimer);
    screenshotTimer = setInterval(() => {
      import('../device/system.js').then(({ captureScreen }) =>
        captureScreen(`interval_${Date.now()}.jpg`));
    }, minutes * 60 * 1000);
  },

  setZones(z: unknown[]): void {
    zones = z;
  },
};
