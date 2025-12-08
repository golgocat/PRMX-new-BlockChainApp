#!/usr/bin/env node
/**
 * PRMX Test - LP Token Cleanup After Settlement
 * 
 * This test verifies that LP tokens are properly burned after settlement:
 * - Before settlement: LP tokens exist
 * - After settlement: LP tokens are destroyed
 * - Storage is cleaned up
 * 
 * Usage: node test-lp-cleanup.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

const WS_ENDPOINT = 'ws://127.0.0.1:9944';
const USDT_ASSET_ID = 1;
const MARKET_ID = 0;
const COVERAGE_DURATION_SECS = 60;

function formatUsdt(balance) {
    return `${(Number(balance) / 1e6).toFixed(2)} USDT`;
}

async function getUsdtBalance(api, address) {
    const usdt = await api.query.assets.account(USDT_ASSET_ID, address);
    return usdt.isSome ? BigInt(usdt.unwrap().balance.toString()) : 0n;
}

async function getLpHoldings(api, policyId, address) {
    const holdings = await api.query.prmxHoldings.holdingsStorage(policyId, address);
    return {
        free: BigInt(holdings.lpShares.toString()),
        locked: BigInt(holdings.lockedShares.toString()),
    };
}

async function main() {
    console.log('='.repeat(70));
    console.log('PRMX TEST - LP TOKEN CLEANUP AFTER SETTLEMENT');
    console.log('='.repeat(70));
    console.log('');
    console.log('📋 This test verifies:');
    console.log('   1. LP tokens exist before settlement');
    console.log('   2. LP tokens are DESTROYED after settlement');
    console.log('   3. Storage is properly cleaned up');
    console.log('');

    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    console.log('✅ Connected to PRMX node');
    
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');
    const charlie = keyring.addFromUri('//Charlie');
    
    const daoAccountHex = '0x' + '00'.repeat(32);
    const { encodeAddress } = await import('@polkadot/util-crypto');
    const daoAccount = encodeAddress(daoAccountHex, 42);

    const chainTimestamp = await api.query.timestamp.now();
    const chainNow = chainTimestamp.toNumber() / 1000;

    // Setup oracle
    const locationConfig = await api.query.prmxOracle.marketLocationConfig(MARKET_ID);
    if (!locationConfig.isSome) {
        const bindTx = api.tx.sudo.sudo(
            api.tx.prmxOracle.setMarketLocationKey(MARKET_ID, '3423441')
        );
        await new Promise((resolve) => {
            bindTx.signAndSend(alice, ({ status }) => {
                if (status.isInBlock) resolve();
            });
        });
    }
    await new Promise((resolve) => {
        api.tx.prmxOracle.submitRainfall(MARKET_ID, Math.floor(chainNow), 100)
            .signAndSend(alice, ({ status }) => {
                if (status.isInBlock) resolve();
            });
    });
    console.log('✅ Oracle setup complete');

    // =========================================================================
    // CREATE POLICY
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 1: CREATE POLICY');
    console.log('─'.repeat(70));

    const coverageStart = Math.floor(chainNow + 10);
    const coverageEnd = coverageStart + COVERAGE_DURATION_SECS;

    let quoteId;
    await new Promise((resolve) => {
        api.tx.prmxQuote.requestPolicyQuote(
            MARKET_ID, coverageStart, coverageEnd, 14_599_500, 120_984_200, 2
        ).signAndSend(bob, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxQuote' && event.method === 'QuoteRequested') {
                        quoteId = event.data[0].toNumber();
                    }
                }
                resolve();
            }
        });
    });

    await new Promise((resolve) => {
        api.tx.prmxQuote.submitQuote(quoteId, 50_000).signAndSend(alice, ({ status }) => {
            if (status.isInBlock) resolve();
        });
    });

    let policyId;
    await new Promise((resolve) => {
        api.tx.prmxPolicy.applyCoverageWithQuote(quoteId).signAndSend(bob, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxPolicy' && event.method === 'PolicyCreated') {
                        policyId = event.data[0].toNumber();
                    }
                }
                resolve();
            }
        });
    });
    console.log(`✅ Policy ${policyId} created with 2 LP tokens`);

    // Charlie buys 1 LP
    await new Promise((resolve) => {
        api.tx.prmxOrderbookLp.buyLp(policyId, 100_000_000n, 1).signAndSend(charlie, ({ status }) => {
            if (status.isInBlock) resolve();
        });
    });
    console.log('✅ Charlie bought 1 LP token');

    // =========================================================================
    // CHECK LP TOKENS BEFORE SETTLEMENT
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 2: CHECK LP TOKENS BEFORE SETTLEMENT');
    console.log('─'.repeat(70));

    const daoLpBefore = await getLpHoldings(api, policyId, daoAccount);
    const charlieLpBefore = await getLpHoldings(api, policyId, charlie.address);
    const totalLpBefore = await api.query.prmxHoldings.totalLpShares(policyId);
    const holdersBefore = await api.query.prmxHoldings.lpHolders(policyId);

    console.log(`\n   📊 LP TOKEN STATE (Before Settlement):`);
    console.log(`      DAO LP tokens: ${daoLpBefore.free + daoLpBefore.locked}`);
    console.log(`      Charlie LP tokens: ${charlieLpBefore.free + charlieLpBefore.locked}`);
    console.log(`      Total LP shares: ${totalLpBefore.toString()}`);
    console.log(`      Registered LP holders: ${holdersBefore.length}`);

    // =========================================================================
    // WAIT AND SETTLE
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 3: WAIT FOR COVERAGE TO END AND SETTLE');
    console.log('─'.repeat(70));

    let currentChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    const waitTime = Math.max(0, coverageEnd - currentChainTs + 15);
    
    console.log(`⏳ Waiting ${waitTime.toFixed(0)} seconds...`);
    for (let i = waitTime; i > 0; i -= 15) {
        console.log(`   ${i.toFixed(0)} seconds remaining...`);
        await new Promise(r => setTimeout(r, Math.min(15000, i * 1000)));
    }

    let settlementChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    while (settlementChainTs <= coverageEnd) {
        await new Promise(r => setTimeout(r, 6000));
        settlementChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    }
    await new Promise(r => setTimeout(r, 12000));
    
    const charlieUsdtBefore = await getUsdtBalance(api, charlie.address);
    const daoUsdtBefore = await getUsdtBalance(api, daoAccount);

    // Settle
    await new Promise((resolve) => {
        api.tx.prmxPolicy.settlePolicy(policyId, false).signAndSend(alice, ({ status, events }) => {
            if (status.isInBlock) {
                console.log('\n   📋 Settlement Events:');
                for (const { event } of events) {
                    if (event.section === 'prmxHoldings') {
                        console.log(`      • ${event.method}`);
                    }
                }
                resolve();
            }
        });
    });

    const charlieUsdtAfter = await getUsdtBalance(api, charlie.address);
    const daoUsdtAfter = await getUsdtBalance(api, daoAccount);
    
    console.log(`\n   💰 USDT Payouts:`);
    console.log(`      Charlie received: +${formatUsdt(charlieUsdtAfter - charlieUsdtBefore)}`);
    console.log(`      DAO received: +${formatUsdt(daoUsdtAfter - daoUsdtBefore)}`);

    // =========================================================================
    // CHECK LP TOKENS AFTER SETTLEMENT
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 4: CHECK LP TOKENS AFTER SETTLEMENT');
    console.log('─'.repeat(70));

    const daoLpAfter = await getLpHoldings(api, policyId, daoAccount);
    const charlieLpAfter = await getLpHoldings(api, policyId, charlie.address);
    const totalLpAfter = await api.query.prmxHoldings.totalLpShares(policyId);
    const holdersAfter = await api.query.prmxHoldings.lpHolders(policyId);

    console.log(`\n   📊 LP TOKEN STATE (After Settlement):`);
    console.log(`      DAO LP tokens: ${daoLpAfter.free + daoLpAfter.locked} ${daoLpAfter.free + daoLpAfter.locked === 0n ? '✅ BURNED' : '❌ NOT BURNED'}`);
    console.log(`      Charlie LP tokens: ${charlieLpAfter.free + charlieLpAfter.locked} ${charlieLpAfter.free + charlieLpAfter.locked === 0n ? '✅ BURNED' : '❌ NOT BURNED'}`);
    console.log(`      Total LP shares: ${totalLpAfter.toString()} ${totalLpAfter.toString() === '0' ? '✅ CLEARED' : '❌ NOT CLEARED'}`);
    console.log(`      Registered LP holders: ${holdersAfter.length} ${holdersAfter.length === 0 ? '✅ CLEARED' : '❌ NOT CLEARED'}`);

    // =========================================================================
    // SUMMARY
    // =========================================================================
    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));

    console.log(`\n   ┌─────────────────────────────────────────────────────────────────┐`);
    console.log(`   │                    BEFORE          AFTER          STATUS        │`);
    console.log(`   ├─────────────────────────────────────────────────────────────────┤`);
    console.log(`   │ DAO LP tokens:     ${String(daoLpBefore.free + daoLpBefore.locked).padStart(5)}           ${String(daoLpAfter.free + daoLpAfter.locked).padStart(5)}           ${daoLpAfter.free + daoLpAfter.locked === 0n ? '✅ BURNED' : '❌ EXISTS'} │`);
    console.log(`   │ Charlie LP:        ${String(charlieLpBefore.free + charlieLpBefore.locked).padStart(5)}           ${String(charlieLpAfter.free + charlieLpAfter.locked).padStart(5)}           ${charlieLpAfter.free + charlieLpAfter.locked === 0n ? '✅ BURNED' : '❌ EXISTS'} │`);
    console.log(`   │ Total LP shares:   ${totalLpBefore.toString().padStart(5)}           ${totalLpAfter.toString().padStart(5)}           ${totalLpAfter.toString() === '0' ? '✅ CLEARED' : '❌ EXISTS'} │`);
    console.log(`   │ LP holders list:   ${String(holdersBefore.length).padStart(5)}           ${String(holdersAfter.length).padStart(5)}           ${holdersAfter.length === 0 ? '✅ CLEARED' : '❌ EXISTS'} │`);
    console.log(`   └─────────────────────────────────────────────────────────────────┘`);

    const allCleared = (daoLpAfter.free + daoLpAfter.locked === 0n) && 
                       (charlieLpAfter.free + charlieLpAfter.locked === 0n) &&
                       (totalLpAfter.toString() === '0') &&
                       (holdersAfter.length === 0);

    console.log(`\n   ${allCleared ? '✅ ALL LP TOKENS PROPERLY CLEANED UP!' : '❌ CLEANUP INCOMPLETE'}`);

    await api.disconnect();
}

main().catch(console.error);

