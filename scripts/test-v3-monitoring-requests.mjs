#!/usr/bin/env node
/**
 * V3 Monitoring Test Requests
 * 
 * Creates 10 diverse V3 underwrite requests across different locations and event types
 * with short coverage windows (ending today) to test V3 oracle monitoring.
 * 
 * Usage:
 *   node scripts/test-v3-monitoring-requests.mjs [--accept]
 * 
 * Options:
 *   --accept    Have Charlie accept all requests to create policies for monitoring
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

// =============================================================================
// Configuration
// =============================================================================

const WS_URL = 'ws://127.0.0.1:9944';
const USDT_ASSET_ID = 1;
const SHOULD_ACCEPT = process.argv.includes('--accept');

// Test request patterns: location name -> location ID mapping is dynamic
const TEST_REQUESTS = [
    {
        locationName: 'Manila',
        eventType: 'PrecipSumGte',
        threshold: { value: 50_000, unit: 'MmX1000' },  // 50mm
        durationHours: 2,
        description: 'Cumulative rainfall ≥ 50mm'
    },
    {
        locationName: 'Tokyo',
        eventType: 'TempMaxGte',
        threshold: { value: 35_000, unit: 'CelsiusX1000' },  // 35°C
        durationHours: 2,
        description: 'Max temperature ≥ 35°C'
    },
    {
        locationName: 'Singapore',
        eventType: 'Precip1hGte',
        threshold: { value: 20_000, unit: 'MmX1000' },  // 20mm/h
        durationHours: 1,
        description: 'Hourly rainfall ≥ 20mm'
    },
    {
        locationName: 'Hong Kong',
        eventType: 'TempMinLte',
        threshold: { value: 10_000, unit: 'CelsiusX1000' },  // 10°C
        durationHours: 3,
        description: 'Min temperature ≤ 10°C'
    },
    {
        locationName: 'Bangkok',
        eventType: 'WindGustMaxGte',
        threshold: { value: 15_000, unit: 'MpsX1000' },  // 15 m/s
        durationHours: 2,
        description: 'Wind gust ≥ 15 m/s'
    },
    {
        locationName: 'Seoul',
        eventType: 'PrecipSumGte',
        threshold: { value: 30_000, unit: 'MmX1000' },  // 30mm
        durationHours: 4,
        description: 'Cumulative rainfall ≥ 30mm'
    },
    {
        locationName: 'Sydney',
        eventType: 'TempMaxGte',
        threshold: { value: 40_000, unit: 'CelsiusX1000' },  // 40°C
        durationHours: 2,
        description: 'Max temperature ≥ 40°C'
    },
    {
        locationName: 'Jakarta',
        eventType: 'Precip1hGte',
        threshold: { value: 25_000, unit: 'MmX1000' },  // 25mm/h
        durationHours: 1,
        description: 'Hourly rainfall ≥ 25mm'
    },
    {
        locationName: 'Miami',
        eventType: 'WindGustMaxGte',
        threshold: { value: 20_000, unit: 'MpsX1000' },  // 20 m/s
        durationHours: 3,
        description: 'Wind gust ≥ 20 m/s'
    },
    {
        locationName: 'Mumbai',
        eventType: 'TempMinLte',
        threshold: { value: 15_000, unit: 'CelsiusX1000' },  // 15°C
        durationHours: 2,
        description: 'Min temperature ≤ 15°C'
    },
];

// Common request parameters
const TOTAL_SHARES = 5;           // 5 shares = $500 coverage
const PREMIUM_PER_SHARE = 5_000_000;  // $5 per share (6 decimals)
const EXPIRY_MINUTES = 30;        // Request expires in 30 minutes

// =============================================================================
// Helper Functions
// =============================================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

async function getLocations(api) {
    const entries = await api.query.prmxOracleV3.locationRegistry.entries();
    const locations = new Map();
    
    for (const [key, value] of entries) {
        if (value.isSome) {
            const loc = value.unwrap();
            const name = Buffer.from(loc.name.toHex().slice(2), 'hex').toString('utf8').replace(/\0/g, '');
            locations.set(name, loc.locationId.toNumber());
        }
    }
    
    return locations;
}

// =============================================================================
// Main Functions
// =============================================================================

async function setupUsdt(api, alice, bob) {
    console.log('🪙 Checking USDT setup...');
    
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
    
    // Mint USDT to Bob if needed (for premium escrow)
    const bobBalance = await getUsdtBalance(api, bob.address);
    const requiredAmount = BigInt(TOTAL_SHARES * PREMIUM_PER_SHARE * TEST_REQUESTS.length);
    
    if (bobBalance < requiredAmount * 2n) {
        console.log(`   Minting USDT to Bob...`);
        await signAndSend(
            api.tx.assets.mint(USDT_ASSET_ID, bob.address, (requiredAmount * 10n).toString()),
            alice,
            api
        );
    }
    
    console.log(`   Bob USDT balance: $${(await getUsdtBalance(api, bob.address)) / 1_000_000n}`);
    console.log('');
}

async function setupCharlieUsdt(api, alice, charlie) {
    // Mint USDT to Charlie if accepting
    const charlieBalance = await getUsdtBalance(api, charlie.address);
    const requiredCollateral = BigInt(100_000_000) * BigInt(TOTAL_SHARES) * BigInt(TEST_REQUESTS.length); // $100 per share
    
    if (charlieBalance < requiredCollateral * 2n) {
        console.log(`   Minting USDT to Charlie for collateral...`);
        await signAndSend(
            api.tx.assets.mint(USDT_ASSET_ID, charlie.address, (requiredCollateral * 10n).toString()),
            alice,
            api
        );
    }
    
    console.log(`   Charlie USDT balance: $${(await getUsdtBalance(api, charlie.address)) / 1_000_000n}`);
}

async function createRequest(api, bob, locationId, testRequest, index) {
    const now = Math.floor(Date.now() / 1000);
    const coverageStart = now + 60;  // Start in 1 minute
    const coverageEnd = now + (testRequest.durationHours * 3600);  // End in X hours
    const expiresAt = now + (EXPIRY_MINUTES * 60);  // Expires in 30 minutes
    
    const eventSpec = {
        event_type: { [testRequest.eventType]: null },
        threshold: {
            value: testRequest.threshold.value,
            unit: { [testRequest.threshold.unit]: null },
        },
        early_trigger: true,
    };
    
    console.log(`   [${index + 1}/10] ${testRequest.locationName}: ${testRequest.description}`);
    
    const { events } = await signAndSend(
        api.tx.prmxMarketV3.createUnderwriteRequest(
            locationId,
            eventSpec,
            TOTAL_SHARES.toString(),
            PREMIUM_PER_SHARE.toString(),
            coverageStart,
            coverageEnd,
            expiresAt
        ),
        bob,
        api
    );
    
    // Find RequestCreated event
    let requestId = null;
    for (const { event } of events) {
        if (event.section === 'prmxMarketV3' && event.method === 'RequestCreated') {
            requestId = event.data[0].toNumber();
            break;
        }
    }
    
    if (requestId !== null) {
        console.log(`       ✅ Request #${requestId} created (coverage: ${testRequest.durationHours}h)`);
    } else {
        console.log(`       ⚠️ Request created but ID not found in events`);
    }
    
    return requestId;
}

async function acceptRequest(api, charlie, requestId, index) {
    console.log(`   [${index + 1}/10] Accepting request #${requestId}...`);
    
    try {
        await signAndSend(
            api.tx.prmxMarketV3.acceptUnderwriteRequest(requestId, TOTAL_SHARES.toString()),
            charlie,
            api
        );
        console.log(`       ✅ Request #${requestId} → Policy created`);
        return true;
    } catch (error) {
        console.log(`       ❌ Failed: ${error.message}`);
        return false;
    }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
    console.log('═'.repeat(70));
    console.log('PRMX V3 Monitoring Test - Create Diverse Requests');
    console.log('═'.repeat(70));
    console.log('');
    console.log(`Mode: ${SHOULD_ACCEPT ? 'Create requests AND accept (create policies)' : 'Create requests only'}`);
    console.log('');
    
    // Connect
    console.log(`🔌 Connecting to ${WS_URL}...`);
    const wsProvider = new WsProvider(WS_URL);
    const api = await ApiPromise.create({ provider: wsProvider });
    const chain = await api.rpc.system.chain();
    console.log(`   Connected to: ${chain.toString()}`);
    console.log('');
    
    // Setup accounts
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');
    const charlie = keyring.addFromUri('//Charlie');
    
    console.log('📋 Accounts:');
    console.log(`   Alice (admin):     ${alice.address}`);
    console.log(`   Bob (requester):   ${bob.address}`);
    console.log(`   Charlie (underwriter): ${charlie.address}`);
    console.log('');
    
    // Get available locations
    console.log('📍 Fetching V3 locations...');
    const locations = await getLocations(api);
    console.log(`   Found ${locations.size} locations:`);
    for (const [name, id] of locations) {
        console.log(`     - ${name} (ID: ${id})`);
    }
    console.log('');
    
    // Validate all required locations exist
    const missingLocations = TEST_REQUESTS.filter(r => !locations.has(r.locationName));
    if (missingLocations.length > 0) {
        console.error('❌ Missing locations:');
        for (const r of missingLocations) {
            console.error(`   - ${r.locationName}`);
        }
        console.error('');
        console.error('Run: node scripts/populate-location-registry.mjs --sudo');
        await api.disconnect();
        process.exit(1);
    }
    
    // Setup USDT
    await setupUsdt(api, alice, bob);
    
    if (SHOULD_ACCEPT) {
        await setupCharlieUsdt(api, alice, charlie);
    }
    
    // Create requests
    console.log('═'.repeat(70));
    console.log('Creating 10 V3 Underwrite Requests');
    console.log('═'.repeat(70));
    console.log('');
    
    const requestIds = [];
    
    for (let i = 0; i < TEST_REQUESTS.length; i++) {
        const testRequest = TEST_REQUESTS[i];
        const locationId = locations.get(testRequest.locationName);
        
        try {
            const requestId = await createRequest(api, bob, locationId, testRequest, i);
            if (requestId !== null) {
                requestIds.push({ id: requestId, testRequest });
            }
        } catch (error) {
            console.log(`       ❌ Failed: ${error.message}`);
        }
        
        await sleep(500);  // Small delay between requests
    }
    
    console.log('');
    console.log(`✅ Created ${requestIds.length} requests`);
    console.log('');
    
    // Accept requests if flag provided
    if (SHOULD_ACCEPT && requestIds.length > 0) {
        console.log('═'.repeat(70));
        console.log('Accepting Requests (Creating Policies for Monitoring)');
        console.log('═'.repeat(70));
        console.log('');
        
        let acceptedCount = 0;
        for (let i = 0; i < requestIds.length; i++) {
            const { id } = requestIds[i];
            const success = await acceptRequest(api, charlie, id, i);
            if (success) acceptedCount++;
            await sleep(500);
        }
        
        console.log('');
        console.log(`✅ Accepted ${acceptedCount} requests → ${acceptedCount} policies created`);
        console.log('');
    }
    
    // Summary
    console.log('═'.repeat(70));
    console.log('Summary');
    console.log('═'.repeat(70));
    console.log('');
    console.log('Created Requests:');
    for (const { id, testRequest } of requestIds) {
        console.log(`   #${id}: ${testRequest.locationName} - ${testRequest.description} (${testRequest.durationHours}h)`);
    }
    console.log('');
    
    if (!SHOULD_ACCEPT) {
        console.log('💡 To convert requests to policies (for monitoring), run:');
        console.log('   node scripts/test-v3-monitoring-requests.mjs --accept');
        console.log('');
    } else {
        console.log('🔍 The oracle service should now be monitoring these policies.');
        console.log('   Check: tail -f /tmp/oracle-service.log');
        console.log('');
    }
    
    await api.disconnect();
    console.log('Done!');
}

main().catch((error) => {
    console.error('');
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
});

