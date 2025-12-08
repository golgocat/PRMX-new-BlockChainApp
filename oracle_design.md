# PRMX Oracle Design – AccuWeather, Market-Bound Locations

**Rainfall 24h Rolling Sum**

> This document is the **single source of truth** for the PRMX oracle pallet `pallet_prmx_oracle` after the move to market-bound AccuWeather locations.

It replaces the previous generic "location-based" design:

- Locations are now **bound to markets**, not per-policy coordinates.
- DAO configures an approximate center (lat/lon) when creating a market.
- An offchain worker resolves the closest AccuWeather Location Key once.
- All rainfall ingestion and settlement are done per market, using that key.

**Target:**

- Polkadot SDK `polkadot-stable2506-2`
- FRAME v2 style
- Integrates with:
  - `pallet_prmx_markets`
  - `pallet_prmx_policy`
  - `pallet_prmx_quote`

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
}

RainBuckets: double_map (LocationId, BucketIndex) -> RainBucket;
```

**Interpretation:**

- For market `market_id`, and bucket index `idx`, the record represents rainfall for `[bucket_start_time(idx), bucket_start_time(idx) + 3600)`.

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
pub trait Config: frame_system::Config + pallet_prmx_markets::Config {
    type RuntimeEvent: From<Event<Self>>
        + IsType<<Self as frame_system::Config>::RuntimeEvent>;

    /// Who can ingest rainfall and bind AccuWeather locations.
    type OracleOrigin: EnsureOrigin<Self::RuntimeOrigin>;

    /// Who can govern configuration (if needed).
    type GovernanceOrigin: EnsureOrigin<Self::RuntimeOrigin>;

    /// Access to markets pallet for center coordinates
    type MarketsApi: MarketsAccess;

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

### 8.1 Ingestion Pattern

A second offchain worker (or the same one) periodically:

1. Iterates markets that already have `MarketLocationConfig[market_id]` set.

2. For each such market:
   - Take `accuweather_location_key`.
   - Call AccuWeather endpoint to get current conditions with 24h precipitation:

   ```http
   GET /currentconditions/v1/{locationKey}
       ?apikey=<ACCUWEATHER_API_KEY>&details=true
   ```

3. Parse response:
   - Extract `EpochTime` (unix seconds) as observation timestamp.
   - Extract `PrecipitationSummary.Past24Hours.Metric.Value` as rainfall in mm.

4. Submit data:

   ```rust
   submit_rainfall(market_id, timestamp, rainfall_mm)
   ```

### 8.2 `submit_rainfall` Extrinsic

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

3. Enforce timestamp constraints:
   - Not older than `MAX_PAST_DRIFT_SECS` from now.
   - Not more than `MAX_FUTURE_DRIFT_SECS` into the future.

4. Enforce rainfall sanity check:
   - `rainfall_mm <= MAX_RAINFALL_MM` (e.g., 10000 = 1000mm scaled)

5. Compute:

   ```rust
   let idx = bucket_index_for_timestamp(timestamp);
   let bucket_start = bucket_start_time(idx);
   ```

6. Load old bucket:

   ```rust
   let old_bucket = RainBuckets::<T>::get(location_id, idx);
   let old_mm = old_bucket.map(|b| b.rainfall_mm).unwrap_or(0);
   ```

7. Insert / overwrite:

   ```rust
   RainBuckets::<T>::insert(
       location_id,
       idx,
       RainBucket {
           timestamp: bucket_start,
           rainfall_mm,
       },
   );
   ```

8. Call internal:

   ```rust
   update_rolling_state(location_id, idx, old_mm, rainfall_mm, now)
   ```

9. Emit event:

   ```rust
   RainfallUpdated { location_id, bucket_index: idx, rainfall_mm }
   ```

### 8.3 Rolling State Update

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

## 10. Oracle Provider Management

### 10.1 Add Oracle Provider

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

### 10.2 Remove Oracle Provider

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

## 11. Data Quality and Safety

### 11.1 Multiple Submissions and Corrections

- Repeated `submit_rainfall` calls for the same `(market_id, bucket_index)` are treated as **corrections**:
  - Overwrite `RainBuckets`.
  - Adjust rolling sum by delta.

### 11.2 Timestamp Drift Limits

Define constants:

```rust
const MAX_PAST_DRIFT_SECS: u64 = 7 * 24 * 3600; // e.g. 7 days
const MAX_FUTURE_DRIFT_SECS: u64 = 2 * 3600;    // e.g. 2 hours
```

- Reject submissions where:
  - `timestamp < now - MAX_PAST_DRIFT_SECS`, or
  - `timestamp > now + MAX_FUTURE_DRIFT_SECS`.

### 11.3 Rainfall Sanity Checks

- Reject absurd values:
  - Example: `rainfall_mm > 10000` (1000mm scaled) for one hour.

```rust
const MAX_RAINFALL_MM: u32 = 10000; // 1000mm scaled by 10
```

### 11.4 AccuWeather API Key Handling

- The key is **never** stored in the runtime or on-chain storage.
- Offchain workers read the key from:
  1. Environment variable (`ACCUWEATHER_API_KEY`)
  2. Offchain local storage
  3. Dev-mode fallback test key (for testing only)
- Documentation should always refer to it as `<ACCUWEATHER_API_KEY>`.

---

## 12. Governance

DAO, via `GovernanceOrigin`, can:

- Control membership of `OracleProviders` accounts via `add_oracle_provider` / `remove_oracle_provider`.
- Adjust drift limits and sanity thresholds.
- Potentially control which AccuWeather endpoints and parameters are used (enforced in offchain config rather than on-chain).

**Markets and oracle must remain consistent:**

- A market to be usable for new policies should eventually have a bound `MarketLocationConfig[market_id]`.
- If not bound, the quote and policy pallets may choose to reject new policies or treat the market as not ready.

---

## 13. Example Runtime Config and AI Implementation Prompt

### Example Runtime Config

```rust
impl pallet_prmx_oracle::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type OracleOrigin = EnsureRoot<AccountId>;
    type GovernanceOrigin = EnsureRoot<AccountId>;
    type MarketsApi = PrmxMarkets;
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
> - `RainBuckets<(LocationId, BucketIndex)>` → `RainBucket`
> - `RollingState<LocationId>` → `RollingWindowState`
> - `OracleProviders<AccountId>` → `bool`
>
> **Constants:**
> - `BUCKET_INTERVAL_SECS = 3600`
> - `ROLLING_WINDOW_SECS = 24 * 3600`
> - `MAX_PAST_DRIFT_SECS = 7 * 24 * 3600`
> - `MAX_FUTURE_DRIFT_SECS = 2 * 3600`
> - `MAX_RAINFALL_MM = 10000`
>
> **Config:**
> - `type OracleOrigin`
> - `type GovernanceOrigin`
> - `type MarketsApi: MarketsAccess`
> - `type MaxLocationKeyLength: Get<u32>`
>
> **Extrinsics:**
> - `set_market_location_key(market_id, accuweather_location_key)`
>   - Checks `OracleOrigin` / `GovernanceOrigin`.
>   - Copies `center_latitude` and `center_longitude` from `pallet_prmx_markets::MarketInfo`.
> - `submit_rainfall(location_id, timestamp, rainfall_mm)`
>   - Requires `location_id` to have a `MarketLocationConfig`.
>   - Updates `RainBuckets` and `RollingState` as described.
> - `add_oracle_provider(account)` - GovernanceOrigin only
> - `remove_oracle_provider(account)` - GovernanceOrigin only
>
> **Offchain worker:**
> - Scans markets without `MarketLocationConfig`.
> - Calls AccuWeather Geoposition Search to get Key.
> - Submits signed tx calling `set_market_location_key`.
> - Fetches rainfall from `/currentconditions/v1/{locationKey}?details=true`.
> - Parses `PrecipitationSummary.Past24Hours.Metric.Value` for 24h rainfall.
>
> **Trait implementation:**
> - `RainfallOracle::rolling_sum_mm_at(location_id, timestamp)`
> - `RainfallOracle::exceeded_threshold_in_window(location_id, strike_mm, coverage_start, coverage_end)`
>
> Assume offchain workers are configured with `<ACCUWEATHER_API_KEY>` but never store it on-chain.

---

**If generated code and `oracle_design.md` disagree, `oracle_design.md` wins and the code must be updated to match this document.**
