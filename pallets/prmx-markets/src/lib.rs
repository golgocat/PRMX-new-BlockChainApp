//! # PRMX Markets Pallet
//!
//! This pallet manages market definitions and parameters for parametric insurance.
//!
//! ## Overview
//!
//! - Markets define the template for insurance policies (e.g., Manila rainfall)
//! - Each market has center coordinates used by oracle for AccuWeather binding
//! - Customers choose a market (not coordinates) when requesting coverage
//! - DAO creates and manages market parameters

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub use pallet::*;

#[frame_support::pallet]
pub mod pallet {
    use super::*;
    use alloc::vec::Vec;
    use codec::DecodeWithMemTracking;
    use frame_support::pallet_prelude::*;
    use frame_system::pallet_prelude::*;

    // =========================================================================
    //                                  Types
    // =========================================================================

    pub type MarketId = u64;
    pub type LocationId = MarketId; // market_id is also location_id for oracle
    pub type BasisPoints = u32;     // 1 bp = 0.01%
    pub type PartsPerMillion = u32; // 1 ppm = 0.0001%
    pub type Millimeters = u32;

    #[derive(
        Encode,
        Decode,
        DecodeWithMemTracking,
        Clone,
        PartialEq,
        Eq,
        RuntimeDebug,
        TypeInfo,
        MaxEncodedLen,
        Default,
    )]
    pub struct RiskParameters {
        /// DAO margin over fair premium (expected loss), in basis points.
        /// Example: 20% margin -> 2000 bp.
        pub dao_margin_bp: BasisPoints,
    }

    #[derive(
        Encode,
        Decode,
        DecodeWithMemTracking,
        Clone,
        PartialEq,
        Eq,
        RuntimeDebug,
        TypeInfo,
        MaxEncodedLen,
    )]
    pub struct WindowRules {
        pub min_duration_secs: u32, // e.g. 1 day = 86_400
        pub max_duration_secs: u32, // e.g. 7 days = 604_800
        pub min_lead_time_secs: u32, // e.g. 3 weeks = 1_814_400
    }

    // Default values for WindowRules
    impl Default for WindowRules {
        fn default() -> Self {
            Self {
                min_duration_secs: 86_400,
                max_duration_secs: 604_800,
                // 0 for testing (production should be 1_814_400 = 21 days)
                min_lead_time_secs: 0,
            }
        }
    }

    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
    pub enum EventType {
        Rainfall24h,
        // future variants...
    }

    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
    pub enum MarketStatus {
        Open,
        Closed,
        Settled,
    }

    /// Market information as defined in design.md section 5.4
    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
    pub struct MarketInfo<Balance, AssetId> {
        pub market_id: MarketId,
        /// Human-readable name, e.g., b"Manila"
        pub name: BoundedVec<u8, ConstU32<64>>,
        /// Center latitude (scaled by 1e6), e.g., 14.5995° -> 14_599_500
        pub center_latitude: i32,
        /// Center longitude (scaled by 1e6), e.g., 120.9842° -> 120_984_200
        pub center_longitude: i32,
        pub event_type: EventType,
        /// Rainfall threshold in mm (scaled by 10 for oracle, so 50mm = 500)
        pub strike_value: Millimeters,
        /// Payout per share = PAYOUT_PER_SHARE
        pub payout_per_share: Balance,
        /// Base asset ID (USDT)
        pub base_asset: AssetId,
        pub status: MarketStatus,
        pub risk: RiskParameters,
        pub window_rules: WindowRules,
    }

    // =========================================================================
    //                                  Config
    // =========================================================================

    #[pallet::config]
    pub trait Config: frame_system::Config {
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;

        /// Balance type
        type Balance: Parameter + Member + From<u128> + Into<u128> + Copy + Default + MaxEncodedLen;

        /// AssetId type
        type AssetId: Parameter + Member + Copy + Default + MaxEncodedLen + From<u32>;
    }

    // =========================================================================
    //                                  Storage
    // =========================================================================

    #[pallet::pallet]
    pub struct Pallet<T>(_);

    /// Stores the details of each market.
    #[pallet::storage]
    #[pallet::getter(fn markets)]
    pub type Markets<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        MarketId,
        MarketInfo<T::Balance, T::AssetId>,
        OptionQuery,
    >;

    /// Tracks the next available MarketId.
    #[pallet::storage]
    #[pallet::getter(fn next_market_id)]
    pub type NextMarketId<T> = StorageValue<_, MarketId, ValueQuery>;

    // =========================================================================
    //                           Genesis Configuration
    // =========================================================================

    /// Genesis market configuration using concrete types for serde compatibility
    #[derive(
        Clone,
        PartialEq,
        Eq,
        Debug,
        Encode,
        Decode,
        scale_info::TypeInfo,
        serde::Serialize,
        serde::Deserialize,
    )]
    #[serde(rename_all = "camelCase")]
    pub struct GenesisMarket {
        pub name: Vec<u8>,
        pub center_latitude: i32,  // scaled by 1e6
        pub center_longitude: i32, // scaled by 1e6
        pub strike_value: u32,     // rainfall threshold in mm (scaled by 10)
        /// Payout per share in smallest units (u128)
        pub payout_per_share: u128,
        /// Base asset ID (u32)
        pub base_asset: u32,
        pub dao_margin_bp: BasisPoints,
        pub min_duration_secs: u32,
        pub max_duration_secs: u32,
        pub min_lead_time_secs: u32,
    }

    #[pallet::genesis_config]
    #[derive(frame_support::DefaultNoBound)]
    pub struct GenesisConfig<T: Config> {
        /// Initial markets to create at genesis
        pub markets: Vec<GenesisMarket>,
        #[serde(skip)]
        pub _phantom: core::marker::PhantomData<T>,
    }

    #[pallet::genesis_build]
    impl<T: Config> BuildGenesisConfig for GenesisConfig<T> {
        fn build(&self) {
            for (index, market_config) in self.markets.iter().enumerate() {
                let market_id = index as MarketId;

                let name: BoundedVec<u8, ConstU32<64>> = market_config
                    .name
                    .clone()
                    .try_into()
                    .expect("Market name too long");

                let market_info = MarketInfo {
                    market_id,
                    name,
                    center_latitude: market_config.center_latitude,
                    center_longitude: market_config.center_longitude,
                    event_type: EventType::Rainfall24h,
                    strike_value: market_config.strike_value,
                    payout_per_share: market_config.payout_per_share.into(),
                    base_asset: market_config.base_asset.into(),
                    status: MarketStatus::Open,
                    risk: RiskParameters {
                        dao_margin_bp: market_config.dao_margin_bp,
                    },
                    window_rules: WindowRules {
                        min_duration_secs: market_config.min_duration_secs,
                        max_duration_secs: market_config.max_duration_secs,
                        min_lead_time_secs: market_config.min_lead_time_secs,
                    },
                };

                Markets::<T>::insert(market_id, market_info);
            }

            // Set next market ID
            NextMarketId::<T>::put(self.markets.len() as MarketId);
        }
    }

    // =========================================================================
    //                                  Events
    // =========================================================================

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// A new market has been created. [market_id, name]
        MarketCreated {
            market_id: MarketId,
            name: BoundedVec<u8, ConstU32<64>>,
        },
        /// Window rules updated for a market. [market_id]
        WindowRulesUpdated { market_id: MarketId },
        /// Risk parameters updated for a market. [market_id]
        RiskParametersUpdated { market_id: MarketId },
        /// Market closed (no new policies). [market_id]
        MarketClosed { market_id: MarketId },
        /// Market settled (all policies settled). [market_id]
        MarketSettled { market_id: MarketId },
    }

    // =========================================================================
    //                                  Errors
    // =========================================================================

    #[pallet::error]
    pub enum Error<T> {
        /// Market not found.
        MarketNotFound,
        /// Invalid window rules.
        InvalidWindowRules,
        /// Invalid coverage window (end must be after start).
        InvalidCoverageWindow,
        /// Coverage duration is too short.
        CoverageTooShort,
        /// Coverage duration is too long.
        CoverageTooLong,
        /// Too late to apply for coverage (lead time not met).
        TooLateToApply,
        /// Market is not open.
        MarketNotOpen,
        /// Name too long.
        NameTooLong,
    }

    // =========================================================================
    //                                Extrinsics
    // =========================================================================

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Create a new market with center coordinates.
        /// Only DAO admin should be able to call this (TODO: add origin check).
        #[pallet::call_index(0)]
        #[pallet::weight(10_000)]
        pub fn dao_create_market(
            origin: OriginFor<T>,
            name: Vec<u8>,
            center_latitude: i32,
            center_longitude: i32,
            strike_value: Millimeters,
            base_asset: T::AssetId,
            payout_per_share: T::Balance,
            risk: RiskParameters,
            window_rules: WindowRules,
        ) -> DispatchResult {
            // TODO: Ensure DAO origin
            let _who = ensure_signed(origin)?;

            let bounded_name: BoundedVec<u8, ConstU32<64>> =
                name.try_into().map_err(|_| Error::<T>::NameTooLong)?;

            let market_id = NextMarketId::<T>::get();

            let market_info = MarketInfo {
                market_id,
                name: bounded_name.clone(),
                center_latitude,
                center_longitude,
                event_type: EventType::Rainfall24h,
                strike_value,
                payout_per_share,
                base_asset,
                status: MarketStatus::Open,
                risk,
                window_rules,
            };

            Markets::<T>::insert(market_id, market_info);
            NextMarketId::<T>::put(market_id + 1);

            Self::deposit_event(Event::MarketCreated {
                market_id,
                name: bounded_name,
            });

            Ok(())
        }

        /// Update window rules for a market.
        #[pallet::call_index(1)]
        #[pallet::weight(10_000)]
        pub fn dao_set_window_rules(
            origin: OriginFor<T>,
            market_id: MarketId,
            window_rules: WindowRules,
        ) -> DispatchResult {
            // TODO: Ensure DAO origin
            let _who = ensure_signed(origin)?;

            Markets::<T>::try_mutate(market_id, |maybe_market| -> DispatchResult {
                let market = maybe_market.as_mut().ok_or(Error::<T>::MarketNotFound)?;
                market.window_rules = window_rules;
                Ok(())
            })?;

            Self::deposit_event(Event::WindowRulesUpdated { market_id });

            Ok(())
        }

        /// Update risk parameters for a market.
        #[pallet::call_index(2)]
        #[pallet::weight(10_000)]
        pub fn dao_set_risk_parameters(
            origin: OriginFor<T>,
            market_id: MarketId,
            risk: RiskParameters,
        ) -> DispatchResult {
            // TODO: Ensure DAO origin
            let _who = ensure_signed(origin)?;

            Markets::<T>::try_mutate(market_id, |maybe_market| -> DispatchResult {
                let market = maybe_market.as_mut().ok_or(Error::<T>::MarketNotFound)?;
                market.risk = risk;
                Ok(())
            })?;

            Self::deposit_event(Event::RiskParametersUpdated { market_id });

            Ok(())
        }

        /// Close a market (prevent new policies).
        #[pallet::call_index(3)]
        #[pallet::weight(10_000)]
        pub fn dao_close_market(origin: OriginFor<T>, market_id: MarketId) -> DispatchResult {
            // TODO: Ensure DAO origin
            let _who = ensure_signed(origin)?;

            Markets::<T>::try_mutate(market_id, |maybe_market| -> DispatchResult {
                let market = maybe_market.as_mut().ok_or(Error::<T>::MarketNotFound)?;
                market.status = MarketStatus::Closed;
                Ok(())
            })?;

            Self::deposit_event(Event::MarketClosed { market_id });

            Ok(())
        }

        /// Settle a market (after all policies settled).
        #[pallet::call_index(4)]
        #[pallet::weight(10_000)]
        pub fn dao_settle_market(origin: OriginFor<T>, market_id: MarketId) -> DispatchResult {
            // TODO: Ensure DAO origin
            let _who = ensure_signed(origin)?;

            Markets::<T>::try_mutate(market_id, |maybe_market| -> DispatchResult {
                let market = maybe_market.as_mut().ok_or(Error::<T>::MarketNotFound)?;
                market.status = MarketStatus::Settled;
                Ok(())
            })?;

            Self::deposit_event(Event::MarketSettled { market_id });

            Ok(())
        }
    }

    // =========================================================================
    //                           Helper Functions
    // =========================================================================

    impl<T: Config> Pallet<T> {
        /// Validate a coverage window against market rules
        pub fn validate_coverage_window(
            market_id: MarketId,
            coverage_start: u64,
            coverage_end: u64,
            now: u64,
        ) -> DispatchResult {
            let market = Markets::<T>::get(market_id).ok_or(Error::<T>::MarketNotFound)?;

            ensure!(
                coverage_start < coverage_end,
                Error::<T>::InvalidCoverageWindow
            );

            let rules = &market.window_rules;
            let duration = coverage_end.saturating_sub(coverage_start);

            ensure!(
                duration as u32 >= rules.min_duration_secs,
                Error::<T>::CoverageTooShort
            );
            ensure!(
                duration as u32 <= rules.max_duration_secs,
                Error::<T>::CoverageTooLong
            );

            let lead_time = coverage_start.saturating_sub(now);
            ensure!(
                (lead_time as u32) >= rules.min_lead_time_secs,
                Error::<T>::TooLateToApply
            );

            Ok(())
        }

        /// Check if a market is open
        pub fn is_market_open(market_id: MarketId) -> bool {
            Markets::<T>::get(market_id)
                .map(|m| m.status == MarketStatus::Open)
                .unwrap_or(false)
        }

        /// Get market DAO margin in basis points
        pub fn get_dao_margin_bp(market_id: MarketId) -> Option<BasisPoints> {
            Markets::<T>::get(market_id).map(|m| m.risk.dao_margin_bp)
        }

        /// Get payout per share for a market
        pub fn get_payout_per_share(market_id: MarketId) -> Option<T::Balance> {
            Markets::<T>::get(market_id).map(|m| m.payout_per_share)
        }

        /// Get center coordinates for a market (used by quote pallet for R model API)
        pub fn get_center_coordinates(market_id: MarketId) -> Option<(i32, i32)> {
            Markets::<T>::get(market_id).map(|m| (m.center_latitude, m.center_longitude))
        }

        /// Get market info
        pub fn get_market(market_id: MarketId) -> Option<MarketInfo<T::Balance, T::AssetId>> {
            Markets::<T>::get(market_id)
        }

        /// Get strike value for a market
        pub fn get_strike_value(market_id: MarketId) -> Option<Millimeters> {
            Markets::<T>::get(market_id).map(|m| m.strike_value)
        }
    }
}

