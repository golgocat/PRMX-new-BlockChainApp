//! # PRMX Policy Pallet
//!
//! This pallet manages insurance policies (Policy Token side) and per-policy capital pools.
//!
//! ## Overview
//!
//! - Users create policies using quotes from the quote pallet.
//! - Each policy locks capital (user premium + DAO contribution) in a per-policy pool.
//! - LP tokens are minted to the DAO when policies are created.
//! - Policies can be settled based on oracle data.
//! - Capital can be invested in DeFi (Hydration Pool 102) via CapitalApi integration.

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub use pallet::*;

use alloc::vec::Vec;
use frame_support::traits::fungibles::{Inspect, Mutate};
use frame_support::traits::tokens::Preservation;
use pallet_prmx_holdings::HoldingsApi;
use pallet_prmx_quote::QuoteAccess;
use sp_runtime::DispatchError;

use pallet_prmx_orderbook_lp::LpOrderbookApi;

// Re-export PolicyId for external use
pub type PolicyId = u64;

// =============================================================================
//                              Traits
// =============================================================================

/// Trait for deriving policy pool accounts.
///
/// This is implemented by pallet_prmx_policy to allow other pallets
/// (like pallet_prmx_xcm_capital) to derive the on-chain account used
/// for each policy pool.
pub trait PolicyPoolAccountApi<AccountId> {
    fn policy_pool_account(policy_id: PolicyId) -> AccountId;
}

/// Capital management API used by pallet_prmx_policy.
///
/// This trait abstracts capital management operations. In v1, it is implemented
/// by pallet_prmx_xcm_capital to manage DeFi investments (Hydration Pool 102).
pub trait CapitalApi<AccountId> {
    type Balance;

    /// Allocate capital of a policy into the DeFi strategy (Hydration Pool 102).
    ///
    /// This is called by a DAO-controlled extrinsic, not by users.
    fn allocate_to_defi(
        policy_id: PolicyId,
        amount: Self::Balance,
    ) -> Result<(), DispatchError>;

    /// Automatically allocate policy capital to DeFi based on configured percentage.
    /// Called after policy creation. Uses the configured allocation percentage.
    fn auto_allocate_policy_capital(
        policy_id: PolicyId,
        pool_balance: Self::Balance,
    ) -> Result<(), DispatchError>;

    /// Ensure that the given policy pool has at least `required_local`
    /// USDT available locally on PRMX and that all DeFi LP exposure
    /// for this policy has been fully unwound.
    ///
    /// If the realised value from unwinding is less than `required_local`,
    /// the DAO must cover the shortfall by transferring USDT into the policy pool.
    fn ensure_local_liquidity(
        policy_id: PolicyId,
        required_local: Self::Balance,
    ) -> Result<(), DispatchError>;

    /// Notification that a policy is fully settled.
    /// Implementations can use this to perform any final cleanup.
    fn on_policy_settled(policy_id: PolicyId) -> Result<(), DispatchError>;
}

/// No-op implementation of CapitalApi for when yield management is disabled.
pub struct NoOpCapitalApi<AccountId, Balance>(
    core::marker::PhantomData<(AccountId, Balance)>,
);

impl<AccountId, Balance> CapitalApi<AccountId> for NoOpCapitalApi<AccountId, Balance>
where
    Balance: Default,
{
    type Balance = Balance;

    fn allocate_to_defi(
        _policy_id: PolicyId,
        _amount: Self::Balance,
    ) -> Result<(), DispatchError> {
        // No-op: capital stays in policy pool
        Ok(())
    }

    fn auto_allocate_policy_capital(
        _policy_id: PolicyId,
        _pool_balance: Self::Balance,
    ) -> Result<(), DispatchError> {
        // No-op: no auto-allocation without yield pallet
        Ok(())
    }

    fn ensure_local_liquidity(
        _policy_id: PolicyId,
        _required_local: Self::Balance,
    ) -> Result<(), DispatchError> {
        // No-op: all capital is already local
        Ok(())
    }

    fn on_policy_settled(_policy_id: PolicyId) -> Result<(), DispatchError> {
        // No-op: nothing to clean up
        Ok(())
    }
}

