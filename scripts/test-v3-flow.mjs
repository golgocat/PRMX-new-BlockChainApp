#!/usr/bin/env node
/**
 * V3 P2P Climate Risk Market - E2E Test Flow
 *
 * Tests the full lifecycle:
 * 1. Create underwrite request
 * 2. Partial acceptance by first underwriter
 * 3. Additional acceptance by second underwriter (multi-underwriter)
 * 4. Full fill and DeFi allocation
 * 5. Simulate oracle observation and final report
 * 6. Settlement (trigger or maturity)
 *
 * Prerequisites:
 *   - Node running with --dev --rpc-methods=Unsafe
 *   - Locations added to registry
 *   - Accounts funded with USDT
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

// =============================================================================
// Configuration
// =============================================================================

const WS_URL = process.argv[2] || 'ws://127.0.0.1:9944';
const USDT_ASSET_ID = 1;

// Test accounts (from dev keyring)
const ACCOUNTS = {
    alice: '//Alice',    // sudo, oracle, location admin
    bob: '//Bob',        // requester (policyholder)
    charlie: '//Charlie', // underwriter 1
    dave: '//Dave',       // underwriter 2
};

// =============================================================================
// Helper Functions
// =============================================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForEvent(api, palletName, eventName, maxBlocks = 10) {
    let count = 0;
    return new Promise((resolve, reject) => {
        const unsub = api.query.system.events((events) => {
            for (const { event } of events) {
                if (event.section === palletName && event.method === eventName) {
                    unsub.then(u => u());
                    resolve(event);
                    return;
                }
            }
            count++;
            if (count > maxBlocks) {
                unsub.then(u => u());
                reject(new Error(`Timeout waiting for ${palletName}.${eventName}`));
            }
        });
    });
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

// =============================================================================
// Test Steps
// =============================================================================

async function setupAccounts(api, keyring) {
    const alice = keyring.addFromUri(ACCOUNTS.alice);
    const bob = keyring.addFromUri(ACCOUNTS.bob);
    const charlie = keyring.addFromUri(ACCOUNTS.charlie);
    const dave = keyring.addFromUri(ACCOUNTS.dave);

    console.log('📋 Accounts:');
    console.log(`   Alice (admin/oracle): ${alice.address}`);
    console.log(`   Bob (requester):      ${bob.address}`);
    console.log(`   Charlie (underwriter1): ${charlie.address}`);
    console.log(`   Dave (underwriter2):    ${dave.address}`);
    console.log('');

    return { alice, bob, charlie, dave };
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
    const mintAmount = 1_000_000_000_000n; // 1M USDT (6 decimals)
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

    // Check if location 0 exists
    const existing = await api.query.prmxOracleV3.locationRegistry(0);
    if (existing.isSome) {
        console.log('   Location 0 already exists');
        return 0;
    }

    // Add Manila location
    await signAndSend(
        api.tx.sudo.sudo(
            api.tx.prmxOracleV3.addLocation(
                '264885',      // AccuWeather Manila key
                14599512,      // latitude * 1e6 (14.599512)
                120984222,     // longitude * 1e6 (120.984222)
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
    console.log('🔮 Adding Alice as oracle member...');

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

async function createUnderwriteRequest(api, bob, locationId) {
    console.log('📝 Creating underwrite request...');

    const totalShares = 10n;                    // $1000 total coverage
    const premiumPerShare = 10_000_000n;        // $10 premium per share (10%)
    const now = Math.floor(Date.now() / 1000);
    const coverageStart = now + 60;             // starts in 1 minute
    const coverageEnd = now + 86400;            // ends in 24 hours
    const expiresAt = now + 3600;               // request expires in 1 hour

    // Event spec: Cumulative precipitation >= 50mm
    const eventSpec = {
        event_type: { PrecipSumGte: null },
        threshold: {
            value: 50_000,                      // 50mm * 1000
            unit: { MmX1000: null },
        },
        early_trigger: true,
    };

    console.log(`   Location ID: ${locationId}`);
    console.log(`   Total shares: ${totalShares} ($${totalShares * 100n} coverage)`);
    console.log(`   Premium per share: $${premiumPerShare / 1_000_000n}`);
    console.log(`   Threshold: 50mm precipitation`);
    console.log('');

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

    // Find RequestCreated event
    let requestId;
    for (const { event } of events) {
        if (event.section === 'prmxMarketV3' && event.method === 'RequestCreated') {
            requestId = event.data[0].toNumber();
            break;
        }
    }

    console.log(`   ✅ Request created: ID ${requestId}`);
    console.log('');
    return requestId;
}

async function acceptRequest(api, underwriter, requestId, shares, label) {
    console.log(`💰 ${label} accepting ${shares} shares...`);

    const { events } = await signAndSend(
        api.tx.prmxMarketV3.acceptUnderwriteRequest(requestId, shares.toString()),
        underwriter,
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

    console.log(`   First acceptance: ${isFirstAcceptance}`);
    console.log(`   Collateral locked: $${collateralLocked / 1_000_000n}`);
    console.log(`   ✅ Acceptance complete`);
    console.log('');
}

async function submitFinalReport(api, alice, policyId, triggered) {
    console.log(`📊 Submitting final report (triggered=${triggered})...`);

    const now = Math.floor(Date.now() / 1000);
    const kind = triggered ? { Trigger: null } : { Maturity: null };

    // Create agg_state based on outcome
    const aggState = triggered
        ? { PrecipSum: { sum_mm_x1000: 60_000 } }  // 60mm - above threshold
        : { PrecipSum: { sum_mm_x1000: 30_000 } }; // 30mm - below threshold

    // Generate mock commitment
    const commitment = new Array(32).fill(0);
    commitment[0] = policyId;

    await signAndSend(
        api.tx.prmxOracleV3.submitFinalReport(
            policyId,
            kind,
            now,
            aggState,
            commitment
        ),
        alice,
        api
    );

    console.log(`   ✅ Final report submitted`);
    console.log('');
}

async function verifyPolicyState(api, policyId) {
    console.log(`🔍 Verifying policy ${policyId} state...`);

    const policy = await api.query.prmxPolicyV3.policies(policyId);
    if (policy.isNone) {
        console.log('   ❌ Policy not found');
        return null;
    }

    const policyData = policy.unwrap();
    console.log(`   Status: ${Object.keys(policyData.status)[0]}`);
    console.log(`   Total shares: ${policyData.totalShares.toString()}`);
    console.log(`   Holder: ${policyData.holder.toString().substring(0, 20)}...`);
    console.log('');

    return policyData;
}

async function verifyRequestState(api, requestId) {
    console.log(`🔍 Verifying request ${requestId} state...`);

    const request = await api.query.prmxMarketV3.underwriteRequests(requestId);
    if (request.isNone) {
        console.log('   ❌ Request not found');
        return null;
    }

    const requestData = request.unwrap();
    console.log(`   Status: ${Object.keys(requestData.status)[0]}`);
    console.log(`   Filled: ${requestData.filledShares.toString()} / ${requestData.totalShares.toString()}`);
    console.log('');

    return requestData;
}

// =============================================================================
// Main Test Flow
// =============================================================================

async function main() {
    console.log('═'.repeat(70));
    console.log('PRMX V3 E2E Test - P2P Climate Risk Market');
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
    const { alice, bob, charlie, dave } = await setupAccounts(api, keyring);

    // Prepare environment
    await setupUsdt(api, alice, { alice, bob, charlie, dave });
    const locationId = await addLocation(api, alice);
    await addOracleMember(api, alice);

    // Test flow
    console.log('═'.repeat(70));
    console.log('TEST: Full V3 Lifecycle');
    console.log('═'.repeat(70));
    console.log('');

    // 1. Bob creates an underwrite request
    const requestId = await createUnderwriteRequest(api, bob, locationId);
    await verifyRequestState(api, requestId);

    // 2. Charlie accepts 4 shares (partial fill)
    await acceptRequest(api, charlie, requestId, 4, 'Charlie');
    await verifyRequestState(api, requestId);
    await verifyPolicyState(api, requestId); // policy_id = request_id

    // 3. Dave accepts 6 shares (full fill)
    await acceptRequest(api, dave, requestId, 6, 'Dave');
    await verifyRequestState(api, requestId);
    await verifyPolicyState(api, requestId);

    // 4. Submit final report (simulate trigger)
    console.log('─'.repeat(70));
    console.log('Simulating weather event trigger...');
    console.log('─'.repeat(70));
    console.log('');

    await submitFinalReport(api, alice, requestId, true);
    await verifyPolicyState(api, requestId);

    // Check final balances
    console.log('💵 Final USDT Balances:');
    console.log(`   Bob (requester):   $${(await getUsdtBalance(api, bob.address)) / 1_000_000n}`);
    console.log(`   Charlie (UW1):     $${(await getUsdtBalance(api, charlie.address)) / 1_000_000n}`);
    console.log(`   Dave (UW2):        $${(await getUsdtBalance(api, dave.address)) / 1_000_000n}`);
    console.log('');

    console.log('═'.repeat(70));
    console.log('✅ V3 E2E Test Complete!');
    console.log('═'.repeat(70));

    await api.disconnect();
    process.exit(0);
}

main().catch((error) => {
    console.error('');
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
});

