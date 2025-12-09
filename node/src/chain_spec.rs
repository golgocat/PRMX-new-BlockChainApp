//! PRMX Chain Specification
//!
//! Defines the genesis configuration and chain parameters.

use prmx_runtime::{AccountId, Signature, WASM_BINARY};
use sc_service::ChainType;
use sp_consensus_aura::sr25519::AuthorityId as AuraId;
use sp_consensus_grandpa::AuthorityId as GrandpaId;
use sp_core::{sr25519, Pair, Public};
use sp_runtime::traits::{IdentifyAccount, Verify};

/// Specialized `ChainSpec`. This is a specialization of the general Substrate ChainSpec type.
pub type ChainSpec = sc_service::GenericChainSpec;

/// Generate a crypto pair from seed.
pub fn get_from_seed<TPublic: Public>(seed: &str) -> <TPublic::Pair as Pair>::Public {
    TPublic::Pair::from_string(&format!("//{}", seed), None)
        .expect("static values are valid; qed")
        .public()
}

type AccountPublic = <Signature as Verify>::Signer;

/// Generate an account ID from seed.
pub fn get_account_id_from_seed<TPublic: Public>(seed: &str) -> AccountId
where
    AccountPublic: From<<TPublic::Pair as Pair>::Public>,
{
    AccountPublic::from(get_from_seed::<TPublic>(seed)).into_account()
}

/// Generate an Aura authority key.
pub fn authority_keys_from_seed(s: &str) -> (AuraId, GrandpaId) {
    (get_from_seed::<AuraId>(s), get_from_seed::<GrandpaId>(s))
}

/// Development chain config.
pub fn development_config() -> Result<ChainSpec, String> {
    Ok(ChainSpec::builder(
        WASM_BINARY.ok_or_else(|| "Development wasm not available".to_string())?,
        None,
    )
    .with_name("PRMX Development")
    .with_id("prmx_dev")
    .with_chain_type(ChainType::Development)
    .with_genesis_config_patch(testnet_genesis(
        // Initial authorities
        vec![authority_keys_from_seed("Alice")],
        // Sudo account
        get_account_id_from_seed::<sr25519::Public>("Alice"),
        // Pre-funded accounts
        vec![
            get_account_id_from_seed::<sr25519::Public>("Alice"),
            get_account_id_from_seed::<sr25519::Public>("Bob"),
            get_account_id_from_seed::<sr25519::Public>("Charlie"),
            get_account_id_from_seed::<sr25519::Public>("Dave"),
            get_account_id_from_seed::<sr25519::Public>("Eve"),
            get_account_id_from_seed::<sr25519::Public>("Ferdie"),
        ],
        true,
    ))
    .build())
}

/// Local testnet config.
pub fn local_testnet_config() -> Result<ChainSpec, String> {
    Ok(ChainSpec::builder(
        WASM_BINARY.ok_or_else(|| "Development wasm not available".to_string())?,
        None,
    )
    .with_name("PRMX Local Testnet")
    .with_id("prmx_local_testnet")
    .with_chain_type(ChainType::Local)
    .with_genesis_config_patch(testnet_genesis(
        // Initial authorities
        vec![
            authority_keys_from_seed("Alice"),
            authority_keys_from_seed("Bob"),
        ],
        // Sudo account
        get_account_id_from_seed::<sr25519::Public>("Alice"),
        // Pre-funded accounts
        vec![
            get_account_id_from_seed::<sr25519::Public>("Alice"),
            get_account_id_from_seed::<sr25519::Public>("Bob"),
            get_account_id_from_seed::<sr25519::Public>("Charlie"),
            get_account_id_from_seed::<sr25519::Public>("Dave"),
            get_account_id_from_seed::<sr25519::Public>("Eve"),
            get_account_id_from_seed::<sr25519::Public>("Ferdie"),
        ],
        true,
    ))
    .build())
}

