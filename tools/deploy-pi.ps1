param(
    [Parameter(Mandatory = $true)]
    [string]$Host,

    [string]$User = "signage",
    [string]$RemoteDir = "/opt/signage",
    [string]$GitRepo = "",
    [string]$Branch = "main",
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

Require-Command "git"
Require-Command "ssh"

$root = Split-Path -Parent $PSScriptRoot
$sshTarget = "$User@$Host"

if ($GitRepo) {
    Write-Host "Cloning/updating remote repo $GitRepo on $sshTarget:$RemoteDir ..." -ForegroundColor Cyan
    $cloneCmd = "mkdir -p '$RemoteDir' && if [ ! -d '$RemoteDir/.git' ]; then git clone --depth 1 --branch '$Branch' '$GitRepo' '$RemoteDir'; else git -C '$RemoteDir' fetch --all --prune && git -C '$RemoteDir' checkout '$Branch' || true && git -C '$RemoteDir' pull --rebase origin '$Branch' || true; fi"
    ssh $sshTarget $cloneCmd
    if ($LASTEXITCODE -ne 0) {
        throw "Remote git clone/pull failed"
    }
} else {
    Write-Host "Uploading repository to $sshTarget:$RemoteDir via git archive ..." -ForegroundColor Cyan
    $archiveCmd = "git archive --format=tar HEAD"
    $extractCmd = "mkdir -p '$RemoteDir' && tar -xf - -C '$RemoteDir'"

    cmd /c "$archiveCmd | ssh $sshTarget \"$extractCmd\""
    if ($LASTEXITCODE -ne 0) {
        throw "Upload failed"
    }
}

if ($RunBootstrap) {
    Write-Host "Running bootstrap on remote host ..." -ForegroundColor Yellow
    ssh $sshTarget "cd '$RemoteDir' && sudo bash infra/pi/bootstrap.sh"
    if ($LASTEXITCODE -ne 0) {
        throw "Bootstrap failed"
    }
}

Write-Host "Running deployment on remote host ..." -ForegroundColor Green
$envArgs = @()
if ($GitRepo) { $envArgs += "GIT_REPO='$GitRepo'" }
if ($Branch) { $envArgs += "BRANCH='$Branch'" }
if ($CertbotEmail) { $envArgs += "CERTBOT_EMAIL='$CertbotEmail'" }
$envStr = $envArgs -join ' '
ssh $sshTarget "cd '$RemoteDir' && $envStr bash infra/pi/deploy.sh"
if ($LASTEXITCODE -ne 0) {
    throw "Deploy failed"
}

Write-Host "Done."
Write-Host "Check health: ssh $sshTarget 'curl -sS http://127.0.0.1:3000/health'"
