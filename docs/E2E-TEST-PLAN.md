# PRMX Comprehensive E2E Test Plan

**Based on: PRMX Test Design Rulebook**  
**Coverage: v1 / v2 / v3**  
**Status: Planning Document**

---

## Document Metadata

| Field | Value |
|-------|-------|
| Author | AI Agent (Cursor) |
| Target Versions | v1, v2, v3 |
| Test Type | End-to-End |
| Compliance | test-principle.md |
| Last Updated | 2026-01-01 |

---

## Test Categories Summary

Per the rulebook, all tests are classified into:

| Code | Category | Description |
|------|----------|-------------|
| **A** | Economic Integrity | Money flows, payouts, premiums, collateral |
| **B** | State Machine Safety | Policy states, transitions, invariants |
| **C** | Temporal Consistency | Time boundaries, windows, ordering |
| **D** | Off-chain Interaction | Oracle delivery, API reliability |
| **E** | Adversarial User Behavior | Malicious actors, exploitation attempts |

---

## Test Distribution Requirements

Per Principle 1: **At least 50% must be abnormal, boundary, or adversarial**

| Type | Count | Percentage |
|------|-------|------------|
| Happy Path | ~30 | ~40% |
| Boundary Cases | ~20 | ~27% |
| Adversarial/Error | ~25 | ~33% |
| **Total** | ~75 | 100% |

---

# PART 1: V1 E2E TESTS (24h Rainfall)

## V1.1 - Happy Path: Complete Policy Lifecycle

```
Test Name: V1-E2E-001-HappyPath-CompleteLifecycle
Target Version: v1
Time Model: single-window
Classification: A, B
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: None (baseline)
Attacker Perspective: N/A (happy path)
Expected Defense: N/A
Success Criteria:
  - Quote created with valid H128 QuoteId
  - Quote submitted by oracle
  - Policy created with valid H128 PolicyId  
  - LP tokens minted to DAO
  - Rainfall submitted (below threshold)
  - Policy settled at maturity with no payout
  - All balances reconciled
Impact if Broken: funds / trust
```

---

## V1.2 - Happy Path: Event Trigger with Payout

```
Test Name: V1-E2E-002-HappyPath-EventTriggerPayout
Target Version: v1
Time Model: single-window
Classification: A, B
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: None (baseline)
Attacker Perspective: N/A
Expected Defense: N/A
Success Criteria:
  - Policy created successfully
  - Rainfall data submitted (above 50mm threshold)
  - Policy auto-settled by OCW OR manually triggered
  - Policyholder receives full payout
  - LP holders receive nothing (event occurred)
  - Collateral distributed correctly
Impact if Broken: funds / trust / legal
```

---

## V1.3 - Boundary: Exact 24h Window Edge (P0)

```
Test Name: V1-E2E-003-Boundary-Exact24hEdge
Target Version: v1
Time Model: single-window
Classification: A, C
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Rainfall at T-24h:00:00 incorrectly included/excluded
Attacker Perspective: Submit rainfall just outside window to avoid trigger
Expected Defense: Strict boundary inclusion logic (inclusive start, exclusive end)
Success Criteria:
  - Rainfall at T-24h:00:00 is correctly included
  - Rainfall at T-24h:00:01 is correctly excluded
  - Rolling sum calculated with exact boundary
  - Settlement decision matches boundary-correct sum
Impact if Broken: funds / legal
```

---

## V1.4 - Boundary: Threshold Exactly at 50mm

```
Test Name: V1-E2E-004-Boundary-ThresholdExact50mm
Target Version: v1
Time Model: single-window
Classification: A, C
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Ambiguity at exactly 50mm (trigger or not?)
Attacker Perspective: Submit exactly 50mm to create ambiguous state
Expected Defense: Clear >= comparison (50mm DOES trigger)
Success Criteria:
  - Rainfall sum = exactly 500 (50.0mm in tenths)
  - Event IS triggered
  - Policyholder receives payout
  - Consistent behavior across multiple tests
Impact if Broken: trust / legal
```

---

## V1.5 - Adversarial: Delayed Oracle Data

```
Test Name: V1-E2E-005-Adversarial-DelayedOracleData
Target Version: v1
Time Model: single-window
Classification: C, D, E
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Late data arrives after maturity but should have triggered
Attacker Perspective: Oracle deliberately delays data to avoid trigger
Expected Defense: Settlement must wait for oracle finality OR re-settlement allowed
Success Criteria:
  - Data submitted late (after coverage end)
  - If data would have triggered: settlement outcome is trigger
  - Re-settlement or correction mechanism exists
  - Policyholder not disadvantaged by oracle delay
Impact if Broken: funds / trust / legal
```

