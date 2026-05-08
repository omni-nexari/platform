# install-epaper.ps1 — DEV build (API: http://192.168.1.17) + deploy to panel.
# For PROD builds (API: https://ds.chiho.app) use deploy-epaper.ps1 instead.

$src        = "C:\Users\chiho\Projects\Platform\apps\nexari-epaper"
$tizen      = "C:\tizen-studio\tools\ide\bin\tizen.bat"
$sdb        = "C:\tizen-studio\tools\sdb.exe"
$appId      = "U1izu2M7CQ.NexariEPaper"
$panel      = "192.168.1.100:26101"  # e-paper panel
$pi         = "chiho@192.168.1.17"
$piPort     = 5551
$tmp        = "$env:TEMP\nexari-epaper-build"

# --- Production signing profile ---
# Same certs as nexari-tizen: testforqbc AUTHOR cert + NADO.p12 DISTRIBUTOR cert.
$signProfile  = "nado-prod"
$profilesXml  = "C:\tizen-studio-data\profile\profiles.xml"
$authorP12    = "C:\Users\chiho\SamsungCertificate\testforqbc\author.p12"
$authorPwd    = "C:\Users\chiho\SamsungCertificate\testforqbc\author.pwd"
$distP12      = "C:\Users\chiho\Projects\Platform\Docs\cert\NADO.p12"
$distPwd      = "C:\Users\chiho\Projects\Platform\Docs\cert\NADO.pwd"

foreach ($p in @($profilesXml, $authorP12, $authorPwd, $distP12, $distPwd)) {
    if (-not (Test-Path $p)) { Write-Error "Missing required file: $p"; exit 1 }
}

Write-Host "=== Ensuring Tizen signing profile '$signProfile' ==="
[xml]$xml = Get-Content $profilesXml
$root = $xml.profiles
$existing = $root.profile | Where-Object { $_.name -eq $signProfile }
if ($existing) { [void]$root.RemoveChild($existing) }

$prof = $xml.CreateElement("profile")
$prof.SetAttribute("name", $signProfile)

$author = $xml.CreateElement("profileitem")
$author.SetAttribute("ca", ""); $author.SetAttribute("distributor", "0")
$author.SetAttribute("key", $authorP12); $author.SetAttribute("password", $authorPwd)
$author.SetAttribute("rootca", "")
[void]$prof.AppendChild($author)

$dist = $xml.CreateElement("profileitem")
$dist.SetAttribute("ca", ""); $dist.SetAttribute("distributor", "1")
$dist.SetAttribute("key", $distP12); $dist.SetAttribute("password", $distPwd)
$dist.SetAttribute("rootca", "")
[void]$prof.AppendChild($dist)

$dist2 = $xml.CreateElement("profileitem")
$dist2.SetAttribute("ca", ""); $dist2.SetAttribute("distributor", "2")
$dist2.SetAttribute("key", ""); $dist2.SetAttribute("password", "")
$dist2.SetAttribute("rootca", "")
[void]$prof.AppendChild($dist2)

[void]$root.AppendChild($prof)
$root.SetAttribute("active", $signProfile)
$xml.Save($profilesXml)
Write-Host "Profile '$signProfile' written to $profilesXml"

# ============================================================
# PRE-BUILD: Bump patch version in package.json + config.xml
# SSSP compares <ver> against the installed app version — bumping
# patch on every build guarantees SSSP always detects a new version.
# ============================================================
Write-Host ""
Write-Host "=== Bumping patch version ==="
Push-Location $src
try {
    npm version patch --no-git-tag-version 2>&1 | Write-Host
    if ($LASTEXITCODE -ne 0) { throw "npm version patch failed" }
} finally {
    Pop-Location
}

$appVerNew = (Get-Content "$src\package.json" -Raw | ConvertFrom-Json).version

