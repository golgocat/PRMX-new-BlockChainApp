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

