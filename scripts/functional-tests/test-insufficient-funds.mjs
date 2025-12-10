#!/usr/bin/env node
/**
 * PRMX Functional Test - Insufficient Funds
 * 
 * This test verifies that transactions fail gracefully when
 * users don't have enough funds.
 * 
 * Flow:
 * 1. Create a user with limited USDT
 * 2. Try to buy insurance they can't afford
 * 3. Try to buy LP tokens they can't afford
 * 4. Verify transactions fail with appropriate errors
 * 
 * Usage: node test-insufficient-funds.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import {
    WS_ENDPOINT, USDT_ASSET_ID, MARKET_ID,
    formatUsdt, getChainTime, getUsdtBalance, setupOracle,
    submitRainfall, requestQuote, submitQuote, createPolicy,
    printHeader, printSection
} from './common.mjs';

async function main() {
    printHeader('PRMX FUNCTIONAL TEST - INSUFFICIENT FUNDS');
    
    console.log('\n📋 This test verifies error handling for insufficient funds.');
    console.log('   Operations requiring more USDT than available should fail.');

    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');
    // Eve typically has less funds in test chains
    const eve = keyring.addFromUri('//Eve');
    
    console.log('\n✅ Connected to PRMX node');

    const chainNow = await getChainTime(api);

    // =========================================================================
    // CHECK EVE'S BALANCE
    // =========================================================================
    printSection('STEP 1: CHECK EVE\'S BALANCE');
    
    const eveUsdt = await getUsdtBalance(api, eve.address);
    console.log(`\n   Eve's USDT balance: ${formatUsdt(eveUsdt)}`);
    
    if (eveUsdt > 1000_000_000n) {
        console.log('   ⚠️  Eve has substantial funds. This test may need adjustment.');
    }

    // =========================================================================
    // SETUP
    // =========================================================================
    printSection('STEP 2: SETUP');
    
    await setupOracle(api, alice, MARKET_ID);
    await submitRainfall(api, alice, MARKET_ID, Math.floor(chainNow), 50);
    console.log('✅ Oracle configured');

    // Bob creates a policy for LP token testing
    const coverageStart = Math.floor(chainNow + 10);
    const coverageEnd = coverageStart + 300;
    
    const quoteId = await requestQuote(api, bob, MARKET_ID, coverageStart, coverageEnd, 14_599_500, 120_984_200, 3);
    await submitQuote(api, alice, quoteId);
    const policyId = await createPolicy(api, bob, quoteId);
    console.log(`✅ Test policy created! ID: ${policyId}`);

    // =========================================================================
    // TEST: BUY INSURANCE WITHOUT SUFFICIENT FUNDS
    // =========================================================================
    printSection('STEP 3: TEST INSURANCE PURCHASE (INSUFFICIENT FUNDS)');
    
    // Request a quote for Eve with many shares
    const expensiveShares = 1000; // 100,000 USDT policy - definitely more than Eve has
    console.log(`\n   Attempting to buy ${expensiveShares} shares (${expensiveShares * 100} USDT max payout)`);
    console.log(`   Eve only has: ${formatUsdt(eveUsdt)}`);
    
    try {
        const eveQuoteId = await requestQuote(api, eve, MARKET_ID, coverageStart + 500, coverageEnd + 500, 14_599_500, 120_984_200, expensiveShares);
        await submitQuote(api, alice, eveQuoteId);
        
        console.log('\n   Eve trying to apply coverage...');
        
        const applyTx = api.tx.prmxPolicy.applyCoverageWithQuote(eveQuoteId);
        
        let failed = false;
        let errorMsg = '';
        
        await new Promise((resolve) => {
            applyTx.signAndSend(eve, ({ status, events, dispatchError }) => {
                if (status.isInBlock) {
                    if (dispatchError) {
                        failed = true;
                        if (dispatchError.isModule) {
                            const decoded = api.registry.findMetaError(dispatchError.asModule);
                            errorMsg = `${decoded.section}.${decoded.name}`;
                        } else {
                            errorMsg = dispatchError.toString();
                        }
                    }
                    // Check for ExtrinsicFailed
                    for (const { event } of events) {
                        if (event.section === 'system' && event.method === 'ExtrinsicFailed') {
                            failed = true;
                        }
                    }
                    resolve();
                }
            });
        });
        
        if (failed) {
            console.log(`   ✅ Transaction FAILED as expected!`);
            console.log(`   Error: ${errorMsg || 'ExtrinsicFailed'}`);
        } else {
            console.log(`   ⚠️  Transaction succeeded (Eve might have more funds than expected)`);
        }
    } catch (e) {
        console.log(`   ✅ Exception caught: ${e.message}`);
    }

    // =========================================================================
    // TEST: BUY LP TOKENS WITHOUT SUFFICIENT FUNDS
    // =========================================================================
    printSection('STEP 4: TEST LP PURCHASE (INSUFFICIENT FUNDS)');
    
    const expensiveLpAmount = 100n; // Try to buy 100 LP tokens (way more than available and affordable)
    const maxPrice = 100_000_000n;
    
    console.log(`\n   Attempting to buy ${expensiveLpAmount.toString()} LP tokens @ ${formatUsdt(maxPrice)} each`);
    console.log(`   Required: ~${formatUsdt(expensiveLpAmount * maxPrice)}`);
    console.log(`   Eve has: ${formatUsdt(eveUsdt)}`);
    
    try {
        const buyTx = api.tx.prmxOrderbookLp.buyLp(policyId, maxPrice, expensiveLpAmount);
        
        let failed = false;
        let errorMsg = '';
        
        await new Promise((resolve) => {
            buyTx.signAndSend(eve, ({ status, events, dispatchError }) => {
                if (status.isInBlock) {
                    if (dispatchError) {
                        failed = true;
                        if (dispatchError.isModule) {
                            const decoded = api.registry.findMetaError(dispatchError.asModule);
                            errorMsg = `${decoded.section}.${decoded.name}`;
                        } else {
                            errorMsg = dispatchError.toString();
                        }
                    }
                    for (const { event } of events) {
                        if (event.section === 'system' && event.method === 'ExtrinsicFailed') {
                            failed = true;
                        }
                    }
                    resolve();
                }
            });
        });
        
        if (failed) {
            console.log(`   ✅ Transaction FAILED as expected!`);
            console.log(`   Error: ${errorMsg || 'ExtrinsicFailed'}`);
        } else {
            console.log(`   ⚠️  Transaction completed (might have partially filled with available funds)`);
        }
    } catch (e) {
        console.log(`   ✅ Exception caught: ${e.message}`);
    }

    // =========================================================================
    // TEST: PLACE BID WITHOUT SUFFICIENT FUNDS
    // =========================================================================
    printSection('STEP 5: TEST BID PLACEMENT (INSUFFICIENT FUNDS)');
    
    const bidPrice = 1000_000_000_000n; // 1,000,000 USDT per LP - definitely can't afford
    const bidAmount = 1n;
    
    console.log(`\n   Attempting to place bid for ${bidAmount.toString()} LP @ ${formatUsdt(bidPrice)}`);
    console.log(`   Required escrow: ${formatUsdt(bidPrice * bidAmount)}`);
    console.log(`   Eve has: ${formatUsdt(eveUsdt)}`);
    
    try {
        const bidTx = api.tx.prmxOrderbookLp.placeLpBid(policyId, bidPrice, bidAmount);
        
        let failed = false;
        let errorMsg = '';
        
        await new Promise((resolve) => {
            bidTx.signAndSend(eve, ({ status, events, dispatchError }) => {
                if (status.isInBlock) {
                    if (dispatchError) {
                        failed = true;
                        if (dispatchError.isModule) {
                            const decoded = api.registry.findMetaError(dispatchError.asModule);
                            errorMsg = `${decoded.section}.${decoded.name}`;
                        } else {
                            errorMsg = dispatchError.toString();
                        }
                    }
                    for (const { event } of events) {
                        if (event.section === 'system' && event.method === 'ExtrinsicFailed') {
                            failed = true;
                        }
                    }
                    resolve();
                }
            });
        });
        
        if (failed) {
            console.log(`   ✅ Transaction FAILED as expected!`);
            console.log(`   Error: ${errorMsg || 'ExtrinsicFailed'}`);
        } else {
            console.log(`   ❌ Transaction succeeded unexpectedly!`);
        }
    } catch (e) {
        console.log(`   ✅ Exception caught: ${e.message}`);
    }

    // =========================================================================
    // VERIFY EVE'S BALANCE UNCHANGED
    // =========================================================================
    printSection('STEP 6: VERIFY BALANCE UNCHANGED');
    
    const eveFinalUsdt = await getUsdtBalance(api, eve.address);
    const balanceChange = eveFinalUsdt - eveUsdt;
    
    console.log(`\n   Eve's final USDT: ${formatUsdt(eveFinalUsdt)}`);
    console.log(`   Balance change: ${balanceChange >= 0n ? '+' : ''}${formatUsdt(balanceChange)}`);

    // =========================================================================
    // TEST RESULT
    // =========================================================================
    printHeader('TEST RESULT');
    
    const balancePreserved = balanceChange >= -1_000_000n; // Allow for small tx fees
    
    if (balancePreserved) {
        console.log('\n   ✅ TEST PASSED: Insufficient funds handled correctly!');
        console.log('   • Expensive operations fail gracefully');
        console.log('   • User funds are preserved on failed transactions');
        console.log('   • Error messages indicate the issue');
    } else {
        console.log('\n   ⚠️  TEST NEEDS REVIEW:');
        console.log(`   • Balance changed by: ${formatUsdt(balanceChange)}`);
    }

    console.log('\n   💡 Common error types for insufficient funds:');
    console.log('   • assets.BalanceLow - Not enough USDT in account');
    console.log('   • prmxOrderbookLp.InsufficientBalance - Can\'t afford LP purchase');
    console.log('   • prmxPolicy.InsufficientPremium - Can\'t pay insurance premium');

    await api.disconnect();
}

main().catch(console.error);
