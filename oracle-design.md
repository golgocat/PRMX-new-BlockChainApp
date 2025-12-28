# PRMX Oracle Design – AccuWeather, Market-Bound Locations

**V1: Rainfall 24h Rolling Sum | V2: Cumulative Rainfall with Early Trigger**

> This document is the **single source of truth** for the PRMX oracle system, including:
> - **V1** (Sections 1-16): On-chain oracle with 24h rolling rainfall sum
> - **V2** (Sections 17-25): Off-chain oracle with cumulative rainfall and early trigger

It replaces the previous generic "location-based" design:

- Locations are now **bound to markets**, not per-policy coordinates.
- DAO configures an approximate center (lat/lon) when creating a market.
- An offchain worker resolves the closest AccuWeather Location Key once.
- All rainfall ingestion and settlement are done per market, using that key.

**Target:**

- Polkadot SDK `polkadot-stable2506-2`
- FRAME v2 style
- **Current mode: Standalone dev chain** (Aura + Grandpa consensus)
- Integrates with:
  - `pallet_prmx_markets`
  - `pallet_prmx_policy`
  - `pallet_prmx_quote`
  - `pallet_prmx_xcm_capital` (for capital management)

**AccuWeather API Key:**

- The real key must **never** be hardcoded in the runtime.
- Use a placeholder like `<ACCUWEATHER_API_KEY>` and pass it via node config / env.
- For dev/test mode, a fallback test key may be defined.

---

## 1. Conceptual Model

### 1.1 DAO Creates a Market

When calling the DAO-only market creation extrinsic, the DAO specifies:

- `name` (e.g., "Manila")
- `center_latitude`, `center_longitude` (approximate, scaled 1e6)
- `strike_value`, window rules, etc.

### 1.2 Offchain Worker Resolves AccuWeather Location

Oracle offchain worker scans markets whose AccuWeather location is not yet set.

For each such market:

1. Calls AccuWeather's Geoposition Search API with the center lat/lon.
2. Gets the best matching Location Key.
3. Writes that binding on-chain via an oracle extrinsic.

### 1.3 Rainfall Ingestion

Another offchain worker (or the same one) periodically:

1. Uses the bound AccuWeather Location Key for each market.
2. Calls AccuWeather current conditions API with details.
3. Extracts 24-hour precipitation data and calls `submit_rainfall(...)`.

### 1.4 Settlement

- Policies reference `market_id` and coverage window.
- At `settle_policy`, PRMX checks rainfall per market using the bound location:
  - *"Did 24h rainfall ever exceed strike during this policy's coverage window?"*

**Customers do not specify lat/lon for oracle purposes. They choose a market, such as "Manila".**

> **Note:** Policies may store reference lat/lon from the quote request for display purposes, but this is not used for oracle/settlement logic.

---

## 2. Types and Aliases

To reuse the previous oracle interface, we treat `LocationId` as `MarketId`.

```rust
pub type MarketId = u64;
pub type LocationId = MarketId;      // alias: one location per market

pub type Millimeters = u32;          // scaled by 10, so 12.5mm = 125
pub type BucketIndex = u64;
```

### AccuWeather Types

```rust
pub type AccuWeatherLocationKey = Vec<u8>; // e.g. b"123456"
```

### Time Discretization

```rust
pub const BUCKET_INTERVAL_SECS: u64 = 3600;         // 1-hour buckets
pub const ROLLING_WINDOW_SECS: u64 = 24 * 3600;     // 24 hours
```

### Helper Functions

```rust
fn bucket_index_for_timestamp(ts: u64) -> BucketIndex {
    ts / BUCKET_INTERVAL_SECS
}

fn bucket_start_time(idx: BucketIndex) -> u64 {
    idx * BUCKET_INTERVAL_SECS
}
```

---

## 3. Market-Bound Location Config

The oracle pallet maintains a location binding per market.

```rust
pub struct MarketLocationInfo<T: Config> {
    pub accuweather_location_key: BoundedVec<u8, T::MaxLocationKeyLength>,
    pub center_latitude: i32,      // copied from MarketInfo at bind time
    pub center_longitude: i32,     // copied from MarketInfo at bind time
}
```

**Storage:**

```rust
MarketLocationConfig: map MarketId -> Option<MarketLocationInfo>;
```

### Lifecycle

1. **When DAO creates a market:**
   - The market pallet stores `name`, `center_latitude`, `center_longitude`.
   - `accuweather_location_key` in the market pallet is initially `None` (or not stored there at all).

2. **Oracle offchain worker:**
   - Resolves an AccuWeather Location Key.
   - Calls `set_market_location_key(market_id, key)` extrinsic.
   - The oracle pallet stores the final binding in `MarketLocationConfig`.

3. **This binding is used for all future rainfall ingestion and settlement for that market.**

---

## 4. AccuWeather APIs Used

The oracle integrations assume:

### 4.1 Geoposition Search (used once per market)

- **Base URL:** `https://dataservice.accuweather.com`
- **Endpoint:**

```http
GET /locations/v1/cities/geoposition/search
    ?apikey=<ACCUWEATHER_API_KEY>
    &q={lat},{lon}
```

- **Input:**
  - `lat`, `lon` as floats (converted from `center_latitude` / `center_longitude`).
- **Result:**
  - JSON with a `Key` field used as `accuweather_location_key`.

### 4.2 Current Conditions for Rainfall Ingestion

- **Endpoint for current conditions with precipitation details:**

```http
GET /currentconditions/v1/{locationKey}
    ?apikey=<ACCUWEATHER_API_KEY>
    &details=true
```

- **Response includes:**
  - `EpochTime` for timestamp (unix seconds)
  - `PrecipitationSummary.Past24Hours.Metric.Value` - total rainfall in mm over the past 24 hours

- **Parsing:**
  - Extract `EpochTime` as the observation timestamp
  - Extract `PrecipitationSummary.Past24Hours.Metric.Value` as rainfall in mm
  - Convert to scaled integer: `rainfall_mm = (value * 10) as u32`

> **Note:** This endpoint provides 24-hour precipitation summary, which is available on the AccuWeather free/starter tier. The historical hourly endpoint (`/historical/24`) requires a premium subscription.

Node-side workers are responsible for choosing the exact endpoint and field.
On-chain we only see normalized `timestamp` and `rainfall_mm`.

