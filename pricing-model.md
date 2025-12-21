# PRMX Pricing Model – R Actuarial Model Integration

This document describes how the R-based actuarial rainfall model is integrated into PRMX for both V1 and V2 products.

**Implementation Status:**

| Feature | V1 | V2 |
|---------|----|----|
| Coverage window | ✅ 24 hours fixed | ✅ 2-7 days configurable |
| Markets | ✅ All markets | ✅ Manila only |
| R pricing API | ✅ Via offchain worker | ✅ Via offchain worker |
| On-chain pricing | ✅ `pallet_prmx_quote` | ✅ `request_policy_quote_v2` |
| Oracle settlement | ✅ 24h rolling sum (on-chain) | ✅ Cumulative rainfall (off-chain) |
| Early trigger | ❌ Not supported | ✅ Enabled by default |

---

## Version Comparison

| Aspect | V1 | V2 |
|--------|----|----|
| **Event Definition** | 24h rolling rainfall ≥ strike at any point during window | Cumulative rainfall over entire window ≥ strike |
| **Coverage Window** | Fixed 24 hours | 2-7 days (user selected) |
| **Settlement Timing** | At coverage end | Immediately when triggered, or at coverage end |
| **R API Duration** | `duration_in_hours = 24` | `duration_in_hours = days × 24` |

### V1 Event Definition Alignment

Because `coverage_end = coverage_start + 24h`, the only 24h window inside the policy is exactly that coverage period:

| R Model Event Definition | Oracle Event Definition |
|--------------------------|-------------------------|
| Total rainfall during the coverage window ≥ `threshold_mm` | 24h rolling rainfall ≥ `strike_mm` at least once during the coverage window |

### V2 Event Definition Alignment

For V2, both the R model and oracle use the same cumulative definition:

| R Model Event Definition | Oracle Event Definition |
|--------------------------|-------------------------|
| Cumulative rainfall over `[start, end]` ≥ `threshold_mm` | Cumulative rainfall over `[start, end]` ≥ `strike_mm` |

---

## Table of Contents

