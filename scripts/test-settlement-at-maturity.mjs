#!/usr/bin/env node
/**
 * PRMX Test - Settlement at Maturity (Event Did NOT Happen)
 * 
 * This test demonstrates the fund flow when rainfall stays BELOW the strike threshold,
 * meaning NO payout event occurs. At maturity:
 * - Policy holder (Bob) receives NOTHING (premium was the cost of insurance)
 * - LP holders (DAO + any secondary LP investors) receive the ENTIRE pool pro-rata
 * 
 * Strike: 50mm (500 scaled)
 * Rainfall: 23mm (230 scaled) - BELOW threshold
 * Result: DAO/LPs receive 100 USDT (premium + capital returned)
 * 
 * Usage: node test-settlement-at-maturity.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

// Configuration
const WS_ENDPOINT = 'ws://127.0.0.1:9944';
const USDT_ASSET_ID = 1;
const MARKET_ID = 0;
const MANILA_ACCUWEATHER_KEY = '3423441';
const COVERAGE_DURATION_SECS = 60; // Short duration for testing

// LOW rainfall data - BELOW strike threshold (50mm = 500 scaled)
const RAINFALL_DATA_NO_EVENT = [
    { hourOffset: 0, rainfall: 50 },   // 5.0mm
    { hourOffset: 1, rainfall: 100 },  // 10.0mm
    { hourOffset: 2, rainfall: 80 },   // 8.0mm - Total: 23mm < 50mm strike
];

function formatUsdt(balance) {
    return `${(Number(balance) / 1e6).toFixed(2)} USDT`;
}

async function getBalances(api, address, label, policyId = 0) {
    const usdt = await api.query.assets.account(USDT_ASSET_ID, address);
    const usdtBalance = usdt.isSome ? BigInt(usdt.unwrap().balance.toString()) : 0n;
    
    // Get LP token holdings for specific policy
    const holdings = await api.query.prmxHoldings.holdingsStorage(policyId, address);
    const lpShares = BigInt(holdings.lpShares.toString());
    const lockedShares = BigInt(holdings.lockedShares.toString());
    
    return { usdt: usdtBalance, lp: lpShares, lockedLp: lockedShares, label };
}

function printBalances(balances, title) {
    console.log(`\n   📊 ${title}:`);
    for (const bal of balances) {
        console.log(`      ${bal.label}:`);
        console.log(`         USDT: ${formatUsdt(bal.usdt)}`);
        if (bal.lp > 0n || bal.lockedLp > 0n) {
            console.log(`         LP Tokens: ${bal.lp.toString()} (free) + ${bal.lockedLp.toString()} (locked)`);
        }
    }
}

function printBalanceChanges(before, after, title) {
    console.log(`\n   📈 ${title}:`);
    for (let i = 0; i < before.length; i++) {
        const b = before[i];
        const a = after[i];
        const usdtChange = a.usdt - b.usdt;
        const lpChange = a.lp - b.lp;
        const lockedLpChange = a.lockedLp - b.lockedLp;
        
        if (usdtChange !== 0n || lpChange !== 0n || lockedLpChange !== 0n) {
            console.log(`      ${b.label}:`);
            if (usdtChange !== 0n) {
                const sign = usdtChange >= 0n ? '+' : '';
                console.log(`         USDT: ${sign}${formatUsdt(usdtChange)} (${formatUsdt(b.usdt)} → ${formatUsdt(a.usdt)})`);
            }
            if (lpChange !== 0n) {
                const sign = lpChange >= 0n ? '+' : '';
                console.log(`         LP Tokens (free): ${sign}${lpChange.toString()}`);
            }
            if (lockedLpChange !== 0n) {
                const sign = lockedLpChange >= 0n ? '+' : '';
                console.log(`         LP Tokens (locked): ${sign}${lockedLpChange.toString()}`);
            }
        }
    }
}

async function main() {
    console.log('='.repeat(70));
    console.log('PRMX TEST - SETTLEMENT AT MATURITY (NO EVENT)');
    console.log('='.repeat(70));
    console.log('');
    console.log('✨ This test simulates LOW rainfall that stays BELOW the strike threshold.');
    console.log('   The policy matures without an event occurring.');
    console.log('   LP holders (DAO) receive the entire pool (premium + returned capital).');
    console.log('');

    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    console.log('✅ Connected to PRMX node');
    
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');
    
    // Get DAO account address
    const { encodeAddress } = await import('@polkadot/util-crypto');
    const daoAccountHex = '0x' + '00'.repeat(32);
    const daoAccount = encodeAddress(daoAccountHex, 42);
    
    console.log(`   Alice (Sudo/Oracle): ${alice.address}`);
    console.log(`   Bob (Customer): ${bob.address}`);
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
    
    const initialBalances = [
        await getBalances(api, bob.address, 'Bob (Customer)', 0),
        await getBalances(api, daoAccount, 'DAO Account', 0),
        await getBalances(api, alice.address, 'Alice (Sudo)', 0),
    ];
    printBalances(initialBalances, 'Starting Balances');

    // =========================================================================
    // STEP 1: Setup Oracle
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 1: SETUP ORACLE');
    console.log('─'.repeat(70));

    // Bind location if needed
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

    // =========================================================================
    // STEP 2: Submit LOW Rainfall Data (No Event)
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 2: SUBMIT LOW RAINFALL DATA (NO EVENT)');
    console.log('─'.repeat(70));
    
    console.log('   🌤️ Submitting rainfall data that stays BELOW strike threshold:');
    console.log('   Strike threshold: 50mm (500 scaled)');
    
    let totalRainfall = 0;
    const baseTimestamp = chainNow;
    
    for (const data of RAINFALL_DATA_NO_EVENT) {
        const timestamp = Math.floor(baseTimestamp - (data.hourOffset * 3600));
        totalRainfall += data.rainfall;
        
        console.log(`   Submitting: ${data.rainfall / 10}mm at ${new Date(timestamp * 1000).toISOString()}`);
        
        const rainTx = api.tx.prmxOracle.submitRainfall(MARKET_ID, timestamp, data.rainfall);
        await new Promise((resolve) => {
            rainTx.signAndSend(alice, ({ status }) => {
                if (status.isInBlock) resolve();
            });
        });
    }
    
    console.log(`\n   📊 RAINFALL SUMMARY:`);
    console.log(`      Total 24h rainfall: ${totalRainfall / 10}mm (${totalRainfall} scaled)`);
    console.log(`      Strike threshold: 50mm (500 scaled)`);
    console.log(`      Status: ${totalRainfall >= 500 ? '🔴 EVENT!' : '✅ NO EVENT (below threshold)'}`);

    // =========================================================================
    // STEP 3: Bob Requests Insurance Quote
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 3: BOB REQUESTS INSURANCE QUOTE');
    console.log('─'.repeat(70));

    const coverageStart = Math.floor(chainNow + 10);
    const coverageEnd = coverageStart + COVERAGE_DURATION_SECS;
    const shares = 1;
    
    console.log(`   Coverage: ${new Date(coverageStart * 1000).toISOString()}`);
    console.log(`         to: ${new Date(coverageEnd * 1000).toISOString()}`);
    console.log(`   Duration: ${COVERAGE_DURATION_SECS} seconds`);
    console.log(`   Shares: ${shares} (= ${shares * 100} USDT max payout)`);
    
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
    console.log(`✅ Quote requested! Quote ID: ${quoteId}`);

    // =========================================================================
    // STEP 4: Submit Quote (Pricing Oracle)
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 4: PRICING ORACLE SUBMITS QUOTE');
    console.log('─'.repeat(70));

    const probabilityPpm = 50_000; // 5%
    console.log(`   Event probability: ${probabilityPpm / 10000}%`);
    console.log(`   DAO margin: 20%`);
    
    const submitQuoteTx = api.tx.prmxQuote.submitQuote(quoteId, probabilityPpm);
    
    await new Promise((resolve) => {
        submitQuoteTx.signAndSend(alice, ({ status }) => {
            if (status.isInBlock) resolve();
        });
    });
    
    const quoteResult = await api.query.prmxQuote.quoteResults(quoteId);
    const premium = quoteResult.isSome ? BigInt(quoteResult.unwrap().totalPremium.toString()) : 0n;
    console.log(`✅ Quote ready! Premium: ${formatUsdt(premium)}`);

    // =========================================================================
    // STEP 5: Bob Buys Insurance
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 5: BOB BUYS INSURANCE');
    console.log('─'.repeat(70));

    const beforeCoverageBalances = [
        await getBalances(api, bob.address, 'Bob (Customer)', 0),
        await getBalances(api, daoAccount, 'DAO Account', 0),
    ];
    printBalances(beforeCoverageBalances, 'Balances BEFORE Coverage');

    const maxPayout = BigInt(shares) * 100_000_000n;
    const daoCapitalRequired = maxPayout - premium;
    
    console.log('\n   💡 FUND FLOW:');
    console.log(`      Bob pays premium: ${formatUsdt(premium)}`);
    console.log(`      DAO provides capital: ${formatUsdt(daoCapitalRequired)}`);
    console.log(`      Policy pool receives: ${formatUsdt(maxPayout)}`);
    console.log(`      DAO receives LP tokens: ${shares} token(s)`);

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
    console.log(`\n✅ Policy created! Policy ID: ${policyId}`);

    // Get balances after coverage (use policyId for LP tokens)
    const afterCoverageBalances = [
        await getBalances(api, bob.address, 'Bob (Customer)', policyId),
        await getBalances(api, daoAccount, 'DAO Account', policyId),
    ];
    printBalanceChanges(
        [
            await getBalances(api, bob.address, 'Bob (Customer)', policyId),
            await getBalances(api, daoAccount, 'DAO Account', policyId),
        ].map((b, i) => ({ ...beforeCoverageBalances[i], lp: 0n, lockedLp: 0n })),
        afterCoverageBalances,
        'Balance Changes from Coverage'
    );

    // Show LP token distribution
    const daoLpBalance = afterCoverageBalances[1].lp;
    const totalLpShares = await api.query.prmxHoldings.totalLpShares(policyId);
    console.log(`\n   🎫 LP TOKEN DISTRIBUTION (Policy ${policyId}):`);
    console.log(`      DAO: ${daoLpBalance.toString()} LP tokens (100%)`);
    console.log(`      Total: ${totalLpShares.toString()} LP tokens`);

    // Show pool balance
    const poolBalance = await api.query.prmxPolicy.policyRiskPoolBalance(policyId);
    console.log(`\n   🏦 POLICY RISK POOL:`);
    console.log(`      Balance: ${formatUsdt(BigInt(poolBalance.toString()))}`);

    // =========================================================================
    // STEP 6: Wait for Coverage to End
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 6: WAIT FOR COVERAGE TO END');
    console.log('─'.repeat(70));

    let currentChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    const waitTime = Math.max(0, coverageEnd - currentChainTs + 15);
    
    console.log(`⏳ Waiting ${waitTime.toFixed(0)} seconds for coverage window to end...`);
    console.log('   (No rainfall event will occur - sum stays below 50mm)');
    
    for (let i = waitTime; i > 0; i -= 10) {
        console.log(`   ${i.toFixed(0)} seconds remaining...`);
        await new Promise(r => setTimeout(r, Math.min(10000, i * 1000)));
    }
    console.log('✅ Coverage window has ended!');

    // =========================================================================
    // STEP 7: Settlement at Maturity (No Event)
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 7: SETTLEMENT AT MATURITY - NO EVENT');
    console.log('─'.repeat(70));

    // Wait for chain time
    let settlementChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    while (settlementChainTs <= coverageEnd) {
        await new Promise(r => setTimeout(r, 6000));
        settlementChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    }
    await new Promise(r => setTimeout(r, 12000));
    console.log('   ✅ Chain time confirmed past coverage end');

    // Check oracle data
    const rollingState = await api.query.prmxOracle.rollingState(MARKET_ID);
    if (rollingState.isSome) {
        const state = rollingState.unwrap();
        const sum = state.rollingSumMm.toNumber();
        console.log(`\n   🌤️ ORACLE DATA AT SETTLEMENT:`);
        console.log(`      24h Rolling Sum: ${sum / 10}mm`);
        console.log(`      Strike Threshold: 50mm`);
        console.log(`      Event Occurred: ${sum >= 500 ? '🔴 YES' : '✅ NO (Policy matures safely)'}`);
    }

    const beforeSettlementBalances = [
        await getBalances(api, bob.address, 'Bob (Customer)', policyId),
        await getBalances(api, daoAccount, 'DAO Account', policyId),
    ];
    printBalances(beforeSettlementBalances, 'Balances BEFORE Settlement');

    const poolBalBefore = await api.query.prmxPolicy.policyRiskPoolBalance(policyId);
    console.log(`\n   🏦 Policy Pool Balance: ${formatUsdt(BigInt(poolBalBefore.toString()))}`);

    // Event did NOT occur
    const eventOccurred = false;
    
    console.log('\n   💡 EXPECTED SETTLEMENT FUND FLOW (NO EVENT):');
    console.log(`      ✨ Policy matures without event - LP holders win!`);
    console.log(`      Bob receives: 0 USDT (premium was the cost of insurance)`);
    console.log(`      Pool (${formatUsdt(BigInt(poolBalBefore.toString()))}) → distributed to LP holders pro-rata`);
    console.log(`      DAO (100% LP shares) receives: ${formatUsdt(BigInt(poolBalBefore.toString()))}`);

    console.log(`\n⏳ Settling policy (event_occurred: ${eventOccurred})...`);
    const settleTx = api.tx.prmxPolicy.settlePolicy(policyId, eventOccurred);
    
    await new Promise((resolve) => {
        settleTx.signAndSend(alice, ({ status, events }) => {
            if (status.isInBlock) {
                console.log('\n   📋 SETTLEMENT EVENTS:');
                for (const { event } of events) {
                    if (event.section === 'prmxPolicy') {
                        console.log(`      • ${event.method}: ${event.data.toString()}`);
                    }
                    if (event.section === 'prmxHoldings') {
                        console.log(`      • ${event.section}.${event.method}: ${event.data.toString()}`);
                    }
                    if (event.section === 'assets' && event.method === 'Transferred') {
                        const [, from, to, amount] = event.data;
                        console.log(`      • Asset Transfer: ${formatUsdt(BigInt(amount.toString()))} from ${from.toString().substring(0,10)}... to ${to.toString().substring(0,10)}...`);
                    }
                }
                resolve();
            }
        });
    });

    const afterSettlementBalances = [
        await getBalances(api, bob.address, 'Bob (Customer)', policyId),
        await getBalances(api, daoAccount, 'DAO Account', policyId),
    ];
    printBalanceChanges(beforeSettlementBalances, afterSettlementBalances, 'Balance Changes from Settlement');

    // Check policy status
    const policyAfter = await api.query.prmxPolicy.policies(policyId);
    if (policyAfter.isSome) {
        console.log(`\n   📄 POLICY STATUS: ${policyAfter.unwrap().status.toString()}`);
    }

    // Check settlement result
    const settlementResult = await api.query.prmxPolicy.settlementResults(policyId);
    if (settlementResult.isSome) {
        const result = settlementResult.unwrap();
        console.log(`\n   📋 SETTLEMENT RESULT:`);
        console.log(`      Event Occurred: ${result.eventOccurred.toString()}`);
        console.log(`      Payout to Holder: ${formatUsdt(BigInt(result.payoutToHolder.toString()))}`);
        console.log(`      Returned to LPs: ${formatUsdt(BigInt(result.returnedToLps.toString()))}`);
        console.log(`      Settled At: ${new Date(result.settledAt.toNumber() * 1000).toISOString()}`);
    }

    // Check pool is empty
    const poolBalAfter = await api.query.prmxPolicy.policyRiskPoolBalance(policyId);
    console.log(`\n   🏦 Policy Pool Balance: ${formatUsdt(BigInt(poolBalAfter.toString()))} (should be 0)`);

    // Check LP tokens were burned
    const lpSupplyAfter = await api.query.prmxHoldings.totalLpShares(policyId);
    console.log(`   🎫 LP Tokens Remaining: ${lpSupplyAfter.toString()} (should be 0 - all burned)`);

    // =========================================================================
    // FINAL SUMMARY
    // =========================================================================
    console.log('\n' + '='.repeat(70));
    console.log('TEST COMPLETE - SETTLEMENT AT MATURITY SUMMARY');
    console.log('='.repeat(70));

    console.log('\n📊 NET BALANCE CHANGES (Start → End):');
    
    // Recalculate with initial balances
    const finalBob = await getBalances(api, bob.address, 'Bob (Customer)', policyId);
    const finalDao = await getBalances(api, daoAccount, 'DAO Account', policyId);
    
    const bobUsdtChange = finalBob.usdt - initialBalances[0].usdt;
    const daoUsdtChange = finalDao.usdt - initialBalances[1].usdt;
    
    console.log(`   Bob (Customer):`);
    console.log(`      USDT: ${bobUsdtChange >= 0n ? '+' : ''}${formatUsdt(bobUsdtChange)}`);
    console.log(`      (Paid premium, received nothing back)`);
    
    console.log(`   DAO Account:`);
    console.log(`      USDT: ${daoUsdtChange >= 0n ? '+' : ''}${formatUsdt(daoUsdtChange)}`);
    console.log(`      (Provided capital, received pool + premium)`);

    console.log('\n📝 FUND FLOW SUMMARY (NO EVENT - MATURITY):');
    console.log('   ✨ NO RAINFALL EVENT - Policy matured safely!');
    console.log('');
    console.log(`   1️⃣  Bob paid: ${formatUsdt(premium)} (premium)`);
    console.log(`   2️⃣  DAO contributed: ${formatUsdt(daoCapitalRequired)} (capital at risk)`);
    console.log(`   3️⃣  Policy pool held: ${formatUsdt(maxPayout)}`);
    console.log(`   4️⃣  At maturity (no event):`);
    console.log(`       • Bob receives: $0.00 (premium was cost of protection)`);
    console.log(`       • DAO receives: ${formatUsdt(maxPayout)} (capital + premium profit)`);
    console.log(`       • LP tokens: Burned after distribution`);
    console.log('');
    console.log(`   💰 NET RESULT:`);
    console.log(`       • Bob LOST: ${formatUsdt(premium)} (insurance premium)`);
    console.log(`       • DAO GAINED: ${formatUsdt(premium)} (premium profit)`);
    console.log('');
    console.log('   💡 This is the intended behavior: when no rainfall event occurs,');
    console.log('      the insurance premium becomes profit for LP token holders.');

    await api.disconnect();
}

main().catch(console.error);
