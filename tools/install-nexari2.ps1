$src        = "C:\Users\chiho\Projects\Platform\apps\nexari-tizen"
$tizen      = "C:\tizen-studio\tools\ide\bin\tizen.bat"
$sdb        = "C:\tizen-studio\tools\sdb.exe"
$tvQBC      = "192.168.1.11:26101"
$tvSBB      = "192.168.1.39:26101"
$appId      = "fmDBbBnvJM.NexariTizen"
$pi         = "chiho@192.168.1.17"
$tmp        = "$env:TEMP\nexari-tizen-build"

# --- Production signing profile ---
# Reuses the existing testforqbc AUTHOR cert and pairs it with the prod NADO.p12 DISTRIBUTOR cert.
$signProfile  = "nado-prod"
$profilesXml  = "C:\tizen-studio-data\profile\profiles.xml"
$authorP12    = "C:\Users\chiho\SamsungCertificate\testforqbc\author.p12"
$authorPwd    = "C:\Users\chiho\SamsungCertificate\testforqbc\author.pwd"
$distP12      = "C:\Users\chiho\Projects\Platform\Docs\cert\NADO.p12"
$distPwd      = "C:\Users\chiho\Projects\Platform\Docs\cert\NADO.pwd"

foreach ($p in @($profilesXml, $authorP12, $authorPwd, $distP12, $distPwd)) {
    if (-not (Test-Path $p)) { Write-Error "Missing required file: $p"; exit 1 }
}

Write-Host "=== Ensuring Tizen signing profile '$signProfile' (testforqbc author + NADO.p12 dist) ==="
[xml]$xml = Get-Content $profilesXml
$root = $xml.profiles
# Remove any existing profile with this name so we can re-add cleanly
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
# SSSP compares <ver> against the installed app version — if
# they match no update is triggered, even if the WGT changed.
# Bumping patch on every build guarantees SSSP always detects
# a new version and installs the updated WGT after reboot.
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

# Sync config.xml widget version attribute to match
# IMPORTANT: Read with explicit UTF-8 to prevent double-encoding corruption of
# any non-ASCII characters in the file (PowerShell default encoding is CP1252).
$configXmlPath = "$src\config.xml"
$configXmlContent = [System.IO.File]::ReadAllText($configXmlPath, [System.Text.UTF8Encoding]::new($false))
$configXmlContent = $configXmlContent -replace '(<widget\s[^>]*version=")[^"]*(")', "`${1}$appVerNew`${2}"
[System.IO.File]::WriteAllText($configXmlPath, $configXmlContent, [System.Text.UTF8Encoding]::new($false))
Write-Host "Version bumped: $appVerNew (package.json + config.xml)"

# ============================================================
# STEP 1: BUILD + PACKAGE (once, shared for both TVs)
# ============================================================
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

# Run build:dev to regenerate build-info.js with LAN API URL (Pi at 192.168.1.17)
Write-Host "Running npm run build:dev..."
Push-Location $src
try {
    npm run build:dev 2>&1 | Write-Host
    if ($LASTEXITCODE -ne 0) { throw "npm run build:dev failed" }
} finally {
    Pop-Location
}

# Re-copy all compiled js/ output (regenerated by build:dev via tsc)
Copy-Item "$src\js" "$tmp\js" -Recurse -Force

Write-Host "Packaging with $signProfile profile..."
& $tizen package --type wgt --sign $signProfile -o $src -- $tmp 2>&1

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

# Update sssp_config.xml with the exact byte-size AND current version
$wgtBytes   = (Get-Item "$src\NexariPlayer.wgt").Length
$appVer     = (Get-Content "$src\package.json" -Raw | ConvertFrom-Json).version
$ssspConfig = "$src\sssp_config.xml"
$ssspXml    = Get-Content $ssspConfig -Raw
$ssspXml    = $ssspXml -replace '<size>\d+</size>',      "<size>$wgtBytes</size>"
$ssspXml    = $ssspXml -replace '<ver>[^<]*</ver>',       "<ver>$appVer</ver>"
[System.IO.File]::WriteAllText($ssspConfig, $ssspXml, [System.Text.UTF8Encoding]::new($false))
Write-Host "Updated sssp_config.xml: <ver>$appVer</ver>  <size>$wgtBytes</size>"

# ============================================================
# STEP 1c: DEPLOY TO PI SERVER
# ============================================================
Write-Host ""
Write-Host "=== STEP 1c: Deploy WGT to Pi server ($pi) ==="
$piTizenDir = "/var/signage/tizen"
scp "$src\NexariPlayer.wgt" "${pi}:${piTizenDir}/NexariPlayer.wgt"
if ($LASTEXITCODE -ne 0) { Write-Error "WGT SCP failed - check SSH access to $pi. Aborting."; exit 1 }
scp "$src\sssp_config.xml" "${pi}:${piTizenDir}/sssp_config.xml"
if ($LASTEXITCODE -ne 0) { Write-Error "sssp_config.xml SCP failed. Aborting."; exit 1 }
Write-Host "Pi server updated: http://192.168.1.17/tizen/NexariPlayer.wgt"

