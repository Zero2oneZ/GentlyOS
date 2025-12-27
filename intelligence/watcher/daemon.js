/**
 * GentlyOS AI Watcher
 * ZERO TRUST: If we didn't build it, it's a threat.
 * Whitelist approach - only trust what's in our graph.
 */

const EventEmitter = require('events');
const fs = require('fs');
const crypto = require('crypto');
const { NeuralGraph } = require('../fusion/graph');

class AIWatcher extends EventEmitter {
  constructor(options = {}) {
    super();

    this.graph = options.graph || new NeuralGraph();
    this.running = false;
    this.alerts = [];
    this.threatLevel = 'LOW';

    // WHITELIST - things WE built/know about
    this.whitelist = {
      files: new Set(),      // Hashes of known good files
      processes: new Set(),  // Known good process signatures
      connections: new Set(), // Known good network destinations
      xors: new Set(),       // All XORs we've generated
      mutations: new Set()   // All mutations we've applied
    };

    // Boot manifest - what the OS shipped with
    this.bootManifest = null;
  }

  /**
   * Initialize whitelist from boot manifest
   * @param {Object} manifest - Boot manifest with known good hashes
   */
  initFromManifest(manifest) {
    this.bootManifest = manifest;

    // Add all boot files to whitelist
    if (manifest.files) {
      for (const hash of manifest.files) {
        this.whitelist.files.add(hash);
      }
    }

    // Add known good processes
    if (manifest.processes) {
      for (const proc of manifest.processes) {
        this.whitelist.processes.add(proc);
      }
    }

    console.log(`[WATCHER] Initialized with ${this.whitelist.files.size} trusted files`);
  }

  /**
   * Start watching
   */
  start() {
    if (this.running) return;
    this.running = true;

    console.log('[WATCHER] ZERO TRUST MODE ACTIVE');
    console.log('[WATCHER] If we didn\'t build it, it\'s a threat.');
    this.emit('start');

    // Start monitors
    this.startMonitors();
  }

  /**
   * Stop watching
   */
  stop() {
    this.running = false;
    this.emit('stop');
    console.log('[WATCHER] Stopped');
  }

  /**
   * Start monitors
   */
  startMonitors() {
    // File system monitor
    this.monitorFiles();

    // Process monitor
    this.monitorProcesses();

    // Network monitor
    this.monitorNetwork();

    // Graph event monitor
    this.monitorGraph();
  }

  /**
   * Register something WE built (add to whitelist)
   * @param {string} type - 'file', 'process', 'connection', 'xor', 'mutation'
   * @param {string} identifier - Hash or signature
   */
  weBuiltThis(type, identifier) {
    if (this.whitelist[type]) {
      this.whitelist[type].add(identifier);
    }
    // Also add to graph
    this.graph.addInteraction({
      type: `whitelist_${type}`,
      label: 'registered',
      metadata: { identifier }
    });
  }

  /**
   * Check if something is trusted
   * @param {string} type
   * @param {string} identifier
   * @returns {boolean}
   */
  isTrusted(type, identifier) {
    return this.whitelist[type]?.has(identifier) || false;
  }

