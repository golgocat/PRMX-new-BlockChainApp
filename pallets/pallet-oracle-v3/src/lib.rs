//! # Pallet Oracle V3
//!
//! Oracle pallet for the PRMX V3 P2P climate risk market.
//!
//! ## Overview
//!
//! - LocationRegistry: Curated list of supported locations with AccuWeather keys
//! - OracleMembership: Authorized accounts that can submit oracle reports
//! - OracleStates: Per-policy aggregation state and commitment tracking
//! - Snapshots: Periodic recovery checkpoints
//! - Final Reports: Trigger or maturity settlement reports
//! - Offchain Worker: Polls policies, fetches AccuWeather data, sends to Ingest API

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub use pallet::*;

pub mod ocw;
pub mod expiry;
pub mod fetcher;
pub mod aggregator;
pub mod commitment;
pub mod http_client;

use alloc::vec::Vec;
use codec::Encode;
use frame_support::pallet_prelude::*;
use frame_system::pallet_prelude::*;
use prmx_primitives::{
    AggStateV3, EventSpecV3, EventTypeV3, OracleReportKindV3, PolicyId, PolicyOracleStateV3,
    PolicyStatusV3, V3_MIN_SNAPSHOT_BLOCKS,
};
use sp_core::H256;
use sp_runtime::traits::UniqueSaturatedInto;

// ============================================================================
// Type Aliases
// ============================================================================

/// Location identifier
pub type LocationId = u64;

// ============================================================================
// Traits
// ============================================================================

/// Trait for policy pallet to receive settlement notifications
pub trait PolicySettlementV3 {
    /// Called when oracle submits final report to trigger settlement
    fn on_final_report(
        policy_id: PolicyId,
        triggered: bool,
        observed_until: u64,
        agg_state: AggStateV3,
        commitment: H256,
    ) -> DispatchResult;
}

/// No-op implementation for testing
impl PolicySettlementV3 for () {
    fn on_final_report(
        _policy_id: PolicyId,
        _triggered: bool,
        _observed_until: u64,
        _agg_state: AggStateV3,
        _commitment: H256,
    ) -> DispatchResult {
        Ok(())
    }
}

/// Trait for accessing request expiry information from market-v3
pub trait RequestExpiryApiV3 {
    /// Get all expired request IDs that need cleanup
    fn get_expired_requests(current_time: u64) -> Vec<PolicyId>;
    
    /// Check if a specific request is expired
    fn is_request_expired(request_id: PolicyId, current_time: u64) -> bool;
    
    /// Execute request expiry - returns unfilled premium to requester
    /// Called by oracle-v3's unsigned transaction handler
    fn expire_request(request_id: PolicyId) -> DispatchResult;
}

/// No-op implementation for testing
impl RequestExpiryApiV3 for () {
    fn get_expired_requests(_current_time: u64) -> Vec<PolicyId> {
        Vec::new()
    }
    
    fn is_request_expired(_request_id: PolicyId, _current_time: u64) -> bool {
        false
    }
    
    fn expire_request(_request_id: PolicyId) -> DispatchResult {
        Ok(())
    }
}

#[frame_support::pallet]
pub mod pallet {
    use super::*;

    // =========================================================================
    //                                  Types
    // =========================================================================

    /// Location information stored in the registry
    #[derive(Clone, PartialEq, Eq, RuntimeDebug, Encode, Decode, TypeInfo, MaxEncodedLen)]
    #[scale_info(skip_type_params(T))]
    pub struct LocationInfo<T: Config> {
        /// Location ID
        pub location_id: LocationId,
        /// AccuWeather location key
        pub accuweather_key: BoundedVec<u8, T::MaxLocationKeyLength>,
        /// Latitude (scaled by 1e6)
        pub latitude: i32,
        /// Longitude (scaled by 1e6)
        pub longitude: i32,
        /// Human-readable name
        pub name: BoundedVec<u8, ConstU32<64>>,
        /// Whether this location accepts new requests
        pub active: bool,
    }

    // =========================================================================
    //                                  Config
    // =========================================================================

    #[pallet::config]
    pub trait Config: frame_system::Config 
        + frame_system::offchain::CreateTransactionBase<Call<Self>>
        + frame_system::offchain::CreateBare<Call<Self>>
    {
        /// Runtime event type
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;

        /// Origin for governance operations (add/remove locations, oracle members)
        type GovernanceOrigin: EnsureOrigin<Self::RuntimeOrigin>;

        /// Origin for oracle operations (submit snapshots, final reports)
        type OracleOrigin: EnsureOrigin<Self::RuntimeOrigin>;

        /// Policy settlement handler
        type PolicySettlement: PolicySettlementV3;

        /// Request expiry API (access to market-v3 for expired request detection)
        type RequestExpiryApi: RequestExpiryApiV3;

        /// Maximum length of AccuWeather location key
        #[pallet::constant]
        type MaxLocationKeyLength: Get<u32>;

        /// Weight info
        type WeightInfo: WeightInfo;
    }

    /// Validate unsigned transactions from OCW
    #[pallet::validate_unsigned]
    impl<T: Config> ValidateUnsigned for Pallet<T> {
        type Call = Call<T>;

