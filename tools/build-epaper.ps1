# build-epaper.ps1 — Build the nexari-epaper Tizen .wgt
# Mirrors tools/build-nexari.ps1 but targets apps/nexari-epaper.
$src = "C:\Users\chiho\Projects\Platform\apps\nexari-epaper"
$out = $src
$tmp = "$env:TEMP\nexari-epaper-build"

if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item $tmp -ItemType Directory | Out-Null

# Exclude: IDE dirs, build artifacts, source-only files, existing wgt files
$excludeNames = @(
    'node_modules', 'src', '.sign', '.settings',
    '.project', '.tproject', '.git',
    'vite.config.ts', 'package-lock.json',
    'sssp_config.xml'
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

Write-Host "=== Temp dir contents ==="
Get-ChildItem $tmp | Select-Object Name | Format-Table -AutoSize
Write-Host "Total files: $((Get-ChildItem $tmp -Recurse -File).Count)"
Write-Host ""

# Sign profile: reuse same signing profile as nexari-tizen unless overridden
$SignProfile = if ($env:EPAPER_SIGN_PROFILE) { $env:EPAPER_SIGN_PROFILE } else { 'testforsbb' }

Write-Host "=== Building NexariEpaper with profile: $SignProfile ==="
& C:\tizen-studio\tools\ide\bin\tizen.bat package --type wgt --sign $SignProfile -o $out -- $tmp 2>&1

Write-Host ""
# Tizen names the WGT after the application name. Normalise to NexariEpaper.wgt.
$candidates = Get-ChildItem $out -Filter "Nexari*.wgt" | Where-Object { $_.Name -ne 'NexariEpaper.wgt' -and $_.Name -ne 'NexariPlayer.wgt' }
foreach ($c in $candidates) {
    $target = Join-Path $out 'NexariEpaper.wgt'
    Rename-Item $c.FullName $target -Force
    Write-Host "Renamed $($c.Name) -> NexariEpaper.wgt"
}

Get-ChildItem $out -Filter "NexariEpaper.wgt" | Select-Object Name, @{N='KB';E={[math]::Round($_.Length/1KB)}} | Format-Table -AutoSize
