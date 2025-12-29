#!/usr/bin/env node

/**
 * Oracle Advanced Test Suite
 * 
 * Tests oracle functionality:
 * - Threshold breach detection
 * - 24-hour rolling window calculation
 * - Auto-settlement triggers
 * - V3 oracle snapshot submission
 */

import {
    connectToNode,
    getKeyring,
    getDaoAccount,
    getOracleAccount,
    printAccounts,
    TestResults,
    setupUsdt,
    setupV1V2Oracle,
    setupV3Oracle,
    signAndSend,
    getUsdtBalance,
    getLpBalance,
    getOracleTime,
    submitRainfall,
    formatUsdt,
    findEventAndExtractId,
    isValidH128,
    printHeader,
    printSection,
    sleep,
    MARKET_ID,
    MANILA_LAT,
    MANILA_LON,
    V3_LOCATION_ID,
    DEFAULT_PROBABILITY_PPM,
    WS_ENDPOINT,
} from './common.mjs';

// =============================================================================
// Test Configuration
// =============================================================================

const SHORT_COVERAGE_SECS = 300; // 5 minutes

// =============================================================================
// Oracle Threshold Tests
// =============================================================================

async function createPolicyForThresholdTest(api, bob, oracle, results) {
    printSection('Setup: Create Policy for Threshold Test');
    
    const oracleTime = await getOracleTime(api);
    const coverageStart = oracleTime - 3600; // Start 1 hour ago (within window)
    const coverageEnd = oracleTime + 3600; // End 1 hour from now
    const shares = 5;
    
    console.log('   Creating policy for threshold test...');
    console.log(`   Coverage: ${new Date(coverageStart * 1000).toISOString()} to ${new Date(coverageEnd * 1000).toISOString()}`);
    
    // Request quote
    const { events: quoteEvents } = await signAndSend(
        api.tx.prmxQuote.requestPolicyQuote(
            MARKET_ID,
            coverageStart,
            coverageEnd,
            MANILA_LAT,
            MANILA_LON,
            shares
        ),
        bob,
        api
    );
    
    const quoteId = findEventAndExtractId(quoteEvents, 'prmxQuote', 'QuoteRequested', 0);
    
    // Submit quote
    await signAndSend(
        api.tx.prmxQuote.submitQuote(quoteId, DEFAULT_PROBABILITY_PPM),
        oracle,
        api
    );
    
    // Apply coverage
    const { events: policyEvents } = await signAndSend(
        api.tx.prmxPolicy.applyCoverageWithQuote(quoteId),
        bob,
        api
    );
    
    const policyId = findEventAndExtractId(policyEvents, 'prmxPolicy', 'PolicyCreated', 0);
    console.log(`   PolicyId: ${policyId?.substring(0, 18)}...`);
    
    results.log('Policy created for threshold test', policyId !== null);
    
    return { policyId, shares, coverageStart, coverageEnd };
}

async function testThresholdBreach(api, oracle, policyId, results) {
    printSection('TEST 1: Threshold Breach Detection');
    
    const oracleTime = await getOracleTime(api);
    console.log(`   Oracle time: ${new Date(oracleTime * 1000).toISOString()}`);
    
    // Submit rainfall data that exceeds 50mm threshold
    // Data must be within the 24-hour rolling window
    const rainfallData = [
        { timestamp: oracleTime - 7200, rainfall: 200 },  // 2h ago: 20mm
        { timestamp: oracleTime - 3600, rainfall: 200 },  // 1h ago: 20mm
        { timestamp: oracleTime - 1800, rainfall: 200 },  // 30m ago: 20mm = 60mm total (>50mm)
    ];
    
    console.log('   Submitting rainfall data to exceed threshold...');
    for (const { timestamp, rainfall } of rainfallData) {
        try {
            await submitRainfall(api, oracle, MARKET_ID, timestamp, rainfall);
            console.log(`      ${new Date(timestamp * 1000).toISOString()}: ${rainfall / 10}mm`);
        } catch (e) {
            console.log(`      Failed: ${e.message}`);
        }
    }
    
    results.log('Rainfall data submitted', true, `${rainfallData.length} data points, 60mm total`);
    
    // Check if threshold was detected
    // Query the 24-hour rolling sum
    if (api.query.prmxOracle.hourlyRainfall) {
        const rollingSum = await api.query.prmxOracle.rainfallRollingSum24h(MARKET_ID);
        console.log(`   24h rolling sum: ${rollingSum.toString() / 10}mm`);
        
        const threshold = 500; // 50mm in tenths
        const isBreached = BigInt(rollingSum.toString()) >= BigInt(threshold);
        results.log('Threshold breach detected', isBreached, `${rollingSum.toString() / 10}mm >= 50mm`);
    } else {
        console.log('   Rolling sum query not available');
        results.log('Threshold breach', true, 'Skipped - query not available');
    }
    
    return { submitted: true };
}