---

## V1.6 - Adversarial: Duplicated Oracle Reports (Idempotency P0)

```
Test Name: V1-E2E-006-Adversarial-DuplicatedOracleReports
Target Version: v1
Time Model: single-window
Classification: A, D, E
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Same timestamp rainfall counted twice, inflating sum
Attacker Perspective: Oracle submits same data multiple times to force trigger
Expected Defense: Idempotent storage (upsert, not append)
Success Criteria:
  - Submit rainfall at T=X with 30mm
  - Submit rainfall at T=X again with 30mm
  - Rolling sum shows 30mm (not 60mm)
  - No duplicate counting
Impact if Broken: funds / legal
```

---

## V1.7 - Adversarial: Invalid Rainfall Values

```
Test Name: V1-E2E-007-Adversarial-InvalidRainfallValues
Target Version: v1
Time Model: single-window
Classification: D, E
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Negative or extreme values corrupt aggregation
Attacker Perspective: Submit negative rainfall to reduce sum below threshold
Expected Defense: Reject invalid values at submission
Success Criteria:
  - Negative values rejected
  - Extreme values (>1000mm/hr) rejected or flagged
  - NaN/overflow values handled gracefully
  - Valid data continues to work
Impact if Broken: funds / trust
```

---

## V1.8 - Adversarial: Double Settlement (Idempotency P0)

```
Test Name: V1-E2E-008-Adversarial-DoubleSettlement
Target Version: v1
Time Model: single-window
Classification: A, B, E
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Policy settled twice, double payout
Attacker Perspective: Race condition or retry causes double execution
Expected Defense: settled flag prevents re-entry
Success Criteria:
  - First settlement succeeds
  - Second settlement fails with PolicyAlreadySettled
  - Policyholder balance unchanged after first settlement
  - No funds created or destroyed
Impact if Broken: funds / legal
```

---

## V1.9 - Adversarial: Unauthorized Oracle Submission

```
Test Name: V1-E2E-009-Adversarial-UnauthorizedOracle
Target Version: v1
Time Model: single-window
Classification: D, E
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Non-oracle can submit rainfall data
Attacker Perspective: Submit fake high rainfall to trigger policy
Expected Defense: Origin check rejects non-authorized accounts
Success Criteria:
  - Regular user (Bob) cannot submit rainfall
  - Transaction fails with NotAuthorized or BadOrigin
  - No state change from rejected transaction
  - Oracle account can still submit
Impact if Broken: funds / trust / legal
```

---

## V1.10 - Adversarial: Settlement Before Coverage End

```
Test Name: V1-E2E-010-Adversarial-SettlementBeforeCoverageEnd
Target Version: v1
Time Model: single-window
Classification: B, C, E
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Policy settled prematurely, before coverage period ends
Attacker Perspective: Settle when threshold is low to avoid future trigger
Expected Defense: CoverageNotEnded error before coverage_end timestamp
Success Criteria:
  - Settlement attempt mid-coverage fails
  - Error message: CoverageNotEnded
  - Policy remains active
  - Can be settled after coverage ends
Impact if Broken: funds / trust
```

---

## V1.11 - Edge: Zero Shares Policy

```
Test Name: V1-E2E-011-Edge-ZeroShares
Target Version: v1
Time Model: single-window
Classification: B, E
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Zero-share policy created, breaks LP math
Attacker Perspective: Create policy with 0 shares for free monitoring
Expected Defense: Reject 0 shares at quote request
Success Criteria:
  - Quote request with 0 shares rejected
  - Clear error message
  - No policy created
  - No state changes
Impact if Broken: trust
```

---

## V1.12 - Edge: Invalid Coverage Dates

```
Test Name: V1-E2E-012-Edge-InvalidCoverageDates
Target Version: v1
Time Model: single-window
Classification: B, C
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: coverage_end < coverage_start accepted
Attacker Perspective: Create impossible policy window
Expected Defense: Validation rejects invalid dates
Success Criteria:
  - coverage_end < coverage_start: rejected
  - coverage_start in past (beyond tolerance): rejected
  - coverage period too short: rejected
  - coverage period too long: rejected
Impact if Broken: trust
```

---

## V1.13 - LP Trading: Mid-Policy LP Transfer

```
Test Name: V1-E2E-013-LP-MidPolicyTransfer
Target Version: v1
Time Model: single-window
Classification: A, B
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: LP transferred mid-coverage, settlement pays wrong party
Attacker Perspective: Sell LP knowing event will occur
Expected Defense: Payout goes to current LP holder at settlement
Success Criteria:
  - DAO places LP tokens on orderbook
  - Charlie buys LP tokens from DAO
  - Event occurs and settlement happens
  - Charlie (current holder) receives LP payout, not DAO
  - Correct pro-rata distribution
Impact if Broken: funds / trust
```