> **Note:** The real API key is not committed to the repo. The offchain worker loads it from configuration / environment.

---

## 5. Storage Structures

### 5.1 Market Location Binding

As above:

```rust
MarketLocationConfig: map MarketId -> Option<MarketLocationInfo>;
```

### 5.2 Hourly Rainfall Buckets

Same concept as before, now indexed by `MarketId` (alias `LocationId`).

```rust
pub struct RainBucket {
    pub timestamp: u64,           // aligned bucket start
    pub rainfall_mm: Millimeters, // rainfall in that hour (scaled by 10)
    pub block_number: u32,        // block when data was recorded
}

RainBuckets: double_map (LocationId, BucketIndex) -> RainBucket;
```

**Interpretation:**

- For market `market_id`, and bucket index `idx`, the record represents rainfall for `[bucket_start_time(idx), bucket_start_time(idx) + 3600)`.
- `block_number` tracks when the data was written on-chain (useful for auditing and debugging).

### 5.3 Rolling 24h State Per Market

```rust
pub struct RollingWindowState {
    pub last_bucket_index: BucketIndex,
    pub oldest_bucket_index: BucketIndex,
    pub rolling_sum_mm: Millimeters, // total rainfall in last 24h window
}

RollingState: map LocationId -> Option<RollingWindowState>;
```

**Interpretation:**

- For a market, `rolling_sum_mm` is the sum of all hourly buckets within the last 24 hours window, relative to `last_bucket_index`.

### 5.4 Oracle Providers

Authorized accounts that can submit rainfall data:

```rust
OracleProviders: map AccountId -> bool;
```

---

## 6. Config and Origins

### Config Trait

```rust
pub trait Config: frame_system::Config 
    + pallet_prmx_markets::Config
    + frame_system::offchain::CreateSignedTransaction<Call<Self>>
{
    type RuntimeEvent: From<Event<Self>>
        + IsType<<Self as frame_system::Config>::RuntimeEvent>;

    /// Who can ingest rainfall and bind AccuWeather locations.
    type OracleOrigin: EnsureOrigin<Self::RuntimeOrigin>;

    /// Who can govern configuration (if needed).
    type GovernanceOrigin: EnsureOrigin<Self::RuntimeOrigin>;

    /// Access to markets pallet for center coordinates
    type MarketsApi: MarketsAccess;

    /// Access to policy pallet for automatic settlement
    type PolicySettlement: PolicySettlement<Self::AccountId>;

    /// Maximum length of AccuWeather location key
    #[pallet::constant]
    type MaxLocationKeyLength: Get<u32>;

    type WeightInfo: WeightInfo;
}
```

### Typical Choices

| Origin | Implementation |
|--------|----------------|
| `OracleOrigin` | `EnsureSignedBy<OracleOperators, AccountId>` or `EnsureRoot` |
| `GovernanceOrigin` | `EnsureSignedBy<DaoAdminAccount, AccountId>` or `EnsureRoot` |

---

## 7. Market Location Binding Flow

### 7.1 Governance / Oracle Extrinsic

In `pallet_prmx_oracle` implement:

```rust
fn set_market_location_key(
    origin,
    market_id: MarketId,
    accuweather_location_key: Vec<u8>,
)
```

**Steps:**

1. Ensure origin satisfies `OracleOrigin` or `GovernanceOrigin`.

2. Use `MarketsApi` to read market info:
   - Confirm the market exists.
   - Retrieve `center_latitude`, `center_longitude`.

3. Convert key to bounded vec:

   ```rust
   let bounded_key: BoundedVec<u8, T::MaxLocationKeyLength> = accuweather_location_key
       .try_into()
       .map_err(|_| Error::<T>::LocationKeyTooLong)?;
   ```

4. Write:

   ```rust
   MarketLocationConfig::<T>::insert(
       market_id,
       MarketLocationInfo {
           accuweather_location_key: bounded_key,
           center_latitude,
           center_longitude,
       },
   );
   ```

5. Emit event:

   ```rust
   MarketLocationBound { market_id, accuweather_location_key }
   ```

### 7.2 Offchain Worker: Resolving AccuWeather Location

An offchain worker in `pallet_prmx_oracle` should:

1. Iterate over a small number of markets per block (for throttling).

2. For each market where:
   - No entry exists in `MarketLocationConfig`, **and**
   - `MarketInfo` has valid `center_latitude` / `center_longitude`:

   a) Convert lat/lon to floats:

   ```rust
   let lat = center_latitude as f64 / 1_000_000.0;
   let lon = center_longitude as f64 / 1_000_000.0;
   ```

   b) Build HTTP request:

   ```http
   GET https://dataservice.accuweather.com/locations/v1/cities/geoposition/search
       ?apikey=<ACCUWEATHER_API_KEY>&q={lat},{lon}
   ```

   c) Parse JSON response, extract `Key` (string) as `accuweather_location_key`.

   d) Submit a signed transaction calling:

   ```rust
   set_market_location_key(market_id, key_bytes)
   ```

> **Note:** The API key is read from offchain configuration (environment variable or offchain storage). It is **not** stored on-chain.

---

## 8. Rainfall Ingestion Per Market

### 8.1 Timing Constants

```rust
pub const BLOCKS_PER_HOUR: u32 = 600;            // 6-second blocks
pub const BLOCKS_PER_SETTLEMENT_CHECK: u32 = 10; // Check settlements every 10 blocks
```

### 8.2 Ingestion Pattern (Signed OCW Transactions)

The offchain worker automatically fetches rainfall data using **signed transactions**:

1. **Frequency**: Fetches every `BLOCKS_PER_HOUR` blocks (approximately 1 hour)

2. **Key Management**:
   - Oracle authority key is loaded via node keystore
   - `KeyTypeId = *b"orcl"` identifies oracle keys
   - DAO sponsors the oracle authority account with funds for transaction fees

3. **For each market** with `MarketLocationConfig[market_id]` set:
   - Take `accuweather_location_key`
   - Call AccuWeather endpoint:

   ```http
   GET /currentconditions/v1/{locationKey}
       ?apikey=<ACCUWEATHER_API_KEY>&details=true
   ```

4. Parse response:
   - Extract `EpochTime` (unix seconds) as observation timestamp
   - Extract `PrecipitationSummary.Past24Hours.Metric.Value` as rainfall in mm

