//! # Offchain Worker for Oracle V3
//!
//! Handles policy polling, AccuWeather fetching, aggregation, and snapshot/report submission.
//!
//! ## Key Features
//!
//! - Poll active policies from on-chain storage
//! - Fetch AccuWeather historical/24 data
//! - Incrementally aggregate observations
//! - Maintain commitment hash chain
//! - Send observations to Ingest API
//! - Submit on-chain snapshots and final reports

use alloc::vec::Vec;
use codec::{Decode, Encode};
use frame_support::sp_runtime::offchain::storage::StorageValueRef;
use prmx_primitives::{
    AggStateV3, EventSpecV3, PolicyId, PolicyOracleStateV3, PolicyStatusV3,
    V3_SNAPSHOT_INTERVAL_FINAL_SECS, V3_SNAPSHOT_INTERVAL_SECS,
};
use sp_core::H256;

// ============================================================================
// OCW Local State Storage Keys
// ============================================================================

/// Prefix for OCW v3 state keys
pub const OCW_V3_PREFIX: &[u8] = b"ocw:v3:";

/// Key for HMAC secret
pub const INGEST_HMAC_SECRET_KEY: &[u8] = b"ocw:v3:ingest_hmac_secret";

/// Key for AccuWeather API key
pub const ACCUWEATHER_API_KEY: &[u8] = b"ocw:v3:accuweather_api_key";

/// Key for Ingest API URL
pub const INGEST_API_URL_KEY: &[u8] = b"ocw:v3:ingest_api_url";

// ============================================================================
// OCW Policy State
// ============================================================================

/// Local state stored per policy in offchain storage
#[derive(Clone, PartialEq, Eq, Debug, Encode, Decode)]
pub struct OcwPolicyState {
    /// Last seen observation epoch time
    pub last_seen_epoch: u64,
    /// Current aggregation state
    pub agg_state: AggStateV3,
    /// Current commitment hash
    pub commitment: [u8; 32],
    /// Last snapshot epoch time
    pub last_snapshot_epoch: u64,
    /// Last snapshot sent timestamp
    pub last_snapshot_sent_at: u64,
    /// Last observation batch sent epoch
    pub last_observation_sent_epoch: u64,
    /// Backoff state for errors
    pub backoff: BackoffState,
    /// Whether policy is finalized locally
    pub finalized: bool,
}

impl Default for OcwPolicyState {
    fn default() -> Self {
        Self {
            last_seen_epoch: 0,
            agg_state: AggStateV3::default(),
            commitment: [0u8; 32],
            last_snapshot_epoch: 0,
            last_snapshot_sent_at: 0,
            last_observation_sent_epoch: 0,
            backoff: BackoffState::default(),
            finalized: false,
        }
    }
}

/// Backoff state for error handling
#[derive(Clone, PartialEq, Eq, Debug, Encode, Decode, Default)]
pub struct BackoffState {
    /// Number of consecutive errors
    pub error_count: u32,
    /// Next retry timestamp
    pub retry_after: u64,
    /// Last error type
    pub last_error: Option<OcwError>,
}

/// OCW error types for backoff tracking
#[derive(Clone, PartialEq, Eq, Debug, Encode, Decode)]
pub enum OcwError {
    AccuWeatherFetch,
    IngestApi,
    ChainSubmission,
    ParseError,
}

impl OcwPolicyState {
    /// Generate storage key for a policy
    pub fn storage_key(policy_id: PolicyId) -> Vec<u8> {
        let mut key = OCW_V3_PREFIX.to_vec();
        key.extend_from_slice(b"policy:");
        key.extend_from_slice(&policy_id.to_le_bytes());
        key.extend_from_slice(b":state");
        key
    }

    /// Load state from offchain storage
    pub fn load(policy_id: PolicyId) -> Option<Self> {
        let key = Self::storage_key(policy_id);
        let storage = StorageValueRef::persistent(&key);
        storage.get::<Self>().ok().flatten()
    }

    /// Save state to offchain storage
    pub fn save(&self, policy_id: PolicyId) {
        let key = Self::storage_key(policy_id);
        let storage = StorageValueRef::persistent(&key);
        storage.set(self);
    }

    /// Initialize from on-chain oracle state
    pub fn from_on_chain_state(state: &PolicyOracleStateV3) -> Self {
        Self {
            last_seen_epoch: state.observed_until,
            agg_state: state.agg_state.clone(),
            commitment: state.commitment,
            last_snapshot_epoch: state.observed_until,
            last_snapshot_sent_at: 0,
            last_observation_sent_epoch: state.observed_until,
            backoff: BackoffState::default(),
            finalized: state.status != PolicyStatusV3::Active,
        }
    }

