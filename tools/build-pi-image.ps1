<#
.SYNOPSIS
    Bump version, build the Docker image directly on the Pi, and optionally
    push the git tag to trigger the GHCR release workflow for partner downloads.

.DESCRIPTION
    1. Commits any staged changes (optional commit message)
    2. Bumps the patch version in package.json
    3. Commits the version bump
    4. Archives the repo and SCPs it to the Pi
    5. Builds the Docker image natively on the Pi (arm64 — no QEMU needed)
    6. Reports the built image tag
    7. Asks whether to push the git tag → triggers GitHub Actions → GHCR release

    The script does NOT deploy (no migrations, no service restart).
    Run  bash /opt/nexari/update.sh --version vX.Y.Z  when ready to go live.

.PARAMETER PiHost
    SSH hostname or IP of the Pi. Default: 192.168.1.17

.PARAMETER SshPort
    SSH port. Default: 5551

.PARAMETER SshUser
    SSH username. Default: chiho

.PARAMETER Version
    Explicit version string (e.g. 1.0.22). If omitted the patch component of
    the current package.json version is incremented by 1.

.PARAMETER SkipPlaywright
    Pass SKIP_PLAYWRIGHT=1 to docker build, saving ~600 MB and several minutes.
    Default: true (playwright is rarely needed on Pi builds).

.PARAMETER NoPush
    Skip the "push tag to GitHub?" prompt entirely — useful for CI / headless runs.

.EXAMPLE
    .\tools\build-pi-image.ps1
    .\tools\build-pi-image.ps1 -Version 1.1.0
    .\tools\build-pi-image.ps1 -NoPush
#>

[CmdletBinding()]
param(
    [string] $PiHost     = "192.168.1.17",
    [int]    $SshPort    = 5551,
    [string] $SshUser    = "chiho",
    [string] $Version    = "",
    [bool]   $SkipPlaywright = $true,
    [switch] $NoPush
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# ── Helpers ──────────────────────────────────────────────────────────────────
function Write-Step  { param([string]$Msg) Write-Host "`n-- $Msg" -ForegroundColor Cyan }
function Write-Ok    { param([string]$Msg) Write-Host "  OK  $Msg" -ForegroundColor Green }
function Write-Warn  { param([string]$Msg) Write-Host "  !!  $Msg" -ForegroundColor Yellow }
function Write-Fail  { param([string]$Msg) Write-Host "  XX  $Msg" -ForegroundColor Red; exit 1 }

function Invoke-Ssh {
    param([string]$Cmd)
    $result = ssh -p $SshPort "$SshUser@$PiHost" $Cmd
    if ($LASTEXITCODE -ne 0) { Write-Fail "SSH command failed: $Cmd" }
    return $result
}

# ── Sanity checks ─────────────────────────────────────────────────────────────
Write-Step "Pre-flight checks"

foreach ($cmd in @("git", "ssh", "scp")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Fail "$cmd not found in PATH"
    }
}

$repoRoot = git -C $PSScriptRoot rev-parse --show-toplevel 2>&1
if ($LASTEXITCODE -ne 0) { Write-Fail "Not inside a git repository" }
Set-Location $repoRoot

Write-Ok "Repo root: $repoRoot"

# ── Handle uncommitted changes ─────────────────────────────────────────────────
Write-Step "Checking working tree"

$dirty = git status --porcelain
if ($dirty) {
    Write-Warn "Working tree has uncommitted changes:"
    git status --short
    $commitMsg = Read-Host "`n  Enter a commit message (or press Enter to abort)"
    if ([string]::IsNullOrWhiteSpace($commitMsg)) {
        Write-Fail "Aborted — commit your changes first or provide a commit message."
    }
    git add -A
    git commit -m $commitMsg
    if ($LASTEXITCODE -ne 0) { Write-Fail "git commit failed" }
    Write-Ok "Changes committed: $commitMsg"
} else {
    Write-Ok "Working tree is clean"
}

# ── Bump version ───────────────────────────────────────────────────────────────
Write-Step "Bumping version"

$pkgPath = Join-Path $repoRoot "package.json"
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json

$currentVersion = $pkg.version
Write-Ok "Current version: $currentVersion"

if ([string]::IsNullOrWhiteSpace($Version)) {
    $parts = $currentVersion -split '\.'
    $parts[2] = [string]([int]$parts[2] + 1)
    $newVersion = $parts -join '.'
} else {
    $newVersion = $Version.TrimStart('v')
}

Write-Ok "New version:     $newVersion"

# Update package.json (simple sed-style replace to preserve file formatting)
$pkgContent = Get-Content $pkgPath -Raw
$pkgContent = $pkgContent -replace '"version": "[^"]*"', "`"version`": `"$newVersion`""
Set-Content $pkgPath $pkgContent -NoNewline

$versionChanged = $false
$null = git diff --quiet package.json 2>&1 ; $versionChanged = $LASTEXITCODE -ne 0
if ($versionChanged) {
    git add package.json
    git commit -m "chore: bump to $newVersion"
    if ($LASTEXITCODE -ne 0) { Write-Fail "git commit failed" }
    Write-Ok "Version bumped and committed"
} else {
    Write-Ok "Version already at $newVersion — skipping commit"
}