5. **Submit signed transaction**:

   ```rust
   submit_rainfall_from_ocw(market_id, timestamp, rainfall_mm)
   ```

### 8.3 Signed Transaction Flow

The runtime must implement `CreateSignedTransaction<Call<Self>>`:

```rust
impl frame_system::offchain::CreateSignedTransaction<pallet_prmx_oracle::Call<Runtime>> 
    for Runtime 
{
    fn create_signed_transaction<C: AppCrypto<Self::Public, Self::Signature>>(
        call: pallet_prmx_oracle::Call<Runtime>,
        public: Self::Public,
        account: Self::AccountId,
        nonce: Self::Nonce,
    ) -> Option<(pallet_prmx_oracle::Call<Runtime>, <Self::Extrinsic as Extrinsic>::SignaturePayload)> {
        // Implementation
    }
}
```

**Node service loads oracle keys:**

```rust
const ORACLE_KEY_TYPE: KeyTypeId = KeyTypeId(*b"orcl");

fn insert_oracle_authority_key(keystore: &KeystorePtr) -> Result<(), String> {
    keystore.sr25519_generate_new(ORACLE_KEY_TYPE, Some("//Alice"))
        .map_err(|e| format!("Failed to generate oracle key: {:?}", e))?;
    Ok(())
}
```

### 8.4 `submit_rainfall` Extrinsic (Manual)

For manual submissions by authorized oracle providers:

**Signature:**

```rust
fn submit_rainfall(
    origin,
    location_id: LocationId, // interpreted as market_id
    timestamp: u64,
    rainfall_mm: Millimeters,
)
```

**Steps:**

1. Ensure caller is authorized:
   - Origin satisfies `OracleOrigin`, OR
   - Caller is in `OracleProviders` storage map.

2. Ensure `MarketLocationConfig::contains_key(location_id)` (bound market only).

3. Enforce timestamp and rainfall sanity checks.

4. Insert RainBucket with current block number:

   ```rust
   RainBuckets::<T>::insert(
       location_id,
       idx,
       RainBucket {
           timestamp: bucket_start,
           rainfall_mm,
           block_number: current_block,
       },
   );
   ```

5. Update rolling state and emit event.

### 8.5 `submit_rainfall_from_ocw` Extrinsic (Automatic)

For submissions from the offchain worker via signed transactions:

**Signature:**

```rust
fn submit_rainfall_from_ocw(
    origin,
    market_id: MarketId,
    timestamp: u64,
    rainfall_mm: Millimeters,
)
```

**Steps:**

1. Ensure signed origin with account in `OracleProviders`.

2. Same validation and storage logic as `submit_rainfall`.

3. Records block number when data was written.

### 8.6 Rolling State Update

**Internal helper:**

```rust
fn update_rolling_state(
    location_id: LocationId,
    idx: BucketIndex,
    old_mm: Millimeters,
    new_mm: Millimeters,
    now: u64,
)
```

**Algorithm:**

1. Compute `window_start_ts = now.saturating_sub(ROLLING_WINDOW_SECS)`.

2. Load or init:

   ```rust
   let mut state = RollingState::<T>::get(location_id)
       .unwrap_or(RollingWindowState {
           last_bucket_index: idx,
           oldest_bucket_index: idx,
           rolling_sum_mm: 0,
       });
   ```

3. Adjust sum by delta, if bucket is within window:

   ```rust
   let delta = new_mm as i64 - old_mm as i64;
   if bucket_start_time(idx) >= window_start_ts {
       let new_sum = (state.rolling_sum_mm as i64 + delta).max(0) as u32;
       state.rolling_sum_mm = new_sum;
   }
   ```

4. If `idx > state.last_bucket_index`:
   - Update `state.last_bucket_index = idx`.
   - Call `prune_old_buckets(location_id, &mut state, window_start_ts)`.

5. Store updated state:

   ```rust
   RollingState::<T>::insert(location_id, state);
   ```

6. Emit event:

   ```rust
   RollingSumUpdated { location_id, rolling_sum_mm: state.rolling_sum_mm }
   ```

### 8.4 Pruning Old Buckets

**Internal:**

```rust
fn prune_old_buckets(
    location_id: LocationId,
    state: &mut RollingWindowState,
    window_start_ts: u64,
)
```

**Behaviour:**

- Start at `state.oldest_bucket_index`.
- While `bucket_start_time(candidate_idx) < window_start_ts` **and** `candidate_idx <= state.last_bucket_index`:
  - If `RainBuckets::<T>::get(location_id, candidate_idx)` exists:
    - Subtract its `rainfall_mm` from `state.rolling_sum_mm`.
    - Remove that bucket.
  - Increment candidate index.
- After loop:

  ```rust
  state.oldest_bucket_index = candidate_idx;
  ```

---

## 9. Query Trait and Settlement

### 9.1 `RainfallOracle` Trait

Same shape as before, but interpret `location_id` as a market identifier.

```rust
pub trait RainfallOracle {
    fn rolling_sum_mm_at(
        location_id: LocationId, // market_id
        timestamp: u64,
    ) -> Option<Millimeters>;

    fn exceeded_threshold_in_window(
        location_id: LocationId, // market_id
        strike_mm: Millimeters,
        coverage_start: u64,
        coverage_end: u64,
    ) -> Result<bool, DispatchError>;
}
```

### 9.2 `rolling_sum_mm_at`

**Implementation:**

1. Return `None` if market location not configured.

2. Compute:

   ```rust
   let window_start = timestamp.saturating_sub(ROLLING_WINDOW_SECS);
   let start_idx = bucket_index_for_timestamp(window_start);
   let end_idx = bucket_index_for_timestamp(timestamp);
   ```

3. Sum:

   ```rust
   let mut sum: u64 = 0;
   for idx in start_idx..=end_idx {
       if let Some(bucket) = RainBuckets::<T>::get(location_id, idx) {
           sum = sum.saturating_add(bucket.rainfall_mm as u64);
       }
   }

   Some(sum.min(u32::MAX as u64) as u32)
   ```

### 9.3 `exceeded_threshold_in_window`

At settlement we check whether any 24h rolling sum during the coverage window exceeds the strike.

**Algorithm:**

