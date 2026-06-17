#Requires -Version 5.1
<#
.SYNOPSIS
    PROD build of nexari-epaper: bakes platform.nexari.ca URL, signs, uploads to Pi.

.DESCRIPTION
    1. Bumps patch version in package.json + config.xml.
    2. Runs build-info generation (API_BASE=https://platform.nexari.ca/api/v1, WS_URL=wss://platform.nexari.ca).
    3. Packages + signs with the nado-prod profile.
    4. Uploads NexariEPaper.wgt + sssp_config.xml to /var/signage/tizen/epaper/ on the Pi.
    5. Optionally installs directly onto the panel via SDB.
    6. Optionally publishes a player_releases record via the DS superadmin API.

    Dev builds (192.168.1.17 API URL) -> use install-epaper.ps1 instead.

.PARAMETER PiHost
    IP address or hostname of the Raspberry Pi. Default: 192.168.1.17

.PARAMETER PanelHost
    SDB address of the e-paper panel. Default: 192.168.1.100:26101

.PARAMETER InstallOnPanel
    After uploading to the Pi, also install directly on the panel via SDB.

.PARAMETER NoBuild
    Skip npm build + tizen package. Upload existing NexariEPaper.wgt as-is.

.EXAMPLE
    # Build + deploy:
    .\tools\deploy-epaper.ps1

    # Build + deploy + install on panel:
    .\tools\deploy-epaper.ps1 -InstallOnPanel

    # Build + deploy + publish release:
    .\tools\deploy-epaper.ps1 -SuperadminEmail chiho.lee23@gmail.com -SuperadminPassword q1w2e3r4
#>
param(
    [string]$PiHost       = "192.168.1.17",
    [string]$User         = "chiho",
    [int]$SshPort         = 5551,
    [string]$PanelHost    = "192.168.1.100:26101",

    [string]$SuperadminEmail    = "chiho.lee23@gmail.com",
    [string]$SuperadminPassword = "",
    [string]$ReleaseNotes       = "",
    [string]$PlayerApiBase      = "https://platform.nexari.ca/api/v1",
    [string]$PlayerWsUrl        = "wss://platform.nexari.ca",

    [switch]$NoBuild,
    [switch]$InstallOnPanel,

    [string]$TizenCli   = "C:\tizen-studio\tools\ide\bin\tizen.bat",
    [string]$SignProfile = "nado-prod"
)

$ErrorActionPreference = "Stop"

$RepoRoot  = Split-Path -Parent $PSScriptRoot
$SrcDir    = Join-Path $RepoRoot "apps\nexari-epaper"
$WgtPath   = Join-Path $SrcDir "NexariEPaper.wgt"
$SsspPath  = Join-Path $SrcDir "sssp_config.xml"
$RemoteDir = "/var/signage/tizen/epaper"
$SshTarget = "$User@$PiHost"
$SdbExe    = "C:\tizen-studio\tools\sdb.exe"
$AppId     = "U1izu2M7CQ.NexariEPaper"

$ProfilesXml = "C:\tizen-studio-data\profile\profiles.xml"
$AuthorP12   = "C:\Users\chiho\SamsungCertificate\testforqbc\author.p12"
$AuthorPwd   = "C:\Users\chiho\SamsungCertificate\testforqbc\author.pwd"
$DistP12     = Join-Path $RepoRoot "Docs\cert\NADO.p12"
$DistPwd     = Join-Path $RepoRoot "Docs\cert\NADO.pwd"

foreach ($cmd in @("ssh", "scp")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $cmd - install OpenSSH client from Windows Optional Features"
    }
}

