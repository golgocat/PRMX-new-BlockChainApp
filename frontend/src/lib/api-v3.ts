/**
 * PRMX V3 P2P Climate Risk Market API
 * 
 * Blockchain API for V3 underwrite requests, policies, and LP management.
 */

import { ApiPromise } from '@polkadot/api';
import { KeyringPair } from '@polkadot/keyring/types';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { ISubmittableResult, IEventRecord } from '@polkadot/types/types';
import { getApi } from './api';
import type {
  V3Location,
  V3Request,
  V3Policy,
  V3OracleState,
  V3LpHolding,
  V3CreateRequestParams,
  V3EventSpec,
  V3RequestStatus,
  V3PolicyStatus,
  V3AggState,
} from '@/types/v3';

// =============================================================================
// Constants
// =============================================================================

export const V3_PAYOUT_PER_SHARE = BigInt(100_000_000); // $100 with 6 decimals

// =============================================================================
// Helper: Sign and wait for transaction
// =============================================================================

/**
 * Sign a transaction and wait for it to be finalized
 * Returns the events from the finalized block
 */
async function signAndWaitV3(
  tx: SubmittableExtrinsic<'promise', ISubmittableResult>,
  signer: KeyringPair
): Promise<IEventRecord<any>[]> {
  const api = await getApi();
  
  return new Promise((resolve, reject) => {
    tx.signAndSend(signer, async (result) => {
      const { status, events, dispatchError } = result;
      
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
        const blockHash = status.asFinalized;
        
        try {
          // Query events directly from the finalized block to avoid parsing issues
          // when the block contains unsigned extrinsics (e.g., from OCW)
          const allBlockEvents = await api.query.system.events.at(blockHash);
          
          // Find our extrinsic index by looking for prmxMarketV3 or prmxPolicyV3 events
          // (since txIndex from callback may be undefined due to block parsing issues)
          let targetPhaseIndex: number | null = null;
          for (const record of allBlockEvents as any) {
            const { phase, event } = record;
            if (phase.isApplyExtrinsic && 
                (event.section === 'prmxMarketV3' || event.section === 'prmxPolicyV3')) {
              targetPhaseIndex = phase.asApplyExtrinsic.toNumber();
              break;
            }
          }
          
          // Filter events for our extrinsic (by detected phase index)
          const txEvents = targetPhaseIndex !== null 
            ? (allBlockEvents as any).filter((record: any) => {
                const { phase } = record;
                return phase.isApplyExtrinsic && phase.asApplyExtrinsic.toNumber() === targetPhaseIndex;
              })
            : events; // Fallback to callback events if we can't find our pallet events
          
          resolve(txEvents);
        } catch {
          // Fallback to callback events if direct query fails
          resolve(events);
        }
      }
    });
  });
}

// =============================================================================
// Location Registry
// =============================================================================

/**
 * Get all locations from the V3 location registry
 */
export async function getV3Locations(): Promise<V3Location[]> {
  const api = await getApi();
  const entries = await api.query.prmxOracleV3.locationRegistry.entries();
  
  const locations: V3Location[] = [];
  
  for (const [key, value] of entries) {
    if (value.isSome) {
      const loc = value.unwrap();
      locations.push({
        id: loc.locationId.toNumber(),
        name: decodeString(loc.name),
        accuweatherKey: decodeString(loc.accuweatherKey),
        latitude: loc.latitude.toNumber(),
        longitude: loc.longitude.toNumber(),
        active: loc.active.isTrue,
      });
    }
  }
  
  return locations.filter(l => l.active);
}

/**
 * Get a single location by ID
 */
export async function getV3Location(locationId: number): Promise<V3Location | null> {
  const api = await getApi();
  const result = await api.query.prmxOracleV3.locationRegistry(locationId);
  
  if (result.isNone) return null;
  
  const loc = result.unwrap();
  return {
    id: loc.locationId.toNumber(),
    name: decodeString(loc.name),
    accuweatherKey: decodeString(loc.accuweatherKey),
    latitude: loc.latitude.toNumber(),
    longitude: loc.longitude.toNumber(),
    active: loc.active.isTrue,
  };
}

// =============================================================================
// Underwrite Requests
// =============================================================================

/**
 * Get all underwrite requests
 */
