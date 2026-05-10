/**
 * @signage/player-web — public entry point.
 *
 * Native host shells (Android WebView, Windows Electron, etc.) bundle this
 * module and bootstrap a `Player` instance against a `PlatformAdapter` they
 * provide. All OS-specific surface (power, volume, screenshot, OTA, kiosk)
 * lives in the host; everything content-related (sync, rendering, scheduling)
 * lives in this bundle.
 */
export { Player } from './player.js';
export type { PlayerConfig } from './player.js';
export type { PlatformAdapter, PlatformDeviceInfo, PlatformNetworkInfo, PlatformPowerState, PlatformOtaProgress, PlatformOtaProgressKind, PlatformKind, PlatformResources, } from './platform-adapter.js';
export { contentRenderers } from './renderers/index.js';
export type { ContentRenderer, ContentItem, ContentType } from './renderers/index.js';
//# sourceMappingURL=index.d.ts.map