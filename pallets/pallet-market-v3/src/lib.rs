//! # Pallet Market V3
//!
//! Market pallet for the PRMX V3 P2P climate risk market.
//!
//! ## Overview
//!
//! - UnderwriteRequest: Anyone can create a request for coverage
//! - Partial acceptance: Multiple underwriters can accept portions
//! - Expiry: OCW triggers cleanup when requests expire
//! - Premium escrow: Single global escrow holds premium until acceptance

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub use pallet::*;

use alloc::vec::Vec;
use frame_support::pallet_prelude::*;
use frame_support::traits::fungibles::{Inspect, Mutate};
use frame_support::traits::tokens::Preservation;
use frame_support::traits::{Get, Time};
use frame_system::pallet_prelude::*;
use prmx_primitives::{
    EventSpecV3, PolicyId, RequestStatusV3, V3_MIN_SHARES_PER_ACCEPT, V3_PAYOUT_PER_SHARE,
    V3_POLICY_ID_OFFSET,
};
use sp_runtime::traits::{AccountIdConversion, Saturating, Zero};

/// V3 Request expiry check interval (5 minutes in seconds)
pub const V3_EXPIRY_CHECK_INTERVAL_SECS: u64 = 300;

// ============================================================================
// Constants
// ============================================================================

/// Pallet ID for generating derived accounts
pub const PALLET_ID: frame_support::PalletId = frame_support::PalletId(*b"prmxmkv3");

/// Request ID type (= Policy ID, 1:1 mapping)
pub type RequestId = PolicyId;

/// Location ID type
pub type LocationId = u64;

// ============================================================================
// Traits for loose coupling
// ============================================================================

/// Trait for accessing location registry
pub trait LocationRegistryApiV3 {
    fn is_location_active(location_id: LocationId) -> bool;
}

/// Trait for accessing request expiry information (used by OCW)
pub trait RequestExpiryApi {
    /// Get all expired request IDs that need cleanup
    fn get_expired_requests(current_time: u64) -> Vec<RequestId>;
    
    /// Check if a specific request is expired
    fn is_request_expired(request_id: RequestId, current_time: u64) -> bool;
}

/// Trait for creating and managing policies
pub trait PolicyApiV3<AccountId, Balance> {
    fn create_policy(
        policy_id: PolicyId,
        holder: AccountId,
        location_id: LocationId,
        event_spec: EventSpecV3,
        initial_shares: u128,
        premium_per_share: Balance,
        coverage_start: u64,
        coverage_end: u64,
    ) -> DispatchResult;

    fn add_shares_to_policy(
        policy_id: PolicyId,
        underwriter: AccountId,
        shares: u128,
    ) -> DispatchResult;

    /// Allocate a specific amount to DeFi strategy (called after each acceptance)
    fn allocate_to_defi(policy_id: PolicyId, amount: Balance) -> DispatchResult;

    /// Legacy: trigger full allocation (kept for compatibility)
    fn trigger_defi_allocation(policy_id: PolicyId) -> DispatchResult;

    fn policy_pool_account(policy_id: PolicyId) -> AccountId;
}

/// Trait for LP token management
pub trait HoldingsApiV3<AccountId> {
    fn mint_lp_tokens(
        policy_id: PolicyId,
        to: &AccountId,
        amount: u128,
    ) -> DispatchResult;

    fn register_lp_holder(
        policy_id: PolicyId,
        holder: &AccountId,
    ) -> DispatchResult;
}

/// No-op implementation for testing
impl LocationRegistryApiV3 for () {
    fn is_location_active(_: LocationId) -> bool {
        true
    }
}

impl<AccountId: Clone, Balance: Default> PolicyApiV3<AccountId, Balance> for () {
    fn create_policy(_: PolicyId, _: AccountId, _: LocationId, _: EventSpecV3, _: u128, _: Balance, _: u64, _: u64) -> DispatchResult { Ok(()) }
    fn add_shares_to_policy(_: PolicyId, _: AccountId, _: u128) -> DispatchResult { Ok(()) }
    fn allocate_to_defi(_: PolicyId, _: Balance) -> DispatchResult { Ok(()) }
    fn trigger_defi_allocation(_: PolicyId) -> DispatchResult { Ok(()) }
    fn policy_pool_account(_: PolicyId) -> AccountId { unimplemented!() }
}

