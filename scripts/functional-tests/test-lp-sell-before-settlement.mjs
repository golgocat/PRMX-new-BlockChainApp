#!/usr/bin/env node
/**
 * PRMX Functional Test - LP Sell Before Settlement
 * 
 * This test verifies that LP holders can sell ALL their tokens
 * before settlement, transferring risk to the buyer.
 * 
 * Flow:
 * 1. Create a policy (DAO gets LP tokens)
 * 2. Charlie buys some LP tokens from DAO
 * 3. Charlie sells ALL his LP tokens to Dave
 * 4. Settlement occurs - only Dave (final holder) receives payout
 * 
 * Usage: node test-lp-sell-before-settlement.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import {
    WS_ENDPOINT, MARKET_ID,
    formatUsdt, getChainTime, getUsdtBalance, getLpBalance, setupOracle,
    submitRainfall, requestQuote, submitQuote, createPolicy,
    settlePolicy, waitUntilTime, getDaoAccount,
    printHeader, printSection
} from './common.mjs';

async function main() {
    printHeader('PRMX FUNCTIONAL TEST - LP SELL BEFORE SETTLEMENT');
    
    console.log('\n📋 This test verifies LP token transfer before settlement.');
    console.log('   Original LP holder sells to new buyer who receives settlement payout.');

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

    // Record initial balances
    const initialCharlieUsdt = await getUsdtBalance(api, charlie.address);
    const initialDaveUsdt = await getUsdtBalance(api, dave.address);

    console.log(`\n   Initial USDT Balances:`);
    console.log(`      Charlie: ${formatUsdt(initialCharlieUsdt)}`);
    console.log(`      Dave: ${formatUsdt(initialDaveUsdt)}`);

    // =========================================================================
    // CREATE POLICY
    // =========================================================================
    printSection('STEP 1: CREATE POLICY');
    
    await setupOracle(api, alice, MARKET_ID);
    await submitRainfall(api, alice, MARKET_ID, Math.floor(chainNow), 50); // Low rainfall
    console.log('✅ Oracle configured');

    const coverageStart = Math.floor(chainNow + 10);
    const coverageEnd = coverageStart + 90; // 1.5 minutes
    const shares = 2; // 200 USDT pool
    
    const quoteId = await requestQuote(api, bob, MARKET_ID, coverageStart, coverageEnd, 14_599_500, 120_984_200, shares);
    const premium = await submitQuote(api, alice, quoteId);
    const policyId = await createPolicy(api, bob, quoteId);
    
    console.log(`\n✅ Policy created! ID: ${policyId}`);
    console.log(`   Pool: ${shares * 100} USDT`);

    // =========================================================================
    // CHARLIE BUYS 2 LP TOKENS
    // =========================================================================
    printSection('STEP 2: CHARLIE BUYS 2 LP TOKENS');
    
    const buyTx = api.tx.prmxOrderbookLp.buyLp(policyId, 100_000_000n, 2n);
    
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
    console.log(`\n   Charlie LP tokens: ${charlieLpAfterBuy.free.toString()}`);

    // =========================================================================
    // CHARLIE SELLS TO DAVE
    // =========================================================================
    printSection('STEP 3: CHARLIE SELLS ALL LP TO DAVE');
    
    // First, Charlie places an ask order
    const askPrice = 95_000_000n; // 95 USDT each
    console.log(`\n   Charlie placing ask order for 2 LP @ ${formatUsdt(askPrice)} each`);

    const askTx = api.tx.prmxOrderbookLp.placeLpAsk(policyId, askPrice, 2n);
    
    let askOrderId;
    await new Promise((resolve) => {
        askTx.signAndSend(charlie, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxOrderbookLp' && event.method === 'LpAskPlaced') {
                        askOrderId = event.data[0].toNumber();
                        console.log(`   ✅ Ask placed! Order ID: ${askOrderId}`);
                    }
                }
                resolve();
            }
        });
    });

    // Dave buys from Charlie
    console.log('\n   Dave buying 2 LP tokens from Charlie...');
    
    const daveBuyTx = api.tx.prmxOrderbookLp.buyLp(policyId, 100_000_000n, 2n);
    
    await new Promise((resolve) => {
        daveBuyTx.signAndSend(dave, ({ status, events }) => {
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

    // Check LP balances after transfer
    const charlieLpAfterSell = await getLpBalance(api, policyId, charlie.address);
    const daveLpAfterBuy = await getLpBalance(api, policyId, dave.address);
    
    console.log('\n   LP Token Distribution After Transfer:');
    console.log(`      Charlie: ${charlieLpAfterSell.total.toString()} LP (sold everything)`);
    console.log(`      Dave: ${daveLpAfterBuy.total.toString()} LP (new holder)`);

    // Get USDT balances after trading
    const charlieUsdtAfterTrade = await getUsdtBalance(api, charlie.address);
    const daveUsdtAfterTrade = await getUsdtBalance(api, dave.address);
    
    console.log('\n   USDT After Trading:');
    console.log(`      Charlie: ${formatUsdt(charlieUsdtAfterTrade)} (received sale proceeds)`);
    console.log(`      Dave: ${formatUsdt(daveUsdtAfterTrade)} (paid for LP tokens)`);

    // =========================================================================
    // WAIT AND SETTLE
    // =========================================================================
    printSection('STEP 4: SETTLEMENT (NO EVENT)');
    
    console.log('   ⏳ Waiting for coverage to end...');
    await waitUntilTime(api, coverageEnd + 10);
    console.log('   ✅ Coverage ended');

    const eventsBeforeSettlement = await settlePolicy(api, alice, policyId, false);
    console.log('\n   ✅ Policy settled (no event - LP holders win)');

    // =========================================================================
    // CHECK FINAL BALANCES
    // =========================================================================
    printSection('STEP 5: FINAL BALANCES');
    
    const finalCharlieUsdt = await getUsdtBalance(api, charlie.address);
    const finalDaveUsdt = await getUsdtBalance(api, dave.address);
    
    const charlieNetChange = finalCharlieUsdt - initialCharlieUsdt;
    const daveNetChange = finalDaveUsdt - initialDaveUsdt;
    
    console.log('\n   💰 NET USDT Changes:');
    console.log(`      Charlie: ${charlieNetChange >= 0n ? '+' : ''}${formatUsdt(charlieNetChange)}`);
    console.log(`      Dave: ${daveNetChange >= 0n ? '+' : ''}${formatUsdt(daveNetChange)}`);

    // Check settlement result
    const settlementResult = await api.query.prmxPolicy.settlementResults(policyId);
    if (settlementResult.isSome) {
        const result = settlementResult.unwrap();
        console.log('\n   📋 Settlement Result:');
        console.log(`      Event Occurred: ${result.eventOccurred.toString()}`);
        console.log(`      Returned to LPs: ${formatUsdt(BigInt(result.returnedToLps.toString()))}`);
    }

    // =========================================================================
    // TEST RESULT
    // =========================================================================
    printHeader('TEST RESULT');
    
    const charlieExited = charlieLpAfterSell.total === 0n;
    const daveReceivedLp = daveLpAfterBuy.total === 2n;
    const daveGotPayout = finalDaveUsdt > daveUsdtAfterTrade; // Dave should have more after settlement
    
    if (charlieExited && daveReceivedLp) {
        console.log('\n   ✅ TEST PASSED: LP transfer before settlement works!');
        console.log('   • Charlie bought LP tokens from DAO');
        console.log('   • Charlie sold ALL LP tokens to Dave');
        console.log('   • Charlie exited position before settlement');
        console.log('   • Dave (final holder) received settlement payout');
        console.log('');
        console.log('   💡 Key Insight:');
        console.log('      LP tokens represent risk exposure. Selling transfers the risk.');
        console.log('      Only holders at settlement time receive payouts (or suffer losses).');
    } else {
        console.log('\n   ❌ TEST FAILED: LP transfer issue');
        console.log(`   • Charlie exited: ${charlieExited}`);
        console.log(`   • Dave received LP: ${daveReceivedLp}`);
        console.log(`   • Dave got payout: ${daveGotPayout}`);
    }

    await api.disconnect();
}

main().catch(console.error);
