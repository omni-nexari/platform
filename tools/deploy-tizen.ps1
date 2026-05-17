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
    # Build + deploy (default — always builds with ds.chiho.app API URL):
    .\tools\deploy-tizen.ps1 -PiHost 192.168.1.17

    # Build + deploy + publish release to DS portal:
    .\tools\deploy-tizen.ps1 -PiHost 192.168.1.17 -SuperadminEmail chiho.lee23@gmail.com -SuperadminPassword q1w2e3r4

    # Upload existing WGT without rebuilding:
    .\tools\deploy-tizen.ps1 -PiHost 192.168.1.17 -NoBuild
#>
param(
    [string]$PiHost = "192.168.1.17",

    [string]$User = "chiho",
    [int]$SshPort = 5551,

    [string]$SuperadminEmail = "chiho.lee23@gmail.com",
    [string]$SuperadminPassword = "",
    [string]$ApiBase = "",
    [string]$ReleaseNotes = "",

    # Auto-bump version before packing. Default "" = use current version from package.json.
    # Dev builds (install-nexari2.ps1) own the version bumping; prod just builds at the
    # version that is already in package.json so both builds share the same version number.
    [ValidateSet("patch", "minor", "major", "")]
    [string]$BumpVersion = "",

    # Skip the Tizen CLI build step (use existing NexariPlayer.wgt as-is).
    # By default this script always builds with npm run build (ds.chiho.app API URL).
    [switch]$NoBuild,

    # Tizen Studio CLI path (tizen.bat)
    [string]$TizenCli = "C:\tizen-studio\tools\ide\bin\tizen.bat",

    # Tizen signing profile name (default: prod cert — testforqbc author + NADO.p12 distributor)
    [string]$SignProfile = "nado-prod"
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
$sshPortArgs = @("-p", $SshPort)

# -- Require ssh / scp ---------------------------------------------------------
foreach ($cmd in @("ssh", "scp")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $cmd - install OpenSSH client from Windows Optional Features"
    }
}

# -- Auto-bump before prod build ---------------------------------------------
# install-nexari2.ps1 bumps patch for dev; deploy-tizen bumps patch for prod.
# This guarantees the prod WGT is always a higher version than the last dev
# build so SSSP detects a change and downloads the prod WGT on reboot.
if (-not $NoBuild -and $BumpVersion -eq "") {
    $BumpVersion = "patch"
    Write-Host "==> Auto-bumping patch version for prod build..." -ForegroundColor Cyan
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
    $cfgXml = [System.IO.File]::ReadAllText($configXmlPath, [System.Text.UTF8Encoding]::new($false))
    $cfgXml = $cfgXml -replace '(<widget[^>]+version=")[^"]*(")', "`${1}$newVer`${2}"
    [System.IO.File]::WriteAllText($configXmlPath, $cfgXml, [System.Text.UTF8Encoding]::new($false))
    Write-Host "  config.xml + package.json version set to $newVer" -ForegroundColor Green

    if ($NoBuild) {
        Write-Host ""
        Write-Host "  Version bumped to $newVer." -ForegroundColor Yellow
        Write-Host "  Skipping build (-NoBuild). Upload will use existing WGT." -ForegroundColor Yellow
    }
}