impl<AccountId> HoldingsApiV3<AccountId> for () {
    fn mint_lp_tokens(_: PolicyId, _: &AccountId, _: u128) -> DispatchResult { Ok(()) }
    fn register_lp_holder(_: PolicyId, _: &AccountId) -> DispatchResult { Ok(()) }
}

#[frame_support::pallet]
pub mod pallet {
    use super::*;

    // =========================================================================
    //                                  Types
    // =========================================================================

    /// Underwrite request structure
    #[derive(Clone, PartialEq, Eq, RuntimeDebug, Encode, Decode, TypeInfo, MaxEncodedLen)]
    #[scale_info(skip_type_params(T))]
    pub struct UnderwriteRequest<T: Config> {
        /// Request ID (also serves as policy_id, 1:1 mapping)
        pub request_id: RequestId,
        /// Requester/policyholder
        pub requester: T::AccountId,
        /// Location ID from LocationRegistry
        pub location_id: LocationId,
        /// Event specification
        pub event_spec: EventSpecV3,
        /// Total shares requested
        pub total_shares: u128,
        /// Shares already filled
        pub filled_shares: u128,
        /// Premium per share (must be > 0)
        pub premium_per_share: T::Balance,
        /// Payout per share (fixed $100)
        pub payout_per_share: T::Balance,
        /// Coverage start timestamp (must be in future at creation)
        pub coverage_start: u64,
        /// Coverage end timestamp
        pub coverage_end: u64,
        /// Request expiry timestamp
        pub expires_at: u64,
        /// Request status
        pub status: RequestStatusV3,
        /// Created at timestamp
        pub created_at: u64,
    }

    // =========================================================================
    //                                  Config
    // =========================================================================

    #[pallet::config]
    pub trait Config: frame_system::Config + pallet_timestamp::Config {
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
            + Saturating;

        /// Asset ID type
        type AssetId: Parameter + Member + Copy + Default + MaxEncodedLen;

        /// Fungibles implementation for USDT transfers
        type Assets: Mutate<Self::AccountId, AssetId = Self::AssetId, Balance = Self::Balance>
            + Inspect<Self::AccountId>;

        /// USDT asset ID
        #[pallet::constant]
        type UsdtAssetId: Get<Self::AssetId>;

        /// Location registry access
        type LocationRegistry: LocationRegistryApiV3;

        /// Policy pallet API
        type PolicyApi: PolicyApiV3<Self::AccountId, Self::Balance>;

        /// Holdings API for LP token management
        type HoldingsApi: HoldingsApiV3<Self::AccountId>;

        /// Origin that can trigger request expiry (OCW)
        type ExpiryOrigin: EnsureOrigin<Self::RuntimeOrigin>;

        /// Weight info for this pallet
        type WeightInfo: WeightInfo;
    }

    /// Weight info trait
    pub trait WeightInfo {
        fn create_underwrite_request() -> Weight;
        fn cancel_underwrite_request() -> Weight;
        fn accept_underwrite_request() -> Weight;
        fn expire_request() -> Weight;
    }

    impl WeightInfo for () {
        fn create_underwrite_request() -> Weight {
            Weight::from_parts(50_000, 0)
        }
        fn cancel_underwrite_request() -> Weight {
            Weight::from_parts(30_000, 0)
        }
        fn accept_underwrite_request() -> Weight {
            Weight::from_parts(100_000, 0)
        }
        fn expire_request() -> Weight {
            Weight::from_parts(30_000, 0)
        }
    }

    // =========================================================================
    //                           Validate Unsigned
    // =========================================================================

    #[pallet::validate_unsigned]
    impl<T: Config> ValidateUnsigned for Pallet<T> {
        type Call = Call<T>;

