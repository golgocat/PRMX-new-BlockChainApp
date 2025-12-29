//! PRMX Shared Primitives
//!
//! Common types used across PRMX pallets.

#![cfg_attr(not(feature = "std"), no_std)]

use codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

// ============================================================================
// Common ID Types
// ============================================================================

/// Market identifier
pub type MarketId = u64;

/// Policy identifier
pub type PolicyId = u64;

/// Quote identifier
pub type QuoteId = u64;

/// Order identifier (for LP orderbook)
pub type OrderId = u64;

/// Location identifier (alias for MarketId in oracle context)
pub type LocationId = MarketId;

/// Rainfall measurement in tenths of millimeters (e.g., 255 = 25.5mm)
pub type Millimeters = u32;

/// Probability in parts per million (e.g., 50_000 = 5%)
pub type PartsPerMillion = u32;

// ============================================================================
// V2 Policy Types
// ============================================================================

/// Policy version - determines which settlement path is used.
/// V1 and V2 are completely isolated and use different settlement logic.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Encode, Decode, DecodeWithMemTracking, TypeInfo, MaxEncodedLen, Default)]
pub enum PolicyVersion {
    /// V1: Original 24h rolling rainfall oracle (on-chain OCW)
    #[default]
    V1,
    /// V2: Cumulative rainfall over window with early trigger (off-chain oracle service)
    V2,
}

/// Event type for policy - determines how rainfall is measured/evaluated.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Encode, Decode, DecodeWithMemTracking, TypeInfo, MaxEncodedLen, Default)]
pub enum EventType {
    /// 24-hour rolling rainfall sum (V1 default)
    #[default]
    Rainfall24hRolling,
    /// Cumulative rainfall over the entire coverage window (V2)
    CumulativeRainfallWindow,
}

/// V2 Oracle status - tracks the lifecycle of a V2 policy in the off-chain oracle.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Encode, Decode, DecodeWithMemTracking, TypeInfo, MaxEncodedLen)]
pub enum V2OracleStatus {
    /// Policy created, waiting for off-chain oracle to pick it up
    PendingMonitoring,
    /// Off-chain oracle is actively monitoring rainfall
    Monitoring,
    /// Threshold was exceeded, report submitted
    TriggeredReported,
    /// Coverage window ended without event, report submitted
    MaturedReported,
    /// Settlement completed
    Settled,
}

/// V2 settlement outcome - the final result of a V2 policy.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Encode, Decode, DecodeWithMemTracking, TypeInfo, MaxEncodedLen)]
pub enum V2Outcome {
    /// Cumulative rainfall >= strike at some point during the window (payout to policyholder)
    Triggered,
    /// Coverage window ended without threshold being met (LP profit)
    MaturedNoEvent,
}

/// V2 report submitted by the off-chain oracle service.
#[derive(Clone, PartialEq, Eq, Debug, Encode, Decode, DecodeWithMemTracking, TypeInfo, MaxEncodedLen)]
pub struct V2Report<AccountId> {
    /// Settlement outcome
    pub outcome: V2Outcome,
    /// Timestamp when the outcome was observed
    pub observed_at: u64,
    /// Cumulative rainfall in tenths of mm at observation time
    pub cumulative_mm: Millimeters,
    /// SHA256 hash of the evidence JSON (stored off-chain)
    pub evidence_hash: [u8; 32],
    /// Account that submitted the report
    pub reporter: AccountId,
    /// Block timestamp when report was submitted
    pub submitted_at: u64,
}

// ============================================================================
// V2 Configuration Constants
// ============================================================================

/// Minimum duration for V2 policies (in days)
pub const V2_MIN_DURATION_DAYS: u8 = 2;

/// Maximum duration for V2 policies (in days)
pub const V2_MAX_DURATION_DAYS: u8 = 7;

/// Manila market ID (the only market supporting V2 initially)
pub const MANILA_MARKET_ID: MarketId = 0;

// ============================================================================
// V3 Types - P2P Climate Risk Market
// ============================================================================

