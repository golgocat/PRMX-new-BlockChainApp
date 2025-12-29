# PRMX Comprehensive Test Suite

Comprehensive end-to-end tests for V1, V2, and V3 policy systems with H128 hash-based ID support.

## Overview

This test suite validates the full policy lifecycle across all three policy versions, ensuring:

- H128 hash-based IDs are properly generated and extracted
- No ID collisions between V1/V2 and V3 policy systems
- Complete policy lifecycle works correctly (create, trade LP, settle)
- LP holdings are correctly separated by policy

## Prerequisites

1. **Node.js** installed (v18+)
2. **PRMX node** running with development settings:
   ```bash
   ./target/release/prmx-node --dev --rpc-methods=Unsafe
   ```
3. **Fresh chain state** recommended for consistent results

## Quick Start

```bash
# Navigate to the test directory
cd scripts/tests

# Run all tests
node run-all-tests.mjs

# Run with custom WebSocket endpoint
node run-all-tests.mjs ws://localhost:9944
```

## Test Suites

### V1 Policy Lifecycle (`test-v1-lifecycle.mjs`)

Tests the complete V1 policy flow:

1. Setup oracle/market
2. Request quote (verify H128 QuoteId)
3. Submit quote result
4. Apply coverage (verify H128 PolicyId)
5. Verify LP tokens minted to DAO
6. Trade LP tokens on orderbook
7. Submit rainfall data
8. Settle policy (event occurred scenario)
9. Verify payouts

```bash
node test-v1-lifecycle.mjs [ws-endpoint]
```

### V2 Policy Lifecycle (`test-v2-lifecycle.mjs`)

Tests the complete V2 policy flow with custom strike:

1. Setup oracle/market
2. Request V2 quote with custom strike
3. Submit quote result
4. Apply V2 coverage
5. Submit V2 final report
6. Early trigger settlement
7. Maturity settlement (no-event scenario)
8. Verify payouts

```bash
node test-v2-lifecycle.mjs [ws-endpoint]
```

### V3 P2P Policy Lifecycle (`test-v3-lifecycle.mjs`)

Tests the complete V3 P2P underwriting flow:

1. Setup V3 oracle and location registry
2. Create underwrite request (verify H128 RequestId)
3. Partial acceptance by multiple underwriters
4. Full fill and policy creation (verify H128 PolicyId)
5. LP token verification and trading
6. Submit oracle snapshots
7. Settlement (trigger and maturity)
8. Payout distribution

```bash
node test-v3-lifecycle.mjs [ws-endpoint]
```

### Cross-Version Coexistence (`test-cross-version.mjs`)

Validates that V1, V2, and V3 policies can coexist:

1. Create V1 policy
2. Create V2 policy
3. Create V3 policy
4. Verify all IDs are unique H128 hashes
5. Verify LP holdings are correctly separated
6. Verify no ID collisions
7. Settle all policies independently

```bash
node test-cross-version.mjs [ws-endpoint]
```

### LP Orderbook Trading (`test-lp-trading.mjs`)

Tests LP token trading functionality:

1. Create policy for trading
2. Verify DAO ask orders placed
3. Buy LP tokens from orderbook
4. Place new ask orders
5. Cancel ask orders
6. Partial order fills

```bash
node test-lp-trading.mjs [ws-endpoint]
```

### Oracle Advanced (`test-oracle-advanced.mjs`)

Tests oracle threshold and settlement:

1. Threshold breach detection
2. 24-hour rolling window calculation
3. Auto-settlement triggers
4. Manual settlement
5. No-event settlement scenario

```bash
node test-oracle-advanced.mjs [ws-endpoint]
```

### Edge Cases (`test-edge-cases.mjs`)

Tests error handling and edge cases:

1. Quote/request expiration
2. V3 request with short expiry
3. Partial V3 acceptance
4. Unauthorized oracle submission
5. Invalid coverage dates
6. Zero shares request
7. Double settlement attempt

```bash
node test-edge-cases.mjs [ws-endpoint]
```

### Multi-Party Scenarios (`test-multi-party.mjs`)

Tests complex multi-party interactions:

1. Multiple policyholders in same market
2. Multiple underwriters for V3 request
3. LP token transfer chain
4. Concurrent policy creation
5. Settlement with multiple stakeholders

```bash
node test-multi-party.mjs [ws-endpoint]
```

## Unified Test Runner

Run all test suites with a summary report:

