#!/bin/bash
#
# GentlyOS ISO Builder
# Creates bootable Alpine Linux ISO with GentlyOS pre-installed
#

set -e

# Configuration
ALPINE_VERSION="3.19"
ALPINE_MINOR="1"
ARCH="x86_64"
ISO_NAME="gentlyos-${ALPINE_VERSION}.${ALPINE_MINOR}-${ARCH}.iso"
BUILD_DIR="${TMPDIR:-$HOME/.cache}/gentlyos-build"
OVERLAY_DIR="$(dirname "$0")/../overlay"
CORE_DIR="$(dirname "$0")/../../"

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                   GentlyOS ISO Builder                           ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║ Alpine Version: ${ALPINE_VERSION}.${ALPINE_MINOR}                                         ║"
echo "║ Architecture:   ${ARCH}                                          ║"
echo "╚══════════════════════════════════════════════════════════════════╝"

# Check requirements
check_requirements() {
    echo "[BUILD] Checking requirements..."

    for cmd in wget tar gzip cpio xorriso; do
        if ! command -v $cmd >/dev/null 2>&1; then
            echo "[ERROR] Missing: $cmd"
            echo "Install with: apk add $cmd (Alpine) or apt install $cmd (Debian)"
            exit 1
        fi
    done

    echo "[BUILD] All requirements met"
}

# Download Alpine ISO
download_alpine() {
    echo "[BUILD] Downloading Alpine Linux ${ALPINE_VERSION}.${ALPINE_MINOR}..."

    mkdir -p "$BUILD_DIR"
    cd "$BUILD_DIR"

    ALPINE_ISO="alpine-standard-${ALPINE_VERSION}.${ALPINE_MINOR}-${ARCH}.iso"
    ALPINE_URL="https://dl-cdn.alpinelinux.org/alpine/v${ALPINE_VERSION}/releases/${ARCH}/${ALPINE_ISO}"

    if [ ! -f "$ALPINE_ISO" ]; then
        wget -q --show-progress "$ALPINE_URL" -O "$ALPINE_ISO"
    else
        echo "[BUILD] Using cached Alpine ISO"
    fi
}

# Extract and modify ISO
modify_iso() {
    echo "[BUILD] Extracting ISO..."

    mkdir -p "$BUILD_DIR/iso-mount"
    mkdir -p "$BUILD_DIR/iso-new"

    # Mount original ISO
    mount -o loop "$BUILD_DIR/alpine-standard-${ALPINE_VERSION}.${ALPINE_MINOR}-${ARCH}.iso" "$BUILD_DIR/iso-mount" 2>/dev/null || \
        xorriso -osirrox on -indev "$BUILD_DIR/alpine-standard-${ALPINE_VERSION}.${ALPINE_MINOR}-${ARCH}.iso" -extract / "$BUILD_DIR/iso-new"

    # Copy to writable directory
    if mountpoint -q "$BUILD_DIR/iso-mount"; then
        cp -a "$BUILD_DIR/iso-mount/"* "$BUILD_DIR/iso-new/"
        umount "$BUILD_DIR/iso-mount"
    fi

    echo "[BUILD] Modifying ISO..."
}

# Create apkovl overlay
create_overlay() {
    echo "[BUILD] Creating GentlyOS overlay..."

    mkdir -p "$BUILD_DIR/overlay"

    # Copy overlay files
    cp -a "$OVERLAY_DIR/"* "$BUILD_DIR/overlay/"

    # Copy core GentlyOS files
    mkdir -p "$BUILD_DIR/overlay/root/.gentlyos/core"
    mkdir -p "$BUILD_DIR/overlay/root/.gentlyos/intelligence"
    mkdir -p "$BUILD_DIR/overlay/root/.gentlyos/storage"
    mkdir -p "$BUILD_DIR/overlay/root/.gentlyos/infra"
    mkdir -p "$BUILD_DIR/overlay/root/.gentlyos/security"

    # Copy core modules
    cp -a "$CORE_DIR/core/"* "$BUILD_DIR/overlay/root/.gentlyos/core/" 2>/dev/null || true
    cp -a "$CORE_DIR/intelligence/"* "$BUILD_DIR/overlay/root/.gentlyos/intelligence/" 2>/dev/null || true
    cp -a "$CORE_DIR/storage/"* "$BUILD_DIR/overlay/root/.gentlyos/storage/" 2>/dev/null || true
    cp -a "$CORE_DIR/infra/"* "$BUILD_DIR/overlay/root/.gentlyos/infra/" 2>/dev/null || true
    cp -a "$CORE_DIR/security/"* "$BUILD_DIR/overlay/root/.gentlyos/security/" 2>/dev/null || true

    # Copy boot genesis scripts (Solana/BTC-first)
    mkdir -p "$BUILD_DIR/overlay/root/.gentlyos/boot/genesis"
    cp -a "$CORE_DIR/boot/genesis/"* "$BUILD_DIR/overlay/root/.gentlyos/boot/genesis/" 2>/dev/null || true

    # Copy VERSION file
    cp "$CORE_DIR/VERSION" "$BUILD_DIR/overlay/root/.gentlyos/VERSION" 2>/dev/null || echo "0.1.0" > "$BUILD_DIR/overlay/root/.gentlyos/VERSION"

    # Make all scripts executable
    chmod +x "$BUILD_DIR/overlay/etc/local.d/gentlyos.start"
    chmod +x "$BUILD_DIR/overlay/root/.gentlyos/install-stack.sh" 2>/dev/null || true
    find "$BUILD_DIR/overlay/root/.gentlyos/boot/genesis" -name "*.sh" -exec chmod +x {} \; 2>/dev/null || true
    find "$BUILD_DIR/overlay/root/.gentlyos/boot/genesis" -name "*.js" -exec chmod +x {} \; 2>/dev/null || true

    # Create the apkovl tarball
    cd "$BUILD_DIR/overlay"
    tar czvf "$BUILD_DIR/iso-new/gentlyos.apkovl.tar.gz" .

    echo "[BUILD] Overlay created: $(du -h "$BUILD_DIR/iso-new/gentlyos.apkovl.tar.gz" | cut -f1)"
}

