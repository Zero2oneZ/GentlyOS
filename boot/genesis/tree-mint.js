#!/usr/bin/env node
/**
 * GentlyOS Genesis: Phase 4 - Tree Mint
 *
 * Maps entire file tree to Solana wallets
 * Distributes GNTLY-OS tokens by hierarchy
 *
 * Value Distribution Formula:
 *   ROOT_VALUE = 100 (always greatest)
 *   folder_value = parent_value / num_children
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const GENESIS_DIR = process.env.GENTLYOS_GENESIS || '/root/.gentlyos/genesis';
const ROOT_PATH = '/root/.gentlyos';
const ROOT_VALUE = 100_000_000_000; // 100 GNTLY-OS with 9 decimals
const BTC_API = 'https://blockchain.info/latestblock';

// Colors for console output
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  reset: '\x1b[0m'
};

function log(msg) { console.log(`${colors.green}[GENESIS:TREE]${colors.reset} ${msg}`); }
function warn(msg) { console.log(`${colors.yellow}[GENESIS:TREE]${colors.reset} ${msg}`); }
function error(msg) { console.error(`${colors.red}[GENESIS:TREE]${colors.reset} ${msg}`); process.exit(1); }
function phase(msg) {
  console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.cyan}  ${msg}${colors.reset}`);
  console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
}

/**
 * Fetch current BTC block for timestamping
 */
async function fetchBtcBlock() {
  try {
    const https = require('https');
    return new Promise((resolve, reject) => {
      https.get(BTC_API, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const block = JSON.parse(data);
          resolve({
            hash: block.hash,
            height: block.height
          });
        });
      }).on('error', reject);
    });
  } catch (e) {
    warn('Failed to fetch BTC block, using cached');
    const btcGenesis = JSON.parse(fs.readFileSync(path.join(GENESIS_DIR, 'btc-genesis.json'), 'utf-8'));
    return {
      hash: btcGenesis.btc_block_hash,
      height: btcGenesis.btc_block_height
    };
  }
}

/**
 * Build file tree with child counts
 */
function buildTree(dirPath) {
  const stats = fs.statSync(dirPath);
  const name = path.basename(dirPath);

  const node = {
    path: dirPath,
    name: name,
    isDirectory: stats.isDirectory(),
    children: [],
    childCount: 0,
    value: 0
  };

  if (stats.isDirectory()) {
    try {
      const entries = fs.readdirSync(dirPath);
      for (const entry of entries) {
        // Skip hidden files and special directories
        if (entry.startsWith('.') && entry !== '.gentlyos') continue;
        if (entry === 'node_modules') continue;
        if (entry === 'target') continue;

        const childPath = path.join(dirPath, entry);
        try {
          const childNode = buildTree(childPath);
          node.children.push(childNode);
        } catch (e) {
          // Skip inaccessible files
        }
      }
      node.childCount = node.children.length;
    } catch (e) {
      warn(`Cannot read directory: ${dirPath}`);
    }
  }

  return node;
}

/**
 * Calculate token values for tree
 * Root gets ROOT_VALUE, children split parent's value
 */
function calculateValues(node, parentValue = ROOT_VALUE) {
  node.value = parentValue;

  if (node.children.length > 0) {
    const childValue = Math.floor(parentValue / node.children.length);
    for (const child of node.children) {
      calculateValues(child, childValue);
    }
  }

  return node;
}

/**
 * Generate wallet address (deterministic from path)
 */
function generateWalletAddress(filePath) {
  const hash = crypto.createHash('sha256').update(filePath).digest('hex');
  // Solana-like base58 would be here, using hex for now
  return `GNTLY_OS_${hash.slice(0, 32)}`;
}

/**
 * Flatten tree to wallet records
 */
function flattenToWallets(node, btc, wallets = []) {
  const wallet = {
    path: node.path,
    name: node.name,
    isDirectory: node.isDirectory,
    value: node.value,
    valueFormatted: (node.value / 1_000_000_000).toFixed(9),
    address: generateWalletAddress(node.path),
    btc_hash: btc.hash,
    btc_height: btc.height,
    timestamp: Date.now(),
    children: node.children.length,
    frozen: true // OS wallets are always frozen
  };

  wallets.push(wallet);

  for (const child of node.children) {
    flattenToWallets(child, btc, wallets);
  }

  return wallets;
}

/**
 * Generate IPFS chain link for wallet
 */
function generateChainLink(wallet, prevCid) {
  const data = {
    wallet: wallet.address,
    path: wallet.path,
    value: wallet.value,
    btc_block: wallet.btc_hash,
    prev_cid: prevCid,
    timestamp: wallet.timestamp,
    hash: crypto.createHash('sha256')
      .update(`${wallet.address}${wallet.path}${wallet.value}${prevCid}`)
      .digest('hex')
  };
  return data;
}