```rust
fn exceeded_threshold_in_window(
    location_id: LocationId,
    strike_mm: Millimeters,
    coverage_start: u64,
    coverage_end: u64,
) -> Result<bool, DispatchError> {
    ensure!(coverage_start < coverage_end, Error::<T>::InvalidCoverageWindow);

    let mut t = coverage_start;
    while t <= coverage_end {
        if let Some(sum) = Self::rolling_sum_mm_at(location_id, t) {
            if sum >= strike_mm {
                return Ok(true);
            }
        }
        t = t.saturating_add(BUCKET_INTERVAL_SECS);
    }

    Ok(false)
}
```

> **Note:** Given `coverage_max = 7 days` and 1-hour buckets, the loop runs at most ~169 times.

### 9.4 Integration with Markets and Policies

In `pallet_prmx_policy::settle_policy(policy_id, event_occurred)`:

1. Load `PolicyInfo`, including `market_id`.

2. Load `MarketInfo` with `strike_value`.

3. Call oracle (or use passed parameter):

   ```rust
   let triggered = T::RainfallOracle::exceeded_threshold_in_window(
       policy.market_id,         // same as LocationId
       market.strike_value,
       policy.coverage_start,
       policy.coverage_end,
   )?;
   // Or use: let triggered = event_occurred;
   ```

4. If `triggered` is `true`:
   - **Policy Token side wins**, pay `shares * PAYOUT_PER_SHARE` to policy holder.
   - Burn LP tokens for this policy.

5. Else:
   - **LP side wins**, automatically distribute pool to LP holders pro-rata.
   - Burn LP tokens for this policy.

> **Note:** Settlement uses policy-specific LP tokens and automatic distribution. There is no market-level residual pool; payouts happen immediately at settlement.

---

## 10. PolicySettlement Trait

The oracle pallet uses this trait to coordinate with the policy pallet for automatic settlement when thresholds are breached during active coverage periods.

### 10.1 Trait Definition

```rust
pub trait PolicySettlement<AccountId> {
    /// Get current blockchain timestamp in Unix seconds
    fn current_time() -> u64;

    /// Get active policies within a coverage window for a market
    fn get_active_policies_in_window(market_id: MarketId, current_time: u64) -> Vec<PolicyId>;

    /// Get policy info: (market_id, coverage_start, coverage_end)
    fn get_policy_info(policy_id: PolicyId) -> Option<(MarketId, u64, u64)>;

    /// Trigger immediate settlement for a policy (called when threshold breached)
    fn trigger_immediate_settlement(policy_id: PolicyId) -> Result<(), DispatchError>;
}
```

### 10.2 Implementation by Policy Pallet

The policy pallet implements this trait:

```rust
impl<T: Config> pallet_prmx_oracle::PolicySettlement<T::AccountId> for Pallet<T> {
    fn current_time() -> u64 {
        Self::current_timestamp()
    }

    fn get_active_policies_in_window(market_id: MarketId, current_time: u64) -> Vec<PolicyId> {
        PoliciesByMarket::<T>::get(market_id)
            .iter()
            .filter(|&&policy_id| {
                if let Some(policy) = Policies::<T>::get(policy_id) {
                    policy.status == PolicyStatus::Active
                        && current_time >= policy.coverage_start
                        && current_time <= policy.coverage_end
                } else {
                    false
                }
            })
            .cloned()
            .collect()
    }

    fn get_policy_info(policy_id: PolicyId) -> Option<(MarketId, u64, u64)> {
        Policies::<T>::get(policy_id)
            .map(|p| (p.market_id, p.coverage_start, p.coverage_end))
    }

    fn trigger_immediate_settlement(policy_id: PolicyId) -> Result<(), DispatchError> {
        Self::settle_policy_internal(policy_id, true)
    }
}
```

---

## 11. ThresholdTriggerLog Storage

When a threshold breach is detected during an active coverage period, the event is logged for auditing and debugging purposes.

### 11.1 Structure

```rust
pub struct ThresholdTriggerLog<T: Config> {
    pub policy_id: PolicyId,
    pub triggered_at: u64,           // Unix timestamp when triggered
    pub rolling_sum_mm: Millimeters, // Rainfall sum that exceeded threshold
    pub strike_threshold: Millimeters,
    pub block_number: BlockNumberFor<T>,
}
```

### 11.2 Storage

```rust
ThresholdTriggerLogs: map u64 -> ThresholdTriggerLog;
NextTriggerLogId: u64;
```

### 11.3 Usage

When the oracle pallet detects a threshold breach:

```rust
let trigger_id = NextTriggerLogId::<T>::get();
NextTriggerLogId::<T>::put(trigger_id + 1);

let trigger_log = ThresholdTriggerLog {
    policy_id,
    triggered_at: current_time,
    rolling_sum_mm: sum,
    strike_threshold: strike_mm,
    block_number: current_block,
};

ThresholdTriggerLogs::<T>::insert(trigger_id, trigger_log);

Self::deposit_event(Event::ThresholdBreached {
    market_id,
    policy_id,
    rolling_sum_mm: sum,
    strike_mm,
});
```

---

## 12. Automatic Settlement via on_initialize

The oracle pallet implements an `on_initialize` hook that periodically checks for threshold breaches and triggers automatic settlement.

### 12.1 Hook Behavior

```rust
#[pallet::hooks]
impl<T: Config> Hooks<BlockNumberFor<T>> for Pallet<T> {
    fn on_initialize(block_number: BlockNumberFor<T>) -> Weight {
        let block_num: u32 = block_number.unique_saturated_into();

        // Check for settlements every BLOCKS_PER_SETTLEMENT_CHECK blocks
        let should_check_settlements = block_num % BLOCKS_PER_SETTLEMENT_CHECK == 0;

        if should_check_settlements {
            Self::check_and_settle_triggered_policies(block_number)
        } else {
            Weight::zero()
        }
    }
}
```

### 12.2 Settlement Check Logic

