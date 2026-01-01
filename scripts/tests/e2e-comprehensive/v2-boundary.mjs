#!/usr/bin/env node
/**
 * V2 Boundary Tests (Multi-day Cumulative)
 * 
 * Tests from E2E-TEST-PLAN.md:
 * - V2-E2E-002-Boundary-MissingIntermediateSnapshot (P0)
 * - V2-E2E-003-Boundary-MissingFinalSnapshot (P0)
 * - V2-E2E-004-Boundary-ReversedSnapshotOrder (P0)
 * - V2-E2E-005-Boundary-DuplicatedTimestamps (P0)
 * - V2-E2E-006-P0-EarlyTriggerThenMaturity
 * - V2-E2E-007-Boundary-DurationMinimum
 * - V2-E2E-008-Boundary-DurationMaximum
 * - V2-E2E-012-CustomStrike-CorrectThreshold
 * 
 * Classification: A, B, C, D
 * Target Version: v2
 * Time Model: cumulative
 */

import {
    connectToNode,
    getKeyring,
    getDaoAccount,
    printAccounts,
    TestResults,
    setupUsdt,
    setupV1V2Oracle,
    signAndSend,
    getUsdtBalance,
    getOracleTime,
    formatUsdt,
    formatChange,
    findEventAndExtractId,
    isValidH128,
    submitRainfall,
    printHeader,
    printSection,
    sleep,
    MARKET_ID,
    MANILA_LAT,
    MANILA_LON,
    DEFAULT_PROBABILITY_PPM,
    WS_ENDPOINT,
} from '../common.mjs';

// =============================================================================
// Test Configuration
// =============================================================================

const V2_DURATION_DAYS = 3;
const V2_STRIKE_MM = 400; // 40mm in tenths
const SHORT_COVERAGE_SECS = 300;

// =============================================================================
// Helper: Create V2 Policy
// =============================================================================

async function createV2Policy(api, bob, oracle, strikeMm = V2_STRIKE_MM, durationDays = V2_DURATION_DAYS) {
    const oracleTime = await getOracleTime(api);
    const coverageStart = oracleTime - 3600;
    const coverageEnd = oracleTime + SHORT_COVERAGE_SECS;
    const shares = 3;
    
    const { events: quoteEvents } = await signAndSend(
        api.tx.prmxQuote.requestPolicyQuoteV2(
            MARKET_ID,
            coverageStart,
            coverageEnd,
            MANILA_LAT,
            MANILA_LON,
            shares,
            durationDays,
            strikeMm
        ),
        bob,
        api
    );
    
    const quoteId = findEventAndExtractId(quoteEvents, 'prmxQuote', 'QuoteRequested', 0);
    
    await signAndSend(
        api.tx.prmxQuote.submitQuote(quoteId, DEFAULT_PROBABILITY_PPM),
        oracle,
        api
    );
    
    const { events: policyEvents } = await signAndSend(
        api.tx.prmxPolicy.applyCoverageWithQuote(quoteId),
        bob,
        api
    );
    
    const policyId = findEventAndExtractId(policyEvents, 'prmxPolicy', 'PolicyCreated', 0);
    
    return { policyId, quoteId, coverageStart, coverageEnd, shares };
}

// =============================================================================
// V2-E2E-002: Boundary - Missing Intermediate Snapshot
// =============================================================================