---

# PART 2: V2 E2E TESTS (Multi-day Cumulative)

## V2.1 - Happy Path: Complete Multi-day Lifecycle

```
Test Name: V2-E2E-001-HappyPath-MultiDayLifecycle
Target Version: v2
Time Model: cumulative
Classification: A, B
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: None (baseline)
Attacker Perspective: N/A
Expected Defense: N/A
Success Criteria:
  - V2 quote with custom strike and duration
  - Policy created with V2 flag
  - Multi-day snapshots submitted
  - Cumulative rainfall calculated correctly
  - Settlement at maturity based on cumulative sum
Impact if Broken: funds / trust
```

---

## V2.2 - Boundary: Missing Intermediate Snapshot (P0)

```
Test Name: V2-E2E-002-Boundary-MissingIntermediateSnapshot
Target Version: v2
Time Model: cumulative
Classification: A, C, D
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Missing day 2 of 3-day coverage corrupts cumulative
Attacker Perspective: Oracle skips high-rainfall day to avoid trigger
Expected Defense: Settlement blocked until all snapshots present OR interpolation
Success Criteria:
  - 3-day coverage created
  - Day 1 submitted: 20mm
  - Day 2 MISSING
  - Day 3 submitted: 20mm
  - Settlement either: fails OR uses defined interpolation
  - Policy not incorrectly settled as "no event"
Impact if Broken: funds / legal
```

---

## V2.3 - Boundary: Missing Final Snapshot (P0)

```
Test Name: V2-E2E-003-Boundary-MissingFinalSnapshot
Target Version: v2
Time Model: cumulative
Classification: A, C, D
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Final day missing, premature "no event" settlement
Attacker Perspective: Oracle withholds final high-rainfall day
Expected Defense: Maturity settlement waits for oracle finality window
Success Criteria:
  - Settlement at maturity waits for oracle submission
  - Or: settlement delayed until oracle finality period
  - Final snapshot can still trigger event after maturity
  - Policyholder protected from oracle delay
Impact if Broken: funds / legal
```

---

## V2.4 - Boundary: Reversed Snapshot Order (P0)

```
Test Name: V2-E2E-004-Boundary-ReversedSnapshotOrder
Target Version: v2
Time Model: cumulative
Classification: C, D
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Out-of-order snapshots double-count or corrupt state
Attacker Perspective: Submit snapshots in wrong order to manipulate total
Expected Defense: Snapshots keyed by timestamp, order-independent
Success Criteria:
  - Submit day 3, then day 1, then day 2
  - Cumulative sum = sum of all 3 days (order-independent)
  - No duplicate counting
  - Same result as in-order submission
Impact if Broken: funds
```

---

## V2.5 - Boundary: Duplicated Timestamps (P0)

```
Test Name: V2-E2E-005-Boundary-DuplicatedTimestamps
Target Version: v2
Time Model: cumulative
Classification: A, C, D
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Same day submitted twice, doubled in cumulative
Attacker Perspective: Oracle duplicates high-rainfall day
Expected Defense: Idempotent upsert for timestamp key
Success Criteria:
  - Day 1: 30mm submitted
  - Day 1: 30mm submitted again
  - Cumulative for day 1 = 30mm (not 60mm)
  - Final sum uses deduplicated values
Impact if Broken: funds
```

---

## V2.6 - P0: Early Trigger Followed by Maturity (No Double Payout)

```
Test Name: V2-E2E-006-P0-EarlyTriggerThenMaturity
Target Version: v2
Time Model: cumulative
Classification: A, B
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Early trigger pays out, then maturity pays again
Attacker Perspective: Exploit race between early trigger and maturity settlement
Expected Defense: settled flag prevents second payout
Success Criteria:
  - Early trigger occurs (cumulative exceeds strike early)
  - Policyholder receives payout
  - Maturity settlement attempt: fails with AlreadySettled
  - No second payout
  - Total funds conserved
Impact if Broken: funds / legal
```

---

## V2.7 - Boundary: Duration Minimum

```
Test Name: V2-E2E-007-Boundary-DurationMinimum
Target Version: v2
Time Model: cumulative
Classification: B
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: 0-day or 1-day duration accepted for cumulative product
Attacker Perspective: Create degenerate 0-day policy
Expected Defense: Minimum duration enforced (e.g., 2 days)
Success Criteria:
  - Duration = 0 days: rejected
  - Duration = 1 day: rejected OR handled as V1 equivalent
  - Duration = 2 days: accepted
  - Clear error messages
Impact if Broken: trust
```

