/**
 * GentlyOS Git Blob Storage
 * Everything is a git blob. Templates, state, history.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

class GitBlobStore {
  constructor(repoPath) {
    this.repoPath = repoPath;
    this.objectsPath = path.join(repoPath, '.gentlyos', 'objects');
    this.templatesPath = path.join(repoPath, '.gentlyos', 'templates');
    this.varsPath = path.join(repoPath, '.gentlyos', 'vars');
    this.xorPath = path.join(repoPath, '.gentlyos', 'xor-chains');

    this.init();
  }

  /**
   * Initialize storage directories
   */
  init() {
    const dirs = [
      this.objectsPath,
      this.templatesPath,
      this.varsPath,
      this.xorPath
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Hash content (SHA256, first 16 chars)
   * @param {string} content
   * @returns {string}
   */
  hash(content) {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /**
   * CREATE - Store a new blob
   * @param {string} type - 'template', 'var', 'xor', 'object'
   * @param {Object|string} data
   * @returns {Object} { hash, path }
   */
  create(type, data) {
    const content = typeof data === 'string' ? data : JSON.stringify(data);
    const hash = this.hash(content);

    let targetPath;
    switch (type) {
      case 'template':
        targetPath = path.join(this.templatesPath, hash);
        break;
      case 'var':
        targetPath = path.join(this.varsPath, hash);
        break;
      case 'xor':
        targetPath = path.join(this.xorPath, hash);
        break;
      default:
        targetPath = path.join(this.objectsPath, hash);
    }

    fs.writeFileSync(targetPath, content);

    return { hash, path: targetPath, size: content.length };
  }

  /**
   * READ - Get a blob by hash
   * @param {string} hash
   * @returns {Object|null}
   */
  read(hash) {
    // Search all paths
    const paths = [
      path.join(this.objectsPath, hash),
      path.join(this.templatesPath, hash),
      path.join(this.varsPath, hash),
      path.join(this.xorPath, hash)
    ];

    for (const p of paths) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        try {
          return JSON.parse(content);
        } catch {
          return content;
        }
      }
    }

    return null;
  }

  /**
   * UPDATE - Update a blob (creates new, marks old)
   * @param {string} oldHash
   * @param {Object|string} newData
   * @returns {Object} { oldHash, newHash, path }
   */
  update(oldHash, newData) {
    // Create new blob
    const { hash: newHash, path: newPath } = this.create('object', newData);

    // Mark old as superseded (optional - could delete)
    const oldPath = path.join(this.objectsPath, oldHash);
    if (fs.existsSync(oldPath)) {
      fs.writeFileSync(oldPath + '.superseded', newHash);
    }

    return { oldHash, newHash, path: newPath };
  }

  /**
   * DELETE - Mark blob as deleted (don't actually remove for audit)
   * @param {string} hash
   * @returns {boolean}
   */
  delete(hash) {
    const blobPath = path.join(this.objectsPath, hash);
    if (fs.existsSync(blobPath)) {
      fs.writeFileSync(blobPath + '.deleted', Date.now().toString());
      return true;
    }
    return false;
  }

  /**
   * Store a template
   * @param {string} name - Template name (e.g., 'celebrity-fan')
   * @param {string} codie - CODIE template
   * @returns {Object}
   */
  storeTemplate(name, codie) {
    const data = {
      name,
      codie,
      created: Date.now(),
      instances: 0
    };

    const { hash } = this.create('template', data);

    // Also create named reference
    const refPath = path.join(this.templatesPath, name);
    fs.writeFileSync(refPath, hash);

    return { name, hash };
  }

  /**
   * Get template by name
   * @param {string} name
   * @returns {Object|null}
   */
  getTemplate(name) {
    const refPath = path.join(this.templatesPath, name);
    if (fs.existsSync(refPath)) {
      const hash = fs.readFileSync(refPath, 'utf-8').trim();
      return this.read(hash);
    }
    return null;
  }

  /**
   * Store variables (instance of a template)
   * @param {string} templateHash
   * @param {Object} vars
   * @returns {Object}
   */
  storeVars(templateHash, vars) {
    const data = {
      template: templateHash,
      vars,
      created: Date.now()
    };

    return this.create('var', data);
  }

  /**
   * Store XOR chain
   * @param {string} sessionId
   * @param {Array} chain
   * @returns {Object}
   */
  storeXORChain(sessionId, chain) {
    const data = {
      sessionId,
      chain,
      updated: Date.now()
    };

    const { hash } = this.create('xor', data);

    // Named reference
    const refPath = path.join(this.xorPath, `session-${sessionId}`);
    fs.writeFileSync(refPath, hash);

    return { sessionId, hash };
  }

  /**
   * Get XOR chain by session
   * @param {string} sessionId
   * @returns {Object|null}
   */
  getXORChain(sessionId) {
    const refPath = path.join(this.xorPath, `session-${sessionId}`);
    if (fs.existsSync(refPath)) {
      const hash = fs.readFileSync(refPath, 'utf-8').trim();
      return this.read(hash);
    }
    return null;
  }

  /**
   * List all templates
   * @returns {Array}
   */
  listTemplates() {
    const templates = [];
    const files = fs.readdirSync(this.templatesPath);

    for (const file of files) {
      // Skip hash files, only get named refs
      if (file.length !== 16) {
        const data = this.getTemplate(file);
        if (data) {
          templates.push({ name: file, ...data });
        }
      }
    }

    return templates;
  }

  /**
   * Get storage statistics
   * @returns {Object}
   */
  getStats() {
    const countFiles = (dir) => {
      try {
        return fs.readdirSync(dir).length;
      } catch {
        return 0;
      }
    };

    return {
      objects: countFiles(this.objectsPath),
      templates: countFiles(this.templatesPath),
      vars: countFiles(this.varsPath),
      xorChains: countFiles(this.xorPath)
    };
  }

  /**
   * Garbage collect deleted/superseded blobs
   * @param {number} olderThan - Remove items older than this (ms)
   * @returns {number} Count of removed items
   */
  gc(olderThan = 86400000) { // 24 hours default
    let removed = 0;
    const now = Date.now();

    const cleanDir = (dir) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.endsWith('.deleted') || file.endsWith('.superseded')) {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > olderThan) {
            // Remove both marker and original
            fs.unlinkSync(filePath);
            const original = filePath.replace(/\.(deleted|superseded)$/, '');
            if (fs.existsSync(original)) {
              fs.unlinkSync(original);
            }
            removed++;
          }
        }
      }
    };

    cleanDir(this.objectsPath);
    cleanDir(this.templatesPath);
    cleanDir(this.varsPath);

    return removed;
  }
}

module.exports = { GitBlobStore };