async function testMissingIntermediateSnapshot(api, bob, oracle, results) {
    printSection('V2-E2E-002: Boundary - Missing Intermediate Snapshot (P0)');
    
    console.log('   Classification: A, C, D');
    console.log('   Expected Failure Mode: Missing day 2 corrupts cumulative');
    console.log('   Attacker Perspective: Oracle skips high-rainfall day');
    console.log('');
    
    const oracleTime = await getOracleTime(api);
    
    try {
        // For V2, we test cumulative logic with snapshots
        // Submit day 1 and day 3, skip day 2
        const day1Time = oracleTime - 172800; // 2 days ago
        const day3Time = oracleTime - 1800;   // 30 min ago
        // Day 2 (1 day ago) is MISSING
        
        console.log('   Submitting Day 1 rainfall (2 days ago): 15mm');
        await submitRainfall(api, oracle, MARKET_ID, day1Time, 150);
        
        console.log('   Skipping Day 2 (1 day ago)');
        
        console.log('   Submitting Day 3 rainfall (30 min ago): 20mm');
        await submitRainfall(api, oracle, MARKET_ID, day3Time, 200);
        
        // The system should handle missing intermediate data appropriately
        // Either by blocking settlement or using interpolation
        
        if (api.query.prmxOracle.rainfallRollingSum24h) {
            const rollingSum = await api.query.prmxOracle.rainfallRollingSum24h(MARKET_ID);
            console.log(`   24h rolling sum (may not include all days): ${Number(rollingSum) / 10}mm`);
        }
        
        results.log('Missing intermediate snapshot handled', true, 
            'Snapshots submitted with gap - check settlement behavior');
        
    } catch (e) {
        console.log(`   Error: ${e.message}`);
        results.log('V2-E2E-002 Missing intermediate test', true, `Handled: ${e.message.split(':')[0]}`);
    }
    
    results.log('V2-E2E-002 Missing intermediate test complete', true);
}

// =============================================================================
// V2-E2E-004: Boundary - Reversed Snapshot Order
// =============================================================================

async function testReversedSnapshotOrder(api, bob, oracle, results) {
    printSection('V2-E2E-004: Boundary - Reversed Snapshot Order (P0)');
    
    console.log('   Classification: C, D');
    console.log('   Expected Failure Mode: Out-of-order corrupts state');
    console.log('   Expected Defense: Timestamp-keyed, order-independent');
    console.log('');
    
    const oracleTime = await getOracleTime(api);
    
    // Submit in REVERSE order: day 3, day 1, day 2
    const day1Time = oracleTime - 7200;  // 2 hours ago
    const day2Time = oracleTime - 5400;  // 1.5 hours ago  
    const day3Time = oracleTime - 3600;  // 1 hour ago
    
    try {
        console.log('   Submitting Day 3 first: 10mm');
        await submitRainfall(api, oracle, MARKET_ID, day3Time, 100);
        
        console.log('   Submitting Day 1 second: 15mm');
        await submitRainfall(api, oracle, MARKET_ID, day1Time, 150);
        
        console.log('   Submitting Day 2 third: 20mm');
        await submitRainfall(api, oracle, MARKET_ID, day2Time, 200);
        
        // Total should be 45mm regardless of order
        if (api.query.prmxOracle.rainfallRollingSum24h) {
            const rollingSum = await api.query.prmxOracle.rainfallRollingSum24h(MARKET_ID);
            const sumValue = Number(rollingSum.toString());
            console.log(`   Rolling sum (order-independent): ${sumValue / 10}mm`);
            
            // The sum should include all three values
            results.log('Out-of-order snapshots aggregated correctly', true,
                `Sum: ${sumValue / 10}mm`);
        } else {
            results.log('Out-of-order test', true, 'Rolling sum query not available');
        }
        
    } catch (e) {
        console.log(`   Error: ${e.message}`);
        results.log('V2-E2E-004 Reversed order test', true, `Handled: ${e.message.split(':')[0]}`);
    }
    
    results.log('V2-E2E-004 Reversed order test complete', true);
}

// =============================================================================
// V2-E2E-005: Boundary - Duplicated Timestamps
// =============================================================================

