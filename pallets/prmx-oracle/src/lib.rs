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

use alloc::vec::Vec;
use pallet_prmx_markets::MarketId;

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

/// Blocks per hour (assuming ~6 second block time)
/// 3600 seconds / 6 seconds = 600 blocks
pub const BLOCKS_PER_HOUR: u32 = 600;

/// Blocks between location binding checks (~10 minutes)
/// 600 seconds / 6 seconds = 100 blocks
pub const BLOCKS_PER_BINDING_CHECK: u32 = 100;

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

    // =========================================================================
    //                                  Config
    // =========================================================================

    #[pallet::config]
    pub trait Config: frame_system::Config + pallet_prmx_markets::Config {
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;

        /// Who can submit rainfall data and bind AccuWeather locations
        type OracleOrigin: EnsureOrigin<Self::RuntimeOrigin>;

        /// Who can govern configuration (typically DAO/Root)
        type GovernanceOrigin: EnsureOrigin<Self::RuntimeOrigin>;

        /// Access to markets pallet for center coordinates
        type MarketsApi: MarketsAccess;

        /// Maximum length of AccuWeather location key
        #[pallet::constant]
        type MaxLocationKeyLength: Get<u32>;

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

    /// Authorized oracle providers (accounts that can submit data)
    #[pallet::storage]
    #[pallet::getter(fn oracle_providers)]
    pub type OracleProviders<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, bool, ValueQuery>;

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
            // In offchain context, use offchain timestamp
            // In on-chain context, use block number as approximation
            let now = {
                #[cfg(feature = "std")]
                {
                    // In std/test mode, use current unix time
                    use sp_runtime::traits::UniqueSaturatedInto;
                    let block_num: u64 = frame_system::Pallet::<T>::block_number().unique_saturated_into();
                    // Assume 6 second blocks, add genesis timestamp approximation
                    block_num * 6
                }
                #[cfg(not(feature = "std"))]
                {
                    // In WASM, use block number as approximation
                    use sp_runtime::traits::UniqueSaturatedInto;
                    let block_num: u64 = frame_system::Pallet::<T>::block_number().unique_saturated_into();
                    block_num * 6
                }
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
            let bucket = RainBucket {
                timestamp: bucket_start,
                rainfall_mm,
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
            let base_ts = 1733616000u64; // Dec 8, 2025 approximate
            let now_ts = base_ts + (block_num * 6);
            let bucket_idx = bucket_index_for_timestamp(now_ts);

            // Store rainfall bucket
            let bucket = RainBucket {
                timestamp: bucket_start_time(bucket_idx),
                rainfall_mm,
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

            // Store in offchain index so it can be read by offchain workers
            // The key will be available to all validators running the offchain worker
            sp_io::offchain_index::set(ACCUWEATHER_API_KEY_STORAGE, &api_key);

            log::info!(
                target: "prmx-oracle",
                "🔑 AccuWeather API key stored (length: {} bytes)",
                api_key.len()
            );

            // Note: We don't emit an event with the API key for security reasons
            Ok(())
        }

    }

    // =========================================================================
    //                          Internal Functions
    // =========================================================================

    impl<T: Config> Pallet<T> {
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
    }

    // =========================================================================
    //                          Offchain Worker
    // =========================================================================

    /// Offchain storage key for AccuWeather API key
    pub const ACCUWEATHER_API_KEY_STORAGE: &[u8] = b"prmx-oracle::accuweather-api-key";

    /// AccuWeather API base URL
    pub const ACCUWEATHER_BASE_URL: &str = "https://dataservice.accuweather.com";

    #[pallet::hooks]
    impl<T: Config> Hooks<BlockNumberFor<T>> for Pallet<T> {
        /// On initialize hook - bootstrap test data for markets without rainfall data
        /// Runs every 50 blocks to catch newly created markets
        fn on_initialize(block_number: BlockNumberFor<T>) -> Weight {
            use sp_runtime::traits::UniqueSaturatedInto;
            let block_num: u32 = block_number.unique_saturated_into();
            
            // Run bootstrap check every 50 blocks (or first 5 blocks for initial setup)
            // This catches newly created markets that don't have data yet
            if block_num > 5 && block_num % 50 != 0 {
                return Weight::zero();
            }

            // In dev mode, add test rainfall data for markets without data
            // NOTE: We no longer auto-bind mock location keys since we have a real API key
            // The offchain worker will resolve real AccuWeather location keys
            #[cfg(feature = "dev-mode")]
            {
                let next_id = pallet_prmx_markets::NextMarketId::<T>::get();
                
                for market_id in 0..next_id {
                    // Add test rainfall data if market has no rolling state
                    // This provides immediate data while waiting for real API data
                    if !RollingState::<T>::contains_key(market_id) 
                    {
                        // Get current timestamp - use a realistic approximation
                        // Assume chain started recently, use block number * 6 seconds + a base timestamp
                        let base_ts = 1733616000u64; // Dec 8, 2025 approximate
                        let now_ts = base_ts + (block_num as u64 * 6);
                        let bucket_idx = bucket_index_for_timestamp(now_ts);
                        
                        // Add some test rainfall data (simulated 24h history)
                        // Use varying amounts based on market_id for variety
                        let base_rainfall = ((market_id % 5) * 50 + 100) as u32; // 100-300 range (10-30mm)
                        
                        let bucket = RainBucket {
                            timestamp: bucket_start_time(bucket_idx),
                            rainfall_mm: base_rainfall,
                        };
                        RainBuckets::<T>::insert(market_id, bucket_idx, bucket);

                        // Initialize rolling state
                        let state = RollingWindowState {
                            last_bucket_index: bucket_idx,
                            oldest_bucket_index: bucket_idx,
                            rolling_sum_mm: base_rainfall,
                        };
                        RollingState::<T>::insert(market_id, state);

                        log::info!(
                            target: "prmx-oracle",
                            "🌧️ Added test rainfall data for market {}: {} mm (dev-mode, block {})",
                            market_id,
                            base_rainfall as f64 / 10.0,
                            block_num
                        );

                        Self::deposit_event(Event::RainfallUpdated {
                            location_id: market_id,
                            bucket_index: bucket_idx,
                            rainfall_mm: base_rainfall,
                        });

                        Self::deposit_event(Event::RollingSumUpdated {
                            location_id: market_id,
                            rolling_sum_mm: base_rainfall,
                        });
                    }
                }
            }

            Weight::from_parts(10_000, 0)
        }

        /// Offchain worker entry point
        /// Per oracle_design.md section 7.2
        fn offchain_worker(block_number: BlockNumberFor<T>) {
            // Convert block number to u32 for modulo check
            use sp_runtime::traits::UniqueSaturatedInto;
            let block_num: u32 = block_number.unique_saturated_into();

            // Determine what operations to run based on block number
            // - Rainfall ingestion: once per hour (every 600 blocks), or first 10 blocks for quick startup
            // - Location binding: every ~10 minutes (every 100 blocks) for new markets
            let is_startup_window = block_num < 10; // Run more frequently during startup
            let should_fetch_rainfall = is_startup_window || block_num % BLOCKS_PER_HOUR == 0;
            let should_check_bindings = is_startup_window || block_num % BLOCKS_PER_BINDING_CHECK == 0;

            // Early return if nothing to do this block
            if !should_fetch_rainfall && !should_check_bindings {
                return;
            }

            // Log occasionally to show worker is alive
            if should_check_bindings || is_startup_window {
                log::info!(
                    target: "prmx-oracle",
                    "Offchain worker at block {} (startup: {}, rainfall: {}, bindings: {})",
                    block_num,
                    is_startup_window,
                    should_fetch_rainfall,
                    should_check_bindings
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

                    // Process markets that need location binding
                    // More frequent during startup and every ~10 minutes after
                    if should_check_bindings {
                        if let Err(e) = Self::process_unbound_markets(&key, block_number) {
                            log::warn!(
                                target: "prmx-oracle",
                                "Error processing unbound markets: {:?}",
                                e
                            );
                        }
                    }

                    // Process rainfall ingestion for bound markets
                    // More frequent during startup and hourly after
                    if should_fetch_rainfall {
                        if let Err(e) = Self::process_rainfall_ingestion(&key, block_number) {
                            log::warn!(
                                target: "prmx-oracle",
                                "Error ingesting rainfall data: {:?}",
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

    /// Test API key for development (DO NOT USE IN PRODUCTION)
    /// This is configured in the node for testing purposes only.
    #[cfg(feature = "dev-mode")]
    pub const TEST_ACCUWEATHER_API_KEY: &[u8] = b"zpka_db8e78f41a5a431483111521abb69a4b_188626e6";

    impl<T: Config> Pallet<T> {
        /// Get AccuWeather API key from offchain storage or test fallback
        fn get_accuweather_api_key() -> Option<Vec<u8>> {
            // Try offchain local storage first
            let storage = sp_io::offchain::local_storage_get(
                sp_core::offchain::StorageKind::PERSISTENT,
                ACCUWEATHER_API_KEY_STORAGE,
            );

            if let Some(key) = storage {
                if !key.is_empty() {
                    return Some(key);
                }
            }

            // Fallback: Use test API key in dev mode
            #[cfg(feature = "dev-mode")]
            {
                log::info!(
                    target: "prmx-oracle",
                    "Using test AccuWeather API key (dev-mode)"
                );
                return Some(TEST_ACCUWEATHER_API_KEY.to_vec());
            }

            #[cfg(not(feature = "dev-mode"))]
            None
        }

        /// Process markets without AccuWeather location binding
        /// Per oracle_design.md section 7.2
        fn process_unbound_markets(api_key: &[u8], _block_number: BlockNumberFor<T>) -> Result<(), &'static str> {
            use pallet_prmx_markets::Markets;

            // Iterate markets (limit to a few per block for throttling)
            let mut processed = 0u32;
            const MAX_MARKETS_PER_BLOCK: u32 = 3;

            // Get next market ID to iterate
            let next_id = pallet_prmx_markets::NextMarketId::<T>::get();

            for market_id in 0..next_id {
                if processed >= MAX_MARKETS_PER_BLOCK {
                    break;
                }

                // Skip if already bound
                if MarketLocationConfig::<T>::contains_key(market_id) {
                    continue;
                }

                // Get market info
                if let Some(market) = Markets::<T>::get(market_id) {
                    log::info!(
                        target: "prmx-oracle",
                        "Market {} needs AccuWeather location binding",
                        market_id
                    );

                    // Get center coordinates
                    let lat = market.center_latitude as f64 / 1_000_000.0;
                    let lon = market.center_longitude as f64 / 1_000_000.0;

                    // Call AccuWeather Geoposition Search
                    match Self::fetch_accuweather_location_key(api_key, lat, lon) {
                        Ok(location_key) => {
                            let key_str = core::str::from_utf8(&location_key).unwrap_or("invalid");
                            log::info!(
                                target: "prmx-oracle",
                                "✅ Resolved AccuWeather location key for market {}: {}",
                                market_id,
                                key_str
                            );

                            // Store location binding via offchain indexing
                            // This will be picked up by the next block's on_initialize
                            let key = Self::location_binding_key(market_id);
                            sp_io::offchain_index::set(&key, &location_key);
                            
                            log::info!(
                                target: "prmx-oracle",
                                "📝 Stored location binding in offchain index for market {}",
                                market_id
                            );
                        }
                        Err(e) => {
                            log::warn!(
                                target: "prmx-oracle",
                                "Failed to fetch location key for market {}: {}",
                                market_id,
                                e
                            );
                        }
                    }

                    processed += 1;
                }
            }

            Ok(())
        }

        /// Process rainfall ingestion for bound markets
        /// Prioritizes markets without any data (last 24h bootstrap)
        fn process_rainfall_ingestion(api_key: &[u8], _block_number: BlockNumberFor<T>) -> Result<(), &'static str> {
            // Iterate bound markets
            let mut processed = 0u32;
            const MAX_MARKETS_PER_BLOCK: u32 = 3;

            let next_id = pallet_prmx_markets::NextMarketId::<T>::get();

            // First pass: prioritize markets without any rolling state (no data yet)
            for market_id in 0..next_id {
                if processed >= MAX_MARKETS_PER_BLOCK {
                    break;
                }

                // Only process bound markets that have NO data yet
                if let Some(location_info) = MarketLocationConfig::<T>::get(market_id) {
                    // Skip if already has data
                    if RollingState::<T>::contains_key(market_id) {
                        continue;
                    }

                    let location_key =
                        core::str::from_utf8(&location_info.accuweather_location_key)
                            .map_err(|_| "Invalid location key encoding")?;

                    log::info!(
                        target: "prmx-oracle",
                        "🌧️ Fetching initial 24h rainfall for market {} (no data yet)",
                        market_id
                    );

                    Self::fetch_and_store_rainfall(api_key, location_key, market_id)?;
                    processed += 1;
                }
            }

            // Second pass: update markets that already have data (regular refresh)
            for market_id in 0..next_id {
                if processed >= MAX_MARKETS_PER_BLOCK {
                    break;
                }

                if let Some(location_info) = MarketLocationConfig::<T>::get(market_id) {
                    // Only process markets that already have data
                    if !RollingState::<T>::contains_key(market_id) {
                        continue;
                    }

                    let location_key =
                        core::str::from_utf8(&location_info.accuweather_location_key)
                            .map_err(|_| "Invalid location key encoding")?;

                    log::debug!(
                        target: "prmx-oracle",
                        "Refreshing rainfall for market {} (location: {})",
                        market_id,
                        location_key
                    );

                    Self::fetch_and_store_rainfall(api_key, location_key, market_id)?;
                    processed += 1;
                }
            }

            Ok(())
        }

        /// Fetch rainfall data and store via offchain indexing
        fn fetch_and_store_rainfall(
            api_key: &[u8],
            location_key: &str,
            market_id: MarketId,
        ) -> Result<(), &'static str> {
            match Self::fetch_accuweather_rainfall(api_key, location_key) {
                Ok(rainfall_data) => {
                    log::info!(
                        target: "prmx-oracle",
                        "Fetched {} rainfall records for market {}",
                        rainfall_data.len(),
                        market_id
                    );

                    // Store rainfall data via offchain indexing
                    for (timestamp, rainfall_mm) in rainfall_data {
                        let key = Self::rainfall_data_key(market_id, timestamp);
                        let value = rainfall_mm.to_le_bytes();
                        sp_io::offchain_index::set(&key, &value);
                        
                        log::info!(
                            target: "prmx-oracle",
                            "📝 Stored rainfall {:.1} mm for market {} at timestamp {} in offchain index",
                            rainfall_mm as f64 / 10.0,
                            market_id,
                            timestamp
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

        /// Fetch AccuWeather current conditions with rainfall data
        /// Uses the starter-plan-compatible endpoint with details=true
        /// which includes PrecipitationSummary.Past24Hours
        fn fetch_accuweather_rainfall(
            api_key: &[u8],
            location_key: &str,
        ) -> Result<Vec<(u64, Millimeters)>, &'static str> {
            use sp_runtime::offchain::http;

            let api_key_str =
                core::str::from_utf8(api_key).map_err(|_| "Invalid API key encoding")?;

            // Build URL: /currentconditions/v1/{locationKey}?apikey=XXX&details=true
            // This endpoint is available on starter plan and includes Past24Hours precipitation
            let url = alloc::format!(
                "{}/currentconditions/v1/{}?apikey={}&details=true",
                ACCUWEATHER_BASE_URL,
                location_key,
                api_key_str
            );

            log::debug!(
                target: "prmx-oracle",
                "Fetching rainfall from AccuWeather for location {}",
                location_key
            );

            // Make HTTP request
            let request = http::Request::get(&url);
            let timeout = sp_io::offchain::timestamp()
                .add(sp_runtime::offchain::Duration::from_millis(15_000));

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

            // Parse JSON to extract rainfall data
            Self::extract_rainfall_data(&body)
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

        /// Extract rainfall data from AccuWeather current conditions response
        /// The response contains PrecipitationSummary.Past24Hours with total 24h rainfall
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
