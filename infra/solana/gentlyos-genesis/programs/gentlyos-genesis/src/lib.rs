use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer, MintTo};

declare_id!("GENTLYosxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

/// GentlyOS Genesis Program
///
/// Manages two token layers:
/// 1. GNTLY-OS: Immutable OS-level tokens (frozen, non-transferable)
/// 2. GNTLY-USER: Tradeable user-level tokens (transferable within groups)
///
/// Every OS event is audited with BTC block + timestamp

#[program]
pub mod gentlyos_genesis {
    use super::*;

    /// Initialize the OS genesis state
    /// Called once at first boot
    pub fn initialize(
        ctx: Context<Initialize>,
        version: String,
        serial: String,
        btc_block_hash: String,
        btc_block_height: u64,
    ) -> Result<()> {
        let genesis = &mut ctx.accounts.genesis;

        genesis.version = version;
        genesis.serial = serial;
        genesis.btc_block_hash = btc_block_hash;
        genesis.btc_block_height = btc_block_height;
        genesis.spawn_order = 1; // First instance
        genesis.genesis_timestamp = Clock::get()?.unix_timestamp;
        genesis.authority = ctx.accounts.authority.key();
        genesis.os_mint = ctx.accounts.os_mint.key();
        genesis.user_mint = ctx.accounts.user_mint.key();
        genesis.total_os_supply = 0;
        genesis.total_user_supply = 0;
        genesis.total_wallets = 0;
        genesis.is_initialized = true;

        emit!(GenesisEvent {
            event_type: "GENESIS_INIT".to_string(),
            btc_block_hash: genesis.btc_block_hash.clone(),
            btc_block_height: genesis.btc_block_height,
            timestamp: genesis.genesis_timestamp,
        });

        Ok(())
    }

    /// Mint a wallet for an OS file/folder (immutable)
    pub fn mint_os_wallet(
        ctx: Context<MintOsWallet>,
        path: String,
        value: u64,
        btc_hash: String,
        btc_height: u64,
    ) -> Result<()> {
        let wallet = &mut ctx.accounts.os_wallet;
        let genesis = &mut ctx.accounts.genesis;

        wallet.path = path.clone();
        wallet.value = value;
        wallet.btc_hash = btc_hash.clone();
        wallet.btc_height = btc_height;
        wallet.timestamp = Clock::get()?.unix_timestamp;
        wallet.is_frozen = true; // OS wallets are always frozen
        wallet.wallet_type = WalletType::Os;
        wallet.owner = ctx.accounts.genesis.key();

        // Mint tokens to wallet
        let cpi_accounts = MintTo {
            mint: ctx.accounts.os_mint.to_account_info(),
            to: ctx.accounts.os_token_account.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::mint_to(cpi_ctx, value)?;

        genesis.total_os_supply += value;
        genesis.total_wallets += 1;

        emit!(WalletMintEvent {
            event_type: "WALLET_MINT_OS".to_string(),
            path,
            value,
            btc_hash,
            btc_height,
            timestamp: wallet.timestamp,
        });

        Ok(())
    }

    /// Mint a wallet for a user (tradeable)
    pub fn mint_user_wallet(
        ctx: Context<MintUserWallet>,
        user_id: String,
        parent_wallet: Option<Pubkey>,
        value: u64,
        btc_hash: String,
        btc_height: u64,
    ) -> Result<()> {
        let wallet = &mut ctx.accounts.user_wallet;
        let genesis = &mut ctx.accounts.genesis;

        wallet.path = user_id.clone();
        wallet.value = value;
        wallet.btc_hash = btc_hash.clone();
        wallet.btc_height = btc_height;
        wallet.timestamp = Clock::get()?.unix_timestamp;
        wallet.is_frozen = false; // User wallets are tradeable
        wallet.wallet_type = WalletType::User;
        wallet.owner = ctx.accounts.user.key();
        wallet.parent = parent_wallet;

        // Mint tokens to user
        let cpi_accounts = MintTo {
            mint: ctx.accounts.user_mint.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::mint_to(cpi_ctx, value)?;

        genesis.total_user_supply += value;
        genesis.total_wallets += 1;

        emit!(WalletMintEvent {
            event_type: "WALLET_MINT_USER".to_string(),
            path: user_id,
            value,
            btc_hash,
            btc_height,
            timestamp: wallet.timestamp,
        });

        Ok(())
    }

    /// Record a BTC checkpoint (for event auditing)
    pub fn btc_checkpoint(
        ctx: Context<BtcCheckpoint>,
        checkpoint_name: String,
        btc_hash: String,
        btc_height: u64,
        event_data: String,
    ) -> Result<()> {
        let checkpoint = &mut ctx.accounts.checkpoint;

        checkpoint.name = checkpoint_name.clone();
        checkpoint.btc_hash = btc_hash.clone();
        checkpoint.btc_height = btc_height;
        checkpoint.timestamp = Clock::get()?.unix_timestamp;
        checkpoint.event_data = event_data;
        checkpoint.genesis = ctx.accounts.genesis.key();

        emit!(CheckpointEvent {
            checkpoint_name,
            btc_hash,
            btc_height,
            timestamp: checkpoint.timestamp,
        });

        Ok(())
    }

    /// Transfer user tokens (only between users, fixed supply)
    pub fn transfer_user_tokens(
        ctx: Context<TransferUserTokens>,
        amount: u64,
        btc_hash: String,
        btc_height: u64,
    ) -> Result<()> {
        // Ensure we're not changing total supply
        require!(
            ctx.accounts.from_wallet.wallet_type == WalletType::User,
            GenesisError::InvalidWalletType
        );
        require!(
            ctx.accounts.to_wallet.wallet_type == WalletType::User,
            GenesisError::InvalidWalletType
        );

        // Transfer tokens
        let cpi_accounts = Transfer {
            from: ctx.accounts.from_token_account.to_account_info(),
            to: ctx.accounts.to_token_account.to_account_info(),
            authority: ctx.accounts.from_owner.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Update wallet values
        ctx.accounts.from_wallet.value -= amount;
        ctx.accounts.to_wallet.value += amount;

        emit!(TransferEvent {
            event_type: "TOKEN_TRANSFER".to_string(),
            from: ctx.accounts.from_wallet.path.clone(),
            to: ctx.accounts.to_wallet.path.clone(),
            amount,
            btc_hash,
            btc_height,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Audit an OS event
    pub fn audit_event(
        ctx: Context<AuditEvent>,
        event_type: String,
        target: String,
        btc_hash: String,
        btc_height: u64,
    ) -> Result<()> {
        let audit = &mut ctx.accounts.audit;

        audit.event_type = event_type.clone();
        audit.target = target.clone();
        audit.actor = ctx.accounts.actor.key();
        audit.btc_hash = btc_hash.clone();
        audit.btc_height = btc_height;
        audit.timestamp = Clock::get()?.unix_timestamp;

        emit!(AuditLogEvent {
            event_type,
            target,
            actor: audit.actor,
            btc_hash,
            btc_height,
            timestamp: audit.timestamp,
        });

        Ok(())
    }
}

// ============================================
// ACCOUNTS
// ============================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Genesis::SIZE,
        seeds = [b"genesis"],
        bump
    )]
    pub genesis: Account<'info, Genesis>,

    #[account(mut)]
    pub os_mint: Account<'info, Mint>,

    #[account(mut)]
    pub user_mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(path: String)]
pub struct MintOsWallet<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Wallet::SIZE,
        seeds = [b"os_wallet", path.as_bytes()],
        bump
    )]
    pub os_wallet: Account<'info, Wallet>,

    #[account(mut)]
    pub genesis: Account<'info, Genesis>,

    #[account(mut)]
    pub os_mint: Account<'info, Mint>,

    #[account(mut)]
    pub os_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(user_id: String)]
pub struct MintUserWallet<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Wallet::SIZE,
        seeds = [b"user_wallet", user_id.as_bytes()],
        bump
    )]
    pub user_wallet: Account<'info, Wallet>,

    #[account(mut)]
    pub genesis: Account<'info, Genesis>,

    #[account(mut)]
    pub user_mint: Account<'info, Mint>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: User account
    pub user: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(checkpoint_name: String)]