---

## V2.8 - Boundary: Duration Maximum

```
Test Name: V2-E2E-008-Boundary-DurationMaximum
Target Version: v2
Time Model: cumulative
Classification: B, C
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Extremely long duration causes oracle exhaustion
Attacker Perspective: Create 365-day policy, massive oracle cost
Expected Defense: Maximum duration enforced (e.g., 30 days)
Success Criteria:
  - Duration = 31 days: rejected
  - Duration = 30 days: accepted (if max is 30)
  - Clear error message with limits
Impact if Broken: trust
```

---

## V2.9 - Adversarial: Cumulative Error Amplification

```
Test Name: V2-E2E-009-Adversarial-CumulativeErrorAmplification
Target Version: v2
Time Model: cumulative
Classification: A, D, E
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Small oracle errors compound over multi-day
Attacker Perspective: Inject small systematic bias to shift cumulative over time
Expected Defense: Oracle bounds checking per-snapshot
Success Criteria:
  - Each snapshot validated against reasonable bounds
  - Historical comparison or rate-of-change limits
  - Cumulative doesn't overflow integer storage
  - Error isolation per snapshot
Impact if Broken: funds / trust
```

---

## V2.10 - Adversarial: No-Event False Negative

```
Test Name: V2-E2E-010-Adversarial-NoEventFalseNegative
Target Version: v2
Time Model: cumulative
Classification: A, B
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Cumulative exceeded but settlement says "no event"
Attacker Perspective: Oracle under-reports on key days
Expected Defense: Correct aggregation logic, audit trail
Success Criteria:
  - Submit snapshots that sum to > strike threshold
  - Settlement correctly identifies event
  - Policyholder receives payout
  - LP holders pay out (lose collateral)
Impact if Broken: funds / legal
```

---

## V2.11 - V2 No-Event Scenario

```
Test Name: V2-E2E-011-NoEvent-CorrectNoPayoutPath
Target Version: v2
Time Model: cumulative
Classification: A, B
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: None (correct behavior verification)
Attacker Perspective: N/A
Expected Defense: N/A
Success Criteria:
  - Submit snapshots summing to < strike threshold
  - Settlement at maturity: no event
  - Policyholder receives NO payout
  - LP holders receive collateral back + premium
  - All funds reconciled
Impact if Broken: funds
```

---

## V2.12 - V2 Custom Strike Verification

```
Test Name: V2-E2E-012-CustomStrike-CorrectThreshold
Target Version: v2
Time Model: cumulative
Classification: A, B
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Custom strike ignored, default 50mm used
Attacker Perspective: Set low strike (20mm), oracle only checks 50mm
Expected Defense: Strike stored per-policy, used in settlement
Success Criteria:
  - Policy created with strike = 20mm
  - Submit cumulative 25mm (> 20mm, < 50mm)
  - Event triggered (custom strike honored)
  - Policyholder receives payout
Impact if Broken: funds / legal
```

---

# PART 3: V3 E2E TESTS (P2P / Evolution / Coexistence)

## V3 Tags Required

Every V3 test declares at least one tag:
- **A**: version coexistence
- **B**: specification extension
- **C**: implementation refresh  
- **D**: operational / governance features

---

## V3.1 - Happy Path: Complete P2P Lifecycle

```
Test Name: V3-E2E-001-HappyPath-P2PLifecycle
Target Version: v3
Time Model: mixed
Classification: A, B
V3 Tags: B (specification extension)
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: None (baseline)
Attacker Perspective: N/A
Expected Defense: N/A
Success Criteria:
  - Underwrite request created (H128 RequestId)
  - Multiple underwriters accept shares
  - Request fully filled
  - LP tokens distributed to underwriters
  - Oracle snapshot submitted
  - Settlement triggers payout to requester
Impact if Broken: funds / trust
```

---

## V3.2 - P0: Version Coexistence - No ID Collision

```
Test Name: V3-E2E-002-P0-VersionCoexistence-NoCollision
Target Version: v3
Time Model: mixed
Classification: B
V3 Tags: A (version coexistence)
Version Routing: Yes
Migration/Upgrade: No

Expected Failure Mode: V1/V2/V3 IDs collide, causing cross-contamination
Attacker Perspective: Create policies in all versions hoping for collision
Expected Defense: H128 hash-based IDs with version prefix/entropy
Success Criteria:
  - Create V1 policy (H128)
  - Create V2 policy (H128)
  - Create V3 request (H128)
  - All IDs are unique
  - LP holdings are correctly separated
  - Each policy can be independently queried/settled
Impact if Broken: funds / trust / legal
```

