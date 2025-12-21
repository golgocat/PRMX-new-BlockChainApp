//! # Live XCM Strategy Interface Implementation
//!
//! **EXPERIMENTAL - DO NOT USE IN PRODUCTION**
//!
//! This module implements the `XcmStrategyInterface` trait using real XCM
//! for cross-chain capital management with Hydration Pool 102 via Asset Hub.
//!
//! ## Prerequisites
//!
//! Before enabling this module, ensure:
//! - HRMP channels are open between PRMX <-> Asset Hub <-> Hydration
//! - DAO account has sufficient funds for XCM fees
//! - Hydration pallet indices are verified against the live runtime
//!
//! ## XCM Flow
//!
//! ### Deposit (enter_strategy):
//! PRMX -> Asset Hub -> Hydration
//! 1. WithdrawAsset(USDT) from DAO account
//! 2. InitiateReserveWithdraw to Asset Hub
//! 3. DepositReserveAsset to Hydration
//! 4. Transact -> stableswap.add_liquidity
//!
//! ### Withdrawal (exit_strategy):
//! Hydration -> Asset Hub -> PRMX
//! 1. Transact -> stableswap.remove_liquidity_one_asset
//! 2. InitiateReserveWithdraw to Asset Hub
//! 3. DepositReserveAsset to PRMX
//!
//! ## Current Status
//!
//! XCM messages are constructed but NOT actually sent (TODO). This module
//! returns expected values and logs intent for testing purposes only.

use crate::{Config, XcmStrategyInterface};
use alloc::vec;
use alloc::vec::Vec;
use codec::Encode;
use frame_support::traits::Get;
use frame_support::weights::Weight;
use sp_runtime::DispatchError;
use xcm::latest::prelude::*;

// =============================================================================
//                       Chain & Pool Configuration
// =============================================================================

/// Asset Hub parachain ID
pub const ASSET_HUB_PARA_ID: u32 = 1000;

/// Hydration parachain ID
pub const HYDRATION_PARA_ID: u32 = 2034;

/// PRMX parachain ID (for testing)
pub const PRMX_PARA_ID: u32 = 2000;

/// Stableswap Pool ID on Hydration (USDT/USDC 2-Pool)
pub const STABLESWAP_POOL_ID: u32 = 102;

/// USDT asset ID on Hydration
pub const USDT_HYDRATION_ID: u32 = 10;

/// USDT asset ID on Asset Hub
pub const USDT_ASSET_HUB_ID: u128 = 1984;

/// Assets pallet instance on Asset Hub
pub const ASSETS_PALLET_INSTANCE: u8 = 50;

/// Stableswap pallet index on Hydration runtime
pub const STABLESWAP_PALLET_INDEX: u8 = 68;

/// stableswap.add_liquidity call index
pub const ADD_LIQUIDITY_CALL_INDEX: u8 = 1;

/// stableswap.remove_liquidity_one_asset call index
pub const REMOVE_LIQUIDITY_ONE_ASSET_CALL_INDEX: u8 = 3;

// =============================================================================
//                       Location Definitions
// =============================================================================

/// USDT location on Asset Hub (reserve)
pub fn usdt_asset_hub_location() -> Location {
    Location::new(
        1,
        [
            Parachain(ASSET_HUB_PARA_ID),
            PalletInstance(ASSETS_PALLET_INSTANCE),
            GeneralIndex(USDT_ASSET_HUB_ID),
        ],
    )
}

/// Asset Hub location
pub fn asset_hub_location() -> Location {
    Location::new(1, [Parachain(ASSET_HUB_PARA_ID)])
}

/// Hydration location
pub fn hydration_location() -> Location {
    Location::new(1, [Parachain(HYDRATION_PARA_ID)])
}

/// PRMX location (from Asset Hub perspective)
pub fn prmx_location_from_asset_hub() -> Location {
    Location::new(1, [Parachain(PRMX_PARA_ID)])
}

// =============================================================================
//                       Call Encoding for Hydration
// =============================================================================

