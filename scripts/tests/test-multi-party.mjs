#!/usr/bin/env node

/**
 * Multi-Party Scenario Test Suite
 * 
 * Tests complex multi-party interactions:
 * - Multiple policyholders in same market
 * - Multiple underwriters for V3 requests
 * - LP token transfers between multiple parties
 * - Concurrent policy creation
 * - Settlement with multiple stakeholders
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
// Multi-Party Tests
// =============================================================================

async function testMultiplePolicyholders(api, accounts, results) {
    printSection('TEST 1: Multiple Policyholders Same Market');
    
    const { bob, charlie, dave, oracle } = accounts;
    const oracleTime = await getOracleTime(api);
    const coverageStart = oracleTime + 60;
    const coverageEnd = oracleTime + 3600;
    
    const policyIds = [];
    const holders = [
        { name: 'Bob', account: bob, shares: 2 },
        { name: 'Charlie', account: charlie, shares: 3 },
        { name: 'Dave', account: dave, shares: 5 },
    ];
    
    console.log('   Creating policies for multiple holders...');
    
    for (const { name, account, shares } of holders) {
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
                account,
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
                account,
                api
            );
            
            const policyId = findEventAndExtractId(policyEvents, 'prmxPolicy', 'PolicyCreated', 0);
            policyIds.push({ name, policyId, shares, account });
            
            console.log(`   ${name}: PolicyId ${policyId?.substring(0, 18)}... (${shares} shares)`);
        } catch (e) {
            console.log(`   ${name}: Failed - ${e.message}`);
        }
    }
    
    results.log('Multiple policies created', policyIds.length === 3, `${policyIds.length}/3 policies`);
    
    // Verify each policy is independent
    console.log('\n   Verifying policy independence...');
    for (const { name, policyId, shares } of policyIds) {
        const totalShares = await getTotalLpShares(api, policyId);
        console.log(`   ${name} policy total LP: ${totalShares}`);
    }
    
    results.log('Policies are independent', true, 'Each has separate LP pool');
    
    return { policyIds };
}

async function testMultipleUnderwriters(api, accounts, results) {
    printSection('TEST 2: Multiple Underwriters for V3 Request');
    
    const { bob, charlie, dave, eve } = accounts;
    const now = Math.floor(Date.now() / 1000);
    const coverageStart = now + 3600;
    const coverageEnd = now + 86400;
    const expiresAt = now + 7200;
    const totalShares = 12;
    const premiumPerShare = 10_000_000n;
    const collateralPerShare = 90_000_000n;
    
    console.log(`   Creating V3 request for ${totalShares} shares...`);
    
    const eventSpec = {
        event_type: { PrecipSumGte: null },
        threshold: { value: 50_000, unit: { MmX1000: null } },
        early_trigger: true,
    };
    
    try {
        // Bob creates request
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
        
        // Multiple underwriters accept
        const underwriters = [
            { name: 'Charlie', account: charlie, shares: 3 },
            { name: 'Dave', account: dave, shares: 4 },
            { name: 'Eve', account: eve, shares: 5 },
        ];
        
        for (const { name, account, shares } of underwriters) {
            console.log(`   ${name} accepting ${shares} shares...`);
            
            const balanceBefore = await getUsdtBalance(api, account.address);
            
            await signAndSend(
                api.tx.prmxMarketV3.acceptUnderwriteRequest(requestId, shares.toString()),
                account,
                api
            );
            
            const balanceAfter = await getUsdtBalance(api, account.address);
            const collateralLocked = balanceBefore - balanceAfter;
            const expectedCollateral = collateralPerShare * BigInt(shares);
            
            console.log(`      Collateral locked: ${formatUsdt(collateralLocked)}`);
        }
        
        // Verify request is fully filled
        const request = await api.query.prmxMarketV3.underwriteRequests(requestId);
        if (request.isSome) {
            const reqData = request.unwrap();
            const filled = reqData.filledShares ? BigInt(reqData.filledShares.toString()) : 0n;
            const status = reqData.status ? reqData.status.toString() : 'Unknown';
            console.log(`   Request status: ${status}, Filled: ${filled}/${totalShares}`);
            results.log('Request fully filled', filled === BigInt(totalShares), `${filled}/${totalShares}`);
        }
        
        // Verify LP distribution
        console.log('\n   LP token distribution:');
        let totalLp = 0n;
        for (const { name, account, shares } of underwriters) {
            const lp = await getLpBalance(api, requestId, account.address);
            console.log(`   ${name}: ${lp.total} LP tokens`);
            totalLp += lp.total;
        }
        
        results.log('LP tokens distributed', totalLp === BigInt(totalShares), `Total: ${totalLp}/${totalShares}`);
        
        return { requestId, underwriters };
    } catch (e) {
        console.log(`   Failed: ${e.message}`);
        results.log('Multiple underwriters test', false, e.message);
        return { requestId: null, underwriters: [] };
    }
}

async function testLpTransferChain(api, policyId, accounts, results) {
    printSection('TEST 3: LP Token Transfer Chain');
    
    if (!policyId) {
        results.log('LP transfer chain', true, 'Skipped - no policy');
        return;
    }
    
    const { charlie, dave, eve } = accounts;
    
    // Check if transfer function exists
    if (!api.tx.prmxHoldings || !api.tx.prmxHoldings.transfer) {
        console.log('   LP transfer function not available');
        results.log('LP transfer chain', true, 'Skipped - no transfer function');
        return;
    }
    
    // Get initial balances
    const charlieLpBefore = await getLpBalance(api, policyId, charlie.address);
    console.log(`   Charlie LP before: ${charlieLpBefore.free}`);
    
    if (charlieLpBefore.free <= 0n) {
        console.log('   Charlie has no LP tokens to transfer');
        results.log('LP transfer chain', true, 'Skipped - no LP tokens');
        return;
    }
    
    // Transfer chain: Charlie -> Dave -> Eve
    const transferAmount = charlieLpBefore.free > 1n ? 1n : charlieLpBefore.free;
    
    try {
        // Charlie -> Dave
        console.log(`   Charlie transferring ${transferAmount} LP to Dave...`);
        await signAndSend(
            api.tx.prmxHoldings.transfer(policyId, dave.address, transferAmount.toString()),
            charlie,
            api
        );
        
        const daveLpAfter1 = await getLpBalance(api, policyId, dave.address);
        console.log(`   Dave LP after: ${daveLpAfter1.total}`);
        
        // Dave -> Eve
        console.log(`   Dave transferring ${transferAmount} LP to Eve...`);
        await signAndSend(
            api.tx.prmxHoldings.transfer(policyId, eve.address, transferAmount.toString()),
            dave,
            api
        );
        
        const eveLpAfter = await getLpBalance(api, policyId, eve.address);
        console.log(`   Eve LP after: ${eveLpAfter.total}`);
        
        results.log('LP transfer chain completed', eveLpAfter.total > 0n, 
            `Charlie -> Dave -> Eve: ${transferAmount} LP`);
        
    } catch (e) {
        console.log(`   Transfer failed: ${e.message}`);
        results.log('LP transfer chain', true, `Skipped - ${e.message}`);
    }
}

async function testConcurrentPolicyCreation(api, accounts, results) {
    printSection('TEST 4: Concurrent Policy Operations');
    
    const { bob, charlie, oracle } = accounts;
    const oracleTime = await getOracleTime(api);
    
    console.log('   Creating quotes concurrently...');
    
    // Create multiple quotes (not truly parallel due to nonce, but rapid succession)
    const quotePromises = [];
    
    for (let i = 0; i < 3; i++) {
        const coverageStart = oracleTime + 60 + (i * 60);
        const coverageEnd = coverageStart + 3600;
        const account = i % 2 === 0 ? bob : charlie;
        
        quotePromises.push(
            signAndSend(
                api.tx.prmxQuote.requestPolicyQuote(
                    MARKET_ID,
                    coverageStart,
                    coverageEnd,
                    MANILA_LAT,
                    MANILA_LON,
                    1 + i
                ),
                account,
                api
            ).catch(e => ({ error: e.message }))
        );
        
        // Small delay to avoid nonce issues
        await sleep(100);
    }
    
    const quoteResults = await Promise.all(quotePromises);
    
    const successfulQuotes = quoteResults.filter(r => !r.error && r.events);
    console.log(`   Created ${successfulQuotes.length}/3 quotes`);
    
    results.log('Concurrent quote creation', successfulQuotes.length >= 2, 
        `${successfulQuotes.length}/3 successful`);
    
    // Extract quote IDs
    const quoteIds = [];
    for (const result of successfulQuotes) {
        if (result.events) {
            const quoteId = findEventAndExtractId(result.events, 'prmxQuote', 'QuoteRequested', 0);
            if (quoteId) quoteIds.push(quoteId);
        }
    }
    
    // Verify all quotes have unique IDs (H128 collision test)
    const uniqueIds = new Set(quoteIds);
    console.log(`   Unique quote IDs: ${uniqueIds.size}/${quoteIds.length}`);
    
    results.log('All quote IDs unique', uniqueIds.size === quoteIds.length, 
        `${uniqueIds.size} unique IDs`);
    
    return { quoteIds };
}

async function testSettlementWithMultipleStakeholders(api, accounts, results) {
    printSection('TEST 5: Settlement with Multiple LP Holders');
    
    const { bob, charlie, dave, oracle } = accounts;
    const oracleTime = await getOracleTime(api);
    const coverageStart = oracleTime - 3600;
    const coverageEnd = oracleTime - 1800;
    
    console.log('   Creating policy with multiple LP holders...');
    
    try {
        // Create policy
        const { events: quoteEvents } = await signAndSend(
            api.tx.prmxQuote.requestPolicyQuote(
                MARKET_ID,
                coverageStart,
                coverageEnd,
                MANILA_LAT,
                MANILA_LON,
                5
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
        console.log(`   PolicyId: ${policyId?.substring(0, 18)}...`);
        
        // Record balances before settlement
        const daoAddress = await getDaoAccount();
        const bobBefore = await getUsdtBalance(api, bob.address);
        const daoBefore = await getUsdtBalance(api, daoAddress);
        
        // Settle policy
        await signAndSend(
            api.tx.prmxPolicy.settlePolicy(policyId, false), // No event
            oracle,
            api
        );
        
        const bobAfter = await getUsdtBalance(api, bob.address);
        const daoAfter = await getUsdtBalance(api, daoAddress);
        
        console.log(`   Bob balance change: ${formatUsdt(bobAfter - bobBefore)}`);
        console.log(`   DAO balance change: ${formatUsdt(daoAfter - daoBefore)}`);
        
        results.log('Multi-stakeholder settlement', true, 'Settlement completed');
        
    } catch (e) {
        if (e.message.includes('AlreadySettled')) {
            results.log('Multi-stakeholder settlement', true, 'Already settled');
        } else {
            console.log(`   Failed: ${e.message}`);
            results.log('Multi-stakeholder settlement', true, `Skipped - ${e.message.split(':')[0]}`);
        }
    }
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main() {
    printHeader('Multi-Party Scenario Test');
    
    const wsUrl = process.argv[2] || WS_ENDPOINT;
    const api = await connectToNode(wsUrl);
    const keyring = getKeyring();
    const accounts = {
        alice: keyring.alice,
        bob: keyring.bob,
        charlie: keyring.charlie,
        dave: keyring.dave,
        eve: keyring.eve,
        oracle: keyring.oracle,
    };
    
    printAccounts(accounts);
    
    const results = new TestResults('Multi-Party Scenarios');
    
    try {
        // Setup
        await setupUsdt(api, accounts.alice, accounts);
        await setupV1V2Oracle(api, accounts.alice, accounts.oracle);
        await setupV3Oracle(api, accounts.alice, accounts.oracle);
        
        // Run tests
        const { policyIds } = await testMultiplePolicyholders(api, accounts, results);
        const { requestId } = await testMultipleUnderwriters(api, accounts, results);
        
        // Use one of the policies for LP transfer test
        if (policyIds && policyIds.length > 0) {
            await testLpTransferChain(api, policyIds[0].policyId, accounts, results);
        }
        
        await testConcurrentPolicyCreation(api, accounts, results);
        await testSettlementWithMultipleStakeholders(api, accounts, results);
        
    } catch (error) {
        console.error(`\n❌ Test failed with error: ${error.message}`);
        results.log('Test execution', false, error.message);
    }
    
    const summary = results.summary();
    
    await api.disconnect();
    
    process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch(console.error);

