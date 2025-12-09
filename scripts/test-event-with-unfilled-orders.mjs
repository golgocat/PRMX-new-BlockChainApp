#!/usr/bin/env node
/**
 * PRMX Test - Event Occurs with Unfilled LP Orders on Orderbook
 * 
 * This test demonstrates what happens when:
 * 1. A policy is created (DAO receives LP tokens, auto-placed on orderbook)
 * 2. Only SOME LP tokens are bought (Charlie buys 2 of 5)
 * 3. DAO still has UNFILLED orders for remaining 3 LP tokens
 * 4. Rainfall EVENT OCCURS (exceeds threshold)
 * 5. Policy is settled with event_occurred = true
 * 
 * Expected outcome:
 * - Bob (policyholder) receives FULL 500 USDT payout
 * - Charlie (bought 2 LP) loses his investment (gets nothing)
 * - DAO (unfilled orders for 3 LP) loses that capital too
 * - All LP tokens are burned, unfilled orders are cleaned up
 * 
 * Usage: node test-event-with-unfilled-orders.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

// Configuration
const WS_ENDPOINT = 'ws://127.0.0.1:9944';
const USDT_ASSET_ID = 1;
const MARKET_ID = 0;
const MANILA_ACCUWEATHER_KEY = '3423441';
const COVERAGE_DURATION_SECS = 60;

// HIGH rainfall - ABOVE strike threshold (50mm = 500 scaled)
// This will trigger the event!
const RAINFALL_DATA_EVENT = [
    { hourOffset: 0, rainfall: 300 },  // 30.0mm
    { hourOffset: 1, rainfall: 350 },  // 35.0mm - Total: 65mm > 50mm threshold!
];

function formatUsdt(balance) {
    return `${(Number(balance) / 1e6).toFixed(2)} USDT`;
}

async function getBalances(api, address, label, policyId) {
    const usdt = await api.query.assets.account(USDT_ASSET_ID, address);
    const usdtBalance = usdt.isSome ? BigInt(usdt.unwrap().balance.toString()) : 0n;
    
    const holdings = await api.query.prmxHoldings.holdingsStorage(policyId, address);
    const lpShares = holdings.lpShares ? BigInt(holdings.lpShares.toString()) : 0n;
    const lockedShares = holdings.lockedShares ? BigInt(holdings.lockedShares.toString()) : 0n;
    
    return { usdt: usdtBalance, lp: lpShares, lockedLp: lockedShares, label };
}

function printLpDistribution(balances, totalLp, title) {
    console.log(`\n   🎫 ${title}:`);
    for (const bal of balances) {
        const totalHolding = bal.lp + bal.lockedLp;
        const percentage = totalLp > 0n ? Number(totalHolding * 10000n / totalLp) / 100 : 0;
        console.log(`      ${bal.label}: ${bal.lp.toString()} free + ${bal.lockedLp.toString()} locked = ${totalHolding.toString()} (${percentage.toFixed(1)}%)`);
    }
    console.log(`      Total Supply: ${totalLp.toString()} LP tokens`);
}

async function main() {
    console.log('='.repeat(70));
    console.log('PRMX TEST - EVENT OCCURS WITH UNFILLED LP ORDERS');
    console.log('='.repeat(70));
    console.log('');
    console.log('🔴 This test simulates HIGH rainfall that EXCEEDS the strike threshold.');
    console.log('   Some LP orders remain UNFILLED on the orderbook when event triggers.');
    console.log('   Policyholder (Bob) receives FULL payout, LP holders lose everything.');
    console.log('');

    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    console.log('✅ Connected to PRMX node');
    
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');
    const charlie = keyring.addFromUri('//Charlie');
    
    const { encodeAddress } = await import('@polkadot/util-crypto');
    const daoAccountHex = '0x' + '00'.repeat(32);
    const daoAccount = encodeAddress(daoAccountHex, 42);
    
    console.log(`   Alice (Sudo/Oracle): ${alice.address}`);
    console.log(`   Bob (Policyholder): ${bob.address}`);
    console.log(`   Charlie (LP Investor): ${charlie.address}`);
    console.log(`   DAO Account: ${daoAccount}`);

    const chainTimestamp = await api.query.timestamp.now();
    const chainNow = chainTimestamp.toNumber() / 1000;
    console.log(`\n⏰ Chain time: ${new Date(chainNow * 1000).toISOString()}`);

    // =========================================================================
    // INITIAL BALANCES
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('INITIAL STATE');
    console.log('─'.repeat(70));
    
    const initialUsdt = {
        bob: (await api.query.assets.account(USDT_ASSET_ID, bob.address)).isSome 
            ? BigInt((await api.query.assets.account(USDT_ASSET_ID, bob.address)).unwrap().balance.toString()) : 0n,
        charlie: (await api.query.assets.account(USDT_ASSET_ID, charlie.address)).isSome 
            ? BigInt((await api.query.assets.account(USDT_ASSET_ID, charlie.address)).unwrap().balance.toString()) : 0n,
        dao: (await api.query.assets.account(USDT_ASSET_ID, daoAccount)).isSome 
            ? BigInt((await api.query.assets.account(USDT_ASSET_ID, daoAccount)).unwrap().balance.toString()) : 0n,
    };
    
    console.log('   📊 Initial USDT Balances:');
    console.log(`      Bob (Policyholder): ${formatUsdt(initialUsdt.bob)}`);
    console.log(`      Charlie (LP Investor): ${formatUsdt(initialUsdt.charlie)}`);
    console.log(`      DAO: ${formatUsdt(initialUsdt.dao)}`);

    // =========================================================================
    // SETUP ORACLE
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('SETUP: ORACLE CONFIGURATION');
    console.log('─'.repeat(70));

    const locationConfig = await api.query.prmxOracle.marketLocationConfig(MARKET_ID);
    if (!locationConfig.isSome) {
        const bindTx = api.tx.sudo.sudo(
            api.tx.prmxOracle.setMarketLocationKey(MARKET_ID, MANILA_ACCUWEATHER_KEY)
        );
        await new Promise((resolve) => {
            bindTx.signAndSend(alice, ({ status }) => {
                if (status.isInBlock) resolve();
            });
        });
    }
    console.log('✅ Oracle location configured');

    try {
        const addProviderTx = api.tx.sudo.sudo(
            api.tx.prmxOracle.addOracleProvider(alice.address)
        );
        await new Promise((resolve) => {
            addProviderTx.signAndSend(alice, ({ status }) => {
                if (status.isInBlock) resolve();
            });
        });
    } catch (e) {}
    console.log('✅ Oracle provider configured');

    // =========================================================================
    // STEP 1: CREATE POLICY
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 1: CREATE POLICY (BOB BUYS INSURANCE)');
    console.log('─'.repeat(70));

    // First submit some initial rainfall (low) for the quote
    const rainTx = api.tx.prmxOracle.submitRainfall(MARKET_ID, Math.floor(chainNow), 50);
    await new Promise((resolve) => {
        rainTx.signAndSend(alice, ({ status }) => {
            if (status.isInBlock) resolve();
        });
    });
    console.log('✅ Initial rainfall data submitted (5mm - for quote calculation)');

    const coverageStart = Math.floor(chainNow + 10);
    const coverageEnd = coverageStart + COVERAGE_DURATION_SECS;
    const shares = 5; // 5 shares = 500 USDT max payout
    
    console.log(`\n   Policy Details:`);
    console.log(`      Shares: ${shares} (= ${shares * 100} USDT max payout)`);
    console.log(`      Coverage: ${COVERAGE_DURATION_SECS} seconds`);

    // Request and submit quote
    const quoteTx = api.tx.prmxQuote.requestPolicyQuote(
        MARKET_ID, coverageStart, coverageEnd, 14_599_500, 120_984_200, shares
    );

    let quoteId;
    await new Promise((resolve) => {
        quoteTx.signAndSend(bob, ({ status, events }) => {
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
    console.log(`✅ Quote requested: ID ${quoteId}`);

    const submitQuoteTx = api.tx.prmxQuote.submitQuote(quoteId, 50_000); // 5%
    await new Promise((resolve) => {
        submitQuoteTx.signAndSend(alice, ({ status }) => {
            if (status.isInBlock) resolve();
        });
    });
    
    const quoteResult = await api.query.prmxQuote.quoteResults(quoteId);
    const premium = quoteResult.isSome ? BigInt(quoteResult.unwrap().totalPremium.toString()) : 0n;
    console.log(`✅ Quote ready! Premium: ${formatUsdt(premium)}`);

    // Apply coverage
    const applyTx = api.tx.prmxPolicy.applyCoverageWithQuote(quoteId);
    
    let policyId;
    await new Promise((resolve) => {
        applyTx.signAndSend(bob, ({ status, events }) => {
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
    console.log(`✅ Policy created! ID: ${policyId}`);

    // Show pool and LP distribution
    const poolBalance = await api.query.prmxPolicy.policyRiskPoolBalance(policyId);
    const totalLpInitial = await api.query.prmxHoldings.totalLpShares(policyId);
    const lpHolders = await api.query.prmxHoldings.lpHolders(policyId);
    
    console.log(`\n   🏦 Policy Pool: ${formatUsdt(BigInt(poolBalance.toString()))}`);
    console.log(`   🎫 Total LP tokens: ${totalLpInitial.toString()}`);
    console.log(`   👥 LP Holders: ${lpHolders.length}`);

    // Check orderbook
    const priceLevels = await api.query.prmxOrderbookLp.priceLevels(policyId);
    console.log(`   📖 Orderbook price levels: ${priceLevels.length}`);

    // =========================================================================
    // STEP 2: CHARLIE BUYS ONLY 2 LP TOKENS (3 REMAIN UNFILLED)
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 2: CHARLIE BUYS 2 LP TOKENS (3 REMAIN ON ORDERBOOK)');
    console.log('─'.repeat(70));

    const charlieBuyAmount = 2n;
    const maxPrice = 100_000_000n; // 100 USDT per token
    
    console.log(`   Charlie buying ${charlieBuyAmount.toString()} of ${shares} LP tokens`);
    console.log(`   ⚠️  ${shares - Number(charlieBuyAmount)} LP tokens will REMAIN UNFILLED on orderbook`);
    
    const charlieBuyTx = api.tx.prmxOrderbookLp.buyLp(policyId, maxPrice, charlieBuyAmount);
    await new Promise((resolve) => {
        charlieBuyTx.signAndSend(charlie, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxOrderbookLp' && event.method === 'TradeExecuted') {
                        console.log(`   ✅ Trade executed!`);
                    }
                }
                resolve();
            }
        });
    });

    // Show LP distribution after partial purchase
    const lpBalances = [
        await getBalances(api, daoAccount, 'DAO', policyId),
        await getBalances(api, charlie.address, 'Charlie', policyId),
    ];
    const totalLpNow = BigInt((await api.query.prmxHoldings.totalLpShares(policyId)).toString());
    printLpDistribution(lpBalances, totalLpNow, 'LP Distribution (After Partial Purchase)');

    // Show remaining unfilled orders
    const priceLevelsAfter = await api.query.prmxOrderbookLp.priceLevels(policyId);
    console.log(`\n   📖 UNFILLED ORDERS ON ORDERBOOK:`);
    let totalUnfilledLp = 0n;
    for (const price of priceLevelsAfter) {
        const orders = await api.query.prmxOrderbookLp.askBook(policyId, price);
        for (const orderId of orders) {
            const order = await api.query.prmxOrderbookLp.orders(orderId);
            if (order.isSome) {
                const remaining = BigInt(order.unwrap().remaining.toString());
                totalUnfilledLp += remaining;
                console.log(`      Order #${orderId}: ${remaining.toString()} LP @ ${formatUsdt(BigInt(price.toString()))} each`);
            }
        }
    }
    console.log(`      ─────────────────────────────`);
    console.log(`      Total unfilled: ${totalUnfilledLp.toString()} LP tokens (${formatUsdt(totalUnfilledLp * 100_000_000n)} at risk)`);

    // =========================================================================
    // STEP 3: SUBMIT HIGH RAINFALL DATA (TRIGGER EVENT!)
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 3: SUBMIT HIGH RAINFALL DATA (TRIGGER EVENT!)');
    console.log('─'.repeat(70));
    
    console.log('   🌧️ Submitting rainfall data that EXCEEDS strike threshold:');
    console.log('   Strike threshold: 50mm (500 scaled)');
    
    let totalRainfall = 0;
    const baseTimestamp = chainNow;
    
    for (const data of RAINFALL_DATA_EVENT) {
        const timestamp = Math.floor(baseTimestamp - (data.hourOffset * 3600));
        totalRainfall += data.rainfall;
        
        console.log(`   Submitting: ${data.rainfall / 10}mm at ${new Date(timestamp * 1000).toISOString()}`);
        
        const highRainTx = api.tx.prmxOracle.submitRainfall(MARKET_ID, timestamp, data.rainfall);
        await new Promise((resolve) => {
            highRainTx.signAndSend(alice, ({ status }) => {
                if (status.isInBlock) resolve();
            });
        });
    }
    
    console.log(`\n   ⚡ TOTAL RAINFALL: ${totalRainfall / 10}mm (${totalRainfall} scaled)`);
    console.log(`   ⚡ STRIKE THRESHOLD: 50mm (500 scaled)`);
    console.log(`   🔴 RESULT: EVENT OCCURRED! (${totalRainfall / 10}mm > 50mm)`);

    // =========================================================================
    // STEP 4: WAIT FOR COVERAGE TO END
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 4: WAIT FOR COVERAGE TO END');
    console.log('─'.repeat(70));

    let currentChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    const waitTime = Math.max(0, coverageEnd - currentChainTs + 15);
    
    console.log(`⏳ Waiting ${waitTime.toFixed(0)} seconds...`);
    console.log('   ⚠️  Unfilled LP orders are still on the orderbook!');
    
    for (let i = waitTime; i > 0; i -= 10) {
        console.log(`   ${i.toFixed(0)} seconds remaining...`);
        await new Promise(r => setTimeout(r, Math.min(10000, i * 1000)));
    }

    // Ensure chain time has passed
    let settlementChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    while (settlementChainTs <= coverageEnd) {
        await new Promise(r => setTimeout(r, 6000));
        settlementChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    }
    await new Promise(r => setTimeout(r, 12000));
    console.log('✅ Coverage window has ended!');

    // =========================================================================
    // STEP 5: SETTLEMENT - EVENT OCCURRED!
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 5: SETTLEMENT - EVENT OCCURRED!');
    console.log('─'.repeat(70));

    // Get balances before settlement
    const beforeSettlement = {
        bob: (await api.query.assets.account(USDT_ASSET_ID, bob.address)).isSome 
            ? BigInt((await api.query.assets.account(USDT_ASSET_ID, bob.address)).unwrap().balance.toString()) : 0n,
        charlie: (await api.query.assets.account(USDT_ASSET_ID, charlie.address)).isSome 
            ? BigInt((await api.query.assets.account(USDT_ASSET_ID, charlie.address)).unwrap().balance.toString()) : 0n,
        dao: (await api.query.assets.account(USDT_ASSET_ID, daoAccount)).isSome 
            ? BigInt((await api.query.assets.account(USDT_ASSET_ID, daoAccount)).unwrap().balance.toString()) : 0n,
    };

    const poolBefore = await api.query.prmxPolicy.policyRiskPoolBalance(policyId);
    
    console.log('\n   📊 STATE BEFORE SETTLEMENT:');
    console.log(`      Pool balance: ${formatUsdt(BigInt(poolBefore.toString()))}`);
    console.log(`      Bob USDT: ${formatUsdt(beforeSettlement.bob)}`);
    console.log(`      Charlie USDT: ${formatUsdt(beforeSettlement.charlie)}`);
    console.log(`      DAO USDT: ${formatUsdt(beforeSettlement.dao)}`);

    // Check unfilled orders still exist
    const ordersBeforeSettlement = await api.query.prmxOrderbookLp.priceLevels(policyId);
    console.log(`\n   📖 Unfilled orders on orderbook: ${ordersBeforeSettlement.length > 0 ? 'YES' : 'NO'}`);

    console.log('\n   💡 EXPECTED FUND FLOW (EVENT OCCURRED):');
    console.log(`      🔴 Bob (Policyholder) receives: ${formatUsdt(BigInt(poolBefore.toString()))} (FULL PAYOUT)`);
    console.log(`      ❌ Charlie (2 LP) receives: 0 USDT (LOSES investment)`);
    console.log(`      ❌ DAO (3 unfilled LP) receives: 0 USDT (LOSES capital)`);
    console.log(`      🗑️  Unfilled orders: Should be cleaned up`);

    console.log(`\n⏳ Settling policy (event_occurred: true)...`);
    const settleTx = api.tx.prmxPolicy.settlePolicy(policyId, true); // EVENT OCCURRED!
    
    await new Promise((resolve) => {
        settleTx.signAndSend(alice, ({ status, events }) => {
            if (status.isInBlock) {
                console.log('\n   📋 SETTLEMENT EVENTS:');
                for (const { event } of events) {
                    if (event.section === 'prmxPolicy') {
                        console.log(`      • ${event.section}.${event.method}`);
                        if (event.method === 'PolicySettled' || event.method === 'PolicyEventTriggered') {
                            console.log(`        Data: ${event.data.toString()}`);
                        }
                    }
                    if (event.section === 'prmxHoldings') {
                        console.log(`      • ${event.section}.${event.method}`);
                    }
                    if (event.section === 'prmxOrderbookLp') {
                        console.log(`      • ${event.section}.${event.method}`);
                    }
                    if (event.section === 'assets' && event.method === 'Transferred') {
                        const [, from, to, amount] = event.data;
                        const fromAddr = from.toString();
                        const toAddr = to.toString();
                        const fromLabel = fromAddr.startsWith('5EYCAe5') ? 'Pool' : 
                                         fromAddr.startsWith('5C4hrfj') ? 'DAO' : fromAddr.substring(0, 10) + '...';
                        const toLabel = toAddr === bob.address ? 'Bob' :
                                       toAddr === charlie.address ? 'Charlie' :
                                       toAddr.startsWith('5C4hrfj') ? 'DAO' : toAddr.substring(0, 10) + '...';
                        console.log(`      • Asset Transfer: ${formatUsdt(BigInt(amount.toString()))} from ${fromLabel} to ${toLabel}`);
                    }
                }
                resolve();
            }
        });
    });

    // Get balances after settlement
    const afterSettlement = {
        bob: (await api.query.assets.account(USDT_ASSET_ID, bob.address)).isSome 
            ? BigInt((await api.query.assets.account(USDT_ASSET_ID, bob.address)).unwrap().balance.toString()) : 0n,
        charlie: (await api.query.assets.account(USDT_ASSET_ID, charlie.address)).isSome 
            ? BigInt((await api.query.assets.account(USDT_ASSET_ID, charlie.address)).unwrap().balance.toString()) : 0n,
        dao: (await api.query.assets.account(USDT_ASSET_ID, daoAccount)).isSome 
            ? BigInt((await api.query.assets.account(USDT_ASSET_ID, daoAccount)).unwrap().balance.toString()) : 0n,
    };

    // =========================================================================
    // RESULTS
    // =========================================================================
    console.log('\n' + '='.repeat(70));
    console.log('SETTLEMENT RESULTS - EVENT OCCURRED WITH UNFILLED ORDERS');
    console.log('='.repeat(70));

    const bobChange = afterSettlement.bob - beforeSettlement.bob;
    const charlieChange = afterSettlement.charlie - beforeSettlement.charlie;
    const daoChange = afterSettlement.dao - beforeSettlement.dao;

    console.log('\n   📊 USDT BALANCE CHANGES FROM SETTLEMENT:');
    console.log(`      Bob (Policyholder): ${bobChange >= 0n ? '+' : ''}${formatUsdt(bobChange)}`);
    console.log(`      Charlie (LP Holder): ${charlieChange >= 0n ? '+' : ''}${formatUsdt(charlieChange)}`);
    console.log(`      DAO (Unfilled Orders): ${daoChange >= 0n ? '+' : ''}${formatUsdt(daoChange)}`);

    // Check policy status
    const policyAfter = await api.query.prmxPolicy.policies(policyId);
    console.log(`\n   📄 Policy Status: ${policyAfter.isSome ? policyAfter.unwrap().status.toString() : 'N/A'}`);

    // Check settlement result
    const settlementResult = await api.query.prmxPolicy.settlementResults(policyId);
    if (settlementResult.isSome) {
        const result = settlementResult.unwrap();
        console.log(`\n   📋 SETTLEMENT RESULT:`);
        console.log(`      Event Occurred: ${result.eventOccurred.toString()}`);
        console.log(`      Payout to Holder: ${formatUsdt(BigInt(result.payoutToHolder.toString()))}`);
        console.log(`      Returned to LPs: ${formatUsdt(BigInt(result.returnedToLps.toString()))}`);
    }

    // Check pool is empty
    const poolAfter = await api.query.prmxPolicy.policyRiskPoolBalance(policyId);
    console.log(`\n   🏦 Pool Balance After: ${formatUsdt(BigInt(poolAfter.toString()))} (should be 0)`);

    // Check LP tokens burned
    const lpSupplyAfter = await api.query.prmxHoldings.totalLpShares(policyId);
    console.log(`   🎫 LP Tokens Remaining: ${lpSupplyAfter.toString()} (should be 0)`);

    // Check orderbook cleaned up
    const ordersAfter = await api.query.prmxOrderbookLp.priceLevels(policyId);
    console.log(`   📖 Orderbook Price Levels: ${ordersAfter.length} (should be 0 - cleaned up)`);

    // =========================================================================
    // FINAL SUMMARY
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('FINAL SUMMARY - NET CHANGES FROM START TO END');
    console.log('─'.repeat(70));

    const bobNetChange = afterSettlement.bob - initialUsdt.bob;
    const charlieNetChange = afterSettlement.charlie - initialUsdt.charlie;
    const daoNetChange = afterSettlement.dao - initialUsdt.dao;

    console.log('\n   💰 NET USDT CHANGES:');
    console.log(`      Bob: ${bobNetChange >= 0n ? '+' : ''}${formatUsdt(bobNetChange)}`);
    console.log(`         (Paid ${formatUsdt(premium)} premium, received ${formatUsdt(BigInt(poolBefore.toString()))} payout)`);
    console.log(`      Charlie: ${charlieNetChange >= 0n ? '+' : ''}${formatUsdt(charlieNetChange)}`);
    console.log(`         (Paid ~200 USDT for 2 LP tokens, received nothing)`);
    console.log(`      DAO: ${daoNetChange >= 0n ? '+' : ''}${formatUsdt(daoNetChange)}`);
    console.log(`         (Had unfilled orders, capital at risk was lost)`);

    console.log('\n   📝 KEY TAKEAWAYS:');
    console.log('      🔴 When EVENT OCCURS:');
    console.log('         • Policyholder receives FULL payout from pool');
    console.log('         • ALL LP holders (filled AND unfilled) lose their capital');
    console.log('         • Unfilled orders on orderbook are cleaned up');
    console.log('         • LP tokens are burned (no value remains)');
    console.log('');
    console.log('      💡 This demonstrates the RISK that LP providers take:');
    console.log('         • They earn premiums when no event occurs');
    console.log('         • They lose EVERYTHING when event triggers');
    console.log('         • Even UNFILLED orders represent capital at risk!');

    await api.disconnect();
}

main().catch(console.error);
