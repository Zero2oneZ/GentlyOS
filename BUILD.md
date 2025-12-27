# GentlyOS Build System

## Architecture

```
gentlyos/
├── core/                    # Core language & protocols
│   ├── codie/              # CODIE language engine
│   ├── xor/                # XOR temporal chain
│   └── primitives/         # UI primitive catalog
│
├── storage/                 # Data layer
│   ├── git/                # Git blob database
│   └── vectors/            # Semantic memory
│
├── intelligence/            # AI layers
│   ├── scatterbrain/       # Orchestrator (the brain)
│   ├── tiny-model/         # Self-hosted JSONL (90%)
│   ├── claude/             # Claude integration (10%)
│   ├── watcher/            # AI surveillance
│   └── neural-graph/       # Learning system
│
├── infra/                   # Infrastructure
│   ├── edge/               # Cloudflare workers
│   ├── solana/             # Audit trail
│   └── domains/            # Domain routing
│
├── security/                # Security layer
│   ├── forensics/          # Evidence collection
│   └── defense/            # Threat response
│
├── boot/                    # Bootable system
│   ├── iso/                # ISO builder
│   └── overlay/            # Alpine overlay
│
├── config/                  # Configuration
└── docs/                    # Documentation
```

## Build Order

```
PHASE 1: CORE (no dependencies)
═══════════════════════════════════════════════════════════
1.1  core/primitives/catalog.js    ← UI primitives
1.2  core/codie/parser.js          ← CODIE parser
1.3  core/codie/encoder.js         ← CODIE encoder
1.4  core/xor/chain.js             ← XOR chain generator
1.5  core/xor/pubkey.js            ← XOR → pubkey derivation

PHASE 2: STORAGE (needs Phase 1)
═══════════════════════════════════════════════════════════
2.1  storage/git/blobs.js          ← Git blob CRUD
2.2  storage/git/templates.js      ← Template storage
2.3  storage/vectors/embed.js      ← Embeddings
2.4  storage/vectors/search.js     ← Similarity search

PHASE 3: INTELLIGENCE (needs Phase 1,2)
═══════════════════════════════════════════════════════════
3.1  intelligence/scatterbrain/    ← Main orchestrator
3.2  intelligence/tiny-model/      ← JSONL model
3.3  intelligence/claude/          ← Claude bridge
3.4  intelligence/watcher/         ← AI surveillance
3.5  intelligence/neural-graph/    ← Learning graph

PHASE 4: INFRASTRUCTURE (needs Phase 1,2,3)
═══════════════════════════════════════════════════════════
4.1  infra/edge/worker.js          ← Edge function
4.2  infra/edge/hydrate.js         ← CODIE → HTML
4.3  infra/solana/anchor.js        ← Hash anchoring
4.4  infra/solana/audit.js         ← Audit queries
4.5  infra/domains/router.js       ← Domain mapping

PHASE 5: SECURITY (parallel with Phase 4)
═══════════════════════════════════════════════════════════
5.1  security/forensics/           ← Evidence collection
5.2  security/defense/             ← Threat response

PHASE 6: BOOT (needs all above)
═══════════════════════════════════════════════════════════
6.1  boot/overlay/                 ← Alpine apkovl
6.2  boot/iso/                     ← Final ISO build
```

## Key Files

| File | Size | Purpose |
|------|------|---------|
| primitives/catalog.js | ~5KB | All UI primitives |
| codie/parser.js | ~3KB | Parse CODIE → AST |
| codie/encoder.js | ~2KB | Object → CODIE |
| xor/chain.js | ~2KB | XOR chain logic |
| scatterbrain/core.js | ~10KB | Main brain |
| watcher/daemon.js | ~5KB | AI surveillance |

## Build Command

```sh
./build.sh                    # Full build
./build.sh --phase 1          # Single phase
./build.sh --component codie  # Single component
./build.sh --iso              # Build ISO only
```
