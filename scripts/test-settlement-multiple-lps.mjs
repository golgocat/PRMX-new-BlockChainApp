#!/usr/bin/env node
/**
 * PRMX Test - Settlement at Maturity with Multiple LP Holders
 * 
 * This test demonstrates the fund flow when:
 * 1. A policy is created (DAO receives LP tokens)
 * 2. DAO sells some LP tokens to Charlie and Dave
 * 3. Coverage period ends WITHOUT rainfall event
 * 4. Policy settles at maturity
 * 5. Pool is distributed PRO-RATA to all LP holders
 * 
 * Expected distribution (example):
 * - DAO: 50% of LP tokens → receives 50% of pool
 * - Charlie: 30% of LP tokens → receives 30% of pool
 * - Dave: 20% of LP tokens → receives 20% of pool
 * 
 * Usage: node test-settlement-multiple-lps.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

// Configuration
const WS_ENDPOINT = 'ws://127.0.0.1:9944';
const USDT_ASSET_ID = 1;
const MARKET_ID = 0;
const MANILA_ACCUWEATHER_KEY = '3423441';
const COVERAGE_DURATION_SECS = 60;

// LOW rainfall - no event
const RAINFALL_DATA_NO_EVENT = [
    { hourOffset: 0, rainfall: 100 },  // 10.0mm - below 50mm threshold
];

function formatUsdt(balance) {
    return `${(Number(balance) / 1e6).toFixed(2)} USDT`;
}

async function getBalances(api, address, label, policyId) {
    const usdt = await api.query.assets.account(USDT_ASSET_ID, address);
    const usdtBalance = usdt.isSome ? BigInt(usdt.unwrap().balance.toString()) : 0n;
    
    // Query LP holdings - returns struct with lp_shares and locked_shares (snake_case from Rust)
    const holdings = await api.query.prmxHoldings.holdingsStorage(policyId, address);
    // The API converts snake_case to camelCase
    const lpShares = holdings.lpShares ? BigInt(holdings.lpShares.toString()) : 0n;
    const lockedShares = holdings.lockedShares ? BigInt(holdings.lockedShares.toString()) : 0n;
    
    return { usdt: usdtBalance, lp: lpShares, lockedLp: lockedShares, label };
}

function printLpDistribution(balances, totalLp, title) {
    console.log(`\n   🎫 ${title}:`);
    for (const bal of balances) {
        const totalHolding = bal.lp + bal.lockedLp;
        const percentage = totalLp > 0n ? Number(totalHolding * 10000n / totalLp) / 100 : 0;
        console.log(`      ${bal.label}: ${totalHolding.toString()} LP tokens (${percentage.toFixed(1)}%)`);
    }
    console.log(`      Total: ${totalLp.toString()} LP tokens`);
}

async function main() {
    console.log('='.repeat(70));
    console.log('PRMX TEST - SETTLEMENT WITH MULTIPLE LP HOLDERS');
    console.log('='.repeat(70));
    console.log('');
    console.log('📋 This test demonstrates pro-rata distribution to multiple LP holders');
    console.log('   when a policy settles at maturity (no event).');
    console.log('');

    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    console.log('✅ Connected to PRMX node');
    
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');
    const charlie = keyring.addFromUri('//Charlie');
    const dave = keyring.addFromUri('//Dave');
    
    const { encodeAddress } = await import('@polkadot/util-crypto');
    const daoAccountHex = '0x' + '00'.repeat(32);
    const daoAccount = encodeAddress(daoAccountHex, 42);
    
    console.log(`   Alice (Sudo/Oracle): ${alice.address}`);
    console.log(`   Bob (Customer): ${bob.address}`);
    console.log(`   Charlie (LP Investor 1): ${charlie.address}`);
    console.log(`   Dave (LP Investor 2): ${dave.address}`);
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
        dave: (await api.query.assets.account(USDT_ASSET_ID, dave.address)).isSome 
            ? BigInt((await api.query.assets.account(USDT_ASSET_ID, dave.address)).unwrap().balance.toString()) : 0n,
        dao: (await api.query.assets.account(USDT_ASSET_ID, daoAccount)).isSome 
            ? BigInt((await api.query.assets.account(USDT_ASSET_ID, daoAccount)).unwrap().balance.toString()) : 0n,
    };
    
    console.log('   📊 Initial USDT Balances:');
    console.log(`      Bob: ${formatUsdt(initialUsdt.bob)}`);
    console.log(`      Charlie: ${formatUsdt(initialUsdt.charlie)}`);
    console.log(`      Dave: ${formatUsdt(initialUsdt.dave)}`);
    console.log(`      DAO: ${formatUsdt(initialUsdt.dao)}`);

    // =========================================================================
    // SETUP
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('SETUP: ORACLE & RAINFALL DATA');
    console.log('─'.repeat(70));

    // Bind location if needed
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

    // Add oracle provider
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

    // Submit low rainfall
    for (const data of RAINFALL_DATA_NO_EVENT) {
        const timestamp = Math.floor(chainNow - (data.hourOffset * 3600));
        const rainTx = api.tx.prmxOracle.submitRainfall(MARKET_ID, timestamp, data.rainfall);
        await new Promise((resolve) => {
            rainTx.signAndSend(alice, ({ status }) => {
                if (status.isInBlock) resolve();
            });
        });
    }
    console.log('✅ Low rainfall data submitted (10mm < 50mm threshold)');

    // =========================================================================
    // STEP 1: Create Policy
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 1: CREATE POLICY (BOB BUYS INSURANCE)');
    console.log('─'.repeat(70));

    const coverageStart = Math.floor(chainNow + 10);
    const coverageEnd = coverageStart + COVERAGE_DURATION_SECS;
    const shares = 5; // 5 shares = 500 USDT max payout
    
    console.log(`   Shares: ${shares} (= ${shares * 100} USDT max payout)`);
    console.log(`   Coverage: ${COVERAGE_DURATION_SECS} seconds`);

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

    // Show initial LP distribution (100% DAO)
    const daoLpInitial = await getBalances(api, daoAccount, 'DAO', policyId);
    const totalLpInitial = await api.query.prmxHoldings.totalLpShares(policyId);
    
    // Also check LP holders list
    const lpHolders = await api.query.prmxHoldings.lpHolders(policyId);
    
    console.log(`\n   🎫 Initial LP Distribution:`);
    console.log(`      Total LP tokens: ${totalLpInitial.toString()}`);
    console.log(`      LP Holders: ${lpHolders.length}`);
    console.log(`      DAO free: ${daoLpInitial.lp.toString()}, locked: ${daoLpInitial.lockedLp.toString()}`);

    // =========================================================================
    // STEP 2: DAO Sells LP Tokens to Charlie and Dave
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 2: LP TOKEN DISTRIBUTION');
    console.log('─'.repeat(70));
    console.log('   DAO will sell LP tokens to Charlie and Dave via orderbook');

    const totalLp = BigInt(totalLpInitial.toString());
    const pricePerLp = 100_000_000n; // 100 USDT per LP token (same as face value)

    // Note: When policy is created, DAO's LP tokens are automatically placed on orderbook
    // via the DaoLpAskPlaced mechanism. We'll just have Charlie and Dave buy from it.
    
    // Check if there are existing ask orders from DAO
    const priceLevels = await api.query.prmxOrderbookLp.priceLevels(policyId);
    console.log(`\n   📖 Existing orderbook price levels: ${priceLevels.length}`);
    
    if (priceLevels.length === 0) {
        // No existing orders - DAO needs to place asks manually (shouldn't happen in normal flow)
        console.log('   ⚠️ No existing ask orders. DAO LP tokens may not be on orderbook.');
        console.log('   💡 In normal flow, DAO asks are auto-placed during policy creation.');
    }

    // Charlie buys 2 LP tokens (40% of 5)
    const charlieBuyAmount = 2n;
    const charlieMaxPrice = pricePerLp; // 100 USDT max per token
    
    console.log(`\n   📥 Charlie buys: ${charlieBuyAmount.toString()} LP tokens @ max ${formatUsdt(charlieMaxPrice)} each`);
    const charlieBuyTx = api.tx.prmxOrderbookLp.buyLp(policyId, charlieMaxPrice, charlieBuyAmount);
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
    console.log('   ✅ Charlie bought LP tokens');

    // Dave buys 1 LP token (20% of 5)
    const daveBuyAmount = 1n;
    const daveMaxPrice = pricePerLp;
    
    console.log(`\n   📥 Dave buys: ${daveBuyAmount.toString()} LP tokens @ max ${formatUsdt(daveMaxPrice)} each`);
    const daveBuyTx = api.tx.prmxOrderbookLp.buyLp(policyId, daveMaxPrice, daveBuyAmount);
    await new Promise((resolve) => {
        daveBuyTx.signAndSend(dave, ({ status, events }) => {
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
    console.log('   ✅ Dave bought LP tokens');

    // Show LP distribution after trading
    const lpBalances = [
        await getBalances(api, daoAccount, 'DAO', policyId),
        await getBalances(api, charlie.address, 'Charlie', policyId),
        await getBalances(api, dave.address, 'Dave', policyId),
    ];
    const totalLpAfterTrade = await api.query.prmxHoldings.totalLpShares(policyId);
    printLpDistribution(lpBalances, BigInt(totalLpAfterTrade.toString()), 'LP Distribution After Trading');

    // Show pool balance
    const poolBalance = await api.query.prmxPolicy.policyRiskPoolBalance(policyId);
    console.log(`\n   🏦 Policy Pool: ${formatUsdt(BigInt(poolBalance.toString()))}`);

    // =========================================================================
    // STEP 3: Wait for Coverage to End
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 3: WAIT FOR COVERAGE TO END');
    console.log('─'.repeat(70));

    let currentChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    const waitTime = Math.max(0, coverageEnd - currentChainTs + 15);
    
    console.log(`⏳ Waiting ${waitTime.toFixed(0)} seconds...`);
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
    // STEP 4: Settlement - Pro-rata Distribution
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 4: SETTLEMENT AT MATURITY (NO EVENT)');
    console.log('─'.repeat(70));

    // Get balances before settlement
    const beforeSettlement = {
        dao: (await api.query.assets.account(USDT_ASSET_ID, daoAccount)).isSome 
            ? BigInt((await api.query.assets.account(USDT_ASSET_ID, daoAccount)).unwrap().balance.toString()) : 0n,
        charlie: (await api.query.assets.account(USDT_ASSET_ID, charlie.address)).isSome 
            ? BigInt((await api.query.assets.account(USDT_ASSET_ID, charlie.address)).unwrap().balance.toString()) : 0n,
        dave: (await api.query.assets.account(USDT_ASSET_ID, dave.address)).isSome 
            ? BigInt((await api.query.assets.account(USDT_ASSET_ID, dave.address)).unwrap().balance.toString()) : 0n,
    };

    const poolBefore = BigInt(poolBalance.toString());
    
    // Calculate expected distribution
    const totalLpNow = BigInt((await api.query.prmxHoldings.totalLpShares(policyId)).toString());
    const daoLp = lpBalances[0].lp + lpBalances[0].lockedLp;
    const charlieLp = lpBalances[1].lp + lpBalances[1].lockedLp;
    const daveLp = lpBalances[2].lp + lpBalances[2].lockedLp;
    
    console.log('\n   💡 EXPECTED PRO-RATA DISTRIBUTION:');
    console.log(`      Pool balance: ${formatUsdt(poolBefore)}`);
    console.log('');
    console.log(`      DAO (${(Number(daoLp * 100n / totalLpNow))}% of LP):`);
    console.log(`         Expected: ${formatUsdt(poolBefore * daoLp / totalLpNow)}`);
    console.log(`      Charlie (${(Number(charlieLp * 100n / totalLpNow))}% of LP):`);
    console.log(`         Expected: ${formatUsdt(poolBefore * charlieLp / totalLpNow)}`);
    console.log(`      Dave (${(Number(daveLp * 100n / totalLpNow))}% of LP):`);
    console.log(`         Expected: ${formatUsdt(poolBefore * daveLp / totalLpNow)}`);

    // Settle policy (no event)
    console.log(`\n⏳ Settling policy (event_occurred: false)...`);
    const settleTx = api.tx.prmxPolicy.settlePolicy(policyId, false);
    
    await new Promise((resolve) => {
        settleTx.signAndSend(alice, ({ status, events }) => {
            if (status.isInBlock) {
                console.log('\n   📋 SETTLEMENT EVENTS:');
                for (const { event } of events) {
                    if (event.section === 'prmxPolicy' || event.section === 'prmxHoldings') {
                        console.log(`      • ${event.section}.${event.method}`);
                    }
                }
                resolve();
            }
        });
    });

    // Get balances after settlement
    const afterSettlement = {
        dao: (await api.query.assets.account(USDT_ASSET_ID, daoAccount)).isSome 
            ? BigInt((await api.query.assets.account(USDT_ASSET_ID, daoAccount)).unwrap().balance.toString()) : 0n,
        charlie: (await api.query.assets.account(USDT_ASSET_ID, charlie.address)).isSome 
            ? BigInt((await api.query.assets.account(USDT_ASSET_ID, charlie.address)).unwrap().balance.toString()) : 0n,
        dave: (await api.query.assets.account(USDT_ASSET_ID, dave.address)).isSome 
            ? BigInt((await api.query.assets.account(USDT_ASSET_ID, dave.address)).unwrap().balance.toString()) : 0n,
    };

    // =========================================================================
    // RESULTS
    // =========================================================================
    console.log('\n' + '='.repeat(70));
    console.log('SETTLEMENT RESULTS - PRO-RATA DISTRIBUTION');
    console.log('='.repeat(70));

    const daoReceived = afterSettlement.dao - beforeSettlement.dao;
    const charlieReceived = afterSettlement.charlie - beforeSettlement.charlie;
    const daveReceived = afterSettlement.dave - beforeSettlement.dave;
    const totalDistributed = daoReceived + charlieReceived + daveReceived;

    console.log('\n   📊 ACTUAL DISTRIBUTION FROM SETTLEMENT:');
    console.log(`      DAO received: ${formatUsdt(daoReceived)}`);
    console.log(`      Charlie received: ${formatUsdt(charlieReceived)}`);
    console.log(`      Dave received: ${formatUsdt(daveReceived)}`);
    console.log(`      ─────────────────────────────`);
    console.log(`      Total distributed: ${formatUsdt(totalDistributed)}`);

    // Verify percentages
    if (totalDistributed > 0n) {
        console.log('\n   📈 DISTRIBUTION PERCENTAGES:');
        console.log(`      DAO: ${(Number(daoReceived * 10000n / totalDistributed) / 100).toFixed(1)}%`);
        console.log(`      Charlie: ${(Number(charlieReceived * 10000n / totalDistributed) / 100).toFixed(1)}%`);
        console.log(`      Dave: ${(Number(daveReceived * 10000n / totalDistributed) / 100).toFixed(1)}%`);
    }

    // LP tokens should be burned
    const lpSupplyAfter = await api.query.prmxHoldings.totalLpShares(policyId);
    console.log(`\n   🎫 LP Tokens After Settlement: ${lpSupplyAfter.toString()} (should be 0 - all burned)`);

    // Policy status
    const policyAfter = await api.query.prmxPolicy.policies(policyId);
    console.log(`   📄 Policy Status: ${policyAfter.isSome ? policyAfter.unwrap().status.toString() : 'N/A'}`);

    console.log('\n   💡 KEY TAKEAWAYS:');
    console.log('      • Pool distributed proportionally to LP shareholding');
    console.log('      • Each LP holder receives their pro-rata share');
    console.log('      • LP tokens are burned after distribution');
    console.log('      • Bob (policyholder) received nothing - premium was cost of protection');

    await api.disconnect();
}

main().catch(console.error);