```rust
pub fn check_and_settle_triggered_policies(block_number: BlockNumberFor<T>) -> Weight {
    let current_time = T::PolicySettlement::current_time();

    // For each market with a location config
    for (market_id, _config) in MarketLocationConfig::<T>::iter() {
        // Get current rolling sum
        if let Some(state) = RollingState::<T>::get(market_id) {
            let rolling_sum = state.rolling_sum_mm;

            // Get market strike value
            if let Ok(strike_mm) = T::MarketsApi::strike_value(market_id) {
                // Check if threshold exceeded
                if rolling_sum >= strike_mm {
                    // Get active policies for this market
                    let active_policies = T::PolicySettlement::get_active_policies_in_window(
                        market_id, 
                        current_time
                    );

                    // Trigger settlement for each active policy
                    for policy_id in active_policies {
                        if let Some((_, coverage_start, coverage_end)) = 
                            T::PolicySettlement::get_policy_info(policy_id) 
                        {
                            if current_time >= coverage_start && current_time <= coverage_end {
                                // Log the trigger
                                let trigger_id = NextTriggerLogId::<T>::get();
                                NextTriggerLogId::<T>::put(trigger_id + 1);
                                
                                ThresholdTriggerLogs::<T>::insert(trigger_id, ThresholdTriggerLog {
                                    policy_id,
                                    triggered_at: current_time,
                                    rolling_sum_mm: rolling_sum,
                                    strike_threshold: strike_mm,
                                    block_number,
                                });

                                // Trigger immediate settlement
                                let _ = T::PolicySettlement::trigger_immediate_settlement(policy_id);
                            }
                        }
                    }
                }
            }
        }
    }

    Weight::from_parts(100_000, 0)
}
```

### 12.3 Timing Summary

| Constant | Value | Description |
|----------|-------|-------------|
| `BLOCKS_PER_HOUR` | 600 | ~1 hour with 6-second blocks |
| `BLOCKS_PER_SETTLEMENT_CHECK` | 10 | Check every 10 blocks (~1 minute) |

---

## 13. Oracle Provider Management

### 13.1 Add Oracle Provider

```rust
fn add_oracle_provider(
    origin,
    account: AccountId,
)
```

**Steps:**

1. Ensure origin satisfies `GovernanceOrigin`.
2. Insert `OracleProviders::<T>::insert(&account, true)`.
3. Emit `OracleProviderAdded { account }` event.

### 13.2 Remove Oracle Provider

```rust
fn remove_oracle_provider(
    origin,
    account: AccountId,
)
```

**Steps:**

1. Ensure origin satisfies `GovernanceOrigin`.
2. Remove `OracleProviders::<T>::remove(&account)`.
3. Emit `OracleProviderRemoved { account }` event.

---

## 14. Data Quality and Safety

### 14.1 Multiple Submissions and Corrections

- Repeated `submit_rainfall` calls for the same `(market_id, bucket_index)` are treated as **corrections**:
  - Overwrite `RainBuckets`.
  - Adjust rolling sum by delta.

### 14.2 Timestamp Drift Limits

Define constants:

```rust
const MAX_PAST_DRIFT_SECS: u64 = 7 * 24 * 3600; // e.g. 7 days
const MAX_FUTURE_DRIFT_SECS: u64 = 2 * 3600;    // e.g. 2 hours
```

- Reject submissions where:
  - `timestamp < now - MAX_PAST_DRIFT_SECS`, or
  - `timestamp > now + MAX_FUTURE_DRIFT_SECS`.

### 14.3 Rainfall Sanity Checks

- Reject absurd values:
  - Example: `rainfall_mm > 10000` (1000mm scaled) for one hour.

```rust
const MAX_RAINFALL_MM: u32 = 10000; // 1000mm scaled by 10
```

### 14.4 AccuWeather API Key Handling

- The key is **never** stored in the runtime or on-chain storage.
- Offchain workers read the key from:
  1. Environment variable (`ACCUWEATHER_API_KEY`)
  2. Offchain local storage
  3. Dev-mode fallback test key (for testing only)
- Documentation should always refer to it as `<ACCUWEATHER_API_KEY>`.

---

## 15. Governance

DAO, via `GovernanceOrigin`, can:

- Control membership of `OracleProviders` accounts via `add_oracle_provider` / `remove_oracle_provider`.
- Adjust drift limits and sanity thresholds.
- Potentially control which AccuWeather endpoints and parameters are used (enforced in offchain config rather than on-chain).

**Markets and oracle must remain consistent:**

- A market to be usable for new policies should eventually have a bound `MarketLocationConfig[market_id]`.
- If not bound, the quote and policy pallets may choose to reject new policies or treat the market as not ready.

---

## 16. Example Runtime Config and AI Implementation Prompt

### Example Runtime Config

```rust
impl pallet_prmx_oracle::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type OracleOrigin = EnsureRoot<AccountId>;
    type GovernanceOrigin = EnsureRoot<AccountId>;
    type MarketsApi = PrmxMarkets;
    type PolicySettlement = PrmxPolicy;
    type MaxLocationKeyLength = ConstU32<32>;
    type WeightInfo = ();
}
```

### Example Prompt for AI Tools

