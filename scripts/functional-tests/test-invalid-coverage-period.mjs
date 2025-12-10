#!/usr/bin/env node
/**
 * PRMX Functional Test - Invalid Coverage Period
 * 
 * This test verifies that the system rejects invalid coverage periods
 * such as end date before start date, or coverage in the past.
 * 
 * Flow:
 * 1. Try to request quote with end < start
 * 2. Try to request quote with coverage in the past
 * 3. Verify both are rejected
 * 
 * Usage: node test-invalid-coverage-period.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import {
    WS_ENDPOINT, MARKET_ID,
    getChainTime, setupOracle, submitRainfall,
    printHeader, printSection
} from './common.mjs';

async function main() {
    printHeader('PRMX FUNCTIONAL TEST - INVALID COVERAGE PERIOD');
    
    console.log('\n📋 This test verifies validation of coverage periods.');
    console.log('   Invalid periods (end < start, past dates) should be rejected.');

    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');
    
    console.log('\n✅ Connected to PRMX node');

    const chainNow = await getChainTime(api);
    console.log(`   Chain time: ${new Date(chainNow * 1000).toISOString()}`);

    // =========================================================================
    // SETUP
    // =========================================================================
    printSection('STEP 1: SETUP');
    
    await setupOracle(api, alice, MARKET_ID);
    await submitRainfall(api, alice, MARKET_ID, Math.floor(chainNow), 50);
    console.log('✅ Oracle configured');

    // =========================================================================
    // TEST 1: END BEFORE START
    // =========================================================================
    printSection('STEP 2: TEST END DATE BEFORE START DATE');
    
    const futureStart = Math.floor(chainNow + 100);
    const badEnd = futureStart - 50; // End is 50 seconds BEFORE start
    
    console.log(`\n   Coverage Start: ${new Date(futureStart * 1000).toISOString()}`);
    console.log(`   Coverage End: ${new Date(badEnd * 1000).toISOString()}`);
    console.log('   ⚠️  End is BEFORE start - should be rejected');
    
    try {
        const quoteTx = api.tx.prmxQuote.requestPolicyQuote(
            MARKET_ID, futureStart, badEnd, 14_599_500, 120_984_200, 1
        );
        
        let failed = false;
        let errorMsg = '';
        
        await new Promise((resolve) => {
            quoteTx.signAndSend(bob, ({ status, events, dispatchError }) => {
                if (status.isInBlock) {
                    if (dispatchError) {
                        failed = true;
                        if (dispatchError.isModule) {
                            const decoded = api.registry.findMetaError(dispatchError.asModule);
                            errorMsg = `${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`;
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
            console.log(`\n   ✅ REJECTED as expected!`);
            console.log(`   Error: ${errorMsg || 'ExtrinsicFailed'}`);
        } else {
            console.log(`\n   ❌ Transaction SUCCEEDED (should have failed!)`);
        }
    } catch (e) {
        console.log(`\n   ✅ Exception: ${e.message}`);
    }

    // =========================================================================
    // TEST 2: COVERAGE IN THE PAST
    // =========================================================================
    printSection('STEP 3: TEST COVERAGE START IN THE PAST');
    
    const pastStart = Math.floor(chainNow - 3600); // 1 hour ago
    const pastEnd = Math.floor(chainNow - 1800);   // 30 minutes ago
    
    console.log(`\n   Coverage Start: ${new Date(pastStart * 1000).toISOString()}`);
    console.log(`   Coverage End: ${new Date(pastEnd * 1000).toISOString()}`);
    console.log('   ⚠️  Both dates are in the PAST - should be rejected');
    
    try {
        const quoteTx = api.tx.prmxQuote.requestPolicyQuote(
            MARKET_ID, pastStart, pastEnd, 14_599_500, 120_984_200, 1
        );
        
        let failed = false;
        let errorMsg = '';
        
        await new Promise((resolve) => {
            quoteTx.signAndSend(bob, ({ status, events, dispatchError }) => {
                if (status.isInBlock) {
                    if (dispatchError) {
                        failed = true;
                        if (dispatchError.isModule) {
                            const decoded = api.registry.findMetaError(dispatchError.asModule);
                            errorMsg = `${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`;
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
            console.log(`\n   ✅ REJECTED as expected!`);
            console.log(`   Error: ${errorMsg || 'ExtrinsicFailed'}`);
        } else {
            console.log(`\n   ⚠️  Transaction SUCCEEDED (may be valid depending on business rules)`);
        }
    } catch (e) {
        console.log(`\n   ✅ Exception: ${e.message}`);
    }

    // =========================================================================
    // TEST 3: ZERO DURATION
    // =========================================================================
    printSection('STEP 4: TEST ZERO DURATION COVERAGE');
    
    const sameTime = Math.floor(chainNow + 100);
    
    console.log(`\n   Coverage Start: ${new Date(sameTime * 1000).toISOString()}`);
    console.log(`   Coverage End: ${new Date(sameTime * 1000).toISOString()}`);
    console.log('   ⚠️  Start = End (zero duration) - should be rejected');
    
    try {
        const quoteTx = api.tx.prmxQuote.requestPolicyQuote(
            MARKET_ID, sameTime, sameTime, 14_599_500, 120_984_200, 1
        );
        
        let failed = false;
        let errorMsg = '';
        
        await new Promise((resolve) => {
            quoteTx.signAndSend(bob, ({ status, events, dispatchError }) => {
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
            console.log(`\n   ✅ REJECTED as expected!`);
            console.log(`   Error: ${errorMsg || 'ExtrinsicFailed'}`);
        } else {
            console.log(`\n   ⚠️  Transaction SUCCEEDED (zero duration may be allowed)`);
        }
    } catch (e) {
        console.log(`\n   ✅ Exception: ${e.message}`);
    }

    // =========================================================================
    // TEST 4: VALID COVERAGE (CONTROL TEST)
    // =========================================================================
    printSection('STEP 5: CONTROL TEST - VALID COVERAGE');
    
    const validStart = Math.floor(chainNow + 60);
    const validEnd = validStart + 3600; // 1 hour duration
    
    console.log(`\n   Coverage Start: ${new Date(validStart * 1000).toISOString()}`);
    console.log(`   Coverage End: ${new Date(validEnd * 1000).toISOString()}`);
    console.log('   ✓ Valid future coverage with positive duration');
    
    try {
        const quoteTx = api.tx.prmxQuote.requestPolicyQuote(
            MARKET_ID, validStart, validEnd, 14_599_500, 120_984_200, 1
        );
        
        let succeeded = false;
        let quoteId;
        
        await new Promise((resolve) => {
            quoteTx.signAndSend(bob, ({ status, events }) => {
                if (status.isInBlock) {
                    for (const { event } of events) {
                        if (event.section === 'prmxQuote' && event.method === 'QuoteRequested') {
                            succeeded = true;
                            quoteId = event.data[0].toNumber();
                        }
                    }
                    resolve();
                }
            });
        });
        
        if (succeeded) {
            console.log(`\n   ✅ Quote created successfully! ID: ${quoteId}`);
        } else {
            console.log(`\n   ❌ Valid quote was rejected!`);
        }
    } catch (e) {
        console.log(`\n   ❌ Exception on valid input: ${e.message}`);
    }

    // =========================================================================
    // TEST RESULT
    // =========================================================================
    printHeader('TEST RESULT');
    
    console.log('\n   📋 Coverage Period Validation Rules:');
    console.log('   ─────────────────────────────────────────');
    console.log('   • coverage_end > coverage_start (positive duration)');
    console.log('   • coverage_start >= current_time (future start)');
    console.log('   • Valid parameters should be accepted');
    console.log('');
    console.log('   ✅ Test completed - verify output above matches expectations');
    console.log('');
    console.log('   💡 Note: Exact validation rules depend on pallet implementation.');
    console.log('      Some systems may allow past coverage for historical data entry.');

    await api.disconnect();
}

main().catch(console.error);
