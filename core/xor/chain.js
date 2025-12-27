/**
 * GentlyOS XOR Temporal Chain
 * Links every state change through XOR chains
 *
 * XOR Key = sha256(state)[:8] ^ timestamp ^ previous_xor
 * Output: 3-char hex (e.g., "A7F", "B3C")
 */

const crypto = require('crypto');

class XORChain {
  constructor() {
    this.chain = [];
    this.current = '000';  // Genesis
  }

  /**
   * Generate XOR key for a state
   * @param {Object|string} state - Current state
   * @param {number} timestamp - Unix timestamp (optional)
   * @returns {string} 3-char hex XOR key
   */
  generate(state, timestamp = Date.now()) {
    // Hash the state
    const stateStr = typeof state === 'string' ? state : JSON.stringify(state);
    const hash = crypto.createHash('sha256').update(stateStr).digest('hex');

    // Take first 8 chars of hash
    const contentComponent = parseInt(hash.slice(0, 8), 16);

    // Time component (last 12 bits of timestamp)
    const timeComponent = timestamp & 0xFFF;

    // Previous XOR
    const prevComponent = parseInt(this.current, 16);

    // XOR all components
    const xorKey = (contentComponent ^ timeComponent ^ prevComponent) & 0xFFF;

    // Format as 3-char hex
    const newXOR = xorKey.toString(16).toUpperCase().padStart(3, '0');

    // Store in chain
    this.chain.push({
      xor: newXOR,
      prev: this.current,
      timestamp,
      stateHash: hash.slice(0, 16)
    });

    this.current = newXOR;
    return newXOR;
  }

  /**
   * Get the current XOR key
   * @returns {string}
   */
  getCurrent() {
    return this.current;
  }

  /**
   * Get the full chain
   * @returns {Array}
   */
  getChain() {
    return this.chain;
  }

  /**
   * Get chain as string (e.g., "A7F → B3C → D8A")
   * @returns {string}
   */
  toString() {
    return this.chain.map(c => c.xor).join(' → ');
  }

  /**
   * Verify chain integrity
   * @returns {boolean}
   */
  verify() {
    let prev = '000';
    for (const link of this.chain) {
      if (link.prev !== prev) {
        return false;
      }
      prev = link.xor;
    }
    return true;
  }

  /**
   * Fork chain from a specific XOR point
   * @param {string} xor - XOR key to fork from
   * @returns {XORChain} New chain starting from that point
   */
  fork(xor) {
    const idx = this.chain.findIndex(c => c.xor === xor);
    if (idx === -1) throw new Error(`XOR ${xor} not found in chain`);

    const forked = new XORChain();
    forked.chain = this.chain.slice(0, idx + 1);
    forked.current = xor;
    return forked;
  }

  /**
   * Serialize chain to JSON
   * @returns {string}
   */
  serialize() {
    return JSON.stringify({
      current: this.current,
      chain: this.chain
    });
  }

  /**
   * Deserialize from JSON
   * @param {string} json
   * @returns {XORChain}
   */
  static deserialize(json) {
    const data = JSON.parse(json);
    const chain = new XORChain();
    chain.current = data.current;
    chain.chain = data.chain;
    return chain;
  }

  /**
   * Get link by XOR key
   * @param {string} xor
   * @returns {Object|null}
   */
  getLink(xor) {
    return this.chain.find(c => c.xor === xor) || null;
  }

  /**
   * Get chain length
   * @returns {number}
   */
  get length() {
    return this.chain.length;
  }
}

/**
 * Generate a single XOR key (stateless)
 * @param {Object|string} state
 * @param {number} timestamp
 * @param {string} previousXOR
 * @returns {string}
 */
function generateXOR(state, timestamp = Date.now(), previousXOR = '000') {
  const stateStr = typeof state === 'string' ? state : JSON.stringify(state);
  const hash = crypto.createHash('sha256').update(stateStr).digest('hex');

  const contentComponent = parseInt(hash.slice(0, 8), 16);
  const timeComponent = timestamp & 0xFFF;
  const prevComponent = parseInt(previousXOR, 16);

  const xorKey = (contentComponent ^ timeComponent ^ prevComponent) & 0xFFF;
  return xorKey.toString(16).toUpperCase().padStart(3, '0');
}

/**
 * Diff two XOR keys to get transition info
 * @param {string} from
 * @param {string} to
 * @returns {Object}
 */
function diffXOR(from, to) {
  const fromInt = parseInt(from, 16);
  const toInt = parseInt(to, 16);
  return {
    from,
    to,
    delta: (toInt ^ fromInt).toString(16).toUpperCase().padStart(3, '0'),
    direction: toInt > fromInt ? 'forward' : 'backward'
  };
}

module.exports = {
  XORChain,
  generateXOR,
  diffXOR
};