        fn validate_unsigned(_source: TransactionSource, call: &Self::Call) -> TransactionValidity {
            match call {
                Call::submit_snapshot_unsigned {
                    policy_id,
                    observed_until,
                    ..
                } => {
                    // Basic validation - ensure policy exists and is active
                    let state = OracleStates::<T>::get(policy_id)
                        .ok_or(InvalidTransaction::Custom(1))?;
                    
                    if state.status != PolicyStatusV3::Active {
                        return Err(InvalidTransaction::Custom(2).into());
                    }

                    ValidTransaction::with_tag_prefix("OracleV3Snapshot")
                        .priority(100)
                        .and_provides((policy_id, observed_until))
                        .longevity(5)
                        .propagate(true)
                        .build()
                }
                Call::submit_final_report_unsigned {
                    policy_id,
                    ..
                } => {
                    // Basic validation - ensure policy exists and is active
                    let state = OracleStates::<T>::get(policy_id)
                        .ok_or(InvalidTransaction::Custom(1))?;
                    
                    if state.status != PolicyStatusV3::Active {
                        return Err(InvalidTransaction::Custom(3).into());
                    }

                    ValidTransaction::with_tag_prefix("OracleV3FinalReport")
                        .priority(200) // Higher priority for final reports
                        .and_provides((policy_id, "final"))
                        .longevity(5)
                        .propagate(true)
                        .build()
                }
                Call::expire_request_unsigned {
                    request_id,
                } => {
                    // Validate request is expired via trait
                    // Note: We use a fixed timestamp check here since we can't
                    // reliably get current time in validate_unsigned
                    // The actual expiry check happens in the extrinsic
                    let now = sp_io::offchain::timestamp().unix_millis() / 1000;
                    
                    if !T::RequestExpiryApi::is_request_expired(*request_id, now) {
                        return Err(InvalidTransaction::Custom(4).into());
                    }

                    ValidTransaction::with_tag_prefix("OracleV3RequestExpiry")
                        .priority(50) // Lower priority than final reports
                        .and_provides((request_id, "expiry"))
                        .longevity(10)
                        .propagate(true)
                        .build()
                }
                _ => InvalidTransaction::Call.into(),
            }
        }
    }

    /// Weight info trait
    pub trait WeightInfo {
        fn add_location() -> Weight;
        fn remove_location() -> Weight;
        fn submit_snapshot() -> Weight;
        fn submit_final_report() -> Weight;
        fn add_oracle_member() -> Weight;
        fn remove_oracle_member() -> Weight;
    }

    /// Default weights
    impl WeightInfo for () {
        fn add_location() -> Weight {
            Weight::from_parts(10_000, 0)
        }
        fn remove_location() -> Weight {
            Weight::from_parts(10_000, 0)
        }
        fn submit_snapshot() -> Weight {
            Weight::from_parts(20_000, 0)
        }
        fn submit_final_report() -> Weight {
            Weight::from_parts(50_000, 0)
        }
        fn add_oracle_member() -> Weight {
            Weight::from_parts(10_000, 0)
        }
        fn remove_oracle_member() -> Weight {
            Weight::from_parts(10_000, 0)
        }
    }

    // =========================================================================
    //                                  Storage
    // =========================================================================

    #[pallet::pallet]
    pub struct Pallet<T>(_);

    /// Curated location registry
    #[pallet::storage]
    #[pallet::getter(fn location_registry)]
    pub type LocationRegistry<T: Config> =
        StorageMap<_, Blake2_128Concat, LocationId, LocationInfo<T>, OptionQuery>;

    /// Next location ID
    #[pallet::storage]
    #[pallet::getter(fn next_location_id)]
    pub type NextLocationId<T: Config> = StorageValue<_, LocationId, ValueQuery>;

    /// Oracle membership (authorized accounts)
    #[pallet::storage]
    #[pallet::getter(fn oracle_membership)]
    pub type OracleMembership<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, bool, ValueQuery>;

    /// Per-policy oracle state
    #[pallet::storage]
    #[pallet::getter(fn oracle_states)]
    pub type OracleStates<T: Config> =
        StorageMap<_, Blake2_128Concat, PolicyId, PolicyOracleStateV3, OptionQuery>;

    /// Snapshot rate limiting (policy_id -> last snapshot block)
    #[pallet::storage]
    #[pallet::getter(fn snapshot_rate_limit)]
    pub type SnapshotRateLimit<T: Config> =
        StorageMap<_, Blake2_128Concat, PolicyId, BlockNumberFor<T>, ValueQuery>;

    /// Policy metadata for OCW lookup (policy_id -> (location_id, event_spec, coverage_start, coverage_end))
    #[pallet::storage]
    #[pallet::getter(fn policy_metadata)]
    pub type PolicyMetadata<T: Config> =
        StorageMap<_, Blake2_128Concat, PolicyId, (LocationId, EventSpecV3, u64, u64), OptionQuery>;

