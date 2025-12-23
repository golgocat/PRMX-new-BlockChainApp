//! PRMX Chain Specification
//!
//! Defines the genesis configuration and chain parameters.
//!
//! ## API Key Configuration
//!
//! API keys should be configured via environment variables:
//! - `ACCUWEATHER_API_KEY` - AccuWeather API key for rainfall data
//! - `R_PRICING_API_KEY` - R pricing model API key
//! - `R_PRICING_API_URL` - R pricing model API URL (optional)
//!
//! See `.env.example` for a template.

use prmx_runtime::{AccountId, Signature, WASM_BINARY};
use sc_service::ChainType;
use sp_consensus_aura::sr25519::AuthorityId as AuraId;
use sp_consensus_grandpa::AuthorityId as GrandpaId;
use sp_core::{sr25519, Pair, Public};
use sp_runtime::traits::{IdentifyAccount, Verify};
use std::env;

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
        // PRMX Markets - Market Configurations
        // Per design.md section 5.4, markets have center coordinates used by oracle
        "prmxMarkets": {
            "markets": vec![
                serde_json::json!({
                    // Manila, Philippines - Rainfall Insurance Market (market_id = 0)
                    // Has R actuarial model support
                    "name": "Manila".as_bytes(),
                    // Center coordinates: 14.5995° N, 120.9842° E
                    // Scaled by 1e6 for precision
                    "centerLatitude": 14_599_500i32,
                    "centerLongitude": 120_984_200i32,
                    // Timezone: UTC+8 (Philippines Standard Time)
                    "timezoneOffsetHours": 8i8,
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
                serde_json::json!({
                    // Amsterdam, Netherlands - Rainfall Insurance Market (market_id = 1)
                    // No R actuarial model yet - uses fixed 1% probability benchmark
                    "name": "Amsterdam".as_bytes(),
                    // Center coordinates: 52.3676° N, 4.9041° E
                    // Scaled by 1e6 for precision
                    "centerLatitude": 52_367_600i32,
                    "centerLongitude": 4_904_100i32,
                    // Timezone: UTC+1 (Central European Time, simplified - ignoring DST)
                    "timezoneOffsetHours": 1i8,
                    // Strike value: 50mm rainfall in 24h triggers payout
                    // Oracle stores rainfall scaled by 10, so 50mm = 500
                    "strikeValue": 500u32,
                    // Payout per share: 100 USDT (in smallest units)
                    "payoutPerShare": PAYOUT_PER_SHARE,
                    // Base asset: USDT
                    "baseAsset": USDT_ASSET_ID,
                    // DAO margin: 20% = 2000 basis points
                    "daoMarginBp": 2000u32,
                    // Coverage window rules (relaxed for testing)
                    "minDurationSecs": 60u32,
                    "maxDurationSecs": 604_800u32,
                    "minLeadTimeSecs": 0u32,
                }),
                serde_json::json!({
                    // Tokyo, Japan - Rainfall Insurance Market (market_id = 2)
                    // No R actuarial model yet - uses fixed 1% probability benchmark
                    "name": "Tokyo".as_bytes(),
                    // Center coordinates: 35.6762° N, 139.6503° E
                    // Scaled by 1e6 for precision
                    "centerLatitude": 35_676_200i32,
                    "centerLongitude": 139_650_300i32,
                    // Timezone: UTC+9 (Japan Standard Time)
                    "timezoneOffsetHours": 9i8,
                    // Strike value: 50mm rainfall in 24h triggers payout
                    // Oracle stores rainfall scaled by 10, so 50mm = 500
                    "strikeValue": 500u32,
                    // Payout per share: 100 USDT (in smallest units)
                    "payoutPerShare": PAYOUT_PER_SHARE,
                    // Base asset: USDT
                    "baseAsset": USDT_ASSET_ID,
                    // DAO margin: 20% = 2000 basis points
                    "daoMarginBp": 2000u32,
                    // Coverage window rules (relaxed for testing)
                    "minDurationSecs": 60u32,
                    "maxDurationSecs": 604_800u32,
                    "minLeadTimeSecs": 0u32,
                }),
                serde_json::json!({
                    // Singapore - Rainfall Insurance Market (market_id = 3)
                    // No R actuarial model yet - uses fixed 1% probability benchmark
                    "name": "Singapore".as_bytes(),
                    // Center coordinates: 1.3521° N, 103.8198° E
                    // Scaled by 1e6 for precision
                    "centerLatitude": 1_352_100i32,
                    "centerLongitude": 103_819_800i32,
                    // Timezone: UTC+8 (Singapore Standard Time)
                    "timezoneOffsetHours": 8i8,
                    // Strike value: 50mm rainfall in 24h triggers payout
                    // Oracle stores rainfall scaled by 10, so 50mm = 500
                    "strikeValue": 500u32,
                    // Payout per share: 100 USDT (in smallest units)
                    "payoutPerShare": PAYOUT_PER_SHARE,
                    // Base asset: USDT
                    "baseAsset": USDT_ASSET_ID,
                    // DAO margin: 20% = 2000 basis points
                    "daoMarginBp": 2000u32,
                    // Coverage window rules (relaxed for testing)
                    "minDurationSecs": 60u32,
                    "maxDurationSecs": 604_800u32,
                    "minLeadTimeSecs": 0u32,
                }),
                serde_json::json!({
                    // Jakarta, Indonesia - Rainfall Insurance Market (market_id = 4)
                    // No R actuarial model yet - uses fixed 1% probability benchmark
                    "name": "Jakarta".as_bytes(),
                    // Center coordinates: 6.2088° S, 106.8456° E
                    // Scaled by 1e6 for precision (negative for southern hemisphere)
                    "centerLatitude": -6_208_800i32,
                    "centerLongitude": 106_845_600i32,
                    // Timezone: UTC+7 (Western Indonesia Time)
                    "timezoneOffsetHours": 7i8,
                    // Strike value: 50mm rainfall in 24h triggers payout
                    // Oracle stores rainfall scaled by 10, so 50mm = 500
                    "strikeValue": 500u32,
                    // Payout per share: 100 USDT (in smallest units)
                    "payoutPerShare": PAYOUT_PER_SHARE,
                    // Base asset: USDT
                    "baseAsset": USDT_ASSET_ID,
                    // DAO margin: 20% = 2000 basis points
                    "daoMarginBp": 2000u32,
                    // Coverage window rules (relaxed for testing)
                    "minDurationSecs": 60u32,
                    "maxDurationSecs": 604_800u32,
                    "minLeadTimeSecs": 0u32,
                }),
                serde_json::json!({
                    // Dubai, UAE - Rainfall Insurance Market (market_id = 5)
                    // No R actuarial model yet - uses fixed 1% probability benchmark
                    "name": "Dubai".as_bytes(),
                    // Center coordinates: 25.2048° N, 55.2708° E
                    // Scaled by 1e6 for precision
                    "centerLatitude": 25_204_800i32,
                    "centerLongitude": 55_270_800i32,
                    // Timezone: UTC+4 (Gulf Standard Time)
                    "timezoneOffsetHours": 4i8,
                    // Strike value: 50mm rainfall in 24h triggers payout
                    // Oracle stores rainfall scaled by 10, so 50mm = 500
                    "strikeValue": 500u32,
                    // Payout per share: 100 USDT (in smallest units)
                    "payoutPerShare": PAYOUT_PER_SHARE,
                    // Base asset: USDT
                    "baseAsset": USDT_ASSET_ID,
                    // DAO margin: 20% = 2000 basis points
                    "daoMarginBp": 2000u32,
                    // Coverage window rules (relaxed for testing)
                    "minDurationSecs": 60u32,
                    "maxDurationSecs": 604_800u32,
                    "minLeadTimeSecs": 0u32,
                }),
            ],
        },
        // PRMX Oracle - Oracle Configuration
        // Register oracle providers and configure AccuWeather API
        "prmxOracle": {
            // Oracle providers (accounts authorized for signed transactions from OCW)
            "oracleProviders": vec![
                endowed_accounts[0].clone(), // Alice
            ],
            // AccuWeather API key from environment variable
            "accuweatherApiKey": env::var("ACCUWEATHER_API_KEY")
                .map(|k| k.into_bytes())
                .unwrap_or_else(|_| {
                    log::warn!("⚠️ ACCUWEATHER_API_KEY not set. Oracle rainfall fetching will not work.");
                    Vec::new()
                }),
        },
        // PRMX Quote - R Pricing API Configuration
        // Configure the R actuarial pricing model API for quote calculations
        // API keys are loaded from environment variables for security
        "prmxQuote": {
            // R pricing API key from environment (falls back to placeholder if not set)
            "pricingApiKey": env::var("R_PRICING_API_KEY")
                .map(|k| k.into_bytes())
                .unwrap_or_else(|_| {
                    log::warn!("⚠️ R_PRICING_API_KEY not set. Quote pricing will not work.");
                    b"NOT_CONFIGURED".to_vec()
                }),
            // R pricing API URL from environment (falls back to default)
            "pricingApiUrl": env::var("R_PRICING_API_URL")
                .map(|u| u.into_bytes())
                .unwrap_or_else(|_| b"http://34.51.195.144:19090/pricing".to_vec()),
            // Quote providers (accounts authorized to submit quote results from OCW)
            "quoteProviders": vec![
                endowed_accounts[0].clone(), // Alice
            ],
        },
    })
}