# -- Signing profile -----------------------------------------------------------
if (-not $NoBuild) {
    foreach ($p in @($ProfilesXml, $AuthorP12, $AuthorPwd, $DistP12, $DistPwd)) {
        if (-not (Test-Path $p)) { throw "Missing required cert file: $p" }
    }

    Write-Host "==> Ensuring Tizen signing profile '$SignProfile'..." -ForegroundColor Cyan
    [xml]$pXml = Get-Content $ProfilesXml
    $pRoot = $pXml.profiles
    $existingProf = $pRoot.profile | Where-Object { $_.name -eq $SignProfile }
    if ($existingProf) { [void]$pRoot.RemoveChild($existingProf) }

    $prof = $pXml.CreateElement('profile'); $prof.SetAttribute('name', $SignProfile)
    $a = $pXml.CreateElement('profileitem')
    $a.SetAttribute('ca',''); $a.SetAttribute('distributor','0')
    $a.SetAttribute('key',$AuthorP12); $a.SetAttribute('password',$AuthorPwd); $a.SetAttribute('rootca','')
    [void]$prof.AppendChild($a)
    $d = $pXml.CreateElement('profileitem')
    $d.SetAttribute('ca',''); $d.SetAttribute('distributor','1')
    $d.SetAttribute('key',$DistP12); $d.SetAttribute('password',$DistPwd); $d.SetAttribute('rootca','')
    [void]$prof.AppendChild($d)
    $d2 = $pXml.CreateElement('profileitem')
    $d2.SetAttribute('ca',''); $d2.SetAttribute('distributor','2')
    $d2.SetAttribute('key',''); $d2.SetAttribute('password',''); $d2.SetAttribute('rootca','')
    [void]$prof.AppendChild($d2)
    [void]$pRoot.AppendChild($prof)
    $pRoot.SetAttribute('active', $SignProfile)
    $pXml.Save($ProfilesXml)
    Write-Host "  Profile '$SignProfile' written." -ForegroundColor Green
}

# -- Version bump --------------------------------------------------------------
if (-not $NoBuild) {
    Write-Host ""
    Write-Host "==> Bumping patch version..." -ForegroundColor Cyan
    Push-Location $SrcDir
    try {
        npm version patch --no-git-tag-version 2>&1 | Write-Host
        if ($LASTEXITCODE -ne 0) { throw "npm version patch failed" }
    } finally { Pop-Location }

    $newVer = (Get-Content (Join-Path $SrcDir "package.json") -Raw | ConvertFrom-Json).version
    $cfgXmlPath = Join-Path $SrcDir "config.xml"
    $cfgXml = [System.IO.File]::ReadAllText($cfgXmlPath, [System.Text.UTF8Encoding]::new($false))
    $cfgXml = $cfgXml -replace '(<widget\s[^>]*version=")[^"]*(")', "`${1}$newVer`${2}"
    [System.IO.File]::WriteAllText($cfgXmlPath, $cfgXml, [System.Text.UTF8Encoding]::new($false))
    Write-Host "  Version: $newVer" -ForegroundColor Green
}

