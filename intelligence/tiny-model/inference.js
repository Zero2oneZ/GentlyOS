/**
 * GentlyOS Tiny Model
 * Fast JSONL-based pattern matching for 90% of interactions
 * Cost: ~$0.0001 per request (essentially free)
 */

const fs = require('fs');
const path = require('path');

class TinyModel {
  constructor(jsonlPath = null) {
    this.patterns = new Map();     // prompt → completion
    this.fuzzyPatterns = [];       // For fuzzy matching
    this.hitCount = 0;
    this.missCount = 0;
    this.jsonlPath = jsonlPath;

    // Load if exists
    if (jsonlPath && fs.existsSync(jsonlPath)) {
      this.load(jsonlPath);
    }
  }

  /**
   * Load patterns from JSONL file
   * @param {string} filePath
   */
  load(filePath) {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const { prompt, completion, frequency } = JSON.parse(line);
        this.patterns.set(prompt.toLowerCase(), {
          completion,
          frequency: frequency || 1
        });

        // Also add to fuzzy patterns
        this.fuzzyPatterns.push({
          tokens: prompt.toLowerCase().split('+'),
          completion,
          frequency: frequency || 1
        });
      } catch (e) {
        console.error(`Failed to parse line: ${line}`);
      }
    }

    console.log(`Loaded ${this.patterns.size} patterns`);
  }

  /**
   * Fast inference - pattern lookup
   * @param {string} prompt
   * @returns {Object|null} { completion, confidence, method }
   */
  infer(prompt) {
    const normalized = prompt.toLowerCase().trim();

    // Exact match (fastest)
    if (this.patterns.has(normalized)) {
      this.hitCount++;
      const match = this.patterns.get(normalized);
      return {
        completion: match.completion,
        confidence: 1.0,
        method: 'exact',
        frequency: match.frequency
      };
    }

    // Fuzzy match (still fast)
    const fuzzyMatch = this.fuzzyMatch(normalized);
    if (fuzzyMatch) {
      this.hitCount++;
      return {
        completion: fuzzyMatch.completion,
        confidence: fuzzyMatch.score,
        method: 'fuzzy',
        frequency: fuzzyMatch.frequency
      };
    }

    // No match - needs Claude
    this.missCount++;
    return null;
  }

  /**
   * Fuzzy matching using token overlap
   * @param {string} prompt
   * @returns {Object|null}
   */
  fuzzyMatch(prompt) {
    const inputTokens = prompt.split(/[+\s_-]+/).filter(Boolean);
    let bestMatch = null;
    let bestScore = 0;

    for (const pattern of this.fuzzyPatterns) {
      const score = this.tokenOverlap(inputTokens, pattern.tokens);
      if (score > bestScore && score >= 0.7) {
        bestScore = score;
        bestMatch = { ...pattern, score };
      }
    }

    return bestMatch;
  }

  /**
   * Calculate token overlap score
   * @param {string[]} a
   * @param {string[]} b
   * @returns {number} 0-1
   */
  tokenOverlap(a, b) {
    const setA = new Set(a);
    const setB = new Set(b);
    const intersection = [...setA].filter(x => setB.has(x));
    const union = new Set([...setA, ...setB]);
    return intersection.length / union.size;
  }

  /**
   * Add new pattern
   * @param {string} prompt
   * @param {string} completion
   * @param {number} frequency
   */
  addPattern(prompt, completion, frequency = 1) {
    const normalized = prompt.toLowerCase();
    this.patterns.set(normalized, { completion, frequency });
    this.fuzzyPatterns.push({
      tokens: normalized.split('+'),
      completion,
      frequency
    });
  }

  /**
   * Batch add patterns
   * @param {Array} patterns - Array of { prompt, completion, frequency }
   */
  addPatterns(patterns) {
    for (const p of patterns) {
      this.addPattern(p.prompt, p.completion, p.frequency);
    }
  }

  /**
   * Save to JSONL
   * @param {string} filePath
   */
  save(filePath = this.jsonlPath) {
    if (!filePath) return;

    const lines = [];
    for (const [prompt, data] of this.patterns) {
      lines.push(JSON.stringify({
        prompt,
        completion: data.completion,
        frequency: data.frequency
      }));
    }

    fs.writeFileSync(filePath, lines.join('\n'));
  }

  /**
   * Get hit rate
   * @returns {number}
   */
  getHitRate() {
    const total = this.hitCount + this.missCount;
    if (total === 0) return 0;
    return this.hitCount / total;
  }

  /**
   * Get statistics
   * @returns {Object}
   */
  getStats() {
    return {
      patterns: this.patterns.size,
      hits: this.hitCount,
      misses: this.missCount,
      hitRate: (this.getHitRate() * 100).toFixed(1) + '%'
    };
  }

  /**
   * Clear all patterns
   */
  clear() {
    this.patterns.clear();
    this.fuzzyPatterns = [];
    this.hitCount = 0;
    this.missCount = 0;
  }
}

