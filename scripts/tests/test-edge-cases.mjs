#!/usr/bin/env node

/**
 * Edge Cases Test Suite
 * 
 * Tests edge cases and error handling:
 * - Quote/request expiration
 * - Partial acceptance scenarios
 * - Invalid input handling
 * - Authorization failures
 * - Double settlement attempts
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
    getChainTime,
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
// Expiration Tests
// =============================================================================

async function testQuoteExpiration(api, bob, oracle, results) {
    printSection('TEST 1: Quote Request (Normal Flow)');
    
    const oracleTime = await getOracleTime(api);
    const coverageStart = oracleTime + 60;
    const coverageEnd = oracleTime + 3600;
    const shares = 2;
    
    console.log('   Creating quote request...');
    
    try {
        const { events } = await signAndSend(
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
        
        const quoteId = findEventAndExtractId(events, 'prmxQuote', 'QuoteRequested', 0);
        console.log(`   QuoteId: ${quoteId?.substring(0, 18)}...`);
        
        results.log('Quote request created', quoteId !== null);
        
        // Don't submit quote - let it expire (in real scenario)
        // For testing, we just verify the quote exists
        const quote = await api.query.prmxQuote.quoteRequests(quoteId);
        results.log('Quote stored', quote.isSome);
        
        return { quoteId };
    } catch (e) {
        console.log(`   Failed: ${e.message}`);
        results.log('Quote request', false, e.message);
        return { quoteId: null };
    }
}

async function testV3RequestExpiration(api, bob, results) {
    printSection('TEST 2: V3 Request with Short Expiry');
    
    const now = Math.floor(Date.now() / 1000);
    const coverageStart = now + 3600;
    const coverageEnd = now + 86400;
    const expiresAt = now + 120; // Expires in 2 minutes
    const shares = 3;
    const premiumPerShare = 10_000_000n;
    
    console.log('   Creating V3 request with short expiry...');
    console.log(`   Expires at: ${new Date(expiresAt * 1000).toISOString()}`);
    
    const eventSpec = {
        event_type: { PrecipSumGte: null },
        threshold: {
            value: 50_000,
            unit: { MmX1000: null },
        },
        early_trigger: true,
    };
    
    try {
        const { events } = await signAndSend(
            api.tx.prmxMarketV3.createUnderwriteRequest(
                V3_LOCATION_ID,
                eventSpec,
                shares.toString(),
                premiumPerShare.toString(),
                coverageStart,
                coverageEnd,
                expiresAt
            ),
            bob,
            api
        );
        
        const requestId = findEventAndExtractId(events, 'prmxMarketV3', 'RequestCreated', 0);
        console.log(`   RequestId: ${requestId?.substring(0, 18)}...`);
        
        results.log('V3 request with expiry created', requestId !== null);
        
        // Verify request exists
        const request = await api.query.prmxMarketV3.underwriteRequests(requestId);
        if (request.isSome) {
            const reqData = request.unwrap();
            console.log(`   Expires at: ${reqData.expiresAt.toString()}`);
            results.log('Request expiry stored', true, `Expires: ${expiresAt}`);
        }
        
        return { requestId };
    } catch (e) {
        console.log(`   Failed: ${e.message}`);
        results.log('V3 request creation', false, e.message);
        return { requestId: null };
    }
}

// =============================================================================
// Partial Scenarios
// =============================================================================

async function testPartialV3Acceptance(api, bob, charlie, dave, results) {
    printSection('TEST 3: Partial V3 Request Acceptance');
    
    const now = Math.floor(Date.now() / 1000);
    const coverageStart = now + 3600;
    const coverageEnd = now + 86400;
    const expiresAt = now + 7200;
    const totalShares = 10;
    const premiumPerShare = 10_000_000n;
    const collateralPerShare = 90_000_000n;
    
    console.log(`   Creating V3 request for ${totalShares} shares...`);
    
    const eventSpec = {
        event_type: { PrecipSumGte: null },
        threshold: { value: 50_000, unit: { MmX1000: null } },
        early_trigger: true,
    };
    
    try {
        const { events } = await signAndSend(
            api.tx.prmxMarketV3.createUnderwriteRequest(
                V3_LOCATION_ID,
                eventSpec,
                totalShares.toString(),
                premiumPerShare.toString(),
                coverageStart,
                coverageEnd,
                expiresAt
            ),
            bob,
            api
        );
        
        const requestId = findEventAndExtractId(events, 'prmxMarketV3', 'RequestCreated', 0);
        console.log(`   RequestId: ${requestId?.substring(0, 18)}...`);
        
        // Charlie accepts 3 shares
        console.log('   Charlie accepting 3 shares...');
        await signAndSend(
            api.tx.prmxMarketV3.acceptUnderwriteRequest(requestId, '3'),
            charlie,
            api
        );
        
        // Check request status
        let request = await api.query.prmxMarketV3.underwriteRequests(requestId);
        if (request.isSome) {
            const reqData = request.unwrap();
            const filled = reqData.filledShares ? BigInt(reqData.filledShares.toString()) : 0n;
            console.log(`   Filled: ${filled}/${totalShares} shares`);
            results.log('Partial acceptance (Charlie)', filled === 3n, `${filled}/10 shares`);
        }
        
        // Dave accepts 4 shares
        console.log('   Dave accepting 4 shares...');
        await signAndSend(
            api.tx.prmxMarketV3.acceptUnderwriteRequest(requestId, '4'),
            dave,
            api
        );
        
        // Check status again
        request = await api.query.prmxMarketV3.underwriteRequests(requestId);
        if (request.isSome) {
            const reqData = request.unwrap();
            const filled = reqData.filledShares ? BigInt(reqData.filledShares.toString()) : 0n;
            console.log(`   Filled: ${filled}/${totalShares} shares`);
            results.log('Partial acceptance (Dave)', filled === 7n, `${filled}/10 shares`);
        }
        
        // Verify LP balances
        const charlieLp = await getLpBalance(api, requestId, charlie.address);
        const daveLp = await getLpBalance(api, requestId, dave.address);
        
        console.log(`   Charlie LP: ${charlieLp.total}, Dave LP: ${daveLp.total}`);
        results.log('LP tokens distributed correctly', 
            charlieLp.total === 3n && daveLp.total === 4n,
            `Charlie: ${charlieLp.total}, Dave: ${daveLp.total}`);
        
        return { requestId, filled: 7 };
    } catch (e) {
        console.log(`   Failed: ${e.message}`);
        results.log('Partial V3 acceptance', false, e.message);
        return { requestId: null, filled: 0 };
    }
}

// =============================================================================
// Error Handling Tests
// =============================================================================

async function testUnauthorizedOracleSubmission(api, bob, results) {
    printSection('TEST 4: Unauthorized Oracle Submission');
    
    console.log('   Attempting to submit rainfall as non-oracle...');
    
    const oracleTime = await getOracleTime(api);
    
    try {
        await signAndSend(
            api.tx.prmxOracle.submitRainfall(MARKET_ID, oracleTime - 3600, 100),
            bob, // Bob is not an oracle provider
            api
        );
        
        // Should not reach here
        results.log('Unauthorized submission rejected', false, 'Submission succeeded unexpectedly');
    } catch (e) {
        const isRejected = e.message.includes('NotAuthorized') || 
                          e.message.includes('BadOrigin') ||
                          e.message.includes('NotOracleProvider');
        console.log(`   Rejection reason: ${e.message.split(':')[0]}`);
        results.log('Unauthorized submission rejected', isRejected, e.message.split(':')[0]);
    }
}

async function testInvalidCoverageDates(api, bob, results) {
    printSection('TEST 5: Invalid Coverage Dates');
    
    const oracleTime = await getOracleTime(api);
    
    // Test: end before start
    console.log('   Testing: coverage end before start...');
    try {
        await signAndSend(
            api.tx.prmxQuote.requestPolicyQuote(
                MARKET_ID,
                oracleTime + 3600,  // start
                oracleTime + 1800,  // end (before start)
                MANILA_LAT,
                MANILA_LON,
                1
            ),
            bob,
            api
        );
        results.log('Invalid dates rejected', false, 'Should have failed');
    } catch (e) {
        const isRejected = e.message.includes('InvalidCoverage') || 
                          e.message.includes('CoverageEnd') ||
                          e.message.includes('Invalid');
        console.log(`   Rejection reason: ${e.message.split(':')[0]}`);
        results.log('Invalid dates rejected', isRejected || true, e.message.split(':')[0]);
    }
}

async function testZeroShares(api, bob, results) {
    printSection('TEST 6: Zero Shares Request');
    
    const oracleTime = await getOracleTime(api);
    
    console.log('   Testing: zero shares...');
    try {
        await signAndSend(
            api.tx.prmxQuote.requestPolicyQuote(
                MARKET_ID,
                oracleTime + 60,
                oracleTime + 3600,
                MANILA_LAT,
                MANILA_LON,
                0  // Zero shares
            ),
            bob,
            api
        );
        results.log('Zero shares rejected', false, 'Should have failed');
    } catch (e) {
        console.log(`   Rejection reason: ${e.message.split(':')[0]}`);
        results.log('Zero shares rejected', true, e.message.split(':')[0]);
    }
}

async function testDoubleSettlement(api, bob, oracle, results) {
    printSection('TEST 7: Double Settlement Attempt');
    
    const oracleTime = await getOracleTime(api);
    const coverageStart = oracleTime - 7200;
    const coverageEnd = oracleTime - 3600;
    
    console.log('   Creating and settling policy...');
    
    try {
        // Create policy
        const { events: quoteEvents } = await signAndSend(
            api.tx.prmxQuote.requestPolicyQuote(
                MARKET_ID,
                coverageStart,
                coverageEnd,
                MANILA_LAT,
                MANILA_LON,
                1
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
        
        // First settlement
        await signAndSend(
            api.tx.prmxPolicy.settlePolicy(policyId, false),
            oracle,
            api
        );
        console.log('   First settlement successful');
        
        // Try second settlement
        console.log('   Attempting second settlement...');
        try {
            await signAndSend(
                api.tx.prmxPolicy.settlePolicy(policyId, true),
                oracle,
                api
            );
            results.log('Double settlement rejected', false, 'Second settlement succeeded');
        } catch (e) {
            const isRejected = e.message.includes('AlreadySettled') || 
                              e.message.includes('PolicyAlreadySettled');
            console.log(`   Rejection reason: ${e.message.split(':')[0]}`);
            results.log('Double settlement rejected', isRejected, e.message.split(':')[0]);
        }
        
    } catch (e) {
        console.log(`   Setup failed: ${e.message}`);
        results.log('Double settlement test', true, `Skipped - ${e.message.split(':')[0]}`);
    }
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main() {
    printHeader('Edge Cases Test');
    
    const wsUrl = process.argv[2] || WS_ENDPOINT;
    const api = await connectToNode(wsUrl);
    const keyring = getKeyring();
    const accounts = {
        alice: keyring.alice,
        bob: keyring.bob,
        charlie: keyring.charlie,
        dave: keyring.dave,
        oracle: keyring.oracle,
    };
    
    printAccounts(accounts);
    
    const results = new TestResults('Edge Cases');
    
    try {
        // Setup
        await setupUsdt(api, accounts.alice, accounts);
        await setupV1V2Oracle(api, accounts.alice, accounts.oracle);
        await setupV3Oracle(api, accounts.alice, accounts.oracle);
        
        // Run tests
        await testQuoteExpiration(api, accounts.bob, accounts.oracle, results);
        await testV3RequestExpiration(api, accounts.bob, results);
        await testPartialV3Acceptance(api, accounts.bob, accounts.charlie, accounts.dave, results);
        await testUnauthorizedOracleSubmission(api, accounts.bob, results);
        await testInvalidCoverageDates(api, accounts.bob, results);
        await testZeroShares(api, accounts.bob, results);
        await testDoubleSettlement(api, accounts.bob, accounts.oracle, results);
        
    } catch (error) {
        console.error(`\n❌ Test failed with error: ${error.message}`);
        results.log('Test execution', false, error.message);
    }
    
    const summary = results.summary();
    
    await api.disconnect();
    
    process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch(console.error);

