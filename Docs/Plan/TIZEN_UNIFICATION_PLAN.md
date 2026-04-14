# Tizen + Tizen-SBB Unification Plan

## Goal

One `apps/tizen` directory producing one `.wgt` that runs on both generations:

| Hardware | Tizen version | SSSP generation |
|---|---|---|
| SBB / SSSP4-6 legacy (2015–2018) | Tizen 2.4 – 4.0 | SSSP4 (Tizen 2.4), SSSP5 (Tizen 3.0), SSSP6 (Tizen 4.0) |
| Modern LFD displays (2019+) | Tizen 5.0 – 7.x | SSSP7 (Tizen 5.0), SSSP8 (Tizen 6.0/6.5/7.x) |

After this merge, `apps/tizen-sbb/` is deleted.

---

## Complete Difference Inventory

### Files that are IDENTICAL (no change needed)
- `js/api.js`
- `js/pairing.js`
- `js/config.js`
- `js/modules/datasync-renderer.js`
- `js/modules/app-updater.js`
- `scripts/generate-build-info.cjs`
- `scripts/update-sssp.js`
- `css/style.css`

### Files that DIFFER (require merge work)

| File | Effort | Summary of difference |
|---|---|---|
| `config.xml` | Low | required_version, viewmodes, privileges, package name |
| `js/content-manager.js` | **High** | Completely different filesystem APIs |
| `js/telemetry.js` | Low | Missing 2s timeout (tizen), missing getFirmware (SBB) |
| `js/tv-control.js` | Low | SBB has extra b2bapis hospitality/b2bControl + capabilities |
| `js/remote-control.js` | Low | SBB has b2bapis.tvinputdevice fallback for key registration |
| `js/app.js` | Low | Hardcoded `'../server.js'` — needs version-aware selection |
| `index.html` | Low | Script order, SBB missing pdf.min.js, different device-info fields |
| `server.js` | Low | SBB version is subset; tizen version is superset — use tizen's |

### SBB-only files to ADD to tizen
- `js/log-viewer.js` — on-screen log browser for field debugging
- `logs.html` — companion HTML page for the log viewer

### Tizen-only files (keep, not in SBB)
- `js/modules/pdf.min.js` + `pdf.worker.min.js` — PDF render support
- `lib/logic.js` — smoke-test for Node runtime (dev/test only, not loaded at runtime)

---

## Step 0 — New File: `js/platform.js` (loaded FIRST)

Create a tiny module that detects the Tizen version once at boot and exposes it globally.
All other modules reference `Platform.isLegacy` instead of sniffing APIs inline.

```js
// js/platform.js — must be the first <script> in index.html
window.Platform = (function() {
  var ver = '0.0';
  try {
    ver = tizen.systeminfo.getCapability(
      'http://tizen.org/feature/platform.version'
    ) || '0.0';
  } catch (e) {}
  var major = parseInt(ver.split('.')[0], 10) || 0;
  return {
    tizenVersion : ver,    // e.g. '4.0.0', '6.5.0'
    tizenMajor   : major,
    isLegacy     : major < 5,   // Tizen ≤4 — old filesystem + b2bapis era
    isModern     : major >= 5,  // Tizen 5+ — new FileSystemManager path API
  };
})();
```

**Why first?** Every downstream module (`content-manager.js`, `app.js`, etc.) may reference
`Platform` at load time, so it must be defined before any other script evaluates.

---

## Step 1 — `config.xml`

| Field | tizen (current) | tizen-sbb | Action |
|---|---|---|---|
| `required_version` | `5.0` | `4.0` | → **`4.0`** (run on all SSSP generations) |
| `viewmodes` | `fullscreen` | `maximized` | → **`maximized`** (safer on older firmware) |
| `screen-orientation` | `auto-rotation` | `landscape` | → **`auto-rotation`** (Tizen 4 silently ignores it; Tizen 5+ respects it) |
| `context-menu` | `disable` | `enable` | → **`disable`** (keep current tizen behaviour) |
| `package / id` | `NexariSignage` | `NexariSignageSBB` | → Keep `NexariSignage.SignagePlayer` |
| Description | `Tizen 5+` | `Tizen 4.0` | → `Samsung Smart TV (Tizen 4+)` |

