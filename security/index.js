/**
 * GentlyOS Security System
 * Integrates: Watcher → Forensics → Defense
 * ZERO TRUST ARCHITECTURE
 */

const { AIWatcher } = require('../intelligence/watcher/daemon');
const { ForensicsCollector } = require('./forensics/collector');
const { DefenseResponder } = require('./defense/responder');

class SecuritySystem {
  constructor(options = {}) {
    this.watcher = new AIWatcher(options);
    this.forensics = new ForensicsCollector(options);
    this.defense = new DefenseResponder(options);

    this.running = false;
    this.mode = 'ZERO_TRUST';

    // Wire up the pipeline
    this.setupPipeline();
  }

  /**
   * Setup: Threat → Forensics → Defense pipeline
   */
  setupPipeline() {
    // When watcher detects threat
    this.watcher.on('threat', async (threat) => {
      console.log(`\n[SECURITY] Threat pipeline activated for: ${threat.type}`);

      // 1. Open forensic case
      const caseObj = this.forensics.openCase(threat);
      console.log(`[SECURITY] Case opened: ${caseObj.id}`);

      // 2. Automatic defense response
      const response = await this.defense.respond(threat, caseObj);

      // 3. Add defense actions to case
      this.forensics.addNote(caseObj.id, `Defense responded: ${response.actions.map(a => a.action).join(', ')}`);

      // 4. Generate and log report
      const report = this.forensics.generateReport(caseObj.id);
      console.log(report);
    });

    // Paranoid mode from defense
    this.defense.on('paranoid', (enabled) => {
      if (enabled) {
        console.log('[SECURITY] PARANOID MODE ENABLED');
        // Could increase monitoring frequency here
      }
    });
  }

  /**
   * Start security system
   * @param {Object} manifest - Boot manifest with known good hashes
   */
  start(manifest = null) {
    if (this.running) return;

    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║             GentlyOS SECURITY SYSTEM                             ║
║             Mode: ZERO TRUST                                     ║
║             If we didn't build it, it's a threat.                ║
╚══════════════════════════════════════════════════════════════════╝
    `);

    // Initialize whitelist from manifest
    if (manifest) {
      this.watcher.initFromManifest(manifest);
    }

    // Start watcher
    this.watcher.start();
    this.running = true;

    console.log('[SECURITY] System active');
  }

  /**
   * Stop security system
   */
  stop() {
    this.watcher.stop();
    this.running = false;
    console.log('[SECURITY] System stopped');
  }

  /**
   * Register something WE built
   * @param {string} type
   * @param {string} identifier
   */
  register(type, identifier) {
    this.watcher.weBuiltThis(type, identifier);
  }

  /**
   * Get full status
   * @returns {Object}
   */
  getStatus() {
    return {
      running: this.running,
      mode: this.mode,
      watcher: this.watcher.getStatus(),
      defense: this.defense.getStatus(),
      cases: this.forensics.listCases()
    };
  }

  /**
   * Get case details
   * @param {string} caseId
   * @returns {string}
   */
  getCaseReport(caseId) {
    return this.forensics.generateReport(caseId);
  }

  /**
   * Export whitelist for new boot manifest
   * @returns {Object}
   */
  exportManifest() {
    return this.watcher.exportWhitelist();
  }

  /**
   * Emergency lockdown
   */
  lockdown() {
    return this.defense.emergencyLockdown();
  }

  /**
   * Lift lockdown
   */
  liftLockdown() {
    return this.defense.liftLockdown();
  }
}

module.exports = { SecuritySystem };
