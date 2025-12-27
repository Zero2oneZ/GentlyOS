#!/bin/bash
#
# GentlyOS Remote Installer
# One-liner installation from any system
#
# Usage:
#   curl -fsSL https://gentlyos.dev/install | bash
#   wget -qO- https://gentlyos.dev/install | bash
#

set -e

REPO="https://github.com/gentlyos/gentlyos"
INSTALL_DIR="${GENTLYOS_HOME:-/opt/gentlyos}"
TMP_DIR="/tmp/gentlyos-install-$$"

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║              GentlyOS Remote Installer                           ║"
echo "║                                                                  ║"
echo "║   Free for personal use | Enterprise requires license           ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# Detect OS
detect_os() {
    if [ -f /etc/alpine-release ]; then
        echo "alpine"
    elif [ -f /etc/debian_version ]; then
        echo "debian"
    elif [ -f /etc/fedora-release ]; then
        echo "fedora"
    elif [ -f /etc/arch-release ]; then
        echo "arch"
    elif [ "$(uname)" = "Darwin" ]; then
        echo "macos"
    else
        echo "unknown"
    fi
}

# Install dependencies
install_deps() {
    local os=$(detect_os)
    echo "[1/5] Installing dependencies ($os)..."

    case $os in
        alpine)
            apk add --no-cache nodejs npm git curl bash openssl
            ;;
        debian)
            apt-get update -qq
            apt-get install -y -qq nodejs npm git curl
            ;;
        fedora)
            dnf install -y nodejs npm git curl
            ;;
        arch)
            pacman -Sy --noconfirm nodejs npm git curl
            ;;
        macos)
            if command -v brew >/dev/null 2>&1; then
                brew install node git
            else
                echo "Install Homebrew first: https://brew.sh"
                exit 1
            fi
            ;;
        *)
            echo "Unknown OS. Please install: nodejs, npm, git, curl"
            ;;
    esac
}

# Download GentlyOS
download() {
    echo "[2/5] Downloading GentlyOS..."

    mkdir -p "$TMP_DIR"
    cd "$TMP_DIR"

    if command -v git >/dev/null 2>&1; then
        git clone --depth 1 "$REPO" gentlyos 2>/dev/null || {
            # Fallback to tarball
            curl -sL "$REPO/archive/main.tar.gz" | tar -xz
            mv gentlyos-main gentlyos
        }
    else
        curl -sL "$REPO/archive/main.tar.gz" | tar -xz
        mv gentlyos-main gentlyos
    fi
}

# Install
install() {
    echo "[3/5] Installing to $INSTALL_DIR..."

    sudo mkdir -p "$INSTALL_DIR"
    sudo cp -r "$TMP_DIR/gentlyos/"* "$INSTALL_DIR/"
    sudo chown -R $(whoami) "$INSTALL_DIR"

    cd "$INSTALL_DIR"
    npm install --production --silent 2>/dev/null || true
}

# Setup service
setup_service() {
    echo "[4/5] Setting up service..."

    if command -v systemctl >/dev/null 2>&1; then
        sudo tee /etc/systemd/system/gentlyos.service > /dev/null << EOF
[Unit]
Description=GentlyOS
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node $INSTALL_DIR/index.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
        sudo systemctl daemon-reload
        sudo systemctl enable gentlyos
    fi
}

# Install dev stack (optional)
install_stack() {
    echo "[5/5] Installing dev stack (Rust, Solana, etc)..."

    if [ -f "$INSTALL_DIR/boot/overlay/root/.gentlyos/install-stack.sh" ]; then
        read -p "Install full dev stack? (Rust, Solana, Anchor, IPFS) [y/N] " answer
        if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
            sudo bash "$INSTALL_DIR/boot/overlay/root/.gentlyos/install-stack.sh"
        else
            echo "Skipped. Run later: sudo bash $INSTALL_DIR/boot/overlay/root/.gentlyos/install-stack.sh"
        fi
    fi
}

# Cleanup
cleanup() {
    rm -rf "$TMP_DIR"
}

# Main
main() {
    trap cleanup EXIT

    # Check if running as root for system install
    if [ "$(id -u)" -eq 0 ]; then
        install_deps
    else
        echo "Note: Run as root for system-wide install, or install to user directory"
        INSTALL_DIR="$HOME/.gentlyos"
    fi

    download
    install
    [ "$(id -u)" -eq 0 ] && setup_service
    install_stack

    echo ""
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║                   Installation Complete!                         ║"
    echo "╠══════════════════════════════════════════════════════════════════╣"
    echo "║ Location: $INSTALL_DIR"
    echo "║                                                                  ║"
    echo "║ Start GentlyOS:                                                  ║"
    echo "║   node $INSTALL_DIR/index.js"
    echo "║                                                                  ║"
    echo "║ Or if service installed:                                         ║"
    echo "║   sudo systemctl start gentlyos                                  ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
}

main "$@"
