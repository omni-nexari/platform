# install-nexaritv.ps1 - Build, sign, and deploy nexari-smarttv to a consumer Samsung TV.
# Usage:
#   .\tools\install-nexaritv.ps1                          # deploys to default TV
#   .\tools\install-nexaritv.ps1 -TV 192.168.1.XX:26101   # deploy to a specific TV

param(
    [string]$TV = "192.168.1.36:26101"
)

$src        = "C:\Users\chiho\Projects\Platform\apps\nexari-smarttv"
$tizen      = "C:\tizen-studio\tools\ide\bin\tizen.bat"
$sdb        = "C:\tizen-studio\tools\sdb.exe"
$appId      = "zBkMAo0wLV.Nexritv"
$wgtName    = "NexariTV.wgt"
$tmp        = "$env:TEMP\nexari-smarttv-build"

# --- Certificate files (nexaritv) ---
$certBase     = "C:\Users\chiho\SamsungCertificate\nexaritv"
$signProfile  = "nexaritv-dev"
$profilesXml  = "C:\tizen-studio-data\profile\profiles.xml"
$authorP12    = "$certBase\author.p12"
$authorPwd    = "$certBase\author.pwd"
$distP12      = "$certBase\distributor.p12"
$distPwd      = "$certBase\distributor.pwd"

foreach ($p in @($profilesXml, $authorP12, $authorPwd, $distP12, $distPwd)) {
    if (-not (Test-Path $p)) { Write-Error "Missing required file: $p"; exit 1 }
}

# ============================================================
# STEP 1: Ensure signing profile in profiles.xml
# ============================================================
Write-Host "=== Ensuring Tizen signing profile: $signProfile ===" -ForegroundColor Cyan
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
Write-Host "Profile '$signProfile' written." -ForegroundColor Green

# ============================================================
# STEP 2: Stage files for packaging
# ============================================================
Write-Host ""
Write-Host "=== STEP 2: Stage build ===" -ForegroundColor Cyan

if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item $tmp -ItemType Directory | Out-Null

$excludeNames = @(
    'node_modules', 'src', '.sign', '.settings',
    '.project', '.tproject', '.git',
    'vite.config.ts', 'package.json', 'tsconfig.json', 'package-lock.json'
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

$stagedCount = (Get-ChildItem $tmp -Recurse -File).Count
Write-Host "Staged $stagedCount files"

# ============================================================
# STEP 3: Package + sign WGT
# ============================================================
Write-Host ""
Write-Host "=== STEP 3: Package (sign: $signProfile) ===" -ForegroundColor Cyan
Remove-Item "$src\*.wgt" -ErrorAction SilentlyContinue
& $tizen package --type wgt --sign $signProfile -o $src -- $tmp 2>&1

$wgt = Get-ChildItem $src -Filter "*.wgt" | Select-Object -First 1
if (-not $wgt) {
    Write-Error "Packaging failed - no WGT produced. Check cert paths and profiles.xml."
    exit 1
}
if ($wgt.Name -ne $wgtName) {
    Rename-Item $wgt.FullName "$src\$wgtName" -Force
    Write-Host "Renamed $($wgt.Name) -> $wgtName"
}
Write-Host "WGT ready: $wgtName" -ForegroundColor Green

# ============================================================
# STEP 4: Connect, uninstall, install, launch on TV
# ============================================================
Write-Host ""
Write-Host "=== STEP 4: Deploy to $TV ===" -ForegroundColor Cyan

Write-Host "--- SDB Connect ---"
$connectOut = & $sdb connect $TV 2>&1 | Out-String
Write-Host $connectOut
if ($connectOut -notmatch "connected to|already connected") {
    Write-Host "Cannot reach TV at $TV via SDB." -ForegroundColor Yellow
    Write-Host "Enable Developer Mode: Smart Hub -> Apps -> press Home x5 -> Dev Mode ON" -ForegroundColor Cyan
    Write-Host "WGT is at: $src\$wgtName" -ForegroundColor Cyan
    exit 0
}
Start-Sleep -Seconds 2

Write-Host "--- Uninstall ---"
& $tizen uninstall -s $TV -p $appId 2>&1 | Out-String | Write-Host
Start-Sleep -Seconds 3

Write-Host "--- Install ---"
& $tizen install -s $TV -n $wgtName -- $src 2>&1

Write-Host "--- Launch ---"
Start-Sleep -Seconds 2
& $tizen run -s $TV -p $appId 2>&1 | Out-String | Write-Host

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green