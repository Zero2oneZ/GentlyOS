/**
 * GentlyOS Neural Graph
 * Every interaction becomes a node/edge in a learning graph
 */

const fs = require('fs');
const path = require('path');
const { generateXOR } = require('../../core/xor/chain');

class NeuralGraph {
  constructor(persistPath = null) {
    this.nodes = new Map();      // xor → node
    this.edges = new Map();      // "from→to" → edge
    this.xorChain = [];          // Temporal sequence
    this.lastXOR = null;
    this.lastTimestamp = null;
    this.persistPath = persistPath;

    // Load from disk if exists
    if (persistPath && fs.existsSync(persistPath)) {
      this.load();
    }
  }

  /**
   * Add an interaction to the graph
   * @param {Object} event - Interaction event
   * @returns {Object} Created node and edge
   */
  addInteraction(event) {
    const timestamp = event.timestamp || Date.now();
    const xor = event.xor || generateXOR(event, timestamp, this.lastXOR || '000');

    // Create node
    const node = {
      id: xor,
      type: event.type,           // click, hover, chat, scroll, etc.
      label: event.label,         // Intent label from tiny model
      timestamp,
      state: event.state,         // Current primitives state
      metadata: event.metadata || {}
    };

    this.nodes.set(xor, node);

    // Create edge from previous node
    let edge = null;
    if (this.lastXOR) {
      const edgeId = `${this.lastXOR}→${xor}`;
      edge = {
        id: edgeId,
        from: this.lastXOR,
        to: xor,
        weight: this.calculateWeight(event),
        type: event.type,
        deltaTime: timestamp - this.lastTimestamp,
        mutation: event.mutation || null
      };

      this.edges.set(edgeId, edge);
    }

    // Update chain
    this.xorChain.push(xor);
    this.lastXOR = xor;
    this.lastTimestamp = timestamp;

    // Auto-persist
    if (this.persistPath) {
      this.save();
    }

    return { node, edge, xor };
  }

  /**
   * Calculate edge weight based on event type
   * @param {Object} event
   * @returns {number} Weight 0-1
   */
  calculateWeight(event) {
    const weights = {
      click: 1.0,
      submit: 1.0,
      purchase: 1.0,
      add_to_cart: 0.9,
      scroll: 0.3,
      hover: 0.2,
      view: 0.5,
      chat: 0.8,
      navigate: 0.6
    };
    return weights[event.type] || 0.5;
  }

  /**
   * Get node by XOR
   * @param {string} xor
   * @returns {Object|null}
   */
  getNode(xor) {
    return this.nodes.get(xor) || null;
  }

  /**
   * Get edge by ID or from/to
   * @param {string} from
   * @param {string} to
   * @returns {Object|null}
   */
  getEdge(from, to) {
    return this.edges.get(`${from}→${to}`) || null;
  }

  /**
   * Get all edges from a node
   * @param {string} xor
   * @returns {Array}
   */
  getOutgoingEdges(xor) {
    const result = [];
    for (const [id, edge] of this.edges) {
      if (edge.from === xor) result.push(edge);
    }
    return result;
  }

  /**
   * Get all edges to a node
   * @param {string} xor
   * @returns {Array}
   */
  getIncomingEdges(xor) {
    const result = [];
    for (const [id, edge] of this.edges) {
      if (edge.to === xor) result.push(edge);
    }
    return result;
  }

  /**
   * Find paths between two nodes
   * @param {string} from
   * @param {string} to
   * @param {number} maxDepth
   * @returns {Array} Array of paths
   */
  findPaths(from, to, maxDepth = 10) {
    const paths = [];

    const dfs = (current, path, depth) => {
      if (depth > maxDepth) return;
      if (current === to) {
        paths.push([...path, current]);
        return;
      }

      const edges = this.getOutgoingEdges(current);
      for (const edge of edges) {
        if (!path.includes(edge.to)) {
          dfs(edge.to, [...path, current], depth + 1);
        }
      }
    };

    dfs(from, [], 0);
    return paths;
  }

  /**
   * Get successful paths (high-weight sequences)
   * @param {number} minWeight
   * @returns {Array}
   */
  getSuccessfulPaths(minWeight = 0.8) {
    const paths = [];
    const visited = new Set();

    for (const [id, edge] of this.edges) {
      if (edge.weight >= minWeight && !visited.has(edge.from)) {
        // Trace path forward
        const path = [edge.from];
        let current = edge.to;

        while (current) {
          path.push(current);
          const next = this.getOutgoingEdges(current)
            .filter(e => e.weight >= minWeight)[0];
          current = next?.to;
          if (path.includes(current)) break; // Cycle detection
        }

        if (path.length >= 2) {
          paths.push({
            nodes: path,
            labels: path.map(xor => this.nodes.get(xor)?.label),
            totalWeight: path.length - 1
          });
        }

        path.forEach(xor => visited.add(xor));
      }
    }

    return paths;
  }

  /**
   * Get last N nodes
   * @param {number} n
   * @returns {Array}
   */
  getLastN(n) {
    const xors = this.xorChain.slice(-n);
    return xors.map(xor => this.nodes.get(xor)).filter(Boolean);
  }

  /**
   * Get graph statistics
   * @returns {Object}
   */
  getStats() {
    const edgeWeights = [...this.edges.values()].map(e => e.weight);
    const avgWeight = edgeWeights.reduce((a, b) => a + b, 0) / edgeWeights.length || 0;

    return {
      nodes: this.nodes.size,
      edges: this.edges.size,
      chainLength: this.xorChain.length,
      avgWeight: avgWeight.toFixed(2),
      currentXOR: this.lastXOR
    };
  }

  /**
   * Export graph as DOT format (for visualization)
   * @returns {string}
   */
  toDOT() {
    let dot = 'digraph NeuralGraph {\n';
    dot += '  rankdir=LR;\n';
    dot += '  node [shape=box];\n\n';

    // Nodes
    for (const [xor, node] of this.nodes) {
      const label = `${xor}\\n${node.label || node.type}`;
      dot += `  "${xor}" [label="${label}"];\n`;
    }

    dot += '\n';

    // Edges
    for (const [id, edge] of this.edges) {
      const label = `w=${edge.weight.toFixed(1)}`;
      dot += `  "${edge.from}" -> "${edge.to}" [label="${label}"];\n`;
    }

    dot += '}\n';
    return dot;
  }

  /**
   * Save to disk
   */
  save() {
    if (!this.persistPath) return;

    const data = {
      nodes: Object.fromEntries(this.nodes),
      edges: Object.fromEntries(this.edges),
      xorChain: this.xorChain,
      lastXOR: this.lastXOR,
      lastTimestamp: this.lastTimestamp
    };

    fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
  }

  /**
   * Load from disk
   */
  load() {
    if (!this.persistPath || !fs.existsSync(this.persistPath)) return;

    const data = JSON.parse(fs.readFileSync(this.persistPath, 'utf-8'));

    this.nodes = new Map(Object.entries(data.nodes));
    this.edges = new Map(Object.entries(data.edges));
    this.xorChain = data.xorChain;
    this.lastXOR = data.lastXOR;
    this.lastTimestamp = data.lastTimestamp;
  }

  /**
   * Clear the graph
   */
  clear() {
    this.nodes.clear();
    this.edges.clear();
    this.xorChain = [];
    this.lastXOR = null;
    this.lastTimestamp = null;
  }
}

module.exports = { NeuralGraph };