**Privileges to ADD** (present in SBB, missing from tizen):

```xml
<tizen:privilege name="http://tizen.org/privilege/websetting"/>
<tizen:privilege name="http://developer.samsung.com/privilege/network.softAP"/>
<tizen:privilege name="http://developer.samsung.com/privilege/widgetdata"/>
<tizen:privilege name="http://developer.samsung.com/privilege/was.partner"/>
<tizen:privilege name="http://developer.samsung.com/privilege/b2bdoc"/>
<tizen:privilege name="http://developer.samsung.com/privilege/broadcast"/>
<tizen:privilege name="http://developer.samsung.com/privilege/dpm"/>
<tizen:privilege name="http://developer.samsung.com/privilege/sso"/>
```

The existing tizen privileges (`timer`, `documentplay`, `avplay`, `tv.audio`, `network.public`, `syncplay`, etc.) are kept as-is.

---

## Step 2 — `index.html`

Changes needed:

1. Add `<script src="js/platform.js"></script>` as the **very first** script tag (before `build-info.js` and `config.js`).
2. Add `<script src="js/log-viewer.js"></script>` after `pairing.js`, before `app.js`.
3. `pdf.min.js` stays — if it runs on legacy Tizen 4 hardware without PDF support the player's existing fallback (no-op / skip PDF items) handles it gracefully.
4. Merge the pairing-screen device-info section: keep tizen's `device-serial` and `device-panel` fields (more informative than SBB's `device-tvname` only).

Final script order:
```html
<script src="js/platform.js"></script>      <!-- NEW — must be first -->
<script src="js/build-info.js"></script>
<script src="js/config.js"></script>
<script src="js/api.js"></script>
<script src="js/telemetry.js"></script>
<script src="js/content-manager.js"></script>
<script src="js/tv-control.js"></script>
<script src="js/remote-control.js"></script>
<script src="js/modules/datasync-renderer.js"></script>
<script src="js/modules/app-updater.js"></script>
<script src="js/modules/pdf.min.js"></script>
<script src="js/player.js"></script>
<script src="js/pairing.js"></script>
<script src="js/log-viewer.js"></script>    <!-- NEW — copied from tizen-sbb -->
<script src="js/app.js"></script>
```

---

## Step 3 — `js/content-manager.js` (highest effort)

### The problem

Tizen 4 exposes an **old callback-based File API**:
```js
tizen.filesystem.resolve('wgt-private/content', onSuccess, onError, 'rw');
// dir.createDirectory('html-packages')
// dir.resolve('filename.mp4')        → File object
// file.toURI()                        → 'file://.../name.mp4'
// file.openStream('r', onS, onE)      → FileStream { readBytes, writeBytes }
```

Tizen 5+ removed that API and replaced it with a **path-based FileSystemManager API**:
```js
tizen.filesystem.pathExists('wgt-private/content')
tizen.filesystem.createDirectory(path, recursive, onSuccess, onError)
tizen.filesystem.openFile(path, 'r')  → FileHandle { readData, writeData, seek, close }
tizen.filesystem.toURI(path)          → 'file://.../name.mp4'
```

The current `content-manager.js` in `apps/tizen` uses the modern API throughout.
It cannot run on Tizen 4 as-is.

### Solution: `FsAdapter` internal shim

Add two adapter objects inside `content-manager.js` immediately before the `ContentManager`
definition. At module load time, `Platform.isLegacy` selects which adapter to activate.
`ContentManager` calls only the adapter methods — never the Tizen API directly.

Adapter interface (both implementations must expose these):

