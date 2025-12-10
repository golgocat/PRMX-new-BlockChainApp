//! # PRMX XCM Capital Pallet
//!
//! This pallet manages XCM-based capital integration for yield generation via Hydration Stableswap.
//!
//! ## Overview
//!
//! In v1, all LP positions are held under a single DAO account on Hydration (Pool 102: USDT/USDC).
//! Per-policy allocation is tracked only in PRMX storage. DeFi profit or loss is
//! fully borne by the DAO. Policy holders and LPs see only the deterministic insurance logic.
//!
//! ## Target: Hydration Stableswap Pool 102
//!
//! - Pool ID: 102
//! - Assets: USDT (ID 10) + USDC (ID 22)
//! - LP Token: Asset ID 102
//! - Route: PRMX -> Asset Hub -> Hydration
//!
//! ## Key Invariants
//!
//! 1. **Capital Source**: All capital deployed into DeFi comes from policy pools or the DAO
//! 2. **Deterministic Settlement**: Settlement always sees the same deterministic obligations
//! 3. **DAO Covers Losses**: DeFi loss is covered 100% by the DAO
//! 4. **DAO Receives Profits**: DeFi profit always accrues to the DAO
//! 5. **Full Unwind at Settlement**: All LP positions are fully unwound at settlement

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub use pallet::*;

// XCM configuration for Hydration Pool 102 integration (placeholder for future implementation)
pub mod xcm_config;

// Live XCM strategy interface for real cross-chain operations
pub mod xcm_strategy;
pub use xcm_strategy::LiveXcmStrategyInterface;

use frame_support::traits::fungibles::{Inspect, Mutate};
use frame_support::traits::tokens::Preservation;
use frame_support::traits::Get;
use sp_runtime::DispatchError;
use sp_runtime::traits::Zero;

// Import traits from policy pallet
pub use pallet_prmx_policy::{CapitalApi, PolicyPoolAccountApi, PolicyId};

// =============================================================================
//                    Hydration Pool 102 Configuration
// =============================================================================

/// Hydration parachain ID on Polkadot
pub const HYDRATION_PARA_ID: u32 = 2034;

/// Asset Hub parachain ID on Polkadot
pub const ASSET_HUB_PARA_ID: u32 = 1000;

/// Stableswap Pool ID on Hydration (USDT/USDC 2-Pool)
pub const STABLESWAP_POOL_ID: u32 = 102;

/// USDT asset ID on Hydration
pub const USDT_HYDRATION_ID: u32 = 10;

/// USDC asset ID on Hydration
pub const USDC_HYDRATION_ID: u32 = 22;

/// LP share token asset ID (equals pool ID for stableswap)
pub const LP_SHARE_ASSET_ID: u32 = 102;

/// USDT asset ID on Asset Hub (reserve location)
pub const USDT_ASSET_HUB_ID: u128 = 1984;

/// USDC asset ID on Asset Hub (reserve location)
pub const USDC_ASSET_HUB_ID: u128 = 1337;

// =============================================================================
//                              Traits
// =============================================================================

/// Trait for interacting with the XCM-based DeFi strategy on Hydration.
///
/// This trait encapsulates all XCM and Hydration Stableswap logic. In v1,
/// we use a mock implementation. In future versions, this will use
/// XCM Transact to call Hydration's stableswap.add_liquidity/remove_liquidity.
pub trait XcmStrategyInterface {
    type Balance;
    type AccountId;

    /// Enter the DeFi strategy with the given USDT principal.
    ///
    /// Implementation responsibilities:
    /// - Move principal USDT from PRMX via Asset Hub into Hydration DAO account
    /// - Call stableswap.add_liquidity on Pool 102
    /// - Return the number of LP share units minted for this principal
    fn enter_strategy(principal: Self::Balance) -> Result<u128, DispatchError>;

    /// Exit the DeFi strategy by redeeming the given number of LP share units.
    ///
    /// Implementation responsibilities:
    /// - Call stableswap.remove_liquidity_one_asset on Pool 102
    /// - Move all resulting USDT back to PRMX via Asset Hub into the policy pool account
    /// - Return the actual USDT amount realised for these shares
    fn exit_strategy(
        shares: u128,
        policy_pool_account: &Self::AccountId,
    ) -> Result<Self::Balance, DispatchError>;
}