/// Stub implementation for when orderbook is not yet implemented
pub struct StubLpOrderbook<AccountId, Balance>(
    core::marker::PhantomData<(AccountId, Balance)>
);

impl<AccountId, Balance> LpOrderbookApi<AccountId, Balance> for StubLpOrderbook<AccountId, Balance> {
    fn place_dao_lp_ask(
        _market_id: u64,
        _seller: &AccountId,
        _price_per_share: Balance,
        _quantity: u128,
    ) -> Result<(), sp_runtime::DispatchError> {
        // Stub implementation - always succeeds
        // In production, this would call the actual orderbook pallet
        Ok(())
    }
}

#[frame_support::pallet]
pub mod pallet {
    use super::*;
    use frame_support::pallet_prelude::*;
    use frame_support::traits::Time;
    use frame_system::pallet_prelude::*;
    use pallet_prmx_markets::MarketId;
    use sp_runtime::traits::{AccountIdConversion, Zero};

    // =========================================================================
    //                                  Types
    // =========================================================================

    // Re-export PolicyId from module level
    pub use super::PolicyId;

    /// Policy status
    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen, Default)]
    pub enum PolicyStatus {
        #[default]
        Active,
        Expired,
        Settled,
        Cancelled,
    }

    /// Settlement result for a policy
    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
    #[scale_info(skip_type_params(T))]
    pub struct SettlementResult<T: Config> {
        /// Whether the rainfall event occurred (exceeded strike threshold)
        pub event_occurred: bool,
        /// Amount paid out to policy holder (0 if no event)
        pub payout_to_holder: T::Balance,
        /// Amount returned to LP holders (0 if event occurred)
        pub returned_to_lps: T::Balance,
        /// Timestamp of settlement (unix seconds)
        pub settled_at: u64,
    }

    /// Policy information
    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
    #[scale_info(skip_type_params(T))]
    pub struct PolicyInfo<T: Config> {
        pub policy_id: PolicyId,
        pub market_id: MarketId,
        pub holder: T::AccountId,
        pub coverage_start: u64,    // unix seconds
        pub coverage_end: u64,      // unix seconds
        pub shares: u128,           // 1 share = 100 USDT coverage
        pub latitude: i32,          // scaled by 1e6
        pub longitude: i32,         // scaled by 1e6
        pub status: PolicyStatus,
        pub premium_paid: T::Balance,
        pub max_payout: T::Balance,
    }

    // =========================================================================
    //                                Constants
    // =========================================================================

    /// USDT has 6 decimals
    pub const USDT_DECIMALS: u32 = 6;
    
    /// Payout per share in USDT (100 USDT)
    pub const PAYOUT_PER_SHARE_USDT: u128 = 100;
    
    /// Payout per share in smallest units (100 * 10^6 = 100_000_000)
    pub const PAYOUT_PER_SHARE: u128 = PAYOUT_PER_SHARE_USDT * 10u128.pow(USDT_DECIMALS);

    /// Pallet ID for generating derived accounts
    pub const PALLET_ID: frame_support::PalletId = frame_support::PalletId(*b"prmxplcy");

    // =========================================================================
    //                                  Config
    // =========================================================================

    #[pallet::config]
    pub trait Config: frame_system::Config + pallet_timestamp::Config {
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;

        /// Balance type
        type Balance: Parameter + Member + From<u128> + Into<u128> + Copy + Default + MaxEncodedLen + Zero + Ord;

        /// Asset ID type
        type AssetId: Parameter + Member + Copy + Default + MaxEncodedLen;

        /// Fungibles implementation for USDT transfers
        type Assets: Mutate<Self::AccountId, AssetId = Self::AssetId, Balance = Self::Balance>
            + Inspect<Self::AccountId>;

        /// USDT asset ID
        #[pallet::constant]
        type UsdtAssetId: Get<Self::AssetId>;

        /// Access to quote pallet
        type QuoteApi: QuoteAccess<Self::AccountId, Self::Balance>;

        /// Access to holdings pallet
        type HoldingsApi: HoldingsApi<Self::AccountId, Balance = Self::Balance>;

        /// LP Orderbook API
        type LpOrderbook: LpOrderbookApi<Self::AccountId, Self::Balance>;

        /// DAO account ID (receives LP tokens)
        #[pallet::constant]
        type DaoAccountId: Get<Self::AccountId>;

        /// DAO capital account ID (provides capital for policies)
        #[pallet::constant]
        type DaoCapitalAccountId: Get<Self::AccountId>;

        /// Maximum policies per market
        #[pallet::constant]
        type MaxPoliciesPerMarket: Get<u32>;

        /// Capital management API for DeFi yield strategy integration (Hydration Pool 102).
        /// Use NoOpCapitalApi if yield management is not enabled.
        type CapitalApi: CapitalApi<Self::AccountId, Balance = Self::Balance>;
    }

    // =========================================================================
    //                                  Storage
    // =========================================================================

    #[pallet::pallet]
    pub struct Pallet<T>(_);

    /// Next policy ID
    #[pallet::storage]
    #[pallet::getter(fn next_policy_id)]
    pub type NextPolicyId<T> = StorageValue<_, PolicyId, ValueQuery>;

    /// Policies by ID
    #[pallet::storage]
    #[pallet::getter(fn policies)]
    pub type Policies<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        PolicyId,
        PolicyInfo<T>,
        OptionQuery,
    >;

    /// Policies by market (index)
    #[pallet::storage]
    #[pallet::getter(fn policies_by_market)]
    pub type PoliciesByMarket<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        MarketId,
        BoundedVec<PolicyId, T::MaxPoliciesPerMarket>,
        ValueQuery,
    >;

    /// Per-policy risk pool balance
    #[pallet::storage]
    #[pallet::getter(fn policy_risk_pool_balance)]
    pub type PolicyRiskPoolBalance<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        PolicyId,
        T::Balance,
        ValueQuery,
    >;

    /// Settlement results by policy ID
    #[pallet::storage]
    #[pallet::getter(fn settlement_results)]
    pub type SettlementResults<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        PolicyId,
        SettlementResult<T>,
        OptionQuery,
    >;

    // =========================================================================
    //                                  Events
    // =========================================================================

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// Policy created. [policy_id, market_id, holder, shares]
        PolicyCreated {
            policy_id: PolicyId,
            market_id: MarketId,
            holder: T::AccountId,
            shares: u128,
        },
        /// Policy capital locked. [policy_id, user_premium, dao_capital]
        CapitalLocked {
            policy_id: PolicyId,
            user_premium: T::Balance,
            dao_capital: T::Balance,
        },
        /// LP tokens minted to DAO for a specific policy. [policy_id, shares]
        LpTokensMinted {
            policy_id: PolicyId,
            shares: u128,
        },
        /// DAO LP ask placed for a specific policy's LP tokens. [policy_id, price_per_share, quantity]
        DaoLpAskPlaced {
            policy_id: PolicyId,
            price_per_share: T::Balance,
            quantity: u128,
        },
        /// Policy settled. [policy_id, payout_to_holder]
        PolicySettled {
            policy_id: PolicyId,
            payout_to_holder: T::Balance,
        },
        /// Policy expired (no payout). [policy_id, residual_to_pool]
        PolicyExpiredNoEvent {
            policy_id: PolicyId,
            residual_to_pool: T::Balance,
        },
    }

    // =========================================================================
    //                                  Errors
    // =========================================================================

    #[pallet::error]
    pub enum Error<T> {
        /// Policy not found.
        PolicyNotFound,
        /// Quote not found.
        QuoteNotFound,
        /// Quote not ready.
        QuoteNotReady,
        /// Quote expired.
        QuoteExpired,
        /// Unauthorized (not the quote requester).
        Unauthorized,
        /// Policy already settled.
        PolicyAlreadySettled,
        /// Coverage window not ended.
        CoverageNotEnded,
        /// Insufficient funds.
        InsufficientFunds,
        /// Insufficient DAO capital.
        InsufficientDaoCapital,
        /// Arithmetic overflow.
        ArithmeticOverflow,
        /// Transfer failed.
        TransferFailed,
    }

    // =========================================================================
    //                                Extrinsics
    // =========================================================================

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Apply for coverage using a previously obtained quote.
        /// 
        /// This will:
        /// 1. Create a policy from the quote.
        /// 2. Lock capital (user premium + DAO contribution).
        /// 3. Mint LP tokens to DAO.
        /// 4. Place DAO LP ask on orderbook.
        #[pallet::call_index(0)]
        #[pallet::weight(100_000)]
        pub fn apply_coverage_with_quote(
            origin: OriginFor<T>,
            quote_id: u64,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;

            // Load quote request and result
            let req = T::QuoteApi::get_quote_request(quote_id)
                .ok_or(Error::<T>::QuoteNotFound)?;
            let res = T::QuoteApi::get_quote_result(quote_id)
                .ok_or(Error::<T>::QuoteNotReady)?;

            // Verify the caller is the quote requester
            ensure!(who == req.requester, Error::<T>::Unauthorized);

            // Check quote is ready
            ensure!(
                T::QuoteApi::is_quote_ready(quote_id),
                Error::<T>::QuoteExpired
            );

            // Calculate capital requirements
            let shares = req.shares;
            let premium = res.total_premium;
            let premium_u128: u128 = premium.into();

            // max_payout = shares * PAYOUT_PER_SHARE
            let max_payout_u128 = shares
                .checked_mul(PAYOUT_PER_SHARE)
                .ok_or(Error::<T>::ArithmeticOverflow)?;
            let max_payout: T::Balance = max_payout_u128.into();

            // required_capital = max_payout - premium
            let required_capital_u128 = max_payout_u128.saturating_sub(premium_u128);
            let required_capital: T::Balance = required_capital_u128.into();

            // Calculate required capital per share (for orderbook listing)
            let premium_per_share_u128: u128 = res.premium_per_share.into();
            let payout_per_share_u128 = PAYOUT_PER_SHARE;
            let required_capital_per_share_u128 = payout_per_share_u128
                .saturating_sub(premium_per_share_u128);
            let required_capital_per_share: T::Balance = required_capital_per_share_u128.into();

            // Create policy
            let policy_id = NextPolicyId::<T>::get();
            let policy = PolicyInfo::<T> {
                policy_id,
                market_id: req.market_id,
                holder: who.clone(),
                coverage_start: req.coverage_start,
                coverage_end: req.coverage_end,
                shares,
                latitude: req.latitude,
                longitude: req.longitude,
                status: PolicyStatus::Active,
                premium_paid: premium,
                max_payout,
            };

            // Get pool account for this policy
            let pool_account = Self::policy_pool_account(policy_id);

            // Transfer premium from user to pool
            T::Assets::transfer(
                T::UsdtAssetId::get(),
                &who,
                &pool_account,
                premium,
                Preservation::Expendable,
            ).map_err(|_| Error::<T>::InsufficientFunds)?;

            // Transfer DAO capital to pool
            if required_capital > T::Balance::zero() {
                T::Assets::transfer(
                    T::UsdtAssetId::get(),
                    &T::DaoCapitalAccountId::get(),
                    &pool_account,
                    required_capital,
                    Preservation::Expendable,
                ).map_err(|_| Error::<T>::InsufficientDaoCapital)?;
            }

            // Store policy
            Policies::<T>::insert(policy_id, policy);
            NextPolicyId::<T>::put(policy_id + 1);

            // Add to market index
            PoliciesByMarket::<T>::mutate(req.market_id, |policies| {
                let _ = policies.try_push(policy_id);
            });

            // Set pool balance
            PolicyRiskPoolBalance::<T>::insert(policy_id, max_payout);

            // Mint LP tokens to DAO for THIS POLICY (policy-specific LP tokens)
            T::HoldingsApi::mint_lp_tokens(policy_id, &T::DaoAccountId::get(), shares)
                .map_err(|_| Error::<T>::ArithmeticOverflow)?;

            // Register DAO as LP holder for this policy (for automatic payout distribution)
            T::HoldingsApi::register_lp_holder(policy_id, &T::DaoAccountId::get())
                .map_err(|_| Error::<T>::ArithmeticOverflow)?;

            // Place DAO LP ask on orderbook for THIS POLICY's LP tokens
            T::LpOrderbook::place_dao_lp_ask(
                policy_id,
                &T::DaoAccountId::get(),
                required_capital_per_share,
                shares,
            )?;

            // Consume the quote
            T::QuoteApi::consume_quote(quote_id)?;

            // Emit events
            Self::deposit_event(Event::PolicyCreated {
                policy_id,
                market_id: req.market_id,
                holder: who,
                shares,
            });

            Self::deposit_event(Event::CapitalLocked {
                policy_id,
                user_premium: premium,
                dao_capital: required_capital,
            });

            Self::deposit_event(Event::LpTokensMinted {
                policy_id,
                shares,
            });

            Self::deposit_event(Event::DaoLpAskPlaced {
                policy_id,
                price_per_share: required_capital_per_share,
                quantity: shares,
            });

            // Auto-allocate policy capital to DeFi strategy (Hydration Pool 102)
            // Uses the configured allocation percentage (default 100%)
            if let Err(e) = T::CapitalApi::auto_allocate_policy_capital(policy_id, max_payout) {
                log::warn!(
                    target: "prmx-policy",
                    "⚠️ Auto-allocation to DeFi failed for policy {}: {:?}",
                    policy_id,
                    e
                );
                // Don't fail policy creation if auto-allocation fails
                // The DAO can manually allocate later
            }

            Ok(())
        }

        /// Settle a policy after coverage window has ended.
        /// This is permissionless - anyone can call it once conditions are met.
        /// 
        /// - `policy_id`: The policy to settle.
        /// - `event_occurred`: Whether the rainfall event occurred (from oracle).
        #[pallet::call_index(1)]
        #[pallet::weight(50_000)]
        pub fn settle_policy(
            origin: OriginFor<T>,
            policy_id: PolicyId,
            event_occurred: bool, // In production, this would come from oracle
        ) -> DispatchResult {
            // Permissionless - anyone can settle
            let _who = ensure_signed(origin)?;

            // Load policy
            let policy = Policies::<T>::get(policy_id)
                .ok_or(Error::<T>::PolicyNotFound)?;

            // Ensure policy is active or expired (not already settled)
            ensure!(
                policy.status == PolicyStatus::Active || policy.status == PolicyStatus::Expired,
                Error::<T>::PolicyAlreadySettled
            );

            // Check coverage window has ended
            let now = Self::current_timestamp();
            log::info!(
                target: "prmx-policy",
                "🔍 Settlement check - now: {}, coverage_end: {}, comparison: {}",
                now,
                policy.coverage_end,
                now >= policy.coverage_end
            );
            ensure!(
                now >= policy.coverage_end,
                Error::<T>::CoverageNotEnded
            );

            // Call internal settlement function
            Self::do_settle_policy(policy_id, event_occurred)?;

            Ok(())
        }

        /// Trigger immediate settlement for a policy when threshold is exceeded.
        /// This is called by the Oracle pallet when automatic settlement is triggered.
        /// Does NOT require coverage window to have ended.
        /// 
        /// - `policy_id`: The policy to settle immediately.
        #[pallet::call_index(2)]
        #[pallet::weight(50_000)]
        pub fn trigger_immediate_settlement(
            origin: OriginFor<T>,
            policy_id: PolicyId,
        ) -> DispatchResult {
            // For now, allow root origin (oracle will call via internal function)
            // In production, this would be restricted to OracleOrigin
            ensure_root(origin)?;

            // Load policy
            let policy = Policies::<T>::get(policy_id)
                .ok_or(Error::<T>::PolicyNotFound)?;

            // Ensure policy is active (not already settled or cancelled)
            ensure!(
                policy.status == PolicyStatus::Active,
                Error::<T>::PolicyAlreadySettled
            );

            log::info!(
                target: "prmx-policy",
                "⚡ Immediate settlement triggered for policy {} (threshold exceeded)",
                policy_id
            );

            // Call internal settlement function with event_occurred = true
            Self::do_settle_policy(policy_id, true)?;

            Ok(())
        }
    }

    // =========================================================================
    //                           Helper Functions
    // =========================================================================

    impl<T: Config> Pallet<T> {
        /// Get the derived account for a policy's capital pool
        pub fn policy_pool_account(policy_id: PolicyId) -> T::AccountId {
            PALLET_ID.into_sub_account_truncating(("policy", policy_id))
        }

        /// Get the derived account for a market's residual pool
        pub fn market_residual_account(market_id: MarketId) -> T::AccountId {
            PALLET_ID.into_sub_account_truncating(("market", market_id))
        }

        /// Get current timestamp from pallet_timestamp (in seconds)
        pub fn current_timestamp() -> u64 {
            // Get timestamp from pallet_timestamp (returns milliseconds)
            let now_ms: u64 = pallet_timestamp::Pallet::<T>::now()
                .try_into()
                .unwrap_or(0);
            let now_secs = now_ms / 1000;
            log::info!(
                target: "prmx-policy",
                "🔍 current_timestamp() - raw_ms: {}, seconds: {}",
                now_ms,
                now_secs
            );
            now_secs
        }

        /// Get all policies for a market
        pub fn get_policies_for_market(market_id: MarketId) -> Vec<PolicyId> {
            PoliciesByMarket::<T>::get(market_id).into_inner()
        }

        /// Get policy info
        pub fn get_policy(policy_id: PolicyId) -> Option<PolicyInfo<T>> {
            Policies::<T>::get(policy_id)
        }

        /// Check if policy is active
        pub fn is_policy_active(policy_id: PolicyId) -> bool {
            Policies::<T>::get(policy_id)
                .map(|p| p.status == PolicyStatus::Active)
                .unwrap_or(false)
        }

        /// Internal settlement function - performs the actual settlement logic
        /// Returns the payout amount on success
        pub fn do_settle_policy(policy_id: PolicyId, event_occurred: bool) -> Result<T::Balance, DispatchError> {
            // Load policy
            let mut policy = Policies::<T>::get(policy_id)
                .ok_or(Error::<T>::PolicyNotFound)?;

            // Ensure policy is active or expired (not already settled)
            ensure!(
                policy.status == PolicyStatus::Active || policy.status == PolicyStatus::Expired,
                Error::<T>::PolicyAlreadySettled
            );

            let now = Self::current_timestamp();

            // Get pool account
            let pool_account = Self::policy_pool_account(policy_id);

            // =========================================================================
            // DeFi Integration: Ensure local liquidity before settlement
            // =========================================================================
            // Before settlement, we need to ensure the policy pool has enough
            // local USDT to fulfill obligations. This unwinds any LP positions
            // and has the DAO top up any shortfall from DeFi losses.
            log::info!(
                target: "prmx-policy",
                "💰 Ensuring local liquidity for policy {} (required: {} USDT)",
                policy_id,
                policy.max_payout.into()
            );

            T::CapitalApi::ensure_local_liquidity(policy_id, policy.max_payout)?;

            // After unwinding, get the ACTUAL on-chain pool balance
            // This may be less than max_payout if DAO couldn't cover full DeFi loss
            let pool_balance = T::Assets::balance(T::UsdtAssetId::get(), &pool_account);
            
            log::info!(
                target: "prmx-policy",
                "📊 Pool balance after DeFi unwind: {} USDT (max_payout was {})",
                pool_balance.into(),
                policy.max_payout.into()
            );

            let payout_to_holder: T::Balance;

            if event_occurred {
                // Event occurred - pay out to policy holder
                // In case of DAO insolvency, pool may have less than max_payout
                // Pay out what's available in the pool
                let payout = if pool_balance < policy.max_payout {
                    log::warn!(
                        target: "prmx-policy",
                        "⚠️ Pool has {} USDT but max_payout is {} USDT - paying out available balance",
                        pool_balance.into(),
                        policy.max_payout.into()
                    );
                    pool_balance
                } else {
                    policy.max_payout
                };
                payout_to_holder = payout;

                // Transfer from pool to holder (only if there's something to transfer)
                if payout > T::Balance::zero() {
                T::Assets::transfer(
                    T::UsdtAssetId::get(),
                    &pool_account,
                    &policy.holder,
                    payout,
                    frame_support::traits::tokens::Preservation::Expendable,
                ).map_err(|_| Error::<T>::TransferFailed)?;
                }

                // Update storage
                PolicyRiskPoolBalance::<T>::insert(policy_id, T::Balance::zero());
                policy.status = PolicyStatus::Settled;
                Policies::<T>::insert(policy_id, policy);

                // Cleanup LP tokens (burn all LP tokens for this policy)
                T::HoldingsApi::cleanup_policy_lp_tokens(policy_id)
                    .map_err(|_| Error::<T>::TransferFailed)?;

                // Store settlement result
                SettlementResults::<T>::insert(policy_id, SettlementResult {
                    event_occurred: true,
                    payout_to_holder: payout,
                    returned_to_lps: T::Balance::zero(),
                    settled_at: now,
                });

                Self::deposit_event(Event::PolicySettled {
                    policy_id,
                    payout_to_holder: payout,
                });
            } else {
                // Event did not occur - distribute pool to LP holders pro-rata
                payout_to_holder = T::Balance::zero();
                
                // Distribute directly from policy pool to all LP holders OF THIS POLICY
                T::HoldingsApi::distribute_to_lp_holders(
                    policy_id,
                    &pool_account,
                    pool_balance,
                ).map_err(|_| Error::<T>::TransferFailed)?;

                // Cleanup LP tokens (burn all LP tokens for this policy)
                T::HoldingsApi::cleanup_policy_lp_tokens(policy_id)
                    .map_err(|_| Error::<T>::TransferFailed)?;

                PolicyRiskPoolBalance::<T>::insert(policy_id, T::Balance::zero());
                policy.status = PolicyStatus::Settled;
                Policies::<T>::insert(policy_id, policy.clone());

                // Store settlement result
                SettlementResults::<T>::insert(policy_id, SettlementResult {
                    event_occurred: false,
                    payout_to_holder: T::Balance::zero(),
                    returned_to_lps: pool_balance,
                    settled_at: now,
                });

                Self::deposit_event(Event::PolicyExpiredNoEvent {
                    policy_id,
                    residual_to_pool: pool_balance,
                });
            }

            // =========================================================================
            // DeFi Integration: Notify CapitalApi of settlement completion
            // =========================================================================
            // Perform any final cleanup for the policy's capital management state.
            T::CapitalApi::on_policy_settled(policy_id)?;

            Ok(payout_to_holder)
        }

        /// Get all active policies for a market that are currently in their coverage window
        pub fn get_active_policies_in_window(market_id: MarketId, current_time: u64) -> Vec<PolicyId> {
            let policy_ids = PoliciesByMarket::<T>::get(market_id);
            
            policy_ids
                .into_iter()
                .filter(|&policy_id| {
                    if let Some(policy) = Policies::<T>::get(policy_id) {
                        // Check if policy is active AND currently in coverage window
                        policy.status == PolicyStatus::Active
                            && current_time >= policy.coverage_start
                            && current_time <= policy.coverage_end
                    } else {
                        false
                    }
                })
                .collect()
        }
    }
}