    // =========================================================================
    //                                  Events
    // =========================================================================

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// Location added to registry
        LocationAdded {
            location_id: LocationId,
            name: BoundedVec<u8, ConstU32<64>>,
        },
        /// Location deactivated
        LocationRemoved { location_id: LocationId },
        /// Oracle member added
        OracleMemberAdded { account: T::AccountId },
        /// Oracle member removed
        OracleMemberRemoved { account: T::AccountId },
        /// Snapshot submitted for a policy
        SnapshotSubmitted {
            policy_id: PolicyId,
            observed_until: u64,
            commitment: H256,
        },
        /// Final report submitted (triggers settlement)
        FinalReportSubmitted {
            policy_id: PolicyId,
            kind: OracleReportKindV3,
            triggered: bool,
            observed_until: u64,
            commitment: H256,
        },
        /// Oracle state initialized for a policy
        OracleStateInitialized {
            policy_id: PolicyId,
            event_spec: EventSpecV3,
            commitment: H256,
        },
        /// Request expired by OCW
        RequestExpiredByOcw {
            request_id: PolicyId,
        },
    }

    // =========================================================================
    //                                  Errors
    // =========================================================================

    #[pallet::error]
    pub enum Error<T> {
        /// Location not found
        LocationNotFound,
        /// Location already exists with this ID
        LocationAlreadyExists,
        /// Location name too long
        LocationNameTooLong,
        /// AccuWeather key too long
        AccuWeatherKeyTooLong,
        /// Not an authorized oracle member
        NotOracleMember,
        /// Oracle member already exists
        OracleMemberAlreadyExists,
        /// Oracle member not found
        OracleMemberNotFound,
        /// Policy oracle state not found
        PolicyStateNotFound,
        /// Policy already settled
        PolicyAlreadySettled,
        /// Snapshot submitted too frequently
        SnapshotRateLimited,
        /// observed_until must be monotonically increasing
        ObservedUntilNotMonotonic,
        /// AggState type mismatch with policy event type
        AggStateMismatch,
        /// Policy not in active state
        PolicyNotActive,
        /// Final report already submitted
        FinalReportAlreadySubmitted,
        /// Location not active
        LocationNotActive,
    }

    // =========================================================================
    //                                Extrinsics
    // =========================================================================

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Add a new location to the registry.
        /// Only governance can call this.
        #[pallet::call_index(0)]
        #[pallet::weight(T::WeightInfo::add_location())]
        pub fn add_location(
            origin: OriginFor<T>,
            accuweather_key: Vec<u8>,
            latitude: i32,
            longitude: i32,
            name: Vec<u8>,
        ) -> DispatchResult {
            T::GovernanceOrigin::ensure_origin(origin)?;

            let bounded_key: BoundedVec<u8, T::MaxLocationKeyLength> = accuweather_key
                .try_into()
                .map_err(|_| Error::<T>::AccuWeatherKeyTooLong)?;

            let bounded_name: BoundedVec<u8, ConstU32<64>> =
                name.try_into().map_err(|_| Error::<T>::LocationNameTooLong)?;

            let location_id = NextLocationId::<T>::get();

            let location_info = LocationInfo {
                location_id,
                accuweather_key: bounded_key,
                latitude,
                longitude,
                name: bounded_name.clone(),
                active: true,
            };

            LocationRegistry::<T>::insert(location_id, location_info);
            NextLocationId::<T>::put(location_id + 1);

            Self::deposit_event(Event::LocationAdded {
                location_id,
                name: bounded_name,
            });

            Ok(())
        }

        /// Deactivate a location (no new requests allowed).
        /// Only governance can call this.
        #[pallet::call_index(1)]
        #[pallet::weight(T::WeightInfo::remove_location())]
        pub fn remove_location(origin: OriginFor<T>, location_id: LocationId) -> DispatchResult {
            T::GovernanceOrigin::ensure_origin(origin)?;

            LocationRegistry::<T>::try_mutate(location_id, |maybe_location| -> DispatchResult {
                let location = maybe_location
                    .as_mut()
                    .ok_or(Error::<T>::LocationNotFound)?;
                location.active = false;
                Ok(())
            })?;

            Self::deposit_event(Event::LocationRemoved { location_id });

            Ok(())
        }

        /// Add an authorized oracle member.
        /// Only governance can call this.
        #[pallet::call_index(2)]
        #[pallet::weight(T::WeightInfo::add_oracle_member())]
        pub fn add_oracle_member(origin: OriginFor<T>, account: T::AccountId) -> DispatchResult {
            T::GovernanceOrigin::ensure_origin(origin)?;

            ensure!(
                !OracleMembership::<T>::get(&account),
                Error::<T>::OracleMemberAlreadyExists
            );

            OracleMembership::<T>::insert(&account, true);

            Self::deposit_event(Event::OracleMemberAdded { account });

            Ok(())
        }

        /// Remove an authorized oracle member.
        /// Only governance can call this.
        #[pallet::call_index(3)]
        #[pallet::weight(T::WeightInfo::remove_oracle_member())]
        pub fn remove_oracle_member(
            origin: OriginFor<T>,
            account: T::AccountId,
        ) -> DispatchResult {
            T::GovernanceOrigin::ensure_origin(origin)?;

            ensure!(
                OracleMembership::<T>::get(&account),
                Error::<T>::OracleMemberNotFound
            );

            OracleMembership::<T>::remove(&account);

            Self::deposit_event(Event::OracleMemberRemoved { account });

            Ok(())
        }

        /// Submit a periodic snapshot for a policy.
        /// Only authorized oracle members can call this.
        #[pallet::call_index(4)]
        #[pallet::weight(T::WeightInfo::submit_snapshot())]
        pub fn submit_snapshot(
            origin: OriginFor<T>,
            policy_id: PolicyId,
            observed_until: u64,
            agg_state: AggStateV3,
            commitment: [u8; 32],
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;
            ensure!(
                OracleMembership::<T>::get(&who),
                Error::<T>::NotOracleMember
            );

            let current_block = frame_system::Pallet::<T>::block_number();

            // Check rate limit
            let last_snapshot_block = SnapshotRateLimit::<T>::get(policy_id);
            let min_blocks: BlockNumberFor<T> = V3_MIN_SNAPSHOT_BLOCKS.into();
            ensure!(
                current_block >= last_snapshot_block + min_blocks,
                Error::<T>::SnapshotRateLimited
            );

            // Update oracle state
            OracleStates::<T>::try_mutate(policy_id, |maybe_state| -> DispatchResult {
                let state = maybe_state.as_mut().ok_or(Error::<T>::PolicyStateNotFound)?;

                // Validate monotonic observed_until
                ensure!(
                    observed_until > state.observed_until,
                    Error::<T>::ObservedUntilNotMonotonic
                );

                // Validate agg_state type matches
                ensure!(
                    Self::validate_agg_state_type(&state.agg_state, &agg_state),
                    Error::<T>::AggStateMismatch
                );

                // Validate policy is active
                ensure!(
                    state.status == PolicyStatusV3::Active,
                    Error::<T>::PolicyNotActive
                );

                // Update state
                state.observed_until = observed_until;
                state.agg_state = agg_state;
                state.commitment = commitment;
                state.last_snapshot_block = current_block.try_into().unwrap_or(0);

                Ok(())
            })?;

            // Update rate limit
            SnapshotRateLimit::<T>::insert(policy_id, current_block);

            Self::deposit_event(Event::SnapshotSubmitted {
                policy_id,
                observed_until,
                commitment: H256::from(commitment),
            });

            Ok(())
        }

        /// Submit a final report (trigger or maturity) for a policy.
        /// This triggers settlement in the policy pallet.
        /// Only authorized oracle members can call this.
        #[pallet::call_index(5)]
        #[pallet::weight(T::WeightInfo::submit_final_report())]
        pub fn submit_final_report(
            origin: OriginFor<T>,
            policy_id: PolicyId,
            kind: OracleReportKindV3,
            observed_until: u64,
            agg_state: AggStateV3,
            commitment: [u8; 32],
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;
            ensure!(
                OracleMembership::<T>::get(&who),
                Error::<T>::NotOracleMember
            );

            Self::do_submit_final_report(policy_id, kind, observed_until, agg_state, commitment)
        }

        /// Submit a snapshot via unsigned transaction from OCW.
        /// This allows the OCW to submit snapshots without a signed origin.
        #[pallet::call_index(6)]
        #[pallet::weight(T::WeightInfo::submit_snapshot())]
        pub fn submit_snapshot_unsigned(
            origin: OriginFor<T>,
            policy_id: PolicyId,
            observed_until: u64,
            agg_state: AggStateV3,
            commitment: [u8; 32],
        ) -> DispatchResult {
            ensure_none(origin)?;

            let current_block = frame_system::Pallet::<T>::block_number();

            // Check rate limit
            let last_snapshot_block = SnapshotRateLimit::<T>::get(policy_id);
            let min_blocks: BlockNumberFor<T> = V3_MIN_SNAPSHOT_BLOCKS.into();
            ensure!(
                current_block >= last_snapshot_block + min_blocks,
                Error::<T>::SnapshotRateLimited
            );

            // Update oracle state
            OracleStates::<T>::try_mutate(policy_id, |maybe_state| -> DispatchResult {
                let state = maybe_state.as_mut().ok_or(Error::<T>::PolicyStateNotFound)?;

                // Validate monotonic observed_until
                ensure!(
                    observed_until > state.observed_until,
                    Error::<T>::ObservedUntilNotMonotonic
                );

                // Validate agg_state type matches
                ensure!(
                    Self::validate_agg_state_type(&state.agg_state, &agg_state),
                    Error::<T>::AggStateMismatch
                );

                // Validate policy is active
                ensure!(
                    state.status == PolicyStatusV3::Active,
                    Error::<T>::PolicyNotActive
                );

                // Update state
                state.observed_until = observed_until;
                state.agg_state = agg_state;
                state.commitment = commitment;
                state.last_snapshot_block = current_block.try_into().unwrap_or(0);

                Ok(())
            })?;

            // Update rate limit
            SnapshotRateLimit::<T>::insert(policy_id, current_block);

            Self::deposit_event(Event::SnapshotSubmitted {
                policy_id,
                observed_until,
                commitment: H256::from(commitment),
            });

            Ok(())
        }

        /// Submit a final report via unsigned transaction from OCW.
        /// This triggers settlement in the policy pallet.
        #[pallet::call_index(7)]
        #[pallet::weight(T::WeightInfo::submit_final_report())]
        pub fn submit_final_report_unsigned(
            origin: OriginFor<T>,
            policy_id: PolicyId,
            kind: OracleReportKindV3,
            observed_until: u64,
            agg_state: AggStateV3,
            commitment: [u8; 32],
        ) -> DispatchResult {
            ensure_none(origin)?;

            Self::do_submit_final_report(policy_id, kind, observed_until, agg_state, commitment)
        }

        /// Expire an underwrite request via unsigned transaction from OCW.
        /// This allows the OCW to trigger request expiry without a signed origin.
        /// The actual expiry logic is delegated to the market-v3 pallet via trait.
        #[pallet::call_index(8)]
        #[pallet::weight(Weight::from_parts(50_000, 0))]
        pub fn expire_request_unsigned(
            origin: OriginFor<T>,
            request_id: PolicyId,
        ) -> DispatchResult {
            ensure_none(origin)?;

            // Delegate to market-v3 via trait
            T::RequestExpiryApi::expire_request(request_id)?;

            Self::deposit_event(Event::RequestExpiredByOcw { request_id });

            Ok(())
        }
    }

    // =========================================================================
    //                           Helper Functions
    // =========================================================================

    impl<T: Config> Pallet<T> {
        /// Validate that two AggState values are of the same variant type
        fn validate_agg_state_type(existing: &AggStateV3, new: &AggStateV3) -> bool {
            core::mem::discriminant(existing) == core::mem::discriminant(new)
        }

        /// Internal implementation of final report submission
        fn do_submit_final_report(
            policy_id: PolicyId,
            kind: OracleReportKindV3,
            observed_until: u64,
            agg_state: AggStateV3,
            commitment: [u8; 32],
        ) -> DispatchResult {
            // Get and validate oracle state
            let mut state =
                OracleStates::<T>::get(policy_id).ok_or(Error::<T>::PolicyStateNotFound)?;

            // Validate policy is active
            ensure!(
                state.status == PolicyStatusV3::Active,
                Error::<T>::PolicyAlreadySettled
            );

            // Validate monotonic observed_until
            ensure!(
                observed_until >= state.observed_until,
                Error::<T>::ObservedUntilNotMonotonic
            );

            // Validate agg_state type matches
            ensure!(
                Self::validate_agg_state_type(&state.agg_state, &agg_state),
                Error::<T>::AggStateMismatch
            );

            // Determine if triggered based on kind
            let triggered = matches!(kind, OracleReportKindV3::Trigger);

            // Update state
            state.observed_until = observed_until;
            state.agg_state = agg_state.clone();
            state.commitment = commitment;
            state.status = if triggered {
                PolicyStatusV3::Triggered
            } else {
                PolicyStatusV3::Matured
            };

            OracleStates::<T>::insert(policy_id, state);

            // Notify policy pallet
            T::PolicySettlement::on_final_report(
                policy_id,
                triggered,
                observed_until,
                agg_state,
                H256::from(commitment),
            )?;

            Self::deposit_event(Event::FinalReportSubmitted {
                policy_id,
                kind,
                triggered,
                observed_until,
                commitment: H256::from(commitment),
            });

            Ok(())
        }

        /// Initialize oracle state for a new policy.
        /// Called by market pallet when a policy is created.
        pub fn initialize_oracle_state(
            policy_id: PolicyId,
            event_spec: EventSpecV3,
            location_id: LocationId,
            coverage_start: u64,
            coverage_end: u64,
        ) -> DispatchResult {
            // Verify location exists and is active
            let location =
                LocationRegistry::<T>::get(location_id).ok_or(Error::<T>::LocationNotFound)?;
            ensure!(location.active, Error::<T>::LocationNotActive);

            // Compute initial commitment seed
            let commitment = Self::compute_initial_commitment(
                policy_id,
                &event_spec,
                location_id,
                coverage_start,
                coverage_end,
            );

            // Create initial agg_state based on event type
            let agg_state = AggStateV3::initial_for_event_type(event_spec.event_type);

            let oracle_state = PolicyOracleStateV3 {
                policy_id,
                observed_until: 0,
                agg_state: agg_state.clone(),
                commitment,
                last_snapshot_block: 0,
                status: PolicyStatusV3::Active,
            };

            OracleStates::<T>::insert(policy_id, oracle_state);
            
            // Store policy metadata for OCW lookup
            PolicyMetadata::<T>::insert(
                policy_id,
                (location_id, event_spec.clone(), coverage_start, coverage_end)
            );

            Self::deposit_event(Event::OracleStateInitialized {
                policy_id,
                event_spec,
                commitment: H256::from(commitment),
            });

            Ok(())
        }

        /// Compute initial commitment seed from policy parameters
        fn compute_initial_commitment(
            policy_id: PolicyId,
            event_spec: &EventSpecV3,
            location_id: LocationId,
            coverage_start: u64,
            coverage_end: u64,
        ) -> [u8; 32] {
            use sp_core::Hasher;
            use sp_runtime::traits::BlakeTwo256;

            let mut data = Vec::new();
            data.extend_from_slice(b"prmx_v3:");
            data.extend_from_slice(&policy_id.to_le_bytes());
            data.extend_from_slice(&event_spec.encode());
            data.extend_from_slice(&location_id.to_le_bytes());
            data.extend_from_slice(&coverage_start.to_le_bytes());
            data.extend_from_slice(&coverage_end.to_le_bytes());

            BlakeTwo256::hash(&data).into()
        }

        /// Evaluate if threshold is met based on event type and agg_state
        pub fn evaluate_threshold(event_spec: &EventSpecV3, agg_state: &AggStateV3) -> bool {
            let threshold = event_spec.threshold.value;

            match (event_spec.event_type, agg_state) {
                (EventTypeV3::PrecipSumGte, AggStateV3::PrecipSum { sum_mm_x1000 }) => {
                    *sum_mm_x1000 >= threshold
                }
                (EventTypeV3::Precip1hGte, AggStateV3::Precip1hMax { max_1h_mm_x1000 }) => {
                    *max_1h_mm_x1000 >= threshold
                }
                (EventTypeV3::TempMaxGte, AggStateV3::TempMax { max_c_x1000 }) => {
                    *max_c_x1000 >= threshold
                }
                (EventTypeV3::TempMinLte, AggStateV3::TempMin { min_c_x1000 }) => {
                    *min_c_x1000 <= threshold
                }
                (EventTypeV3::WindGustMaxGte, AggStateV3::WindGustMax { max_mps_x1000 }) => {
                    *max_mps_x1000 >= threshold
                }
                (EventTypeV3::PrecipTypeOccurred, AggStateV3::PrecipTypeOccurred { mask }) => {
                    // Threshold value is used as a mask to check for specific precip types
                    (*mask as i64) & threshold != 0
                }
                // Type mismatch - should not happen if properly validated
                _ => false,
            }
        }

        /// Get location info by ID
        pub fn get_location(location_id: LocationId) -> Option<LocationInfo<T>> {
            LocationRegistry::<T>::get(location_id)
        }

        /// Check if a location is active
        pub fn is_location_active(location_id: LocationId) -> bool {
            LocationRegistry::<T>::get(location_id)
                .map(|l| l.active)
                .unwrap_or(false)
        }

        /// Get oracle state for a policy
        pub fn get_oracle_state(policy_id: PolicyId) -> Option<PolicyOracleStateV3> {
            OracleStates::<T>::get(policy_id)
        }

        /// Mark policy as settled (called after settlement completes)
        pub fn mark_policy_settled(policy_id: PolicyId) -> DispatchResult {
            OracleStates::<T>::try_mutate(policy_id, |maybe_state| -> DispatchResult {
                let state = maybe_state.as_mut().ok_or(Error::<T>::PolicyStateNotFound)?;
                state.status = PolicyStatusV3::Settled;
                Ok(())
            })
        }
        
        /// Get all active policies for OCW processing
        pub fn get_active_policies() -> Vec<(PolicyId, PolicyOracleStateV3)> {
            OracleStates::<T>::iter()
                .filter(|(_, state)| state.status == PolicyStatusV3::Active)
                .collect()
        }
    }
    
    // =========================================================================
    //                           Offchain Worker Hooks
    // =========================================================================
    
    #[pallet::hooks]
    impl<T: Config> Hooks<BlockNumberFor<T>> for Pallet<T> {
        /// Offchain worker runs after each block is imported
        fn offchain_worker(block_number: BlockNumberFor<T>) {
            let block_num: u32 = block_number.unique_saturated_into();
            
            // Run OCW logic every 10 blocks (~1 minute at 6s block time)
            // During startup (first 5 blocks), run every block
            let is_startup = block_num < 5;
            let should_run = is_startup || block_num % 10 == 0;
            
            if !should_run {
                return;
            }
            
            log::info!(
                target: "prmx-oracle-v3",
                "🔄 OCW V3 running at block {} (startup: {})",
                block_num,
                is_startup
            );
            
            // Check if secrets are provisioned
            if ocw::get_accuweather_api_key().is_none() {
                log::warn!(
                    target: "prmx-oracle-v3",
                    "⚠️ AccuWeather API key not provisioned - skipping OCW"
                );
                return;
            }
            
            if ocw::get_hmac_secret().is_none() {
                log::warn!(
                    target: "prmx-oracle-v3",
                    "⚠️ HMAC secret not provisioned - skipping OCW"
                );
                return;
            }
            
            // Get current timestamp
            let now = sp_io::offchain::timestamp().unix_millis() / 1000;
            
            // Process all active policies
            let active_policies = Self::get_active_policies();
            
            if active_policies.is_empty() {
                log::debug!(
                    target: "prmx-oracle-v3",
                    "No active V3 policies to process"
                );
                return;
            }
            
            log::info!(
                target: "prmx-oracle-v3",
                "📊 Processing {} active V3 policies",
                active_policies.len()
            );
            
            for (policy_id, on_chain_state) in active_policies {
                if let Err(e) = Self::process_policy_ocw(policy_id, &on_chain_state, now) {
                    log::warn!(
                        target: "prmx-oracle-v3",
                        "❌ Failed to process policy {}: {:?}",
                        policy_id,
                        e
                    );
                }
            }
            
            // Check for expired requests (every 5 minutes)
            if expiry::should_check_expiry(now) {
                Self::process_expired_requests(now);
                expiry::record_expiry_check(now);
            }
        }
    }
    
    // =========================================================================
    //                           OCW Processing Logic
    // =========================================================================
    
    impl<T: Config> Pallet<T> {
        /// Process a single policy in the offchain worker
        fn process_policy_ocw(
            policy_id: PolicyId,
            on_chain_state: &PolicyOracleStateV3,
            now_epoch: u64,
        ) -> Result<(), &'static str> {
            // Load or initialize local OCW state
            let mut local_state = ocw::OcwPolicyState::load(policy_id)
                .unwrap_or_else(|| ocw::OcwPolicyState::from_on_chain_state(on_chain_state));
            
            // Skip if in backoff
            if local_state.is_in_backoff(now_epoch) {
                log::debug!(
                    target: "prmx-oracle-v3",
                    "Policy {} in backoff until {}",
                    policy_id,
                    local_state.backoff.retry_after
                );
                return Ok(());
            }
            
            // Skip if already finalized locally
            if local_state.finalized {
                return Ok(());
            }
            
            // Get location info for this policy
            // Note: We need to get the location_id from somewhere - for now use a lookup
            // In production, this would be stored in the policy or oracle state
            let location_id = Self::get_policy_location_id(policy_id)?;
            let location = LocationRegistry::<T>::get(location_id)
                .ok_or("Location not found")?;
            
            // Fetch new observations from AccuWeather
            let api_key = ocw::get_accuweather_api_key().ok_or("No API key")?;
            let location_key = &location.accuweather_key;
            
            log::info!(
                target: "prmx-oracle-v3",
                "🌐 Fetching weather for policy {} from AccuWeather",
                policy_id
            );
            
            // Fetch and process observations
            match http_client::fetch_accuweather_historical(location_key.as_slice(), &api_key) {
                Ok(observations) => {
                    if observations.is_empty() {
                        log::debug!(
                            target: "prmx-oracle-v3",
                            "No new observations for policy {}",
                            policy_id
                        );
                        local_state.save(policy_id);
                        return Ok(());
                    }
                    
                    // Filter observations to those we haven't seen
                    let new_obs: Vec<_> = observations
                        .into_iter()
                        .filter(|obs| obs.epoch_time > local_state.last_seen_epoch)
                        .collect();
                    
                    if new_obs.is_empty() {
                        log::debug!(
                            target: "prmx-oracle-v3",
                            "All observations already processed for policy {}",
                            policy_id
                        );
                        
                        // Even with no new observations, check if coverage ended and we need to submit maturity
                        if let Some((_, _event_spec, _coverage_start, coverage_end)) = Self::get_policy_metadata(policy_id) {
                            if now_epoch > coverage_end && !local_state.finalized {
                                log::info!(
                                    target: "prmx-oracle-v3",
                                    "✅ Submitting final MATURITY report for policy {} (no new observations)",
                                    policy_id
                                );
                                
                                if let Err(e) = Self::submit_final_report_on_chain(
                                    policy_id,
                                    OracleReportKindV3::Maturity,
                                    local_state.last_seen_epoch,
                                    local_state.agg_state.clone(),
                                    local_state.commitment,
                                ) {
                                    log::warn!(
                                        target: "prmx-oracle-v3",
                                        "Failed to submit maturity report: {:?}",
                                        e
                                    );
                                    local_state.record_error(ocw::OcwError::ChainSubmission, now_epoch);
                                } else {
                                    local_state.finalized = true;
                                }
                            }
                        }
                        
                        local_state.save(policy_id);
                        return Ok(());
                    }
                    
                    log::info!(
                        target: "prmx-oracle-v3",
                        "📊 Processing {} new observations for policy {}",
                        new_obs.len(),
                        policy_id
                    );
                    
                    // Get event type from on-chain state
                    let event_type = Self::get_policy_event_type(policy_id)?;
                    
                    // Update commitment chain and aggregation
                    let (new_commitment, sample_hashes) = 
                        commitment::process_commitment_batch(local_state.commitment, &new_obs);
                    
                    // Aggregate observations
                    let (new_agg_state, last_epoch) = aggregator::process_observation_batch(
                        event_type,
                        local_state.agg_state.clone(),
                        new_obs.clone(),
                    );
                    
                    // Update local state
                    local_state.agg_state = new_agg_state.clone();
                    local_state.commitment = new_commitment;
                    local_state.last_seen_epoch = last_epoch;
                    
                    // Send observations to Ingest API
                    if let Some(ingest_url) = ocw::get_ingest_api_url() {
                        if let Some(hmac_secret) = ocw::get_hmac_secret() {
                            if let Err(e) = http_client::send_observations_batch(
                                &ingest_url,
                                &hmac_secret,
                                policy_id,
                                location_key.as_slice(),
                                &new_obs,
                                &sample_hashes,
                                new_commitment,
                            ) {
                                log::warn!(
                                    target: "prmx-oracle-v3",
                                    "Failed to send observations to Ingest API: {}",
                                    e
                                );
                                local_state.record_error(ocw::OcwError::IngestApi, now_epoch);
                            } else {
                                local_state.last_observation_sent_epoch = last_epoch;
                                local_state.clear_error();
                            }
                        }
                    }
                    
                    // Get policy metadata for coverage times
                    if let Some((_, event_spec, coverage_start, coverage_end)) = Self::get_policy_metadata(policy_id) {
                        // Determine what on-chain action to take
                        let decision = ocw::decide_snapshot_action(
                            &local_state,
                            &event_spec,
                            now_epoch,
                            coverage_start,
                            coverage_end,
                        );
                        
                        match decision {
                            ocw::SnapshotDecision::SendFinalTrigger => {
                                log::info!(
                                    target: "prmx-oracle-v3",
                                    "🎯 Submitting final TRIGGER report for policy {}",
                                    policy_id
                                );
                                
                                if let Err(e) = Self::submit_final_report_on_chain(
                                    policy_id,
                                    OracleReportKindV3::Trigger,
                                    last_epoch,
                                    new_agg_state.clone(),
                                    new_commitment,
                                ) {
                                    log::warn!(
                                        target: "prmx-oracle-v3",
                                        "Failed to submit trigger report: {:?}",
                                        e
                                    );
                                    local_state.record_error(ocw::OcwError::ChainSubmission, now_epoch);
                                } else {
                                    local_state.finalized = true;
                                    local_state.last_snapshot_epoch = last_epoch;
                                }
                            }
                            ocw::SnapshotDecision::SendFinalMaturity => {
                                log::info!(
                                    target: "prmx-oracle-v3",
                                    "✅ Submitting final MATURITY report for policy {}",
                                    policy_id
                                );
                                
                                if let Err(e) = Self::submit_final_report_on_chain(
                                    policy_id,
                                    OracleReportKindV3::Maturity,
                                    last_epoch,
                                    new_agg_state.clone(),
                                    new_commitment,
                                ) {
                                    log::warn!(
                                        target: "prmx-oracle-v3",
                                        "Failed to submit maturity report: {:?}",
                                        e
                                    );
                                    local_state.record_error(ocw::OcwError::ChainSubmission, now_epoch);
                                } else {
                                    local_state.finalized = true;
                                    local_state.last_snapshot_epoch = last_epoch;
                                }
                            }
                            ocw::SnapshotDecision::SendSnapshot => {
                                log::info!(
                                    target: "prmx-oracle-v3",
                                    "📸 Submitting snapshot for policy {} (observed_until: {})",
                                    policy_id,
                                    last_epoch
                                );
                                
                                if let Err(e) = Self::submit_snapshot_on_chain(
                                    policy_id,
                                    last_epoch,
                                    new_agg_state.clone(),
                                    new_commitment,
                                ) {
                                    log::warn!(
                                        target: "prmx-oracle-v3",
                                        "Failed to submit snapshot: {:?}",
                                        e
                                    );
                                    local_state.record_error(ocw::OcwError::ChainSubmission, now_epoch);
                                } else {
                                    local_state.last_snapshot_epoch = last_epoch;
                                    local_state.last_snapshot_sent_at = now_epoch;
                                }
                            }
                            ocw::SnapshotDecision::None => {
                                // No on-chain action needed
                            }
                        }
                    }
                    
                    local_state.save(policy_id);
                }
                Err(e) => {
                    log::warn!(
                        target: "prmx-oracle-v3",
                        "Failed to fetch AccuWeather data for policy {}: {}",
                        policy_id,
                        e
                    );
                    local_state.record_error(ocw::OcwError::AccuWeatherFetch, now_epoch);
                    local_state.save(policy_id);
                }
            }
            
            Ok(())
        }
        
        /// Submit a snapshot to the chain via unsigned transaction
        fn submit_snapshot_on_chain(
            policy_id: PolicyId,
            observed_until: u64,
            agg_state: AggStateV3,
            commitment: [u8; 32],
        ) -> Result<(), &'static str> {
            use frame_system::offchain::SubmitTransaction;
            
            let call = Call::<T>::submit_snapshot_unsigned {
                policy_id,
                observed_until,
                agg_state,
                commitment,
            };
            
            // Create a bare (unsigned) extrinsic and submit it
            let xt = T::create_bare(call.into());
            SubmitTransaction::<T, Call<T>>::submit_transaction(xt)
                .map_err(|_| "Failed to submit unsigned snapshot transaction")
        }
        
        /// Submit a final report to the chain via unsigned transaction
        fn submit_final_report_on_chain(
            policy_id: PolicyId,
            kind: OracleReportKindV3,
            observed_until: u64,
            agg_state: AggStateV3,
            commitment: [u8; 32],
        ) -> Result<(), &'static str> {
            use frame_system::offchain::SubmitTransaction;
            
            let call = Call::<T>::submit_final_report_unsigned {
                policy_id,
                kind,
                observed_until,
                agg_state,
                commitment,
            };
            
            // Create a bare (unsigned) extrinsic and submit it
            let xt = T::create_bare(call.into());
            SubmitTransaction::<T, Call<T>>::submit_transaction(xt)
                .map_err(|_| "Failed to submit unsigned final report transaction")
        }
        
        /// Process expired requests and submit expiry transactions
        fn process_expired_requests(now_epoch: u64) {
            let expired_requests = T::RequestExpiryApi::get_expired_requests(now_epoch);
            
            if expired_requests.is_empty() {
                log::debug!(
                    target: "prmx-oracle-v3",
                    "No expired V3 requests to process"
                );
                return;
            }
            
            log::info!(
                target: "prmx-oracle-v3",
                "⏰ Processing {} expired V3 requests",
                expired_requests.len()
            );
            
            for request_id in expired_requests {
                if let Err(e) = Self::submit_request_expiry_on_chain(request_id) {
                    log::warn!(
                        target: "prmx-oracle-v3",
                        "❌ Failed to submit expiry for request {}: {}",
                        request_id,
                        e
                    );
                } else {
                    log::info!(
                        target: "prmx-oracle-v3",
                        "✅ Submitted expiry for request {}",
                        request_id
                    );
                }
            }
        }
        
        /// Submit a request expiry to the chain via unsigned transaction
        /// Note: This calls into the market-v3 pallet
        /// Submit a request expiry to the chain via unsigned transaction
        fn submit_request_expiry_on_chain(request_id: PolicyId) -> Result<(), &'static str> {
            use frame_system::offchain::SubmitTransaction;
            
            log::info!(
                target: "prmx-oracle-v3",
                "📤 Submitting request {} expiry via unsigned transaction",
                request_id
            );
            
            // Create the call to our own pallet's expire_request_unsigned
            // which will then delegate to market-v3 via trait
            let call = Call::<T>::expire_request_unsigned { request_id };
            
            // Create a bare (unsigned) extrinsic and submit it
            let xt = T::create_bare(call.into());
            SubmitTransaction::<T, Call<T>>::submit_transaction(xt)
                .map_err(|_| "Failed to submit unsigned expiry transaction")
        }
        
        /// Get the location ID for a policy
        fn get_policy_location_id(policy_id: PolicyId) -> Result<LocationId, &'static str> {
            PolicyMetadata::<T>::get(policy_id)
                .map(|(location_id, _, _, _)| location_id)
                .ok_or("Policy metadata not found")
        }
        
        /// Get the event type for a policy
        fn get_policy_event_type(policy_id: PolicyId) -> Result<EventTypeV3, &'static str> {
            PolicyMetadata::<T>::get(policy_id)
                .map(|(_, event_spec, _, _)| event_spec.event_type)
                .ok_or("Policy metadata not found")
        }
        
        /// Get full policy metadata (location_id, event_spec, coverage_start, coverage_end)
        pub fn get_policy_metadata(policy_id: PolicyId) -> Option<(LocationId, EventSpecV3, u64, u64)> {
            PolicyMetadata::<T>::get(policy_id)
        }
    }
}

// ============================================================================
// LocationRegistryApi Trait
// ============================================================================

/// Trait for other pallets to access location registry
pub trait LocationRegistryApi {
    /// Check if location exists and is active
    fn is_location_valid(location_id: LocationId) -> bool;

    /// Get location coordinates
    fn get_location_coordinates(location_id: LocationId) -> Option<(i32, i32)>;
}

impl<T: Config> LocationRegistryApi for Pallet<T> {
    fn is_location_valid(location_id: LocationId) -> bool {
        Pallet::<T>::is_location_active(location_id)
    }

    fn get_location_coordinates(location_id: LocationId) -> Option<(i32, i32)> {
        pallet::LocationRegistry::<T>::get(location_id).map(|l| (l.latitude, l.longitude))
    }
}

