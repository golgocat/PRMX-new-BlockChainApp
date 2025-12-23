# PRMX Policy Settlement Flow

This document explains how rainfall insurance policies are monitored and settled in the PRMX system. There are two versions of the oracle system (V1 and V2) with different approaches to settlement.

## Table of Contents

1. [Overview](#overview)
2. [V1 Oracle Settlement](#v1-oracle-settlement)
3. [V2 Oracle Settlement](#v2-oracle-settlement)
4. [Comparison](#comparison)
5. [Settlement Outcomes](#settlement-outcomes)
6. [Technical Details](#technical-details)

---

## Overview

PRMX provides rainfall insurance where policyholders are protected against excessive rainfall events. When rainfall exceeds a predefined threshold (strike value), the policy is "triggered" and the policyholder receives a payout.

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRMX SETTLEMENT OVERVIEW                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Policyholder                     Liquidity Provider (LP)      │
│        │                                    │                    │
│        │ Buys Policy                        │ Provides Liquidity │
│        ▼                                    ▼                    │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                   PRMX Blockchain                        │   │
│   │                                                          │   │
│   │   Policy Created → Oracle Monitors → Settlement          │   │
│   │                                                          │   │
│   │   if (rainfall >= strike):  Policyholder WINS ✅         │   │
│   │   if (rainfall < strike):   LPs WIN ✅                   │   │
│   └─────────────────────────────────────────────────────────┘   │
│                          ▲                                       │
│                          │                                       │
│                    Oracle System                                 │
│              (V1 On-chain / V2 Off-chain)                       │
│                          │                                       │
│                          ▼                                       │
│              ┌─────────────────────┐                            │
│              │    AccuWeather API  │                            │
│              │  (Rainfall Data)    │                            │
│              └─────────────────────┘                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## V1 Oracle Settlement

V1 uses an **on-chain Offchain Worker (OCW)** to fetch and process rainfall data. Settlement is automatic and happens entirely on-chain.

### V1 Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         V1 ORACLE SETTLEMENT FLOW                           │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────────┐
                              │  User Creates    │
                              │   V1 Policy      │
                              │ (uses market     │
                              │  strike: 50mm)   │
                              └────────┬─────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      ON-CHAIN: prmx-oracle Pallet                           │
│ ─────────────────────────────────────────────────────────────────────────── │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                  OFFCHAIN WORKER (OCW)                              │   │
│   │                  Runs every block                                   │   │
│   │                                                                      │   │
│   │   1. Check if market needs rainfall update                          │   │
│   │      └── Round-robin through markets                                │   │
│   │      └── Skip if fetched within last hour                           │   │
│   │                                                                      │   │
│   │   2. Fetch from AccuWeather API                                     │   │
│   │      └── GET /currentconditions/v1/{locationKey}/historical/24      │   │
│   │      └── Returns 24 hourly precipitation readings                   │   │
│   │                                                                      │   │
│   │   3. Parse and store hourly buckets                                 │   │
│   │      └── HourlyBuckets<MarketId, HourIndex> = { mm, fetched_at }    │   │
│   │                                                                      │   │
│   │   4. Calculate rolling 24h sum                                      │   │
│   │      └── Sum all buckets from last 24 hours                         │   │
│   │      └── Store in RollingState<MarketId>                            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │              SETTLEMENT CHECK (Every 10 blocks)                     │   │
│   │              on_initialize() hook                                   │   │
│   │                                                                      │   │
│   │   for each market:                                                  │   │
│   │       rolling_sum = RollingState[market_id].rolling_sum_mm          │   │
│   │       strike = Markets[market_id].strike_value                      │   │
│   │                                                                      │   │
│   │       if rolling_sum >= strike:                                     │   │
│   │           for each active V1 policy in market:                      │   │
│   │               if now >= coverage_start AND now <= coverage_end:     │   │
│   │                   → TRIGGER SETTLEMENT (Early Trigger)              │   │
│   │                                                                      │   │
│   │       for each expired V1 policy:                                   │   │
│   │           if now > coverage_end AND not settled:                    │   │
│   │               → MATURE SETTLEMENT (No Event)                        │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    SETTLEMENT EXECUTION                             │   │
│   │                                                                      │   │
│   │   Triggered (rainfall >= strike):                                   │   │
│   │   └── Payout to policyholder                                        │   │
│   │   └── Burn LP tokens                                                │   │
│   │   └── Set policy.status = Settled                                   │   │
│   │   └── Emit V1PolicySettled { outcome: Triggered }                   │   │
│   │                                                                      │   │
│   │   Matured No Event (rainfall < strike at expiry):                   │   │
│   │   └── Return funds to LPs                                           │   │
│   │   └── Unlock LP shares                                              │   │
│   │   └── Set policy.status = Settled                                   │   │
│   │   └── Emit V1PolicySettled { outcome: MaturedNoEvent }              │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### V1 Key Characteristics

| Feature | Description |
|---------|-------------|
| **Oracle Location** | On-chain (Offchain Worker) |
| **Strike Value** | Market-level (same for all policies in market) |
| **Measurement** | Rolling 24-hour sum |
| **Data Source** | AccuWeather `/historical/24` endpoint |
| **Settlement** | Automatic, on-chain |
| **Early Trigger** | ✅ Enabled - settles immediately when threshold breached |
| **Storage** | `HourlyBuckets`, `RollingState` on-chain |

### V1 On-Chain Storage

```rust
// Hourly rainfall readings per market
HourlyBuckets<MarketId, HourIndex> = HourlyBucket {
    mm: Millimeters,      // Rainfall in mm * 10
    fetched_at: u64,      // Unix timestamp
    source: u8,           // 0=current, 1=historical
}

// Rolling 24h sum per market
RollingState<MarketId> = RollingWindowState {
    rolling_sum_mm: Millimeters,
    last_bucket_index: u64,
    oldest_bucket_index: u64,
}
```

---

## V2 Oracle Settlement

V2 uses an **off-chain oracle service** with MongoDB for data storage. Settlement requires explicit report submission.

### V2 Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         V2 ORACLE SETTLEMENT FLOW                           │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────────┐
                              │  User Creates    │
                              │   V2 Policy      │
                              │ (custom strike:  │
                              │   e.g., 1mm)     │
                              └────────┬─────────┘
                                       │
                                       │ Emits V2PolicyCreated event
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    OFF-CHAIN: Oracle V2 Service                             │
│                    (Node.js + MongoDB)                                      │
│ ─────────────────────────────────────────────────────────────────────────── │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                 EVENT LISTENER (listener.ts)                        │   │
│   │                                                                      │   │
│   │   Subscribes to chain events:                                       │   │
│   │   └── V2PolicyCreated → Create monitor in MongoDB                   │   │
│   │   └── V2PolicySettled → Update monitor state                        │   │
│   │                                                                      │   │
│   │   On V2PolicyCreated:                                               │   │
│   │   1. Create Monitor document:                                       │   │
│   │      {                                                               │   │
│   │        _id: "market_id:policy_id",                                  │   │
│   │        state: "monitoring",                                         │   │
│   │        strike_mm: 10,  // 1mm in storage units                      │   │
│   │        coverage_start: 1766419200,                                  │   │
│   │        coverage_end: 1766851199,                                    │   │
│   │        cumulative_mm: 0,                                            │   │
│   │      }                                                               │   │
│   │                                                                      │   │
│   │   2. Fetch initial 24h historical data from AccuWeather             │   │
│   │   3. Pre-populate buckets within coverage period                    │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │               SCHEDULER (monitor.ts)                                │   │
│   │               Runs every 30 minutes (configurable)                  │   │
│   │                                                                      │   │
│   │   for each monitor where state === 'monitoring':                    │   │
│   │       evaluateMonitor(monitor)                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │               EVALUATOR (cumulative.ts)                             │   │
│   │                                                                      │   │
│   │   ┌─────────────────────────────────────────────────────────────┐   │   │
│   │   │                PRE-EVALUATION CHECKS                        │   │   │
│   │   │                                                              │   │   │
│   │   │   state !== 'monitoring'? ──────── SKIP ────────────────── │   │   │
│   │   │                    │                                         │   │   │
│   │   │                    ▼                                         │   │   │
│   │   │   now < coverage_start? ──────── SKIP (not started) ─────── │   │   │
│   │   │                    │                                         │   │   │
│   │   │                    ▼                                         │   │   │
│   │   │   checkV2ReportExists(policy_id)? ── SKIP (reported) ────── │   │   │
│   │   └─────────────────────────────────────────────────────────────┘   │   │
│   │                        │                                            │   │
│   │                        ▼                                            │   │
│   │   ┌─────────────────────────────────────────────────────────────┐   │   │
│   │   │           FETCH & AGGREGATE RAINFALL                        │   │   │
│   │   │                                                              │   │   │
│   │   │   1. fetchHistorical24Hours(location_key)                   │   │   │
│   │   │      └── GET /currentconditions/v1/{key}/historical/24      │   │   │
│   │   │                                                              │   │   │
│   │   │   2. Store hourly buckets in MongoDB                        │   │   │
│   │   │      └── Only within coverage period                        │   │   │
│   │   │                                                              │   │   │
│   │   │   3. Calculate cumulative rainfall                          │   │   │
│   │   │      └── cumulative_mm = SUM(all buckets.mm)                │   │   │
│   │   └─────────────────────────────────────────────────────────────┘   │   │
│   │                        │                                            │   │
│   │                        ▼                                            │   │
│   │   ┌─────────────────────────────────────────────────────────────┐   │   │
│   │   │             SETTLEMENT DECISION TREE                        │   │   │
│   │   │                                                              │   │   │
│   │   │           cumulative_mm >= strike_mm                         │   │   │
│   │   │           AND now <= coverage_end?                           │   │   │
│   │   │                      │                                       │   │   │
│   │   │        ┌─────────────┴─────────────┐                         │   │   │
│   │   │        │                           │                         │   │   │
│   │   │       YES                         NO                         │   │   │
│   │   │        │                           │                         │   │   │
│   │   │        ▼                           ▼                         │   │   │
│   │   │   ┌──────────┐            now >= coverage_end?               │   │   │
│   │   │   │ 🎯 EARLY │                     │                         │   │   │
│   │   │   │  TRIGGER │           ┌─────────┴─────────┐               │   │   │
│   │   │   │          │           │                   │               │   │   │
│   │   │   │ outcome: │          YES                 NO               │   │   │
│   │   │   │'Triggered'│          │                   │               │   │   │
│   │   │   └──────────┘           ▼                   ▼               │   │   │
│   │   │        │          ┌──────────┐      ┌────────────┐           │   │   │
│   │   │        │          │ 📅 MATURE│      │ ⏳ CONTINUE │           │   │   │
│   │   │        │          │          │      │ MONITORING │           │   │   │
│   │   │        │          │ outcome: │      │            │           │   │   │
│   │   │        │          │'Matured  │      │ Wait for   │           │   │   │
│   │   │        │          │ NoEvent' │      │ next poll  │           │   │   │
│   │   │        │          └──────────┘      └────────────┘           │   │   │
│   │   │        │                │                                    │   │   │
│   │   │        └───────┬────────┘                                    │   │   │
│   │   │                │                                             │   │   │
│   │   │                ▼                                             │   │   │
│   │   │   ┌─────────────────────────────────────────────────────┐   │   │   │
│   │   │   │            BUILD EVIDENCE                           │   │   │   │
│   │   │   │                                                      │   │   │   │
│   │   │   │   evidence = {                                       │   │   │   │
│   │   │   │     version: '2.0',                                  │   │   │   │
│   │   │   │     policy_id, market_id, outcome,                   │   │   │   │
│   │   │   │     cumulative_mm, strike_mm,                        │   │   │   │
│   │   │   │     buckets: [{hour, mm}, ...]                       │   │   │   │
│   │   │   │   }                                                  │   │   │   │
│   │   │   │                                                      │   │   │   │
│   │   │   │   evidence_hash = SHA256(JSON.stringify(evidence))   │   │   │   │
│   │   │   └─────────────────────────────────────────────────────┘   │   │   │
│   │   │                        │                                     │   │   │
│   │   └────────────────────────┼─────────────────────────────────────┘   │   │
│   │                            │                                         │   │
│   └────────────────────────────┼─────────────────────────────────────────┘   │
│                                │                                             │
└────────────────────────────────┼─────────────────────────────────────────────┘
                                 │
                                 │ submitV2Report()
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      ON-CHAIN: prmx-oracle Pallet                           │
│ ─────────────────────────────────────────────────────────────────────────── │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                 submitV2Report Extrinsic                            │   │
│   │                                                                      │   │
│   │   Parameters:                                                       │   │
│   │   - policy_id: u32                                                  │   │
│   │   - outcome: 'Triggered' | 'MaturedNoEvent'                         │   │
│   │   - observed_at: u64                                                │   │
│   │   - cumulative_mm: u32                                              │   │
│   │   - evidence_hash: [u8; 32]                                         │   │
│   │                                                                      │   │
│   │   1. Verify caller is authorized V2 reporter                        │   │
│   │      └── AuthorizedV2Reporters.get(caller) == true                  │   │
│   │                                                                      │   │
│   │   2. Verify report not already submitted                            │   │
│   │      └── V2FinalReportByPolicy.get(policy_id).is_none()            │   │
│   │                                                                      │   │
│   │   3. Store report on-chain                                          │   │
│   │      └── V2FinalReportByPolicy.insert(policy_id, report)           │   │
│   │                                                                      │   │
│   │   4. Emit V2ReportAccepted event                                    │   │
│   │                                                                      │   │
│   │   5. Forward to policy pallet for settlement                        │   │
│   │      └── T::PolicySettlement::settle_v2(policy_id, outcome, ...)    │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      ON-CHAIN: prmx-policy Pallet                           │
│ ─────────────────────────────────────────────────────────────────────────── │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                 settle_v2 Implementation                            │   │
│   │                                                                      │   │
│   │   if outcome == 'Triggered':                                        │   │
│   │       • Calculate payout to policyholder                            │   │
│   │       • Transfer from policy reserve to policyholder                │   │
│   │       • Burn LP tokens                                              │   │
│   │                                                                      │   │
│   │   if outcome == 'MaturedNoEvent':                                   │   │
│   │       • Return premium to LPs                                       │   │
│   │       • Unlock LP shares                                            │   │
│   │                                                                      │   │
│   │   Set policy.status = Settled                                       │   │
│   │   Emit V2PolicySettled event                                        │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### V2 Key Characteristics

| Feature | Description |
|---------|-------------|
| **Oracle Location** | Off-chain (Node.js service) |
| **Strike Value** | Policy-level (customizable per policy) |
| **Measurement** | Cumulative during coverage period |
| **Data Source** | AccuWeather `/historical/24` endpoint |
| **Settlement** | Manual report submission |
| **Early Trigger** | ✅ Enabled - reports immediately when threshold breached |
| **Storage** | MongoDB (off-chain), final report on-chain |

### V2 MongoDB Collections

```typescript
// Monitor document
{
  _id: "0:0",                    // market_id:policy_id
  market_id: 0,
  policy_id: 0,
  state: "monitoring" | "triggered" | "matured" | "reported",
  strike_mm: 10,                 // 1mm in storage units (mm * 10)
  coverage_start: 1766419200,    // Unix timestamp
  coverage_end: 1766851199,
  cumulative_mm: 47,             // 4.7mm in storage units
  location_key: "264885",        // AccuWeather location key
  trigger_time?: 1766476213,     // When triggered
  evidence_hash?: "d480f9...",   // SHA256 of evidence
  report_tx_hash?: "0xbcdfaf..." // On-chain tx hash
}

// Bucket document (hourly readings)
{
  _id: "0:0:2024122316",         // monitor_id:YYYYMMDDHH
  monitor_id: "0:0",
  hour_utc: "2024-12-23T16:00:00Z",
  mm: 5,                         // 0.5mm
  backfilled: false,
  raw_data: { ... }              // AccuWeather response
}

// Evidence document
{
  _id: "d480f9...",              // SHA256 hash
  monitor_id: "0:0",
  json_blob: { ... },            // Full evidence JSON
  created_at: Date
}
```

---

## Comparison

| Aspect | V1 Oracle | V2 Oracle |
|--------|-----------|-----------|
| **Architecture** | On-chain OCW | Off-chain service |
| **Strike Value** | Market-level (fixed) | Policy-level (customizable) |
| **Rainfall Metric** | Rolling 24h sum | Cumulative during coverage |
| **Settlement** | Automatic on-chain | Explicit report submission |
| **Data Storage** | On-chain (`HourlyBuckets`) | Off-chain (MongoDB) |
| **Scalability** | Limited by block weight | Highly scalable |
| **Gas Costs** | Higher (on-chain ops) | Lower (off-chain computation) |
| **Transparency** | Fully on-chain | Evidence hash on-chain |
| **Latency** | Every block | Configurable polling interval |
| **Use Case** | Standard policies | Custom/flexible policies |

### When to Use Each Version

**Use V1 when:**
- You want fully decentralized, trustless operation
- Standard market strike values are acceptable
- You need immediate on-chain verification

**Use V2 when:**
- You need custom strike values per policy
- You want cumulative rainfall tracking
- You prefer lower gas costs
- You need longer coverage periods (7+ days)

---

## Settlement Outcomes

Both V1 and V2 have two possible settlement outcomes:

### 1. Triggered (Policyholder Wins)

```
┌─────────────────────────────────────────────────────────┐
│                    TRIGGERED OUTCOME                     │
│                                                          │
│   Condition: rainfall >= strike during coverage period   │
│                                                          │
│   Actions:                                               │
│   1. Calculate payout amount                             │
│   2. Transfer from policy reserve to policyholder        │
│   3. Burn LP tokens (proportionally)                     │
│   4. Set policy.status = Settled                         │
│                                                          │
│   Example:                                               │
│   - Policy: 100 USDT coverage                           │
│   - Strike: 1mm                                          │
│   - Actual: 4.7mm                                        │
│   - Result: Policyholder receives 100 USDT payout       │
└─────────────────────────────────────────────────────────┘
```

### 2. Matured No Event (LPs Win)

```
┌─────────────────────────────────────────────────────────┐
│                  MATURED NO EVENT OUTCOME                │
│                                                          │
│   Condition: coverage_end reached AND rainfall < strike  │
│                                                          │
│   Actions:                                               │
│   1. Return premium to LP pool                           │
│   2. Unlock LP shares                                    │
│   3. LPs can claim their share + profit                 │
│   4. Set policy.status = Settled                         │
│                                                          │
│   Example:                                               │
│   - Policy: 100 USDT coverage, 10 USDT premium          │
│   - Strike: 50mm                                         │
│   - Actual: 4.7mm                                        │
│   - Result: LPs keep 10 USDT premium as profit          │
└─────────────────────────────────────────────────────────┘
```

---

## Technical Details

### AccuWeather API Integration

Both oracles use the AccuWeather Historical 24h endpoint:

```
GET https://dataservice.accuweather.com/currentconditions/v1/{locationKey}/historical/24
    ?apikey={API_KEY}
    &details=true

Response: Array of 24 hourly observations with precipitation data
```

### Location Keys (Default Markets)

| Market | Location Key | Timezone |
|--------|--------------|----------|
| Manila | 264885 | UTC+8 |
| Tokyo | 226396 | UTC+9 |
| Hong Kong | 1123655 | UTC+8 |
| Singapore | 300597 | UTC+8 |
| Jakarta | 208971 | UTC+7 |
| Dubai | 323091 | UTC+4 |

### Authorization

**V1 (OCW):** Runs automatically as part of the blockchain runtime. No explicit authorization needed.

**V2 (Off-chain):** Requires explicit reporter authorization:

```rust
// Add V2 reporter (governance only)
api.tx.sudo.sudo(
    api.tx.prmxOracle.addV2Reporter(reporterAddress)
)

// Check authorization
api.query.prmxOracle.authorizedV2Reporters(address) // returns bool
```

### Events

**V1 Events:**
- `V1RainfallUpdated { market_id, rolling_sum_mm, hour_index }`
- `V1PolicySettled { policy_id, outcome, rainfall_mm }`

**V2 Events:**
- `V2PolicyCreated { policy_id, market_id, coverage_start, coverage_end, strike_mm }`
- `V2ReportAccepted { policy_id, outcome, cumulative_mm, evidence_hash }`
- `V2PolicySettled { policy_id, outcome, cumulative_mm, evidence_hash }`

---

## API Endpoints (V2 Oracle Service)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/v2/monitors` | GET | List all monitors |
| `/v2/monitors/:id` | GET | Get specific monitor |
| `/v2/monitors/:id/buckets` | GET | Get hourly buckets |
| `/v2/monitors/:id/trigger` | POST | Trigger evaluation |
| `/v2/monitors/trigger-all` | POST | Trigger all evaluations |
| `/v2/monitors/:id/backfill` | POST | Backfill missing data |
| `/v2/admin/monitors/:id/reset` | POST | Reset monitor state |
| `/v2/stats` | GET | Get statistics |

---

## Troubleshooting

### V1 Issues

1. **0.0mm rainfall for all markets**
   - Check if AccuWeather API key is injected
   - Verify OCW is running (check node logs for `process_markets_and_fetch_rainfall`)
   - Check `MAX_INFLIGHT_AGE_SECS` isn't causing submission locks

2. **Policy not settling**
   - Verify `RollingState` has data: `api.query.prmxOracle.rollingState(marketId)`
   - Check market strike value
   - Ensure policy is within coverage period

### V2 Issues

1. **NotAuthorizedV2Reporter error**
   - Add reporter via sudo: `api.tx.sudo.sudo(api.tx.prmxOracle.addV2Reporter(address))`
   - Restart Oracle V2 service after adding reporter

2. **Monitor stuck in triggered state**
   - Use admin reset endpoint: `POST /v2/admin/monitors/:id/reset`
   - Then trigger evaluation again

3. **No active monitors**
   - Check if chain was restarted (genesis hash changed)
   - Verify V2PolicyCreated events are being emitted
   - Check MongoDB connection

---

*Last updated: December 2025*

