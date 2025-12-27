#!/bin/sh
# Download Alpine netboot files for GentlyOS

VERSION="${1:-3.21}"
ARCH="${2:-x86_64}"
RELEASE="3.21.2"

echo "Downloading Alpine netboot ${RELEASE} for ${ARCH}..."

cd "$(dirname "$0")"

curl -L -O "https://dl-cdn.alpinelinux.org/alpine/v${VERSION}/releases/${ARCH}/alpine-netboot-${RELEASE}-${ARCH}.tar.gz"

echo "Extracting..."
tar -xzf "alpine-netboot-${RELEASE}-${ARCH}.tar.gz"

echo "Copying to parent boot directory..."
cp -r boot/* ../boot/ 2>/dev/null || mkdir -p ../boot && cp -r boot/* ../boot/

echo "Done! Boot files ready in ../boot/"
