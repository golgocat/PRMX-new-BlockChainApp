//! # HTTP Client for OCW
//!
//! Provides HTTP client functions for AccuWeather API and Ingest API.
//! Uses sp_runtime::offchain::http for making requests.

use alloc::string::String;
use alloc::vec::Vec;
use alloc::format;
use sp_runtime::offchain::{http, Duration};

use crate::fetcher::WeatherObservation;
use crate::commitment;
use prmx_primitives::PolicyId;

// ============================================================================
// Constants
// ============================================================================

/// AccuWeather API base URL
pub const ACCUWEATHER_BASE_URL: &str = "https://dataservice.accuweather.com";

/// HTTP request timeout (30 seconds)
pub const HTTP_TIMEOUT_MS: u64 = 30_000;

// ============================================================================
// AccuWeather Client
// ============================================================================

/// Fetch 24-hour historical weather data from AccuWeather
pub fn fetch_accuweather_historical(
    location_key: &[u8],
    api_key: &[u8],
) -> Result<Vec<WeatherObservation>, &'static str> {
    let location_key_str = core::str::from_utf8(location_key)
        .map_err(|_| "Invalid location key encoding")?;
    let api_key_str = core::str::from_utf8(api_key)
        .map_err(|_| "Invalid API key encoding")?;
    
    // Build URL for historical/24 endpoint
    let url = format!(
        "{}/currentconditions/v1/{}/historical/24?apikey={}&details=true",
        ACCUWEATHER_BASE_URL,
        location_key_str,
        api_key_str
    );
    
    log::info!(
        target: "prmx-oracle-v3",
        "🌐 Fetching AccuWeather historical/24 for location {}",
        location_key_str
    );
    
    // Make HTTP request
    let request = http::Request::get(&url);
    let timeout = sp_io::offchain::timestamp()
        .add(Duration::from_millis(HTTP_TIMEOUT_MS));
    
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
            target: "prmx-oracle-v3",
            "AccuWeather API returned status {}",
            response.code
        );
        return Err("AccuWeather API error");
    }
    
    let body = response.body().collect::<Vec<u8>>();
    
    // Parse JSON response
    parse_accuweather_historical_response(&body)
}

/// Parse AccuWeather historical/24 JSON response
fn parse_accuweather_historical_response(json: &[u8]) -> Result<Vec<WeatherObservation>, &'static str> {
    let json_str = core::str::from_utf8(json)
        .map_err(|_| "Invalid JSON encoding")?;
    
    let mut observations = Vec::new();
    let mut search_start = 0;
    
    // Parse each observation in the JSON array
    // Format: [{"EpochTime":123,...,"PrecipitationSummary":{"PastHour":{"Metric":{"Value":1.2}}}}]
    while let Some(epoch_pos) = json_str[search_start..].find("\"EpochTime\":") {
        let abs_epoch_pos = search_start + epoch_pos + 12;
        
        // Extract EpochTime value
        let epoch_end = json_str[abs_epoch_pos..]
            .find(|c: char| !c.is_ascii_digit())
            .unwrap_or(0);
        
        let epoch_time = json_str[abs_epoch_pos..abs_epoch_pos + epoch_end]
            .parse::<u64>()
            .unwrap_or(0);
        
        if epoch_time == 0 {
            search_start = abs_epoch_pos + 1;
            continue;
        }
        
        // Find the start of this observation object (the '{' before "EpochTime")
        // Look backwards from epoch_pos to find the opening brace
        let epoch_abs = search_start + epoch_pos;
        let obj_start = json_str[..epoch_abs].rfind('{').unwrap_or(search_start);
        
        // Find the end of this observation object using proper brace matching
        let obs_end = find_object_end(&json_str[obj_start..])
            .map(|e| obj_start + e)
            .unwrap_or(json_str.len());
        
        let obs_slice = &json_str[obj_start..obs_end];
        
        // Parse precipitation (PastHour)
        let precip_mm = extract_precip_past_hour(obs_slice);
        
        // Parse temperature
        let temp_c = extract_temperature(obs_slice);
        
        // Parse wind gust
        let wind_gust_kmh = extract_wind_gust(obs_slice);
        
        // Parse precipitation type
        let (precip_type, has_precip) = extract_precip_type(obs_slice);
        
        let observation = WeatherObservation::from_parsed(
            epoch_time,
            precip_mm,
            temp_c,
            wind_gust_kmh,
            precip_type,
            has_precip,
        );
        
        observations.push(observation);
        search_start = obs_end;
    }
    
    // Log sample observation for debugging
    if !observations.is_empty() {
        let sample = &observations[0];
        log::info!(
            target: "prmx-oracle-v3",
            "📊 Parsed {} observations. Sample: temp={}°C, precip={}mm, wind={}m/s",
            observations.len(),
            sample.temp_c_x1000 as f64 / 1000.0,
            sample.precip_1h_mm_x1000 as f64 / 1000.0,
            sample.wind_gust_mps_x1000 as f64 / 1000.0
        );
    } else {
        log::info!(
            target: "prmx-oracle-v3",
            "📊 Parsed 0 observations from AccuWeather response"
        );
    }
    
    Ok(observations)
}

