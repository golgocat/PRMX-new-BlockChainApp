#!/usr/bin/env node
/**
 * PRMX Full Insurance Cycle Test with Detailed Fund Flow
 * 
 * This script demonstrates the complete insurance flow with detailed fund tracking:
 * 1. Bind AccuWeather location to market (oracle setup)
 * 2. Submit rainfall data from AccuWeather
 * 3. Request a quote for a policy
 * 4. Submit quote result (simulate pricing oracle)
 * 5. Apply for coverage (with DAO liquidity provision tracking)
 * 6. Wait for coverage window to end
 * 7. Settle the policy (with fund distribution tracking)
 * 
 * Usage: node test-full-insurance-cycle.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

// Configuration
const WS_ENDPOINT = 'ws://127.0.0.1:9944';
const USDT_ASSET_ID = 1;
const MARKET_ID = 0; // Manila market

// AccuWeather location key for Manila (resolved by oracle)
const MANILA_ACCUWEATHER_KEY = '3423441';

// Test coverage: 60 seconds for quick testing
const COVERAGE_DURATION_SECS = 60;

// Simulated rainfall data (mm * 10, so 25.5mm = 255)
// This will be below strike (500 = 50mm), so NO side should win
const RAINFALL_DATA_NO_EVENT = [
  { hourOffset: 0, rainfall: 50 },   // 5.0mm
  { hourOffset: 1, rainfall: 100 },  // 10.0mm
  { hourOffset: 2, rainfall: 80 },   // 8.0mm
];

// High rainfall data (above strike threshold)
// This triggers payout - YES side wins
const RAINFALL_DATA_EVENT = [
  { hourOffset: 0, rainfall: 200 },  // 20.0mm
  { hourOffset: 1, rainfall: 350 },  // 35.0mm - 24h sum now 550 > 500 strike
];

// Helper to format USDT balance
function formatUsdt(balance) {
    return `${(Number(balance) / 1e6).toFixed(2)} USDT`;
}

// Helper to get all balances for an account
async function getBalances(api, address, label) {
    const usdt = await api.query.assets.account(USDT_ASSET_ID, address);
    const usdtBalance = usdt.isSome ? BigInt(usdt.unwrap().balance.toString()) : 0n;
    
    // Get LP token holdings for market 0 from holdings storage
    const holdings = await api.query.prmxHoldings.holdingsStorage(MARKET_ID, address);
    const lpShares = BigInt(holdings.lpShares.toString());
    const lockedShares = BigInt(holdings.lockedShares.toString());
    
    return {
        usdt: usdtBalance,
        lp: lpShares,
        lockedLp: lockedShares,
        label
    };
}

// Print balance summary
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

// Print balance changes
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
                console.log(`         LP Tokens (free): ${sign}${lpChange.toString()} (${b.lp.toString()} → ${a.lp.toString()})`);
            }
            if (lockedLpChange !== 0n) {
                const sign = lockedLpChange >= 0n ? '+' : '';
                console.log(`         LP Tokens (locked): ${sign}${lockedLpChange.toString()} (${b.lockedLp.toString()} → ${a.lockedLp.toString()})`);
            }
        }
    }
}

async function main() {
    console.log('='.repeat(70));
    console.log('PRMX FULL INSURANCE CYCLE TEST - DETAILED FUND FLOW');
    console.log('='.repeat(70));
    console.log('');

    // Connect to node
    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    console.log('✅ Connected to PRMX node');
    const chain = await api.rpc.system.chain();
    console.log(`   Chain: ${chain}`);
    
    // Setup keyring
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');
    
    // Single DAO account derived from [0u8; 32] in the runtime
    const daoAccountHex = '0x' + '00'.repeat(32);           // [0u8; 32]
    
    // Convert to SS58 address
    const { encodeAddress } = await import('@polkadot/util-crypto');
    const daoAccount = encodeAddress(daoAccountHex, 42);
    
    console.log(`   Alice (Sudo): ${alice.address}`);
    console.log(`   Bob (Customer): ${bob.address}`);
    console.log(`   DAO Account: ${daoAccount}`);
    console.log('');

    // Get current block info
    const header = await api.rpc.chain.getHeader();
    const blockNumber = header.number.toNumber();
    
    const now = Math.floor(Date.now() / 1000);
    const chainTimestamp = await api.query.timestamp.now();
    const chainNow = chainTimestamp.toNumber() / 1000;
    
    console.log(`📦 Current block: #${blockNumber}`);
    console.log(`⏰ Real time: ${new Date(now * 1000).toISOString()}`);
    console.log(`⏰ Chain time: ${new Date(chainNow * 1000).toISOString()}`);

    // =========================================================================
    // INITIAL BALANCES
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('INITIAL STATE - All Account Balances');
    console.log('─'.repeat(70));
    
    const initialBalances = [
        await getBalances(api, alice.address, 'Alice (Sudo)'),
        await getBalances(api, bob.address, 'Bob (Customer)'),
        await getBalances(api, daoAccount, 'DAO Account'),
    ];
    printBalances(initialBalances, 'Starting Balances');

    // =========================================================================
    // STEP 1: Check and bind AccuWeather location
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 1: ORACLE SETUP - Bind AccuWeather Location');
    console.log('─'.repeat(70));

    const locationConfig = await api.query.prmxOracle.marketLocationConfig(MARKET_ID);
    
    if (locationConfig.isSome) {
        const config = locationConfig.unwrap();
        const key = Buffer.from(config.accuweatherLocationKey.toU8a()).toString().replace(/\0/g, '');
        console.log(`✅ AccuWeather location already bound`);
        console.log(`   Location Key: ${key}`);
        console.log(`   Latitude: ${config.centerLatitude.toNumber() / 1e6}°`);
        console.log(`   Longitude: ${config.centerLongitude.toNumber() / 1e6}°`);
    } else {
        console.log('⏳ Binding AccuWeather location to market...');
        
        const bindTx = api.tx.sudo.sudo(
            api.tx.prmxOracle.setMarketLocationKey(MARKET_ID, MANILA_ACCUWEATHER_KEY)
        );
        
        await new Promise((resolve, reject) => {
            bindTx.signAndSend(alice, ({ status, events, dispatchError }) => {
                if (dispatchError) {
                    reject(new Error(`Bind failed: ${dispatchError.toString()}`));
                }
                if (status.isInBlock) {
                    console.log(`✅ Location bound in block ${status.asInBlock.toHex()}`);
                    resolve();
                }
            });
        });
    }

    // =========================================================================
    // STEP 2: Submit rainfall data
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 2: ORACLE DATA - Submit Rainfall from AccuWeather');
    console.log('─'.repeat(70));

    // Add Alice as oracle provider
    console.log('⏳ Adding Alice as oracle provider...');
    try {
        const addProviderTx = api.tx.sudo.sudo(
            api.tx.prmxOracle.addOracleProvider(alice.address)
        );
        await new Promise((resolve, reject) => {
            addProviderTx.signAndSend(alice, ({ status, dispatchError }) => {
                if (dispatchError) {
                    console.log(`   Note: ${dispatchError.toString()}`);
                }
                if (status.isInBlock) {
                    console.log(`✅ Oracle provider added`);
                    resolve();
                }
            });
        });
    } catch (e) {
        console.log(`   Already a provider or error: ${e.message}`);
    }

    // Submit rainfall data
    console.log('');
    console.log('⏳ Submitting rainfall data from AccuWeather...');
    console.log('   (Simulating historical 24h data for Manila)');
    
    const rainfallData = RAINFALL_DATA_NO_EVENT;
    let totalRainfall = 0;
    const baseTimestamp = chainNow > 0 ? chainNow : now;
    
    for (const data of rainfallData) {
        const timestamp = Math.floor(baseTimestamp - (data.hourOffset * 3600));
        totalRainfall += data.rainfall;
        
        console.log(`   Submitting: ${data.rainfall / 10}mm at ${new Date(timestamp * 1000).toISOString()}`);
        
        const rainTx = api.tx.prmxOracle.submitRainfall(MARKET_ID, timestamp, data.rainfall);
        
        await new Promise((resolve, reject) => {
            rainTx.signAndSend(alice, ({ status, dispatchError }) => {
                if (dispatchError) {
                    console.log(`   Warning: ${dispatchError.toString()}`);
                }
                if (status.isInBlock) {
                    resolve();
                }
            });
        });
    }
    
    console.log(`✅ Rainfall data submitted. 24h total: ${totalRainfall / 10}mm`);
    console.log(`   Strike threshold: 50mm (500 scaled)`);
    console.log(`   Expected outcome: ${totalRainfall >= 500 ? 'YES (Event occurred)' : 'NO (No event)'}`);

    // =========================================================================
    // STEP 3: Request quote
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 3: QUOTE REQUEST - Bob requests insurance quote');
    console.log('─'.repeat(70));

    const timeBase = chainNow > 0 ? chainNow : now;
    const coverageStart = Math.floor(timeBase + 10);
    const coverageEnd = coverageStart + COVERAGE_DURATION_SECS;
    const shares = 1;

    console.log(`   Market: Manila (ID: ${MARKET_ID})`);
    console.log(`   Coverage Start: ${new Date(coverageStart * 1000).toISOString()}`);
    console.log(`   Coverage End: ${new Date(coverageEnd * 1000).toISOString()}`);
    console.log(`   Duration: ${COVERAGE_DURATION_SECS} seconds`);
    console.log(`   Shares: ${shares} (= ${shares * 100} USDT max payout)`);

    const MANILA_LAT = 14_599_500;
    const MANILA_LON = 120_984_200;
    
    console.log('⏳ Requesting quote...');
    
    const quoteTx = api.tx.prmxQuote.requestPolicyQuote(
        MARKET_ID, coverageStart, coverageEnd, MANILA_LAT, MANILA_LON, shares
    );

    let quoteId;
    await new Promise((resolve, reject) => {
        quoteTx.signAndSend(bob, ({ status, events, dispatchError }) => {
            if (dispatchError) {
                reject(new Error(`Quote request failed: ${dispatchError.toString()}`));
            }
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxQuote' && event.method === 'QuoteRequested') {
                        quoteId = event.data[0].toNumber();
                        console.log(`✅ Quote requested! Quote ID: ${quoteId}`);
                    }
                }
                resolve();
            }
        });
    });

    // =========================================================================
    // STEP 4: Submit quote result
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 4: PRICING ORACLE - Submit quote calculation');
    console.log('─'.repeat(70));

    const probabilityPpm = 50_000; // 5%
    console.log(`   Event probability: ${probabilityPpm / 10000}%`);
    console.log(`   DAO margin: 20%`);

    const submitQuoteTx = api.tx.prmxQuote.submitQuote(quoteId, probabilityPpm);
    
    await new Promise((resolve, reject) => {
        submitQuoteTx.signAndSend(alice, ({ status, events, dispatchError }) => {
            if (dispatchError) {
                reject(new Error(`Submit quote failed: ${dispatchError.toString()}`));
            }
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxQuote' && event.method === 'QuoteReady') {
                        console.log(`✅ Quote ready!`);
                    }
                }
                resolve();
            }
        });
    });

    const quoteResult = await api.query.prmxQuote.quoteResults(quoteId);
    let premium = 0n;
    let premiumPerShare = 0n;
    if (quoteResult.isSome) {
        const result = quoteResult.unwrap();
        premium = BigInt(result.totalPremium.toString());
        premiumPerShare = BigInt(result.premiumPerShare.toString());
        console.log(`   Premium per share: ${formatUsdt(premiumPerShare)}`);
        console.log(`   Total premium: ${formatUsdt(premium)}`);
    }

    // =========================================================================
    // STEP 5: Apply for coverage - DETAILED FUND FLOW
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 5: APPLY COVERAGE - Bob buys insurance');
    console.log('─'.repeat(70));

    // Get balances BEFORE applying coverage
    const beforeCoverageBalances = [
        await getBalances(api, alice.address, 'Alice (Sudo)'),
        await getBalances(api, bob.address, 'Bob (Customer)'),
        await getBalances(api, daoAccount, 'DAO Account'),
    ];
    
    printBalances(beforeCoverageBalances, 'Balances BEFORE Coverage');

    // Calculate expected fund flows
    const maxPayout = BigInt(shares) * 100_000_000n; // 100 USDT per share (scaled by 1e6)
    const daoCapitalRequired = maxPayout - premium;
    
    console.log('\n   💡 EXPECTED FUND FLOW:');
    console.log(`      Bob pays premium: ${formatUsdt(premium)}`);
    console.log(`      DAO provides capital: ${formatUsdt(daoCapitalRequired)}`);
    console.log(`      Policy pool receives: ${formatUsdt(maxPayout)} (max payout)`);
    console.log(`      DAO receives LP tokens: ${shares} tokens`);

    const applyTx = api.tx.prmxPolicy.applyCoverageWithQuote(quoteId);
    
    let policyId;
    await new Promise((resolve, reject) => {
        applyTx.signAndSend(bob, ({ status, events, dispatchError }) => {
            if (dispatchError) {
                reject(new Error(`Apply coverage failed: ${dispatchError.toString()}`));
            }
            if (status.isInBlock) {
                console.log('\n   📋 EVENTS EMITTED:');
                for (const { event } of events) {
                    if (event.section === 'prmxPolicy') {
                        console.log(`      • ${event.method}: ${event.data.toString()}`);
                        if (event.method === 'PolicyCreated') {
                            policyId = event.data[0].toNumber();
                        }
                    }
                    if (event.section === 'assets' && event.method === 'Transferred') {
                        const [assetId, from, to, amount] = event.data;
                        console.log(`      • Asset Transfer: ${formatUsdt(BigInt(amount.toString()))} from ${from.toString().substring(0,8)}... to ${to.toString().substring(0,8)}...`);
                    }
                }
                resolve();
            }
        });
    });

    console.log(`\n✅ Policy created! Policy ID: ${policyId}`);

    // Get balances AFTER applying coverage
    const afterCoverageBalances = [
        await getBalances(api, alice.address, 'Alice (Sudo)'),
        await getBalances(api, bob.address, 'Bob (Customer)'),
        await getBalances(api, daoAccount, 'DAO Account'),
    ];
    
    printBalanceChanges(beforeCoverageBalances, afterCoverageBalances, 'Balance Changes from Coverage');

    // Get policy info
    const policy = await api.query.prmxPolicy.policies(policyId);
    if (policy.isSome) {
        const p = policy.unwrap();
        console.log('\n   📄 POLICY DETAILS:');
        console.log(`      Holder: ${p.holder.toString().substring(0, 20)}...`);
        console.log(`      Coverage: ${new Date(p.coverageStart.toNumber() * 1000).toISOString()}`);
        console.log(`              to ${new Date(p.coverageEnd.toNumber() * 1000).toISOString()}`);
        console.log(`      Shares: ${p.shares.toNumber()}`);
        console.log(`      Max Payout: ${formatUsdt(BigInt(p.maxPayout.toString()))}`);
        console.log(`      Status: ${p.status.toString()}`);
    }

    // Check pool balance
    const poolBalance = await api.query.prmxPolicy.policyRiskPoolBalance(policyId);
    console.log(`\n   🏦 POLICY RISK POOL:`);
    console.log(`      Balance: ${formatUsdt(BigInt(poolBalance.toString()))}`);
    console.log(`      (This is locked until settlement)`);

    // Check LP token supply
    const lpSupply = await api.query.prmxHoldings.totalLpShares(MARKET_ID);
    console.log(`\n   🎫 LP TOKEN STATUS (Market ${MARKET_ID}):`);
    console.log(`      Total Supply: ${lpSupply.toString()} tokens`);

    // =========================================================================
    // STEP 6: Wait for coverage window to end
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 6: WAIT FOR COVERAGE TO END');
    console.log('─'.repeat(70));

    const currentChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    const waitTime = Math.max(0, coverageEnd - currentChainTs + 15);
    if (waitTime > 0) {
        console.log(`⏳ Waiting ${waitTime.toFixed(0)} seconds for coverage window to end...`);
        console.log('   (Oracle continues fetching rainfall data in background)');
        
        for (let i = waitTime; i > 0; i -= 10) {
            console.log(`   ${i.toFixed(0)} seconds remaining...`);
            await new Promise(r => setTimeout(r, Math.min(10000, i * 1000)));
        }
    }
    console.log('✅ Coverage window has ended!');

    // =========================================================================
    // STEP 7: Settlement - DETAILED FUND FLOW
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 7: SETTLEMENT - Check oracle and distribute funds');
    console.log('─'.repeat(70));

    // Wait for chain time
    let settlementChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    console.log(`   Chain time: ${new Date(settlementChainTs * 1000).toISOString()}`);
    console.log(`   Coverage end: ${new Date(coverageEnd * 1000).toISOString()}`);
    
    while (settlementChainTs <= coverageEnd) {
        const extraWait = coverageEnd - settlementChainTs + 12;
        console.log(`   ⏳ Waiting ${extraWait.toFixed(0)}s more for chain time...`);
        await new Promise(r => setTimeout(r, extraWait * 1000));
        settlementChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    }
    
    console.log(`   ⏳ Waiting 2 more blocks for safe settlement...`);
    await new Promise(r => setTimeout(r, 12000));
    settlementChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    console.log(`   ✅ Chain time confirmed past coverage end`);

    // Check final oracle data
    const finalRollingState = await api.query.prmxOracle.rollingState(MARKET_ID);
    if (finalRollingState.isSome) {
        const state = finalRollingState.unwrap();
        const sum = state.rollingSumMm.toNumber();
        console.log(`\n   🌧️ ORACLE DATA AT SETTLEMENT:`);
        console.log(`      24h Rolling Sum: ${sum / 10}mm`);
        console.log(`      Strike Threshold: 50mm`);
        console.log(`      Event Occurred: ${sum >= 500 ? 'YES ✅ (Payout triggered)' : 'NO ❌ (No payout)'}`);
    }

    // Get balances BEFORE settlement
    const beforeSettlementBalances = [
        await getBalances(api, alice.address, 'Alice (Sudo)'),
        await getBalances(api, bob.address, 'Bob (Customer)'),
        await getBalances(api, daoAccount, 'DAO Account'),
    ];
    
    printBalances(beforeSettlementBalances, 'Balances BEFORE Settlement');

    // Get pool balance before settlement
    const poolBalBefore = await api.query.prmxPolicy.policyRiskPoolBalance(policyId);
    console.log(`\n   🏦 Policy Pool Balance: ${formatUsdt(BigInt(poolBalBefore.toString()))}`);

    // Determine outcome and expected fund flow
    const eventOccurred = totalRainfall >= 500;
    
    console.log('\n   💡 EXPECTED SETTLEMENT FUND FLOW:');
    if (eventOccurred) {
        console.log(`      ⚡ EVENT OCCURRED - Policyholder wins!`);
        console.log(`      Bob receives: ${formatUsdt(maxPayout)} (max payout)`);
        console.log(`      DAO loses: ${formatUsdt(daoCapitalRequired)} (capital at risk)`);
    } else {
        console.log(`      ✨ NO EVENT - DAO/LPs win!`);
        console.log(`      Bob receives: 0 USDT (premium was paid)`);
        console.log(`      Residual pool receives: ${formatUsdt(maxPayout)}`);
        console.log(`      (LP holders can claim proportional share)`);
    }

    console.log(`\n⏳ Settling policy (event_occurred: ${eventOccurred})...`);
    const settleTx = api.tx.prmxPolicy.settlePolicy(policyId, eventOccurred);
    
    await new Promise((resolve, reject) => {
        settleTx.signAndSend(alice, ({ status, events, dispatchError }) => {
            if (dispatchError) {
                try {
                    const decoded = api.registry.findMetaError(dispatchError.asModule);
                    console.log(`❌ Settlement failed: ${decoded.name} - ${decoded.docs.join(' ')}`);
                } catch (e) {
                    console.log(`❌ Settlement failed: ${dispatchError.toString()}`);
                }
                resolve();
                return;
            }
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
                        const [assetId, from, to, amount] = event.data;
                        console.log(`      • Asset Transfer: ${formatUsdt(BigInt(amount.toString()))} from ${from.toString().substring(0,8)}... to ${to.toString().substring(0,8)}...`);
                    }
                }
                resolve();
            }
        });
    });

    // Get balances AFTER settlement
    const afterSettlementBalances = [
        await getBalances(api, alice.address, 'Alice (Sudo)'),
        await getBalances(api, bob.address, 'Bob (Customer)'),
        await getBalances(api, daoAccount, 'DAO Account'),
    ];
    
    printBalanceChanges(beforeSettlementBalances, afterSettlementBalances, 'Balance Changes from Settlement');

    // Check policy status after settlement
    const policyAfter = await api.query.prmxPolicy.policies(policyId);
    if (policyAfter.isSome) {
        const p = policyAfter.unwrap();
        console.log(`\n   📄 POLICY STATUS: ${p.status.toString()}`);
    }

    // Check pool balance after settlement
    const poolBalAfter = await api.query.prmxPolicy.policyRiskPoolBalance(policyId);
    console.log(`   🏦 Policy Pool Balance: ${formatUsdt(BigInt(poolBalAfter.toString()))} (should be 0)`);

    // Check residual pool
    const residualPool = await api.query.prmxHoldings.marketLpResidualPool(MARKET_ID);
    console.log(`\n   💎 MARKET RESIDUAL POOL (for LP holders):`);
    console.log(`      Balance: ${formatUsdt(BigInt(residualPool.toString()))}`);

    // =========================================================================
    // FINAL SUMMARY
    // =========================================================================
    console.log('\n' + '='.repeat(70));
    console.log('TEST COMPLETE - FINAL SUMMARY');
    console.log('='.repeat(70));

    // Calculate net changes from start to finish
    const finalBalances = afterSettlementBalances;
    
    console.log('\n📊 NET BALANCE CHANGES (Start → End):');
    for (let i = 0; i < initialBalances.length; i++) {
        const initial = initialBalances[i];
        const final = finalBalances[i];
        const usdtChange = final.usdt - initial.usdt;
        const lpChange = final.lp - initial.lp;
        
        console.log(`   ${initial.label}:`);
        const usdtSign = usdtChange >= 0n ? '+' : '';
        console.log(`      USDT: ${usdtSign}${formatUsdt(usdtChange)} (${formatUsdt(initial.usdt)} → ${formatUsdt(final.usdt)})`);
        if (lpChange !== 0n) {
            const lpSign = lpChange >= 0n ? '+' : '';
            console.log(`      LP Tokens: ${lpSign}${lpChange.toString()}`);
        }
    }

    console.log('\n📝 FUND FLOW SUMMARY:');
    if (eventOccurred) {
        console.log('   🎉 RAINFALL EVENT OCCURRED - Policyholder (Bob) received payout!');
        console.log(`   • Bob paid ${formatUsdt(premium)} premium, received ${formatUsdt(maxPayout)} payout`);
        console.log(`   • Net gain for Bob: ${formatUsdt(maxPayout - premium)}`);
        console.log(`   • DAO lost ${formatUsdt(daoCapitalRequired)} (capital at risk)`);
    } else {
        console.log('   ✨ NO RAINFALL EVENT - DAO/LP holders profit!');
        console.log(`   • Bob paid ${formatUsdt(premium)} premium, received nothing`);
        console.log(`   • Premium + DAO capital (${formatUsdt(maxPayout)}) → Residual Pool`);
        console.log(`   • LP token holders can claim their share from residual pool`);
    }

    console.log('\n💡 KEY INSIGHTS:');
    console.log('   • Premium goes into policy risk pool (not directly to DAO)');
    console.log('   • DAO provides capital to cover potential payout');
    console.log('   • LP tokens represent risk-bearing position');
    console.log('   • On settlement:');
    console.log('     - If event: Policyholder receives max payout from pool');
    console.log('     - If no event: Pool funds go to residual (LP holders profit)');

    await api.disconnect();
}

main().catch(console.error);
