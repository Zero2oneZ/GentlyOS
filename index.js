/**
 * GentlyOS - Self-Evolving Operating System
 *
 * LICENSE:
 * - FREE for personal use
 * - Enterprise/commercial use requires paid license
 * - See LICENSE.md for details
 *
 * Architecture:
 * - 90% handled by tiny JSONL model (cheap, fast)
 * - 10% handled by Claude (complex reasoning)
 * - Neural graph learns from every interaction
 * - Zero trust security model
 * - XOR temporal chains for state linking
 * - IPFS/Solana for permanence and audit
 */

const { PRIMITIVES, THEMES } = require('./core/primitives/catalog');
const { parse, hydrate } = require('./core/codie/parser');
const { encode, delta } = require('./core/codie/encoder');
const { XORChain } = require('./core/xor/chain');
const { deriveKeys } = require('./core/xor/pubkey');
const { NeuralGraph } = require('./intelligence/fusion/graph');
const { PatternDetector } = require('./intelligence/fusion/pattern');
const { TinyModel, ModelRouter } = require('./intelligence/tiny-model/inference');
const { ClaudeBridge } = require('./intelligence/claude/bridge');
const { AIWatcher } = require('./intelligence/watcher/daemon');
const { GitBlobStore } = require('./storage/git/blobs');
const { NervousSystem, ChainOfThought } = require('./infra/solana/audit');
const { SecuritySystem } = require('./security');

// License types
const LICENSE_TYPES = {
  PERSONAL: 'personal',      // Free
  ENTERPRISE: 'enterprise'   // Paid
};

class GentlyOS {
  constructor(options = {}) {
    this.version = '0.1.0';
    this.mode = options.mode || 'development';
    this.licenseType = options.license || LICENSE_TYPES.PERSONAL;
    this.licenseKey = options.licenseKey || null;

    // Validate enterprise license
    if (this.licenseType === LICENSE_TYPES.ENTERPRISE && !this.licenseKey) {
      console.warn('[LICENSE] Enterprise mode requires valid license key');
      console.warn('[LICENSE] Contact licensing@gentlyos.dev');
    }

    // Core systems
    this.xorChain = new XORChain('main');
    this.graph = new NeuralGraph();
    this.patterns = new PatternDetector(this.graph);
    this.model = new TinyModel();
    this.router = new ModelRouter(this.model);
    this.claude = new ClaudeBridge();
    this.nervous = new NervousSystem();
    this.storage = new GitBlobStore(options.repoPath || process.cwd());
    this.security = new SecuritySystem({ graph: this.graph });

    // State
    this.initialized = false;
    this.bootXor = null;
  }

  /**
   * Validate license key for enterprise use
   * @param {string} key
   * @returns {boolean}
   */
  validateLicense(key) {
    if (!key) return false;

    // License format: GENTLY-XXXX-XXXX-XXXX
    const pattern = /^GENTLY-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
    if (!pattern.test(key)) return false;

    // Verify against XOR chain (simple check)
    const hash = this.xorChain.ns?.hash(key) || key;
    return hash.length === 64;
  }