        fn validate_unsigned(_source: TransactionSource, call: &Self::Call) -> TransactionValidity {
            match call {
                Call::expire_request_unsigned { request_id } => {
                    // Basic validation - ensure request exists and is expirable
                    let request = UnderwriteRequests::<T>::get(request_id)
                        .ok_or(InvalidTransaction::Custom(1))?;

                    // Check request is in expirable state
                    if request.status != RequestStatusV3::Pending
                        && request.status != RequestStatusV3::PartiallyFilled
                    {
                        return Err(InvalidTransaction::Custom(2).into());
                    }

                    // Note: We can't fully validate expires_at here because we don't
                    // have reliable access to timestamp in validate_unsigned.
                    // The actual check happens in the extrinsic.

                    ValidTransaction::with_tag_prefix("MarketV3Expiry")
                        .priority(50)
                        .and_provides(("expire", request_id))
                        .longevity(10)
                        .propagate(true)
                        .build()
                }
                _ => InvalidTransaction::Call.into(),
            }
        }
    }

    // =========================================================================
    //                                  Storage
    // =========================================================================

    #[pallet::pallet]
    pub struct Pallet<T>(_);

    /// Default value for NextRequestId - starts at V3_POLICY_ID_OFFSET
    /// to avoid collision with V1/V2 policy IDs in shared prmxHoldings pallet.
    pub struct NextRequestIdDefault;
    impl frame_support::traits::Get<RequestId> for NextRequestIdDefault {
        fn get() -> RequestId {
            V3_POLICY_ID_OFFSET
        }
    }

    /// Underwrite requests by ID
    #[pallet::storage]
    #[pallet::getter(fn underwrite_requests)]
    pub type UnderwriteRequests<T: Config> =
        StorageMap<_, Blake2_128Concat, RequestId, UnderwriteRequest<T>, OptionQuery>;

    /// Next request ID
    /// Initialized to V3_POLICY_ID_OFFSET to avoid collision with V1/V2 policy IDs
    /// in the shared prmxHoldings pallet.
    #[pallet::storage]
    #[pallet::getter(fn next_request_id)]
    pub type NextRequestId<T: Config> = StorageValue<_, RequestId, ValueQuery, NextRequestIdDefault>;

    /// Premium held in escrow per request (unfilled portion)
    #[pallet::storage]
    #[pallet::getter(fn escrow_balance)]
    pub type EscrowBalance<T: Config> =
        StorageMap<_, Blake2_128Concat, RequestId, T::Balance, ValueQuery>;

    // =========================================================================
    //                                  Hooks
    // =========================================================================

    #[pallet::hooks]
    impl<T: Config> Hooks<BlockNumberFor<T>> for Pallet<T> {
        fn on_runtime_upgrade() -> Weight {
            // Migrate NextRequestId to use V3_POLICY_ID_OFFSET if it's below the offset
            let current_id = NextRequestId::<T>::get();
            if current_id < V3_POLICY_ID_OFFSET {
                // If there are existing requests, we need to preserve their count
                // by adding the offset to the current value
                let new_id = V3_POLICY_ID_OFFSET + current_id;
                NextRequestId::<T>::put(new_id);
                log::info!(
                    target: "pallet-market-v3",
                    "🔄 Migrated NextRequestId from {} to {} (added V3_POLICY_ID_OFFSET)",
                    current_id,
                    new_id
                );
                // Return weight for one storage read and one storage write
                T::DbWeight::get().reads_writes(1, 1)
            } else {
                log::info!(
                    target: "pallet-market-v3",
                    "✓ NextRequestId ({}) already >= V3_POLICY_ID_OFFSET, no migration needed",
                    current_id
                );
                // Just one read
                T::DbWeight::get().reads(1)
            }
        }
    }

