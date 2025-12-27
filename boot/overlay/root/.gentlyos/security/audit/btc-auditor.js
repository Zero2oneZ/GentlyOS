/**
 * GentlyOS BTC Event Auditor
 *
 * EVERY OS event is audited with BTC block + timestamp
 *
 * Events:
 * - FILE_CREATE, FILE_MODIFY, FILE_DELETE, FILE_ACCESS
 * - WALLET_MINT, TOKEN_TRANSFER
 * - USER_REGISTER, USER_LOGIN
 * - BOOT, SHUTDOWN
 *
 * Values justify privileges - all actions are recorded
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const GENESIS_DIR = process.env.GENTLYOS_GENESIS || '/root/.gentlyos/genesis';
const AUDIT_DIR = '/root/.gentlyos/audit';
const AUDIT_FILE = path.join(AUDIT_DIR, 'chain.jsonl');
const BTC_API = 'https://blockchain.info/latestblock';

// Ensure audit directory exists
if (!fs.existsSync(AUDIT_DIR)) {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
}

// Colors
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

function log(msg) { console.log(`${colors.green}[AUDIT]${colors.reset} ${msg}`); }
function warn(msg) { console.log(`${colors.yellow}[AUDIT]${colors.reset} ${msg}`); }
function error(msg) { console.error(`${colors.red}[AUDIT]${colors.reset} ${msg}`); }

/**
 * Fetch current BTC block
 */