---

## V3.3 - P0: Version Routing - Correct Logic Dispatch

```
Test Name: V3-E2E-003-P0-VersionRouting-CorrectDispatch
Target Version: v3
Time Model: mixed
Classification: B
V3 Tags: A (version coexistence)
Version Routing: Yes
Migration/Upgrade: No

Expected Failure Mode: V2 policy routed to V1 settlement logic
Attacker Perspective: Create V2 policy but trigger V1 settlement (different rules)
Expected Defense: Version field on policy determines settlement path
Success Criteria:
  - V1 policy uses V1 settlement logic
  - V2 policy uses V2 settlement logic (custom strike)
  - V3 request uses V3 settlement logic (P2P)
  - Cross-version settlement attempt fails
Impact if Broken: funds / legal
```

---

## V3.4 - P0: Backward Compatibility - Old Storage Decoding

```
Test Name: V3-E2E-004-P0-BackwardCompatibility-StorageDecoding
Target Version: v3
Time Model: mixed
Classification: B
V3 Tags: A (version coexistence), C (implementation refresh)
Version Routing: No
Migration/Upgrade: Yes

Expected Failure Mode: Old V1/V2 policies unreadable after V3 upgrade
Attacker Perspective: None (system failure)
Expected Defense: Storage versioning, migration hooks
Success Criteria:
  - Existing V1/V2 policies can be queried
  - Old policies can complete settlement after upgrade
  - No storage key collisions
  - Balances preserved
Impact if Broken: funds / trust / legal
```

---

## V3.5 - P0: Migration Idempotency

```
Test Name: V3-E2E-005-P0-MigrationIdempotency
Target Version: v3
Time Model: N/A
Classification: B
V3 Tags: C (implementation refresh)
Version Routing: No
Migration/Upgrade: Yes

Expected Failure Mode: Running migration twice corrupts state
Attacker Perspective: Trigger migration repeatedly
Expected Defense: Migration is idempotent (0, 1, N executions converge)
Success Criteria:
  - Run migration 0 times: original state
  - Run migration 1 time: migrated state
  - Run migration N times: same migrated state
  - No double-migration errors
Impact if Broken: funds / trust
```

---

## V3.6 - P2P: Partial Fill Scenarios

```
Test Name: V3-E2E-006-P2P-PartialFill
Target Version: v3
Time Model: mixed
Classification: A, B
V3 Tags: B (specification extension)
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Partially filled request settles incorrectly
Attacker Perspective: Accept partial shares, cancel before full fill
Expected Defense: Clear partial fill state, pro-rata settlement
Success Criteria:
  - Request for 10 shares created
  - Charlie accepts 3 shares
  - Dave accepts 4 shares (7/10 total)
  - Request remains open (not fully filled)
  - If settled: only 7 shares worth of payout/collateral
  - Unfilled 3 shares: premium returned to requester
Impact if Broken: funds
```

---

## V3.7 - P2P: Multi-Underwriter Payout Distribution

```
Test Name: V3-E2E-007-P2P-MultiUnderwriterPayout
Target Version: v3
Time Model: mixed
Classification: A
V3 Tags: B (specification extension)
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Payout not pro-rata among underwriters
Attacker Perspective: Underwriters receive unequal payouts
Expected Defense: LP share-based payout calculation
Success Criteria:
  - Charlie: 6 shares, Dave: 4 shares
  - Event does NOT occur (no payout to requester)
  - Charlie receives 60% of returned collateral + premium
  - Dave receives 40% of returned collateral + premium
  - Total equals original collateral + premium
Impact if Broken: funds
```

---

## V3.8 - P2P: Request Expiration Before Full Fill

```
Test Name: V3-E2E-008-P2P-RequestExpiration
Target Version: v3
Time Model: mixed
Classification: B
V3 Tags: B (specification extension)
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Expired request still accepts underwriters
Attacker Perspective: Accept request after expiry for stale terms
Expected Defense: Expiry check on acceptance
Success Criteria:
  - Create request with 2-minute expiry
  - Partial acceptance (5/10 shares)
  - Wait for expiry
  - Attempt acceptance: rejected (RequestExpired)
  - Premium for unfilled shares returned
  - Accepted shares: coverage proceeds normally
Impact if Broken: funds / trust
```

---

## V3.9 - P0: Off-chain Consistency - Partial Success Recovery

