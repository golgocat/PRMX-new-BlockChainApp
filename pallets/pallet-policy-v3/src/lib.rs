//! # Pallet Policy V3
//!
//! Policy pallet for the PRMX V3 P2P climate risk market.
//!
//! ## Overview
//!
//! - Policy: Represents an active insurance contract with coverage details
//! - Settlement: Handles trigger (payout to holder) and maturity (distribute to LPs)
//! - Per-policy pool account: Holds premium + collateral until settlement
//! - Integrates with holdings pallet for LP token management

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub use pallet::*;

use alloc::vec::Vec;
use frame_support::pallet_prelude::*;
use frame_support::traits::fungibles::{Inspect, Mutate};
use frame_support::traits::tokens::Preservation;
use frame_support::traits::Get;
use frame_system::pallet_prelude::*;
use pallet_oracle_v3::LocationId;
use prmx_primitives::{
    AggStateV3, EventSpecV3, PolicyId, PolicyStatusV3, V3_PAYOUT_PER_SHARE,
};
use sp_core::H256;
use sp_runtime::traits::{AccountIdConversion, Zero};

// ============================================================================
// Constants
// ============================================================================

/// Pallet ID for generating derived accounts
pub const PALLET_ID: frame_support::PalletId = frame_support::PalletId(*b"prmxplv3");

// ============================================================================
// Traits
// ============================================================================

/// Trait for LP token management (holdings pallet integration)
pub trait HoldingsApiV3<AccountId> {
    type Balance;

    /// Mint LP tokens to an account for a specific policy
    fn mint_lp_tokens(
        policy_id: PolicyId,
        to: &AccountId,
        amount: u128,
    ) -> Result<(), DispatchError>;

    /// Register an LP holder for a policy
    fn register_lp_holder(policy_id: PolicyId, holder: &AccountId) -> Result<(), DispatchError>;

    /// Get total LP supply for a policy
    fn total_lp_supply(policy_id: PolicyId) -> u128;

    /// Get LP balance for an account on a policy
    fn lp_balance(policy_id: PolicyId, account: &AccountId) -> u128;

    /// Distribute funds pro-rata to all LP holders
    fn distribute_to_lp_holders(
        policy_id: PolicyId,
        from_account: &AccountId,
        amount: Self::Balance,
    ) -> Result<(), DispatchError>;

    /// Burn/cleanup LP tokens after settlement
    fn cleanup_policy_lp_tokens(policy_id: PolicyId) -> Result<(), DispatchError>;
}

/// No-op implementation for testing
impl<AccountId> HoldingsApiV3<AccountId> for () {
    type Balance = u128;

    fn mint_lp_tokens(_: PolicyId, _: &AccountId, _: u128) -> Result<(), DispatchError> {
        Ok(())
    }
    fn register_lp_holder(_: PolicyId, _: &AccountId) -> Result<(), DispatchError> {
        Ok(())
    }
    fn total_lp_supply(_: PolicyId) -> u128 {
        0
    }
    fn lp_balance(_: PolicyId, _: &AccountId) -> u128 {
        0
    }
    fn distribute_to_lp_holders(_: PolicyId, _: &AccountId, _: u128) -> Result<(), DispatchError> {
        Ok(())
    }
    fn cleanup_policy_lp_tokens(_: PolicyId) -> Result<(), DispatchError> {
        Ok(())
    }
}

/// Trait for DeFi capital management
pub trait CapitalApiV3<AccountId> {
    type Balance;

    /// Allocate a specific amount to DeFi (incremental, per-acceptance)
    fn allocate_to_defi(
        policy_id: PolicyId,
        amount: Self::Balance,
    ) -> Result<(), DispatchError>;

    /// Auto-allocate policy capital to DeFi (legacy, full pool balance)
    fn auto_allocate_policy_capital(
        policy_id: PolicyId,
        pool_balance: Self::Balance,
    ) -> Result<(), DispatchError>;

    /// Ensure local liquidity before settlement
    fn ensure_local_liquidity(
        policy_id: PolicyId,
        required_local: Self::Balance,
    ) -> Result<(), DispatchError>;

