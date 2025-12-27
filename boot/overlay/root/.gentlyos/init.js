/**
 * GentlyOS Boot Initialization
 * First thing that runs after system boot
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const GENTLYOS_HOME = process.env.GENTLYOS_HOME || '/root/.gentlyos';

console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                      GentlyOS v0.1.0                             ║
║          Self-Evolving Operating System                          ║
║                                                                  ║
║   90% Tiny Model | 10% Claude | 100% Zero Trust                 ║
╚══════════════════════════════════════════════════════════════════╝
`);

// Initialize core systems
async function init() {
  try {
    // 1. Load core modules
    console.log('[INIT] Loading core modules...');

    const { XORChain } = require('./core/xor/chain');
    const { NeuralGraph } = require('./intelligence/fusion/graph');
    const { TinyModel, ModelRouter } = require('./intelligence/tiny-model/inference');
    const { SecuritySystem } = require('./security');

    // 2. Initialize XOR chain
    console.log('[INIT] Initializing XOR chain...');
    const xorChain = new XORChain('system-boot');
    const bootXor = xorChain.generate({ event: 'boot', timestamp: Date.now() });
    console.log(`[INIT] Boot XOR: ${bootXor}`);

    // 3. Initialize Neural Graph
    console.log('[INIT] Initializing Neural Graph...');
    const graph = new NeuralGraph();

    // 4. Initialize Tiny Model
    console.log('[INIT] Loading Tiny Model...');
    const model = new TinyModel();
    const router = new ModelRouter(model);

    // 5. Start Security System
    console.log('[INIT] Starting Security System...');
    const security = new SecuritySystem({ graph });

    // Load boot manifest
    const manifestPath = path.join(GENTLYOS_HOME, 'boot-manifest.txt');
    if (fs.existsSync(manifestPath)) {
      const hashes = fs.readFileSync(manifestPath, 'utf-8').split('\n').filter(Boolean);
      security.start({ files: hashes });
      console.log(`[INIT] Loaded ${hashes.length} file hashes to whitelist`);
    } else {
      security.start();
    }

    // 6. Register boot event
    graph.addInteraction({
      type: 'system',
      label: 'boot',
      metadata: { xor: bootXor }
    });

    console.log('[INIT] GentlyOS initialized successfully');
    console.log('[INIT] System ready');

    // Export for other modules
    global.GENTLYOS = {
      xorChain,
      graph,
      model,
      router,
      security
    };

  } catch (e) {
    console.error('[INIT] ERROR:', e.message);
    console.error('[INIT] Stack:', e.stack);
  }
}

init();
