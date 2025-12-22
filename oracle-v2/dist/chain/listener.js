/**
 * Chain event listener for V2PolicyCreated events
 */
import { ApiPromise, WsProvider } from '@polkadot/api';
import { config } from '../config.js';
import { getMonitors, getBuckets, makeMonitorId, checkChainRestart } from '../db/mongo.js';
import { fetchHistorical24Hours } from '../accuweather/fetcher.js';
let api = null;
/**
 * Connect to the PRMX chain and check for chain restart
 */
export async function connectToChain() {
    if (api)
        return api;
    const provider = new WsProvider(config.wsUrl);
    api = await ApiPromise.create({ provider });
    const chainName = await api.rpc.system.chain();
    console.log(`✅ Connected to chain: ${chainName}`);
    // Get current chain state for restart detection
    const genesisHash = api.genesisHash.toHex();
    const header = await api.rpc.chain.getHeader();
    const currentBlock = header.number.toNumber();
    // Check if chain was restarted (genesis hash changed or block number reset)
    const wasRestarted = await checkChainRestart(genesisHash, currentBlock);
    if (wasRestarted) {
        console.log('🔄 Chain restart detected - database has been cleared');
    }
    return api;
}
/**
 * Subscribe to V2 policy events (created, settled)
 */
export async function subscribeToV2PolicyCreated(onPolicyCreated) {
    const chainApi = await connectToChain();
    chainApi.query.system.events((events) => {
        events.forEach(({ event }) => {
            // Handle V2PolicyCreated
            if (event.section === 'prmxPolicy' && event.method === 'V2PolicyCreated') {
                const [policyId, marketId, coverageStart, coverageEnd, strikeMm, lat, lon] = event.data;
                console.log(`📋 V2PolicyCreated event detected: policy_id=${policyId}`);
                onPolicyCreated({
                    policy_id: Number(policyId.toString()),
                    market_id: Number(marketId.toString()),
                    coverage_start: Number(coverageStart.toString()),
                    coverage_end: Number(coverageEnd.toString()),
                    strike_mm: Number(strikeMm.toString()),
                    lat: Number(lat.toString()),
                    lon: Number(lon.toString()),
                }).catch(err => console.error('Error handling V2PolicyCreated:', err));
            }
            // Handle V2ReportAccepted (settlement from oracle pallet)
            // Event fields: policy_id, outcome, cumulative_mm, evidence_hash
            if (event.section === 'prmxOracle' && event.method === 'V2ReportAccepted') {
                const [policyId, outcome, cumulativeMm, evidenceHash] = event.data;
                const outcomeStr = outcome.toString();
                console.log(`📊 V2ReportAccepted event detected: policy_id=${policyId}, outcome=${outcomeStr}`);
                handleV2Settlement(Number(policyId.toString()), outcomeStr, Number(cumulativeMm.toString()), evidenceHash.toHex()).catch(err => console.error('Error handling V2ReportAccepted:', err));
            }
            // Handle V2PolicySettled (from policy pallet)
            // Event fields: policy_id, outcome, cumulative_mm, evidence_hash
            if (event.section === 'prmxPolicy' && event.method === 'V2PolicySettled') {
                const [policyId, outcome, cumulativeMm, evidenceHash] = event.data;
                const outcomeStr = outcome.toString();
                console.log(`✅ V2PolicySettled event detected: policy_id=${policyId}, outcome=${outcomeStr}`);
                handleV2Settlement(Number(policyId.toString()), outcomeStr, Number(cumulativeMm.toString()), evidenceHash.toHex()).catch(err => console.error('Error handling V2PolicySettled:', err));
            }
        });
    });
    console.log('📡 Subscribed to V2 policy events (created, settled)');
}
/**
 * Handle V2 settlement - update monitor state in MongoDB
 */
