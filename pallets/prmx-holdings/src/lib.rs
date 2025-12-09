//! # PRMX Holdings Pallet
//!
//! This pallet manages LP Token holdings per **policy**. LP Tokens represent
//! exposure to a specific policy's risk pool.
//!
//! ## Overview
//!
//! - Tracks LP Token holdings per (policy_id, account).
//! - Each policy has its own isolated LP token pool.
//! - Provides trait `HoldingsApi` for other pallets to mint/burn/transfer LP tokens.
//! - **Automatic LP payout distribution** when policies settle.
//!
//! ## Key Design Decision
//!
//! LP tokens are **policy-specific**, not market-specific. This ensures:
//! - Each policy has isolated risk exposure
//! - LP holders only receive payouts from policies they invested in
//! - Different policies can have different LP token distributions

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub use pallet::*;

/// Policy ID type (matches pallet_prmx_policy)
pub type PolicyId = u64;

/// Trait for other pallets to interact with LP Token holdings
pub trait HoldingsApi<AccountId> {
    type Balance;

    /// Mint LP tokens to an account for a specific policy
    fn mint_lp_tokens(
        policy_id: PolicyId,
        to: &AccountId,
        amount: u128,
    ) -> Result<(), sp_runtime::DispatchError>;

    /// Burn LP tokens from an account for a specific policy
    fn burn_lp_tokens(
        policy_id: PolicyId,
        from: &AccountId,
        amount: u128,
    ) -> Result<(), sp_runtime::DispatchError>;

    /// Transfer LP tokens between accounts for a specific policy
    fn transfer_lp_tokens(
        policy_id: PolicyId,
        from: &AccountId,
        to: &AccountId,
        amount: u128,
    ) -> Result<(), sp_runtime::DispatchError>;

    /// Transfer locked LP tokens between accounts for a specific policy
    fn transfer_locked_lp_tokens(
        policy_id: PolicyId,
        from: &AccountId,
        to: &AccountId,
        amount: u128,
    ) -> Result<(), sp_runtime::DispatchError>;

    /// Get LP token balance for an account in a policy
    fn lp_balance(policy_id: PolicyId, who: &AccountId) -> u128;

    /// Get total LP shares for a policy
    fn total_lp_shares(policy_id: PolicyId) -> u128;

    /// Lock LP tokens (for orderbook asks)
    fn lock_lp_tokens(
        policy_id: PolicyId,
        who: &AccountId,
        amount: u128,
    ) -> Result<(), sp_runtime::DispatchError>;

    /// Unlock LP tokens (for cancelled orders)
    fn unlock_lp_tokens(
        policy_id: PolicyId,
        who: &AccountId,
        amount: u128,
    ) -> Result<(), sp_runtime::DispatchError>;

    /// Get locked LP token balance for an account in a policy
    fn locked_lp_balance(policy_id: PolicyId, who: &AccountId) -> u128;

    /// Distribute USDT to LP holders pro-rata (automatic payout)
    fn distribute_to_lp_holders(
        policy_id: PolicyId,
        from_account: &AccountId,
        total_amount: Self::Balance,
    ) -> Result<(), sp_runtime::DispatchError>;

    /// Register an LP holder for a policy (for tracking)
    fn register_lp_holder(
        policy_id: PolicyId,
        holder: &AccountId,
    ) -> Result<(), sp_runtime::DispatchError>;

    /// Cleanup LP tokens after policy settlement
    /// Burns all LP tokens and clears storage for this policy
    fn cleanup_policy_lp_tokens(
        policy_id: PolicyId,
    ) -> Result<(), sp_runtime::DispatchError>;
}

#[frame_support::pallet]
pub mod pallet {
    use super::*;
    use frame_support::pallet_prelude::*;
    use frame_support::traits::fungibles::{Inspect, Mutate};

    // =========================================================================
    //                                  Types
    // =========================================================================

