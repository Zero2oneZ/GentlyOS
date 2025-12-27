# GentlyOS Flash Guide

## Quick Start

### Option 1: Build ISO on Linux

```bash
# Transfer GentlyOS folder to Linux machine, then:
cd GentlyOS
./build.sh

# Flash to USB
./build.sh flash /dev/sdX
```

### Option 2: Direct Tarball Install

```bash
# On target machine (Alpine Linux):
tar -xzf gentlyos-runtime.tar.gz
cd gentlyos
./install.sh
```

### Option 3: Network Boot

```bash
# Start PXE server
cd netboot
./start-server.sh
```

## Boot Sequence

When GentlyOS boots, it runs these phases IN ORDER:

```
PHASE 0: Network + Base
PHASE 1: Rust + Solana + Anchor (CRITICAL - FIRST)
PHASE 2: BTC Genesis Timestamp
PHASE 3: Mint GentlyOS Program
PHASE 4: File Tree → Wallet Mapping
PHASE 4.5: Git Initialization
PHASE 5: Complete + Verify
```

## What Happens at First Boot

1. **Solana Stack Installed**
   - Rust, Solana CLI, Anchor
   - Keypair generated
   - Devnet SOL airdropped

2. **BTC Birth Certificate**
   - Current BTC block fetched
   - Serial number generated
   - XOR key calculated

3. **OS Program Minted**
   - Solana program deployed
   - GNTLY-OS and GNTLY-USER tokens created
   - Version + serial recorded on-chain

4. **File Tree Mapped**
   - Every file/folder gets a wallet
   - Tokens distributed by hierarchy
   - IPFS chain created

5. **Git Initialized**
   - Local repo created
   - Instance branch: `instance/<SERIAL>`
   - Hourly auto-sync enabled

## Flash to USB (Linux)

```bash
# Find your USB device
lsblk

# Flash (DESTRUCTIVE - erases USB)
sudo dd if=dist/gentlyos-*.img of=/dev/sdX bs=4M status=progress
sync

# Eject safely
sudo eject /dev/sdX
```

## Flash to USB (macOS)

```bash
# Find disk
diskutil list

# Unmount
diskutil unmountDisk /dev/diskN

# Flash
sudo dd if=dist/gentlyos-*.img of=/dev/rdiskN bs=4m
```

## First Boot Checklist

- [ ] USB boots successfully
- [ ] Network connects
- [ ] Rust/Solana installs
- [ ] BTC block fetched
- [ ] Program deploys
- [ ] Wallets created
- [ ] Git initialized

## Troubleshooting

### No Network
```bash
# Check interfaces
ip link show

# Bring up interface
ip link set eth0 up
dhclient eth0
```

### Solana Airdrop Fails
```bash
# Devnet may be rate-limited, retry:
solana airdrop 1
```

### Build Fails
```bash
# Install dependencies
apk add tar gzip cpio xorriso wget curl
```

## Files Created at Genesis

```
/root/.gentlyos/genesis/
├── btc-genesis.json      # BTC birth certificate
├── btc-env.sh            # BTC environment vars
├── solana-manifest.json  # Solana stack info
├── os-genesis.json       # OS program info
├── os-wallets.json       # All OS wallets
├── os-chain.json         # IPFS chain links
├── users.json            # User wallets
├── git-manifest.json     # Git info
└── checkpoints.jsonl     # BTC audit trail
```

## Security Notes

- ROOT cannot be pushed from root (50% minimum)
- All events audited with BTC block + timestamp
- OS wallets are frozen (immutable)
- User wallets are tradeable (fixed supply per group)