async function handleV2Settlement(policyId, outcome, cumulativeMm, evidenceHash) {
    const monitors = getMonitors();
    // Find monitor for this policy (assume Manila market for V2)
    const monitorId = makeMonitorId(0, policyId);
    const monitor = await monitors.findOne({ _id: monitorId });
    if (!monitor) {
        console.log(`⚠️ No monitor found for policy ${policyId}`);
        return;
    }
    // Determine new state based on outcome
    let newState;
    if (outcome.includes('Triggered')) {
        newState = 'triggered';
    }
    else if (outcome.includes('Matured') || outcome.includes('NoEvent')) {
        newState = 'matured';
    }
    else {
        newState = 'reported';
    }
    // Update monitor in MongoDB
    await monitors.updateOne({ _id: monitorId }, {
        $set: {
            state: newState,
            cumulative_mm: cumulativeMm,
            evidence_hash: evidenceHash,
            updated_at: new Date(),
        }
    });
    console.log(`📝 Updated monitor ${monitorId}: state=${newState}, cumulative=${cumulativeMm / 10}mm`);
}
/**
 * Handle V2PolicyCreated event - create monitor document and fetch 24h historical data
 */
export async function handleV2PolicyCreated(policy) {
    const monitors = getMonitors();
    const buckets = getBuckets();
    const monitorId = makeMonitorId(policy.market_id, policy.policy_id);
    // Check if monitor already exists
    const existing = await monitors.findOne({ _id: monitorId });
    if (existing) {
        console.log(`⚠️ Monitor already exists: ${monitorId}`);
        return;
    }
    const now = new Date();
    const locationKey = config.manilaLocationKey; // Manila hardcoded for V2
    const monitor = {
        _id: monitorId,
        market_id: policy.market_id,
        policy_id: policy.policy_id,
        coverage_start: policy.coverage_start,
        coverage_end: policy.coverage_end,
        strike_mm: policy.strike_mm,
        lat: policy.lat,
        lon: policy.lon,
        state: 'monitoring',
        cumulative_mm: 0,
        last_fetch_at: 0,
        location_key: locationKey,
        created_at: now,
        updated_at: now,
    };
    await monitors.insertOne(monitor);
    console.log(`✅ Created monitor: ${monitorId}`);
    // Immediately fetch 24h historical data for context
    console.log(`🌐 Fetching 24h historical data for new policy ${policy.policy_id}...`);
    try {
        const records = await fetchHistorical24Hours(locationKey);
        console.log(`   ✅ Fetched ${records.length} hourly records`);
        let bucketsCreated = 0;
        let cumulativeMm = 0;
        for (const record of records) {
            const recordTime = new Date(record.dateTime).getTime() / 1000;
            // Only store buckets within the coverage period
            if (recordTime >= policy.coverage_start && recordTime <= policy.coverage_end) {
                const hourUtc = normalizeToHour(record.dateTime);
                const bucketId = `${monitorId}:${hourUtc.replace(/[-:TZ]/g, '').slice(0, 10)}`;
                const mmScaled = Math.round(record.precipitationMm * 10);
                await buckets.updateOne({ _id: bucketId }, {
                    $set: {
                        monitor_id: monitorId,
                        hour_utc: hourUtc,
                        mm: mmScaled,
                        raw_data: record.rawData,
                        fetched_at: new Date(),
                        backfilled: false,
                    }
                }, { upsert: true });
                bucketsCreated++;
                cumulativeMm += mmScaled;
            }
        }
        // Update monitor with initial cumulative rainfall
        if (bucketsCreated > 0) {
            await monitors.updateOne({ _id: monitorId }, {
                $set: {
                    cumulative_mm: cumulativeMm,
                    last_fetch_at: Math.floor(Date.now() / 1000),
                    updated_at: new Date(),
                }
            });
            console.log(`   📊 Pre-populated ${bucketsCreated} buckets, cumulative=${cumulativeMm / 10}mm`);
        }
        else {
            console.log(`   📊 No buckets in coverage period yet`);
        }
    }
    catch (error) {
        console.error(`   ⚠️ Failed to fetch historical data:`, error);
        // Continue - the scheduler will fetch data on the next poll
    }
}
/**
 * Normalize datetime to hour start (ISO format)
 */
function normalizeToHour(dateTime) {
    const d = new Date(dateTime);
    d.setMinutes(0, 0, 0);
    return d.toISOString().slice(0, 13) + ':00:00Z';
}
/**
 * Get API instance
 */
export function getApi() {
    if (!api)
        throw new Error('Chain not connected');
    return api;
}
/**
 * Disconnect from chain
 */
export async function disconnectFromChain() {
    if (api) {
        await api.disconnect();
        api = null;
        console.log('Disconnected from chain');
    }
}