// =============================================================================
//                       PolicySettlement Trait Implementation
// =============================================================================

impl<T: Config> pallet_prmx_oracle::PolicySettlement<T::AccountId> for Pallet<T> {
    fn current_time() -> u64 {
        pallet::Pallet::<T>::current_timestamp()
    }
    
    fn get_active_policies_in_window(market_id: pallet_prmx_markets::MarketId, current_time: u64) -> Vec<pallet_prmx_oracle::PolicyId> {
        pallet::Pallet::<T>::get_active_policies_in_window(market_id, current_time)
    }

    fn get_policy_info(policy_id: pallet_prmx_oracle::PolicyId) -> Option<(T::AccountId, u128, u64, u64, pallet_prmx_markets::MarketId)> {
        pallet::Policies::<T>::get(policy_id).map(|p| {
            (p.holder, p.max_payout.into(), p.coverage_start, p.coverage_end, p.market_id)
        })
    }

    fn trigger_immediate_settlement(policy_id: pallet_prmx_oracle::PolicyId) -> Result<u128, sp_runtime::DispatchError> {
        // Call internal settlement function with event_occurred = true
        let payout = pallet::Pallet::<T>::do_settle_policy(policy_id, true)?;
        Ok(payout.into())
    }
}

// =============================================================================
//                       PolicyPoolAccountApi Implementation
// =============================================================================

impl<T: Config> PolicyPoolAccountApi<T::AccountId> for Pallet<T> {
    fn policy_pool_account(policy_id: PolicyId) -> T::AccountId {
        pallet::Pallet::<T>::policy_pool_account(policy_id)
    }
}