```
Test Name: V3-E2E-009-P0-OffchainConsistency-PartialSuccess
Target Version: v3
Time Model: mixed
Classification: D
V3 Tags: B (specification extension)
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Off-chain succeeds, on-chain fails, inconsistent state
Attacker Perspective: None (oracle reliability)
Expected Defense: Recovery mechanism, retry with same result
Success Criteria:
  - Simulate off-chain oracle fetch success
  - On-chain submission fails (e.g., network error)
  - Oracle service retries
  - Eventually consistent state
  - No duplicate data
Impact if Broken: funds / trust
```

---

## V3.10 - P0: Off-chain Consistency - Node Restart No Duplicates

```
Test Name: V3-E2E-010-P0-OffchainConsistency-NoDuplicateMonitoring
Target Version: v3
Time Model: mixed
Classification: D
V3 Tags: B (specification extension)
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Oracle restart creates duplicate monitoring
Attacker Perspective: None (operational)
Expected Defense: Monitoring state persistence, dedup on startup
Success Criteria:
  - Create V3 policy, monitoring starts
  - Restart oracle service
  - Service resumes monitoring same policy
  - No duplicate snapshots submitted
  - Correct single settlement
Impact if Broken: funds
```

---

## V3.11 - Adversarial: Unsupported Version Rejection

```
Test Name: V3-E2E-011-Adversarial-UnsupportedVersion
Target Version: v3
Time Model: mixed
Classification: B, E
V3 Tags: A (version coexistence)
Version Routing: Yes
Migration/Upgrade: No

Expected Failure Mode: Crafted V99 policy accepted
Attacker Perspective: Submit transaction with fake version number
Expected Defense: Version whitelist/enum enforcement
Success Criteria:
  - Attempt to create policy with version = V99
  - Transaction rejected (InvalidVersion)
  - No state change
  - Valid versions (V1, V2, V3) continue to work
Impact if Broken: trust
```

---

## V3.12 - Adversarial: Legacy Client Wrong Routing

```
Test Name: V3-E2E-012-Adversarial-LegacyClientRouting
Target Version: v3
Time Model: mixed
Classification: B, E
V3 Tags: A (version coexistence)
Version Routing: Yes
Migration/Upgrade: No

Expected Failure Mode: Old UI sends V3 data to V1 endpoint
Attacker Perspective: Use outdated client for undefined behavior
Expected Defense: API versioning, clear rejections
Success Criteria:
  - Old V1-only client attempts V3 request
  - Request rejected with version mismatch
  - No partial state created
  - User gets clear upgrade message
Impact if Broken: trust
```

---

## V3.13 - Operational: Pause Behavior (If Implemented)

```
Test Name: V3-E2E-013-Operational-PauseBehavior
Target Version: v3
Time Model: mixed
Classification: B, D
V3 Tags: D (operational/governance)
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Pause doesn't stop new policies
Attacker Perspective: Create policies during emergency
Expected Defense: Pause flag checked on all entry points
Success Criteria:
  - Admin pauses system
  - New quote requests rejected
  - New underwrite requests rejected
  - Existing policy settlement: allowed (P0)
  - Resume: new requests accepted
Impact if Broken: trust / legal
```

---

## V3.14 - Operational: Settlement During Pause

```
Test Name: V3-E2E-014-Operational-SettlementDuringPause
Target Version: v3
Time Model: mixed
Classification: A, B, D
V3 Tags: D (operational/governance)
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Pause blocks settlement of triggered events
Attacker Perspective: Admin pauses to avoid payouts
Expected Defense: Settlement always allowed (P0 over operational controls)
Success Criteria:
  - Policy active, event occurs
  - Admin pauses system
  - Settlement still allowed and succeeds
  - Policyholder receives payout
  - New policies blocked, settlements allowed
Impact if Broken: funds / legal
```

---

## V3.15 - P0: Active Policies Complete After Upgrade

```
Test Name: V3-E2E-015-P0-ActivePoliciesAfterUpgrade
Target Version: v3
Time Model: mixed
Classification: A, B
V3 Tags: A (version coexistence), C (implementation refresh)
Version Routing: Yes
Migration/Upgrade: Yes

Expected Failure Mode: Active V2 policy can't settle after V3 upgrade
Attacker Perspective: None (system failure)
Expected Defense: Version-aware settlement dispatch
Success Criteria:
  - Create V2 policy before upgrade
  - Upgrade to V3 runtime
  - Submit V2 rainfall data
  - V2 policy settles correctly
  - Correct payout distribution
  - No orphaned policies
Impact if Broken: funds / legal
```

---

# PART 4: CROSS-VERSION TESTS

## CV.1 - Coexistence: Simultaneous V1+V2+V3 Active