# Sync config.xml widget version attribute
$configXmlPath = "$src\config.xml"
$configXmlContent = [System.IO.File]::ReadAllText($configXmlPath, [System.Text.UTF8Encoding]::new($false))
$configXmlContent = $configXmlContent -replace '(<widget\s[^>]*version=")[^"]*(")', "`${1}$appVerNew`${2}"
[System.IO.File]::WriteAllText($configXmlPath, $configXmlContent, [System.Text.UTF8Encoding]::new($false))
Write-Host "Version bumped: $appVerNew (package.json + config.xml)"

# ============================================================
# STEP 1: BUILD + PACKAGE
# ============================================================
Write-Host ""
Write-Host "=== STEP 1: Build ==="

if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item $tmp -ItemType Directory | Out-Null

$excludeNames = @(
    'node_modules', 'src', '.sign', '.settings',
    '.project', '.tproject', '.git',
    'vite.config.ts', 'package-lock.json', 'sssp_config.xml',
    'js'   # excluded here — copied fresh after build:dev below
)
foreach ($item in Get-ChildItem $src) {
    if ($excludeNames -contains $item.Name) { continue }
    if ($item.Extension -eq '.wgt') { continue }
    if ($item.Name -eq '.manifest.tmp') { continue }
    if ($item.PSIsContainer) {
        Copy-Item $item.FullName "$tmp\$($item.Name)" -Recurse
    } else {
        Copy-Item $item.FullName $tmp
    }
}

Write-Host "Staging dir: $((Get-ChildItem $tmp -Recurse -File).Count) files"
Remove-Item "$src\*.wgt" -ErrorAction SilentlyContinue

# Run build:dev — regenerates build-info.js with LAN API URL (Pi at 192.168.1.17)
Write-Host "Running npm run build:dev..."
Push-Location $src
try {
    npm run build:dev 2>&1 | Write-Host
    if ($LASTEXITCODE -ne 0) { throw "npm run build:dev failed" }
} finally {
    Pop-Location
}

# Re-copy all compiled js/ output
Copy-Item "$src\js" "$tmp\js" -Recurse -Force

Write-Host "Packaging with $signProfile profile..."
& $tizen package --type wgt --sign $signProfile -o $src -- $tmp 2>&1

$wgt = Get-ChildItem $src -Filter "*.wgt" | Select-Object -First 1
if (-not $wgt) {
    Write-Error "Build failed - no WGT produced. Aborting."
    exit 1
}
if ($wgt.Name -ne "NexariEPaper.wgt") {
    Rename-Item $wgt.FullName "$src\NexariEPaper.wgt" -Force
    Write-Host "Renamed $($wgt.Name) -> NexariEPaper.wgt"
}
$sizeKB = [math]::Round((Get-Item "$src\NexariEPaper.wgt").Length / 1KB)
Write-Host "WGT size: ${sizeKB} KB"

# ============================================================
# STEP 2: Update sssp_config.xml with exact byte-size + version
# ============================================================
$wgtBytes   = (Get-Item "$src\NexariEPaper.wgt").Length
$appVer     = (Get-Content "$src\package.json" -Raw | ConvertFrom-Json).version
$ssspConfig = "$src\sssp_config.xml"
$ssspXml    = [System.IO.File]::ReadAllText($ssspConfig, [System.Text.UTF8Encoding]::new($false))
$ssspXml    = $ssspXml -replace '<size>\d+</size>',  "<size>$wgtBytes</size>"
$ssspXml    = $ssspXml -replace '<ver>[^<]*</ver>',   "<ver>$appVer</ver>"
[System.IO.File]::WriteAllText($ssspConfig, $ssspXml, [System.Text.UTF8Encoding]::new($false))
Write-Host "Updated sssp_config.xml: <ver>$appVer</ver>  <size>$wgtBytes</size>"