#[frame_support::pallet]
pub mod pallet {
    use super::*;
    use alloc::vec::Vec;
    use frame_support::pallet_prelude::*;
    use frame_system::pallet_prelude::*;
    use sp_runtime::traits::{Saturating, Zero};

    // =========================================================================
    //                                  Types
    // =========================================================================

    /// Investment status for a policy's DeFi LP position
    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen, Default)]
    pub enum InvestmentStatus {
        /// Policy has no DeFi investment
        #[default]
        NotInvested,
        /// Policy capital is invested in DeFi (Hydration Stableswap)
        Invested,
        /// LP position is being unwound
        Unwinding,
        /// Policy is settled, LP position fully exited
        Settled,
        /// Investment operation failed
        Failed,
    }

    /// LP position information for a policy (Hydration Stableswap Pool 102)
    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
    #[scale_info(skip_type_params(T))]
    pub struct PolicyLpPosition<T: Config> {
        /// The policy this position belongs to
        pub policy_id: PolicyId,
        /// Number of LP share units allocated to this policy (Pool 102 LP tokens)
        pub lp_shares: u128,
        /// Principal USDT invested on behalf of this policy
        pub principal_usdt: T::Balance,
    }

    // =========================================================================
    //                                  Config
    // =========================================================================

    #[pallet::config]
    pub trait Config: frame_system::Config {
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
            + Saturating;

        /// Asset ID type
        type AssetId: Parameter + Member + Copy + Default + MaxEncodedLen;

        /// Fungibles implementation for USDT transfers
        type Assets: Mutate<Self::AccountId, AssetId = Self::AssetId, Balance = Self::Balance>
            + Inspect<Self::AccountId>;

        /// USDT asset ID
        #[pallet::constant]
        type UsdtAssetId: Get<Self::AssetId>;

        /// DAO account on PRMX side (receives profits, covers losses)
        #[pallet::constant]
        type DaoAccountId: Get<Self::AccountId>;

        /// Default allocation percentage to DeFi strategy (in ppm, 1_000_000 = 100%)
        #[pallet::constant]
        type DefaultAllocationPpm: Get<u32>;

        /// Interface that encapsulates XCM and Hydration Stableswap logic
        type XcmStrategyInterface: XcmStrategyInterface<
            Balance = Self::Balance,
            AccountId = Self::AccountId,
        >;

        /// Policy pool account derivation API
        type PolicyPoolAccount: PolicyPoolAccountApi<Self::AccountId>;
    }

    // =========================================================================
    //                                  Storage
    // =========================================================================

    #[pallet::pallet]
    pub struct Pallet<T>(_);

    /// LP share allocation and principal per policy (Pool 102)
    #[pallet::storage]
    #[pallet::getter(fn policy_lp_positions)]
    pub type PolicyLpPositions<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        PolicyId,
        PolicyLpPosition<T>,
        OptionQuery,
    >;

    /// Total LP shares held by the DAO account on Hydration (Pool 102)
    #[pallet::storage]
    #[pallet::getter(fn total_lp_shares)]
    pub type TotalLpShares<T: Config> = StorageValue<_, u128, ValueQuery>;

    /// High-level investment status per policy
    #[pallet::storage]
    #[pallet::getter(fn policy_investment_status)]
    pub type PolicyInvestmentStatus<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        PolicyId,
        InvestmentStatus,
        ValueQuery,
    >;

    /// Mock yield rate in parts per million (for testing).
    /// Positive values = profit, negative values = loss.
    /// 1_000_000 = 100%, so 50_000 = 5% profit, -50_000 = 5% loss
    #[pallet::storage]
    #[pallet::getter(fn mock_yield_rate_ppm)]
    pub type MockYieldRatePpm<T: Config> = StorageValue<_, i32, ValueQuery>;

    /// Configurable allocation percentage in ppm (1_000_000 = 100%).
    /// Default comes from Config::DefaultAllocationPpm.
    #[pallet::storage]
    #[pallet::getter(fn allocation_percentage_ppm)]
    pub type AllocationPercentagePpm<T: Config> = StorageValue<_, u32, ValueQuery>;

    /// Track total allocated capital across all policies (for frontend display)
    #[pallet::storage]
    #[pallet::getter(fn total_allocated_capital)]
    pub type TotalAllocatedCapital<T: Config> = StorageValue<_, T::Balance, ValueQuery>;

    /// Genesis initialization flag
    #[pallet::storage]
    pub type Initialized<T: Config> = StorageValue<_, bool, ValueQuery>;

    // =========================================================================
    //                                  Events
    // =========================================================================

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// Capital allocated to DeFi strategy (Hydration Pool 102). [policy_id, amount, shares]
        CapitalAllocated {
            policy_id: PolicyId,
            amount: T::Balance,
            shares: u128,
        },
        /// LP position unwound. [policy_id, shares, realised_amount]
        PositionUnwound {
            policy_id: PolicyId,
            shares: u128,
            realised_amount: T::Balance,
        },
        /// DAO topped up shortfall. [policy_id, shortfall_amount]
        DaoToppedUpShortfall {
            policy_id: PolicyId,
            shortfall_amount: T::Balance,
        },
        /// DAO received profit. [policy_id, profit_amount]
        DaoReceivedProfit {
            policy_id: PolicyId,
            profit_amount: T::Balance,
        },
        /// Policy LP position cleaned up. [policy_id]
        PolicyPositionCleanedUp {
            policy_id: PolicyId,
        },
        /// Mock yield rate updated. [new_rate_ppm]
        MockYieldRateUpdated {
            new_rate_ppm: i32,
        },
        /// Allocation percentage updated. [new_percentage_ppm]
        AllocationPercentageUpdated {
            new_percentage_ppm: u32,
        },
        /// DAO solvency check passed. [policy_id, allocation_amount, dao_balance, max_potential_loss]
        DaoSolvencyCheckPassed {
            policy_id: PolicyId,
            allocation_amount: T::Balance,
            dao_balance: T::Balance,
            max_potential_loss: T::Balance,
        },
        /// DAO solvency check warning - DAO may not cover full loss.
        /// [policy_id, allocation_amount, dao_balance, max_potential_loss]
        DaoSolvencyCheckWarning {
            policy_id: PolicyId,
            allocation_amount: T::Balance,
            dao_balance: T::Balance,
            max_potential_loss: T::Balance,
        },
        /// Loss absorption by LPs/holders due to DAO insolvency.
        /// [policy_id, shortfall_amount, covered_by_dao, absorbed_by_lps]
        LossAbsorbedByLps {
            policy_id: PolicyId,
            shortfall_amount: T::Balance,
            covered_by_dao: T::Balance,
            absorbed_by_lps: T::Balance,
        },
    }

    // =========================================================================
    //                                  Errors
    // =========================================================================

    #[pallet::error]
    pub enum Error<T> {
        /// Policy not found or not active.
        PolicyNotActive,
        /// Policy already has DeFi investment.
        AlreadyInvested,
        /// Policy has no LP position to unwind.
        NoPositionToUnwind,
        /// Insufficient funds in policy pool.
        InsufficientPoolFunds,
        /// Insufficient DAO funds to cover shortfall.
        InsufficientDaoFunds,
        /// DeFi strategy entry failed.
        StrategyEntryFailed,
        /// DeFi strategy exit failed.
        StrategyExitFailed,
        /// Transfer failed.
        TransferFailed,
        /// Arithmetic overflow.
        ArithmeticOverflow,
        /// Position is currently being unwound.
        PositionUnwinding,
    }

    // =========================================================================
    //                                Extrinsics
    // =========================================================================

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Allocate capital from a policy pool into the DeFi strategy (Hydration Pool 102).
        ///
        /// This is a DAO-controlled operation. The amount is transferred from the
        /// policy pool to the DeFi strategy, and the resulting LP shares are tracked.
        ///
        /// - `policy_id`: The policy whose capital to invest
        /// - `amount`: Amount of USDT to invest
        #[pallet::call_index(0)]
        #[pallet::weight(100_000)]
        pub fn dao_allocate_to_defi(
            origin: OriginFor<T>,
            policy_id: PolicyId,
            amount: T::Balance,
        ) -> DispatchResult {
            // Only DAO can call this
            ensure_root(origin)?;

            Self::do_allocate_to_defi(policy_id, amount)?;

            Ok(())
        }

        /// Set the mock yield rate for testing purposes.
        ///
        /// - `rate_ppm`: Yield rate in parts per million
        ///   - 50_000 = 5% profit
        ///   - -50_000 = 5% loss
        ///   - 0 = no yield (principal returned as-is)
        #[pallet::call_index(1)]
        #[pallet::weight(10_000)]
        pub fn set_mock_yield_rate(
            origin: OriginFor<T>,
            rate_ppm: i32,
        ) -> DispatchResult {
            ensure_root(origin)?;

            MockYieldRatePpm::<T>::put(rate_ppm);

            Self::deposit_event(Event::MockYieldRateUpdated { new_rate_ppm: rate_ppm });

            Ok(())
        }

        /// Set the allocation percentage for DeFi strategy (Hydration Pool 102).
        ///
        /// - `percentage_ppm`: Allocation percentage in parts per million
        ///   - 1_000_000 = 100%
        ///   - 500_000 = 50%
        ///   - 0 = no allocation
        #[pallet::call_index(2)]
        #[pallet::weight(10_000)]
        pub fn set_allocation_percentage(
            origin: OriginFor<T>,
            percentage_ppm: u32,
        ) -> DispatchResult {
            ensure_root(origin)?;

            // Cap at 100%
            let capped = core::cmp::min(percentage_ppm, 1_000_000);
            AllocationPercentagePpm::<T>::put(capped);

            log::info!(
                target: "prmx-xcm-capital",
                "⚙️ Allocation percentage set to {}% ({} ppm)",
                capped as f64 / 10_000.0,
                capped
            );

            Self::deposit_event(Event::AllocationPercentageUpdated { 
                new_percentage_ppm: capped 
            });

            Ok(())
        }
    }

    // =========================================================================
    //                           Internal Functions
    // =========================================================================

    impl<T: Config> Pallet<T> {
        /// Get the current allocation percentage (uses default if not set)
        pub fn get_allocation_percentage_ppm() -> u32 {
            let stored = AllocationPercentagePpm::<T>::get();
            if stored == 0 {
                T::DefaultAllocationPpm::get()
            } else {
                stored
            }
        }

        /// Internal implementation of allocate_to_defi
        pub fn do_allocate_to_defi(
            policy_id: PolicyId,
            amount: T::Balance,
        ) -> Result<(), DispatchError> {
            // Check current status
            let status = PolicyInvestmentStatus::<T>::get(policy_id);
            ensure!(
                status == InvestmentStatus::NotInvested,
                Error::<T>::AlreadyInvested
            );

            // Get pool account
            let pool_account = T::PolicyPoolAccount::policy_pool_account(policy_id);

            // Verify pool has enough funds
            let pool_balance = T::Assets::balance(T::UsdtAssetId::get(), &pool_account);
            ensure!(pool_balance >= amount, Error::<T>::InsufficientPoolFunds);

            // =================================================================
            // DAO SOLVENCY CHECK
            // =================================================================
            // Check if DAO has enough USDT to cover potential 100% loss of
            // the allocated amount. This is a pre-allocation safety check.
            // STRICT MODE: Block allocation if DAO cannot cover the loss.
            let dao_balance = T::Assets::balance(T::UsdtAssetId::get(), &T::DaoAccountId::get());
            let max_potential_loss = amount; // 100% loss scenario

            log::info!(
                target: "prmx-xcm-capital",
                "═══════════════════════════════════════════════════════════════════"
            );
            log::info!(
                target: "prmx-xcm-capital",
                "🔍 DAO SOLVENCY CHECK - Policy {} Allocation",
                policy_id
            );
            log::info!(
                target: "prmx-xcm-capital",
                "═══════════════════════════════════════════════════════════════════"
            );
            log::info!(
                target: "prmx-xcm-capital",
                "   📊 Allocation amount:      {} USDT",
                amount.into()
            );
            log::info!(
                target: "prmx-xcm-capital",
                "   💰 DAO current balance:    {} USDT",
                dao_balance.into()
            );
            log::info!(
                target: "prmx-xcm-capital",
                "   ⚠️  Max potential loss:    {} USDT (100%)",
                max_potential_loss.into()
            );

            if dao_balance >= max_potential_loss {
                log::info!(
                    target: "prmx-xcm-capital",
                    "   ✅ SOLVENCY CHECK PASSED: DAO can cover 100% loss"
                );
                log::info!(
                    target: "prmx-xcm-capital",
                    "   📈 Coverage ratio: {:.2}%",
                    (dao_balance.into() as f64 / max_potential_loss.into() as f64) * 100.0
                );
                
                Self::deposit_event(Event::DaoSolvencyCheckPassed {
                    policy_id,
                    allocation_amount: amount,
                    dao_balance,
                    max_potential_loss,
                });
            } else {
                log::error!(
                    target: "prmx-xcm-capital",
                    "   ❌ SOLVENCY CHECK FAILED: DAO cannot cover potential loss!"
                );
                log::error!(
                    target: "prmx-xcm-capital",
                    "   📉 DAO can only cover: {} USDT ({:.2}% of max loss)",
                    dao_balance.into(),
                    (dao_balance.into() as f64 / max_potential_loss.into() as f64) * 100.0
                );
                log::error!(
                    target: "prmx-xcm-capital",
                    "   🚫 BLOCKING ALLOCATION - DAO must add {} USDT before allocating",
                    (max_potential_loss.saturating_sub(dao_balance)).into()
                );
                log::info!(
                    target: "prmx-xcm-capital",
                    "═══════════════════════════════════════════════════════════════════"
                );
                
                Self::deposit_event(Event::DaoSolvencyCheckWarning {
                    policy_id,
                    allocation_amount: amount,
                    dao_balance,
                    max_potential_loss,
                });
                
                // STRICT MODE: Block allocation if DAO is insolvent
                return Err(Error::<T>::InsufficientDaoFunds.into());
            }
            log::info!(
                target: "prmx-xcm-capital",
                "═══════════════════════════════════════════════════════════════════"
            );

            // Solvency check passed - proceed with allocation

            // Transfer from pool to DAO (staging for DeFi entry)
            // Use Expendable since we may transfer 100% of pool balance
            T::Assets::transfer(
                T::UsdtAssetId::get(),
                &pool_account,
                &T::DaoAccountId::get(),
                amount,
                Preservation::Expendable,
            ).map_err(|_| Error::<T>::TransferFailed)?;

            // Enter DeFi strategy (Hydration Stableswap Pool 102)
            let minted_shares = T::XcmStrategyInterface::enter_strategy(amount)
                .map_err(|_| Error::<T>::StrategyEntryFailed)?;

            // Store position
            PolicyLpPositions::<T>::insert(
                policy_id,
                PolicyLpPosition {
                    policy_id,
                    lp_shares: minted_shares,
                    principal_usdt: amount,
                },
            );

            // Update total shares
            TotalLpShares::<T>::mutate(|total| {
                *total = total.saturating_add(minted_shares);
            });

            // Update total allocated capital
            TotalAllocatedCapital::<T>::mutate(|total| {
                *total = total.saturating_add(amount);
            });

            // Update status
            PolicyInvestmentStatus::<T>::insert(policy_id, InvestmentStatus::Invested);

            log::info!(
                target: "prmx-xcm-capital",
                "📈 Allocated {} USDT to DeFi (Pool 102) for policy {}, received {} LP shares",
                amount.into(),
                policy_id,
                minted_shares
            );

            Self::deposit_event(Event::CapitalAllocated {
                policy_id,
                amount,
                shares: minted_shares,
            });

            Ok(())
        }

        /// Ensure local liquidity for a policy by unwinding LP position if needed.
        ///
        /// This is called before settlement to ensure the policy pool has enough
        /// USDT to fulfill obligations. If DAO cannot cover the full shortfall,
        /// it covers what it can and LPs absorb the remaining loss.
        pub fn do_ensure_local_liquidity(
            policy_id: PolicyId,
            required_local: T::Balance,
        ) -> Result<(), DispatchError> {
            let status = PolicyInvestmentStatus::<T>::get(policy_id);

            // If not invested, nothing to do
            if status == InvestmentStatus::NotInvested || status == InvestmentStatus::Settled {
                return Ok(());
            }

            // Check for unwinding status
            ensure!(
                status != InvestmentStatus::Unwinding,
                Error::<T>::PositionUnwinding
            );

            // Get the position
            let pos = PolicyLpPositions::<T>::get(policy_id)
                .ok_or(Error::<T>::NoPositionToUnwind)?;

            let pool_account = T::PolicyPoolAccount::policy_pool_account(policy_id);

            // Mark as unwinding
            PolicyInvestmentStatus::<T>::insert(policy_id, InvestmentStatus::Unwinding);

            // Exit strategy - get all LP shares back
            let realised = T::XcmStrategyInterface::exit_strategy(
                pos.lp_shares,
                &pool_account,
            ).map_err(|_| Error::<T>::StrategyExitFailed)?;

            log::info!(
                target: "prmx-xcm-capital",
                "📉 Unwound {} LP shares for policy {}, realised {} USDT (principal was {})",
                pos.lp_shares,
                policy_id,
                realised.into(),
                pos.principal_usdt.into()
            );

            Self::deposit_event(Event::PositionUnwound {
                policy_id,
                shares: pos.lp_shares,
                realised_amount: realised,
            });

            // Update total allocated capital
            TotalAllocatedCapital::<T>::mutate(|total| {
                *total = total.saturating_sub(pos.principal_usdt);
            });

            // Check if we need DAO to top up
            let local_balance = T::Assets::balance(T::UsdtAssetId::get(), &pool_account);

            if local_balance < required_local {
                let shortfall = required_local.saturating_sub(local_balance);
                let dao_balance = T::Assets::balance(T::UsdtAssetId::get(), &T::DaoAccountId::get());

                log::info!(
                    target: "prmx-xcm-capital",
                    "💰 Shortfall detected: {} USDT for policy {}",
                    shortfall.into(),
                    policy_id
                );
                log::info!(
                    target: "prmx-xcm-capital",
                    "   DAO balance: {} USDT",
                    dao_balance.into()
                );

                if dao_balance >= shortfall {
                    // DAO can cover the full shortfall
                    log::info!(
                        target: "prmx-xcm-capital",
                        "   ✅ DAO covering full shortfall of {} USDT",
                        shortfall.into()
                    );

                    T::Assets::transfer(
                        T::UsdtAssetId::get(),
                        &T::DaoAccountId::get(),
                        &pool_account,
                        shortfall,
                        Preservation::Preserve,
                    ).map_err(|_| Error::<T>::TransferFailed)?;

                    Self::deposit_event(Event::DaoToppedUpShortfall {
                        policy_id,
                        shortfall_amount: shortfall,
                    });
                } else {
                    // DAO cannot cover full shortfall - cover what we can
                    // LPs will absorb the remaining loss
                    let covered_by_dao = dao_balance;
                    let absorbed_by_lps = shortfall.saturating_sub(dao_balance);

                    log::warn!(
                        target: "prmx-xcm-capital",
                        "═══════════════════════════════════════════════════════════════════"
                    );
                    log::warn!(
                        target: "prmx-xcm-capital",
                        "⚠️  DAO INSOLVENCY - Policy {} Loss Absorption",
                        policy_id
                    );
                    log::warn!(
                        target: "prmx-xcm-capital",
                        "═══════════════════════════════════════════════════════════════════"
                    );
                    log::warn!(
                        target: "prmx-xcm-capital",
                        "   Total shortfall:     {} USDT",
                        shortfall.into()
                    );
                    log::warn!(
                        target: "prmx-xcm-capital",
                        "   DAO can cover:       {} USDT",
                        covered_by_dao.into()
                    );
                    log::warn!(
                        target: "prmx-xcm-capital",
                        "   LPs must absorb:     {} USDT",
                        absorbed_by_lps.into()
                    );
                    log::warn!(
                        target: "prmx-xcm-capital",
                        "═══════════════════════════════════════════════════════════════════"
                    );

                    // Transfer what DAO can cover
                    if covered_by_dao > T::Balance::zero() {
                        T::Assets::transfer(
                            T::UsdtAssetId::get(),
                            &T::DaoAccountId::get(),
                            &pool_account,
                            covered_by_dao,
                            Preservation::Preserve,
                        ).map_err(|_| Error::<T>::TransferFailed)?;
                    }

                    Self::deposit_event(Event::LossAbsorbedByLps {
                        policy_id,
                        shortfall_amount: shortfall,
                        covered_by_dao,
                        absorbed_by_lps,
                    });
                }
            } else if local_balance > required_local {
                // DAO receives the profit
                let profit = local_balance.saturating_sub(required_local);

                log::info!(
                    target: "prmx-xcm-capital",
                    "🎉 DAO receiving profit of {} USDT from policy {}",
                    profit.into(),
                    policy_id
                );

                T::Assets::transfer(
                    T::UsdtAssetId::get(),
                    &pool_account,
                    &T::DaoAccountId::get(),
                    profit,
                    Preservation::Preserve,
                ).map_err(|_| Error::<T>::TransferFailed)?;

                Self::deposit_event(Event::DaoReceivedProfit {
                    policy_id,
                    profit_amount: profit,
                });
            }

            // Update total shares
            TotalLpShares::<T>::mutate(|total| {
                *total = total.saturating_sub(pos.lp_shares);
            });

            // Clean up position
            PolicyLpPositions::<T>::remove(policy_id);
            PolicyInvestmentStatus::<T>::insert(policy_id, InvestmentStatus::Settled);

            Ok(())
        }

        /// Called when a policy is fully settled to perform any final cleanup.
        pub fn do_on_policy_settled(policy_id: PolicyId) -> Result<(), DispatchError> {
            // Ensure no lingering position
            if PolicyLpPositions::<T>::contains_key(policy_id) {
                PolicyLpPositions::<T>::remove(policy_id);
            }

            // Mark as settled if not already
            PolicyInvestmentStatus::<T>::insert(policy_id, InvestmentStatus::Settled);

            log::info!(
                target: "prmx-xcm-capital",
                "✅ Policy {} LP position cleaned up",
                policy_id
            );

            Self::deposit_event(Event::PolicyPositionCleanedUp { policy_id });

            Ok(())
        }

        /// Get all invested policies (for diagnostics)
        pub fn get_invested_policies() -> Vec<PolicyId> {
            PolicyLpPositions::<T>::iter_keys().collect()
        }
    }
}