/// V3 Event types supported by the EventTypeRegistry.
/// Each type has specific aggregation logic and threshold comparison.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Encode, Decode, DecodeWithMemTracking, TypeInfo, MaxEncodedLen)]
pub enum EventTypeV3 {
    /// Cumulative precipitation >= threshold (mm)
    PrecipSumGte,
    /// Any 1-hour precipitation reading >= threshold (mm)
    Precip1hGte,
    /// Maximum temperature >= threshold (celsius)
    TempMaxGte,
    /// Minimum temperature <= threshold (celsius)
    TempMinLte,
    /// Maximum wind gust >= threshold (m/s)
    WindGustMaxGte,
    /// Specific precipitation type occurred (rain, snow, ice, etc.)
    PrecipTypeOccurred,
}

impl Default for EventTypeV3 {
    fn default() -> Self {
        Self::PrecipSumGte
    }
}

/// Unit type for threshold values.
/// All values use fixed-point scaling of 1e3.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Encode, Decode, DecodeWithMemTracking, TypeInfo, MaxEncodedLen)]
pub enum UnitV3 {
    /// Millimeters (scaled by 1000, e.g., 50.5mm = 50500)
    MmX1000,
    /// Celsius (scaled by 1000, e.g., 25.5°C = 25500)
    CelsiusX1000,
    /// Meters per second (scaled by 1000, e.g., 15.5m/s = 15500)
    MpsX1000,
    /// Precipitation type bitmask (rain=1, snow=2, ice=4, etc.)
    PrecipTypeMask,
}

impl Default for UnitV3 {
    fn default() -> Self {
        Self::MmX1000
    }
}

/// Threshold value with unit for event specification.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Encode, Decode, DecodeWithMemTracking, TypeInfo, MaxEncodedLen, Default)]
pub struct ThresholdV3 {
    /// Threshold value (fixed-point scaled by 1000 for mm/celsius/mps)
    pub value: i64,
    /// Unit of the threshold
    pub unit: UnitV3,
}

/// Event specification for a V3 policy.
/// Defines what weather event triggers a payout.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Encode, Decode, DecodeWithMemTracking, TypeInfo, MaxEncodedLen, Default)]
pub struct EventSpecV3 {
    /// Type of event to monitor
    pub event_type: EventTypeV3,
    /// Threshold for triggering
    pub threshold: ThresholdV3,
    /// Whether early trigger is enabled (settle immediately when threshold met)
    pub early_trigger: bool,
}

/// Aggregation state variants for on-chain oracle state.
/// Each variant matches an EventTypeV3 and holds the current aggregated value.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Encode, Decode, DecodeWithMemTracking, TypeInfo, MaxEncodedLen)]
pub enum AggStateV3 {
    /// Cumulative precipitation sum (mm * 1000)
    PrecipSum { sum_mm_x1000: i64 },
    /// Maximum 1-hour precipitation reading (mm * 1000)
    Precip1hMax { max_1h_mm_x1000: i64 },
    /// Maximum temperature observed (celsius * 1000)
    TempMax { max_c_x1000: i64 },
    /// Minimum temperature observed (celsius * 1000)
    TempMin { min_c_x1000: i64 },
    /// Maximum wind gust observed (m/s * 1000)
    WindGustMax { max_mps_x1000: i64 },
    /// Bitmask of precipitation types that occurred
    PrecipTypeOccurred { mask: u8 },
}

impl Default for AggStateV3 {
    fn default() -> Self {
        Self::PrecipSum { sum_mm_x1000: 0 }
    }
}

impl AggStateV3 {
    /// Create initial aggregation state for a given event type
    pub fn initial_for_event_type(event_type: EventTypeV3) -> Self {
        match event_type {
            EventTypeV3::PrecipSumGte => Self::PrecipSum { sum_mm_x1000: 0 },
            EventTypeV3::Precip1hGte => Self::Precip1hMax { max_1h_mm_x1000: 0 },
            EventTypeV3::TempMaxGte => Self::TempMax { max_c_x1000: i64::MIN },
            EventTypeV3::TempMinLte => Self::TempMin { min_c_x1000: i64::MAX },
            EventTypeV3::WindGustMaxGte => Self::WindGustMax { max_mps_x1000: 0 },
            EventTypeV3::PrecipTypeOccurred => Self::PrecipTypeOccurred { mask: 0 },
        }
    }
}

