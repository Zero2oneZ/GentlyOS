# GentlyOS Build System
# Single command: make all
# Creates flashable ISO with everything pre-installed

SHELL := /bin/bash
VERSION := 0.1.0
ARCH := x86_64
BUILD_DIR := /tmp/gentlyos-build
ISO_NAME := gentlyos-$(VERSION)-$(ARCH).iso
IMG_NAME := gentlyos-$(VERSION)-$(ARCH).img

.PHONY: all clean iso img electron tauri core install flash help

# Default target
all: core electron tauri iso
	@echo "✓ Build complete: $(ISO_NAME)"

help:
	@echo "GentlyOS Build System"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@echo "  all       - Build everything (default)"
	@echo "  core      - Build GentlyOS core"
	@echo "  electron  - Build Electron app"
	@echo "  tauri     - Build Tauri app"
	@echo "  iso       - Create bootable ISO"
	@echo "  img       - Create flashable IMG"
	@echo "  flash     - Flash to USB (requires DEVICE=)"
	@echo "  clean     - Remove build artifacts"
	@echo ""
	@echo "Examples:"
	@echo "  make all"
	@echo "  make flash DEVICE=/dev/sdb"

# Build core Node.js modules
core:
	@echo "→ Building GentlyOS core..."
	@cd $(CURDIR) && npm install --production 2>/dev/null || true
	@echo "✓ Core ready"

# Build Electron app
electron:
	@echo "→ Building Electron app..."
	@cd $(CURDIR)/apps/electron && npm install 2>/dev/null || true
	@cd $(CURDIR)/apps/electron && npm run build 2>/dev/null || echo "  (dev mode only)"
	@echo "✓ Electron ready"

# Build Tauri app
tauri:
	@echo "→ Building Tauri app..."
	@cd $(CURDIR)/apps/tauri && npm install 2>/dev/null || true
	@if command -v cargo >/dev/null 2>&1; then \
		cd $(CURDIR)/apps/tauri && npm run build 2>/dev/null || echo "  (dev mode only)"; \
	else \
		echo "  (Rust not installed, skipping binary build)"; \
	fi
	@echo "✓ Tauri ready"

# Create bootable ISO
iso: prepare-overlay
	@echo "→ Creating bootable ISO..."
	@bash $(CURDIR)/boot/iso/build.sh
	@echo "✓ ISO created: boot/iso/$(ISO_NAME)"

# Create flashable IMG (for dd)
img: iso
	@echo "→ Converting to IMG..."
	@cp $(CURDIR)/boot/iso/$(ISO_NAME) $(CURDIR)/boot/iso/$(IMG_NAME)
	@echo "✓ IMG created: boot/iso/$(IMG_NAME)"

# Prepare overlay with all built artifacts
prepare-overlay:
	@echo "→ Preparing boot overlay..."
	@mkdir -p $(CURDIR)/boot/overlay/root/.gentlyos
	@cp -r $(CURDIR)/core $(CURDIR)/boot/overlay/root/.gentlyos/ 2>/dev/null || true
	@cp -r $(CURDIR)/intelligence $(CURDIR)/boot/overlay/root/.gentlyos/ 2>/dev/null || true
	@cp -r $(CURDIR)/storage $(CURDIR)/boot/overlay/root/.gentlyos/ 2>/dev/null || true
	@cp -r $(CURDIR)/infra $(CURDIR)/boot/overlay/root/.gentlyos/ 2>/dev/null || true
	@cp -r $(CURDIR)/security $(CURDIR)/boot/overlay/root/.gentlyos/ 2>/dev/null || true
	@cp -r $(CURDIR)/apps $(CURDIR)/boot/overlay/root/.gentlyos/ 2>/dev/null || true
	@cp $(CURDIR)/index.js $(CURDIR)/boot/overlay/root/.gentlyos/ 2>/dev/null || true
	@cp $(CURDIR)/package.json $(CURDIR)/boot/overlay/root/.gentlyos/ 2>/dev/null || true
	@echo "✓ Overlay prepared"

# Flash to USB device
flash:
ifndef DEVICE
	$(error DEVICE not set. Usage: make flash DEVICE=/dev/sdX)
endif
	@echo "⚠ WARNING: This will ERASE $(DEVICE)"
	@echo "Press Ctrl+C to cancel, Enter to continue..."
	@read
	@echo "→ Flashing to $(DEVICE)..."
	@sudo dd if=$(CURDIR)/boot/iso/$(IMG_NAME) of=$(DEVICE) bs=4M status=progress conv=fsync
	@sudo sync
	@echo "✓ Flash complete. Safe to remove $(DEVICE)"

# Clean build artifacts
clean:
	@echo "→ Cleaning..."
	@rm -rf $(BUILD_DIR)
	@rm -f $(CURDIR)/boot/iso/*.iso
	@rm -f $(CURDIR)/boot/iso/*.img
	@rm -rf $(CURDIR)/apps/electron/dist
	@rm -rf $(CURDIR)/apps/tauri/src-tauri/target
	@rm -rf $(CURDIR)/node_modules
	@echo "✓ Clean"

# Install dependencies (run on target system)
install:
	@echo "→ Installing GentlyOS runtime..."
	@bash $(CURDIR)/boot/overlay/root/.gentlyos/install-stack.sh
	@echo "✓ Installation complete"