// =============================================================================
//                       CapitalApi Implementation
// =============================================================================

impl<T: Config> CapitalApi<T::AccountId> for Pallet<T> {
    type Balance = T::Balance;

    fn allocate_to_defi(
        policy_id: PolicyId,
        amount: Self::Balance,
    ) -> Result<(), DispatchError> {
        pallet::Pallet::<T>::do_allocate_to_defi(policy_id, amount)
    }

    fn auto_allocate_policy_capital(
        policy_id: PolicyId,
        pool_balance: Self::Balance,
    ) -> Result<(), DispatchError> {
        // Get allocation percentage (in ppm)
        let allocation_ppm = pallet::Pallet::<T>::get_allocation_percentage_ppm();
        
        if allocation_ppm == 0 {
            log::info!(
                target: "prmx-xcm-capital",
                "📊 Auto-allocation disabled (0%) for policy {}",
                policy_id
            );
            return Ok(());
        }

        // Calculate allocation amount: pool_balance * allocation_ppm / 1_000_000
        let pool_u128: u128 = pool_balance.into();
        let allocation_u128 = pool_u128
            .saturating_mul(allocation_ppm as u128)
            / 1_000_000u128;
        
        if allocation_u128 == 0 {
            return Ok(());
        }

        let allocation: T::Balance = allocation_u128.into();

        log::info!(
            target: "prmx-xcm-capital",
            "🔄 Auto-allocating {}% of policy {} capital ({} USDT) to DeFi (Pool 102)",
            allocation_ppm as f64 / 10_000.0,
            policy_id,
            allocation_u128
        );

        pallet::Pallet::<T>::do_allocate_to_defi(policy_id, allocation)
    }

