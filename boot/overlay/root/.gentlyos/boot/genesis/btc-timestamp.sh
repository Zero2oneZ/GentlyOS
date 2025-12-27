#!/bin/sh
#
# GentlyOS Genesis: Phase 2 - BTC Genesis Timestamp
# Fetches current BTC block as "birth certificate"
#
# This timestamp is immutable and serves as:
# - Genesis randomness source
# - Proof of existence timestamp
# - Serial number component
#

set -e

GENESIS_DIR="/root/.gentlyos/genesis"
BTC_API="https://blockchain.info"
MEMPOOL_API="https://mempool.space/api"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo "${GREEN}[GENESIS:BTC]${NC} $1"; }
warn() { echo "${YELLOW}[GENESIS:BTC]${NC} $1"; }
error() { echo "${RED}[GENESIS:BTC]${NC} $1"; exit 1; }
phase() { echo "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo "${CYAN}  $1${NC}"; echo "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

# Ensure genesis directory exists
mkdir -p "$GENESIS_DIR"

echo "
╔══════════════════════════════════════════════════════════════════╗
║              GentlyOS Genesis: BTC TIMESTAMP                     ║
║                                                                  ║
║  Fetching BTC block as birth certificate                         ║
╚══════════════════════════════════════════════════════════════════╝
"

# ============================================
# PHASE 2.1: FETCH LATEST BTC BLOCK
# ============================================
phase "Phase 2.1: Fetching latest BTC block"

log "Querying blockchain.info for latest block..."

# Try blockchain.info first
LATEST_BLOCK=$(curl -s "${BTC_API}/latestblock" 2>/dev/null) || {
    warn "blockchain.info failed, trying mempool.space..."
    BLOCK_HEIGHT=$(curl -s "${MEMPOOL_API}/blocks/tip/height" 2>/dev/null) || error "Failed to fetch BTC block"
    BLOCK_HASH=$(curl -s "${MEMPOOL_API}/blocks/tip/hash" 2>/dev/null) || error "Failed to fetch BTC hash"
    LATEST_BLOCK="{\"hash\":\"${BLOCK_HASH}\",\"height\":${BLOCK_HEIGHT}}"
}

# Parse block data
if command -v jq >/dev/null 2>&1; then
    BTC_HASH=$(echo "$LATEST_BLOCK" | jq -r '.hash')
    BTC_HEIGHT=$(echo "$LATEST_BLOCK" | jq -r '.height')
else
    # Fallback parsing without jq
    BTC_HASH=$(echo "$LATEST_BLOCK" | grep -o '"hash":"[^"]*"' | cut -d'"' -f4)
    BTC_HEIGHT=$(echo "$LATEST_BLOCK" | grep -o '"height":[0-9]*' | cut -d':' -f2)
fi

log "Block hash:   $BTC_HASH"
log "Block height: $BTC_HEIGHT"

# ============================================
# PHASE 2.2: GENERATE SERIAL NUMBER
# ============================================
phase "Phase 2.2: Generating OS Serial Number"

GENESIS_TIMESTAMP=$(date +%s)
GENESIS_TIMESTAMP_HUMAN=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Serial = first 16 chars of BTC hash + timestamp
SERIAL_PREFIX=$(echo "$BTC_HASH" | cut -c1-16)
SERIAL="${SERIAL_PREFIX}-${GENESIS_TIMESTAMP}"

log "Serial number: $SERIAL"

# ============================================
# PHASE 2.3: CALCULATE XOR KEY
# ============================================
phase "Phase 2.3: Calculating XOR Genesis Key"

# XOR key from BTC hash (first 8 chars as hex)
XOR_INPUT="${BTC_HASH}${GENESIS_TIMESTAMP}"
if command -v sha256sum >/dev/null 2>&1; then
    XOR_HASH=$(echo -n "$XOR_INPUT" | sha256sum | cut -c1-8)
else
    XOR_HASH=$(echo -n "$XOR_INPUT" | openssl dgst -sha256 | cut -c1-8)
fi

log "Genesis XOR key: $XOR_HASH"

# ============================================
# PHASE 2.4: WRITE BTC GENESIS RECORD
# ============================================
phase "Phase 2.4: Writing BTC Genesis Record"

cat > "$GENESIS_DIR/btc-genesis.json" << EOF
{
  "checkpoint": "GENESIS",
  "btc_block_hash": "$BTC_HASH",
  "btc_block_height": $BTC_HEIGHT,
  "unix_timestamp": $GENESIS_TIMESTAMP,
  "timestamp_human": "$GENESIS_TIMESTAMP_HUMAN",
  "serial": "$SERIAL",
  "xor_key": "$XOR_HASH",
  "source": "blockchain.info/mempool.space"
}
EOF

log "BTC genesis record saved to $GENESIS_DIR/btc-genesis.json"

# ============================================
# PHASE 2.5: CREATE CHECKPOINT SCRIPT
# ============================================
phase "Phase 2.5: Creating checkpoint utility"

cat > "$GENESIS_DIR/btc-checkpoint.sh" << 'CHECKPOINT_SCRIPT'
#!/bin/sh
#
# BTC Checkpoint Utility
# Usage: btc-checkpoint.sh <checkpoint_name>
#
# Called at key boot phases to record BTC timestamp
#

CHECKPOINT_NAME="$1"
GENESIS_DIR="/root/.gentlyos/genesis"
CHECKPOINT_FILE="$GENESIS_DIR/checkpoints.jsonl"

if [ -z "$CHECKPOINT_NAME" ]; then
    echo "Usage: btc-checkpoint.sh <checkpoint_name>"
    exit 1
fi

# Fetch current BTC block
BLOCK_DATA=$(curl -s "https://blockchain.info/latestblock" 2>/dev/null)
BTC_HASH=$(echo "$BLOCK_DATA" | grep -o '"hash":"[^"]*"' | cut -d'"' -f4)
BTC_HEIGHT=$(echo "$BLOCK_DATA" | grep -o '"height":[0-9]*' | cut -d':' -f2)
TIMESTAMP=$(date +%s)

# Append checkpoint to JSONL
echo "{\"checkpoint\":\"$CHECKPOINT_NAME\",\"btc_hash\":\"$BTC_HASH\",\"btc_height\":$BTC_HEIGHT,\"timestamp\":$TIMESTAMP}" >> "$CHECKPOINT_FILE"

echo "[BTC-CHECKPOINT] $CHECKPOINT_NAME @ block $BTC_HEIGHT"
CHECKPOINT_SCRIPT

chmod +x "$GENESIS_DIR/btc-checkpoint.sh"
log "Checkpoint utility created at $GENESIS_DIR/btc-checkpoint.sh"

# ============================================
# PHASE 2.6: EXPORT FOR NEXT PHASES
# ============================================
phase "Phase 2.6: Exporting environment"

# Export for use by subsequent scripts
cat > "$GENESIS_DIR/btc-env.sh" << EOF
# GentlyOS BTC Genesis Environment
export BTC_GENESIS_HASH="$BTC_HASH"
export BTC_GENESIS_HEIGHT="$BTC_HEIGHT"
export BTC_GENESIS_TIMESTAMP="$GENESIS_TIMESTAMP"
export GENTLYOS_SERIAL="$SERIAL"
export GENTLYOS_XOR_KEY="$XOR_HASH"
EOF

log "Environment exported to $GENESIS_DIR/btc-env.sh"

# Record first checkpoint
echo "{\"checkpoint\":\"GENESIS\",\"btc_hash\":\"$BTC_HASH\",\"btc_height\":$BTC_HEIGHT,\"timestamp\":$GENESIS_TIMESTAMP}" > "$GENESIS_DIR/checkpoints.jsonl"

echo "
╔══════════════════════════════════════════════════════════════════╗
║              BTC GENESIS TIMESTAMP: COMPLETE                     ║
╠══════════════════════════════════════════════════════════════════╣
║  Block Hash:   ${BTC_HASH:0:32}...
║  Block Height: $BTC_HEIGHT
║  Serial:       $SERIAL
║  XOR Key:      $XOR_HASH
║  Timestamp:    $GENESIS_TIMESTAMP_HUMAN
╚══════════════════════════════════════════════════════════════════╝
"

log "Ready for Phase 3: Mint GentlyOS Program"
exit 0