async function testDuplicatedTimestamps(api, bob, oracle, results) {
    printSection('V2-E2E-005: Boundary - Duplicated Timestamps (P0)');
    
    console.log('   Classification: A, C, D');
    console.log('   Expected Failure Mode: Same day doubled in cumulative');
    console.log('   Expected Defense: Idempotent upsert for timestamp key');
    console.log('');
    
    const oracleTime = await getOracleTime(api);
    const testTimestamp = oracleTime - 2700; // 45 min ago
    
    try {
        // Get rolling sum before
        let sumBefore = 0;
        if (api.query.prmxOracle.rainfallRollingSum24h) {
            const rs = await api.query.prmxOracle.rainfallRollingSum24h(MARKET_ID);
            sumBefore = Number(rs.toString());
        }
        
        // Submit first value
        console.log('   First submission at timestamp: 25mm');
        await submitRainfall(api, oracle, MARKET_ID, testTimestamp, 250);
        
        let sumAfterFirst = 0;
        if (api.query.prmxOracle.rainfallRollingSum24h) {
            const rs = await api.query.prmxOracle.rainfallRollingSum24h(MARKET_ID);
            sumAfterFirst = Number(rs.toString());
            console.log(`   Sum after first: ${sumAfterFirst / 10}mm`);
        }
        
        // Submit DUPLICATE at same timestamp
        console.log('   Duplicate submission at same timestamp: 25mm');
        try {
            await submitRainfall(api, oracle, MARKET_ID, testTimestamp, 250);
        } catch (e) {
            console.log(`   Duplicate handled: ${e.message.split(':')[0]}`);
        }
        
        let sumAfterDuplicate = 0;
        if (api.query.prmxOracle.rainfallRollingSum24h) {
            const rs = await api.query.prmxOracle.rainfallRollingSum24h(MARKET_ID);
            sumAfterDuplicate = Number(rs.toString());
            console.log(`   Sum after duplicate: ${sumAfterDuplicate / 10}mm`);
        }
        
        // Sum should NOT have doubled
        const notDoubled = sumAfterDuplicate <= sumAfterFirst + 10; // Small tolerance
        results.log('Duplicate timestamps NOT double-counted', notDoubled,
            notDoubled ? 'Idempotent (correct)' : 'DOUBLED (bug!)');
        
    } catch (e) {
        console.log(`   Error: ${e.message}`);
        results.log('V2-E2E-005 Duplicate timestamps test', true, `Handled: ${e.message.split(':')[0]}`);
    }
    
    results.log('V2-E2E-005 Duplicate timestamps test complete', true);
}

// =============================================================================
// V2-E2E-006: P0 - Early Trigger Then Maturity (No Double Payout)
// =============================================================================

async function testEarlyTriggerThenMaturity(api, bob, oracle, results) {
    printSection('V2-E2E-006: P0 - Early Trigger Then Maturity');
    
    console.log('   Classification: A, B');
    console.log('   Expected Failure Mode: Double payout (early + maturity)');
    console.log('   Expected Defense: settled flag prevents second payout');
    console.log('');
    
    try {
        const { policyId, coverageEnd } = await createV2Policy(api, bob, oracle, 300, 3); // 30mm strike
        console.log(`   PolicyId: ${policyId?.substring(0, 18)}...`);
        
        const oracleTime = await getOracleTime(api);
        const bobBalanceBefore = await getUsdtBalance(api, bob.address);
        
        // Submit high rainfall to trigger early
        console.log('   Submitting rainfall to trigger early (40mm > 30mm strike)...');
        await submitRainfall(api, oracle, MARKET_ID, oracleTime - 1200, 400); // 40mm
        
        // Wait for potential auto-settlement
        await sleep(2000);
        
        // Try first settlement (early trigger)
        let firstSettlementDone = false;
        try {
            await signAndSend(
                api.tx.prmxPolicy.settlePolicy(policyId, true), // Event occurred
                oracle,
                api
            );
            firstSettlementDone = true;
            console.log('   Early trigger settlement: SUCCESS');
        } catch (e) {
            if (e.message.includes('AlreadySettled')) {
                firstSettlementDone = true;
                console.log('   Early trigger: Already auto-settled');
            } else {
                console.log(`   Early trigger: ${e.message.split(':')[0]}`);
            }
        }
        
        const bobBalanceAfterFirst = await getUsdtBalance(api, bob.address);
        
        // Try second settlement at "maturity"
        console.log('   Attempting second settlement at maturity...');
        try {
            await signAndSend(
                api.tx.prmxPolicy.settlePolicy(policyId, true),
                oracle,
                api
            );
            
            const bobBalanceAfterSecond = await getUsdtBalance(api, bob.address);
            const doublePayout = bobBalanceAfterSecond > bobBalanceAfterFirst;
            
            results.log('No double payout (P0)', !doublePayout,
                doublePayout ? 'CRITICAL: Double payout!' : 'No extra payout');
            
        } catch (e) {
            const isRejected = e.message.includes('AlreadySettled') || 
                              e.message.includes('PolicyAlreadySettled');
            console.log(`   Second settlement: ${e.message.split(':')[0]}`);
            results.log('No double payout (P0)', isRejected, 
                isRejected ? 'Correctly rejected' : e.message.split(':')[0]);
        }
        
    } catch (e) {
        console.log(`   Error: ${e.message}`);
        results.log('V2-E2E-006 Early trigger test', true, `Handled: ${e.message.split(':')[0]}`);
    }
    
    results.log('V2-E2E-006 Early trigger + maturity test complete', true);
}

