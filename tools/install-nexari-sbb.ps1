param(
    [string]$tv   = "192.168.1.39:26101",
    [string]$sign = "testforsbb"
)

$src   = "C:\Users\chiho\Projects\Platform\apps\nexariSBBplayer"
$tizen = "C:\tizen-studio\tools\ide\bin\tizen.bat"
$sdb   = "C:\tizen-studio\tools\sdb.exe"
$appId = "bhMcQA2FmL.NexariSBBPlayer"
$tmp   = "$env:TEMP\nexari-sbb-build"

# --- 1. STAGE + PACKAGE ---
Write-Host "=== STEP 1: Package with $sign profile ==="

if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item $tmp -ItemType Directory | Out-Null

$excludeNames = @('.sign', '.settings', '.project', '.tproject', '.manifest.tmp')
foreach ($item in Get-ChildItem $src) {
    if ($excludeNames -contains $item.Name) { continue }
    if ($item.Extension -eq '.wgt') { continue }
    if ($item.PSIsContainer) {
        Copy-Item $item.FullName "$tmp\$($item.Name)" -Recurse
    } else {
        Copy-Item $item.FullName $tmp
    }
}
Write-Host "Staged $((Get-ChildItem $tmp -Recurse -File).Count) files"

Remove-Item "$src\*.wgt" -ErrorAction SilentlyContinue

& $tizen package --type wgt --sign $sign -o $src -- $tmp 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Packaging failed (exit $LASTEXITCODE)"
    exit 1
}

$wgtItem = Get-ChildItem $src -Filter "*.wgt" | Select-Object -First 1
if (-not $wgtItem) {
    Write-Error "No .wgt produced after packaging"
    exit 1
}
# Rename to remove spaces so the tizen CLI receives a clean filename
$wgtSafe = $wgtItem.Name -replace '\s+', '-'
if ($wgtSafe -ne $wgtItem.Name) {
    Rename-Item $wgtItem.FullName "$src\$wgtSafe" -Force
    Write-Host "Renamed to: $wgtSafe"
}
$wgtName = $wgtSafe
$wgtKB   = [math]::Round((Get-Item "$src\$wgtName").Length / 1024)
Write-Host "Packaged: $wgtName - ${wgtKB}KB"

# --- 2. SDB CONNECT ---
Write-Host ""
Write-Host "=== STEP 2: SDB Connect to $tv ==="
$connectOut = & $sdb connect $tv 2>&1 | Out-String
Write-Host $connectOut
Start-Sleep -Seconds 2

# --- 3. UNINSTALL ---
Write-Host ""
Write-Host "=== STEP 3: Uninstall previous version ==="
& $tizen uninstall -s $tv -p $appId 2>&1 | Out-String | Write-Host
Start-Sleep -Seconds 2

# --- 4. INSTALL ---
Write-Host ""
Write-Host "=== STEP 4: Install $wgtName ==="
& $tizen install -s $tv -n $wgtName -- $src 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Install failed with exit code $LASTEXITCODE"
    exit 1
}
Start-Sleep -Seconds 3

# --- 5. LAUNCH ---
Write-Host ""
Write-Host "=== STEP 5: Launch $appId ==="
& $tizen run -s $tv -p $appId 2>&1 | Out-String | Write-Host

Write-Host ""
Write-Host "Done."