/// Status of an underwrite request.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Encode, Decode, DecodeWithMemTracking, TypeInfo, MaxEncodedLen, Default)]
pub enum RequestStatusV3 {
    /// Request created, no acceptances yet
    #[default]
    Pending,
    /// Some shares accepted, policy created with partial coverage
    PartiallyFilled,
    /// All shares accepted, request fully underwritten
    FullyFilled,
    /// Requester cancelled unfilled portion
    Cancelled,
    /// Request expired (OCW triggered cleanup)
    Expired,
}

/// V3 Policy status - lifecycle states for a v3 policy.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Encode, Decode, DecodeWithMemTracking, TypeInfo, MaxEncodedLen, Default)]
pub enum PolicyStatusV3 {
    /// Policy is active, monitoring for events
    #[default]
    Active,
    /// Event threshold was met, payout triggered
    Triggered,
    /// Coverage window ended without event
    Matured,
    /// Settlement completed
    Settled,
}

/// Oracle report kind for final reports.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Encode, Decode, DecodeWithMemTracking, TypeInfo, MaxEncodedLen)]
pub enum OracleReportKindV3 {
    /// Early trigger - threshold was met during coverage
    Trigger,
    /// Maturity - coverage window ended
    Maturity,
}

/// Per-policy oracle state stored on-chain.
#[derive(Clone, PartialEq, Eq, Debug, Encode, Decode, DecodeWithMemTracking, TypeInfo, MaxEncodedLen)]
pub struct PolicyOracleStateV3 {
    /// Policy ID this state belongs to
    pub policy_id: PolicyId,
    /// Latest observation timestamp processed
    pub observed_until: u64,
    /// Current aggregation state
    pub agg_state: AggStateV3,
    /// Commitment hash for verification
    pub commitment: [u8; 32],
    /// Block number of last snapshot
    pub last_snapshot_block: u32,
    /// Current status
    pub status: PolicyStatusV3,
}

// ============================================================================
// V3 Configuration Constants
// ============================================================================

/// Minimum duration for V3 policies (in days)
pub const V3_MIN_DURATION_DAYS: u8 = 1;

/// Maximum duration for V3 policies (in days)
pub const V3_MAX_DURATION_DAYS: u8 = 30;

/// Fixed payout per share in smallest units (100 USDT * 10^6 = 100_000_000)
pub const V3_PAYOUT_PER_SHARE: u128 = 100_000_000;

/// Minimum shares per acceptance
pub const V3_MIN_SHARES_PER_ACCEPT: u128 = 1;

/// Snapshot interval in seconds (6 hours)
pub const V3_SNAPSHOT_INTERVAL_SECS: u64 = 6 * 3600;

/// Snapshot interval in final 24 hours (1 hour)
pub const V3_SNAPSHOT_INTERVAL_FINAL_SECS: u64 = 3600;

/// Minimum blocks between snapshots (~10 minutes at 6s blocks)
pub const V3_MIN_SNAPSHOT_BLOCKS: u32 = 100;

/// Observations TTL in seconds (30 days)
pub const V3_OBSERVATIONS_TTL_SECS: u64 = 30 * 24 * 3600;

/// Snapshots TTL in seconds (90 days)
pub const V3_SNAPSHOTS_TTL_SECS: u64 = 90 * 24 * 3600;

/// Policy ID offset for V3 policies.
/// V3 policy IDs start from this value to avoid collision with V1/V2 policy IDs.
/// This ensures that when both systems share the prmxHoldings pallet, their IDs don't overlap.
/// V1/V2 policies: 0 to 999,999
/// V3 policies: 1,000,000+
pub const V3_POLICY_ID_OFFSET: PolicyId = 1_000_000;

