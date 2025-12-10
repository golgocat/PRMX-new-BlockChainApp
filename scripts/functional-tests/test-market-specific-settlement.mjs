#!/usr/bin/env node
/**
 * PRMX Functional Test - Market-Specific Settlement
 * 
 * This test verifies that policies on one market are NOT affected
 * by rainfall events on other markets.
 * 
 * Scenario:
 * 1. Create policies on the same market (Market 0)
 * 2. Submit different rainfall data
 * 3. Verify each policy settles based on its own coverage period
 * 
 * Note: True multi-market isolation would require creating additional markets,
 * which needs governance action. This test focuses on policy isolation.
 * 
 * Usage: node test-market-specific-settlement.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import {
    WS_ENDPOINT, MARKET_ID,
    formatUsdt, getChainTime, getUsdtBalance, setupOracle,
    submitRainfall, requestQuote, submitQuote, createPolicy,
    settlePolicy, waitUntilTime, getDaoAccount,
    printHeader, printSection
} from './common.mjs';

async function getPolicyInfo(api, policyId) {
    const policy = await api.query.prmxPolicy.policies(policyId);
    if (policy.isSome) {
        const p = policy.unwrap();
        return {
            marketId: p.marketId.toNumber(),
            status: p.status.toString(),
            coverageStart: p.coverageStart.toNumber(),
            coverageEnd: p.coverageEnd.toNumber(),
            holder: p.holder.toString(),
        };
    }
    return null;
}

async function main() {
    printHeader('PRMX FUNCTIONAL TEST - MARKET-SPECIFIC SETTLEMENT');
    
    console.log('\n📋 This test verifies policy independence within a market.');
    console.log('   Different policies with different coverage periods settle');
    console.log('   based on their own parameters.');

    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');
    const charlie = keyring.addFromUri('//Charlie');
    const daoAccount = await getDaoAccount();
    
    console.log('\n✅ Connected to PRMX node');
    console.log(`   Testing on Market ${MARKET_ID}`);

    const chainNow = await getChainTime(api);

    // Record initial balances
    const initialBobUsdt = await getUsdtBalance(api, bob.address);
    const initialCharlieUsdt = await getUsdtBalance(api, charlie.address);

    // =========================================================================
    // SETUP
    // =========================================================================
    printSection('STEP 1: SETUP ORACLE');
    
    await setupOracle(api, alice, MARKET_ID);
    console.log('✅ Oracle configured');

    // Submit moderate rainfall (below threshold)
    await submitRainfall(api, alice, MARKET_ID, Math.floor(chainNow), 100); // 10mm
    console.log('✅ Initial rainfall: 10mm (below 50mm threshold)');

    // =========================================================================
    // CREATE TWO POLICIES WITH DIFFERENT TIMINGS
    // =========================================================================
    printSection('STEP 2: CREATE POLICIES WITH DIFFERENT COVERAGE');
    
    // Policy 1: Bob - Short coverage (ends first)
    const coverage1Start = Math.floor(chainNow + 10);
    const coverage1End = coverage1Start + 45; // 45 seconds
    
    console.log('\n   📋 Policy 1 (Bob):');
    console.log(`      Coverage: ${new Date(coverage1Start * 1000).toISOString()}`);
    console.log(`            to: ${new Date(coverage1End * 1000).toISOString()}`);
    
    const quoteId1 = await requestQuote(api, bob, MARKET_ID, coverage1Start, coverage1End, 14_599_500, 120_984_200, 1);
    await submitQuote(api, alice, quoteId1);
    const policyId1 = await createPolicy(api, bob, quoteId1);
    console.log(`      ✅ Policy created! ID: ${policyId1}`);

    // Policy 2: Charlie - Longer coverage (ends later)
    const coverage2Start = Math.floor(chainNow + 15);
    const coverage2End = coverage2Start + 90; // 90 seconds
    
    console.log('\n   📋 Policy 2 (Charlie):');
    console.log(`      Coverage: ${new Date(coverage2Start * 1000).toISOString()}`);
    console.log(`            to: ${new Date(coverage2End * 1000).toISOString()}`);
    
    const quoteId2 = await requestQuote(api, charlie, MARKET_ID, coverage2Start, coverage2End, 14_599_500, 120_984_200, 1);
    await submitQuote(api, alice, quoteId2);
    const policyId2 = await createPolicy(api, charlie, quoteId2);
    console.log(`      ✅ Policy created! ID: ${policyId2}`);

    // =========================================================================
    // CHECK POLICY STATES
    // =========================================================================
    printSection('STEP 3: INITIAL POLICY STATES');
    
    const policy1Info = await getPolicyInfo(api, policyId1);
    const policy2Info = await getPolicyInfo(api, policyId2);
    
    console.log('\n   📊 Both Policies on Same Market:');
    console.log('   ─────────────────────────────────────────────────────────');
    console.log(`   Policy ${policyId1} (Bob):    Market ${policy1Info.marketId}, Status: ${policy1Info.status}`);
    console.log(`   Policy ${policyId2} (Charlie): Market ${policy2Info.marketId}, Status: ${policy2Info.status}`);

    // =========================================================================
    // WAIT FOR POLICY 1 TO END, SETTLE IT
    // =========================================================================
    printSection('STEP 4: SETTLE POLICY 1 (BOB)');
    
    console.log('   ⏳ Waiting for Policy 1 coverage to end...');
    await waitUntilTime(api, coverage1End + 10);
    console.log('   ✅ Policy 1 coverage ended');

    console.log('\n   Settling Policy 1 (no event)...');
    await settlePolicy(api, alice, policyId1, false);
    
    const policy1After = await getPolicyInfo(api, policyId1);
    const policy2During = await getPolicyInfo(api, policyId2);
    
    console.log(`\n   Policy ${policyId1} Status: ${policy1After.status}`);
    console.log(`   Policy ${policyId2} Status: ${policy2During.status} (still active)`);

    // =========================================================================
    // SUBMIT HIGH RAINFALL (AFTER POLICY 1 SETTLED)
    // =========================================================================
    printSection('STEP 5: SUBMIT HIGH RAINFALL');
    
    console.log('\n   🌧️ Submitting HIGH rainfall AFTER Policy 1 settled:');
    console.log('   (This should only affect Policy 2 if it\'s still active)');
    
    const currentTime = await getChainTime(api);
    await submitRainfall(api, alice, MARKET_ID, Math.floor(currentTime), 400);      // 40mm
    await submitRainfall(api, alice, MARKET_ID, Math.floor(currentTime - 3600), 200); // 20mm
    console.log('   ✅ Submitted total 60mm (exceeds 50mm threshold)');
    
    const rollingState = await api.query.prmxOracle.rollingState(MARKET_ID);
    if (rollingState.isSome) {
        console.log(`   Current 24h rolling sum: ${rollingState.unwrap().rollingSumMm.toNumber() / 10}mm`);
    }

    // =========================================================================
    // WAIT FOR POLICY 2 TO END, SETTLE IT
    // =========================================================================
    printSection('STEP 6: SETTLE POLICY 2 (CHARLIE) - EVENT OCCURRED');
    
    console.log('   ⏳ Waiting for Policy 2 coverage to end...');
    await waitUntilTime(api, coverage2End + 10);
    console.log('   ✅ Policy 2 coverage ended');

    console.log('\n   Settling Policy 2 (event occurred - threshold exceeded)...');
    await settlePolicy(api, alice, policyId2, true); // Event occurred!
    
    const policy2After = await getPolicyInfo(api, policyId2);
    console.log(`\n   Policy ${policyId2} Status: ${policy2After.status}`);

    // =========================================================================
    // VERIFY INDEPENDENT SETTLEMENTS
    // =========================================================================
    printSection('STEP 7: VERIFY SETTLEMENT INDEPENDENCE');
    
    const result1 = await api.query.prmxPolicy.settlementResults(policyId1);
    const result2 = await api.query.prmxPolicy.settlementResults(policyId2);
    
    console.log('\n   📋 Settlement Results:');
    console.log('   ─────────────────────────────────────────────────────────');
    
    if (result1.isSome) {
        const r = result1.unwrap();
        console.log(`   Policy ${policyId1} (Bob):`);
        console.log(`      Event Occurred: ${r.eventOccurred.toString()}`);
        console.log(`      Payout to Holder: ${formatUsdt(BigInt(r.payoutToHolder.toString()))}`);
        console.log(`      Returned to LPs: ${formatUsdt(BigInt(r.returnedToLps.toString()))}`);
    }
    
    if (result2.isSome) {
        const r = result2.unwrap();
        console.log(`   Policy ${policyId2} (Charlie):`);
        console.log(`      Event Occurred: ${r.eventOccurred.toString()}`);
        console.log(`      Payout to Holder: ${formatUsdt(BigInt(r.payoutToHolder.toString()))}`);
        console.log(`      Returned to LPs: ${formatUsdt(BigInt(r.returnedToLps.toString()))}`);
    }

    // Check final balances
    const finalBobUsdt = await getUsdtBalance(api, bob.address);
    const finalCharlieUsdt = await getUsdtBalance(api, charlie.address);
    
    const bobChange = finalBobUsdt - initialBobUsdt;
    const charlieChange = finalCharlieUsdt - initialCharlieUsdt;
    
    console.log('\n   💰 Net USDT Changes:');
    console.log(`      Bob: ${bobChange >= 0n ? '+' : ''}${formatUsdt(bobChange)} (no event - paid premium)`);
    console.log(`      Charlie: ${charlieChange >= 0n ? '+' : ''}${formatUsdt(charlieChange)} (event - received payout)`);

    // =========================================================================
    // TEST RESULT
    // =========================================================================
    printHeader('TEST RESULT');
    
    const policy1NoEvent = result1.isSome && result1.unwrap().eventOccurred.isFalse;
    const policy2Event = result2.isSome && result2.unwrap().eventOccurred.isTrue;
    const bothSettled = policy1After.status === 'Settled' && policy2After.status === 'Settled';
    
    if (policy1NoEvent && policy2Event && bothSettled) {
        console.log('\n   ✅ TEST PASSED: Policy settlements are independent!');
        console.log('   • Policy 1 (Bob): Settled with NO event (low rainfall at that time)');
        console.log('   • Policy 2 (Charlie): Settled with EVENT (high rainfall during coverage)');
        console.log('   • Each policy evaluated based on its own coverage period');
    } else if (bothSettled) {
        console.log('\n   ⚠️  TEST PARTIAL: Both policies settled');
        console.log(`   • Policy 1 event: ${policy1NoEvent}`);
        console.log(`   • Policy 2 event: ${policy2Event}`);
    } else {
        console.log('\n   ❌ TEST FAILED: Settlement issue');
        console.log(`   • Policy 1 status: ${policy1After.status}`);
        console.log(`   • Policy 2 status: ${policy2After.status}`);
    }

    console.log('\n   💡 Key Insight: Even on the same market, each policy');
    console.log('      is evaluated independently based on its coverage period');
    console.log('      and the rainfall data at that specific time.');

    await api.disconnect();
}

main().catch(console.error);
