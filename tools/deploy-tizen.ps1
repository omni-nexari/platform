#Requires -Version 5.1
<#
.SYNOPSIS
    Build the nexari-tizen app on Windows and upload the .wgt + sssp_config.xml to the Pi.

.DESCRIPTION
    1. Runs "npm run pack:sssp" in apps/nexari-tizen/ to patch sssp_config.xml with
       the current version and WGT file size.
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
    DS API base URL. Defaults to https://ds.chiho.app

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
    [string]$ApiBase = "",
    [string]$ReleaseNotes = "",

    # Auto-bump version before packing. Set to "" to skip (use current version).
    [ValidateSet("patch", "minor", "major", "")]
    [string]$BumpVersion = "patch",

    # Run Tizen Studio CLI build + sign before uploading.
    # Uses npm run build (production HTTPS API URL).
    [switch]$Build,

    # Tizen Studio CLI path (tizen.bat)
    [string]$TizenCli = "C:\tizen-studio\tools\ide\bin\tizen.bat",

    # Tizen signing profile name
    [string]$SignProfile = "testforsbb"
)

$ErrorActionPreference = "Stop"

# Default API base to local Pi IP so LAN calls work without hairpin NAT
if ($ApiBase -eq "") { $ApiBase = "http://$PiHost" }

$RepoRoot  = Split-Path -Parent $PSScriptRoot
$TizenDir  = Join-Path $RepoRoot "apps\nexari-tizen"
$WgtPath   = Join-Path $TizenDir "NexariPlayer.wgt"
$SsspPath  = Join-Path $TizenDir "sssp_config.xml"
$RemoteDir = "/var/signage/tizen"
$SshTarget = "$User@$PiHost"

# -- Require ssh / scp ---------------------------------------------------------
foreach ($cmd in @("ssh", "scp")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $cmd - install OpenSSH client from Windows Optional Features"
    }
}

# -- Bump version (optional) --------------------------------------------------
# Must happen BEFORE build so config.xml version is baked into the WGT
if ($BumpVersion -ne "") {
    Write-Host "==> Bumping $BumpVersion version in package.json + config.xml..." -ForegroundColor Cyan
    Push-Location $TizenDir
    try {
        npm version $BumpVersion --no-git-tag-version | Write-Host
        if ($LASTEXITCODE -ne 0) { throw "npm version $BumpVersion failed" }
    }
    finally {
        Pop-Location
    }

    # Sync version into config.xml so the WGT version matches sssp_config.xml
    $pkgForVer = Get-Content (Join-Path $TizenDir "package.json") -Raw | ConvertFrom-Json
    $newVer = $pkgForVer.version
    $configXmlPath = Join-Path $TizenDir "config.xml"
    $cfgXml = Get-Content $configXmlPath -Raw
    $cfgXml = $cfgXml -replace '(<widget[^>]+version=")[^"]*(")', "`${1}$newVer`${2}"
    [System.IO.File]::WriteAllText($configXmlPath, $cfgXml, [System.Text.UTF8Encoding]::new($false))
    Write-Host "  config.xml + package.json version set to $newVer" -ForegroundColor Green

    if (-not $Build) {
        Write-Host ""
        Write-Host "  Version bumped to $newVer." -ForegroundColor Yellow
        Write-Host "  Rebuild the WGT in Tizen Studio, then re-run with -BumpVersion ''." -ForegroundColor Yellow
        exit 0
    }
}

# -- Tizen CLI build (optional, via -Build switch) ----------------------------
if ($Build) {
    Write-Host "==> Building Tizen app with npm run build + Tizen CLI..." -ForegroundColor Cyan

    if (-not (Test-Path $TizenCli)) {
        throw "Tizen CLI not found at: $TizenCli - install Tizen Studio or pass -TizenCli"
    }

    # npm run build uses production HTTPS API URL (ds.chiho.app)
    Push-Location $TizenDir
    try {
        Write-Host "  Running npm run build..."
        npm run build 2>&1 | Write-Host
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
    } finally {
        Pop-Location
    }

    # Stage files for Tizen packaging (mirrors install-nexari2.ps1)
    $tmp = Join-Path $env:TEMP "nexari-tizen-build"
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    New-Item $tmp -ItemType Directory | Out-Null

    $excludeNames = @('node_modules','src','.sign','.settings','.project','.tproject','.git','vite.config.ts','package-lock.json','sssp_config.xml')
    foreach ($item in Get-ChildItem $TizenDir) {
        if ($excludeNames -contains $item.Name) { continue }
        if ($item.Extension -eq '.wgt') { continue }
        if ($item.Name -eq '.manifest.tmp') { continue }
        if ($item.PSIsContainer) {
            Copy-Item $item.FullName "$tmp\$($item.Name)" -Recurse
        } else {
            Copy-Item $item.FullName $tmp
        }
    }

    # Re-copy compiled js/ output (regenerated by tsc)
    Copy-Item "$TizenDir\js" "$tmp\js" -Recurse -Force

    Remove-Item "$TizenDir\*.wgt" -ErrorAction SilentlyContinue

    Write-Host "  Packaging + signing with profile '$SignProfile'..."
    & $TizenCli package --type wgt --sign $SignProfile -o $TizenDir -- $tmp 2>&1 | Write-Host

    $wgt = Get-ChildItem $TizenDir -Filter '*.wgt' | Select-Object -First 1
    if (-not $wgt) { throw "Tizen build failed - no WGT produced" }
    if ($wgt.Name -ne 'NexariPlayer.wgt') {
        Rename-Item $wgt.FullName "$TizenDir\NexariPlayer.wgt" -Force
        Write-Host "  Renamed $($wgt.Name) -> NexariPlayer.wgt"
    }
    Write-Host "  WGT built: $([math]::Round((Get-Item $WgtPath).Length / 1KB)) KB" -ForegroundColor Green
}

