#!/bin/sh
# GentlyOS Build Script v0.1.0

set -e

VERSION=$(cat VERSION)
TARGET="${1:-metal}"
ARCH="${2:-x86_64}"

echo "Building GentlyOS v${VERSION}"
echo "Target: ${TARGET}"
echo "Arch: ${ARCH}"

case "$TARGET" in
    metal)
        echo "Building bare metal image..."
        # TODO: mkimage integration
        ;;
    vm)
        echo "Building VM image..."
        # TODO: qcow2/vmdk generation
        ;;
    container)
        echo "Building container rootfs..."
        # TODO: OCI rootfs tarball
        ;;
    wasm)
        echo "Building WebAssembly image..."
        # TODO: WebVM compatible build
        ;;
    android)
        echo "Building Android/proot rootfs..."
        # TODO: Termux-compatible rootfs
        ;;
    *)
        echo "Unknown target: $TARGET"
        exit 1
        ;;
esac

echo "Build complete!"
