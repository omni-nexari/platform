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

.PARAMETER SuperadminEmail
    Superadmin email for publishing the release to the DS API player_releases table.
    If omitted, the upload still happens but no release record is created.

.PARAMETER SuperadminPassword
    Superadmin password. Required when SuperadminEmail is provided.

.PARAMETER ApiBase
    DS API base URL. Defaults to https://ds.chiho.app (public — for both the API call and the stored WGT URL).
    Override with http://<PiHost> only for LAN-only deployments.

.PARAMETER ReleaseNotes
    Optional release notes stored with the player_releases record.

.EXAMPLE
    # Upload only:
    .\tools\deploy-tizen.ps1 -PiHost 192.168.1.17

    # Upload + publish release to DS portal:
    .\tools\deploy-tizen.ps1 -PiHost 192.168.1.17 -SuperadminEmail chiho.lee23@gmail.com -SuperadminPassword q1w2e3r4
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$PiHost,

    [string]$User = "chiho",

    [string]$SuperadminEmail = "",
    [string]$SuperadminPassword = "",
    [string]$ApiBase = "https://ds.chiho.app",
    [string]$ReleaseNotes = ""
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

# ── Publish release to DS API (optional) ─────────────────────────────────────
if ($SuperadminEmail -ne "" -and $SuperadminPassword -ne "") {
    $ApiBase = $ApiBase.TrimEnd('/')

    $pkgJson = Get-Content (Join-Path $TizenDir "package.json") -Raw | ConvertFrom-Json
    $Version = $pkgJson.version
    # Use the public HTTPS URL — TVs on any network can reach it
    $DownloadUrl = "https://ds.chiho.app/tizen/NexariPlayer.wgt"

    Write-Host "==> Publishing release v$Version to $ApiBase ..." -ForegroundColor Cyan

    # Login via superadmin endpoint and capture the sa_access_token cookie in a session
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    try {
        $loginBody = @{ email = $SuperadminEmail; password = $SuperadminPassword } | ConvertTo-Json
        $null = Invoke-WebRequest -Method Post `
            -Uri "$ApiBase/api/v1/superadmin/auth/login" `
            -ContentType "application/json" `
            -Body $loginBody `
            -WebSession $session `
            -UseBasicParsing
    } catch {
        Write-Host "WARNING: Superadmin login failed — skipping release publish. $_" -ForegroundColor Yellow
        $session = $null
    }

    if ($session) {
        try {
            $releaseBody = @{ version = $Version; downloadUrl = $DownloadUrl }
            if ($ReleaseNotes -ne "") { $releaseBody.releaseNotes = $ReleaseNotes }

            $publishResp = Invoke-RestMethod -Method Post `
                -Uri "$ApiBase/api/v1/player-releases" `
                -ContentType "application/json" `
                -WebSession $session `
                -Body ($releaseBody | ConvertTo-Json)
            Write-Host "  Release published: v$($publishResp.version) (id=$($publishResp.id))" -ForegroundColor Green
        } catch {
            Write-Host "WARNING: Failed to publish release — $_" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "(Skipping release publish — add -SuperadminEmail / -SuperadminPassword to publish)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  TV launcher URL (HTTPS): https://ds.chiho.app/tizen/sssp_config.xml" -ForegroundColor Gray
Write-Host "  TV launcher URL (LAN):   http://${PiHost}/tizen/sssp_config.xml" -ForegroundColor Gray
Write-Host ""
Write-Host "On existing test TVs with a different cert installed:" -ForegroundColor Yellow
Write-Host "  tizen uninstall -s <TV_IP>:26101 -p fmDBbBnvJM.NexariTizen" -ForegroundColor Yellow
Write-Host "  Then use the URL Launcher on the TV to install fresh." -ForegroundColor Yellow
