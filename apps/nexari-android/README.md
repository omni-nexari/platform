# Nexari Signage — Android Player

Native Android shell that hosts a single full-screen `WebView` running the
shared [`@signage/player-web`](../player-web/README.md) bundle. The WebView
is the player. The Kotlin code only exposes OS-level capabilities to the
bundle through a `PlatformAdapter` JS bridge.

## Targets

| Target           | Distribution                      | Min SDK |
|------------------|------------------------------------|---------|
| Android phones   | Google Play (or sideload)          | 24      |
| Android tablets  | Google Play / Managed Play         | 24      |
| Android TV       | Google Play TV                     | 24      |
| Fire TV          | Self-hosted APK + in-app OTA       | 24      |

## Layout

```
apps/nexari-android/
├── package.json              # pnpm workspace entry, glue scripts
├── scripts/
│   ├── sync-player-web.cjs   # copies @signage/player-web/dist into android/app/src/main/assets/web
│   └── sync-version.cjs      # mirrors package.json → app/build.gradle.kts versionName
├── android/                  # Gradle project (Kotlin DSL)
│   ├── settings.gradle.kts
│   ├── build.gradle.kts
│   ├── gradle.properties
│   └── app/
│       ├── build.gradle.kts
│       ├── proguard-rules.pro
│       └── src/main/
│           ├── AndroidManifest.xml
│           ├── res/
│           │   ├── values/strings.xml
│           │   ├── values/themes.xml
│           │   └── xml/
│           │       ├── device_admin.xml         # DPC config for Device Owner
│           │       └── network_security.xml
│           ├── assets/web/                      # @signage/player-web bundle (synced)
│           └── kotlin/app/chiho/nexari/
│               ├── MainActivity.kt              # WebView host
│               ├── PlayerView.kt                # full-screen WebView wrapper
│               ├── PlatformBridge.kt            # @JavascriptInterface impl of PlatformAdapter
│               ├── boot/BootReceiver.kt         # autorestart on power
│               ├── kiosk/DeviceAdminReceiver.kt # DPC entry point
│               ├── kiosk/KioskController.kt     # lock-task, restrictions
│               ├── ota/OtaInstaller.kt          # DownloadManager + PackageInstaller
│               ├── ota/UpdateChecker.kt         # polls /android/update.json
│               ├── system/Audio.kt              # AudioManager wrapper
│               ├── system/Brightness.kt         # SCREEN_BRIGHTNESS settings
│               ├── system/Power.kt              # DPC reboot / lockNow
│               ├── system/Screenshot.kt         # PixelCopy → JPEG
│               └── system/DeviceInfo.kt         # Build / WifiManager / BatteryManager
```

## Build

```sh
pnpm --filter @signage/player-web build
pnpm --filter nexari-android build:debug
# APK at apps/nexari-android/android/app/build/outputs/apk/debug/app-debug.apk
```

## Device Owner provisioning

Generate a QR code containing the JSON in
`docs/dpc-provisioning.json` and serve it from
`https://ds.chiho.app/android/dpc-provisioning.json`. On a factory-reset
device, tap the welcome screen 6× → scan QR → device enrols with our DPC
and silently installs the latest APK.

## Auto-update flow

1. On boot and every 6 h the player checks `https://ds.chiho.app/android/update.json`.
2. If a newer version is published the player emits `app_update_downloading`
   over the existing API WebSocket and uses Android `DownloadManager` to fetch
   the APK, verifying SHA-256.
3. With Device Owner permission `PackageInstaller` installs silently and the
   app relaunches. Without DPC the user sees the standard install dialog.
4. Play Store builds short-circuit this path — the store handles updates.

The protocol mirrors [`apps/nexari-epaper/js/epaper-updater.js`](../nexari-epaper/js/epaper-updater.js)
exactly so the API/portal need no changes for Android OTA reporting.
