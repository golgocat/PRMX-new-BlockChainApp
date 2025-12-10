#!/usr/bin/env node
/**
 * PRMX Functional Test - Automatic Settlement on Threshold Breach
 * 
 * This test verifies that the on_initialize hook automatically detects
 * when rainfall exceeds the strike threshold and triggers settlement.
 * 
 * Flow:
 * 1. Create a policy with active coverage
 * 2. Submit rainfall data that exceeds threshold DURING coverage
 * 3. Wait for on_initialize to detect and trigger settlement
 * 4. Verify policy was automatically settled
 * 
 * Usage: node test-auto-settlement-threshold-breach.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import {
    WS_ENDPOINT, USDT_ASSET_ID, MARKET_ID, MANILA_ACCUWEATHER_KEY,
    formatUsdt, getChainTime, getUsdtBalance, setupOracle,
    submitRainfall, requestQuote, submitQuote, createPolicy,
    printHeader, printSection, waitForBlocks, getDaoAccount
} from './common.mjs';

async function main() {
    printHeader('PRMX FUNCTIONAL TEST - AUTO SETTLEMENT ON THRESHOLD BREACH');
    
    console.log('\n📋 This test verifies automatic settlement when rainfall');
    console.log('   exceeds the strike threshold during active coverage.');
    console.log('   The on_initialize hook should detect and trigger settlement.');

    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');
    const daoAccount = await getDaoAccount();
    
    console.log('\n✅ Connected to PRMX node');
    console.log(`   Alice (Oracle): ${alice.address}`);
    console.log(`   Bob (Customer): ${bob.address}`);

    const chainNow = await getChainTime(api);
    console.log(`\n⏰ Chain time: ${new Date(chainNow * 1000).toISOString()}`);

    // =========================================================================
    // SETUP
    // =========================================================================
    printSection('STEP 1: SETUP ORACLE AND INITIAL STATE');
    
    await setupOracle(api, alice, MARKET_ID);
    console.log('✅ Oracle configured');

    // Submit low initial rainfall for quote calculation
    await submitRainfall(api, alice, MARKET_ID, Math.floor(chainNow), 50); // 5mm
    console.log('✅ Initial low rainfall submitted (5mm)');

    const bobInitialUsdt = await getUsdtBalance(api, bob.address);
    console.log(`\n   Bob initial USDT: ${formatUsdt(bobInitialUsdt)}`);

    // =========================================================================
    // CREATE POLICY WITH LONGER COVERAGE WINDOW
    // =========================================================================
    printSection('STEP 2: CREATE POLICY WITH ACTIVE COVERAGE');
    
    // Use longer coverage window to allow time for threshold breach detection
    const coverageStart = Math.floor(chainNow + 10);
    const coverageEnd = coverageStart + 300; // 5 minutes coverage
    const shares = 2;
    
    console.log(`   Coverage: ${new Date(coverageStart * 1000).toISOString()}`);
    console.log(`         to: ${new Date(coverageEnd * 1000).toISOString()}`);
    console.log(`   Duration: 300 seconds (5 minutes)`);
    console.log(`   Shares: ${shares} (= ${shares * 100} USDT max payout)`);

    const quoteId = await requestQuote(api, bob, MARKET_ID, coverageStart, coverageEnd, 14_599_500, 120_984_200, shares);
    console.log(`✅ Quote requested: ID ${quoteId}`);

    const premium = await submitQuote(api, alice, quoteId);
    console.log(`✅ Quote ready! Premium: ${formatUsdt(premium)}`);

    const policyId = await createPolicy(api, bob, quoteId);
    console.log(`✅ Policy created! ID: ${policyId}`);

    // Check initial policy state
    const policy = await api.query.prmxPolicy.policies(policyId);
    console.log(`\n   Policy Status: ${policy.unwrap().status.toString()}`);
    console.log(`   Strike Threshold: 50mm (500 scaled)`);

    // =========================================================================
    // WAIT FOR COVERAGE TO START
    // =========================================================================
    printSection('STEP 3: WAIT FOR COVERAGE TO START');
    
    let currentTime = await getChainTime(api);
    while (currentTime < coverageStart) {
        console.log(`   Waiting for coverage start... (${Math.ceil(coverageStart - currentTime)}s remaining)`);
        await new Promise(r => setTimeout(r, 6000));
        currentTime = await getChainTime(api);
    }
    console.log('✅ Coverage period has started!');

    // =========================================================================
    // SUBMIT HIGH RAINFALL TO TRIGGER THRESHOLD BREACH
    // =========================================================================
    printSection('STEP 4: SUBMIT HIGH RAINFALL (TRIGGER THRESHOLD BREACH)');
    
    console.log('   🌧️ Submitting rainfall that EXCEEDS 50mm strike threshold:');
    
    // Submit high rainfall in multiple buckets
    currentTime = await getChainTime(api);
    await submitRainfall(api, alice, MARKET_ID, Math.floor(currentTime), 300);      // 30mm
    console.log('   ✅ Submitted 30mm rainfall');
    await submitRainfall(api, alice, MARKET_ID, Math.floor(currentTime - 3600), 350); // 35mm
    console.log('   ✅ Submitted 35mm rainfall (1 hour ago)');
    
    console.log('\n   ⚡ Total rainfall: 65mm (650 scaled)');
    console.log('   ⚡ Strike threshold: 50mm (500 scaled)');
    console.log('   🔴 THRESHOLD BREACH! Event should be triggered.');

    // Check rolling state
    const rollingState = await api.query.prmxOracle.rollingState(MARKET_ID);
    if (rollingState.isSome) {
        const state = rollingState.unwrap();
        console.log(`\n   📊 Oracle Rolling State:`);
        console.log(`      24h Sum: ${state.rollingSumMm.toNumber() / 10}mm`);
    }

    // =========================================================================
    // MONITOR FOR AUTOMATIC SETTLEMENT
    // =========================================================================
    printSection('STEP 5: MONITOR FOR AUTOMATIC SETTLEMENT');
    
    console.log('   ⏳ Waiting for on_initialize to detect threshold breach...');
    console.log('   (Settlement checks run every BLOCKS_PER_SETTLEMENT_CHECK = 10 blocks)');
    
    let settled = false;
    let waitBlocks = 0;
    const maxWaitBlocks = 30; // Max 30 blocks (~3 minutes)
    
    while (!settled && waitBlocks < maxWaitBlocks) {
        await new Promise(r => setTimeout(r, 6000)); // Wait 1 block (~6 seconds)
        waitBlocks++;
        
        const currentPolicy = await api.query.prmxPolicy.policies(policyId);
        const status = currentPolicy.unwrap().status.toString();
        
        if (status === 'Settled') {
            settled = true;
            console.log(`\n   ✅ POLICY AUTO-SETTLED after ${waitBlocks} blocks!`);
        } else {
            console.log(`   Block ${waitBlocks}/${maxWaitBlocks}: Status = ${status}`);
        }
        
        // Also check for ThresholdTriggerLog
        const triggerLog = await api.query.prmxOracle.thresholdTriggerLog(MARKET_ID);
        if (triggerLog.isSome) {
            console.log(`   📋 Threshold trigger logged for market ${MARKET_ID}`);
        }
    }

    // =========================================================================
    // VERIFY SETTLEMENT RESULTS
    // =========================================================================
    printSection('STEP 6: VERIFY SETTLEMENT RESULTS');
    
    const finalPolicy = await api.query.prmxPolicy.policies(policyId);
    const settlementResult = await api.query.prmxPolicy.settlementResults(policyId);
    
    console.log(`\n   📄 Policy Status: ${finalPolicy.unwrap().status.toString()}`);
    
    if (settlementResult.isSome) {
        const result = settlementResult.unwrap();
        console.log(`\n   📋 SETTLEMENT RESULT:`);
        console.log(`      Event Occurred: ${result.eventOccurred.toString()}`);
        console.log(`      Payout to Holder: ${formatUsdt(BigInt(result.payoutToHolder.toString()))}`);
        console.log(`      Returned to LPs: ${formatUsdt(BigInt(result.returnedToLps.toString()))}`);
        console.log(`      Settled At: ${new Date(result.settledAt.toNumber() * 1000).toISOString()}`);
    }

    const bobFinalUsdt = await getUsdtBalance(api, bob.address);
    const bobChange = bobFinalUsdt - bobInitialUsdt;
    
    console.log(`\n   💰 Bob's USDT Change: ${bobChange >= 0n ? '+' : ''}${formatUsdt(bobChange)}`);

    // =========================================================================
    // TEST RESULT
    // =========================================================================
    printHeader('TEST RESULT');
    
    if (settled && settlementResult.isSome && settlementResult.unwrap().eventOccurred.isTrue) {
        console.log('\n   ✅ TEST PASSED: Automatic settlement triggered correctly!');
        console.log('   • Threshold breach was detected by on_initialize');
        console.log('   • Policy was automatically settled with event_occurred = true');
        console.log('   • Policyholder received payout');
    } else if (settled) {
        console.log('\n   ⚠️  TEST PARTIAL: Policy settled but event flag unclear');
    } else {
        console.log('\n   ❌ TEST FAILED: Automatic settlement did not trigger');
        console.log('   • Check if BLOCKS_PER_SETTLEMENT_CHECK is configured correctly');
        console.log('   • Verify threshold detection logic in on_initialize');
    }

    await api.disconnect();
}

main().catch(console.error);
