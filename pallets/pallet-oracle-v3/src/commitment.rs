//! # Commitment Hash Chain for OCW
//!
//! Implements the commitment hash chain that binds observations to policies.
//! Provides tamper evidence and recovery verification.

use alloc::vec::Vec;
use codec::Encode;
use prmx_primitives::{EventSpecV3, PolicyId};
use sp_core::Hasher;
use sp_runtime::traits::BlakeTwo256;

use crate::fetcher::WeatherObservation;

// ============================================================================
// Commitment Chain Functions
// ============================================================================

/// Compute the initial commitment seed from policy parameters.
/// This binds the commitment chain to the specific policy.
///
/// Format: blake2_256(b"prmx_v3:" || policy_id || event_spec || location_id || start_at || end_at)
pub fn compute_initial_commitment(
    policy_id: PolicyId,
    event_spec: &EventSpecV3,
    location_id: u64,
    coverage_start: u64,
    coverage_end: u64,
) -> [u8; 32] {
    let mut data = Vec::new();
    data.extend_from_slice(b"prmx_v3:");
    data.extend_from_slice(&policy_id.to_le_bytes());
    data.extend_from_slice(&event_spec.encode());
    data.extend_from_slice(&location_id.to_le_bytes());
    data.extend_from_slice(&coverage_start.to_le_bytes());
    data.extend_from_slice(&coverage_end.to_le_bytes());

    BlakeTwo256::hash(&data).into()
}

/// Compute sample hash from an observation.
///
/// Format: blake2_256(epoch_time || normalized_value)
pub fn compute_sample_hash(observation: &WeatherObservation) -> [u8; 32] {
    let mut data = Vec::new();
    data.extend_from_slice(&observation.epoch_time.to_le_bytes());
    // Use precip as the primary value for commitment
    data.extend_from_slice(&observation.precip_1h_mm_x1000.to_le_bytes());
    data.extend_from_slice(&observation.temp_c_x1000.to_le_bytes());
    data.extend_from_slice(&observation.wind_gust_mps_x1000.to_le_bytes());
    data.push(observation.precip_type_mask);

    BlakeTwo256::hash(&data).into()
}

/// Extend the commitment chain with a new observation.
///
/// Format: commitment_n = blake2_256(commitment_{n-1} || sample_hash)
pub fn extend_commitment(current_commitment: [u8; 32], observation: &WeatherObservation) -> [u8; 32] {
    let sample_hash = compute_sample_hash(observation);

    let mut data = Vec::new();
    data.extend_from_slice(&current_commitment);
    data.extend_from_slice(&sample_hash);

    BlakeTwo256::hash(&data).into()
}

/// Process a batch of observations and return the final commitment.
pub fn process_commitment_batch(
    initial_commitment: [u8; 32],
    observations: &[WeatherObservation],
) -> ([u8; 32], Vec<[u8; 32]>) {
    let mut current = initial_commitment;
    let mut sample_hashes = Vec::with_capacity(observations.len());

    for obs in observations {
        let sample_hash = compute_sample_hash(obs);
        sample_hashes.push(sample_hash);
        current = extend_commitment(current, obs);
    }

    (current, sample_hashes)
}

// ============================================================================
// Ingest API Client Types
// ============================================================================

/// Observation batch to send to Ingest API
#[derive(Clone, Debug, Encode)]
pub struct ObservationBatch {
    /// Oracle ID (node identity)
    pub oracle_id: Vec<u8>,
    /// Policy ID
    pub policy_id: PolicyId,
    /// AccuWeather location key
    pub location_key: Vec<u8>,
    /// Event type string
    pub event_type: Vec<u8>,
    /// Individual samples
    pub samples: Vec<SampleRecord>,
    /// Commitment after this batch
    pub commitment_after: [u8; 32],
    /// Timestamp when sent
    pub sent_at: u64,
    /// Nonce for idempotency
    pub nonce: [u8; 16],
}

/// Individual sample record
#[derive(Clone, Debug, Encode)]
pub struct SampleRecord {
    /// Epoch time of observation
    pub epoch_time: u64,
    /// Normalized fields as key-value pairs
    pub normalized_fields: Vec<(Vec<u8>, i64)>,
    /// Sample hash
    pub sample_hash: [u8; 32],
}

/// Snapshot payload to send to Ingest API
#[derive(Clone, Debug, Encode)]
pub struct SnapshotPayload {
    /// Oracle ID
    pub oracle_id: Vec<u8>,
    /// Policy ID
    pub policy_id: PolicyId,
    /// Observed until timestamp
    pub observed_until: u64,
    /// Aggregation state (encoded)
    pub agg_state: Vec<u8>,
    /// Current commitment
    pub commitment: [u8; 32],
    /// Created at timestamp
    pub created_at: u64,
    /// Nonce for idempotency
    pub nonce: [u8; 16],
}

// ============================================================================
// HMAC Signing
// ============================================================================

/// Compute HMAC-SHA256 signature for a payload
pub fn compute_hmac_signature(secret: &[u8], payload: &[u8]) -> [u8; 32] {
    // Simple HMAC construction: H(key || payload)
    // In production, use proper HMAC implementation
    let mut data = Vec::new();
    data.extend_from_slice(secret);
    data.extend_from_slice(payload);

    BlakeTwo256::hash(&data).into()
}

/// Generate a random nonce for request idempotency
pub fn generate_nonce() -> [u8; 16] {
    // In production, use proper random source
    // For now, use timestamp-based pseudo-random
    let timestamp = sp_io::offchain::timestamp().unix_millis();
    let mut nonce = [0u8; 16];
    nonce[0..8].copy_from_slice(&timestamp.to_le_bytes());
    // Add some entropy from block hash if available
    let random_seed = sp_io::offchain::random_seed();
    nonce[8..16].copy_from_slice(&random_seed[0..8]);
    nonce
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use prmx_primitives::{EventTypeV3, ThresholdV3, UnitV3};

    #[test]
    fn test_initial_commitment_deterministic() {
        let event_spec = EventSpecV3 {
            event_type: EventTypeV3::PrecipSumGte,
            threshold: ThresholdV3 {
                value: 50_000,
                unit: UnitV3::MmX1000,
            },
            early_trigger: true,
        };

        let c1 = compute_initial_commitment(1, &event_spec, 100, 1000, 2000);
        let c2 = compute_initial_commitment(1, &event_spec, 100, 1000, 2000);

        assert_eq!(c1, c2);
    }

    #[test]
    fn test_commitment_chain_extension() {
        let initial = [0u8; 32];
        let obs = WeatherObservation {
            epoch_time: 1000,
            precip_1h_mm_x1000: 5000,
            temp_c_x1000: 25000,
            wind_gust_mps_x1000: 5000,
            precip_type_mask: 1,
            has_precipitation: true,
        };

        let extended = extend_commitment(initial, &obs);
        assert_ne!(extended, initial);

        // Same observation should produce same extension
        let extended2 = extend_commitment(initial, &obs);
        assert_eq!(extended, extended2);
    }
}

