#!/usr/bin/env node
/**
 * PRMX Functional Test - Threshold Trigger Log
 * 
 * This test verifies that when rainfall exceeds the strike threshold,
 * a ThresholdTriggerLog entry is recorded on-chain.
 * 
 * Flow:
 * 1. Check initial trigger log state
 * 2. Submit rainfall that exceeds threshold
 * 3. Verify trigger log is created
 * 4. Verify log contains correct data
 * 
 * Usage: node test-threshold-trigger-log.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import {
    WS_ENDPOINT, MARKET_ID,
    getChainTime, setupOracle, submitRainfall,
    requestQuote, submitQuote, createPolicy,
    printHeader, printSection, getDaoAccount, formatUsdt
} from './common.mjs';

async function getTriggerLog(api, marketId) {
    const log = await api.query.prmxOracle.thresholdTriggerLog(marketId);
    if (log.isSome) {
        const l = log.unwrap();
        return {
            policyId: l.policyId.toNumber(),
            triggeredAt: l.triggeredAt.toNumber(),
            blockNumber: l.blockNumber.toNumber(),
            rollingSumMm: l.rollingSumMm.toNumber(),
            strikeThreshold: l.strikeThreshold.toNumber(),
        };
    }
    return null;
}

async function main() {
    printHeader('PRMX FUNCTIONAL TEST - THRESHOLD TRIGGER LOG');
    
    console.log('\n📋 This test verifies ThresholdTriggerLog storage.');
    console.log('   When rainfall exceeds threshold during active coverage,');
    console.log('   a trigger log entry should be recorded.');

    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');
    
    console.log('\n✅ Connected to PRMX node');

    const chainNow = await getChainTime(api);
    console.log(`   Chain time: ${new Date(chainNow * 1000).toISOString()}`);

    // =========================================================================
    // CHECK INITIAL STATE
    // =========================================================================
    printSection('STEP 1: CHECK INITIAL TRIGGER LOG STATE');
    
    await setupOracle(api, alice, MARKET_ID);
    console.log('✅ Oracle configured');

    const initialLog = await getTriggerLog(api, MARKET_ID);
    if (initialLog) {
        console.log(`\n   📋 Existing Trigger Log for Market ${MARKET_ID}:`);
        console.log(`      Policy ID: ${initialLog.policyId}`);
        console.log(`      Triggered At: ${new Date(initialLog.triggeredAt * 1000).toISOString()}`);
        console.log(`      Block Number: #${initialLog.blockNumber}`);
        console.log(`      Rolling Sum: ${initialLog.rollingSumMm / 10}mm`);
        console.log(`      Strike Threshold: ${initialLog.strikeThreshold / 10}mm`);
    } else {
        console.log(`\n   No existing trigger log for Market ${MARKET_ID}`);
    }

    // =========================================================================
    // CREATE A POLICY WITH ACTIVE COVERAGE
    // =========================================================================
    printSection('STEP 2: CREATE POLICY WITH ACTIVE COVERAGE');
    
    // Submit initial low rainfall
    await submitRainfall(api, alice, MARKET_ID, Math.floor(chainNow), 50);
    console.log('✅ Initial low rainfall submitted (5mm)');

    const coverageStart = Math.floor(chainNow + 10);
    const coverageEnd = coverageStart + 180; // 3 minutes
    const shares = 1;
    
    console.log(`\n   Coverage: ${new Date(coverageStart * 1000).toISOString()}`);
    console.log(`         to: ${new Date(coverageEnd * 1000).toISOString()}`);

    const quoteId = await requestQuote(api, bob, MARKET_ID, coverageStart, coverageEnd, 14_599_500, 120_984_200, shares);
    console.log(`✅ Quote requested: ID ${quoteId}`);

    const premium = await submitQuote(api, alice, quoteId);
    console.log(`✅ Quote ready! Premium: ${formatUsdt(premium)}`);

    const policyId = await createPolicy(api, bob, quoteId);
    console.log(`✅ Policy created! ID: ${policyId}`);

    // Wait for coverage to start
    console.log('\n   ⏳ Waiting for coverage to start...');
    let currentTime = await getChainTime(api);
    while (currentTime < coverageStart) {
        await new Promise(r => setTimeout(r, 3000));
        currentTime = await getChainTime(api);
    }
    console.log('   ✅ Coverage period active');

    // =========================================================================
    // SUBMIT HIGH RAINFALL TO TRIGGER THRESHOLD
    // =========================================================================
    printSection('STEP 3: SUBMIT HIGH RAINFALL (EXCEED THRESHOLD)');
    
    console.log('   🌧️ Submitting rainfall that EXCEEDS 50mm strike threshold:\n');
    
    currentTime = await getChainTime(api);
    
    // Submit enough rainfall to exceed 50mm threshold
    await submitRainfall(api, alice, MARKET_ID, Math.floor(currentTime), 350);      // 35mm
    console.log('   ✅ Submitted 35mm rainfall (current hour)');
    
    await submitRainfall(api, alice, MARKET_ID, Math.floor(currentTime - 3600), 250); // 25mm
    console.log('   ✅ Submitted 25mm rainfall (1 hour ago)');
    
    console.log('\n   ⚡ Total submitted: 60mm (600 scaled)');
    console.log('   ⚡ Strike threshold: 50mm (500 scaled)');
    console.log('   🔴 THRESHOLD EXCEEDED!');

    // =========================================================================
    // WAIT FOR SETTLEMENT CHECK
    // =========================================================================
    printSection('STEP 4: WAIT FOR SETTLEMENT CHECK');
    
    console.log('   ⏳ Waiting for on_initialize to detect threshold breach...');
    console.log('   (Checks run every 10 blocks)\n');
    
    let triggerLog = null;
    let waitBlocks = 0;
    const maxWaitBlocks = 20;
    
    while (!triggerLog && waitBlocks < maxWaitBlocks) {
        await new Promise(r => setTimeout(r, 6000));
        waitBlocks++;
        
        triggerLog = await getTriggerLog(api, MARKET_ID);
        
        if (triggerLog) {
            console.log(`   ✅ Trigger log created after ${waitBlocks} blocks!`);
        } else {
            console.log(`   Block ${waitBlocks}/${maxWaitBlocks}: No trigger log yet`);
        }
    }

    // =========================================================================
    // VERIFY TRIGGER LOG
    // =========================================================================
    printSection('STEP 5: VERIFY TRIGGER LOG');
    
    const finalLog = await getTriggerLog(api, MARKET_ID);
    
    if (finalLog) {
        console.log(`\n   📋 ThresholdTriggerLog for Market ${MARKET_ID}:`);
        console.log(`      ─────────────────────────────────────────`);
        console.log(`      Policy ID:        ${finalLog.policyId}`);
        console.log(`      Triggered At:     ${new Date(finalLog.triggeredAt * 1000).toISOString()}`);
        console.log(`      Block Number:     #${finalLog.blockNumber}`);
        console.log(`      Rolling Sum:      ${finalLog.rollingSumMm / 10}mm (${finalLog.rollingSumMm} scaled)`);
        console.log(`      Strike Threshold: ${finalLog.strikeThreshold / 10}mm (${finalLog.strikeThreshold} scaled)`);
        console.log(`      ─────────────────────────────────────────`);
        
        // Verify the log is correct
        const sumExceedsThreshold = finalLog.rollingSumMm >= finalLog.strikeThreshold;
        console.log(`\n   ✓ Sum exceeds threshold: ${sumExceedsThreshold ? 'YES' : 'NO'}`);
        console.log(`   ✓ Policy ID matches: ${finalLog.policyId === policyId ? 'YES' : 'NO'}`);
    } else {
        console.log('\n   ❌ No trigger log found!');
    }

    // =========================================================================
    // TEST RESULT
    // =========================================================================
    printHeader('TEST RESULT');
    
    if (finalLog && finalLog.rollingSumMm >= finalLog.strikeThreshold) {
        console.log('\n   ✅ TEST PASSED: ThresholdTriggerLog works correctly!');
        console.log('   • Trigger log was created when threshold exceeded');
        console.log('   • Log contains correct rolling sum and threshold values');
        console.log('   • Block number and timestamp are recorded');
    } else if (finalLog) {
        console.log('\n   ⚠️  TEST PARTIAL: Log exists but values may be incorrect');
        console.log(`   • Rolling sum: ${finalLog.rollingSumMm / 10}mm`);
        console.log(`   • Threshold: ${finalLog.strikeThreshold / 10}mm`);
    } else {
        console.log('\n   ❌ TEST FAILED: No trigger log was created');
        console.log('   • Check if on_initialize threshold detection is working');
        console.log('   • Verify BLOCKS_PER_SETTLEMENT_CHECK timing');
    }

    console.log('\n   💡 Note: ThresholdTriggerLog is overwritten each time');
    console.log('      a new threshold breach is detected for the market.');

    await api.disconnect();
}

main().catch(console.error);
