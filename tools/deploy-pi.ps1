param(
    [Parameter(Mandatory = $true)]
    [string]$PiHost,

    [string]$User = "chiho",
    [int]$SshPort = 5551,
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
    [string]$IdentityFile = "$env:USERPROFILE\.ssh\id_ed25519",
    [string]$AppUser = "nexari",
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
$sshPortArgs = @("-p", $SshPort, "-i", $IdentityFile, "-o", "StrictHostKeyChecking=accept-new")

# ── Write .netrc on Pi for passwordless HTTPS clone ───────────────────────────
Write-Host "Configuring git credentials on $sshTarget ..." -ForegroundColor Cyan
$setupCreds = "printf 'machine github.com\nlogin $GitUsername\npassword $GitToken\n' > ~/.netrc && chmod 600 ~/.netrc"
ssh @sshPortArgs $sshTarget $setupCreds
if ($LASTEXITCODE -ne 0) { throw "Failed to write .netrc on remote host" }

if ($RunBootstrap) {
    Write-Host "Running bootstrap on remote host ..." -ForegroundColor Yellow
    # Step 1: create remote dir with sudo (NOPASSWD required in sudoers)
    ssh @sshPortArgs $sshTarget "sudo mkdir -p '$RemoteDir' && sudo chown $User`:$User '$RemoteDir'"
    if ($LASTEXITCODE -ne 0) { throw "Failed to create remote directory" }
    # Step 2: pipe git archive — no sudo needed, dir is already owned by user
    $archiveCmd = "git archive --format=tar HEAD"
    $extractCmd = "tar -xf - -C '$RemoteDir'"
    cmd /c "$archiveCmd | ssh -p $SshPort -i `"$IdentityFile`" -o StrictHostKeyChecking=accept-new $sshTarget `"$extractCmd`""
    if ($LASTEXITCODE -ne 0) { throw "Archive upload failed" }
    # Step 3: strip Windows CRLF line endings from shell scripts before executing
    ssh @sshPortArgs $sshTarget "find '$RemoteDir/infra' -name '*.sh' -exec sed -i 's/\r//' {} \;"
    # Step 4: run bootstrap
    ssh @sshPortArgs $sshTarget "cd '$RemoteDir' && sudo GIT_REPO='$GitRepo' GIT_USERNAME='$GitUsername' GIT_TOKEN='$GitToken' BRANCH='$Branch' APP_DIR='$RemoteDir' APP_USER='$AppUser' bash infra/pi/bootstrap.sh"
    if ($LASTEXITCODE -ne 0) { throw "Bootstrap failed" }
}

# ── Run update.sh on remote ───────────────────────────────────────────────────
Write-Host "Running update on $sshTarget ..." -ForegroundColor Green
$envStr = "APP_DIR='$RemoteDir' BRANCH='$Branch'"
ssh @sshPortArgs $sshTarget "$envStr bash $RemoteDir/infra/pi/update.sh"
if ($LASTEXITCODE -ne 0) { throw "Update failed" }

Write-Host ""
Write-Host "Done. Check health:" -ForegroundColor Green
Write-Host "  curl -sS http://127.0.0.1:3000/api/v1/health   (on Pi)" -ForegroundColor Gray
Write-Host "  https://platform.nexari.ca/api/v1/health              (public once TLS up)" -ForegroundColor Gray
