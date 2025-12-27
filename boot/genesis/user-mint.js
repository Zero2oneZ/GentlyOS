#!/usr/bin/env node
/**
 * GentlyOS Genesis: User Layer Wallet Minter
 *
 * Creates and manages USER wallets (GNTLY-USER tokens)
 * - 1 ROOT user at top
 * - Users split tokens amongst themselves
 * - Fixed supply per group (never more or less than init)
 * - Tradeable between users
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GENESIS_DIR = process.env.GENTLYOS_GENESIS || '/root/.gentlyos/genesis';
const USERS_FILE = path.join(GENESIS_DIR, 'users.json');
const ROOT_USER_VALUE = 100_000_000_000; // 100 GNTLY-USER with 9 decimals
const BTC_API = 'https://blockchain.info/latestblock';

// Colors
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  reset: '\x1b[0m'
};

function log(msg) { console.log(`${colors.green}[USER:MINT]${colors.reset} ${msg}`); }
function warn(msg) { console.log(`${colors.yellow}[USER:MINT]${colors.reset} ${msg}`); }
function error(msg) { console.error(`${colors.red}[USER:MINT]${colors.reset} ${msg}`); }

/**
 * Fetch current BTC block
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
          resolve({ hash: block.hash, height: block.height });
        });
      }).on('error', reject);
    });
  } catch (e) {
    const btcGenesis = JSON.parse(fs.readFileSync(path.join(GENESIS_DIR, 'btc-genesis.json'), 'utf-8'));
    return { hash: btcGenesis.btc_block_hash, height: btcGenesis.btc_block_height };
  }
}

/**
 * Generate wallet address for user
 */
function generateUserAddress(userId) {
  const hash = crypto.createHash('sha256').update(`user:${userId}`).digest('hex');
  return `GNTLY_USER_${hash.slice(0, 32)}`;
}

/**
 * Load existing user state
 */
function loadUsers() {
  if (fs.existsSync(USERS_FILE)) {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  }
  return {
    root: null,
    users: {},
    groups: {},
    totalSupply: ROOT_USER_VALUE,
    created_at: Date.now()
  };
}

/**
 * Save user state
 */
function saveUsers(state) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(state, null, 2));
}

/**
 * UserMinter class
 */
class UserMinter {
  constructor() {
    this.state = loadUsers();
  }

  /**
   * Initialize ROOT user (first boot only)
   */
  async initRootUser(btc) {
    if (this.state.root) {
      log('ROOT user already exists');
      return this.state.root;
    }

    const rootUser = {
      id: 'ROOT',
      address: generateUserAddress('ROOT'),
      value: ROOT_USER_VALUE,
      valueFormatted: (ROOT_USER_VALUE / 1_000_000_000).toFixed(9),
      parent: null,
      children: [],
      btc_hash: btc.hash,
      btc_height: btc.height,
      created_at: Date.now(),
      frozen: false
    };

    this.state.root = rootUser;
    this.state.users['ROOT'] = rootUser;
    saveUsers(this.state);

    log(`ROOT user created: ${rootUser.address}`);
    log(`Initial value: ${rootUser.valueFormatted} GNTLY-USER`);

    return rootUser;
  }

  /**
   * Register a new user under a parent
   * Value is split from parent
   */
  async registerUser(userId, parentId, btc) {
    if (this.state.users[userId]) {
      warn(`User ${userId} already exists`);
      return this.state.users[userId];
    }

    const parent = this.state.users[parentId];
    if (!parent) {
      error(`Parent ${parentId} not found`);
      return null;
    }

    // Calculate value: parent's value split among all children
    const siblings = parent.children.length + 1; // Include new user
    const childValue = Math.floor(parent.value / (siblings + 1)); // Parent keeps some

    // Update parent's value
    const newParentValue = parent.value - childValue;

    // Create new user
    const newUser = {
      id: userId,
      address: generateUserAddress(userId),
      value: childValue,
      valueFormatted: (childValue / 1_000_000_000).toFixed(9),
      parent: parentId,
      children: [],
      btc_hash: btc.hash,
      btc_height: btc.height,
      created_at: Date.now(),
      frozen: false
    };

    // Update state
    parent.value = newParentValue;
    parent.valueFormatted = (newParentValue / 1_000_000_000).toFixed(9);
    parent.children.push(userId);
    this.state.users[userId] = newUser;

    saveUsers(this.state);

    log(`User ${userId} registered under ${parentId}`);
    log(`Value: ${newUser.valueFormatted} GNTLY-USER`);
    log(`Parent ${parentId} now has: ${parent.valueFormatted} GNTLY-USER`);

    return newUser;
  }

