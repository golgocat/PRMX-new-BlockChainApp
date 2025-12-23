//! # PRMX Oracle Pallet
//!
//! This pallet provides rainfall data and 24-hour rolling sums for settlement.
//!
//! ## Overview
//!
//! Per oracle_design.md:
//! - Locations are bound to markets (LocationId = MarketId)
//! - Oracle offchain worker resolves AccuWeather Location Key for each market
//! - Rainfall is ingested per market using the bound AccuWeather key
//! - Settlement checks if 24h rainfall exceeded strike during coverage window
//!
//! ## Key Features
//!
//! - `MarketLocationConfig`: Binds AccuWeather Location Key to market
//! - `RainBuckets`: Hourly rainfall data per market
//! - `RollingState`: 24h rolling sum state per market
//! - `RainfallOracle` trait for settlement queries

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub use pallet::*;

// =============================================================================
//                     Oracle Authority Crypto Types
// =============================================================================

/// Key type for oracle authority (used for signing offchain transactions)
pub const KEY_TYPE: sp_runtime::KeyTypeId = sp_runtime::KeyTypeId(*b"orcl");

/// Crypto module for oracle authority signatures
pub mod crypto {
    use super::KEY_TYPE;
    use sp_core::sr25519::Signature as Sr25519Signature;
    use sp_runtime::{
        app_crypto::{app_crypto, sr25519},
        traits::Verify,
        MultiSignature, MultiSigner,
    };

    app_crypto!(sr25519, KEY_TYPE);

    /// Oracle authority ID (public key)
    pub struct OracleAuthId;

    impl frame_system::offchain::AppCrypto<MultiSigner, MultiSignature> for OracleAuthId {
        type RuntimeAppPublic = Public;
        type GenericPublic = sp_core::sr25519::Public;
        type GenericSignature = sp_core::sr25519::Signature;
    }

    impl frame_system::offchain::AppCrypto<<Sr25519Signature as Verify>::Signer, Sr25519Signature>
        for OracleAuthId
    {
        type RuntimeAppPublic = Public;
        type GenericPublic = sp_core::sr25519::Public;
        type GenericSignature = sp_core::sr25519::Signature;
    }
}

use alloc::vec::Vec;
use pallet_prmx_markets::{MarketId, NewMarketNotifier};

// =============================================================================
//                             Type Aliases
// =============================================================================

/// LocationId is an alias for MarketId (one location per market)
pub type LocationId = MarketId;

/// Millimeters type for rainfall (scaled by 10, so 12.5mm = 125)
pub type Millimeters = u32;

/// Bucket index (timestamp / BUCKET_INTERVAL_SECS)
pub type BucketIndex = u64;

/// AccuWeather Location Key (e.g., b"123456")
pub type AccuWeatherLocationKey = Vec<u8>;

// =============================================================================
//                             Constants
// =============================================================================

/// Seconds per bucket (1 hour)
pub const BUCKET_INTERVAL_SECS: u64 = 3600;

/// Seconds in rolling window (24 hours)
pub const ROLLING_WINDOW_SECS: u64 = 24 * 3600;

/// Maximum allowed past drift for submitted timestamps (7 days)
pub const MAX_PAST_DRIFT_SECS: u64 = 7 * 24 * 3600;

/// Maximum allowed future drift for submitted timestamps (2 hours)
pub const MAX_FUTURE_DRIFT_SECS: u64 = 2 * 3600;

/// Maximum rainfall value sanity check (1000mm per hour is absurd)
pub const MAX_RAINFALL_MM: u32 = 10000; // 1000mm scaled by 10

/// Base timestamp for block-to-time conversion (Dec 8, 2025 00:00 UTC approximate)
pub const BASE_TIMESTAMP_SECS: u64 = 1733616000;

/// Blocks per hour (assuming ~6 second block time)
/// 3600 seconds / 6 seconds = 600 blocks
pub const BLOCKS_PER_HOUR: u32 = 600;

/// Blocks between location binding checks (~10 minutes)
/// 600 seconds / 6 seconds = 100 blocks
pub const BLOCKS_PER_BINDING_CHECK: u32 = 100;

/// Blocks between settlement threshold checks (~1 minute for testing, can be increased in production)
/// 60 seconds / 6 seconds = 10 blocks
pub const BLOCKS_PER_SETTLEMENT_CHECK: u32 = 10;

// =============================================================================
//                          Helper Functions
// =============================================================================

/// Convert timestamp to bucket index
pub fn bucket_index_for_timestamp(ts: u64) -> BucketIndex {
    ts / BUCKET_INTERVAL_SECS
}

/// Get bucket start time from index
pub fn bucket_start_time(idx: BucketIndex) -> u64 {
    idx * BUCKET_INTERVAL_SECS
}

// =============================================================================
//                          RainfallOracle Trait
// =============================================================================

/// Trait for other pallets to access oracle data for settlement
pub trait RainfallOracle {
    /// Get 24h rolling sum at a specific timestamp for a location (market)
    fn rolling_sum_mm_at(location_id: LocationId, timestamp: u64) -> Option<Millimeters>;

    /// Check if rainfall exceeded threshold at any point during coverage window
    fn exceeded_threshold_in_window(
        location_id: LocationId,
        strike_mm: Millimeters,
        coverage_start: u64,
        coverage_end: u64,
    ) -> Result<bool, sp_runtime::DispatchError>;
}

// =============================================================================
//                          PolicySettlement Trait
// =============================================================================

/// Policy ID type (must match pallet_prmx_policy::PolicyId)
pub type PolicyId = u64;

/// Trait for oracle to trigger automatic policy settlements
pub trait PolicySettlement<AccountId> {
    /// Get the current blockchain timestamp in seconds
    fn current_time() -> u64;
    
    /// Get all active policies for a market that are currently in their coverage window
    fn get_active_policies_in_window(market_id: MarketId, current_time: u64) -> Vec<PolicyId>;
    
    /// Get policy details: (holder, max_payout_u128, coverage_start, coverage_end, market_id)
    fn get_policy_info(policy_id: PolicyId) -> Option<(AccountId, u128, u64, u64, MarketId)>;
    
    /// Trigger immediate settlement for a policy (called when threshold exceeded)
    /// Returns Ok(payout_amount_u128) on success
    fn trigger_immediate_settlement(policy_id: PolicyId) -> Result<u128, sp_runtime::DispatchError>;
    
    /// Get all active policies that have expired (coverage_end < current_time)
    /// Used for automated expiration settlement
    fn get_expired_policies(current_time: u64) -> Vec<PolicyId>;
    
    /// Settle an expired policy with the determined event outcome
    /// Returns Ok(payout_amount_u128) on success
    fn settle_expired_policy(policy_id: PolicyId, event_occurred: bool) -> Result<u128, sp_runtime::DispatchError>;

    /// Settle a V2 policy based on off-chain oracle report.
    /// This is called by the oracle pallet after validating the report.
    fn settle_v2_policy(
        policy_id: PolicyId,
        outcome: prmx_primitives::V2Outcome,
        observed_at: u64,
        cumulative_mm: u32,
        evidence_hash: [u8; 32],
    ) -> Result<(), sp_runtime::DispatchError>;
}

#[frame_support::pallet]
pub mod pallet {
    use super::*;
    use frame_support::pallet_prelude::*;
    use frame_system::pallet_prelude::*;
    use pallet_prmx_markets::MarketsAccess;

    // =========================================================================
    //                                  Types
    // =========================================================================

    /// Market location binding info (per oracle_design.md section 3)
    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
    #[scale_info(skip_type_params(T))]
    pub struct MarketLocationInfo<T: Config> {
        /// AccuWeather Location Key (resolved by offchain worker)
        pub accuweather_location_key: BoundedVec<u8, T::MaxLocationKeyLength>,
        /// Center latitude (copied from MarketInfo at bind time)
        pub center_latitude: i32,
        /// Center longitude (copied from MarketInfo at bind time)
        pub center_longitude: i32,
    }