/// Find the end position of a JSON object, properly handling nested braces
/// Returns the position after the closing brace (including the comma if present)
fn find_object_end(json: &str) -> Option<usize> {
    let mut depth = 0;
    let mut in_string = false;
    let mut escape_next = false;
    
    for (i, c) in json.char_indices() {
        if escape_next {
            escape_next = false;
            continue;
        }
        
        match c {
            '\\' if in_string => escape_next = true,
            '"' => in_string = !in_string,
            '{' if !in_string => depth += 1,
            '}' if !in_string => {
                depth -= 1;
                if depth == 0 {
                    // Found the matching closing brace
                    // Return position after it (and comma if present)
                    if json.len() > i + 1 && json.as_bytes()[i + 1] == b',' {
                        return Some(i + 2);
                    }
                    return Some(i + 1);
                }
            }
            _ => {}
        }
    }
    None
}

/// Helper to extract a numeric value from JSON, handling whitespace variations
/// Searches for the key sequence and extracts the numeric value that follows
fn extract_json_value(json: &str, keys: &[&str]) -> Option<f64> {
    let mut search_pos = 0;
    
    // Find each key in sequence
    for key in keys {
        let key_pattern = format!("\"{}\"", key);
        let pos = json[search_pos..].find(&key_pattern)?;
        search_pos += pos + key_pattern.len();
        
        // Skip whitespace and colon
        let rest = &json[search_pos..];
        let colon_pos = rest.find(':')?;
        search_pos += colon_pos + 1;
    }
    
    // Skip whitespace after the last colon
    let rest = &json[search_pos..];
    let value_start = rest.find(|c: char| c.is_ascii_digit() || c == '-' || c == '.')?;
    let value_slice = &rest[value_start..];
    
    // Find end of numeric value
    let value_end = value_slice
        .find(|c: char| !c.is_ascii_digit() && c != '.' && c != '-')
        .unwrap_or(value_slice.len());
    
    if value_end > 0 {
        value_slice[..value_end].parse::<f64>().ok()
    } else {
        None
    }
}

/// Extract past hour precipitation from observation JSON slice
fn extract_precip_past_hour(json: &str) -> f64 {
    // Try "Precip1hr" first (top-level, simpler)
    if let Some(val) = extract_json_value(json, &["Precip1hr", "Metric", "Value"]) {
        return val;
    }
    // Fallback to "PrecipitationSummary" -> "PastHour" (nested)
    extract_json_value(json, &["PrecipitationSummary", "PastHour", "Metric", "Value"])
        .unwrap_or(0.0)
}

/// Extract temperature from observation JSON slice
fn extract_temperature(json: &str) -> f64 {
    // Look for: "Temperature" -> "Metric" -> "Value"
    let temp = extract_json_value(json, &["Temperature", "Metric", "Value"])
        .unwrap_or(0.0);
    
    // Debug: log temperature extraction
    if temp != 0.0 {
        log::debug!(
            target: "prmx-oracle-v3",
            "🌡️ Parsed temperature: {}°C",
            temp
        );
    }
    
    temp
}

/// Extract wind gust speed from observation JSON slice
fn extract_wind_gust(json: &str) -> f64 {
    // Look for: "WindGust" -> "Speed" -> "Metric" -> "Value"
    extract_json_value(json, &["WindGust", "Speed", "Metric", "Value"])
        .unwrap_or(0.0)
}

/// Extract precipitation type from observation JSON slice
fn extract_precip_type(json: &str) -> (Option<&'static str>, bool) {
    // Check HasPrecipitation flag
    let has_precip = json.contains("\"HasPrecipitation\":true");
    
    // Look for: "PrecipitationType":"Rain"
    if let Some(type_pos) = json.find("\"PrecipitationType\":\"") {
        let type_start = type_pos + 21;
        if let Some(type_end) = json[type_start..].find('"') {
            let precip_type = &json[type_start..type_start + type_end];
            let static_type: Option<&'static str> = match precip_type {
                "Rain" => Some("Rain"),
                "Snow" => Some("Snow"),
                "Ice" => Some("Ice"),
                "Mixed" => Some("Mixed"),
                _ => None,
            };
            return (static_type, has_precip);
        }
    }
    
    (None, has_precip)
}