export async function getV3Requests(): Promise<V3Request[]> {
  const api = await getApi();
  const entries = await api.query.prmxMarketV3.underwriteRequests.entries();
  const locations = await getV3Locations();
  const locationMap = new Map(locations.map(l => [l.id, l]));
  
  const requests: V3Request[] = [];
  
  for (const [key, value] of entries) {
    if (value.isSome) {
      const req = value.unwrap();
      const request = parseRequest(req, locationMap);
      requests.push(request);
    }
  }
  
  // Sort by created_at descending
  return requests.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Get open requests (Pending or PartiallyFilled)
 */
export async function getV3OpenRequests(): Promise<V3Request[]> {
  const requests = await getV3Requests();
  const now = Math.floor(Date.now() / 1000);
  
  return requests.filter(r => 
    (r.status === 'Pending' || r.status === 'PartiallyFilled') &&
    r.expiresAt > now
  );
}

/**
 * Get a single request by ID
 */
export async function getV3Request(requestId: number): Promise<V3Request | null> {
  const api = await getApi();
  const result = await api.query.prmxMarketV3.underwriteRequests(requestId);
  
  if (result.isNone) return null;
  
  const locations = await getV3Locations();
  const locationMap = new Map(locations.map(l => [l.id, l]));
  
  return parseRequest(result.unwrap(), locationMap);
}

/**
 * Get requests by requester address
 */
export async function getV3RequestsByRequester(address: string): Promise<V3Request[]> {
  const requests = await getV3Requests();
  return requests.filter(r => r.requester === address);
}

/**
 * Create a new underwrite request
 */
export async function createV3Request(
  keypair: KeyringPair,
  params: V3CreateRequestParams
): Promise<number> {
  const api = await getApi();
  
  const eventSpec = {
    event_type: { [params.eventSpec.eventType]: null },
    threshold: {
      value: params.eventSpec.threshold.value,
      unit: { [params.eventSpec.threshold.unit]: null },
    },
    early_trigger: params.eventSpec.earlyTrigger,
  };
  
  const tx = api.tx.prmxMarketV3.createUnderwriteRequest(
    params.locationId,
    eventSpec,
    params.totalShares.toString(),
    params.premiumPerShare.toString(),
    params.coverageStart,
    params.coverageEnd,
    params.expiresAt
  );
  
  const events = await signAndWaitV3(tx, keypair);
  
  // Find RequestCreated event
  for (const { event } of events) {
    if (event.section === 'prmxMarketV3' && event.method === 'RequestCreated') {
      return event.data[0].toNumber();
    }
  }
  
  throw new Error('Failed to get request ID from chain event');
}

/**
 * Accept shares from an underwrite request
 */
export async function acceptV3Request(
  keypair: KeyringPair,
  requestId: number,
  shares: number
): Promise<void> {
  const api = await getApi();
  
  const tx = api.tx.prmxMarketV3.acceptUnderwriteRequest(
    requestId,
    shares.toString()
  );
  
  await signAndWaitV3(tx, keypair);
}

/**
 * Cancel an underwrite request (requester only)
 */
export async function cancelV3Request(
  keypair: KeyringPair,
  requestId: number
): Promise<bigint> {
  const api = await getApi();
  
  const tx = api.tx.prmxMarketV3.cancelUnderwriteRequest(requestId);
  
  const events = await signAndWaitV3(tx, keypair);
  
  // Find RequestCancelled event to get refund amount
  for (const { event } of events) {
    if (event.section === 'prmxMarketV3' && event.method === 'RequestCancelled') {
      return BigInt(event.data[2].toString());
    }
  }
  
  return BigInt(0);
}

// =============================================================================
// V3 Policies
// =============================================================================

/**
 * Get all V3 policies
 */
export async function getV3Policies(): Promise<V3Policy[]> {
  const api = await getApi();
  const entries = await api.query.prmxPolicyV3.policies.entries();
  const locations = await getV3Locations();
  const locationMap = new Map(locations.map(l => [l.id, l]));
  
  const policies: V3Policy[] = [];
  
  for (const [key, value] of entries) {
    if (value.isSome) {
      const policy = value.unwrap();
      policies.push(parsePolicy(policy, locationMap));
    }
  }
  
  return policies.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Get a single V3 policy by ID
 */
export async function getV3Policy(policyId: number): Promise<V3Policy | null> {
  const api = await getApi();
  const result = await api.query.prmxPolicyV3.policies(policyId);
  
  if (result.isNone) return null;
  
  const locations = await getV3Locations();
  const locationMap = new Map(locations.map(l => [l.id, l]));
  
  return parsePolicy(result.unwrap(), locationMap);
}

/**
 * Get policies by holder address
 */
export async function getV3PoliciesByHolder(address: string): Promise<V3Policy[]> {
  const policies = await getV3Policies();
  return policies.filter(p => p.holder === address);
}

// =============================================================================
// Oracle State
// =============================================================================

/**
 * Get oracle state for a policy
 */
export async function getV3OracleState(policyId: number): Promise<V3OracleState | null> {
  const api = await getApi();
  const result = await api.query.prmxOracleV3.oracleStates(policyId);
  
  if (result.isNone) return null;
  
  const state = result.unwrap();
  const human = state.toHuman ? state.toHuman() : state;
  
  return {
    policyId,
    eventSpec: parseEventSpecHuman(human.eventSpec || human.event_spec),
    aggState: parseAggState(human.aggState || human.agg_state),
    observedUntil: parseInt((human.observedUntil || human.observed_until || '0').toString().replace(/,/g, '')),
    commitment: state.commitment.toHex(),
    status: parseStatusString(human.status) as V3PolicyStatus,
  };
}

// =============================================================================
// LP Holdings
// =============================================================================

/**
 * Get LP holdings for an address across all V3 policies
 */
export async function getV3LpHoldings(address: string): Promise<V3LpHolding[]> {
  const api = await getApi();
  const policies = await getV3Policies();
  const holdings: V3LpHolding[] = [];
  
  for (const policy of policies) {
    const result = await api.query.prmxHoldings.holdingsStorage(policy.id, address);
    if (result && !result.isEmpty) {
      const lpShares = result.lpShares.toNumber();
      if (lpShares > 0) {
        // Get total LP shares for percentage calculation
        const totalLp = await api.query.prmxHoldings.totalLpShares(policy.id);
        const totalShares = totalLp.toNumber();
        
        holdings.push({
          policyId: policy.id,
          policy,
          holder: address,
          lpShares,
          percentageOwned: totalShares > 0 ? (lpShares / totalShares) * 100 : 0,
        });
      }
    }
  }
  
  return holdings;
}

/**
 * Get all LP holders for a V3 policy
 */
export async function getV3PolicyLpHolders(policyId: number): Promise<V3LpHolding[]> {
  const api = await getApi();
  const entries = await api.query.prmxHoldings.holdingsStorage.entries(policyId);
  const totalLp = await api.query.prmxHoldings.totalLpShares(policyId);
  const totalShares = totalLp.toNumber();
  
  const holders: V3LpHolding[] = [];
  
  for (const [key, value] of entries) {
    if (value && !value.isEmpty) {
      const lpShares = value.lpShares.toNumber();
      if (lpShares > 0) {
        // Extract holder address from key
        const keyHuman = key.args[1].toString();
        
        holders.push({
          policyId,
          holder: keyHuman,
          lpShares,
          percentageOwned: totalShares > 0 ? (lpShares / totalShares) * 100 : 0,
        });
      }
    }
  }
  
  return holders.sort((a, b) => b.lpShares - a.lpShares);
}

// =============================================================================
// Helper Functions
// =============================================================================

function decodeString(value: any): string {
  if (typeof value === 'string') return value;
  if (value.toUtf8) return value.toUtf8();
  if (value.toString) {
    const str = value.toString();
    // Handle hex-encoded strings
    if (str.startsWith('0x')) {
      try {
        const bytes = Buffer.from(str.slice(2), 'hex');
        return bytes.toString('utf8').replace(/\0/g, '');
      } catch {
        return str;
      }
    }
    return str;
  }
  return '';
}

function parseRequest(req: any, locationMap: Map<number, V3Location>): V3Request {
  // Convert to human-readable format first - this is the proper polkadot.js way
  const human = req.toHuman ? req.toHuman() : req;
  
  // Debug: log the raw request structure
  console.log('[V3 DEBUG] Raw request (human):', JSON.stringify(human, null, 2));
  
  // Get locationId - handle both formats
  const locationId = human.locationId 
    ? parseInt(human.locationId.replace(/,/g, '')) 
    : (req.locationId || req.location_id).toNumber();
  
  // Parse event spec from human-readable format
  const eventSpecHuman = human.eventSpec || human.event_spec;
  
  return {
    id: human.requestId 
      ? parseInt(human.requestId.replace(/,/g, '')) 
      : (req.requestId || req.request_id).toNumber(),
    requester: human.requester || req.requester.toString(),
    locationId,
    location: locationMap.get(locationId),
    eventSpec: parseEventSpecHuman(eventSpecHuman),
    totalShares: parseInt((human.totalShares || human.total_shares || '0').replace(/,/g, '')),
    filledShares: parseInt((human.filledShares || human.filled_shares || '0').replace(/,/g, '')),
    premiumPerShare: BigInt((human.premiumPerShare || human.premium_per_share || '0').replace(/,/g, '')),
    payoutPerShare: BigInt((human.payoutPerShare || human.payout_per_share || '0').replace(/,/g, '')),
    coverageStart: parseInt((human.coverageStart || human.coverage_start || '0').replace(/,/g, '')),
    coverageEnd: parseInt((human.coverageEnd || human.coverage_end || '0').replace(/,/g, '')),
    expiresAt: parseInt((human.expiresAt || human.expires_at || '0').replace(/,/g, '')),
    status: parseStatusString(human.status) as V3RequestStatus,
    createdAt: parseInt((human.createdAt || human.created_at || '0').replace(/,/g, '')),
  };
}

// Parse event spec from human-readable polkadot.js format
function parseEventSpecHuman(spec: any): V3EventSpec {
  if (!spec) {
    return {
      eventType: 'PrecipSumGte',
      threshold: { value: 0, unit: 'MmX1000' },
      earlyTrigger: false,
    };
  }
  
  console.log('[V3 DEBUG] Event spec (human):', JSON.stringify(spec, null, 2));
  
  // Extract event type - polkadot.js returns enums as { VariantName: null } or just string
  let eventType: string;
  const eventTypeObj = spec.eventType || spec.event_type;
  if (typeof eventTypeObj === 'string') {
    eventType = eventTypeObj;
  } else if (eventTypeObj && typeof eventTypeObj === 'object') {
    // Get the key of the enum variant
    eventType = Object.keys(eventTypeObj)[0] || 'Unknown';
  } else {
    eventType = 'Unknown';
  }
  
  // Extract threshold
  const thresholdObj = spec.threshold;
  let thresholdValue = 0;
  let thresholdUnit = 'MmX1000';
  
  if (thresholdObj) {
    // Value might be a string with commas like "50,000"
    if (thresholdObj.value !== undefined) {
      const valueStr = String(thresholdObj.value).replace(/,/g, '');
      thresholdValue = parseInt(valueStr) || 0;
    }
    
    // Unit is also an enum
    const unitObj = thresholdObj.unit;
    if (typeof unitObj === 'string') {
      thresholdUnit = unitObj;
    } else if (unitObj && typeof unitObj === 'object') {
      thresholdUnit = Object.keys(unitObj)[0] || 'MmX1000';
    }
  }
  
  // Normalize to our expected format
  const normalizedEventType = normalizeEventType(eventType);
  const normalizedUnit = normalizeThresholdUnit(thresholdUnit);
  
  console.log('[V3 DEBUG] Parsed:', eventType, '->', normalizedEventType, '|', thresholdValue, thresholdUnit, '->', normalizedUnit);
  
  return {
    eventType: normalizedEventType as V3EventSpec['eventType'],
    threshold: {
      value: thresholdValue,
      unit: normalizedUnit as V3EventSpec['threshold']['unit'],
    },
    earlyTrigger: spec.earlyTrigger === true || spec.early_trigger === true || spec.earlyTrigger === 'true',
  };
}

function parsePolicy(policy: any, locationMap: Map<number, V3Location>): V3Policy {
  // Convert to human-readable format
  const human = policy.toHuman ? policy.toHuman() : policy;
  
  const locationId = human.locationId 
    ? parseInt(human.locationId.replace(/,/g, '')) 
    : (policy.locationId || policy.location_id).toNumber();
  
  const eventSpecHuman = human.eventSpec || human.event_spec;
  const totalShares = parseInt((human.totalShares || human.total_shares || '0').toString().replace(/,/g, ''));
  
  // The chain stores premium_per_share and payout_per_share, we calculate totals
  const premiumPerShareRaw = human.premiumPerShare || human.premium_per_share || '0';
  const premiumPerShare = BigInt(premiumPerShareRaw.toString().replace(/,/g, ''));
  const premiumPaid = BigInt(totalShares) * premiumPerShare;
  
  // maxPayout is calculated: totalShares * payoutPerShare ($100 = 100_000_000 with 6 decimals)
  const payoutPerShare = V3_PAYOUT_PER_SHARE; // $100
  const maxPayout = BigInt(totalShares) * payoutPerShare;
  
  return {
    id: human.policyId 
      ? parseInt(human.policyId.replace(/,/g, '')) 
      : (policy.policyId || policy.policy_id).toNumber(),
    holder: human.holder || policy.holder.toString(),
    locationId,
    location: locationMap.get(locationId),
    eventSpec: parseEventSpecHuman(eventSpecHuman),
    totalShares,
    premiumPerShare,
    premiumPaid,
    maxPayout,
    coverageStart: parseInt((human.coverageStart || human.coverage_start || '0').toString().replace(/,/g, '')),
    coverageEnd: parseInt((human.coverageEnd || human.coverage_end || '0').toString().replace(/,/g, '')),
    status: parseStatusString(human.status) as V3PolicyStatus,
    createdAt: parseInt((human.createdAt || human.created_at || '0').toString().replace(/,/g, '')),
  };
}

// Normalize event type from various formats to our standard PascalCase
function normalizeEventType(raw: string): string {
  const mapping: Record<string, string> = {
    // snake_case variants
    'precip_sum_gte': 'PrecipSumGte',
    'precip_1h_gte': 'Precip1hGte',
    'temp_max_gte': 'TempMaxGte',
    'temp_min_lte': 'TempMinLte',
    'wind_gust_max_gte': 'WindGustMaxGte',
    'precip_type_occurred': 'PrecipTypeOccurred',
    // Already PascalCase
    'PrecipSumGte': 'PrecipSumGte',
    'Precip1hGte': 'Precip1hGte',
    'TempMaxGte': 'TempMaxGte',
    'TempMinLte': 'TempMinLte',
    'WindGustMaxGte': 'WindGustMaxGte',
    'PrecipTypeOccurred': 'PrecipTypeOccurred',
  };
  
  return mapping[raw] || raw;
}

// Normalize threshold unit from various formats
function normalizeThresholdUnit(raw: string): string {
  const mapping: Record<string, string> = {
    // snake_case variants
    'mm_x1000': 'MmX1000',
    'celsius_x1000': 'CelsiusX1000',
    'mps_x1000': 'MpsX1000',
    'precip_type_mask': 'PrecipTypeMask',
    // Already PascalCase
    'MmX1000': 'MmX1000',
    'CelsiusX1000': 'CelsiusX1000',
    'MpsX1000': 'MpsX1000',
    'PrecipTypeMask': 'PrecipTypeMask',
  };
  
  return mapping[raw] || raw;
}

function parseAggState(aggState: any): V3AggState {
  if (!aggState) {
    return { type: 'PrecipSum', sumMmX1000: 0 };
  }
  
  // Handle human-readable format: { TempMax: { max_c_x1000: "0" } }
  const stateType = Object.keys(aggState)[0];
  const stateValue = aggState[stateType] || {};
  
  // Helper to parse numeric values that may have commas
  const parseNum = (val: any): number => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') return parseInt(val.replace(/,/g, '')) || 0;
    return 0;
  };
  
  switch (stateType) {
    case 'PrecipSum':
      return { 
        type: 'PrecipSum', 
        sumMmX1000: parseNum(stateValue.sum_mm_x1000 ?? stateValue.sumMmX1000 ?? stateValue)
      };
    case 'Precip1hMax':
      return { 
        type: 'Precip1hMax', 
        max1hMmX1000: parseNum(stateValue.max_1h_mm_x1000 ?? stateValue.max1hMmX1000 ?? stateValue)
      };
    case 'TempMax':
      return { 
        type: 'TempMax', 
        maxCX1000: parseNum(stateValue.max_c_x1000 ?? stateValue.maxCX1000 ?? stateValue)
      };
    case 'TempMin':
      return { 
        type: 'TempMin', 
        minCX1000: parseNum(stateValue.min_c_x1000 ?? stateValue.minCX1000 ?? stateValue)
      };
    case 'WindGustMax':
      return { 
        type: 'WindGustMax', 
        maxMpsX1000: parseNum(stateValue.max_mps_x1000 ?? stateValue.maxMpsX1000 ?? stateValue)
      };
    case 'PrecipTypeOccurred':
      return { 
        type: 'PrecipTypeOccurred', 
        mask: parseNum(stateValue.mask ?? stateValue)
      };
    default:
      console.warn('Unknown aggState type:', stateType, aggState);
      return { type: 'PrecipSum', sumMmX1000: 0 };
  }
}

function parseStatusString(status: string): string {
  // Handle both camelCase and snake_case status strings
  const normalized = status.toLowerCase().replace(/_/g, '');
  
  if (normalized.includes('pending')) return 'Pending';
  if (normalized.includes('partiallyfilled')) return 'PartiallyFilled';
  if (normalized.includes('fullyfilled')) return 'FullyFilled';
  if (normalized.includes('cancelled')) return 'Cancelled';
  if (normalized.includes('expired')) return 'Expired';
  if (normalized.includes('active')) return 'Active';
  if (normalized.includes('triggered')) return 'Triggered';
  if (normalized.includes('matured')) return 'Matured';
  if (normalized.includes('settled')) return 'Settled';
  
  return status;
}

