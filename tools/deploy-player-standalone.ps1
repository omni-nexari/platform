#Requires -Version 5.1
<#
.SYNOPSIS
    Build and deploy Nexari player apps directly to a standalone platform instance.
    Does NOT require admin.nexari.ca — uses only the instance's own deploy API key.

.DESCRIPTION
    Standalone replacement for build-partner-players.ps1.
    Builds the selected player platform(s) and pushes them to the instance at
    -InstanceUrl using a deploy API key (sk_live_*).

    Platforms:
      tizen   -- NexariPlayer.wgt  + sssp_config.xml  (Samsung SSSP commercial display)
      epaper  -- NexariEPaper.wgt  + sssp_config.xml  (Samsung ePaper display)
      android -- nexari-android.apk
      windows -- nexari-windows-setup-x.x.x.exe  (+ latest.yml)
      esp32   -- firmware.bin

    Getting a deploy key:
      1. Log into the platform dashboard.
      2. Settings > API Keys > Create Key.
      3. Enable scope: player:deploy.
      4. Copy the sk_live_* value and pass it via -DeployApiKey.

.PARAMETER InstanceUrl
    Base URL of the standalone platform instance.
    Example: https://portal.reflowcast.com

.PARAMETER DeployApiKey
    deploy API key (sk_live_*) from Settings > API Keys on the instance.

.PARAMETER Platform
    Limit to one platform: tizen, epaper, android, windows, esp32.
    Default: tizen epaper android (skip windows/esp32 unless specified).

.PARAMETER SkipBuild
    Skip the build step -- just re-upload and re-approve the last artifact on disk.

.PARAMETER WindowsInstallerPath
    Path to a pre-built Windows installer .exe. Required when -Platform windows
    and -SkipBuild, otherwise the script builds it automatically.

.PARAMETER Esp32BinPath
    Path to a pre-built ESP32 firmware.bin. Required when -Platform esp32
    and -SkipBuild.