  /**
   * Create a group (fixed supply)
   */
  async createGroup(groupId, members, valueFromParent, parentId, btc) {
    if (this.state.groups[groupId]) {
      warn(`Group ${groupId} already exists`);
      return this.state.groups[groupId];
    }

    const parent = this.state.users[parentId];
    if (!parent || parent.value < valueFromParent) {
      error('Insufficient parent balance');
      return null;
    }

    // Deduct from parent
    parent.value -= valueFromParent;
    parent.valueFormatted = (parent.value / 1_000_000_000).toFixed(9);

    // Calculate per-member value
    const perMemberValue = Math.floor(valueFromParent / members.length);

    // Create group
    const group = {
      id: groupId,
      address: generateUserAddress(`group:${groupId}`),
      totalSupply: valueFromParent, // Fixed, never changes
      parent: parentId,
      members: {},
      btc_hash: btc.hash,
      btc_height: btc.height,
      created_at: Date.now()
    };

    // Add members
    for (const memberId of members) {
      group.members[memberId] = {
        id: memberId,
        address: generateUserAddress(`${groupId}:${memberId}`),
        value: perMemberValue,
        valueFormatted: (perMemberValue / 1_000_000_000).toFixed(9)
      };
    }

    this.state.groups[groupId] = group;
    saveUsers(this.state);

    log(`Group ${groupId} created with ${members.length} members`);
    log(`Fixed supply: ${(valueFromParent / 1_000_000_000).toFixed(9)} GNTLY-USER`);

    return group;
  }

  /**
   * Transfer tokens between users (same group or related)
   *
   * CRITICAL CONSTRAINT:
   * - ROOT can NEVER be pushed from root
   * - ROOT's value can NEVER be reduced below minimum threshold
   * - Values justify privileges - losing value = losing access
   */
  async transfer(fromUserId, toUserId, amount, btc) {
    const fromUser = this.state.users[fromUserId];
    const toUser = this.state.users[toUserId];

    if (!fromUser || !toUser) {
      error('User not found');
      return false;
    }

    // CRITICAL: ROOT can NEVER lose root status
    if (fromUserId === 'ROOT') {
      const minRootValue = ROOT_USER_VALUE * 0.5; // ROOT must keep at least 50%
      if (fromUser.value - amount < minRootValue) {
        error('VIOLATION: ROOT cannot be pushed from root. Minimum 50% must be retained.');
        return false;
      }
    }

    if (fromUser.value < amount) {
      error('Insufficient balance');
      return false;
    }

    // Value justifies privilege - check if transfer would demote user
    const fromUserMinValue = this.getMinPrivilegeValue(fromUserId);
    if (fromUser.value - amount < fromUserMinValue) {
      error(`VIOLATION: Transfer would demote ${fromUserId} below privilege threshold`);
      return false;
    }

    // Transfer
    fromUser.value -= amount;
    fromUser.valueFormatted = (fromUser.value / 1_000_000_000).toFixed(9);
    toUser.value += amount;
    toUser.valueFormatted = (toUser.value / 1_000_000_000).toFixed(9);

    // Record transfer
    const transfer = {
      from: fromUserId,
      to: toUserId,
      amount: amount,
      btc_hash: btc.hash,
      btc_height: btc.height,
      timestamp: Date.now()
    };

    if (!this.state.transfers) this.state.transfers = [];
    this.state.transfers.push(transfer);

    saveUsers(this.state);

    log(`Transfer: ${(amount / 1_000_000_000).toFixed(9)} GNTLY-USER`);
    log(`From ${fromUserId}: ${fromUser.valueFormatted}`);
    log(`To ${toUserId}: ${toUser.valueFormatted}`);

    return true;
  }

  /**
   * Get minimum value required for user's privilege level
   * Values justify privileges - losing value = losing access
   */
  getMinPrivilegeValue(userId) {
    if (userId === 'ROOT') {
      return ROOT_USER_VALUE * 0.5; // ROOT must keep 50%+
    }

    const user = this.state.users[userId];
    if (!user) return 0;

    // Privilege thresholds based on user hierarchy
    // Parent users have higher minimum thresholds
    const depth = this.getUserDepth(userId);

    // Deeper users have lower minimum requirements
    // ROOT (depth 0) = 50%, depth 1 = 25%, depth 2 = 10%, etc.
    const minPercent = Math.max(0.01, 0.5 / Math.pow(2, depth));

    // Get user's original allocation
    const parent = this.state.users[user.parent];
    if (!parent) return 0;

    // User must keep at least minPercent of their original allocation
    // to maintain their privilege level
    return user.value * minPercent;
  }

