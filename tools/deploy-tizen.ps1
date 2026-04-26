#Requires -Version 5.1
<#
.SYNOPSIS
    Build the nexari-tizen app on Windows and upload the .wgt + sssp_config.xml to the Pi.

.DESCRIPTION
    1. Runs "npm run pack:sssp" in apps/nexari-tizen/ to:
       - Patch sssp_config.xml with the current version and WGT file size
       - (Local copy to /var/signage/tizen/ is skipped — that directory is on the Pi, not Windows)
    2. SCPs NexariPlayer.wgt and sssp_config.xml to /var/signage/tizen/ on the Pi.

    Prerequisites on Windows:
      - Tizen Studio: build + sign the .wgt with the prod .p12 cert first
      - OpenSSH client (ships with Windows 10+)
      - Node.js (for npm run pack:sssp)

.PARAMETER PiHost
    IP address or hostname of the Raspberry Pi (e.g. 192.168.1.17)

.PARAMETER User
    SSH user on the Pi. Default: chiho

.EXAMPLE
    .\tools\deploy-tizen.ps1 -PiHost 192.168.1.17
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$PiHost,

    [string]$User = "chiho"
)

$ErrorActionPreference = "Stop"

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$TizenDir   = Join-Path $RepoRoot "apps\nexari-tizen"
$WgtPath    = Join-Path $TizenDir "NexariPlayer.wgt"
$SsspPath   = Join-Path $TizenDir "sssp_config.xml"
$RemoteDir  = "/var/signage/tizen"
$SshTarget  = "$User@$PiHost"

# ── Require ssh / scp ─────────────────────────────────────────────────────────
foreach ($cmd in @("ssh", "scp")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $cmd — install OpenSSH client from Windows Optional Features"
    }
}

# ── Require WGT ───────────────────────────────────────────────────────────────
if (-not (Test-Path $WgtPath)) {
    Write-Host ""
    Write-Host "ERROR: NexariPlayer.wgt not found at:" -ForegroundColor Red
    Write-Host "  $WgtPath" -ForegroundColor Red
    Write-Host ""
    Write-Host "Build and sign the app in Tizen Studio first (using the prod .p12 cert)," -ForegroundColor Yellow
    Write-Host "then re-run this script." -ForegroundColor Yellow
    exit 1
}

# ── patch sssp_config.xml with current version + file size ───────────────────
Write-Host "==> Running npm run pack:sssp..." -ForegroundColor Cyan
Push-Location $TizenDir
try {
    # pack:sssp will warn about /var/signage/tizen not existing locally — that's expected
    npm run pack:sssp 2>&1 | Where-Object { $_ -notmatch "Deploy dir not found" } | Write-Host
    if ($LASTEXITCODE -ne 0) { throw "npm run pack:sssp failed" }
}
finally {
    Pop-Location
}

# ── Ensure remote directory exists ────────────────────────────────────────────
Write-Host "==> Ensuring $RemoteDir exists on $SshTarget..." -ForegroundColor Cyan
ssh $SshTarget "sudo mkdir -p '$RemoteDir' && sudo chown '${User}:${User}' '$RemoteDir'"
if ($LASTEXITCODE -ne 0) { throw "Failed to create remote directory" }

# ── Upload ────────────────────────────────────────────────────────────────────
Write-Host "==> Uploading NexariPlayer.wgt and sssp_config.xml..." -ForegroundColor Cyan
scp "$WgtPath" "$SsspPath" "${SshTarget}:${RemoteDir}/"
if ($LASTEXITCODE -ne 0) { throw "SCP upload failed" }

# ── Verify ────────────────────────────────────────────────────────────────────
Write-Host "==> Verifying files on Pi..." -ForegroundColor Cyan
ssh $SshTarget "ls -lh '$RemoteDir/'"
if ($LASTEXITCODE -ne 0) { throw "Remote verification failed" }

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  TV launcher URL (HTTPS): https://ds.chiho.app/tizen/sssp_config.xml" -ForegroundColor Gray
Write-Host "  TV launcher URL (LAN):   http://${PiHost}/tizen/sssp_config.xml" -ForegroundColor Gray
Write-Host ""
Write-Host "On existing test TVs with a different cert installed:" -ForegroundColor Yellow
Write-Host "  tizen uninstall -s <TV_IP>:26101 -p fmDBbBnvJM.NexariTizen" -ForegroundColor Yellow
Write-Host "  Then use the URL Launcher on the TV to install fresh." -ForegroundColor Yellow