    /// Rainfall bucket (hourly data) per oracle_design.md section 5.2
    #[derive(
        Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen, Default,
    )]
    pub struct RainBucket {
        /// Timestamp of this bucket (aligned to bucket start)
        pub timestamp: u64,
        /// Rainfall amount in mm (scaled by 10, so 12.5mm = 125)
        pub rainfall_mm: Millimeters,
        /// Block number when this bucket was last updated
        pub block_number: u32,
    }

    /// Rolling window state per oracle_design.md section 5.3
    #[derive(
        Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen, Default,
    )]
    pub struct RollingWindowState {
        /// Most recent bucket index processed
        pub last_bucket_index: BucketIndex,
        /// Oldest bucket index in the rolling window
        pub oldest_bucket_index: BucketIndex,
        /// Current 24h rolling sum in mm (scaled by 10)
        pub rolling_sum_mm: Millimeters,
    }

    /// Hourly bucket for V1 oracle using AccuWeather historical/24 endpoint
    /// Stores individual hourly rainfall readings for accurate rolling window calculation
    #[derive(
        Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen, Default,
    )]
    pub struct HourlyBucket {
        /// Rainfall amount in mm (scaled by 10, so 12.5mm = 125)
        pub mm: Millimeters,
        /// Unix timestamp when this bucket was fetched
        pub fetched_at: u64,
        /// Data source: 0 = current conditions, 1 = historical/24
        pub source: u8,
    }

    /// On-chain log of threshold trigger events
    /// Records comprehensive data when a policy is auto-settled due to threshold breach
    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
    #[scale_info(skip_type_params(T))]
    pub struct ThresholdTriggerLog<T: Config> {
        /// Unique trigger ID
        pub trigger_id: u64,
        /// Market ID where event occurred
        pub market_id: MarketId,
        /// Policy ID that was settled
        pub policy_id: super::PolicyId,
        /// Unix timestamp when trigger occurred
        pub triggered_at: u64,
        /// Block number when trigger occurred
        pub block_number: BlockNumberFor<T>,
        /// 24H rolling rainfall sum at trigger time (in tenths of mm)
        pub rolling_sum_mm: Millimeters,
        /// Strike threshold that was exceeded (in tenths of mm)
        pub strike_threshold: Millimeters,
        /// Policy holder account
        pub holder: T::AccountId,
        /// Payout amount to holder (stored as u128)
        pub payout_amount: u128,
        /// Market center latitude (scaled by 1e6)
        pub center_latitude: i32,
        /// Market center longitude (scaled by 1e6)
        pub center_longitude: i32,
    }

    // =========================================================================
    //                                  Config
    // =========================================================================

    #[pallet::config]
    pub trait Config:
        frame_system::Config
        + pallet_prmx_markets::Config
        + frame_system::offchain::CreateSignedTransaction<Call<Self>>
    {
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;

        /// Who can submit rainfall data and bind AccuWeather locations
        type OracleOrigin: EnsureOrigin<Self::RuntimeOrigin>;

        /// Who can govern configuration (typically DAO/Root)
        type GovernanceOrigin: EnsureOrigin<Self::RuntimeOrigin>;

        /// Access to markets pallet for center coordinates
        type MarketsApi: MarketsAccess;

        /// Access to policy pallet for automatic settlements
        type PolicySettlement: super::PolicySettlement<Self::AccountId>;

        /// Maximum length of AccuWeather location key
        #[pallet::constant]
        type MaxLocationKeyLength: Get<u32>;

        /// Oracle authority ID for signing offchain transactions
        type AuthorityId: frame_system::offchain::AppCrypto<Self::Public, Self::Signature>;

        /// Weight info for extrinsics
        type WeightInfo: WeightInfo;
    }

    /// Weight info trait
    pub trait WeightInfo {
        fn set_market_location_key() -> Weight;
        fn submit_rainfall() -> Weight;
    }

    /// Default weights
    impl WeightInfo for () {
        fn set_market_location_key() -> Weight {
            Weight::from_parts(10_000, 0)
        }
        fn submit_rainfall() -> Weight {
            Weight::from_parts(20_000, 0)
        }
    }

    // =========================================================================
    //                                  Storage
    // =========================================================================

    #[pallet::pallet]
    pub struct Pallet<T>(_);

    /// Market location binding (AccuWeather key per market)
    /// Per oracle_design.md section 5.1
    #[pallet::storage]
    #[pallet::getter(fn market_location_config)]
    pub type MarketLocationConfig<T: Config> =
        StorageMap<_, Blake2_128Concat, MarketId, MarketLocationInfo<T>, OptionQuery>;

    /// Rain buckets per (location_id, bucket_index)
    /// Per oracle_design.md section 5.2
    #[pallet::storage]
    #[pallet::getter(fn rain_buckets)]
    pub type RainBuckets<T: Config> = StorageDoubleMap<
        _,
        Blake2_128Concat,
        LocationId,
        Blake2_128Concat,
        BucketIndex,
        RainBucket,
        OptionQuery,
    >;

    /// Rolling window state per location (market)
    /// Per oracle_design.md section 5.3
    #[pallet::storage]
    #[pallet::getter(fn rolling_state)]
    pub type RollingState<T: Config> =
        StorageMap<_, Blake2_128Concat, LocationId, RollingWindowState, OptionQuery>;

    /// Hourly buckets for V1 oracle (per market_id and hour_index)
    /// Stores individual hourly rainfall readings from AccuWeather historical/24 endpoint
    /// hour_index = unix_timestamp / 3600 (hour since Unix epoch)
    #[pallet::storage]
    #[pallet::getter(fn hourly_buckets)]
    pub type HourlyBuckets<T: Config> = StorageDoubleMap<
        _,
        Blake2_128Concat,
        MarketId,
        Blake2_128Concat,
        u64, // hour_index
        HourlyBucket,
        OptionQuery,
    >;

    /// Authorized oracle providers (accounts that can submit data)
    #[pallet::storage]
    #[pallet::getter(fn oracle_providers)]
    pub type OracleProviders<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, bool, ValueQuery>;

    /// On-chain threshold trigger logs
    /// Records all automatic settlements triggered by threshold breaches
    #[pallet::storage]
    #[pallet::getter(fn threshold_trigger_logs)]
    pub type ThresholdTriggerLogs<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        u64, // trigger_id
        ThresholdTriggerLog<T>,
        OptionQuery,
    >;

    /// Next trigger log ID (auto-increment)
    #[pallet::storage]
    #[pallet::getter(fn next_trigger_log_id)]
    pub type NextTriggerLogId<T: Config> = StorageValue<_, u64, ValueQuery>;

    /// Pending manual fetch requests by market ID
    /// Stores the block number when the request was made
    /// Used by offchain worker to trigger immediate AccuWeather API fetch
    #[pallet::storage]
    #[pallet::getter(fn pending_fetch_requests)]
    pub type PendingFetchRequests<T: Config> =
        StorageMap<_, Blake2_128Concat, MarketId, BlockNumberFor<T>, OptionQuery>;

    /// Flag indicating API key was just configured and immediate fetch should be triggered
    #[pallet::storage]
    #[pallet::getter(fn api_key_configured_at)]
    pub type ApiKeyConfiguredAt<T: Config> = StorageValue<_, BlockNumberFor<T>, OptionQuery>;

    /// Pending API key to be copied to offchain local storage by the OCW.
    /// This is used to securely transfer the API key from on-chain to offchain.
    /// The OCW reads this, copies to local storage, and clears it.
    #[pallet::storage]
    pub type PendingApiKey<T: Config> = StorageValue<_, BoundedVec<u8, ConstU32<256>>, OptionQuery>;

    // =========================================================================
    //                          V2 Oracle Storage
    // =========================================================================

    /// Authorized V2 oracle reporters (accounts that can submit V2 reports).
    /// These are off-chain oracle service accounts.
    #[pallet::storage]
    #[pallet::getter(fn authorized_v2_reporters)]
    pub type AuthorizedV2Reporters<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, bool, ValueQuery>;

    /// V2 final reports by policy ID (one report per policy, immutable once set).
    /// Stored here for oracle-level tracking; policy pallet also stores a copy.
    #[pallet::storage]
    #[pallet::getter(fn v2_final_report_by_policy)]
    pub type V2FinalReportByPolicy<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        PolicyId,
        prmx_primitives::V2Report<T::AccountId>,
        OptionQuery,
    >;

    // =========================================================================
    //                                  Events
    // =========================================================================

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// AccuWeather location key bound to market
        MarketLocationBound {
            market_id: MarketId,
            accuweather_location_key: Vec<u8>,
        },
        /// Rainfall data updated for a bucket
        RainfallUpdated {
            location_id: LocationId,
            bucket_index: BucketIndex,
            rainfall_mm: Millimeters,
        },
        /// Rolling sum updated for a location
        RollingSumUpdated {
            location_id: LocationId,
            rolling_sum_mm: Millimeters,
        },
        /// Oracle provider added
        OracleProviderAdded { account: T::AccountId },
        /// Oracle provider removed
        OracleProviderRemoved { account: T::AccountId },
        /// Threshold triggered - automatic settlement initiated
        ThresholdTriggered {
            trigger_id: u64,
            market_id: MarketId,
            policy_id: super::PolicyId,
            rolling_sum_mm: Millimeters,
            strike_threshold: Millimeters,
            triggered_at: u64,
            payout_amount: u128,
        },
        /// Manual rainfall fetch requested by DAO
        RainfallFetchRequested {
            market_id: MarketId,
        },
        /// Manual rainfall fetch completed by offchain worker
        RainfallFetchCompleted {
            market_id: MarketId,
            records_updated: u32,
        },
        /// All markets rainfall fetch requested (batch refresh)
        AllMarketsFetchRequested {
            market_count: u32,
            requested_at: u64,
        },
        /// Policy automatically settled after coverage expiration
        PolicyExpirationSettled {
            policy_id: super::PolicyId,
            event_occurred: bool,
            payout_amount: u128,
        },
        // ===== V2 Oracle Events =====
        /// V2 reporter added
        V2ReporterAdded { account: T::AccountId },
        /// V2 reporter removed
        V2ReporterRemoved { account: T::AccountId },
        /// V2 report accepted and forwarded to policy pallet
        V2ReportAccepted {
            policy_id: super::PolicyId,
            outcome: prmx_primitives::V2Outcome,
            cumulative_mm: u32,
            evidence_hash: [u8; 32],
        },
    }

    // =========================================================================
    //                                  Errors
    // =========================================================================

    #[pallet::error]
    pub enum Error<T> {
        /// Market not found
        MarketNotFound,
        /// Market location not configured (AccuWeather key not bound)
        MarketLocationNotConfigured,
        /// Location key already bound for this market
        LocationAlreadyBound,
        /// Invalid timestamp (too far in past or future)
        InvalidTimestamp,
        /// Timestamp too old
        TimestampTooOld,
        /// Timestamp too far in future
        TimestampInFuture,
        /// Invalid rainfall value (sanity check failed)
        InvalidRainfallValue,
        /// Location key too long
        LocationKeyTooLong,
        /// Not an authorized oracle provider
        NotOracleProvider,
        /// Invalid coverage window (end must be after start)
        InvalidCoverageWindow,
        /// API key is too long
        InvalidApiKey,
        /// Settlement failed
        SettlementFailed,
        /// Fetch request already pending for this market
        FetchAlreadyPending,
        /// No pending fetch request for this market (unsigned tx validation)
        NoPendingFetchRequest,
        /// Invalid unsigned transaction submission
        InvalidUnsignedSubmission,
        /// Not an authorized V2 reporter
        NotAuthorizedV2Reporter,
        /// V2 report already submitted for this policy
        V2ReportAlreadySubmitted,
        /// Not a V2 policy
        NotV2Policy,
        /// V2 policies only allowed for Manila market
        V2OnlyManilaAllowed,
    }

    // =========================================================================
    //                              Genesis Config
    // =========================================================================

    /// Genesis configuration for oracle pallet
    #[pallet::genesis_config]
    #[derive(frame_support::DefaultNoBound)]
    pub struct GenesisConfig<T: Config> {
        /// Initial oracle providers (accounts authorized to submit rainfall data)
        pub oracle_providers: Vec<T::AccountId>,
        /// AccuWeather API key (stored in offchain index at genesis)
        pub accuweather_api_key: Vec<u8>,
    }

    #[pallet::genesis_build]
    impl<T: Config> BuildGenesisConfig for GenesisConfig<T> {
        fn build(&self) {
            // Register initial oracle providers
            for account in &self.oracle_providers {
                OracleProviders::<T>::insert(account, true);
                log::info!(
                    target: "prmx-oracle",
                    "🔐 Genesis: Registered oracle provider"
                );
            }
            
            // Store AccuWeather API key in offchain index
            if !self.accuweather_api_key.is_empty() {
                sp_io::offchain_index::set(ACCUWEATHER_API_KEY_STORAGE, &self.accuweather_api_key);
                log::info!(
                    target: "prmx-oracle",
                    "🔑 Genesis: AccuWeather API key configured (length: {} bytes)",
                    self.accuweather_api_key.len()
                );
            } else {
                log::warn!(
                    target: "prmx-oracle",
                    "⚠️ Genesis: AccuWeather API key not configured. Set ACCUWEATHER_API_KEY environment variable."
                );
            }
        }
    }

    // =========================================================================
    //                                Extrinsics
    // =========================================================================

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Bind AccuWeather Location Key to a market.
        /// Called by oracle offchain worker after resolving geoposition.
        /// Per oracle_design.md section 7.1
        #[pallet::call_index(0)]
        #[pallet::weight(T::WeightInfo::set_market_location_key())]
        pub fn set_market_location_key(
            origin: OriginFor<T>,
            market_id: MarketId,
            accuweather_location_key: Vec<u8>,
        ) -> DispatchResult {
            // Either OracleOrigin or GovernanceOrigin can call this
            let is_oracle = T::OracleOrigin::try_origin(origin.clone()).is_ok();
            let is_governance = T::GovernanceOrigin::try_origin(origin).is_ok();

            ensure!(is_oracle || is_governance, Error::<T>::NotOracleProvider);

            // Ensure market exists and get center coordinates
            let (center_latitude, center_longitude) = T::MarketsApi::center_coordinates(market_id)
                .map_err(|_| Error::<T>::MarketNotFound)?;

            // Convert to bounded vec
            let bounded_key: BoundedVec<u8, T::MaxLocationKeyLength> = accuweather_location_key
                .clone()
                .try_into()
                .map_err(|_| Error::<T>::LocationKeyTooLong)?;

            // Store the binding
            let location_info = MarketLocationInfo {
                accuweather_location_key: bounded_key,
                center_latitude,
                center_longitude,
            };

            MarketLocationConfig::<T>::insert(market_id, location_info);

            Self::deposit_event(Event::MarketLocationBound {
                market_id,
                accuweather_location_key,
            });

            Ok(())
        }

        /// Submit rainfall data for a location (market).
        /// Called by authorized oracle providers.
        /// Per oracle_design.md section 8.2
        #[pallet::call_index(1)]
        #[pallet::weight(T::WeightInfo::submit_rainfall())]
        pub fn submit_rainfall(
            origin: OriginFor<T>,
            location_id: LocationId,
            timestamp: u64,
            rainfall_mm: Millimeters,
        ) -> DispatchResult {
            // Check if caller is authorized (either OracleOrigin or signed provider)
            let is_oracle_origin = T::OracleOrigin::try_origin(origin.clone()).is_ok();

            if !is_oracle_origin {
                let who = ensure_signed(origin)?;
                ensure!(
                    OracleProviders::<T>::get(&who),
                    Error::<T>::NotOracleProvider
                );
            }

            // Ensure market has location config
            ensure!(
                MarketLocationConfig::<T>::contains_key(location_id),
                Error::<T>::MarketLocationNotConfigured
            );

            // Get current time for drift validation
            // Use block number * 6 seconds + base timestamp for approximation
            let now = {
                use sp_runtime::traits::UniqueSaturatedInto;
                let block_num: u64 = frame_system::Pallet::<T>::block_number().unique_saturated_into();
                // Use consistent timestamp calculation: base + (block_num * 6 seconds)
                BASE_TIMESTAMP_SECS + (block_num * 6)
            };

            // Validate timestamp drift (allow any timestamp in dev mode if now is 0)
            if now > 0 {
                ensure!(
                    timestamp >= now.saturating_sub(MAX_PAST_DRIFT_SECS),
                    Error::<T>::TimestampTooOld
                );
                ensure!(
                    timestamp <= now.saturating_add(MAX_FUTURE_DRIFT_SECS),
                    Error::<T>::TimestampInFuture
                );
            }

            // Sanity check rainfall value
            ensure!(
                rainfall_mm <= MAX_RAINFALL_MM,
                Error::<T>::InvalidRainfallValue
            );

            // Compute bucket index and aligned timestamp
            let idx = bucket_index_for_timestamp(timestamp);
            let bucket_start = bucket_start_time(idx);

            // Get old bucket value for delta calculation
            let old_mm = RainBuckets::<T>::get(location_id, idx)
                .map(|b| b.rainfall_mm)
                .unwrap_or(0);

            // Insert/overwrite bucket
            let current_block: u32 = frame_system::Pallet::<T>::block_number()
                .try_into()
                .unwrap_or(0);
            let bucket = RainBucket {
                timestamp: bucket_start,
                rainfall_mm,
                block_number: current_block,
            };
            RainBuckets::<T>::insert(location_id, idx, bucket);

            Self::deposit_event(Event::RainfallUpdated {
                location_id,
                bucket_index: idx,
                rainfall_mm,
            });

            // Update rolling state
            Self::update_rolling_state(location_id, idx, old_mm, rainfall_mm, now)?;

            Ok(())
        }

        /// Add an oracle provider account.
        /// Only callable by GovernanceOrigin.
        #[pallet::call_index(2)]
        #[pallet::weight(Weight::from_parts(10_000, 0))]
        pub fn add_oracle_provider(origin: OriginFor<T>, account: T::AccountId) -> DispatchResult {
            T::GovernanceOrigin::ensure_origin(origin)?;

            OracleProviders::<T>::insert(&account, true);

            Self::deposit_event(Event::OracleProviderAdded { account });

            Ok(())
        }

        /// Remove an oracle provider account.
        /// Only callable by GovernanceOrigin.
        #[pallet::call_index(3)]
        #[pallet::weight(Weight::from_parts(10_000, 0))]
        pub fn remove_oracle_provider(
            origin: OriginFor<T>,
            account: T::AccountId,
        ) -> DispatchResult {
            T::GovernanceOrigin::ensure_origin(origin)?;

            OracleProviders::<T>::remove(&account);

            Self::deposit_event(Event::OracleProviderRemoved { account });

            Ok(())
        }

        /// Set test rainfall data for a market (dev/testing purposes).
        /// This allows manual population of rainfall data without needing AccuWeather API.
        /// Only callable by GovernanceOrigin or OracleOrigin.
        #[pallet::call_index(4)]
        #[pallet::weight(Weight::from_parts(50_000, 0))]
        pub fn set_test_rainfall(
            origin: OriginFor<T>,
            market_id: MarketId,
            rainfall_mm: u32,
        ) -> DispatchResult {
            // Either OracleOrigin or GovernanceOrigin can call this
            let is_oracle = T::OracleOrigin::try_origin(origin.clone()).is_ok();
            let is_governance = T::GovernanceOrigin::try_origin(origin).is_ok();
            ensure!(is_oracle || is_governance, Error::<T>::NotOracleProvider);

            // Ensure market exists
            ensure!(
                T::MarketsApi::center_coordinates(market_id).is_ok(),
                Error::<T>::MarketNotFound
            );

            // Auto-bind location if not already bound
            if !MarketLocationConfig::<T>::contains_key(market_id) {
                if let Ok((lat, lon)) = T::MarketsApi::center_coordinates(market_id) {
                    let mock_key = alloc::format!("test-market-{}", market_id);
                    if let Ok(bounded_key) = mock_key.as_bytes().to_vec().try_into() {
                        let location_info = MarketLocationInfo {
                            accuweather_location_key: bounded_key,
                            center_latitude: lat,
                            center_longitude: lon,
                        };
                        MarketLocationConfig::<T>::insert(market_id, location_info);
                    }
                }
            }

            // Get current timestamp approximation
            use sp_runtime::traits::UniqueSaturatedInto;
            let block_num: u64 = frame_system::Pallet::<T>::block_number().unique_saturated_into();
            let now_ts = BASE_TIMESTAMP_SECS + (block_num * 6);
            let bucket_idx = bucket_index_for_timestamp(now_ts);

            // Store rainfall bucket
            let bucket = RainBucket {
                timestamp: bucket_start_time(bucket_idx),
                rainfall_mm,
                block_number: block_num as u32,
            };
            RainBuckets::<T>::insert(market_id, bucket_idx, bucket);

            // Update or create rolling state
            let state = RollingWindowState {
                last_bucket_index: bucket_idx,
                oldest_bucket_index: bucket_idx,
                rolling_sum_mm: rainfall_mm,
            };
            RollingState::<T>::insert(market_id, state);

            Self::deposit_event(Event::RainfallUpdated {
                location_id: market_id,
                bucket_index: bucket_idx,
                rainfall_mm,
            });

            Self::deposit_event(Event::RollingSumUpdated {
                location_id: market_id,
                rolling_sum_mm: rainfall_mm,
            });

            log::info!(
                target: "prmx-oracle",
                "🧪 Set test rainfall for market {}: {} mm (via extrinsic)",
                market_id,
                rainfall_mm as f64 / 10.0
            );

            Ok(())
        }

        /// Store AccuWeather API key in offchain storage.
        /// This key is used by the offchain worker to fetch real rainfall data.
        /// Only callable by GovernanceOrigin.
        /// Note: The API key is stored in offchain local storage, not on-chain.
        #[pallet::call_index(5)]
        #[pallet::weight(Weight::from_parts(10_000, 0))]
        pub fn set_accuweather_api_key(
            origin: OriginFor<T>,
            api_key: Vec<u8>,
        ) -> DispatchResult {
            T::GovernanceOrigin::ensure_origin(origin)?;

            // Store the key in on-chain storage for the OCW to pick up
            // The OCW will copy this to its local storage and clear this storage
            let bounded_key: BoundedVec<u8, ConstU32<256>> = api_key.clone().try_into()
                .map_err(|_| Error::<T>::InvalidApiKey)?;
            PendingApiKey::<T>::put(bounded_key);

            // Set flag to trigger immediate rainfall fetch on next offchain worker run
            let current_block = <frame_system::Pallet<T>>::block_number();
            ApiKeyConfiguredAt::<T>::put(current_block);

            log::info!(
                target: "prmx-oracle",
                "🔑 AccuWeather API key queued for OCW (length: {} bytes) - immediate fetch scheduled",
                api_key.len()
            );

            // Note: We don't emit an event with the API key for security reasons
            Ok(())
        }

        /// Request manual rainfall data fetch from AccuWeather for a specific market.
        /// Only callable by GovernanceOrigin (DAO).
        /// The offchain worker will process this request and fetch real data.
        #[pallet::call_index(6)]
        #[pallet::weight(Weight::from_parts(10_000, 0))]
        pub fn request_rainfall_fetch(
            origin: OriginFor<T>,
            market_id: MarketId,
        ) -> DispatchResult {
            T::GovernanceOrigin::ensure_origin(origin)?;

            // Validate market exists
            ensure!(
                pallet_prmx_markets::Markets::<T>::contains_key(market_id),
                Error::<T>::MarketNotFound
            );

            // Validate market has location binding
            ensure!(
                MarketLocationConfig::<T>::contains_key(market_id),
                Error::<T>::MarketLocationNotConfigured
            );

            // Check if there's already a pending request
            ensure!(
                !PendingFetchRequests::<T>::contains_key(market_id),
                Error::<T>::FetchAlreadyPending
            );

            // Store request with current block number
            let current_block = frame_system::Pallet::<T>::block_number();
            PendingFetchRequests::<T>::insert(market_id, current_block);

            log::info!(
                target: "prmx-oracle",
                "📥 Manual rainfall fetch requested for market {} at block {:?}",
                market_id,
                current_block
            );

            Self::deposit_event(Event::RainfallFetchRequested { market_id });

            Ok(())
        }

        /// Complete a manual rainfall fetch by processing fetched data.
        /// Called by DAO after offchain worker has fetched and stored data.
        /// This extrinsic allows the DAO to manually submit the AccuWeather data.
        #[pallet::call_index(7)]
        #[pallet::weight(Weight::from_parts(50_000, 0))]
        pub fn complete_rainfall_fetch(
            origin: OriginFor<T>,
            market_id: MarketId,
            rainfall_mm: Millimeters, // The 24h rolling sum from AccuWeather
        ) -> DispatchResult {
            // Only governance can complete fetch requests
            T::GovernanceOrigin::ensure_origin(origin)?;

            // Verify there's a pending fetch request (or allow direct update)
            // Clear the pending request if it exists
            PendingFetchRequests::<T>::remove(market_id);

            // Get current time for rolling state updates
            let now = Self::current_timestamp();
            let bucket_idx = bucket_index_for_timestamp(now);
            let bucket_start = bucket_start_time(bucket_idx);

            log::info!(
                target: "prmx-oracle",
                "📊 Processing manual rainfall fetch completion for market {} with {} mm",
                market_id,
                rainfall_mm as f64 / 10.0
            );

            // Get old bucket value for delta calculation
            let _old_mm = RainBuckets::<T>::get(market_id, bucket_idx)
                .map(|b| b.rainfall_mm)
                .unwrap_or(0);

            // Insert/overwrite bucket with new data
            let current_block: u32 = frame_system::Pallet::<T>::block_number()
                .try_into()
                .unwrap_or(0);
            let bucket = RainBucket {
                timestamp: bucket_start,
                rainfall_mm,
                block_number: current_block,
            };
            RainBuckets::<T>::insert(market_id, bucket_idx, bucket);

            Self::deposit_event(Event::RainfallUpdated {
                location_id: market_id,
                bucket_index: bucket_idx,
                rainfall_mm,
            });

            // Update rolling state - set the rolling sum to the provided value
            // (AccuWeather Past24Hours already gives us the 24h sum)
            let state = RollingWindowState {
                last_bucket_index: bucket_idx,
                oldest_bucket_index: bucket_idx.saturating_sub(24), // ~24 hours of buckets
                rolling_sum_mm: rainfall_mm,
            };
            RollingState::<T>::insert(market_id, state);

            Self::deposit_event(Event::RollingSumUpdated {
                location_id: market_id,
                rolling_sum_mm: rainfall_mm,
            });

            log::info!(
                target: "prmx-oracle",
                "✅ Completed rainfall fetch for market {}: rolling sum = {} mm",
                market_id,
                rainfall_mm as f64 / 10.0
            );

            Self::deposit_event(Event::RainfallFetchCompleted {
                market_id,
                records_updated: 1,
            });

            Ok(())
        }

        /// Update on-chain rainfall data from offchain worker (signed transaction).
        /// This is called by the offchain worker after fetching real data from AccuWeather.
        /// The signer must be an authorized oracle provider.
        #[pallet::call_index(8)]
        #[pallet::weight(Weight::from_parts(50_000, 0))]
        pub fn submit_rainfall_from_ocw(
            origin: OriginFor<T>,
            market_id: MarketId,
            rainfall_mm: Millimeters, // The 24h rolling sum from AccuWeather (in tenths of mm)
        ) -> DispatchResult {
            // Verify signed by an oracle provider
            let who = ensure_signed(origin)?;
            ensure!(
                OracleProviders::<T>::get(&who),
                Error::<T>::NotOracleProvider
            );

            // Validate market exists
            ensure!(
                pallet_prmx_markets::Markets::<T>::contains_key(market_id),
                Error::<T>::MarketNotFound
            );

            // Sanity check rainfall value (1000mm = 10000 in tenths)
            ensure!(
                rainfall_mm <= MAX_RAINFALL_MM,
                Error::<T>::InvalidRainfallValue
            );

            // Get current time for rolling state updates
            let now = Self::current_timestamp();
            let bucket_idx = bucket_index_for_timestamp(now);
            let bucket_start = bucket_start_time(bucket_idx);

            log::info!(
                target: "prmx-oracle",
                "🤖 OCW signed tx: updating rainfall for market {} with {} mm",
                market_id,
                rainfall_mm as f64 / 10.0
            );

            // Get old bucket value for delta calculation
            let _old_mm = RainBuckets::<T>::get(market_id, bucket_idx)
                .map(|b| b.rainfall_mm)
                .unwrap_or(0);

            // Insert/overwrite bucket with new data
            let current_block: u32 = frame_system::Pallet::<T>::block_number()
                .try_into()
                .unwrap_or(0);
            let bucket = RainBucket {
                timestamp: bucket_start,
                rainfall_mm,
                block_number: current_block,
            };
            RainBuckets::<T>::insert(market_id, bucket_idx, bucket);

            Self::deposit_event(Event::RainfallUpdated {
                location_id: market_id,
                bucket_index: bucket_idx,
                rainfall_mm,
            });

            // Update rolling state - set the rolling sum to the provided value
            // (AccuWeather Past24Hours already gives us the 24h sum)
            let state = RollingWindowState {
                last_bucket_index: bucket_idx,
                oldest_bucket_index: bucket_idx.saturating_sub(24),
                rolling_sum_mm: rainfall_mm,
            };
            RollingState::<T>::insert(market_id, state);

            Self::deposit_event(Event::RollingSumUpdated {
                location_id: market_id,
                rolling_sum_mm: rainfall_mm,
            });

            log::info!(
                target: "prmx-oracle",
                "✅ OCW updated on-chain rainfall for market {}: {} mm",
                market_id,
                rainfall_mm as f64 / 10.0
            );

            // Clear any pending fetch request for this market since we've now updated it
            if PendingFetchRequests::<T>::contains_key(market_id) {
                PendingFetchRequests::<T>::remove(market_id);
                log::info!(
                    target: "prmx-oracle",
                    "🧹 Cleared pending fetch request for market {}",
                    market_id
                );
            }

            Ok(())
        }

        /// Submit 24 hourly rainfall readings from OCW
        /// Uses AccuWeather historical/24 endpoint data for more accurate rolling window
        /// Each entry is (epoch_time, rainfall_mm_scaled)
        #[pallet::call_index(13)]
        #[pallet::weight(Weight::from_parts(100_000, 0))]
        pub fn submit_hourly_rainfall_from_ocw(
            origin: OriginFor<T>,
            market_id: MarketId,
            hourly_data: BoundedVec<(u64, Millimeters), ConstU32<24>>, // Max 24 hourly readings
        ) -> DispatchResult {
            // Verify signed by an oracle provider
            let who = ensure_signed(origin)?;
            ensure!(
                OracleProviders::<T>::get(&who),
                Error::<T>::NotOracleProvider
            );

            // Validate market exists
            ensure!(
                pallet_prmx_markets::Markets::<T>::contains_key(market_id),
                Error::<T>::MarketNotFound
            );

            let now = Self::current_timestamp();
            let current_hour_index = now / 3600;
            // Accept data up to 25 hours old to account for timing differences between
            // AccuWeather's observation time and chain processing time
            let oldest_acceptable_hour = current_hour_index.saturating_sub(25);
            // But only keep 24 hours for display/calculation purposes
            let oldest_display_hour = current_hour_index.saturating_sub(24);
            
            log::info!(
                target: "prmx-oracle",
                "🌧️ OCW hourly rainfall: {} readings for market {} (hours {} to {})",
                hourly_data.len(),
                market_id,
                oldest_acceptable_hour,
                current_hour_index
            );

            // Store each hourly bucket
            let mut rolling_sum: Millimeters = 0;
            let mut buckets_stored = 0u32;
            
            for (epoch_time, rainfall_mm) in hourly_data.iter() {
                let hour_index = *epoch_time / 3600;
                
                // Skip buckets older than 25 hours (gives 1 hour buffer for timing)
                if hour_index < oldest_acceptable_hour {
                    log::debug!(
                        target: "prmx-oracle",
                        "⏭️ Skipping bucket {} (too old, oldest acceptable: {})",
                        hour_index,
                        oldest_acceptable_hour
                    );
                    continue;
                }
                
                // Sanity check
                if *rainfall_mm > MAX_RAINFALL_MM {
                    continue;
                }
                
                let bucket = HourlyBucket {
                    mm: *rainfall_mm,
                    fetched_at: now,
                    source: 1, // historical/24
                };
                
                HourlyBuckets::<T>::insert(market_id, hour_index, bucket);
                rolling_sum = rolling_sum.saturating_add(*rainfall_mm);
                buckets_stored += 1;
            }

            // Cleanup old buckets (older than 25 hours from current hour)
            // Use 25 hours to match the acceptance window and avoid race conditions
            let mut removed = 0u32;
            for (hour_idx, _) in HourlyBuckets::<T>::iter_prefix(market_id) {
                if hour_idx < oldest_acceptable_hour {
                    HourlyBuckets::<T>::remove(market_id, hour_idx);
                    removed += 1;
                }
            }

            // Recalculate rolling sum from buckets within the 24-hour display window
            let mut actual_rolling_sum: Millimeters = 0;
            let mut bucket_count = 0u32;
            for (hour_idx, bucket) in HourlyBuckets::<T>::iter_prefix(market_id) {
                // Only include buckets within the 24-hour display window for the rolling sum
                if hour_idx >= oldest_display_hour {
                    actual_rolling_sum = actual_rolling_sum.saturating_add(bucket.mm);
                    bucket_count += 1;
                }
            }
            
            log::info!(
                target: "prmx-oracle",
                "📊 Market {} rolling sum: {:.1}mm from {} buckets (stored: {}, removed: {})",
                market_id,
                actual_rolling_sum as f64 / 10.0,
                bucket_count,
                buckets_stored,
                removed
            );

            // Update the legacy RollingState for backwards compatibility
            let bucket_idx = bucket_index_for_timestamp(now);
            let state = RollingWindowState {
                last_bucket_index: bucket_idx,
                oldest_bucket_index: bucket_idx.saturating_sub(24),
                rolling_sum_mm: actual_rolling_sum,
            };
            RollingState::<T>::insert(market_id, state);

            Self::deposit_event(Event::RollingSumUpdated {
                location_id: market_id,
                rolling_sum_mm: actual_rolling_sum,
            });

            log::info!(
                target: "prmx-oracle",
                "✅ Stored {} hourly buckets for market {} (removed {} old), rolling sum = {:.1}mm",
                buckets_stored,
                market_id,
                removed,
                actual_rolling_sum as f64 / 10.0
            );

            // Clear any pending fetch request
            if PendingFetchRequests::<T>::contains_key(market_id) {
                PendingFetchRequests::<T>::remove(market_id);
            }

            Ok(())
        }

        /// Request rainfall fetch for ALL markets at once.
        /// Useful when the node has been offline and missed regular polling.
        /// This queues fetch requests for all registered markets.
        #[pallet::call_index(9)]
        #[pallet::weight(Weight::from_parts(50_000, 0))]
        pub fn request_rainfall_fetch_all(
            origin: OriginFor<T>,
        ) -> DispatchResult {
            T::GovernanceOrigin::ensure_origin(origin)?;

            // Get total number of markets
            let next_market_id = pallet_prmx_markets::NextMarketId::<T>::get();
            
            // Get current block for pending request storage
            let current_block = frame_system::Pallet::<T>::block_number();
            let now: u64 = Self::current_timestamp();
            
            let mut queued_count = 0u32;
            for market_id in 0..next_market_id {
                // Only queue if market exists and doesn't already have pending request
                if pallet_prmx_markets::Markets::<T>::contains_key(market_id) {
                    if !PendingFetchRequests::<T>::contains_key(market_id) {
                        PendingFetchRequests::<T>::insert(market_id, current_block);
                        queued_count += 1;
                        
                        log::info!(
                            target: "prmx-oracle",
                            "📥 Queued rainfall fetch for market {} (batch request)",
                            market_id
                        );
                    }
                }
            }

            log::info!(
                target: "prmx-oracle",
                "📥 Batch rainfall fetch requested: {} markets queued at block {:?}",
                queued_count,
                current_block
            );

            Self::deposit_event(Event::AllMarketsFetchRequested {
                market_count: queued_count,
                requested_at: now,
            });

            Ok(())
        }

        // =====================================================================
        //                       V2 Oracle Extrinsics
        // =====================================================================

        /// Submit a V2 oracle report for a policy.
        /// 
        /// Only authorized V2 reporters can call this.
        /// This forwards the report to the policy pallet for settlement.
        ///
        /// - `policy_id`: The V2 policy to report on.
        /// - `outcome`: Triggered or MaturedNoEvent.
        /// - `observed_at`: Timestamp when the outcome was determined.
        /// - `cumulative_mm`: Cumulative rainfall in tenths of mm.
        /// - `evidence_hash`: SHA256 hash of off-chain evidence JSON.
        #[pallet::call_index(10)]
        #[pallet::weight(Weight::from_parts(100_000, 0))]
        pub fn submit_v2_report(
            origin: OriginFor<T>,
            policy_id: PolicyId,
            outcome: prmx_primitives::V2Outcome,
            observed_at: u64,
            cumulative_mm: u32,
            evidence_hash: [u8; 32],
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;

            // Verify caller is authorized V2 reporter
            ensure!(
                AuthorizedV2Reporters::<T>::get(&who),
                Error::<T>::NotAuthorizedV2Reporter
            );

            // Verify no report already submitted for this policy (idempotency)
            ensure!(
                !V2FinalReportByPolicy::<T>::contains_key(policy_id),
                Error::<T>::V2ReportAlreadySubmitted
            );

            // Get current timestamp
            let now = Self::current_timestamp();

            // Store the report in oracle storage (immutable record)
            let report = prmx_primitives::V2Report {
                outcome: outcome.clone(),
                observed_at,
                cumulative_mm,
                evidence_hash,
                reporter: who.clone(),
                submitted_at: now,
            };
            V2FinalReportByPolicy::<T>::insert(policy_id, report);

            // Forward to policy pallet for actual settlement
            // The policy pallet will validate the report and perform settlement
            T::PolicySettlement::settle_v2_policy(
                policy_id,
                outcome.clone(),
                observed_at,
                cumulative_mm,
                evidence_hash,
            )?;

            // Emit event
            Self::deposit_event(Event::V2ReportAccepted {
                policy_id,
                outcome,
                cumulative_mm,
                evidence_hash,
            });

            log::info!(
                target: "prmx-oracle",
                "✅ V2 report accepted for policy {}: {:?}, cumulative_mm={}",
                policy_id,
                outcome,
                cumulative_mm
            );

            Ok(())
        }

        /// Add an authorized V2 reporter.
        /// Only governance/root can call this.
        #[pallet::call_index(11)]
        #[pallet::weight(Weight::from_parts(10_000, 0))]
        pub fn add_v2_reporter(
            origin: OriginFor<T>,
            account: T::AccountId,
        ) -> DispatchResult {
            T::GovernanceOrigin::ensure_origin(origin)?;

            AuthorizedV2Reporters::<T>::insert(&account, true);

            Self::deposit_event(Event::V2ReporterAdded { account });

            Ok(())
        }

        /// Remove an authorized V2 reporter.
        /// Only governance/root can call this.
        #[pallet::call_index(12)]
        #[pallet::weight(Weight::from_parts(10_000, 0))]
        pub fn remove_v2_reporter(
            origin: OriginFor<T>,
            account: T::AccountId,
        ) -> DispatchResult {
            T::GovernanceOrigin::ensure_origin(origin)?;

            AuthorizedV2Reporters::<T>::remove(&account);

            Self::deposit_event(Event::V2ReporterRemoved { account });

            Ok(())
        }

    }

    // =========================================================================
    //                          Internal Functions
    // =========================================================================

    impl<T: Config> Pallet<T> {
        /// Get current timestamp from PolicySettlement trait (uses pallet_timestamp)
        pub fn current_timestamp() -> u64 {
            // Use the PolicySettlement trait to get the real blockchain timestamp
            T::PolicySettlement::current_time()
        }

        /// Update rolling state after rainfall submission
        /// Per oracle_design.md section 8.3
        fn update_rolling_state(
            location_id: LocationId,
            idx: BucketIndex,
            old_mm: Millimeters,
            new_mm: Millimeters,
            now: u64,
        ) -> DispatchResult {
            let window_start_ts = now.saturating_sub(ROLLING_WINDOW_SECS);

            let mut state = RollingState::<T>::get(location_id).unwrap_or(RollingWindowState {
                last_bucket_index: idx,
                oldest_bucket_index: idx,
                rolling_sum_mm: 0,
            });

            // Adjust sum by delta if bucket is within window
            let bucket_ts = bucket_start_time(idx);
            if bucket_ts >= window_start_ts {
                let delta = new_mm as i64 - old_mm as i64;
                let new_sum = (state.rolling_sum_mm as i64 + delta).max(0) as u32;
                state.rolling_sum_mm = new_sum;
            }

            // If this is a newer bucket, update last_bucket_index and prune old buckets
            if idx > state.last_bucket_index {
                state.last_bucket_index = idx;
                Self::prune_old_buckets(location_id, &mut state, window_start_ts);
            }

            RollingState::<T>::insert(location_id, state.clone());

            Self::deposit_event(Event::RollingSumUpdated {
                location_id,
                rolling_sum_mm: state.rolling_sum_mm,
            });

            Ok(())
        }

        /// Prune old buckets that fall outside the rolling window
        /// Per oracle_design.md section 8.4
        fn prune_old_buckets(
            location_id: LocationId,
            state: &mut RollingWindowState,
            window_start_ts: u64,
        ) {
            let mut candidate_idx = state.oldest_bucket_index;

            while bucket_start_time(candidate_idx) < window_start_ts
                && candidate_idx <= state.last_bucket_index
            {
                if let Some(bucket) = RainBuckets::<T>::get(location_id, candidate_idx) {
                    // Subtract from rolling sum
                    state.rolling_sum_mm = state.rolling_sum_mm.saturating_sub(bucket.rainfall_mm);
                    // Remove bucket
                    RainBuckets::<T>::remove(location_id, candidate_idx);
                }
                candidate_idx = candidate_idx.saturating_add(1);
            }

            state.oldest_bucket_index = candidate_idx;
        }

        /// Calculate 24h rolling sum at a specific timestamp
        /// Per oracle_design.md section 9.2
        pub fn calculate_rolling_sum_at(location_id: LocationId, timestamp: u64) -> Millimeters {
            let window_start = timestamp.saturating_sub(ROLLING_WINDOW_SECS);
            let start_idx = bucket_index_for_timestamp(window_start);
            let end_idx = bucket_index_for_timestamp(timestamp);

            let mut sum: u64 = 0;
            for idx in start_idx..=end_idx {
                if let Some(bucket) = RainBuckets::<T>::get(location_id, idx) {
                    sum = sum.saturating_add(bucket.rainfall_mm as u64);
                }
            }

            // Cap at u32::MAX
            sum.min(u32::MAX as u64) as u32
        }

        /// Check if rainfall exceeded threshold during coverage window
        /// Per oracle_design.md section 9.3
        pub fn check_exceeded_threshold_in_window(
            location_id: LocationId,
            strike_mm: Millimeters,
            coverage_start: u64,
            coverage_end: u64,
        ) -> Result<bool, Error<T>> {
            ensure!(coverage_start < coverage_end, Error::<T>::InvalidCoverageWindow);

            let mut t = coverage_start;
            while t <= coverage_end {
                let sum = Self::calculate_rolling_sum_at(location_id, t);
                if sum >= strike_mm {
                    return Ok(true);
                }
                t = t.saturating_add(BUCKET_INTERVAL_SECS);
            }

            Ok(false)
        }

        /// Check all active policies across all markets and trigger settlements if threshold exceeded
        /// This is called from on_initialize every BLOCKS_PER_SETTLEMENT_CHECK blocks
        pub fn check_and_settle_triggered_policies(block_number: BlockNumberFor<T>) -> Weight {
            use sp_runtime::traits::UniqueSaturatedInto;
            let _block_num: u32 = block_number.unique_saturated_into();
            
            // Get current timestamp from the policy pallet (which has access to pallet_timestamp)
            let current_time = T::PolicySettlement::current_time();
            
            let mut weight = Weight::from_parts(5_000, 0);
            let mut settlements_triggered = 0u32;
            
            // Iterate through all markets
            let next_market_id = pallet_prmx_markets::NextMarketId::<T>::get();
            
            for market_id in 0..next_market_id {
                // Get rolling state for this market
                let rolling_state = match RollingState::<T>::get(market_id) {
                    Some(state) => state,
                    None => continue, // No rainfall data for this market
                };
                
                // Get strike threshold for this market
                let strike_threshold = match T::MarketsApi::strike_value(market_id) {
                    Ok(strike) => strike,
                    Err(_) => continue, // Market not found
                };
                
                let current_rolling_sum = rolling_state.rolling_sum_mm;
                
                // Check if current rainfall exceeds threshold
                if current_rolling_sum >= strike_threshold {
                    log::info!(
                        target: "prmx-oracle",
                        "⚠️ Threshold breach detected! Market {}: {} mm >= {} mm threshold",
                        market_id,
                        current_rolling_sum as f64 / 10.0,
                        strike_threshold as f64 / 10.0
                    );
                    
                    // Get all active policies in their coverage window for this market
                    let active_policies = T::PolicySettlement::get_active_policies_in_window(market_id, current_time);
                    
                    log::info!(
                        target: "prmx-oracle",
                        "🔍 Found {} active policies in coverage window for market {} (current_time={})",
                        active_policies.len(),
                        market_id,
                        current_time
                    );
                    
                    if active_policies.is_empty() {
                        log::warn!(
                            target: "prmx-oracle",
                            "⚠️ No active policies to settle for market {} - check coverage windows",
                            market_id
                        );
                    }
                    
                    let mut policies_settled_count = 0u32;
                    
                    for policy_id in active_policies {
                        // Get policy info for logging
                        if let Some((holder, _max_payout, _coverage_start, _coverage_end, _market_id)) = 
                            T::PolicySettlement::get_policy_info(policy_id) 
                        {
                            // Get market coordinates for logging
                            let (center_lat, center_lon) = T::MarketsApi::center_coordinates(market_id)
                                .unwrap_or((0, 0));
                            
                            // Trigger immediate settlement
                            match T::PolicySettlement::trigger_immediate_settlement(policy_id) {
                                Ok(payout_amount) => {
                                    // Create and store trigger log
                                    let trigger_id = NextTriggerLogId::<T>::get();
                                    NextTriggerLogId::<T>::put(trigger_id + 1);
                                    
                                    let trigger_log = ThresholdTriggerLog {
                                        trigger_id,
                                        market_id,
                                        policy_id,
                                        triggered_at: current_time,
                                        block_number,
                                        rolling_sum_mm: current_rolling_sum,
                                        strike_threshold,
                                        holder: holder.clone(),
                                        payout_amount,
                                        center_latitude: center_lat,
                                        center_longitude: center_lon,
                                    };
                                    
                                    ThresholdTriggerLogs::<T>::insert(trigger_id, trigger_log);
                                    
                                    // Emit event
                                    Self::deposit_event(Event::ThresholdTriggered {
                                        trigger_id,
                                        market_id,
                                        policy_id,
                                        rolling_sum_mm: current_rolling_sum,
                                        strike_threshold,
                                        triggered_at: current_time,
                                        payout_amount,
                                    });
                                    
                                    settlements_triggered += 1;
                                    policies_settled_count += 1;
                                    
                                    log::info!(
                                        target: "prmx-oracle",
                                        "✅ Auto-settled policy {} (trigger_id: {}) - Payout: {} to holder",
                                        policy_id,
                                        trigger_id,
                                        payout_amount
                                    );
                                }
                                Err(e) => {
                                    log::warn!(
                                        target: "prmx-oracle",
                                        "❌ Failed to auto-settle policy {}: {:?}",
                                        policy_id,
                                        e
                                    );
                                }
                            }
                        }
                        
                        // Add weight for each policy processed
                        weight = weight.saturating_add(Weight::from_parts(50_000, 0));
                    }
                    
                    // Reset the rolling state after trigger to continue monitoring for future policies
                    // This ensures the oracle starts fresh after a threshold event
                    if policies_settled_count > 0 {
                        // Reset rolling state to zero
                        let reset_state = RollingWindowState {
                            last_bucket_index: rolling_state.last_bucket_index,
                            oldest_bucket_index: rolling_state.last_bucket_index, // Start fresh
                            rolling_sum_mm: 0, // Reset to zero
                        };
                        RollingState::<T>::insert(market_id, reset_state);
                        
                        // Clear old rain buckets for this market
                        // Keep only the current bucket index as reference point
                        let _ = RainBuckets::<T>::clear_prefix(market_id, u32::MAX, None);
                        
                        log::info!(
                            target: "prmx-oracle",
                            "🔄 Reset rainfall data for market {} after settling {} policies",
                            market_id,
                            policies_settled_count
                        );
                        
                        Self::deposit_event(Event::RollingSumUpdated {
                            location_id: market_id,
                            rolling_sum_mm: 0,
                        });
                    }
                }
                
                // Add weight for each market processed
                weight = weight.saturating_add(Weight::from_parts(10_000, 0));
            }
            
            if settlements_triggered > 0 {
                log::info!(
                    target: "prmx-oracle",
                    "🏁 Settlement check complete: {} policies auto-settled",
                    settlements_triggered
                );
            }
            
            weight
        }
        
        /// Maximum number of expired policies to settle per block
        /// Limits block weight while ensuring backlog is cleared within reasonable time
        const MAX_EXPIRATION_SETTLEMENTS_PER_BLOCK: u32 = 10;
        
        /// Check all expired policies and settle them automatically
        /// This is called from on_initialize every BLOCKS_PER_SETTLEMENT_CHECK blocks
        pub fn check_and_settle_expired_policies(block_number: BlockNumberFor<T>) -> Weight {
            let current_time = T::PolicySettlement::current_time();
            let mut weight = Weight::from_parts(5_000, 0);
            let mut settlements_count = 0u32;
            
            // Get all expired policies (coverage ended, still active)
            let expired_policies = T::PolicySettlement::get_expired_policies(current_time);
            
            if expired_policies.is_empty() {
                return weight;
            }
            
            log::info!(
                target: "prmx-oracle",
                "📋 Found {} expired policies to settle (current_time={})",
                expired_policies.len(),
                current_time
            );
            
            for policy_id in expired_policies {
                if settlements_count >= Self::MAX_EXPIRATION_SETTLEMENTS_PER_BLOCK {
                    log::info!(
                        target: "prmx-oracle",
                        "⏸️ Reached max settlements per block ({}), deferring remaining to next block",
                        Self::MAX_EXPIRATION_SETTLEMENTS_PER_BLOCK
                    );
                    break; // Defer remaining to next block
                }
                
                // Get policy info to determine event outcome
                if let Some((_holder, _max_payout, coverage_start, coverage_end, market_id)) = 
                    T::PolicySettlement::get_policy_info(policy_id) 
                {
                    // Get strike threshold for this market
                    let strike_mm = match T::MarketsApi::strike_value(market_id) {
                        Ok(strike) => strike,
                        Err(_) => {
                            log::warn!(
                                target: "prmx-oracle",
                                "❌ Could not get strike value for market {}, skipping policy {}",
                                market_id,
                                policy_id
                            );
                            continue;
                        }
                    };
                    
                    // Check if event occurred during coverage window using oracle data
                    let event_occurred = Self::check_exceeded_threshold_in_window(
                        market_id,
                        strike_mm,
                        coverage_start,
                        coverage_end,
                    ).unwrap_or(false);
                    
                    log::info!(
                        target: "prmx-oracle",
                        "🔍 Policy {} expired: coverage [{}, {}], strike {} mm, event_occurred: {}",
                        policy_id,
                        coverage_start,
                        coverage_end,
                        strike_mm as f64 / 10.0,
                        event_occurred
                    );
                    
                    // Settle the policy
                    match T::PolicySettlement::settle_expired_policy(policy_id, event_occurred) {
                        Ok(payout) => {
                            log::info!(
                                target: "prmx-oracle",
                                "✅ Auto-settled expired policy {} (event: {}, payout: {})",
                                policy_id,
                                event_occurred,
                                payout
                            );
                            
                            Self::deposit_event(Event::PolicyExpirationSettled {
                                policy_id,
                                event_occurred,
                                payout_amount: payout,
                            });
                            
                            settlements_count += 1;
                        }
                        Err(e) => {
                            log::warn!(
                                target: "prmx-oracle",
                                "❌ Failed to auto-settle expired policy {}: {:?}",
                                policy_id,
                                e
                            );
                        }
                    }
                }
                
                // Add weight for each policy processed
                weight = weight.saturating_add(Weight::from_parts(100_000, 0));
            }
            
            if settlements_count > 0 {
                log::info!(
                    target: "prmx-oracle",
                    "🏁 Expiration settlement complete: {} policies auto-settled",
                    settlements_count
                );
            }
            
            weight
        }
    }

    // =========================================================================
    //                          Offchain Worker
    // =========================================================================

    /// Offchain storage key for AccuWeather API key
    pub const ACCUWEATHER_API_KEY_STORAGE: &[u8] = b"prmx-oracle::accuweather-api-key";

    /// Offchain storage key prefix for tracking in-flight pending fetch submissions
    /// This prevents duplicate submissions while waiting for on-chain transaction to be processed
    pub const PENDING_FETCH_INFLIGHT_PREFIX: &[u8] = b"prmx-oracle::pending-fetch-inflight::";

    /// AccuWeather API base URL
    pub const ACCUWEATHER_BASE_URL: &str = "https://dataservice.accuweather.com";

    #[pallet::hooks]
    impl<T: Config> Hooks<BlockNumberFor<T>> for Pallet<T> {
        /// On initialize hook:
        /// 1. Clear API key configured flag after offchain worker has had time to fetch
        /// 2. Check for threshold breaches and trigger automatic settlements (every BLOCKS_PER_SETTLEMENT_CHECK blocks)
        /// 3. Check for expired policies and settle them automatically (every BLOCKS_PER_SETTLEMENT_CHECK blocks)
        fn on_initialize(block_number: BlockNumberFor<T>) -> Weight {
            use sp_runtime::traits::UniqueSaturatedInto;
            let block_num: u32 = block_number.unique_saturated_into();
            
            let mut weight = Weight::zero();
            
            // =========================================================================
            // Clear API key configured flag after a few blocks (offchain worker should have run)
            // =========================================================================
            if let Some(configured_at) = ApiKeyConfiguredAt::<T>::get() {
                // Clear the flag and pending key after 3 blocks (OCW should have copied it)
                if block_number > configured_at + 3u32.into() {
                    ApiKeyConfiguredAt::<T>::kill();
                    PendingApiKey::<T>::kill(); // Clear the temporary on-chain key
                    weight = weight.saturating_add(Weight::from_parts(10_000, 0));
                }
            }
            
            // =========================================================================
            // Automatic settlement check (every BLOCKS_PER_SETTLEMENT_CHECK blocks)
            // =========================================================================
            let should_check_settlements = block_num % BLOCKS_PER_SETTLEMENT_CHECK == 0;
            
            if should_check_settlements {
                // Check for threshold breaches during active coverage
                let settlements_weight = Self::check_and_settle_triggered_policies(block_number);
                weight = weight.saturating_add(settlements_weight);
                
                // Check for expired policies that need settlement
                let expiration_weight = Self::check_and_settle_expired_policies(block_number);
                weight = weight.saturating_add(expiration_weight);
            }

            weight
        }

        /// Offchain worker entry point
        /// Per oracle_design.md section 7.2
        fn offchain_worker(block_number: BlockNumberFor<T>) {
            // Convert block number to u32 for modulo check
            use sp_runtime::traits::UniqueSaturatedInto;
            let block_num: u32 = block_number.unique_saturated_into();

            // =========================================================================
            // Priority 1: Process pending manual fetch requests (every block)
            // =========================================================================
            let has_pending_requests = Self::process_pending_fetch_requests(block_number);

            // Check if API key was just configured and immediate fetch is needed
            let api_key_just_configured = ApiKeyConfiguredAt::<T>::get().is_some();
            
            // Determine what operations to run based on block number
            // - Rainfall ingestion: once per hour (every 600 blocks), or first 10 blocks for quick startup
            // - Location binding: every ~10 minutes (every 100 blocks) for new markets
            // - Immediate fetch: when API key is newly configured
            let is_startup_window = block_num < 10; // Run more frequently during startup
            let should_fetch_rainfall = is_startup_window || block_num % BLOCKS_PER_HOUR == 0 || api_key_just_configured;
            let should_check_bindings = is_startup_window || block_num % BLOCKS_PER_BINDING_CHECK == 0 || api_key_just_configured;

            // Early return if nothing to do this block (and no pending requests processed)
            if !should_fetch_rainfall && !should_check_bindings && !has_pending_requests {
                return;
            }
            
            // Log if this is an immediate fetch triggered by API key configuration
            if api_key_just_configured {
                log::info!(
                    target: "prmx-oracle",
                    "🚀 API key configured - triggering immediate rainfall fetch for all markets"
                );
            }

            // Log occasionally to show worker is alive
            if should_check_bindings || is_startup_window || has_pending_requests {
            log::info!(
                target: "prmx-oracle",
                    "Offchain worker at block {} (startup: {}, rainfall: {}, bindings: {}, pending: {})",
                    block_num,
                    is_startup_window,
                    should_fetch_rainfall,
                    should_check_bindings,
                    has_pending_requests
            );
            }

            // Try to get API key from offchain local storage
            let api_key = Self::get_accuweather_api_key();

            match api_key {
                Some(key) => {
                    let key_preview = core::str::from_utf8(&key[..10.min(key.len())])
                        .unwrap_or("invalid");
                    log::debug!(
                        target: "prmx-oracle",
                        "AccuWeather API key configured ({}...)",
                        key_preview
                    );

                    // Process markets: resolve bindings AND fetch rainfall
                    // This combined approach handles both binding resolution and rainfall fetching
                    // in the same offchain worker invocation to avoid storage persistence issues
                    if should_check_bindings || should_fetch_rainfall {
                        if let Err(e) = Self::process_markets_and_fetch_rainfall(&key, block_number, should_fetch_rainfall) {
                            log::warn!(
                                target: "prmx-oracle",
                                "Error processing markets: {:?}",
                                e
                            );
                        }
                    }
                }
                None => {
                    log::warn!(
                        target: "prmx-oracle",
                        "AccuWeather API key not configured. Set it via offchain storage or environment variable ACCUWEATHER_API_KEY"
                    );
                }
            }
        }
    }

    // NOTE: API keys should be configured via environment variable ACCUWEATHER_API_KEY
    // or set at runtime using the set_accuweather_api_key extrinsic.
    // See .env.example for configuration template.

    impl<T: Config> Pallet<T> {
        /// Get AccuWeather API key from offchain local storage.
        /// 
        /// The key can be injected via:
        /// 1. CLI: `prmx-node inject-api-key --key "prmx-oracle::accuweather-api-key" --value "YOUR_KEY"`
        /// 2. Extrinsic: `prmxOracle.setAccuweatherApiKey`
        /// 
        /// Based on the offchain-utils pattern from polkadot-confidential-offchain-worker.
        fn get_accuweather_api_key() -> Option<Vec<u8>> {
            // Try to read from local storage (PERSISTENT kind)
            let storage = sp_io::offchain::local_storage_get(
                sp_core::offchain::StorageKind::PERSISTENT,
                ACCUWEATHER_API_KEY_STORAGE,
            );

            if let Some(ref key) = storage {
                if !key.is_empty() {
                    log::info!(
                        target: "prmx-oracle",
                        "✅ Using AccuWeather API key from offchain storage (length: {} bytes)",
                        key.len()
                    );
                    return storage;
                }
            }
            
            // Check if there's a pending API key from on-chain storage
            // This is set by the set_accuweather_api_key extrinsic
            if let Some(pending_key) = PendingApiKey::<T>::get() {
                if !pending_key.is_empty() {
                    let key_vec: Vec<u8> = pending_key.into();
                    
                    // Copy to local storage for persistence
                    sp_io::offchain::local_storage_set(
                        sp_core::offchain::StorageKind::PERSISTENT,
                        ACCUWEATHER_API_KEY_STORAGE,
                        &key_vec,
                    );
                    
                    log::info!(
                        target: "prmx-oracle",
                        "✅ Copied AccuWeather API key from on-chain to local storage (length: {} bytes)",
                        key_vec.len()
                    );
                    
                    // Note: We can't clear PendingApiKey here because we're in offchain context
                    // It will be cleared in on_initialize after a few blocks
                    
                    return Some(key_vec);
                }
            }
            
            log::warn!(
                target: "prmx-oracle",
                "⚠️ AccuWeather API key not configured. Inject via CLI or extrinsic."
            );
            None
        }

        /// Process pending manual fetch requests
        /// Returns true if any requests were processed
        fn process_pending_fetch_requests(_block_number: BlockNumberFor<T>) -> bool {
            // Check for pending fetch requests
            let pending_markets: Vec<_> = PendingFetchRequests::<T>::iter()
                .map(|(market_id, _)| market_id)
                .collect();

            if pending_markets.is_empty() {
                return false;
            }

            log::info!(
                target: "prmx-oracle",
                "📥 Found {} pending fetch request(s) to process",
                pending_markets.len()
            );

            // Get API key
            let api_key = match Self::get_accuweather_api_key() {
                Some(key) => key,
                None => {
                    log::warn!(
                        target: "prmx-oracle",
                        "Cannot process pending fetch requests: AccuWeather API key not configured"
                    );
                    return false;
                }
            };

            let mut processed_any = false;

            for market_id in pending_markets {
                // Skip if we've already submitted a transaction for this market that's still in-flight
                // This prevents duplicate submissions while waiting for on-chain processing
                if Self::is_pending_fetch_inflight(market_id) {
                    log::info!(
                        target: "prmx-oracle",
                        "⏳ Skipping market {} - submission already in-flight",
                        market_id
                    );
                    continue;
                }

                log::info!(
                    target: "prmx-oracle",
                    "🌧️ Processing manual fetch request for market {}",
                    market_id
                );

                // First, try to get location key from offchain cache
                let location_key: Vec<u8> = match Self::get_location_key_from_offchain_index(market_id) {
                    Some(key) => {
                        log::info!(
                            target: "prmx-oracle",
                            "📖 Found cached location key for market {}",
                            market_id
                        );
                        key
                    }
                    None => {
                        // No cached key - need to resolve from AccuWeather
                        // Get market coordinates from MarketsApi
                        let (lat, lon) = match T::MarketsApi::center_coordinates(market_id) {
                            Ok(coords) => coords,
                            Err(_) => {
                                log::warn!(
                                    target: "prmx-oracle",
                                    "Market {} not found in markets pallet, skipping",
                                    market_id
                                );
                                continue;
                            }
                        };

                        let lat_f = lat as f64 / 1_000_000.0;
                        let lon_f = lon as f64 / 1_000_000.0;

                        log::info!(
                            target: "prmx-oracle",
                            "🔍 Resolving AccuWeather location key for new market {} (lat: {}, lon: {})",
                            market_id,
                            lat_f,
                            lon_f
                        );

                        match Self::fetch_accuweather_location_key(&api_key, lat_f, lon_f) {
                            Ok(key) => {
                                let key_str = core::str::from_utf8(&key).unwrap_or("invalid");
                                log::info!(
                                    target: "prmx-oracle",
                                    "✅ Resolved AccuWeather location key for new market {}: {}",
                                    market_id,
                                    key_str
                                );

                                // Store in offchain cache for future use
                                let storage_key = Self::location_binding_key(market_id);
                                sp_io::offchain::local_storage_set(
                                    sp_core::offchain::StorageKind::PERSISTENT,
                                    &storage_key,
                                    &key,
                                );

                                // Also submit on-chain binding via signed transaction
                                if let Err(e) = Self::submit_location_binding_tx(market_id, key.clone()) {
                                    log::warn!(
                                        target: "prmx-oracle",
                                        "Failed to submit on-chain location binding for market {}: {:?}",
                                        market_id,
                                        e
                                    );
                                }

                                key
                            }
                            Err(e) => {
                                log::warn!(
                                    target: "prmx-oracle",
                                    "❌ Failed to resolve location key for new market {}: {}",
                                    market_id,
                                    e
                                );
                                continue;
                            }
                        }
                    }
                };

                let location_key_str = match core::str::from_utf8(&location_key) {
                    Ok(key) => key,
                    Err(_) => {
                        log::warn!(
                            target: "prmx-oracle",
                            "Invalid location key encoding for market {}",
                            market_id
                        );
                        continue;
                    }
                };

                // Fetch rainfall data from AccuWeather
                match Self::fetch_accuweather_rainfall(&api_key, location_key_str) {
                    Ok(rainfall_data) => {
                        log::info!(
                            target: "prmx-oracle",
                            "✅ Fetched {} rainfall records for market {} from AccuWeather",
                            rainfall_data.len(),
                            market_id
                        );

                        if !rainfall_data.is_empty() {
                            // Store the fetched data in offchain index
                            Self::store_fetched_rainfall_data(market_id, rainfall_data.clone());
                            
                            // Get the 24h rainfall sum and submit on-chain
                            // AccuWeather Past24Hours gives us the 24h sum in the first entry
                            if let Some((_, rainfall_mm)) = rainfall_data.first() {
                                log::info!(
                                    target: "prmx-oracle",
                                    "🌧️ AccuWeather 24h rainfall for market {}: {:.1} mm - submitting on-chain",
                                    market_id,
                                    *rainfall_mm as f64 / 10.0
                                );
                                
                                // Submit rainfall on-chain via signed transaction
                                if let Err(e) = Self::submit_rainfall_signed_tx(market_id, *rainfall_mm) {
                                    log::warn!(
                                        target: "prmx-oracle",
                                        "Failed to submit on-chain rainfall for market {}: {:?}",
                                        market_id,
                                        e
                                    );
                                } else {
                                    // Mark as in-flight to prevent duplicate submissions
                                    // The in-flight marker will be cleared when:
                                    // 1. The on-chain transaction is processed (clears PendingFetchRequests)
                                    // 2. The marker expires after 3 minutes (staleness check)
                                    Self::mark_pending_fetch_inflight(market_id);
                                    
                                    log::info!(
                                        target: "prmx-oracle",
                                        "✅ Submitted on-chain rainfall update for market {}: {:.1} mm (marked in-flight)",
                                        market_id,
                                        *rainfall_mm as f64 / 10.0
                                    );
                                }
                            }
                            
                            processed_any = true;
                        }
                    }
                    Err(e) => {
                        log::warn!(
                            target: "prmx-oracle",
                            "Failed to fetch rainfall for market {}: {}",
                            market_id,
                            e
                        );
                    }
                }
            }

            processed_any
        }

        /// Store fetched rainfall data in offchain indexed storage for logging/reference
        fn store_fetched_rainfall_data(
            market_id: MarketId,
            rainfall_data: Vec<(u64, Millimeters)>,
        ) {
            // Store data in offchain index for reference
            let key = Self::pending_rainfall_data_key(market_id);
            let encoded_data = rainfall_data.encode();
            sp_io::offchain_index::set(&key, &encoded_data);
            
            log::info!(
                target: "prmx-oracle",
                "📝 Stored {} rainfall records in offchain index for market {}",
                rainfall_data.len(),
                market_id
            );
        }

        /// Generate offchain index key for pending rainfall data
        fn pending_rainfall_data_key(market_id: MarketId) -> Vec<u8> {
            let mut key = b"prmx-oracle::pending-rainfall::".to_vec();
            key.extend_from_slice(&market_id.to_le_bytes());
            key
        }

        /// Combined function: resolve location bindings AND fetch rainfall data
        /// This handles both in a single pass to avoid storage persistence issues with --tmp
        fn process_markets_and_fetch_rainfall(
            api_key: &[u8],
            _block_number: BlockNumberFor<T>,
            should_fetch_rainfall: bool,
        ) -> Result<(), &'static str> {
            use pallet_prmx_markets::Markets;

            let mut processed = 0u32;
            const MAX_MARKETS_PER_BLOCK: u32 = 3;

            let next_id = pallet_prmx_markets::NextMarketId::<T>::get();
            
            log::info!(
                target: "prmx-oracle",
                "🔄 Processing {} markets (fetch_rainfall: {})",
                next_id,
                should_fetch_rainfall
            );

            for market_id in 0..next_id {
                if processed >= MAX_MARKETS_PER_BLOCK {
                    break;
                }

                // Get market info
                let market = match Markets::<T>::get(market_id) {
                    Some(m) => m,
                    None => continue,
                };

                // Get center coordinates
                let lat = market.center_latitude as f64 / 1_000_000.0;
                let lon = market.center_longitude as f64 / 1_000_000.0;

                // First, try to get location key from offchain local storage
                let location_key = Self::get_location_key_from_offchain_index(market_id);
                
                let location_key: Vec<u8> = match location_key {
                    Some(key) => {
                        log::info!(
                            target: "prmx-oracle",
                            "📖 Found cached location key for market {}",
                            market_id
                        );
                        key
                    }
                    None => {
                        // Need to resolve location key from AccuWeather
                        log::info!(
                            target: "prmx-oracle",
                            "🔍 Resolving AccuWeather location key for market {} (lat: {}, lon: {})",
                            market_id,
                            lat,
                            lon
                        );
                        
                        match Self::fetch_accuweather_location_key(api_key, lat, lon) {
                            Ok(key) => {
                                let key_str = core::str::from_utf8(&key).unwrap_or("invalid");
                                log::info!(
                                    target: "prmx-oracle",
                                    "✅ Resolved AccuWeather location key for market {}: {}",
                                    market_id,
                                    key_str
                                );

                                // Store for future use
                                let storage_key = Self::location_binding_key(market_id);
                                sp_io::offchain::local_storage_set(
                                    sp_core::offchain::StorageKind::PERSISTENT,
                                    &storage_key,
                                    &key,
                                );
                                
                                key
                            }
                            Err(e) => {
                                log::warn!(
                                    target: "prmx-oracle",
                                    "❌ Failed to resolve location key for market {}: {}",
                                    market_id,
                                    e
                                );
                                continue;
                            }
                        }
                    }
                };

                // Now fetch rainfall if enabled
                if should_fetch_rainfall {
                    let key_str = core::str::from_utf8(&location_key).unwrap_or("invalid");
                    log::info!(
                        target: "prmx-oracle",
                        "🌧️ Fetching 24h rainfall for market {} from AccuWeather (location: {})",
                        market_id,
                        key_str
                    );

                    if let Err(e) = Self::fetch_and_store_rainfall(api_key, key_str, market_id) {
                        log::warn!(
                            target: "prmx-oracle",
                            "❌ Failed to fetch rainfall for market {}: {}",
                            market_id,
                            e
                        );
                    }
                }

                processed += 1;
            }

            log::info!(
                target: "prmx-oracle",
                "🔄 Completed processing {} markets",
                processed
            );

            Ok(())
        }

        /// Get location key from offchain indexed storage
        fn get_location_key_from_offchain_index(market_id: MarketId) -> Option<Vec<u8>> {
            let key = Self::location_binding_key(market_id);
            
            // Read from offchain local storage (where offchain_index::set stores data)
            let value = sp_io::offchain::local_storage_get(
                sp_core::offchain::StorageKind::PERSISTENT,
                &key,
            );
            
            log::info!(
                target: "prmx-oracle",
                "📖 Reading offchain index for market {}: found = {}",
                market_id,
                value.is_some()
            );
            
            match value {
                Some(data) if !data.is_empty() => {
                    let key_str = core::str::from_utf8(&data).unwrap_or("invalid");
                    log::info!(
                        target: "prmx-oracle",
                        "📖 Found offchain location key for market {}: {}",
                        market_id,
                        key_str
                    );
                    Some(data)
                }
                _ => None,
            }
        }

        /// Fetch rainfall data and submit signed transaction to update on-chain storage
        /// Now uses historical/24 endpoint and stores individual hourly buckets
        fn fetch_and_store_rainfall(
            api_key: &[u8],
            location_key: &str,
            market_id: MarketId,
        ) -> Result<(), &'static str> {
            match Self::fetch_accuweather_rainfall(api_key, location_key) {
                Ok(rainfall_data) => {
                    log::info!(
                        target: "prmx-oracle",
                        "📊 Fetched {} hourly rainfall records for market {}",
                        rainfall_data.len(),
                        market_id
                    );

                    if !rainfall_data.is_empty() {
                        // Calculate total for logging
                        let total_mm: Millimeters = rainfall_data.iter().map(|(_, mm)| *mm).sum();
                        log::info!(
                            target: "prmx-oracle",
                            "🌧️ Submitting {} hourly readings for market {} (total: {:.1} mm)",
                            rainfall_data.len(),
                            market_id,
                            total_mm as f64 / 10.0
                        );

                        // Submit hourly data via signed transaction
                        let result = Self::submit_hourly_rainfall_signed_tx(market_id, rainfall_data.clone());
                        
                        match result {
                            Ok(()) => {
                                log::info!(
                                    target: "prmx-oracle",
                                    "✅ Hourly rainfall submitted for market {} ({} readings)",
                                    market_id,
                                    rainfall_data.len()
                                );
                            }
                            Err(e) => {
                                log::warn!(
                                    target: "prmx-oracle",
                                    "❌ Failed to submit hourly rainfall for market {}: {}",
                                    market_id,
                                    e
                                );
                                // Fallback: try legacy single-value submission with total
                                if let Some((timestamp, _)) = rainfall_data.first() {
                                    let key = Self::rainfall_data_key(market_id, *timestamp);
                                    let value = total_mm.to_le_bytes();
                                    sp_io::offchain_index::set(&key, &value);
                                }
                            }
                        }
                    } else {
                        log::debug!(
                            target: "prmx-oracle",
                            "No rainfall data returned for market {}",
                            market_id
                        );
                    }
                }
                Err(e) => {
                    log::warn!(
                        target: "prmx-oracle",
                        "Failed to fetch rainfall for market {}: {}",
                        market_id,
                        e
                    );
                }
            }

            Ok(())
        }

        /// Submit a signed transaction to update on-chain rainfall data
        fn submit_rainfall_signed_tx(
            market_id: MarketId,
            rainfall_mm: Millimeters,
        ) -> Result<(), &'static str> {
            use frame_system::offchain::{Signer, SendSignedTransaction};

            // Get signer from keystore
            let signer = Signer::<T, T::AuthorityId>::all_accounts();
            
            if !signer.can_sign() {
                log::warn!(
                    target: "prmx-oracle",
                    "⚠️ No oracle authority keys found in keystore. Cannot submit signed tx."
                );
                return Err("No oracle authority keys in keystore");
            }

            // Create the call
            let call = Call::<T>::submit_rainfall_from_ocw {
                market_id,
                rainfall_mm,
            };

            // Send signed transaction
            let results = signer.send_signed_transaction(|_account| call.clone());

            for (acc, result) in &results {
                match result {
                    Ok(()) => {
                        log::info!(
                            target: "prmx-oracle",
                            "✅ Signed tx sent from account {:?}",
                            acc.id
                        );
                        return Ok(());
                    }
                    Err(e) => {
                        log::warn!(
                            target: "prmx-oracle",
                            "❌ Signed tx from account {:?} failed: {:?}",
                            acc.id,
                            e
                        );
                    }
                }
            }

            Err("All signed transactions failed")
        }

        /// Submit hourly rainfall data via signed transaction
        /// Uses the new submit_hourly_rainfall_from_ocw extrinsic
        fn submit_hourly_rainfall_signed_tx(
            market_id: MarketId,
            hourly_data: Vec<(u64, Millimeters)>,
        ) -> Result<(), &'static str> {
            use frame_system::offchain::{Signer, SendSignedTransaction};

            // Get signer from keystore
            let signer = Signer::<T, T::AuthorityId>::all_accounts();
            
            if !signer.can_sign() {
                log::warn!(
                    target: "prmx-oracle",
                    "⚠️ No oracle authority keys found in keystore. Cannot submit hourly rainfall tx."
                );
                return Err("No oracle authority keys in keystore");
            }

            // Convert to BoundedVec (max 24 entries)
            let bounded_data: BoundedVec<(u64, Millimeters), ConstU32<24>> = 
                hourly_data.into_iter().take(24).collect::<Vec<_>>().try_into()
                    .map_err(|_| "Failed to create bounded vec")?;

            // Create the call
            let call = Call::<T>::submit_hourly_rainfall_from_ocw {
                market_id,
                hourly_data: bounded_data,
            };

            // Send signed transaction
            let results = signer.send_signed_transaction(|_account| call.clone());

            for (acc, result) in &results {
                match result {
                    Ok(()) => {
                        log::info!(
                            target: "prmx-oracle",
                            "✅ Hourly rainfall tx sent from account {:?}",
                            acc.id
                        );
                        return Ok(());
                    }
                    Err(e) => {
                        log::warn!(
                            target: "prmx-oracle",
                            "❌ Hourly rainfall tx from account {:?} failed: {:?}",
                            acc.id,
                            e
                        );
                    }
                }
            }

            Err("All signed transactions failed for hourly rainfall")
        }

        /// Submit a signed transaction to bind market location on-chain
        /// This ensures the MarketLocationConfig storage is populated
        fn submit_location_binding_tx(
            market_id: MarketId,
            location_key: Vec<u8>,
        ) -> Result<(), &'static str> {
            use frame_system::offchain::{Signer, SendSignedTransaction};

            // Get signer from keystore
            let signer = Signer::<T, T::AuthorityId>::all_accounts();
            
            if !signer.can_sign() {
                log::warn!(
                    target: "prmx-oracle",
                    "⚠️ No oracle authority keys found in keystore. Cannot submit location binding tx."
                );
                return Err("No oracle authority keys in keystore");
            }

            // Create the call to set_market_location_key
            let call = Call::<T>::set_market_location_key {
                market_id,
                accuweather_location_key: location_key.clone(),
            };

            // Send signed transaction
            let results = signer.send_signed_transaction(|_account| call.clone());

            for (acc, result) in &results {
                match result {
                    Ok(()) => {
                        let key_str = core::str::from_utf8(&location_key).unwrap_or("invalid");
                        log::info!(
                            target: "prmx-oracle",
                            "✅ Location binding tx sent for market {} with key {} from account {:?}",
                            market_id,
                            key_str,
                            acc.id
                        );
                        return Ok(());
                    }
                    Err(e) => {
                        log::warn!(
                            target: "prmx-oracle",
                            "❌ Location binding tx from account {:?} failed: {:?}",
                            acc.id,
                            e
                        );
                    }
                }
            }

            Err("All signed transactions failed for location binding")
        }

        /// Generate offchain index key for location binding
        fn location_binding_key(market_id: MarketId) -> Vec<u8> {
            let mut key = b"prmx-oracle::location::".to_vec();
            key.extend_from_slice(&market_id.to_le_bytes());
            key
        }

        /// Generate offchain index key for rainfall data
        fn rainfall_data_key(market_id: MarketId, timestamp: u64) -> Vec<u8> {
            let mut key = b"prmx-oracle::rainfall::".to_vec();
            key.extend_from_slice(&market_id.to_le_bytes());
            key.extend_from_slice(b"::");
            key.extend_from_slice(&timestamp.to_le_bytes());
            key
        }

        /// Generate offchain storage key for tracking in-flight pending fetch requests
        fn pending_fetch_inflight_key(market_id: MarketId) -> Vec<u8> {
            let mut key = PENDING_FETCH_INFLIGHT_PREFIX.to_vec();
            key.extend_from_slice(&market_id.to_le_bytes());
            key
        }

        /// Check if a pending fetch request submission is already in-flight for this market
        /// Returns true if we've already submitted a transaction that hasn't been processed yet
        fn is_pending_fetch_inflight(market_id: MarketId) -> bool {
            let key = Self::pending_fetch_inflight_key(market_id);
            let value = sp_io::offchain::local_storage_get(
                sp_core::offchain::StorageKind::PERSISTENT,
                &key,
            );
            
            if let Some(timestamp_bytes) = value {
                // Check if the in-flight marker is stale (older than 30 blocks worth of time)
                // Each block is ~6 seconds, so 30 blocks = ~180 seconds = 3 minutes
                // This prevents permanent blocking if a transaction fails
                // NOTE: current_timestamp() returns SECONDS (not milliseconds)
                const MAX_INFLIGHT_AGE_SECS: u64 = 180; // 3 minutes in seconds
                
                if timestamp_bytes.len() >= 8 {
                    let mut bytes = [0u8; 8];
                    bytes.copy_from_slice(&timestamp_bytes[..8]);
                    let submitted_at = u64::from_le_bytes(bytes);
                    let now = Self::current_timestamp();
                    
                    if now.saturating_sub(submitted_at) < MAX_INFLIGHT_AGE_SECS {
                        return true;
                    }
                    // Marker is stale, clear it
                    sp_io::offchain::local_storage_set(
                        sp_core::offchain::StorageKind::PERSISTENT,
                        &key,
                        &[],
                    );
                }
            }
            false
        }

        /// Mark a pending fetch request as in-flight (transaction submitted, waiting for processing)
        fn mark_pending_fetch_inflight(market_id: MarketId) {
            let key = Self::pending_fetch_inflight_key(market_id);
            let timestamp = Self::current_timestamp();
            sp_io::offchain::local_storage_set(
                sp_core::offchain::StorageKind::PERSISTENT,
                &key,
                &timestamp.to_le_bytes(),
            );
        }

        /// Clear the in-flight marker for a pending fetch request
        /// Called when the on-chain transaction has been confirmed or we know it failed
        #[allow(dead_code)]
        fn clear_pending_fetch_inflight(market_id: MarketId) {
            let key = Self::pending_fetch_inflight_key(market_id);
            sp_io::offchain::local_storage_set(
                sp_core::offchain::StorageKind::PERSISTENT,
                &key,
                &[],
            );
        }

        /// Fetch AccuWeather Location Key via Geoposition Search
        /// Per oracle_design.md section 4.1
        fn fetch_accuweather_location_key(
            api_key: &[u8],
            lat: f64,
            lon: f64,
        ) -> Result<Vec<u8>, &'static str> {
            use sp_runtime::offchain::http;

            let api_key_str =
                core::str::from_utf8(api_key).map_err(|_| "Invalid API key encoding")?;

            // Build URL: /locations/v1/cities/geoposition/search?apikey=XXX&q=lat,lon
            let url = alloc::format!(
                "{}/locations/v1/cities/geoposition/search?apikey={}&q={},{}",
                ACCUWEATHER_BASE_URL,
                api_key_str,
                lat,
                lon
            );

            log::debug!(
                target: "prmx-oracle",
                "Fetching location from AccuWeather: {:.4},{:.4}",
                lat,
                lon
            );

            // Make HTTP request
            let request = http::Request::get(&url);
            let timeout = sp_io::offchain::timestamp()
                .add(sp_runtime::offchain::Duration::from_millis(10_000));

            let pending = request
                .deadline(timeout)
                .send()
                .map_err(|_| "Failed to send HTTP request")?;

            let response = pending
                .try_wait(timeout)
                .map_err(|_| "HTTP request timeout")?
                .map_err(|_| "HTTP request failed")?;

            if response.code != 200 {
                log::warn!(
                    target: "prmx-oracle",
                    "AccuWeather API returned status {}",
                    response.code
                );
                return Err("AccuWeather API error");
            }

            let body = response.body().collect::<Vec<u8>>();

            // Parse JSON to extract "Key" field
            // Simple JSON parsing without serde (look for "Key":"...")
            Self::extract_json_key(&body)
        }

        /// Fetch AccuWeather 24 hours historical current conditions with rainfall data
        /// Uses the /historical/24 endpoint (available on all tiers including Free Trial)
        /// which returns 24 hourly observations with PrecipitationSummary.PastHour for each
        fn fetch_accuweather_rainfall(
            api_key: &[u8],
            location_key: &str,
        ) -> Result<Vec<(u64, Millimeters)>, &'static str> {
            use sp_runtime::offchain::http;

            let api_key_str =
                core::str::from_utf8(api_key).map_err(|_| "Invalid API key encoding")?;

            // Build URL: /currentconditions/v1/{locationKey}/historical/24?apikey=XXX&details=true
            // Returns 24 hourly observations with individual PastHour precipitation for each
            let url = alloc::format!(
                "{}/currentconditions/v1/{}/historical/24?apikey={}&details=true",
                ACCUWEATHER_BASE_URL,
                location_key,
                api_key_str
            );

            log::info!(
                target: "prmx-oracle",
                "🌐 Fetching 24h historical rainfall from AccuWeather for location {}",
                location_key
            );

            // Make HTTP request
            let request = http::Request::get(&url);
            let timeout = sp_io::offchain::timestamp()
                .add(sp_runtime::offchain::Duration::from_millis(30_000)); // Longer timeout for historical data

            let pending = request
                .deadline(timeout)
                .send()
                .map_err(|_| "Failed to send HTTP request")?;

            let response = pending
                .try_wait(timeout)
                .map_err(|_| "HTTP request timeout")?
                .map_err(|_| "HTTP request failed")?;

            if response.code != 200 {
                log::warn!(
                    target: "prmx-oracle",
                    "AccuWeather API returned status {}",
                    response.code
                );
                return Err("AccuWeather API error");
            }

            let body = response.body().collect::<Vec<u8>>();

            // Parse JSON to extract 24 hourly rainfall records from historical/24 response
            Self::extract_hourly_rainfall_data(&body)
        }

        /// Extract "Key" value from AccuWeather JSON response
        fn extract_json_key(json: &[u8]) -> Result<Vec<u8>, &'static str> {
            let json_str = core::str::from_utf8(json).map_err(|_| "Invalid JSON encoding")?;

            // Look for "Key":"value" pattern
            if let Some(key_start) = json_str.find("\"Key\":\"") {
                let value_start = key_start + 7;
                if let Some(value_end) = json_str[value_start..].find('"') {
                    let key = &json_str[value_start..value_start + value_end];
                    return Ok(key.as_bytes().to_vec());
                }
            }

            Err("Could not find Key in JSON response")
        }

        /// Extract rainfall data from AccuWeather current conditions response (legacy)
        /// The response contains PrecipitationSummary.Past24Hours with total 24h rainfall
        #[allow(dead_code)]
        fn extract_rainfall_data(json: &[u8]) -> Result<Vec<(u64, Millimeters)>, &'static str> {
            let json_str = core::str::from_utf8(json).map_err(|_| "Invalid JSON encoding")?;

            let mut results = Vec::new();

            // Extract EpochTime (observation time)
            let epoch = if let Some(epoch_start) = json_str.find("\"EpochTime\":") {
                let epoch_pos = epoch_start + 12;
                let epoch_end = json_str[epoch_pos..]
                    .find(|c: char| !c.is_ascii_digit())
                    .unwrap_or(0);
                json_str[epoch_pos..epoch_pos + epoch_end]
                    .parse::<u64>()
                    .unwrap_or(0)
            } else {
                return Err("No EpochTime found in response");
            };

            // Look for Past24Hours rainfall in PrecipitationSummary
            // Format: "Past24Hours":{"Metric":{"Value":23.1,...}}
            if let Some(past24h_start) = json_str.find("\"Past24Hours\":{\"Metric\":{\"Value\":") {
                let value_pos = past24h_start + 34; // Skip to the value
                let value_end = json_str[value_pos..]
                    .find(|c: char| !c.is_ascii_digit() && c != '.')
                    .unwrap_or(0);
                if let Ok(precip) = json_str[value_pos..value_pos + value_end].parse::<f64>() {
                    // Convert to mm * 10 for storage (e.g., 23.1mm -> 231)
                    let rainfall_mm = (precip * 10.0) as Millimeters;
                    
                    log::info!(
                        target: "prmx-oracle",
                        "📊 AccuWeather Past24Hours rainfall: {:.1}mm (stored as {})",
                        precip,
                        rainfall_mm
                    );
                    
                    // Return as a single data point with the total 24h rainfall
                    results.push((epoch, rainfall_mm));
                }
            } else {
                log::debug!(
                    target: "prmx-oracle",
                    "No Past24Hours rainfall found in response"
                );
            }

            if results.is_empty() {
                log::debug!(
                    target: "prmx-oracle",
                    "No rainfall data found in response"
                );
            }

            Ok(results)
        }

        /// Extract 24 hourly rainfall readings from AccuWeather historical/24 response
        /// The response is an array of 24 hourly observations, each with PrecipitationSummary.PastHour
        fn extract_hourly_rainfall_data(json: &[u8]) -> Result<Vec<(u64, Millimeters)>, &'static str> {
            let json_str = core::str::from_utf8(json).map_err(|_| "Invalid JSON encoding")?;
            
            let mut results: Vec<(u64, Millimeters)> = Vec::new();
            
            // The response is an array of objects: [{"EpochTime":123,...,"PrecipitationSummary":{...}},...]
            // Parse each observation
            let mut search_start = 0;
            let mut observations_parsed = 0u32;
            
            while let Some(epoch_pos) = json_str[search_start..].find("\"EpochTime\":") {
                let abs_epoch_pos = search_start + epoch_pos + 12;
                
                // Extract EpochTime value
                let epoch_end = json_str[abs_epoch_pos..]
                    .find(|c: char| !c.is_ascii_digit())
                    .unwrap_or(0);
                
                let epoch = json_str[abs_epoch_pos..abs_epoch_pos + epoch_end]
                    .parse::<u64>()
                    .unwrap_or(0);
                
                if epoch == 0 {
                    search_start = abs_epoch_pos;
                    continue;
                }
                
                // Look for PastHour rainfall near this observation
                // Search within the next ~500 chars for the PastHour value
                let search_window_end = core::cmp::min(abs_epoch_pos + 500, json_str.len());
                let search_window = &json_str[abs_epoch_pos..search_window_end];
                
                let mut rainfall_mm: Millimeters = 0;
                
                // Look for "PastHour":{"Metric":{"Value":X.X
                if let Some(past_hour_pos) = search_window.find("\"PastHour\":{\"Metric\":{\"Value\":") {
                    let value_start = past_hour_pos + 31;
                    if value_start < search_window.len() {
                        let remaining = &search_window[value_start..];
                        let value_end = remaining
                            .find(|c: char| !c.is_ascii_digit() && c != '.' && c != '-')
                            .unwrap_or(0);
                        if value_end > 0 {
                            if let Ok(precip) = remaining[..value_end].parse::<f64>() {
                                // Convert to mm * 10 for storage
                                rainfall_mm = (precip * 10.0) as Millimeters;
                            }
                        }
                    }
                }
                
                results.push((epoch, rainfall_mm));
                observations_parsed += 1;
                
                // Move to next observation
                search_start = abs_epoch_pos + 1;
                
                // Safety limit
                if observations_parsed >= 24 {
                    break;
                }
            }
            
            if !results.is_empty() {
                let total_mm: Millimeters = results.iter().map(|(_, mm)| *mm).sum();
                log::info!(
                    target: "prmx-oracle",
                    "📊 AccuWeather historical/24: {} hourly observations, total rainfall {:.1}mm",
                    results.len(),
                    total_mm as f64 / 10.0
                );
            } else {
                log::warn!(
                    target: "prmx-oracle",
                    "⚠️ No hourly observations found in historical/24 response"
                );
            }
            
            Ok(results)
        }
    }
}