| Method | Signature | Notes |
|---|---|---|
| `init(basePath)` | `Promise<void>` | Resolve/create `basePath` and any sub-paths |
| `pathExists(path)` | `boolean` (sync) | Return true if path/file exists |
| `ensureDir(path)` | `Promise<void>` | Create directory (recursive) if needed |
| `readBytes(path)` | `Uint8Array` (sync) | Read full file as bytes |
| `writeBytes(path, bytes)` | `void` (sync) | Overwrite file with bytes |
| `deleteFile(path)` | `Promise<void>` | Delete a file; no-op if missing |
| `listDir(path)` | `string[]` (sync) | Filenames in directory |
| `toUri(path)` | `string` | `'file://...'` URI for a path |
| `fileSize(path)` | `number` (sync) | 0 on error |

The modern adapter (`ModernFsAdapter`) wraps the existing `tizen.filesystem.*` calls already in use.
The legacy adapter (`LegacyFsAdapter`) wraps `tizen.filesystem.resolve()`, `File.resolve()`,
`openStream()`, etc. from the SBB code.

Once both adapters exist, all `ContentManager` methods are updated to call `FsAdapter.*` instead
of `tizen.filesystem.*` directly. The existing compatibility shims (`storageDir.resolve()`,
`_openStreamShim`, etc.) can be removed once all callsites are migrated to the adapter.

### `LARGE_FILE_THRESHOLD`