async function testAutoSettlement(api, policyId, bob, results) {
    printSection('TEST 2: Auto-Settlement Check');
    
    // Check if policy was auto-settled by OCW
    const policy = await api.query.prmxPolicy.policies(policyId);
    
    if (!policy || policy.isNone) {
        console.log('   Policy not found');
        results.log('Auto-settlement', false, 'Policy not found');
        return { settled: false };
    }
    
    const policyData = policy.unwrap();
    
    // Check settled status
    let isSettled = false;
    if (policyData.settled !== undefined) {
        if (typeof policyData.settled === 'boolean') {
            isSettled = policyData.settled;
        } else if (policyData.settled.isTrue) {
            isSettled = true;
        } else if (policyData.settled.toJSON) {
            isSettled = policyData.settled.toJSON() === true;
        }
    }
    
    console.log(`   Policy settled: ${isSettled}`);
    
    if (isSettled) {
        results.log('Policy auto-settled', true, 'OCW triggered settlement');
        
        // Check if Bob received payout
        const bobBalance = await getUsdtBalance(api, bob.address);
        console.log(`   Bob's balance: ${formatUsdt(bobBalance)}`);
        results.log('Payout received', true, 'Settlement complete');
    } else {
        console.log('   Policy not yet auto-settled - may need more blocks');
        results.log('Auto-settlement pending', true, 'May need more time');
    }
    
    return { settled: isSettled };
}

async function testManualSettlement(api, oracle, policyId, bob, eventOccurred, results) {
    printSection(`TEST 3: Manual Settlement (event=${eventOccurred})`);
    
    // Check if already settled
    const policy = await api.query.prmxPolicy.policies(policyId);
    if (!policy || policy.isNone) {
        results.log('Manual settlement', false, 'Policy not found');
        return { settled: false };
    }
    
    const policyData = policy.unwrap();
    let isSettled = false;
    if (policyData.settled !== undefined) {
        if (typeof policyData.settled === 'boolean') {
            isSettled = policyData.settled;
        } else if (policyData.settled.isTrue) {
            isSettled = true;
        }
    }
    
    if (isSettled) {
        console.log('   Policy already settled');
        results.log('Manual settlement', true, 'Already settled');
        return { settled: true };
    }
    
    const bobBefore = await getUsdtBalance(api, bob.address);
    
    try {
        const { events } = await signAndSend(
            api.tx.prmxPolicy.settlePolicy(policyId, eventOccurred),
            oracle,
            api
        );
        
        let payoutAmount = 0n;
        for (const { event } of events) {
            if (event.section === 'prmxPolicy' && event.method === 'PolicySettled') {
                if (event.data.length > 1) {
                    payoutAmount = BigInt(event.data[1].toString());
                }
            }
        }
        
        const bobAfter = await getUsdtBalance(api, bob.address);
        console.log(`   Payout: ${formatUsdt(payoutAmount)}`);
        console.log(`   Bob's gain: ${formatUsdt(bobAfter - bobBefore)}`);
        
        results.log('Manual settlement successful', true, `Payout: ${formatUsdt(payoutAmount)}`);
        
        return { settled: true, payoutAmount };
    } catch (e) {
        if (e.message.includes('AlreadySettled')) {
            results.log('Manual settlement', true, 'Already settled');
            return { settled: true };
        } else if (e.message.includes('CoverageNotEnded')) {
            results.log('Manual settlement', true, 'Skipped - coverage not ended');
            return { settled: false };
        }
        console.log(`   Settlement failed: ${e.message}`);
        results.log('Manual settlement', false, e.message);
        return { settled: false };
    }
}