# -- Require WGT ---------------------------------------------------------------
if (-not (Test-Path $WgtPath)) {
    Write-Host ""
    Write-Host "ERROR: NexariPlayer.wgt not found at:" -ForegroundColor Red
    Write-Host "  $WgtPath" -ForegroundColor Red
    Write-Host ""
    Write-Host "Pass -Build to build automatically, or build manually in Tizen Studio first." -ForegroundColor Yellow
    exit 1
}

# -- Patch sssp_config.xml with current version + file size -------------------
Write-Host "==> Running npm run pack:sssp..." -ForegroundColor Cyan
Push-Location $TizenDir
try {
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    npm run pack:sssp 2>&1 | Where-Object { "$_" -notmatch "Deploy dir not found" } | Write-Host
    $ec = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP
    if ($ec -ne 0) { throw "npm run pack:sssp failed" }
}
finally {
    Pop-Location
}

# -- Ensure remote directory exists -------------------------------------------
Write-Host "==> Ensuring $RemoteDir exists on $SshTarget..." -ForegroundColor Cyan
ssh $SshTarget "sudo mkdir -p '$RemoteDir' && sudo chown '${User}:${User}' '$RemoteDir'"
if ($LASTEXITCODE -ne 0) { throw "Failed to create remote directory" }

# -- Upload -------------------------------------------------------------------
Write-Host "==> Uploading NexariPlayer.wgt and sssp_config.xml..." -ForegroundColor Cyan
scp "$WgtPath" "$SsspPath" "${SshTarget}:${RemoteDir}/"
if ($LASTEXITCODE -ne 0) { throw "SCP upload failed" }

# -- Verify -------------------------------------------------------------------
Write-Host "==> Verifying files on Pi..." -ForegroundColor Cyan
ssh $SshTarget "ls -lh '$RemoteDir/'"
if ($LASTEXITCODE -ne 0) { throw "Remote verification failed" }

# -- Publish release to DS API (optional) -------------------------------------
if ($SuperadminEmail -ne "" -and $SuperadminPassword -ne "") {
    $ApiBase = $ApiBase.TrimEnd('/')

    $pkgJson = Get-Content (Join-Path $TizenDir "package.json") -Raw | ConvertFrom-Json
    $Version = $pkgJson.version
    $DownloadUrl = "https://ds.chiho.app/tizen/NexariPlayer.wgt"

    Write-Host "==> Publishing release v$Version to $ApiBase ..." -ForegroundColor Cyan

    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    try {
        $loginBody = @{ email = $SuperadminEmail; password = $SuperadminPassword } | ConvertTo-Json
        $null = Invoke-WebRequest -Method Post `
            -Uri "$ApiBase/api/v1/superadmin/auth/login" `
            -ContentType "application/json" `
            -Body $loginBody `
            -WebSession $session `
            -UseBasicParsing
    }
    catch {
        Write-Host "WARNING: Superadmin login failed - skipping release publish. $_" -ForegroundColor Yellow
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
        }
        catch {
            $errBody = $_.ErrorDetails.Message
            if ($errBody -and ($errBody | ConvertFrom-Json -ErrorAction SilentlyContinue).code -eq '23505') {
                Write-Host "  Release v$Version already exists - skipping publish." -ForegroundColor DarkGray
            } else {
                Write-Host "WARNING: Failed to publish release - $_" -ForegroundColor Yellow
            }
        }
    }
}
else {
    Write-Host "(Skipping release publish - add -SuperadminEmail / -SuperadminPassword to publish)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  TV launcher URL (HTTPS): https://ds.chiho.app/tizen/sssp_config.xml" -ForegroundColor Gray
Write-Host "  TV launcher URL (LAN):   http://${PiHost}/tizen/sssp_config.xml" -ForegroundColor Gray
Write-Host ""
Write-Host "On existing test TVs with a different cert installed:" -ForegroundColor Yellow
Write-Host "  tizen uninstall -s [TV_IP]:26101 -p fmDBbBnvJM.NexariTizen" -ForegroundColor Yellow
Write-Host "  Then use the URL Launcher on the TV to install fresh." -ForegroundColor Yellow