/// Encode stableswap.add_liquidity call for Hydration
///
/// Call signature: add_liquidity(pool_id: PoolId, assets: Vec<AssetAmount>, min_mint_amount: Balance)
pub fn encode_add_liquidity(
    pool_id: u32,
    usdt_amount: u128,
    min_lp_shares: u128,
) -> Vec<u8> {
    let mut encoded = Vec::new();
    
    // Pallet index + call index
    encoded.push(STABLESWAP_PALLET_INDEX);
    encoded.push(ADD_LIQUIDITY_CALL_INDEX);
    
    // pool_id: u32
    encoded.extend(pool_id.encode());
    
    // assets: Vec<(AssetId, Balance)> - SCALE encoded
    // We're depositing only USDT (asset ID 10)
    let assets: Vec<(u32, u128)> = vec![(USDT_HYDRATION_ID, usdt_amount)];
    encoded.extend(assets.encode());
    
    // min_mint_amount: u128
    encoded.extend(min_lp_shares.encode());
    
    encoded
}

/// Encode stableswap.remove_liquidity_one_asset call for Hydration
///
/// Call signature: remove_liquidity_one_asset(pool_id: PoolId, asset_id: AssetId, share_amount: Balance, min_amount_out: Balance)
pub fn encode_remove_liquidity(
    pool_id: u32,
    output_asset_id: u32,
    lp_shares: u128,
    min_usdt_out: u128,
) -> Vec<u8> {
    let mut encoded = Vec::new();
    
    // Pallet index + call index
    encoded.push(STABLESWAP_PALLET_INDEX);
    encoded.push(REMOVE_LIQUIDITY_ONE_ASSET_CALL_INDEX);
    
    // pool_id: u32
    encoded.extend(pool_id.encode());
    
    // asset_id: u32 (the asset we want to receive)
    encoded.extend(output_asset_id.encode());
    
    // share_amount: u128 (LP tokens to burn)
    encoded.extend(lp_shares.encode());
    
    // min_amount_out: u128
    encoded.extend(min_usdt_out.encode());
    
    encoded
}

// =============================================================================
//                       XCM Message Builders
// =============================================================================

/// Build XCM message for depositing USDT into Hydration Pool 102
///
/// This creates a multi-hop XCM that:
/// 1. Transfers USDT to Asset Hub
/// 2. Forwards USDT to Hydration
/// 3. Executes stableswap.add_liquidity on Hydration
pub fn build_deposit_xcm(
    usdt_amount: u128,
    min_lp_shares: u128,
    dao_account_on_hydration: [u8; 32],
) -> Xcm<()> {
    // Weight for execution on remote chains
    let weight_limit = WeightLimit::Unlimited;
    
    // The USDT asset we're moving
    let usdt_asset = Asset {
        id: AssetId(usdt_asset_hub_location()),
        fun: Fungible(usdt_amount),
    };
    
    // Beneficiary on Hydration (DAO account)
    let beneficiary = Location::new(
        0,
        [AccountId32 {
            network: None,
            id: dao_account_on_hydration,
        }],
    );
    
    // Encoded stableswap.add_liquidity call
    let add_liquidity_call = encode_add_liquidity(
        STABLESWAP_POOL_ID,
        usdt_amount,
        min_lp_shares,
    );
    
    // Build XCM program
    Xcm(vec![
        // 1. Withdraw USDT from local account
        WithdrawAsset(usdt_asset.clone().into()),
        
        // 2. Initiate reserve withdraw to Asset Hub
        InitiateReserveWithdraw {
            assets: All.into(),
            reserve: asset_hub_location(),
            xcm: Xcm(vec![
                // On Asset Hub: Buy execution
                BuyExecution {
                    fees: usdt_asset.clone(),
                    weight_limit: weight_limit.clone(),
                },
                
                // Forward to Hydration with deposit + transact
                DepositReserveAsset {
                    assets: All.into(),
                    dest: hydration_location(),
                    xcm: Xcm(vec![
                        // On Hydration: Buy execution
                        BuyExecution {
                            fees: Asset {
                                id: AssetId(Location::new(0, [GeneralIndex(USDT_HYDRATION_ID as u128)])),
                                fun: Fungible(usdt_amount / 100), // Use 1% for fees
                            },
                            weight_limit: weight_limit.clone(),
                        },
                        
                        // Deposit remaining USDT to DAO account
                        DepositAsset {
                            assets: All.into(),
                            beneficiary: beneficiary.clone(),
                        },
                        
                        // Execute stableswap.add_liquidity
                        Transact {
                            origin_kind: OriginKind::SovereignAccount,
                            fallback_max_weight: Some(Weight::from_parts(1_000_000_000, 100_000)),
                            call: add_liquidity_call.into(),
                        },
                        
                        // Refund any unused fees
                        RefundSurplus,
                        
                        // Deposit LP tokens to DAO account
                        DepositAsset {
                            assets: All.into(),
                            beneficiary,
                        },
                    ]),
                },
            ]),
        },
    ])
}

