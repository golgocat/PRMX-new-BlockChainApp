# PRMX XCM Capital Integration Tests

This directory contains test scripts for the DeFi yield strategy integration (Hydration Stableswap Pool 102).

## Prerequisites

1. PRMX node running locally at `ws://127.0.0.1:9944`
2. Market 0 (Manila) must exist
3. DAO account (Alice) must have sufficient USDT

## Running Tests

From the `PRMX-new-BlockChainApp` directory:

```bash
# Start the node
./target/release/prmx-node --dev

# In another terminal, run tests:
cd scripts
node zombienet-tests/test-defi-allocation.mjs
```

## Test Scripts

### test-defi-allocation.mjs

Tests the `allocate_to_defi` flow:
- Verifies capital can be allocated to DeFi strategy (Pool 102)
- Checks investment status transitions
- Validates LP position tracking

```bash
node zombienet-tests/test-defi-allocation.mjs
```

### test-defi-unwind.mjs

Tests the `ensure_local_liquidity` flow during settlement:
- Verifies LP positions are unwound at settlement
- Checks fund distribution after unwind
- Validates DAO top-up on losses

```bash
node zombienet-tests/test-defi-unwind.mjs
```

### test-dao-topup.mjs

Tests DAO loss coverage:
- Sets mock yield rate to simulate DeFi losses
- Settles policy and verifies DAO covers shortfall
- Checks fund distribution is correct

### test-dao-insolvency.mjs

Tests graceful degradation when DAO is insolvent:
- DAO doesn't have enough to cover full DeFi loss
- Verifies partial DAO coverage
- Checks LP loss absorption

### test-event-with-dao-insolvency.mjs

Tests event settlement with DAO insolvency:
- Event occurs (policy holder should receive max_payout)
- DeFi position has losses
- DAO is partially insolvent
- Verifies partial payouts and loss distribution

### test-external-lp-defi-loss.mjs

Tests external LP impact when DeFi loses money:
- External LP buys tokens
- DeFi position suffers loss
- Settlement distributes remaining funds

### test-solvency-block.mjs

Tests that DAO solvency check blocks allocation:
- Drain DAO to make it insolvent
- Verify auto-allocation is blocked
- Verify manual allocation also fails

## Multi-Chain Testing with Zombienet

For full XCM integration testing with Asset Hub and Hydration:

```bash
# From the PRMX-new-BlockChainApp directory
zombienet spawn zombienet/prmx-xcm-capital-test.toml

# Then run tests against the network
node scripts/zombienet-tests/test-defi-allocation.mjs
```

## Key Invariants Tested

1. **Capital Source**: All capital deployed into DeFi comes from policy pools or the DAO

2. **Deterministic Settlement**: Settlement always sees the same deterministic obligations
   - **Event:** Policy holder receives `max_payout`
   - **No Event:** LP side receives the configured amount

3. **DAO Covers Losses**: DeFi loss is covered 100% by the DAO

4. **DAO Receives Profits**: DeFi profit always accrues to the DAO

5. **Full Unwind at Settlement**: No DeFi exposure persists after policy settlement

## Mock XCM Strategy Interface

In v1, the `MockXcmStrategyInterface` simulates Hydration Stableswap without real XCM calls:

- `enter_strategy(amount)` → Returns `shares = amount` (1:1 minting)
- `exit_strategy(shares)` → Returns `amount = shares * (1 + yield_rate)`

The mock yield rate can be set via:
```javascript
api.tx.sudo.sudo(api.tx.prmxXcmCapital.setMockYieldRate(-200_000)) // -20% loss
```
