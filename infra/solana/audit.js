/**
 * GentlyOS Nervous System
 * Every thought hashed. Every step valued. IPFS + Solana anchored.
 *
 * Chain of Thought Structure:
 * - Problem (labeled)
 * - Steps (each with contribution value)
 * - Solution (labeled)
 * - Total chain value = 100
 */

const crypto = require('crypto');
const { execSync } = require('child_process');

class NervousSystem {
  constructor() {
    this.chains = new Map();       // chainId → ChainOfThought
    this.hashes = new Map();       // hash → { ipfs, solana, data }
    this.ipfsGateway = 'https://ipfs.io/ipfs/';
    this.solanaEndpoint = 'https://api.devnet.solana.com';
  }

  /**
   * Start a new Chain of Thought
   * @param {string} problem - The problem being solved
   * @returns {ChainOfThought}
   */
  startChain(problem) {
    const chain = new ChainOfThought(problem, this);
    this.chains.set(chain.id, chain);
    return chain;
  }

  /**
   * Hash any data
   * @param {any} data
   * @returns {string}
   */
  hash(data) {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  /**
   * Push to IPFS
   * @param {any} data
   * @returns {Promise<string>} IPFS CID
   */
  async pushToIPFS(data) {
    const content = typeof data === 'string' ? data : JSON.stringify(data);

    try {
      // Try local IPFS daemon
      const result = execSync(`echo '${content.replace(/'/g, "\\'")}' | ipfs add -q`, {
        encoding: 'utf-8',
        timeout: 10000
      }).trim();

      return result;
    } catch {
      // Fallback: hash as pseudo-CID
      const hash = this.hash(content);
      console.log(`[IPFS] Offline - using local hash: ${hash.slice(0, 12)}...`);
      return `Qm${hash.slice(0, 44)}`; // Pseudo-CID format
    }
  }

  /**
   * Anchor to Solana
   * @param {string} hash
   * @param {string} ipfsCid
   * @returns {Promise<string>} Transaction hash
   */
  async anchorToSolana(hash, ipfsCid) {
    // In production: actual Solana transaction
    // For now: simulated
    const txHash = this.hash(`${hash}:${ipfsCid}:${Date.now()}`);
    console.log(`[SOLANA] Anchored ${hash.slice(0, 8)} → ${txHash.slice(0, 8)}`);
    return txHash;
  }

  /**
   * Store and anchor data
   * @param {any} data
   * @returns {Promise<Object>}
   */
  async store(data) {
    const hash = this.hash(data);
    const ipfsCid = await this.pushToIPFS(data);
    const solanaTx = await this.anchorToSolana(hash, ipfsCid);

    const record = {
      hash,
      ipfs: ipfsCid,
      solana: solanaTx,
      timestamp: Date.now(),
      data
    };

    this.hashes.set(hash, record);
    return record;
  }

  /**
   * Get chain by ID
   * @param {string} id
   * @returns {ChainOfThought|null}
   */
  getChain(id) {
    return this.chains.get(id) || null;
  }

  /**
   * Get all completed chains
   * @returns {Array}
   */
  getCompletedChains() {
    return [...this.chains.values()].filter(c => c.completed);
  }

  /**
   * Export all hashes
   * @returns {Object}
   */
  exportHashes() {
    return Object.fromEntries(this.hashes);
  }
}

/**
 * Chain of Thought
 * Tracks reasoning from problem to solution with step values
 */
class ChainOfThought {
  constructor(problem, nervousSystem) {
    this.id = crypto.randomBytes(8).toString('hex');
    this.ns = nervousSystem;

    this.problem = {
      text: problem,
      hash: this.ns.hash(problem),
      timestamp: Date.now()
    };

    this.steps = [];           // Each step with value
    this.solution = null;
    this.completed = false;
    this.totalValue = 100;     // Total chain value

    // Hash and store problem
    this.ns.store({
      type: 'problem',
      chainId: this.id,
      ...this.problem
    });
  }

  /**
   * Add a reasoning step
   * @param {string} thought - The reasoning step
   * @param {number} value - Contribution value (0-100)
   * @param {Object} metadata - Additional info
   * @returns {Object} The step
   */
  async addStep(thought, value, metadata = {}) {
    const step = {
      index: this.steps.length,
      thought,
      value,
      hash: this.ns.hash(thought),
      timestamp: Date.now(),
      metadata,
      cumulativeValue: this.getCumulativeValue() + value
    };

    this.steps.push(step);

    // Hash and store step
    await this.ns.store({
      type: 'step',
      chainId: this.id,
      problemHash: this.problem.hash,
      ...step
    });

    console.log(`[COT] Step ${step.index}: "${thought.slice(0, 30)}..." (value: ${value})`);

    return step;
  }

