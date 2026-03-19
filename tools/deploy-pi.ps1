param(
    [Parameter(Mandatory = $true)]
    [string]$PiHost,

    [string]$User = "chiho",
    [string]$RemoteDir = "/opt/signage",

    # GitHub HTTPS access
    [Parameter(Mandatory = $true)]
    [string]$GitRepo,
    [string]$Branch = "main",
    [Parameter(Mandatory = $true)]
    [string]$GitUsername,
    [Parameter(Mandatory = $true)]
    [string]$GitToken,

    [string]$CertbotEmail = "",
    [switch]$RunBootstrap
)

$ErrorActionPreference = "Stop"

function Require-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

Require-Command "ssh"

$sshTarget = "$User@$PiHost"

# ── Write .netrc on Pi for passwordless HTTPS clone ───────────────────────────
Write-Host "Configuring git credentials on $sshTarget ..." -ForegroundColor Cyan
$setupCreds = "printf 'machine github.com\nlogin $GitUsername\npassword $GitToken\n' > ~/.netrc && chmod 600 ~/.netrc"
ssh $sshTarget $setupCreds
if ($LASTEXITCODE -ne 0) { throw "Failed to write .netrc on remote host" }

if ($RunBootstrap) {
    Write-Host "Running bootstrap on remote host ..." -ForegroundColor Yellow
    # Bootstrap requires the repo to already be present; upload a minimal copy first via git archive
    $archiveCmd = "git archive --format=tar HEAD"
    $extractCmd = "mkdir -p '$RemoteDir' && tar -xf - -C '$RemoteDir'"
    cmd /c "$archiveCmd | ssh $sshTarget `"$extractCmd`""
    if ($LASTEXITCODE -ne 0) { throw "Archive upload failed" }
    ssh $sshTarget "cd '$RemoteDir' && sudo bash infra/pi/bootstrap.sh"
    if ($LASTEXITCODE -ne 0) { throw "Bootstrap failed" }
}

# ── Run deploy.sh on remote ────────────────────────────────────────────────────
Write-Host "Running deployment on $sshTarget ..." -ForegroundColor Green
$envArgs = @(
    "GIT_REPO='$GitRepo'",
    "BRANCH='$Branch'",
    "APP_DIR='$RemoteDir'"
)
if ($CertbotEmail) { $envArgs += "CERTBOT_EMAIL='$CertbotEmail'" }
$envStr = $envArgs -join ' '
ssh $sshTarget "$envStr bash -s" -T < "$PSScriptRoot/../infra/pi/deploy.sh"
if ($LASTEXITCODE -ne 0) { throw "Deploy failed" }

Write-Host ""
Write-Host "Done. Check health:" -ForegroundColor Green
Write-Host "  curl -sS http://127.0.0.1:3000/health   (on Pi)" -ForegroundColor Gray
Write-Host "  https://ds.chiho.app/api/health          (public once TLS up)" -ForegroundColor Gray
