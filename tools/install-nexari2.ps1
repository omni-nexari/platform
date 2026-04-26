$src   = "C:\Users\chiho\Projects\Platform\apps\nexari-tizen"
$tizen = "C:\tizen-studio\tools\ide\bin\tizen.bat"
$sdb   = "C:\tizen-studio\tools\sdb.exe"
$tv    = "192.168.1.39:26101"
$appId = "fmDBbBnvJM.NexariTizen"
$tmp   = "$env:TEMP\nexari-tizen-build"

# --- 1. BUILD ---
Write-Host "=== STEP 1: Build ==="

if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item $tmp -ItemType Directory | Out-Null

$excludeNames = @(
    'node_modules', 'src', '.sign', '.settings',
    '.project', '.tproject', '.git',
    'vite.config.ts', 'package-lock.json', 'sssp_config.xml'
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

Write-Host "Packaging with testforsbb profile..."
& $tizen package --type wgt --sign testforsbb -o $src -- $tmp 2>&1

$wgt = Get-ChildItem $src -Filter "*.wgt" | Select-Object -First 1
if (-not $wgt) {
    Write-Error "Build failed - no WGT produced. Aborting."
    exit 1
}
if ($wgt.Name -ne "NexariPlayer.wgt") {
    Rename-Item $wgt.FullName "$src\NexariPlayer.wgt" -Force
    Write-Host "Renamed $($wgt.Name) -> NexariPlayer.wgt"
}
$sizeKB = [math]::Round((Get-Item "$src\NexariPlayer.wgt").Length / 1KB)
Write-Host "WGT size: ${sizeKB} KB"

# --- 1b. SDB CONNECT ---
Write-Host ""
Write-Host "=== STEP 1b: SDB Connect ==="
$connectOut = & $sdb connect $tv 2>&1 | Out-String
Write-Host $connectOut
if ($connectOut -notmatch "connected to") {
    Write-Host "WARNING: sdb connect may have failed. Check TV Developer Mode is on and IP is correct." -ForegroundColor Yellow
}
Start-Sleep -Seconds 2

# --- 2. UNINSTALL ---
Write-Host ""
Write-Host "=== STEP 2: Uninstall ==="
foreach ($pkg in @($appId, "yhSyDyxfkq.NexariPlayer", "q6naPUaTRW.NexariPlayer")) {
    Write-Host "Removing $pkg ..."
    & $tizen uninstall -s $tv -p $pkg 2>&1 | Out-String | Write-Host
}
Start-Sleep -Seconds 3

# --- 3. INSTALL ---
Write-Host ""
Write-Host "=== STEP 3: Install ==="
& $tizen install -s $tv -n NexariPlayer.wgt -- $src 2>&1

# --- 4. LAUNCH ---
Write-Host ""
Write-Host "=== STEP 4: Launch ==="
Start-Sleep -Seconds 2
& $tizen run -s $tv -p $appId 2>&1 | Out-String | Write-Host