> You are a senior Substrate engineer working against `polkadot-sdk/tree/polkadot-stable2506-2`.
>
> Using `oracle_design.md` as the only specification, implement `pallet_prmx_oracle` with:
>
> **Storage:**
> - `MarketLocationConfig<MarketId>` → `MarketLocationInfo`
> - `RainBuckets<(LocationId, BucketIndex)>` → `RainBucket` (includes `block_number`)
> - `RollingState<LocationId>` → `RollingWindowState`
> - `OracleProviders<AccountId>` → `bool`
> - `ThresholdTriggerLogs<u64>` → `ThresholdTriggerLog` (for audit)
> - `NextTriggerLogId` → `u64`
>
> **Constants:**
> - `BUCKET_INTERVAL_SECS = 3600`
> - `ROLLING_WINDOW_SECS = 24 * 3600`
> - `BLOCKS_PER_HOUR = 600` (6-second blocks)
> - `BLOCKS_PER_SETTLEMENT_CHECK = 10`
> - `MAX_PAST_DRIFT_SECS = 7 * 24 * 3600`
> - `MAX_FUTURE_DRIFT_SECS = 2 * 3600`
> - `MAX_RAINFALL_MM = 10000`
>
> **Config:**
> - `type OracleOrigin`
> - `type GovernanceOrigin`
> - `type MarketsApi: MarketsAccess`
> - `type PolicySettlement: PolicySettlement<Self::AccountId>`
> - `type MaxLocationKeyLength: Get<u32>`
>
> **Extrinsics:**
> - `set_market_location_key(market_id, accuweather_location_key)`
>   - Checks `OracleOrigin` / `GovernanceOrigin`.
>   - Copies `center_latitude` and `center_longitude` from `pallet_prmx_markets::MarketInfo`.
> - `submit_rainfall(location_id, timestamp, rainfall_mm)` - manual submission
>   - Requires `location_id` to have a `MarketLocationConfig`.
>   - Updates `RainBuckets` (with block_number) and `RollingState`.
> - `submit_rainfall_from_ocw(market_id, timestamp, rainfall_mm)` - signed OCW submission
>   - Same logic but uses signed transactions from offchain worker.
> - `add_oracle_provider(account)` - GovernanceOrigin only
> - `remove_oracle_provider(account)` - GovernanceOrigin only
>
> **Hooks:**
> - `on_initialize`: Every `BLOCKS_PER_SETTLEMENT_CHECK` blocks, check for threshold breaches and trigger automatic settlement via `PolicySettlement::trigger_immediate_settlement`.
>
> **Offchain worker:**
> - Scans markets without `MarketLocationConfig`.
> - Calls AccuWeather Geoposition Search to get Key.
> - Submits **signed** tx calling `set_market_location_key`.
> - Every `BLOCKS_PER_HOUR` blocks, fetches rainfall from `/currentconditions/v1/{locationKey}?details=true`.
> - Parses `PrecipitationSummary.Past24Hours.Metric.Value` for 24h rainfall.
> - Submits **signed** tx calling `submit_rainfall_from_ocw`.
>
> **Trait implementations:**
> - `RainfallOracle::rolling_sum_mm_at(location_id, timestamp)`
> - `RainfallOracle::exceeded_threshold_in_window(location_id, strike_mm, coverage_start, coverage_end)`
>
> **Runtime requirements:**
> - Runtime must implement `CreateSignedTransaction<Call<Self>>`
> - Node service must load oracle authority keys (`KeyTypeId = *b"orcl"`)
>
> Assume offchain workers are configured with `<ACCUWEATHER_API_KEY>` but never store it on-chain.

---

# V2 Oracle System – Cumulative Rainfall with Early Trigger

> **Version 2** of the oracle system provides strict separation from V1, with a dedicated off-chain service for cumulative rainfall monitoring and early trigger settlement.

---

## 17. V2 Conceptual Model

### 17.1 Separation Principle

**Hard Rules:**

- Any **V1 policy** is only settled by the existing on-chain oracle logic (Sections 1-16).
- Any **V2 policy** is only settled by the off-chain oracle service via V2 report extrinsic.
- No shared settlement entrypoints between V1 and V2.

**Implementation:**

- Every policy is marked with `policy_version = V1 | V2`.
- V1 code paths reject V2 policies.
- V2 extrinsics reject V1 policies.

### 17.2 V2 Product Definition (Manila Only)

| Parameter | Value |
|-----------|-------|
| Market | Manila only (market_id = 0) |
| Duration | 2 to 7 days |
| Event Type | Cumulative rainfall over the coverage window |
| Early Trigger | Enabled by default |
| Outcome | `Triggered` (cumulative ≥ strike) or `MaturedNoEvent` (reached end without crossing) |

### 17.3 V2 Outcomes

- **Triggered**: `cumulative_mm >= strike_mm` at some time `t` within the coverage window → immediate payout
- **MaturedNoEvent**: Reached `coverage_end` without ever crossing strike → no payout, premium returned to DAO

---

## 18. V2 Shared Primitives

The `prmx-primitives` crate defines common V2 types used across pallets:

```rust
// primitives/src/lib.rs

/// Policy version identifier
#[derive(Clone, Copy, PartialEq, Eq, Debug, Encode, Decode, TypeInfo, MaxEncodedLen, Default)]
pub enum PolicyVersion {
    #[default]
    V1,
    V2,
}

/// Event type for oracle monitoring
#[derive(Clone, Copy, PartialEq, Eq, Debug, Encode, Decode, TypeInfo, MaxEncodedLen, Default)]
pub enum EventType {
    #[default]
    Rainfall24hRolling,      // V1: 24h rolling sum
    CumulativeRainfallWindow, // V2: cumulative over coverage window
}

/// V2 oracle monitoring status
#[derive(Clone, Copy, PartialEq, Eq, Debug, Encode, Decode, TypeInfo, MaxEncodedLen)]
pub enum V2OracleStatus {
    PendingMonitoring,
    Monitoring,
    TriggeredReported,
    MaturedReported,
    Settled,
}

/// V2 settlement outcome
#[derive(Clone, Copy, PartialEq, Eq, Debug, Encode, Decode, TypeInfo, MaxEncodedLen)]
pub enum V2Outcome {
    Triggered,
    MaturedNoEvent,
}

/// V2 oracle report submitted by off-chain service
#[derive(Clone, PartialEq, Eq, Debug, Encode, Decode, TypeInfo, MaxEncodedLen)]
pub struct V2Report<AccountId> {
    pub outcome: V2Outcome,
    pub observed_at: u64,
    pub cumulative_mm: Millimeters,
    pub evidence_hash: [u8; 32],
    pub reporter: AccountId,
    pub submitted_at: u64,
}

// V2 configuration constants
pub const V2_MIN_DURATION_DAYS: u8 = 2;
pub const V2_MAX_DURATION_DAYS: u8 = 7;
pub const MANILA_MARKET_ID: MarketId = 0;
```

---

## 19. V2 On-Chain Storage

### 19.1 Policy Pallet Extensions

```rust
// In PolicyInfo struct:
pub policy_version: PolicyVersion,
pub event_type: EventType,
pub early_trigger: bool,
pub oracle_status_v2: Option<V2OracleStatus>,

// Additional storage:
V2FinalReport: map PolicyId -> Option<V2Report<AccountId>>;
```

### 19.2 Oracle Pallet V2 Storage

```rust
// Authorized accounts that can submit V2 reports
AuthorizedV2Reporters: map AccountId -> bool;

// Final V2 reports by policy (immutable once submitted)
V2FinalReportByPolicy: map PolicyId -> Option<V2Report<AccountId>>;
```

---

## 20. V2 On-Chain Extrinsics

### 20.1 Quote Pallet: `request_policy_quote_v2`