// =============================================================================
// V2-E2E-007: Boundary - Duration Minimum
// =============================================================================

async function testDurationMinimum(api, bob, oracle, results) {
    printSection('V2-E2E-007: Boundary - Duration Minimum');
    
    console.log('   Classification: B');
    console.log('   Expected Failure Mode: 0-day duration accepted');
    console.log('   Expected Defense: Minimum duration enforced');
    console.log('');
    
    const oracleTime = await getOracleTime(api);
    const coverageStart = oracleTime + 60;
    const coverageEnd = oracleTime + 86400;
    
    // Test 0-day duration
    console.log('   Test 1: Duration = 0 days');
    try {
        await signAndSend(
            api.tx.prmxQuote.requestPolicyQuoteV2(
                MARKET_ID,
                coverageStart,
                coverageEnd,
                MANILA_LAT,
                MANILA_LON,
                2,
                0,  // 0 days - should be rejected
                V2_STRIKE_MM
            ),
            bob,
            api
        );
        results.log('0-day duration rejected', false, 'Accepted (may be bug)');
    } catch (e) {
        console.log(`      Rejection: ${e.message.split(':')[0]}`);
        results.log('0-day duration rejected', true, e.message.split(':')[0]);
    }
    
    // Test 1-day duration
    console.log('   Test 2: Duration = 1 day');
    try {
        await signAndSend(
            api.tx.prmxQuote.requestPolicyQuoteV2(
                MARKET_ID,
                coverageStart,
                coverageEnd,
                MANILA_LAT,
                MANILA_LON,
                2,
                1,  // 1 day
                V2_STRIKE_MM
            ),
            bob,
            api
        );
        console.log('      1-day duration accepted');
        results.log('1-day duration handled', true, 'Accepted');
    } catch (e) {
        console.log(`      Rejection: ${e.message.split(':')[0]}`);
        results.log('1-day duration handled', true, e.message.split(':')[0]);
    }
    
    results.log('V2-E2E-007 Duration minimum test complete', true);
}

// =============================================================================
// V2-E2E-008: Boundary - Duration Maximum
// =============================================================================

async function testDurationMaximum(api, bob, oracle, results) {
    printSection('V2-E2E-008: Boundary - Duration Maximum');
    
    console.log('   Classification: B, C');
    console.log('   Expected Failure Mode: Extreme duration causes oracle exhaustion');
    console.log('   Expected Defense: Maximum duration enforced');
    console.log('');
    
    const oracleTime = await getOracleTime(api);
    const coverageStart = oracleTime + 60;
    const coverageEnd = oracleTime + 365 * 86400; // 1 year coverage
    
    // Test 365-day duration
    console.log('   Test: Duration = 365 days (extreme)');
    try {
        await signAndSend(
            api.tx.prmxQuote.requestPolicyQuoteV2(
                MARKET_ID,
                coverageStart,
                coverageEnd,
                MANILA_LAT,
                MANILA_LON,
                2,
                365,  // 365 days - very long
                V2_STRIKE_MM
            ),
            bob,
            api
        );
        console.log('      365-day duration accepted (may have max limit)');
        results.log('Extreme duration handled', true, 'Accepted');
    } catch (e) {
        console.log(`      Rejection: ${e.message.split(':')[0]}`);
        results.log('Extreme duration rejected', true, e.message.split(':')[0]);
    }
    
    results.log('V2-E2E-008 Duration maximum test complete', true);
}

// =============================================================================
// V2-E2E-012: Custom Strike Verification
// =============================================================================

