//! # AccuWeather Fetcher for OCW
//!
//! Handles fetching precipitation and weather data from AccuWeather API.
//! Uses the historical/24 endpoint for hourly observations.

use alloc::string::String;
use alloc::vec::Vec;
use codec::{Decode, Encode};
use prmx_primitives::{AggStateV3, EventTypeV3};

// ============================================================================
// AccuWeather Response Types
// ============================================================================

/// Parsed observation from AccuWeather
#[derive(Clone, PartialEq, Eq, Debug, Encode, Decode)]
pub struct WeatherObservation {
    /// Unix epoch time of observation
    pub epoch_time: u64,
    /// Precipitation in past hour (mm * 1000)
    pub precip_1h_mm_x1000: i64,
    /// Temperature (celsius * 1000)
    pub temp_c_x1000: i64,
    /// Wind gust speed (m/s * 1000)
    pub wind_gust_mps_x1000: i64,
    /// Precipitation type bitmask (0=none, 1=rain, 2=snow, 4=ice, etc.)
    pub precip_type_mask: u8,
    /// Has precipitation flag
    pub has_precipitation: bool,
}

impl WeatherObservation {
    /// Create observation from parsed JSON values
    pub fn from_parsed(
        epoch_time: u64,
        precip_past_hour_mm: f64,
        temp_celsius: f64,
        wind_gust_kmh: f64,
        precip_type: Option<&str>,
        has_precipitation: bool,
    ) -> Self {
        // Convert to scaled integers
        let precip_1h_mm_x1000 = (precip_past_hour_mm * 1000.0) as i64;
        let temp_c_x1000 = (temp_celsius * 1000.0) as i64;
        // Convert km/h to m/s: divide by 3.6
        let wind_gust_mps_x1000 = ((wind_gust_kmh / 3.6) * 1000.0) as i64;

        // Parse precip type to bitmask
        let precip_type_mask = match precip_type {
            Some("Rain") => 1,
            Some("Snow") => 2,
            Some("Ice") => 4,
            Some("Mixed") => 7,
            _ => 0,
        };

        Self {
            epoch_time,
            precip_1h_mm_x1000,
            temp_c_x1000,
            wind_gust_mps_x1000,
            precip_type_mask,
            has_precipitation,
        }
    }
}

// ============================================================================
// Aggregation Logic
// ============================================================================

/// Update aggregation state with a new observation
pub fn update_agg_state(
    event_type: EventTypeV3,
    current: &AggStateV3,
    observation: &WeatherObservation,
) -> AggStateV3 {
    match (event_type, current) {
        // Precipitation sum: add new precipitation
        (EventTypeV3::PrecipSumGte, AggStateV3::PrecipSum { sum_mm_x1000 }) => {
            AggStateV3::PrecipSum {
                sum_mm_x1000: sum_mm_x1000.saturating_add(observation.precip_1h_mm_x1000),
            }
        }

        // Precipitation 1h max: track maximum
        (EventTypeV3::Precip1hGte, AggStateV3::Precip1hMax { max_1h_mm_x1000 }) => {
            AggStateV3::Precip1hMax {
                max_1h_mm_x1000: (*max_1h_mm_x1000).max(observation.precip_1h_mm_x1000),
            }
        }

        // Temperature max: track maximum
        (EventTypeV3::TempMaxGte, AggStateV3::TempMax { max_c_x1000 }) => {
            AggStateV3::TempMax {
                max_c_x1000: (*max_c_x1000).max(observation.temp_c_x1000),
            }
        }

        // Temperature min: track minimum
        (EventTypeV3::TempMinLte, AggStateV3::TempMin { min_c_x1000 }) => {
            AggStateV3::TempMin {
                min_c_x1000: (*min_c_x1000).min(observation.temp_c_x1000),
            }
        }

        // Wind gust max: track maximum
        (EventTypeV3::WindGustMaxGte, AggStateV3::WindGustMax { max_mps_x1000 }) => {
            AggStateV3::WindGustMax {
                max_mps_x1000: (*max_mps_x1000).max(observation.wind_gust_mps_x1000),
            }
        }

        // Precipitation type occurred: accumulate bitmask
        (EventTypeV3::PrecipTypeOccurred, AggStateV3::PrecipTypeOccurred { mask }) => {
            AggStateV3::PrecipTypeOccurred {
                mask: *mask | observation.precip_type_mask,
            }
        }

        // Type mismatch - return current unchanged
        _ => current.clone(),
    }
}

/// Filter observations to only those within the coverage window
pub fn filter_observations_for_window(
    observations: Vec<WeatherObservation>,
    last_seen_epoch: u64,
    coverage_start: u64,
    coverage_end: u64,
) -> Vec<WeatherObservation> {
    observations
        .into_iter()
        .filter(|obs| {
            obs.epoch_time > last_seen_epoch
                && obs.epoch_time >= coverage_start
                && obs.epoch_time <= coverage_end
        })
        .collect()
}

/// Sort observations by epoch time ascending
pub fn sort_observations(mut observations: Vec<WeatherObservation>) -> Vec<WeatherObservation> {
    observations.sort_by_key(|obs| obs.epoch_time);
    observations
}

// ============================================================================
// AccuWeather URL Building
// ============================================================================

/// Build AccuWeather historical/24 URL
pub fn build_historical_24_url(location_key: &[u8], api_key: &[u8]) -> Vec<u8> {
    let mut url = b"https://dataservice.accuweather.com/currentconditions/v1/".to_vec();
    url.extend_from_slice(location_key);
    url.extend_from_slice(b"/historical/24?apikey=");
    url.extend_from_slice(api_key);
    url.extend_from_slice(b"&details=true");
    url
}

// ============================================================================
// Mock Data for Testing
// ============================================================================

#[cfg(feature = "test-mode")]
pub fn generate_mock_observations(
    start_epoch: u64,
    count: usize,
    precip_mm_per_hour: f64,
) -> Vec<WeatherObservation> {
    (0..count)
        .map(|i| WeatherObservation {
            epoch_time: start_epoch + (i as u64 * 3600),
            precip_1h_mm_x1000: (precip_mm_per_hour * 1000.0) as i64,
            temp_c_x1000: 25_000, // 25°C
            wind_gust_mps_x1000: 5_000, // 5 m/s
            precip_type_mask: if precip_mm_per_hour > 0.0 { 1 } else { 0 },
            has_precipitation: precip_mm_per_hour > 0.0,
        })
        .collect()
}

