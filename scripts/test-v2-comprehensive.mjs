#!/usr/bin/env node
/**
 * PRMX Comprehensive V1/V2 Policy Testing
 * 
 * 20 scenarios covering:
 * - V1 Core Tests (1-5)
 * - V2 Core Tests (6-11)
 * - Settlement Timing Edge Cases (12-17)
 * - Mixed & Validation Tests (18-20)
 * 
 * Roles:
 * - Alice: Oracle/Admin (submit rainfall, quotes, V2 reports, sudo)
 * - Bob: Customer (buy insurance policies)
 * - Charlie: LP Holder 1 (buy/sell LP tokens)
 * - Dave: LP Holder 2 (buy/sell LP tokens)
 * 
 * Usage: node test-v2-comprehensive.mjs [scenario-id]
 *        node test-v2-comprehensive.mjs         # Run all scenarios
 *        node test-v2-comprehensive.mjs 1       # Run only scenario 1
 *        node test-v2-comprehensive.mjs 1,5,10  # Run scenarios 1, 5, and 10
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import { createHash } from 'crypto';

// =============================================================================
// Configuration
// =============================================================================

const WS_ENDPOINT = 'ws://127.0.0.1:9944';
const USDT_ASSET_ID = 1;
const USDT_DECIMALS = 6;
const MANILA_MARKET_ID = 0;
const MANILA_LAT = 14_599_500;  // scaled by 1e6
const MANILA_LON = 120_984_200; // scaled by 1e6
const MANILA_ACCUWEATHER_KEY = '3423441';
const FALLBACK_PROBABILITY_PPM = 50_000; // 5%
const STRIKE_VALUE = 500; // 50mm in tenths

// Short coverage for quick tests (60 seconds)
const SHORT_COVERAGE_SECS = 60;

// =============================================================================
// Utility Functions
// =============================================================================

function formatUsdt(balance) {
    const val = Number(balance) / (10 ** USDT_DECIMALS);
    return `${val >= 0 ? '' : '-'}${Math.abs(val).toFixed(2)} USDT`;
}

function formatChange(before, after) {
    const change = after - before;
    const sign = change >= 0n ? '+' : '';
    return `${sign}${formatUsdt(change)}`;
}

async function getDaoAccount() {
    const { encodeAddress } = await import('@polkadot/util-crypto');
    // Dedicated DAO account (//DAO) - defined in runtime/src/lib.rs
    // Address: 5EyKeA48QNY6LbD2QeN2JUuArTiyBTDN2BBYoLLCwz9rXdZS
    const daoAccountHex = '0x8099b04502498ba2936833a5715a95dbcd367628a4dd4792222b7bcb4aa79959';
    return encodeAddress(daoAccountHex, 42);
}

// The oracle uses a different time calculation than the chain timestamp
// Oracle calculates: BASE_TIMESTAMP_SECS + (block_num * 6)
const BASE_TIMESTAMP_SECS = 1733616000; // Dec 8, 2025 00:00 UTC

async function getChainTime(api) {
    const chainTimestamp = await api.query.timestamp.now();
    // Return as integer seconds
    return Math.floor(chainTimestamp.toNumber() / 1000);
}

async function getOracleTime(api) {
    // Oracle uses BASE_TIMESTAMP_SECS + (block_num * 6)
    const header = await api.rpc.chain.getHeader();
    const blockNum = header.number.toNumber();
    return BASE_TIMESTAMP_SECS + (blockNum * 6);
}

async function getUsdtBalance(api, address) {
    const usdt = await api.query.assets.account(USDT_ASSET_ID, address);
    return usdt.isSome ? BigInt(usdt.unwrap().balance.toString()) : 0n;
}

async function getLpBalance(api, policyId, address) {
    const holdings = await api.query.prmxHoldings.holdingsStorage(policyId, address);
    return {
        free: BigInt(holdings.lpShares.toString()),
        locked: BigInt(holdings.lockedShares.toString()),
        total: BigInt(holdings.lpShares.toString()) + BigInt(holdings.lockedShares.toString()),
    };
}

async function getBalanceSnapshot(api, addresses, policyId = null) {
    const snapshot = {};
    for (const [name, address] of Object.entries(addresses)) {
        snapshot[name] = {
            usdt: await getUsdtBalance(api, address),
            lp: policyId ? await getLpBalance(api, policyId, address) : null,
        };
    }
    return snapshot;
}

function printBalanceChanges(label, before, after, names) {
    console.log(`\n   📊 ${label}:`);
    for (const name of names) {
        const usdtChange = after[name].usdt - before[name].usdt;
        if (usdtChange !== 0n) {
            console.log(`      ${name}: ${formatChange(before[name].usdt, after[name].usdt)}`);
        }
    }
}

// Fund Flow Tracker for comprehensive checkpoint tracking
class FundFlowTracker {
    constructor(names) {
        this.names = names;
        this.checkpoints = [];
    }
    
    async capture(api, addresses, label, policyId = null) {
        const snapshot = await getBalanceSnapshot(api, addresses, policyId);
        this.checkpoints.push({ label, snapshot, policyId });
        return snapshot;
    }
    
    printSummary() {
        if (this.checkpoints.length < 2) return;
        
        console.log('\n   ┌─────────────────────────────────────────────────────────────────┐');
        console.log('   │                    FUND FLOW SUMMARY                            │');
        console.log('   ├─────────────────────────────────────────────────────────────────┤');
        
        const first = this.checkpoints[0];
        const last = this.checkpoints[this.checkpoints.length - 1];
        
        for (const name of this.names) {
            const initial = first.snapshot[name]?.usdt || 0n;
            const final = last.snapshot[name]?.usdt || 0n;
            const netChange = final - initial;
            
            if (netChange !== 0n) {
                const sign = netChange >= 0n ? '+' : '';
                console.log(`   │  ${name.padEnd(12)}: ${formatUsdt(initial).padStart(15)} → ${formatUsdt(final).padStart(15)} (${sign}${formatUsdt(netChange)})  │`);
            }
        }
        
        console.log('   └─────────────────────────────────────────────────────────────────┘');
    }
    
    printDetailed() {
        if (this.checkpoints.length === 0) return;
        
        console.log('\n   📈 Detailed Fund Flow by Checkpoint:');
        
        for (let i = 0; i < this.checkpoints.length; i++) {
            const cp = this.checkpoints[i];
            console.log(`      [${i + 1}] ${cp.label}:`);
            
            for (const name of this.names) {
                const usdt = cp.snapshot[name]?.usdt || 0n;
                const lp = cp.snapshot[name]?.lp?.total || 0n;
                
                let line = `          ${name}: ${formatUsdt(usdt)}`;
                if (cp.policyId !== null && lp > 0n) {
                    line += ` | ${lp} LP`;
                }
                
                if (i > 0) {
                    const prev = this.checkpoints[i - 1].snapshot[name]?.usdt || 0n;
                    const change = usdt - prev;
                    if (change !== 0n) {
                        line += ` (${formatChange(prev, usdt)})`;
                    }
                }
                
                console.log(line);
            }
        }
    }
}

async function waitUntilTime(api, targetTime) {
    let currentTime = await getChainTime(api);
    while (currentTime < targetTime) {
        const remaining = targetTime - currentTime;
        console.log(`      ⏳ Waiting ${remaining}s for chain time...`);
        await new Promise(r => setTimeout(r, Math.min(6000, remaining * 1000)));
        currentTime = await getChainTime(api);
    }
}

async function sendTx(api, tx, signer, label = '') {
    return new Promise((resolve, reject) => {
        tx.signAndSend(signer, { nonce: -1 }, ({ status, dispatchError, events }) => {
            if (status.isInBlock || status.isFinalized) {
                if (dispatchError) {
                    let errorMessage = 'Transaction failed';
                    if (dispatchError.isModule) {
                        try {
                            const decoded = api.registry.findMetaError(dispatchError.asModule);
                            errorMessage = `${decoded.section}.${decoded.name}`;
                        } catch (e) {
                            errorMessage = dispatchError.toString();
                        }
                    } else {
                        errorMessage = dispatchError.toString();
                    }
                    reject(new Error(errorMessage));
                } else {
                    resolve(events);
                }
            }
        });
    });
}

async function sendTxExpectError(api, tx, signer, expectedError) {
    try {
        await sendTx(api, tx, signer);
        return { success: true, error: null };
    } catch (err) {
        const errorStr = err.message || err.toString();
        const matched = errorStr.includes(expectedError);
        return { success: false, error: errorStr, matched };
    }
}

function generateEvidenceHash(data) {
    return Array.from(createHash('sha256').update(JSON.stringify(data)).digest());
}

// =============================================================================
// Oracle & Quote Helpers
// =============================================================================

async function setupOracle(api, alice) {
    // Bind Manila location if needed
    const locationConfig = await api.query.prmxOracle.marketLocationConfig(MANILA_MARKET_ID);
    if (!locationConfig.isSome) {
        await sendTx(api, api.tx.sudo.sudo(
            api.tx.prmxOracle.setMarketLocationKey(MANILA_MARKET_ID, MANILA_ACCUWEATHER_KEY)
        ), alice);
    }

    // Add oracle provider
    try {
        await sendTx(api, api.tx.sudo.sudo(
            api.tx.prmxOracle.addOracleProvider(alice.address)
        ), alice);
    } catch (e) {
        // May already exist
    }

    // Add V2 reporter
    try {
        await sendTx(api, api.tx.sudo.sudo(
            api.tx.prmxOracle.addV2Reporter(alice.address)
        ), alice);
    } catch (e) {
        // May already exist
    }
}

async function submitRainfall(api, alice, hoursAgo, rainfallTenthsMm) {
    // Get oracle's time (BASE_TIMESTAMP + block_num * 6) and use a relative offset
    const oracleNow = await getOracleTime(api);
    // Compute timestamp as hours before oracle's now
    const safeTimestamp = oracleNow - (hoursAgo * 3600);
    await sendTx(api, api.tx.prmxOracle.submitRainfall(MANILA_MARKET_ID, safeTimestamp, rainfallTenthsMm), alice);
}

async function requestV1Quote(api, bob, coverageStart, coverageEnd, shares) {
    const tx = api.tx.prmxQuote.requestPolicyQuote(
        MANILA_MARKET_ID, coverageStart, coverageEnd, MANILA_LAT, MANILA_LON, shares
    );
    const events = await sendTx(api, tx, bob);
    for (const { event } of events) {
        if (event.section === 'prmxQuote' && event.method === 'QuoteRequested') {
            return event.data[0].toNumber();
        }
    }
    throw new Error('QuoteRequested event not found');
}

async function requestV2Quote(api, bob, coverageStart, coverageEnd, shares, durationDays, strikeMm = STRIKE_VALUE) {
    const tx = api.tx.prmxQuote.requestPolicyQuoteV2(
        MANILA_MARKET_ID, coverageStart, coverageEnd, MANILA_LAT, MANILA_LON, shares, durationDays, strikeMm
    );
    const events = await sendTx(api, tx, bob);
    for (const { event } of events) {
        if (event.section === 'prmxQuote' && event.method === 'QuoteRequested') {
            return event.data[0].toNumber();
        }
    }
    throw new Error('QuoteRequested event not found');
}

async function submitQuoteFallback(api, alice, quoteId) {
    await sendTx(api, api.tx.prmxQuote.submitQuote(quoteId, FALLBACK_PROBABILITY_PPM), alice);
    const result = await api.query.prmxQuote.quoteResults(quoteId);
    return result.isSome ? BigInt(result.unwrap().totalPremium.toString()) : 0n;
}

async function createPolicy(api, user, quoteId) {
    const tx = api.tx.prmxPolicy.applyCoverageWithQuote(quoteId);
    const events = await sendTx(api, tx, user);
    let policyId = null;
    let isV2 = false;
    for (const { event } of events) {
        if (event.section === 'prmxPolicy' && event.method === 'PolicyCreated') {
            policyId = event.data[0].toNumber();
        }
        if (event.section === 'prmxPolicy' && event.method === 'V2PolicyCreated') {
            isV2 = true;
        }
    }
    return { policyId, isV2 };
}

async function buyLp(api, buyer, policyId, maxPricePerLp, quantity) {
    const tx = api.tx.prmxOrderbookLp.buyLp(policyId, maxPricePerLp, quantity);
    const events = await sendTx(api, tx, buyer);
    let filled = 0n;
    for (const { event } of events) {
        if (event.section === 'prmxOrderbookLp' && event.method === 'TradeExecuted') {
            filled += BigInt(event.data[5].toString()); // quantity field
        }
    }
    return filled;
}

async function placeLpAsk(api, seller, policyId, pricePerLp, quantity) {
    const tx = api.tx.prmxOrderbookLp.placeLpAsk(policyId, pricePerLp, quantity);
    const events = await sendTx(api, tx, seller);
    for (const { event } of events) {
        if (event.section === 'prmxOrderbookLp' && event.method === 'LpAskPlaced') {
            return event.data[0].toNumber(); // order_id
        }
    }
    return null;
}

async function settleV1Policy(api, alice, policyId, eventOccurred) {
    const tx = api.tx.prmxPolicy.settlePolicy(policyId, eventOccurred);
    return await sendTx(api, tx, alice);
}

async function submitV2Report(api, alice, policyId, outcome, observedAt, cumulativeMm) {
    const evidence = { policy_id: policyId, outcome, cumulative_mm: cumulativeMm, observed_at: observedAt };
    const evidenceHash = generateEvidenceHash(evidence);
    const outcomeEnum = outcome === 'Triggered' ? { Triggered: null } : { MaturedNoEvent: null };
    const tx = api.tx.prmxOracle.submitV2Report(policyId, outcomeEnum, observedAt, cumulativeMm, evidenceHash);
    return await sendTx(api, tx, alice);
}

// =============================================================================
// Test Scenario Implementations
// =============================================================================

// Scenario 1: V1 No Event - Single LP
async function testV1NoEventSingleLP(api, accounts) {
    const { alice, bob, charlie, daoAccount } = accounts;
    
    console.log('   📋 Bob buys V1 policy, Charlie buys LP, no event, settle at maturity');
    
    const chainNow = await getChainTime(api);
    const coverageStart = chainNow + 10;
    const coverageEnd = coverageStart + SHORT_COVERAGE_SECS;
    const shares = 2;
    
    // Initialize fund flow tracker
    const addresses = { Bob: bob.address, Charlie: charlie.address, DAO: daoAccount };
    const tracker = new FundFlowTracker(['Bob', 'Charlie', 'DAO']);
    
    // Checkpoint 1: Initial state
    await tracker.capture(api, addresses, 'Initial State');
    
    // Submit low rainfall (no event) - 1 hour ago relative to oracle time
    await submitRainfall(api, alice, 1, 100); // 10mm < 50mm strike, 1 hour ago
    
    // Request and submit quote
    const quoteId = await requestV1Quote(api, bob, coverageStart, coverageEnd, shares);
    const premium = await submitQuoteFallback(api, alice, quoteId);
    console.log(`      Quote ID: ${quoteId}, Premium: ${formatUsdt(premium)}`);
    
    // Create policy
    const { policyId } = await createPolicy(api, bob, quoteId);
    console.log(`      Policy ID: ${policyId}`);
    
    // Checkpoint 2: After policy creation
    await tracker.capture(api, addresses, 'After Policy Created', policyId);
    
    // Charlie buys 1 LP token
    const lpPrice = 100_000_000n; // 100 USDT
    await buyLp(api, charlie, policyId, lpPrice, 1n);
    console.log('      ✅ Charlie bought 1 LP token');
    
    // Checkpoint 3: After LP purchase
    const afterLpBal = await tracker.capture(api, addresses, 'After LP Purchase', policyId);
    
    // Wait for coverage to end
    await waitUntilTime(api, coverageEnd + 5);
    
    // Settle (no event)
    await settleV1Policy(api, alice, policyId, false);
    console.log('      ✅ Policy settled (no event)');
    
    // Checkpoint 4: After settlement
    const finalBal = await tracker.capture(api, addresses, 'After Settlement', policyId);
    
    // Print comprehensive fund flow summary
    tracker.printSummary();
    
    // Verify Charlie received payout
    const charlieGain = finalBal.Charlie.usdt - afterLpBal.Charlie.usdt;
    return { passed: charlieGain > 0n, message: `Charlie received ${formatUsdt(charlieGain)}` };
}

// Scenario 2: V1 Event Triggered
async function testV1EventTriggered(api, accounts) {
    const { alice, bob, daoAccount } = accounts;
    
    console.log('   📋 Bob buys V1 policy, DAO holds LP, rainfall exceeds strike');
    
    const chainNow = await getChainTime(api);
    const coverageStart = chainNow + 10;
    const coverageEnd = coverageStart + SHORT_COVERAGE_SECS;
    const shares = 1;
    
    // Initialize fund flow tracker
    const addresses = { Bob: bob.address, DAO: daoAccount };
    const tracker = new FundFlowTracker(['Bob', 'DAO']);
    
    // Checkpoint 1: Initial state
    await tracker.capture(api, addresses, 'Initial State');
    
    // Submit high rainfall (event triggers) - 1 hour ago relative to oracle time
    await submitRainfall(api, alice, 1, 600); // 60mm > 50mm strike, 1 hour ago
    
    const quoteId = await requestV1Quote(api, bob, coverageStart, coverageEnd, shares);
    const premium = await submitQuoteFallback(api, alice, quoteId);
    console.log(`      Quote ID: ${quoteId}, Premium: ${formatUsdt(premium)}`);
    
    const { policyId } = await createPolicy(api, bob, quoteId);
    console.log(`      Policy ID: ${policyId}`);
    
    // Checkpoint 2: After policy creation
    const afterPolicyBal = await tracker.capture(api, addresses, 'After Policy Created', policyId);
    
    // Wait for coverage to end
    await waitUntilTime(api, coverageEnd + 5);
    
    // Settle (event occurred)
    await settleV1Policy(api, alice, policyId, true);
    console.log('      ✅ Policy settled (event occurred)');
    
    // Checkpoint 3: After settlement
    const finalBal = await tracker.capture(api, addresses, 'After Settlement', policyId);
    
    // Print comprehensive fund flow summary
    tracker.printSummary();
    
    // Verify Bob received payout (100 USDT per share)
    const bobGain = finalBal.Bob.usdt - afterPolicyBal.Bob.usdt;
    const expectedPayout = 100_000_000n; // 100 USDT
    return { passed: bobGain >= expectedPayout, message: `Bob received ${formatUsdt(bobGain)}` };
}

// Scenario 3: V1 Multiple LPs Pro-rata
async function testV1MultipleLPsProrata(api, accounts) {
    const { alice, bob, charlie, dave, daoAccount } = accounts;
    
    console.log('   📋 Bob buys V1 policy, Charlie (60%) & Dave (40%) buy LP');
    
    const chainNow = await getChainTime(api);
    const coverageStart = chainNow + 10;
    const coverageEnd = coverageStart + SHORT_COVERAGE_SECS;
    const shares = 5; // 5 LP tokens total
    
    const addresses = { Bob: bob.address, Charlie: charlie.address, Dave: dave.address, DAO: daoAccount };
    
    await submitRainfall(api, alice, 1, 100); // No event
    
    const quoteId = await requestV1Quote(api, bob, coverageStart, coverageEnd, shares);
    await submitQuoteFallback(api, alice, quoteId);
    const { policyId } = await createPolicy(api, bob, quoteId);
    console.log(`      Policy ID: ${policyId}`);
    
    const afterPolicyBal = await getBalanceSnapshot(api, addresses, policyId);
    
    // Charlie buys 3 LP (60%), Dave buys 2 LP (40%)
    const lpPrice = 100_000_000n;
    await buyLp(api, charlie, policyId, lpPrice, 3n);
    await buyLp(api, dave, policyId, lpPrice, 2n);
    console.log('      ✅ Charlie bought 3 LP, Dave bought 2 LP');
    
    const afterLpBal = await getBalanceSnapshot(api, addresses, policyId);
    
    await waitUntilTime(api, coverageEnd + 5);
    await settleV1Policy(api, alice, policyId, false);
    console.log('      ✅ Policy settled (no event)');
    
    const finalBal = await getBalanceSnapshot(api, addresses, policyId);
    printBalanceChanges('After Settlement', afterLpBal, finalBal, ['Charlie', 'Dave', 'DAO']);
    
    const charlieGain = finalBal.Charlie.usdt - afterLpBal.Charlie.usdt;
    const daveGain = finalBal.Dave.usdt - afterLpBal.Dave.usdt;
    
    // Charlie should get ~60%, Dave ~40%
    const total = charlieGain + daveGain;
    const charlieRatio = total > 0n ? Number(charlieGain * 100n / total) : 0;
    
    return { 
        passed: charlieRatio >= 55 && charlieRatio <= 65, 
        message: `Charlie: ${formatUsdt(charlieGain)} (${charlieRatio}%), Dave: ${formatUsdt(daveGain)}` 
    };
}

// Scenario 4: V1 LP Secondary Sale
async function testV1LPSecondarySale(api, accounts) {
    const { alice, bob, charlie, dave, daoAccount } = accounts;
    
    console.log('   📋 Charlie buys LP from DAO, sells to Dave before settlement');
    
    const chainNow = await getChainTime(api);
    const coverageStart = chainNow + 10;
    const coverageEnd = coverageStart + SHORT_COVERAGE_SECS + 30; // Extra time for trading
    const shares = 2;
    
    const addresses = { Charlie: charlie.address, Dave: dave.address, DAO: daoAccount };
    
    await submitRainfall(api, alice, 1, 100);
    
    const quoteId = await requestV1Quote(api, bob, coverageStart, coverageEnd, shares);
    await submitQuoteFallback(api, alice, quoteId);
    const { policyId } = await createPolicy(api, bob, quoteId);
    console.log(`      Policy ID: ${policyId}`);
    
    // Charlie buys 2 LP
    const lpPrice = 100_000_000n;
    await buyLp(api, charlie, policyId, lpPrice, 2n);
    console.log('      ✅ Charlie bought 2 LP from DAO');
    
    const afterCharlieBuyBal = await getBalanceSnapshot(api, addresses, policyId);
    
    // Charlie sells 2 LP to Dave
    await placeLpAsk(api, charlie, policyId, 95_000_000n, 2n); // 95 USDT each
    await buyLp(api, dave, policyId, 100_000_000n, 2n);
    console.log('      ✅ Charlie sold 2 LP to Dave');
    
    const afterTradeBal = await getBalanceSnapshot(api, addresses, policyId);
    
    // Verify Charlie has 0 LP, Dave has 2 LP
    const charlieLp = afterTradeBal.Charlie.lp.total;
    const daveLp = afterTradeBal.Dave.lp.total;
    console.log(`      Charlie LP: ${charlieLp}, Dave LP: ${daveLp}`);
    
    await waitUntilTime(api, coverageEnd + 5);
    await settleV1Policy(api, alice, policyId, false);
    console.log('      ✅ Policy settled');
    
    const finalBal = await getBalanceSnapshot(api, addresses, policyId);
    printBalanceChanges('After Settlement', afterTradeBal, finalBal, ['Charlie', 'Dave']);
    
    // Only Dave should receive payout (Charlie sold everything)
    const charlieSettlement = finalBal.Charlie.usdt - afterTradeBal.Charlie.usdt;
    const daveSettlement = finalBal.Dave.usdt - afterTradeBal.Dave.usdt;
    
    return { 
        passed: charlieSettlement === 0n && daveSettlement > 0n, 
        message: `Charlie: ${formatUsdt(charlieSettlement)}, Dave: ${formatUsdt(daveSettlement)}` 
    };
}

// Scenario 5: V1 Partial LP Sale
async function testV1PartialLPSale(api, accounts) {
    const { alice, bob, charlie, dave, daoAccount } = accounts;
    
    console.log('   📋 Charlie buys 3 LP, sells 2 to Dave, keeps 1');
    
    const chainNow = await getChainTime(api);
    const coverageStart = chainNow + 10;
    const coverageEnd = coverageStart + SHORT_COVERAGE_SECS + 30;
    const shares = 3;
    
    const addresses = { Charlie: charlie.address, Dave: dave.address };
    
    await submitRainfall(api, alice, 1, 100);
    
    const quoteId = await requestV1Quote(api, bob, coverageStart, coverageEnd, shares);
    await submitQuoteFallback(api, alice, quoteId);
    const { policyId } = await createPolicy(api, bob, quoteId);
    console.log(`      Policy ID: ${policyId}`);
    
    // Charlie buys all 3 LP
    const lpPrice = 100_000_000n;
    await buyLp(api, charlie, policyId, lpPrice, 3n);
    console.log('      ✅ Charlie bought 3 LP');
    
    // Charlie sells 2 LP to Dave
    await placeLpAsk(api, charlie, policyId, 95_000_000n, 2n);
    await buyLp(api, dave, policyId, 100_000_000n, 2n);
    console.log('      ✅ Charlie sold 2 LP to Dave');
    
    const afterTradeBal = await getBalanceSnapshot(api, addresses, policyId);
    console.log(`      Charlie LP: ${afterTradeBal.Charlie.lp.total}, Dave LP: ${afterTradeBal.Dave.lp.total}`);
    
    await waitUntilTime(api, coverageEnd + 5);
    await settleV1Policy(api, alice, policyId, false);
    console.log('      ✅ Policy settled');
    
    const finalBal = await getBalanceSnapshot(api, addresses, policyId);
    printBalanceChanges('After Settlement', afterTradeBal, finalBal, ['Charlie', 'Dave']);
    
    const charlieSettlement = finalBal.Charlie.usdt - afterTradeBal.Charlie.usdt;
    const daveSettlement = finalBal.Dave.usdt - afterTradeBal.Dave.usdt;
    
    // Both should receive payouts - Dave should get ~2x Charlie
    const bothGot = charlieSettlement > 0n && daveSettlement > 0n;
    const ratio = charlieSettlement > 0n ? Number(daveSettlement / charlieSettlement) : 0;
    
    return { 
        passed: bothGot && ratio >= 1.5 && ratio <= 2.5, 
        message: `Charlie: ${formatUsdt(charlieSettlement)}, Dave: ${formatUsdt(daveSettlement)} (ratio: ${ratio.toFixed(1)}x)` 
    };
}

// Scenario 6: V2 Triggered Early
async function testV2TriggeredEarly(api, accounts) {
    const { alice, bob, charlie, daoAccount } = accounts;
    
    console.log('   📋 Bob buys V2 policy (3 days), cumulative hits strike, early trigger');
    
    const chainNow = await getChainTime(api);
    const coverageStart = chainNow - 86400; // Started 1 day ago
    const coverageEnd = chainNow + 2 * 86400; // Ends in 2 days
    const durationDays = 3;
    const shares = 2;
    
    // Initialize fund flow tracker
    const addresses = { Bob: bob.address, Charlie: charlie.address, DAO: daoAccount };
    const tracker = new FundFlowTracker(['Bob', 'Charlie', 'DAO']);
    
    // Checkpoint 1: Initial state
    await tracker.capture(api, addresses, 'Initial State');
    
    const quoteId = await requestV2Quote(api, bob, coverageStart, coverageEnd, shares, durationDays);
    const premium = await submitQuoteFallback(api, alice, quoteId);
    console.log(`      Quote ID: ${quoteId}, Premium: ${formatUsdt(premium)}`);
    
    const { policyId, isV2 } = await createPolicy(api, bob, quoteId);
    console.log(`      Policy ID: ${policyId}, V2: ${isV2}`);
    
    // Checkpoint 2: After policy creation
    await tracker.capture(api, addresses, 'After Policy Created', policyId);
    
    // Charlie buys 1 LP
    await buyLp(api, charlie, policyId, 100_000_000n, 1n);
    console.log('      ✅ Charlie bought 1 LP');
    
    // Checkpoint 3: After LP purchase
    const afterLpBal = await tracker.capture(api, addresses, 'After LP Purchase', policyId);
    
    // Submit V2 report: Triggered at strike + 10mm
    const observedAt = chainNow - 3600; // 1 hour ago (within window)
    const cumulativeMm = STRIKE_VALUE + 100; // 60mm
    await submitV2Report(api, alice, policyId, 'Triggered', observedAt, cumulativeMm);
    console.log(`      ✅ V2 Report submitted: Triggered at ${cumulativeMm / 10}mm`);
    
    // Checkpoint 4: After settlement
    const finalBal = await tracker.capture(api, addresses, 'After V2 Settlement', policyId);
    
    // Print comprehensive fund flow summary
    tracker.printSummary();
    
    const bobGain = finalBal.Bob.usdt - afterLpBal.Bob.usdt;
    return { passed: bobGain > 0n, message: `Bob received ${formatUsdt(bobGain)}` };
}

// Scenario 7: V2 Matured No Event
async function testV2MaturedNoEvent(api, accounts) {
    const { alice, bob, charlie, daoAccount } = accounts;
    
    console.log('   📋 Bob buys V2 policy, coverage ends without hitting threshold');
    
    const chainNow = await getChainTime(api);
    const coverageStart = chainNow - 2 * 86400; // Started 2 days ago
    const coverageEnd = chainNow - 3600; // Ended 1 hour ago
    const durationDays = 2;
    const shares = 2;
    
    const addresses = { Bob: bob.address, Charlie: charlie.address, DAO: daoAccount };
    
    const quoteId = await requestV2Quote(api, bob, coverageStart, coverageEnd, shares, durationDays);
    await submitQuoteFallback(api, alice, quoteId);
    const { policyId, isV2 } = await createPolicy(api, bob, quoteId);
    console.log(`      Policy ID: ${policyId}, V2: ${isV2}`);
    
    // Charlie buys LP
    await buyLp(api, charlie, policyId, 100_000_000n, 1n);
    console.log('      ✅ Charlie bought 1 LP');
    
    const afterLpBal = await getBalanceSnapshot(api, addresses, policyId);
    
    // Submit V2 report: MaturedNoEvent
    const observedAt = coverageEnd + 60;
    const cumulativeMm = STRIKE_VALUE - 100; // 40mm < 50mm strike
    await submitV2Report(api, alice, policyId, 'MaturedNoEvent', observedAt, cumulativeMm);
    console.log(`      ✅ V2 Report submitted: MaturedNoEvent at ${cumulativeMm / 10}mm`);
    
    const finalBal = await getBalanceSnapshot(api, addresses, policyId);
    printBalanceChanges('After V2 Settlement', afterLpBal, finalBal, ['Bob', 'Charlie', 'DAO']);
    
    const charlieGain = finalBal.Charlie.usdt - afterLpBal.Charlie.usdt;
    const bobGain = finalBal.Bob.usdt - afterLpBal.Bob.usdt;
    
    return { 
        passed: charlieGain > 0n && bobGain === 0n, 
        message: `Charlie: ${formatUsdt(charlieGain)}, Bob: ${formatUsdt(bobGain)}` 
    };
}

// Scenario 8: V2 Multiple LPs + Triggered
async function testV2MultipleLPsTriggered(api, accounts) {
    const { alice, bob, charlie, dave, daoAccount } = accounts;
    
    console.log('   📋 Charlie & Dave buy LP from V2 policy, early trigger occurs');
    
    const chainNow = await getChainTime(api);
    const coverageStart = chainNow - 86400;
    const coverageEnd = chainNow + 2 * 86400;
    const durationDays = 3;
    const shares = 4;
    
    const addresses = { Bob: bob.address, Charlie: charlie.address, Dave: dave.address };
    
    const quoteId = await requestV2Quote(api, bob, coverageStart, coverageEnd, shares, durationDays);
    await submitQuoteFallback(api, alice, quoteId);
    const { policyId } = await createPolicy(api, bob, quoteId);
    console.log(`      Policy ID: ${policyId}`);
    
    // Charlie buys 2, Dave buys 2
    await buyLp(api, charlie, policyId, 100_000_000n, 2n);
    await buyLp(api, dave, policyId, 100_000_000n, 2n);
    console.log('      ✅ Charlie & Dave each bought 2 LP');
    
    const afterLpBal = await getBalanceSnapshot(api, addresses, policyId);
    
    // Trigger event
    const observedAt = chainNow - 3600;
    await submitV2Report(api, alice, policyId, 'Triggered', observedAt, STRIKE_VALUE + 50);
    console.log('      ✅ V2 Triggered');
    
    const finalBal = await getBalanceSnapshot(api, addresses, policyId);
    
    const bobGain = finalBal.Bob.usdt - afterLpBal.Bob.usdt;
    const charlieLoss = afterLpBal.Charlie.usdt - finalBal.Charlie.usdt;
    const daveLoss = afterLpBal.Dave.usdt - finalBal.Dave.usdt;
    
    return { 
        passed: bobGain > 0n, 
        message: `Bob: +${formatUsdt(bobGain)}, Charlie: -${formatUsdt(charlieLoss)}, Dave: -${formatUsdt(daveLoss)}` 
    };
}

// Scenario 9: V2 LP Trading + Matured
async function testV2LPTradingMatured(api, accounts) {
    const { alice, bob, charlie, dave, daoAccount } = accounts;
    
    console.log('   📋 Charlie buys LP, sells to Dave, V2 matures without event');
    
    const chainNow = await getChainTime(api);
    const coverageStart = chainNow - 2 * 86400;
    const coverageEnd = chainNow - 3600;
    const durationDays = 2;
    const shares = 2;
    
    const addresses = { Charlie: charlie.address, Dave: dave.address };
    
    const quoteId = await requestV2Quote(api, bob, coverageStart, coverageEnd, shares, durationDays);
    await submitQuoteFallback(api, alice, quoteId);
    const { policyId } = await createPolicy(api, bob, quoteId);
    console.log(`      Policy ID: ${policyId}`);
    
    // Charlie buys, sells to Dave
    await buyLp(api, charlie, policyId, 100_000_000n, 2n);
    await placeLpAsk(api, charlie, policyId, 95_000_000n, 2n);
    await buyLp(api, dave, policyId, 100_000_000n, 2n);
    console.log('      ✅ Charlie sold all LP to Dave');
    
    const afterTradeBal = await getBalanceSnapshot(api, addresses, policyId);
    
    await submitV2Report(api, alice, policyId, 'MaturedNoEvent', coverageEnd + 60, STRIKE_VALUE - 100);
    console.log('      ✅ V2 MaturedNoEvent');
    
    const finalBal = await getBalanceSnapshot(api, addresses, policyId);
    
    const charlieSettlement = finalBal.Charlie.usdt - afterTradeBal.Charlie.usdt;
    const daveSettlement = finalBal.Dave.usdt - afterTradeBal.Dave.usdt;
    
    return { 
        passed: charlieSettlement === 0n && daveSettlement > 0n, 
        message: `Charlie: ${formatUsdt(charlieSettlement)}, Dave: ${formatUsdt(daveSettlement)}` 
    };
}

// Scenario 10: V2 Trigger Exactly at Strike
async function testV2TriggerExactlyAtStrike(api, accounts) {
    const { alice, bob, daoAccount } = accounts;
    
    console.log('   📋 Cumulative rainfall equals exactly 50mm strike');
    
    const chainNow = await getChainTime(api);
    const coverageStart = chainNow - 86400;
    const coverageEnd = chainNow + 86400;
    const durationDays = 2;
    const shares = 1;
    
    const addresses = { Bob: bob.address, DAO: daoAccount };
    
    const quoteId = await requestV2Quote(api, bob, coverageStart, coverageEnd, shares, durationDays);
    await submitQuoteFallback(api, alice, quoteId);
    const { policyId } = await createPolicy(api, bob, quoteId);
    console.log(`      Policy ID: ${policyId}`);
    
    const afterPolicyBal = await getBalanceSnapshot(api, addresses, policyId);
    
    // Trigger at exactly strike value
    const observedAt = chainNow - 3600;
    await submitV2Report(api, alice, policyId, 'Triggered', observedAt, STRIKE_VALUE); // Exactly 50mm
    console.log(`      ✅ V2 Triggered at exactly ${STRIKE_VALUE / 10}mm`);
    
    const finalBal = await getBalanceSnapshot(api, addresses, policyId);
    
    const bobGain = finalBal.Bob.usdt - afterPolicyBal.Bob.usdt;
    return { passed: bobGain > 0n, message: `Bob received ${formatUsdt(bobGain)}` };
}

// Scenario 11: V2 Just Below Strike at Maturity
async function testV2JustBelowStrike(api, accounts) {
    const { alice, bob, charlie, daoAccount } = accounts;
    
    console.log('   📋 Cumulative rainfall is 49.9mm at coverage end');
    
    const chainNow = await getChainTime(api);
    const coverageStart = chainNow - 2 * 86400;
    const coverageEnd = chainNow - 3600;
    const durationDays = 2;
    const shares = 1;
    
    const addresses = { Bob: bob.address, Charlie: charlie.address };
    
    const quoteId = await requestV2Quote(api, bob, coverageStart, coverageEnd, shares, durationDays);
    await submitQuoteFallback(api, alice, quoteId);
    const { policyId } = await createPolicy(api, bob, quoteId);
    console.log(`      Policy ID: ${policyId}`);
    
    await buyLp(api, charlie, policyId, 100_000_000n, 1n);
    
    const afterLpBal = await getBalanceSnapshot(api, addresses, policyId);
    
    // MaturedNoEvent at 49.9mm (just below 50mm strike)
    await submitV2Report(api, alice, policyId, 'MaturedNoEvent', coverageEnd + 60, STRIKE_VALUE - 1); // 49.9mm
    console.log(`      ✅ V2 MaturedNoEvent at ${(STRIKE_VALUE - 1) / 10}mm`);
    
    const finalBal = await getBalanceSnapshot(api, addresses, policyId);
    
    const bobGain = finalBal.Bob.usdt - afterLpBal.Bob.usdt;
    const charlieGain = finalBal.Charlie.usdt - afterLpBal.Charlie.usdt;
    
    return { 
        passed: bobGain === 0n && charlieGain > 0n, 
        message: `Bob: ${formatUsdt(bobGain)}, Charlie: ${formatUsdt(charlieGain)}` 
    };
}

// Scenario 12: V1 Settle Before Coverage End
async function testV1SettleBeforeCoverageEnd(api, accounts) {
    const { alice, bob } = accounts;
    
    console.log('   📋 Attempt to settle V1 policy before coverage_end');
    
    const chainNow = await getChainTime(api);
    const coverageStart = chainNow + 10;
    const coverageEnd = coverageStart + 300; // 5 minutes from now
    const shares = 1;
    
    await submitRainfall(api, alice, 1, 100);
    
    const quoteId = await requestV1Quote(api, bob, coverageStart, coverageEnd, shares);
    await submitQuoteFallback(api, alice, quoteId);
    const { policyId } = await createPolicy(api, bob, quoteId);
    console.log(`      Policy ID: ${policyId}`);
    
    // Wait for coverage to start but not end
    await waitUntilTime(api, coverageStart + 5);
    
    // Try to settle before coverage end
    const tx = api.tx.prmxPolicy.settlePolicy(policyId, false);
    const result = await sendTxExpectError(api, tx, alice, 'CoverageNotEnded');
    
    if (!result.success && result.matched) {
        console.log('      ✅ Expected error: CoverageNotEnded');
        
        // Now wait and settle properly
        await waitUntilTime(api, coverageEnd + 5);
        await settleV1Policy(api, alice, policyId, false);
        console.log('      ✅ Settlement succeeded after coverage end');
        
        return { passed: true, message: 'CoverageNotEnded error received as expected' };
    }
    
    return { passed: false, message: `Unexpected result: ${result.error || 'settled before coverage end'}` };
}

// Scenario 13: V1 Settle Exactly at Coverage End
async function testV1SettleExactlyAtEnd(api, accounts) {
    const { alice, bob } = accounts;
    
    console.log('   📋 Settle V1 immediately when chain time = coverage_end');
    
    const chainNow = await getChainTime(api);
    const coverageStart = chainNow + 5;
    const coverageEnd = coverageStart + SHORT_COVERAGE_SECS;
    const shares = 1;
    
    await submitRainfall(api, alice, 1, 100);
    
    const quoteId = await requestV1Quote(api, bob, coverageStart, coverageEnd, shares);
    await submitQuoteFallback(api, alice, quoteId);
    const { policyId } = await createPolicy(api, bob, quoteId);
    console.log(`      Policy ID: ${policyId}`);
    
    // Wait exactly until coverage end
    await waitUntilTime(api, coverageEnd);
    
    try {
        await settleV1Policy(api, alice, policyId, false);
        console.log('      ✅ Settlement succeeded at coverage end');
        return { passed: true, message: 'Settlement allowed at exact coverage_end' };
    } catch (err) {
        return { passed: false, message: `Settlement failed: ${err.message}` };
    }
}

// Scenario 14: V1 Settle Long After Coverage End
async function testV1SettleLongAfter(api, accounts) {
    const { alice, bob } = accounts;
    
    console.log('   📋 Settle V1 policy long after coverage_end');
    
    const chainNow = await getChainTime(api);
    // Coverage ended 1 day ago (simulated by using past dates)
    const coverageStart = chainNow - 2 * 86400;
    const coverageEnd = chainNow - 86400;
    const shares = 1;
    
    // For V1, coverage times are checked at settlement, so we need future coverage
    // Use a short window that we can wait through
    const actualCoverageStart = chainNow + 5;
    const actualCoverageEnd = actualCoverageStart + SHORT_COVERAGE_SECS;
    
    await submitRainfall(api, alice, 1, 100);
    
    const quoteId = await requestV1Quote(api, bob, actualCoverageStart, actualCoverageEnd, shares);
    await submitQuoteFallback(api, alice, quoteId);
    const { policyId } = await createPolicy(api, bob, quoteId);
    console.log(`      Policy ID: ${policyId}`);
    
    // Wait for coverage to end + extra time
    await waitUntilTime(api, actualCoverageEnd + 30);
    console.log('      ⏳ Additional wait after coverage end...');
    await new Promise(r => setTimeout(r, 10000));
    
    try {
        await settleV1Policy(api, alice, policyId, false);
        console.log('      ✅ Settlement succeeded long after coverage end');
        return { passed: true, message: 'Settlement still allowed after extended time' };
    } catch (err) {
        return { passed: false, message: `Settlement failed: ${err.message}` };
    }
}

// Scenario 15: V2 Report Before Coverage Start
async function testV2ReportBeforeStart(api, accounts) {
    const { alice, bob } = accounts;
    
    console.log('   📋 V2 report submitted with observed_at before coverage_start');
    
    const chainNow = await getChainTime(api);
    const coverageStart = chainNow - 86400; // Started 1 day ago
    const coverageEnd = chainNow + 86400; // Ends in 1 day
    const durationDays = 2;
    const shares = 1;
    
    const quoteId = await requestV2Quote(api, bob, coverageStart, coverageEnd, shares, durationDays);
    await submitQuoteFallback(api, alice, quoteId);
    const { policyId } = await createPolicy(api, bob, quoteId);
    console.log(`      Policy ID: ${policyId}`);
    
    // Try to submit report with observed_at before coverage_start
    const invalidObservedAt = coverageStart - 3600; // 1 hour before coverage start
    const evidence = { policy_id: policyId };
    const evidenceHash = generateEvidenceHash(evidence);
    
    const tx = api.tx.prmxOracle.submitV2Report(
        policyId, 
        { Triggered: null }, 
        invalidObservedAt, 
        STRIKE_VALUE + 100, 
        evidenceHash
    );
    
    const result = await sendTxExpectError(api, tx, alice, 'InvalidObservedAt');
    
    if (!result.success && result.matched) {
        console.log('      ✅ Expected error: InvalidObservedAt');
        return { passed: true, message: 'InvalidObservedAt error received as expected' };
    }
    
    return { passed: false, message: `Unexpected result: ${result.error || 'report accepted'}` };
}

// Scenario 16: V2 Triggered Mid-Window
async function testV2TriggeredMidWindow(api, accounts) {
    const { alice, bob, daoAccount } = accounts;
    
    console.log('   📋 V2 triggered at exactly middle of coverage window');
    
    const chainNow = await getChainTime(api);
    const coverageStart = chainNow - 2 * 86400; // 2 days ago
    const coverageEnd = chainNow + 2 * 86400; // 2 days from now
    const midPoint = Math.floor((coverageStart + coverageEnd) / 2);
    const durationDays = 4;
    const shares = 1;
    
    const addresses = { Bob: bob.address, DAO: daoAccount };
    
    const quoteId = await requestV2Quote(api, bob, coverageStart, coverageEnd, shares, durationDays);
    await submitQuoteFallback(api, alice, quoteId);
    const { policyId } = await createPolicy(api, bob, quoteId);
    console.log(`      Policy ID: ${policyId}`);
    
    const afterPolicyBal = await getBalanceSnapshot(api, addresses, policyId);
    
    // Submit report at mid-window
    await submitV2Report(api, alice, policyId, 'Triggered', midPoint, STRIKE_VALUE + 50);
    console.log(`      ✅ V2 Triggered at mid-window (${new Date(midPoint * 1000).toISOString()})`);
    
    const finalBal = await getBalanceSnapshot(api, addresses, policyId);
    
    const bobGain = finalBal.Bob.usdt - afterPolicyBal.Bob.usdt;
    return { passed: bobGain > 0n, message: `Bob received ${formatUsdt(bobGain)}` };
}

// Scenario 17: V2 MaturedNoEvent Before Coverage End
async function testV2MaturedBeforeEnd(api, accounts) {
    const { alice, bob } = accounts;
    
    console.log('   📋 Attempt MaturedNoEvent before coverage_end');
    
    const chainNow = await getChainTime(api);
    const coverageStart = chainNow - 86400;
    const coverageEnd = chainNow + 86400; // Still active
    const durationDays = 2;
    const shares = 1;
    
    const quoteId = await requestV2Quote(api, bob, coverageStart, coverageEnd, shares, durationDays);
    await submitQuoteFallback(api, alice, quoteId);
    const { policyId } = await createPolicy(api, bob, quoteId);
    console.log(`      Policy ID: ${policyId}`);
    
    // Try to submit MaturedNoEvent before coverage ends
    const invalidObservedAt = chainNow; // Now is before coverage_end
    const evidence = { policy_id: policyId };
    const evidenceHash = generateEvidenceHash(evidence);
    
    const tx = api.tx.prmxOracle.submitV2Report(
        policyId, 
        { MaturedNoEvent: null }, 
        invalidObservedAt, 
        STRIKE_VALUE - 100, 
        evidenceHash
    );
    
    const result = await sendTxExpectError(api, tx, alice, 'CoverageNotEnded');
    
    if (!result.success && result.matched) {
        console.log('      ✅ Expected error: CoverageNotEnded');
        return { passed: true, message: 'CoverageNotEnded error received as expected' };
    }
    
    return { passed: false, message: `Unexpected result: ${result.error || 'report accepted'}` };
}

// Scenario 18: V1 and V2 Parallel Policies
async function testV1V2Parallel(api, accounts) {
    const { alice, bob, charlie, dave, daoAccount } = accounts;
    
    console.log('   📋 Simultaneous V1 & V2 policies on Manila, both settle correctly');
    
    const chainNow = await getChainTime(api);
    
    // V1 Policy
    const v1Start = chainNow + 10;
    const v1End = v1Start + SHORT_COVERAGE_SECS;
    
    // V2 Policy (coverage already ended for quick test)
    const v2Start = chainNow - 2 * 86400;
    const v2End = chainNow - 3600;
    
    // Initialize fund flow tracker
    const addresses = { Bob: bob.address, Charlie: charlie.address, Dave: dave.address, DAO: daoAccount };
    const tracker = new FundFlowTracker(['Bob', 'Charlie', 'Dave', 'DAO']);
    
    // Checkpoint 1: Initial state
    await tracker.capture(api, addresses, 'Initial State');
    
    await submitRainfall(api, alice, 1, 100); // No V1 event
    
    // Create V1 policy
    const v1QuoteId = await requestV1Quote(api, bob, v1Start, v1End, 2);
    await submitQuoteFallback(api, alice, v1QuoteId);
    const { policyId: v1PolicyId } = await createPolicy(api, bob, v1QuoteId);
    console.log(`      V1 Policy ID: ${v1PolicyId}`);
    
    // Create V2 policy
    const v2QuoteId = await requestV2Quote(api, bob, v2Start, v2End, 2, 2);
    await submitQuoteFallback(api, alice, v2QuoteId);
    const { policyId: v2PolicyId } = await createPolicy(api, bob, v2QuoteId);
    console.log(`      V2 Policy ID: ${v2PolicyId}`);
    
    // Checkpoint 2: After both policies created
    await tracker.capture(api, addresses, 'After Both Policies Created');
    
    // Charlie buys LP from V1, Dave buys LP from V2
    await buyLp(api, charlie, v1PolicyId, 100_000_000n, 1n);
    await buyLp(api, dave, v2PolicyId, 100_000_000n, 1n);
    console.log('      ✅ Charlie bought LP from V1, Dave bought LP from V2');
    
    // Checkpoint 3: After LP purchases
    const beforeBal = await tracker.capture(api, addresses, 'After LP Purchases');
    
    // Wait for V1 coverage to end
    await waitUntilTime(api, v1End + 5);
    
    // Settle V1 (no event)
    await settleV1Policy(api, alice, v1PolicyId, false);
    console.log('      ✅ V1 Policy settled');
    
    // Checkpoint 4: After V1 settlement
    await tracker.capture(api, addresses, 'After V1 Settlement');
    
    // Settle V2 (matured no event)
    await submitV2Report(api, alice, v2PolicyId, 'MaturedNoEvent', v2End + 60, STRIKE_VALUE - 100);
    console.log('      ✅ V2 Policy settled');
    
    // Checkpoint 5: After V2 settlement
    const afterBal = await tracker.capture(api, addresses, 'After V2 Settlement');
    
    // Print comprehensive fund flow summary
    tracker.printSummary();
    
    const charlieGain = afterBal.Charlie.usdt - beforeBal.Charlie.usdt;
    const daveGain = afterBal.Dave.usdt - beforeBal.Dave.usdt;
    
    return { 
        passed: charlieGain > 0n && daveGain > 0n, 
        message: `Charlie (V1): ${formatUsdt(charlieGain)}, Dave (V2): ${formatUsdt(daveGain)}` 
    };
}

// Scenario 19: V2 Duration Validation
async function testV2DurationValidation(api, accounts) {
    const { alice, bob } = accounts;
    
    console.log('   📋 Test V2 duration bounds (1 day, 2 days, 7 days, 8 days)');
    
    const chainNow = await getChainTime(api);
    const results = [];
    
    const testCases = [
        { days: 1, shouldFail: true },
        { days: 2, shouldFail: false },
        { days: 7, shouldFail: false },
        { days: 8, shouldFail: true },
    ];
    
    for (const { days, shouldFail } of testCases) {
        const coverageStart = chainNow + 3600;
        const coverageEnd = coverageStart + days * 86400;
        
        try {
            const tx = api.tx.prmxQuote.requestPolicyQuoteV2(
                MANILA_MARKET_ID, coverageStart, coverageEnd, MANILA_LAT, MANILA_LON, 1, days, STRIKE_VALUE
            );
            await sendTx(api, tx, bob);
            
            if (shouldFail) {
                results.push({ days, passed: false, message: 'Expected to fail but succeeded' });
            } else {
                results.push({ days, passed: true, message: 'Quote accepted' });
            }
        } catch (err) {
            if (shouldFail && err.message.includes('V2InvalidDuration')) {
                results.push({ days, passed: true, message: 'Correctly rejected' });
            } else if (!shouldFail) {
                results.push({ days, passed: false, message: `Unexpected error: ${err.message}` });
            } else {
                results.push({ days, passed: true, message: `Rejected: ${err.message}` });
            }
        }
    }
    
    for (const r of results) {
        console.log(`      ${r.days} days: ${r.passed ? '✅' : '❌'} ${r.message}`);
    }
    
    const allPassed = results.every(r => r.passed);
    return { passed: allPassed, message: `${results.filter(r => r.passed).length}/4 cases passed` };
}

// Scenario 20: Double Settlement Attempt
async function testDoubleSettlement(api, accounts) {
    const { alice, bob } = accounts;
    
    console.log('   📋 Attempt to settle already-settled policy (V1 and V2)');
    
    const chainNow = await getChainTime(api);
    
    // Test V1 double settlement
    const v1Start = chainNow + 5;
    const v1End = v1Start + SHORT_COVERAGE_SECS;
    
    await submitRainfall(api, alice, 1, 100);
    
    const v1QuoteId = await requestV1Quote(api, bob, v1Start, v1End, 1);
    await submitQuoteFallback(api, alice, v1QuoteId);
    const { policyId: v1PolicyId } = await createPolicy(api, bob, v1QuoteId);
    console.log(`      V1 Policy ID: ${v1PolicyId}`);
    
    await waitUntilTime(api, v1End + 5);
    await settleV1Policy(api, alice, v1PolicyId, false);
    console.log('      ✅ V1 First settlement succeeded');
    
    // Try to settle again
    const v1Tx = api.tx.prmxPolicy.settlePolicy(v1PolicyId, false);
    const v1Result = await sendTxExpectError(api, v1Tx, alice, 'PolicyAlreadySettled');
    
    const v1Pass = !v1Result.success && (v1Result.error.includes('AlreadySettled') || v1Result.error.includes('NotActive'));
    console.log(`      V1 Double settle: ${v1Pass ? '✅ Correctly rejected' : '❌ ' + v1Result.error}`);
    
    // Test V2 double settlement
    const v2Start = chainNow - 2 * 86400;
    const v2End = chainNow - 3600;
    
    const v2QuoteId = await requestV2Quote(api, bob, v2Start, v2End, 1, 2);
    await submitQuoteFallback(api, alice, v2QuoteId);
    const { policyId: v2PolicyId } = await createPolicy(api, bob, v2QuoteId);
    console.log(`      V2 Policy ID: ${v2PolicyId}`);
    
    await submitV2Report(api, alice, v2PolicyId, 'MaturedNoEvent', v2End + 60, STRIKE_VALUE - 100);
    console.log('      ✅ V2 First settlement succeeded');
    
    // Try to submit another report
    const evidence = { policy_id: v2PolicyId };
    const evidenceHash = generateEvidenceHash(evidence);
    const v2Tx = api.tx.prmxOracle.submitV2Report(
        v2PolicyId, 
        { MaturedNoEvent: null }, 
        v2End + 120, 
        STRIKE_VALUE - 100, 
        evidenceHash
    );
    const v2Result = await sendTxExpectError(api, v2Tx, alice, 'ReportAlreadySubmitted');
    
    const v2Pass = !v2Result.success && (v2Result.error.includes('AlreadySubmitted') || v2Result.error.includes('NotActive'));
    console.log(`      V2 Double settle: ${v2Pass ? '✅ Correctly rejected' : '❌ ' + v2Result.error}`);
    
    return { passed: v1Pass && v2Pass, message: `V1: ${v1Pass ? 'OK' : 'FAIL'}, V2: ${v2Pass ? 'OK' : 'FAIL'}` };
}

// =============================================================================
// Scenario Registry
// =============================================================================

const SCENARIOS = [
    { id: 1, name: 'V1 No Event - Single LP', runner: testV1NoEventSingleLP },
    { id: 2, name: 'V1 Event Triggered', runner: testV1EventTriggered },
    { id: 3, name: 'V1 Multiple LPs Pro-rata', runner: testV1MultipleLPsProrata },
    { id: 4, name: 'V1 LP Secondary Sale', runner: testV1LPSecondarySale },
    { id: 5, name: 'V1 Partial LP Sale', runner: testV1PartialLPSale },
    { id: 6, name: 'V2 Triggered Early', runner: testV2TriggeredEarly },
    { id: 7, name: 'V2 Matured No Event', runner: testV2MaturedNoEvent },
    { id: 8, name: 'V2 Multiple LPs + Triggered', runner: testV2MultipleLPsTriggered },
    { id: 9, name: 'V2 LP Trading + Matured', runner: testV2LPTradingMatured },
    { id: 10, name: 'V2 Trigger Exactly at Strike', runner: testV2TriggerExactlyAtStrike },
    { id: 11, name: 'V2 Just Below Strike', runner: testV2JustBelowStrike },
    { id: 12, name: 'V1 Settle Before Coverage End', runner: testV1SettleBeforeCoverageEnd },
    { id: 13, name: 'V1 Settle Exactly at Coverage End', runner: testV1SettleExactlyAtEnd },
    { id: 14, name: 'V1 Settle Long After Coverage End', runner: testV1SettleLongAfter },
    { id: 15, name: 'V2 Report Before Coverage Start', runner: testV2ReportBeforeStart },
    { id: 16, name: 'V2 Triggered Mid-Window', runner: testV2TriggeredMidWindow },
    { id: 17, name: 'V2 MaturedNoEvent Before Coverage End', runner: testV2MaturedBeforeEnd },
    { id: 18, name: 'V1 and V2 Parallel Policies', runner: testV1V2Parallel },
    { id: 19, name: 'V2 Duration Validation', runner: testV2DurationValidation },
    { id: 20, name: 'Double Settlement Attempt', runner: testDoubleSettlement },
];

// =============================================================================
// Main Runner
// =============================================================================

async function main() {
    console.log('╔════════════════════════════════════════════════════════════════════╗');
    console.log('║  PRMX Comprehensive V1/V2 Policy Testing (20 Scenarios)            ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝\n');
    
    // Parse command line args
    const args = process.argv.slice(2);
    let scenarioIds = [];
    
    if (args.length > 0) {
        scenarioIds = args[0].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    }
    
    // Connect to node
    const api = await ApiPromise.create({ provider: new WsProvider(WS_ENDPOINT) });
    console.log('✅ Connected to PRMX node');
    
    const chain = await api.rpc.system.chain();
    console.log(`   Chain: ${chain}`);
    
    // Setup accounts
    const keyring = new Keyring({ type: 'sr25519' });
    const accounts = {
        alice: keyring.addFromUri('//Alice'),
        bob: keyring.addFromUri('//Bob'),
        charlie: keyring.addFromUri('//Charlie'),
        dave: keyring.addFromUri('//Dave'),
        daoAccount: await getDaoAccount(),
    };
    
    console.log(`   Alice (Oracle): ${accounts.alice.address}`);
    console.log(`   Bob (Customer): ${accounts.bob.address}`);
    console.log(`   Charlie (LP 1): ${accounts.charlie.address}`);
    console.log(`   Dave (LP 2): ${accounts.dave.address}`);
    console.log(`   DAO: ${accounts.daoAccount}`);
    
    // Setup oracle
    console.log('\n⏳ Setting up oracle...');
    await setupOracle(api, accounts.alice);
    console.log('✅ Oracle configured\n');
    
    // Run scenarios
    const scenariosToRun = scenarioIds.length > 0 
        ? SCENARIOS.filter(s => scenarioIds.includes(s.id))
        : SCENARIOS;
    
    const results = [];
    
    for (const scenario of scenariosToRun) {
        console.log('━'.repeat(70));
        console.log(`📋 Scenario ${scenario.id}: ${scenario.name}`);
        console.log('━'.repeat(70));
        
        try {
            const result = await scenario.runner(api, accounts);
            results.push({ id: scenario.id, name: scenario.name, ...result });
            console.log(`\n   ${result.passed ? '✅ PASSED' : '❌ FAILED'}: ${result.message}`);
        } catch (err) {
            results.push({ id: scenario.id, name: scenario.name, passed: false, message: err.message });
            console.log(`\n   ❌ ERROR: ${err.message}`);
        }
        
        console.log('');
    }
    
    // Summary
    console.log('╔════════════════════════════════════════════════════════════════════╗');
    console.log('║                           TEST SUMMARY                             ║');
    console.log('╠════════════════════════════════════════════════════════════════════╣');
    
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    
    for (const r of results) {
        const status = r.passed ? '✅' : '❌';
        const name = r.name.padEnd(40);
        console.log(`║  ${status} ${r.id.toString().padStart(2)}. ${name} ║`);
    }
    
    console.log('╠════════════════════════════════════════════════════════════════════╣');
    console.log(`║  Total: ${passed} passed, ${failed} failed                                       ║`);
    console.log('╚════════════════════════════════════════════════════════════════════╝');
    
    await api.disconnect();
    
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});