# ============================================================
# Helper function: connect, uninstall, install, launch one TV
# ============================================================
function Install-NexariOnTV {
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
        Write-Host "WARNING: $label ($tv) is not reachable via SDB (likely not in developer mode)." -ForegroundColor Yellow
        Write-Host "Pi already has the latest build. To update the TV manually:" -ForegroundColor Yellow
        Write-Host "  1. On the TV: Settings > General > System Manager > URL Launcher Settings" -ForegroundColor Cyan
        Write-Host "  2. Enter URL: http://192.168.1.17/tizen/sssp_config.xml" -ForegroundColor Cyan
        Write-Host "  3. The TV will detect the new version and install it automatically." -ForegroundColor Cyan
        return
    }
    Start-Sleep -Seconds 2

    # UNINSTALL
    Write-Host ""
    Write-Host "--- Uninstall ---"
    foreach ($pkg in @($appId, "yhSyDyxfkq.NexariPlayer", "q6naPUaTRW.NexariPlayer")) {
        Write-Host "Removing $pkg ..."
        & $tizen uninstall -s $tv -p $pkg 2>&1 | Out-String | Write-Host
    }
    Start-Sleep -Seconds 3

    # INSTALL
    Write-Host ""
    Write-Host "--- Install ---"
    & $tizen install -s $tv -n NexariPlayer.wgt -- $src 2>&1

    # LAUNCH
    Write-Host ""
    Write-Host "--- Launch ---"
    Start-Sleep -Seconds 2
    & $tizen run -s $tv -p $appId 2>&1 | Out-String | Write-Host
}

# ============================================================
# Helper function: send Samsung MDC reboot command over TCP
#   Packet: 0xAA 0x11 0xFE 0x01 0x02 0x12
#   (Header=0xAA, Cmd=0x11/Power, ID=0xFE, Len=0x01, Data=0x02/Reboot, Checksum=0x12)
# ============================================================
function Send-MdcReboot {
    param([string]$ip, [string]$label)
    $port    = 1515
    $packet  = [byte[]](0xAA, 0x11, 0xFE, 0x01, 0x02, 0x12)
    Write-Host ""
    Write-Host "--- MDC Reboot -> $label ($ip) ---"
    try {
        $tcp    = [System.Net.Sockets.TcpClient]::new()
        $conn   = $tcp.BeginConnect($ip, $port, $null, $null)
        $ok     = $conn.AsyncWaitHandle.WaitOne(3000)
        if (-not $ok) { $tcp.Close(); throw "Timed out connecting to ${ip}:${port}" }
        $tcp.EndConnect($conn)
        $stream = $tcp.GetStream()
        $stream.Write($packet, 0, $packet.Length)
        $stream.Flush()

        # Read ACK: 0xAA 0xFF <ID> 0x03 'A'(0x41) 0x11 <Power> <checksum>
        $stream.ReadTimeout = 3000
        $ackBuf = [byte[]]::new(16)
        try {
            $read = $stream.Read($ackBuf, 0, $ackBuf.Length)
            if ($read -ge 5 -and $ackBuf[0] -eq 0xAA -and $ackBuf[1] -eq 0xFF -and $ackBuf[4] -eq 0x41) {
                Write-Host "$label ACK received - reboot accepted." -ForegroundColor Green
            } elseif ($read -ge 5 -and $ackBuf[0] -eq 0xAA -and $ackBuf[1] -eq 0xFF -and $ackBuf[4] -eq 0x4E) {
                Write-Host "WARNING: $label NAK received - TV rejected the reboot command." -ForegroundColor Yellow
            } else {
                Write-Host "$label reboot command sent (no ACK parsed)." -ForegroundColor Green
            }
        } catch {
            # ReadTimeout - TV didn't respond but command was delivered
            Write-Host "$label reboot command sent (no ACK within 3s - TV may be rebooting)." -ForegroundColor Green
        }

        $tcp.Close()
    } catch {
        Write-Host "WARNING: Could not send MDC reboot to $label (${ip}:${port}) - $_" -ForegroundColor Yellow
        Write-Host "  Check that the TV is powered on and MDC is enabled (port 1515)." -ForegroundColor Yellow
    }
}

# ============================================================
# STEP 2: DEPLOY TO QBC (192.168.1.11)
# ============================================================
Install-NexariOnTV -tv $tvQBC -label "QBC"

# ============================================================
# STEP 3: DEPLOY TO SBB TV (192.168.1.39)
# ============================================================
Install-NexariOnTV -tv $tvSBB -label "SBB TV"

# ============================================================
# STEP 4: OPTIONAL REBOOT (triggers SSSP auto-update on boot)
# ============================================================
Write-Host ""
Write-Host "Pi has the latest build ($appVer). Rebooting a screen will trigger SSSP" -ForegroundColor Cyan
Write-Host "auto-update if the version in sssp_config.xml is newer than what is installed." -ForegroundColor Cyan
Write-Host ""
$rebootChoice = Read-Host "Reboot screens via MDC? [A]ll / [Q]BC only / [S]BB only / [N]o"
switch ($rebootChoice.Trim().ToUpper()) {
    "A" {
        Send-MdcReboot -ip "192.168.1.11" -label "QBC"
        Send-MdcReboot -ip "192.168.1.39" -label "SBB TV"
    }
    "Q" { Send-MdcReboot -ip "192.168.1.11" -label "QBC" }
    "S" { Send-MdcReboot -ip "192.168.1.39" -label "SBB TV" }
    default { Write-Host "Skipping reboot." }
}

Write-Host ""
Write-Host "=== All done. ===" -ForegroundColor Green