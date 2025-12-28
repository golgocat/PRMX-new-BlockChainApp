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

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub use pallet::*;

pub mod ocw;
pub mod expiry;
pub mod fetcher;
pub mod aggregator;
pub mod commitment;

use alloc::vec::Vec;
use frame_support::pallet_prelude::*;
use frame_system::pallet_prelude::*;
use prmx_primitives::{
    AggStateV3, EventSpecV3, EventTypeV3, OracleReportKindV3, PolicyId, PolicyOracleStateV3,
    PolicyStatusV3, ThresholdV3, V3_MIN_SNAPSHOT_BLOCKS,
};
use sp_core::H256;

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
    pub trait Config: frame_system::Config {
        /// Runtime event type
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;

        /// Origin for governance operations (add/remove locations, oracle members)
        type GovernanceOrigin: EnsureOrigin<Self::RuntimeOrigin>;

        /// Origin for oracle operations (submit snapshots, final reports)
        type OracleOrigin: EnsureOrigin<Self::RuntimeOrigin>;

        /// Policy settlement handler
        type PolicySettlement: PolicySettlementV3;

        /// Maximum length of AccuWeather location key
        #[pallet::constant]
        type MaxLocationKeyLength: Get<u32>;

        /// Weight info
        type WeightInfo: WeightInfo;
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
    }

    // =========================================================================
    //                           Helper Functions
    // =========================================================================

    impl<T: Config> Pallet<T> {
        /// Validate that two AggState values are of the same variant type
        fn validate_agg_state_type(existing: &AggStateV3, new: &AggStateV3) -> bool {
            core::mem::discriminant(existing) == core::mem::discriminant(new)
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

