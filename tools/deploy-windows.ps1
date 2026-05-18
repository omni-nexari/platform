#Requires -Version 5.1
<#
.SYNOPSIS
    Build the nexari-windows Electron app (prod flavor) and upload the NSIS
    installer + latest.yml to the Pi, then optionally publish a release record
    to the DS portal.

.DESCRIPTION
    Mirrors deploy-tizen.ps1 / deploy-android.ps1 for the Windows player.

    1. Builds @signage/player-web.
    2. Runs pnpm package (electron-builder NSIS --win --x64).
    3. Uploads nexari-windows-{version}-setup.exe + latest.yml to the Pi at
       /var/signage/windows/.
    4. Optionally publishes a player_releases record to the DS API.

.EXAMPLE
    .\tools\deploy-windows.ps1 -PiHost 192.168.1.17
    .\tools\deploy-windows.ps1 -PiHost 192.168.1.17 -SuperadminEmail chiho.lee23@gmail.com -SuperadminPassword q1w2e3r4
    .\tools\deploy-windows.ps1 -PiHost 192.168.1.17 -SkipBuild   # upload existing installer
    .\tools\deploy-windows.ps1 -PiHost 192.168.1.17 -NoUpload    # build only, skip Pi SCP
#>
param(
    [string]$PiHost  = "192.168.1.17",

    [string]$PiUser  = "chiho",
    [int]$SshPort    = 5551,

    [switch]$SkipBuild,
    [switch]$NoUpload,

    [string]$SuperadminEmail    = "chiho.lee23@gmail.com",
    [string]$SuperadminPassword = "",
    [string]$ApiBase            = "https://ds.chiho.app/api/v1",
    [string]$ReleaseNotes       = ""
)

$ErrorActionPreference = "Stop"

$RepoRoot  = Split-Path -Parent $PSScriptRoot
$AppDir    = Join-Path $RepoRoot "apps\nexari-windows"
$ReleaseDir = Join-Path $AppDir "release"

# --- Build ---
if (-not $SkipBuild) {
    # Step 1: player-web bundle (Windows renderer reuses it)
    Write-Host ""
    Write-Host "=== Step 1: Build @signage/player-web ===" -ForegroundColor Cyan
    Push-Location $RepoRoot
    try {
        pnpm --filter "@signage/player-web" build
        if ($LASTEXITCODE -ne 0) { throw "player-web build failed" }
    } finally { Pop-Location }

    # Step 2: bump patch version
    Write-Host ""
    Write-Host "=== Step 2: Bump patch version ===" -ForegroundColor Cyan
    Push-Location $AppDir
    try {
        npm version patch --no-git-tag-version
        if ($LASTEXITCODE -ne 0) { throw "npm version patch failed" }
    } finally { Pop-Location }

    $newVersion = (Get-Content "$AppDir\package.json" -Raw | ConvertFrom-Json).version
    Write-Host "Version: $newVersion"

    # Step 3: electron-builder NSIS installer
    Write-Host ""
    Write-Host "=== Step 3: electron-builder --win --x64 ===" -ForegroundColor Cyan
    Push-Location $AppDir
    try {
        pnpm run package
        if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
    } finally { Pop-Location }
} else {
    Write-Host "=== -SkipBuild: using existing installer in $ReleaseDir ===" -ForegroundColor DarkGray
}

$newVersion = (Get-Content "$AppDir\package.json" -Raw | ConvertFrom-Json).version

# Locate the installer
$InstallerPath = Get-ChildItem $ReleaseDir -Filter "nexari-windows-*-setup.exe" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName

if (-not $InstallerPath) {
    Write-Error "Installer not found in $ReleaseDir - run without -SkipBuild first."
    exit 1
}

# latest.yml is written by electron-builder for auto-updater
$LatestYmlPath = Join-Path $ReleaseDir "latest.yml"

$sizeMB = [math]::Round((Get-Item $InstallerPath).Length / 1MB, 1)
Write-Host ""
Write-Host "Installer: $InstallerPath  ($sizeMB MB)"