```bash
# Run all suites
node run-all-tests.mjs

# Run specific suites
node run-all-tests.mjs --suite v1,v3,edge,multi

# List available suites
node run-all-tests.mjs --list

# Show help
node run-all-tests.mjs --help
```

### Options

| Option | Description |
|--------|-------------|
| `--list`, `-l` | List available test suites |
| `--suite`, `-s` | Run specific suites (comma-separated: v1,v2,v3,cross) |
| `--verbose`, `-v` | Show detailed output |
| `--help`, `-h` | Show help message |

## H128 Hash-Based IDs

All ID types (PolicyId, QuoteId, RequestId, OrderId) are now 128-bit hashes instead of sequential integers. This ensures:

- **No collisions**: IDs are generated using blake2_128 hash of (sender, nonce, block_number, pallet_id, version_prefix)
- **Version isolation**: V1/V2 and V3 policies have distinct ID spaces
- **Unpredictability**: IDs cannot be guessed or enumerated

### ID Format

IDs are represented as 34-character hex strings:

```
0x1a2b3c4d5e6f7890abcdef1234567890
```

### Extracting IDs from Events

```javascript
// OLD (numeric IDs)
const policyId = event.data[0].toNumber();

// NEW (H128 hash IDs)
const policyId = event.data[0].toHex();
```

## Test Accounts

All tests use the standard development accounts:

| Account | Role |
|---------|------|
| Alice | Admin, Oracle, Settler |
| Bob | Policyholder, V1/V2 Customer |
| Charlie | Underwriter 1, V2 Customer |
| Dave | Underwriter 2, V3 Requester |
| Eve | LP Buyer, V3 Underwriter |

## Shared Utilities (`common.mjs`)

The common module provides:

- **Connection**: `connectToNode()`, `getKeyring()`
- **H128 Handling**: `extractH128Id()`, `findEventAndExtractId()`, `isValidH128()`
- **Balances**: `getUsdtBalance()`, `getLpBalance()`, `getTotalLpShares()`
- **Transactions**: `signAndSend()`, `sendTx()`
- **Setup**: `setupUsdt()`, `setupV1V2Oracle()`, `setupV3Oracle()`
- **Time**: `getChainTime()`, `getOracleTime()`, `waitForBlocks()`, `sleep()`
- **Results**: `TestResults` class for tracking pass/fail

## Example Output

```
╔══════════════════════════════════════════════════════════════════════╗
║  🧪 PRMX COMPREHENSIVE TEST SUITE                                    ║
║  Testing H128 Hash-Based ID Implementation                           ║
╚══════════════════════════════════════════════════════════════════════╝

📡 WebSocket Endpoint: ws://127.0.0.1:9944
📋 Running 4 test suite(s): v1, v2, v3, cross

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧪 Running: V1 Policy Lifecycle
...

╔══════════════════════════════════════════════════════════════════════╗
║  📊 COMPREHENSIVE TEST SUMMARY                                        ║
╠══════════════════════════════════════════════════════════════════════╣
║  ✅ V1 Policy Lifecycle                    12/12 tests (15.2s)       ║
║  ✅ V2 Policy Lifecycle                    14/14 tests (18.5s)       ║
║  ✅ V3 P2P Policy Lifecycle                16/16 tests (22.3s)       ║
║  ✅ Cross-Version Coexistence              10/10 tests (25.1s)       ║
╠══════════════════════════════════════════════════════════════════════╣
║  Suites: 4 passed, 0 failed (4 total)                                ║
║  Tests:  52 passed, 0 failed (52 total)                              ║
║  Time:   81.1s                                                        ║
╠══════════════════════════════════════════════════════════════════════╣
║  ✅ ALL TESTS PASSED                                                  ║
╚══════════════════════════════════════════════════════════════════════╝
```

## Troubleshooting

### Connection Issues

```
Error: Cannot connect to ws://127.0.0.1:9944
```

Ensure the PRMX node is running with WebSocket RPC enabled:
```bash
./target/release/prmx-node --dev --rpc-methods=Unsafe --ws-port=9944
```

### Insufficient Funds

The test setup mints USDT to all test accounts. If you see "InsufficientBalance" errors, the setup may have failed. Try restarting with a fresh chain state.

### ID Extraction Failures

If tests fail to extract H128 IDs, ensure your runtime includes the latest changes with hash-based ID types. Rebuild and restart the node:

```bash
cargo build --release -p prmx-node
./target/release/prmx-node purge-chain --dev -y
./target/release/prmx-node --dev --rpc-methods=Unsafe
```

