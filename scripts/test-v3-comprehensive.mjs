#!/usr/bin/env node
/**
 * V3 P2P Climate Risk Market - Comprehensive E2E Test
 *
 * Tests the full lifecycle including:
 * 1. Create underwrite request
 * 2. Partial acceptance by first underwriter
 * 3. Additional acceptance by second underwriter (multi-underwriter)
 * 4. LP token verification
 * 5. Snapshot submission test
 * 6. LP token orderbook trading
 * 7. Settlement (both trigger and maturity scenarios)
 * 8. Payout/distribution verification
 *
 * Prerequisites:
 *   - Node running with --dev --rpc-methods=Unsafe
 *   - Run: node scripts/test-v3-comprehensive.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

// =============================================================================
// Configuration
// =============================================================================

const WS_URL = process.argv[2] || 'ws://127.0.0.1:9944';
const USDT_ASSET_ID = 1;
const V3_PAYOUT_PER_SHARE = 100_000_000n; // $100 per share (6 decimals)

// Test accounts (from dev keyring)
const ACCOUNTS = {
    alice: '//Alice',    // sudo, oracle, location admin
    bob: '//Bob',        // requester (policyholder)
    charlie: '//Charlie', // underwriter 1
    dave: '//Dave',       // underwriter 2
    eve: '//Eve',         // LP buyer
};

// Test results
const results = {
    passed: 0,
    failed: 0,
    tests: [],
};

// =============================================================================
// Helper Functions
// =============================================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function logTest(name, passed, details = '') {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`   ${status}: ${name}${details ? ' - ' + details : ''}`);
    results.tests.push({ name, passed, details });
    if (passed) results.passed++; else results.failed++;
}

async function signAndSend(tx, signer, api) {
    return new Promise((resolve, reject) => {
        tx.signAndSend(signer, { nonce: -1 }, ({ status, events, dispatchError }) => {
            if (dispatchError) {
                if (dispatchError.isModule) {
                    const decoded = api.registry.findMetaError(dispatchError.asModule);
                    reject(new Error(`${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`));
                } else {
                    reject(new Error(dispatchError.toString()));
                }
                return;
            }
            if (status.isFinalized) {
                resolve({ status, events });
            }
        });
    });
}

async function getUsdtBalance(api, account) {
    const result = await api.query.assets.account(USDT_ASSET_ID, account);
    if (result.isSome) {
        return BigInt(result.unwrap().balance.toString());
    }
    return 0n;
}

async function getLpBalance(api, policyId, account) {
    const holdings = await api.query.prmxHoldings.holdingsStorage(policyId, account);
    if (holdings) {
        return BigInt(holdings.lpShares.toString());
    }
    return 0n;
}

async function getTotalLpShares(api, policyId) {
    const total = await api.query.prmxHoldings.totalLpShares(policyId);
    return BigInt(total.toString());
}

function formatUsdt(amount) {
    return `$${(amount / 1_000_000n).toLocaleString()}`;
}

// =============================================================================
// Setup Functions
// =============================================================================

async function setupAccounts(api, keyring) {
    const alice = keyring.addFromUri(ACCOUNTS.alice);
    const bob = keyring.addFromUri(ACCOUNTS.bob);
    const charlie = keyring.addFromUri(ACCOUNTS.charlie);
    const dave = keyring.addFromUri(ACCOUNTS.dave);
    const eve = keyring.addFromUri(ACCOUNTS.eve);

    console.log('📋 Test Accounts:');
    console.log(`   Alice (admin/oracle): ${alice.address.substring(0, 20)}...`);
    console.log(`   Bob (requester):      ${bob.address.substring(0, 20)}...`);
    console.log(`   Charlie (UW1):        ${charlie.address.substring(0, 20)}...`);
    console.log(`   Dave (UW2):           ${dave.address.substring(0, 20)}...`);
    console.log(`   Eve (LP buyer):       ${eve.address.substring(0, 20)}...`);
    console.log('');

    return { alice, bob, charlie, dave, eve };
}

async function setupUsdt(api, alice, accounts) {
    console.log('🪙 Setting up USDT asset...');

    // Check if asset exists
    const asset = await api.query.assets.asset(USDT_ASSET_ID);
    if (asset.isNone) {
        console.log('   Creating USDT asset...');
        await signAndSend(
            api.tx.sudo.sudo(api.tx.assets.forceCreate(USDT_ASSET_ID, alice.address, true, 1)),
            alice,
            api
        );
    }

    // Mint USDT to test accounts
    const mintAmount = 10_000_000_000_000n; // 10M USDT (6 decimals)
    for (const [name, account] of Object.entries(accounts)) {
        const balance = await getUsdtBalance(api, account.address);
        if (balance < mintAmount / 2n) {
            console.log(`   Minting USDT to ${name}...`);
            await signAndSend(
                api.tx.assets.mint(USDT_ASSET_ID, account.address, mintAmount.toString()),
                alice,
                api
            );
        }
    }

    console.log('   ✅ USDT setup complete');
    console.log('');
}

async function addLocation(api, alice) {
    console.log('📍 Adding test location to V3 registry...');

    const existing = await api.query.prmxOracleV3.locationRegistry(0);
    if (existing.isSome) {
        console.log('   Location 0 already exists');
        return 0;
    }

    await signAndSend(
        api.tx.sudo.sudo(
            api.tx.prmxOracleV3.addLocation(
                '264885',      // AccuWeather Manila key
                14599512,      // latitude * 1e6
                120984222,     // longitude * 1e6
                'Manila'       // name
            )
        ),
        alice,
        api
    );

    console.log('   ✅ Location 0 (Manila) added');
    console.log('');
    return 0;
}

async function addOracleMember(api, alice) {
    console.log('🔮 Setting up oracle membership...');

    const isMember = await api.query.prmxOracleV3.oracleMembership(alice.address);
    if (isMember.isTrue) {
        console.log('   Alice already an oracle member');
        return;
    }

    await signAndSend(
        api.tx.sudo.sudo(api.tx.prmxOracleV3.addOracleMember(alice.address)),
        alice,
        api
    );

    console.log('   ✅ Alice added as oracle member');
    console.log('');
}

// =============================================================================
// Test Functions
// =============================================================================

async function testCreateRequest(api, bob, locationId) {
    console.log('\n📝 TEST 1: Create Underwrite Request');
    console.log('─'.repeat(50));

    const totalShares = 10n;                    // $1000 total coverage
    const premiumPerShare = 10_000_000n;        // $10 premium per share (10%)
    const now = Math.floor(Date.now() / 1000);
    const coverageStart = now + 60;             // starts in 1 minute
    const coverageEnd = now + 86400;            // ends in 24 hours
    const expiresAt = now + 3600;               // request expires in 1 hour

    const eventSpec = {
        event_type: { PrecipSumGte: null },
        threshold: {
            value: 50_000,                      // 50mm * 1000
            unit: { MmX1000: null },
        },
        early_trigger: true,
    };

    const bobBalanceBefore = await getUsdtBalance(api, bob.address);
    console.log(`   Bob's USDT before: ${formatUsdt(bobBalanceBefore)}`);

    const { events } = await signAndSend(
        api.tx.prmxMarketV3.createUnderwriteRequest(
            locationId,
            eventSpec,
            totalShares.toString(),
            premiumPerShare.toString(),
            coverageStart,
            coverageEnd,
            expiresAt
        ),
        bob,
        api
    );

    let requestId;
    for (const { event } of events) {
        if (event.section === 'prmxMarketV3' && event.method === 'RequestCreated') {
            requestId = event.data[0].toNumber();
            break;
        }
    }

    const bobBalanceAfter = await getUsdtBalance(api, bob.address);
    const expectedPremiumLocked = totalShares * premiumPerShare;
    const premiumDeducted = bobBalanceBefore - bobBalanceAfter;

    console.log(`   Bob's USDT after: ${formatUsdt(bobBalanceAfter)}`);
    console.log(`   Premium locked: ${formatUsdt(premiumDeducted)}`);

    logTest('Request created', requestId !== undefined, `ID=${requestId}`);
    logTest('Premium deducted from requester', premiumDeducted === expectedPremiumLocked, 
        `Expected ${formatUsdt(expectedPremiumLocked)}, got ${formatUsdt(premiumDeducted)}`);

    // Verify request state
    const request = await api.query.prmxMarketV3.underwriteRequests(requestId);
    const requestData = request.unwrap();
    const statusStr = requestData.status.toString().toLowerCase();
    logTest('Request status is Pending', statusStr.includes('pending'), `Status: ${requestData.status.toString()}`);

    console.log('');
    return { requestId, totalShares, premiumPerShare, eventSpec };
}

async function testPartialAcceptance(api, charlie, requestId, shares) {
    console.log('\n💰 TEST 2: Partial Acceptance (First Underwriter)');
    console.log('─'.repeat(50));

    const charlieBalanceBefore = await getUsdtBalance(api, charlie.address);
    console.log(`   Charlie's USDT before: ${formatUsdt(charlieBalanceBefore)}`);

    const { events } = await signAndSend(
        api.tx.prmxMarketV3.acceptUnderwriteRequest(requestId, shares.toString()),
        charlie,
        api
    );

    let isFirstAcceptance = false;
    let collateralLocked = 0n;
    for (const { event } of events) {
        if (event.section === 'prmxMarketV3' && event.method === 'RequestAccepted') {
            isFirstAcceptance = event.data[4].isTrue;
            collateralLocked = BigInt(event.data[3].toString());
        }
    }

    const charlieBalanceAfter = await getUsdtBalance(api, charlie.address);
    const charlieLpBalance = await getLpBalance(api, requestId, charlie.address);

    console.log(`   Charlie's USDT after: ${formatUsdt(charlieBalanceAfter)}`);
    console.log(`   Collateral locked: ${formatUsdt(collateralLocked)}`);
    console.log(`   Charlie's LP tokens: ${charlieLpBalance.toString()}`);

    logTest('First acceptance flagged correctly', isFirstAcceptance === true);
    logTest('Collateral deducted', charlieBalanceBefore - charlieBalanceAfter === collateralLocked);
    logTest('LP tokens minted', charlieLpBalance === BigInt(shares), 
        `Expected ${shares}, got ${charlieLpBalance}`);

    // Verify request status
    const request = await api.query.prmxMarketV3.underwriteRequests(requestId);
    const requestData = request.unwrap();
    const statusStr = requestData.status.toString().toLowerCase();
    logTest('Request status is PartiallyFilled', statusStr.includes('partiallyfilled'), `Status: ${requestData.status.toString()}`);

    // Verify policy created
    const policy = await api.query.prmxPolicyV3.policies(requestId);
    logTest('Policy created on first acceptance', policy.isSome);

    console.log('');
    return { collateralLocked };
}

async function testFullAcceptance(api, dave, requestId, shares) {
    console.log('\n💰 TEST 3: Full Acceptance (Second Underwriter)');
    console.log('─'.repeat(50));

    const daveBalanceBefore = await getUsdtBalance(api, dave.address);
    console.log(`   Dave's USDT before: ${formatUsdt(daveBalanceBefore)}`);

    const { events } = await signAndSend(
        api.tx.prmxMarketV3.acceptUnderwriteRequest(requestId, shares.toString()),
        dave,
        api
    );

    let isFirstAcceptance = false;
    let collateralLocked = 0n;
    let fullyFilled = false;
    for (const { event } of events) {
        if (event.section === 'prmxMarketV3' && event.method === 'RequestAccepted') {
            isFirstAcceptance = event.data[4].isTrue;
            collateralLocked = BigInt(event.data[3].toString());
        }
        if (event.section === 'prmxMarketV3' && event.method === 'RequestFullyFilled') {
            fullyFilled = true;
        }
    }

    const daveBalanceAfter = await getUsdtBalance(api, dave.address);
    const daveLpBalance = await getLpBalance(api, requestId, dave.address);
    const totalLpShares = await getTotalLpShares(api, requestId);

    console.log(`   Dave's USDT after: ${formatUsdt(daveBalanceAfter)}`);
    console.log(`   Collateral locked: ${formatUsdt(collateralLocked)}`);
    console.log(`   Dave's LP tokens: ${daveLpBalance.toString()}`);
    console.log(`   Total LP shares: ${totalLpShares.toString()}`);

    logTest('Not first acceptance', isFirstAcceptance === false);
    logTest('Request fully filled event', fullyFilled === true);
    logTest('Dave LP tokens minted', daveLpBalance === BigInt(shares));
    logTest('Total LP matches total shares', totalLpShares === 10n);

    // Verify request status
    const request = await api.query.prmxMarketV3.underwriteRequests(requestId);
    const requestData = request.unwrap();
    const statusStr = requestData.status.toString().toLowerCase();
    logTest('Request status is FullyFilled', statusStr.includes('fullyfilled'), `Status: ${requestData.status.toString()}`);

    console.log('');
}

async function testSnapshotSubmission(api, alice, policyId) {
    console.log('\n📸 TEST 4: Snapshot Submission');
    console.log('─'.repeat(50));

    const now = Math.floor(Date.now() / 1000);
    const aggState = { PrecipSum: { sum_mm_x1000: 25_000 } }; // 25mm
    const commitment = new Array(32).fill(0);
    commitment[0] = policyId;

    try {
        const { events } = await signAndSend(
            api.tx.prmxOracleV3.submitSnapshot(
                policyId,
                now,
                aggState,
                commitment
            ),
            alice,
            api
        );

        let snapshotSubmitted = false;
        for (const { event } of events) {
            if (event.section === 'prmxOracleV3' && event.method === 'SnapshotSubmitted') {
                snapshotSubmitted = true;
            }
        }

        logTest('Snapshot submitted successfully', snapshotSubmitted);

        // Verify oracle state updated
        const oracleState = await api.query.prmxOracleV3.oracleStates(policyId);
        if (oracleState.isSome) {
            const state = oracleState.unwrap();
            logTest('Oracle state updated', BigInt(state.observedUntil.toString()) >= BigInt(now));
        }
    } catch (e) {
        logTest('Snapshot submitted successfully', false, e.message);
    }

    console.log('');
}

async function testLpOrderbook(api, charlie, eve, policyId) {
    console.log('\n📈 TEST 5: LP Token Orderbook Trading');
    console.log('─'.repeat(50));

    const sharesToSell = 2n;
    const pricePerShare = 95_000_000n; // $95 per share

    // Charlie places ask
    const charlieLpBefore = await getLpBalance(api, policyId, charlie.address);
    console.log(`   Charlie LP before: ${charlieLpBefore.toString()}`);

    try {
        await signAndSend(
            api.tx.prmxOrderbookLp.placeLpAsk(policyId, pricePerShare.toString(), sharesToSell.toString()),
            charlie,
            api
        );
        logTest('Charlie placed LP ask order', true);
    } catch (e) {
        logTest('Charlie placed LP ask order', false, e.message);
        console.log('');
        return;
    }

    // Eve buys LP
    const eveLpBefore = await getLpBalance(api, policyId, eve.address);
    const eveUsdtBefore = await getUsdtBalance(api, eve.address);
    console.log(`   Eve USDT before: ${formatUsdt(eveUsdtBefore)}`);

    try {
        await signAndSend(
            api.tx.prmxOrderbookLp.buyLp(policyId, pricePerShare.toString(), sharesToSell.toString()),
            eve,
            api
        );

        const eveLpAfter = await getLpBalance(api, policyId, eve.address);
        const eveUsdtAfter = await getUsdtBalance(api, eve.address);
        const charlieUsdtAfter = await getUsdtBalance(api, charlie.address);

        console.log(`   Eve LP after: ${eveLpAfter.toString()}`);
        console.log(`   Eve USDT after: ${formatUsdt(eveUsdtAfter)}`);

        logTest('Eve bought LP tokens', eveLpAfter === sharesToSell);
        logTest('Eve paid correct amount', eveUsdtBefore - eveUsdtAfter === sharesToSell * pricePerShare);
    } catch (e) {
        logTest('Eve bought LP tokens', false, e.message);
    }

    console.log('');
}

async function testTriggerSettlement(api, alice, bob, charlie, dave, eve, policyId) {
    console.log('\n🎯 TEST 6: Trigger Settlement (Event Occurred)');
    console.log('─'.repeat(50));

    // Record balances before
    const bobBefore = await getUsdtBalance(api, bob.address);
    const charlieBefore = await getUsdtBalance(api, charlie.address);
    const daveBefore = await getUsdtBalance(api, dave.address);
    const eveBefore = await getUsdtBalance(api, eve.address);

    console.log('   Balances before settlement:');
    console.log(`      Bob (holder): ${formatUsdt(bobBefore)}`);
    console.log(`      Charlie (UW1): ${formatUsdt(charlieBefore)}`);
    console.log(`      Dave (UW2): ${formatUsdt(daveBefore)}`);
    console.log(`      Eve (LP buyer): ${formatUsdt(eveBefore)}`);

    // Submit final report (triggered)
    const now = Math.floor(Date.now() / 1000);
    const aggState = { PrecipSum: { sum_mm_x1000: 60_000 } }; // 60mm - above 50mm threshold
    const commitment = new Array(32).fill(0);
    commitment[0] = policyId;

    try {
        await signAndSend(
            api.tx.prmxOracleV3.submitFinalReport(
                policyId,
                { Trigger: null },
                now + 100,
                aggState,
                commitment
            ),
            alice,
            api
        );
        logTest('Final report (trigger) submitted', true);
    } catch (e) {
        logTest('Final report (trigger) submitted', false, e.message);
        console.log('');
        return;
    }

    // Check balances after
    const bobAfter = await getUsdtBalance(api, bob.address);
    const charlieAfter = await getUsdtBalance(api, charlie.address);
    const daveAfter = await getUsdtBalance(api, dave.address);
    const eveAfter = await getUsdtBalance(api, eve.address);

    console.log('   Balances after settlement:');
    console.log(`      Bob (holder): ${formatUsdt(bobAfter)} (+${formatUsdt(bobAfter - bobBefore)})`);
    console.log(`      Charlie (UW1): ${formatUsdt(charlieAfter)}`);
    console.log(`      Dave (UW2): ${formatUsdt(daveAfter)}`);
    console.log(`      Eve (LP buyer): ${formatUsdt(eveAfter)}`);

    // Verify: Bob should receive payout
    const expectedPayout = 10n * V3_PAYOUT_PER_SHARE; // 10 shares * $100
    logTest('Bob received payout', bobAfter > bobBefore, 
        `Got ${formatUsdt(bobAfter - bobBefore)}`);

    // Verify policy status
    const policy = await api.query.prmxPolicyV3.policies(policyId);
    if (policy.isSome) {
        const policyData = policy.unwrap();
        const statusStr = policyData.status.toString().toLowerCase();
        logTest('Policy status is Settled', statusStr.includes('settled'), `Status: ${policyData.status.toString()}`);
    }

    console.log('');
}

async function testMaturitySettlement(api, alice, bob, charlie, dave, policyId) {
    console.log('\n✅ TEST 7: Maturity Settlement (No Event)');
    console.log('─'.repeat(50));

    // Record balances before
    const bobBefore = await getUsdtBalance(api, bob.address);
    const charlieBefore = await getUsdtBalance(api, charlie.address);
    const daveBefore = await getUsdtBalance(api, dave.address);

    console.log('   Balances before settlement:');
    console.log(`      Bob (holder): ${formatUsdt(bobBefore)}`);
    console.log(`      Charlie (UW1): ${formatUsdt(charlieBefore)}`);
    console.log(`      Dave (UW2): ${formatUsdt(daveBefore)}`);

    // Submit final report (maturity - no trigger)
    const now = Math.floor(Date.now() / 1000);
    const aggState = { PrecipSum: { sum_mm_x1000: 30_000 } }; // 30mm - below 50mm threshold
    const commitment = new Array(32).fill(0);
    commitment[0] = policyId;

    try {
        await signAndSend(
            api.tx.prmxOracleV3.submitFinalReport(
                policyId,
                { Maturity: null },
                now + 100,
                aggState,
                commitment
            ),
            alice,
            api
        );
        logTest('Final report (maturity) submitted', true);
    } catch (e) {
        logTest('Final report (maturity) submitted', false, e.message);
        console.log('');
        return;
    }

    // Check balances after
    const bobAfter = await getUsdtBalance(api, bob.address);
    const charlieAfter = await getUsdtBalance(api, charlie.address);
    const daveAfter = await getUsdtBalance(api, dave.address);

    console.log('   Balances after settlement:');
    console.log(`      Bob (holder): ${formatUsdt(bobAfter)}`);
    console.log(`      Charlie (UW1): ${formatUsdt(charlieAfter)} (+${formatUsdt(charlieAfter - charlieBefore)})`);
    console.log(`      Dave (UW2): ${formatUsdt(daveAfter)} (+${formatUsdt(daveAfter - daveBefore)})`);

    // Verify: LPs should receive pro-rata distribution
    logTest('Charlie received distribution', charlieAfter > charlieBefore);
    logTest('Dave received distribution', daveAfter > daveBefore);

    // Verify policy status
    const policy = await api.query.prmxPolicyV3.policies(policyId);
    if (policy.isSome) {
        const policyData = policy.unwrap();
        const statusStr = policyData.status.toString().toLowerCase();
        logTest('Policy status is Settled', statusStr.includes('settled'), `Status: ${policyData.status.toString()}`);
    }

    console.log('');
}

async function testRequestCancellation(api, bob, charlie, locationId) {
    console.log('\n🚫 TEST 8: Request Cancellation');
    console.log('─'.repeat(50));

    const totalShares = 10n;
    const premiumPerShare = 10_000_000n;
    const now = Math.floor(Date.now() / 1000);

    const eventSpec = {
        event_type: { PrecipSumGte: null },
        threshold: {
            value: 50_000,
            unit: { MmX1000: null },
        },
        early_trigger: true,
    };

    // Create request
    const bobBalanceBefore = await getUsdtBalance(api, bob.address);
    const { events } = await signAndSend(
        api.tx.prmxMarketV3.createUnderwriteRequest(
            locationId,
            eventSpec,
            totalShares.toString(),
            premiumPerShare.toString(),
            now + 60,
            now + 86400,
            now + 3600
        ),
        bob,
        api
    );

    let requestId;
    for (const { event } of events) {
        if (event.section === 'prmxMarketV3' && event.method === 'RequestCreated') {
            requestId = event.data[0].toNumber();
            break;
        }
    }

    console.log(`   Created request ${requestId} for cancellation test`);

    // Charlie accepts 3 shares (partial)
    await signAndSend(
        api.tx.prmxMarketV3.acceptUnderwriteRequest(requestId, '3'),
        charlie,
        api
    );
    console.log('   Charlie accepted 3 shares (partial fill)');

    // Bob cancels remaining 7 shares
    const bobAfterAccept = await getUsdtBalance(api, bob.address);
    const { events: cancelEvents } = await signAndSend(
        api.tx.prmxMarketV3.cancelUnderwriteRequest(requestId),
        bob,
        api
    );

    let premiumReturned = 0n;
    let cancelledEvent = false;
    for (const { event } of cancelEvents) {
        if (event.section === 'prmxMarketV3' && event.method === 'RequestCancelled') {
            cancelledEvent = true;
            premiumReturned = BigInt(event.data[2].toString());
        }
    }

    const bobAfterCancel = await getUsdtBalance(api, bob.address);
    const expectedRefund = 7n * premiumPerShare; // 7 unfilled shares

    console.log(`   Premium returned: ${formatUsdt(premiumReturned)}`);
    console.log(`   Bob balance change: +${formatUsdt(bobAfterCancel - bobAfterAccept)}`);

    logTest('Request cancelled event emitted', cancelledEvent === true);
    logTest('Premium refunded for unfilled shares', premiumReturned === expectedRefund,
        `Expected ${formatUsdt(expectedRefund)}, got ${formatUsdt(premiumReturned)}`);
    logTest('Bob received refund', bobAfterCancel - bobAfterAccept === expectedRefund);

    // Verify request status
    const request = await api.query.prmxMarketV3.underwriteRequests(requestId);
    const requestData = request.unwrap();
    const statusStr = requestData.status.toString().toLowerCase();
    logTest('Request status is Cancelled', statusStr.includes('cancelled'), `Status: ${requestData.status.toString()}`);

    // Verify policy still exists with partial coverage
    const policy = await api.query.prmxPolicyV3.policies(requestId);
    logTest('Policy exists with partial coverage', policy.isSome);

    console.log('');
    return requestId;
}

async function testOracleStateInitialization(api, alice, policyId) {
    console.log('\n🔮 TEST 9: Oracle State Verification');
    console.log('─'.repeat(50));

    const oracleState = await api.query.prmxOracleV3.oracleStates(policyId);
    
    if (oracleState.isSome) {
        const state = oracleState.unwrap();
        console.log(`   Policy ID: ${policyId}`);
        console.log(`   Status: ${state.status.toString()}`);
        console.log(`   Observed until: ${state.observedUntil.toString()}`);
        
        logTest('Oracle state exists', true);
        logTest('Oracle status is Active', state.status.toString().toLowerCase().includes('active'));
    } else {
        logTest('Oracle state exists', false, 'State not found');
    }

    console.log('');
}

async function testValidationErrors(api, bob, charlie, locationId) {
    console.log('\n⚠️  TEST 10: Validation & Error Handling');
    console.log('─'.repeat(50));

    const now = Math.floor(Date.now() / 1000);
    const eventSpec = {
        event_type: { PrecipSumGte: null },
        threshold: { value: 50_000, unit: { MmX1000: null } },
        early_trigger: true,
    };

    // Test: Cannot accept own request
    const { events } = await signAndSend(
        api.tx.prmxMarketV3.createUnderwriteRequest(
            locationId, eventSpec, '5', '10000000',
            now + 60, now + 86400, now + 3600
        ),
        bob,
        api
    );

    let requestId;
    for (const { event } of events) {
        if (event.section === 'prmxMarketV3' && event.method === 'RequestCreated') {
            requestId = event.data[0].toNumber();
            break;
        }
    }

    try {
        await signAndSend(
            api.tx.prmxMarketV3.acceptUnderwriteRequest(requestId, '2'),
            bob, // Bob trying to accept his own request
            api
        );
        logTest('Cannot accept own request', false, 'Should have failed');
    } catch (e) {
        logTest('Cannot accept own request', e.message.includes('RequesterCannotUnderwrite'),
            e.message.includes('RequesterCannotUnderwrite') ? '' : e.message);
    }

    // Test: Cannot accept more than available
    try {
        await signAndSend(
            api.tx.prmxMarketV3.acceptUnderwriteRequest(requestId, '100'), // Only 5 shares total
            charlie,
            api
        );
        logTest('Cannot over-accept shares', false, 'Should have failed');
    } catch (e) {
        logTest('Cannot over-accept shares', e.message.includes('InsufficientShares') || 
            e.message.includes('ArithmeticOverflow'),
            e.message.includes('InsufficientShares') || e.message.includes('ArithmeticOverflow') ? '' : e.message);
    }

    console.log('');
}

// =============================================================================
// Main Test Flow
// =============================================================================

async function main() {
    console.log('═'.repeat(70));
    console.log('PRMX V3 Comprehensive E2E Test');
    console.log('P2P Climate Risk Market - Full Lifecycle');
    console.log('═'.repeat(70));
    console.log('');

    // Connect
    console.log(`🔌 Connecting to ${WS_URL}...`);
    const wsProvider = new WsProvider(WS_URL);
    const api = await ApiPromise.create({ provider: wsProvider });
    const chain = await api.rpc.system.chain();
    console.log(`   Connected to: ${chain.toString()}`);
    console.log('');

    // Setup
    const keyring = new Keyring({ type: 'sr25519' });
    const { alice, bob, charlie, dave, eve } = await setupAccounts(api, keyring);

    // Prepare environment
    await setupUsdt(api, alice, { alice, bob, charlie, dave, eve });
    const locationId = await addLocation(api, alice);
    await addOracleMember(api, alice);

    console.log('═'.repeat(70));
    console.log('SCENARIO A: Trigger Settlement (Event Occurs)');
    console.log('═'.repeat(70));

    // Test A: Trigger scenario
    const { requestId: requestIdA } = await testCreateRequest(api, bob, locationId);
    await testPartialAcceptance(api, charlie, requestIdA, 4n);
    await testFullAcceptance(api, dave, requestIdA, 6n);
    await testSnapshotSubmission(api, alice, requestIdA);
    await testLpOrderbook(api, charlie, eve, requestIdA);
    await testTriggerSettlement(api, alice, bob, charlie, dave, eve, requestIdA);

    // Wait a bit between scenarios
    await sleep(2000);

    console.log('═'.repeat(70));
    console.log('SCENARIO B: Maturity Settlement (No Event)');
    console.log('═'.repeat(70));

    // Create a fresh request for maturity test
    const { requestId: requestIdB } = await testCreateRequest(api, bob, locationId);
    await testPartialAcceptance(api, charlie, requestIdB, 5n);
    await testFullAcceptance(api, dave, requestIdB, 5n);
    await testOracleStateInitialization(api, alice, requestIdB);
    await testMaturitySettlement(api, alice, bob, charlie, dave, requestIdB);

    // Wait a bit between scenarios
    await sleep(2000);

    console.log('═'.repeat(70));
    console.log('SCENARIO C: Request Cancellation');
    console.log('═'.repeat(70));

    await testRequestCancellation(api, bob, charlie, locationId);

    // Wait a bit between scenarios
    await sleep(2000);

    console.log('═'.repeat(70));
    console.log('SCENARIO D: Validation & Error Handling');
    console.log('═'.repeat(70));

    await testValidationErrors(api, bob, charlie, locationId);

    // Summary
    console.log('═'.repeat(70));
    console.log('TEST SUMMARY');
    console.log('═'.repeat(70));
    console.log(`   Passed: ${results.passed}`);
    console.log(`   Failed: ${results.failed}`);
    console.log(`   Total:  ${results.passed + results.failed}`);
    console.log('');

    if (results.failed > 0) {
        console.log('❌ Failed Tests:');
        for (const test of results.tests) {
            if (!test.passed) {
                console.log(`   - ${test.name}: ${test.details}`);
            }
        }
        console.log('');
    }

    console.log(results.failed === 0 ? '✅ ALL TESTS PASSED!' : '❌ SOME TESTS FAILED');
    console.log('═'.repeat(70));

    await api.disconnect();
    process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((error) => {
    console.error('');
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
});