/**
 * Main execution
 */
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║              GentlyOS Genesis: TREE MINT                         ║
║                                                                  ║
║  Mapping file tree to Solana wallets                             ║
╚══════════════════════════════════════════════════════════════════╝
`);

  // ============================================
  // PHASE 4.1: BTC CHECKPOINT
  // ============================================
  phase('Phase 4.1: Recording BTC checkpoint (TREE_START)');

  const btc = await fetchBtcBlock();
  log(`BTC Block: ${btc.height} (${btc.hash.slice(0, 16)}...)`);

  // Record checkpoint
  try {
    execSync(`${GENESIS_DIR}/btc-checkpoint.sh TREE_START`, { stdio: 'inherit' });
  } catch (e) {
    warn('Checkpoint script not found');
  }

  // ============================================
  // PHASE 4.2: BUILD FILE TREE
  // ============================================
  phase('Phase 4.2: Building file tree');

  if (!fs.existsSync(ROOT_PATH)) {
    error(`Root path not found: ${ROOT_PATH}`);
  }

  const tree = buildTree(ROOT_PATH);
  log(`Tree built: ${tree.childCount} top-level entries`);

  // ============================================
  // PHASE 4.3: CALCULATE VALUES
  // ============================================
  phase('Phase 4.3: Calculating token values');

  calculateValues(tree, ROOT_VALUE);
  log(`Root value: ${(ROOT_VALUE / 1_000_000_000).toFixed(2)} GNTLY-OS`);

  // ============================================
  // PHASE 4.4: GENERATE WALLETS
  // ============================================
  phase('Phase 4.4: Generating wallet records');

  const wallets = flattenToWallets(tree, btc);
  log(`Total wallets: ${wallets.length}`);

  // Calculate statistics
  let totalValue = 0;
  let dirCount = 0;
  let fileCount = 0;

  for (const w of wallets) {
    totalValue += w.value;
    if (w.isDirectory) dirCount++;
    else fileCount++;
  }

  log(`Directories: ${dirCount}`);
  log(`Files: ${fileCount}`);
  log(`Total value distributed: ${(totalValue / 1_000_000_000).toFixed(2)} GNTLY-OS`);

  // ============================================
  // PHASE 4.5: BUILD IPFS CHAIN
  // ============================================
  phase('Phase 4.5: Building IPFS chain links');

  const chainLinks = [];
  let prevCid = 'GENESIS';

  for (const wallet of wallets) {
    const link = generateChainLink(wallet, prevCid);
    chainLinks.push(link);
    prevCid = `Qm${link.hash.slice(0, 44)}`; // Mock CID format
  }

  log(`Chain links generated: ${chainLinks.length}`);

  // ============================================
  // PHASE 4.6: WRITE MANIFESTS
  // ============================================
  phase('Phase 4.6: Writing manifests');

  // Wallet manifest
  const walletManifest = {
    generated_at: Date.now(),
    btc_block: btc,
    total_wallets: wallets.length,
    total_value: totalValue,
    directories: dirCount,
    files: fileCount,
    root_value: ROOT_VALUE,
    wallets: wallets
  };

  fs.writeFileSync(
    path.join(GENESIS_DIR, 'os-wallets.json'),
    JSON.stringify(walletManifest, null, 2)
  );
  log(`Wallet manifest: ${GENESIS_DIR}/os-wallets.json`);

  // Chain manifest
  const chainManifest = {
    generated_at: Date.now(),
    btc_block: btc,
    total_links: chainLinks.length,
    genesis_cid: 'GENESIS',
    head_cid: prevCid,
    links: chainLinks
  };

  fs.writeFileSync(
    path.join(GENESIS_DIR, 'os-chain.json'),
    JSON.stringify(chainManifest, null, 2)
  );
  log(`Chain manifest: ${GENESIS_DIR}/os-chain.json`);

  // Tree visualization
  const treeVis = generateTreeVisualization(wallets);
  fs.writeFileSync(
    path.join(GENESIS_DIR, 'tree-visualization.txt'),
    treeVis
  );
  log(`Tree visualization: ${GENESIS_DIR}/tree-visualization.txt`);

  // ============================================
  // PHASE 4.7: FINAL CHECKPOINT
  // ============================================
  phase('Phase 4.7: Recording BTC checkpoint (TREE_END)');

  const btcEnd = await fetchBtcBlock();
  try {
    execSync(`${GENESIS_DIR}/btc-checkpoint.sh TREE_END`, { stdio: 'inherit' });
  } catch (e) {
    warn('Checkpoint script not found');
  }

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║              TREE MINT: COMPLETE                                 ║
╠══════════════════════════════════════════════════════════════════╣
║  Total Wallets:  ${wallets.length.toString().padEnd(46)}║
║  Directories:    ${dirCount.toString().padEnd(46)}║
║  Files:          ${fileCount.toString().padEnd(46)}║
║  Total Value:    ${(totalValue / 1_000_000_000).toFixed(2)} GNTLY-OS${' '.repeat(36)}║
║  BTC Start:      ${btc.height.toString().padEnd(46)}║
║  BTC End:        ${btcEnd.height.toString().padEnd(46)}║
╚══════════════════════════════════════════════════════════════════╝
`);

  log('Ready for Phase 5: Complete + Verify');
}

/**
 * Generate ASCII tree visualization
 */
function generateTreeVisualization(wallets) {
  const lines = ['GentlyOS File Tree Value Distribution', ''];

  // Sort by path depth
  wallets.sort((a, b) => a.path.localeCompare(b.path));

  for (const w of wallets.slice(0, 50)) { // Limit to first 50
    const depth = w.path.replace(ROOT_PATH, '').split('/').length - 1;
    const prefix = '│   '.repeat(depth);
    const icon = w.isDirectory ? '📁' : '📄';
    const value = (w.value / 1_000_000_000).toFixed(4);
    lines.push(`${prefix}├── ${icon} ${w.name} (${value} GNTLY-OS)`);
  }

  if (wallets.length > 50) {
    lines.push(`\n... and ${wallets.length - 50} more entries`);
  }

  return lines.join('\n');
}

// Run
main().catch(e => {
  error(`Fatal: ${e.message}`);
});
