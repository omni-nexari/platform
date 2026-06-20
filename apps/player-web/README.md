# @signage/player-web

Shared signage player bundle. Hosted by native shells that expose a
`PlatformAdapter` (Android WebView, Windows Electron — out of scope here,
future Linux/web).

## What's in here

- **`PlatformAdapter`** — the contract a host shell must implement (power,
  volume, screenshot, OTA install, kiosk lock, network info, brightness).
  This is the new, important artifact.
- **`sync/`** — group sync protocol (NTP-style PING/PONG, leader election,
  LOAD_URL/READY/GO/LOOP_GO barrier). Mirrors `nexari-html5-sync/src/sync.ts`.
- **`engine/`** — A/B `<video>` swap engine + canvas-crop videowall renderer.
  Mirrors `nexari-html5-sync/src/engine.ts`.
- **`Player`** — top-level orchestrator: connects WS to API
  (`/api/v1/devices/ws/:deviceId`), dispatches device commands through the
  adapter, and renders content by type.
- **`renderers/`** — per content-type DOM renderers (video / image / html /
  iframe). Calendar / RSS / weather / POS / ticker / DataSync renderers are
  **not yet ported** from `nexari-tizen/src/player.ts` — see _Porting status_.

## Porting status

The Tizen player at `apps/nexari-tizen/src/player.ts` (~7k LOC) and its
sibling JS modules under `apps/nexari-tizen/js/` are the reference
implementation. Phase 0 of the Android plan ports them into platform-agnostic
modules here, gated behind the `PlatformAdapter` interface.

| Module                    | Status        | Source of truth                                              |
|---------------------------|---------------|--------------------------------------------------------------|
| `PlatformAdapter` types   | ✅ done       | new artefact                                                  |
| Sync engine               | ⏳ skeleton   | `apps/nexari-html5-sync/src/sync.ts` (verbatim port pending)  |
| A/B video engine          | ⏳ skeleton   | `apps/nexari-html5-sync/src/engine.ts` (verbatim port pending)|
| Logger / log relay        | ⏳ skeleton   | `apps/nexari-html5-sync/src/logger.ts`                        |
| WS command dispatcher     | ⏳ skeleton   | `apps/nexari-tizen/src/player.ts:430-800`                     |
| Content type: VIDEO       | ⏳ skeleton   | tizen player switch on `type === 'VIDEO'`                     |
| Content type: IMAGE       | ⏳ skeleton   | tizen player switch on `type === 'IMAGE'`                     |
| Content type: HTML        | ⏳ skeleton   | tizen player switch on `type === 'HTML'`                      |
| Content type: CANVAS      | ❌ TODO       | tizen player switch on `type === 'CANVAS'`                    |
| Calendar widget           | ❌ TODO       | `apps/nexari-tizen/js/modules/calendar*.js`                   |
| RSS / weather / ticker    | ❌ TODO       | `apps/nexari-tizen/js/modules/`                               |
| POS menu / DataSync       | ❌ TODO       | `apps/nexari-tizen/js/modules/data-sync-renderer.js`          |
| Videowall integration     | ⏳ skeleton   | `apps/nexari-tizen/src/player.ts` `VIDEOWALL_INIT` handler    |
| OTA app update            | ⏳ skeleton   | `apps/nexari-epaper/js/epaper-updater.js` (Android port)      |

The skeletons compile and run; they delegate the unimplemented surface back
to the host via `PlatformAdapter` so an Android shell can boot, pair, render
the first content type, and stream screenshots while the remaining renderers
are ported in subsequent commits.

## Usage (host shell)

```ts
import { Player, type PlatformAdapter } from '@signage/player-web';

const adapter: PlatformAdapter = createAndroidAdapter(); // implemented in Kotlin via @JavascriptInterface
const player = new Player({
  apiBase:   'https://your-platform.example.com/api/v1',
  wsBase:    'wss://your-platform.example.com',
  adapter,
  container: document.getElementById('player-root')!,
});
await player.start();
```