  /**
   * Complete the chain with a solution
   * @param {string} solution - The final solution
   * @returns {Object} Complete chain summary
   */
  async complete(solution) {
    // Calculate remaining value for solution
    const stepsValue = this.getCumulativeValue();
    const solutionValue = this.totalValue - stepsValue;

    this.solution = {
      text: solution,
      hash: this.ns.hash(solution),
      value: solutionValue,
      timestamp: Date.now()
    };

    this.completed = true;

    // Normalize step values to ensure total = 100
    this.normalizeValues();

    // Store complete chain
    const chainRecord = await this.ns.store({
      type: 'chain_complete',
      chainId: this.id,
      problem: this.problem,
      steps: this.steps,
      solution: this.solution,
      totalValue: this.totalValue,
      stepCount: this.steps.length
    });

    console.log(`[COT] Chain complete: ${this.steps.length} steps, solution value: ${solutionValue}`);

    return {
      chainId: this.id,
      ipfs: chainRecord.ipfs,
      solana: chainRecord.solana,
      problem: this.problem.text,
      solution: this.solution.text,
      steps: this.steps.map(s => ({ thought: s.thought, value: s.value })),
      breakdown: this.getBreakdown()
    };
  }

  /**
   * Get cumulative value of all steps
   * @returns {number}
   */
  getCumulativeValue() {
    return this.steps.reduce((sum, s) => sum + s.value, 0);
  }

  /**
   * Normalize values to ensure total = 100
   */
  normalizeValues() {
    const total = this.getCumulativeValue() + (this.solution?.value || 0);

    if (total !== this.totalValue) {
      const factor = this.totalValue / total;

      for (const step of this.steps) {
        step.value = Math.round(step.value * factor);
      }

      if (this.solution) {
        this.solution.value = this.totalValue - this.getCumulativeValue();
      }
    }
  }

  /**
   * Get value breakdown
   * @returns {Object}
   */
  getBreakdown() {
    const breakdown = {
      problem: { label: 'Problem', value: 0 },
      steps: this.steps.map((s, i) => ({
        label: `Step ${i + 1}`,
        thought: s.thought.slice(0, 50),
        value: s.value,
        percentage: `${s.value}%`
      })),
      solution: {
        label: 'Solution',
        value: this.solution?.value || 0,
        percentage: `${this.solution?.value || 0}%`
      },
      total: this.totalValue
    };

    return breakdown;
  }

  /**
   * Get chain as linked hashes
   * @returns {Array}
   */
  getHashChain() {
    const chain = [this.problem.hash];

    for (const step of this.steps) {
      chain.push(step.hash);
    }

    if (this.solution) {
      chain.push(this.solution.hash);
    }

    return chain;
  }

  /**
   * Visualize chain
   * @returns {string}
   */
  visualize() {
    let viz = `\n╔══ CHAIN OF THOUGHT: ${this.id} ══╗\n`;
    viz += `║ PROBLEM: ${this.problem.text.slice(0, 40)}...\n`;
    viz += `╠══════════════════════════════════════════╣\n`;

    for (const step of this.steps) {
      const bar = '█'.repeat(Math.floor(step.value / 5));
      viz += `║ [${step.value.toString().padStart(2)}%] ${bar.padEnd(20)} ${step.thought.slice(0, 20)}...\n`;
    }

    if (this.solution) {
      viz += `╠══════════════════════════════════════════╣\n`;
      const bar = '█'.repeat(Math.floor(this.solution.value / 5));
      viz += `║ [${this.solution.value.toString().padStart(2)}%] ${bar.padEnd(20)} SOLUTION\n`;
      viz += `║ ${this.solution.text.slice(0, 40)}...\n`;
    }

    viz += `╚══════════════════════════════════════════╝\n`;
    viz += `Total: ${this.totalValue}% | Steps: ${this.steps.length} | Hashes: ${this.getHashChain().length}\n`;

    return viz;
  }
}

module.exports = { NervousSystem, ChainOfThought };
