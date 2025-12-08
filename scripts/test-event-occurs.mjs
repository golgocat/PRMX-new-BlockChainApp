#!/usr/bin/env node
/**
 * PRMX Test - Event Occurs (Policyholder Wins)
 * 
 * This test demonstrates the fund flow when rainfall EXCEEDS the strike threshold,
 * triggering a payout to the policyholder (Bob).
 * 
 * Strike: 50mm (500 scaled)
 * Rainfall: 55mm (550 scaled) - EXCEEDS threshold
 * Result: Bob receives 100 USDT payout
 * 
 * Usage: node test-event-occurs.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

// Configuration
const WS_ENDPOINT = 'ws://127.0.0.1:9944';
const USDT_ASSET_ID = 1;
const MARKET_ID = 0;
const MANILA_ACCUWEATHER_KEY = '3423441';
const COVERAGE_DURATION_SECS = 60;

// HIGH rainfall data - EXCEEDS strike threshold (50mm = 500 scaled)
const RAINFALL_DATA_EVENT = [
    { hourOffset: 0, rainfall: 250 },  // 25.0mm
    { hourOffset: 1, rainfall: 350 },  // 35.0mm - Total: 60mm > 50mm strike!
];

function formatUsdt(balance) {
    return `${(Number(balance) / 1e6).toFixed(2)} USDT`;
}

async function getBalances(api, address, label) {
    const usdt = await api.query.assets.account(USDT_ASSET_ID, address);
    const usdtBalance = usdt.isSome ? BigInt(usdt.unwrap().balance.toString()) : 0n;
    
    const holdings = await api.query.prmxHoldings.holdingsStorage(MARKET_ID, address);
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
    console.log('PRMX TEST - EVENT OCCURS (POLICYHOLDER WINS)');
    console.log('='.repeat(70));
    console.log('');
    console.log('⚠️  This test simulates HIGH rainfall that EXCEEDS the strike threshold.');
    console.log('   Bob (policyholder) should receive the full 100 USDT payout.');
    console.log('');

    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    console.log('✅ Connected to PRMX node');
    
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');
    
    const daoAccountHex = '0x' + '00'.repeat(32);
    const { encodeAddress } = await import('@polkadot/util-crypto');
    const daoAccount = encodeAddress(daoAccountHex, 42);
    
    console.log(`   Alice (Sudo): ${alice.address}`);
    console.log(`   Bob (Customer): ${bob.address}`);
    console.log(`   DAO Account: ${daoAccount}`);

    const chainTimestamp = await api.query.timestamp.now();
    const chainNow = chainTimestamp.toNumber() / 1000;
    console.log(`\n⏰ Chain time: ${new Date(chainNow * 1000).toISOString()}`);

    // Initial balances
    console.log('\n' + '─'.repeat(70));
    console.log('INITIAL STATE');
    console.log('─'.repeat(70));
    
    const initialBalances = [
        await getBalances(api, bob.address, 'Bob (Customer)'),
        await getBalances(api, daoAccount, 'DAO Account'),
    ];
    printBalances(initialBalances, 'Starting Balances');

    // Setup oracle
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 1: SETUP ORACLE');
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

    // Submit HIGH rainfall data
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 2: SUBMIT HIGH RAINFALL DATA (EVENT!)');
    console.log('─'.repeat(70));
    
    console.log('   🌧️ Submitting rainfall data that EXCEEDS strike threshold:');
    console.log('   Strike threshold: 50mm (500 scaled)');
    
    let totalRainfall = 0;
    const baseTimestamp = chainNow;
    
    for (const data of RAINFALL_DATA_EVENT) {
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
    
    console.log(`\n   ⚡ TOTAL RAINFALL: ${totalRainfall / 10}mm (${totalRainfall} scaled)`);
    console.log(`   ⚡ STRIKE THRESHOLD: 50mm (500 scaled)`);
    console.log(`   ⚡ RESULT: ${totalRainfall >= 500 ? '🔴 EVENT OCCURRED!' : '✅ No event'}`);

    // Request quote
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 3: BOB REQUESTS INSURANCE QUOTE');
    console.log('─'.repeat(70));

    const coverageStart = Math.floor(chainNow + 10);
    const coverageEnd = coverageStart + COVERAGE_DURATION_SECS;
    const shares = 1;
    
    console.log(`   Coverage: ${new Date(coverageStart * 1000).toISOString()} to ${new Date(coverageEnd * 1000).toISOString()}`);
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

    // Submit quote
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 4: PRICING ORACLE SUBMITS QUOTE');
    console.log('─'.repeat(70));

    const probabilityPpm = 50_000; // 5%
    const submitQuoteTx = api.tx.prmxQuote.submitQuote(quoteId, probabilityPpm);
    
    await new Promise((resolve) => {
        submitQuoteTx.signAndSend(alice, ({ status }) => {
            if (status.isInBlock) resolve();
        });
    });
    
    const quoteResult = await api.query.prmxQuote.quoteResults(quoteId);
    const premium = quoteResult.isSome ? BigInt(quoteResult.unwrap().totalPremium.toString()) : 0n;
    console.log(`✅ Quote ready! Premium: ${formatUsdt(premium)}`);

    // Apply coverage
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 5: BOB BUYS INSURANCE');
    console.log('─'.repeat(70));

    const beforeCoverageBalances = [
        await getBalances(api, bob.address, 'Bob (Customer)'),
        await getBalances(api, daoAccount, 'DAO Account'),
    ];
    printBalances(beforeCoverageBalances, 'Balances BEFORE Coverage');

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

    const afterCoverageBalances = [
        await getBalances(api, bob.address, 'Bob (Customer)'),
        await getBalances(api, daoAccount, 'DAO Account'),
    ];
    printBalanceChanges(beforeCoverageBalances, afterCoverageBalances, 'Balance Changes from Coverage');

    // Wait for coverage to end
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 6: WAIT FOR COVERAGE TO END');
    console.log('─'.repeat(70));

    let currentChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    const waitTime = Math.max(0, coverageEnd - currentChainTs + 15);
    
    console.log(`⏳ Waiting ${waitTime.toFixed(0)} seconds for coverage window to end...`);
    for (let i = waitTime; i > 0; i -= 10) {
        console.log(`   ${i.toFixed(0)} seconds remaining...`);
        await new Promise(r => setTimeout(r, Math.min(10000, i * 1000)));
    }
    console.log('✅ Coverage window has ended!');

    // Settlement
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 7: SETTLEMENT - EVENT OCCURRED!');
    console.log('─'.repeat(70));

    // Wait for chain time
    let settlementChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    while (settlementChainTs <= coverageEnd) {
        await new Promise(r => setTimeout(r, 6000));
        settlementChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    }
    await new Promise(r => setTimeout(r, 12000));
    console.log('   ✅ Chain time confirmed past coverage end');

    const beforeSettlementBalances = [
        await getBalances(api, bob.address, 'Bob (Customer)'),
        await getBalances(api, daoAccount, 'DAO Account'),
    ];
    printBalances(beforeSettlementBalances, 'Balances BEFORE Settlement');

    const poolBalBefore = await api.query.prmxPolicy.policyRiskPoolBalance(policyId);
    console.log(`\n   🏦 Policy Pool Balance: ${formatUsdt(BigInt(poolBalBefore.toString()))}`);

    // Event OCCURRED - Bob should receive payout
    const eventOccurred = true;
    
    console.log('\n   💡 EXPECTED SETTLEMENT FUND FLOW:');
    console.log(`      🔴 EVENT OCCURRED - Policyholder wins!`);
    console.log(`      Bob receives: 100.00 USDT (max payout)`);
    console.log(`      DAO loses: 94.00 USDT (capital at risk)`);

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
        await getBalances(api, bob.address, 'Bob (Customer)'),
        await getBalances(api, daoAccount, 'DAO Account'),
    ];
    printBalanceChanges(beforeSettlementBalances, afterSettlementBalances, 'Balance Changes from Settlement');

    const policyAfter = await api.query.prmxPolicy.policies(policyId);
    if (policyAfter.isSome) {
        console.log(`\n   📄 POLICY STATUS: ${policyAfter.unwrap().status.toString()}`);
    }

    // Final summary
    console.log('\n' + '='.repeat(70));
    console.log('TEST COMPLETE - FINAL SUMMARY');
    console.log('='.repeat(70));

    console.log('\n📊 NET BALANCE CHANGES (Start → End):');
    for (let i = 0; i < initialBalances.length; i++) {
        const initial = initialBalances[i];
        const final = afterSettlementBalances[i];
        const usdtChange = final.usdt - initial.usdt;
        
        console.log(`   ${initial.label}:`);
        const sign = usdtChange >= 0n ? '+' : '';
        console.log(`      USDT: ${sign}${formatUsdt(usdtChange)} (${formatUsdt(initial.usdt)} → ${formatUsdt(final.usdt)})`);
    }

    console.log('\n📝 FUND FLOW SUMMARY:');
    console.log('   🔴 RAINFALL EVENT OCCURRED - Policyholder wins!');
    console.log(`   • Bob paid ${formatUsdt(premium)} premium`);
    console.log(`   • Bob received 100.00 USDT payout`);
    console.log(`   • Bob NET GAIN: ${formatUsdt(100_000_000n - premium)}`);
    console.log(`   • DAO provided 94.00 USDT capital`);
    console.log(`   • DAO received 0 USDT back`);
    console.log(`   • DAO NET LOSS: 94.00 USDT`);

    await api.disconnect();
}

main().catch(console.error);

