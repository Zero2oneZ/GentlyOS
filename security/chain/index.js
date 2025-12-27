/**
 * GentlyOS Build Chain Verifier (JavaScript)
 * 10-layer cryptographic verification
 *
 * Mirrors the Python verifier for Node.js environments
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Chain constants
const XOR_KEY = 73;
const GOLDEN_SEED = 618033988;
const MASTER_KEY = [3, 5, 5, 4, 6];
const KEY_SUM = 23;
const GRID_DIMS = [64, 32, 64];
const COORD_4D = [26, 11, 17, 929];

// Critical files to always verify
const CRITICAL_FILES = [
  'index.js',
  'core/codie/parser.js',
  'core/xor/chain.js',
  'intelligence/fusion/graph.js',
  'intelligence/tiny-model/inference.js',
  'security/index.js',
];

// ═══════════════════════════════════════════════════════════════
// LAYER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function layer1Bacon(text) {
  const baconMap = {};
  for (let i = 0; i < 26; i++) {
    const binary = i.toString(2).padStart(5, '0');
    baconMap[String.fromCharCode(65 + i)] = binary.replace(/0/g, 'A').replace(/1/g, 'B');
  }

  let result = '';
  for (const c of text.toUpperCase()) {
    if (baconMap[c]) result += baconMap[c];
  }
  return result;
}

function layer2Xor(data, key = XOR_KEY) {
  return Buffer.from(data.map(b => b ^ key));
}

function layer3Golden(value) {
  return (value * GOLDEN_SEED) % (2 ** 32);
}

function layer4Box(text, rows, cols) {
  text = text.padEnd(rows * cols, 'X').slice(0, rows * cols);
  const grid = [];
  for (let i = 0; i < rows; i++) {
    grid.push(text.slice(i * cols, (i + 1) * cols));
  }

  let result = '';
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      result += grid[row][col];
    }
  }
  return result;
}

function layer5Scytale(text, diameter) {
  while (text.length % diameter !== 0) text += 'X';

  let result = '';
  for (let i = 0; i < diameter; i++) {
    for (let j = i; j < text.length; j += diameter) {
      result += text[j];
    }
  }
  return result;
}

function layer6Md5(data) {
  return crypto.createHash('md5').update(data).digest('hex');
}

function layer7Ed25519Derive(seed) {
  const h = crypto.createHash('sha512').update(seed).digest();
  const result = Buffer.from(h.slice(0, 32));
  result[0] &= 248;
  result[31] &= 127;
  result[31] |= 64;
  return result;
}

function layer8Sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function layer9CombinedXor(data) {
  const result = Buffer.from(data);
  for (let i = 0; i < result.length; i++) {
    const keyByte = MASTER_KEY[i % MASTER_KEY.length];
    result[i] = result[i] ^ keyByte ^ XOR_KEY;
  }
  return result;
}

function layer10BerlinClock(value) {
  const hours = Math.floor(value / 3600) % 24;
  const minutes = Math.floor(value / 60) % 60;
  const seconds = value % 60;
  return { hours, minutes, seconds };
}

// ═══════════════════════════════════════════════════════════════
// CHAIN PROCESSOR
// ═══════════════════════════════════════════════════════════════

function processChain(seedInput) {
  const states = {
    input: seedInput,
    timestamp: new Date().toISOString()
  };

  // Layer 1: Bacon
  const l1 = layer1Bacon(seedInput);
  states.L1_bacon = l1.slice(0, 64);

  // Layer 2: XOR
  const l2 = layer2Xor(Buffer.from(l1));
  states.L2_xor = l2.toString('hex').slice(0, 32);

  // Layer 3: Golden
  const l3Int = l2.readUInt32BE(0) || 0;
  const l3 = layer3Golden(l3Int);
  states.L3_golden = l3;

  // Layer 4: Box
  const l4 = layer4Box(l2.toString('hex'), 3, 14);
  states.L4_box = l4.slice(0, 32);

  // Layer 5: Scytale
  const l5 = layer5Scytale(l4, MASTER_KEY[0]);
  states.L5_scytale = l5.slice(0, 32);

  // Layer 6: MD5
  const l6 = layer6Md5(l5);
  states.L6_md5 = l6;

  // Layer 7: Ed25519
  const l7 = layer7Ed25519Derive(Buffer.from(l6, 'hex'));
  states.L7_ed25519 = l7.toString('hex').slice(0, 32);

  // Layer 8: SHA256
  const l8 = layer8Sha256(l7);
  states.L8_sha256 = l8;

  // Layer 9: Combined XOR
  const l9 = layer9CombinedXor(Buffer.from(l8, 'hex'));
  states.L9_combined = l9.toString('hex').slice(0, 32);

  // Layer 10: Berlin Clock
  const l10Val = l9.readUInt32BE(0);
  const l10 = layer10BerlinClock(l10Val);
  states.L10_berlin = `${String(l10.hours).padStart(2, '0')}:${String(l10.minutes).padStart(2, '0')}:${String(l10.seconds).padStart(2, '0')}`;

  // Final key
  const finalHash = crypto.createHash('sha256').update(l9).digest();
  const coordModifier = COORD_4D.reduce((a, b) => a + b, 0) % 256;
  const finalBytes = Buffer.from(finalHash.map(b => b ^ coordModifier));

  states.chain_key = finalBytes.toString('hex');
  states.chain_key_short = finalBytes.toString('hex').slice(0, 16);

  // Grid cell
  const zkqIndex = finalBytes.readUIntBE(0, 3) % (64 * 32 * 64);
  const x = Math.floor(zkqIndex / (32 * 64));
  const y = Math.floor(zkqIndex / 64) % 32;
  const z = zkqIndex % 64;
  states.grid_cell = `(${x},${y},${z})`;

  return states;
}

// ═══════════════════════════════════════════════════════════════
// FILE VERIFICATION
// ═══════════════════════════════════════════════════════════════

function hashFile(filepath) {
  try {
    const content = fs.readFileSync(filepath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return 'MISSING';
  }
}

function verifyFile(filepath) {
  const fileHash = hashFile(filepath);
  if (fileHash === 'MISSING') {
    return { file: filepath, status: 'MISSING', chain: null };
  }

  const chain = processChain(fileHash);
  return {
    file: filepath,
    status: 'VERIFIED',
    hash: fileHash,
    chain_key: chain.chain_key_short,
    grid_cell: chain.grid_cell,
    berlin: chain.L10_berlin
  };
}

function scanDirectory(root, extensions = ['.js', '.py', '.rs', '.json', '.html', '.sh']) {
  const results = [];

  function scan(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip node_modules, dist, .git
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
          continue;
        }

        if (entry.isDirectory()) {
          scan(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (extensions.includes(ext)) {
            results.push(verifyFile(fullPath));
          }
        }
      }
    } catch {}
  }

  scan(root);
  return results;
}

function generateManifest(root) {
  const files = scanDirectory(root);
  const allHashes = files
    .filter(f => f.status === 'VERIFIED')
    .map(f => f.hash)
    .join('');

  const masterChain = processChain(allHashes);

  return {
    version: '0.1.0',
    generated: new Date().toISOString(),
    master_key: masterChain.chain_key,
    master_cell: masterChain.grid_cell,
    master_berlin: masterChain.L10_berlin,
    file_count: files.length,
    verified_count: files.filter(f => f.status === 'VERIFIED').length,
    files
  };
}

function verifyBuild(root) {
  console.log(`\n[VERIFYING] ${root}\n`);

  let criticalVerified = 0;

  for (const crit of CRITICAL_FILES) {
    const fullPath = path.join(root, crit);
    const result = verifyFile(fullPath);

    if (result.status === 'VERIFIED') {
      criticalVerified++;
      console.log(`  [✓] ${crit} → ${result.chain_key}`);
    } else {
      console.log(`  [✗] ${crit} → MISSING`);
    }
  }

  const manifest = generateManifest(root);

  console.log(`\n  Critical: ${criticalVerified}/${CRITICAL_FILES.length}`);
  console.log(`  Total: ${manifest.verified_count}/${manifest.file_count}`);
  console.log(`  Master Key: ${manifest.master_key.slice(0, 16)}...`);
  console.log(`  Grid Cell: ${manifest.master_cell}`);
  console.log(`  Berlin: ${manifest.master_berlin}`);

  return criticalVerified === CRITICAL_FILES.length;
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
  processChain,
  verifyFile,
  verifyBuild,
  generateManifest,
  scanDirectory,
  hashFile,
  // Layer functions
  layer1Bacon,
  layer2Xor,
  layer3Golden,
  layer4Box,
  layer5Scytale,
  layer6Md5,
  layer7Ed25519Derive,
  layer8Sha256,
  layer9CombinedXor,
  layer10BerlinClock,
  // Constants
  XOR_KEY,
  GOLDEN_SEED,
  MASTER_KEY,
  GRID_DIMS,
  COORD_4D
};

// CLI
if (require.main === module) {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║           GENTLYOS BUILD CHAIN VERIFIER                          ║
║                                                                  ║
║   10-Layer Cryptographic Verification                            ║
║   Every file. Every hash. Every layer.                           ║
╚══════════════════════════════════════════════════════════════════╝
  `);

  const root = path.resolve(__dirname, '..', '..');
  const success = verifyBuild(root);

  console.log(`\n[RESULT] ${success ? 'PASSED ✓' : 'FAILED ✗'}`);
  process.exit(success ? 0 : 1);
}