pub struct BtcCheckpoint<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Checkpoint::SIZE,
        seeds = [b"checkpoint", checkpoint_name.as_bytes()],
        bump
    )]
    pub checkpoint: Account<'info, Checkpoint>,

    pub genesis: Account<'info, Genesis>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TransferUserTokens<'info> {
    #[account(mut)]
    pub from_wallet: Account<'info, Wallet>,

    #[account(mut)]
    pub to_wallet: Account<'info, Wallet>,

    #[account(mut)]
    pub from_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub to_token_account: Account<'info, TokenAccount>,

    pub from_owner: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AuditEvent<'info> {
    #[account(
        init,
        payer = actor,
        space = 8 + AuditLog::SIZE
    )]
    pub audit: Account<'info, AuditLog>,

    #[account(mut)]
    pub actor: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ============================================
// STATE
// ============================================

#[account]
pub struct Genesis {
    pub version: String,           // "0.1.0"
    pub serial: String,            // BTC_HASH[:16] + timestamp
    pub btc_block_hash: String,    // Full BTC block hash
    pub btc_block_height: u64,     // BTC block height
    pub spawn_order: u64,          // Which instance (1, 2, 3...)
    pub genesis_timestamp: i64,    // Unix timestamp
    pub authority: Pubkey,         // Genesis authority
    pub os_mint: Pubkey,           // OS token mint
    pub user_mint: Pubkey,         // User token mint
    pub total_os_supply: u64,      // Total OS tokens minted
    pub total_user_supply: u64,    // Total User tokens minted
    pub total_wallets: u64,        // Total wallets created
    pub is_initialized: bool,
}

