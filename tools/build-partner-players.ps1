#Requires -Version 5.1
<#
.SYNOPSIS
    Build per-partner Nexari player apps (Tizen SSSP, ePaper, Android)
    with the partner's instance URL baked in, then upload to the server
    and register in the nexari-admin player_builds table.

.DESCRIPTION
    Fetches all partners from the nexari-admin API, shows a numbered list,
    lets you pick one, then builds the selected platforms using the partner's
    instanceUrl (captured automatically from heartbeats).

    Platforms built:
      tizen   -- NexariPlayer.wgt  (Tizen SSSP commercial display)
      epaper  -- NexariEPaper.wgt  (Samsung ePaper display)
      android -- nexari-android.apk

    Generic platforms (Windows, ESP32) do not need per-partner builds.
    Register them once using -RegisterGeneric.

.PARAMETER AdminEmail
    Email address for nexari-admin API authentication.

.PARAMETER AdminPassword
    Admin password. Prompted if omitted.

.PARAMETER AdminApiBase
    nexari-admin API base URL. Default: https://admin.nexari.ca/api/v1

.PARAMETER Platform
    Limit to one platform: tizen, epaper, android. Default: all three.

.PARAMETER PiHost
    Hostname/IP of the server where artifacts are uploaded.

.PARAMETER PiUser
    SSH user on the server. Default: chiho

.PARAMETER SshPort
    SSH port. Default: 5551

.PARAMETER SkipBuild
    Skip the actual build step -- just re-upload and re-register an existing artifact.

.PARAMETER RegisterGeneric
    Register the current Windows installer and ESP32 firmware as generic builds
    for the selected partner (no rebuild -- uses existing files on server).

.EXAMPLE
    # Interactive -- pick partner from list, build all platforms:
    .\tools\build-partner-players.ps1

    # Tizen only:
    .\tools\build-partner-players.ps1 -Platform tizen

    # Skip build, just re-register existing artifacts:
    .\tools\build-partner-players.ps1 -SkipBuild
#>
param(
    [string]$AdminEmail    = "chiho.lee23@gmail.com",
    [string]$AdminPassword = "",
    [string]$AdminApiBase  = "https://admin.nexari.ca/api/v1",

    [ValidateSet("", "tizen", "epaper", "android", "windows", "esp32")]
    [string]$Platform = "",

    # Admin server (nexari-admin) — used for API calls (and SCP if same machine)
    [string]$PiHost    = "192.168.1.17",
    [string]$PiUser    = "chiho",
    [int]$SshPort      = 5551,

    # Platform server — where Docker nginx serves /tizen/, /android/, etc.
    # Defaults to the same machine as the admin server.
    [string]$PlatformSshHost = "",
    [string]$PlatformSshUser = "",
    [int]$PlatformSshPort    = 0,

    # Path to a pre-built Windows installer (required when -Platform windows)
    [string]$WindowsInstallerPath = "",
    # Path to a pre-built ESP32 firmware .bin (required when -Platform esp32)
    [string]$Esp32BinPath = "",

    [switch]$SkipBuild,
    [switch]$RegisterGeneric
)

$ErrorActionPreference = "Stop"
$RepoRoot     = Split-Path -Parent $PSScriptRoot
$TizenDir     = Join-Path $RepoRoot "apps\nexari-tizen"
$EpaperDir    = Join-Path $RepoRoot "apps\nexari-epaper"
$AndroidDir   = Join-Path $RepoRoot "apps\nexari-android"
$TizenCli     = "C:\tizen-studio\tools\ide\bin\tizen.bat"
$SignProfile   = "nado-prod"