    /// Notify that policy is settled
    fn on_policy_settled(policy_id: PolicyId) -> Result<(), DispatchError>;
}

/// No-op implementation
impl<AccountId> CapitalApiV3<AccountId> for () {
    type Balance = u128;

    fn allocate_to_defi(_: PolicyId, _: u128) -> Result<(), DispatchError> {
        Ok(())
    }
    fn auto_allocate_policy_capital(_: PolicyId, _: u128) -> Result<(), DispatchError> {
        Ok(())
    }
    fn ensure_local_liquidity(_: PolicyId, _: u128) -> Result<(), DispatchError> {
        Ok(())
    }
    fn on_policy_settled(_: PolicyId) -> Result<(), DispatchError> {
        Ok(())
    }
}

#[frame_support::pallet]
pub mod pallet {
    use super::*;
    use sp_runtime::traits::Saturating;

    // =========================================================================
    //                                  Types
    // =========================================================================

    /// V3 Policy information
    #[derive(Clone, PartialEq, Eq, RuntimeDebug, Encode, Decode, TypeInfo, MaxEncodedLen)]
    #[scale_info(skip_type_params(T))]
    pub struct PolicyInfoV3<T: Config> {
        /// Policy ID (= request_id, 1:1 mapping)
        pub policy_id: PolicyId,
        /// Requester/policyholder
        pub holder: T::AccountId,
        /// Location ID from registry
        pub location_id: LocationId,
        /// Event specification
        pub event_spec: EventSpecV3,
        /// Total shares (filled so far)
        pub total_shares: u128,
        /// Premium per share
        pub premium_per_share: T::Balance,
        /// Payout per share (fixed $100)
        pub payout_per_share: T::Balance,
        /// Coverage start timestamp
        pub coverage_start: u64,
        /// Coverage end timestamp
        pub coverage_end: u64,
        /// Policy status
        pub status: PolicyStatusV3,
        /// Whether DeFi allocation has been done
        pub defi_allocated: bool,
        /// Created at timestamp
        pub created_at: u64,
    }

    // =========================================================================
    //                                  Config
    // =========================================================================

    #[pallet::config]
    pub trait Config: frame_system::Config + pallet_oracle_v3::Config {
        /// Runtime event type
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;

        /// Balance type
        type Balance: Parameter
            + Member
            + From<u128>
            + Into<u128>
            + Copy
            + Default
            + MaxEncodedLen
            + Zero
            + Ord
            + sp_runtime::traits::Saturating;

        /// Asset ID type
        type AssetId: Parameter + Member + Copy + Default + MaxEncodedLen;

        /// Fungibles implementation for USDT transfers
        type Assets: Mutate<Self::AccountId, AssetId = Self::AssetId, Balance = Self::Balance>
            + Inspect<Self::AccountId>;

        /// USDT asset ID
        #[pallet::constant]
        type UsdtAssetId: Get<Self::AssetId>;

        /// Holdings API for LP token management
        type HoldingsApi: HoldingsApiV3<Self::AccountId, Balance = Self::Balance>;

        /// Capital API for DeFi integration
        type CapitalApi: CapitalApiV3<Self::AccountId, Balance = Self::Balance>;

        /// Maximum LP holders per policy
        #[pallet::constant]
        type MaxLpHoldersPerPolicy: Get<u32>;

        /// Weight info
        type WeightInfo: WeightInfo;
    }

    /// Weight info trait
    pub trait WeightInfo {
        fn settle_policy() -> Weight;
    }

    impl WeightInfo for () {
        fn settle_policy() -> Weight {
            Weight::from_parts(100_000, 0)
        }
    }

    // =========================================================================
    //                                  Storage
    // =========================================================================

    #[pallet::pallet]
    pub struct Pallet<T>(_);

    /// Policies by ID
    #[pallet::storage]
    #[pallet::getter(fn policies)]
    pub type Policies<T: Config> =
        StorageMap<_, Blake2_128Concat, PolicyId, PolicyInfoV3<T>, OptionQuery>;

