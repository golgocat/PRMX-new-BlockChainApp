# PRMX Functional Tests

This folder contains comprehensive functional tests for the PRMX parametric rainfall insurance blockchain.

## Prerequisites

1. **Node.js** installed (v18+)
2. **PRMX blockchain** running locally:
   ```bash
   cd /path/to/PRMX-new-BlockChainApp
   ./target/release/prmx-node --dev --tmp --rpc-port 9944
   ```
3. **Dependencies** installed:
   ```bash
   cd scripts
   npm install
   ```

## Running Tests

Each test can be run individually:

```bash
cd scripts/functional-tests
node test-name.mjs
```

Or run multiple tests sequentially (note: tests may affect chain state):

```bash
for f in test-*.mjs; do echo "Running $f..."; node "$f"; done
```

## Test Categories

### 1. Auto-Settlement Tests

| Test | Description |
|------|-------------|
| `test-auto-settlement-threshold-breach.mjs` | Verifies automatic settlement when rainfall exceeds threshold during active coverage |
| `test-auto-settlement-timing.mjs` | Verifies settlement checks run at correct intervals (BLOCKS_PER_SETTLEMENT_CHECK) |

### 2. Oracle & Rainfall Tests

| Test | Description |
|------|-------------|
| `test-rolling-sum-calculation.mjs` | Verifies 24-hour rolling sum calculation across multiple buckets |
| `test-ocw-rainfall-fetch.mjs` | Monitors Offchain Worker (OCW) AccuWeather data fetching |
| `test-threshold-trigger-log.mjs` | Verifies ThresholdTriggerLog storage when threshold is breached |

### 3. Quote & Policy Lifecycle Tests

| Test | Description |
|------|-------------|
| `test-quote-expiry.mjs` | Verifies quotes expire if not accepted within validity period |
| `test-multiple-policies-same-market.mjs` | Tests multiple policies coexisting on one market |
| `test-policy-already-settled.mjs` | Verifies double-settlement prevention |

### 4. LP Orderbook Tests

| Test | Description |
|------|-------------|
| `test-lp-order-cancellation.mjs` | Tests LP ask order cancellation and token unlock |
| `test-lp-partial-fill.mjs` | Tests partial order fills on LP orderbook |
| `test-lp-sell-before-settlement.mjs` | Tests LP token transfer before settlement |
| `test-lp-bid-orders.mjs` | Tests bid (buy) side of LP orderbook |

### 5. Edge Cases & Error Handling

| Test | Description |
|------|-------------|
| `test-settlement-rounding.mjs` | Tests pro-rata distribution with odd amounts |
| `test-insufficient-funds.mjs` | Tests error handling for insufficient USDT |
| `test-invalid-coverage-period.mjs` | Tests validation of coverage period parameters |
| `test-zero-lp-holders.mjs` | Analyzes zero LP holder edge case |

### 6. Multi-Market Tests

| Test | Description |
|------|-------------|
| `test-multiple-markets.mjs` | Explores multi-market architecture and data isolation |
| `test-market-specific-settlement.mjs` | Verifies policy independence within markets |

## Common Module

The `common.mjs` file provides shared utilities:

- `connectToNode()` - Connect to PRMX node
- `getKeyring()` - Get test accounts (Alice, Bob, Charlie, Dave, Eve)
- `getDaoAccount()` - Get DAO account address
- `setupOracle()` - Configure oracle for a market
- `submitRainfall()` - Submit rainfall data
- `requestQuote()` / `submitQuote()` - Quote workflow
- `createPolicy()` / `settlePolicy()` - Policy workflow
- `getUsdtBalance()` / `getLpBalance()` - Balance queries
- `waitForBlocks()` / `waitUntilTime()` - Timing utilities
- `printHeader()` / `printSection()` - Output formatting

## Test Output

Each test produces formatted console output with:

- Step-by-step progress indicators
- Balance changes before/after operations
- Settlement results and fund flows
- Pass/Fail summary with key findings

## Notes

1. **Chain State**: Tests may modify chain state. For isolated testing, restart the node with `--tmp` flag between test runs.

2. **Timing**: Some tests involve waiting for coverage periods. Default durations are kept short (45-90 seconds) for faster testing.

3. **Test Accounts**: Tests use well-known dev accounts:
   - Alice: Oracle/Sudo authority
   - Bob: Customer (policy holder)
   - Charlie: LP Investor
   - Dave: LP Investor
   - Eve: Low-funds account for error testing

4. **Market 0**: Genesis creates Market 0 (Manila). Additional markets require governance action.

## Extending Tests

To create new tests:

1. Copy an existing test as template
2. Import utilities from `common.mjs`
3. Follow the established pattern:
   - STEP sections for major operations
   - Balance tracking before/after
   - Clear PASS/FAIL determination
   - Key findings summary

## Related Documentation

- `/PRMX-new-BlockChainApp/app-design.md` - Application architecture
- `/PRMX-new-BlockChainApp/oracle_design.md` - Oracle pallet design
- `/PRMX-new-BlockChainApp/pallets/*/src/lib.rs` - Pallet implementations