/**
 * Router - decides tiny model vs Claude
 */
class ModelRouter {
  constructor(tinyModel, claudeBridge = null) {
    this.tiny = tinyModel;
    this.claude = claudeBridge;
    this.complexityThreshold = 0.7;  // Below this → tiny model
  }

  /**
   * Assess complexity of a request
   * @param {Object} request
   * @returns {number} 0-1 (higher = more complex)
   */
  assessComplexity(request) {
    let score = 0;

    // Long requests are more complex
    const textLength = (request.text || request.prompt || '').length;
    if (textLength > 100) score += 0.3;
    if (textLength > 300) score += 0.2;

    // Certain keywords indicate complexity
    const complexKeywords = ['redesign', 'change', 'new feature', 'architecture', 'why', 'explain', 'analyze'];
    const text = (request.text || request.prompt || '').toLowerCase();
    for (const kw of complexKeywords) {
      if (text.includes(kw)) score += 0.15;
    }

    // Request type
    if (request.type === 'chat') score += 0.2;
    if (request.type === 'redesign') score += 0.5;
    if (request.type === 'analyze') score += 0.4;

    return Math.min(score, 1);
  }

  /**
   * Route request to appropriate model
   * @param {Object} request
   * @returns {Object} { response, model, complexity }
   */
  async route(request) {
    const complexity = this.assessComplexity(request);
    const prompt = request.text || request.prompt || '';

    // Try tiny model first
    if (complexity < this.complexityThreshold) {
      const tinyResult = this.tiny.infer(prompt);
      if (tinyResult) {
        return {
          response: tinyResult.completion,
          model: 'tiny',
          complexity,
          confidence: tinyResult.confidence,
          cost: 0.0001
        };
      }
    }

    // Fallback to Claude
    if (this.claude) {
      const claudeResult = await this.claude.query(prompt);
      return {
        response: claudeResult,
        model: 'claude',
        complexity,
        confidence: 1.0,
        cost: 0.01
      };
    }

    // No Claude available
    return {
      response: null,
      model: 'none',
      complexity,
      error: 'No model available for this complexity level'
    };
  }

  /**
   * Get routing statistics
   * @returns {Object}
   */
  getStats() {
    return {
      tinyStats: this.tiny.getStats(),
      threshold: this.complexityThreshold,
      claudeAvailable: !!this.claude
    };
  }
}

// Default seed patterns for cold start
const SEED_PATTERNS = [
  { prompt: "btn:add_cart", completion: "MUT{BTN:{t:checkout,v:visible}}" },
  { prompt: "btn:checkout", completion: "NAV{to:checkout}" },
  { prompt: "click:product", completion: "MUT{MDL:{v:visible,c:product_detail}}" },
  { prompt: "scroll:bottom", completion: "MUT{LST:{load:more}}" },
  { prompt: "hover:2s+element:btn", completion: "MUT{TLT:{v:visible}}" },
  { prompt: "form:submit", completion: "MUT{SPN:{v:visible}}" },
  { prompt: "nav:home", completion: "NAV{to:/}" },
  { prompt: "nav:cart", completion: "NAV{to:/cart}" },
  { prompt: "filter:price", completion: "MUT{GRD:{sort:price}}" },
  { prompt: "filter:size", completion: "MUT{GRD:{f:size}}" },
  { prompt: "search:query", completion: "MUT{GRD:{q:$query}}" },
  { prompt: "toggle:dark", completion: "MUT{APP:{t:dark}}" },
  { prompt: "toggle:light", completion: "MUT{APP:{t:light}}" }
];

module.exports = {
  TinyModel,
  ModelRouter,
  SEED_PATTERNS
};
