/**
 * GentlyOS Forensics Collector
 * Evidence collection for threat analysis
 * Every threat gets full forensic workup
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

class ForensicsCollector {
  constructor(options = {}) {
    this.evidencePath = options.evidencePath || process.env.TMPDIR || process.env.HOME + '/.gentlyos/forensics';
    this.maxEvidenceAge = options.maxEvidenceAge || 86400000 * 7; // 7 days
    this.cases = new Map();

    this.init();
  }

  /**
   * Initialize forensics storage
   */
  init() {
    if (!fs.existsSync(this.evidencePath)) {
      fs.mkdirSync(this.evidencePath, { recursive: true });
    }
  }

  /**
   * Open a new case for a threat
   * @param {Object} threat - Threat alert from watcher
   * @returns {Object} Case object
   */
  openCase(threat) {
    const caseId = crypto.randomBytes(8).toString('hex');
    const casePath = path.join(this.evidencePath, caseId);
    fs.mkdirSync(casePath, { recursive: true });

    const caseObj = {
      id: caseId,
      threat,
      opened: Date.now(),
      status: 'OPEN',
      evidence: [],
      timeline: [],
      path: casePath
    };

    this.cases.set(caseId, caseObj);

    // Auto-collect based on threat type
    this.autoCollect(caseObj);

    return caseObj;
  }

  /**
   * Auto-collect evidence based on threat type
   * @param {Object} caseObj
   */
  autoCollect(caseObj) {
    const { threat } = caseObj;

    switch (threat.type) {
      case 'FILE':
        this.collectFileEvidence(caseObj, threat.data.path);
        break;
      case 'PROCESS':
        this.collectProcessEvidence(caseObj, threat.data.command);
        break;
      case 'NETWORK':
        this.collectNetworkEvidence(caseObj, threat.data.remote);
        break;
      case 'GRAPH':
        this.collectGraphEvidence(caseObj, threat.data.xor);
        break;
    }

    // Always collect system state
    this.collectSystemState(caseObj);
  }

  /**
   * Collect file evidence
   * @param {Object} caseObj
   * @param {string} filePath
   */
  collectFileEvidence(caseObj, filePath) {
    const evidence = {
      type: 'file',
      timestamp: Date.now(),
      data: {}
    };

    try {
      // File metadata
      const stat = fs.statSync(filePath);
      evidence.data.stat = {
        size: stat.size,
        mode: stat.mode,
        uid: stat.uid,
        gid: stat.gid,
        atime: stat.atime,
        mtime: stat.mtime,
        ctime: stat.ctime
      };

      // File hash
      const content = fs.readFileSync(filePath);
      evidence.data.hash = {
        sha256: crypto.createHash('sha256').update(content).digest('hex'),
        md5: crypto.createHash('md5').update(content).digest('hex')
      };

      // File type
      try {
        evidence.data.fileType = execSync(`file "${filePath}"`, { encoding: 'utf-8' }).trim();
      } catch {}

      // Copy file to evidence
      const evidenceCopy = path.join(caseObj.path, `file_${Date.now()}_${path.basename(filePath)}`);
      fs.copyFileSync(filePath, evidenceCopy);
      evidence.data.evidenceCopy = evidenceCopy;

      // Strings extraction (for binaries)
      try {
        evidence.data.strings = execSync(`strings "${filePath}" | head -100`, { encoding: 'utf-8' });
      } catch {}

    } catch (e) {
      evidence.data.error = e.message;
    }

    this.addEvidence(caseObj, evidence);
  }

  /**
   * Collect process evidence
   * @param {Object} caseObj
   * @param {string} command
   */
  collectProcessEvidence(caseObj, command) {
    const evidence = {
      type: 'process',
      timestamp: Date.now(),
      data: { command }
    };

    try {
      // Find PID
      const pidSearch = execSync(`pgrep -f "${command.slice(0, 50)}" 2>/dev/null || echo ""`, { encoding: 'utf-8' }).trim();
      const pids = pidSearch.split('\n').filter(Boolean);

      if (pids.length > 0) {
        evidence.data.pids = pids;

        for (const pid of pids.slice(0, 5)) { // Limit to 5 PIDs
          try {
            // Process info
            evidence.data[`pid_${pid}`] = {
              cmdline: fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8').replace(/\0/g, ' '),
              cwd: fs.readlinkSync(`/proc/${pid}/cwd`),
              exe: fs.readlinkSync(`/proc/${pid}/exe`),
              environ: fs.readFileSync(`/proc/${pid}/environ`, 'utf-8').replace(/\0/g, '\n').slice(0, 2000),
              status: fs.readFileSync(`/proc/${pid}/status`, 'utf-8')
            };

            // Open files
            try {
              const fds = fs.readdirSync(`/proc/${pid}/fd`);
              evidence.data[`pid_${pid}`].openFiles = fds.slice(0, 50).map(fd => {
                try {
                  return fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
                } catch {
                  return null;
                }
              }).filter(Boolean);
            } catch {}

          } catch {}
        }
      }

      // Process tree
      try {
        evidence.data.processTree = execSync('ps auxf 2>/dev/null | head -100', { encoding: 'utf-8' });
      } catch {}

    } catch (e) {
      evidence.data.error = e.message;
    }

    this.addEvidence(caseObj, evidence);
  }

  /**
   * Collect network evidence
   * @param {Object} caseObj
   * @param {string} remote
   */
  collectNetworkEvidence(caseObj, remote) {
    const evidence = {
      type: 'network',
      timestamp: Date.now(),
      data: { remote }
    };

    try {
      // Current connections
      try {
        evidence.data.connections = execSync('ss -tupn 2>/dev/null || netstat -tupn 2>/dev/null', { encoding: 'utf-8' });
      } catch {}

      // DNS lookup
      try {
        const ip = remote.split(':')[0];
        evidence.data.dns = execSync(`nslookup ${ip} 2>/dev/null || host ${ip} 2>/dev/null || echo "DNS lookup failed"`, { encoding: 'utf-8' });
      } catch {}

      // Whois (if available)
      try {
        const ip = remote.split(':')[0];
        evidence.data.whois = execSync(`whois ${ip} 2>/dev/null | head -50`, { encoding: 'utf-8' });
      } catch {}

      // Routing info
      try {
        evidence.data.route = execSync('ip route 2>/dev/null || route -n 2>/dev/null', { encoding: 'utf-8' });
      } catch {}

      // Listening ports
      try {
        evidence.data.listening = execSync('ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null', { encoding: 'utf-8' });
      } catch {}

    } catch (e) {
      evidence.data.error = e.message;
    }

    this.addEvidence(caseObj, evidence);
  }

  /**
   * Collect graph evidence
   * @param {Object} caseObj
   * @param {string} xor
   */
  collectGraphEvidence(caseObj, xor) {
    const evidence = {
      type: 'graph',
      timestamp: Date.now(),
      data: { xor }
    };

    // Graph evidence would come from the NeuralGraph
    // This is more about capturing the context

    evidence.data.note = 'Graph modification detected outside of trusted operations';

    this.addEvidence(caseObj, evidence);
  }

  /**
   * Collect system state
   * @param {Object} caseObj
   */
  collectSystemState(caseObj) {
    const evidence = {
      type: 'system_state',
      timestamp: Date.now(),
      data: {}
    };

    try {
      // System info
      evidence.data.uname = execSync('uname -a', { encoding: 'utf-8' }).trim();
      evidence.data.uptime = execSync('uptime', { encoding: 'utf-8' }).trim();

      // Memory
      try {
        evidence.data.memory = execSync('free -m 2>/dev/null || cat /proc/meminfo', { encoding: 'utf-8' });
      } catch {}

      // Disk
      try {
        evidence.data.disk = execSync('df -h', { encoding: 'utf-8' });
      } catch {}

      // Logged in users
      try {
        evidence.data.users = execSync('who 2>/dev/null || w 2>/dev/null', { encoding: 'utf-8' });
      } catch {}

      // Recent logins
      try {
        evidence.data.logins = execSync('last -n 10 2>/dev/null', { encoding: 'utf-8' });
      } catch {}

      // Environment
      evidence.data.env = Object.keys(process.env).filter(k =>
        !k.includes('KEY') && !k.includes('SECRET') && !k.includes('TOKEN')
      ).reduce((acc, k) => {
        acc[k] = process.env[k];
        return acc;
      }, {});

    } catch (e) {
      evidence.data.error = e.message;
    }

    this.addEvidence(caseObj, evidence);
  }

  /**
   * Add evidence to case
   * @param {Object} caseObj
   * @param {Object} evidence
   */
  addEvidence(caseObj, evidence) {
    // Hash evidence
    evidence.hash = crypto.createHash('sha256')
      .update(JSON.stringify(evidence))
      .digest('hex')
      .slice(0, 16);

    // Add to case
    caseObj.evidence.push(evidence);
    caseObj.timeline.push({
      time: Date.now(),
      action: `Evidence collected: ${evidence.type}`,
      hash: evidence.hash
    });

    // Write to disk
    const evidenceFile = path.join(caseObj.path, `evidence_${evidence.hash}.json`);
    fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2));

    console.log(`[FORENSICS] Evidence collected: ${evidence.type} (${evidence.hash})`);
  }

  /**
   * Add note to case
   * @param {string} caseId
   * @param {string} note
   */
  addNote(caseId, note) {
    const caseObj = this.cases.get(caseId);
    if (!caseObj) return;

    caseObj.timeline.push({
      time: Date.now(),
      action: 'Note added',
      note
    });

    this.saveCase(caseObj);
  }

  /**
   * Close case
   * @param {string} caseId
   * @param {string} resolution
   * @returns {Object}
   */
  closeCase(caseId, resolution) {
    const caseObj = this.cases.get(caseId);
    if (!caseObj) return null;

    caseObj.status = 'CLOSED';
    caseObj.closed = Date.now();
    caseObj.resolution = resolution;

    caseObj.timeline.push({
      time: Date.now(),
      action: 'Case closed',
      resolution
    });

    this.saveCase(caseObj);

    return caseObj;
  }

  /**
   * Save case to disk
   * @param {Object} caseObj
   */
  saveCase(caseObj) {
    const caseFile = path.join(caseObj.path, 'case.json');
    fs.writeFileSync(caseFile, JSON.stringify({
      ...caseObj,
      evidence: caseObj.evidence.map(e => ({ type: e.type, hash: e.hash }))
    }, null, 2));
  }

  /**
   * Get case
   * @param {string} caseId
   * @returns {Object|null}
   */
  getCase(caseId) {
    return this.cases.get(caseId) || null;
  }

  /**
   * List all cases
   * @returns {Array}
   */
  listCases() {
    return [...this.cases.values()].map(c => ({
      id: c.id,
      status: c.status,
      threat: c.threat.type,
      opened: new Date(c.opened).toISOString(),
      evidenceCount: c.evidence.length
    }));
  }

  /**
   * Generate case report
   * @param {string} caseId
   * @returns {string}
   */
  generateReport(caseId) {
    const caseObj = this.cases.get(caseId);
    if (!caseObj) return 'Case not found';

    let report = `
╔════════════════════════════════════════════════════════════════╗
║                    FORENSIC CASE REPORT                        ║
╠════════════════════════════════════════════════════════════════╣
║ Case ID: ${caseObj.id.padEnd(52)}║
║ Status: ${caseObj.status.padEnd(53)}║
║ Opened: ${new Date(caseObj.opened).toISOString().padEnd(53)}║
${caseObj.closed ? `║ Closed: ${new Date(caseObj.closed).toISOString().padEnd(53)}║\n` : ''}╠════════════════════════════════════════════════════════════════╣
║ THREAT DETAILS                                                 ║
╠════════════════════════════════════════════════════════════════╣
║ Type: ${caseObj.threat.type.padEnd(55)}║
║ Message: ${caseObj.threat.message.slice(0, 52).padEnd(52)}║
╠════════════════════════════════════════════════════════════════╣
║ EVIDENCE (${caseObj.evidence.length} items)                                          ║
╠════════════════════════════════════════════════════════════════╣
`;

    for (const ev of caseObj.evidence) {
      report += `║ [${ev.type.padEnd(12)}] ${ev.hash.padEnd(45)}║\n`;
    }

    report += `╠════════════════════════════════════════════════════════════════╣
║ TIMELINE                                                       ║
╠════════════════════════════════════════════════════════════════╣
`;

    for (const event of caseObj.timeline.slice(-10)) {
      const time = new Date(event.time).toISOString().slice(11, 19);
      report += `║ ${time} │ ${event.action.slice(0, 48).padEnd(48)}║\n`;
    }

    if (caseObj.resolution) {
      report += `╠════════════════════════════════════════════════════════════════╣
║ RESOLUTION: ${caseObj.resolution.slice(0, 48).padEnd(48)}║
`;
    }

    report += `╚════════════════════════════════════════════════════════════════╝`;

    return report;
  }

  /**
   * Clean old cases
   * @returns {number} Number of cases cleaned
   */
  cleanup() {
    let cleaned = 0;
    const now = Date.now();

    for (const [id, caseObj] of this.cases) {
      if (caseObj.status === 'CLOSED' && now - caseObj.closed > this.maxEvidenceAge) {
        // Remove case directory
        try {
          fs.rmSync(caseObj.path, { recursive: true });
        } catch {}
        this.cases.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }
}

module.exports = { ForensicsCollector };
