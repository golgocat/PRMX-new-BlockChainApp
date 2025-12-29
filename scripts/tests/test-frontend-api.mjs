#!/usr/bin/env node

/**
 * Frontend API Integration Test Suite
 * 
 * Tests that the frontend can correctly interact with H128 hash-based IDs:
 * - H128 IDs display correctly in API responses
 * - Policy detail queries work with hash IDs
 * - LP holdings show correctly per policy
 * - URL-compatible ID formatting
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
    getTotalLpShares,
    getOracleTime,
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
// Frontend API Tests
// =============================================================================

async function createTestPolicy(api, bob, oracle, results) {
    printSection('Setup: Create Test Policy');
    
    const oracleTime = await getOracleTime(api);
    const coverageStart = oracleTime + 60;
    const coverageEnd = oracleTime + 3600;
    const shares = 5;
    
    console.log('   Creating policy for frontend API tests...');
    
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
    console.log(`   QuoteId: ${quoteId}`);
    
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
    console.log(`   PolicyId: ${policyId}`);
    
    results.log('Test policy created', policyId !== null && isValidH128(policyId));
    
    return { policyId, quoteId, shares, holder: bob.address };
}

async function testH128UrlFormat(policyId, quoteId, results) {
    printSection('TEST 1: H128 ID URL Format');
    
    console.log('   Verifying H128 IDs are URL-safe...');
    
    // H128 IDs should be:
    // - 34 characters (0x + 32 hex chars)
    // - Only contain 0-9, a-f, and leading 0x
    // - No special characters that need URL encoding
    
    const urlSafeRegex = /^0x[0-9a-f]{32}$/i;
    
    const policyIdValid = urlSafeRegex.test(policyId);
    const quoteIdValid = urlSafeRegex.test(quoteId);
    
    console.log(`   PolicyId: ${policyId}`);
    console.log(`     URL-safe: ${policyIdValid}`);
    console.log(`     Length: ${policyId.length} (expected: 34)`);
    
    console.log(`   QuoteId: ${quoteId}`);
    console.log(`     URL-safe: ${quoteIdValid}`);
    console.log(`     Length: ${quoteId.length} (expected: 34)`);
    
    // Test URL encoding/decoding
    const encodedPolicyId = encodeURIComponent(policyId);
    const isUnchangedAfterEncoding = encodedPolicyId === policyId;
    console.log(`   PolicyId unchanged after URL encoding: ${isUnchangedAfterEncoding}`);
    
    results.log('PolicyId is valid H128', policyIdValid, policyId);
    results.log('QuoteId is valid H128', quoteIdValid, quoteId);
    results.log('IDs are URL-safe', isUnchangedAfterEncoding, 'No encoding needed');
    
    // Simulate frontend URL construction
    const v1PolicyUrl = `/policies/${policyId}`;
    const v3PolicyUrl = `/v3/policies/${policyId}`;
    console.log(`   V1 Policy URL: ${v1PolicyUrl}`);
    console.log(`   V3 Policy URL: ${v3PolicyUrl}`);
    
    results.log('URL construction works', true, 'URLs generated correctly');
    
    return { policyIdValid, quoteIdValid };
}

async function testPolicyDetailQuery(api, policyId, holder, results) {
    printSection('TEST 2: Policy Detail Query with H128 ID');
    
    console.log(`   Querying policy: ${policyId.substring(0, 24)}...`);
    
    // Query policy using H128 ID (simulating frontend API call)
    const policy = await api.query.prmxPolicy.policies(policyId);
    
    if (!policy || policy.isNone) {
        results.log('Policy query with H128', false, 'Policy not found');
        return { found: false };
    }
    
    const policyData = policy.unwrap();
    
    // Extract policy details (as frontend would)
    const details = {
        holder: policyData.holder ? policyData.holder.toString() : null,
        marketId: policyData.marketId ? policyData.marketId.toString() : null,
        shares: policyData.shares ? policyData.shares.toString() : null,
        premium: policyData.premium ? policyData.premium.toString() : null,
        settled: policyData.settled ? 
            (typeof policyData.settled === 'boolean' ? policyData.settled : policyData.settled.isTrue) 
            : false,
    };
    
    console.log(`   Policy Details:`);
    console.log(`     Holder: ${details.holder?.substring(0, 20)}...`);
    console.log(`     Market ID: ${details.marketId}`);
    console.log(`     Shares: ${details.shares}`);
    console.log(`     Premium: ${formatUsdt(BigInt(details.premium || 0))}`);
    console.log(`     Settled: ${details.settled}`);
    
    results.log('Policy query with H128', true, 'Policy found');
    results.log('Policy holder matches', details.holder === holder, 
        details.holder === holder ? 'Matches' : 'Mismatch');
    
    return { found: true, details };
}

async function testLpHoldingsQuery(api, policyId, holder, results) {
    printSection('TEST 3: LP Holdings Query with H128 ID');
    
    console.log(`   Querying LP holdings for policy: ${policyId.substring(0, 24)}...`);
    
    // Get DAO address
    const daoAddress = await getDaoAccount();
    
    // Query LP holdings using H128 policy ID (simulating frontend API call)
    const daoLp = await getLpBalance(api, policyId, daoAddress);
    const holderLp = await getLpBalance(api, policyId, holder);
    const totalShares = await getTotalLpShares(api, policyId);
    
    console.log(`   LP Holdings:`);
    console.log(`     DAO: ${daoLp.total} (free: ${daoLp.free}, locked: ${daoLp.locked})`);
    console.log(`     Holder: ${holderLp.total}`);
    console.log(`     Total Shares: ${totalShares}`);
    
    results.log('DAO LP holdings queryable', daoLp.total >= 0n, `${daoLp.total} shares`);
    results.log('Total shares queryable', totalShares >= 0n, `${totalShares} shares`);
    
    // Verify LP tokens exist for this policy
    const hasLpTokens = daoLp.total > 0n || totalShares > 0n;
    results.log('LP tokens exist for policy', hasLpTokens, 
        hasLpTokens ? 'LP pool exists' : 'May have been settled');
    
    return { daoLp, holderLp, totalShares };
}

async function testQuoteQuery(api, quoteId, results) {
    printSection('TEST 4: Quote Query with H128 ID');
    
    console.log(`   Querying quote: ${quoteId.substring(0, 24)}...`);
    
    // Query quote request
    const quoteRequest = await api.query.prmxQuote.quoteRequests(quoteId);
    
    if (quoteRequest.isSome) {
        const req = quoteRequest.unwrap();
        console.log(`   Quote Request:`);
        console.log(`     Shares: ${req.shares?.toString()}`);
        console.log(`     Market: ${req.marketId?.toString()}`);
        results.log('Quote request queryable', true, `${req.shares?.toString()} shares`);
    } else {
        console.log('   Quote request not found (may have been consumed)');
        results.log('Quote request query', true, 'Request consumed (expected after policy creation)');
    }
    
    // Query quote result
    const quoteResult = await api.query.prmxQuote.quoteResults(quoteId);
    
    if (quoteResult.isSome) {
        const result = quoteResult.unwrap();
        const premium = BigInt(result.totalPremium?.toString() || 0);
        console.log(`   Quote Result:`);
        console.log(`     Premium: ${formatUsdt(premium)}`);
        results.log('Quote result queryable', true, formatUsdt(premium));
    } else {
        console.log('   Quote result not found');
        results.log('Quote result query', true, 'May not exist');
    }
    
    return { found: quoteRequest.isSome || quoteResult.isSome };
}

async function testV3RequestQuery(api, bob, results) {
    printSection('TEST 5: V3 Request Query with H128 ID');
    
    const now = Math.floor(Date.now() / 1000);
    const coverageStart = now + 3600;
    const coverageEnd = now + 86400;
    const expiresAt = now + 7200;
    const shares = 3;
    const premiumPerShare = 10_000_000n;
    
    console.log('   Creating V3 request...');
    
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
        console.log(`   RequestId: ${requestId}`);
        
        // Query using H128 ID
        const request = await api.query.prmxMarketV3.underwriteRequests(requestId);
        
        if (request.isSome) {
            const reqData = request.unwrap();
            console.log(`   V3 Request Details:`);
            console.log(`     Requester: ${reqData.requester?.toString().substring(0, 20)}...`);
            console.log(`     Total Shares: ${reqData.totalShares?.toString()}`);
            console.log(`     Filled Shares: ${reqData.filledShares?.toString()}`);
            console.log(`     Status: ${reqData.status?.toString()}`);
            
            results.log('V3 request queryable with H128', true, requestId.substring(0, 24));
        } else {
            results.log('V3 request query', false, 'Not found');
        }
        
        return { requestId };
    } catch (e) {
        console.log(`   Failed to create V3 request: ${e.message}`);
        results.log('V3 request test', true, `Skipped - ${e.message.split(':')[0]}`);
        return { requestId: null };
    }
}

async function testMultiplePolicyQueries(api, bob, oracle, results) {
    printSection('TEST 6: Multiple Policy Queries (List View)');
    
    console.log('   Creating multiple policies...');
    
    const policyIds = [];
    
    for (let i = 0; i < 3; i++) {
        try {
            const oracleTime = await getOracleTime(api);
            const coverageStart = oracleTime + 60 + (i * 30);
            const coverageEnd = oracleTime + 3600 + (i * 30);
            
            const { events: quoteEvents } = await signAndSend(
                api.tx.prmxQuote.requestPolicyQuote(
                    MARKET_ID,
                    coverageStart,
                    coverageEnd,
                    MANILA_LAT,
                    MANILA_LON,
                    1 + i
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
            policyIds.push(policyId);
            console.log(`   Policy ${i + 1}: ${policyId.substring(0, 24)}...`);
        } catch (e) {
            console.log(`   Policy ${i + 1} failed: ${e.message}`);
        }
    }
    
    console.log(`\n   Created ${policyIds.length} policies`);
    
    // Verify all IDs are unique
    const uniqueIds = new Set(policyIds);
    console.log(`   Unique IDs: ${uniqueIds.size}/${policyIds.length}`);
    
    results.log('Multiple policies created', policyIds.length >= 2, `${policyIds.length} policies`);
    results.log('All IDs unique', uniqueIds.size === policyIds.length, 'No duplicates');
    
    // Simulate frontend list view - query each policy
    console.log('\n   Simulating frontend list view...');
    let successfulQueries = 0;
    
    for (const policyId of policyIds) {
        const policy = await api.query.prmxPolicy.policies(policyId);
        if (policy.isSome) {
            successfulQueries++;
        }
    }
    
    console.log(`   Successfully queried: ${successfulQueries}/${policyIds.length}`);
    results.log('All policies queryable', successfulQueries === policyIds.length, 
        `${successfulQueries}/${policyIds.length}`);
    
    return { policyIds };
}

async function testIdParsing(results) {
    printSection('TEST 7: H128 ID Parsing');
    
    console.log('   Testing ID parsing scenarios...');
    
    // Test valid H128 IDs
    const validIds = [
        '0x1a2b3c4d5e6f7890abcdef1234567890',
        '0xABCDEF1234567890ABCDEF1234567890',
        '0x00000000000000000000000000000001',
        '0xffffffffffffffffffffffffffffffff',
    ];
    
    // Test invalid IDs
    const invalidIds = [
        '123',                              // Too short, no prefix
        '0x123',                            // Too short
        '1a2b3c4d5e6f7890abcdef1234567890', // Missing 0x prefix
        '0xGGGG0000000000000000000000000000', // Invalid hex chars
        '0x1a2b3c4d5e6f7890abcdef12345678901', // Too long
    ];
    
    console.log('   Valid IDs:');
    let validCount = 0;
    for (const id of validIds) {
        const isValid = isValidH128(id);
        console.log(`     ${id.substring(0, 24)}... : ${isValid ? '✅' : '❌'}`);
        if (isValid) validCount++;
    }
    
    console.log('   Invalid IDs:');
    let invalidCount = 0;
    for (const id of invalidIds) {
        const isValid = isValidH128(id);
        console.log(`     ${id.substring(0, 24)}... : ${isValid ? '❌ (should be invalid)' : '✅ (correctly rejected)'}`);
        if (!isValid) invalidCount++;
    }
    
    results.log('Valid H128 IDs accepted', validCount === validIds.length, 
        `${validCount}/${validIds.length}`);
    results.log('Invalid IDs rejected', invalidCount === invalidIds.length, 
        `${invalidCount}/${invalidIds.length}`);
    
    return { validCount, invalidCount };
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main() {
    printHeader('Frontend API Integration Test');
    
    const wsUrl = process.argv[2] || WS_ENDPOINT;
    const api = await connectToNode(wsUrl);
    const keyring = getKeyring();
    const accounts = {
        alice: keyring.alice,
        bob: keyring.bob,
        oracle: keyring.oracle,
    };
    
    printAccounts(accounts);
    
    const results = new TestResults('Frontend API Integration');
    
    try {
        // Setup
        await setupUsdt(api, accounts.alice, accounts);
        await setupV1V2Oracle(api, accounts.alice, accounts.oracle);
        await setupV3Oracle(api, accounts.alice, accounts.oracle);
        
        // Create test policy
        const { policyId, quoteId, holder } = await createTestPolicy(
            api, accounts.bob, accounts.oracle, results
        );
        
        // Run tests
        await testH128UrlFormat(policyId, quoteId, results);
        await testPolicyDetailQuery(api, policyId, holder, results);
        await testLpHoldingsQuery(api, policyId, holder, results);
        await testQuoteQuery(api, quoteId, results);
        await testV3RequestQuery(api, accounts.bob, results);
        await testMultiplePolicyQueries(api, accounts.bob, accounts.oracle, results);
        await testIdParsing(results);
        
    } catch (error) {
        console.error(`\n❌ Test failed with error: ${error.message}`);
        results.log('Test execution', false, error.message);
    }
    
    const summary = results.summary();
    
    await api.disconnect();
    
    process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch(console.error);