```rust
#[pallet::call_index(7)]
pub fn request_policy_quote_v2(
    origin: OriginFor<T>,
    market_id: MarketId,
    coverage_start: u64,
    coverage_end: u64,
    latitude: i32,
    longitude: i32,
    shares: u128,
    duration_days: u8,
) -> DispatchResult
```

**Validation:**
- Market must be Manila (`market_id == 0`)
- Duration must be 2-7 days
- Creates `QuoteRequest` with `policy_version = V2`, `event_type = CumulativeRainfallWindow`, `early_trigger = true`

### 20.2 Oracle Pallet: V2 Report Submission

```rust
#[pallet::call_index(10)]
pub fn submit_v2_report(
    origin: OriginFor<T>,
    policy_id: PolicyId,
    outcome: V2Outcome,
    observed_at: u64,
    cumulative_mm: u32,
    evidence_hash: [u8; 32],
) -> DispatchResult
```

**Steps:**

1. Ensure caller is in `AuthorizedV2Reporters`.
2. Load policy, ensure `policy_version == V2`.
3. Ensure market is Manila.
4. Ensure policy not already settled.
5. Validate outcome:
   - **Triggered**: `observed_at` within `[coverage_start, coverage_end]`, `cumulative_mm >= strike_mm`
   - **MaturedNoEvent**: `observed_at >= coverage_end`, `cumulative_mm < strike_mm`
6. Store report in `V2FinalReportByPolicy` (immutable).
7. Call `PolicySettlement::settle_v2_policy(...)`.
8. Emit `V2ReportAccepted` event.

### 20.3 V2 Reporter Management

```rust
#[pallet::call_index(11)]
pub fn add_v2_reporter(origin: OriginFor<T>, account: T::AccountId) -> DispatchResult {
    T::GovernanceOrigin::ensure_origin(origin)?;
    AuthorizedV2Reporters::<T>::insert(&account, true);
    Self::deposit_event(Event::V2ReporterAdded { account });
    Ok(())
}

#[pallet::call_index(12)]
pub fn remove_v2_reporter(origin: OriginFor<T>, account: T::AccountId) -> DispatchResult {
    T::GovernanceOrigin::ensure_origin(origin)?;
    AuthorizedV2Reporters::<T>::remove(&account);
    Self::deposit_event(Event::V2ReporterRemoved { account });
    Ok(())
}
```

---

## 21. V2 On-Chain Events

### 21.1 Policy Pallet Events

```rust
/// V2 policy created with cumulative rainfall monitoring
V2PolicyCreated {
    policy_id: PolicyId,
    market_id: MarketId,
    coverage_start: u64,
    coverage_end: u64,
    strike_mm: u32,
    lat: i32,
    lon: i32,
}

/// V2 policy settled by off-chain oracle report
V2PolicySettled {
    policy_id: PolicyId,
    outcome: V2Outcome,
    cumulative_mm: u32,
    evidence_hash: [u8; 32],
}
```

### 21.2 Oracle Pallet Events

```rust
/// V2 reporter added
V2ReporterAdded { account: AccountId }

/// V2 reporter removed
V2ReporterRemoved { account: AccountId }

/// V2 report accepted and forwarded to policy pallet
V2ReportAccepted {
    policy_id: PolicyId,
    outcome: V2Outcome,
    cumulative_mm: u32,
    evidence_hash: [u8; 32],
}
```

---

## 22. V2 Off-Chain Oracle Service

The V2 oracle is implemented as a Node.js service with MongoDB Atlas for persistent state.

### 22.1 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    PRMX Blockchain                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ prmx-policy │  │ prmx-oracle │  │ V2PolicyCreated     │ │
│  │ (V2 events) │  │ (V2 reports)│  │ V2PolicySettled     │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
           │                    ▲                    ▲
           │ Events             │ submit_v2_report   │ Events
           ▼                    │                    │
┌─────────────────────────────────────────────────────────────┐
│              Oracle V2 Service (Node.js)                    │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │  Listener  │  │ Evaluator  │  │  Reporter  │            │
│  │ (events)   │  │ (cumulative│  │ (submit tx)│            │
│  └────────────┘  │  rainfall) │  └────────────┘            │
│        │         └────────────┘         │                   │
│        ▼                                ▼                   │
│  ┌────────────────────────────────────────┐                │
│  │           MongoDB Atlas                 │                │
│  │  - monitors (policy tracking)           │                │
│  │  - buckets (hourly rainfall)            │                │
│  │  - evidence (JSON blobs)                │                │
│  │  - chain_meta (restart detection)       │                │
│  └────────────────────────────────────────┘                │
│        │                                                    │
│        ▼                                                    │
│  ┌────────────────────────────────────────┐                │
│  │         AccuWeather API                 │                │
│  │  /currentconditions/v1/{locationKey}    │                │
│  └────────────────────────────────────────┘                │
│                                                             │
│  ┌────────────────────────────────────────┐                │
│  │         REST API (Express.js)           │                │
│  │  GET /v2/monitors                       │                │
│  │  GET /v2/monitors/:id                   │                │
│  │  GET /v2/policies/:policyId/monitor     │                │
│  │  GET /v2/stats                          │                │
│  │  GET /health                            │                │
│  └────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

### 22.2 MongoDB Collections

**monitors** - Policy tracking documents:

```typescript
interface Monitor {
  _id: string;              // Composite UID: "0:42" (market_id:policy_id)
  market_id: number;
  policy_id: number;
  coverage_start: number;   // Unix timestamp
  coverage_end: number;     // Unix timestamp
  strike_mm: number;        // Threshold (scaled by 10)
  lat: number;
  lon: number;
  state: 'monitoring' | 'triggered' | 'matured' | 'reported';
  cumulative_mm: number;    // Current cumulative rainfall
  trigger_time?: number;    // When threshold was first crossed
  last_fetch_at: number;    // Last AccuWeather fetch timestamp
  location_key: string;     // AccuWeather location key
  report_tx_hash?: string;  // On-chain transaction hash
  evidence_hash?: string;   // SHA256 of evidence JSON
  created_at: Date;
  updated_at: Date;
}
```

**buckets** - Hourly precipitation data:

```typescript
interface Bucket {
  _id: string;              // "0:42:1734567890" (market:policy:hour_utc)
  policy_id: number;
  hour_utc: number;         // Hour-aligned Unix timestamp
  mm: number;               // Rainfall in mm (scaled by 10)
  created_at: Date;
}
```