# ============================================================
# STEP 3: Deploy WGT + sssp_config.xml to Pi server
#   Served at: http://192.168.1.17/tizen/epaper/
#   Enter this URL in the panel's URL Launcher Settings to install/auto-update.
# ============================================================
Write-Host ""
Write-Host "=== STEP 3: Deploy WGT to Pi server ($pi) ==="
$piTizenDir = "/var/signage/tizen/epaper"
ssh -p $piPort $pi "mkdir -p $piTizenDir" 2>&1 | Out-Null
scp -P $piPort "$src\NexariEPaper.wgt" "${pi}:${piTizenDir}/NexariEPaper.wgt"
if ($LASTEXITCODE -ne 0) { Write-Error "WGT SCP failed - check SSH access to $pi. Aborting."; exit 1 }
scp -P $piPort "$src\sssp_config.xml" "${pi}:${piTizenDir}/sssp_config.xml"
if ($LASTEXITCODE -ne 0) { Write-Error "sssp_config.xml SCP failed. Aborting."; exit 1 }

# ============================================================
# Helper: connect via SDB, uninstall old app, install + run
# Uses the already-built NexariEPaper.wgt in $src.
# Author cert (distributor=0) + NADO.p12 dist cert (distributor=1)
# are embedded in the WGT signature applied above by --sign $signProfile.
# ============================================================
function Install-EpaperOnPanel {
    param([string]$tv, [string]$label)

    Write-Host ""
    Write-Host "======================================================"
    Write-Host "  TARGET: $label ($tv)"
    Write-Host "======================================================"

    # SDB CONNECT
    Write-Host ""
    Write-Host "--- SDB Connect ---"
    $connectOut = & $sdb connect $tv 2>&1 | Out-String
    Write-Host $connectOut
    if ($connectOut -notmatch "connected to|already connected") {
        Write-Host "WARNING: $label ($tv) is not reachable via SDB." -ForegroundColor Yellow
        Write-Host "Make sure the panel is on and developer mode is enabled." -ForegroundColor Yellow
        Write-Host "You can still install via SSSP URL Launcher:" -ForegroundColor Yellow
        Write-Host "  http://192.168.1.17/tizen/epaper/sssp_config.xml" -ForegroundColor Cyan
        return
    }
    Start-Sleep -Seconds 2

    # UNINSTALL old versions
    Write-Host ""
    Write-Host "--- Uninstall ---"
    foreach ($pkg in @($appId, "nxrEPaper01.NexariEPaper", "EpHzVnXrQp.NexariEpaper")) {
        Write-Host "Removing $pkg ..."
        & $tizen uninstall -s $tv -p $pkg 2>&1 | Out-String | Write-Host
    }
    Start-Sleep -Seconds 3

    # INSTALL
    Write-Host ""
    Write-Host "--- Install ---"
    & $tizen install -s $tv -n NexariEPaper.wgt -- $src 2>&1

    # LAUNCH
    Write-Host ""
    Write-Host "--- Launch ---"
    Start-Sleep -Seconds 2
    & $tizen run -s $tv -p $appId 2>&1 | Out-String | Write-Host
}

# ============================================================
# STEP 4: INSTALL ON E-PAPER PANEL VIA SDB (optional)
# ============================================================
Write-Host ""
$installChoice = Read-Host "Install on panel via SDB? [Y]es / [N]o (Pi SSSP URL install)"
if ($installChoice.Trim().ToUpper() -eq "Y") {
    Install-EpaperOnPanel -tv $panel -label "E-Paper Panel"
}

Write-Host ""
Write-Host "=== All done. ===" -ForegroundColor Green
Write-Host ""
Write-Host "Pi server updated: http://192.168.1.17/tizen/epaper/NexariEPaper.wgt" -ForegroundColor Cyan
Write-Host "App ID:            $appId" -ForegroundColor Cyan
Write-Host "Version:           $appVer" -ForegroundColor Cyan
Write-Host ""
Write-Host "SSSP URL Launcher install (panel reboot triggers auto-update):" -ForegroundColor Yellow
Write-Host "  http://192.168.1.17/tizen/epaper/sssp_config.xml" -ForegroundColor Cyan
