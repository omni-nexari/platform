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
    $extractCmd = "sudo mkdir -p '$RemoteDir' && sudo chown $User`:$User '$RemoteDir' && tar -xf - -C '$RemoteDir'"
    cmd /c "$archiveCmd | ssh $sshTarget `"$extractCmd`""
    if ($LASTEXITCODE -ne 0) { throw "Archive upload failed" }
    # Strip Windows CRLF line endings from shell scripts before executing
    ssh $sshTarget "find '$RemoteDir/infra' -name '*.sh' -exec sed -i 's/\r//' {} \;"
    ssh $sshTarget "cd '$RemoteDir' && sudo GIT_REPO='$GitRepo' GIT_USERNAME='$GitUsername' GIT_TOKEN='$GitToken' BRANCH='$Branch' APP_DIR='$RemoteDir' APP_USER='$User' bash infra/pi/bootstrap.sh"
    if ($LASTEXITCODE -ne 0) { throw "Bootstrap failed" }
}

# ── Run update.sh on remote ───────────────────────────────────────────────────
Write-Host "Running update on $sshTarget ..." -ForegroundColor Green
$envStr = "APP_DIR='$RemoteDir' BRANCH='$Branch'"
ssh $sshTarget "$envStr bash $RemoteDir/infra/pi/update.sh"
if ($LASTEXITCODE -ne 0) { throw "Update failed" }

Write-Host ""
Write-Host "Done. Check health:" -ForegroundColor Green
Write-Host "  curl -sS http://127.0.0.1:3000/api/v1/health   (on Pi)" -ForegroundColor Gray
Write-Host "  https://ds.chiho.app/api/v1/health              (public once TLS up)" -ForegroundColor Gray