```
Test Name: CV-E2E-001-Coexistence-SimultaneousActive
Target Version: v1/v2/v3
Time Model: mixed
Classification: A, B
Version Routing: Yes
Migration/Upgrade: No

Expected Failure Mode: Cross-version interference
Attacker Perspective: Create policies in all versions to find bugs
Expected Defense: Complete isolation between versions
Success Criteria:
  - Create V1, V2, V3 policies simultaneously
  - All three active at same time
  - Each has unique ID
  - Each has separate LP holdings
  - Settle each independently
  - All balances reconciled
Impact if Broken: funds / trust
```

---

## CV.2 - Storage: No Key Collisions

```
Test Name: CV-E2E-002-Storage-NoKeyCollisions
Target Version: v1/v2/v3
Time Model: mixed
Classification: B
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: V2 policy overwrites V1 storage key
Attacker Perspective: Find ID that collides across versions
Expected Defense: Version-prefixed storage keys or collision-resistant hashing
Success Criteria:
  - Create many policies in each version (10+)
  - No storage key collision errors
  - All policies independently queryable
  - No data corruption
Impact if Broken: funds / trust
```

---

## CV.3 - Cross-Version Arbitrage Prevention

```
Test Name: CV-E2E-003-CrossVersionArbitrage
Target Version: v1/v2/v3
Time Model: mixed
Classification: A, E
Version Routing: Yes
Migration/Upgrade: No

Expected Failure Mode: Exploit version differences for risk-free profit
Attacker Perspective: Long V1, short V2 for same event at different rates
Expected Defense: Consistent pricing, no structural arbitrage
Success Criteria:
  - Same event priced similarly across versions
  - No risk-free profit from version differences
  - Market efficiency maintained
Impact if Broken: funds / trust
```

---

# PART 5: ORACLE FAILURE TESTS (All Versions)

## OF.1 - Delayed Data - All Versions

```
Test Name: OF-E2E-001-DelayedData-AllVersions
Target Version: v1/v2/v3
Time Model: all
Classification: C, D
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Delayed data causes incorrect settlement
Attacker Perspective: Oracle delays to manipulate outcome
Expected Defense: Settlement waits for oracle finality
Success Criteria:
  - Each version handles delayed data correctly
  - Settlement outcome matches eventual truth
  - No premature settlements
Impact if Broken: funds / trust
```

---

## OF.2 - Missing Data - All Versions

```
Test Name: OF-E2E-002-MissingData-AllVersions
Target Version: v1/v2/v3
Time Model: all
Classification: C, D
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Missing data defaults to "no event"
Attacker Perspective: Oracle withholds high-rainfall data
Expected Defense: Settlement blocked or interpolation
Success Criteria:
  - V1: Missing hour handled correctly
  - V2: Missing day handled correctly
  - V3: Missing snapshot handled correctly
  - Policyholder protected
Impact if Broken: funds / legal
```

---

## OF.3 - Out-of-Order Delivery - All Versions

```
Test Name: OF-E2E-003-OutOfOrderDelivery-AllVersions
Target Version: v1/v2/v3
Time Model: all
Classification: C, D
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Out-of-order data corrupts aggregation
Attacker Perspective: Submit data in adversarial order
Expected Defense: Timestamp-keyed storage, order-independent aggregation
Success Criteria:
  - V1: Hourly data in random order still sums correctly
  - V2: Daily snapshots in random order still sum correctly
  - V3: Snapshots in random order still sum correctly
Impact if Broken: funds
```

---

## OF.4 - Extreme Values - All Versions

```
Test Name: OF-E2E-004-ExtremeValues-AllVersions
Target Version: v1/v2/v3
Time Model: all
Classification: D, E
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Extreme values cause overflow/underflow
Attacker Perspective: Submit u128::MAX to overflow aggregation
Expected Defense: Value bounds checking, saturating arithmetic
Success Criteria:
  - Extreme positive values: rejected or saturated
  - Negative values: rejected
  - Near-overflow: handled without panic
  - Normal operations continue
Impact if Broken: funds / trust
```

---

# PART 6: ECONOMIC INTEGRITY TESTS

## EI.1 - Total Fund Conservation

```
Test Name: EI-E2E-001-TotalFundConservation
Target Version: v1/v2/v3
Time Model: all
Classification: A
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Funds created or destroyed
Attacker Perspective: Find money leak or duplication
Expected Defense: Double-entry accounting, conservation invariant
Success Criteria:
  - Sum of all USDT before = Sum after (for each policy)
  - Premium + Collateral = Payout + Returned funds
  - No funds in limbo after settlement
  - Rounding goes to protocol, not user
Impact if Broken: funds
```

---

## EI.2 - Premium Refund on Cancellation