async function fetchBtcBlock() {
  return new Promise((resolve, reject) => {
    https.get(BTC_API, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const block = JSON.parse(data);
          resolve({
            hash: block.hash,
            height: block.height,
            time: block.time
          });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Get cached BTC block (for rapid events)
 */
let cachedBlock = null;
let cacheExpiry = 0;
const CACHE_TTL = 60000; // 1 minute

async function getBtcBlock() {
  const now = Date.now();
  if (cachedBlock && now < cacheExpiry) {
    return cachedBlock;
  }

  try {
    cachedBlock = await fetchBtcBlock();
    cacheExpiry = now + CACHE_TTL;
    return cachedBlock;
  } catch (e) {
    // Use last known block
    if (cachedBlock) {
      warn('Using cached BTC block');
      return cachedBlock;
    }
    // Load from genesis
    try {
      const genesis = JSON.parse(fs.readFileSync(path.join(GENESIS_DIR, 'btc-genesis.json'), 'utf-8'));
      return {
        hash: genesis.btc_block_hash,
        height: genesis.btc_block_height,
        time: genesis.unix_timestamp
      };
    } catch {
      error('No BTC block available');
      return { hash: 'UNAVAILABLE', height: 0, time: 0 };
    }
  }
}

/**
 * BTCAuditor class
 */
class BTCAuditor {
  constructor() {
    this.prevAuditCid = this.loadLastCid();
  }

  /**
   * Load last audit CID for chain linkage
   */
  loadLastCid() {
    if (!fs.existsSync(AUDIT_FILE)) {
      return 'GENESIS';
    }

    try {
      const lines = fs.readFileSync(AUDIT_FILE, 'utf-8').trim().split('\n');
      if (lines.length > 0 && lines[lines.length - 1]) {
        const lastRecord = JSON.parse(lines[lines.length - 1]);
        return lastRecord.audit_cid || 'GENESIS';
      }
    } catch {
      return 'GENESIS';
    }

    return 'GENESIS';
  }

  /**
   * Generate audit CID
   */
  generateCid(content) {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return `QmAUDIT${hash.slice(0, 38)}`;
  }

  /**
   * Record an audit event
   *
   * @param {string} eventType - Event type
   * @param {string} target - Target path/ID
   * @param {string|object} actor - Actor wallet/user
   * @param {object} metadata - Additional metadata
   */
  async audit(eventType, target, actor, metadata = {}) {
    const btc = await getBtcBlock();

    const record = {
      event_type: eventType,
      target: target,
      actor: typeof actor === 'object' ? actor.address || actor.id : actor,
      btc_block_hash: btc.hash,
      btc_block_height: btc.height,
      unix_timestamp: Date.now(),
      prev_audit_cid: this.prevAuditCid,
      metadata: metadata
    };

    // Generate signature/hash
    const content = JSON.stringify(record);
    record.signature = crypto.createHash('sha256')
      .update(`${eventType}${btc.hash}${record.unix_timestamp}${this.prevAuditCid}`)
      .digest('hex');

    // Generate CID
    record.audit_cid = this.generateCid(content);

    // Append to audit chain
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(record) + '\n');

    // Update chain head
    this.prevAuditCid = record.audit_cid;

    log(`${eventType}: ${target}`);

    return record;
  }

  /**
   * Audit file event
   */
  async auditFile(eventType, filePath, actor, metadata = {}) {
    const validTypes = ['FILE_CREATE', 'FILE_MODIFY', 'FILE_DELETE', 'FILE_ACCESS'];
    if (!validTypes.includes(eventType)) {
      error(`Invalid file event type: ${eventType}`);
      return null;
    }

    // Add file metadata
    try {
      const stats = fs.statSync(filePath);
      metadata.size = stats.size;
      metadata.mtime = stats.mtime.toISOString();
    } catch {
      // File may not exist for DELETE
    }

    return this.audit(eventType, filePath, actor, metadata);
  }

  /**
   * Audit wallet event
   */
  async auditWallet(eventType, walletAddress, actor, metadata = {}) {
    const validTypes = ['WALLET_MINT', 'TOKEN_TRANSFER'];
    if (!validTypes.includes(eventType)) {
      error(`Invalid wallet event type: ${eventType}`);
      return null;
    }

    return this.audit(eventType, walletAddress, actor, metadata);
  }

  /**
   * Audit user event
   */
  async auditUser(eventType, userId, actor, metadata = {}) {
    const validTypes = ['USER_REGISTER', 'USER_LOGIN', 'USER_LOGOUT', 'USER_PRIVILEGE_CHANGE'];
    if (!validTypes.includes(eventType)) {
      error(`Invalid user event type: ${eventType}`);
      return null;
    }

    return this.audit(eventType, userId, actor, metadata);
  }

  /**
   * Audit system event
   */
  async auditSystem(eventType, metadata = {}) {
    const validTypes = ['BOOT', 'SHUTDOWN', 'CHECKPOINT', 'CONFIG_CHANGE'];
    if (!validTypes.includes(eventType)) {
      error(`Invalid system event type: ${eventType}`);
      return null;
    }

    return this.audit(eventType, 'SYSTEM', 'SYSTEM', metadata);
  }

  /**
   * Get audit chain
   */
  getChain() {
    if (!fs.existsSync(AUDIT_FILE)) {
      return [];
    }

    return fs.readFileSync(AUDIT_FILE, 'utf-8')
      .trim()
      .split('\n')
      .filter(line => line)
      .map(line => JSON.parse(line));
  }

  /**
   * Get events by type
   */
  getByType(eventType) {
    return this.getChain().filter(r => r.event_type === eventType);
  }

  /**
   * Get events for target
   */
  getByTarget(target) {
    return this.getChain().filter(r => r.target === target);
  }

  /**
   * Get events by actor
   */
  getByActor(actor) {
    return this.getChain().filter(r => r.actor === actor);
  }

  /**
   * Get events in BTC block range
   */
  getByBlockRange(startHeight, endHeight) {
    return this.getChain().filter(r =>
      r.btc_block_height >= startHeight && r.btc_block_height <= endHeight
    );
  }

  /**
   * Verify audit chain integrity
   */
  verifyIntegrity() {
    const chain = this.getChain();
    const errors = [];
    let prevCid = 'GENESIS';

    for (let i = 0; i < chain.length; i++) {
      const record = chain[i];

      // Check chain linkage
      if (record.prev_audit_cid !== prevCid) {
        errors.push({
          index: i,
          error: 'Chain linkage broken',
          expected: prevCid,
          actual: record.prev_audit_cid
        });
      }

      // Verify signature
      const expectedSig = crypto.createHash('sha256')
        .update(`${record.event_type}${record.btc_block_hash}${record.unix_timestamp}${record.prev_audit_cid}`)
        .digest('hex');

      if (record.signature !== expectedSig) {
        errors.push({
          index: i,
          error: 'Signature mismatch',
          expected: expectedSig,
          actual: record.signature
        });
      }

      prevCid = record.audit_cid;
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      length: chain.length,
      head: this.prevAuditCid
    };
  }

  /**
   * Generate audit report
   */
  generateReport(startTime = 0, endTime = Date.now()) {
    const chain = this.getChain().filter(r =>
      r.unix_timestamp >= startTime && r.unix_timestamp <= endTime
    );

    const report = {
      generated_at: new Date().toISOString(),
      period: {
        start: new Date(startTime).toISOString(),
        end: new Date(endTime).toISOString()
      },
      total_events: chain.length,
      events_by_type: {},
      events_by_actor: {},
      btc_block_range: {
        start: chain.length > 0 ? chain[0].btc_block_height : 0,
        end: chain.length > 0 ? chain[chain.length - 1].btc_block_height : 0
      }
    };

    for (const record of chain) {
      // Count by type
      report.events_by_type[record.event_type] =
        (report.events_by_type[record.event_type] || 0) + 1;

      // Count by actor
      report.events_by_actor[record.actor] =
        (report.events_by_actor[record.actor] || 0) + 1;
    }

    return report;
  }
}

/**
 * Singleton instance
 */
let instance = null;

function getAuditor() {
  if (!instance) {
    instance = new BTCAuditor();
  }
  return instance;
}

// Export
module.exports = {
  BTCAuditor,
  getAuditor,
  getBtcBlock,
  fetchBtcBlock
};

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  const auditor = getAuditor();

  (async () => {
    switch (command) {
      case 'verify':
        const result = auditor.verifyIntegrity();
        console.log(JSON.stringify(result, null, 2));
        break;

      case 'report':
        const report = auditor.generateReport();
        console.log(JSON.stringify(report, null, 2));
        break;

      case 'tail':
        const chain = auditor.getChain();
        const last10 = chain.slice(-10);
        for (const r of last10) {
          console.log(`${r.event_type}: ${r.target} @ ${r.btc_block_height}`);
        }
        break;

      default:
        console.log(`
GentlyOS BTC Auditor

Usage:
  btc-auditor.js verify   Verify chain integrity
  btc-auditor.js report   Generate audit report
  btc-auditor.js tail     Show last 10 events
`);
    }
  })();
}
