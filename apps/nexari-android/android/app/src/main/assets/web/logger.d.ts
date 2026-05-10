/**
 * logger.ts — Lightweight logger for player-web.
 *
 * All log calls are:
 *   1. Printed to console (visible in Chrome DevTools / logcat)
 *   2. Stored in a ring buffer (window.LogBuffer) so the player can drain and
 *      relay them to the server via the WS `device_log` message on demand.
 *
 * The HTTP flush to /test-sync/log is retained as a best-effort fallback for
 * Pi/standalone deployments that have no WS connection.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
export interface LoggerInit {
    apiBase: string;
    deviceId: string;
    onLine?: (level: Level, msg: string) => void;
    flushIntervalMs?: number;
}
export declare function initLogger(opts: LoggerInit): void;
export declare const logger: {
    debug: (msg: string) => void;
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    /** @deprecated Use info/warn/error instead. Kept for sync engine compat. */
    drift: (msg: string, _driftMs: number) => void;
};
export {};
//# sourceMappingURL=logger.d.ts.map