impl Genesis {
    pub const SIZE: usize = 32 + 64 + 128 + 8 + 8 + 8 + 32 + 32 + 32 + 8 + 8 + 8 + 1;
}

#[account]
pub struct Wallet {
    pub path: String,              // File path or user ID
    pub value: u64,                // Token value
    pub btc_hash: String,          // BTC block at creation
    pub btc_height: u64,           // BTC block height
    pub timestamp: i64,            // Creation timestamp
    pub is_frozen: bool,           // Frozen for OS, unfrozen for User
    pub wallet_type: WalletType,   // OS or User
    pub owner: Pubkey,             // Owner (genesis for OS, user for User)
    pub parent: Option<Pubkey>,    // Parent wallet (for hierarchy)
}

impl Wallet {
    pub const SIZE: usize = 256 + 8 + 128 + 8 + 8 + 1 + 1 + 32 + 33;
}

#[account]
pub struct Checkpoint {
    pub name: String,              // Checkpoint name
    pub btc_hash: String,          // BTC block hash
    pub btc_height: u64,           // BTC block height
    pub timestamp: i64,            // Checkpoint timestamp
    pub event_data: String,        // Associated event data
    pub genesis: Pubkey,           // Genesis account
}

impl Checkpoint {
    pub const SIZE: usize = 64 + 128 + 8 + 8 + 256 + 32;
}

#[account]
pub struct AuditLog {
    pub event_type: String,        // FILE_CREATE, FILE_MODIFY, etc.
    pub target: String,            // Target path/ID
    pub actor: Pubkey,             // Who triggered
    pub btc_hash: String,          // BTC block hash
    pub btc_height: u64,           // BTC block height
    pub timestamp: i64,            // Event timestamp
}

impl AuditLog {
    pub const SIZE: usize = 32 + 256 + 32 + 128 + 8 + 8;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum WalletType {
    Os,
    User,
}

// ============================================
// EVENTS
// ============================================

#[event]
pub struct GenesisEvent {
    pub event_type: String,
    pub btc_block_hash: String,
    pub btc_block_height: u64,
    pub timestamp: i64,
}

#[event]
pub struct WalletMintEvent {
    pub event_type: String,
    pub path: String,
    pub value: u64,
    pub btc_hash: String,
    pub btc_height: u64,
    pub timestamp: i64,
}

#[event]
pub struct CheckpointEvent {
    pub checkpoint_name: String,
    pub btc_hash: String,
    pub btc_height: u64,
    pub timestamp: i64,
}

#[event]
pub struct TransferEvent {
    pub event_type: String,
    pub from: String,
    pub to: String,
    pub amount: u64,
    pub btc_hash: String,
    pub btc_height: u64,
    pub timestamp: i64,
}

#[event]
pub struct AuditLogEvent {
    pub event_type: String,
    pub target: String,
    pub actor: Pubkey,
    pub btc_hash: String,
    pub btc_height: u64,
    pub timestamp: i64,
}

// ============================================
// ERRORS
// ============================================

#[error_code]
pub enum GenesisError {
    #[msg("Invalid wallet type for this operation")]
    InvalidWalletType,
    #[msg("Wallet is frozen and cannot be modified")]
    WalletFrozen,
    #[msg("Insufficient token balance")]
    InsufficientBalance,
    #[msg("Genesis already initialized")]
    AlreadyInitialized,
}
