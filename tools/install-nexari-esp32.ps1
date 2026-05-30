<#
.SYNOPSIS
    Flash Nexari ESP32 firmware (dev environment, LAN server).

.DESCRIPTION
    Builds and uploads the nexari-esp32-dev PlatformIO environment.
    Optionally opens the serial monitor after flashing.

.PARAMETER Port
    Serial port to use (e.g. COM5). If omitted, PlatformIO auto-detects.

.PARAMETER NoBuild
    Skip the build step and only upload (requires a prior successful build).

.PARAMETER Monitor
    Open serial monitor after upload (Ctrl+C to exit).

.EXAMPLE
    .\tools\install-nexari-esp32.ps1
    .\tools\install-nexari-esp32.ps1 -Port COM5 -Monitor
    .\tools\install-nexari-esp32.ps1 -NoBuild -Port COM5
#>
param(
    [string]$Port    = '',
    [switch]$NoBuild,
    [switch]$Monitor
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$rootDir = Split-Path -Parent $PSScriptRoot
$appDir  = Join-Path $rootDir 'apps\nexari-esp32'
$envName = 'nexari-esp32-dev'

if (-not (Test-Path $appDir)) {
    Write-Error "App directory not found: $appDir"
    exit 1
}

Push-Location $appDir
try {
    Write-Host "==> Nexari ESP32 -- DEV flash ($envName)" -ForegroundColor Cyan

    $pioArgs = @('-e', $envName)
    if ($Port -ne '') { $pioArgs += @('--upload-port', $Port) }

    if (-not $NoBuild) {
        Write-Host '==> Building...' -ForegroundColor Yellow
        & pio run @pioArgs
        if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE)" }
    }

    Write-Host '==> Uploading...' -ForegroundColor Yellow
    $uploadArgs = $pioArgs + @('-t', 'upload')
    & pio run @uploadArgs
    if ($LASTEXITCODE -ne 0) { throw "Upload failed (exit $LASTEXITCODE)" }

    Write-Host '==> Upload complete!' -ForegroundColor Green

    if ($Monitor) {
        $monArgs = @('-e', $envName, '-t', 'monitor')
        if ($Port -ne '') { $monArgs += @('--upload-port', $Port) }
        Write-Host '==> Opening serial monitor (Ctrl+C to exit)...' -ForegroundColor Cyan
        & pio run @monArgs
    }
}
finally {
    Pop-Location
}