// ============================================================================
// Ingest API Client
// ============================================================================

/// Send a batch of observations to the Ingest API
pub fn send_observations_batch(
    ingest_url: &[u8],
    hmac_secret: &[u8],
    policy_id: PolicyId,
    location_key: &[u8],
    observations: &[WeatherObservation],
    sample_hashes: &[[u8; 32]],
    commitment_after: [u8; 32],
) -> Result<(), &'static str> {
    let url_str = core::str::from_utf8(ingest_url)
        .map_err(|_| "Invalid Ingest URL encoding")?;
    
    let full_url = format!("{}/ingest/observations/batch", url_str);
    
    // Build JSON payload
    let payload = build_observations_json(
        policy_id,
        location_key,
        observations,
        sample_hashes,
        commitment_after,
    );
    
    // Get current timestamp in milliseconds
    let timestamp = sp_io::offchain::timestamp().unix_millis();
    let timestamp_str = format!("{}", timestamp);
    
    // Generate nonce
    let nonce = commitment::generate_nonce();
    let nonce_hex = hex_encode(&nonce);
    
    // Compute signature: Blake2(secret || payload || timestamp || nonce)
    let mut sign_data = Vec::new();
    sign_data.extend_from_slice(hmac_secret);
    sign_data.extend_from_slice(payload.as_bytes());
    sign_data.extend_from_slice(timestamp_str.as_bytes());
    sign_data.extend_from_slice(nonce_hex.as_bytes());
    
    let signature = commitment::compute_hmac_signature(&[], &sign_data);
    let signature_hex = hex_encode(&signature);
    
    log::info!(
        target: "prmx-oracle-v3",
        "📤 Sending {} observations to Ingest API for policy {}",
        observations.len(),
        policy_id
    );
    
    // Make HTTP POST request - use slice reference for body
    let body_bytes = payload.as_bytes();
    let request = http::Request::post(&full_url, alloc::vec![body_bytes])
        .add_header("Content-Type", "application/json")
        .add_header("X-HMAC-Signature", &signature_hex)
        .add_header("X-Timestamp", &timestamp_str)
        .add_header("X-Nonce", &nonce_hex);
    
    let timeout = sp_io::offchain::timestamp()
        .add(Duration::from_millis(HTTP_TIMEOUT_MS));
    
    let pending = request
        .deadline(timeout)
        .send()
        .map_err(|_| "Failed to send HTTP request")?;
    
    let response = pending
        .try_wait(timeout)
        .map_err(|_| "HTTP request timeout")?
        .map_err(|_| "HTTP request failed")?;
    
    if response.code != 200 && response.code != 201 {
        log::warn!(
            target: "prmx-oracle-v3",
            "Ingest API returned status {}",
            response.code
        );
        return Err("Ingest API error");
    }
    
    log::info!(
        target: "prmx-oracle-v3",
        "✅ Successfully sent observations to Ingest API"
    );
    
    Ok(())
}