**evidence** - Evidence JSON blobs:

```typescript
interface Evidence {
  _id: string;              // SHA256 hash
  policy_id: number;
  json_blob: object;        // Raw AccuWeather responses
  created_at: Date;
}
```

**chain_meta** - Chain restart detection:

```typescript
interface ChainMeta {
  _id: string;              // "chain_meta"
  genesis_hash: string;
  last_block_number: number;
  last_seen_timestamp: Date;
}
```

### 22.3 Chain Restart Detection

The oracle service detects chain restarts and clears stale data:

```typescript
async function checkChainRestart(api: ApiPromise): Promise<boolean> {
  const currentGenesisHash = api.genesisHash.toHex();
  const currentBlockNumber = (await api.rpc.chain.getHeader()).number.toNumber();
  
  const storedMeta = await chainMetaCollection.findOne({ _id: 'chain_meta' });
  
  if (!storedMeta) {
    // First run - store current state
    await chainMetaCollection.insertOne({
      _id: 'chain_meta',
      genesis_hash: currentGenesisHash,
      last_block_number: currentBlockNumber,
      last_seen_timestamp: new Date(),
    });
    return false;
  }
  
  // Detect restart conditions
  const genesisChanged = storedMeta.genesis_hash !== currentGenesisHash;
  const blockReset = currentBlockNumber < storedMeta.last_block_number - 10;
  
  if (genesisChanged || blockReset) {
    // Clear all collections for fresh chain state
    await monitors.deleteMany({});
    await buckets.deleteMany({});
    await evidence.deleteMany({});
    
    // Update chain meta
    await chainMetaCollection.updateOne(
      { _id: 'chain_meta' },
      { $set: { genesis_hash: currentGenesisHash, last_block_number: currentBlockNumber } }
    );
    
    return true;
  }
  
  return false;
}
```

### 22.4 Event Listeners

The service subscribes to blockchain events:

```typescript
// Listen for V2PolicyCreated events
api.query.system.events((events) => {
  events.forEach(({ event }) => {
    if (event.section === 'prmxPolicy' && event.method === 'V2PolicyCreated') {
      const [policyId, marketId, coverageStart, coverageEnd, strikeMm, lat, lon] = event.data;
      // Create monitor document in MongoDB
    }
    
    if (event.section === 'prmxPolicy' && event.method === 'V2PolicySettled') {
      const [policyId, outcome, cumulativeMm, evidenceHash] = event.data;
      // Update monitor state to 'triggered' or 'matured'
    }
  });
});
```

### 22.5 Scheduler and Evaluation

```typescript
// Every 30 minutes (configurable)
async function runEvaluationCycle() {
  const activeMonitors = await monitors.find({ state: 'monitoring' }).toArray();
  
  for (const monitor of activeMonitors) {
    const now = Math.floor(Date.now() / 1000);
    
    // Fetch latest precipitation from AccuWeather
    const rainfall = await fetchAccuWeatherPrecipitation(monitor.location_key);
    
    // Update cumulative rainfall
    monitor.cumulative_mm += rainfall.mm;
    
    // Check for trigger condition
    if (monitor.cumulative_mm >= monitor.strike_mm && now <= monitor.coverage_end) {
      // TRIGGERED - submit report immediately
      await submitV2Report(monitor.policy_id, 'Triggered', now, monitor.cumulative_mm);
      monitor.state = 'triggered';
    } else if (now >= monitor.coverage_end) {
      // MATURED - submit final report
      await submitV2Report(monitor.policy_id, 'MaturedNoEvent', monitor.coverage_end, monitor.cumulative_mm);
      monitor.state = 'matured';
    }
    
    await monitors.updateOne({ _id: monitor._id }, { $set: monitor });
  }
}
```

### 22.6 Environment Configuration

```bash
# offchain-oracle-service/.env
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/prmx-oracle
WS_ENDPOINT=ws://127.0.0.1:9944
ACCUWEATHER_API_KEY=<your-key>
MANILA_LOCATION_KEY=264885
ORACLE_SEED=//Alice
ORACLE_V2_API_PORT=3001
POLL_INTERVAL_SECS=1800
```

---

## 23. V2 Frontend Integration

### 23.1 Policy Version Display

- Policies list and detail pages show V1/V2 badges
- Market pages indicate V2 availability (Manila only)
- Get Coverage page offers V1/V2 selector with duration options

### 23.2 Oracle V2 Monitoring Page

Route: `/oracle-v2`

Features:
- Live monitor status from REST API
- Cumulative rainfall progress bars
- State badges (monitoring/triggered/matured/reported)
- Evidence hash links
- Coverage window countdown

### 23.3 REST API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Service health check |
| `GET /v2/monitors` | List all monitors |
| `GET /v2/monitors/:id` | Get specific monitor by ID (e.g., `0:42`) |
| `GET /v2/policies/:policyId/monitor` | Get monitor for a policy |
| `GET /v2/stats` | Get aggregated statistics |

---

## 24. V2 Testing

### 24.1 Settlement Test Script

```bash
# Run V2 settlement test
cd scripts && node test-v2-settlement.mjs
```

Tests both scenarios:
- **Triggered**: Create policy, submit report with `cumulative_mm >= strike_mm` → verify payout
- **MaturedNoEvent**: Create policy, submit report with `cumulative_mm < strike_mm` → verify no payout

### 24.2 Expected Payout Calculation

```
Payout = shares × payout_per_share

Example (Manila genesis config):
- payout_per_share = 100 USDT (100 × 10^6 smallest units)
- 5 shares purchased
- Triggered settlement → 500 USDT payout
```

---

## 25. V2 Summary

| Component | V1 | V2 |
|-----------|----|----|
| Event Type | 24h rolling rainfall | Cumulative over window |
| Markets | All | Manila only |
| Duration | Per market config | 2-7 days |
| Early Trigger | No | Yes |
| Settlement | On-chain OCW | Off-chain service |
| Data Source | AccuWeather (on-chain fetch) | AccuWeather (off-chain fetch) |
| Report | Automatic via `on_initialize` | Manual via `submit_v2_report` |
| Evidence | On-chain buckets | Off-chain MongoDB + hash |

---

**If generated code and `oracle_design.md` disagree, `oracle_design.md` wins and the code must be updated to match this document.**