Runtime-select based on platform (older hardware's XHR stack is less reliable for large files):
```js
LARGE_FILE_THRESHOLD: Platform.isLegacy ? 50 * 1024 * 1024 : 10 * 1024 * 1024,
```

---

## Step 4 — `js/telemetry.js` (small change)

Replace `getPropertyAsync` body in tizen's file with SBB's version (adds 2s safety timeout):

```js
// BEFORE (tizen — no timeout)
getPropertyAsync(property) {
  return new Promise((resolve, reject) => {
    try {
      tizen.systeminfo.getPropertyValue(property, resolve, (error) => {
        logger.warn(`Failed to get ${property}:`, error);
        resolve(null);
      });
    } catch (error) {
      logger.warn(`Exception getting ${property}:`, error);
      resolve(null);
    }
  });
},

// AFTER (merged — with 2s timeout from SBB, safer on old hardware)
getPropertyAsync(property) {
  return new Promise(function(resolve) {
    var timer = setTimeout(function() { resolve(null); }, 2000);
    try {
      tizen.systeminfo.getPropertyValue(
        property,
        function(val) { clearTimeout(timer); resolve(val); },
        function(error) {
          clearTimeout(timer);
          try { logger.warn('Failed to get ' + property + ':', error); } catch(e) {}
          resolve(null);
        }
      );
    } catch (error) {
      clearTimeout(timer);
      try { logger.warn('Exception getting ' + property + ':', error); } catch(e) {}
      resolve(null);
    }
  });
},
```

The `getFirmware()` call already in tizen stays — it's inside a `try/catch` so it silently
no-ops on Tizen 4 hardware where the method doesn't exist.

---

## Step 5 — `js/tv-control.js` (additive — no removal)

Add the SBB handles/capabilities to the existing tizen `tv-control.js`:

In `apis` declaration:
```js
// ADD in apis object:
hospitality: null,
b2bControl:  null,
```

In `init()` — after the existing `this.apis.*` assignments:
```js
// ADD:
this.apis.hospitality = typeof webapis !== 'undefined' && webapis.tv
  ? webapis.tv.hospitality || null : null;
this.apis.b2bControl  = typeof b2bapis !== 'undefined'
  ? b2bapis.b2bcontrol || null : null;

// REPLACE existing tvInputDevice assignment with b2bapis-first fallback:
this.apis.tvInputDevice =
  (typeof b2bapis !== 'undefined' && b2bapis.tvinputdevice)
    ? b2bapis.tvinputdevice
    : (typeof webapis !== 'undefined')
      ? (webapis.tvinputdevice || webapis.tvinputdevice2 || null)
      : null;
```

In `capabilities` declaration:
```js
// ADD:
hospitalityPower: false,
b2bPanelPower:    false,
```

In `init()` — after the existing `this.capabilities.*` assignments:
```js
// ADD:
this.capabilities.hospitalityPower = !!(this.apis.hospitality && (
  typeof this.apis.hospitality.powerOff      === 'function' ||
  typeof this.apis.hospitality.powerOn       === 'function' ||
  typeof this.apis.hospitality.controlPower  === 'function' ||
  typeof this.apis.hospitality.setPowerOn    === 'function'
));
this.capabilities.b2bPanelPower = !!(this.apis.b2bControl);
```

Also add them to `describePowerApis()`:
```js
// ADD in namespaces:
hospitality: !!this.apis.hospitality,
b2bControl:  !!this.apis.b2bControl,
```

---

## Step 6 — `js/remote-control.js` (small change)

In `registerTizenKeys()`, replace the `if (typeof tizen !== 'undefined' && tizen.tvinputdevice)`
block with the SBB fallback chain that checks `b2bapis.tvinputdevice` first (SSSP-era devices
expose `tvinputdevice` under `b2bapis`, not under `tizen`):

```js
// REPLACE:
if (typeof tizen !== 'undefined' && tizen.tvinputdevice) { ... }

// WITH:
const inputDevice =
  (typeof tizen   !== 'undefined' && tizen.tvinputdevice)   ? tizen.tvinputdevice   :
  (typeof b2bapis !== 'undefined' && b2bapis.tvinputdevice) ? b2bapis.tvinputdevice : null;

if (inputDevice) { ... use inputDevice.getSupportedKeys() / inputDevice.registerKey() ... }
```

---

## Step 7 — `js/app.js` — version-aware Node server file

Both apps already have `b2bcontrol.startNodeServer('../server.js', 'mdc-bridge', ...)`.
The `'../server.js'` path works fine for **unsigned development builds**.

For **production signed builds**, Samsung requires each SSSP generation to use a separately
Samsung-signed Node binary. Add a helper and use it:

```js
// Add before the b2bcontrol block:
function pickNodeServerFile() {
  // Unsigned dev fallback (no BUILD_PRODUCTION flag set):
  if (typeof BUILD_PRODUCTION === 'undefined' || !BUILD_PRODUCTION) {
    return '../server.js';
  }
  var v = Platform.tizenMajor;
  if (v <= 2) return '../lib/server2016.js.signed'; // SSSP4
  if (v === 3) return '../lib/server2017.js.signed'; // SSSP5
  if (v === 4) return '../lib/server2018.js.signed'; // SSSP6
  if (v === 5) return '../lib/server2019.js.signed'; // SSSP7
  return '../lib/server2022.js.signed';              // SSSP8+ (Tizen 6.0 / 6.5 / 7.x)
}

// Then update the startNodeServer call:
b2bapis.b2bcontrol.startNodeServer(
  pickNodeServerFile(),
  'mdc-bridge',
  ...
);
```

---

## Step 8 — `server.js` — use tizen's version

tizen's `server.js` is a **superset** of SBB's:
- Has `CMD_CLOCK = 0xA7` extra MDC command
- Has a more complete `/mdc-control` handler
- The `/remote-key` endpoint is identical in both

No changes needed. SBB's `server.js` can be discarded.

---

## Step 9 — `lib/` — signed Node server files (external dependency)

The `lib/` directory in the unified app needs all SSSP-generation–specific signed files:

```
apps/tizen/lib/
  logic.js              ← already present (smoke-test, dev only)
  server2016.js.signed  ← SSSP4  / Tizen 2.4
  server2017.js.signed  ← SSSP5  / Tizen 3.0
  server2018.js.signed  ← SSSP6  / Tizen 4.0
  server2019.js.signed  ← SSSP7  / Tizen 5.0
  server2022.js.signed  ← SSSP8+ / Tizen 6.0+
```

**How to obtain:** These are submitted to and signed by Samsung via the
[Samsung SSSP Developer Portal](https://developer.samsung.com/smarttv/develop/b2b/b2b-app-development.html).
The source for all of them is the same `server.js` MDC bridge file.
Different signing keys are issued per SSSP generation.

`server.js` (unsigned) stays in the project root for development use.

> **Blocker:** Until actual signed files are obtained from Samsung, the app works on
> development hardware with `BUILD_PRODUCTION` unset (falls back to `../server.js`).
> On real production displays, an unsigned `.js` will be rejected by `startNodeServer()`.

---

## Step 10 — Copy log-viewer files from tizen-sbb

Files to copy verbatim:
- `apps/tizen-sbb/js/log-viewer.js` → `apps/tizen/js/log-viewer.js`
- `apps/tizen-sbb/logs.html`        → `apps/tizen/logs.html`

These provide an on-device log browser at `logs.html` for field debugging — especially useful
on legacy hardware where remote debugging isn't available.

---

## Build & Signing

### Single `.wgt` covering both Tizen 4 and 5+

Setting `required_version="4.0"` means the WGT can install on any Tizen ≥ 4.0 device.
Samsung's distributor certificate is issued per-app (not per Tizen version).
One certificate covers all supported generations — no dual-signing required.

### `BUILD_PRODUCTION` flag

Define `BUILD_PRODUCTION = true` in your Tizen IDE build step or in `build-info.js`
(generated by `scripts/generate-build-info.cjs`) so production builds select the
version-appropriate signed server file.

---

## Migration Order (implementation steps)

| # | Task | Risk |
|---|---|---|
| 1 | Create `js/platform.js` | None — new file |
| 2 | Update `config.xml` — lower `required_version`, add privileges, change `viewmodes` | Low — additive |
| 3 | Add `platform.js` and `log-viewer.js` to `index.html`; merge pairing-screen device-info | Low |
| 4 | Update `js/telemetry.js` — add 2s timeout to `getPropertyAsync` | Low |
| 5 | Update `js/tv-control.js` — add b2bapis handles + capabilities | Low — additive |
| 6 | Update `js/remote-control.js` — add b2bapis.tvinputdevice fallback | Low |
| 7 | Merge `js/content-manager.js` — add `FsAdapter`, branch on `Platform.isLegacy` | **High** |
| 8 | Update `js/app.js` — add `pickNodeServerFile()` and use it | Low |
| 9 | Copy `log-viewer.js` + `logs.html` from tizen-sbb | None |
| 10 | Obtain / place signed server files in `lib/` | External dependency |
| 11 | Test on Tizen 5+ hardware (existing behaviour must not regress) | Verify |
| 12 | Test on Tizen 4 (SSSP6) hardware | Verify |
| 13 | Delete `apps/tizen-sbb/` | Irreversible — do last |

---

## Risk Register

| Risk | Mitigation |
|---|---|
| `tizen.filesystem.pathExists` / `openFile` called on Tizen 4 (throws) | `FsAdapter` always dispatches correct call; `Platform.isLegacy` is set at module load before first ContentManager call |
| `b2bcontrol.startNodeServer` rejects unsigned `server.js` on production hardware | `pickNodeServerFile()` returns correct signed path in production; unsigned fallback for dev |
| Single `.wgt` rejected by Tizen 4 cert validation | Use Samsung Partner distributor cert — covers all TV platform generations |
| PDF rendering hangs or crashes on Tizen 4 | `pdf.min.js` is already loaded; if Tizen 4 JavaScript engine can't handle it, player.js should gracefully skip PDF content items |
| `b2bapis` not available on Tizen 5+ (no regression) | All `b2bapis` refs are guarded by `typeof b2bapis !== 'undefined'`; no change in Tizen 5+ behaviour |
| Legacy `storageDir.resolve()` calls in `player.js` break | The `storageDir` shim already in tizen's `content-manager.js` is preserved until player.js is fully migrated to `FsAdapter` |