.EXAMPLE
    # Build + deploy Tizen to a standalone instance:
    .\tools\deploy-player-standalone.ps1 `
        -InstanceUrl https://portal.reflowcast.com `
        -DeployApiKey sk_live_xxxxxxx

    # Tizen only, skip the build:
    .\tools\deploy-player-standalone.ps1 `
        -InstanceUrl https://portal.reflowcast.com `
        -DeployApiKey sk_live_xxxxxxx `
        -Platform tizen -SkipBuild

    # All platforms:
    .\tools\deploy-player-standalone.ps1 `
        -InstanceUrl https://portal.reflowcast.com `
        -DeployApiKey sk_live_xxxxxxx `
        -Platform all
#>
param(
    [Parameter(Mandatory)]
    [string]$InstanceUrl,

    [Parameter(Mandatory)]
    [string]$DeployApiKey,

    [ValidateSet("", "all", "tizen", "epaper", "android", "windows", "esp32")]
    [string]$Platform = "",

    [switch]$SkipBuild,

    [string]$WindowsInstallerPath = "",
    [string]$Esp32BinPath = ""
)

$ErrorActionPreference = "Stop"
$InstanceUrl  = $InstanceUrl.TrimEnd('/')
$RepoRoot     = Split-Path -Parent $PSScriptRoot
$TizenDir     = Join-Path $RepoRoot "apps\nexari-tizen"
$EpaperDir    = Join-Path $RepoRoot "apps\nexari-epaper"
$AndroidDir   = Join-Path $RepoRoot "apps\nexari-android"
$TizenCli     = "C:\tizen-studio\tools\ide\bin\tizen.bat"
$SignProfile   = "nado-prod"

$apiBase = "$InstanceUrl/api/v1"
$wsUrl   = $InstanceUrl -replace '^https://', 'wss://' -replace '^http://', 'ws://'

# ── Validate deploy key ───────────────────────────────────────────────────────
if (-not $DeployApiKey.StartsWith('sk_live_')) {
    Write-Error "DeployApiKey must start with sk_live_. Get one from Settings > API Keys on the platform."
    exit 1
}

Write-Host "Deploying to: $InstanceUrl" -ForegroundColor Cyan

# ── Verify baked URL in existing WGT matches -InstanceUrl (SkipBuild safety check) ──
function Test-BakedUrl {
    param([string]$BuildInfoPath)
    if (-not (Test-Path $BuildInfoPath)) { return }
    $content = Get-Content $BuildInfoPath -Raw
    if ($content -match 'API_BASE:\s*"([^"]+)"') {
        $baked = $Matches[1] -replace '/api/v1.*$', ''
        if ($baked -ne $InstanceUrl) {
            Write-Warning "  MISMATCH: WGT was built for '$baked' but -InstanceUrl is '$InstanceUrl'."
            Write-Warning "  Run without -SkipBuild to rebuild with the correct URL."
        } else {
            Write-Host "  Baked URL verified: $baked" -ForegroundColor DarkGray
        }
    }
}

# ── Upload files + create + approve release ───────────────────────────────────
function Deploy-Release {
    param([string]$Plat, [string[]]$FilePaths, [string]$Ver)

    Write-Host "  Uploading $($FilePaths.Count) file(s)..." -ForegroundColor DarkGray

    $formArgs = @()
    foreach ($fp in $FilePaths) {
        $name      = Split-Path $fp -Leaf
        $formArgs += "-F", "files=@`"$fp`";filename=`"$name`""
    }

    $json = & curl.exe -s -S --fail `
        -H "Authorization: Bearer $DeployApiKey" `
        @formArgs `
        "$InstanceUrl/api/v1/player-releases/upload/$Plat" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "  Upload failed (curl exit $LASTEXITCODE): $json"
        return
    }
    $upload = $json | ConvertFrom-Json

    $body = @{
        version     = $Ver
        downloadUrl = $upload.artifactUrl
        sizeBytes   = $upload.sizeBytes
        sha256      = $upload.sha256
        platform    = $Plat
    }
    if ($upload.manifestUrl) { $body.manifestUrl = $upload.manifestUrl }

    $headers = @{ 'Authorization' = "Bearer $DeployApiKey"; 'Content-Type' = 'application/json' }

    $release = Invoke-RestMethod -Method Post `
        -Uri "$InstanceUrl/api/v1/player-releases" `
        -Headers $headers `
        -Body ($body | ConvertTo-Json -Compress)

    $null = Invoke-RestMethod -Method Post `
        -Uri "$InstanceUrl/api/v1/player-releases/$($release.id)/approve" `
        -Headers $headers `
        -Body '{}'

    Write-Host "  Released + approved: v$Ver (id=$($release.id))" -ForegroundColor Green
}

# ── Tizen signing profile ─────────────────────────────────────────────────────
function Set-NadoProdProfile {
    $profilesXml = "C:\tizen-studio-data\profile\profiles.xml"
    $authorP12   = "C:\Users\chiho\SamsungCertificate\testforqbc\author.p12"
    $authorPwd   = "C:\Users\chiho\SamsungCertificate\testforqbc\author.pwd"
    $distP12     = Join-Path $RepoRoot "Docs\cert\NADO.p12"
    $distPwd     = Join-Path $RepoRoot "Docs\cert\NADO.pwd"
    foreach ($p in @($profilesXml, $authorP12, $authorPwd, $distP12, $distPwd)) {
        if (-not (Test-Path $p)) { throw "Missing cert file: $p" }
    }
    [xml]$pXml = Get-Content $profilesXml
    $pRoot = $pXml.profiles
    $existing = $pRoot.profile | Where-Object { $_.name -eq 'nado-prod' }
    if ($existing) { [void]$pRoot.RemoveChild($existing) }
    $prof = $pXml.CreateElement('profile'); $prof.SetAttribute('name', 'nado-prod')
    $a = $pXml.CreateElement('profileitem')
    $a.SetAttribute('ca',''); $a.SetAttribute('distributor','0')
    $a.SetAttribute('key',$authorP12); $a.SetAttribute('password',$authorPwd); $a.SetAttribute('rootca','')
    [void]$prof.AppendChild($a)
    $d = $pXml.CreateElement('profileitem')
    $d.SetAttribute('ca',''); $d.SetAttribute('distributor','1')
    $d.SetAttribute('key',$distP12); $d.SetAttribute('password',$distPwd); $d.SetAttribute('rootca','')
    [void]$prof.AppendChild($d)
    $d2 = $pXml.CreateElement('profileitem')
    $d2.SetAttribute('ca',''); $d2.SetAttribute('distributor','2')
    $d2.SetAttribute('key',''); $d2.SetAttribute('password',''); $d2.SetAttribute('rootca','')
    [void]$prof.AppendChild($d2)
    [void]$pRoot.AppendChild($prof)
    $pRoot.SetAttribute('active','nado-prod')
    $pXml.Save($profilesXml)
}

# ── Platforms ─────────────────────────────────────────────────────────────────
$platforms = switch ($Platform) {
    "all"   { @("tizen","epaper","android","windows","esp32") }
    ""      { @("tizen","epaper","android") }
    default { @($Platform) }
}

foreach ($plat in $platforms) {
    Write-Host ""
    Write-Host "=== $($plat.ToUpper()) ===" -ForegroundColor Yellow

    switch ($plat) {

        "tizen" {
            if ($SkipBuild) { Test-BakedUrl -BuildInfoPath "$TizenDir\js\build-info.js" }
            if (-not $SkipBuild) {
                Push-Location $TizenDir
                try {
                    npm version patch --no-git-tag-version | Out-Null
                    $env:API_BASE = $apiBase; $env:WS_URL = $wsUrl
                    node scripts/generate-build-info.cjs
                    if ($LASTEXITCODE -ne 0) { throw "generate-build-info.cjs failed" }
                    npm run build
                    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
                    $tmp = "$env:TEMP\nexari-tizen-standalone"
                    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
                    New-Item $tmp -ItemType Directory | Out-Null
                    $exclude = @('node_modules','src','.sign','.settings','.project','.tproject','.git','vite.config.ts','package-lock.json','sssp_config.xml','js')
                    foreach ($item in Get-ChildItem $TizenDir) {
                        if ($exclude -contains $item.Name -or $item.Extension -eq '.wgt' -or $item.Name -eq '.manifest.tmp') { continue }
                        if ($item.PSIsContainer) { Copy-Item $item.FullName "$tmp\$($item.Name)" -Recurse }
                        else { Copy-Item $item.FullName $tmp }
                    }
                    Copy-Item "$TizenDir\js" "$tmp\js" -Recurse -Force
                    Remove-Item "$TizenDir\*.wgt" -ErrorAction SilentlyContinue
                    Set-NadoProdProfile
                    Write-Host "  Packaging + signing..."
                    & $TizenCli package --type wgt --sign $SignProfile -o $TizenDir -- $tmp 2>&1 | Write-Host
                    $wgt = Get-ChildItem $TizenDir -Filter '*.wgt' | Select-Object -First 1
                    if (-not $wgt) { throw "No WGT produced" }
                    if ($wgt.Name -ne 'NexariPlayer.wgt') { Rename-Item $wgt.FullName "$TizenDir\NexariPlayer.wgt" -Force }
                    $env:API_BASE = $null; $env:WS_URL = $null
                } finally { Pop-Location }
            }
            $ver = (Get-Content "$TizenDir\package.json" -Raw | ConvertFrom-Json).version
            $ssspPath = "$TizenDir\sssp_config.xml"
            $wgtBytes = (Get-Item "$TizenDir\NexariPlayer.wgt").Length
            $xml = [System.IO.File]::ReadAllText($ssspPath)
            $xml = $xml -replace '<size>\d+</size>', "<size>$wgtBytes</size>"
            $xml = $xml -replace '<ver>[^<]*</ver>', "<ver>$ver</ver>"
            [System.IO.File]::WriteAllText($ssspPath, $xml)
            Write-Host "  sssp_config.xml: ver=$ver size=$wgtBytes" -ForegroundColor DarkGray
            Deploy-Release -Plat tizen -FilePaths @("$TizenDir\NexariPlayer.wgt","$TizenDir\sssp_config.xml") -Ver $ver
            Write-Host "  SSSP URL: $InstanceUrl/tizen/sssp_config.xml" -ForegroundColor Cyan
        }

        "epaper" {
            if ($SkipBuild) { Test-BakedUrl -BuildInfoPath "$EpaperDir\js\build-info.js" }
            if (-not $SkipBuild) {
                Push-Location $EpaperDir
                try {
                    npm version patch --no-git-tag-version | Out-Null
                    $env:API_BASE = $apiBase; $env:WS_URL = $wsUrl
                    node scripts/generate-build-info.cjs
                    if ($LASTEXITCODE -ne 0) { throw "generate-build-info.cjs failed" }
                    $tmp = "$env:TEMP\nexari-epaper-standalone"
                    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
                    New-Item $tmp -ItemType Directory | Out-Null
                    $exclude = @('node_modules','src','.sign','.settings','.project','.tproject','.git','vite.config.ts','package-lock.json','sssp_config.xml','js')
                    foreach ($item in Get-ChildItem $EpaperDir) {
                        if ($exclude -contains $item.Name -or $item.Extension -eq '.wgt' -or $item.Name -eq '.manifest.tmp') { continue }
                        if ($item.PSIsContainer) { Copy-Item $item.FullName "$tmp\$($item.Name)" -Recurse }
                        else { Copy-Item $item.FullName $tmp }
                    }
                    Copy-Item "$EpaperDir\js" "$tmp\js" -Recurse -Force
                    Remove-Item "$EpaperDir\*.wgt" -ErrorAction SilentlyContinue
                    Set-NadoProdProfile
                    Write-Host "  Packaging + signing..."
                    & $TizenCli package --type wgt --sign $SignProfile -o $EpaperDir -- $tmp 2>&1 | Write-Host
                    $wgt = Get-ChildItem $EpaperDir -Filter '*.wgt' | Select-Object -First 1
                    if (-not $wgt) { throw "No WGT produced" }
                    if ($wgt.Name -ne 'NexariEPaper.wgt') { Rename-Item $wgt.FullName "$EpaperDir\NexariEPaper.wgt" -Force }
                    $env:API_BASE = $null; $env:WS_URL = $null
                } finally { Pop-Location }
            }
            $ver = (Get-Content "$EpaperDir\package.json" -Raw | ConvertFrom-Json).version
            $ssspPath = "$EpaperDir\sssp_config.xml"
            $wgtBytes = (Get-Item "$EpaperDir\NexariEPaper.wgt").Length
            $xml = [System.IO.File]::ReadAllText($ssspPath)
            $xml = $xml -replace '<size>\d+</size>', "<size>$wgtBytes</size>"
            $xml = $xml -replace '<ver>[^<]*</ver>', "<ver>$ver</ver>"
            [System.IO.File]::WriteAllText($ssspPath, $xml)
            Write-Host "  sssp_config.xml: ver=$ver size=$wgtBytes" -ForegroundColor DarkGray
            Deploy-Release -Plat epaper -FilePaths @("$EpaperDir\NexariEPaper.wgt","$EpaperDir\sssp_config.xml") -Ver $ver
            Write-Host "  SSSP URL: $InstanceUrl/epaper/sssp_config.xml" -ForegroundColor Cyan
        }

        "android" {
            if (-not $SkipBuild) {
                Push-Location $RepoRoot
                try {
                    $local:ErrorActionPreference = 'Continue'
                    pnpm --filter "@signage/player-web" build
                    $local:ErrorActionPreference = 'Stop'
                    if ($LASTEXITCODE -ne 0) { throw "player-web build failed" }
                } finally { Pop-Location }
                node "$AndroidDir\scripts\sync-player-web.cjs"
                if ($LASTEXITCODE -ne 0) { throw "sync-player-web failed" }
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
                    .\gradlew.bat assembleSelfRelease "-PpartnerApiBase=$apiBase" "-PpartnerWsBase=$wsUrl"
                    if ($LASTEXITCODE -ne 0) { throw "Gradle build failed" }
                    Pop-Location
                } finally { Pop-Location }
            }
            $ver = (Get-Content "$AndroidDir\package.json" -Raw | ConvertFrom-Json).version
            $apkSrc = "$AndroidDir\android\app\build\outputs\apk\self\release\app-self-release.apk"
            if (-not (Test-Path $apkSrc)) { Write-Error "APK not found: $apkSrc"; continue }
            $versionedApk = Join-Path (Split-Path $apkSrc -Parent) "nexari-android-$ver.apk"
            Copy-Item $apkSrc $versionedApk -Force
            Deploy-Release -Plat android -FilePaths @($versionedApk) -Ver $ver
        }

        "windows" {
            $winAppDir = Join-Path $RepoRoot "apps\nexari-windows"
            $winReleaseDir = Join-Path $winAppDir "release"
            if (-not $SkipBuild) {
                Push-Location $RepoRoot
                try {
                    $local:ErrorActionPreference = 'Continue'
                    pnpm --filter "@signage/player-web" build
                    $local:ErrorActionPreference = 'Stop'
                    if ($LASTEXITCODE -ne 0) { throw "player-web build failed" }
                } finally { Pop-Location }
                Push-Location $winAppDir
                try {
                    npm version patch --no-git-tag-version | Out-Null
                    pnpm run build
                    if ($LASTEXITCODE -ne 0) { throw "Windows build failed" }
                    pnpm exec electron-builder --win --x64 `
                        "-c.extraMetadata.nexariApiBase=$apiBase" `
                        "-c.publish.url=$InstanceUrl/windows"
                    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
                } finally { Pop-Location }
            }
            $src = if ($WindowsInstallerPath) { $WindowsInstallerPath } else {
                Get-ChildItem $winReleaseDir -Filter '*-setup.exe' -ErrorAction SilentlyContinue |
                    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
            }
            if (-not $src -or -not (Test-Path $src)) {
                Write-Warning "  No installer found. Pass -WindowsInstallerPath or run without -SkipBuild."
                continue
            }
            $ver = if ($src -match '(\d+\.\d+\.\d+)') { $Matches[1] } else { "0.0.0" }
            $latestYml = Join-Path (Split-Path $src -Parent) 'latest.yml'
            $files = @($src) + @(if (Test-Path $latestYml) { $latestYml } else { })
            Deploy-Release -Plat windows -FilePaths $files -Ver $ver
        }

        "esp32" {
            $src = if ($Esp32BinPath) { $Esp32BinPath } else {
                $f = Join-Path $RepoRoot "apps\nexari-esp32\.pio\build\esp32dev\firmware.bin"
                if (Test-Path $f) { $f } else { $null }
            }
            if (-not $src -or -not (Test-Path $src)) {
                Write-Warning "  firmware.bin not found. Pass -Esp32BinPath."
                continue
            }
            $ver = try {
                Push-Location (Join-Path $RepoRoot "apps\nexari-esp32")
                (Get-Content "platformio.ini" | Select-String 'version\s*=\s*(.+)').Matches[0].Groups[1].Value.Trim()
                Pop-Location
            } catch { "0.0.0" }
            Deploy-Release -Plat esp32 -FilePaths @($src) -Ver $ver
        }
    }
}

Write-Host ""
Write-Host "=================================================" -ForegroundColor Green
Write-Host "  Deploy complete: $InstanceUrl"                   -ForegroundColor Green
Write-Host ""
Write-Host "  Samsung TV (Tizen SSSP)" -ForegroundColor White
Write-Host "    Enter this URL in MagicInfo or URL Launcher:" -ForegroundColor DarkGray
Write-Host "    $InstanceUrl/tizen/sssp_config.xml" -ForegroundColor Cyan
Write-Host "    Direct WGT download: $InstanceUrl/tizen/NexariPlayer.wgt" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  ePaper (Tizen SSSP)" -ForegroundColor White
Write-Host "    Enter this URL in URL Launcher:" -ForegroundColor DarkGray
Write-Host "    $InstanceUrl/epaper/sssp_config.xml" -ForegroundColor Cyan
Write-Host "    Direct WGT download: $InstanceUrl/epaper/NexariEPaper.wgt" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Android APK:  $InstanceUrl/android/nexari-android.apk" -ForegroundColor DarkGray
Write-Host "  Windows EXE:  $InstanceUrl/windows/nexari-windows-setup.exe" -ForegroundColor DarkGray
Write-Host "=================================================" -ForegroundColor Green
