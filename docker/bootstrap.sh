#!/usr/bin/env bash
# Nexari Platform bootstrap installer
#
# Installs Docker Engine when needed, downloads the latest Nexari install
# package, then runs the interactive installer from /opt/nexari.

set -euo pipefail

INSTALL_DIR="${NEXARI_INSTALL_DIR:-/opt/nexari}"
PACKAGE_URL="${NEXARI_PACKAGE_URL:-https://github.com/omni-nexari/platform/releases/latest/download/nexari-install.tar.gz}"

info() { echo "[nexari] $*"; }
die()  { echo "[nexari] ERROR: $*" >&2; exit 1; }

if [[ "${EUID}" -ne 0 ]]; then
  die "Run this script with sudo: sudo bash nexari-bootstrap.sh"
fi

if ! command -v apt-get >/dev/null 2>&1; then
  die "This bootstrap installer supports Ubuntu/Debian servers. Use the manual Docker Compose guide for other Linux distributions."
fi

if [[ -r /etc/os-release ]]; then
  . /etc/os-release
else
  die "/etc/os-release not found"
fi

install_base_packages() {
  info "Installing required system packages"
  apt-get update
  apt-get install -y ca-certificates curl gnupg openssl tar gzip
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    info "Docker Engine and Compose plugin already installed"
    if command -v systemctl >/dev/null 2>&1; then
      systemctl enable --now docker
    fi
    return
  fi

  [[ "${ID:-}" == "ubuntu" || "${ID:-}" == "debian" ]] || die "Unsupported distribution: ${PRETTY_NAME:-unknown}"
  [[ -n "${VERSION_CODENAME:-}" ]] || die "Could not detect distribution codename"

  info "Installing Docker Engine and Compose plugin"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

download_package() {
  local archive
  archive="$(mktemp -t nexari-install.XXXXXX.tar.gz)"

  info "Downloading Nexari install package"
  curl -fL "$PACKAGE_URL" -o "$archive"

  info "Extracting install package to ${INSTALL_DIR}"
  mkdir -p "$INSTALL_DIR"
  tar xzf "$archive" -C "$INSTALL_DIR" --strip-components=1
  rm -f "$archive"
  chmod +x "$INSTALL_DIR/install.sh" "$INSTALL_DIR/update.sh" "$INSTALL_DIR/generate-keys.sh"
}

install_base_packages
install_docker
download_package

info "Starting interactive Nexari installer"
cd "$INSTALL_DIR"
bash install.sh "$@"