    /// Holdings structure for an account in a policy
    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen, Default)]
    pub struct Holdings {
        /// Number of LP shares held (free balance)
        pub lp_shares: u128,
        /// Number of LP shares locked (for orderbook asks)
        pub locked_shares: u128,
    }

    /// Asset ID type alias
    pub type AssetIdOf<T> = <<T as Config>::Assets as Inspect<<T as frame_system::Config>::AccountId>>::AssetId;
    pub type AssetBalanceOf<T> = <<T as Config>::Assets as Inspect<<T as frame_system::Config>::AccountId>>::Balance;

    // =========================================================================
    //                                  Config
    // =========================================================================

    #[pallet::config]
    pub trait Config: frame_system::Config {
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;

        /// Balance type
        type Balance: Parameter + Member + From<u128> + Into<u128> + Copy + Default + MaxEncodedLen;

        /// Assets pallet for USDT transfers
        type Assets: Inspect<Self::AccountId> + Mutate<Self::AccountId>;

        /// USDT Asset ID
        #[pallet::constant]
        type UsdtAssetId: Get<AssetIdOf<Self>>;

        /// Maximum number of LP holders per policy (for bounded iteration)
        #[pallet::constant]
        type MaxLpHoldersPerPolicy: Get<u32>;
    }

    // =========================================================================
    //                                  Storage
    // =========================================================================

    #[pallet::pallet]
    pub struct Pallet<T>(_);

    /// Holdings per (policy_id, account_id)
    /// Each policy has its own LP token pool
    #[pallet::storage]
    #[pallet::getter(fn holdings)]
    pub type HoldingsStorage<T: Config> = StorageDoubleMap<
        _,
        Blake2_128Concat,
        PolicyId,
        Blake2_128Concat,
        T::AccountId,
        Holdings,
        ValueQuery,
    >;

    /// Total LP shares per policy
    #[pallet::storage]
    #[pallet::getter(fn total_lp_shares)]
    pub type TotalLpShares<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        PolicyId,
        u128,
        ValueQuery,
    >;

    /// List of LP holders per policy (for automatic distribution)
    #[pallet::storage]
    #[pallet::getter(fn lp_holders)]
    pub type LpHolders<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        PolicyId,
        BoundedVec<T::AccountId, T::MaxLpHoldersPerPolicy>,
        ValueQuery,
    >;

    /// Tracks whether an account is registered as LP holder for a policy
    #[pallet::storage]
    pub type IsLpHolder<T: Config> = StorageDoubleMap<
        _,
        Blake2_128Concat,
        PolicyId,
        Blake2_128Concat,
        T::AccountId,
        bool,
        ValueQuery,
    >;

    // =========================================================================
    //                                  Events
    // =========================================================================

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// LP tokens minted for a policy. [policy_id, account, amount]
        LpTokensMinted {
            policy_id: PolicyId,
            account: T::AccountId,
            amount: u128,
        },
        /// LP tokens burned for a policy. [policy_id, account, amount]
        LpTokensBurned {
            policy_id: PolicyId,
            account: T::AccountId,
            amount: u128,
        },
        /// LP tokens transferred for a policy. [policy_id, from, to, amount]
        LpTokensTransferred {
            policy_id: PolicyId,
            from: T::AccountId,
            to: T::AccountId,
            amount: u128,
        },
        /// LP tokens locked for orderbook. [policy_id, account, amount]
        LpTokensLocked {
            policy_id: PolicyId,
            account: T::AccountId,
            amount: u128,
        },
        /// LP tokens unlocked from orderbook. [policy_id, account, amount]
        LpTokensUnlocked {
            policy_id: PolicyId,
            account: T::AccountId,
            amount: u128,
        },
        /// Automatic LP payout distributed. [policy_id, total_distributed, num_holders]
        LpPayoutDistributed {
            policy_id: PolicyId,
            total_distributed: T::Balance,
            num_holders: u32,
        },
        /// LP holder registered for a policy. [policy_id, account]
        LpHolderRegistered {
            policy_id: PolicyId,
            account: T::AccountId,
        },
        /// Policy LP tokens cleaned up after settlement. [policy_id, total_burned, num_holders]
        PolicyLpTokensCleaned {
            policy_id: PolicyId,
            total_burned: u128,
            num_holders: u32,
        },
    }

    // =========================================================================
    //                                  Errors
    // =========================================================================

    #[pallet::error]
    pub enum Error<T> {
        /// Insufficient LP balance.
        InsufficientBalance,
        /// Insufficient locked balance.
        InsufficientLockedBalance,
        /// Arithmetic overflow.
        ArithmeticOverflow,
        /// Too many LP holders for this policy.
        TooManyLpHolders,
        /// Transfer failed.
        TransferFailed,
        /// No LP shares in policy.
        NoLpShares,
    }

    // =========================================================================
    //                                Extrinsics
    // =========================================================================

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        // No public extrinsics - all operations go through HoldingsApi
    }

    // =========================================================================
    //                           Internal Functions
    // =========================================================================

    impl<T: Config> Pallet<T> {
        /// Internal function to mint LP tokens for a policy
        pub fn do_mint_lp_tokens(
            policy_id: PolicyId,
            to: &T::AccountId,
            amount: u128,
        ) -> DispatchResult {
            HoldingsStorage::<T>::try_mutate(policy_id, to, |holdings| -> DispatchResult {
                holdings.lp_shares = holdings.lp_shares
                    .checked_add(amount)
                    .ok_or(Error::<T>::ArithmeticOverflow)?;
                Ok(())
            })?;

            TotalLpShares::<T>::try_mutate(policy_id, |total| -> DispatchResult {
                *total = total.checked_add(amount).ok_or(Error::<T>::ArithmeticOverflow)?;
                Ok(())
            })?;

            Self::deposit_event(Event::LpTokensMinted {
                policy_id,
                account: to.clone(),
                amount,
            });

            Ok(())
        }

        /// Internal function to burn LP tokens for a policy
        pub fn do_burn_lp_tokens(
            policy_id: PolicyId,
            from: &T::AccountId,
            amount: u128,
        ) -> DispatchResult {
            HoldingsStorage::<T>::try_mutate(policy_id, from, |holdings| -> DispatchResult {
                holdings.lp_shares = holdings.lp_shares
                    .checked_sub(amount)
                    .ok_or(Error::<T>::InsufficientBalance)?;
                Ok(())
            })?;

            TotalLpShares::<T>::try_mutate(policy_id, |total| -> DispatchResult {
                *total = total.checked_sub(amount).ok_or(Error::<T>::ArithmeticOverflow)?;
                Ok(())
            })?;

            Self::deposit_event(Event::LpTokensBurned {
                policy_id,
                account: from.clone(),
                amount,
            });

            Ok(())
        }

        /// Internal function to transfer LP tokens for a policy
        pub fn do_transfer_lp_tokens(
            policy_id: PolicyId,
            from: &T::AccountId,
            to: &T::AccountId,
            amount: u128,
        ) -> DispatchResult {
            // Deduct from sender
            HoldingsStorage::<T>::try_mutate(policy_id, from, |holdings| -> DispatchResult {
                holdings.lp_shares = holdings.lp_shares
                    .checked_sub(amount)
                    .ok_or(Error::<T>::InsufficientBalance)?;
                Ok(())
            })?;

            // Credit to receiver
            HoldingsStorage::<T>::try_mutate(policy_id, to, |holdings| -> DispatchResult {
                holdings.lp_shares = holdings.lp_shares
                    .checked_add(amount)
                    .ok_or(Error::<T>::ArithmeticOverflow)?;
                Ok(())
            })?;

            Self::deposit_event(Event::LpTokensTransferred {
                policy_id,
                from: from.clone(),
                to: to.clone(),
                amount,
            });

            Ok(())
        }

        /// Internal function to lock LP tokens (for orderbook asks)
        pub fn do_lock_lp_tokens(
            policy_id: PolicyId,
            who: &T::AccountId,
            amount: u128,
        ) -> DispatchResult {
            HoldingsStorage::<T>::try_mutate(policy_id, who, |holdings| -> DispatchResult {
                holdings.lp_shares = holdings.lp_shares
                    .checked_sub(amount)
                    .ok_or(Error::<T>::InsufficientBalance)?;
                holdings.locked_shares = holdings.locked_shares
                    .checked_add(amount)
                    .ok_or(Error::<T>::ArithmeticOverflow)?;
                Ok(())
            })?;

            Self::deposit_event(Event::LpTokensLocked {
                policy_id,
                account: who.clone(),
                amount,
            });

            Ok(())
        }

        /// Internal function to unlock LP tokens (for cancelled orders)
        pub fn do_unlock_lp_tokens(
            policy_id: PolicyId,
            who: &T::AccountId,
            amount: u128,
        ) -> DispatchResult {
            HoldingsStorage::<T>::try_mutate(policy_id, who, |holdings| -> DispatchResult {
                holdings.locked_shares = holdings.locked_shares
                    .checked_sub(amount)
                    .ok_or(Error::<T>::InsufficientLockedBalance)?;
                holdings.lp_shares = holdings.lp_shares
                    .checked_add(amount)
                    .ok_or(Error::<T>::ArithmeticOverflow)?;
                Ok(())
            })?;

            Self::deposit_event(Event::LpTokensUnlocked {
                policy_id,
                account: who.clone(),
                amount,
            });

            Ok(())
        }

        /// Transfer locked LP tokens directly (for filled orders)
        pub fn do_transfer_locked_lp_tokens(
            policy_id: PolicyId,
            from: &T::AccountId,
            to: &T::AccountId,
            amount: u128,
        ) -> DispatchResult {
            // Deduct from sender's locked balance
            HoldingsStorage::<T>::try_mutate(policy_id, from, |holdings| -> DispatchResult {
                holdings.locked_shares = holdings.locked_shares
                    .checked_sub(amount)
                    .ok_or(Error::<T>::InsufficientLockedBalance)?;
                Ok(())
            })?;

            // Credit to receiver's free balance
            HoldingsStorage::<T>::try_mutate(policy_id, to, |holdings| -> DispatchResult {
                holdings.lp_shares = holdings.lp_shares
                    .checked_add(amount)
                    .ok_or(Error::<T>::ArithmeticOverflow)?;
                Ok(())
            })?;

            Self::deposit_event(Event::LpTokensTransferred {
                policy_id,
                from: from.clone(),
                to: to.clone(),
                amount,
            });

            Ok(())
        }

        /// Get free LP balance for an account in a policy
        pub fn get_lp_balance(policy_id: PolicyId, who: &T::AccountId) -> u128 {
            HoldingsStorage::<T>::get(policy_id, who).lp_shares
        }

        /// Get locked LP balance for an account in a policy
        pub fn get_locked_lp_balance(policy_id: PolicyId, who: &T::AccountId) -> u128 {
            HoldingsStorage::<T>::get(policy_id, who).locked_shares
        }

        /// Get total LP shares for a policy
        pub fn get_total_lp_shares(policy_id: PolicyId) -> u128 {
            TotalLpShares::<T>::get(policy_id)
        }

        /// Register an LP holder for a policy (for tracking distributions)
        pub fn do_register_lp_holder(
            policy_id: PolicyId,
            holder: &T::AccountId,
        ) -> DispatchResult {
            // Skip if already registered
            if IsLpHolder::<T>::get(policy_id, holder) {
                return Ok(());
            }

            // Add to holders list
            LpHolders::<T>::try_mutate(policy_id, |holders| -> DispatchResult {
                holders.try_push(holder.clone())
                    .map_err(|_| Error::<T>::TooManyLpHolders)?;
                Ok(())
            })?;

            // Mark as registered
            IsLpHolder::<T>::insert(policy_id, holder, true);

            Self::deposit_event(Event::LpHolderRegistered {
                policy_id,
                account: holder.clone(),
            });

            Ok(())
        }

        /// Distribute USDT to all LP holders pro-rata for a specific policy
        /// This is the automatic payout mechanism
        pub fn do_distribute_to_lp_holders(
            policy_id: PolicyId,
            from_account: &T::AccountId,
            total_amount: T::Balance,
        ) -> DispatchResult {
            let total_lp_shares = TotalLpShares::<T>::get(policy_id);
            ensure!(total_lp_shares > 0, Error::<T>::NoLpShares);

            let holders = LpHolders::<T>::get(policy_id);
            let total_amount_u128: u128 = total_amount.into();
            let mut distributed: u128 = 0;
            let num_holders = holders.len() as u32;

            for holder in holders.iter() {
                let holdings = HoldingsStorage::<T>::get(policy_id, holder);
                let holder_shares = holdings.lp_shares.saturating_add(holdings.locked_shares);
                
                if holder_shares > 0 {
                    // Calculate pro-rata share: (holder_shares / total_shares) * total_amount
                    let payout_u128 = total_amount_u128
                        .saturating_mul(holder_shares)
                        / total_lp_shares;
                    
                    if payout_u128 > 0 {
                        let payout: AssetBalanceOf<T> = payout_u128.try_into().unwrap_or_default();
                        
                        // Transfer USDT from source to LP holder
                        T::Assets::transfer(
                            T::UsdtAssetId::get(),
                            from_account,
                            holder,
                            payout,
                            frame_support::traits::tokens::Preservation::Expendable,
                        ).map_err(|_| Error::<T>::TransferFailed)?;
                        
                        distributed = distributed.saturating_add(payout_u128);
                    }
                }
            }

            let distributed_balance: T::Balance = distributed.into();
            Self::deposit_event(Event::LpPayoutDistributed {
                policy_id,
                total_distributed: distributed_balance,
                num_holders,
            });

            Ok(())
        }

        /// Cleanup all LP tokens for a settled policy
        /// Burns all LP tokens and clears storage
        pub fn do_cleanup_policy_lp_tokens(
            policy_id: PolicyId,
        ) -> DispatchResult {
            let holders = LpHolders::<T>::get(policy_id);
            let num_holders = holders.len() as u32;
            let mut total_burned: u128 = 0;

            // Burn all LP tokens from each holder
            for holder in holders.iter() {
                let holdings = HoldingsStorage::<T>::get(policy_id, holder);
                let holder_total = holdings.lp_shares.saturating_add(holdings.locked_shares);
                
                if holder_total > 0 {
                    total_burned = total_burned.saturating_add(holder_total);
                    
                    // Clear the holder's storage for this policy
                    HoldingsStorage::<T>::remove(policy_id, holder);
                }
                
                // Clear the LP holder flag
                IsLpHolder::<T>::remove(policy_id, holder);
            }

            // Clear total LP shares for this policy
            TotalLpShares::<T>::remove(policy_id);

            // Clear LP holders list
            LpHolders::<T>::remove(policy_id);

            Self::deposit_event(Event::PolicyLpTokensCleaned {
                policy_id,
                total_burned,
                num_holders,
            });

            Ok(())
        }
    }

    // =========================================================================
    //                         HoldingsApi Implementation
    // =========================================================================

    impl<T: Config> HoldingsApi<T::AccountId> for Pallet<T> {
        type Balance = T::Balance;

        fn mint_lp_tokens(
            policy_id: PolicyId,
            to: &T::AccountId,
            amount: u128,
        ) -> Result<(), sp_runtime::DispatchError> {
            Self::do_mint_lp_tokens(policy_id, to, amount)
        }

        fn burn_lp_tokens(
            policy_id: PolicyId,
            from: &T::AccountId,
            amount: u128,
        ) -> Result<(), sp_runtime::DispatchError> {
            Self::do_burn_lp_tokens(policy_id, from, amount)
        }

        fn transfer_lp_tokens(
            policy_id: PolicyId,
            from: &T::AccountId,
            to: &T::AccountId,
            amount: u128,
        ) -> Result<(), sp_runtime::DispatchError> {
            Self::do_transfer_lp_tokens(policy_id, from, to, amount)
        }

        fn lp_balance(policy_id: PolicyId, who: &T::AccountId) -> u128 {
            Self::get_lp_balance(policy_id, who)
        }

        fn total_lp_shares(policy_id: PolicyId) -> u128 {
            Self::get_total_lp_shares(policy_id)
        }

        fn lock_lp_tokens(
            policy_id: PolicyId,
            who: &T::AccountId,
            amount: u128,
        ) -> Result<(), sp_runtime::DispatchError> {
            Self::do_lock_lp_tokens(policy_id, who, amount)
        }

        fn unlock_lp_tokens(
            policy_id: PolicyId,
            who: &T::AccountId,
            amount: u128,
        ) -> Result<(), sp_runtime::DispatchError> {
            Self::do_unlock_lp_tokens(policy_id, who, amount)
        }

        fn transfer_locked_lp_tokens(
            policy_id: PolicyId,
            from: &T::AccountId,
            to: &T::AccountId,
            amount: u128,
        ) -> Result<(), sp_runtime::DispatchError> {
            Self::do_transfer_locked_lp_tokens(policy_id, from, to, amount)
        }

        fn locked_lp_balance(policy_id: PolicyId, who: &T::AccountId) -> u128 {
            Self::get_locked_lp_balance(policy_id, who)
        }

        fn distribute_to_lp_holders(
            policy_id: PolicyId,
            from_account: &T::AccountId,
            total_amount: Self::Balance,
        ) -> Result<(), sp_runtime::DispatchError> {
            Pallet::<T>::do_distribute_to_lp_holders(policy_id, from_account, total_amount)
        }

        fn register_lp_holder(
            policy_id: PolicyId,
            holder: &T::AccountId,
        ) -> Result<(), sp_runtime::DispatchError> {
            Pallet::<T>::do_register_lp_holder(policy_id, holder)
        }

        fn cleanup_policy_lp_tokens(
            policy_id: PolicyId,
        ) -> Result<(), sp_runtime::DispatchError> {
            Pallet::<T>::do_cleanup_policy_lp_tokens(policy_id)
        }
    }
}