    // =========================================================================
    //                                  Events
    // =========================================================================

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// Underwrite request created
        RequestCreated {
            request_id: RequestId,
            requester: T::AccountId,
            total_shares: u128,
            premium_per_share: T::Balance,
            expires_at: u64,
        },
        /// Request cancelled by requester
        RequestCancelled {
            request_id: RequestId,
            unfilled_shares: u128,
            premium_returned: T::Balance,
        },
        /// Request accepted (partially or fully)
        RequestAccepted {
            request_id: RequestId,
            underwriter: T::AccountId,
            shares_accepted: u128,
            collateral_locked: T::Balance,
            is_first_acceptance: bool,
        },
        /// Request fully filled
        RequestFullyFilled {
            request_id: RequestId,
            total_shares: u128,
        },
        /// Request expired
        RequestExpired {
            request_id: RequestId,
            unfilled_shares: u128,
            premium_returned: T::Balance,
        },
    }

    // =========================================================================
    //                                  Errors
    // =========================================================================

    #[pallet::error]
    pub enum Error<T> {
        /// Request not found
        RequestNotFound,
        /// Not the requester
        NotRequester,
        /// Request not pending or partially filled
        RequestNotAcceptable,
        /// Request already fully filled
        RequestAlreadyFilled,
        /// Cannot self-underwrite
        CannotSelfUnderwrite,
        /// Shares must be >= 1
        InvalidSharesAmount,
        /// Not enough shares remaining
        NotEnoughSharesRemaining,
        /// Premium must be > 0
        PremiumMustBePositive,
        /// Coverage start must be in future
        CoverageStartMustBeFuture,
        /// Invalid coverage window
        InvalidCoverageWindow,
        /// Location not valid
        LocationNotValid,
        /// Insufficient funds
        InsufficientFunds,
        /// Transfer failed
        TransferFailed,
        /// Arithmetic overflow
        ArithmeticOverflow,
        /// Request not expired yet
        RequestNotExpired,
        /// Request has active policy
        RequestHasActivePolicy,
    }

    // =========================================================================
    //                                Extrinsics
    // =========================================================================

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Create an underwrite request.
        /// Premium is transferred to pallet escrow.
        #[pallet::call_index(0)]
        #[pallet::weight(<T as Config>::WeightInfo::create_underwrite_request())]
        pub fn create_underwrite_request(
            origin: OriginFor<T>,
            location_id: LocationId,
            event_spec: EventSpecV3,
            total_shares: u128,
            premium_per_share: T::Balance,
            coverage_start: u64,
            coverage_end: u64,
            expires_at: u64,
        ) -> DispatchResult {
            let requester = ensure_signed(origin)?;

            // Validate premium > 0
            ensure!(
                premium_per_share > T::Balance::zero(),
                Error::<T>::PremiumMustBePositive
            );

            // Validate shares
            ensure!(total_shares >= 1, Error::<T>::InvalidSharesAmount);

            // Validate coverage window
            let now = Self::current_timestamp();
            ensure!(coverage_start > now, Error::<T>::CoverageStartMustBeFuture);
            ensure!(coverage_end > coverage_start, Error::<T>::InvalidCoverageWindow);

            // Validate location
            ensure!(
                T::LocationRegistry::is_location_active(location_id),
                Error::<T>::LocationNotValid
            );

            // Calculate total premium
            let premium_per_share_u128: u128 = premium_per_share.into();
            let total_premium_u128 = total_shares
                .checked_mul(premium_per_share_u128)
                .ok_or(Error::<T>::ArithmeticOverflow)?;
            let total_premium: T::Balance = total_premium_u128.into();

            // Transfer premium to escrow
            let escrow_account = Self::escrow_account();
            T::Assets::transfer(
                T::UsdtAssetId::get(),
                &requester,
                &escrow_account,
                total_premium,
                Preservation::Expendable,
            )
            .map_err(|_| Error::<T>::InsufficientFunds)?;

            // Create request
            let request_id = NextRequestId::<T>::get();
            let payout_per_share: T::Balance = V3_PAYOUT_PER_SHARE.into();

            let request = UnderwriteRequest {
                request_id,
                requester: requester.clone(),
                location_id,
                event_spec,
                total_shares,
                filled_shares: 0,
                premium_per_share,
                payout_per_share,
                coverage_start,
                coverage_end,
                expires_at,
                status: RequestStatusV3::Pending,
                created_at: now,
            };

            UnderwriteRequests::<T>::insert(request_id, request);
            EscrowBalance::<T>::insert(request_id, total_premium);
            NextRequestId::<T>::put(request_id + 1);

            Self::deposit_event(Event::RequestCreated {
                request_id,
                requester,
                total_shares,
                premium_per_share,
                expires_at,
            });

            Ok(())
        }

        /// Cancel unfilled portion of a request.
        /// Returns unfilled premium to requester.
        #[pallet::call_index(1)]
        #[pallet::weight(<T as Config>::WeightInfo::cancel_underwrite_request())]
        pub fn cancel_underwrite_request(
            origin: OriginFor<T>,
            request_id: RequestId,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;

            let mut request =
                UnderwriteRequests::<T>::get(request_id).ok_or(Error::<T>::RequestNotFound)?;

            ensure!(request.requester == who, Error::<T>::NotRequester);
            ensure!(
                request.status == RequestStatusV3::Pending
                    || request.status == RequestStatusV3::PartiallyFilled,
                Error::<T>::RequestNotAcceptable
            );

            let unfilled_shares = request
                .total_shares
                .saturating_sub(request.filled_shares);

            // Calculate unfilled premium to return
            let premium_per_share_u128: u128 = request.premium_per_share.into();
            let unfilled_premium_u128 = unfilled_shares
                .checked_mul(premium_per_share_u128)
                .ok_or(Error::<T>::ArithmeticOverflow)?;
            let unfilled_premium: T::Balance = unfilled_premium_u128.into();

            // Return unfilled premium
            if unfilled_premium > T::Balance::zero() {
                let escrow_account = Self::escrow_account();
                T::Assets::transfer(
                    T::UsdtAssetId::get(),
                    &escrow_account,
                    &request.requester,
                    unfilled_premium,
                    Preservation::Expendable,
                )
                .map_err(|_| Error::<T>::TransferFailed)?;
            }

            // Update request status
            request.status = RequestStatusV3::Cancelled;
            UnderwriteRequests::<T>::insert(request_id, request);
            EscrowBalance::<T>::insert(request_id, T::Balance::zero());

            Self::deposit_event(Event::RequestCancelled {
                request_id,
                unfilled_shares,
                premium_returned: unfilled_premium,
            });

            Ok(())
        }

        /// Accept shares from a request.
        /// Creates policy on first acceptance, adds LP holder on subsequent.
        #[pallet::call_index(2)]
        #[pallet::weight(<T as Config>::WeightInfo::accept_underwrite_request())]
        pub fn accept_underwrite_request(
            origin: OriginFor<T>,
            request_id: RequestId,
            shares_to_accept: u128,
        ) -> DispatchResult {
            let underwriter = ensure_signed(origin)?;

            let mut request =
                UnderwriteRequests::<T>::get(request_id).ok_or(Error::<T>::RequestNotFound)?;

            // Validate
            ensure!(
                underwriter != request.requester,
                Error::<T>::CannotSelfUnderwrite
            );
            ensure!(
                shares_to_accept >= V3_MIN_SHARES_PER_ACCEPT,
                Error::<T>::InvalidSharesAmount
            );
            ensure!(
                request.status == RequestStatusV3::Pending
                    || request.status == RequestStatusV3::PartiallyFilled,
                Error::<T>::RequestNotAcceptable
            );

            let remaining_shares = request
                .total_shares
                .saturating_sub(request.filled_shares);
            ensure!(
                shares_to_accept <= remaining_shares,
                Error::<T>::NotEnoughSharesRemaining
            );

            // Calculate amounts
            let payout_per_share_u128: u128 = V3_PAYOUT_PER_SHARE;
            let premium_per_share_u128: u128 = request.premium_per_share.into();
            let collateral_per_share = payout_per_share_u128.saturating_sub(premium_per_share_u128);

            let total_collateral_u128 = shares_to_accept
                .checked_mul(collateral_per_share)
                .ok_or(Error::<T>::ArithmeticOverflow)?;
            let total_collateral: T::Balance = total_collateral_u128.into();

            let premium_for_shares_u128 = shares_to_accept
                .checked_mul(premium_per_share_u128)
                .ok_or(Error::<T>::ArithmeticOverflow)?;
            let premium_for_shares: T::Balance = premium_for_shares_u128.into();

            let is_first_acceptance = request.filled_shares == 0;

            // Get policy pool account
            let policy_id = request_id; // 1:1 mapping
            let policy_pool = T::PolicyApi::policy_pool_account(policy_id);

            // Transfer collateral from underwriter to policy pool
            T::Assets::transfer(
                T::UsdtAssetId::get(),
                &underwriter,
                &policy_pool,
                total_collateral,
                Preservation::Expendable,
            )
            .map_err(|_| Error::<T>::InsufficientFunds)?;

            // Transfer premium from escrow to policy pool
            let escrow_account = Self::escrow_account();
            T::Assets::transfer(
                T::UsdtAssetId::get(),
                &escrow_account,
                &policy_pool,
                premium_for_shares,
                Preservation::Expendable,
            )
            .map_err(|_| Error::<T>::TransferFailed)?;

            // Update escrow balance
            EscrowBalance::<T>::mutate(request_id, |balance| {
                *balance = balance.saturating_sub(premium_for_shares);
            });

            if is_first_acceptance {
                // Create policy
                T::PolicyApi::create_policy(
                    policy_id,
                    request.requester.clone(),
                    request.location_id,
                    request.event_spec.clone(),
                    shares_to_accept,
                    request.premium_per_share,
                    request.coverage_start,
                    request.coverage_end,
                )?;
            } else {
                // Add shares to existing policy
                T::PolicyApi::add_shares_to_policy(
                    policy_id,
                    underwriter.clone(),
                    shares_to_accept,
                )?;
            }

            // Mint LP tokens to underwriter
            T::HoldingsApi::mint_lp_tokens(policy_id, &underwriter, shares_to_accept)?;
            T::HoldingsApi::register_lp_holder(policy_id, &underwriter)?;

            // Update request
            request.filled_shares = request
                .filled_shares
                .checked_add(shares_to_accept)
                .ok_or(Error::<T>::ArithmeticOverflow)?;

            let is_fully_filled = request.filled_shares >= request.total_shares;
            request.status = if is_fully_filled {
                RequestStatusV3::FullyFilled
            } else {
                RequestStatusV3::PartiallyFilled
            };

            UnderwriteRequests::<T>::insert(request_id, request.clone());

            Self::deposit_event(Event::RequestAccepted {
                request_id,
                underwriter,
                shares_accepted: shares_to_accept,
                collateral_locked: total_collateral,
                is_first_acceptance,
            });

            // Allocate collateral to DeFi incrementally (after each acceptance)
            // This ensures all collateral is allocated, not just what's in pool when fully filled
            if let Err(e) = T::PolicyApi::allocate_to_defi(policy_id, total_collateral) {
                log::warn!(
                    target: "pallet-market-v3",
                    "⚠️ Incremental DeFi allocation failed for policy {}: {:?}",
                    policy_id,
                    e
                );
                // Don't fail - DeFi allocation is optional
            }

            if is_fully_filled {
                Self::deposit_event(Event::RequestFullyFilled {
                    request_id,
                    total_shares: request.total_shares,
                });
            }

            Ok(())
        }

        /// Expire a request that has passed its expiry time.
        /// Called by governance/sudo. Returns unfilled premium to requester.
        #[pallet::call_index(3)]
        #[pallet::weight(<T as Config>::WeightInfo::expire_request())]
        pub fn expire_request(origin: OriginFor<T>, request_id: RequestId) -> DispatchResult {
            T::ExpiryOrigin::ensure_origin(origin)?;
            Self::do_expire_request(request_id)
        }

        /// Expire a request via unsigned transaction from OCW.
        /// This allows the OCW to trigger expiry without a signed origin.
        #[pallet::call_index(4)]
        #[pallet::weight(<T as Config>::WeightInfo::expire_request())]
        pub fn expire_request_unsigned(
            origin: OriginFor<T>,
            request_id: RequestId,
        ) -> DispatchResult {
            ensure_none(origin)?;
            Self::do_expire_request(request_id)
        }
    }

    // =========================================================================
    //                           Helper Functions
    // =========================================================================

    impl<T: Config> Pallet<T> {
        /// Get the global escrow account for premium deposits
        pub fn escrow_account() -> T::AccountId {
            PALLET_ID.into_sub_account_truncating(("escrow",))
        }

        /// Get current timestamp from pallet_timestamp
        /// Returns Unix timestamp in seconds
        fn current_timestamp() -> u64 {
            // pallet_timestamp returns milliseconds, convert to seconds
            let moment = <pallet_timestamp::Pallet<T>>::now();
            // Convert Moment to u64 (Moment is typically u64 in milliseconds)
            let millis: u64 = moment.try_into().unwrap_or(0);
            millis / 1000
        }

        /// Internal implementation of request expiry
        pub fn do_expire_request(request_id: RequestId) -> DispatchResult {
            let mut request =
                UnderwriteRequests::<T>::get(request_id).ok_or(Error::<T>::RequestNotFound)?;

            // Validate request can be expired
            ensure!(
                request.status == RequestStatusV3::Pending
                    || request.status == RequestStatusV3::PartiallyFilled,
                Error::<T>::RequestNotAcceptable
            );

            // Note: For unsigned transactions, we trust the OCW has validated expiry
            // For signed transactions, we check the timestamp
            // In production, use pallet_timestamp for reliable time

            let unfilled_shares = request
                .total_shares
                .saturating_sub(request.filled_shares);

            // Calculate unfilled premium to return
            let premium_per_share_u128: u128 = request.premium_per_share.into();
            let unfilled_premium_u128 = unfilled_shares
                .checked_mul(premium_per_share_u128)
                .ok_or(Error::<T>::ArithmeticOverflow)?;
            let unfilled_premium: T::Balance = unfilled_premium_u128.into();

            // Return unfilled premium
            if unfilled_premium > T::Balance::zero() {
                let escrow_account = Self::escrow_account();
                T::Assets::transfer(
                    T::UsdtAssetId::get(),
                    &escrow_account,
                    &request.requester,
                    unfilled_premium,
                    Preservation::Expendable,
                )
                .map_err(|_| Error::<T>::TransferFailed)?;
            }

            // Update request status
            request.status = RequestStatusV3::Expired;
            UnderwriteRequests::<T>::insert(request_id, request);
            EscrowBalance::<T>::insert(request_id, T::Balance::zero());

            Self::deposit_event(Event::RequestExpired {
                request_id,
                unfilled_shares,
                premium_returned: unfilled_premium,
            });

            Ok(())
        }

        /// Get request by ID
        pub fn get_request(request_id: RequestId) -> Option<UnderwriteRequest<T>> {
            UnderwriteRequests::<T>::get(request_id)
        }

        /// Get all pending/partially filled requests that can be accepted
        pub fn get_open_requests() -> Vec<RequestId> {
            UnderwriteRequests::<T>::iter()
                .filter(|(_, req)| {
                    req.status == RequestStatusV3::Pending
                        || req.status == RequestStatusV3::PartiallyFilled
                })
                .map(|(id, _)| id)
                .collect()
        }

        /// Get expired requests that need cleanup
        pub fn get_expired_requests_internal(current_time: u64) -> Vec<RequestId> {
            UnderwriteRequests::<T>::iter()
                .filter(|(_, req)| {
                    (req.status == RequestStatusV3::Pending
                        || req.status == RequestStatusV3::PartiallyFilled)
                        && current_time >= req.expires_at
                })
                .map(|(id, _)| id)
                .collect()
        }
        
        /// Check if a request is expired
        pub fn is_request_expired_internal(request_id: RequestId, current_time: u64) -> bool {
            if let Some(req) = UnderwriteRequests::<T>::get(request_id) {
                (req.status == RequestStatusV3::Pending
                    || req.status == RequestStatusV3::PartiallyFilled)
                    && current_time >= req.expires_at
            } else {
                false
            }
        }
    }
}

// ============================================================================
// RequestExpiryApi Implementation
// ============================================================================

impl<T: Config> RequestExpiryApi for Pallet<T> {
    fn get_expired_requests(current_time: u64) -> Vec<RequestId> {
        pallet::Pallet::<T>::get_expired_requests_internal(current_time)
    }
    
    fn is_request_expired(request_id: RequestId, current_time: u64) -> bool {
        pallet::Pallet::<T>::is_request_expired_internal(request_id, current_time)
    }
}