    fn ensure_local_liquidity(
        policy_id: PolicyId,
        required_local: Self::Balance,
    ) -> Result<(), DispatchError> {
        pallet::Pallet::<T>::do_ensure_local_liquidity(policy_id, required_local)
    }

    fn on_policy_settled(policy_id: PolicyId) -> Result<(), DispatchError> {
        pallet::Pallet::<T>::do_on_policy_settled(policy_id)
    }
}

// =============================================================================
//                       Mock XCM Strategy Interface
// =============================================================================

/// Mock implementation of XcmStrategyInterface for testing.
///
/// This mock simulates Hydration Stableswap Pool 102 entry/exit without actual XCM calls.
/// The yield/loss can be configured via the MockYieldRatePpm storage.
pub struct MockXcmStrategyInterface<T>(core::marker::PhantomData<T>);

impl<T: Config> XcmStrategyInterface for MockXcmStrategyInterface<T> {
    type Balance = T::Balance;
    type AccountId = T::AccountId;

    /// Enter strategy: LP shares = principal (1:1 mapping for simplicity)
    fn enter_strategy(principal: Self::Balance) -> Result<u128, DispatchError> {
        // In mock, LP shares are 1:1 with principal
        let principal_u128: u128 = principal.into();
        
        log::info!(
            target: "prmx-xcm-capital",
            "🔧 [MOCK] Entering DeFi strategy (Pool 102) with {} principal, minting {} LP shares",
            principal_u128,
            principal_u128
        );

        Ok(principal_u128)
    }

