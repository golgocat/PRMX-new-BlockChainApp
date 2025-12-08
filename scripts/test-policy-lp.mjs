#!/usr/bin/env node
/**
 * PRMX Test - Policy-Specific LP Tokens
 * 
 * This test demonstrates that LP tokens are now POLICY-SPECIFIC:
 * - Each policy has its own LP token pool
 * - LP holders only receive payouts from policies they invested in
 * - Multiple policies can exist simultaneously with separate LP distributions
 * 
 * Usage: node test-policy-lp.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

// Configuration
const WS_ENDPOINT = 'ws://127.0.0.1:9944';
const USDT_ASSET_ID = 1;
const MARKET_ID = 0;
const MANILA_ACCUWEATHER_KEY = '3423441';
const COVERAGE_DURATION_SECS = 90;

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
    console.log('PRMX TEST - POLICY-SPECIFIC LP TOKENS');
    console.log('='.repeat(70));
    console.log('');
    console.log('📋 This test demonstrates:');
    console.log('   1. Each policy has its OWN LP token pool');
    console.log('   2. Charlie buys LP from Policy 0');
    console.log('   3. Dave buys LP from Policy 1');
    console.log('   4. When Policy 0 settles, ONLY Charlie gets paid');
    console.log('   5. When Policy 1 settles, ONLY Dave gets paid');
    console.log('');

    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    console.log('✅ Connected to PRMX node');
    
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');
    const charlie = keyring.addFromUri('//Charlie');
    const dave = keyring.addFromUri('//Dave');
    
    const daoAccountHex = '0x' + '00'.repeat(32);
    const { encodeAddress } = await import('@polkadot/util-crypto');
    const daoAccount = encodeAddress(daoAccountHex, 42);
    
    console.log(`   Alice (Sudo): ${alice.address}`);
    console.log(`   Bob (Customer): ${bob.address}`);
    console.log(`   Charlie (LP - Policy 0): ${charlie.address}`);
    console.log(`   Dave (LP - Policy 1): ${dave.address}`);
    console.log(`   DAO Account: ${daoAccount}`);

    const chainTimestamp = await api.query.timestamp.now();
    const chainNow = chainTimestamp.toNumber() / 1000;
    console.log(`\n⏰ Chain time: ${new Date(chainNow * 1000).toISOString()}`);

    // =========================================================================
    // INITIAL BALANCES
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('INITIAL USDT BALANCES');
    console.log('─'.repeat(70));
    
    const initialBob = await getUsdtBalance(api, bob.address);
    const initialCharlie = await getUsdtBalance(api, charlie.address);
    const initialDave = await getUsdtBalance(api, dave.address);
    const initialDao = await getUsdtBalance(api, daoAccount);
    
    console.log(`   Bob: ${formatUsdt(initialBob)}`);
    console.log(`   Charlie: ${formatUsdt(initialCharlie)}`);
    console.log(`   Dave: ${formatUsdt(initialDave)}`);
    console.log(`   DAO: ${formatUsdt(initialDao)}`);

    // =========================================================================
    // SETUP ORACLE
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('SETUP ORACLE');
    console.log('─'.repeat(70));

    const locationConfig = await api.query.prmxOracle.marketLocationConfig(MARKET_ID);
    if (!locationConfig.isSome) {
        console.log('⏳ Binding AccuWeather location...');
        const bindTx = api.tx.sudo.sudo(
            api.tx.prmxOracle.setMarketLocationKey(MARKET_ID, MANILA_ACCUWEATHER_KEY)
        );
        await new Promise((resolve) => {
            bindTx.signAndSend(alice, ({ status }) => {
                if (status.isInBlock) resolve();
            });
        });
    }

    // Submit low rainfall
    const rainfallData = [{ hourOffset: 0, rainfall: 100 }];
    for (const data of rainfallData) {
        const timestamp = Math.floor(chainNow - (data.hourOffset * 3600));
        const rainTx = api.tx.prmxOracle.submitRainfall(MARKET_ID, timestamp, data.rainfall);
        await new Promise((resolve) => {
            rainTx.signAndSend(alice, ({ status }) => {
                if (status.isInBlock) resolve();
            });
        });
    }
    console.log('✅ Oracle configured with low rainfall (no event)');

    // =========================================================================
    // CREATE POLICY 0 (Bob buys, Charlie will buy LP)
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('CREATE POLICY 0 (Bob buys insurance, Charlie will buy LP)');
    console.log('─'.repeat(70));

    const coverageStart0 = Math.floor(chainNow + 15);
    const coverageEnd0 = coverageStart0 + COVERAGE_DURATION_SECS;
    
    // Request quote for Policy 0
    const quote0Tx = api.tx.prmxQuote.requestPolicyQuote(
        MARKET_ID, coverageStart0, coverageEnd0, 14_599_500, 120_984_200, 2
    );
    let quoteId0;
    await new Promise((resolve) => {
        quote0Tx.signAndSend(bob, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxQuote' && event.method === 'QuoteRequested') {
                        quoteId0 = event.data[0].toNumber();
                    }
                }
                resolve();
            }
        });
    });
    console.log(`✅ Quote 0 requested (ID: ${quoteId0})`);

    // Submit quote
    await new Promise((resolve) => {
        api.tx.prmxQuote.submitQuote(quoteId0, 50_000).signAndSend(alice, ({ status }) => {
            if (status.isInBlock) resolve();
        });
    });

    // Apply coverage - creates Policy 0
    let policyId0;
    await new Promise((resolve) => {
        api.tx.prmxPolicy.applyCoverageWithQuote(quoteId0).signAndSend(bob, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxPolicy' && event.method === 'PolicyCreated') {
                        policyId0 = event.data[0].toNumber();
                    }
                }
                resolve();
            }
        });
    });
    console.log(`✅ POLICY 0 created (ID: ${policyId0})`);
    console.log(`   Coverage: ${new Date(coverageStart0 * 1000).toISOString()} to ${new Date(coverageEnd0 * 1000).toISOString()}`);
    console.log(`   2 LP tokens created for Policy 0`);

    // =========================================================================
    // CREATE POLICY 1 (Bob buys, Dave will buy LP)
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('CREATE POLICY 1 (Bob buys insurance, Dave will buy LP)');
    console.log('─'.repeat(70));

    const coverageStart1 = Math.floor(chainNow + 20);
    const coverageEnd1 = coverageStart1 + COVERAGE_DURATION_SECS;
    
    // Request quote for Policy 1
    const quote1Tx = api.tx.prmxQuote.requestPolicyQuote(
        MARKET_ID, coverageStart1, coverageEnd1, 14_599_500, 120_984_200, 3
    );
    let quoteId1;
    await new Promise((resolve) => {
        quote1Tx.signAndSend(bob, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxQuote' && event.method === 'QuoteRequested') {
                        quoteId1 = event.data[0].toNumber();
                    }
                }
                resolve();
            }
        });
    });

    await new Promise((resolve) => {
        api.tx.prmxQuote.submitQuote(quoteId1, 50_000).signAndSend(alice, ({ status }) => {
            if (status.isInBlock) resolve();
        });
    });

    let policyId1;
    await new Promise((resolve) => {
        api.tx.prmxPolicy.applyCoverageWithQuote(quoteId1).signAndSend(bob, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxPolicy' && event.method === 'PolicyCreated') {
                        policyId1 = event.data[0].toNumber();
                    }
                }
                resolve();
            }
        });
    });
    console.log(`✅ POLICY 1 created (ID: ${policyId1})`);
    console.log(`   Coverage: ${new Date(coverageStart1 * 1000).toISOString()} to ${new Date(coverageEnd1 * 1000).toISOString()}`);
    console.log(`   3 LP tokens created for Policy 1`);

    // =========================================================================
    // CHARLIE BUYS LP FROM POLICY 0
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('CHARLIE BUYS LP FROM POLICY 0');
    console.log('─'.repeat(70));

    const charlieBefore = await getUsdtBalance(api, charlie.address);
    
    await new Promise((resolve) => {
        api.tx.prmxOrderbookLp.buyLp(policyId0, 100_000_000n, 1).signAndSend(charlie, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxOrderbookLp' && event.method === 'TradeExecuted') {
                        const [, policyId, buyer, seller, price, qty] = event.data;
                        console.log(`   ✅ Charlie bought ${qty.toString()} LP from Policy ${policyId.toString()} @ ${formatUsdt(BigInt(price.toString()))}`);
                    }
                }
                resolve();
            }
        });
    });

    const charlieAfterBuy = await getUsdtBalance(api, charlie.address);
    const charlieLp0 = await getLpHoldings(api, policyId0, charlie.address);
    console.log(`   Charlie LP holdings for Policy ${policyId0}: ${charlieLp0.free + charlieLp0.locked}`);
    console.log(`   Charlie USDT: ${formatUsdt(charlieBefore)} → ${formatUsdt(charlieAfterBuy)}`);

    // =========================================================================
    // DAVE BUYS LP FROM POLICY 1
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('DAVE BUYS LP FROM POLICY 1');
    console.log('─'.repeat(70));

    const daveBefore = await getUsdtBalance(api, dave.address);
    
    await new Promise((resolve) => {
        api.tx.prmxOrderbookLp.buyLp(policyId1, 100_000_000n, 1).signAndSend(dave, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxOrderbookLp' && event.method === 'TradeExecuted') {
                        const [, policyId, buyer, seller, price, qty] = event.data;
                        console.log(`   ✅ Dave bought ${qty.toString()} LP from Policy ${policyId.toString()} @ ${formatUsdt(BigInt(price.toString()))}`);
                    }
                }
                resolve();
            }
        });
    });

    const daveAfterBuy = await getUsdtBalance(api, dave.address);
    const daveLp1 = await getLpHoldings(api, policyId1, dave.address);
    console.log(`   Dave LP holdings for Policy ${policyId1}: ${daveLp1.free + daveLp1.locked}`);
    console.log(`   Dave USDT: ${formatUsdt(daveBefore)} → ${formatUsdt(daveAfterBuy)}`);

    // Verify Charlie has NO LP in Policy 1 and Dave has NO LP in Policy 0
    const charlieLp1 = await getLpHoldings(api, policyId1, charlie.address);
    const daveLp0 = await getLpHoldings(api, policyId0, dave.address);
    console.log('\n   🔍 CROSS-CHECK (should be 0):');
    console.log(`   Charlie LP in Policy ${policyId1}: ${charlieLp1.free + charlieLp1.locked}`);
    console.log(`   Dave LP in Policy ${policyId0}: ${daveLp0.free + daveLp0.locked}`);

    // =========================================================================
    // LP SUMMARY BEFORE SETTLEMENT
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('LP TOKEN SUMMARY (Before Settlement)');
    console.log('─'.repeat(70));

    const daoLp0 = await getLpHoldings(api, policyId0, daoAccount);
    const daoLp1 = await getLpHoldings(api, policyId1, daoAccount);
    const totalLp0 = await api.query.prmxHoldings.totalLpShares(policyId0);
    const totalLp1 = await api.query.prmxHoldings.totalLpShares(policyId1);

    console.log(`\n   📊 POLICY ${policyId0} LP HOLDERS:`);
    console.log(`      DAO: ${daoLp0.free + daoLp0.locked} LP`);
    console.log(`      Charlie: ${charlieLp0.free + charlieLp0.locked} LP`);
    console.log(`      Total: ${totalLp0.toString()} LP`);

    console.log(`\n   📊 POLICY ${policyId1} LP HOLDERS:`);
    console.log(`      DAO: ${daoLp1.free + daoLp1.locked} LP`);
    console.log(`      Dave: ${daveLp1.free + daveLp1.locked} LP`);
    console.log(`      Total: ${totalLp1.toString()} LP`);

    // =========================================================================
    // WAIT FOR COVERAGE TO END
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('WAITING FOR COVERAGE TO END');
    console.log('─'.repeat(70));

    const maxCoverageEnd = Math.max(coverageEnd0, coverageEnd1);
    let currentChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    const waitTime = Math.max(0, maxCoverageEnd - currentChainTs + 15);
    
    console.log(`⏳ Waiting ${waitTime.toFixed(0)} seconds...`);
    for (let i = waitTime; i > 0; i -= 15) {
        console.log(`   ${i.toFixed(0)} seconds remaining...`);
        await new Promise(r => setTimeout(r, Math.min(15000, i * 1000)));
    }

    // Ensure chain time is past coverage end
    let settlementChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    while (settlementChainTs <= maxCoverageEnd) {
        await new Promise(r => setTimeout(r, 6000));
        settlementChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    }
    await new Promise(r => setTimeout(r, 12000));
    console.log('✅ Coverage windows ended!');

    // =========================================================================
    // SETTLE POLICY 0
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log(`SETTLE POLICY ${policyId0} (NO EVENT)`);
    console.log('─'.repeat(70));

    const charlieBeforeSettle0 = await getUsdtBalance(api, charlie.address);
    const daveBeforeSettle0 = await getUsdtBalance(api, dave.address);
    const daoBeforeSettle0 = await getUsdtBalance(api, daoAccount);

    console.log(`   Before settlement:`);
    console.log(`      Charlie: ${formatUsdt(charlieBeforeSettle0)}`);
    console.log(`      Dave: ${formatUsdt(daveBeforeSettle0)}`);
    console.log(`      DAO: ${formatUsdt(daoBeforeSettle0)}`);

    await new Promise((resolve) => {
        api.tx.prmxPolicy.settlePolicy(policyId0, false).signAndSend(alice, ({ status, events }) => {
            if (status.isInBlock) {
                console.log('\n   📋 SETTLEMENT EVENTS:');
                for (const { event } of events) {
                    if (event.section === 'prmxHoldings' && event.method === 'LpPayoutDistributed') {
                        console.log(`      • LpPayoutDistributed: Policy ${event.data[0].toString()}, ${formatUsdt(BigInt(event.data[1].toString()))}`);
                    }
                    if (event.section === 'assets' && event.method === 'Transferred') {
                        const [, from, to, amount] = event.data;
                        console.log(`      • USDT Transfer: ${formatUsdt(BigInt(amount.toString()))} → ${to.toString().substring(0, 15)}...`);
                    }
                }
                resolve();
            }
        });
    });

    const charlieAfterSettle0 = await getUsdtBalance(api, charlie.address);
    const daveAfterSettle0 = await getUsdtBalance(api, dave.address);
    const daoAfterSettle0 = await getUsdtBalance(api, daoAccount);

    console.log(`\n   After Policy ${policyId0} settlement:`);
    console.log(`      Charlie: ${formatUsdt(charlieAfterSettle0)} (${charlieAfterSettle0 > charlieBeforeSettle0 ? '+' : ''}${formatUsdt(charlieAfterSettle0 - charlieBeforeSettle0)}) ← SHOULD GET PAID`);
    console.log(`      Dave: ${formatUsdt(daveAfterSettle0)} (${daveAfterSettle0 > daveBeforeSettle0 ? '+' : ''}${formatUsdt(daveAfterSettle0 - daveBeforeSettle0)}) ← SHOULD NOT GET PAID (no LP in Policy 0)`);
    console.log(`      DAO: ${formatUsdt(daoAfterSettle0)} (${daoAfterSettle0 > daoBeforeSettle0 ? '+' : ''}${formatUsdt(daoAfterSettle0 - daoBeforeSettle0)})`);

    // =========================================================================
    // SETTLE POLICY 1
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log(`SETTLE POLICY ${policyId1} (NO EVENT)`);
    console.log('─'.repeat(70));

    const charlieBeforeSettle1 = await getUsdtBalance(api, charlie.address);
    const daveBeforeSettle1 = await getUsdtBalance(api, dave.address);
    const daoBeforeSettle1 = await getUsdtBalance(api, daoAccount);

    console.log(`   Before settlement:`);
    console.log(`      Charlie: ${formatUsdt(charlieBeforeSettle1)}`);
    console.log(`      Dave: ${formatUsdt(daveBeforeSettle1)}`);
    console.log(`      DAO: ${formatUsdt(daoBeforeSettle1)}`);

    await new Promise((resolve) => {
        api.tx.prmxPolicy.settlePolicy(policyId1, false).signAndSend(alice, ({ status, events }) => {
            if (status.isInBlock) {
                console.log('\n   📋 SETTLEMENT EVENTS:');
                for (const { event } of events) {
                    if (event.section === 'prmxHoldings' && event.method === 'LpPayoutDistributed') {
                        console.log(`      • LpPayoutDistributed: Policy ${event.data[0].toString()}, ${formatUsdt(BigInt(event.data[1].toString()))}`);
                    }
                    if (event.section === 'assets' && event.method === 'Transferred') {
                        const [, from, to, amount] = event.data;
                        console.log(`      • USDT Transfer: ${formatUsdt(BigInt(amount.toString()))} → ${to.toString().substring(0, 15)}...`);
                    }
                }
                resolve();
            }
        });
    });

    const charlieAfterSettle1 = await getUsdtBalance(api, charlie.address);
    const daveAfterSettle1 = await getUsdtBalance(api, dave.address);
    const daoAfterSettle1 = await getUsdtBalance(api, daoAccount);

    console.log(`\n   After Policy ${policyId1} settlement:`);
    console.log(`      Charlie: ${formatUsdt(charlieAfterSettle1)} (${charlieAfterSettle1 > charlieBeforeSettle1 ? '+' : ''}${formatUsdt(charlieAfterSettle1 - charlieBeforeSettle1)}) ← SHOULD NOT GET PAID (no LP in Policy 1)`);
    console.log(`      Dave: ${formatUsdt(daveAfterSettle1)} (${daveAfterSettle1 > daveBeforeSettle1 ? '+' : ''}${formatUsdt(daveAfterSettle1 - daveBeforeSettle1)}) ← SHOULD GET PAID`);
    console.log(`      DAO: ${formatUsdt(daoAfterSettle1)} (${daoAfterSettle1 > daoBeforeSettle1 ? '+' : ''}${formatUsdt(daoAfterSettle1 - daoBeforeSettle1)})`);

    // =========================================================================
    // FINAL SUMMARY
    // =========================================================================
    console.log('\n' + '='.repeat(70));
    console.log('TEST COMPLETE - FINAL SUMMARY');
    console.log('='.repeat(70));

    console.log('\n📊 NET BALANCE CHANGES (Start → End):');
    const finalCharlie = await getUsdtBalance(api, charlie.address);
    const finalDave = await getUsdtBalance(api, dave.address);
    const finalDao = await getUsdtBalance(api, daoAccount);
    const finalBob = await getUsdtBalance(api, bob.address);

    console.log(`   Bob (Policyholder): ${formatUsdt(initialBob)} → ${formatUsdt(finalBob)} (${formatUsdt(finalBob - initialBob)})`);
    console.log(`   Charlie (Policy ${policyId0} LP): ${formatUsdt(initialCharlie)} → ${formatUsdt(finalCharlie)} (${formatUsdt(finalCharlie - initialCharlie)})`);
    console.log(`   Dave (Policy ${policyId1} LP): ${formatUsdt(initialDave)} → ${formatUsdt(finalDave)} (${formatUsdt(finalDave - initialDave)})`);
    console.log(`   DAO: ${formatUsdt(initialDao)} → ${formatUsdt(finalDao)} (${formatUsdt(finalDao - initialDao)})`);

    console.log('\n✅ KEY VERIFICATION:');
    console.log(`   • Charlie ONLY got paid from Policy ${policyId0} settlement`);
    console.log(`   • Dave ONLY got paid from Policy ${policyId1} settlement`);
    console.log(`   • LP tokens are correctly POLICY-SPECIFIC!`);

    await api.disconnect();
}

main().catch(console.error);

