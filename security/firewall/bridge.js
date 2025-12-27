/**
 * GentlyOS Firewall Bridge
 *
 * Integrates the Rust firewall core with the existing JS security system.
 * Uses child_process to invoke the CLI until N-API bindings are built.
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const EventEmitter = require('events');

class FirewallBridge extends EventEmitter {
  constructor(options = {}) {
    super();

    this.cliPath = options.cliPath || path.join(__dirname, 'target/release/firewall');
    this.ready = false;
    this.skillSchemas = null;

    // Check if CLI exists
    this._checkCli();
  }

  /**
   * Check if CLI binary exists
   */
  _checkCli() {
    try {
      execSync(`${this.cliPath} --version`, { stdio: 'pipe' });
      this.ready = true;
    } catch (e) {
      console.warn('[FirewallBridge] CLI not found. Run: cd firewall && cargo build --release');
      this.ready = false;
    }
  }

  /**
   * Invoke a skill by name
   * @param {string} skillName - Name of the skill to invoke
   * @param {Object} params - Parameters including path
   * @returns {Promise<Object>} - Skill output
   */
  async invokeSkill(skillName, params) {
    if (!this.ready) {
      throw new Error('Firewall CLI not ready');
    }

    return new Promise((resolve, reject) => {
      const args = ['invoke', skillName, params.path];

      if (params.extra) {
        args.push('--params', JSON.stringify(params.extra));
      }

      const proc = spawn(this.cliPath, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data;
      });

      proc.stderr.on('data', (data) => {
        stderr += data;
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr || `Exit code ${code}`));
        } else {
          try {
            resolve(JSON.parse(stdout));
          } catch (e) {
            reject(new Error(`Invalid JSON output: ${stdout}`));
          }
        }
      });
    });
  }

  /**
   * Scan a path with all skills
   * @param {string} targetPath - Path to scan
   * @param {Object} options - Scan options
   * @returns {Promise<Array>} - All findings
   */
  async scanAll(targetPath, options = {}) {
    if (!this.ready) {
      throw new Error('Firewall CLI not ready');
    }

    return new Promise((resolve, reject) => {
      const args = ['scan', targetPath, '--format', 'json'];

      if (options.skill) {
        args.push('--skill', options.skill);
      }

      if (options.minSeverity) {
        args.push('--min-severity', options.minSeverity);
      }

      const proc = spawn(this.cliPath, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data;
      });

      proc.stderr.on('data', (data) => {
        stderr += data;
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr || `Exit code ${code}`));
        } else {
          try {
            resolve(JSON.parse(stdout));
          } catch (e) {
            // Empty results
            resolve([]);
          }
        }
      });
    });
  }

  /**
   * Get all available skill schemas for tool calling
   * @returns {Promise<Object>} - Skill schemas in tool calling format
   */
  async getToolSchemas() {
    if (this.skillSchemas) {
      return this.skillSchemas;
    }

    if (!this.ready) {
      throw new Error('Firewall CLI not ready');
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(this.cliPath, ['export']);
      let stdout = '';

      proc.stdout.on('data', (data) => {
        stdout += data;
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Exit code ${code}`));
        } else {
          try {
            this.skillSchemas = JSON.parse(stdout);
            resolve(this.skillSchemas);
          } catch (e) {
            reject(new Error(`Invalid JSON: ${stdout}`));
          }
        }
      });
    });
  }

  /**
   * List available skills
   * @returns {Promise<Array<string>>} - Skill names
   */
  async listSkills() {
    const schemas = await this.getToolSchemas();
    return schemas.skills.map(s => s.name);
  }

  /**
   * Wire into existing SecuritySystem watcher
   * @param {Object} watcher - AIWatcher instance
   */
  attachToWatcher(watcher) {
    if (!watcher) return;

    // Listen for scan requests
    watcher.on('scan_request', async (target) => {
      try {
        const findings = await this.scanAll(target.path, {
          minSeverity: target.minSeverity || 'medium'
        });

        // Convert findings to threat format
        for (const finding of findings) {
          watcher.emit('threat', {
            type: `firewall_${finding.finding_type}`,
            severity: finding.severity,
            confidence: finding.confidence,
            location: finding.location,
            details: finding.metadata,
            source: 'firewall'
          });
        }
      } catch (e) {
        console.error('[FirewallBridge] Scan failed:', e.message);
      }
    });

    console.log('[FirewallBridge] Attached to watcher');
  }

  /**
   * Run a quick security check on a file
   * @param {string} filePath - File to check
   * @returns {Promise<boolean>} - true if threats found
   */
  async quickCheck(filePath) {
    const findings = await this.scanAll(filePath, { minSeverity: 'high' });
    return findings.length > 0;
  }
}

/**
 * Create a FirewallBridge instance with default options
 */
function createFirewallBridge(options = {}) {
  return new FirewallBridge(options);
}

module.exports = { FirewallBridge, createFirewallBridge };