  /**
   * Get user's depth in hierarchy
   */
  getUserDepth(userId) {
    let depth = 0;
    let current = this.state.users[userId];

    while (current && current.parent) {
      depth++;
      current = this.state.users[current.parent];
    }

    return depth;
  }

  /**
   * Verify total supply (should never change)
   */
  verifySupply() {
    let totalInUsers = 0;
    let totalInGroups = 0;

    for (const user of Object.values(this.state.users)) {
      totalInUsers += user.value;
    }

    for (const group of Object.values(this.state.groups)) {
      for (const member of Object.values(group.members)) {
        totalInGroups += member.value;
      }
    }

    const total = totalInUsers + totalInGroups;
    const expected = this.state.totalSupply;

    log(`Users total: ${(totalInUsers / 1_000_000_000).toFixed(9)}`);
    log(`Groups total: ${(totalInGroups / 1_000_000_000).toFixed(9)}`);
    log(`Combined: ${(total / 1_000_000_000).toFixed(9)}`);
    log(`Expected: ${(expected / 1_000_000_000).toFixed(9)}`);

    if (total > expected) {
      error('SUPPLY VIOLATION: Total exceeds initial supply!');
      return false;
    }

    log('Supply verification: PASSED');
    return true;
  }

  /**
   * Get user tree visualization
   */
  getTreeVisualization() {
    const lines = ['GentlyOS User Hierarchy', ''];

    const renderUser = (userId, depth = 0) => {
      const user = this.state.users[userId];
      if (!user) return;

      const prefix = '│   '.repeat(depth);
      const value = (user.value / 1_000_000_000).toFixed(4);
      lines.push(`${prefix}├── 👤 ${userId} (${value} GNTLY-USER)`);

      for (const childId of user.children) {
        renderUser(childId, depth + 1);
      }
    };

    if (this.state.root) {
      renderUser('ROOT');
    }

    return lines.join('\n');
  }
}

/**
 * CLI Interface
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const minter = new UserMinter();

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║              GentlyOS: USER WALLET MINTER                        ║
╚══════════════════════════════════════════════════════════════════╝
`);

  const btc = await fetchBtcBlock();
  log(`BTC Block: ${btc.height}`);

  switch (command) {
    case 'init':
      await minter.initRootUser(btc);
      break;

    case 'register':
      const userId = args[1];
      const parentId = args[2] || 'ROOT';
      if (!userId) {
        error('Usage: user-mint.js register <userId> [parentId]');
        break;
      }
      await minter.registerUser(userId, parentId, btc);
      break;

    case 'group':
      const groupId = args[1];
      const members = args.slice(2);
      if (!groupId || members.length === 0) {
        error('Usage: user-mint.js group <groupId> <member1> <member2> ...');
        break;
      }
      // Allocate 10% of ROOT to group
      const groupValue = Math.floor(ROOT_USER_VALUE * 0.1);
      await minter.createGroup(groupId, members, groupValue, 'ROOT', btc);
      break;

    case 'transfer':
      const from = args[1];
      const to = args[2];
      const amount = parseInt(args[3]) * 1_000_000_000; // Convert to raw units
      if (!from || !to || !amount) {
        error('Usage: user-mint.js transfer <from> <to> <amount>');
        break;
      }
      await minter.transfer(from, to, amount, btc);
      break;

    case 'verify':
      minter.verifySupply();
      break;

    case 'tree':
      console.log(minter.getTreeVisualization());
      break;

    case 'status':
      log(`ROOT: ${minter.state.root ? 'initialized' : 'not initialized'}`);
      log(`Total users: ${Object.keys(minter.state.users).length}`);
      log(`Total groups: ${Object.keys(minter.state.groups).length}`);
      minter.verifySupply();
      break;

    default:
      console.log(`
Usage:
  user-mint.js init                              Initialize ROOT user
  user-mint.js register <userId> [parentId]      Register new user
  user-mint.js group <groupId> <m1> <m2> ...     Create user group
  user-mint.js transfer <from> <to> <amount>     Transfer tokens
  user-mint.js verify                            Verify supply integrity
  user-mint.js tree                              Show user hierarchy
  user-mint.js status                            Show system status
`);
  }
}

// Export for programmatic use
module.exports = { UserMinter, generateUserAddress };

// Run if called directly
if (require.main === module) {
  main().catch(e => {
    error(`Fatal: ${e.message}`);
    process.exit(1);
  });
}
