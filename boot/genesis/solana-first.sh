#!/bin/sh
#
# GentlyOS Genesis: Phase 1 - Solana Stack Installer
# MUST run FIRST before anything else
#
# Installs: Rust, Solana CLI, Anchor
# Generates keypair, airdrops devnet SOL
#

set -e

GENESIS_DIR="/root/.gentlyos/genesis"
KEYPAIR_PATH="/root/.config/solana/id.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo "${GREEN}[GENESIS:SOLANA]${NC} $1"; }
warn() { echo "${YELLOW}[GENESIS:SOLANA]${NC} $1"; }
error() { echo "${RED}[GENESIS:SOLANA]${NC} $1"; exit 1; }
phase() { echo "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo "${CYAN}  $1${NC}"; echo "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

# Ensure running as root
[ "$(id -u)" -eq 0 ] || error "Must run as root"

# Create genesis directory
mkdir -p "$GENESIS_DIR"

echo "
╔══════════════════════════════════════════════════════════════════╗
║              GentlyOS Genesis: SOLANA FIRST                      ║
║                                                                  ║
║  This MUST complete before any other boot operations             ║
╚══════════════════════════════════════════════════════════════════╝
"

# ============================================
# PHASE 1.1: BASE BUILD DEPENDENCIES
# ============================================
phase "Phase 1.1: Installing build dependencies"

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
    libudev-zero-dev \
    curl \
    wget \
    git

log "Build dependencies installed"

# ============================================
# PHASE 1.2: RUST
# ============================================
phase "Phase 1.2: Installing Rust"

if ! command -v rustc >/dev/null 2>&1; then
    log "Installing Rust via rustup..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
    . "$HOME/.cargo/env"
else
    log "Rust already installed"
fi

# Ensure cargo is in PATH
export PATH="$HOME/.cargo/bin:$PATH"

# Add wasm target for Solana programs
log "Adding wasm32 target..."
rustup target add wasm32-unknown-unknown

RUST_VERSION=$(rustc --version)
log "Rust version: $RUST_VERSION"
echo "$RUST_VERSION" > "$GENESIS_DIR/rust-version.txt"

# ============================================
# PHASE 1.3: SOLANA CLI
# ============================================
phase "Phase 1.3: Installing Solana CLI"

if ! command -v solana >/dev/null 2>&1; then
    log "Installing Solana CLI..."
    sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
    export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
else
    log "Solana CLI already installed"
fi

SOLANA_VERSION=$(solana --version)
log "Solana version: $SOLANA_VERSION"
echo "$SOLANA_VERSION" > "$GENESIS_DIR/solana-version.txt"

# Configure for devnet
log "Configuring Solana for devnet..."
solana config set --url devnet

# ============================================
# PHASE 1.4: GENERATE KEYPAIR
# ============================================
phase "Phase 1.4: Generating/Loading Keypair"

if [ ! -f "$KEYPAIR_PATH" ]; then
    log "Generating new Solana keypair..."
    solana-keygen new --no-passphrase --outfile "$KEYPAIR_PATH"
    log "New keypair generated"
else
    log "Using existing keypair"
fi

PUBKEY=$(solana address)
log "Public key: $PUBKEY"
echo "$PUBKEY" > "$GENESIS_DIR/pubkey.txt"

# ============================================
# PHASE 1.5: AIRDROP SOL
# ============================================
phase "Phase 1.5: Airdropping devnet SOL"

log "Requesting airdrop (2 SOL)..."
solana airdrop 2 || warn "Airdrop may have rate limited, continuing..."

BALANCE=$(solana balance)
log "Current balance: $BALANCE"
echo "$BALANCE" > "$GENESIS_DIR/balance.txt"

# ============================================
# PHASE 1.6: ANCHOR
# ============================================
phase "Phase 1.6: Installing Anchor"

if ! command -v anchor >/dev/null 2>&1; then
    log "Installing Anchor Version Manager (avm)..."
    cargo install --git https://github.com/coral-xyz/anchor avm --locked --force

    log "Installing latest Anchor..."
    avm install latest
    avm use latest
else
    log "Anchor already installed"
fi

ANCHOR_VERSION=$(anchor --version)
log "Anchor version: $ANCHOR_VERSION"
echo "$ANCHOR_VERSION" > "$GENESIS_DIR/anchor-version.txt"

# ============================================
# PHASE 1.7: WRITE GENESIS MANIFEST
# ============================================
phase "Phase 1.7: Writing Genesis Manifest"

GENESIS_TIMESTAMP=$(date +%s)

cat > "$GENESIS_DIR/solana-manifest.json" << EOF
{
  "phase": "solana-first",
  "completed_at": $GENESIS_TIMESTAMP,
  "rust_version": "$(rustc --version | cut -d' ' -f2)",
  "solana_version": "$(solana --version | cut -d' ' -f2)",
  "anchor_version": "$(anchor --version | cut -d' ' -f2)",
  "pubkey": "$PUBKEY",
  "network": "devnet",
  "status": "ready"
}
EOF

log "Manifest written to $GENESIS_DIR/solana-manifest.json"

# ============================================
# PHASE 1.8: SET ENVIRONMENT PERMANENTLY
# ============================================
phase "Phase 1.8: Setting Environment"

cat > /etc/profile.d/gentlyos-solana.sh << 'EOF'
# GentlyOS Solana Environment
export PATH="$HOME/.cargo/bin:$PATH"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
export GENTLYOS_GENESIS=/root/.gentlyos/genesis
EOF

log "Environment configured in /etc/profile.d/gentlyos-solana.sh"

echo "
╔══════════════════════════════════════════════════════════════════╗
║              SOLANA FIRST: COMPLETE                              ║
╠══════════════════════════════════════════════════════════════════╣
║  Rust:    $(rustc --version | cut -d' ' -f2)
║  Solana:  $(solana --version | cut -d' ' -f2)
║  Anchor:  $(anchor --version | cut -d' ' -f2)
║  Pubkey:  $PUBKEY
║  Balance: $BALANCE
╚══════════════════════════════════════════════════════════════════╝
"

log "Ready for Phase 2: BTC Genesis Timestamp"
exit 0