/// Configure initial storage state for FRAME pallets.
fn testnet_genesis(
    initial_authorities: Vec<(AuraId, GrandpaId)>,
    root_key: AccountId,
    endowed_accounts: Vec<AccountId>,
    _enable_println: bool,
) -> serde_json::Value {
    // Initial PRMX balance for endowed accounts
    const ENDOWMENT: u128 = 1_000_000_000_000_000_000_000; // 1000 PRMX with 18 decimals
    const USDT_ASSET_ID: u32 = 1;
    const USDT_DECIMALS: u8 = 6;
    const USDT_MULTIPLIER: u128 = 1_000_000;

    // Market parameters
    const PAYOUT_PER_SHARE: u128 = 100 * USDT_MULTIPLIER; // 100 USDT per share

    let alice = endowed_accounts[0].clone();
    let bob = endowed_accounts[1].clone();
    let charlie = endowed_accounts[2].clone();
    let dave = endowed_accounts[3].clone();

    // Single DAO account (must match runtime configuration)
    // Both DaoAccountId and DaoCapitalAccountId = [0u8; 32]
    let dao_account = AccountId::from([0u8; 32]);

    serde_json::json!({
        "balances": {
            "balances": endowed_accounts
                .iter()
                .cloned()
                .chain(vec![dao_account.clone()])
                .map(|k| (k, ENDOWMENT))
                .collect::<Vec<_>>(),
        },
        "aura": {
            "authorities": initial_authorities.iter().map(|x| x.0.clone()).collect::<Vec<_>>(),
        },
        "grandpa": {
            "authorities": initial_authorities
                .iter()
                .map(|x| (x.1.clone(), 1))
                .collect::<Vec<_>>(),
        },
        "sudo": {
            "key": Some(root_key),
        },
        "assets": {
            "assets": vec![
                // [id, owner, is_sufficient, min_balance]
                (USDT_ASSET_ID, alice.clone(), true, 1u128),
            ],
            "metadata": vec![
                // [id, name, symbol, decimals]
                (USDT_ASSET_ID, "Tether USD".as_bytes(), "USDT".as_bytes(), USDT_DECIMALS),
            ],
            "accounts": vec![
                // [id, account, balance]
                (USDT_ASSET_ID, alice, 100_000_000 * USDT_MULTIPLIER),       // DAO Admin
                (USDT_ASSET_ID, bob, 10_000 * USDT_MULTIPLIER),              // Customer
                (USDT_ASSET_ID, charlie, 1_000_000 * USDT_MULTIPLIER),       // LP 1
                (USDT_ASSET_ID, dave, 1_000_000 * USDT_MULTIPLIER),          // LP 2
                (USDT_ASSET_ID, dao_account, 60_000_000 * USDT_MULTIPLIER),  // DAO (combined treasury + capital)
            ],
        },
        // PRMX Markets - Manila Market Configuration
        // Per design.md section 5.4, markets have center coordinates used by oracle
        "prmxMarkets": {
            "markets": vec![
                serde_json::json!({
                    // Manila, Philippines - Rainfall Insurance Market
                    "name": "Manila".as_bytes(),
                    // Center coordinates: 14.5995° N, 120.9842° E
                    // Scaled by 1e6 for precision
                    "centerLatitude": 14_599_500i32,
                    "centerLongitude": 120_984_200i32,
                    // Strike value: 50mm rainfall in 24h triggers payout
                    // Oracle stores rainfall scaled by 10, so 50mm = 500
                    "strikeValue": 500u32,
                    // Payout per share: 100 USDT (in smallest units)
                    "payoutPerShare": PAYOUT_PER_SHARE,
                    // Base asset: USDT
                    "baseAsset": USDT_ASSET_ID,
                    // DAO margin: 20% = 2000 basis points
                    "daoMarginBp": 2000u32,
                    // Coverage window rules (relaxed for testing):
                    // Min duration: 60 seconds for testing (normally 1 day = 86,400)
                    "minDurationSecs": 60u32,
                    // Max duration: 7 days = 604,800 seconds
                    "maxDurationSecs": 604_800u32,
                    // Min lead time: 0 for testing (normally 21 days = 1,814,400 seconds)
                    "minLeadTimeSecs": 0u32,
                }),
            ],
        },
        // PRMX Oracle - Oracle Providers
        // Register Alice as an oracle provider for offchain worker signed transactions
        "prmxOracle": {
            "oracleProviders": vec![
                endowed_accounts[0].clone(), // Alice
            ],
        },
    })
}