    /// Exit strategy: apply mock yield rate to determine realised amount
    fn exit_strategy(
        shares: u128,
        pool_account: &Self::AccountId,
    ) -> Result<Self::Balance, DispatchError> {
        // Get configured yield rate
        let yield_rate_ppm = pallet::MockYieldRatePpm::<T>::get();

        // Calculate realised amount with yield/loss
        // realised = shares * (1 + yield_rate_ppm / 1_000_000)
        let realised_u128 = if yield_rate_ppm >= 0 {
            let yield_amount = (shares as u128)
                .saturating_mul(yield_rate_ppm as u128)
                / 1_000_000u128;
            shares.saturating_add(yield_amount)
        } else {
            let loss_amount = (shares as u128)
                .saturating_mul((-yield_rate_ppm) as u128)
                / 1_000_000u128;
            shares.saturating_sub(loss_amount)
        };

        let realised: T::Balance = realised_u128.into();

        log::info!(
            target: "prmx-xcm-capital",
            "🔧 [MOCK] Exiting DeFi strategy (Pool 102) with {} LP shares, yield_rate={}ppm, realised={}",
            shares,
            yield_rate_ppm,
            realised_u128
        );

        // In the mock, we simulate the transfer by having the DAO account
        // transfer funds to the pool account. The DAO received the principal
        // when entering, so it should have funds (potentially more or less
        // depending on yield).
        // Note: In real implementation, this would be done via XCM from Hydration.
        
        // Check DAO balance - in real scenario funds come from Hydration, not local DAO
        // For mock, transfer what's available (simulating partial return from DeFi)
        let dao_balance = T::Assets::balance(T::UsdtAssetId::get(), &T::DaoAccountId::get());
        let actual_transfer = if dao_balance < realised {
            log::warn!(
                target: "prmx-xcm-capital",
                "🔧 [MOCK] DAO only has {} USDT, can't transfer full {} USDT from DeFi",
                dao_balance.into(),
                realised.into()
            );
            dao_balance
        } else {
            realised
        };

        if actual_transfer > Zero::zero() {
            T::Assets::transfer(
                T::UsdtAssetId::get(),
                &T::DaoAccountId::get(),
                pool_account,
                actual_transfer,
                Preservation::Expendable,
            ).map_err(|_| DispatchError::Other("Mock transfer failed"))?;
        }

        // Return actual amount transferred (may be less than expected due to insolvency)
        Ok(actual_transfer)
    }
}
