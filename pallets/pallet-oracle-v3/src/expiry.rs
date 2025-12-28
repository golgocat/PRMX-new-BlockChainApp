//! # Request Expiry Detection for OCW
//!
//! Functions for detecting and triggering expired underwrite requests.
//! This module is used by the OCW to periodically check for expired requests.

use alloc::vec::Vec;
use codec::{Decode, Encode};
use frame_support::sp_runtime::offchain::storage::StorageValueRef;
use prmx_primitives::PolicyId;

// ============================================================================
// Expiry Tracking State
// ============================================================================

/// Key for last expiry check timestamp
pub const LAST_EXPIRY_CHECK_KEY: &[u8] = b"ocw:v3:last_expiry_check";

/// Minimum interval between expiry checks (5 minutes)
pub const EXPIRY_CHECK_INTERVAL_SECS: u64 = 300;

/// Get last expiry check timestamp
pub fn get_last_expiry_check() -> u64 {
    let storage = StorageValueRef::persistent(LAST_EXPIRY_CHECK_KEY);
    storage.get::<u64>().ok().flatten().unwrap_or(0)
}

/// Set last expiry check timestamp
pub fn set_last_expiry_check(timestamp: u64) {
    let storage = StorageValueRef::persistent(LAST_EXPIRY_CHECK_KEY);
    storage.set(&timestamp);
}

/// Check if we should run expiry check
pub fn should_check_expiry(now: u64) -> bool {
    let last_check = get_last_expiry_check();
    now.saturating_sub(last_check) >= EXPIRY_CHECK_INTERVAL_SECS
}

/// Record that expiry check was performed
pub fn record_expiry_check(now: u64) {
    set_last_expiry_check(now);
}

// ============================================================================
// Expiry Detection Logic
// ============================================================================

/// Result of expiry detection for a request
#[derive(Clone, PartialEq, Eq, Debug, Encode, Decode)]
pub struct ExpiredRequest {
    pub request_id: PolicyId,
    pub expires_at: u64,
    pub unfilled_shares: u128,
}

/// Trait for querying expired requests
/// Implemented by the market-v3 pallet
pub trait ExpirySource {
    /// Get all expired requests that need cleanup
    fn get_expired_requests(current_time: u64) -> Vec<PolicyId>;
}

