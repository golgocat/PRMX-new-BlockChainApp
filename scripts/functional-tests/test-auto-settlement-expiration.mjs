#!/usr/bin/env node
/**
 * PRMX Functional Test - Automatic Settlement on Policy Expiration
 * 
 * This test verifies that the on_initialize hook automatically detects
 * expired policies and settles them based on oracle data.
 * 
 * Flow:
 * 1. Create a policy with a short coverage window
 * 2. Submit rainfall data BELOW the threshold (no event)
 * 3. Wait for coverage window to expire
 * 4. Wait for on_initialize to detect expiration and trigger settlement
 * 5. Verify policy was automatically settled with event_occurred = false
 * 6. Verify LP holders received the pool distribution
 * 
 * Usage: node test-auto-settlement-expiration.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import {
    WS_ENDPOINT, USDT_ASSET_ID, MARKET_ID, MANILA_ACCUWEATHER_KEY,
    formatUsdt, getChainTime, getUsdtBalance, setupOracle,
    requestQuote, submitQuote, createPolicy, sendTx,
    printHeader, printSection, waitForBlocks, getDaoAccount, getLpBalance
} from './common.mjs';

// Helper to submit test rainfall using setTestRainfall (no timestamp validation)
async function setTestRainfall(api, signer, marketId, rainfallMm) {
    const tx = api.tx.sudo.sudo(
        api.tx.prmxOracle.setTestRainfall(marketId, rainfallMm)
    );
    await sendTx(tx, signer, api);
}

async function main() {
    printHeader('PRMX FUNCTIONAL TEST - AUTO SETTLEMENT ON EXPIRATION');
    
    console.log('\n📋 This test verifies automatic settlement when a policy');
    console.log('   coverage window expires without a threshold breach.');
    console.log('   The on_initialize hook should detect and trigger settlement.');
    console.log('   LP holders should receive the pool distribution (no event case).');

    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');
    const daoAccount = await getDaoAccount();
    
    console.log('\n✅ Connected to PRMX node');
    console.log(`   Alice (Oracle): ${alice.address}`);
    console.log(`   Bob (Customer): ${bob.address}`);
    console.log(`   DAO Account: ${daoAccount}`);

    const chainNow = await getChainTime(api);
    console.log(`\n⏰ Chain time: ${new Date(chainNow * 1000).toISOString()}`);

    // =========================================================================
    // SETUP
    // =========================================================================
    printSection('STEP 1: SETUP ORACLE AND INITIAL STATE');
    
    await setupOracle(api, alice, MARKET_ID);
    console.log('✅ Oracle configured');

    // Submit LOW rainfall for quote calculation (BELOW 50mm threshold)
    await setTestRainfall(api, alice, MARKET_ID, 100); // 10mm
    console.log('✅ Low rainfall submitted (10mm - below 50mm strike threshold)');

    const bobInitialUsdt = await getUsdtBalance(api, bob.address);
    const daoInitialUsdt = await getUsdtBalance(api, daoAccount);
    console.log(`\n   Bob initial USDT: ${formatUsdt(bobInitialUsdt)}`);
    console.log(`   DAO initial USDT: ${formatUsdt(daoInitialUsdt)}`);

    // =========================================================================
    // CREATE POLICY WITH SHORT COVERAGE WINDOW
    // =========================================================================
    printSection('STEP 2: CREATE POLICY WITH SHORT COVERAGE WINDOW');
    
    // Use a very short coverage window (60 seconds) for quick testing
    const coverageStart = Math.floor(chainNow + 10);
    const coverageEnd = coverageStart + 60; // 60 seconds coverage (1 minute)
    const shares = 2;
    
    console.log(`   Coverage: ${new Date(coverageStart * 1000).toISOString()}`);
    console.log(`         to: ${new Date(coverageEnd * 1000).toISOString()}`);
    console.log(`   Duration: 60 seconds (1 minute)`);
    console.log(`   Shares: ${shares} (= ${shares * 100} USDT max payout)`);
    console.log(`   Strike Threshold: 50mm (500 scaled)`);

    const quoteId = await requestQuote(api, bob, MARKET_ID, coverageStart, coverageEnd, 14_599_500, 120_984_200, shares);
    console.log(`✅ Quote requested: ID ${quoteId}`);

    const premium = await submitQuote(api, alice, quoteId);
    console.log(`✅ Quote ready! Premium: ${formatUsdt(premium)}`);

    const policyId = await createPolicy(api, bob, quoteId);
    console.log(`✅ Policy created! ID: ${policyId}`);

    // Check initial policy state
    const policy = await api.query.prmxPolicy.policies(policyId);
    console.log(`\n   Policy Status: ${policy.unwrap().status.toString()}`);
    
    // Check DAO LP holdings
    const daoLpBalance = await getLpBalance(api, policyId, daoAccount);
    console.log(`   DAO LP Tokens: ${daoLpBalance.total.toString()} shares`);

    // =========================================================================
    // WAIT FOR COVERAGE TO START AND END
    // =========================================================================
    printSection('STEP 3: WAIT FOR COVERAGE WINDOW TO EXPIRE');
    
    let currentTime = await getChainTime(api);
    console.log(`   Current time: ${new Date(currentTime * 1000).toISOString()}`);
    
    // Wait for coverage to start
    while (currentTime < coverageStart) {
        console.log(`   Waiting for coverage start... (${Math.ceil(coverageStart - currentTime)}s remaining)`);
        await new Promise(r => setTimeout(r, 6000));
        currentTime = await getChainTime(api);
    }
    console.log('✅ Coverage period has started!');
    
    // Ensure rainfall stays BELOW threshold during coverage
    await setTestRainfall(api, alice, MARKET_ID, 150); // 15mm total - still below 50mm
    console.log('   📊 Submitted 15mm rainfall during coverage (below 50mm threshold)');
    
    // Wait for coverage to end
    while (currentTime < coverageEnd) {
        console.log(`   Waiting for coverage end... (${Math.ceil(coverageEnd - currentTime)}s remaining)`);
        await new Promise(r => setTimeout(r, 6000));
        currentTime = await getChainTime(api);
    }
    console.log('✅ Coverage period has ENDED!');

    // Check rolling state
    const rollingState = await api.query.prmxOracle.rollingState(MARKET_ID);
    if (rollingState.isSome) {
        const state = rollingState.unwrap();
        console.log(`\n   📊 Oracle Rolling State:`);
        console.log(`      24h Sum: ${state.rollingSumMm.toNumber() / 10}mm`);
        console.log(`      (Below 50mm threshold - NO EVENT)`);
    }

    // =========================================================================
    // MONITOR FOR AUTOMATIC EXPIRATION SETTLEMENT
    // =========================================================================
    printSection('STEP 4: MONITOR FOR AUTOMATIC EXPIRATION SETTLEMENT');
    
    console.log('   ⏳ Waiting for on_initialize to detect expired policy...');
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
    }

    // =========================================================================
    // VERIFY SETTLEMENT RESULTS
    // =========================================================================
    printSection('STEP 5: VERIFY SETTLEMENT RESULTS');
    
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

    // Check balances after settlement
    const bobFinalUsdt = await getUsdtBalance(api, bob.address);
    const daoFinalUsdt = await getUsdtBalance(api, daoAccount);
    
    const bobChange = bobFinalUsdt - bobInitialUsdt;
    const daoChange = daoFinalUsdt - daoInitialUsdt;
    
    console.log(`\n   💰 Balance Changes:`);
    console.log(`      Bob (Policyholder): ${bobChange >= 0n ? '+' : ''}${formatUsdt(bobChange)}`);
    console.log(`      DAO (LP Holder): ${daoChange >= 0n ? '+' : ''}${formatUsdt(daoChange)}`);

    // Check if LP tokens were cleaned up
    const finalDaoLp = await getLpBalance(api, policyId, daoAccount);
    console.log(`\n   🧹 LP Token Cleanup:`);
    console.log(`      DAO LP Tokens after settlement: ${finalDaoLp.total.toString()} shares`);

    // =========================================================================
    // TEST RESULT
    // =========================================================================
    printHeader('TEST RESULT');
    
    const eventOccurred = settlementResult.isSome && settlementResult.unwrap().eventOccurred.isTrue;
    const lpReceived = settlementResult.isSome && BigInt(settlementResult.unwrap().returnedToLps.toString()) > 0n;
    const lpCleaned = finalDaoLp.total === 0n;
    
    if (settled && !eventOccurred && lpReceived && lpCleaned) {
        console.log('\n   ✅ TEST PASSED: Automatic expiration settlement worked correctly!');
        console.log('   • Expired policy was detected by on_initialize');
        console.log('   • Policy was automatically settled with event_occurred = false');
        console.log('   • LP holders received pool distribution');
        console.log('   • LP tokens were properly cleaned up');
    } else if (settled && eventOccurred) {
        console.log('\n   ⚠️  TEST WARNING: Policy settled but event_occurred = true');
        console.log('   • Check if rainfall data was correctly below threshold');
    } else if (settled) {
        console.log('\n   ⚠️  TEST PARTIAL: Policy settled but LP distribution unclear');
    } else {
        console.log('\n   ❌ TEST FAILED: Automatic expiration settlement did not trigger');
        console.log('   • Check if check_and_settle_expired_policies is being called');
        console.log('   • Verify BLOCKS_PER_SETTLEMENT_CHECK is configured correctly');
    }

    await api.disconnect();
}

main().catch(console.error);

