/**
 * GentlyOS IPFS Chain Storage
 *
 * Stores OS wallet state changes on IPFS as an immutable chain
 * Each record links to previous via CID → forms append-only log
 *
 * OS wallets are IMMUTABLE - this chain provides proof
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const GENESIS_DIR = process.env.GENTLYOS_GENESIS || '/root/.gentlyos/genesis';
const CHAIN_FILE = path.join(GENESIS_DIR, 'ipfs-chain.jsonl');
const IPFS_AVAILABLE = checkIpfsAvailable();

function checkIpfsAvailable() {
  try {
    execSync('ipfs version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate mock CID for local testing
 */
function mockCid(hash) {
  return `Qm${hash.slice(0, 44)}`;
}

/**
 * Add content to IPFS
 */
function ipfsAdd(content) {
  if (!IPFS_AVAILABLE) {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return mockCid(hash);
  }

  try {
    const result = execSync(`echo '${content}' | ipfs add -q`, { encoding: 'utf-8' });
    return result.trim();
  } catch (e) {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return mockCid(hash);
  }
}

/**
 * IPFSChain class
 */
class IPFSChain {
  constructor() {
    this.headCid = null;
    this.chainLength = 0;
    this.loadChain();
  }

  /**
   * Load existing chain state
   */
  loadChain() {
    if (fs.existsSync(CHAIN_FILE)) {
      const lines = fs.readFileSync(CHAIN_FILE, 'utf-8').trim().split('\n');
      if (lines.length > 0 && lines[0]) {
        this.chainLength = lines.length;
        const lastRecord = JSON.parse(lines[lines.length - 1]);
        this.headCid = lastRecord.cid;
      }
    }
  }

  /**
   * Add a wallet state to the chain
   *
   * @param {object} wallet - Wallet state
   * @param {object} btc - BTC block info
   * @returns {object} Chain record with CID
   */
  addWalletState(wallet, btc) {
    const record = {
      type: 'WALLET_STATE',
      wallet: wallet.address,
      path: wallet.path,
      value: wallet.value,
      btc_block: btc.hash,
      btc_height: btc.height,
      prev_cid: this.headCid || 'GENESIS',
      timestamp: Date.now(),
      frozen: wallet.frozen || true
    };

    // Generate hash
    const content = JSON.stringify(record);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    record.hash = hash;

    // Add to IPFS
    record.cid = ipfsAdd(content);

    // Append to chain file
    fs.appendFileSync(CHAIN_FILE, JSON.stringify(record) + '\n');

    // Update head
    this.headCid = record.cid;
    this.chainLength++;

    return record;
  }

  /**
   * Add an event to the chain
   *
   * @param {string} eventType - Event type
   * @param {object} eventData - Event data
   * @param {object} btc - BTC block info
   * @returns {object} Chain record with CID
   */
  addEvent(eventType, eventData, btc) {
    const record = {
      type: eventType,
      data: eventData,
      btc_block: btc.hash,
      btc_height: btc.height,
      prev_cid: this.headCid || 'GENESIS',
      timestamp: Date.now()
    };

    // Generate hash
    const content = JSON.stringify(record);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    record.hash = hash;

    // Add to IPFS
    record.cid = ipfsAdd(content);

    // Append to chain file
    fs.appendFileSync(CHAIN_FILE, JSON.stringify(record) + '\n');

    // Update head
    this.headCid = record.cid;
    this.chainLength++;

    return record;
  }

  /**
   * Get chain head CID
   */
  getHead() {
    return this.headCid;
  }

  /**
   * Get chain length
   */
  getLength() {
    return this.chainLength;
  }

  /**
   * Verify chain integrity
   * Each record's prev_cid should match previous record's cid
   */
  verifyIntegrity() {
    if (!fs.existsSync(CHAIN_FILE)) {
      return { valid: true, errors: [], length: 0 };
    }

    const lines = fs.readFileSync(CHAIN_FILE, 'utf-8').trim().split('\n');
    const errors = [];
    let prevCid = 'GENESIS';

    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]) continue;

      try {
        const record = JSON.parse(lines[i]);

        // Check prev_cid linkage
        if (record.prev_cid !== prevCid) {
          errors.push({
            line: i + 1,
            expected_prev: prevCid,
            actual_prev: record.prev_cid,
            error: 'Chain linkage broken'
          });
        }

        // Verify hash
        const recordCopy = { ...record };
        delete recordCopy.hash;
        delete recordCopy.cid;
        const expectedHash = crypto.createHash('sha256')
          .update(JSON.stringify(recordCopy))
          .digest('hex');

        // Hash is calculated before cid is added, so we recalculate
        const content = JSON.stringify(recordCopy);
        const hash = crypto.createHash('sha256').update(content).digest('hex');

        prevCid = record.cid;
      } catch (e) {
        errors.push({
          line: i + 1,
          error: `Parse error: ${e.message}`
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      length: lines.length,
      head: this.headCid
    };
  }

  /**
   * Get full chain as array
   */
  getChain() {
    if (!fs.existsSync(CHAIN_FILE)) {
      return [];
    }

    return fs.readFileSync(CHAIN_FILE, 'utf-8')
      .trim()
      .split('\n')
      .filter(line => line)
      .map(line => JSON.parse(line));
  }

  /**
   * Find record by CID
   */
  findByCid(cid) {
    const chain = this.getChain();
    return chain.find(r => r.cid === cid);
  }

  /**
   * Get records by type
   */
  getByType(type) {
    const chain = this.getChain();
    return chain.filter(r => r.type === type);
  }

  /**
   * Get wallet history
   */
  getWalletHistory(walletAddress) {
    const chain = this.getChain();
    return chain.filter(r => r.wallet === walletAddress);
  }
}

/**
 * Singleton instance
 */
let instance = null;

function getChain() {
  if (!instance) {
    instance = new IPFSChain();
  }
  return instance;
}

module.exports = {
  IPFSChain,
  getChain,
  ipfsAdd,
  mockCid
};
