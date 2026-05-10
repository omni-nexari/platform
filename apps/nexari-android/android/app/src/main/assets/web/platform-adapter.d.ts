/**
 * PlatformAdapter — the contract a native host shell must implement so that
 * `@signage/player-web` can be reused unchanged across Android (WebView),
 * Windows (Electron), Linux, and pure-web hosts.
 *
 * Design rules:
 *   1. All methods are async (return Promise) so JS-bridge round-trips on
 *      Android/Electron are natural.
 *   2. Methods report **best-effort** semantics: on unsupported hosts they
 *      should resolve `{ supported: false }` rather than throw, so the player
 *      can degrade gracefully (e.g. tablets without DPC permission cannot
 *      reboot — they should still pair, render content, take screenshots).
 *   3. Identifiers (deviceId, MAC) are read once at boot and cached; the
 *      adapter must never change them across a session.
 *   4. The adapter is the *only* place that pokes the OS. Content rendering
 *      and sync logic must never reach around it.
 */
export type PlatformKind = 'tv' | 'epaper' | 'android' | 'androidtv' | 'firetv';
export type PlatformPowerState = 'on' | 'off' | 'standby' | 'sleeping';
export type PlatformOtaProgressKind = 'app_update_downloading' | 'app_update_installing' | 'app_update_complete' | 'app_update_failed';
export interface PlatformOtaProgress {
    kind: PlatformOtaProgressKind;
    /** 0..100 download or install percent (when known). */
    pct?: number;
    /** Target version being installed. */
    version?: string;
    /** Package id (Android: applicationId; Tizen: package name). */
    packageId?: string;
    /** Error message when `kind === 'app_update_failed'`. */
    error?: string;
}
export interface PlatformDeviceInfo {
    /** Stable device id assigned by the platform (Android ID, serial, etc.). */
    deviceId: string;
    /** Coarse device class for the API. */
    kind: PlatformKind;
    /** Free-form platform string sent to API: 'android', 'androidtv', 'firetv', ... */
    platform: string;
    /** Manufacturer ("Samsung", "Amazon", "Google", ...). */
    manufacturer?: string;
    /** Model name ("Fire TV Stick 4K Max", "Pixel Tablet", ...). */
    modelName?: string;
    /** Model code (Build.MODEL on Android). */
    modelCode?: string;
    /** Hardware serial number (when readable). */
    serialNumber?: string;
    /** OS firmware version (Build.VERSION.RELEASE on Android). */
    firmwareVersion?: string;
    /** Player app version (BuildConfig.VERSION_NAME on Android). */
    playerVersion?: string;
    /** "1920x1080" — landscape orientation. */
    resolution?: string;
    /** IANA timezone id. */
    timezone?: string;
    /** Battery percentage 0..100 (tablets / Fire TV battery accessories). */
    batteryPct?: number;
    /** MAC address of the primary network interface (Wi-Fi preferred). */
    macAddress?: string;
}
export interface PlatformNetworkInfo {
    ipAddress?: string;
    ssid?: string;
    /** "wifi" | "ethernet" | "cellular" | "unknown". */
    connectionType?: string;
    /** Signal strength 0..100. */
    signalPct?: number;
}
export interface PlatformAdapter {
    getDeviceInfo(): Promise<PlatformDeviceInfo>;
    getNetworkInfo(): Promise<PlatformNetworkInfo>;
    /** Hard reboot the host OS. Requires Device Owner on Android. */
    reboot(): Promise<{
        supported: boolean;
        error?: string;
    }>;
    /** Soft power off / standby. */
    powerOff(): Promise<{
        supported: boolean;
        error?: string;
    }>;
    /** Wake from standby. No-op on devices that auto-wake. */
    powerOn(): Promise<{
        supported: boolean;
        error?: string;
    }>;
    /** Lock the screen / blank the display without quitting the app. */
    sleep(): Promise<{
        supported: boolean;
        error?: string;
    }>;
    /** Current power state as the host sees it. */
    getPowerState(): Promise<PlatformPowerState>;
    /** 0..100 — media stream on Android. */
    setVolume(pct: number): Promise<{
        supported: boolean;
    }>;
    getVolume(): Promise<number>;
    setMute(muted: boolean): Promise<{
        supported: boolean;
    }>;
    /** 0..100. */
    setBrightness(pct: number): Promise<{
        supported: boolean;
    }>;
    getBrightness(): Promise<number>;
    /** Returns JPEG bytes of the current player surface. */
    screenshot(): Promise<{
        jpegBase64: string;
        width: number;
        height: number;
    } | null>;
    relaunch(): Promise<void>;
    clearCache(): Promise<void>;
    /** Restart only the WebView/renderer, keeping the host process alive. */
    reloadRenderer(): Promise<void>;
    /**
     * Download + install an APK / package. Progress callbacks fire on a best
     * effort basis. Resolves only after install completes (or fails).
     */
    installUpdate(args: {
        url: string;
        version: string;
        sha256?: string;
        onProgress?: (p: PlatformOtaProgress) => void;
    }): Promise<PlatformOtaProgress>;
    /** Enter lock-task / pinned mode. Best-effort; tablets without DPC silently no-op. */
    lockKiosk(): Promise<{
        supported: boolean;
    }>;
    unlockKiosk(): Promise<{
        supported: boolean;
    }>;
    /** True when the host believes it owns the screen exclusively. */
    isKioskActive(): Promise<boolean>;
}
//# sourceMappingURL=platform-adapter.d.ts.map