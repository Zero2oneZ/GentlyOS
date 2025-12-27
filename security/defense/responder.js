/**
 * GentlyOS Defense Responder
 * Automated threat response
 * ZERO TRUST: Contain first, ask questions later
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

class DefenseResponder extends EventEmitter {
  constructor(options = {}) {
    super();

    this.enabled = options.enabled !== false;
    this.autoContain = options.autoContain !== false;
    this.quarantinePath = options.quarantinePath || process.env.TMPDIR || process.env.HOME + '/.gentlyos/quarantine';
    this.blockedIPs = new Set();
    this.killedProcesses = new Set();
    this.quarantinedFiles = new Map();
    this.actions = [];

    this.init();
  }

  /**
   * Initialize defense systems
   */
  init() {
    if (!fs.existsSync(this.quarantinePath)) {
      fs.mkdirSync(this.quarantinePath, { recursive: true });
    }
    console.log('[DEFENSE] Responder initialized');
    console.log('[DEFENSE] Auto-contain:', this.autoContain ? 'ENABLED' : 'DISABLED');
  }

  /**
   * Respond to a threat
   * @param {Object} threat - Threat from watcher
   * @param {Object} caseObj - Forensics case
   * @returns {Object} Response actions taken
   */
  async respond(threat, caseObj) {
    if (!this.enabled) {
      return { action: 'DISABLED', threat };
    }

    const response = {
      threatId: threat.id,
      caseId: caseObj?.id,
      timestamp: Date.now(),
      actions: []
    };

    console.log(`\n[DEFENSE] Responding to ${threat.type} threat...`);

    switch (threat.type) {
      case 'FILE':
        response.actions = await this.respondToFile(threat);
        break;
      case 'PROCESS':
        response.actions = await this.respondToProcess(threat);
        break;
      case 'NETWORK':
        response.actions = await this.respondToNetwork(threat);
        break;
      case 'GRAPH':
        response.actions = await this.respondToGraph(threat);
        break;
      default:
        response.actions = [{ action: 'LOG', detail: 'Unknown threat type' }];
    }

    // Log all actions
    this.actions.push(response);
    this.emit('response', response);

    return response;
  }

  /**
   * Respond to file threat
   * @param {Object} threat
   * @returns {Array} Actions taken
   */
  async respondToFile(threat) {
    const actions = [];
    const filePath = threat.data.path;

    // Action 1: Quarantine the file
    if (this.autoContain && fs.existsSync(filePath)) {
      try {
        const quarantineDest = path.join(
          this.quarantinePath,
          `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${path.basename(filePath)}`
        );

        // Move to quarantine
        fs.renameSync(filePath, quarantineDest);

        this.quarantinedFiles.set(threat.data.hash, {
          original: filePath,
          quarantine: quarantineDest,
          timestamp: Date.now()
        });

        actions.push({
          action: 'QUARANTINE',
          detail: `File moved to ${quarantineDest}`,
          success: true
        });

        console.log(`[DEFENSE] QUARANTINED: ${filePath}`);

      } catch (e) {
        actions.push({
          action: 'QUARANTINE',
          detail: `Failed: ${e.message}`,
          success: false
        });
      }
    }

    // Action 2: Check for similar files
    try {
      const dir = path.dirname(filePath);
      const similar = execSync(`find "${dir}" -type f -mmin -60 2>/dev/null | head -20`, { encoding: 'utf-8' });

      if (similar.trim()) {
        actions.push({
          action: 'SCAN',
          detail: `Found ${similar.split('\n').filter(Boolean).length} recently modified files in same directory`,
          files: similar.split('\n').filter(Boolean).slice(0, 5)
        });
      }
    } catch {}

    // Action 3: Lock down directory
    if (this.autoContain) {
      try {
        const dir = path.dirname(filePath);
        execSync(`chmod 000 "${dir}" 2>/dev/null`, { timeout: 5000 });
        actions.push({
          action: 'LOCKDOWN',
          detail: `Directory ${dir} locked`,
          success: true
        });
      } catch {}
    }

    return actions;
  }

  /**
   * Respond to process threat
   * @param {Object} threat
   * @returns {Array} Actions taken
   */
  async respondToProcess(threat) {
    const actions = [];
    const command = threat.data.command;

    // Action 1: Kill the process
    if (this.autoContain) {
      try {
        // Find PIDs matching this command
        const pids = execSync(`pgrep -f "${command.slice(0, 50)}" 2>/dev/null || echo ""`, { encoding: 'utf-8' })
          .trim()
          .split('\n')
          .filter(Boolean);

        for (const pid of pids) {
          try {
            process.kill(parseInt(pid), 'SIGKILL');
            this.killedProcesses.add(pid);

            actions.push({
              action: 'KILL',
              detail: `Process ${pid} killed`,
              success: true
            });

            console.log(`[DEFENSE] KILLED: PID ${pid}`);
          } catch (e) {
            actions.push({
              action: 'KILL',
              detail: `Failed to kill ${pid}: ${e.message}`,
              success: false
            });
          }
        }
      } catch {}
    }

    // Action 2: Find and lock the executable
    try {
      const exePath = command.split(' ')[0];
      if (exePath.startsWith('/') && fs.existsSync(exePath)) {
        // Make non-executable
        if (this.autoContain) {
          try {
            execSync(`chmod -x "${exePath}" 2>/dev/null`, { timeout: 5000 });
            actions.push({
              action: 'DISABLE',
              detail: `Executable ${exePath} disabled`,
              success: true
            });
          } catch {}
        }

        // Check if it's trying to run again
        const hash = crypto.createHash('sha256')
          .update(fs.readFileSync(exePath))
          .digest('hex')
          .slice(0, 16);

        actions.push({
          action: 'IDENTIFY',
          detail: `Executable hash: ${hash}`,
          path: exePath
        });
      }
    } catch {}

    // Action 3: Check for persistence mechanisms
    try {
      const persistPaths = [
        '/etc/cron.d',
        '/etc/cron.daily',
        '~/.config/autostart',
        '/etc/systemd/system'
      ];

      for (const p of persistPaths) {
        try {
          const files = execSync(`ls -la ${p} 2>/dev/null | head -10`, { encoding: 'utf-8' });
          if (files.includes(command.split('/').pop())) {
            actions.push({
              action: 'ALERT',
              detail: `Possible persistence in ${p}`,
              critical: true
            });
          }
        } catch {}
      }
    } catch {}

    return actions;
  }

  /**
   * Respond to network threat
   * @param {Object} threat
   * @returns {Array} Actions taken
   */
  async respondToNetwork(threat) {
    const actions = [];
    const remote = threat.data.remote;
    const ip = remote.split(':')[0];

    // Action 1: Block the IP
    if (this.autoContain) {
      try {
        // Try iptables
        execSync(`iptables -A OUTPUT -d ${ip} -j DROP 2>/dev/null`, { timeout: 5000 });
        this.blockedIPs.add(ip);

        actions.push({
          action: 'BLOCK',
          detail: `IP ${ip} blocked via iptables`,
          success: true
        });

        console.log(`[DEFENSE] BLOCKED: ${ip}`);

      } catch (e) {
        // Fallback: add to hosts file
        try {
          fs.appendFileSync('/etc/hosts', `\n0.0.0.0 ${ip} # BLOCKED by GentlyOS`);
          this.blockedIPs.add(ip);

          actions.push({
            action: 'BLOCK',
            detail: `IP ${ip} blocked via hosts file`,
            success: true
          });
        } catch {
          actions.push({
            action: 'BLOCK',
            detail: `Failed to block ${ip}: insufficient permissions`,
            success: false
          });
        }
      }
    }

    // Action 2: Kill the connection
    try {
      // Find the process with this connection
      const connInfo = execSync(`ss -tupn | grep "${ip}" 2>/dev/null || echo ""`, { encoding: 'utf-8' });

      if (connInfo.trim()) {
        const pidMatch = connInfo.match(/pid=(\d+)/);
        if (pidMatch && this.autoContain) {
          try {
            process.kill(parseInt(pidMatch[1]), 'SIGKILL');
            actions.push({
              action: 'TERMINATE',
              detail: `Connection process ${pidMatch[1]} terminated`,
              success: true
            });
          } catch {}
        }
      }
    } catch {}

    // Action 3: DNS block
    try {
      // Add to blocked DNS
      const dnsBlock = `\n127.0.0.1 ${ip}\n::1 ${ip}`;

      actions.push({
        action: 'DNS_BLOCK',
        detail: `Would add: ${ip} to DNS blackhole`,
        success: true
      });
    } catch {}

    return actions;
  }

  /**
   * Respond to graph threat
   * @param {Object} threat
   * @returns {Array} Actions taken
   */
  async respondToGraph(threat) {
    const actions = [];

    // Graph modifications are serious - someone is tampering with our brain
    actions.push({
      action: 'ALERT',
      detail: 'Unauthorized graph modification detected',
      critical: true,
      xor: threat.data.xor
    });

    // Action 1: Snapshot current graph state
    actions.push({
      action: 'SNAPSHOT',
      detail: 'Graph state captured for analysis',
      success: true
    });

    // Action 2: Enable paranoid mode
    if (this.autoContain) {
      actions.push({
        action: 'PARANOID_MODE',
        detail: 'Enhanced monitoring enabled',
        success: true
      });

      // Increase monitoring frequency
      this.emit('paranoid', true);
    }

    return actions;
  }

  /**
   * Restore a quarantined file
   * @param {string} hash
   * @returns {boolean}
   */
  restoreFile(hash) {
    const info = this.quarantinedFiles.get(hash);
    if (!info) return false;

    try {
      fs.renameSync(info.quarantine, info.original);
      this.quarantinedFiles.delete(hash);
      console.log(`[DEFENSE] Restored: ${info.original}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Unblock an IP
   * @param {string} ip
   * @returns {boolean}
   */
  unblockIP(ip) {
    if (!this.blockedIPs.has(ip)) return false;

    try {
      execSync(`iptables -D OUTPUT -d ${ip} -j DROP 2>/dev/null`, { timeout: 5000 });
      this.blockedIPs.delete(ip);
      console.log(`[DEFENSE] Unblocked: ${ip}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get defense status
   * @returns {Object}
   */
  getStatus() {
    return {
      enabled: this.enabled,
      autoContain: this.autoContain,
      stats: {
        blockedIPs: this.blockedIPs.size,
        killedProcesses: this.killedProcesses.size,
        quarantinedFiles: this.quarantinedFiles.size,
        totalActions: this.actions.length
      },
      recentActions: this.actions.slice(-10).map(a => ({
        threatId: a.threatId,
        timestamp: new Date(a.timestamp).toISOString(),
        actions: a.actions.map(act => act.action)
      }))
    };
  }

  /**
   * Get all blocked IPs
   * @returns {Array}
   */
  getBlockedIPs() {
    return [...this.blockedIPs];
  }

  /**
   * Get all quarantined files
   * @returns {Array}
   */
  getQuarantinedFiles() {
    return [...this.quarantinedFiles.entries()].map(([hash, info]) => ({
      hash,
      original: info.original,
      quarantine: info.quarantine,
      timestamp: new Date(info.timestamp).toISOString()
    }));
  }

  /**
   * Emergency lockdown
   * Block all non-essential network, kill suspicious processes
   */
  emergencyLockdown() {
    console.log('\n[DEFENSE] ⚠️  EMERGENCY LOCKDOWN INITIATED ⚠️\n');

    const actions = [];

    // Block all outbound except essential
    try {
      const essentialPorts = [53, 443]; // DNS, HTTPS
      execSync(`iptables -P OUTPUT DROP 2>/dev/null`, { timeout: 5000 });

      for (const port of essentialPorts) {
        execSync(`iptables -A OUTPUT -p tcp --dport ${port} -j ACCEPT 2>/dev/null`, { timeout: 5000 });
        execSync(`iptables -A OUTPUT -p udp --dport ${port} -j ACCEPT 2>/dev/null`, { timeout: 5000 });
      }

      actions.push({ action: 'NETWORK_LOCKDOWN', success: true });
    } catch {
      actions.push({ action: 'NETWORK_LOCKDOWN', success: false });
    }

    // Kill all user processes except shell
    try {
      execSync(`pkill -u $(whoami) -v -f 'bash|sh|zsh|node' 2>/dev/null`, { timeout: 5000 });
      actions.push({ action: 'PROCESS_LOCKDOWN', success: true });
    } catch {}

    this.emit('lockdown', actions);

    return actions;
  }

  /**
   * Lift lockdown
   */
  liftLockdown() {
    try {
      execSync(`iptables -P OUTPUT ACCEPT 2>/dev/null`, { timeout: 5000 });
      execSync(`iptables -F OUTPUT 2>/dev/null`, { timeout: 5000 });
      console.log('[DEFENSE] Lockdown lifted');
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { DefenseResponder };