/// Send a snapshot to the Ingest API
pub fn send_snapshot(
    ingest_url: &[u8],
    hmac_secret: &[u8],
    policy_id: PolicyId,
    observed_until: u64,
    agg_state_encoded: &[u8],
    commitment: [u8; 32],
) -> Result<(), &'static str> {
    let url_str = core::str::from_utf8(ingest_url)
        .map_err(|_| "Invalid Ingest URL encoding")?;
    
    let full_url = format!("{}/ingest/snapshots", url_str);
    
    // Build JSON payload
    let payload = build_snapshot_json(
        policy_id,
        observed_until,
        agg_state_encoded,
        commitment,
    );
    
    // Get current timestamp in milliseconds
    let timestamp = sp_io::offchain::timestamp().unix_millis();
    let timestamp_str = format!("{}", timestamp);
    
    // Generate nonce
    let nonce = commitment::generate_nonce();
    let nonce_hex = hex_encode(&nonce);
    
    // Compute signature: Blake2(secret || payload || timestamp || nonce)
    let mut sign_data = Vec::new();
    sign_data.extend_from_slice(hmac_secret);
    sign_data.extend_from_slice(payload.as_bytes());
    sign_data.extend_from_slice(timestamp_str.as_bytes());
    sign_data.extend_from_slice(nonce_hex.as_bytes());
    
    let signature = commitment::compute_hmac_signature(&[], &sign_data);
    let signature_hex = hex_encode(&signature);
    
    log::info!(
        target: "prmx-oracle-v3",
        "📤 Sending snapshot to Ingest API for policy {}",
        policy_id
    );
    
    // Make HTTP POST request - use slice reference for body
    let body_bytes = payload.as_bytes();
    let request = http::Request::post(&full_url, alloc::vec![body_bytes])
        .add_header("Content-Type", "application/json")
        .add_header("X-HMAC-Signature", &signature_hex)
        .add_header("X-Timestamp", &timestamp_str)
        .add_header("X-Nonce", &nonce_hex);
    
    let timeout = sp_io::offchain::timestamp()
        .add(Duration::from_millis(HTTP_TIMEOUT_MS));
    
    let pending = request
        .deadline(timeout)
        .send()
        .map_err(|_| "Failed to send HTTP request")?;
    
    let response = pending
        .try_wait(timeout)
        .map_err(|_| "HTTP request timeout")?
        .map_err(|_| "HTTP request failed")?;
    
    if response.code != 200 && response.code != 201 {
        log::warn!(
            target: "prmx-oracle-v3",
            "Ingest API returned status {}",
            response.code
        );
        return Err("Ingest API error");
    }
    
    log::info!(
        target: "prmx-oracle-v3",
        "✅ Successfully sent snapshot to Ingest API"
    );
    
    Ok(())
}

// ============================================================================
// JSON Building Helpers
// ============================================================================

/// Build JSON payload for observations batch
fn build_observations_json(
    policy_id: PolicyId,
    location_key: &[u8],
    observations: &[WeatherObservation],
    sample_hashes: &[[u8; 32]],
    commitment_after: [u8; 32],
) -> String {
    let location_key_str = core::str::from_utf8(location_key).unwrap_or("");
    let commitment_hex = hex_encode(&commitment_after);
    
    let mut samples_json = String::from("[");
    for (i, obs) in observations.iter().enumerate() {
        if i > 0 {
            samples_json.push_str(",");
        }
        let sample_hash = sample_hashes.get(i).map(|h| hex_encode(h)).unwrap_or_default();
        samples_json.push_str(&format!(
            r#"{{"epoch_time":{},"precip_1h_mm_x1000":{},"temp_c_x1000":{},"wind_gust_mps_x1000":{},"precip_type_mask":{},"sample_hash":"{}"}}"#,
            obs.epoch_time,
            obs.precip_1h_mm_x1000,
            obs.temp_c_x1000,
            obs.wind_gust_mps_x1000,
            obs.precip_type_mask,
            sample_hash
        ));
    }
    samples_json.push_str("]");
    
    format!(
        r#"{{"policy_id":"{}","location_key":"{}","samples":{},"commitment_after":"{}"}}"#,
        policy_id,
        location_key_str,
        samples_json,
        commitment_hex
    )
}

/// Build JSON payload for snapshot
fn build_snapshot_json(
    policy_id: PolicyId,
    observed_until: u64,
    agg_state_encoded: &[u8],
    commitment: [u8; 32],
) -> String {
    let agg_state_hex = hex_encode(agg_state_encoded);
    let commitment_hex = hex_encode(&commitment);
    
    format!(
        r#"{{"policy_id":"{}","observed_until":{},"agg_state":"{}","commitment":"{}"}}"#,
        policy_id,
        observed_until,
        agg_state_hex,
        commitment_hex
    )
}

// ============================================================================
// Hex Encoding Helper
// ============================================================================

/// Encode bytes to hex string
fn hex_encode(bytes: &[u8]) -> String {
    const HEX_CHARS: &[u8; 16] = b"0123456789abcdef";
    let mut result = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        result.push(HEX_CHARS[(byte >> 4) as usize] as char);
        result.push(HEX_CHARS[(byte & 0x0f) as usize] as char);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_hex_encode() {
        assert_eq!(hex_encode(&[0xde, 0xad, 0xbe, 0xef]), "deadbeef");
        assert_eq!(hex_encode(&[0x00, 0xff]), "00ff");
    }
    
    #[test]
    fn test_extract_precip_past_hour() {
        let json = r#""PastHour":{"Metric":{"Value":2.5,"Unit":"mm"}}"#;
        assert!((extract_precip_past_hour(json) - 2.5).abs() < 0.001);
    }
    
    #[test]
    fn test_extract_temperature() {
        let json = r#""Temperature":{"Metric":{"Value":25.3,"Unit":"C"}}"#;
        assert!((extract_temperature(json) - 25.3).abs() < 0.001);
    }
}

