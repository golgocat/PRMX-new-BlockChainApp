#!/usr/bin/env node
/**
 * PRMX Functional Test - LP Partial Order Fill
 * 
 * This test verifies that LP orders can be partially filled,
 * leaving the remaining amount available for future trades.
 * 
 * Flow:
 * 1. Create a policy with multiple LP tokens
 * 2. DAO's LP tokens are auto-listed on orderbook
 * 3. Buyer purchases only part of the available LP tokens
 * 4. Verify order is partially filled with remaining available
 * 
 * Usage: node test-lp-partial-fill.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import {
    WS_ENDPOINT, MARKET_ID,
    formatUsdt, getChainTime, getLpBalance, setupOracle,
    submitRainfall, requestQuote, submitQuote, createPolicy,
    getDaoAccount,
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
    printHeader('PRMX FUNCTIONAL TEST - LP PARTIAL ORDER FILL');
    
    console.log('\n📋 This test verifies partial order fills on the LP orderbook.');
    console.log('   Buyers can purchase part of an order, leaving the rest available.');

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
    // CREATE POLICY WITH MULTIPLE LP TOKENS
    // =========================================================================
    printSection('STEP 1: CREATE POLICY');
    
    await setupOracle(api, alice, MARKET_ID);
    await submitRainfall(api, alice, MARKET_ID, Math.floor(chainNow), 50);
    console.log('✅ Oracle configured');

    const coverageStart = Math.floor(chainNow + 10);
    const coverageEnd = coverageStart + 300; // 5 minutes
    const shares = 5; // 5 LP tokens = 500 USDT pool
    
    const quoteId = await requestQuote(api, bob, MARKET_ID, coverageStart, coverageEnd, 14_599_500, 120_984_200, shares);
    const premium = await submitQuote(api, alice, quoteId);
    const policyId = await createPolicy(api, bob, quoteId);
    
    console.log(`\n✅ Policy created! ID: ${policyId}`);
    console.log(`   Total LP tokens: ${shares}`);

    // =========================================================================
    // INITIAL ORDERBOOK STATE
    // =========================================================================
    printSection('STEP 2: INITIAL ORDERBOOK STATE');
    
    const initialOrders = await getOrderbookOrders(api, policyId);
    
    console.log('\n   📖 Initial Orderbook:');
    for (const order of initialOrders) {
        console.log(`      Order #${order.orderId}:`);
        console.log(`         Original: ${order.original.toString()} LP`);
        console.log(`         Remaining: ${order.remaining.toString()} LP`);
        console.log(`         Price: ${formatUsdt(order.price)} each`);
    }

    const totalLpAvailable = initialOrders.reduce((sum, o) => sum + o.remaining, 0n);
    console.log(`\n   Total LP available: ${totalLpAvailable.toString()}`);

    // =========================================================================
    // CHARLIE BUYS 2 LP TOKENS (PARTIAL FILL)
    // =========================================================================
    printSection('STEP 3: CHARLIE BUYS 2 LP (PARTIAL FILL)');
    
    const charlieBuyAmount = 2n;
    console.log(`\n   Charlie buying ${charlieBuyAmount.toString()} of ${totalLpAvailable.toString()} available LP tokens`);

    const buyTx1 = api.tx.prmxOrderbookLp.buyLp(policyId, 100_000_000n, charlieBuyAmount);
    
    await new Promise((resolve) => {
        buyTx1.signAndSend(charlie, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxOrderbookLp' && event.method === 'TradeExecuted') {
                        const [, buyer, , amount, price] = event.data;
                        console.log(`   ✅ Trade executed: ${amount.toString()} LP @ ${formatUsdt(BigInt(price.toString()))}`);
                    }
                }
                resolve();
            }
        });
    });

    const charlieLp = await getLpBalance(api, policyId, charlie.address);
    console.log(`\n   Charlie LP tokens: ${charlieLp.free.toString()}`);

    // Check orderbook after partial fill
    const ordersAfterCharlie = await getOrderbookOrders(api, policyId);
    
    console.log('\n   📖 Orderbook After Charlie\'s Purchase:');
    for (const order of ordersAfterCharlie) {
        console.log(`      Order #${order.orderId}:`);
        console.log(`         Original: ${order.original.toString()} LP`);
        console.log(`         Remaining: ${order.remaining.toString()} LP`);
        console.log(`         Filled: ${(order.original - order.remaining).toString()} LP`);
    }

    const lpRemainingAfterCharlie = ordersAfterCharlie.reduce((sum, o) => sum + o.remaining, 0n);
    console.log(`\n   LP still available: ${lpRemainingAfterCharlie.toString()}`);

    // =========================================================================
    // DAVE BUYS 1 MORE LP TOKEN
    // =========================================================================
    printSection('STEP 4: DAVE BUYS 1 MORE LP');
    
    const daveBuyAmount = 1n;
    console.log(`\n   Dave buying ${daveBuyAmount.toString()} LP token`);

    const buyTx2 = api.tx.prmxOrderbookLp.buyLp(policyId, 100_000_000n, daveBuyAmount);
    
    await new Promise((resolve) => {
        buyTx2.signAndSend(dave, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxOrderbookLp' && event.method === 'TradeExecuted') {
                        const [, buyer, , amount, price] = event.data;
                        console.log(`   ✅ Trade executed: ${amount.toString()} LP @ ${formatUsdt(BigInt(price.toString()))}`);
                    }
                }
                resolve();
            }
        });
    });

    const daveLp = await getLpBalance(api, policyId, dave.address);
    console.log(`\n   Dave LP tokens: ${daveLp.free.toString()}`);

    // =========================================================================
    // FINAL ORDERBOOK STATE
    // =========================================================================
    printSection('STEP 5: FINAL ORDERBOOK STATE');
    
    const finalOrders = await getOrderbookOrders(api, policyId);
    
    console.log('\n   📖 Final Orderbook:');
    for (const order of finalOrders) {
        console.log(`      Order #${order.orderId}:`);
        console.log(`         Original: ${order.original.toString()} LP`);
        console.log(`         Remaining: ${order.remaining.toString()} LP`);
        console.log(`         Filled: ${(order.original - order.remaining).toString()} LP`);
    }

    const finalLpRemaining = finalOrders.reduce((sum, o) => sum + o.remaining, 0n);
    console.log(`\n   LP still available: ${finalLpRemaining.toString()}`);

    // =========================================================================
    // LP DISTRIBUTION SUMMARY
    // =========================================================================
    printSection('STEP 6: LP DISTRIBUTION SUMMARY');
    
    const daoLp = await getLpBalance(api, policyId, daoAccount);
    const finalCharlieLp = await getLpBalance(api, policyId, charlie.address);
    const finalDaveLp = await getLpBalance(api, policyId, dave.address);
    
    const totalLp = BigInt((await api.query.prmxHoldings.totalLpShares(policyId)).toString());
    
    console.log('\n   🎫 LP Token Distribution:');
    console.log(`      DAO: ${daoLp.free.toString()} free + ${daoLp.locked.toString()} locked`);
    console.log(`      Charlie: ${finalCharlieLp.free.toString()} free + ${finalCharlieLp.locked.toString()} locked`);
    console.log(`      Dave: ${finalDaveLp.free.toString()} free + ${finalDaveLp.locked.toString()} locked`);
    console.log(`      ─────────────────────`);
    console.log(`      Total: ${totalLp.toString()} LP tokens`);

    // =========================================================================
    // TEST RESULT
    // =========================================================================
    printHeader('TEST RESULT');
    
    const partialFillWorked = charlieLp.free === charlieBuyAmount;
    const remainingCorrect = finalLpRemaining === (totalLpAvailable - charlieBuyAmount - daveBuyAmount);
    const daveGotTokens = daveLp.free === daveBuyAmount;
    
    if (partialFillWorked && remainingCorrect && daveGotTokens) {
        console.log('\n   ✅ TEST PASSED: Partial order fills work correctly!');
        console.log(`   • Original order: ${totalLpAvailable.toString()} LP tokens`);
        console.log(`   • Charlie bought: ${charlieBuyAmount.toString()} LP tokens`);
        console.log(`   • Dave bought: ${daveBuyAmount.toString()} LP token`);
        console.log(`   • Remaining on orderbook: ${finalLpRemaining.toString()} LP tokens`);
        console.log('   • Orders maintain correct remaining amounts after partial fills');
    } else {
        console.log('\n   ❌ TEST FAILED: Partial fill issue');
        console.log(`   • Charlie got expected: ${partialFillWorked}`);
        console.log(`   • Remaining correct: ${remainingCorrect}`);
        console.log(`   • Dave got tokens: ${daveGotTokens}`);
    }

    await api.disconnect();
}

main().catch(console.error);
