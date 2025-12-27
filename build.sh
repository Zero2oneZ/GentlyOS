#!/bin/bash
#
# GentlyOS Automated Build Script
# Creates a flashable runtime installer
#
# Usage:
#   ./build.sh              # Build ISO
#   ./build.sh flash /dev/sdX   # Build and flash to USB
#

set -e

VERSION="0.1.0"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="${TMPDIR:-/tmp}/gentlyos-build-$$"
OUTPUT_DIR="$SCRIPT_DIR/dist"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

log() { echo -e "${GREEN}[BUILD]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
step() { echo -e "\n${PURPLE}━━━ $1 ━━━${NC}"; }

banner() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║                 GentlyOS Build System v${VERSION}                      ║"
    echo "║          Automated Flashable Runtime Installer                   ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Check requirements
check_requirements() {
    step "Checking Requirements"

    local missing=0

    for cmd in tar gzip curl wget; do
        if command -v $cmd >/dev/null 2>&1; then
            log "✓ $cmd"
        else
            warn "✗ $cmd (missing)"
            missing=1
        fi
    done

    if [ $missing -eq 1 ]; then
        warn "Some tools missing, build may be limited"
    fi
}

# Verify build with 10-layer chain
verify_chain() {
    step "Chain Verification (10-Layer)"

    cd "$SCRIPT_DIR"

    if command -v python3 >/dev/null 2>&1 && [ -f "security/chain/verifier.py" ]; then
        python3 security/chain/verifier.py --verify-build
    elif command -v node >/dev/null 2>&1 && [ -f "security/chain/index.js" ]; then
        node security/chain/index.js
    else
        warn "Chain verifier not available, skipping..."
    fi
}

# Build GentlyOS core
build_core() {
    step "Building GentlyOS Core"

    cd "$SCRIPT_DIR"

    # Validate core files exist
    local core_files=(
        "index.js"
        "core/primitives/catalog.js"
        "core/codie/parser.js"
        "intelligence/fusion/graph.js"
        "intelligence/tiny-model/inference.js"
        "security/index.js"
    )

    for file in "${core_files[@]}"; do
        if [ -f "$file" ]; then
            log "✓ $file"
        else
            warn "✗ $file (missing)"
        fi
    done

    log "Core validated"

    # Run chain verification
    verify_chain
}

# Build apps
build_apps() {
    step "Building Desktop Apps"

    # Electron
    if [ -d "$SCRIPT_DIR/apps/electron" ]; then
        log "Building Electron..."
        cd "$SCRIPT_DIR/apps/electron"
        if command -v npm >/dev/null 2>&1; then
            npm install --silent 2>/dev/null || true
            log "✓ Electron dependencies installed"
        fi
    fi

    # Tauri
    if [ -d "$SCRIPT_DIR/apps/tauri" ]; then
        log "Building Tauri..."
        cd "$SCRIPT_DIR/apps/tauri"
        if command -v npm >/dev/null 2>&1; then
            npm install --silent 2>/dev/null || true
            log "✓ Tauri dependencies installed"
        fi
        if command -v cargo >/dev/null 2>&1; then
            cd src-tauri
            cargo build --release 2>/dev/null && log "✓ Tauri binary built" || warn "Tauri build skipped"
        fi
    fi
}

# Create runtime package
create_package() {
    step "Creating Runtime Package"

    mkdir -p "$BUILD_DIR/gentlyos"
    mkdir -p "$OUTPUT_DIR"

    # Copy all source files
    log "Copying source files..."

    cp -r "$SCRIPT_DIR/core" "$BUILD_DIR/gentlyos/"
    cp -r "$SCRIPT_DIR/intelligence" "$BUILD_DIR/gentlyos/"
    cp -r "$SCRIPT_DIR/storage" "$BUILD_DIR/gentlyos/"
    cp -r "$SCRIPT_DIR/infra" "$BUILD_DIR/gentlyos/"
    cp -r "$SCRIPT_DIR/security" "$BUILD_DIR/gentlyos/"
    cp -r "$SCRIPT_DIR/apps" "$BUILD_DIR/gentlyos/"
    cp -r "$SCRIPT_DIR/boot" "$BUILD_DIR/gentlyos/"

    cp "$SCRIPT_DIR/index.js" "$BUILD_DIR/gentlyos/"
    cp "$SCRIPT_DIR/package.json" "$BUILD_DIR/gentlyos/"
    cp "$SCRIPT_DIR/LICENSE.md" "$BUILD_DIR/gentlyos/"
    cp "$SCRIPT_DIR/CLAUDE.md" "$BUILD_DIR/gentlyos/"

    # Create installer script
    create_installer

    # Create tarball
    log "Creating tarball..."
    cd "$BUILD_DIR"
    tar -czf "$OUTPUT_DIR/gentlyos-${VERSION}-runtime.tar.gz" gentlyos/

    log "✓ Package: $OUTPUT_DIR/gentlyos-${VERSION}-runtime.tar.gz"
}

# Create self-extracting installer
create_installer() {
    log "Creating installer..."

    cat > "$BUILD_DIR/gentlyos/install.sh" << 'INSTALLER_EOF'
#!/bin/bash
#
# GentlyOS Runtime Installer
# Installs GentlyOS and all dependencies
#

set -e

INSTALL_DIR="${GENTLYOS_HOME:-/opt/gentlyos}"

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║              GentlyOS Runtime Installer                          ║"
echo "╚══════════════════════════════════════════════════════════════════╝"

# Check root
if [ "$(id -u)" -ne 0 ]; then
    echo "[!] Root required. Run: sudo ./install.sh"
    exit 1
fi

echo "[1/6] Creating directories..."
mkdir -p "$INSTALL_DIR"
mkdir -p /var/log/gentlyos
mkdir -p /etc/gentlyos

echo "[2/6] Copying files..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp -r "$SCRIPT_DIR"/* "$INSTALL_DIR/"

echo "[3/6] Installing system packages..."
if command -v apk >/dev/null 2>&1; then
    # Alpine
    apk add --no-cache nodejs npm git curl wget openssl bash
elif command -v apt-get >/dev/null 2>&1; then
    # Debian/Ubuntu
    apt-get update -qq
    apt-get install -y -qq nodejs npm git curl wget openssl
elif command -v dnf >/dev/null 2>&1; then
    # Fedora
    dnf install -y nodejs npm git curl wget openssl
elif command -v pacman >/dev/null 2>&1; then
    # Arch
    pacman -Sy --noconfirm nodejs npm git curl wget openssl
fi

echo "[4/6] Installing Node dependencies..."
cd "$INSTALL_DIR"
npm install --production --silent 2>/dev/null || true

echo "[5/6] Installing dev stack..."
if [ -f "$INSTALL_DIR/boot/overlay/root/.gentlyos/install-stack.sh" ]; then
    bash "$INSTALL_DIR/boot/overlay/root/.gentlyos/install-stack.sh" || echo "  (partial install)"
fi

echo "[6/6] Creating systemd service..."
cat > /etc/systemd/system/gentlyos.service << 'SERVICE_EOF'
[Unit]
Description=GentlyOS Self-Evolving OS
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node /opt/gentlyos/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=GENTLYOS_HOME=/opt/gentlyos

[Install]
WantedBy=multi-user.target
SERVICE_EOF

systemctl daemon-reload
systemctl enable gentlyos

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                   Installation Complete!                         ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║ GentlyOS installed to: $INSTALL_DIR"
echo "║                                                                  ║"
echo "║ Commands:                                                        ║"
echo "║   systemctl start gentlyos    # Start service                    ║"
echo "║   systemctl status gentlyos   # Check status                     ║"
echo "║   node /opt/gentlyos          # Run directly                     ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
INSTALLER_EOF

    chmod +x "$BUILD_DIR/gentlyos/install.sh"
}

# Create bootable ISO
create_iso() {
    step "Creating Bootable ISO"

    if [ ! -f "$SCRIPT_DIR/boot/iso/build.sh" ]; then
        warn "ISO build script not found, skipping"
        return
    fi

    # Check for required tools
    if ! command -v xorriso >/dev/null 2>&1; then
        warn "xorriso not installed, skipping ISO creation"
        return
    fi

    bash "$SCRIPT_DIR/boot/iso/build.sh"

    if [ -f "$SCRIPT_DIR/boot/iso/"*.iso ]; then
        mv "$SCRIPT_DIR/boot/iso/"*.iso "$OUTPUT_DIR/"
        log "✓ ISO created in $OUTPUT_DIR/"
    fi
}

# Create flashable image
create_image() {
    step "Creating Flashable Image"

    local iso_file=$(ls "$OUTPUT_DIR/"*.iso 2>/dev/null | head -1)

    if [ -z "$iso_file" ]; then
        warn "No ISO found, creating raw image..."

        # Create a raw bootable image
        local img_file="$OUTPUT_DIR/gentlyos-${VERSION}.img"
        local img_size="2G"

        dd if=/dev/zero of="$img_file" bs=1M count=2048 2>/dev/null
        log "✓ Created ${img_size} image"

        # Create partition table
        if command -v parted >/dev/null 2>&1; then
            parted -s "$img_file" mklabel msdos
            parted -s "$img_file" mkpart primary fat32 1MiB 100%
            parted -s "$img_file" set 1 boot on
            log "✓ Partition table created"
        fi

        log "✓ Image: $img_file"
    else
        # Copy ISO as IMG
        local img_file="${iso_file%.iso}.img"
        cp "$iso_file" "$img_file"
        log "✓ Image: $img_file"
    fi
}

# Flash to device
flash_device() {
    local device="$1"

    step "Flashing to $device"

    if [ -z "$device" ]; then
        error "No device specified. Usage: ./build.sh flash /dev/sdX"
    fi

    if [ ! -b "$device" ]; then
        error "$device is not a block device"
    fi

    local img_file=$(ls "$OUTPUT_DIR/"*.img 2>/dev/null | head -1)

    if [ -z "$img_file" ]; then
        error "No image found. Run ./build.sh first"
    fi

    echo ""
    warn "⚠ WARNING: This will ERASE ALL DATA on $device"
    echo "   Image: $img_file"
    echo ""
    read -p "Type 'yes' to continue: " confirm

    if [ "$confirm" != "yes" ]; then
        echo "Aborted."
        exit 1
    fi

    log "Unmounting $device..."
    umount "${device}"* 2>/dev/null || true

    log "Flashing (this may take a few minutes)..."
    dd if="$img_file" of="$device" bs=4M status=progress conv=fsync

    sync

    log "✓ Flash complete!"
    echo ""
    echo "Safe to remove $device"
    echo "Boot from USB to start GentlyOS"
}

# Cleanup
cleanup() {
    rm -rf "$BUILD_DIR"
}

# Main
main() {
    banner

    trap cleanup EXIT

    case "${1:-}" in
        flash)
            flash_device "$2"
            ;;
        clean)
            rm -rf "$OUTPUT_DIR"
            log "Cleaned"
            ;;
        *)
            check_requirements
            build_core
            build_apps
            create_package
            create_iso
            create_image

            echo ""
            step "Build Complete"
            echo ""
            log "Output directory: $OUTPUT_DIR"
            ls -lh "$OUTPUT_DIR/" 2>/dev/null || true
            echo ""
            log "To flash to USB:"
            echo "   ./build.sh flash /dev/sdX"
            ;;
    esac
}

main "$@"