# -- Tizen CLI build (skipped only if -NoBuild is passed) --------------------
if (-not $NoBuild) {
    Write-Host "==> Building prod Tizen app (API: https://ds.chiho.app)..." -ForegroundColor Cyan

    if (-not (Test-Path $TizenCli)) {
        throw "Tizen CLI not found at: $TizenCli - install Tizen Studio or pass -TizenCli"
    }

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

    $excludeNames = @('node_modules','src','.sign','.settings','.project','.tproject','.git','vite.config.ts','package-lock.json','sssp_config.xml','js')
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

    # -- Ensure nado-prod signing profile is registered in profiles.xml --------
    if ($SignProfile -eq "nado-prod") {
        $profilesXml = "C:\tizen-studio-data\profile\profiles.xml"
        $authorP12   = "C:\Users\chiho\SamsungCertificate\testforqbc\author.p12"
        $authorPwd   = "C:\Users\chiho\SamsungCertificate\testforqbc\author.pwd"
        $distP12     = Join-Path $RepoRoot "Docs\cert\NADO.p12"
        $distPwd     = Join-Path $RepoRoot "Docs\cert\NADO.pwd"

        foreach ($p in @($profilesXml, $authorP12, $authorPwd, $distP12, $distPwd)) {
            if (-not (Test-Path $p)) { throw "Missing required cert file: $p" }
        }

        Write-Host "  Ensuring Tizen signing profile 'nado-prod' in $profilesXml..."
        [xml]$pXml = Get-Content $profilesXml
        $pRoot = $pXml.profiles
        $existingProf = $pRoot.profile | Where-Object { $_.name -eq 'nado-prod' }
        if ($existingProf) { [void]$pRoot.RemoveChild($existingProf) }

        $prof = $pXml.CreateElement('profile'); $prof.SetAttribute('name', 'nado-prod')

        $a = $pXml.CreateElement('profileitem')
        $a.SetAttribute('ca',''); $a.SetAttribute('distributor','0')
        $a.SetAttribute('key',$authorP12); $a.SetAttribute('password',$authorPwd); $a.SetAttribute('rootca','')
        [void]$prof.AppendChild($a)

        $d = $pXml.CreateElement('profileitem')
        $d.SetAttribute('ca',''); $d.SetAttribute('distributor','1')
        $d.SetAttribute('key',$distP12); $d.SetAttribute('password',$distPwd); $d.SetAttribute('rootca','')
        [void]$prof.AppendChild($d)

        $d2 = $pXml.CreateElement('profileitem')
        $d2.SetAttribute('ca',''); $d2.SetAttribute('distributor','2')
        $d2.SetAttribute('key',''); $d2.SetAttribute('password',''); $d2.SetAttribute('rootca','')
        [void]$prof.AppendChild($d2)

        [void]$pRoot.AppendChild($prof)
        $pRoot.SetAttribute('active', 'nado-prod')
        $pXml.Save($profilesXml)
        Write-Host "  Profile 'nado-prod' written." -ForegroundColor Green
    }

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
    Write-Host "Pass -NoBuild to skip the build and upload an existing WGT." -ForegroundColor Yellow
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
ssh @sshPortArgs $SshTarget "sudo mkdir -p '$RemoteDir' && sudo chown '${User}:${User}' '$RemoteDir'"
if ($LASTEXITCODE -ne 0) { throw "Failed to create remote directory" }

# -- Upload -------------------------------------------------------------------
Write-Host "==> Uploading NexariPlayer.wgt and sssp_config.xml..." -ForegroundColor Cyan
scp -P $SshPort "$WgtPath" "$SsspPath" "${SshTarget}:${RemoteDir}/"
if ($LASTEXITCODE -ne 0) { throw "SCP upload failed" }

# -- Verify -------------------------------------------------------------------
Write-Host "==> Verifying files on Pi..." -ForegroundColor Cyan
ssh @sshPortArgs $SshTarget "ls -lh '$RemoteDir/'"
if ($LASTEXITCODE -ne 0) { throw "Remote verification failed" }

# -- Publish release to DS API (optional) -------------------------------------
if ($SuperadminEmail -ne "" -and $SuperadminPassword -eq "") {
    $secPwd = Read-Host "Superadmin password for $SuperadminEmail" -AsSecureString
    $SuperadminPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPwd))
}
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
            # Extract the sa_csrf_token set by the login response and send it
            # as X-CSRF-Token so the double-submit CSRF check in the API passes.
            $csrfToken = $session.Cookies.GetCookies("$ApiBase/") |
                Where-Object { $_.Name -eq 'sa_csrf_token' } |
                Select-Object -First 1 -ExpandProperty Value

            $releaseBody = @{ version = $Version; downloadUrl = $DownloadUrl }
            if ($ReleaseNotes -ne "") { $releaseBody.releaseNotes = $ReleaseNotes }

            $publishResp = Invoke-RestMethod -Method Post `
                -Uri "$ApiBase/api/v1/player-releases" `
                -ContentType "application/json" `
                -WebSession $session `
                -Headers @{ 'X-CSRF-Token' = $csrfToken } `
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

$finalVer = (Get-Content (Join-Path $TizenDir "package.json") -Raw | ConvertFrom-Json).version
Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  Prod build : v$finalVer  (API: https://ds.chiho.app)" -ForegroundColor Green
Write-Host "  TV launcher URL (HTTPS): https://ds.chiho.app/tizen/sssp_config.xml" -ForegroundColor Gray
Write-Host "  TV launcher URL (LAN):   http://${PiHost}/tizen/sssp_config.xml" -ForegroundColor Gray