    /// Per-policy pool balance (tracking)
    #[pallet::storage]
    #[pallet::getter(fn policy_pool_balance)]
    pub type PolicyPoolBalance<T: Config> =
        StorageMap<_, Blake2_128Concat, PolicyId, T::Balance, ValueQuery>;

    // =========================================================================
    //                                  Events
    // =========================================================================

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// Policy created
        PolicyCreated {
            policy_id: PolicyId,
            holder: T::AccountId,
            location_id: LocationId,
            total_shares: u128,
        },
        /// LP tokens minted to underwriter
        LpTokensMinted {
            policy_id: PolicyId,
            underwriter: T::AccountId,
            shares: u128,
        },
        /// Policy settled - trigger (payout to holder)
        PolicyTriggered {
            policy_id: PolicyId,
            payout: T::Balance,
        },
        /// Policy settled - matured (distributed to LPs)
        PolicyMatured {
            policy_id: PolicyId,
            distributed: T::Balance,
        },
        /// DeFi allocation completed
        DeFiAllocated {
            policy_id: PolicyId,
            amount: T::Balance,
        },
        /// Shares added to policy by underwriter
        SharesAdded {
            policy_id: PolicyId,
            underwriter: T::AccountId,
            shares: u128,
            new_total: u128,
        },
    }

    // =========================================================================
    //                                  Errors
    // =========================================================================

    #[pallet::error]
    pub enum Error<T> {
        /// Policy not found
        PolicyNotFound,
        /// Policy already settled
        PolicyAlreadySettled,
        /// Policy not active
        PolicyNotActive,
        /// Insufficient funds
        InsufficientFunds,
        /// Transfer failed
        TransferFailed,
        /// Arithmetic overflow
        ArithmeticOverflow,
        /// Policy already exists
        PolicyAlreadyExists,
        /// Invalid shares amount
        InvalidSharesAmount,
    }

    // =========================================================================
    //                                Extrinsics
    // =========================================================================

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        // Settlement is triggered by oracle pallet, not directly callable
    }

    // =========================================================================
    //                           Helper Functions
    // =========================================================================

    impl<T: Config> Pallet<T> {
        /// Get the derived account for a policy's capital pool
        pub fn policy_pool_account(policy_id: PolicyId) -> T::AccountId {
            PALLET_ID.into_sub_account_truncating(("policy", policy_id))
        }

        /// Create a new policy (called by market pallet)
        pub fn create_policy(
            policy_id: PolicyId,
            holder: T::AccountId,
            location_id: LocationId,
            event_spec: EventSpecV3,
            initial_shares: u128,
            premium_per_share: T::Balance,
            coverage_start: u64,
            coverage_end: u64,
        ) -> DispatchResult {
            ensure!(
                !Policies::<T>::contains_key(policy_id),
                Error::<T>::PolicyAlreadyExists
            );

            let payout_per_share: T::Balance = V3_PAYOUT_PER_SHARE.into();

            let policy = PolicyInfoV3 {
                policy_id,
                holder: holder.clone(),
                location_id,
                event_spec: event_spec.clone(),
                total_shares: initial_shares,
                premium_per_share,
                payout_per_share,
                coverage_start,
                coverage_end,
                status: PolicyStatusV3::Active,
                defi_allocated: false,
                created_at: Self::current_timestamp(),
            };

            Policies::<T>::insert(policy_id, policy);

            // Initialize oracle state
            pallet_oracle_v3::Pallet::<T>::initialize_oracle_state(
                policy_id,
                event_spec,
                location_id,
                coverage_start,
                coverage_end,
            )?;

            Self::deposit_event(Event::PolicyCreated {
                policy_id,
                holder,
                location_id,
                total_shares: initial_shares,
            });

            Ok(())
        }

        /// Add shares to an existing policy (called by market pallet on subsequent accepts)
        pub fn add_shares_to_policy(
            policy_id: PolicyId,
            underwriter: T::AccountId,
            shares: u128,
        ) -> DispatchResult {
            Policies::<T>::try_mutate(policy_id, |maybe_policy| -> DispatchResult {
                let policy = maybe_policy.as_mut().ok_or(Error::<T>::PolicyNotFound)?;

                ensure!(
                    policy.status == PolicyStatusV3::Active,
                    Error::<T>::PolicyNotActive
                );

                policy.total_shares = policy
                    .total_shares
                    .checked_add(shares)
                    .ok_or(Error::<T>::ArithmeticOverflow)?;

                Self::deposit_event(Event::SharesAdded {
                    policy_id,
                    underwriter,
                    shares,
                    new_total: policy.total_shares,
                });

                Ok(())
            })
        }

        /// Allocate a specific amount to DeFi (called incrementally per acceptance)
        pub fn allocate_to_defi(policy_id: PolicyId, amount: T::Balance) -> DispatchResult {
            // Ensure policy exists
            ensure!(
                Policies::<T>::contains_key(policy_id),
                Error::<T>::PolicyNotFound
            );

            if amount == T::Balance::zero() {
                return Ok(());
            }

            // Call the capital API to allocate (it handles the actual XCM/mock strategy)
            if let Err(e) = T::CapitalApi::allocate_to_defi(policy_id, amount) {
                log::warn!(
                    target: "pallet-policy-v3",
                    "⚠️ Incremental DeFi allocation failed for policy {} (amount {}): {:?}",
                    policy_id,
                    amount.into(),
                    e
                );
                // Don't fail - DeFi allocation is optional
                return Ok(());
            }

            log::info!(
                target: "pallet-policy-v3",
                "✅ Allocated {} USDT to DeFi for policy {}",
                amount.into(),
                policy_id
            );

            Self::deposit_event(Event::DeFiAllocated {
                policy_id,
                amount,
            });

            Ok(())
        }

        /// Trigger DeFi allocation for a policy (legacy - allocates full pool balance)
        /// Kept for backwards compatibility but no longer used for new policies
        pub fn trigger_defi_allocation(policy_id: PolicyId) -> DispatchResult {
            let mut policy = Policies::<T>::get(policy_id).ok_or(Error::<T>::PolicyNotFound)?;

            if policy.defi_allocated {
                return Ok(()); // Already allocated
            }

            let pool_balance = PolicyPoolBalance::<T>::get(policy_id);

            if let Err(e) = T::CapitalApi::auto_allocate_policy_capital(policy_id, pool_balance) {
                log::warn!(
                    target: "pallet-policy-v3",
                    "⚠️ DeFi allocation failed for policy {}: {:?}",
                    policy_id,
                    e
                );
                // Don't fail - DeFi allocation is optional
            } else {
                policy.defi_allocated = true;
                Policies::<T>::insert(policy_id, policy);

                Self::deposit_event(Event::DeFiAllocated {
                    policy_id,
                    amount: pool_balance,
                });
            }

            Ok(())
        }

        /// Settle a policy (called by oracle pallet via PolicySettlementV3 trait)
        pub fn do_settle_policy(
            policy_id: PolicyId,
            triggered: bool,
        ) -> Result<T::Balance, DispatchError> {
            let mut policy = Policies::<T>::get(policy_id).ok_or(Error::<T>::PolicyNotFound)?;

            ensure!(
                policy.status == PolicyStatusV3::Active
                    || policy.status == PolicyStatusV3::Triggered
                    || policy.status == PolicyStatusV3::Matured,
                Error::<T>::PolicyAlreadySettled
            );

            let pool_account = Self::policy_pool_account(policy_id);

            // Ensure local liquidity (unwind DeFi if needed)
            let max_payout_u128 = policy
                .total_shares
                .checked_mul(V3_PAYOUT_PER_SHARE)
                .ok_or(Error::<T>::ArithmeticOverflow)?;
            let max_payout: T::Balance = max_payout_u128.into();

            T::CapitalApi::ensure_local_liquidity(policy_id, max_payout)?;

            // Get actual pool balance
            let pool_balance = T::Assets::balance(T::UsdtAssetId::get(), &pool_account);

            let payout: T::Balance;

            if triggered {
                // Triggered: pay out to policyholder
                let actual_payout = if pool_balance < max_payout {
                    log::warn!(
                        target: "pallet-policy-v3",
                        "⚠️ Pool {} USDT < max_payout {} USDT",
                        pool_balance.into(),
                        max_payout.into()
                    );
                    pool_balance
                } else {
                    max_payout
                };

                if actual_payout > T::Balance::zero() {
                    T::Assets::transfer(
                        T::UsdtAssetId::get(),
                        &pool_account,
                        &policy.holder,
                        actual_payout,
                        Preservation::Expendable,
                    )
                    .map_err(|_| Error::<T>::TransferFailed)?;
                }

                payout = actual_payout;
                policy.status = PolicyStatusV3::Settled;

                // Cleanup LP tokens
                T::HoldingsApi::cleanup_policy_lp_tokens(policy_id)?;

                Self::deposit_event(Event::PolicyTriggered {
                    policy_id,
                    payout: actual_payout,
                });
            } else {
                // Matured: distribute to LP holders
                T::HoldingsApi::distribute_to_lp_holders(policy_id, &pool_account, pool_balance)?;

                // Cleanup LP tokens
                T::HoldingsApi::cleanup_policy_lp_tokens(policy_id)?;

                payout = T::Balance::zero();
                policy.status = PolicyStatusV3::Settled;

                Self::deposit_event(Event::PolicyMatured {
                    policy_id,
                    distributed: pool_balance,
                });
            }

            Policies::<T>::insert(policy_id, policy);
            PolicyPoolBalance::<T>::insert(policy_id, T::Balance::zero());

            // Notify oracle and capital
            pallet_oracle_v3::Pallet::<T>::mark_policy_settled(policy_id)?;
            T::CapitalApi::on_policy_settled(policy_id)?;

            Ok(payout)
        }

        /// Add funds to policy pool (called by market pallet during acceptance)
        pub fn add_to_policy_pool(
            policy_id: PolicyId,
            from: &T::AccountId,
            amount: T::Balance,
        ) -> DispatchResult {
            let pool_account = Self::policy_pool_account(policy_id);

            T::Assets::transfer(
                T::UsdtAssetId::get(),
                from,
                &pool_account,
                amount,
                Preservation::Expendable,
            )
            .map_err(|_| Error::<T>::TransferFailed)?;

            PolicyPoolBalance::<T>::mutate(policy_id, |balance| {
                *balance = balance.saturating_add(amount);
            });

            Ok(())
        }

        /// Get policy info
        pub fn get_policy(policy_id: PolicyId) -> Option<PolicyInfoV3<T>> {
            Policies::<T>::get(policy_id)
        }

        /// Check if policy exists
        pub fn policy_exists(policy_id: PolicyId) -> bool {
            Policies::<T>::contains_key(policy_id)
        }

        /// Get current timestamp (placeholder - should use pallet_timestamp)
        fn current_timestamp() -> u64 {
            // In production, use pallet_timestamp
            0
        }
    }
}

// ============================================================================
// PolicySettlementV3 Implementation
// ============================================================================

impl<T: Config> pallet_oracle_v3::PolicySettlementV3 for Pallet<T> {
    fn on_final_report(
        policy_id: PolicyId,
        triggered: bool,
        _observed_until: u64,
        _agg_state: AggStateV3,
        _commitment: H256,
    ) -> DispatchResult {
        Pallet::<T>::do_settle_policy(policy_id, triggered)?;
        Ok(())
    }
}

// ============================================================================
// PolicyPoolAccountApi Trait
// ============================================================================

/// Trait for deriving policy pool accounts
pub trait PolicyPoolAccountApi<AccountId> {
    fn policy_pool_account(policy_id: PolicyId) -> AccountId;
}

impl<T: Config> PolicyPoolAccountApi<T::AccountId> for Pallet<T> {
    fn policy_pool_account(policy_id: PolicyId) -> T::AccountId {
        pallet::Pallet::<T>::policy_pool_account(policy_id)
    }
}