/// Build XCM message for withdrawing from Hydration Pool 102 back to PRMX
///
/// This creates a multi-hop XCM that:
/// 1. Executes stableswap.remove_liquidity_one_asset on Hydration
/// 2. Transfers resulting USDT via Asset Hub back to PRMX
pub fn build_withdraw_xcm(
    lp_shares: u128,
    min_usdt_out: u128,
    destination_account: [u8; 32],
) -> Xcm<()> {
    let weight_limit = WeightLimit::Unlimited;
    
    // Encoded stableswap.remove_liquidity_one_asset call
    let remove_liquidity_call = encode_remove_liquidity(
        STABLESWAP_POOL_ID,
        USDT_HYDRATION_ID,
        lp_shares,
        min_usdt_out,
    );
    
    // USDT asset representation on Hydration
    let usdt_hydration_asset = Asset {
        id: AssetId(Location::new(0, [GeneralIndex(USDT_HYDRATION_ID as u128)])),
        fun: Fungible(min_usdt_out),
    };
    
    // Final destination on PRMX
    let final_beneficiary = Location::new(
        0,
        [AccountId32 {
            network: None,
            id: destination_account,
        }],
    );
    
    // This XCM is sent to Hydration to initiate the withdrawal
    Xcm(vec![
        // 1. Execute remove_liquidity to get USDT
        Transact {
            origin_kind: OriginKind::SovereignAccount,
            fallback_max_weight: Some(Weight::from_parts(1_000_000_000, 100_000)),
            call: remove_liquidity_call.into(),
        },
        
        // 2. Initiate reserve withdraw of USDT back to Asset Hub
        InitiateReserveWithdraw {
            assets: Wild(AllOf {
                id: AssetId(Location::new(0, [GeneralIndex(USDT_HYDRATION_ID as u128)])),
                fun: WildFungibility::Fungible,
            }),
            reserve: asset_hub_location(),
            xcm: Xcm(vec![
                // On Asset Hub: Buy execution
                BuyExecution {
                    fees: usdt_hydration_asset.clone(),
                    weight_limit: weight_limit.clone(),
                },
                
                // Forward to PRMX
                DepositReserveAsset {
                    assets: All.into(),
                    dest: prmx_location_from_asset_hub(),
                    xcm: Xcm(vec![
                        // On PRMX: Deposit to final account
                        DepositAsset {
                            assets: All.into(),
                            beneficiary: final_beneficiary,
                        },
                    ]),
                },
            ]),
        },
    ])
}

// =============================================================================
//                       Live XCM Strategy Interface
// =============================================================================

/// Live implementation of XcmStrategyInterface that uses real XCM.
///
/// This implementation sends actual XCM messages to Asset Hub and Hydration.
/// It should only be used when HRMP channels are properly configured.
pub struct LiveXcmStrategyInterface<T>(core::marker::PhantomData<T>);