// =============================================================================
//                       RainfallOracle Trait Implementation
// =============================================================================

impl<T: Config> RainfallOracle for Pallet<T> {
    fn rolling_sum_mm_at(location_id: LocationId, timestamp: u64) -> Option<Millimeters> {
        // Return None if market location not configured
        if !pallet::MarketLocationConfig::<T>::contains_key(location_id) {
            return None;
        }
        Some(Pallet::<T>::calculate_rolling_sum_at(location_id, timestamp))
    }

    fn exceeded_threshold_in_window(
        location_id: LocationId,
        strike_mm: Millimeters,
        coverage_start: u64,
        coverage_end: u64,
    ) -> Result<bool, sp_runtime::DispatchError> {
        Pallet::<T>::check_exceeded_threshold_in_window(
            location_id,
            strike_mm,
            coverage_start,
            coverage_end,
        )
        .map_err(|e| e.into())
    }
}

// =============================================================================
//                       Legacy OracleAccess (for backwards compatibility)
// =============================================================================

/// Legacy trait for backwards compatibility with existing code
pub trait OracleAccess {
    /// Check if rainfall event occurred during a coverage window
    fn event_occurred_in_window(
        location_id: u32,
        coverage_start: u64,
        coverage_end: u64,
        strike_value: u32,
    ) -> bool;