# --- Upload to Pi ---
if (-not $NoUpload) {
    Write-Host ""
    Write-Host "=== Uploading installer to Pi ===" -ForegroundColor Cyan

    $RemoteDir = "/var/signage/windows"
    $SshTarget = "$PiUser@$PiHost"
    $sshPortArgs = @("-p", $SshPort)

    foreach ($cmd in @("ssh", "scp")) {
        if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
            throw "Required command not found: $cmd - install OpenSSH client from Windows Optional Features"
        }
    }

    ssh @sshPortArgs $SshTarget "sudo mkdir -p '$RemoteDir' && sudo chown '${PiUser}:${PiUser}' '$RemoteDir'"
    if ($LASTEXITCODE -ne 0) { throw "Failed to create remote directory $RemoteDir" }

    # Upload installer with a fixed name so the download link never changes
    scp -P $SshPort "$InstallerPath" "${SshTarget}:${RemoteDir}/nexari-windows-setup.exe"
    if ($LASTEXITCODE -ne 0) { throw "SCP installer upload failed" }

    # Upload latest.yml for the electron-updater auto-update check
    if (Test-Path $LatestYmlPath) {
        scp -P $SshPort "$LatestYmlPath" "${SshTarget}:${RemoteDir}/latest.yml"
        if ($LASTEXITCODE -ne 0) { throw "SCP latest.yml upload failed" }
    } else {
        Write-Host "  (latest.yml not found - skipping)" -ForegroundColor DarkGray
    }

    Write-Host "Verifying files on Pi..."
    ssh @sshPortArgs $SshTarget "ls -lh '$RemoteDir/'"
    if ($LASTEXITCODE -ne 0) { throw "Remote verification failed" }
    Write-Host "Upload complete." -ForegroundColor Green
} else {
    Write-Host "(-NoUpload set - skipping Pi upload)" -ForegroundColor DarkGray
}

# --- Publish release record to DS API (optional) ---
if ($SuperadminEmail -ne "" -and $SuperadminPassword -eq "") {
    $secPwd = Read-Host "Superadmin password for $SuperadminEmail" -AsSecureString
    $SuperadminPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPwd))
}
if ($SuperadminEmail -ne "" -and $SuperadminPassword -ne "") {
    $ApiBase = $ApiBase.TrimEnd('/')
    $DownloadUrl = "https://ds.chiho.app/windows/nexari-windows-setup.exe"

    Write-Host ""
    Write-Host "=== Publishing release v$newVersion to DS API ===" -ForegroundColor Cyan

    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    try {
        $loginBody = @{ email = $SuperadminEmail; password = $SuperadminPassword } | ConvertTo-Json
        $null = Invoke-WebRequest -Method Post `
            -Uri "$ApiBase/superadmin/auth/login" `
            -ContentType "application/json" `
            -Body $loginBody `
            -WebSession $session `
            -UseBasicParsing
    } catch {
        Write-Host "WARNING: Superadmin login failed - skipping release publish. $_" -ForegroundColor Yellow
        $session = $null
    }

    if ($session) {
        $csrfToken = $session.Cookies.GetCookies("$ApiBase/") |
            Where-Object { $_.Name -eq 'sa_csrf_token' } |
            Select-Object -First 1 -ExpandProperty Value

        try {
            $releaseBody = @{ platform = "windows"; version = $newVersion; downloadUrl = $DownloadUrl }
            if ($ReleaseNotes -ne "") { $releaseBody.releaseNotes = $ReleaseNotes }

            $publishResp = Invoke-RestMethod -Method Post `
                -Uri "$ApiBase/player-releases" `
                -ContentType "application/json" `
                -WebSession $session `
                -Headers @{ 'X-CSRF-Token' = $csrfToken } `
                -Body ($releaseBody | ConvertTo-Json)
            Write-Host "  Release published: v$($publishResp.version) (id=$($publishResp.id))" -ForegroundColor Green
        } catch {
            $errBody = $_.ErrorDetails.Message
            if ($errBody -and ($errBody | ConvertFrom-Json -ErrorAction SilentlyContinue).code -eq '23505') {
                Write-Host "  Release v$newVersion already exists - skipping." -ForegroundColor DarkGray
            } else {
                Write-Host "WARNING: Failed to publish release - $_" -ForegroundColor Yellow
            }
        }
    }
} else {
    Write-Host "(Skipping release publish - add -SuperadminEmail / -SuperadminPassword to publish)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  nexari-windows  $newVersion  PROD build complete" -ForegroundColor Green
Write-Host "  Installer: $InstallerPath" -ForegroundColor Green
Write-Host "  OTA URL:   https://ds.chiho.app/windows/nexari-windows-setup.exe" -ForegroundColor Green
Write-Host "  Auto-upd:  https://ds.chiho.app/windows/latest.yml" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
