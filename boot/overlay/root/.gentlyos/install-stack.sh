#!/bin/sh
#
# GentlyOS Full Stack Installer
# Installs: Rust, Solana, Anchor, IPFS, Tauri, Claude Code CLI
#

set -e

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                GentlyOS Stack Installer                          ║"
echo "╚══════════════════════════════════════════════════════════════════╝"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo "${GREEN}[INSTALL]${NC} $1"; }
warn() { echo "${YELLOW}[WARN]${NC} $1"; }
error() { echo "${RED}[ERROR]${NC} $1"; exit 1; }

# Check if running as root
[ "$(id -u)" -eq 0 ] || error "Must run as root"

# ============================================
# LAYER 1: Base System
# ============================================
log "Layer 1: Base system packages..."
apk update
apk add --no-cache \
    build-base \
    linux-headers \
    musl-dev \
    openssl-dev \
    pkgconfig \
    cmake \
    llvm \
    clang \
    lld \
    python3 \
    py3-pip \
    libudev-zero-dev

# ============================================
# LAYER 2: Rust
# ============================================
log "Layer 2: Installing Rust..."
if ! command -v rustc >/dev/null 2>&1; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    . "$HOME/.cargo/env"
fi
log "Rust version: $(rustc --version)"

# Add wasm target for Solana
rustup target add wasm32-unknown-unknown

# ============================================
# LAYER 3: Solana
# ============================================
log "Layer 3: Installing Solana CLI..."
if ! command -v solana >/dev/null 2>&1; then
    sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
    export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
fi
log "Solana version: $(solana --version)"

# Configure for devnet
solana config set --url devnet
log "Solana configured for devnet"

# ============================================
# LAYER 4: Anchor
# ============================================
log "Layer 4: Installing Anchor..."
if ! command -v anchor >/dev/null 2>&1; then
    cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
    avm install latest
    avm use latest
fi
log "Anchor version: $(anchor --version)"

# ============================================
# LAYER 5: Node.js (already in base, ensure npm global)
# ============================================
log "Layer 5: Configuring Node.js..."
npm config set prefix /usr/local
npm install -g yarn pnpm

# ============================================
# LAYER 6: IPFS
# ============================================
log "Layer 6: Installing IPFS..."
if ! command -v ipfs >/dev/null 2>&1; then
    IPFS_VERSION="v0.27.0"
    wget -q "https://dist.ipfs.io/kubo/${IPFS_VERSION}/kubo_${IPFS_VERSION}_linux-amd64.tar.gz" -O /tmp/ipfs.tar.gz
    tar -xzf /tmp/ipfs.tar.gz -C /tmp
    mv /tmp/kubo/ipfs /usr/local/bin/
    rm -rf /tmp/ipfs.tar.gz /tmp/kubo
    ipfs init
fi
log "IPFS version: $(ipfs version)"

# ============================================
# LAYER 7: Tauri Prerequisites
# ============================================
log "Layer 7: Installing Tauri prerequisites..."
apk add --no-cache \
    gtk+3.0-dev \
    webkit2gtk-dev \
    libappindicator-dev \
    librsvg-dev

cargo install tauri-cli
log "Tauri CLI installed"

# ============================================
# LAYER 8: Claude Code CLI
# ============================================
log "Layer 8: Installing Claude Code CLI..."
npm install -g @anthropic-ai/claude-code
log "Claude Code CLI installed"

# ============================================
# LAYER 9: BTC Block Fetcher (for randomness)
# ============================================
log "Layer 9: Setting up BTC randomness beacon..."
cat > /usr/local/bin/btc-random << 'EOF'
#!/bin/sh
# Fetch latest BTC block hash for randomness
curl -s "https://blockchain.info/latestblock" | grep -o '"hash":"[^"]*"' | cut -d'"' -f4
EOF
chmod +x /usr/local/bin/btc-random
log "BTC randomness beacon installed"

# ============================================
# VERIFY INSTALLATION
# ============================================
echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                 Installation Complete                            ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║ Rust:     $(rustc --version | cut -d' ' -f2)"
echo "║ Solana:   $(solana --version | cut -d' ' -f2)"
echo "║ Anchor:   $(anchor --version | cut -d' ' -f2)"
echo "║ Node:     $(node --version)"
echo "║ IPFS:     $(ipfs version | cut -d' ' -f3)"
echo "║ Tauri:    $(cargo tauri --version 2>/dev/null || echo 'installed')"
echo "║ Claude:   $(claude --version 2>/dev/null || echo 'installed')"
echo "╚══════════════════════════════════════════════════════════════════╝"

# Add to PATH permanently
cat >> /etc/profile.d/gentlyos.sh << 'EOF'
export PATH="$PATH:$HOME/.cargo/bin"
export PATH="$PATH:$HOME/.local/share/solana/install/active_release/bin"
export GENTLYOS_HOME=/root/.gentlyos
EOF

log "Stack installation complete!"
