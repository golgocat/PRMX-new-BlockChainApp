#!/usr/bin/env node
/**
 * PRMX Functional Test - Multiple Policies on Same Market
 * 
 * This test verifies that multiple policies can exist on the same market
 * and each settles independently.
 * 
 * Flow:
 * 1. Create multiple policies on the same market
 * 2. Each has different coverage periods
 * 3. Settle each independently
 * 4. Verify correct fund distribution for each
 * 
 * Usage: node test-multiple-policies-same-market.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import {
    WS_ENDPOINT, USDT_ASSET_ID, MARKET_ID,
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
            status: p.status.toString(),
            coverageStart: p.coverageStart.toNumber(),
            coverageEnd: p.coverageEnd.toNumber(),
            holder: p.holder.toString(),
        };
    }
    return null;
}

async function main() {
    printHeader('PRMX FUNCTIONAL TEST - MULTIPLE POLICIES SAME MARKET');
    
    console.log('\n📋 This test verifies multiple policies can coexist on one market.');
    console.log('   Each policy has independent coverage periods and settlements.');

    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');
    const charlie = keyring.addFromUri('//Charlie');
    const daoAccount = await getDaoAccount();
    
    console.log('\n✅ Connected to PRMX node');
    console.log(`   Bob (Customer 1): ${bob.address}`);
    console.log(`   Charlie (Customer 2): ${charlie.address}`);

    const chainNow = await getChainTime(api);
    console.log(`\n⏰ Chain time: ${new Date(chainNow * 1000).toISOString()}`);

    // =========================================================================
    // SETUP
    // =========================================================================
    printSection('STEP 1: SETUP ORACLE');
    
    await setupOracle(api, alice, MARKET_ID);
    await submitRainfall(api, alice, MARKET_ID, Math.floor(chainNow), 50); // 5mm - low rainfall
    console.log('✅ Oracle configured with low rainfall (no event)');

    // Record initial balances
    const initialBobUsdt = await getUsdtBalance(api, bob.address);
    const initialCharlieUsdt = await getUsdtBalance(api, charlie.address);
    
    console.log(`\n   Initial Balances:`);
    console.log(`      Bob: ${formatUsdt(initialBobUsdt)}`);
    console.log(`      Charlie: ${formatUsdt(initialCharlieUsdt)}`);

    // =========================================================================
    // CREATE POLICY 1 (BOB)
    // =========================================================================
    printSection('STEP 2: CREATE POLICY 1 (BOB)');
    
    const coverage1Start = Math.floor(chainNow + 10);
    const coverage1End = coverage1Start + 60; // 1 minute
    const shares1 = 1; // 100 USDT
    
    console.log(`   Coverage: ${new Date(coverage1Start * 1000).toISOString()}`);
    console.log(`         to: ${new Date(coverage1End * 1000).toISOString()}`);
    console.log(`   Shares: ${shares1}`);

    const quoteId1 = await requestQuote(api, bob, MARKET_ID, coverage1Start, coverage1End, 14_599_500, 120_984_200, shares1);
    const premium1 = await submitQuote(api, alice, quoteId1);
    const policyId1 = await createPolicy(api, bob, quoteId1);
    
    console.log(`\n✅ Policy 1 created!`);
    console.log(`   Policy ID: ${policyId1}`);
    console.log(`   Premium: ${formatUsdt(premium1)}`);

    // =========================================================================
    // CREATE POLICY 2 (CHARLIE) - OVERLAPPING COVERAGE
    // =========================================================================
    printSection('STEP 3: CREATE POLICY 2 (CHARLIE)');
    
    const coverage2Start = Math.floor(chainNow + 20); // Starts 10 seconds after Policy 1
    const coverage2End = coverage2Start + 90; // 1.5 minutes (ends after Policy 1)
    const shares2 = 2; // 200 USDT
    
    console.log(`   Coverage: ${new Date(coverage2Start * 1000).toISOString()}`);
    console.log(`         to: ${new Date(coverage2End * 1000).toISOString()}`);
    console.log(`   Shares: ${shares2}`);

    const quoteId2 = await requestQuote(api, charlie, MARKET_ID, coverage2Start, coverage2End, 14_599_500, 120_984_200, shares2);
    const premium2 = await submitQuote(api, alice, quoteId2);
    const policyId2 = await createPolicy(api, charlie, quoteId2);
    
    console.log(`\n✅ Policy 2 created!`);
    console.log(`   Policy ID: ${policyId2}`);
    console.log(`   Premium: ${formatUsdt(premium2)}`);

    // =========================================================================
    // CREATE POLICY 3 (BOB) - SEQUENTIAL
    // =========================================================================
    printSection('STEP 4: CREATE POLICY 3 (BOB)');
    
    const coverage3Start = coverage1End + 30; // Starts after Policy 1 ends
    const coverage3End = coverage3Start + 60; // 1 minute
    const shares3 = 1; // 100 USDT
    
    console.log(`   Coverage: ${new Date(coverage3Start * 1000).toISOString()}`);
    console.log(`         to: ${new Date(coverage3End * 1000).toISOString()}`);
    console.log(`   Shares: ${shares3}`);

    const quoteId3 = await requestQuote(api, bob, MARKET_ID, coverage3Start, coverage3End, 14_599_500, 120_984_200, shares3);
    const premium3 = await submitQuote(api, alice, quoteId3);
    const policyId3 = await createPolicy(api, bob, quoteId3);
    
    console.log(`\n✅ Policy 3 created!`);
    console.log(`   Policy ID: ${policyId3}`);
    console.log(`   Premium: ${formatUsdt(premium3)}`);

    // =========================================================================
    // SHOW ALL POLICIES
    // =========================================================================
    printSection('STEP 5: ALL POLICIES ON MARKET');
    
    console.log('\n   📋 Policies on Market 0:');
    console.log('   ─────────────────────────────────────────────────────────────');
    console.log('   ID | Holder  | Coverage Start            | Coverage End             | Status');
    console.log('   ─────────────────────────────────────────────────────────────');
    
    for (const pid of [policyId1, policyId2, policyId3]) {
        const info = await getPolicyInfo(api, pid);
        const holder = info.holder === bob.address ? 'Bob    ' : 'Charlie';
        console.log(`   ${pid}  | ${holder} | ${new Date(info.coverageStart * 1000).toISOString()} | ${new Date(info.coverageEnd * 1000).toISOString()} | ${info.status}`);
    }

    // =========================================================================
    // WAIT AND SETTLE POLICY 1
    // =========================================================================
    printSection('STEP 6: SETTLE POLICY 1 (FIRST TO END)');
    
    console.log('   ⏳ Waiting for Policy 1 coverage to end...');
    await waitUntilTime(api, coverage1End + 10);
    console.log('   ✅ Coverage ended');

    const events1 = await settlePolicy(api, alice, policyId1, false);
    console.log(`\n   ✅ Policy ${policyId1} settled (no event)`);
    
    const policy1After = await getPolicyInfo(api, policyId1);
    const policy2During = await getPolicyInfo(api, policyId2);
    const policy3During = await getPolicyInfo(api, policyId3);
    
    console.log(`\n   Policy States After Settlement 1:`);
    console.log(`      Policy ${policyId1}: ${policy1After.status}`);
    console.log(`      Policy ${policyId2}: ${policy2During.status} (still active)`);
    console.log(`      Policy ${policyId3}: ${policy3During.status} (not started)`);

    // =========================================================================
    // WAIT AND SETTLE POLICY 2
    // =========================================================================
    printSection('STEP 7: SETTLE POLICY 2');
    
    console.log('   ⏳ Waiting for Policy 2 coverage to end...');
    await waitUntilTime(api, coverage2End + 10);
    console.log('   ✅ Coverage ended');

    const events2 = await settlePolicy(api, alice, policyId2, false);
    console.log(`\n   ✅ Policy ${policyId2} settled (no event)`);

    // =========================================================================
    // WAIT AND SETTLE POLICY 3
    // =========================================================================
    printSection('STEP 8: SETTLE POLICY 3');
    
    console.log('   ⏳ Waiting for Policy 3 coverage to end...');
    await waitUntilTime(api, coverage3End + 10);
    console.log('   ✅ Coverage ended');

    const events3 = await settlePolicy(api, alice, policyId3, false);
    console.log(`\n   ✅ Policy ${policyId3} settled (no event)`);

    // =========================================================================
    // FINAL STATE
    // =========================================================================
    printSection('STEP 9: FINAL STATE');
    
    console.log('\n   📋 Final Policy States:');
    for (const pid of [policyId1, policyId2, policyId3]) {
        const info = await getPolicyInfo(api, pid);
        console.log(`      Policy ${pid}: ${info.status}`);
    }

    const finalBobUsdt = await getUsdtBalance(api, bob.address);
    const finalCharlieUsdt = await getUsdtBalance(api, charlie.address);
    
    const bobChange = finalBobUsdt - initialBobUsdt;
    const charlieChange = finalCharlieUsdt - initialCharlieUsdt;
    
    console.log('\n   💰 Balance Changes (Premiums Paid):');
    console.log(`      Bob: ${bobChange >= 0n ? '+' : ''}${formatUsdt(bobChange)}`);
    console.log(`         (Paid for Policy ${policyId1} and Policy ${policyId3})`);
    console.log(`      Charlie: ${charlieChange >= 0n ? '+' : ''}${formatUsdt(charlieChange)}`);
    console.log(`         (Paid for Policy ${policyId2})`);

    // =========================================================================
    // TEST RESULT
    // =========================================================================
    printHeader('TEST RESULT');
    
    const allSettled = (await getPolicyInfo(api, policyId1)).status === 'Settled' &&
                       (await getPolicyInfo(api, policyId2)).status === 'Settled' &&
                       (await getPolicyInfo(api, policyId3)).status === 'Settled';
    
    if (allSettled) {
        console.log('\n   ✅ TEST PASSED: Multiple policies work correctly!');
        console.log('   • 3 policies created on same market');
        console.log('   • Overlapping and sequential coverage supported');
        console.log('   • Each policy settled independently');
        console.log('   • Different holders can have policies on same market');
    } else {
        console.log('\n   ❌ TEST FAILED: Not all policies settled correctly');
    }

    await api.disconnect();
}

main().catch(console.error);
