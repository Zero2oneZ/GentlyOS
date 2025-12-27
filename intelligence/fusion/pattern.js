/**
 * GentlyOS Pattern Detector
 * Finds common patterns in the neural graph for training
 */

const fs = require('fs');

class PatternDetector {
  constructor(graph) {
    this.graph = graph;
    this.patterns = new Map();  // pattern string → count
    this.minOccurrences = 3;    // Minimum times a pattern must occur
  }

  /**
   * Detect all patterns in the graph
   * @returns {Array} Sorted patterns by frequency
   */
  detectPatterns() {
    this.patterns.clear();

    // Get all successful paths
    const paths = this.graph.getSuccessfulPaths(0.7);

    // Extract n-grams of labels
    for (const path of paths) {
      const labels = path.labels.filter(Boolean);

      // 2-grams
      for (let i = 0; i < labels.length - 1; i++) {
        const pattern = `${labels[i]}→${labels[i + 1]}`;
        this.patterns.set(pattern, (this.patterns.get(pattern) || 0) + 1);
      }

      // 3-grams
      for (let i = 0; i < labels.length - 2; i++) {
        const pattern = `${labels[i]}→${labels[i + 1]}→${labels[i + 2]}`;
        this.patterns.set(pattern, (this.patterns.get(pattern) || 0) + 1);
      }
    }

    // Filter and sort
    const filtered = [...this.patterns.entries()]
      .filter(([_, count]) => count >= this.minOccurrences)
      .sort((a, b) => b[1] - a[1]);

    return filtered.map(([pattern, count]) => ({
      pattern,
      count,
      steps: pattern.split('→')
    }));
  }

  /**
   * Detect conversion patterns (lead to purchase/submit/etc)
   * @returns {Array}
   */
  detectConversionPatterns() {
    const conversions = ['purchase', 'submit', 'add_to_cart', 'signup', 'checkout'];
    const patterns = [];

    for (const [xor, node] of this.graph.nodes) {
      if (conversions.includes(node.label)) {
        // Trace back the path
        const path = this.traceBack(xor, 5);
        if (path.length >= 2) {
          patterns.push({
            conversion: node.label,
            path: path.map(n => n.label).filter(Boolean),
            xorChain: path.map(n => n.id)
          });
        }
      }
    }

    return patterns;
  }

  /**
   * Trace back from a node
   * @param {string} xor
   * @param {number} maxDepth
   * @returns {Array}
   */
  traceBack(xor, maxDepth = 5) {
    const path = [this.graph.getNode(xor)];
    let current = xor;
    let depth = 0;

    while (depth < maxDepth) {
      const incoming = this.graph.getIncomingEdges(current);
      if (incoming.length === 0) break;

      // Take the edge with highest weight
      const best = incoming.sort((a, b) => b.weight - a.weight)[0];
      const node = this.graph.getNode(best.from);
      if (!node) break;

      path.unshift(node);
      current = best.from;
      depth++;
    }

    return path;
  }

  /**
   * Detect drop-off points
   * @returns {Array}
   */
  detectDropoffs() {
    const dropoffs = [];

    for (const [xor, node] of this.graph.nodes) {
      const outgoing = this.graph.getOutgoingEdges(xor);

      // Node with no outgoing edges = potential drop-off
      if (outgoing.length === 0 && node.type !== 'purchase' && node.type !== 'submit') {
        const incoming = this.graph.getIncomingEdges(xor);
        dropoffs.push({
          xor,
          label: node.label,
          type: node.type,
          incomingCount: incoming.length,
          avgIncomingWeight: incoming.reduce((a, e) => a + e.weight, 0) / incoming.length || 0
        });
      }
    }

    return dropoffs.sort((a, b) => b.incomingCount - a.incomingCount);
  }

  /**
   * Generate JSONL training data from patterns
   * @returns {Array}
   */
  generateTrainingData() {
    const patterns = this.detectPatterns();
    const conversions = this.detectConversionPatterns();
    const training = [];

    // Pattern-based training
    for (const { pattern, steps, count } of patterns) {
      if (steps.length >= 2) {
        training.push({
          prompt: steps.slice(0, -1).join('+'),
          completion: `NEXT:${steps[steps.length - 1]}`,
          frequency: count
        });
      }
    }

    // Conversion-based training
    for (const { conversion, path } of conversions) {
      if (path.length >= 2) {
        training.push({
          prompt: path.slice(0, -1).join('+'),
          completion: `CONVERT:${conversion}`,
          frequency: 1
        });
      }
    }

    return training;
  }

  /**
   * Export training data to JSONL file
   * @param {string} filePath
   */
  exportJSONL(filePath) {
    const training = this.generateTrainingData();
    const lines = training.map(t => JSON.stringify(t)).join('\n');
    fs.writeFileSync(filePath, lines);
    return training.length;
  }

  /**
   * Get pattern statistics
   * @returns {Object}
   */
  getStats() {
    const patterns = this.detectPatterns();
    const conversions = this.detectConversionPatterns();
    const dropoffs = this.detectDropoffs();

    return {
      totalPatterns: patterns.length,
      topPatterns: patterns.slice(0, 5),
      conversions: conversions.length,
      dropoffPoints: dropoffs.length,
      topDropoffs: dropoffs.slice(0, 3)
    };
  }
}

module.exports = { PatternDetector };
