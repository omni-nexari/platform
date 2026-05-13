# Player Apps — Security Audit & Remediation

**Scope**: `apps/nexari-tizen`, `apps/nexari-android`, `apps/nexari-windows`, `apps/nexari-epaper`, `apps/player-web`, plus the API and DS pieces they consume.

This document records the audit findings, severity ratings, and the
remediations applied in the migration `0063_player_release_sha256.sql` +
associated app changes.

---

## High Severity

### H1 — OTA installers did not verify a checksum

**Affected**: `apps/nexari-tizen/src/modules/app-updater.ts`,
`apps/nexari-epaper/js/epaper-updater.js`, `apps/player-web/src/player.ts`.

The `AppUpdater.handle()` / `EpaperUpdater.handle()` paths previously
accepted a `checksum` field on the WS message but never compared it to the
downloaded `.wgt`. An attacker who could either (a) compromise the
download host or (b) MITM a cleartext download could swap the installer
without detection, leading to arbitrary code execution on the player
device.

**Fix applied**:

- DB: added `player_releases.sha256` column (migration `0063`).
- API (`/player-releases` POST + deploy): accepts and forwards `sha256`
  to the device as `payload.sha256`.
- DS (`DeviceDetailPage.tsx`): passes `latestRelease.sha256` into the
  `update_player` payload.
- Tizen `app-updater.ts`: after `tizen.download` completes, reads the
  downloaded file via XHR + WebCrypto `crypto.subtle.digest('SHA-256')`
  and aborts the install on mismatch. Emits an `app_update_verifying`
  status so the dashboard reflects the new phase.
- ePaper `epaper-updater.js`: identical SHA-256 check before
  `tizen.package.install`.
- Player-web `player.ts`: the existing `APP_UPDATE` path already forwarded
  `sha256` to `adapter.installUpdate`; a new `update_player` command alias
  was added with the same behaviour for the snake-case command the API
  emits via `sendCommand`.

If the WS message omits `checksum` the install proceeds with a warning
(supports legacy releases until every published release has a sha256).

### H2 — Android WebView served the SPA from `file://` with universal access

**Affected**: `apps/nexari-android/.../PlayerView.kt`.

`s.allowFileAccessFromFileURLs = true` + `s.allowUniversalAccessFromFileURLs = true`
combined with `addJavascriptInterface("AndroidBridge")` meant any HTML
content rendered inside the WebView could access arbitrary files via
`XMLHttpRequest('file:///…')` and cross-origin the API surface. A
single XSS in cached HTML content would have escalated to bridge access.

**Fix applied**: PlayerView migrated to
[`WebViewAssetLoader`](https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader)
serving `assets/web/` at
`https://appassets.androidplatform.net/web/`. Both file-URL flags are now
`false`, `allowFileAccess = false`, and `mixedContentMode =
MIXED_CONTENT_NEVER_ALLOW`. The JS bridge continues to work because
`addJavascriptInterface` is bound to the WebView, not to an origin.

### H4 — Cleartext traffic allowed globally on Android

**Affected**: `apps/nexari-android/.../AndroidManifest.xml`,
`apps/nexari-android/android/app/build.gradle.kts`.

The manifest placeholder `usesCleartextTraffic` was hard-set to `true`
for every flavor (including the `self` / `play` production builds).

**Fix applied**: The placeholder is now `false`; the existing
`res/xml/network_security.xml` (which already restricts cleartext to
the dev LAN hosts `192.168.1.17`, `10.0.2.2`, `localhost`, `127.0.0.1`)
is the single source of truth. Production traffic to `ds.chiho.app` is
HTTPS-only with no opt-out.

### M5 — Mixed content allowed on Android WebView

Folded into H2; `MIXED_CONTENT_NEVER_ALLOW` is now in force because the
SPA is hosted on an `https://` origin.

---

## Medium Severity

### M2 — Windows Electron CSP was too permissive

**Affected**: `apps/nexari-windows/src/main/main.ts`.

`script-src 'self' file: blob: 'unsafe-inline'` plus
`connect-src * ws: wss:` plus `frame-src *` allowed inline scripts and
fetches to arbitrary hosts.

**Fix applied**: `'unsafe-inline'` removed from `script-src` (Vite emits
external scripts). `connect-src` is now derived at session-init time
from the persisted `apiBase` (e.g. `https://ds.chiho.app` →
`wss://ds.chiho.app`), plus `https://ds.chiho.app` / `wss://ds.chiho.app`
as a hard-coded fall-back so post-CSP re-pairing still works, plus
`localhost:*` for HMR / Electron tooling. Added `object-src 'none'` and
`base-uri 'self'`. `frame-src *` is retained on purpose because user
content includes arbitrary HTML5 / dashboard iframes.

### M4 — Updaters accepted any absolute URL

**Affected**: every player updater.

`resolveUrl()` accepted any `http(s)://` URL with no host restriction.
A compromised CMS account could push a download URL pointing at an
attacker-controlled host.

**Fix applied**: Each updater now enforces an `UPDATE_HOST_ALLOWLIST`
of `['ds.chiho.app', 'updates.chiho.app']`. Player-web exports
`isAllowedUpdateUrl()` and checks it in both `APP_UPDATE` and
`update_player` paths. Tizen + ePaper updaters reject the install
before download with `app_update_failed { error: 'Download URL host not allowed' }`.

---

## Low Severity

### L1 — `document.write` in Tizen `index.html`

Used to load the right PDF.js build for the Tizen version. The `src`
value was hard-coded to one of two literals, so there was no XSS path,
but `document.write` is a footgun and trips lint/CSP audits.

**Fix applied**: Replaced with `document.createElement('script')` +
`appendChild` + a strict whitelist guard that rejects any value other
than the two literal paths. `script.async = false` preserves order
relative to other dynamically inserted scripts; PDF.js itself is invoked
lazily by the renderer so its load order vs. later `<script>` tags is
not critical.

### L2 — Hard-coded dev API base in `html5-sync`

`apps/nexari-html5-sync/src/sync.ts` contains a hard-coded
`http://192.168.1.17/api/v1/...` URL for sync content. This is only
referenced during sync-engine development and never deployed to
customer-facing players. Left as-is, but tracked here for visibility —
will be replaced when the html5-sync prototype is folded into
player-web.

### L4 — WS URL with `?token=…` was logged

**Affected**: `apps/nexari-tizen/src/player.ts` (line ~390),
`apps/player-web/src/player.ts`.

`logger.info('Connecting to WebSocket:', wsUrl)` leaked the device token
into the OSD log overlay and any persisted log files.

**Fix applied**: New `redactUrl(url)` helper in both apps strips
`token`, `access_token`, `auth`, `apiKey`, and `api_key` query
parameters before logging. The Tizen connect site was migrated to
`logger.info('Connecting to WebSocket:', redactUrl(wsUrl))`; the helper
is exported from player-web for future log sites.

---

## Outstanding / Tracked

- **H3 — innerHTML sink audit**: `apps/player-web/src/renderers/menu-board.ts`
  was reviewed and is correctly escaped via `escapeHtml`. The remaining
  innerHTML sites in `apps/nexari-windows/src/renderer/player.ts` and
  `apps/nexari-tizen/src/player.ts` use template literals that
  interpolate API-sourced content; an end-to-end audit pass is still
  required before this can be closed out.
- **Android 10-tap settings overlay**: Tracked separately from this
  audit. The capture-phase tap handler is documented in the prior
  conversation and should be added to
  `apps/player-web/src/player.ts:initAndroidSettingsTap` when the
  settings overlay work resumes.
