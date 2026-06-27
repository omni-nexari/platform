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
    [string]$AdminPassword = "Samsung@2026!",
    [string]$AdminApiBase  = "https://admin.nexari.ca/api/v1",

    [ValidateSet("", "tizen", "epaper", "android", "windows", "esp32")]
    [string]$Platform = "",

    # Credentials for the partner's platform owner account.
    # Used to publish releases via the platform API (no SSH required).
    # Defaults to AdminEmail/AdminPassword for self-hosted setups where they
    # are the same person.  Override when the platform owner is different.
    [string]$PlatformOwnerEmail    = "",
    [string]$PlatformOwnerPassword = "",

    # Override the platform deploy API key (sk_live_*) instead of using the one
    # stored in nexari-admin. Useful for first-time setup before the partner has
    # saved their key via partners.nexari.ca/downloads.
    [string]$DeployApiKey = "",

    # Override the instance URL from the DB (useful when the partner's instanceUrl
    # record hasn't been updated yet, e.g. after moving from dev to a new domain).
    [string]$InstanceUrl = "",

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

# ── Tizen signing profile setup ───────────────────────────────────────────────
# Mirrors deploy-tizen.ps1: writes the 'nado-prod' profile into Tizen Studio's
# profiles.xml before every packaging step so the cert paths are always current.
function Set-NadoProdProfile {
    $profilesXml = "C:\tizen-studio-data\profile\profiles.xml"
    $authorP12   = "C:\Users\chiho\SamsungCertificate\testforqbc\author.p12"
    $authorPwd   = "C:\Users\chiho\SamsungCertificate\testforqbc\author.pwd"
    $distP12     = Join-Path $RepoRoot "Docs\cert\NADO.p12"
    $distPwd     = Join-Path $RepoRoot "Docs\cert\NADO.pwd"

    foreach ($p in @($profilesXml, $authorP12, $authorPwd, $distP12, $distPwd)) {
        if (-not (Test-Path $p)) { throw "Missing required cert file: $p" }
    }

    [xml]$pXml  = Get-Content $profilesXml
    $pRoot      = $pXml.profiles
    $existing   = $pRoot.profile | Where-Object { $_.name -eq 'nado-prod' }
    if ($existing) { [void]$pRoot.RemoveChild($existing) }

    $prof = $pXml.CreateElement('profile'); $prof.SetAttribute('name', 'nado-prod')

    $a = $pXml.CreateElement('profileitem')
    $a.SetAttribute('ca',''); $a.SetAttribute('distributor','0')
    $a.SetAttribute('key', $authorP12); $a.SetAttribute('password', $authorPwd); $a.SetAttribute('rootca','')
    [void]$prof.AppendChild($a)

    $d = $pXml.CreateElement('profileitem')
    $d.SetAttribute('ca',''); $d.SetAttribute('distributor','1')
    $d.SetAttribute('key', $distP12); $d.SetAttribute('password', $distPwd); $d.SetAttribute('rootca','')
    [void]$prof.AppendChild($d)

    $d2 = $pXml.CreateElement('profileitem')
    $d2.SetAttribute('ca',''); $d2.SetAttribute('distributor','2')
    $d2.SetAttribute('key',''); $d2.SetAttribute('password',''); $d2.SetAttribute('rootca','')
    [void]$prof.AppendChild($d2)

    [void]$pRoot.AppendChild($prof)
    $pRoot.SetAttribute('active', 'nado-prod')
    $pXml.Save($profilesXml)
    Write-Host "  Signing profile 'nado-prod' written to Tizen Studio." -ForegroundColor DarkGray
}

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
        DeployKey    = $_.platformDeployKey
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
# Allow caller to override the URL from the DB (e.g. after domain migration)
if ($InstanceUrl -ne "") { $instanceUrl = $InstanceUrl.TrimEnd('/') }
$wsUrl = if ($instanceUrl) {
    $instanceUrl -replace '^https://', 'wss://' -replace '^http://', 'ws://'
} else { "" }
$apiBase = "$instanceUrl/api/v1"

