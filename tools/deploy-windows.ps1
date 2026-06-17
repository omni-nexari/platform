#Requires -Version 5.1
<#
.SYNOPSIS
    Build the nexari-windows Electron app (prod flavor) and upload the NSIS
    installer + latest.yml to the Pi, then optionally publish a release record
    to the DS portal.

.DESCRIPTION
    Mirrors deploy-tizen.ps1 / deploy-android.ps1 for the Windows player.

    1. Builds @signage/player-web.
    2. Runs pnpm package (electron-builder NSIS --win --x64).
    3. Uploads nexari-windows-{version}-setup.exe + latest.yml to the Pi at
       /var/signage/windows/.
    4. Optionally publishes a player_releases record to the DS API.

.EXAMPLE
    .\tools\deploy-windows.ps1 -PiHost 192.168.1.17
    .\tools\deploy-windows.ps1 -PiHost 192.168.1.17 -SuperadminEmail chiho.lee23@gmail.com -SuperadminPassword q1w2e3r4
    .\tools\deploy-windows.ps1 -PiHost 192.168.1.17 -SkipBuild   # upload existing installer
    .\tools\deploy-windows.ps1 -PiHost 192.168.1.17 -NoUpload    # build only, skip Pi SCP
#>
param(
    [string]$PiHost  = "192.168.1.17",
    [string]$PiUser  = "chiho",
    [int]$SshPort    = 5551,

    [switch]$SkipBuild,
    # -Upload to push to the old /var/signage/windows path (legacy, not normally needed)
    [switch]$Upload,

    [string]$PlayerApiBase = "https://platform.nexari.ca/api/v1"
)

$ErrorActionPreference = "Stop"

$RepoRoot  = Split-Path -Parent $PSScriptRoot
$AppDir    = Join-Path $RepoRoot "apps\nexari-windows"
$ReleaseDir = Join-Path $AppDir "release"

# --- Build ---
if (-not $SkipBuild) {
    # Step 1: player-web bundle (Windows renderer reuses it)
    Write-Host ""
    Write-Host "=== Step 1: Build @signage/player-web ===" -ForegroundColor Cyan
    Push-Location $RepoRoot
    try {
        pnpm --filter "@signage/player-web" build
        if ($LASTEXITCODE -ne 0) { throw "player-web build failed" }
    } finally { Pop-Location }

    # Step 2: bump patch version
    Write-Host ""
    Write-Host "=== Step 2: Bump patch version ===" -ForegroundColor Cyan
    Push-Location $AppDir
    try {
        npm version patch --no-git-tag-version
        if ($LASTEXITCODE -ne 0) { throw "npm version patch failed" }
    } finally { Pop-Location }

    $newVersion = (Get-Content "$AppDir\package.json" -Raw | ConvertFrom-Json).version
    Write-Host "Version: $newVersion"

    # Step 3: electron-builder NSIS installer
    Write-Host ""
    Write-Host "=== Step 3: electron-builder --win --x64 ===" -ForegroundColor Cyan
    Push-Location $AppDir
    try {
        $previousPlayerApiBase = $env:NEXARI_PLAYER_API_BASE
        if ($PlayerApiBase -ne "") {
            $env:NEXARI_PLAYER_API_BASE = $PlayerApiBase.Trim().TrimEnd('/')
            Write-Host "Player default API base: $($env:NEXARI_PLAYER_API_BASE)" -ForegroundColor DarkGray
        }
        pnpm run package
        if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
    } finally {
        if ($null -ne $previousPlayerApiBase) {
            $env:NEXARI_PLAYER_API_BASE = $previousPlayerApiBase
        } else {
            Remove-Item Env:NEXARI_PLAYER_API_BASE -ErrorAction SilentlyContinue
        }
        Pop-Location
    }
} else {
    Write-Host "=== -SkipBuild: using existing installer in $ReleaseDir ===" -ForegroundColor DarkGray
}

$newVersion = (Get-Content "$AppDir\package.json" -Raw | ConvertFrom-Json).version

# Locate the installer
$InstallerPath = Get-ChildItem $ReleaseDir -Filter "nexari-windows-*-setup.exe" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName

if (-not $InstallerPath) {
    Write-Error "Installer not found in $ReleaseDir - run without -SkipBuild first."
    exit 1
}

# latest.yml is written by electron-builder for auto-updater
$LatestYmlPath = Join-Path $ReleaseDir "latest.yml"

$sizeMB = [math]::Round((Get-Item $InstallerPath).Length / 1MB, 1)
Write-Host ""
Write-Host "Installer: $InstallerPath  ($sizeMB MB)"

# --- Legacy upload to /var/signage/windows (only when -Upload is passed) ---
if ($Upload) {
    Write-Host ""
    Write-Host "=== Uploading installer to Pi (legacy path) ===" -ForegroundColor Cyan

    $RemoteDir = "/var/signage/windows"
    $SshTarget = "$PiUser@$PiHost"
    $sshPortArgs = @("-p", $SshPort)

    ssh @sshPortArgs $SshTarget "sudo mkdir -p '$RemoteDir' && sudo chown '${PiUser}:${PiUser}' '$RemoteDir'"
    scp -P $SshPort "$InstallerPath" "${SshTarget}:${RemoteDir}/nexari-windows-setup.exe"
    if (Test-Path $LatestYmlPath) {
        scp -P $SshPort "$LatestYmlPath" "${SshTarget}:${RemoteDir}/latest.yml"
    }
    Write-Host "Upload complete." -ForegroundColor Green
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  nexari-windows  $newVersion  build complete"      -ForegroundColor Green
Write-Host "  Installer: $InstallerPath"                        -ForegroundColor Green
Write-Host ""
Write-Host "  To register for a partner:"                       -ForegroundColor Cyan
Write-Host "  .\tools\build-partner-players.ps1 -Platform windows" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Green

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  nexari-windows  $newVersion  PROD build complete" -ForegroundColor Green
Write-Host "  Installer: $InstallerPath" -ForegroundColor Green
Write-Host "  OTA URL:   https://platform.nexari.ca/windows/nexari-windows-setup.exe" -ForegroundColor Green
Write-Host "  Auto-upd:  https://platform.nexari.ca/windows/latest.yml" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
