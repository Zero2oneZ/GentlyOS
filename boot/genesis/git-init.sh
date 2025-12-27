#!/bin/sh
#
# GentlyOS Genesis: Git Initialization
# Every GentlyOS instance has local git that pushes to main remote
#
# Local changes → Local git → Push to main repo
#

set -e

GENESIS_DIR="/root/.gentlyos/genesis"
GENTLYOS_HOME="/root/.gentlyos"
MAIN_REMOTE="https://github.com/anthropics/gentlyos.git"  # Configure this

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo "${GREEN}[GENESIS:GIT]${NC} $1"; }
warn() { echo "${YELLOW}[GENESIS:GIT]${NC} $1"; }
error() { echo "${RED}[GENESIS:GIT]${NC} $1"; exit 1; }
phase() { echo "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo "${CYAN}  $1${NC}"; echo "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

echo "
╔══════════════════════════════════════════════════════════════════╗
║              GentlyOS Genesis: GIT INITIALIZATION                ║
║                                                                  ║
║  Every instance gets local git → syncs to main remote            ║
╚══════════════════════════════════════════════════════════════════╝
"

# ============================================
# PHASE G.1: CHECK GIT AVAILABLE
# ============================================
phase "Phase G.1: Checking git availability"

if ! command -v git >/dev/null 2>&1; then
    log "Installing git..."
    apk add --no-cache git
fi

GIT_VERSION=$(git --version)
log "Git version: $GIT_VERSION"

# ============================================
# PHASE G.2: LOAD INSTANCE IDENTITY
# ============================================
phase "Phase G.2: Loading instance identity"

# Load serial number from genesis
if [ -f "$GENESIS_DIR/btc-genesis.json" ]; then
    SERIAL=$(grep -o '"serial":"[^"]*"' "$GENESIS_DIR/btc-genesis.json" | cut -d'"' -f4)
else
    SERIAL="UNKNOWN-$(date +%s)"
fi

# Instance ID = first 8 chars of serial
INSTANCE_ID=$(echo "$SERIAL" | cut -c1-8)
log "Instance ID: $INSTANCE_ID"

# ============================================
# PHASE G.3: CONFIGURE GIT IDENTITY
# ============================================
phase "Phase G.3: Configuring git identity"

# Set git config for this instance
git config --global user.name "GentlyOS-$INSTANCE_ID"
git config --global user.email "gentlyos-$INSTANCE_ID@localhost"
git config --global init.defaultBranch main

log "Git identity: GentlyOS-$INSTANCE_ID"

# ============================================
# PHASE G.4: INITIALIZE LOCAL REPO
# ============================================
phase "Phase G.4: Initializing local repository"

cd "$GENTLYOS_HOME"

if [ ! -d ".git" ]; then
    log "Initializing new git repository..."
    git init

    # Create .gitignore
    cat > .gitignore << 'EOF'
# Node modules
node_modules/

# Build outputs
target/
dist/

# Logs
*.log
*.log.*

# Environment
.env
.env.*

# Secrets (NEVER commit)
*.pem
*.key
id_rsa*
*.secret

# Runtime
*.pid
*.sock

# Temporary
tmp/
temp/
*.tmp

# OS files
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/

# Solana keypairs (sensitive!)
*.json
!package.json
!tsconfig.json
!Anchor.toml
EOF

    log ".gitignore created"

    # Initial commit
    git add .
    git commit -m "GentlyOS Genesis: Instance $INSTANCE_ID

Serial: $SERIAL
Created: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

🤖 Generated with GentlyOS Genesis"

    log "Initial commit created"
else
    log "Git repository already exists"
fi

# ============================================
# PHASE G.5: CONFIGURE REMOTE
# ============================================
phase "Phase G.5: Configuring remote"

# Check if remote exists
if git remote | grep -q "^origin$"; then
    CURRENT_REMOTE=$(git remote get-url origin)
    log "Remote origin exists: $CURRENT_REMOTE"
else
    # Read remote URL from config or use default
    if [ -f "$GENESIS_DIR/git-remote.txt" ]; then
        REMOTE_URL=$(cat "$GENESIS_DIR/git-remote.txt")
    else
        REMOTE_URL="$MAIN_REMOTE"
        echo "$REMOTE_URL" > "$GENESIS_DIR/git-remote.txt"
    fi

    log "Adding remote: $REMOTE_URL"
    git remote add origin "$REMOTE_URL" || warn "Could not add remote"
fi

# Create instance-specific branch
INSTANCE_BRANCH="instance/$INSTANCE_ID"
log "Creating instance branch: $INSTANCE_BRANCH"
git checkout -B "$INSTANCE_BRANCH" 2>/dev/null || git checkout "$INSTANCE_BRANCH" 2>/dev/null || true

# ============================================
# PHASE G.6: CREATE GIT SYNC SCRIPT
# ============================================
phase "Phase G.6: Creating git sync utilities"

# Create sync script
cat > "$GENTLYOS_HOME/git-sync.sh" << 'SYNC_SCRIPT'
#!/bin/sh
#
# GentlyOS Git Sync
# Commits local changes and pushes to remote
#

GENTLYOS_HOME="/root/.gentlyos"
GENESIS_DIR="/root/.gentlyos/genesis"

cd "$GENTLYOS_HOME"

# Load instance ID
if [ -f "$GENESIS_DIR/btc-genesis.json" ]; then
    SERIAL=$(grep -o '"serial":"[^"]*"' "$GENESIS_DIR/btc-genesis.json" | cut -d'"' -f4)
    INSTANCE_ID=$(echo "$SERIAL" | cut -c1-8)
else
    INSTANCE_ID="unknown"
fi

# Fetch latest BTC block for commit message
BTC_HEIGHT="unknown"
BTC_DATA=$(curl -s "https://blockchain.info/latestblock" 2>/dev/null)
if [ -n "$BTC_DATA" ]; then
    BTC_HEIGHT=$(echo "$BTC_DATA" | grep -o '"height":[0-9]*' | cut -d':' -f2)
fi

# Check for changes
if git diff --quiet && git diff --cached --quiet; then
    echo "[GIT-SYNC] No changes to commit"
    exit 0
fi

# Add all changes
git add -A

# Commit with BTC timestamp
COMMIT_MSG="Sync @ BTC block $BTC_HEIGHT

Instance: $INSTANCE_ID
Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

🤖 Auto-sync by GentlyOS"

git commit -m "$COMMIT_MSG"

# Push to remote
echo "[GIT-SYNC] Pushing to remote..."
git push -u origin "instance/$INSTANCE_ID" 2>/dev/null || {
    echo "[GIT-SYNC] Push failed (no network or auth required)"
    echo "[GIT-SYNC] Changes committed locally"
}

echo "[GIT-SYNC] Complete"
SYNC_SCRIPT

chmod +x "$GENTLYOS_HOME/git-sync.sh"
log "Created git-sync.sh"

# Create audit commit script (for BTC-audited commits)
cat > "$GENTLYOS_HOME/git-audit-commit.sh" << 'AUDIT_SCRIPT'
#!/bin/sh
#
# GentlyOS Audited Git Commit
# Creates commit with BTC block verification
#

MESSAGE="$1"
if [ -z "$MESSAGE" ]; then
    echo "Usage: git-audit-commit.sh <message>"
    exit 1
fi

GENTLYOS_HOME="/root/.gentlyos"
cd "$GENTLYOS_HOME"

# Get BTC block
BTC_DATA=$(curl -s "https://blockchain.info/latestblock" 2>/dev/null)
BTC_HASH=$(echo "$BTC_DATA" | grep -o '"hash":"[^"]*"' | cut -d'"' -f4)
BTC_HEIGHT=$(echo "$BTC_DATA" | grep -o '"height":[0-9]*' | cut -d':' -f2)

# Get instance serial
SERIAL=$(grep -o '"serial":"[^"]*"' "$GENTLYOS_HOME/genesis/btc-genesis.json" 2>/dev/null | cut -d'"' -f4)

# Add changes
git add -A

# Create audited commit
git commit -m "$MESSAGE

---
BTC Block: $BTC_HEIGHT
BTC Hash: ${BTC_HASH:0:16}...
Instance: ${SERIAL:0:16}
Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

🔒 BTC-Audited Commit
🤖 GentlyOS"

echo "[AUDIT-COMMIT] Created at BTC block $BTC_HEIGHT"
AUDIT_SCRIPT

chmod +x "$GENTLYOS_HOME/git-audit-commit.sh"
log "Created git-audit-commit.sh"

# ============================================
# PHASE G.7: SETUP AUTO-SYNC (CRON)
# ============================================
phase "Phase G.7: Setting up auto-sync"

# Create cron job for hourly sync
CRON_FILE="/etc/periodic/hourly/gentlyos-git-sync"
cat > "$CRON_FILE" << 'CRON_SCRIPT'
#!/bin/sh
# GentlyOS hourly git sync
/root/.gentlyos/git-sync.sh >> /var/log/gentlyos/git-sync.log 2>&1
CRON_SCRIPT

chmod +x "$CRON_FILE"
log "Hourly git sync configured"

# ============================================
# PHASE G.8: WRITE MANIFEST
# ============================================
phase "Phase G.8: Writing git manifest"

cat > "$GENESIS_DIR/git-manifest.json" << EOF
{
  "initialized_at": $(date +%s),
  "instance_id": "$INSTANCE_ID",
  "serial": "$SERIAL",
  "git_version": "$GIT_VERSION",
  "branch": "$INSTANCE_BRANCH",
  "remote": "$(git remote get-url origin 2>/dev/null || echo 'none')",
  "auto_sync": "hourly"
}
EOF

log "Git manifest written"

echo "
╔══════════════════════════════════════════════════════════════════╗
║              GIT INITIALIZATION: COMPLETE                        ║
╠══════════════════════════════════════════════════════════════════╣
║  Instance:    $INSTANCE_ID
║  Branch:      $INSTANCE_BRANCH
║  Auto-sync:   Hourly
║  Commands:
║    git-sync.sh         - Manual sync to remote
║    git-audit-commit.sh - BTC-audited commit
╚══════════════════════════════════════════════════════════════════╝
"

log "Git initialization complete"
exit 0
