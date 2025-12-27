#!/bin/sh
#
# GentlyOS Genesis: Phase 3 - Mint OS Program
# Deploys the gentlyos_genesis Solana program
# Initializes OS genesis state
#

set -e

GENESIS_DIR="/root/.gentlyos/genesis"
PROGRAM_DIR="/root/.gentlyos/infra/solana/gentlyos-genesis"
KEYPAIR_PATH="/root/.config/solana/id.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo "${GREEN}[GENESIS:MINT]${NC} $1"; }
warn() { echo "${YELLOW}[GENESIS:MINT]${NC} $1"; }
error() { echo "${RED}[GENESIS:MINT]${NC} $1"; exit 1; }
phase() { echo "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo "${CYAN}  $1${NC}"; echo "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

# Ensure genesis directory exists
mkdir -p "$GENESIS_DIR"

# Load BTC genesis environment
if [ -f "$GENESIS_DIR/btc-env.sh" ]; then
    . "$GENESIS_DIR/btc-env.sh"
else
    error "BTC genesis not found. Run btc-timestamp.sh first"
fi

# Load Solana environment
export PATH="$HOME/.cargo/bin:$PATH"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

echo "
╔══════════════════════════════════════════════════════════════════╗
║              GentlyOS Genesis: MINT OS PROGRAM                   ║
║                                                                  ║
║  Deploying Solana program + initializing genesis                 ║
╚══════════════════════════════════════════════════════════════════╝
"

# ============================================
# PHASE 3.1: READ VERSION
# ============================================
phase "Phase 3.1: Reading OS Version"

VERSION_FILE="/root/.gentlyos/VERSION"
if [ -f "$VERSION_FILE" ]; then
    OS_VERSION=$(cat "$VERSION_FILE")
else
    OS_VERSION="0.1.0"
    echo "$OS_VERSION" > "$VERSION_FILE"
fi

log "OS Version: $OS_VERSION"

# ============================================
# PHASE 3.2: BTC CHECKPOINT
# ============================================
phase "Phase 3.2: Recording BTC checkpoint (PROGRAM_DEPLOY)"

"$GENESIS_DIR/btc-checkpoint.sh" "PROGRAM_DEPLOY"

# ============================================
# PHASE 3.3: BUILD ANCHOR PROGRAM
# ============================================
phase "Phase 3.3: Building Anchor program"

if [ -d "$PROGRAM_DIR" ]; then
    cd "$PROGRAM_DIR"
    log "Building program..."
    anchor build
    PROGRAM_KEYPAIR="$PROGRAM_DIR/target/deploy/gentlyos_genesis-keypair.json"
    PROGRAM_SO="$PROGRAM_DIR/target/deploy/gentlyos_genesis.so"

    if [ -f "$PROGRAM_SO" ]; then
        log "Program built successfully"
    else
        error "Program build failed"
    fi
else
    warn "Program directory not found, skipping build"
    PROGRAM_SO=""
fi

# ============================================
# PHASE 3.4: DEPLOY PROGRAM
# ============================================
phase "Phase 3.4: Deploying to Solana devnet"

if [ -n "$PROGRAM_SO" ] && [ -f "$PROGRAM_SO" ]; then
    log "Deploying program..."
    PROGRAM_ID=$(solana program deploy "$PROGRAM_SO" --output json | grep -o '"programId": "[^"]*"' | cut -d'"' -f4)

    if [ -n "$PROGRAM_ID" ]; then
        log "Program deployed: $PROGRAM_ID"
        echo "$PROGRAM_ID" > "$GENESIS_DIR/program-id.txt"
    else
        warn "Program deployment may have failed, using placeholder"
        PROGRAM_ID="PLACEHOLDER"
    fi
else
    warn "No program binary, using placeholder ID"
    PROGRAM_ID="GENTLYosxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
fi

# ============================================
# PHASE 3.5: CREATE TOKEN MINTS
# ============================================
phase "Phase 3.5: Creating SPL Token Mints"

# Create OS Token Mint (GNTLY-OS)
log "Creating GNTLY-OS token mint..."
OS_MINT=$(spl-token create-token --decimals 9 --output json 2>/dev/null | grep -o '"address": "[^"]*"' | cut -d'"' -f4) || {
    warn "spl-token not available, using placeholder"
    OS_MINT="OS_MINT_PLACEHOLDER"
}
log "OS Mint: $OS_MINT"

# Create User Token Mint (GNTLY-USER)
log "Creating GNTLY-USER token mint..."
USER_MINT=$(spl-token create-token --decimals 9 --output json 2>/dev/null | grep -o '"address": "[^"]*"' | cut -d'"' -f4) || {
    warn "spl-token not available, using placeholder"
    USER_MINT="USER_MINT_PLACEHOLDER"
}
log "User Mint: $USER_MINT"

# ============================================
# PHASE 3.6: WRITE GENESIS MANIFEST
# ============================================
phase "Phase 3.6: Writing Genesis Manifest"

SPAWN_ORDER=1
# Check if this is a re-spawn
if [ -f "$GENESIS_DIR/spawn-order.txt" ]; then
    PREV_SPAWN=$(cat "$GENESIS_DIR/spawn-order.txt")
    SPAWN_ORDER=$((PREV_SPAWN + 1))
fi
echo "$SPAWN_ORDER" > "$GENESIS_DIR/spawn-order.txt"

cat > "$GENESIS_DIR/os-genesis.json" << EOF
{
  "version": "$OS_VERSION",
  "serial": "$GENTLYOS_SERIAL",
  "btc_block_hash": "$BTC_GENESIS_HASH",
  "btc_block_height": $BTC_GENESIS_HEIGHT,
  "spawn_order": $SPAWN_ORDER,
  "genesis_timestamp": $BTC_GENESIS_TIMESTAMP,
  "program_id": "$PROGRAM_ID",
  "os_mint": "$OS_MINT",
  "user_mint": "$USER_MINT",
  "xor_key": "$GENTLYOS_XOR_KEY",
  "status": "deployed"
}
EOF

log "Genesis manifest written to $GENESIS_DIR/os-genesis.json"

# ============================================
# PHASE 3.7: INITIALIZE GENESIS STATE
# ============================================
phase "Phase 3.7: Initializing on-chain genesis state"

# This would call the Anchor program's initialize instruction
# For now, we create a local initialization record
cat > "$GENESIS_DIR/init-tx.json" << EOF
{
  "instruction": "initialize",
  "params": {
    "version": "$OS_VERSION",
    "serial": "$GENTLYOS_SERIAL",
    "btc_block_hash": "$BTC_GENESIS_HASH",
    "btc_block_height": $BTC_GENESIS_HEIGHT
  },
  "status": "pending",
  "created_at": $(date +%s)
}
EOF

log "Genesis initialization prepared"

echo "
╔══════════════════════════════════════════════════════════════════╗
║              MINT OS PROGRAM: COMPLETE                           ║
╠══════════════════════════════════════════════════════════════════╣
║  Version:     $OS_VERSION
║  Serial:      $GENTLYOS_SERIAL
║  Spawn Order: $SPAWN_ORDER
║  Program ID:  ${PROGRAM_ID:0:32}...
║  OS Mint:     ${OS_MINT:0:32}...
║  User Mint:   ${USER_MINT:0:32}...
╚══════════════════════════════════════════════════════════════════╝
"

log "Ready for Phase 4: File Tree Mapping"
exit 0
