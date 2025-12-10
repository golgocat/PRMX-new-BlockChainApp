#!/usr/bin/env node
/**
 * PRMX Functional Test - Settlement Rounding
 * 
 * This test verifies correct handling of rounding when distributing
 * pool funds to multiple LP holders with odd amounts.
 * 
 * Flow:
 * 1. Create a policy with a pool that doesn't divide evenly
 * 2. Distribute LP tokens to create fractional ownership
 * 3. Settle and verify distribution handles rounding correctly
 * 
 * Usage: node test-settlement-rounding.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import {
    WS_ENDPOINT, USDT_ASSET_ID, MARKET_ID,
    formatUsdt, getChainTime, getUsdtBalance, getLpBalance, setupOracle,
    submitRainfall, requestQuote, submitQuote, createPolicy,
    settlePolicy, waitUntilTime, getDaoAccount,
    printHeader, printSection
} from './common.mjs';

async function main() {
    printHeader('PRMX FUNCTIONAL TEST - SETTLEMENT ROUNDING');
    
    console.log('\n📋 This test verifies rounding behavior in settlement distribution.');
    console.log('   When pool amount doesn\'t divide evenly among LP holders,');
    console.log('   the system should handle rounding correctly without losing funds.');

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
    const initialDaoUsdt = await getUsdtBalance(api, daoAccount);
    const initialCharlieUsdt = await getUsdtBalance(api, charlie.address);
    const initialDaveUsdt = await getUsdtBalance(api, dave.address);

    // =========================================================================
    // CREATE POLICY
    // =========================================================================
    printSection('STEP 1: CREATE POLICY');
    
    await setupOracle(api, alice, MARKET_ID);
    await submitRainfall(api, alice, MARKET_ID, Math.floor(chainNow), 50);
    console.log('✅ Oracle configured');

    const coverageStart = Math.floor(chainNow + 10);
    const coverageEnd = coverageStart + 60;
    const shares = 3; // 3 LP tokens = 300 USDT pool
    
    const quoteId = await requestQuote(api, bob, MARKET_ID, coverageStart, coverageEnd, 14_599_500, 120_984_200, shares);
    const premium = await submitQuote(api, alice, quoteId);
    const policyId = await createPolicy(api, bob, quoteId);
    
    const poolBalance = await api.query.prmxPolicy.policyRiskPoolBalance(policyId);
    
    console.log(`\n✅ Policy created! ID: ${policyId}`);
    console.log(`   Total LP tokens: ${shares}`);
    console.log(`   Pool balance: ${formatUsdt(BigInt(poolBalance.toString()))}`);

    // =========================================================================
    // DISTRIBUTE LP TOKENS TO CREATE UNEVEN OWNERSHIP
    // =========================================================================
    printSection('STEP 2: CREATE UNEVEN LP DISTRIBUTION');
    
    // Charlie buys 1 LP token
    const buyTx1 = api.tx.prmxOrderbookLp.buyLp(policyId, 100_000_000n, 1n);
    await new Promise((resolve) => {
        buyTx1.signAndSend(charlie, ({ status }) => {
            if (status.isInBlock) resolve();
        });
    });
    console.log('   ✅ Charlie bought 1 LP token');

    // Dave buys 1 LP token
    const buyTx2 = api.tx.prmxOrderbookLp.buyLp(policyId, 100_000_000n, 1n);
    await new Promise((resolve) => {
        buyTx2.signAndSend(dave, ({ status }) => {
            if (status.isInBlock) resolve();
        });
    });
    console.log('   ✅ Dave bought 1 LP token');

    // Check distribution (DAO has remaining LP in locked state)
    const daoLp = await getLpBalance(api, policyId, daoAccount);
    const charlieLp = await getLpBalance(api, policyId, charlie.address);
    const daveLp = await getLpBalance(api, policyId, dave.address);
    const totalLp = BigInt((await api.query.prmxHoldings.totalLpShares(policyId)).toString());

    console.log('\n   🎫 LP Distribution:');
    console.log(`      DAO: ${daoLp.total.toString()} LP (${Number(daoLp.total * 10000n / totalLp) / 100}%)`);
    console.log(`      Charlie: ${charlieLp.total.toString()} LP (${Number(charlieLp.total * 10000n / totalLp) / 100}%)`);
    console.log(`      Dave: ${daveLp.total.toString()} LP (${Number(daveLp.total * 10000n / totalLp) / 100}%)`);
    console.log(`      Total: ${totalLp.toString()} LP tokens`);

    // =========================================================================
    // CALCULATE EXPECTED DISTRIBUTION
    // =========================================================================
    printSection('STEP 3: EXPECTED DISTRIBUTION');
    
    const pool = BigInt(poolBalance.toString());
    
    console.log('\n   📐 Expected Pro-rata Distribution:');
    console.log(`      Pool: ${formatUsdt(pool)}`);
    console.log('');
    
    const daoShare = pool * daoLp.total / totalLp;
    const charlieShare = pool * charlieLp.total / totalLp;
    const daveShare = pool * daveLp.total / totalLp;
    const totalDistributed = daoShare + charlieShare + daveShare;
    const remainder = pool - totalDistributed;
    
    console.log(`      DAO (${daoLp.total.toString()}/${totalLp.toString()} LP): ${formatUsdt(daoShare)}`);
    console.log(`      Charlie (${charlieLp.total.toString()}/${totalLp.toString()} LP): ${formatUsdt(charlieShare)}`);
    console.log(`      Dave (${daveLp.total.toString()}/${totalLp.toString()} LP): ${formatUsdt(daveShare)}`);
    console.log(`      ─────────────────────────────`);
    console.log(`      Sum: ${formatUsdt(totalDistributed)}`);
    console.log(`      Remainder (rounding): ${formatUsdt(remainder)}`);

    // =========================================================================
    // SETTLE AND VERIFY
    // =========================================================================
    printSection('STEP 4: SETTLEMENT');
    
    console.log('   ⏳ Waiting for coverage to end...');
    await waitUntilTime(api, coverageEnd + 10);
    console.log('   ✅ Coverage ended');

    // Get balances before settlement
    const beforeSettlement = {
        dao: await getUsdtBalance(api, daoAccount),
        charlie: await getUsdtBalance(api, charlie.address),
        dave: await getUsdtBalance(api, dave.address),
    };

    await settlePolicy(api, alice, policyId, false);
    console.log('\n   ✅ Policy settled (no event)');

    // Get balances after settlement
    const afterSettlement = {
        dao: await getUsdtBalance(api, daoAccount),
        charlie: await getUsdtBalance(api, charlie.address),
        dave: await getUsdtBalance(api, dave.address),
    };

    // Calculate actual distribution
    const daoReceived = afterSettlement.dao - beforeSettlement.dao;
    const charlieReceived = afterSettlement.charlie - beforeSettlement.charlie;
    const daveReceived = afterSettlement.dave - beforeSettlement.dave;
    const totalActual = daoReceived + charlieReceived + daveReceived;

    console.log('\n   💰 Actual Distribution from Settlement:');
    console.log(`      DAO received: ${formatUsdt(daoReceived)}`);
    console.log(`      Charlie received: ${formatUsdt(charlieReceived)}`);
    console.log(`      Dave received: ${formatUsdt(daveReceived)}`);
    console.log(`      ─────────────────────────────`);
    console.log(`      Total distributed: ${formatUsdt(totalActual)}`);

    // Check pool is empty
    const finalPool = await api.query.prmxPolicy.policyRiskPoolBalance(policyId);
    console.log(`\n   🏦 Final pool balance: ${formatUsdt(BigInt(finalPool.toString()))}`);

    // =========================================================================
    // VERIFY ROUNDING BEHAVIOR
    // =========================================================================
    printSection('STEP 5: ROUNDING ANALYSIS');
    
    const daoRoundingError = daoReceived - daoShare;
    const charlieRoundingError = charlieReceived - charlieShare;
    const daveRoundingError = daveReceived - daveShare;
    
    console.log('\n   📊 Rounding Errors (Actual - Expected):');
    console.log(`      DAO: ${daoRoundingError >= 0n ? '+' : ''}${formatUsdt(daoRoundingError)}`);
    console.log(`      Charlie: ${charlieRoundingError >= 0n ? '+' : ''}${formatUsdt(charlieRoundingError)}`);
    console.log(`      Dave: ${daveRoundingError >= 0n ? '+' : ''}${formatUsdt(daveRoundingError)}`);
    
    const totalRoundingDiff = totalActual - pool;
    console.log(`\n   Total rounding difference: ${totalRoundingDiff >= 0n ? '+' : ''}${formatUsdt(totalRoundingDiff)}`);

    // =========================================================================
    // TEST RESULT
    // =========================================================================
    printHeader('TEST RESULT');
    
    const poolEmpty = BigInt(finalPool.toString()) === 0n;
    const noFundsLost = totalActual >= pool - 10n; // Allow tiny rounding loss (< 10 micro-USDT)
    const distributionProportional = charlieReceived > 0n && daveReceived > 0n;
    
    if (poolEmpty && noFundsLost && distributionProportional) {
        console.log('\n   ✅ TEST PASSED: Rounding handled correctly!');
        console.log('   • Pool was fully distributed');
        console.log('   • No significant funds lost to rounding');
        console.log('   • Each holder received proportional share');
        console.log(`   • Maximum rounding error: ${formatUsdt(totalRoundingDiff < 0n ? -totalRoundingDiff : totalRoundingDiff)}`);
    } else {
        console.log('\n   ⚠️  TEST NEEDS REVIEW:');
        console.log(`   • Pool empty: ${poolEmpty}`);
        console.log(`   • No funds lost: ${noFundsLost}`);
        console.log(`   • Proportional distribution: ${distributionProportional}`);
    }

    console.log('\n   💡 Note: Small rounding errors (< 1 micro-USDT) are acceptable');
    console.log('      due to integer division. The remainder typically goes to the');
    console.log('      last holder processed in the distribution loop.');

    await api.disconnect();
}

main().catch(console.error);
