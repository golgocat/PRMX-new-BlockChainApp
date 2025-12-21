/**
 * Chain event listener for V2PolicyCreated events
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import type { Vec } from '@polkadot/types';
import type { EventRecord } from '@polkadot/types/interfaces';
import { config } from '../config.js';
import { getMonitors, makeMonitorId, Monitor, checkChainRestart } from '../db/mongo.js';

let api: ApiPromise | null = null;

/**
 * Connect to the PRMX chain and check for chain restart
 */
export async function connectToChain(): Promise<ApiPromise> {
  if (api) return api;
  
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
export async function subscribeToV2PolicyCreated(
  onPolicyCreated: (policy: {
    policy_id: number;
    market_id: number;
    coverage_start: number;
    coverage_end: number;
    strike_mm: number;
    lat: number;
    lon: number;
  }) => Promise<void>
): Promise<void> {
  const chainApi = await connectToChain();
  
  chainApi.query.system.events((events: Vec<EventRecord>) => {
    events.forEach(({ event }: EventRecord) => {
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
        
        handleV2Settlement(
          Number(policyId.toString()),
          outcomeStr,
          Number(cumulativeMm.toString()),
          evidenceHash.toHex()
        ).catch(err => console.error('Error handling V2ReportAccepted:', err));
      }
      
      // Handle V2PolicySettled (from policy pallet)
      // Event fields: policy_id, outcome, cumulative_mm, evidence_hash
      if (event.section === 'prmxPolicy' && event.method === 'V2PolicySettled') {
        const [policyId, outcome, cumulativeMm, evidenceHash] = event.data;
        const outcomeStr = outcome.toString();
        
        console.log(`✅ V2PolicySettled event detected: policy_id=${policyId}, outcome=${outcomeStr}`);
        
        handleV2Settlement(
          Number(policyId.toString()),
          outcomeStr,
          Number(cumulativeMm.toString()),
          evidenceHash.toHex()
        ).catch(err => console.error('Error handling V2PolicySettled:', err));
      }
    });
  });
  
  console.log('📡 Subscribed to V2 policy events (created, settled)');
}

/**
 * Handle V2 settlement - update monitor state in MongoDB
 */
async function handleV2Settlement(
  policyId: number,
  outcome: string,
  cumulativeMm: number,
  evidenceHash: string
): Promise<void> {
  const monitors = getMonitors();
  
  // Find monitor for this policy (assume Manila market for V2)
  const monitorId = makeMonitorId(0, policyId);
  const monitor = await monitors.findOne({ _id: monitorId });
  
  if (!monitor) {
    console.log(`⚠️ No monitor found for policy ${policyId}`);
    return;
  }
  
  // Determine new state based on outcome
  let newState: 'triggered' | 'matured' | 'reported';
  if (outcome.includes('Triggered')) {
    newState = 'triggered';
  } else if (outcome.includes('Matured') || outcome.includes('NoEvent')) {
    newState = 'matured';
  } else {
    newState = 'reported';
  }
  
  // Update monitor in MongoDB
  await monitors.updateOne(
    { _id: monitorId },
    {
      $set: {
        state: newState,
        cumulative_mm: cumulativeMm,
        evidence_hash: evidenceHash,
        updated_at: new Date(),
      }
    }
  );
  
  console.log(`📝 Updated monitor ${monitorId}: state=${newState}, cumulative=${cumulativeMm/10}mm`);
}

/**
 * Handle V2PolicyCreated event - create monitor document
 */
export async function handleV2PolicyCreated(policy: {
  policy_id: number;
  market_id: number;
  coverage_start: number;
  coverage_end: number;
  strike_mm: number;
  lat: number;
  lon: number;
}): Promise<void> {
  const monitors = getMonitors();
  const monitorId = makeMonitorId(policy.market_id, policy.policy_id);
  
  // Check if monitor already exists
  const existing = await monitors.findOne({ _id: monitorId });
  if (existing) {
    console.log(`⚠️ Monitor already exists: ${monitorId}`);
    return;
  }
  
  const now = new Date();
  const monitor: Monitor = {
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
    location_key: config.manilaLocationKey, // Manila hardcoded for V2
    created_at: now,
    updated_at: now,
  };
  
  await monitors.insertOne(monitor);
  console.log(`✅ Created monitor: ${monitorId}`);
}

/**
 * Get API instance
 */
export function getApi(): ApiPromise {
  if (!api) throw new Error('Chain not connected');
  return api;
}

/**
 * Disconnect from chain
 */
export async function disconnectFromChain(): Promise<void> {
  if (api) {
    await api.disconnect();
    api = null;
    console.log('Disconnected from chain');
  }
}