Write-Host ""
Write-Host "Building for: $($partner.Name)" -ForegroundColor Cyan
if ($instanceUrl) { Write-Host "  Instance: $instanceUrl" }

# ── Platform deploy key ───────────────────────────────────────────────────────
# Prefer the -DeployApiKey param override, then fall back to the key stored in nexari-admin.
$script:deployKey = if ($DeployApiKey -ne "") { $DeployApiKey } else { $partner.DeployKey }
if (-not $script:deployKey) {
    Write-Warning "No deploy API key for $($partner.Name)."
    Write-Warning "  1. On their platform go to Settings > API Keys and create a key with scope 'player:deploy'."
    Write-Warning "  2. Save it at partners.nexari.ca > Downloads > Platform Deploy Key."
    Write-Warning "  OR pass -DeployApiKey sk_live_... to this script."
    Write-Warning "  Uploads and releases will be skipped -- only nexari-admin registration will run."
}

# Upload one or more local files to the partner's platform via the upload API.
# Returns the parsed JSON response, or $null on failure.
function Send-PlatformFiles {
    param([string]$Plat, [string[]]$FilePaths)

    if (-not $script:deployKey) { return $null }

    Write-Host "  Uploading $($FilePaths.Count) file(s) to platform..." -ForegroundColor DarkGray

    # Use HttpClient + StreamContent so large files (200 MB+ Windows installer) are
    # streamed from disk rather than buffered into a MemoryStream.  Invoke-WebRequest
    # uses the old .NET WebRequest stack which drops TLS connections on large sends.
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    $streams = @()
    $form    = $null
    $client  = $null
    try {
        $client = New-Object System.Net.Http.HttpClient
        $client.Timeout = [System.TimeSpan]::FromMinutes(10)
        $client.DefaultRequestHeaders.Authorization =
            New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $script:deployKey)

        $form = New-Object System.Net.Http.MultipartFormDataContent

        foreach ($fp in $FilePaths) {
            $name    = Split-Path $fp -Leaf
            $fs      = [System.IO.File]::OpenRead($fp)
            $streams += $fs
            $sc      = New-Object System.Net.Http.StreamContent($fs)
            $sc.Headers.ContentType =
                New-Object System.Net.Http.Headers.MediaTypeHeaderValue('application/octet-stream')
            $form.Add($sc, 'files', $name)
        }

        $resp = $client.PostAsync("$instanceUrl/api/v1/player-releases/upload/$Plat", $form).GetAwaiter().GetResult()
        $body = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()

        if (-not $resp.IsSuccessStatusCode) {
            Write-Warning "  Platform upload failed: HTTP $([int]$resp.StatusCode) — $body"
            return $null
        }
        return $body | ConvertFrom-Json
    } catch {
        Write-Warning "  Platform upload failed: $($_.Exception.Message)"
        return $null
    } finally {
        if ($form)   { $form.Dispose() }
        if ($client) { $client.Dispose() }
        foreach ($s in $streams) { $s.Dispose() }
    }
}

