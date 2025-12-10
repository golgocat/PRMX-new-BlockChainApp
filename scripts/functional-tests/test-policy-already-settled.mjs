#!/usr/bin/env node
/**
 * PRMX Functional Test - Policy Already Settled
 * 
 * This test verifies that attempting to settle an already-settled policy
 * fails with the appropriate error.
 * 
 * Flow:
 * 1. Create a policy
 * 2. Wait for coverage to end
 * 3. Settle the policy
 * 4. Attempt to settle again
 * 5. Verify the second settlement fails
 * 
 * Usage: node test-policy-already-settled.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import {
    WS_ENDPOINT, MARKET_ID,
    formatUsdt, getChainTime, setupOracle,
    submitRainfall, requestQuote, submitQuote, createPolicy,
    settlePolicy, waitUntilTime,
    printHeader, printSection
} from './common.mjs';

async function getPolicyStatus(api, policyId) {
    const policy = await api.query.prmxPolicy.policies(policyId);
    if (policy.isSome) {
        return policy.unwrap().status.toString();
    }
    return null;
}

async function main() {
    printHeader('PRMX FUNCTIONAL TEST - POLICY ALREADY SETTLED');
    
    console.log('\n📋 This test verifies double-settlement prevention.');
    console.log('   Attempting to settle an already-settled policy should fail.');

    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');
    
    console.log('\n✅ Connected to PRMX node');

    const chainNow = await getChainTime(api);
    console.log(`   Chain time: ${new Date(chainNow * 1000).toISOString()}`);

    // =========================================================================
    // SETUP AND CREATE POLICY
    // =========================================================================
    printSection('STEP 1: CREATE POLICY');
    
    await setupOracle(api, alice, MARKET_ID);
    await submitRainfall(api, alice, MARKET_ID, Math.floor(chainNow), 50);
    console.log('✅ Oracle configured');

    const coverageStart = Math.floor(chainNow + 10);
    const coverageEnd = coverageStart + 45; // 45 seconds
    const shares = 1;
    
    console.log(`\n   Coverage: ${new Date(coverageStart * 1000).toISOString()}`);
    console.log(`         to: ${new Date(coverageEnd * 1000).toISOString()}`);

    const quoteId = await requestQuote(api, bob, MARKET_ID, coverageStart, coverageEnd, 14_599_500, 120_984_200, shares);
    const premium = await submitQuote(api, alice, quoteId);
    const policyId = await createPolicy(api, bob, quoteId);
    
    console.log(`\n✅ Policy created!`);
    console.log(`   Policy ID: ${policyId}`);
    console.log(`   Premium: ${formatUsdt(premium)}`);
    console.log(`   Status: ${await getPolicyStatus(api, policyId)}`);

    // =========================================================================
    // WAIT AND SETTLE (FIRST TIME)
    // =========================================================================
    printSection('STEP 2: FIRST SETTLEMENT');
    
    console.log('   ⏳ Waiting for coverage to end...');
    await waitUntilTime(api, coverageEnd + 10);
    console.log('   ✅ Coverage ended');

    console.log('\n   Settling policy (first time)...');
    const events1 = await settlePolicy(api, alice, policyId, false);
    
    const statusAfter1 = await getPolicyStatus(api, policyId);
    console.log(`\n   ✅ First settlement successful!`);
    console.log(`   Policy Status: ${statusAfter1}`);
    
    // Show settlement events
    console.log('\n   📋 Settlement Events:');
    for (const evt of events1) {
        if (evt.section === 'prmxPolicy' || evt.section === 'prmxHoldings') {
            console.log(`      • ${evt.section}.${evt.method}`);
        }
    }

    // =========================================================================
    // ATTEMPT SECOND SETTLEMENT
    // =========================================================================
    printSection('STEP 3: ATTEMPT SECOND SETTLEMENT');
    
    console.log('   Attempting to settle the same policy again...');
    console.log('   ⚠️  This should FAIL with PolicyAlreadySettled error\n');

    const settleTx = api.tx.prmxPolicy.settlePolicy(policyId, false);
    
    let secondSettlementFailed = false;
    let errorMessage = '';
    
    try {
        await new Promise((resolve, reject) => {
            settleTx.signAndSend(alice, ({ status, events, dispatchError }) => {
                if (status.isInBlock) {
                    if (dispatchError) {
                        if (dispatchError.isModule) {
                            const decoded = api.registry.findMetaError(dispatchError.asModule);
                            errorMessage = `${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`;
                        } else {
                            errorMessage = dispatchError.toString();
                        }
                        secondSettlementFailed = true;
                        resolve();
                    } else {
                        // Check for ExtrinsicFailed event
                        for (const { event } of events) {
                            if (event.section === 'system' && event.method === 'ExtrinsicFailed') {
                                secondSettlementFailed = true;
                                const decoded = api.registry.findMetaError(event.data[0].asModule);
                                errorMessage = `${decoded.section}.${decoded.name}`;
                            }
                        }
                        resolve();
                    }
                }
            });
        });
    } catch (e) {
        secondSettlementFailed = true;
        errorMessage = e.message;
    }

    if (secondSettlementFailed) {
        console.log('   ✅ Second settlement FAILED (as expected)!');
        console.log(`   Error: ${errorMessage}`);
    } else {
        console.log('   ❌ Second settlement SUCCEEDED (unexpected!)');
    }

    // =========================================================================
    // VERIFY POLICY STATE
    // =========================================================================
    printSection('STEP 4: VERIFY FINAL STATE');
    
    const finalStatus = await getPolicyStatus(api, policyId);
    console.log(`\n   Policy ${policyId} Final Status: ${finalStatus}`);
    
    // Check settlement result
    const settlementResult = await api.query.prmxPolicy.settlementResults(policyId);
    if (settlementResult.isSome) {
        const result = settlementResult.unwrap();
        console.log(`\n   📋 Settlement Result:`);
        console.log(`      Event Occurred: ${result.eventOccurred.toString()}`);
        console.log(`      Payout to Holder: ${formatUsdt(BigInt(result.payoutToHolder.toString()))}`);
        console.log(`      Returned to LPs: ${formatUsdt(BigInt(result.returnedToLps.toString()))}`);
        console.log(`      Settled At: ${new Date(result.settledAt.toNumber() * 1000).toISOString()}`);
    }

    // =========================================================================
    // TEST RESULT
    // =========================================================================
    printHeader('TEST RESULT');
    
    if (secondSettlementFailed && finalStatus === 'Settled') {
        console.log('\n   ✅ TEST PASSED: Double-settlement prevention works!');
        console.log('   • First settlement succeeded');
        console.log('   • Second settlement correctly rejected');
        console.log('   • Policy remains in Settled state');
        console.log(`   • Error received: ${errorMessage}`);
    } else if (!secondSettlementFailed) {
        console.log('\n   ❌ TEST FAILED: Second settlement was allowed!');
        console.log('   • Double-settlement should be prevented');
    } else {
        console.log('\n   ⚠️  TEST INCONCLUSIVE');
        console.log(`   • Second settlement failed: ${secondSettlementFailed}`);
        console.log(`   • Final status: ${finalStatus}`);
    }

    await api.disconnect();
}

main().catch(console.error);