# Configure boot
configure_boot() {
    echo "[BUILD] Configuring boot..."

    # Modify syslinux.cfg for auto-boot with overlay
    if [ -f "$BUILD_DIR/iso-new/boot/syslinux/syslinux.cfg" ]; then
        cat > "$BUILD_DIR/iso-new/boot/syslinux/syslinux.cfg" << 'EOF'
TIMEOUT 20
PROMPT 1
DEFAULT gentlyos

LABEL gentlyos
    MENU LABEL GentlyOS
    KERNEL /boot/vmlinuz-lts
    INITRD /boot/initramfs-lts
    APPEND modules=loop,squashfs,sd-mod,usb-storage quiet nomodeset apkovl=gentlyos.apkovl.tar.gz

LABEL alpine
    MENU LABEL Alpine Linux (Standard)
    KERNEL /boot/vmlinuz-lts
    INITRD /boot/initramfs-lts
    APPEND modules=loop,squashfs,sd-mod,usb-storage quiet
EOF
    fi

    # GRUB config for UEFI
    if [ -d "$BUILD_DIR/iso-new/boot/grub" ]; then
        cat > "$BUILD_DIR/iso-new/boot/grub/grub.cfg" << 'EOF'
set timeout=5
set default=0

menuentry "GentlyOS" {
    linux /boot/vmlinuz-lts modules=loop,squashfs,sd-mod,usb-storage quiet nomodeset apkovl=gentlyos.apkovl.tar.gz
    initrd /boot/initramfs-lts
}

menuentry "Alpine Linux (Standard)" {
    linux /boot/vmlinuz-lts modules=loop,squashfs,sd-mod,usb-storage quiet
    initrd /boot/initramfs-lts
}
EOF
    fi
}

# Build final ISO
build_iso() {
    echo "[BUILD] Building final ISO..."

    cd "$BUILD_DIR"

    xorriso -as mkisofs \
        -o "$ISO_NAME" \
        -isohybrid-mbr /usr/share/syslinux/isohdpfx.bin 2>/dev/null || \
    xorriso -as mkisofs \
        -o "$ISO_NAME" \
        -V "GENTLYOS" \
        -c boot/syslinux/boot.cat \
        -b boot/syslinux/isolinux.bin \
        -no-emul-boot \
        -boot-load-size 4 \
        -boot-info-table \
        iso-new

    # Move to output directory
    mv "$ISO_NAME" "$(dirname "$0")/"

    echo ""
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║                    Build Complete!                               ║"
    echo "╠══════════════════════════════════════════════════════════════════╣"
    echo "║ ISO: $(dirname "$0")/$ISO_NAME"
    echo "║ Size: $(du -h "$(dirname "$0")/$ISO_NAME" | cut -f1)"
    echo "╠══════════════════════════════════════════════════════════════════╣"
    echo "║ To boot:                                                         ║"
    echo "║   1. Write to USB: dd if=$ISO_NAME of=/dev/sdX bs=4M            ║"
    echo "║   2. Boot from USB                                               ║"
    echo "║   3. Run: /root/.gentlyos/install-stack.sh                       ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
}

# Cleanup
cleanup() {
    echo "[BUILD] Cleaning up..."
    rm -rf "$BUILD_DIR/iso-mount"
    rm -rf "$BUILD_DIR/iso-new"
    rm -rf "$BUILD_DIR/overlay"
    # Keep downloaded Alpine ISO for future builds
}

# Main
main() {
    check_requirements
    download_alpine
    modify_iso
    create_overlay
    configure_boot
    build_iso
    cleanup
}

main "$@"
