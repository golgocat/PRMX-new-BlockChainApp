# PRMX Load Test

This test creates 120 policies with 1-minute durations, covering 5 different LP scenarios, with event logging and simulated weather triggers.

## Prerequisites

1. **Build the node with test-mode enabled:**
   ```bash
   cd /path/to/PRMX-new-BlockChainApp
   cargo build --release --features test-mode
   ```

2. **Start the node:**
   ```bash
   ./target/release/prmx-node --dev
   ```

3. **Install dependencies:**
   ```bash
   cd scripts/load-test
   npm install
   ```

## Running the Test

### Quick Test (10 policies, ~5 minutes)

Run a quick test to verify everything works:

```bash
# Terminal 1: Start event listener
npm run listener

# Terminal 2: Run quick test
npm run test:quick
```

### Full Test (120 policies, ~1 hour)

```bash
# Terminal 1: Start event listener
npm run listener

# Terminal 2: Run full test
npm run test:full
```

### Custom Test

```bash
node load-test.mjs --policies=50 --interval=20 --duration=120 --trigger-interval=180 --trigger-prob=30
```

**Options:**
- `--policies=N` - Number of policies to create (default: 120)
- `--interval=N` - Seconds between policy creation (default: 30)
- `--duration=N` - Coverage duration in seconds (default: 60)
- `--trigger-interval=N` - Seconds between trigger checks (default: 180)
- `--trigger-prob=N` - Probability of trigger 0-100 (default: 50)

## Test Scenarios

Each policy is assigned one of 5 scenarios in rotation:

| Scenario | Description |
|----------|-------------|
| A: DAO Hold | DAO holds LP tokens until settlement |
| B: Full Buy | Single investor buys 100% LP tokens |
| C: Partial Buy | Investor buys 50% LP tokens |
| D: Multi-Investor | 3 investors split LP tokens (33%, 33%, 34%) |
| E: Secondary Trade | Investor buys 100%, then sells in secondary market |

## Output

### Event Listener Log

The event listener writes a structured log to `test-results.log`:

```
================================================================================
POLICY #42 | Scenario: C (Partial Buy) | Created: 2025-12-12T10:15:30Z
================================================================================
[10:15:30] PolicyCreated { marketId: 0, holder: 5GrwvaEF..., shares: 1 }
[10:15:30] CapitalLocked { userPremium: 10,000,000, daoCapital: 90,000,000 }
[10:15:31] LpTokensMinted { shares: 100 }
[10:15:31] DaoLpAskPlaced { pricePerShare: 900,000, quantity: 100 }
[10:15:45] TradeExecuted { buyer: Alice, quantity: 50 }
[10:16:30] ThresholdTriggered { rollingSumMm: 550, strikeThreshold: 500 }
[10:16:30] PolicySettled { payoutToHolder: 100,000,000 }

RESULT: TRIGGERED (Payout: 100,000,000)
--------------------------------------------------------------------------------
```

### Summary Statistics

The log includes a summary at the top:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SUMMARY                                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  Triggered (Payout):      45                                              │
│  Expired (No Event):      75                                              │
│  Pending:                  0                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Verifying Results

For each policy, verify:

1. ✅ Policy created with correct parameters
2. ✅ Capital locked (premium from user, capital from DAO)
3. ✅ LP tokens minted and traded per scenario
4. ✅ Settlement occurred at correct time
5. ✅ Payouts distributed correctly based on trigger status
6. ✅ LP holders received correct share of pool

## Troubleshooting

### "CoverageTooShort" error
The node wasn't built with `test-mode` feature. Rebuild with:
```bash
cargo build --release --features test-mode
```

### Connection refused
Make sure the node is running on `ws://127.0.0.1:9944`

### Policies not settling
Check that Alice is registered as oracle and quote provider (the test script does this automatically).

