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
      tizen   — NexariPlayer.wgt  (Tizen SSSP commercial display)
      epaper  — NexariEPaper.wgt  (Samsung ePaper display)
      android — nexari-android.apk

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
    Skip the actual build step — just re-upload and re-register an existing artifact.

.PARAMETER RegisterGeneric
    Register the current Windows installer and ESP32 firmware as generic builds
    for the selected partner (no rebuild — uses existing files on server).

.EXAMPLE
    # Interactive — pick partner from list, build all platforms:
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

    [ValidateSet("", "tizen", "epaper", "android")]
    [string]$Platform = "",

    [string]$PiHost    = "192.168.1.17",
    [string]$PiUser    = "chiho",
    [int]$SshPort      = 5551,

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
$RemoteBuildsDir = "/var/nexari-admin/player-builds"
$RemoteGenericDir = "/var/nexari-admin/player-generic"
$PublicBaseUrl = "https://nexari.ca/player"

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
$csrfToken = $session.Cookies.GetCookies("$AdminApiBase/") |
    Where-Object { $_.Name -eq 'sa_csrf_token' } |
    Select-Object -First 1 -ExpandProperty Value
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
    (Invoke-RestMethod @params)
}

# ── Fetch partner list ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Fetching partners..." -ForegroundColor Cyan
$resp = Invoke-AdminApi -Method Get -Path "/partners"
$allPartners = $resp.partners

# For each partner, get their instanceUrl from the first active license key
Write-Host "Fetching instance URLs..." -ForegroundColor Cyan
$partnerInfos = foreach ($p in $allPartners) {
    $detail = Invoke-AdminApi -Method Get -Path "/partners/$($p.id)"
    $activeKey = $detail.licenseKeys | Where-Object { $_.status -in @('active','grace') } | Select-Object -First 1
    [PSCustomObject]@{
        Id          = $p.id
        Name        = $p.name
        Status      = $p.status
        InstanceUrl = $activeKey?.instanceUrl
        LicenseKeyId = $activeKey?.id
    }
}

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

# ── Build dir on server ───────────────────────────────────────────────────────
$buildUuid  = [System.Guid]::NewGuid().ToString()
$SshTarget  = "$PiUser@$PiHost"
$sshPortArgs = @("-p", $SshPort)
$remoteBuildDir = "$RemoteBuildsDir/$buildUuid"

ssh @sshPortArgs $SshTarget "mkdir -p '$remoteBuildDir'"

function Register-Build {
    param([string]$Plat, [string]$Filename, [string]$Ver, [string]$BldUuid)
    $dlUrl = "$PublicBaseUrl/p/$BldUuid/$Filename"
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

$platforms = if ($Platform -ne "") { @($Platform) } else { @("tizen", "epaper", "android") }

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
                    if (-not $wgt) { throw "Tizen package failed — no WGT produced" }
                    if ($wgt.Name -ne 'NexariPlayer.wgt') { Rename-Item $wgt.FullName "$TizenDir\NexariPlayer.wgt" -Force }
                    $env:API_BASE = $null; $env:WS_URL = $null
                } finally { Pop-Location }
            }
            $ver = (Get-Content "$TizenDir\package.json" -Raw | ConvertFrom-Json).version
            scp -P $SshPort "$TizenDir\NexariPlayer.wgt" "${SshTarget}:${remoteBuildDir}/NexariPlayer.wgt"
            Register-Build -Plat tizen -Filename "NexariPlayer.wgt" -Ver $ver -BldUuid $buildUuid
            Write-Host "  Done. v$ver" -ForegroundColor Green
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
                    if (-not $wgt) { throw "ePaper package failed — no WGT produced" }
                    if ($wgt.Name -ne 'NexariEPaper.wgt') { Rename-Item $wgt.FullName "$EpaperDir\NexariEPaper.wgt" -Force }
                    $env:API_BASE = $null; $env:WS_URL = $null
                } finally { Pop-Location }
            }
            $ver = (Get-Content "$EpaperDir\package.json" -Raw | ConvertFrom-Json).version
            scp -P $SshPort "$EpaperDir\NexariEPaper.wgt" "${SshTarget}:${remoteBuildDir}/NexariEPaper.wgt"
            Register-Build -Plat epaper -Filename "NexariEPaper.wgt" -Ver $ver -BldUuid $buildUuid
            Write-Host "  Done. v$ver" -ForegroundColor Green
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
            scp -P $SshPort "$ApkSrc" "${SshTarget}:${remoteBuildDir}/$apkFilename"
            Register-Build -Plat android -Filename $apkFilename -Ver $ver -BldUuid $buildUuid
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
