#Requires -Version 5.1
<#
.SYNOPSIS
    Build the nexari-android app (self/prod flavor) and optionally install it
    via ADB and publish an OTA release record to the DS portal.

.DESCRIPTION
    Mirrors deploy-tizen.ps1 for the Android player.

    1. Builds @signage/player-web.
    2. Syncs the bundle into Android assets.
    3. Runs Gradle assembleSelfRelease (prod API: https://ds.chiho.app).
    4. Optionally installs the APK on a USB-connected device via ADB.
    5. Optionally publishes an OTA release record to the DS API.

.EXAMPLE
    .\tools\deploy-android.ps1
    .\tools\deploy-android.ps1 -Install
    .\tools\deploy-android.ps1 -Install -SuperadminEmail chiho.lee23@gmail.com -SuperadminPassword q1w2e3r4
    .\tools\deploy-android.ps1 -Install -SkipBuild
#>
param(
    [switch]$Install,
    [switch]$SkipBuild,
    [string]$Device = "",

    [string]$SuperadminEmail = "",
    [string]$SuperadminPassword = "",
    [string]$ApiBase = "https://ds.chiho.app/api/v1",
    [string]$ReleaseNotes = "",
    [string]$OtaUrl = "https://ds.chiho.app/android/nexari-android.apk"
)

$ErrorActionPreference = "Stop"

$RepoRoot    = Split-Path -Parent $PSScriptRoot
$AppDir      = Join-Path $RepoRoot "apps\nexari-android"
$AndroidDir  = Join-Path $AppDir "android"
$AdbPath     = "C:\Users\chiho\Projects\Platform\Docs\Android\platform-tools\adb.exe"
$ApkPath     = Join-Path $AndroidDir "app\build\outputs\apk\self\release\app-self-release.apk"
$PackageName = "app.chiho.nexari"

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

# --- Build ---
if (-not $SkipBuild) {
    # Step 1: player-web bundle
    Write-Host ""
    Write-Host "=== Step 1: Build @signage/player-web ==="
    Push-Location $RepoRoot
    try {
        pnpm --filter "@signage/player-web" build
        if ($LASTEXITCODE -ne 0) { throw "player-web build failed" }
    } finally { Pop-Location }

    # Step 2: sync assets
    Write-Host ""
    Write-Host "=== Step 2: Sync bundle into Android assets ==="
    Push-Location $AppDir
    try {
        node scripts/sync-player-web.cjs
        if ($LASTEXITCODE -ne 0) { throw "sync-player-web failed" }
    } finally { Pop-Location }

    # Step 3: bump patch version
    Write-Host ""
    Write-Host "=== Step 3: Bump patch version ==="
    Push-Location $AppDir
    try {
        npm version patch --no-git-tag-version
        if ($LASTEXITCODE -ne 0) { throw "npm version patch failed" }
    } finally { Pop-Location }

    $newVersion = (Get-Content "$AppDir\package.json" -Raw | ConvertFrom-Json).version
    Write-Host "Version: $newVersion"

    # Propagate versionCode + versionName into build.gradle.kts
    $parts = $newVersion -split '\.'
    $vCode = [int]$parts[0] * 10000 + [int]$parts[1] * 100 + [int]$parts[2]
    $gradleFile = "$AndroidDir\app\build.gradle.kts"
    $gradleContent = Get-Content $gradleFile -Raw
    $gradleContent = $gradleContent -replace '(versionCode\s*=\s*)\d+', "`${1}$vCode"
    $gradleContent = $gradleContent -replace '(versionName\s*=\s*)"[^"]+"', "`${1}`"$newVersion`""
    Set-Content $gradleFile $gradleContent -Encoding UTF8
    Write-Host "Updated build.gradle.kts -- versionCode=$vCode versionName=$newVersion"

    # Step 4: Gradle assembleSelfRelease
    Write-Host ""
    Write-Host "=== Step 4: Gradle assembleSelfRelease ==="
    Ensure-GradleWrapper $AndroidDir
    Push-Location $AndroidDir
    try {
        .\gradlew.bat assembleSelfRelease
        if ($LASTEXITCODE -ne 0) { throw "Gradle assembleSelfRelease failed" }
    } finally { Pop-Location }
} else {
    Write-Host "=== -SkipBuild: using existing APK at $ApkPath ==="
    $newVersion = (Get-Content "$AppDir\package.json" -Raw | ConvertFrom-Json).version
}

if (-not (Test-Path $ApkPath)) {
    Write-Error "APK not found: $ApkPath"
    exit 1
}

$apkSizeMB = [math]::Round((Get-Item $ApkPath).Length / 1MB, 1)
Write-Host ""
Write-Host "APK: $ApkPath  ($apkSizeMB MB)"

# --- Install (optional) ---
if ($Install) {
    if (-not (Test-Path $AdbPath)) { Write-Error "ADB not found at $AdbPath"; exit 1 }
    $connectedDevices = & $AdbPath devices 2>&1 | Select-String "device$"
    if (-not $connectedDevices) { Write-Error "No ADB device found. Connect phone and enable USB debugging."; exit 1 }

    Write-Host ""
    Write-Host "=== Installing APK via ADB ==="
    Invoke-Adb @("install", "-r", $ApkPath)
    Write-Host "Install successful."

    Write-Host ""
    Write-Host "=== Launching $PackageName ==="
    Invoke-Adb @("shell", "am", "start", "-n", "$PackageName/.MainActivity")
}

# --- Publish OTA release (optional) ---
if ($SuperadminEmail -ne "" -and $SuperadminPassword -ne "") {
    Write-Host ""
    Write-Host "=== Publishing OTA release to DS API ==="

    $loginBody = @{ email = $SuperadminEmail; password = $SuperadminPassword } | ConvertTo-Json
    $loginResp = Invoke-RestMethod -Method Post `
        -Uri "$ApiBase/auth/login" `
        -ContentType "application/json" `
        -Body $loginBody
    $token = $loginResp.token
    if (-not $token) { Write-Error "Login failed -- check credentials."; exit 1 }
    Write-Host "Logged in as $SuperadminEmail"

    $releaseBody = @{
        platform     = "android"
        version      = $newVersion
        packageId    = $PackageName
        downloadUrl  = $OtaUrl
        releaseNotes = $ReleaseNotes
        mandatory    = $false
    } | ConvertTo-Json
    $headers = @{ Authorization = "Bearer $token" }

    try {
        $releaseResp = Invoke-RestMethod -Method Post `
            -Uri "$ApiBase/admin/player-releases" `
            -ContentType "application/json" `
            -Headers $headers `
            -Body $releaseBody
        Write-Host "Release published: id=$($releaseResp.id) version=$newVersion"
    } catch {
        Write-Warning "Release publish failed: $_"
    }
}

Write-Host ""
Write-Host "=================================================="
Write-Host "  nexari-android  $newVersion  PROD build complete"
Write-Host "  APK: $ApkPath"
if ($OtaUrl) { Write-Host "  OTA URL: $OtaUrl" }
Write-Host "=================================================="
Write-Host ""
Write-Host "Next step -- upload APK to OTA endpoint:"
Write-Host "  scp `"$ApkPath`" chiho@192.168.1.17:/var/signage/android/nexari-android.apk"
