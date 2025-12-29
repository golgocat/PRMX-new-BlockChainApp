#!/usr/bin/env node
/**
 * V3 Policy Monitoring Script
 * 
 * Monitors V3 policies #1-#10 to verify oracle monitoring is working correctly.
 * Displays real-time status, aggregation state, and events.
 * 
 * Usage:
 *   node scripts/monitor-v3-policies.mjs [--policy-ids 1,2,3] [--interval 5]
 * 
 * Options:
 *   --policy-ids <ids>   Comma-separated policy IDs to monitor (default: 1-10)
 *   --interval <secs>    Polling interval in seconds (default: 6)
 *   --once               Run once and exit (no continuous monitoring)
 *   --events-only        Only show events, no polling display
 *   --check-secrets      Check if oracle secrets are provisioned
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

// =============================================================================
// Configuration
// =============================================================================

const WS_URL = 'ws://127.0.0.1:9944';
const DEFAULT_POLICY_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const DEFAULT_INTERVAL_SECS = 6;

// Parse CLI args
function parseArgs() {
    const args = process.argv.slice(2);
    let policyIds = DEFAULT_POLICY_IDS;
    let intervalSecs = DEFAULT_INTERVAL_SECS;
    let once = false;
    let eventsOnly = false;
    let checkSecrets = false;
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--policy-ids' && args[i + 1]) {
            policyIds = args[++i].split(',').map(s => parseInt(s.trim()));
        } else if (args[i] === '--interval' && args[i + 1]) {
            intervalSecs = parseInt(args[++i]);
        } else if (args[i] === '--once') {
            once = true;
        } else if (args[i] === '--events-only') {
            eventsOnly = true;
        } else if (args[i] === '--check-secrets') {
            checkSecrets = true;
        }
    }
    
    return { policyIds, intervalSecs, once, eventsOnly, checkSecrets };
}

// =============================================================================
// Helper Functions
// =============================================================================

function formatTimestamp(epochSecs) {
    if (!epochSecs || epochSecs === 0) return 'N/A';
    return new Date(epochSecs * 1000).toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
}

function formatDuration(startEpoch, endEpoch) {
    const now = Math.floor(Date.now() / 1000);
    const remaining = endEpoch - now;
    
    if (remaining <= 0) {
        return 'ENDED';
    }
    
    const hours = Math.floor(remaining / 3600);
    const mins = Math.floor((remaining % 3600) / 60);
    return `${hours}h ${mins}m left`;
}

function parseAggState(aggState, policyId = null) {
    if (!aggState) return { type: 'Unknown', value: 'N/A' };
    
    const human = aggState.toHuman ? aggState.toHuman() : aggState;
    const stateType = Object.keys(human)[0];
    const stateValue = human[stateType];
    
    switch (stateType) {
        case 'PrecipSum': {
            const val = parseInt(String(stateValue?.sum_mm_x1000 || stateValue?.sumMmX1000 || stateValue || 0).replace(/,/g, ''));
            return { type: 'PrecipSum', value: `${(val / 1000).toFixed(1)} mm` };
        }
        case 'Precip1hMax': {
            const val = parseInt(String(stateValue?.max_1h_mm_x1000 || stateValue?.max1hMmX1000 || stateValue || 0).replace(/,/g, ''));
            return { type: 'Precip1hMax', value: `${(val / 1000).toFixed(1)} mm/h` };
        }
        case 'TempMax': {
            const val = parseInt(String(stateValue?.max_c_x1000 || stateValue?.maxCX1000 || stateValue || 0).replace(/,/g, ''));
            return { type: 'TempMax', value: `${(val / 1000).toFixed(1)}°C` };
        }
        case 'TempMin': {
            const val = parseInt(String(stateValue?.min_c_x1000 || stateValue?.minCX1000 || stateValue || 0).replace(/,/g, ''));
            return { type: 'TempMin', value: `${(val / 1000).toFixed(1)}°C` };
        }
        case 'WindGustMax': {
            const val = parseInt(String(stateValue?.max_mps_x1000 || stateValue?.maxMpsX1000 || stateValue || 0).replace(/,/g, ''));
            return { type: 'WindGustMax', value: `${(val / 1000).toFixed(1)} m/s` };
        }
        case 'PrecipTypeOccurred': {
            const val = parseInt(String(stateValue?.mask || stateValue || 0).replace(/,/g, ''));
            return { type: 'PrecipType', value: `mask: ${val}` };
        }
        default:
            return { type: stateType, value: JSON.stringify(stateValue) };
    }
}

function parseStatus(status) {
    const statusStr = typeof status === 'object' ? Object.keys(status)[0] : String(status);
    return statusStr;
}

function getStatusIcon(status) {
    switch (status) {
        case 'Active': return '🟢';
        case 'Triggered': return '🎯';
        case 'Matured': return '✅';
        case 'Settled': return '💰';
        default: return '⚪';
    }
}

// =============================================================================
// Monitoring Functions
// =============================================================================

async function getOracleState(api, policyId) {
    const state = await api.query.prmxOracleV3.oracleStates(policyId);
    if (state.isNone) return null;
    
    const data = state.unwrap();
    const human = data.toHuman();
    
    return {
        policyId,
        observedUntil: parseInt(String(human.observedUntil || human.observed_until || '0').replace(/,/g, '')),
        aggState: parseAggState(data.aggState || data.agg_state, policyId),
        commitment: data.commitment.toHex().slice(0, 18) + '...',
        lastSnapshotBlock: parseInt(String(human.lastSnapshotBlock || human.last_snapshot_block || '0').replace(/,/g, '')),
        status: parseStatus(human.status),
    };
}

async function getPolicyMetadata(api, policyId) {
    const metadata = await api.query.prmxOracleV3.policyMetadata(policyId);
    if (metadata.isNone) return null;
    
    const [locationId, eventSpec, coverageStart, coverageEnd] = metadata.unwrap();
    const eventSpecHuman = eventSpec.toHuman();
    
    // Extract eventType - handle both object {TempMaxGte: null} and string "TempMaxGte" formats
    let eventTypeValue = eventSpecHuman.event_type || eventSpecHuman.eventType;
    let eventType;
    if (typeof eventTypeValue === 'string') {
        eventType = eventTypeValue;
    } else if (typeof eventTypeValue === 'object' && eventTypeValue !== null) {
        eventType = Object.keys(eventTypeValue)[0];
    } else {
        eventType = 'Unknown';
    }
    
    return {
        locationId: locationId.toNumber(),
        eventType,
        coverageStart: coverageStart.toNumber(),
        coverageEnd: coverageEnd.toNumber(),
    };
}

async function getLocationName(api, locationId) {
    const location = await api.query.prmxOracleV3.locationRegistry(locationId);
    if (location.isNone) return `Loc#${locationId}`;
    
    const data = location.unwrap();
    const name = Buffer.from(data.name.toHex().slice(2), 'hex').toString('utf8').replace(/\0/g, '');
    return name;
}

async function displayPolicyStatus(api, policyIds) {
    const now = Math.floor(Date.now() / 1000);
    const currentBlock = (await api.query.system.number()).toNumber();
    
    console.clear();
    console.log('═'.repeat(100));
    console.log('                           PRMX V3 Policy Monitor');
    console.log('═'.repeat(100));
    console.log(`  Time: ${new Date().toLocaleTimeString()}   Block: #${currentBlock}   Monitoring: ${policyIds.length} policies`);
    console.log('─'.repeat(100));
    console.log('');
    
    console.log(
        'Policy'.padEnd(8) +
        'Location'.padEnd(14) +
        'Type'.padEnd(14) +
        'Status'.padEnd(12) +
        'AggState'.padEnd(20) +
        'Observed'.padEnd(12) +
        'Coverage'.padEnd(14) +
        'Last Snap'
    );
    console.log('─'.repeat(100));
    
    let activeCount = 0;
    let triggeredCount = 0;
    let maturedCount = 0;
    let hasSnapshots = 0;
    
    for (const policyId of policyIds) {
        const state = await getOracleState(api, policyId);
        const metadata = await getPolicyMetadata(api, policyId);
        
        if (!state || !metadata) {
            console.log(`#${policyId}`.padEnd(8) + 'NOT FOUND'.padEnd(92));
            continue;
        }
        
        const locationName = await getLocationName(api, metadata.locationId);
        
        const statusIcon = getStatusIcon(state.status);
        const statusStr = `${statusIcon} ${state.status}`;
        
        const aggStr = `${state.aggState.value}`;
        const observedStr = formatTimestamp(state.observedUntil);
        const coverageStr = formatDuration(metadata.coverageStart, metadata.coverageEnd);
        const snapBlockStr = state.lastSnapshotBlock > 0 ? `#${state.lastSnapshotBlock}` : '-';
        
        console.log(
            `#${policyId}`.padEnd(8) +
            locationName.padEnd(14) +
            metadata.eventType.padEnd(14) +
            statusStr.padEnd(14) +
            aggStr.padEnd(20) +
            observedStr.padEnd(12) +
            coverageStr.padEnd(14) +
            snapBlockStr
        );
        
        if (state.status === 'Active') activeCount++;
        if (state.status === 'Triggered') triggeredCount++;
        if (state.status === 'Matured') maturedCount++;
        if (state.lastSnapshotBlock > 0) hasSnapshots++;
    }
    
    console.log('─'.repeat(100));
    console.log('');
    console.log('Summary:');
    console.log(`  🟢 Active: ${activeCount}   🎯 Triggered: ${triggeredCount}   ✅ Matured: ${maturedCount}   📸 With Snapshots: ${hasSnapshots}`);
    console.log('');
    console.log('Monitoring... (Ctrl+C to exit)');
    console.log('');
}

// Event log storage
const eventLog = [];
const MAX_EVENT_LOG = 50;

function addEventLog(message) {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    const logEntry = `[${time}] ${message}`;
    eventLog.unshift(logEntry);
    if (eventLog.length > MAX_EVENT_LOG) eventLog.pop();
    console.log(logEntry);
}

async function subscribeToEvents(api, policyIds, eventsOnly) {
    const policySet = new Set(policyIds);
    
    console.log('📡 Subscribed to oracle events...\n');
    
    api.query.system.events((events) => {
        events.forEach(({ event }) => {
            if (event.section === 'prmxOracleV3') {
                const data = event.data.toHuman();
                const policyId = parseInt(String(data.policy_id || data.policyId || data[0] || '0').replace(/,/g, ''));
                
                if (!policySet.has(policyId)) return;
                
                switch (event.method) {
                    case 'SnapshotSubmitted':
                        addEventLog(`📸 Policy #${policyId}: Snapshot submitted (observed_until: ${data.observed_until || data.observedUntil})`);
                        break;
                    case 'FinalReportSubmitted':
                        const triggered = data.triggered;
                        addEventLog(`🏁 Policy #${policyId}: Final report - ${triggered === true || triggered === 'true' ? '🎯 TRIGGERED' : '✅ MATURED'}`);
                        break;
                    case 'OracleStateInitialized':
                        addEventLog(`🆕 Policy #${policyId}: Oracle state initialized`);
                        break;
                }
            }
        });
    });
}

// Check if V3 oracle secrets are provisioned and Ingest API is reachable
async function checkOracleSecrets(api) {
    console.log('\n🔐 Checking V3 Oracle Configuration...\n');
    
    // Check Ingest API
    console.log('1️⃣  Checking Ingest API...');
    try {
        const response = await fetch('http://localhost:3001/health');
        if (response.ok) {
            const data = await response.json();
            console.log(`   ✅ Ingest API is running: ${data.service || 'prmx-offchain-oracle-service'}`);
        } else {
            console.log('   ❌ Ingest API returned non-OK status');
        }
    } catch (error) {
        console.log('   ❌ Ingest API not reachable at http://localhost:3001');
        console.log('      Start it with: cd offchain-oracle-service && npm start');
    }
    
    // Check Ingest API V3 stats
    console.log('\n2️⃣  Checking V3 Ingest API stats...');
    try {
        const response = await fetch('http://localhost:3001/ingest/stats');
        if (response.ok) {
            const data = await response.json();
            console.log(`   📊 Observations stored: ${data.data?.observations_count || 0}`);
            console.log(`   📸 Snapshots stored: ${data.data?.snapshots_count || 0}`);
        }
    } catch (error) {
        console.log('   ⚠️  Could not fetch V3 stats');
    }
    
    // Check on-chain policy states
    console.log('\n3️⃣  Checking on-chain oracle states...');
    const currentBlock = (await api.query.system.number()).toNumber();
    let snapshotsFound = 0;
    let activePolicies = 0;
    
    for (let i = 1; i <= 10; i++) {
        const state = await api.query.prmxOracleV3.oracleStates(i);
        if (state.isSome) {
            activePolicies++;
            const data = state.unwrap();
            const lastSnap = parseInt(String(data.lastSnapshotBlock.toHuman()).replace(/,/g, ''));
            if (lastSnap > 0) {
                snapshotsFound++;
                const blocksAgo = currentBlock - lastSnap;
                console.log(`   Policy #${i}: Last snapshot at block #${lastSnap} (${blocksAgo} blocks ago)`);
            }
        }
    }
    
    console.log(`\n   📋 Active policies: ${activePolicies}`);
    console.log(`   📸 Policies with snapshots: ${snapshotsFound}`);
    
    // Check observations per policy in Ingest API
    console.log('\n4️⃣  Checking observations per policy in Ingest API...');
    let policiesWithObs = 0;
    for (let i = 1; i <= 10; i++) {
        try {
            const response = await fetch(`http://localhost:3001/ingest/observations/${i}`);
            if (response.ok) {
                const data = await response.json();
                if (data.count > 0) {
                    policiesWithObs++;
                    console.log(`   Policy #${i}: ${data.count} observations`);
                }
            }
        } catch (e) {
            // Skip
        }
    }
    if (policiesWithObs === 0) {
        console.log('   No observations stored for policies #1-#10');
    }
    
    if (snapshotsFound === 0) {
        console.log('\n⚠️  No on-chain snapshots found for any policies.');
        console.log('   This likely means V3 oracle secrets are not provisioned.');
        console.log('');
        console.log('   To provision secrets, run:');
        console.log('');
        console.log('     node scripts/set-v3-oracle-secrets.mjs \\');
        console.log('       --accuweather-key YOUR_ACCUWEATHER_API_KEY \\');
        console.log('       --hmac-secret YOUR_32_CHAR_SECRET');
        console.log('');
        console.log('   The OCW runs every ~60 seconds after secrets are set.');
    } else {
        console.log(`\n✅ Oracle is working! ${snapshotsFound}/${activePolicies} policies have on-chain snapshots.`);
    }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
    const { policyIds, intervalSecs, once, eventsOnly, checkSecrets } = parseArgs();
    
    console.log('═'.repeat(60));
    console.log('PRMX V3 Policy Monitor');
    console.log('═'.repeat(60));
    console.log(`Connecting to ${WS_URL}...`);
    
    const wsProvider = new WsProvider(WS_URL);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    const chain = await api.rpc.system.chain();
    console.log(`Connected to: ${chain.toString()}`);
    console.log(`Monitoring policies: ${policyIds.join(', ')}`);
    console.log('');
    
    // Check secrets mode
    if (checkSecrets) {
        await checkOracleSecrets(api);
        await api.disconnect();
        process.exit(0);
    }
    
    if (once) {
        // Single run mode
        await displayPolicyStatus(api, policyIds);
        await api.disconnect();
        process.exit(0);
    }
    
    // Subscribe to events
    await subscribeToEvents(api, policyIds, eventsOnly);
    
    if (eventsOnly) {
        console.log('🎧 Events-only mode. Watching for oracle events...');
        console.log('   (Press Ctrl+C to exit)\n');
    } else {
        // Initial display
        await displayPolicyStatus(api, policyIds);
        
        // Continuous monitoring
        const interval = setInterval(async () => {
            try {
                await displayPolicyStatus(api, policyIds);
            } catch (error) {
                console.error('Error fetching status:', error.message);
            }
        }, intervalSecs * 1000);
        
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            clearInterval(interval);
            console.log('\n\n👋 Shutting down monitor...');
            await printEventLog();
            await api.disconnect();
            process.exit(0);
        });
        
        return;
    }
    
    // Handle graceful shutdown for events-only mode
    process.on('SIGINT', async () => {
        console.log('\n\n👋 Shutting down monitor...');
        printEventLog();
        await api.disconnect();
        process.exit(0);
    });
}

function printEventLog() {
    if (eventLog.length > 0) {
        console.log('\n📜 Event Log:');
        console.log('─'.repeat(60));
        eventLog.slice().reverse().forEach(entry => console.log(entry));
    }
}

main().catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
});