# ── Archive & upload ───────────────────────────────────────────────────────────
Write-Step "Archiving repo and uploading to Pi"

$zipPath = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.zip'
git archive --format=zip HEAD -o $zipPath
if ($LASTEXITCODE -ne 0) { Write-Fail "git archive failed" }

$zipSize = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Ok "Archive created: $zipPath ($zipSize MB)"

scp -P $SshPort $zipPath "${SshUser}@${PiHost}:/tmp/nexari-src.zip"
if ($LASTEXITCODE -ne 0) { Write-Fail "scp failed" }
Remove-Item $zipPath -Force
Write-Ok "Uploaded to Pi"

# ── Build on Pi ────────────────────────────────────────────────────────────────
Write-Step "Building Docker image on Pi (this takes ~5 min on first build, ~2 min with cache)"

$imageTag  = "ghcr.io/omni-nexari/platform:$newVersion"
$skipPw    = if ($SkipPlaywright) { "1" } else { "0" }

$buildCmd  = @"
exec 2>&1
set -e
echo '  Extracting source...'
rm -rf /tmp/nexari-build
mkdir -p /tmp/nexari-build
cd /tmp/nexari-build && unzip -q /tmp/nexari-src.zip
rm /tmp/nexari-src.zip
echo '  Starting docker build...'
docker build \
  --build-arg SKIP_PLAYWRIGHT=$skipPw \
  -f /tmp/nexari-build/docker/Dockerfile \
  -t $imageTag \
  /tmp/nexari-build
rm -rf /tmp/nexari-build
echo 'BUILD_DONE'
"@

Write-Host ""
# Write build script to a temp .sh file with Unix line endings, SCP it, then run it.
# This avoids the Windows CRLF / SSH argument-passing issues.
$tmpScript = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.sh'
[System.IO.File]::WriteAllText($tmpScript, $buildCmd.Replace("`r`n", "`n").Replace("`r", "`n"))
scp -P $SshPort $tmpScript "${SshUser}@${PiHost}:/tmp/nexari-build.sh" | Out-Null
Remove-Item $tmpScript -Force

$buildOutput = ssh -p $SshPort "${SshUser}@${PiHost}" "bash /tmp/nexari-build.sh ; rm -f /tmp/nexari-build.sh"
$buildExitCode = $LASTEXITCODE
$buildOutput | ForEach-Object { Write-Host "    $_" }

# Wrap pipeline result in @() so .Count works under Set-StrictMode -Version Latest
# (Where-Object returns a plain string when exactly one item matches, not an array)
if ($buildExitCode -ne 0 -or @(@($buildOutput) | Where-Object { $_ -match 'BUILD_DONE' }).Count -eq 0) {
    Write-Fail "Docker build failed (exit $buildExitCode)"
}

Write-Ok "Image built: $imageTag"

# ── Push to GitHub (always) ────────────────────────────────────────────────────
# Both git and Pi must be on the same version. Push commits + force-update the
# tag so GHCR also gets a matching multi-arch image for partner installs.
if (-not $NoPush) {
    Write-Step "Pushing to GitHub"
    git push origin main
    if ($LASTEXITCODE -ne 0) { Write-Fail "git push failed" }
    # Force-update the tag in case it already exists (e.g. re-running for same version)
    git tag -f "v$newVersion"
    git push origin "v$newVersion" --force
    if ($LASTEXITCODE -ne 0) { Write-Fail "git tag push failed" }
    Write-Ok "Pushed main + tag v$newVersion -- GitHub Actions will build the GHCR image"
    Write-Host "  Follow: https://github.com/omni-nexari/platform/actions" -ForegroundColor DarkGray
}

# ── Sync docker-compose.yml to Pi ─────────────────────────────────────────────
Write-Step "Syncing docker-compose.yml to Pi"
$composeLocal = Join-Path $repoRoot "docker\docker-compose.yml"
scp -P $SshPort $composeLocal "${SshUser}@${PiHost}:/opt/nexari/docker-compose.yml"
if ($LASTEXITCODE -ne 0) { Write-Fail "scp docker-compose.yml failed" }
Write-Ok "docker-compose.yml synced"

# ── Deploy on Pi (using locally-built image — skip GHCR pull) ─────────────────
Write-Step "Deploying v$newVersion on Pi"
Write-Host "  Running update.sh --version v$newVersion --skip-pull"
ssh -p $SshPort "${SshUser}@${PiHost}" "cd /opt/nexari && bash update.sh --version v$newVersion --skip-pull"
if ($LASTEXITCODE -ne 0) { Write-Fail "Deploy failed" }
Write-Ok "Deployed v$newVersion on Pi"

# ── Summary ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Done. Pi is running v$newVersion." -ForegroundColor Green
if (-not $NoPush) {
    Write-Host "  GitHub Actions is building the GHCR image for partner installs." -ForegroundColor DarkGray
    Write-Host "  Follow: https://github.com/omni-nexari/platform/actions" -ForegroundColor DarkGray
}