# -- Build + package -----------------------------------------------------------
if (-not $NoBuild) {
    if (-not (Test-Path $TizenCli)) { throw "Tizen CLI not found at: $TizenCli" }

    Write-Host ""
    Write-Host "==> Building PROD app (API: $PlayerApiBase)..." -ForegroundColor Cyan

    Push-Location $SrcDir
    try {
        $prevApiBase = $env:API_BASE
        $prevWsUrl = $env:WS_URL
        try {
            $env:API_BASE = $PlayerApiBase
            $env:WS_URL = $PlayerWsUrl
            node scripts/generate-build-info.cjs 2>&1 | Write-Host
            if ($LASTEXITCODE -ne 0) { throw "generate-build-info failed" }
        } finally {
            $env:API_BASE = $prevApiBase
            $env:WS_URL = $prevWsUrl
        }
    } finally { Pop-Location }

    $tmp = "$env:TEMP\nexari-epaper-prod"
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    New-Item $tmp -ItemType Directory | Out-Null

    $excludeNames = @('node_modules','src','.sign','.settings','.project','.tproject','.git','vite.config.ts','package-lock.json','sssp_config.xml','js')
    foreach ($item in Get-ChildItem $SrcDir) {
        if ($excludeNames -contains $item.Name) { continue }
        if ($item.Extension -eq '.wgt') { continue }
        if ($item.Name -eq '.manifest.tmp') { continue }
        if ($item.PSIsContainer) { Copy-Item $item.FullName "$tmp\$($item.Name)" -Recurse }
        else { Copy-Item $item.FullName $tmp }
    }
    Copy-Item "$SrcDir\js" "$tmp\js" -Recurse -Force
    Write-Host "  Staging: $((Get-ChildItem $tmp -Recurse -File).Count) files"

    Remove-Item "$SrcDir\*.wgt" -ErrorAction SilentlyContinue
    Write-Host "  Packaging + signing with '$SignProfile'..."
    & $TizenCli package --type wgt --sign $SignProfile -o $SrcDir -- $tmp 2>&1 | Write-Host

    $wgt = Get-ChildItem $SrcDir -Filter '*.wgt' | Select-Object -First 1
    if (-not $wgt) { throw "Tizen package failed - no WGT produced" }
    if ($wgt.Name -ne 'NexariEPaper.wgt') {
        Rename-Item $wgt.FullName (Join-Path $SrcDir 'NexariEPaper.wgt') -Force
        Write-Host "  Renamed $($wgt.Name) -> NexariEPaper.wgt"
    }
    Write-Host "  WGT built: $([math]::Round((Get-Item $WgtPath).Length / 1KB)) KB" -ForegroundColor Green
}

if (-not (Test-Path $WgtPath)) {
    Write-Host "ERROR: NexariEPaper.wgt not found. Build first or omit -NoBuild." -ForegroundColor Red; exit 1
}

# -- Patch sssp_config.xml -----------------------------------------------------
$wgtBytes = (Get-Item $WgtPath).Length
$appVer   = (Get-Content (Join-Path $SrcDir "package.json") -Raw | ConvertFrom-Json).version
$ssspXml  = [System.IO.File]::ReadAllText($SsspPath, [System.Text.UTF8Encoding]::new($false))
$ssspXml  = $ssspXml -replace '<size>\d+</size>',  "<size>$wgtBytes</size>"
$ssspXml  = $ssspXml -replace '<ver>[^<]*</ver>',   "<ver>$appVer</ver>"
[System.IO.File]::WriteAllText($SsspPath, $ssspXml, [System.Text.UTF8Encoding]::new($false))
Write-Host ""
Write-Host "==> sssp_config.xml: <ver>$appVer</ver>  <size>$wgtBytes</size>" -ForegroundColor Cyan

# -- Upload to Pi --------------------------------------------------------------
Write-Host ""
Write-Host "==> Uploading to ${SshTarget}:${RemoteDir} ..." -ForegroundColor Cyan
ssh -p $SshPort $SshTarget "sudo mkdir -p '$RemoteDir' && sudo chown '${User}:${User}' '$RemoteDir'"
if ($LASTEXITCODE -ne 0) { throw "Failed to create remote directory" }
scp -P $SshPort $WgtPath $SsspPath "${SshTarget}:${RemoteDir}/"
if ($LASTEXITCODE -ne 0) { throw "SCP upload failed" }
ssh -p $SshPort $SshTarget "ls -lh '$RemoteDir/'"

# -- Optional SDB install ------------------------------------------------------
function Install-EpaperOnPanel {
    param([string]$tv, [string]$label)
    Write-Host ""
    Write-Host "======================================================"
    Write-Host "  TARGET: $label ($tv)"
    Write-Host "======================================================"
    Write-Host "--- SDB Connect ---"
    $connectOut = & $SdbExe connect $tv 2>&1 | Out-String
    Write-Host $connectOut
    if ($connectOut -notmatch "connected to|already connected") {
        Write-Host "WARNING: Panel not reachable via SDB. Use SSSP URL below." -ForegroundColor Yellow
        return
    }
    Start-Sleep -Seconds 2
    Write-Host "--- Uninstall ---"
    foreach ($pkg in @($AppId, "nxrEPaper01.NexariEPaper", "EpHzVnXrQp.NexariEpaper")) {
        Write-Host "Removing $pkg ..."
        & $TizenCli uninstall -s $tv -p $pkg 2>&1 | Out-String | Write-Host
    }
    Start-Sleep -Seconds 3
    Write-Host "--- Install ---"
    & $TizenCli install -s $tv -n NexariEPaper.wgt -- $SrcDir 2>&1
    Write-Host "--- Launch ---"
    Start-Sleep -Seconds 2
    & $TizenCli run -s $tv -p $AppId 2>&1 | Out-String | Write-Host
}

