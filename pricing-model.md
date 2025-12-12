# PRMX v1 – 24h Product And R Actuarial Model Integration

This document describes how the existing R-based actuarial rainfall model is integrated into PRMX v1.

**Implementation Status:**
- ✅ 24-hour fixed coverage window enforced in frontend
- ✅ R pricing API integration via offchain worker
- ✅ On-chain pricing logic in `pallet_prmx_quote`
- ✅ Oracle settlement logic with 24h rolling sum
- ✅ Mock DeFi strategy via `pallet_prmx_xcm_capital`

v1 intentionally restricts the product to a single 24-hour coverage window so that:

| R Model Event Definition | Oracle Event Definition |
|--------------------------|-------------------------|
| Total rainfall during the coverage window ≥ `threshold_mm` | 24h rolling rainfall ≥ `strike_mm` at least once during the coverage window |

Because `coverage_end = coverage_start + 24h`, the only 24h window inside the policy is exactly that coverage period.

---

## Table of Contents

1. [Product Scope (v1)](#1-product-scope-v1)
2. [R Actuarial Model: Conceptual Role](#2-r-actuarial-model-conceptual-role)
3. [Parameter Mapping: PRMX → R API](#3-parameter-mapping-prmx--r-api)
4. [Offchain Worker Logic](#4-offchain-worker-logic)
5. [On-chain Pricing Logic](#5-on-chain-pricing-logic-pallet_prmx_quote)
6. [Oracle Settlement Logic in v1](#6-oracle-settlement-logic-in-v1)
7. [v2 Evolution Path (Informative)](#7-v2-evolution-path-informative)

---

## 1. Product Scope (v1)

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

## 4. Offchain Worker Logic

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

## 5. On-chain Pricing Logic (pallet_prmx_quote)

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

## 6. Oracle Settlement Logic in v1

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

## 7. Capital Management Integration

### DeFi Strategy (v1: Mock Mode)

When a policy is created, the DAO's capital contribution can be allocated to a DeFi strategy:

```
policy_creation:
  1. User pays premium → policy pool account
  2. DAO contributes required_capital → policy pool account
  3. pallet_prmx_xcm_capital::allocate_capital() called
     - v1 (MockXcmStrategyInterface): Simulates DeFi deposit, tracks LP shares
     - Future (LiveXcmStrategyInterface): Real XCM to Hydration Pool 102
```

At settlement:

```
settlement:
  1. pallet_prmx_xcm_capital::withdraw_capital() called
     - v1 (Mock): Returns principal ± mock yield
     - Future (Live): Real XCM withdrawal from Hydration
  2. If event occurred: payout to policyholder
  3. If no event: distribute to LP holders
```

### Mock Yield Configuration

For testing different scenarios:

```rust
// Set mock yield rate (extrinsic)
PrmxXcmCapital::set_mock_yield_rate(50_000); // +5% yield
PrmxXcmCapital::set_mock_yield_rate(-20_000); // -2% loss
```

---

## 8. v2 Evolution Path (Informative)

This v1 design deliberately:

- Fixes the coverage window to 24h
- Treats the R model as a probability oracle for "24h total rainfall ≥ `strike_mm`"

### Planned v2 Extensions

For v2, we can extend **without changing the API boundary**:

| Change | Description |
|--------|-------------|
| **Coverage windows** | Allow 1–7 days |
| **R model updates** | Simulate hourly rainfall over the full window; compute the maximum 24h rolling cumulative rainfall within that window; define the event as `max_24h_rolling ≥ strike_mm` |
| **On-chain oracle** | Track rolling 24h mm across arbitrary windows |
| **API compatibility** | Keep the same API signature and `probability_ppm` semantics |
| **Real XCM DeFi** | Switch from `MockXcmStrategyInterface` to `LiveXcmStrategyInterface` for Hydration Pool 102 |
| **Parachain deployment** | Re-add cumulus pallets, configure HRMP channels |

> This keeps v1 simple and ship-able, while leaving a clear path to a more sophisticated product in v2.

### v2 Parachain Migration Checklist

1. Re-add cumulus dependencies to `runtime/Cargo.toml`
2. Re-create `runtime/src/xcm_config.rs` with XCM executor configuration
3. Add cumulus pallets back to `construct_runtime!`
4. Switch strategy in runtime config:
   ```rust
   type XcmStrategyInterface = pallet_prmx_xcm_capital::LiveXcmStrategyInterface<Runtime>;
   ```
5. Configure HRMP channels with Asset Hub (para 1000) and Hydration (para 2034)
6. Fund sovereign accounts for XCM execution

---