### V1 (24h Rolling Rainfall)
1. [Product Scope (V1)](#1-product-scope-v1)
2. [R Actuarial Model: Conceptual Role](#2-r-actuarial-model-conceptual-role)
3. [Parameter Mapping: PRMX → R API](#3-parameter-mapping-prmx--r-api)
4. [Offchain Worker Logic (V1)](#4-offchain-worker-logic-v1)
5. [On-chain Pricing Logic (V1)](#5-on-chain-pricing-logic-v1)
6. [Oracle Settlement Logic (V1)](#6-oracle-settlement-logic-v1)

### V2 (Cumulative Rainfall with Early Trigger)
7. [Product Scope (V2)](#7-product-scope-v2)
8. [V2 Parameter Mapping: PRMX → R API](#8-v2-parameter-mapping-prmx--r-api)
9. [V2 Offchain Worker Logic](#9-v2-offchain-worker-logic)
10. [V2 On-chain Pricing Logic](#10-v2-on-chain-pricing-logic)
11. [V2 Oracle Settlement Logic](#11-v2-oracle-settlement-logic)
12. [Future Evolution](#12-future-evolution)

---

## 1. Product Scope (V1)

### Coverage Window

- Fixed to **24 hours** per policy
- `coverage_start` is chosen by the user
- `coverage_end` is derived as `coverage_start + 24h` on-chain

### Trigger Definition

- Strike is configured per market as `strike_mm` (millimeters of rain)
- A policy is **in-the-money** if, during its 24h coverage window, total rainfall in mm ≥ `strike_mm`

### Payout

- **Binary full-payout product**
- If triggered: policy holder receives full `max_payout` amount
- If not triggered: `payout = 0`

---

## 2. R Actuarial Model: Conceptual Role

The R pricing model is treated as a **black box** that estimates the probability `p` of the trigger event for a specific policy configuration.

### Input Parameters

| Parameter | Description |
|-----------|-------------|
| `lat`, `lon` | Geographic location |
| `startdate` | Coverage window start |
| `duration_in_hours` | Duration (= 24 for v1) |
| `threshold` | Rainfall threshold in mm |
| `coverage` | Coverage amount in payout token units |
| `number_of_simulations` | Simulation count |
| `ROC` | Target return on capital |

### Output Parameters

| Parameter | Description |
|-----------|-------------|
| `avg_cost` | Average expected cost |
| `recommended_premium` | Model's suggested premium |
| `closest_point` | Nearest data point location |
| `dist_closest_point_km` | Distance to closest point |

### Probability Calculation

For v1 PRMX, we interpret:

```
p = avg_cost / coverage
```

as the event probability that the policy triggers.

> **Note:** On-chain pricing is derived from `p` and the payout amount. The R model's own premium formula is not used on-chain; it is advisory only.

---

## 3. Parameter Mapping: PRMX → R API

When an offchain worker prices a quote for market M and a requested `coverage_start`:

### Market Configuration (on-chain)

| Field | Description |
|-------|-------------|
| `market_id` | Unique market identifier |
| `center_lat`, `center_lon` | Market center coordinates |
| `strike_mm` | Rainfall threshold |
| `payout_per_share` | Payout amount (in payout token units) |
| `dao_margin_bp` | DAO margin (basis points) |

### Quote Request (on-chain)

| Field | Description |
|-------|-------------|
| `quote_id` | Unique quote identifier |
| `market_id` | Associated market |
| `coverage_start` | Coverage period start time |
| `shares` | Number of policy shares requested |
| `requested_at` | Request timestamp |

### R API Parameter Mapping

| R API Parameter | Source in PRMX |
|-----------------|----------------|
| `lat` | `MarketsAccess::center_coordinates(market_id).lat` |
| `lon` | `MarketsAccess::center_coordinates(market_id).lon` |
| `startdate` | `coverage_start` as Unix timestamp (UTC seconds) |
| `duration_in_hours` | `24` (fixed for v1) |
| `threshold` | `market.strike_mm` |
| `coverage` | `payout_per_share × shares` |
| `number_of_simulations` | `100000` (v1 default) |
| `ROC` | `0.08` (or governance-configured default) |

The R service responds for this specific location, window, threshold, and coverage.

---

## 4. Offchain Worker Logic (V1)

### Pseudocode

```
1. Detect new QuoteRequest on-chain

2. Derive API inputs:
   - Read market parameters: center_lat, center_lon, strike_mm, payout_per_share
   - Read quote parameters: coverage_start, shares
   - Compute:
     - coverage_end = coverage_start + 24h (not passed to R but used on-chain)
     - coverage_amount = payout_per_share × shares

3. Call R pricing API:
   - GET /pricing with mapped parameters above
   - Parse JSON response:
     - avg_cost
     - recommended_premium (optional, advisory only)
     - closest_point
     - dist_closest_point_km

4. Compute trigger probability:
   - p = avg_cost / coverage_amount
   - probability_ppm = round(p × 1_000_000)  // parts per million

5. Submit quote result on-chain:
   - Call pallet_prmx_quote::submit_quote(
       quote_id,
       probability_ppm,
       model_version,             // e.g. "R_LUZON_TYPE1_V1"
       closest_point,
       dist_closest_point_km
     )
```

> **Note:** This transaction is unsigned or signed by the oracle/agent key, depending on the security model.

---

## 5. On-chain Pricing Logic (V1)

Once `submit_quote` is accepted, pricing is done entirely on-chain from:

- `payout_per_share`
- `probability_ppm`
- `dao_margin_bp`

### Variable Definitions

| Variable | Type | Description |
|----------|------|-------------|
| `payout_per_share` | `u128` | Denominated in payout token units |
| `probability_ppm` | `u32` | Probability `p` in parts per million |
| `dao_margin_bp` | `u32` | DAO margin in basis points (1/100 of a percent) |

### Pricing Formulas

**Step 1: Convert probability**

```
p = probability_ppm / 1_000_000
```

**Step 2: Calculate fair premium per share (no DAO margin)**

```
fair_premium_per_share = payout_per_share × probability_ppm / 1_000_000
```

**Step 3: Apply DAO margin**

```
margin_factor_bp = 10_000 + dao_margin_bp

premium_per_share = fair_premium_per_share × margin_factor_bp / 10_000
```

**Step 4: Calculate total premium**

```
total_premium = premium_per_share × shares
```

> This keeps the premium calculation **deterministic and transparent** on-chain; the R model only supplies the probability estimate.

---

## 6. Oracle Settlement Logic (V1)

### Oracle Subsystem Responsibilities

For each market, the oracle subsystem:

- Binds a single AccuWeather location key per market
- Periodically fetches rainfall in mm
- Maintains a 24h rolling rainfall sum value: `rolling_24h_mm(t)` for each timestamp `t`

### Policy Parameters

For v1, every policy has:

| Parameter | Value |
|-----------|-------|
| `coverage_start` | User-specified |
| `coverage_end` | `coverage_start + 24h` |

### Settlement Rule

At `settle_policy`:

1. Obtain the total rainfall over `[coverage_start, coverage_end]`
2. If `total_rainfall_mm ≥ strike_mm`: policy **triggers** (`payout = max_payout`)
3. Else: **no payout**

### Implementation Note

Because the coverage window is exactly 24 hours, using either:

- Total rainfall over `[start, end]`, or
- `rolling_24h_mm` evaluated at `coverage_end`

is **equivalent**.

The settlement implementation may therefore:

- Either store cumulative rain and subtract checkpoints, or
- Store `rolling_24h_mm` per hour and read the value at `coverage_end`

The spec only requires that the 24h coverage window total be compared to `strike_mm`.

---

---

# V2 Pricing Model – Cumulative Rainfall with Early Trigger

---

## 7. Product Scope (V2)

### Coverage Window

- **Configurable duration**: 2 to 7 days (user selected)
- `coverage_start` is chosen by the user
- `coverage_end = coverage_start + (duration_days × 24h)`

### Market Restrictions

- V2 is **Manila only** (market_id = 0)
- Other markets continue to use V1 only

### Trigger Definition

- Strike is configured per market as `strike_mm` (millimeters of rain)
- A policy is **in-the-money** if cumulative rainfall over `[coverage_start, coverage_end]` ≥ `strike_mm`
- **Early trigger**: Settlement occurs immediately when threshold is crossed (not waiting for coverage_end)

### Payout

- **Binary full-payout product** (same as V1)
- If triggered: policy holder receives full `max_payout` amount
- If matured without event: `payout = 0`, premium returned to DAO

---

## 8. V2 Parameter Mapping: PRMX → R API

### Quote Request Extensions (V2)

| Field | Description |
|-------|-------------|
| `policy_version` | `V2` |
| `event_type` | `CumulativeRainfallWindow` |
| `early_trigger` | `true` (always for V2) |
| `duration_days` | User-selected (2-7) |

### R API Parameter Mapping (V2)

| R API Parameter | Source in PRMX |
|-----------------|----------------|
| `lat` | `MarketsAccess::center_coordinates(0).lat` (Manila) |
| `lon` | `MarketsAccess::center_coordinates(0).lon` (Manila) |
| `startdate` | `coverage_start` as Unix timestamp (UTC seconds) |
| `duration_in_hours` | `duration_days × 24` (48-168 hours) |
| `threshold` | `market.strike_mm` |
| `coverage` | `payout_per_share × shares` |
| `number_of_simulations` | `100000` (default) |
| `ROC` | `0.08` (or governance-configured default) |

The R service responds with probability estimates for cumulative rainfall over the specified window.

---

## 9. V2 Offchain Worker Logic

### Pseudocode

```
1. Detect new QuoteRequest with policy_version = V2

2. Validate V2 constraints:
   - market_id == 0 (Manila only)
   - duration_days in [2, 7]

3. Derive API inputs:
   - Read market parameters: center_lat, center_lon, strike_mm, payout_per_share
   - Read quote parameters: coverage_start, shares, duration_days
   - Compute:
     - duration_in_hours = duration_days × 24
     - coverage_end = coverage_start + (duration_days × 24h)
     - coverage_amount = payout_per_share × shares

4. Call R pricing API:
   - GET /pricing with mapped parameters
   - Parse JSON response:
     - avg_cost
     - recommended_premium (optional, advisory only)
     - closest_point
     - dist_closest_point_km

5. Compute trigger probability:
   - p = avg_cost / coverage_amount
   - probability_ppm = round(p × 1_000_000)

6. Submit quote result on-chain:
   - Call pallet_prmx_quote::submit_quote(
       quote_id,
       probability_ppm,
       model_version,             // e.g. "R_LUZON_TYPE1_V2"
       closest_point,
       dist_closest_point_km
     )
```

> **Note:** V2 uses the same R API endpoint as V1; only `duration_in_hours` differs.

---

## 10. V2 On-chain Pricing Logic

V2 pricing uses the **same formulas** as V1 (Section 5), with the probability coming from the R model's cumulative rainfall simulation.

### Key Differences

| Aspect | V1 | V2 |
|--------|----|----|
| Duration passed to R | 24 hours | `duration_days × 24` hours |
| Event type | 24h rolling max | Cumulative over window |
| Probability interpretation | P(any 24h period ≥ strike) | P(total rainfall ≥ strike) |

### Pricing Formulas (Same as V1)

```
fair_premium_per_share = payout_per_share × probability_ppm / 1_000_000

margin_factor_bp = 10_000 + dao_margin_bp

premium_per_share = fair_premium_per_share × margin_factor_bp / 10_000

total_premium = premium_per_share × shares
```

---

## 11. V2 Oracle Settlement Logic

### Off-Chain Oracle Service

V2 settlement is handled by a dedicated **off-chain oracle service** (Node.js + MongoDB Atlas), not the on-chain offchain worker.

### Service Responsibilities

1. **Listen for `V2PolicyCreated` events** on-chain
2. **Create monitor documents** in MongoDB with policy parameters
3. **Periodically fetch AccuWeather data** (every 30-60 minutes)
4. **Compute cumulative rainfall** over the coverage window
5. **Submit `submit_v2_report` extrinsic** when:
   - Cumulative ≥ strike (Triggered) → immediate settlement
   - Coverage ended and cumulative < strike (MaturedNoEvent) → settlement at end

### Settlement Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  V2PolicyCreated │────▶│  Oracle Service  │────▶│  submit_v2_report│
│  (on-chain)      │     │  (off-chain)     │     │  (on-chain)      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  AccuWeather API │
                        │  (precipitation) │
                        └──────────────────┘
```

### V2 Report Parameters

| Parameter | Description |
|-----------|-------------|
| `policy_id` | The V2 policy being settled |
| `outcome` | `Triggered` or `MaturedNoEvent` |
| `observed_at` | Timestamp when threshold crossed or coverage ended |
| `cumulative_mm` | Total rainfall observed (scaled by 10) |
| `evidence_hash` | SHA256 of evidence JSON blob |

### Evidence Storage

- Raw AccuWeather API responses stored in MongoDB
- Evidence hash submitted on-chain for auditability
- Evidence can be retrieved via REST API: `GET /v2/policies/:id/evidence`

---

## 12. Future Evolution

### V2 Implementation Complete

V2 is now fully implemented with:

- ✅ Cumulative rainfall tracking
- ✅ 2-7 day coverage windows
- ✅ Early trigger support
- ✅ Off-chain oracle service
- ✅ Evidence storage and verification

### Potential Future Extensions

| Extension | Description |
|-----------|-------------|
| **Additional V2 markets** | Extend beyond Manila to other markets |
| **Variable thresholds** | Allow per-policy strike values |
| **Partial payouts** | Graduated payouts based on rainfall amount |
| **Multi-location policies** | Coverage across multiple coordinates |

> **Note:** For detailed V2 oracle architecture, see `oracle-design.md` Sections 17-25.

---