  /**
   * Monitor files - ANYTHING not in whitelist = THREAT
   */
  monitorFiles() {
    const checkInterval = setInterval(() => {
      if (!this.running) {
        clearInterval(checkInterval);
        return;
      }

      // Check critical paths
      const criticalPaths = [
        '/etc',
        '/usr/bin',
        '/usr/local/bin',
        '/root',
        '/home'
      ];

      for (const dir of criticalPaths) {
        this.scanDirectory(dir);
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Scan a directory
   * @param {string} dir
   */
  scanDirectory(dir) {
    try {
      const files = fs.readdirSync(dir, { withFileTypes: true });

      for (const file of files) {
        const fullPath = `${dir}/${file.name}`;

        if (file.isFile()) {
          const hash = this.hashFile(fullPath);

          if (!this.isTrusted('files', hash)) {
            this.threat('FILE', `Unknown file: ${fullPath}`, {
              path: fullPath,
              hash
            });
          }
        }
      }
    } catch {}
  }

  /**
   * Monitor processes - ANYTHING not in whitelist = THREAT
   */
  monitorProcesses() {
    const { exec } = require('child_process');

    const checkInterval = setInterval(() => {
      if (!this.running) {
        clearInterval(checkInterval);
        return;
      }

      exec('ps aux --no-headers 2>/dev/null', (err, stdout) => {
        if (err) return;

        const procs = stdout.split('\n').filter(Boolean);

        for (const proc of procs) {
          // Extract command (last column)
          const parts = proc.trim().split(/\s+/);
          const cmd = parts.slice(10).join(' ');
          const cmdHash = this.hash(cmd);

          if (!this.isTrusted('processes', cmdHash)) {
            // Check if it's a known OS process
            if (!this.isKnownOSProcess(cmd)) {
              this.threat('PROCESS', `Unknown process: ${cmd.slice(0, 50)}`, {
                full: proc,
                command: cmd
              });
            }
          }
        }
      });
    }, 10000); // Every 10 seconds
  }

  /**
   * Check if process is known OS process
   * @param {string} cmd
   * @returns {boolean}
   */
  isKnownOSProcess(cmd) {
    const knownPatterns = [
      /^\/bin\//,
      /^\/sbin\//,
      /^\/usr\/bin\//,
      /^\/usr\/sbin\//,
      /^\/lib\//,
      /^\[.*\]$/,  // Kernel threads
      /^init$/,
      /^systemd/,
      /^kworker/,
      /^rcu_/,
      /^migration/
    ];

    return knownPatterns.some(p => p.test(cmd));
  }

  /**
   * Monitor network - ANYTHING not in whitelist = THREAT
   */
  monitorNetwork() {
    const { exec } = require('child_process');

    const checkInterval = setInterval(() => {
      if (!this.running) {
        clearInterval(checkInterval);
        return;
      }

      exec('ss -tupn 2>/dev/null || netstat -tupn 2>/dev/null', (err, stdout) => {
        if (err) return;

        const conns = stdout.split('\n').filter(l => l.includes('ESTABLISHED'));

        for (const conn of conns) {
          // Extract remote address
          const match = conn.match(/(\d+\.\d+\.\d+\.\d+):(\d+)/g);
          if (match) {
            const remote = match[1] || match[0];  // Second match is usually remote

            if (!this.isTrusted('connections', remote)) {
              // Check if it's a known safe destination
              if (!this.isKnownSafe(remote)) {
                this.threat('NETWORK', `Unknown connection: ${remote}`, {
                  connection: conn,
                  remote
                });
              }
            }
          }
        }
      });
    }, 15000); // Every 15 seconds
  }

  /**
   * Check if destination is known safe
   * @param {string} addr
   * @returns {boolean}
   */
  isKnownSafe(addr) {
    const safePatterns = [
      /^127\./,           // Localhost
      /^192\.168\./,      // Private network (could be sus, but common)
      /^10\./,            // Private network
      /^172\.(1[6-9]|2[0-9]|3[01])\./,  // Private network
      /^8\.8\./,          // Google DNS
      /^1\.1\.1\./        // Cloudflare DNS
    ];

    return safePatterns.some(p => p.test(addr));
  }

  /**
   * Monitor graph for unauthorized modifications
   */
  monitorGraph() {
    // Every interaction should come through us
    // If something modifies the graph directly = sus

    this.graph.on('interaction', (event) => {
      if (!this.isTrusted('xors', event.xor)) {
        this.threat('GRAPH', `Unauthorized graph modification`, {
          xor: event.xor,
          event
        });
      }
    });
  }

  /**
   * Process an event WE generated
   * @param {Object} event
   */
  processOurEvent(event) {
    const { xor } = this.graph.addInteraction(event);

    // Add to whitelist - we built this
    this.whitelist.xors.add(xor);

    return xor;
  }

  /**
   * Register a mutation WE applied
   * @param {string} mutation
   */
  registerMutation(mutation) {
    const hash = this.hash(mutation);
    this.whitelist.mutations.add(hash);
  }

  /**
   * Raise a threat
   * @param {string} type
   * @param {string} message
   * @param {Object} data
   */
  threat(type, message, data = {}) {
    const alert = {
      id: crypto.randomBytes(4).toString('hex'),
      type,
      message,
      data,
      timestamp: new Date().toISOString(),
      level: 'THREAT'  // Everything unknown is a threat
    };

    this.alerts.push(alert);

    // Emit
    this.emit('threat', alert);

    // Display
    console.log(`\n╔══════════════════════════════════════════════════════╗`);
    console.log(`║  ⚠️  THREAT DETECTED                                  ║`);
    console.log(`╠══════════════════════════════════════════════════════╣`);
    console.log(`║  Type: ${type.padEnd(45)}║`);
    console.log(`║  ${message.slice(0, 50).padEnd(52)}║`);
    console.log(`╚══════════════════════════════════════════════════════╝`);

    return alert;
  }

  /**
   * Hash a file
   * @param {string} filePath
   * @returns {string}
   */
  hashFile(filePath) {
    try {
      const content = fs.readFileSync(filePath);
      return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
    } catch {
      return 'unreadable';
    }
  }

  /**
   * Hash a string
   * @param {string} str
   * @returns {string}
   */
  hash(str) {
    return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
  }

  /**
   * Get status
   * @returns {Object}
   */
  getStatus() {
    return {
      running: this.running,
      mode: 'ZERO_TRUST',
      threats: this.alerts.length,
      whitelist: {
        files: this.whitelist.files.size,
        processes: this.whitelist.processes.size,
        connections: this.whitelist.connections.size,
        xors: this.whitelist.xors.size
      },
      recentThreats: this.alerts.slice(-5)
    };
  }

  /**
   * Get all threats
   * @returns {Array}
   */
  getThreats() {
    return this.alerts;
  }

  /**
   * Clear threat log (doesn't clear whitelist)
   */
  clearThreats() {
    this.alerts = [];
  }

  /**
   * Export whitelist for boot manifest
   * @returns {Object}
   */
  exportWhitelist() {
    return {
      files: [...this.whitelist.files],
      processes: [...this.whitelist.processes],
      connections: [...this.whitelist.connections],
      generated: new Date().toISOString()
    };
  }
}

module.exports = { AIWatcher };
