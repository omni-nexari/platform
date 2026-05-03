# Deploy sync-test Tizen app to both TVs using tizen.bat
# Usage: powershell -ExecutionPolicy Bypass -File .\tools\deploy-sync-test.ps1

$appDir      = (Resolve-Path "$PSScriptRoot\..\apps\nexari-sync-test").Path
$tizen       = "C:\tizen-studio\tools\ide\bin\tizen.bat"
$sdb         = "C:\tizen-studio\tools\sdb.exe"
$appId       = "SyncTest01.SyncTest"
$tvQBC       = "192.168.1.11:26101"
$tvSBB       = "192.168.1.39:26101"

$signProfile = "nado-prod"
$profilesXml = "C:\tizen-studio-data\profile\profiles.xml"
$authorP12   = "C:\Users\chiho\SamsungCertificate\testforqbc\author.p12"
$authorPwd   = "C:\Users\chiho\SamsungCertificate\testforqbc\author.pwd"
$distP12     = "C:\Users\chiho\Projects\Platform\Docs\cert\NADO.p12"
$distPwd     = "C:\Users\chiho\Projects\Platform\Docs\cert\NADO.pwd"

foreach ($p in @($profilesXml, $authorP12, $authorPwd, $distP12, $distPwd)) {
    if (-not (Test-Path $p)) { Write-Error "Missing: $p"; exit 1 }
}

Write-Host "=== sync-test deploy (QBC + SBB) ===" -ForegroundColor Cyan

# ── 0. Signing profile ──────────────────────────────────────────────────────
Write-Host "`n[0/3] Writing signing profile '$signProfile'..." -ForegroundColor Yellow
[xml]$xml = Get-Content $profilesXml
$root = $xml.profiles
$existing = $root.profile | Where-Object { $_.name -eq $signProfile }
if ($existing) { [void]$root.RemoveChild($existing) }
$prof = $xml.CreateElement("profile"); $prof.SetAttribute("name", $signProfile)
$a = $xml.CreateElement("profileitem")
$a.SetAttribute("ca",""); $a.SetAttribute("distributor","0")
$a.SetAttribute("key",$authorP12); $a.SetAttribute("password",$authorPwd); $a.SetAttribute("rootca","")
[void]$prof.AppendChild($a)
$d1 = $xml.CreateElement("profileitem")
$d1.SetAttribute("ca",""); $d1.SetAttribute("distributor","1")
$d1.SetAttribute("key",$distP12); $d1.SetAttribute("password",$distPwd); $d1.SetAttribute("rootca","")
[void]$prof.AppendChild($d1)
$d2 = $xml.CreateElement("profileitem")
$d2.SetAttribute("ca",""); $d2.SetAttribute("distributor","2")
$d2.SetAttribute("key",""); $d2.SetAttribute("password",""); $d2.SetAttribute("rootca","")
[void]$prof.AppendChild($d2)
[void]$root.AppendChild($prof)
$root.SetAttribute("active", $signProfile)
$xml.Save($profilesXml)
Write-Host "Profile ready." -ForegroundColor Green

# ── 1. Package & sign ───────────────────────────────────────────────────────
Write-Host "`n[1/3] Packaging WGT..." -ForegroundColor Yellow
Remove-Item "$appDir\*.wgt" -ErrorAction SilentlyContinue
& $tizen package --type wgt --sign $signProfile -o $appDir -- $appDir 2>&1
$wgt = Get-ChildItem $appDir -Filter "*.wgt" | Select-Object -First 1
if (-not $wgt) { Write-Error "Packaging failed - no WGT produced."; exit 1 }
Write-Host "WGT: $($wgt.Name)  ($([math]::Round($wgt.Length/1KB)) KB)" -ForegroundColor Green

# ── 2. Deploy helper ────────────────────────────────────────────────────────
function Deploy-TV {
    param([string]$tv, [string]$label)
    Write-Host "`n====== $label ($tv) ======" -ForegroundColor Cyan

    & $sdb connect $tv
    Start-Sleep -Seconds 2

    Write-Host "  Uninstalling..." -ForegroundColor Yellow
    & $tizen uninstall -s $tv -p $appId 2>&1 | Write-Host
    Start-Sleep -Seconds 3

    Write-Host "  Installing..." -ForegroundColor Yellow
    & $tizen install -s $tv -n $wgt.Name -- $appDir 2>&1
    Start-Sleep -Seconds 3

    Write-Host "  Launching..." -ForegroundColor Yellow
    & $tizen run -s $tv -p $appId 2>&1 | Write-Host
}

# ── 3. Deploy to both TVs ───────────────────────────────────────────────────
Write-Host "`n[2/3] Deploy to QBC..." -ForegroundColor Yellow
Deploy-TV -tv $tvQBC -label "QBC"

Write-Host "`n[3/3] Deploy to SBB..." -ForegroundColor Yellow
Deploy-TV -tv $tvSBB -label "SBB"

Write-Host "`n=== Done ===" -ForegroundColor Green