  /**
   * Initialize GentlyOS
   */
  async init() {
    const licenseLabel = this.licenseType === LICENSE_TYPES.ENTERPRISE
      ? 'ENTERPRISE'
      : 'PERSONAL (Free)';

    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                      GentlyOS v${this.version}                            ║
║          Self-Evolving Operating System                          ║
║                                                                  ║
║   License: ${licenseLabel.padEnd(50)}║
║                                                                  ║
║   Every thought hashed. Every step valued.                       ║
║   IPFS + Solana anchored.                                        ║
╚══════════════════════════════════════════════════════════════════╝
    `);

    // Generate boot XOR
    this.bootXor = this.xorChain.generate({
      event: 'init',
      version: this.version,
      license: this.licenseType,
      timestamp: Date.now()
    });

    console.log(`[GENTLYOS] Boot XOR: ${this.bootXor}`);

    // Start security in zero trust mode
    this.security.start();

    // Register ourselves
    this.security.register('xors', this.bootXor);

    this.initialized = true;
    console.log('[GENTLYOS] Initialized');

    return this;
  }

  /**
   * Process user interaction
   * Routes to tiny model (90%) or Claude (10%)
   * @param {Object} interaction
   * @returns {Object} Response
   */
  async process(interaction) {
    // Start chain of thought
    const chain = this.nervous.startChain(interaction.prompt || interaction.action);

    // Add to graph
    const { xor } = this.graph.addInteraction({
      type: interaction.type || 'user',
      label: interaction.action || 'interaction',
      metadata: interaction
    });

    // Register XOR
    this.security.register('xors', xor);

    // Route to appropriate model
    await chain.addStep('Analyzing request complexity', 15);

    const route = await this.router.route({
      type: interaction.type,
      action: interaction.action,
      context: interaction.context || '',
      complexity: this.estimateComplexity(interaction)
    });

    let response;

    if (route.useFullModel) {
      // Complex request → Claude (10%)
      await chain.addStep('Routing to Claude for complex reasoning', 20);

      try {
        response = await this.claude.query(
          interaction.prompt || JSON.stringify(interaction),
          { type: interaction.type }
        );
        await chain.addStep('Claude response received', 25);
      } catch (e) {
        response = { error: e.message, fallback: true };
        await chain.addStep('Claude unavailable, using fallback', 25);
      }
    } else {
      // Simple request → Tiny Model (90%)
      await chain.addStep('Handling with tiny model', 20);
      response = route.tinyResponse || { handled: true };
      await chain.addStep('Tiny model response generated', 25);
    }

    // Complete chain
    const chainResult = await chain.complete(JSON.stringify(response).slice(0, 100));

    // Store to git
    this.storage.create('object', {
      interaction,
      response,
      xor,
      chain: chainResult.chainId
    });

    return {
      response,
      xor,
      chain: chainResult,
      route: route.useFullModel ? 'claude' : 'tiny'
    };
  }

  /**
   * Estimate complexity of interaction
   * @param {Object} interaction
   * @returns {number} 0-100
   */
  estimateComplexity(interaction) {
    let complexity = 0;

    // Long prompts = more complex
    const promptLen = (interaction.prompt || '').length;
    complexity += Math.min(promptLen / 10, 30);

    // Certain actions are always complex
    const complexActions = ['redesign', 'analyze', 'synthesize', 'architecture'];
    if (complexActions.includes(interaction.action)) {
      complexity += 50;
    }

    // Context adds complexity
    if (interaction.context) {
      complexity += 10;
    }

    return Math.min(complexity, 100);
  }

  /**
   * Parse CODIE string
   * @param {string} codie
   * @returns {Object}
   */
  parse(codie) {
    return parse(codie);
  }

  /**
   * Hydrate CODIE to HTML
   * @param {string} codie
   * @returns {string}
   */
  hydrate(codie) {
    return hydrate(codie);
  }

  /**
   * Encode to CODIE
   * @param {Object} structure
   * @returns {string}
   */
  encode(structure) {
    return encode(structure);
  }

  /**
   * Get system status
   * @returns {Object}
   */
  getStatus() {
    return {
      version: this.version,
      mode: this.mode,
      license: this.licenseType,
      initialized: this.initialized,
      bootXor: this.bootXor,
      xorChain: this.xorChain.chain.length,
      graph: this.graph.getStats(),
      patterns: this.patterns.getStats(),
      model: this.model.getStats(),
      claude: this.claude.getStats(),
      storage: this.storage.getStats(),
      security: this.security.getStatus()
    };
  }

  /**
   * Visualize neural graph
   * @returns {string}
   */
  visualize() {
    return this.graph.visualize();
  }

  /**
   * Shutdown
   */
  shutdown() {
    console.log('[GENTLYOS] Shutting down...');
    this.security.stop();
    console.log('[GENTLYOS] Goodbye');
  }
}

// Export
module.exports = {
  GentlyOS,
  LICENSE_TYPES,
  // Core
  PRIMITIVES,
  THEMES,
  parse,
  hydrate,
  encode,
  delta,
  XORChain,
  deriveKeys,
  // Intelligence
  NeuralGraph,
  PatternDetector,
  TinyModel,
  ModelRouter,
  ClaudeBridge,
  AIWatcher,
  // Storage
  GitBlobStore,
  // Infrastructure
  NervousSystem,
  ChainOfThought,
  // Security
  SecuritySystem
};

// CLI entry point
if (require.main === module) {
  const os = new GentlyOS({
    license: process.env.GENTLYOS_LICENSE || LICENSE_TYPES.PERSONAL,
    licenseKey: process.env.GENTLYOS_LICENSE_KEY
  });

  os.init().then(() => {
    console.log('\n[GENTLYOS] Running in interactive mode');
    console.log('[GENTLYOS] Press Ctrl+C to exit\n');

    // Keep alive
    process.on('SIGINT', () => {
      os.shutdown();
      process.exit(0);
    });
  });
}
