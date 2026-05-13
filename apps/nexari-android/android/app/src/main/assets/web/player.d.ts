/**
 * player.ts — Full Nexari player orchestrator for player-web.
 *
 * Platform-agnostic. Host shells (Android, Pi, browser) inject a PlatformAdapter.
 * Content rendering is identical to the Tizen player, minus AVPlay and Tizen APIs.
 * All video uses HTML5 <video>. Sync/play uses the A/B engine in ./sync/engine.ts.
 *
 * Content types supported:
 *   VIDEO, IMAGE, HTML, CANVAS, MENU_BOARD, CALENDAR, DATASYNC, LIVE_STREAM,
 *   ZONE_LAYOUT, PDF (PDF.js if available), PLAYLIST (nested)
 */
import type { PlatformAdapter } from './platform-adapter.js';
export interface PlayerConfig {
    apiBase: string;
    wsBase: string;
    adapter: PlatformAdapter;
    container: HTMLElement;
    heartbeatMs?: number;
}
export declare class Player {
    private cfg;
    private api;
    private ws;
    private wsReady;
    private deviceId;
    private token;
    private heartbeatTimer;
    private reconnectTimer;
    private contentRefreshTimer;
    private logStreamTimer;
    private ntpOffset;
    private ntpSyncInProgress;
    private playlistItems;
    private playlistIdx;
    private playbackCancel;
    private currentHandle;
    private currentVideoEl;
    private localUrlCache;
    private calendarPushHandlers;
    private syncActive;
    private platform;
    private screenshotIntervalHandle;
    private liveIntervalHandle;
    private liveCaptureActive;
    private liveCaptureIntervalMs;
    private liveCaptureBusy;
    private thumbTimer;
    private lastThumbAt;
    private lastContentSignature;
    private pendingItems;
    private _pendingSyncGroupMsg;
    private _pendingSyncRelayInfo;
    private pendingSignature;
    private isDownloadingContent;
    private deviceDisplayName;
    constructor(cfg: PlayerConfig);
    start(): Promise<void>;
    stop(): void;
    private ensurePaired;
    private showPairingScreen;
    private updatePairingStatus;
    private hidePairingScreen;
    private syncNtp;
    getSyncedTime(): number;
    private connectWs;
    private send;
    private onWsMessage;
    private dispatchCommand;
    private takeScreenshot;
    /** Throttled auto-thumbnail on content change (≤1 per 10s, fires 5s after item starts). */
    private scheduleContentChangeShot;
    /** Live-view capture loop (setTimeout chain, not setInterval — prevents concurrent calls). */
    private scheduleLiveCapture;
    private sendHeartbeat;
    /**
     * Arm the technician 10-tap gesture: ten taps inside the top-left ZONE
     * within a 3-second window open the in-player settings overlay. Uses
     * capture-phase listeners on `touchstart`, `pointerdown`, and `click` so
     * taps on fullscreen content (video, iframes, images) still register, and
     * accepts touch as well as mouse for desktop QA.
     */
    private initSettingsGesture;
    /**
     * In-player settings overlay. Renders device/network/config info, a tail of
     * recent log lines, and technician actions (Re-pair, Reload, Clear logs,
     * open native system settings). Auto-refreshes the log tail every second
     * while visible.
     */
    private settingsOverlayEl;
    private settingsLogTimer;
    private showSettingsOverlay;
    private hideSettingsOverlay;
    private flushLogStream;
    private getContentSignature;
    private preCacheItems;
    /** Swap a remote content URL for the locally cached blob: URL if available. */
    private resolveLocalUrl;
    private updateIdleProgress;
    private downloadContentInBackground;
    private swapToPending;
    private tryLoadCachedSchedule;
    private loadContent;
    private cancelPlayback;
    /**
     * Fully release a <video> element's media decoder resources.
     * On Android WebView, just .pause() + .remove() leaks the decoder buffer.
     * Must clear src, removeAttribute, call load(), then remove from DOM.
     */
    private releaseVideo;
    private renderPlaylist;
    private sleep;
    private renderContent;
    private renderImage;
    private renderVideo;
    /**
     * Seamless VIDEO → VIDEO swap. Appends the new <video> on top of the
     * currently playing one, waits for `canplay`, then releases the old element.
     * Prevents the WebView default "play" overlay flash that appears when we
     * pause/remove the prior video before the new one is decoded.
     */
    private transitionToVideo;
    private renderHTML;
    private renderCanvas;
    private renderCalendarContent;
    private renderDataSyncContent;
    private renderLiveStream;
    private renderPdf;
    /**
     * PDF.js-based renderer. Mirrors the Tizen implementation: lazy-loads
     * pdfjs/pdf.min.js (shipped in android assets via sync-player-web.cjs),
     * fetches the PDF as a Uint8Array (from local blob cache when available),
     * renders each page to a canvas and auto-advances every durMs/numPages.
     */
    private renderPdfWithPdfJs;
    private pdfJsLibPromise;
    private loadPdfJs;
    private renderZoneLayout;
    private initSyncGroup;
    private initVideoWall;
    private sendOta;
    private showIdle;
}
//# sourceMappingURL=player.d.ts.map