# install-android-dev.ps1 -- Build devDebug APK and sideload onto a USB-connected phone.
# Mirrors install-nexari2.ps1 (Tizen dev script) for the Android player.
#
# API base: http://192.168.1.17/api/v1  (dev flavor, via nginx)
# Requires: JDK 17, Node.js, pnpm, USB cable, USB debugging enabled on phone.
#
# Usage:
#   .\tools\install-android-dev.ps1
#   .\tools\install-android-dev.ps1 -SkipBuild           # re-install existing APK
#   .\tools\install-android-dev.ps1 -OpenLogcat           # tail logs after install
#   .\tools\install-android-dev.ps1 -Device "R5CT10XXXXX" # target specific device

param(
    [switch]$SkipBuild,
    [switch]$OpenLogcat,
    [string]$Device = ""
)

$ErrorActionPreference = "Stop"

$RepoRoot    = Split-Path -Parent $PSScriptRoot
$AppDir      = Join-Path $RepoRoot "apps\nexari-android"
$AndroidDir  = Join-Path $AppDir "android"
$AdbPath     = "C:\Users\chiho\Projects\Platform\Docs\Android\platform-tools\adb.exe"
$ApkPath     = Join-Path $AndroidDir "app\build\outputs\apk\dev\debug\app-dev-debug.apk"
$PackageName = "app.chiho.nexari"

# --- Validate prerequisites ---
if (-not (Test-Path $AdbPath)) {
    Write-Error "ADB not found at $AdbPath"
    exit 1
}

$java = Get-Command java -ErrorAction SilentlyContinue
if (-not $java) {
    Write-Error "Java not found on PATH. Install JDK 17 and add it to PATH."
    exit 1
}

$adbArgs = if ($Device) { @("-s", $Device) } else { @() }

function Invoke-Adb {
    param([string[]]$AdbArgList)
    & $AdbPath @adbArgs @AdbArgList
    if ($LASTEXITCODE -ne 0) { throw "adb $($AdbArgList -join ' ') failed (exit $LASTEXITCODE)" }
}

function Ensure-GradleWrapper {
    param([string]$Dir)
    $jar = "$Dir\gradle\wrapper\gradle-wrapper.jar"
    if (-not (Test-Path $jar)) {
        Write-Host "Downloading gradle-wrapper.jar..."
        New-Item -ItemType Directory -Force -Path "$Dir\gradle\wrapper" | Out-Null
        Invoke-WebRequest -Uri "https://raw.githubusercontent.com/gradle/gradle/v8.8.0/gradle/wrapper/gradle-wrapper.jar" `
            -OutFile $jar -UseBasicParsing
        Write-Host "gradle-wrapper.jar downloaded."
    }
}

# --- Check device connected ---
Write-Host ""
Write-Host "=== Checking ADB device ==="
$connectedDevices = & $AdbPath devices 2>&1 | Select-String "device$"
if (-not $connectedDevices) {
    Write-Error "No ADB device found. Connect your phone via USB and enable USB debugging."
    exit 1
}
Write-Host $connectedDevices

if (-not $SkipBuild) {
    # --- Step 1: Build player-web bundle ---
    Write-Host ""
    Write-Host "=== Step 1: Build @signage/player-web ==="
    Push-Location $RepoRoot
    try {
        pnpm --filter "@signage/player-web" build
        if ($LASTEXITCODE -ne 0) { throw "player-web build failed" }
    } finally { Pop-Location }

    # --- Step 2: Sync bundle into Android assets ---
    Write-Host ""
    Write-Host "=== Step 2: Sync bundle into Android assets ==="
    Push-Location $AppDir
    try {
        node scripts/sync-player-web.cjs
        if ($LASTEXITCODE -ne 0) { throw "sync-player-web failed" }
    } finally { Pop-Location }

    # --- Step 3: Gradle assembleDevDebug ---
    Write-Host ""
    Write-Host "=== Step 3: Gradle assembleDevDebug ==="
    Ensure-GradleWrapper $AndroidDir
    Push-Location $AndroidDir
    try {
        .\gradlew.bat assembleDevDebug
        if ($LASTEXITCODE -ne 0) { throw "Gradle assembleDevDebug failed" }
    } finally { Pop-Location }
} else {
    Write-Host "=== -SkipBuild: using existing APK at $ApkPath ==="
}

if (-not (Test-Path $ApkPath)) {
    Write-Error "APK not found: $ApkPath -- run without -SkipBuild first."
    exit 1
}

$apkSizeMB = [math]::Round((Get-Item $ApkPath).Length / 1MB, 1)
Write-Host ""
Write-Host "APK: $ApkPath  ($apkSizeMB MB)"

# --- Step 4: Install APK ---
Write-Host ""
Write-Host "=== Step 4: Install APK via ADB ==="
Invoke-Adb @("install", "-r", "-d", $ApkPath)
Write-Host "Install successful."

# --- Step 5: Launch app ---
Write-Host ""
Write-Host "=== Step 5: Launch $PackageName ==="
Invoke-Adb @("shell", "am", "start", "-n", "$PackageName/.MainActivity")

Write-Host ""
Write-Host "Done! The Nexari Android dev build is running on your device."
Write-Host "  API base : http://192.168.1.17/api/v1"
Write-Host "  WS base  : ws://192.168.1.17"
Write-Host ""
Write-Host "Chrome DevTools remote debugging:"
Write-Host "  Open chrome://inspect/#devices in Chrome on this PC."
Write-Host ""

# --- Optional: tail logcat ---
if ($OpenLogcat) {
    Write-Host "=== Tailing logcat (Ctrl+C to stop) ==="
    Invoke-Adb @("logcat", "-s", "Nexari,chromium,WebView")
}
