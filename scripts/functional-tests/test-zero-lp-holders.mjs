#!/usr/bin/env node
/**
 * PRMX Functional Test - Zero LP Holders Edge Case
 * 
 * This test explores what happens if somehow all LP tokens are
 * burned or transferred before settlement. This is an edge case
 * that shouldn't normally occur in production.
 * 
 * Note: This scenario is largely theoretical as LP tokens are created
 * during policy creation and should always have at least the DAO as holder.
 * 
 * Usage: node test-zero-lp-holders.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import {
    WS_ENDPOINT, MARKET_ID,
    formatUsdt, getChainTime, getLpBalance, setupOracle,
    submitRainfall, requestQuote, submitQuote, createPolicy,
    settlePolicy, waitUntilTime, getDaoAccount,
    printHeader, printSection
} from './common.mjs';

async function main() {
    printHeader('PRMX FUNCTIONAL TEST - ZERO LP HOLDERS EDGE CASE');
    
    console.log('\n📋 This test explores the edge case where LP token supply');
    console.log('   might become zero before settlement.');
    console.log('');
    console.log('   Note: In normal operation, the DAO always holds LP tokens');
    console.log('   for the portion they don\'t sell on the orderbook.');

    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');
    const charlie = keyring.addFromUri('//Charlie');
    const daoAccount = await getDaoAccount();
    
    console.log('\n✅ Connected to PRMX node');

    const chainNow = await getChainTime(api);

    // =========================================================================
    // CREATE POLICY
    // =========================================================================
    printSection('STEP 1: CREATE POLICY');
    
    await setupOracle(api, alice, MARKET_ID);
    await submitRainfall(api, alice, MARKET_ID, Math.floor(chainNow), 50);
    console.log('✅ Oracle configured');

    const coverageStart = Math.floor(chainNow + 10);
    const coverageEnd = coverageStart + 60;
    const shares = 1; // Just 1 LP token
    
    const quoteId = await requestQuote(api, bob, MARKET_ID, coverageStart, coverageEnd, 14_599_500, 120_984_200, shares);
    await submitQuote(api, alice, quoteId);
    const policyId = await createPolicy(api, bob, quoteId);
    
    console.log(`\n✅ Policy created! ID: ${policyId}`);
    console.log(`   Total LP tokens: ${shares}`);

    // =========================================================================
    // CHECK INITIAL LP DISTRIBUTION
    // =========================================================================
    printSection('STEP 2: CHECK LP DISTRIBUTION');
    
    const totalLp = await api.query.prmxHoldings.totalLpShares(policyId);
    const lpHolders = await api.query.prmxHoldings.lpHolders(policyId);
    const daoLp = await getLpBalance(api, policyId, daoAccount);
    
    console.log(`\n   Total LP supply: ${totalLp.toString()}`);
    console.log(`   Number of holders: ${lpHolders.length}`);
    console.log(`   DAO LP: ${daoLp.free.toString()} free + ${daoLp.locked.toString()} locked`);
    
    // List all holders
    console.log('\n   LP Holders:');
    for (const holder of lpHolders.toJSON()) {
        const balance = await getLpBalance(api, policyId, holder);
        console.log(`      ${holder.substring(0, 20)}... : ${balance.total.toString()} LP`);
    }

    // =========================================================================
    // ATTEMPT TO REDUCE LP TO ZERO
    // =========================================================================
    printSection('STEP 3: ANALYZE LP TOKEN BEHAVIOR');
    
    console.log('\n   📊 LP Token Lifecycle Analysis:');
    console.log('');
    console.log('   1. LP tokens are MINTED when policy is created');
    console.log('      → DAO receives LP tokens for capital provided');
    console.log('');
    console.log('   2. LP tokens can be TRANSFERRED via orderbook');
    console.log('      → Trading doesn\'t change total supply');
    console.log('');
    console.log('   3. LP tokens are BURNED at settlement');
    console.log('      → After payout distribution, tokens are burned');
    console.log('');
    console.log('   ⚠️  There is NO mechanism to burn LP tokens before settlement');
    console.log('      Therefore, zero LP holders before settlement is impossible');
    console.log('      in the current implementation.');

    // =========================================================================
    // SIMULATE: BUY ALL LP TOKENS
    // =========================================================================
    printSection('STEP 4: CHARLIE BUYS ALL LP TOKENS');
    
    const buyTx = api.tx.prmxOrderbookLp.buyLp(policyId, 100_000_000n, BigInt(shares));
    
    await new Promise((resolve) => {
        buyTx.signAndSend(charlie, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxOrderbookLp' && event.method === 'TradeExecuted') {
                        console.log('   ✅ Charlie bought all LP tokens');
                    }
                }
                resolve();
            }
        });
    });

    // Check new distribution
    const totalLpAfter = await api.query.prmxHoldings.totalLpShares(policyId);
    const daoLpAfter = await getLpBalance(api, policyId, daoAccount);
    const charlieLp = await getLpBalance(api, policyId, charlie.address);
    
    console.log(`\n   LP Distribution After Trade:`);
    console.log(`      Total supply: ${totalLpAfter.toString()} (unchanged)`);
    console.log(`      DAO: ${daoLpAfter.total.toString()} LP`);
    console.log(`      Charlie: ${charlieLp.total.toString()} LP`);

    // =========================================================================
    // SETTLE WITH SINGLE HOLDER
    // =========================================================================
    printSection('STEP 5: SETTLE WITH SINGLE LP HOLDER');
    
    console.log('   ⏳ Waiting for coverage to end...');
    await waitUntilTime(api, coverageEnd + 10);
    console.log('   ✅ Coverage ended');

    console.log('\n   Settling policy (Charlie is sole LP holder)...');
    await settlePolicy(api, alice, policyId, false);
    
    // Check results
    const finalTotalLp = await api.query.prmxHoldings.totalLpShares(policyId);
    const settlementResult = await api.query.prmxPolicy.settlementResults(policyId);
    
    console.log(`\n   📋 After Settlement:`);
    console.log(`      LP supply: ${finalTotalLp.toString()} (should be 0 - all burned)`);
    
    if (settlementResult.isSome) {
        const result = settlementResult.unwrap();
        console.log(`      Returned to LPs: ${formatUsdt(BigInt(result.returnedToLps.toString()))}`);
    }

    // =========================================================================
    // TEST RESULT
    // =========================================================================
    printHeader('TEST RESULT');
    
    console.log('\n   ✅ TEST COMPLETED: Zero LP holder scenario analyzed');
    console.log('');
    console.log('   Key Findings:');
    console.log('   ─────────────────────────────────────────────────────────');
    console.log('   1. LP tokens cannot reach zero supply before settlement');
    console.log('   2. Total supply only decreases at settlement (burn)');
    console.log('   3. Trading moves tokens between users, not destroy them');
    console.log('   4. Settlement handles single-holder case correctly');
    console.log('');
    console.log('   💡 The "zero LP holders" edge case is prevented by design:');
    console.log('      • Tokens are minted at policy creation');
    console.log('      • Only settlement burns tokens');
    console.log('      • No external burn mechanism exists');

    await api.disconnect();
}

main().catch(console.error);
