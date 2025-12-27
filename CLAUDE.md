# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GentlyOS is a self-evolving operating system with:
- **CODIE language**: 100-1000x compression (e.g., `W{d:sports,s:mlb,t:purple}` → full website)
- **XOR temporal chains**: State linking via `xor = sha256(state)[:8] ^ timestamp ^ previous_xor`
- **90/10 split**: 90% tiny JSONL model, 10% Claude for complex reasoning
- **Zero trust security**: If we didn't build it, it's a threat
- **Chain of Thought tracking**: Every reasoning step hashed to IPFS/Solana

## Architecture

```
USER → TINY MODEL (90%) → FUSION LAYER → CLAUDE (10%) → INFRASTRUCTURE
         ↓                    ↓              ↓              ↓
    Fast inference      Neural Graph    Reasoning     Git/Solana/Edge
```

## Key Directories

- `core/` - CODIE parser, primitives, XOR chains
- `intelligence/` - Neural graph, tiny model, Claude bridge, watcher
- `storage/` - Git blob storage
- `infra/` - Edge workers, Solana audit
- `security/` - Forensics, defense
- `boot/` - Alpine overlay, ISO builder

## Build Commands

```bash
# Automated build (creates flashable ISO/IMG)
./build.sh

# Flash to USB
./build.sh flash /dev/sdX

# Using Make
make all          # Build everything
make iso          # Create bootable ISO
make flash DEVICE=/dev/sdX

# Run locally
node index.js

# Remote install (one-liner)
curl -fsSL https://gentlyos.dev/install | bash
```

## Desktop Apps

```bash
# Electron (JavaScript)
cd apps/electron && npm install && npm start

# Tauri (Rust - smaller, faster)
cd apps/tauri && npm install && npm run dev
```

## CODIE Syntax

Primitives: `APP`, `GRD`, `BTN`, `CRD`, `IMG`, `TXT`, `INP`, `NAV`, `LST`, `MOD`

Format: `PRIMITIVE{key:value,key:value}`

Example: `APP{GRD{CRD{TXT{t:"Hello"}},BTN{t:"Click",a:submit}}}`

## License Model

- **Personal use**: FREE
- **Enterprise use**: Requires paid license (GENTLY-XXXX-XXXX-XXXX)
- Contact: licensing@gentlyos.dev

## Key Concepts

1. **XOR Chain**: Every state change generates 3-char hex XOR key linking to previous state
2. **Neural Graph**: Every interaction = node, transitions = edges with weights
3. **Patterns**: System detects patterns → generates JSONL → retrains tiny model
4. **Nervous System**: All reasoning hashed, pushed to IPFS, each step has value (total=100)
