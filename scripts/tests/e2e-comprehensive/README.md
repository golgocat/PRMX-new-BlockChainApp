# PRMX Comprehensive E2E Tests

End-to-end test suite implementing the test plan from `docs/E2E-TEST-PLAN.md`, following the principles defined in `docs/test-principle.md`.

## Quick Start

```bash
# Run all comprehensive tests
node scripts/tests/e2e-comprehensive/run-comprehensive.mjs

# Run specific version tests
node scripts/tests/e2e-comprehensive/run-comprehensive.mjs --suite=v1
node scripts/tests/e2e-comprehensive/run-comprehensive.mjs --suite=v2
node scripts/tests/e2e-comprehensive/run-comprehensive.mjs --suite=v3

# Run with custom endpoint
node scripts/tests/e2e-comprehensive/run-comprehensive.mjs ws://localhost:9944

# Run individual test file
node scripts/tests/e2e-comprehensive/v1-boundary.mjs
```

## Test Suites

| Suite | Version | Description |
|-------|---------|-------------|
| `v1-boundary` | v1 | 24h window edges, thresholds, zero shares, invalid dates |
| `v1-adversarial` | v1 | Delayed oracle, duplicates, unauthorized, double settlement |
| `v2-boundary` | v2 | Missing snapshots, reversed order, duplicated timestamps |
| `v2-adversarial` | v2 | Cumulative errors, false negatives, no-event paths |
| `v3-coexistence` | v3 | Version routing, compatibility, no ID collisions |
| `v3-p2p-advanced` | v3 | Partial fills, multi-underwriter, expiration |
| `cross-version` | all | Simultaneous policies, storage separation |
| `oracle-failure` | all | Delayed/missing/out-of-order data, extreme values |
| `economic-integrity` | all | Fund conservation, premium refunds, collateral timing |

## Test Distribution

Per **Principle 1** from test-principle.md:

| Type | Count | Target |
|------|-------|--------|
| Happy Path | ~30% | ≤50% |
| Boundary Cases | ~35% | Part of ≥50% |
| Adversarial/Error | ~35% | Part of ≥50% |

## Classification System

All tests are classified per the rulebook:

| Code | Category |
|------|----------|
| **A** | Economic Integrity |
| **B** | State Machine Safety |
| **C** | Temporal Consistency |
| **D** | Off-chain Interaction |
| **E** | Adversarial User Behavior |

## V3 Tags

V3 tests additionally declare:

| Tag | Description |
|-----|-------------|
| **A** | version coexistence |
| **B** | specification extension |
| **C** | implementation refresh |
| **D** | operational / governance features |

## P0 Tests

The following are P0 (Priority 0) tests that must always pass:

### V1 P0
- `V1-E2E-006`: Duplicated oracle reports (idempotency)
- `V1-E2E-008`: Double settlement prevention

### V2 P0
- `V2-E2E-002`: Missing intermediate snapshot
- `V2-E2E-003`: Missing final snapshot
- `V2-E2E-004`: Reversed snapshot order
- `V2-E2E-005`: Duplicated timestamps
- `V2-E2E-006`: Early trigger + maturity (no double payout)

### V3 P0
- `V3-E2E-002`: Version coexistence, no ID collision
- `V3-E2E-003`: Version routing correct dispatch
- `V3-E2E-004`: Backward compatibility
- `V3-E2E-005`: Migration idempotency
- `V3-E2E-009`: Off-chain partial success recovery
- `V3-E2E-010`: No duplicate monitoring
- `V3-E2E-015`: Active policies complete after upgrade

## Running Tests

### Prerequisites

1. Start the PRMX node:
```bash
./target/release/prmx-node --dev
```

2. Ensure dependencies are installed:
```bash
cd scripts/tests
npm install
```

### Run All Tests

```bash
node scripts/tests/e2e-comprehensive/run-comprehensive.mjs
```

### Run by Version

```bash
# V1 tests only
node scripts/tests/e2e-comprehensive/run-comprehensive.mjs --suite=v1

# V2 tests only  
node scripts/tests/e2e-comprehensive/run-comprehensive.mjs --suite=v2

# V3 tests only
node scripts/tests/e2e-comprehensive/run-comprehensive.mjs --suite=v3
```

### Verbose Output

```bash
node scripts/tests/e2e-comprehensive/run-comprehensive.mjs --verbose
```

## Test Output

Each test logs:
- Test name and classification
- Expected failure mode
- Attacker perspective
- Success criteria
- Pass/fail status with details

Example:
```
─────────────────────────────────────────────────────────────
  V1-E2E-008: Adversarial - Double Settlement (P0)
─────────────────────────────────────────────────────────────
   Classification: A, B, E
   Expected Failure Mode: Policy settled twice, double payout
   Attacker Perspective: Race condition causes double execution
   Expected Defense: settled flag prevents re-entry

   First settlement attempt...
   First settlement: SUCCESS
   Second settlement attempt (should fail)...
   Second settlement: prmxPolicy.PolicyAlreadySettled
   ✅ PASS: Double settlement REJECTED - PolicyAlreadySettled (correct)
```

## Adding New Tests

1. Choose appropriate file based on version and test type
2. Follow the test template from `E2E-TEST-PLAN.md`:

```javascript
async function testNewFeature(api, accounts, results) {
    printSection('V1-E2E-XXX: Test Name');
    
    console.log('   Classification: A, B');
    console.log('   Expected Failure Mode: ...');
    console.log('   Attacker Perspective: ...');
    console.log('   Expected Defense: ...');
    console.log('');
    
    try {
        // Test implementation
        
        results.log('Test assertion', true/false, 'Details');
    } catch (e) {
        results.log('Test name', false, e.message);
    }
}
```

3. Register in the main function
4. Update this README if adding new suite

## Related Documentation

- `docs/E2E-TEST-PLAN.md` - Detailed test specifications
- `docs/test-principle.md` - Testing rulebook and principles
- `scripts/tests/common.mjs` - Shared test utilities

