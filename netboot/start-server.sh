#!/bin/sh
# GentlyOS HTTP Install Server

PORT="${1:-8080}"
IP=$(ip addr show wlan0 2>/dev/null | grep "inet " | awk '{print $2}' | cut -d/ -f1)

echo "========================================="
echo "  GentlyOS HTTP Install Server"
echo "========================================="
echo ""
echo "Server: http://${IP}:${PORT}/"
echo ""
echo "Boot options for target machine:"
echo ""
echo "KERNEL:   http://${IP}:${PORT}/boot/vmlinuz-lts"
echo "INITRD:   http://${IP}:${PORT}/boot/initramfs-lts"
echo "MODLOOP:  http://${IP}:${PORT}/boot/modloop-lts"
echo ""
echo "Kernel command line:"
echo "  alpine_repo=http://${IP}:${PORT}/apks"
echo "  modloop=http://${IP}:${PORT}/boot/modloop-lts"
echo "  ip=dhcp"
echo ""
echo "========================================="
echo "Starting HTTP server on port ${PORT}..."
echo "Press Ctrl+C to stop"
echo "========================================="

cd "$(dirname "$0")"
python -m http.server ${PORT}