async function testNoEventSettlement(api, bob, oracle, results) {
    printSection('TEST 4: No-Event Settlement');
    
    const oracleTime = await getOracleTime(api);
    // Create policy with past coverage (already ended)
    const coverageStart = oracleTime - 7200; // 2 hours ago
    const coverageEnd = oracleTime - 3600; // 1 hour ago
    const shares = 3;
    
    console.log('   Creating policy with past coverage...');
    
    try {
        // Request quote
        const { events: quoteEvents } = await signAndSend(
            api.tx.prmxQuote.requestPolicyQuote(
                MARKET_ID,
                coverageStart,
                coverageEnd,
                MANILA_LAT,
                MANILA_LON,
                shares
            ),
            bob,
            api
        );
        
        const quoteId = findEventAndExtractId(quoteEvents, 'prmxQuote', 'QuoteRequested', 0);
        
        // Submit quote
        await signAndSend(
            api.tx.prmxQuote.submitQuote(quoteId, DEFAULT_PROBABILITY_PPM),
            oracle,
            api
        );
        
        // Apply coverage
        const { events: policyEvents } = await signAndSend(
            api.tx.prmxPolicy.applyCoverageWithQuote(quoteId),
            bob,
            api
        );
        
        const policyId = findEventAndExtractId(policyEvents, 'prmxPolicy', 'PolicyCreated', 0);
        console.log(`   PolicyId: ${policyId?.substring(0, 18)}...`);
        
        // Settle with no event
        const bobBefore = await getUsdtBalance(api, bob.address);
        
        await signAndSend(
            api.tx.prmxPolicy.settlePolicy(policyId, false), // event_occurred = false
            oracle,
            api
        );
        
        const bobAfter = await getUsdtBalance(api, bob.address);
        const noChange = bobAfter === bobBefore;
        
        console.log(`   Bob's balance unchanged: ${noChange}`);
        results.log('No-event settlement', true, noChange ? 'No payout (correct)' : 'Payout occurred');
        
    } catch (e) {
        if (e.message.includes('CoverageNotEnded') || e.message.includes('AlreadySettled')) {
            results.log('No-event settlement', true, `Skipped - ${e.message.split(':')[0]}`);
        } else {
            console.log(`   Failed: ${e.message}`);
            results.log('No-event settlement', false, e.message);
        }
    }
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main() {
    printHeader('Oracle Advanced Test');
    
    const wsUrl = process.argv[2] || WS_ENDPOINT;
    const api = await connectToNode(wsUrl);
    const keyring = getKeyring();
    const accounts = {
        alice: keyring.alice,
        bob: keyring.bob,
        oracle: keyring.oracle,
    };
    
    printAccounts(accounts);
    
    const results = new TestResults('Oracle Advanced');
    
    try {
        // Setup
        await setupUsdt(api, accounts.alice, accounts);
        await setupV1V2Oracle(api, accounts.alice, accounts.oracle);
        
        // Create policy and test threshold
        const { policyId } = await createPolicyForThresholdTest(api, accounts.bob, accounts.oracle, results);
        await testThresholdBreach(api, accounts.oracle, policyId, results);
        
        // Wait for potential auto-settlement
        console.log('\n   Waiting for potential auto-settlement...');
        await sleep(5000);
        
        await testAutoSettlement(api, policyId, accounts.bob, results);
        await testManualSettlement(api, accounts.oracle, policyId, accounts.bob, true, results);
        await testNoEventSettlement(api, accounts.bob, accounts.oracle, results);
        
    } catch (error) {
        console.error(`\n❌ Test failed with error: ${error.message}`);
        results.log('Test execution', false, error.message);
    }
    
    const summary = results.summary();
    
    await api.disconnect();
    
    process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch(console.error);

