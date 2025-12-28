//! # Aggregator for OCW
//!
//! Provides incremental aggregation of weather observations.
//! Re-exports fetcher aggregation functions and adds batch processing.

use alloc::vec::Vec;
use prmx_primitives::{AggStateV3, EventTypeV3};

pub use crate::fetcher::{
    filter_observations_for_window, sort_observations, update_agg_state, WeatherObservation,
};

/// Process a batch of observations and return updated aggregation state
pub fn process_observation_batch(
    event_type: EventTypeV3,
    initial_state: AggStateV3,
    observations: Vec<WeatherObservation>,
) -> (AggStateV3, u64) {
    let sorted = sort_observations(observations);
    let mut current_state = initial_state;
    let mut last_epoch = 0u64;

    for obs in sorted {
        current_state = update_agg_state(event_type, &current_state, &obs);
        last_epoch = obs.epoch_time;
    }

    (current_state, last_epoch)
}

/// Represents the result of processing observations
#[derive(Clone, Debug)]
pub struct AggregationResult {
    /// Updated aggregation state
    pub agg_state: AggStateV3,
    /// Last observation epoch processed
    pub last_epoch: u64,
    /// Number of observations processed
    pub observation_count: usize,
    /// Whether threshold was met (for early trigger)
    pub threshold_met: bool,
}

/// Process observations with threshold checking
pub fn process_with_threshold_check(
    event_type: EventTypeV3,
    threshold_value: i64,
    initial_state: AggStateV3,
    observations: Vec<WeatherObservation>,
    early_trigger: bool,
) -> AggregationResult {
    let sorted = sort_observations(observations.clone());
    let mut current_state = initial_state;
    let mut last_epoch = 0u64;
    let mut threshold_met = false;

    for obs in &sorted {
        current_state = update_agg_state(event_type, &current_state, obs);
        last_epoch = obs.epoch_time;

        // Check threshold after each observation if early trigger enabled
        if early_trigger && !threshold_met {
            threshold_met = check_threshold(&current_state, threshold_value);
        }
    }

    // Final threshold check
    if !threshold_met {
        threshold_met = check_threshold(&current_state, threshold_value);
    }

    AggregationResult {
        agg_state: current_state,
        last_epoch,
        observation_count: sorted.len(),
        threshold_met,
    }
}

/// Check if threshold is met for the current state
fn check_threshold(state: &AggStateV3, threshold: i64) -> bool {
    match state {
        AggStateV3::PrecipSum { sum_mm_x1000 } => *sum_mm_x1000 >= threshold,
        AggStateV3::Precip1hMax { max_1h_mm_x1000 } => *max_1h_mm_x1000 >= threshold,
        AggStateV3::TempMax { max_c_x1000 } => *max_c_x1000 >= threshold,
        AggStateV3::TempMin { min_c_x1000 } => *min_c_x1000 <= threshold,
        AggStateV3::WindGustMax { max_mps_x1000 } => *max_mps_x1000 >= threshold,
        AggStateV3::PrecipTypeOccurred { mask } => (*mask as i64) & threshold != 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_precip_sum_aggregation() {
        let observations = vec![
            WeatherObservation {
                epoch_time: 1000,
                precip_1h_mm_x1000: 5000, // 5mm
                temp_c_x1000: 25000,
                wind_gust_mps_x1000: 5000,
                precip_type_mask: 1,
                has_precipitation: true,
            },
            WeatherObservation {
                epoch_time: 2000,
                precip_1h_mm_x1000: 10000, // 10mm
                temp_c_x1000: 26000,
                wind_gust_mps_x1000: 6000,
                precip_type_mask: 1,
                has_precipitation: true,
            },
        ];

        let initial = AggStateV3::PrecipSum { sum_mm_x1000: 0 };
        let (result, last_epoch) =
            process_observation_batch(EventTypeV3::PrecipSumGte, initial, observations);

        assert_eq!(last_epoch, 2000);
        match result {
            AggStateV3::PrecipSum { sum_mm_x1000 } => assert_eq!(sum_mm_x1000, 15000), // 15mm
            _ => panic!("Wrong state type"),
        }
    }
}