    /// Get the maximum 24h rolling sum during a window
    fn max_rolling_sum_in_window(
        location_id: u32,
        coverage_start: u64,
        coverage_end: u64,
    ) -> u32;

    /// Get current 24h rolling sum for a location
    fn current_rolling_sum(location_id: u32) -> u32;
}

impl<T: Config> OracleAccess for Pallet<T> {
    fn event_occurred_in_window(
        location_id: u32,
        coverage_start: u64,
        coverage_end: u64,
        strike_value: u32,
    ) -> bool {
        Pallet::<T>::check_exceeded_threshold_in_window(
            location_id as u64,
            strike_value,
            coverage_start,
            coverage_end,
        )
        .unwrap_or(false)
    }

    fn max_rolling_sum_in_window(
        location_id: u32,
        coverage_start: u64,
        coverage_end: u64,
    ) -> u32 {
        // Calculate max rolling sum across the window
        if coverage_start >= coverage_end {
            return 0;
        }

        let mut max_sum: u32 = 0;
        let mut t = coverage_start;
        while t <= coverage_end {
            let sum = Pallet::<T>::calculate_rolling_sum_at(location_id as u64, t);
            if sum > max_sum {
                max_sum = sum;
            }
            t = t.saturating_add(BUCKET_INTERVAL_SECS);
        }

        max_sum
    }

    fn current_rolling_sum(location_id: u32) -> u32 {
        // Use current rolling state if available
        pallet::RollingState::<T>::get(location_id as u64)
            .map(|s| s.rolling_sum_mm)
            .unwrap_or(0)
    }
}

// =============================================================================
//                    NewMarketNotifier Implementation
// =============================================================================

impl<T: Config> NewMarketNotifier for Pallet<T> {
    /// Called by the markets pallet when a new market is created.
    /// Queues a pending fetch request so the OCW will immediately resolve
    /// the AccuWeather location and fetch rainfall data.
    fn notify_new_market(market_id: MarketId) {
        // Queue a pending fetch request for the new market
        let current_block = frame_system::Pallet::<T>::block_number();
        pallet::PendingFetchRequests::<T>::insert(market_id, current_block);
        
        log::info!(
            target: "prmx-oracle",
            "📥 Auto-queued fetch for newly created market {} at block {:?}",
            market_id,
            current_block
        );
    }
}