# ── Auth to nexari-admin API ──────────────────────────────────────────────────
if ($AdminPassword -eq "") {
    $secPwd = Read-Host "Admin password for $AdminEmail" -AsSecureString
    $AdminPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPwd))
}

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$loginBody = @{ email = $AdminEmail; password = $AdminPassword } | ConvertTo-Json -Compress
try {
    $null = Invoke-WebRequest -Method Post `
        -Uri "$AdminApiBase/auth/login" `
        -ContentType "application/json" `
        -Body $loginBody `
        -WebSession $session `
        -UseBasicParsing
} catch {
    Write-Error "Login failed: $_"
    exit 1
}
$csrfToken = $session.Cookies.GetCookies("https://admin.nexari.ca/") |
    Where-Object { $_.Name -eq 'sa_csrf_token' } |
    Select-Object -First 1 -ExpandProperty Value
if (-not $csrfToken) {
    # Dump all cookies to help diagnose
    $allCookies = $session.Cookies.GetCookies("https://admin.nexari.ca/")
    Write-Warning "sa_csrf_token not found. Cookies present: $($allCookies | ForEach-Object { $_.Name })"
}
Write-Host "Logged in as $AdminEmail" -ForegroundColor Green

function Invoke-AdminApi {
    param([string]$Method, [string]$Path, [object]$Body = $null)
    $params = @{
        Method      = $Method
        Uri         = "$AdminApiBase$Path"
        WebSession  = $session
        Headers     = @{ 'X-CSRF-Token' = $csrfToken }
        UseBasicParsing = $true
    }
    if ($Body) {
        $params.ContentType = "application/json"
        $params.Body = ($Body | ConvertTo-Json -Compress)
    }
    try {
        (Invoke-RestMethod @params)
    } catch {
        $statusCode = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { 0 }
        $body = try { $_.ErrorDetails.Message } catch { $_.Exception.Message }
        Write-Error "API $Method $Path -> $statusCode : $body"
        throw
    }
}

# ── Fetch partner list ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Fetching partners..." -ForegroundColor Cyan
$resp = Invoke-AdminApi -Method Get -Path "/partners"
$allPartners = $resp.partners

$partnerInfos = @($allPartners | ForEach-Object {
    [PSCustomObject]@{
        Id           = $_.id
        Name         = $_.name
        Status       = $_.status
        InstanceUrl  = $_.instanceUrl
        LicenseKeyId = $_.licenseKeyId
    }
})

# ── Partner picker ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Partners:" -ForegroundColor White
for ($i = 0; $i -lt $partnerInfos.Count; $i++) {
    $pi = $partnerInfos[$i]
    $urlDisplay = if ($pi.InstanceUrl) { $pi.InstanceUrl } else { "⚠  no instance URL (no heartbeat yet)" }
    $idx = ($i + 1).ToString().PadLeft(3)
    Write-Host "  $idx.  $($pi.Name.PadRight(30)) $urlDisplay"
}

Write-Host ""
$pick = Read-Host "Pick a partner [1-$($partnerInfos.Count)]"
$idx = [int]$pick - 1
if ($idx -lt 0 -or $idx -ge $partnerInfos.Count) { Write-Error "Invalid selection."; exit 1 }

$partner = $partnerInfos[$idx]
if (-not $partner.InstanceUrl -and -not $SkipBuild) {
    Write-Error "No instance URL for $($partner.Name). Wait for their platform to send a heartbeat."
    exit 1
}

$instanceUrl = $partner.InstanceUrl
$wsUrl = if ($instanceUrl) {
    $instanceUrl -replace '^https://', 'wss://' -replace '^http://', 'ws://'
} else { "" }
$apiBase = "$instanceUrl/api/v1"

Write-Host ""
Write-Host "Building for: $($partner.Name)" -ForegroundColor Cyan
if ($instanceUrl) { Write-Host "  Instance: $instanceUrl" }

# ── SSH targets ───────────────────────────────────────────────────────────────
# Admin server (for API calls, used with $PiHost/$SshPort)
$SshTarget   = "$PiUser@$PiHost"
$sshPortArgs = @("-p", $SshPort)

# Platform server — where /var/nexari/player-builds/ lives inside Docker.
# Defaults to the same machine as the admin server.
$platSshHost = if ($PlatformSshHost -ne "") { $PlatformSshHost } else { $PiHost }
$platSshUser = if ($PlatformSshUser -ne "") { $PlatformSshUser } else { $PiUser }
$platSshPort = if ($PlatformSshPort -ne 0)  { $PlatformSshPort }  else { $SshPort }
$PlatformSshTarget  = "${platSshUser}@${platSshHost}"
$RemoteBuildsRoot    = "/var/nexari/player-builds"

function Register-Build {
    param([string]$Plat, [string]$Filename, [string]$Ver, [string]$BldUuid)
    # Download URL points to the partner's own platform instance URL.
    # The file is served by the platform nginx at /{platform}/{filename}.
    $dlUrl = "$instanceUrl/$Plat/$Filename"
    $body = @{
        partnerId        = $partner.Id
        licenseKeyId     = $partner.LicenseKeyId
        platform         = $Plat
        instanceUrl      = $instanceUrl
        version          = $Ver
        artifactFilename = $Filename
        downloadUrl      = $dlUrl
        builtBy          = $AdminEmail
    }
    if (-not $partner.LicenseKeyId) { $body.Remove('licenseKeyId') }
    $result = Invoke-AdminApi -Method Post -Path "/player-builds" -Body $body
    Write-Host "  Registered build id=$($result.build.id)" -ForegroundColor DarkGray
    return $dlUrl
}

$platforms = if ($Platform -ne "") { @($Platform) } else { @("tizen", "epaper", "android", "windows", "esp32") }

foreach ($plat in $platforms) {
    Write-Host ""
    Write-Host "=== $($plat.ToUpper()) ===" -ForegroundColor Yellow

    switch ($plat) {

        "tizen" {
            if (-not $SkipBuild) {
                Write-Host "  Building Tizen SSSP WGT..."
                Push-Location $TizenDir
                try {
                    npm version patch --no-git-tag-version | Out-Null
                    $env:API_BASE = $apiBase
                    $env:WS_URL   = $wsUrl
                    node scripts/generate-build-info.cjs
                    npm run build 2>&1 | Out-Null

                    # Stage + package (mirrors deploy-tizen.ps1)
                    $tmp = "$env:TEMP\nexari-tizen-partner"
                    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
                    New-Item $tmp -ItemType Directory | Out-Null
                    $excludeNames = @('node_modules','src','.sign','.settings','.project','.tproject','.git','vite.config.ts','package-lock.json','sssp_config.xml','js')
                    foreach ($item in Get-ChildItem $TizenDir) {
                        if ($excludeNames -contains $item.Name -or $item.Extension -eq '.wgt' -or $item.Name -eq '.manifest.tmp') { continue }
                        if ($item.PSIsContainer) { Copy-Item $item.FullName "$tmp\$($item.Name)" -Recurse }
                        else { Copy-Item $item.FullName $tmp }
                    }
                    Copy-Item "$TizenDir\js" "$tmp\js" -Recurse -Force
                    Remove-Item "$TizenDir\*.wgt" -ErrorAction SilentlyContinue
                    & $TizenCli package --type wgt --sign $SignProfile -o $TizenDir -- $tmp 2>&1 | Out-Null
                    $wgt = Get-ChildItem $TizenDir -Filter '*.wgt' | Select-Object -First 1
                    if (-not $wgt) { throw "Tizen package failed -- no WGT produced" }
                    if ($wgt.Name -ne 'NexariPlayer.wgt') { Rename-Item $wgt.FullName "$TizenDir\NexariPlayer.wgt" -Force }
                    $env:API_BASE = $null; $env:WS_URL = $null
                } finally { Pop-Location }
            }
            $ver = (Get-Content "$TizenDir\package.json" -Raw | ConvertFrom-Json).version
            # Update sssp_config.xml with current version + WGT byte-size
            Push-Location $TizenDir
            npm run pack:sssp 2>&1 | Out-Null  # warns about /var/signage/tizen not existing on Windows, that's fine
            Pop-Location
            ssh -p $platSshPort $PlatformSshTarget "mkdir -p $RemoteBuildsRoot/tizen"
            scp -P $platSshPort "$TizenDir\NexariPlayer.wgt" "$TizenDir\sssp_config.xml" "${PlatformSshTarget}:${RemoteBuildsRoot}/tizen/"
            Register-Build -Plat tizen -Filename "NexariPlayer.wgt" -Ver $ver -BldUuid ""
            Write-Host "  Done. v$ver  SSSP: $instanceUrl/tizen/sssp_config.xml" -ForegroundColor Green
        }

        "epaper" {
            if (-not $SkipBuild) {
                Write-Host "  Building ePaper WGT..."
                Push-Location $EpaperDir
                try {
                    npm version patch --no-git-tag-version | Out-Null
                    $env:API_BASE = $apiBase
                    $env:WS_URL   = $wsUrl
                    node scripts/generate-build-info.cjs

                    $tmp = "$env:TEMP\nexari-epaper-partner"
                    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
                    New-Item $tmp -ItemType Directory | Out-Null
                    $excludeNames = @('node_modules','src','.sign','.settings','.project','.tproject','.git','vite.config.ts','package-lock.json','sssp_config.xml','js')
                    foreach ($item in Get-ChildItem $EpaperDir) {
                        if ($excludeNames -contains $item.Name -or $item.Extension -eq '.wgt' -or $item.Name -eq '.manifest.tmp') { continue }
                        if ($item.PSIsContainer) { Copy-Item $item.FullName "$tmp\$($item.Name)" -Recurse }
                        else { Copy-Item $item.FullName $tmp }
                    }
                    Copy-Item "$EpaperDir\js" "$tmp\js" -Recurse -Force
                    Remove-Item "$EpaperDir\*.wgt" -ErrorAction SilentlyContinue
                    & $TizenCli package --type wgt --sign $SignProfile -o $EpaperDir -- $tmp 2>&1 | Out-Null
                    $wgt = Get-ChildItem $EpaperDir -Filter '*.wgt' | Select-Object -First 1
                    if (-not $wgt) { throw "ePaper package failed -- no WGT produced" }
                    if ($wgt.Name -ne 'NexariEPaper.wgt') { Rename-Item $wgt.FullName "$EpaperDir\NexariEPaper.wgt" -Force }
                    $env:API_BASE = $null; $env:WS_URL = $null
                } finally { Pop-Location }
            }
            $ver = (Get-Content "$EpaperDir\package.json" -Raw | ConvertFrom-Json).version
            # Patch sssp_config.xml with current version + WGT byte-size (same as deploy-epaper.ps1)
            $epaperSsspPath = "$EpaperDir\sssp_config.xml"
            $wgtBytes = (Get-Item "$EpaperDir\NexariEPaper.wgt").Length
            $ssspXml = [System.IO.File]::ReadAllText($epaperSsspPath)
            $ssspXml = $ssspXml -replace '<size>\d+</size>', "<size>$wgtBytes</size>"
            $ssspXml = $ssspXml -replace '<ver>[^<]*</ver>', "<ver>$ver</ver>"
            [System.IO.File]::WriteAllText($epaperSsspPath, $ssspXml)
            Write-Host "  sssp_config.xml: <ver>$ver</ver> <size>$wgtBytes</size>" -ForegroundColor DarkGray
            ssh -p $platSshPort $PlatformSshTarget "mkdir -p $RemoteBuildsRoot/epaper"
            scp -P $platSshPort "$EpaperDir\NexariEPaper.wgt" "$EpaperDir\sssp_config.xml" "${PlatformSshTarget}:${RemoteBuildsRoot}/epaper/"
            Register-Build -Plat epaper -Filename "NexariEPaper.wgt" -Ver $ver -BldUuid ""
            Write-Host "  Done. v$ver  SSSP: $instanceUrl/epaper/sssp_config.xml" -ForegroundColor Green
        }

        "android" {
            if (-not $SkipBuild) {
                Write-Host "  Building Android APK..."
                Push-Location $AndroidDir
                try {
                    npm version patch --no-git-tag-version | Out-Null
                    $newVer = (Get-Content "$AndroidDir\package.json" -Raw | ConvertFrom-Json).version
                    $parts = $newVer -split '\.'
                    $vCode = [int]$parts[0] * 10000 + [int]$parts[1] * 100 + [int]$parts[2]
                    $gradleFile = "android\app\build.gradle.kts"
                    $gc = Get-Content $gradleFile -Raw
                    $gc = $gc -replace '(versionCode\s*=\s*)\d+', "`${1}$vCode"
                    $gc = $gc -replace '(versionName\s*=\s*)"[^"]+"', "`${1}`"$newVer`""
                    Set-Content $gradleFile $gc -Encoding UTF8

                    Push-Location "android"
                    .\gradlew.bat assembleSelfRelease `
                        "-PpartnerApiBase=$apiBase" `
                        "-PpartnerWsBase=$wsUrl"
                    if ($LASTEXITCODE -ne 0) { throw "Gradle assembleSelfRelease failed" }
                    Pop-Location
                } finally { Pop-Location }
            }
            $ver = (Get-Content "$AndroidDir\package.json" -Raw | ConvertFrom-Json).version
            $ApkSrc = "$AndroidDir\android\app\build\outputs\apk\self\release\app-self-release.apk"
            if (-not (Test-Path $ApkSrc)) { Write-Error "APK not found: $ApkSrc"; continue }
            $apkFilename = "nexari-android.apk"
            ssh -p $platSshPort $PlatformSshTarget "mkdir -p $RemoteBuildsRoot/android"
            scp -P $platSshPort "$ApkSrc" "${PlatformSshTarget}:${RemoteBuildsRoot}/android/$apkFilename"
            Register-Build -Plat android -Filename $apkFilename -Ver $ver -BldUuid ""
            Write-Host "  Done. v$ver" -ForegroundColor Green
        }

        "windows" {
            $winAppDir     = Join-Path $RepoRoot "apps\nexari-windows"
            $winReleaseDir = Join-Path $winAppDir "release"

            if (-not $SkipBuild) {
                Write-Host "  Building player-web bundle..."
                Push-Location $RepoRoot
                try {
                    pnpm --filter "@signage/player-web" build
                    if ($LASTEXITCODE -ne 0) { throw "player-web build failed" }
                } finally { Pop-Location }

                Write-Host "  Bumping version..."
                Push-Location $winAppDir
                try {
                    npm version patch --no-git-tag-version | Out-Null
                    if ($LASTEXITCODE -ne 0) { throw "npm version patch failed" }
                } finally { Pop-Location }

                Write-Host "  Running electron-builder (NSIS)..."
                Push-Location $winAppDir
                try {
                    $env:NEXARI_PLAYER_API_BASE = $apiBase
                    pnpm run package
                    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
                } finally {
                    Remove-Item Env:NEXARI_PLAYER_API_BASE -ErrorAction SilentlyContinue
                    Pop-Location
                }
            }

            $src = if ($WindowsInstallerPath -ne "") { $WindowsInstallerPath } else {
                Get-ChildItem $winReleaseDir -Filter '*-setup.exe' -ErrorAction SilentlyContinue |
                    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
            }
            if (-not $src -or -not (Test-Path $src)) {
                Write-Warning "  Windows: no installer found. Build with deploy-windows.ps1 first, or pass -WindowsInstallerPath. Skipping."
                continue
            }
            $filename = "nexari-windows-setup.exe"
            $ver = if ($src -match '(\d+\.\d+\.\d+)') { $Matches[1] } else { "0.0.0" }
            ssh -p $platSshPort $PlatformSshTarget "mkdir -p $RemoteBuildsRoot/windows"
            scp -P $platSshPort "$src" "${PlatformSshTarget}:${RemoteBuildsRoot}/windows/$filename"
            Register-Build -Plat windows -Filename $filename -Ver $ver -BldUuid ""
            Write-Host "  Done. v$ver" -ForegroundColor Green
        }

        "esp32" {
            $src = if ($Esp32BinPath -ne "") { $Esp32BinPath } else {
                $esp32Dir = Join-Path $RepoRoot "apps\nexari-esp32\.pio\build\esp32dev"
                $bin = Join-Path $esp32Dir "firmware.bin"
                if (Test-Path $bin) { $bin } else { $null }
            }
            if (-not $src -or -not (Test-Path $src)) {
                Write-Warning "  ESP32: no firmware.bin found. Build with deploy-esp32.ps1 first, or pass -Esp32BinPath. Skipping."
                continue
            }
            $filename = "nexari-esp32.bin"
            Push-Location (Join-Path $RepoRoot "apps\nexari-esp32")
            $ver = try { (Get-Content "platformio.ini" | Select-String 'version\s*=\s*(.+)').Matches[0].Groups[1].Value.Trim() } catch { "0.0.0" }
            Pop-Location
            ssh -p $platSshPort $PlatformSshTarget "mkdir -p $RemoteBuildsRoot/esp32"
            scp -P $platSshPort "$src" "${PlatformSshTarget}:${RemoteBuildsRoot}/esp32/$filename"
            Register-Build -Plat esp32 -Filename $filename -Ver $ver -BldUuid ""
            Write-Host "  Done. v$ver" -ForegroundColor Green
        }
    }
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=================================================" -ForegroundColor Green
Write-Host "  Builds complete for: $($partner.Name)"          -ForegroundColor Green
Write-Host "  Platforms: $($platforms -join ', ')"            -ForegroundColor Green
Write-Host "  Partner can download at: https://partners.nexari.ca/downloads" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green
