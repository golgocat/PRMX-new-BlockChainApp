# PRMX XCM Chopsticks Tests

This directory contains test scripts for verifying XCM cross-chain capital management between PRMX, Asset Hub, and Hydration.

## Overview

The PRMX XCM Capital Integration enables the DAO to deploy policy capital into Hydration's Stableswap Pool 102 (USDT/USDC) for yield generation. These tests verify the XCM flows using Chopsticks to fork mainnet state.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Polkadot Relay Chain                        │
│                     (HRMP Channel Management)                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   PRMX (2000)   │  │ Asset Hub (1000)│  │ Hydration (2034)│
│                 │  │                 │  │                 │
│ • Policy Pallet │  │ • USDT Reserve  │  │ • Stableswap    │
│ • XCM Capital   │  │   (Asset 1984)  │  │   Pool 102      │
│ • DAO Account   │  │ • USDC Reserve  │  │ • LP Tokens     │
└────────┬────────┘  │   (Asset 1337)  │  │   (Asset 102)   │
         │           └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         └────────────────────┴────────────────────┘
                        XCM Transfers
```

## Prerequisites

1. **Node.js** >= 18
2. **Chopsticks** - Substrate chain forking tool
   ```bash
   npm install -g @acala-network/chopsticks
   ```

3. **Test Dependencies**
   ```bash
   cd scripts/chopsticks-tests
   npm install @polkadot/api @polkadot/keyring @polkadot/util
   ```

## Chopsticks Configuration

The `chopsticks/` directory contains configuration files:

| File | Description |
|------|-------------|
| `hydration.yml` | Fork Hydration mainnet (port 8000) |
| `asset-hub.yml` | Fork Asset Hub mainnet (port 8001) |
| `prmx.yml` | Connect to PRMX dev node (port 8002) |
| `xcm-test.yml` | Multi-chain XCM orchestration |

## Test Scripts

### Setup

```bash
# Check HRMP channels and sovereign accounts
node scripts/chopsticks-tests/setup-hrmp-channels.mjs
```

### Individual Tests

```bash
# Test XCM deposit flow (PRMX -> Asset Hub -> Hydration)
node scripts/chopsticks-tests/test-xcm-deposit.mjs

# Test XCM withdrawal flow (Hydration -> Asset Hub -> PRMX)
node scripts/chopsticks-tests/test-xcm-withdraw.mjs

# Test full policy lifecycle with XCM
node scripts/chopsticks-tests/test-full-xcm-cycle.mjs
```

### Run All Tests

```bash
./scripts/run-chopsticks-test.sh
```

## XCM Flows

### Deposit Flow (enter_strategy)

1. **PRMX**: DAO calls `dao_allocate_to_defi(policy_id, amount)`
2. **PRMX**: Build XCM with `WithdrawAsset` + `InitiateReserveWithdraw`
3. **Asset Hub**: Receive USDT, execute `DepositReserveAsset` to Hydration
4. **Hydration**: Execute `Transact` → `stableswap.add_liquidity(102, [USDT], min_lp)`
5. **Hydration**: LP tokens minted to PRMX sovereign account

### Withdrawal Flow (exit_strategy)

1. **PRMX**: Settlement triggers `ensure_local_liquidity`
2. **PRMX → Hydration**: Send XCM with `Transact` instruction
3. **Hydration**: Execute `stableswap.remove_liquidity_one_asset(102, USDT, shares, min_out)`
4. **Hydration → Asset Hub**: `InitiateReserveWithdraw` with USDT
5. **Asset Hub → PRMX**: `DepositReserveAsset` to policy pool account

## Key Constants

```javascript
// Chain IDs
PRMX_PARA_ID: 2000
ASSET_HUB_PARA_ID: 1000
HYDRATION_PARA_ID: 2034

// Asset IDs
USDT_ASSET_HUB: 1984
USDC_ASSET_HUB: 1337
USDT_HYDRATION: 10
USDC_HYDRATION: 22
LP_POOL_102: 102

// Pool Configuration
STABLESWAP_POOL_ID: 102
```

## Sovereign Account Derivation

PRMX sovereign accounts on sibling chains are derived using:

```rust
// In Substrate/XCM:
let sovereign = Sibling::from(PRMX_PARA_ID).into_account_truncating();
```

This is a 32-byte account derived from `"sibl" + para_id (little-endian u32)`.

## Troubleshooting

### Chopsticks Connection Issues

```bash
# Check if chains are running
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"system_chain","params":[],"id":1}' \
  http://localhost:8000

# Restart Chopsticks with fresh DB
rm -rf chopsticks/db
./scripts/run-chopsticks-test.sh
```

### HRMP Channel Not Found

If HRMP channels don't appear open, ensure:
1. The relay chain config includes HRMP storage overrides
2. Wait for Chopsticks to fully initialize (30+ seconds)
3. Check `xcm-test.yml` has correct HRMP configuration

### LP Token Balance Issues

For withdrawal tests, ensure PRMX sovereign has LP tokens:
```yaml
# In chopsticks/hydration.yml
import-storage:
  Tokens:
    Accounts:
      - - ["PRMX_SOVEREIGN_ACCOUNT", 102]
        - free: "1000000000"  # LP tokens
```

## Development Notes

### Adding New Tests

1. Create test file in `scripts/chopsticks-tests/`
2. Import utilities from `common.mjs`
3. Use `connectAllChains()` for multi-chain setup
4. Remember to call `disconnectAll()` in finally block

### Modifying XCM Programs

XCM message construction is in:
- `pallets/prmx-xcm-capital/src/xcm_strategy.rs`

Key functions:
- `build_deposit_xcm()` - Deposit to Pool 102
- `build_withdraw_xcm()` - Withdraw from Pool 102
- `encode_add_liquidity()` - Hydration stableswap call encoding
- `encode_remove_liquidity()` - Hydration stableswap call encoding