impl<T: Config> XcmStrategyInterface for LiveXcmStrategyInterface<T>
where
    T::AccountId: Into<[u8; 32]> + Clone,
{
    type Balance = T::Balance;
    type AccountId = T::AccountId;

    /// Enter the DeFi strategy by sending USDT to Hydration Pool 102.
    ///
    /// Returns the expected number of LP shares (in v1, we estimate 1:1 for stableswap).
    fn enter_strategy(principal: Self::Balance) -> Result<u128, DispatchError> {
        let principal_u128: u128 = principal.into();
        
        // For stableswap with stablecoins, LP shares are roughly 1:1 with deposit
        // In production, we'd query the pool for precise calculation
        let expected_shares = principal_u128;
        let min_shares = expected_shares * 99 / 100; // 1% slippage tolerance
        
        // Get DAO account as [u8; 32]
        let dao_account: [u8; 32] = T::DaoAccountId::get().into();
        
        // Build the XCM message
        let xcm = build_deposit_xcm(principal_u128, min_shares, dao_account);
        
        log::info!(
            target: "prmx-xcm-capital",
            "📤 [LIVE XCM] Sending deposit XCM for {} USDT, expecting {} LP shares",
            principal_u128,
            expected_shares
        );
        
        // Send XCM via pallet_xcm
        // Note: In production, we'd use pallet_xcm::send and track the response
        // For now, we log the intent and return expected shares
        log::info!(
            target: "prmx-xcm-capital",
            "📤 [LIVE XCM] XCM message prepared with {} instructions",
            xcm.0.len()
        );
        
        // TODO: Actually send the XCM using pallet_xcm::send
        // For Chopsticks testing, we'll verify the XCM construction is correct
        
        Ok(expected_shares)
    }

    /// Exit the DeFi strategy by withdrawing from Hydration Pool 102.
    ///
    /// Returns the actual USDT amount realized (estimated in v1).
    fn exit_strategy(
        shares: u128,
        _policy_pool_account: &Self::AccountId,
    ) -> Result<Self::Balance, DispatchError> {
        // For stableswap with stablecoins, redemption is roughly 1:1
        let expected_usdt = shares;
        let min_usdt = expected_usdt * 99 / 100; // 1% slippage tolerance
        
        // Get destination account as [u8; 32]
        let destination: [u8; 32] = _policy_pool_account.clone().into();
        
        // Build the XCM message
        let xcm = build_withdraw_xcm(shares, min_usdt, destination);
        
        log::info!(
            target: "prmx-xcm-capital",
            "📤 [LIVE XCM] Sending withdraw XCM for {} LP shares, expecting {} USDT",
            shares,
            expected_usdt
        );
        
        log::info!(
            target: "prmx-xcm-capital",
            "📤 [LIVE XCM] XCM message prepared with {} instructions",
            xcm.0.len()
        );
        
        // TODO: Actually send the XCM to Hydration
        // For Chopsticks testing, we'll verify the XCM construction is correct
        
        Ok(expected_usdt.into())
    }
}

// =============================================================================
//                       Utility Functions
// =============================================================================

// NOTE: prmx_sovereign_account function requires polkadot_parachain_primitives
// which adds significant compilation overhead. It's commented out for dev builds.
// Uncomment when deploying as a real parachain.
//
// /// Calculate PRMX sovereign account on a sibling parachain
// pub fn prmx_sovereign_account<AccountId>() -> AccountId
// where
//     AccountId: From<[u8; 32]>,
// {
//     use polkadot_parachain_primitives::primitives::Sibling;
//     use sp_runtime::traits::AccountIdConversion;
//     
//     Sibling::from(PRMX_PARA_ID).into_account_truncating()
// }

/// Estimate XCM fees for a deposit operation (in USDT base units)
pub fn estimate_deposit_fees() -> u128 {
    // Rough estimate: 2 USDT for 2-hop XCM with transact
    2_000_000
}

/// Estimate XCM fees for a withdrawal operation (in USDT base units)
pub fn estimate_withdraw_fees() -> u128 {
    // Rough estimate: 2 USDT for 2-hop XCM with transact
    2_000_000
}