// =============================================================================
//                           MarketsAccess Trait
// =============================================================================

/// Trait for other pallets to access market data
pub trait MarketsAccess {
    type Balance;

    /// Get DAO margin in basis points for a market
    fn dao_margin_bp(market_id: u64) -> Result<u32, ()>;

    /// Get payout per share for a market
    fn payout_per_share(market_id: u64) -> Result<Self::Balance, ()>;

    /// Get center coordinates (lat, lon) for a market
    fn center_coordinates(market_id: u64) -> Result<(i32, i32), ()>;

    /// Check if market exists and is open
    fn is_market_open(market_id: u64) -> bool;

    /// Validate coverage window against market rules
    fn validate_coverage_window(
        market_id: u64,
        coverage_start: u64,
        coverage_end: u64,
        now: u64,
    ) -> Result<(), sp_runtime::DispatchError>;

    /// Get strike value for a market
    fn strike_value(market_id: u64) -> Result<u32, ()>;
}

impl<T: Config> MarketsAccess for Pallet<T> {
    type Balance = T::Balance;

    fn dao_margin_bp(market_id: u64) -> Result<u32, ()> {
        Pallet::<T>::get_dao_margin_bp(market_id).ok_or(())
    }

    fn payout_per_share(market_id: u64) -> Result<Self::Balance, ()> {
        Pallet::<T>::get_payout_per_share(market_id).ok_or(())
    }

    fn center_coordinates(market_id: u64) -> Result<(i32, i32), ()> {
        Pallet::<T>::get_center_coordinates(market_id).ok_or(())
    }

    fn is_market_open(market_id: u64) -> bool {
        Pallet::<T>::is_market_open(market_id)
    }

    fn validate_coverage_window(
        market_id: u64,
        coverage_start: u64,
        coverage_end: u64,
        now: u64,
    ) -> Result<(), sp_runtime::DispatchError> {
        Pallet::<T>::validate_coverage_window(market_id, coverage_start, coverage_end, now)
    }

    fn strike_value(market_id: u64) -> Result<u32, ()> {
        Pallet::<T>::get_strike_value(market_id).ok_or(())
    }
}