    /// Check if we should send a snapshot
    pub fn should_send_snapshot(&self, now_epoch: u64, coverage_end: u64) -> bool {
        if self.finalized {
            return false;
        }

        let time_since_last = now_epoch.saturating_sub(self.last_snapshot_epoch);

        // Normal interval: every 6 hours
        if time_since_last >= V3_SNAPSHOT_INTERVAL_SECS {
            return true;
        }

        // Final 24 hours: every 1 hour
        let time_to_end = coverage_end.saturating_sub(now_epoch);
        if time_to_end <= 24 * 3600 && time_since_last >= V3_SNAPSHOT_INTERVAL_FINAL_SECS {
            return true;
        }

        false
    }

    /// Check if we're in backoff
    pub fn is_in_backoff(&self, now: u64) -> bool {
        now < self.backoff.retry_after
    }

    /// Record an error and compute next retry time
    pub fn record_error(&mut self, error: OcwError, now: u64) {
        self.backoff.error_count = self.backoff.error_count.saturating_add(1);
        self.backoff.last_error = Some(error);

        // Exponential backoff: 30s, 60s, 120s, 240s, max 600s
        let base_delay = 30u64;
        let multiplier = 2u64.pow(self.backoff.error_count.min(5));
        let delay = (base_delay * multiplier).min(600);

        self.backoff.retry_after = now + delay;
    }

    /// Clear error state on success
    pub fn clear_error(&mut self) {
        self.backoff = BackoffState::default();
    }
}

// ============================================================================
// Snapshot Scheduling
// ============================================================================

/// Snapshot decision result
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum SnapshotDecision {
    /// No action needed
    None,
    /// Send periodic snapshot
    SendSnapshot,
    /// Send final report - triggered
    SendFinalTrigger,
    /// Send final report - matured
    SendFinalMaturity,
}

/// Determine what snapshot action to take
pub fn decide_snapshot_action(
    state: &OcwPolicyState,
    event_spec: &EventSpecV3,
    now_epoch: u64,
    coverage_start: u64,
    coverage_end: u64,
) -> SnapshotDecision {
    if state.finalized {
        return SnapshotDecision::None;
    }

    // Check if past coverage end
    if now_epoch > coverage_end {
        return SnapshotDecision::SendFinalMaturity;
    }

    // Check if we're in coverage window
    if now_epoch < coverage_start {
        return SnapshotDecision::None;
    }

    // Check for early trigger
    if event_spec.early_trigger {
        if crate::pallet::Pallet::<()>::evaluate_threshold_static(event_spec, &state.agg_state) {
            return SnapshotDecision::SendFinalTrigger;
        }
    }

    // Check for periodic snapshot
    if state.should_send_snapshot(now_epoch, coverage_end) {
        return SnapshotDecision::SendSnapshot;
    }

    SnapshotDecision::None
}

// ============================================================================
// Secret Provisioning
// ============================================================================

/// Get HMAC secret from offchain storage
pub fn get_hmac_secret() -> Option<Vec<u8>> {
    let storage = StorageValueRef::persistent(INGEST_HMAC_SECRET_KEY);
    storage.get::<Vec<u8>>().ok().flatten()
}

/// Get AccuWeather API key from offchain storage
pub fn get_accuweather_api_key() -> Option<Vec<u8>> {
    let storage = StorageValueRef::persistent(ACCUWEATHER_API_KEY);
    storage.get::<Vec<u8>>().ok().flatten()
}

/// Get Ingest API URL from offchain storage
pub fn get_ingest_api_url() -> Option<Vec<u8>> {
    let storage = StorageValueRef::persistent(INGEST_API_URL_KEY);
    storage.get::<Vec<u8>>().ok().flatten()
}

/// Set HMAC secret (called by setup script via RPC)
pub fn set_hmac_secret(secret: Vec<u8>) {
    let storage = StorageValueRef::persistent(INGEST_HMAC_SECRET_KEY);
    storage.set(&secret);
}

/// Set AccuWeather API key (called by setup script via RPC)
pub fn set_accuweather_api_key(key: Vec<u8>) {
    let storage = StorageValueRef::persistent(ACCUWEATHER_API_KEY);
    storage.set(&key);
}

/// Set Ingest API URL (called by setup script via RPC)
pub fn set_ingest_api_url(url: Vec<u8>) {
    let storage = StorageValueRef::persistent(INGEST_API_URL_KEY);
    storage.set(&url);
}

// ============================================================================
// Helper trait for static evaluation
// ============================================================================

impl crate::pallet::Pallet<()> {
    /// Static version of evaluate_threshold for OCW
    pub fn evaluate_threshold_static(event_spec: &EventSpecV3, agg_state: &AggStateV3) -> bool {
        use prmx_primitives::EventTypeV3;
        
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
                (*mask as i64) & threshold != 0
            }
            _ => false,
        }
    }
}

