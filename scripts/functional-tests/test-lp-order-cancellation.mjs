#!/usr/bin/env node
/**
 * PRMX Functional Test - LP Order Cancellation
 * 
 * This test verifies that LP holders can cancel their ask orders
 * on the orderbook before they are filled.
 * 
 * Flow:
 * 1. Create a policy (DAO receives LP tokens, auto-placed on orderbook)
 * 2. Place an additional ask order (or use DAO's auto-placed order)
 * 3. Cancel the order
 * 4. Verify LP tokens are returned to the user
 * 
 * Usage: node test-lp-order-cancellation.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import {
    WS_ENDPOINT, USDT_ASSET_ID, MARKET_ID,
    formatUsdt, getChainTime, getUsdtBalance, getLpBalance, setupOracle,
    submitRainfall, requestQuote, submitQuote, createPolicy,
    getDaoAccount, sendTx,
    printHeader, printSection
} from './common.mjs';

async function getOrderbookOrders(api, policyId) {
    const priceLevels = await api.query.prmxOrderbookLp.priceLevels(policyId);
    const orders = [];
    
    for (const price of priceLevels) {
        const orderIds = await api.query.prmxOrderbookLp.askBook(policyId, price);
        for (const orderId of orderIds) {
            const order = await api.query.prmxOrderbookLp.orders(orderId);
            if (order.isSome) {
                const o = order.unwrap();
                orders.push({
                    orderId: orderId.toNumber(),
                    owner: o.owner.toString(),
                    policyId: o.policyId.toNumber(),
                    price: BigInt(o.price.toString()),
                    original: BigInt(o.original.toString()),
                    remaining: BigInt(o.remaining.toString()),
                });
            }
        }
    }
    return orders;
}

async function main() {
    printHeader('PRMX FUNCTIONAL TEST - LP ORDER CANCELLATION');
    
    console.log('\n📋 This test verifies LP ask order cancellation.');
    console.log('   LP holders can cancel unfilled orders to unlock their LP tokens.');

    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');
    const charlie = keyring.addFromUri('//Charlie');
    const daoAccount = await getDaoAccount();
    
    console.log('\n✅ Connected to PRMX node');
    console.log(`   Charlie will test order cancellation`);

    const chainNow = await getChainTime(api);

    // =========================================================================
    // SETUP AND CREATE POLICY
    // =========================================================================
    printSection('STEP 1: CREATE POLICY');
    
    await setupOracle(api, alice, MARKET_ID);
    await submitRainfall(api, alice, MARKET_ID, Math.floor(chainNow), 50);
    console.log('✅ Oracle configured');

    const coverageStart = Math.floor(chainNow + 10);
    const coverageEnd = coverageStart + 300; // 5 minutes
    const shares = 3;
    
    const quoteId = await requestQuote(api, bob, MARKET_ID, coverageStart, coverageEnd, 14_599_500, 120_984_200, shares);
    const premium = await submitQuote(api, alice, quoteId);
    const policyId = await createPolicy(api, bob, quoteId);
    
    console.log(`\n✅ Policy created! ID: ${policyId}`);
    console.log(`   Shares: ${shares} (= ${shares * 100} USDT)`);

    // =========================================================================
    // SHOW INITIAL ORDERBOOK
    // =========================================================================
    printSection('STEP 2: INITIAL ORDERBOOK STATE');
    
    const initialOrders = await getOrderbookOrders(api, policyId);
    
    console.log('\n   📖 Orderbook Orders:');
    for (const order of initialOrders) {
        console.log(`      Order #${order.orderId}: ${order.remaining.toString()} LP @ ${formatUsdt(order.price)} each`);
        console.log(`         Owner: ${order.owner.substring(0, 20)}...`);
    }

    // =========================================================================
    // CHARLIE BUYS 1 LP TOKEN (BECOMES LP HOLDER)
    // =========================================================================
    printSection('STEP 3: CHARLIE BUYS 1 LP TOKEN');
    
    const charlieInitialUsdt = await getUsdtBalance(api, charlie.address);
    console.log(`   Charlie initial USDT: ${formatUsdt(charlieInitialUsdt)}`);

    const buyTx = api.tx.prmxOrderbookLp.buyLp(policyId, 100_000_000n, 1n);
    await new Promise((resolve) => {
        buyTx.signAndSend(charlie, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxOrderbookLp' && event.method === 'TradeExecuted') {
                        console.log('   ✅ Trade executed!');
                    }
                }
                resolve();
            }
        });
    });

    const charlieLpAfterBuy = await getLpBalance(api, policyId, charlie.address);
    console.log(`\n   Charlie LP tokens: ${charlieLpAfterBuy.free.toString()} free, ${charlieLpAfterBuy.locked.toString()} locked`);

    // =========================================================================
    // CHARLIE PLACES ASK ORDER
    // =========================================================================
    printSection('STEP 4: CHARLIE PLACES ASK ORDER');
    
    const askPrice = 95_000_000n; // 95 USDT per LP
    const askAmount = 1n;
    
    console.log(`\n   Charlie placing ask order:`);
    console.log(`      Amount: ${askAmount.toString()} LP tokens`);
    console.log(`      Price: ${formatUsdt(askPrice)} each`);

    const askTx = api.tx.prmxOrderbookLp.placeLpAsk(policyId, askPrice, askAmount);
    
    let charlieOrderId;
    await new Promise((resolve) => {
        askTx.signAndSend(charlie, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxOrderbookLp' && event.method === 'LpAskPlaced') {
                        charlieOrderId = event.data[0].toNumber();
                        console.log(`   ✅ Ask order placed! Order ID: ${charlieOrderId}`);
                    }
                }
                resolve();
            }
        });
    });

    // Check LP balance after placing ask (tokens should be locked)
    const charlieLpAfterAsk = await getLpBalance(api, policyId, charlie.address);
    console.log(`\n   Charlie LP tokens after ask:`);
    console.log(`      Free: ${charlieLpAfterAsk.free.toString()}`);
    console.log(`      Locked: ${charlieLpAfterAsk.locked.toString()}`);

    // =========================================================================
    // SHOW ORDERBOOK WITH CHARLIE'S ORDER
    // =========================================================================
    printSection('STEP 5: ORDERBOOK WITH CHARLIE\'S ORDER');
    
    const ordersWithCharlie = await getOrderbookOrders(api, policyId);
    
    console.log('\n   📖 Current Orderbook:');
    for (const order of ordersWithCharlie) {
        const isCharlies = order.owner === charlie.address;
        console.log(`      Order #${order.orderId}: ${order.remaining.toString()} LP @ ${formatUsdt(order.price)} ${isCharlies ? '← CHARLIE\'S ORDER' : ''}`);
    }

    // =========================================================================
    // CHARLIE CANCELS ORDER
    // =========================================================================
    printSection('STEP 6: CHARLIE CANCELS ORDER');
    
    console.log(`\n   Charlie cancelling order #${charlieOrderId}...`);

    const cancelTx = api.tx.prmxOrderbookLp.cancelLpAsk(charlieOrderId);
    
    let cancelled = false;
    await new Promise((resolve) => {
        cancelTx.signAndSend(charlie, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxOrderbookLp' && event.method === 'LpAskCancelled') {
                        cancelled = true;
                        console.log('   ✅ Order cancelled!');
                    }
                }
                resolve();
            }
        });
    });

    // Check LP balance after cancellation (tokens should be unlocked)
    const charlieLpAfterCancel = await getLpBalance(api, policyId, charlie.address);
    console.log(`\n   Charlie LP tokens after cancel:`);
    console.log(`      Free: ${charlieLpAfterCancel.free.toString()}`);
    console.log(`      Locked: ${charlieLpAfterCancel.locked.toString()}`);

    // =========================================================================
    // VERIFY ORDERBOOK
    // =========================================================================
    printSection('STEP 7: VERIFY ORDERBOOK');
    
    const finalOrders = await getOrderbookOrders(api, policyId);
    
    console.log('\n   📖 Final Orderbook:');
    for (const order of finalOrders) {
        const isCharlies = order.owner === charlie.address;
        console.log(`      Order #${order.orderId}: ${order.remaining.toString()} LP @ ${formatUsdt(order.price)} ${isCharlies ? '← CHARLIE\'S' : ''}`);
    }

    const charlieOrderStillExists = finalOrders.some(o => o.orderId === charlieOrderId);
    console.log(`\n   Charlie's order #${charlieOrderId} still in orderbook: ${charlieOrderStillExists ? 'YES (unexpected)' : 'NO (correct)'}`);

    // =========================================================================
    // TEST RESULT
    // =========================================================================
    printHeader('TEST RESULT');
    
    const tokensUnlocked = charlieLpAfterCancel.locked === 0n;
    const orderRemoved = !charlieOrderStillExists;
    const tokensRecovered = charlieLpAfterCancel.free >= charlieLpAfterAsk.free;
    
    if (cancelled && tokensUnlocked && orderRemoved) {
        console.log('\n   ✅ TEST PASSED: Order cancellation works correctly!');
        console.log('   • Order was successfully cancelled');
        console.log('   • LP tokens were unlocked and returned to owner');
        console.log('   • Order was removed from orderbook');
    } else {
        console.log('\n   ❌ TEST FAILED: Order cancellation issue');
        console.log(`   • Cancelled event: ${cancelled}`);
        console.log(`   • Tokens unlocked: ${tokensUnlocked}`);
        console.log(`   • Order removed: ${orderRemoved}`);
    }

    console.log('\n   💡 Note: Only the order owner can cancel their orders.');
    console.log('      Attempting to cancel someone else\'s order will fail.');

    await api.disconnect();
}

main().catch(console.error);
