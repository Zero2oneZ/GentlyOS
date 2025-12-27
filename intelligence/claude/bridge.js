/**
 * GentlyOS Claude Bridge
 * Integrates with Claude Code CLI for complex reasoning
 * Handles 10% of interactions (the hard stuff)
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class ClaudeBridge {
  constructor(options = {}) {
    this.available = false;
    this.cache = new Map();
    this.cacheExpiry = options.cacheExpiry || 3600000; // 1 hour
    this.requestCount = 0;
    this.totalCost = 0;
    this.costPerRequest = 0.01;

    this.checkAvailability();
  }

  /**
   * Check if Claude CLI is available
   */
  checkAvailability() {
    try {
      execSync('claude --version', { stdio: 'pipe' });
      this.available = true;
      console.log('[Claude] CLI available');
    } catch (e) {
      this.available = false;
      console.log('[Claude] CLI not available - complex requests will fail');
    }
  }

  /**
   * Query Claude with a prompt
   * @param {string} prompt
   * @param {Object} context
   * @returns {Promise<string>}
   */
  async query(prompt, context = {}) {
    if (!this.available) {
      throw new Error('Claude CLI not available');
    }

    // Check cache
    const cacheKey = this.getCacheKey(prompt, context);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.response;
    }

    // Build full prompt with context
    const fullPrompt = this.buildPrompt(prompt, context);

    // Call Claude CLI
    const response = await this.callCLI(fullPrompt);

    // Cache response
    this.cache.set(cacheKey, {
      response,
      timestamp: Date.now()
    });

    // Track usage
    this.requestCount++;
    this.totalCost += this.costPerRequest;

    return response;
  }

  /**
   * Build prompt with GentlyOS context
   * @param {string} prompt
   * @param {Object} context
   * @returns {string}
   */
  buildPrompt(prompt, context) {
    let fullPrompt = `You are the AI brain of GentlyOS, a self-evolving operating system.

Current context:
- Current state: ${context.state || 'unknown'}
- XOR chain: ${context.xorChain || 'N/A'}
- User intent: ${context.intent || 'unknown'}
- Request type: ${context.type || 'general'}

`;

    if (context.type === 'redesign') {
      fullPrompt += `Generate CODIE mutations for this redesign request.
Output format: MUT{primitive:{changes}}

`;
    } else if (context.type === 'analyze') {
      fullPrompt += `Analyze the following and provide insights.
Be concise and actionable.

`;
    } else if (context.type === 'threat') {
      fullPrompt += `This is a security analysis request.
Identify threats and recommend actions.

`;
    }

    fullPrompt += `User request: ${prompt}`;

    return fullPrompt;
  }

  /**
   * Call Claude CLI
   * @param {string} prompt
   * @returns {Promise<string>}
   */
  async callCLI(prompt) {
    return new Promise((resolve, reject) => {
      const child = spawn('claude', ['--print'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });

      child.on('close', code => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(stderr || `Claude exited with code ${code}`));
        }
      });

      child.on('error', reject);

      // Send prompt
      child.stdin.write(prompt);
      child.stdin.end();

      // Timeout after 60 seconds
      setTimeout(() => {
        child.kill();
        reject(new Error('Claude request timed out'));
      }, 60000);
    });
  }

  /**
   * Generate cache key
   * @param {string} prompt
   * @param {Object} context
   * @returns {string}
   */
  getCacheKey(prompt, context) {
    const crypto = require('crypto');
    const data = JSON.stringify({ prompt, context });
    return crypto.createHash('md5').update(data).digest('hex');
  }

  /**
   * Handle redesign request
   * @param {string} request - Natural language redesign request
   * @param {Object} currentState - Current CODIE state
   * @returns {Promise<Object>} Mutations to apply
   */
  async redesign(request, currentState) {
    const response = await this.query(request, {
      type: 'redesign',
      state: JSON.stringify(currentState)
    });

    // Parse mutations from response
    const mutations = this.parseMutations(response);
    return mutations;
  }

  /**
   * Parse CODIE mutations from Claude response
   * @param {string} response
   * @returns {Array}
   */
  parseMutations(response) {
    const mutations = [];
    const mutRegex = /MUT\{([^}]+)\}/g;
    let match;

    while ((match = mutRegex.exec(response)) !== null) {
      mutations.push({
        raw: match[0],
        content: match[1]
      });
    }

    return mutations;
  }

  /**
   * Analyze data with Claude
   * @param {Object} data
   * @param {string} question
   * @returns {Promise<string>}
   */
  async analyze(data, question) {
    return this.query(question, {
      type: 'analyze',
      state: JSON.stringify(data)
    });
  }

  /**
   * Threat analysis
   * @param {Object} evidence
   * @returns {Promise<Object>}
   */
  async analyzeThreat(evidence) {
    const response = await this.query(
      'Analyze this evidence for security threats',
      {
        type: 'threat',
        state: JSON.stringify(evidence)
      }
    );

    return {
      analysis: response,
      timestamp: Date.now()
    };
  }

  /**
   * Generate training data for tiny model
   * @param {Array} interactions - Recent interactions
   * @returns {Promise<Array>} JSONL training data
   */
  async generateTrainingData(interactions) {
    const prompt = `Based on these user interactions, generate JSONL training data for pattern matching.

Interactions:
${JSON.stringify(interactions, null, 2)}

Output format (one JSON per line):
{"prompt": "action+context", "completion": "MUT{...}"}`;

    const response = await this.query(prompt, { type: 'training' });

    // Parse JSONL
    const lines = response.split('\n').filter(l => l.startsWith('{'));
    return lines.map(l => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  /**
   * Get usage statistics
   * @returns {Object}
   */
  getStats() {
    return {
      available: this.available,
      requests: this.requestCount,
      totalCost: this.totalCost.toFixed(2),
      cacheSize: this.cache.size,
      avgCost: this.requestCount ? (this.totalCost / this.requestCount).toFixed(4) : 0
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = { ClaudeBridge };