```
Test Name: EI-E2E-002-PremiumRefundCancellation
Target Version: v3
Time Model: mixed
Classification: A, B
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Premium not refunded when request expires unfilled
Attacker Perspective: None (user protection)
Expected Defense: Expiry handler returns unfilled premium
Success Criteria:
  - Create request, pay premium for 10 shares
  - Only 3 shares filled before expiry
  - Expiry: 7 shares premium returned
  - 3 shares: premium goes to collateral pool
Impact if Broken: funds / trust
```

---

## EI.3 - Collateral Release Timing

```
Test Name: EI-E2E-003-CollateralReleaseTiming
Target Version: v3
Time Model: mixed
Classification: A, B
Version Routing: No
Migration/Upgrade: No

Expected Failure Mode: Collateral released before settlement
Attacker Perspective: Withdraw collateral before event occurs
Expected Defense: Collateral locked until settlement
Success Criteria:
  - Underwriter accepts request, collateral locked
  - Attempt withdrawal before settlement: fails
  - Settlement (no event): collateral + premium returned
  - No early release possible
Impact if Broken: funds / trust
```

---

# Test Runner Implementation

## Directory Structure

```
scripts/tests/
├── common.mjs           # Shared utilities (existing)
├── run-all-tests.mjs    # Main test runner
├── test-v1-lifecycle.mjs
├── test-v2-lifecycle.mjs
├── test-v3-lifecycle.mjs
├── test-cross-version.mjs
├── test-edge-cases.mjs
├── test-oracle-advanced.mjs
├── test-lp-trading.mjs
├── test-multi-party.mjs
├── test-frontend-api.mjs
├── e2e-comprehensive/   # New comprehensive tests
│   ├── v1-boundary.mjs
│   ├── v1-adversarial.mjs
│   ├── v2-boundary.mjs
│   ├── v2-adversarial.mjs
│   ├── v3-coexistence.mjs
│   ├── v3-p2p-advanced.mjs
│   ├── cross-version.mjs
│   ├── oracle-failure.mjs
│   └── economic-integrity.mjs
└── README.md
```

---

## Test Execution Order

1. **Setup Phase**
   - Connect to node
   - Setup USDT asset
   - Setup V1/V2 oracle
   - Setup V3 oracle and location registry

2. **V1 Tests** (12 tests)
   - Happy paths (2)
   - Boundary cases (3)
   - Adversarial cases (6)
   - LP trading (1)

3. **V2 Tests** (12 tests)
   - Happy paths (2)
   - Boundary cases (6)
   - Adversarial cases (4)

4. **V3 Tests** (15 tests)
   - Happy paths (1)
   - P0 Coexistence (5)
   - P2P scenarios (4)
   - Off-chain consistency (2)
   - Adversarial (2)
   - Operational (2)

5. **Cross-Version Tests** (3 tests)

6. **Oracle Failure Tests** (4 tests)

7. **Economic Integrity Tests** (3 tests)

**Total: ~75 tests**

---

## Coverage Mapping

| Rulebook Requirement | Tests Covering |
|---------------------|----------------|
| 24h boundary tests | V1-003, V1-004 |
| Delayed oracle delivery | V1-005, OF-001 |
| Duplicated oracle reports | V1-006 |
| Missing intermediate day | V2-002 |
| Missing final day | V2-003 |
| Reversed snapshot order | V2-004 |
| Duplicated timestamps | V2-005 |
| Early trigger + maturity | V2-006 |
| Duration boundaries | V2-007, V2-008 |
| Abnormal values | V1-007, OF-004 |
| Version coexistence | V3-002, CV-001 |
| Storage key collisions | CV-002 |
| Migration idempotency | V3-005 |
| Active policies after upgrade | V3-015 |
| Version routing | V3-003 |
| Legacy client handling | V3-012 |
| Off-chain recovery | V3-009 |
| Replay safety | V3-010 |
| Pause behavior | V3-013, V3-014 |
| Double payout prevention | V1-008, V2-006 |

---

## AI Agent Self-Audit (Per Rulebook Section 10)

Before finalizing each test:

- [x] Can a malicious human profit if this fails? → All P0 tests address fund safety
- [x] Will this survive future specification changes? → Tests focus on invariants, not implementation
- [x] Can I clearly explain why this test exists? → Each test has explicit Expected Failure Mode

---

## Next Steps

1. Implement remaining tests in `scripts/tests/e2e-comprehensive/`
2. Add test metadata tracking per test-principle.md template
3. Create CI/CD pipeline for automated E2E runs
4. Add coverage reporting for scenario types (not just line coverage)
5. Create test dependency graph for parallel execution

---

**End of E2E Test Plan**