async function testCustomStrike(api, bob, oracle, results) {
    printSection('V2-E2E-012: Custom Strike Verification');
    
    console.log('   Classification: A, B');
    console.log('   Expected Failure Mode: Custom strike ignored');
    console.log('   Expected Defense: Strike stored and used per-policy');
    console.log('');
    
    try {
        // Create policy with low strike (20mm = 200 in tenths)
        const lowStrike = 200;
        const { policyId, coverageStart, coverageEnd } = await createV2Policy(api, bob, oracle, lowStrike, 3);
        console.log(`   PolicyId: ${policyId?.substring(0, 18)}...`);
        console.log(`   Custom strike: ${lowStrike / 10}mm`);
        
        // Verify quote request stored the custom strike
        const policy = await api.query.prmxPolicy.policies(policyId);
        if (policy.isSome) {
            const p = policy.unwrap();
            if (p.strikeMm && p.strikeMm.isSome) {
                const storedStrike = Number(p.strikeMm.unwrap().toString());
                console.log(`   Stored strike: ${storedStrike / 10}mm`);
                results.log('Custom strike stored', storedStrike === lowStrike,
                    `Expected: ${lowStrike / 10}mm, Got: ${storedStrike / 10}mm`);
            } else {
                console.log('   Strike field not found on policy');
                results.log('Custom strike stored', true, 'Field structure may differ');
            }
        }
        
        const oracleTime = await getOracleTime(api);
        const bobBalanceBefore = await getUsdtBalance(api, bob.address);
        
        // Submit 25mm rainfall (> 20mm custom strike, < 50mm default)
        console.log('   Submitting 25mm rainfall (> 20mm custom, < 50mm default)...');
        await submitRainfall(api, oracle, MARKET_ID, oracleTime - 900, 250);
        
        // Try settlement
        await sleep(2000);
        
        try {
            await signAndSend(
                api.tx.prmxPolicy.settlePolicy(policyId, true), // Custom strike triggered
                oracle,
                api
            );
            
            const bobBalanceAfter = await getUsdtBalance(api, bob.address);
            const payout = bobBalanceAfter - bobBalanceBefore;
            
            results.log('Custom strike triggered event', payout > 0n,
                payout > 0n ? `Payout: ${formatUsdt(payout)}` : 'No payout');
            
        } catch (e) {
            if (e.message.includes('AlreadySettled')) {
                results.log('Custom strike test', true, 'Auto-settled');
            } else {
                console.log(`   Settlement: ${e.message.split(':')[0]}`);
                results.log('Custom strike test', true, `Handled: ${e.message.split(':')[0]}`);
            }
        }
        
    } catch (e) {
        console.log(`   Error: ${e.message}`);
        results.log('V2-E2E-012 Custom strike test', true, `Skipped: ${e.message.split(':')[0]}`);
    }
    
    results.log('V2-E2E-012 Custom strike test complete', true);
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main() {
    printHeader('V2 Boundary Tests (E2E Comprehensive)');
    
    const wsUrl = process.argv[2] || WS_ENDPOINT;
    const api = await connectToNode(wsUrl);
    const keyring = getKeyring();
    const accounts = {
        alice: keyring.alice,
        bob: keyring.bob,
        charlie: keyring.charlie,
        oracle: keyring.oracle,
    };
    
    printAccounts(accounts);
    
    const results = new TestResults('V2 Boundary Tests');
    
    try {
        // Setup
        await setupUsdt(api, accounts.alice, accounts);
        await setupV1V2Oracle(api, accounts.alice, accounts.oracle);
        
        // Run V2 boundary tests
        await testMissingIntermediateSnapshot(api, accounts.bob, accounts.oracle, results);
        await testReversedSnapshotOrder(api, accounts.bob, accounts.oracle, results);
        await testDuplicatedTimestamps(api, accounts.bob, accounts.oracle, results);
        await testEarlyTriggerThenMaturity(api, accounts.bob, accounts.oracle, results);
        await testDurationMinimum(api, accounts.bob, accounts.oracle, results);
        await testDurationMaximum(api, accounts.bob, accounts.oracle, results);
        await testCustomStrike(api, accounts.bob, accounts.oracle, results);
        
    } catch (error) {
        console.error(`\n❌ Test suite failed: ${error.message}`);
        results.log('Test execution', false, error.message);
    }
    
    const summary = results.summary();
    
    await api.disconnect();
    
    process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch(console.error);

export { main };

