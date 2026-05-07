# deploy-epaper.ps1 — Install the e-paper .wgt onto a connected Tizen e-paper device via sdb.
# Usage: .\tools\deploy-epaper.ps1 -DeviceIp 192.168.1.50
param(
    [Parameter(Mandatory = $true)]
    [string]$DeviceIp,
    [string]$SdbPath = "C:\tizen-studio\tools\sdb.exe",
    [string]$TizenCli = "C:\tizen-studio\tools\ide\bin\tizen.bat",
    [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$WgtPath  = Join-Path $RepoRoot "apps\nexari-epaper\NexariEpaper.wgt"

if (-not $NoBuild) {
    Write-Host "==> Generating build-info..." -ForegroundColor Cyan
    Push-Location (Join-Path $RepoRoot "apps\nexari-epaper")
    try {
        & node scripts/generate-build-info.cjs
        if ($LASTEXITCODE -ne 0) { throw "generate-build-info failed" }
    } finally { Pop-Location }

    Write-Host "==> Building NexariEpaper.wgt..." -ForegroundColor Cyan
    & (Join-Path $RepoRoot "tools\build-epaper.ps1")
    if ($LASTEXITCODE -ne 0) { throw "build-epaper failed" }
}

if (-not (Test-Path $WgtPath)) { throw "NexariEpaper.wgt not found at $WgtPath" }

Write-Host "==> Connecting sdb to $DeviceIp..." -ForegroundColor Cyan
& $SdbPath connect $DeviceIp
if ($LASTEXITCODE -ne 0) { throw "sdb connect failed" }

Write-Host "==> Installing NexariEpaper.wgt..." -ForegroundColor Cyan
& $TizenCli install -n $WgtPath -t $DeviceIp
if ($LASTEXITCODE -ne 0) { throw "tizen install failed" }

Write-Host "==> Done. Launch the app from the e-paper device." -ForegroundColor Green
