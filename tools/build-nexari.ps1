$src = "C:\Users\chiho\Projects\Platform\apps\nexari-tizen"
$out = $src
$tmp = "$env:TEMP\nexari-tizen-build"

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

Write-Host "=== Building NexariTizen with testforsbb profile ==="
& C:\tizen-studio\tools\ide\bin\tizen.bat package --type wgt --sign testforsbb -o $out -- $tmp 2>&1

Write-Host ""
# Rename output (Tizen uses app name for filename, which may have capital variations)
$spaced = "$out\Nexariplayer.wgt"
$target = "$out\NexariPlayer.wgt"
if (Test-Path $spaced) {
    Rename-Item $spaced $target -Force
    Write-Host "Renamed to NexariPlayer.wgt"
}

Get-ChildItem $out -Filter "*.wgt" | Select-Object Name, @{N='KB';E={[math]::Round($_.Length/1KB)}} | Format-Table -AutoSize
