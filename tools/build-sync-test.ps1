$src    = "C:\Users\chiho\Projects\Platform\apps\nexari-sync-engine"
$tizen  = "C:\tizen-studio\tools\ide\bin\tizen.bat"
$sdb    = "C:\tizen-studio\tools\sdb.exe"
$tvQBC  = "192.168.1.11:26101"
$tvSBB  = "192.168.1.39:26101"
$appId  = "fmDBbBnvJM.NexariSyncEngine"
$wgtName = "NexariSyncEngine.wgt"
$tmp    = "$env:TEMP\nexari-sync-engine-build"

$signProfile  = "nado-prod"
$profilesXml  = "C:\tizen-studio-data\profile\profiles.xml"
$authorP12    = "C:\Users\chiho\SamsungCertificate\testforqbc\author.p12"
$authorPwd    = "C:\Users\chiho\SamsungCertificate\testforqbc\author.pwd"
$distP12      = "C:\Users\chiho\Projects\Platform\Docs\cert\NADO.p12"
$distPwd      = "C:\Users\chiho\Projects\Platform\Docs\cert\NADO.pwd"

foreach ($p in @($profilesXml, $authorP12, $authorPwd, $distP12, $distPwd)) {
    if (-not (Test-Path $p)) { Write-Error "Missing required file: $p"; exit 1 }
}

Write-Host "=== Ensuring signing profile '$signProfile' ===" -ForegroundColor Cyan
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
Write-Host "Profile '$signProfile' written."

# ============================================================
# STEP 1: TypeScript compile -> js/bundle.js
# ============================================================
Write-Host ""
Write-Host "=== STEP 1: Build ===" -ForegroundColor Cyan

Push-Location $src
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing node_modules..."
    npm install 2>&1
}
$buildOut = npm run build 2>&1 | Out-String
Write-Host $buildOut
Pop-Location

if (-not (Test-Path "$src\js\bundle.js")) {
    Write-Error "Build failed - js\bundle.js not found"
    exit 1
}
$bundleKB = [math]::Round((Get-Item "$src\js\bundle.js").Length / 1KB)
Write-Host ("bundle.js: " + $bundleKB + " KB") -ForegroundColor Green

# ============================================================
# STEP 2: Stage files for packaging
# ============================================================
Write-Host ""
Write-Host "=== STEP 2: Stage ===" -ForegroundColor Cyan

if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item $tmp -ItemType Directory | Out-Null

$excludeNames = @(
    'node_modules', 'src', '.sign', '.settings',
    '.project', '.tproject', '.git',
    'vite.config.ts', 'package-lock.json'
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

Write-Host "Staged $((Get-ChildItem $tmp -Recurse -File).Count) files"
Write-Host "bundle.js present:  $(Test-Path "$tmp\js\bundle.js")"

# ============================================================
# STEP 3: Package (sign with testforsbb)
# ============================================================
Write-Host ""
Write-Host "=== STEP 3: Package ===" -ForegroundColor Cyan

Remove-Item "$src\*.wgt" -ErrorAction SilentlyContinue
& $tizen package --type wgt --sign $signProfile -o $src -- $tmp 2>&1

$wgt = Get-ChildItem $src -Filter "*.wgt" | Select-Object -First 1
if (-not $wgt) { Write-Error "Packaging failed -- no WGT produced."; exit 1 }

if ($wgt.Name -ne $wgtName) {
    Rename-Item $wgt.FullName "$src\$wgtName" -Force
    Write-Host "Renamed $($wgt.Name) -> $wgtName"
}
$sizeKB = [math]::Round((Get-Item "$src\$wgtName").Length / 1KB)
Write-Host ("WGT ready: " + $wgtName + " (" + $sizeKB + " KB)")

# ============================================================
# Helper: connect -> uninstall -> install -> launch on one TV
# ============================================================
function Install-SyncTestOnTV {
    param([string]$tv, [string]$label)

    Write-Host ""
    Write-Host "======================================================" -ForegroundColor Cyan
    Write-Host "  TARGET: $label  $tv" -ForegroundColor Cyan
    Write-Host "======================================================" -ForegroundColor Cyan

    Write-Host "--- SDB Connect ---"
    $connectOut = & $sdb connect $tv 2>&1 | Out-String
    Write-Host $connectOut
    if ($connectOut -notmatch "connected to|already connected") {
        Write-Host "WARNING: $label ($tv) not reachable via SDB -- skipping." -ForegroundColor Yellow
        return
    }
    Start-Sleep -Seconds 2

    Write-Host "--- Uninstall NexariHtml5Sync (if present) ---"
    & $tizen uninstall -s $tv -p "NxrHtmlSnc.NexariHtml5Sync" 2>&1 | Out-String | Write-Host
    Start-Sleep -Seconds 3

    Write-Host "--- Uninstall NexariSyncEngine (if present) ---"
    & $tizen uninstall -s $tv -p $appId 2>&1 | Out-String | Write-Host
    Start-Sleep -Seconds 3

    Write-Host "--- Install ---"
    & $tizen install -s $tv -n $wgtName -- $src 2>&1

    Write-Host "--- Launch ---"
    Start-Sleep -Seconds 2
    & $tizen run -s $tv -p $appId 2>&1 | Out-String | Write-Host
}

# ============================================================
# STEP 4: Deploy to both TVs
# ============================================================
Install-SyncTestOnTV -tv $tvQBC -label "QBC"
Install-SyncTestOnTV -tv $tvSBB -label "SBB TV"

Write-Host ""
Write-Host "Done." -ForegroundColor Green
