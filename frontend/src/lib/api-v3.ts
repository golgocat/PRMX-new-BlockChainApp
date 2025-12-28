/**
 * PRMX V3 P2P Climate Risk Market API
 * 
 * Blockchain API for V3 underwrite requests, policies, and LP management.
 */

import { ApiPromise } from '@polkadot/api';
import { KeyringPair } from '@polkadot/keyring/types';
import { getApi, signAndWait } from './api';
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
  
  const events = await signAndWait(tx, keypair);
  
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
  
  await signAndWait(tx, keypair);
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
  
  const events = await signAndWait(tx, keypair);
  
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
  return {
    policyId,
    eventSpec: parseEventSpec(state.eventSpec),
    aggState: parseAggState(state.aggState),
    observedUntil: state.observedUntil.toNumber(),
    commitment: state.commitment.toHex(),
    status: parseStatusString(state.status.toString()) as V3PolicyStatus,
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
  const locationId = req.locationId.toNumber();
  
  return {
    id: req.requestId.toNumber(),
    requester: req.requester.toString(),
    locationId,
    location: locationMap.get(locationId),
    eventSpec: parseEventSpec(req.eventSpec),
    totalShares: parseInt(req.totalShares.toString()),
    filledShares: parseInt(req.filledShares.toString()),
    premiumPerShare: BigInt(req.premiumPerShare.toString()),
    payoutPerShare: BigInt(req.payoutPerShare.toString()),
    coverageStart: req.coverageStart.toNumber(),
    coverageEnd: req.coverageEnd.toNumber(),
    expiresAt: req.expiresAt.toNumber(),
    status: parseStatusString(req.status.toString()) as V3RequestStatus,
    createdAt: req.createdAt.toNumber(),
  };
}

function parsePolicy(policy: any, locationMap: Map<number, V3Location>): V3Policy {
  const locationId = policy.locationId.toNumber();
  
  return {
    id: policy.policyId.toNumber(),
    holder: policy.holder.toString(),
    locationId,
    location: locationMap.get(locationId),
    eventSpec: parseEventSpec(policy.eventSpec),
    totalShares: parseInt(policy.totalShares.toString()),
    premiumPaid: BigInt(policy.premiumPaid.toString()),
    maxPayout: BigInt(policy.maxPayout.toString()),
    coverageStart: policy.coverageStart.toNumber(),
    coverageEnd: policy.coverageEnd.toNumber(),
    status: parseStatusString(policy.status.toString()) as V3PolicyStatus,
    createdAt: policy.createdAt.toNumber(),
  };
}

function parseEventSpec(spec: any): V3EventSpec {
  const eventTypeKey = Object.keys(spec.event_type || spec.eventType)[0];
  const thresholdUnit = Object.keys(spec.threshold.unit)[0];
  
  return {
    eventType: eventTypeKey as V3EventSpec['eventType'],
    threshold: {
      value: spec.threshold.value.toNumber ? spec.threshold.value.toNumber() : spec.threshold.value,
      unit: thresholdUnit as V3EventSpec['threshold']['unit'],
    },
    earlyTrigger: spec.early_trigger || spec.earlyTrigger || false,
  };
}

function parseAggState(aggState: any): V3AggState {
  const stateType = Object.keys(aggState)[0];
  const stateValue = aggState[stateType];
  
  switch (stateType) {
    case 'PrecipSum':
      return { type: 'PrecipSum', sumMmX1000: stateValue.sum_mm_x1000 || stateValue.sumMmX1000 };
    case 'Precip1hMax':
      return { type: 'Precip1hMax', max1hMmX1000: stateValue.max_1h_mm_x1000 || stateValue.max1hMmX1000 };
    case 'TempMax':
      return { type: 'TempMax', maxCX1000: stateValue.max_c_x1000 || stateValue.maxCX1000 };
    case 'TempMin':
      return { type: 'TempMin', minCX1000: stateValue.min_c_x1000 || stateValue.minCX1000 };
    case 'WindGustMax':
      return { type: 'WindGustMax', maxMpsX1000: stateValue.max_mps_x1000 || stateValue.maxMpsX1000 };
    case 'PrecipTypeOccurred':
      return { type: 'PrecipTypeOccurred', mask: stateValue.mask };
    default:
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

