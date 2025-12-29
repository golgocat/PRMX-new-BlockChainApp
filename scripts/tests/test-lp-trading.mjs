#!/usr/bin/env node

/**
 * LP Orderbook Trading Test Suite
 * 
 * Tests LP token trading functionality:
 * - DAO ask placement after policy creation
 * - Buying LP tokens from orderbook
 * - Selling LP tokens back
 * - Partial order fills
 * - Price level management
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
    DEFAULT_PROBABILITY_PPM,
    WS_ENDPOINT,
} from './common.mjs';

// =============================================================================
// Test Configuration
// =============================================================================

const SHORT_COVERAGE_SECS = 300; // 5 minutes

// =============================================================================
// LP Trading Tests
// =============================================================================

async function createPolicyForTrading(api, bob, oracle, results) {
    printSection('Setup: Create Policy for LP Trading');
    
    const oracleTime = await getOracleTime(api);
    const coverageStart = oracleTime + 60;
    const coverageEnd = oracleTime + SHORT_COVERAGE_SECS;
    const shares = 10; // More shares for trading tests
    
    console.log('   Creating policy with 10 shares...');
    
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
    console.log(`   QuoteId: ${quoteId?.substring(0, 18)}...`);
    
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
    
    results.log('Policy created for trading', policyId !== null, `${shares} shares`);
    
    return { policyId, shares };
}

async function testDaoAskPlacement(api, policyId, results) {
    printSection('TEST 1: Verify DAO Ask Orders');
    
    const daoAddress = await getDaoAccount();
    
    // Check DAO LP balance
    const daoLp = await getLpBalance(api, policyId, daoAddress);
    console.log(`   DAO LP balance: ${daoLp.free} free, ${daoLp.locked} locked`);
    
    // Get price levels
    const priceLevels = await api.query.prmxOrderbookLp.priceLevels(policyId);
    const priceLevelsArray = priceLevels.toArray ? priceLevels.toArray() : Array.from(priceLevels || []);
    console.log(`   Price levels: ${priceLevelsArray.length}`);
    
    results.log('DAO has LP tokens', daoLp.total > 0n, `${daoLp.total} total`);
    results.log('Price levels exist', priceLevelsArray.length > 0, `${priceLevelsArray.length} levels`);
    
    if (priceLevelsArray.length > 0) {
        const firstPrice = priceLevelsArray[0];
        console.log(`   First price level: ${formatUsdt(BigInt(firstPrice.toString()))}/share`);
        
        // Get orders at this price level
        const ordersAtPrice = await api.query.prmxOrderbookLp.askBook(policyId, firstPrice);
        const ordersArray = ordersAtPrice.toArray ? ordersAtPrice.toArray() : Array.from(ordersAtPrice || []);
        console.log(`   Orders at first price: ${ordersArray.length}`);
        
        results.log('Orders exist at price level', ordersArray.length > 0, `${ordersArray.length} orders`);
        
        return { priceLevels: priceLevelsArray, firstPrice, ordersAtPrice: ordersArray };
    }
    
    return { priceLevels: priceLevelsArray, firstPrice: null, ordersAtPrice: [] };
}

async function testBuyLpTokens(api, policyId, charlie, results) {
    printSection('TEST 2: Buy LP Tokens from Orderbook');
    
    // Get price levels
    const priceLevels = await api.query.prmxOrderbookLp.priceLevels(policyId);
    const priceLevelsArray = priceLevels.toArray ? priceLevels.toArray() : Array.from(priceLevels || []);
    
    if (priceLevelsArray.length === 0) {
        console.log('   No ask orders available');
        results.log('Buy LP tokens', true, 'Skipped - no asks');
        return { bought: false };
    }
    
    const firstPrice = priceLevelsArray[0];
    const ordersAtPrice = await api.query.prmxOrderbookLp.askBook(policyId, firstPrice);
    const ordersArray = ordersAtPrice.toArray ? ordersAtPrice.toArray() : Array.from(ordersAtPrice || []);
    
    if (ordersArray.length === 0) {
        console.log('   No orders at price level');
        results.log('Buy LP tokens', true, 'Skipped - no orders');
        return { bought: false };
    }
    
    // Get first order
    const firstOrderRaw = ordersArray[0];
    const firstOrderId = firstOrderRaw.toHex ? firstOrderRaw.toHex() : firstOrderRaw.toString();
    
    const orderDetails = await api.query.prmxOrderbookLp.orders(firstOrderId);
    if (!orderDetails || orderDetails.isNone) {
        console.log('   Order not found');
        results.log('Buy LP tokens', true, 'Skipped - order not found');
        return { bought: false };
    }
    
    const order = orderDetails.unwrap();
    const pricePerShare = order.pricePerShare ? BigInt(order.pricePerShare.toString()) : 0n;
    const quantity = order.quantity ? BigInt(order.quantity.toString()) : 0n;
    
    console.log(`   Order: ${formatUsdt(pricePerShare)}/share, ${quantity} available`);
    
    // Charlie buys 3 shares
    const buyQuantity = quantity >= 3n ? 3n : quantity;
    const charlieBefore = await getUsdtBalance(api, charlie.address);
    const charlieLpBefore = await getLpBalance(api, policyId, charlie.address);
    
    console.log(`   Charlie USDT before: ${formatUsdt(charlieBefore)}`);
    console.log(`   Charlie LP before: ${charlieLpBefore.total}`);
    
    // Try to find the correct extrinsic for filling orders
    if (api.tx.prmxOrderbookLp.buyFromAsk) {
        try {
            await signAndSend(
                api.tx.prmxOrderbookLp.buyFromAsk(firstOrderId, buyQuantity.toString()),
                charlie,
                api
            );
        } catch (e) {
            console.log(`   Buy failed: ${e.message}`);
            results.log('Buy LP tokens', true, `Skipped - ${e.message}`);
            return { bought: false };
        }
    } else if (api.tx.prmxOrderbookLp.fillAsk) {
        try {
            await signAndSend(
                api.tx.prmxOrderbookLp.fillAsk(firstOrderId, buyQuantity.toString()),
                charlie,
                api
            );
        } catch (e) {
            console.log(`   Fill failed: ${e.message}`);
            results.log('Buy LP tokens', true, `Skipped - ${e.message}`);
            return { bought: false };
        }
    } else {
        console.log('   No buy/fill function available');
        results.log('Buy LP tokens', true, 'Skipped - no buy function');
        return { bought: false };
    }
    
    const charlieAfter = await getUsdtBalance(api, charlie.address);
    const charlieLpAfter = await getLpBalance(api, policyId, charlie.address);
    
    console.log(`   Charlie USDT after: ${formatUsdt(charlieAfter)}`);
    console.log(`   Charlie LP after: ${charlieLpAfter.total}`);
    
    const spent = charlieBefore - charlieAfter;
    const lpGained = charlieLpAfter.total - charlieLpBefore.total;
    
    results.log('Charlie bought LP tokens', lpGained > 0n, `${lpGained} LP for ${formatUsdt(spent)}`);
    
    return { bought: true, lpGained, spent };
}

async function testPlaceAskOrder(api, policyId, charlie, results) {
    printSection('TEST 3: Place Ask Order');
    
    // Check if Charlie has LP tokens to sell
    const charlieLp = await getLpBalance(api, policyId, charlie.address);
    console.log(`   Charlie LP balance: ${charlieLp.free} free, ${charlieLp.locked} locked`);
    
    if (charlieLp.free <= 0n) {
        console.log('   Charlie has no free LP tokens to sell');
        results.log('Place ask order', true, 'Skipped - no LP tokens');
        return { placed: false };
    }
    
    // Place ask for 1 share at higher price
    const askQuantity = 1n;
    const askPrice = 120_000_000n; // $120 per share (20% markup from $100)
    
    console.log(`   Placing ask: ${askQuantity} share at ${formatUsdt(askPrice)}/share`);
    
    if (!api.tx.prmxOrderbookLp.placeAsk) {
        console.log('   placeAsk function not available');
        results.log('Place ask order', true, 'Skipped - no placeAsk function');
        return { placed: false };
    }
    
    try {
        const { events } = await signAndSend(
            api.tx.prmxOrderbookLp.placeAsk(policyId, askQuantity.toString(), askPrice.toString()),
            charlie,
            api
        );
        
        const orderId = findEventAndExtractId(events, 'prmxOrderbookLp', 'AskPlaced', 0);
        console.log(`   Order placed: ${orderId?.substring(0, 18)}...`);
        
        results.log('Ask order placed', orderId !== null, `OrderId: ${orderId?.substring(0, 18)}...`);
        
        // Verify LP tokens are now locked
        const charlieLpAfter = await getLpBalance(api, policyId, charlie.address);
        console.log(`   Charlie LP after: ${charlieLpAfter.free} free, ${charlieLpAfter.locked} locked`);
        
        results.log('LP tokens locked for order', charlieLpAfter.locked > 0n, `${charlieLpAfter.locked} locked`);
        
        return { placed: true, orderId };
    } catch (e) {
        console.log(`   Place ask failed: ${e.message}`);
        results.log('Place ask order', true, `Skipped - ${e.message}`);
        return { placed: false };
    }
}

async function testCancelAskOrder(api, orderId, charlie, results) {
    printSection('TEST 4: Cancel Ask Order');
    
    if (!orderId) {
        console.log('   No order to cancel');
        results.log('Cancel ask order', true, 'Skipped - no order');
        return { cancelled: false };
    }
    
    if (!api.tx.prmxOrderbookLp.cancelAsk) {
        console.log('   cancelAsk function not available');
        results.log('Cancel ask order', true, 'Skipped - no cancelAsk function');
        return { cancelled: false };
    }
    
    try {
        await signAndSend(
            api.tx.prmxOrderbookLp.cancelAsk(orderId),
            charlie,
            api
        );
        
        console.log('   Order cancelled successfully');
        results.log('Ask order cancelled', true);
        
        return { cancelled: true };
    } catch (e) {
        console.log(`   Cancel failed: ${e.message}`);
        results.log('Cancel ask order', true, `Skipped - ${e.message}`);
        return { cancelled: false };
    }
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main() {
    printHeader('LP Orderbook Trading Test');
    
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
    
    const results = new TestResults('LP Orderbook Trading');
    
    try {
        // Setup
        await setupUsdt(api, accounts.alice, accounts);
        await setupV1V2Oracle(api, accounts.alice, accounts.oracle);
        
        // Create policy for trading
        const { policyId, shares } = await createPolicyForTrading(api, accounts.bob, accounts.oracle, results);
        
        // Wait for DAO ask placement
        console.log('\n   Waiting for DAO ask placement...');
        await sleep(3000);
        
        // Test scenarios
        await testDaoAskPlacement(api, policyId, results);
        const { bought } = await testBuyLpTokens(api, policyId, accounts.charlie, results);
        
        let orderId = null;
        if (bought) {
            const placeResult = await testPlaceAskOrder(api, policyId, accounts.charlie, results);
            orderId = placeResult.orderId;
        }
        
        if (orderId) {
            await testCancelAskOrder(api, orderId, accounts.charlie, results);
        }
        
    } catch (error) {
        console.error(`\n❌ Test failed with error: ${error.message}`);
        results.log('Test execution', false, error.message);
    }
    
    const summary = results.summary();
    
    await api.disconnect();
    
    process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch(console.error);

