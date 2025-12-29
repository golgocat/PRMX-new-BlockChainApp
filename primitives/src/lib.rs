//! PRMX Shared Primitives
//!
//! Common types used across PRMX pallets.

#![cfg_attr(not(feature = "std"), no_std)]

use codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

// ============================================================================
// H128 Type Definition
// ============================================================================

/// 128-bit hash type for unique identifiers.
/// This is a wrapper around [u8; 16] with proper codec and scale-info support.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Debug, Encode, Decode, DecodeWithMemTracking, TypeInfo, MaxEncodedLen)]
pub struct H128(pub [u8; 16]);

impl H128 {
    /// Create a new H128 from a 16-byte array
    pub fn from_slice(slice: &[u8]) -> Self {
        let mut inner = [0u8; 16];
        let len = core::cmp::min(slice.len(), 16);
        inner[..len].copy_from_slice(&slice[..len]);
        Self(inner)
    }

    /// Get the inner bytes
    pub fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }

    /// Get the inner bytes (alias for compatibility)
    pub fn to_le_bytes(&self) -> [u8; 16] {
        self.0
    }

    /// Create from a blake2_128 hash output
    pub fn from_hash(hash: [u8; 16]) -> Self {
        Self(hash)
    }

    /// Zero value
    pub fn zero() -> Self {
        Self([0u8; 16])
    }
}

impl From<[u8; 16]> for H128 {
    fn from(bytes: [u8; 16]) -> Self {
        Self(bytes)
    }
}

impl From<H128> for [u8; 16] {
    fn from(h: H128) -> [u8; 16] {
        h.0
    }
}

impl AsRef<[u8]> for H128 {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

impl core::fmt::Display for H128 {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "0x")?;
        for byte in &self.0 {
            write!(f, "{:02x}", byte)?;
        }
        Ok(())
    }
}

// ============================================================================
// Common ID Types
// ============================================================================

/// Market identifier
pub type MarketId = u64;

/// Policy identifier (H128 hash-based for collision resistance)
pub type PolicyId = H128;

/// Request identifier (same as PolicyId for V3, 1:1 mapping)
pub type RequestId = H128;

/// Quote identifier (H128 hash-based for collision resistance)
pub type QuoteId = H128;

/// Order identifier (H128 hash-based for collision resistance)
pub type OrderId = H128;

/// Location identifier (alias for MarketId in oracle context)
pub type LocationId = MarketId;

// ============================================================================
// ID Generation
// ============================================================================

/// Generate a unique H128 ID from version prefix, creator, timestamp, and nonce.
/// 
/// The version prefix ensures IDs from different systems never collide:
/// - V1/V2 policies use b"V1V2"
/// - V3 policies use b"V3"
/// - Quotes use b"QUOTE"
/// - Orders use b"ORDER"
/// 
/// # Arguments
/// * `version_prefix` - Unique prefix for this ID type/system
/// * `creator` - Account creating the entity
/// * `timestamp` - Current timestamp
/// * `nonce` - Per-account nonce for uniqueness
#[cfg(feature = "std")]
pub fn generate_unique_id<AccountId: Encode>(
    version_prefix: &[u8],
    creator: &AccountId,
    timestamp: u64,
    nonce: u64,
) -> H128 {
    use sp_core::hashing::blake2_128;
    let data = (version_prefix, creator, timestamp, nonce).encode();
    H128::from_hash(blake2_128(&data))
}

/// Generate a unique H128 ID (no_std version using sp_io)
#[cfg(not(feature = "std"))]
pub fn generate_unique_id<AccountId: Encode>(
    version_prefix: &[u8],
    creator: &AccountId,
    timestamp: u64,
    nonce: u64,
) -> H128 {
    use sp_io::hashing::blake2_128;
    let data = (version_prefix, creator, timestamp, nonce).encode();
    H128::from_hash(blake2_128(&data))
}

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