# Create + auto-approve a platform release so it appears in /management/releases.
function Publish-PlatformRelease {
    param([string]$Plat, [string]$Ver, $UploadResult)

    if (-not $script:deployKey) {
        Write-Warning "  Skipping platform release publish for $Plat -- no deploy key."
        return
    }
    if (-not $UploadResult) {
        Write-Warning "  Skipping platform release publish for $Plat -- upload failed (check warnings above)."
        return
    }

    try {
        $body = @{
            platform    = $Plat
            version     = $Ver
            downloadUrl = $UploadResult.artifactUrl
            sizeBytes   = $UploadResult.sizeBytes
            sha256      = $UploadResult.sha256
        }
        if ($UploadResult.manifestUrl) { $body.manifestUrl = $UploadResult.manifestUrl }

        $headers = @{ 'Authorization' = "Bearer $($script:deployKey)"; 'Content-Type' = 'application/json' }

        $release = Invoke-RestMethod -Method Post `
            -Uri "$instanceUrl/api/v1/player-releases" `
            -Headers $headers `
            -Body ($body | ConvertTo-Json -Compress)

        # Auto-approve so it appears immediately in the management portal
        $null = Invoke-RestMethod -Method Post `
            -Uri "$instanceUrl/api/v1/player-releases/$($release.id)/approve" `
            -Headers $headers `
            -Body '{}'

        Write-Host "  Platform release published + approved: v$Ver (id=$($release.id))" -ForegroundColor Green
    } catch {
        Write-Warning "  Failed to publish platform release: $($_.Exception.Message)"
    }
}

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
                    npm version patch --no-git-tag-version
                    if ($LASTEXITCODE -ne 0) { throw "npm version patch failed" }
                    $env:API_BASE = $apiBase
                    $env:WS_URL   = $wsUrl
                    node scripts/generate-build-info.cjs
                    if ($LASTEXITCODE -ne 0) { throw "generate-build-info.cjs failed" }
                    npm run build
                    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

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
                    Set-NadoProdProfile
                    Write-Host "  Packaging + signing with profile '$SignProfile'..."
                    & $TizenCli package --type wgt --sign $SignProfile -o $TizenDir -- $tmp 2>&1 | Write-Host
                    $wgt = Get-ChildItem $TizenDir -Filter '*.wgt' | Select-Object -First 1
                    if (-not $wgt) { throw "Tizen package failed -- no WGT produced" }
                    if ($wgt.Name -ne 'NexariPlayer.wgt') { Rename-Item $wgt.FullName "$TizenDir\NexariPlayer.wgt" -Force }
                    $env:API_BASE = $null; $env:WS_URL = $null
                } finally { Pop-Location }
            }
            $ver = (Get-Content "$TizenDir\package.json" -Raw | ConvertFrom-Json).version
            # Patch sssp_config.xml with current version + WGT byte-size (same as epaper; avoids
            # calling npm run pack:sssp which tries to copy to /var/signage/tizen on Linux)
            $tizenSsspPath = "$TizenDir\sssp_config.xml"
            $wgtBytes = (Get-Item "$TizenDir\NexariPlayer.wgt").Length
            $ssspXml = [System.IO.File]::ReadAllText($tizenSsspPath)
            $ssspXml = $ssspXml -replace '<size>\d+</size>', "<size>$wgtBytes</size>"
            $ssspXml = $ssspXml -replace '<ver>[^<]*</ver>', "<ver>$ver</ver>"
            [System.IO.File]::WriteAllText($tizenSsspPath, $ssspXml)
            Write-Host "  sssp_config.xml: <ver>$ver</ver> <size>$wgtBytes</size>" -ForegroundColor DarkGray
            $uploadResult = Send-PlatformFiles -Plat tizen -FilePaths @("$TizenDir\NexariPlayer.wgt", "$TizenDir\sssp_config.xml")
            Publish-PlatformRelease -Plat tizen -Ver $ver -UploadResult $uploadResult
            Register-Build -Plat tizen -Filename "NexariPlayer.wgt" -Ver $ver -BldUuid ""
            Write-Host "  Done. v$ver  SSSP: $instanceUrl/tizen/sssp_config.xml" -ForegroundColor Green
        }

        "epaper" {
            if (-not $SkipBuild) {
                Write-Host "  Building ePaper WGT..."
                Push-Location $EpaperDir
                try {
                    npm version patch --no-git-tag-version
                    if ($LASTEXITCODE -ne 0) { throw "npm version patch failed" }
                    $env:API_BASE = $apiBase
                    $env:WS_URL   = $wsUrl
                    node scripts/generate-build-info.cjs
                    if ($LASTEXITCODE -ne 0) { throw "generate-build-info.cjs failed" }

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
                    Set-NadoProdProfile
                    Write-Host "  Packaging + signing with profile '$SignProfile'..."
                    & $TizenCli package --type wgt --sign $SignProfile -o $EpaperDir -- $tmp 2>&1 | Write-Host
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
            $uploadResult = Send-PlatformFiles -Plat epaper -FilePaths @("$EpaperDir\NexariEPaper.wgt", "$EpaperDir\sssp_config.xml")
            Publish-PlatformRelease -Plat epaper -Ver $ver -UploadResult $uploadResult
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
            $versionedApk = "nexari-android-$ver.apk"   # versioned -- stored as downloadUrl in DB
            $staticApk    = "nexari-android.apk"         # static -- refreshed for nginx redirect
            $apkDir = Split-Path $ApkSrc -Parent
            $versionedApkSrc = Join-Path $apkDir $versionedApk
            $staticApkSrc    = Join-Path $apkDir $staticApk
            Copy-Item $ApkSrc $versionedApkSrc -Force
            Copy-Item $ApkSrc $staticApkSrc    -Force
            $uploadResult = Send-PlatformFiles -Plat android -FilePaths @($versionedApkSrc, $staticApkSrc)
            Publish-PlatformRelease -Plat android -Ver $ver -UploadResult $uploadResult
            Register-Build -Plat android -Filename $versionedApk -Ver $ver -BldUuid ""
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

                Write-Host "  Building Windows player (TypeScript + renderer)..."
                Push-Location $winAppDir
                try {
                    pnpm run build
                    if ($LASTEXITCODE -ne 0) { throw "Windows player build failed" }
                } finally { Pop-Location }

                Write-Host "  Running electron-builder (NSIS) with baked API base: $apiBase ..."
                Push-Location $winAppDir
                try {
                    # -c.extraMetadata.nexariApiBase bakes the partner URL into package.json inside the asar.
                    # store.ts reads it at runtime via require('../../package.json').nexariApiBase.
                    pnpm exec electron-builder --win --x64 "-c.extraMetadata.nexariApiBase=$apiBase"
                    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
                } finally { Pop-Location }
            }

            $src = if ($WindowsInstallerPath -ne "") { $WindowsInstallerPath } else {
                Get-ChildItem $winReleaseDir -Filter '*-setup.exe' -ErrorAction SilentlyContinue |
                    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
            }
            if (-not $src -or -not (Test-Path $src)) {
                Write-Warning "  Windows: no installer found. Build with deploy-windows.ps1 first, or pass -WindowsInstallerPath. Skipping."
                continue
            }
            $ver = if ($src -match '(\d+\.\d+\.\d+)') { $Matches[1] } else { "0.0.0" }
            $releaseDir        = Split-Path $src -Parent
            $versionedFilename = "nexari-windows-setup-$ver.exe"   # versioned -- stored as downloadUrl in DB
            $staticFilename    = "nexari-windows-setup.exe"         # static -- refreshed for nginx redirect
            $versionedSrc = Join-Path $releaseDir $versionedFilename
            $staticSrc    = Join-Path $releaseDir $staticFilename
            Copy-Item $src $versionedSrc -Force
            Copy-Item $src $staticSrc    -Force
            $latestYml   = Join-Path $releaseDir 'latest.yml'
            # Upload versioned first so it becomes the artifactUrl in the DB
            $uploadFiles = @($versionedSrc, $staticSrc) + @(if (Test-Path $latestYml) { $latestYml } else { })
            $uploadResult = Send-PlatformFiles -Plat windows -FilePaths $uploadFiles
            Publish-PlatformRelease -Plat windows -Ver $ver -UploadResult $uploadResult
            Register-Build -Plat windows -Filename $versionedFilename -Ver $ver -BldUuid ""
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
            $uploadResult = Send-PlatformFiles -Plat esp32 -FilePaths @($src)
            # ESP32 has no player_releases entry (no approval flow) -- just register to admin
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
Write-Host "  Partner downloads:   https://partners.nexari.ca/downloads"           -ForegroundColor Green
Write-Host "  Management releases: $instanceUrl/management/releases" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green
