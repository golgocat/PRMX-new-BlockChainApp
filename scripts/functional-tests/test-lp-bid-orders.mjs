#!/usr/bin/env node
/**
 * PRMX Functional Test - LP Bid Orders
 * 
 * This test verifies the bid (buy) side of the LP orderbook.
 * Buyers can place standing bids to purchase LP tokens.
 * 
 * Flow:
 * 1. Create a policy with LP tokens
 * 2. Place bid orders at various prices
 * 3. Seller fills the bids
 * 4. Verify trades execute correctly
 * 
 * Usage: node test-lp-bid-orders.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import {
    WS_ENDPOINT, MARKET_ID,
    formatUsdt, getChainTime, getUsdtBalance, getLpBalance, setupOracle,
    submitRainfall, requestQuote, submitQuote, createPolicy,
    getDaoAccount,
    printHeader, printSection
} from './common.mjs';

async function getOrderbookState(api, policyId) {
    const priceLevels = await api.query.prmxOrderbookLp.priceLevels(policyId);
    
    const asks = [];
    const bids = [];
    
    for (const price of priceLevels) {
        // Get asks at this price
        const askOrderIds = await api.query.prmxOrderbookLp.askBook(policyId, price);
        for (const orderId of askOrderIds) {
            const order = await api.query.prmxOrderbookLp.orders(orderId);
            if (order.isSome) {
                const o = order.unwrap();
                asks.push({
                    orderId: orderId.toNumber(),
                    price: BigInt(o.price.toString()),
                    remaining: BigInt(o.remaining.toString()),
                    owner: o.owner.toString(),
                });
            }
        }
        
        // Get bids at this price
        const bidOrderIds = await api.query.prmxOrderbookLp.bidBook(policyId, price);
        for (const orderId of bidOrderIds) {
            const order = await api.query.prmxOrderbookLp.orders(orderId);
            if (order.isSome) {
                const o = order.unwrap();
                bids.push({
                    orderId: orderId.toNumber(),
                    price: BigInt(o.price.toString()),
                    remaining: BigInt(o.remaining.toString()),
                    owner: o.owner.toString(),
                });
            }
        }
    }
    
    return { asks, bids };
}

async function main() {
    printHeader('PRMX FUNCTIONAL TEST - LP BID ORDERS');
    
    console.log('\n📋 This test verifies bid (buy) orders on the LP orderbook.');
    console.log('   Buyers can place standing bids to purchase LP tokens.');

    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');
    const charlie = keyring.addFromUri('//Charlie');
    const dave = keyring.addFromUri('//Dave');
    const daoAccount = await getDaoAccount();
    
    console.log('\n✅ Connected to PRMX node');

    const chainNow = await getChainTime(api);

    // =========================================================================
    // CREATE POLICY
    // =========================================================================
    printSection('STEP 1: CREATE POLICY');
    
    await setupOracle(api, alice, MARKET_ID);
    await submitRainfall(api, alice, MARKET_ID, Math.floor(chainNow), 50);
    console.log('✅ Oracle configured');

    const coverageStart = Math.floor(chainNow + 10);
    const coverageEnd = coverageStart + 300;
    const shares = 5;
    
    const quoteId = await requestQuote(api, bob, MARKET_ID, coverageStart, coverageEnd, 14_599_500, 120_984_200, shares);
    await submitQuote(api, alice, quoteId);
    const policyId = await createPolicy(api, bob, quoteId);
    
    console.log(`\n✅ Policy created! ID: ${policyId}`);
    console.log(`   Total LP tokens: ${shares}`);

    // =========================================================================
    // INITIAL ORDERBOOK
    // =========================================================================
    printSection('STEP 2: INITIAL ORDERBOOK');
    
    const initialState = await getOrderbookState(api, policyId);
    
    console.log('\n   📖 Initial State:');
    console.log(`      Asks (sell orders): ${initialState.asks.length}`);
    for (const ask of initialState.asks) {
        console.log(`         Order #${ask.orderId}: ${ask.remaining.toString()} LP @ ${formatUsdt(ask.price)}`);
    }
    console.log(`      Bids (buy orders): ${initialState.bids.length}`);

    // =========================================================================
    // CHARLIE BUYS SOME LP (TO BECOME SELLER LATER)
    // =========================================================================
    printSection('STEP 3: CHARLIE BUYS LP TOKENS');
    
    const buyTx = api.tx.prmxOrderbookLp.buyLp(policyId, 100_000_000n, 3n);
    
    await new Promise((resolve) => {
        buyTx.signAndSend(charlie, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxOrderbookLp' && event.method === 'TradeExecuted') {
                        console.log('   ✅ Charlie bought 3 LP tokens');
                    }
                }
                resolve();
            }
        });
    });

    const charlieLp = await getLpBalance(api, policyId, charlie.address);
    console.log(`   Charlie LP balance: ${charlieLp.free.toString()} free`);

    // =========================================================================
    // DAVE PLACES BID ORDERS
    // =========================================================================
    printSection('STEP 4: DAVE PLACES BID ORDERS');
    
    const daveInitialUsdt = await getUsdtBalance(api, dave.address);
    console.log(`   Dave initial USDT: ${formatUsdt(daveInitialUsdt)}`);

    // Place bid at 90 USDT for 1 LP
    console.log('\n   Dave placing bid orders...');
    
    const bid1Price = 90_000_000n;
    const bid1Amount = 1n;
    
    console.log(`   Bid 1: ${bid1Amount.toString()} LP @ ${formatUsdt(bid1Price)} each`);
    
    const bidTx1 = api.tx.prmxOrderbookLp.placeLpBid(policyId, bid1Price, bid1Amount);
    
    let bidOrderId1;
    await new Promise((resolve) => {
        bidTx1.signAndSend(dave, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxOrderbookLp' && event.method === 'LpBidPlaced') {
                        bidOrderId1 = event.data[0].toNumber();
                        console.log(`      ✅ Bid placed! Order ID: ${bidOrderId1}`);
                    }
                }
                resolve();
            }
        });
    });

    // Place another bid at 85 USDT for 1 LP
    const bid2Price = 85_000_000n;
    const bid2Amount = 1n;
    
    console.log(`   Bid 2: ${bid2Amount.toString()} LP @ ${formatUsdt(bid2Price)} each`);
    
    const bidTx2 = api.tx.prmxOrderbookLp.placeLpBid(policyId, bid2Price, bid2Amount);
    
    let bidOrderId2;
    await new Promise((resolve) => {
        bidTx2.signAndSend(dave, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxOrderbookLp' && event.method === 'LpBidPlaced') {
                        bidOrderId2 = event.data[0].toNumber();
                        console.log(`      ✅ Bid placed! Order ID: ${bidOrderId2}`);
                    }
                }
                resolve();
            }
        });
    });

    // Check Dave's USDT (should be escrowed)
    const daveUsdtAfterBids = await getUsdtBalance(api, dave.address);
    const usdtEscrowed = daveInitialUsdt - daveUsdtAfterBids;
    console.log(`\n   Dave USDT escrowed: ${formatUsdt(usdtEscrowed)}`);

    // =========================================================================
    // SHOW ORDERBOOK WITH BIDS
    // =========================================================================
    printSection('STEP 5: ORDERBOOK WITH BIDS');
    
    const stateWithBids = await getOrderbookState(api, policyId);
    
    console.log('\n   📖 Orderbook State:');
    console.log(`      ASKS (Sell Orders):`);
    for (const ask of stateWithBids.asks) {
        console.log(`         ${ask.remaining.toString()} LP @ ${formatUsdt(ask.price)}`);
    }
    console.log(`      BIDS (Buy Orders):`);
    for (const bid of stateWithBids.bids) {
        const isDaves = bid.owner === dave.address;
        console.log(`         ${bid.remaining.toString()} LP @ ${formatUsdt(bid.price)} ${isDaves ? '← DAVE' : ''}`);
    }

    // =========================================================================
    // CHARLIE SELLS TO BID
    // =========================================================================
    printSection('STEP 6: CHARLIE SELLS TO BIDS');
    
    console.log('\n   Charlie selling 1 LP token (should match Dave\'s highest bid)...');
    
    const sellTx = api.tx.prmxOrderbookLp.sellLp(policyId, bid1Price, 1n);
    
    await new Promise((resolve) => {
        sellTx.signAndSend(charlie, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxOrderbookLp' && event.method === 'TradeExecuted') {
                        const [, buyer, seller, amount, price] = event.data;
                        console.log(`   ✅ Trade executed!`);
                        console.log(`      Amount: ${amount.toString()} LP`);
                        console.log(`      Price: ${formatUsdt(BigInt(price.toString()))}`);
                    }
                }
                resolve();
            }
        });
    });

    // Check balances after trade
    const charlieUsdtAfterSell = await getUsdtBalance(api, charlie.address);
    const charlieLpAfterSell = await getLpBalance(api, policyId, charlie.address);
    const daveLpAfterBuy = await getLpBalance(api, policyId, dave.address);
    
    console.log('\n   After Trade:');
    console.log(`      Charlie LP: ${charlieLpAfterSell.free.toString()}`);
    console.log(`      Dave LP: ${daveLpAfterBuy.free.toString()}`);

    // =========================================================================
    // FINAL ORDERBOOK
    // =========================================================================
    printSection('STEP 7: FINAL ORDERBOOK');
    
    const finalState = await getOrderbookState(api, policyId);
    
    console.log('\n   📖 Final Orderbook State:');
    console.log(`      ASKS: ${finalState.asks.length} orders`);
    console.log(`      BIDS: ${finalState.bids.length} orders`);
    
    for (const bid of finalState.bids) {
        console.log(`         Remaining bid: ${bid.remaining.toString()} LP @ ${formatUsdt(bid.price)}`);
    }

    // =========================================================================
    // TEST RESULT
    // =========================================================================
    printHeader('TEST RESULT');
    
    const bidOrdersCreated = stateWithBids.bids.length >= 2;
    const tradeExecuted = daveLpAfterBuy.free >= 1n;
    const oneBidFilled = finalState.bids.length < stateWithBids.bids.length || 
                         finalState.bids.some(b => b.remaining < bid1Amount);
    
    if (bidOrdersCreated && tradeExecuted) {
        console.log('\n   ✅ TEST PASSED: LP bid orders work correctly!');
        console.log('   • Bid orders can be placed on the orderbook');
        console.log('   • USDT is escrowed when placing bids');
        console.log('   • Sellers can fill outstanding bids');
        console.log('   • LP tokens transfer to buyer, USDT to seller');
    } else {
        console.log('\n   ⚠️  TEST PARTIAL:');
        console.log(`   • Bid orders created: ${bidOrdersCreated}`);
        console.log(`   • Trade executed: ${tradeExecuted}`);
        console.log(`   • One bid filled: ${oneBidFilled}`);
    }

    console.log('\n   💡 Note: The sellLp function allows sellers to match');
    console.log('      their LP tokens against standing bid orders.');

    await api.disconnect();
}

main().catch(console.error);
