<#
.SYNOPSIS
    Deploy Nexari ESP32 firmware to production (platform.nexari.ca).

.DESCRIPTION
    Bumps the patch version in package.json, builds the nexari-esp32-prod
    PlatformIO environment, and uploads to the connected device.

.PARAMETER Port
    Serial port to use (e.g. COM5). If omitted, PlatformIO auto-detects.

.PARAMETER NoBuild
    Skip build+version bump; only re-upload the last build artifact.

.PARAMETER NoBump
    Skip the version bump but still build and upload.

.EXAMPLE
    .\tools\deploy-esp32.ps1
    .\tools\deploy-esp32.ps1 -Port COM5
    .\tools\deploy-esp32.ps1 -NoBuild -Port COM5
    .\tools\deploy-esp32.ps1 -NoBump
#>
param(
    [string]$Port    = '',
    [switch]$NoBuild,
    [switch]$NoBump
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$rootDir   = Split-Path -Parent $PSScriptRoot
$appDir    = Join-Path $rootDir 'apps\nexari-esp32'
$pkgJson   = Join-Path $appDir 'package.json'
$envName   = 'nexari-esp32-prod'

if (-not (Test-Path $appDir)) {
    Write-Error "App directory not found: $appDir"
    exit 1
}

Push-Location $appDir
try {
    Write-Host "==> Nexari ESP32 -- PROD deploy ($envName)" -ForegroundColor Cyan

    if (-not $NoBuild -and -not $NoBump) {
        if (Test-Path $pkgJson) {
            $pkg = Get-Content $pkgJson -Raw | ConvertFrom-Json
            $parts = $pkg.version -split '\.'
            $parts[2] = [string]([int]$parts[2] + 1)
            $pkg.version = $parts -join '.'
            $pkg | ConvertTo-Json -Depth 10 | Set-Content $pkgJson -Encoding UTF8
            Write-Host "==> Version bumped to $($pkg.version)" -ForegroundColor Green
        } else {
            Write-Warning "package.json not found at $pkgJson -- skipping version bump"
        }
    }

    $pioArgs = @('-e', $envName)
    if ($Port -ne '') { $pioArgs += @('--upload-port', $Port) }

    if (-not $NoBuild) {
        Write-Host '==> Building (prod)...' -ForegroundColor Yellow
        & pio run @pioArgs
        if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE)" }
    }

    Write-Host '==> Uploading to device...' -ForegroundColor Yellow
    $uploadArgs = $pioArgs + @('-t', 'upload')
    & pio run @uploadArgs
    if ($LASTEXITCODE -ne 0) { throw "Upload failed (exit $LASTEXITCODE)" }

    Write-Host '==> Production deploy complete!' -ForegroundColor Green
}
finally {
    Pop-Location
}