if ($InstallOnPanel) {
    Install-EpaperOnPanel -tv $PanelHost -label "E-Paper Panel"
} else {
    Write-Host "(Re-run with -InstallOnPanel to install directly via SDB)" -ForegroundColor DarkGray
}

# -- Optional: publish player release ------------------------------------------
if ($SuperadminEmail -ne "" -and $SuperadminPassword -eq "") {
    $secPwd = Read-Host "Superadmin password for $SuperadminEmail" -AsSecureString
    $SuperadminPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPwd))
}
if ($SuperadminEmail -ne "" -and $SuperadminPassword -ne "") {
    $ApiBase     = "https://platform.nexari.ca"
    $DownloadUrl = "https://platform.nexari.ca/tizen/epaper/NexariEPaper.wgt"
    Write-Host ""
    Write-Host "==> Publishing release v$appVer to $ApiBase ..." -ForegroundColor Cyan
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    try {
        $loginBody = @{ email = $SuperadminEmail; password = $SuperadminPassword } | ConvertTo-Json
        $null = Invoke-WebRequest -Method Post `
            -Uri "$ApiBase/api/v1/superadmin/auth/login" `
            -ContentType "application/json" `
            -Body $loginBody -WebSession $session -UseBasicParsing
    } catch {
        Write-Host "WARNING: Superadmin login failed - skipping release publish. $_" -ForegroundColor Yellow
        $session = $null
    }
    if ($session) {
        $csrfToken = $session.Cookies.GetCookies("$ApiBase/") |
            Where-Object { $_.Name -eq 'sa_csrf_token' } |
            Select-Object -First 1 -ExpandProperty Value

        try {
            $rb = @{ version = $appVer; downloadUrl = $DownloadUrl }
            if ($ReleaseNotes -ne "") { $rb.releaseNotes = $ReleaseNotes }
            $resp = Invoke-RestMethod -Method Post `
                -Uri "$ApiBase/api/v1/player-releases" `
                -ContentType "application/json" `
                -WebSession $session `
                -Headers @{ 'X-CSRF-Token' = $csrfToken } `
                -Body ($rb | ConvertTo-Json)
            Write-Host "  Release published: v$($resp.version) (id=$($resp.id))" -ForegroundColor Green
        } catch {
            $errBody = $_.ErrorDetails.Message
            if ($errBody -and ($errBody | ConvertFrom-Json -ErrorAction SilentlyContinue).code -eq '23505') {
                Write-Host "  Release v$appVer already exists - skipping." -ForegroundColor DarkGray
            } else {
                Write-Host "WARNING: Failed to publish release - $_" -ForegroundColor Yellow
            }
        }
    }
} else {
    Write-Host "(Skipping release publish - add -SuperadminEmail / -SuperadminPassword to publish)" -ForegroundColor DarkGray
}

# -- Summary -------------------------------------------------------------------
Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  PROD build : v$appVer  (API: https://platform.nexari.ca)" -ForegroundColor Green
Write-Host "  SSSP URL (HTTPS): https://platform.nexari.ca/tizen/epaper/sssp_config.xml" -ForegroundColor Gray
Write-Host "  SSSP URL (LAN):   http://${PiHost}/tizen/epaper/sssp_config.xml" -ForegroundColor Gray
