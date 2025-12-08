/**
 * PRMX Blockchain API Service
 * 
 * Connects to the PRMX Substrate node and provides methods to interact
 * with all PRMX pallets.
 */

import { ApiPromise, WsProvider, Keyring } from '@polkadot/api';
import { KeyringPair } from '@polkadot/keyring/types';
import type { Market, Policy, QuoteRequest, QuoteResult, LpHolding, LpAskOrder, RainfallData } from '@/types';

// Constants
export const WS_ENDPOINT = process.env.NEXT_PUBLIC_WS_ENDPOINT || 'ws://localhost:9944';
export const USDT_ASSET_ID = 1;
export const USDT_DECIMALS = 6;
export const PRMX_DECIMALS = 12;
export const PAYOUT_PER_SHARE = BigInt('100000000'); // 100 USDT (6 decimals)

// Test accounts with their roles
export const TEST_ACCOUNTS = {
  alice: {
    name: 'Alice',
    role: 'DAO Admin',
    address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
    seed: '//Alice',
    usdtBalance: BigInt('100000000000000'), // 100M USDT
    description: 'DAO administrator with full control',
  },
  bob: {
    name: 'Bob',
    role: 'Customer',
    address: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
    seed: '//Bob',
    usdtBalance: BigInt('10000000000'), // 10K USDT
    description: 'Insurance customer seeking coverage',
  },
  charlie: {
    name: 'Charlie',
    role: 'LP 1',
    address: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y',
    seed: '//Charlie',
    usdtBalance: BigInt('1000000000000'), // 1M USDT
    description: 'Liquidity provider 1',
  },
  dave: {
    name: 'Dave',
    role: 'LP 2',
    address: '5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy',
    seed: '//Dave',
    usdtBalance: BigInt('1000000000000'), // 1M USDT
    description: 'Liquidity provider 2',
  },
} as const;

export type AccountKey = keyof typeof TEST_ACCOUNTS;

// Singleton API instance
let apiInstance: ApiPromise | null = null;
let keyring: Keyring | null = null;
let connectionPromise: Promise<ApiPromise> | null = null;

/**
 * Initialize and return the API connection
 */
export async function getApi(): Promise<ApiPromise> {
  if (apiInstance?.isConnected) {
    return apiInstance;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    try {
      const provider = new WsProvider(WS_ENDPOINT);
      const api = await ApiPromise.create({ provider });
      await api.isReady;
      apiInstance = api;
      console.log('Connected to PRMX chain:', api.genesisHash.toHex());
      return api;
    } catch (error) {
      connectionPromise = null;
      throw error;
    }
  })();

  return connectionPromise;
}

/**
 * Get keyring instance
 */
export function getKeyring(): Keyring {
  if (!keyring) {
    keyring = new Keyring({ type: 'sr25519' });
  }
  return keyring;
}

/**
 * Get keypair for a test account
 */
export function getKeypair(accountKey: AccountKey): KeyringPair {
  const kr = getKeyring();
  const account = TEST_ACCOUNTS[accountKey];
  return kr.addFromUri(account.seed);
}

/**
 * Disconnect from the API
 */
export async function disconnect(): Promise<void> {
  if (apiInstance) {
    await apiInstance.disconnect();
    apiInstance = null;
    connectionPromise = null;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Normalize status from chain enum format to string
 */
export function normalizeStatus(status: unknown, defaultValue: string = 'Unknown'): string {
  if (typeof status === 'string') {
    return status;
  }
  
  if (typeof status === 'object' && status !== null) {
    // Handle { type: "Active" } format
    if ('type' in status && typeof (status as any).type === 'string') {
      return (status as any).type;
    }
    // Handle { Active: null } format
    const keys = Object.keys(status);
    if (keys.length > 0) {
      return keys[0];
    }
  }
  
  return defaultValue;
}

/**
 * Convert hex string to UTF-8 string
 */
export function hexToString(hex: string | undefined): string {
  if (!hex) return '';
  let hexStr = hex;
  if (hexStr.startsWith('0x')) hexStr = hexStr.slice(2);
  
  let str = '';
  for (let i = 0; i < hexStr.length; i += 2) {
    const charCode = parseInt(hexStr.substring(i, i + 2), 16);
    if (charCode === 0) break;
    str += String.fromCharCode(charCode);
  }
  return str;
}

/**
 * Format balance with decimals
 */
export function formatBalance(balance: bigint, decimals: number = USDT_DECIMALS): string {
  const divisor = BigInt(10 ** decimals);
  const whole = balance / divisor;
  const fraction = balance % divisor;
  const fractionStr = fraction.toString().padStart(decimals, '0').slice(0, 2);
  return `${whole.toLocaleString()}.${fractionStr}`;
}

/**
 * Parse amount string to bigint
 */
export function parseAmount(amount: string, decimals: number = USDT_DECIMALS): bigint {
  const [whole, fraction = ''] = amount.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole + paddedFraction);
}

// ============================================================================
// Balance Queries
// ============================================================================

/**
 * Get PRMX (native) balance for an account
 */
export async function getPrmxBalance(address: string): Promise<bigint> {
  const api = await getApi();
  const account = await api.query.system.account(address);
  return BigInt((account as any).data.free.toString());
}

/**
 * Get USDT balance for an account
 */
export async function getUsdtBalance(address: string): Promise<bigint> {
  const api = await getApi();
  try {
    const balance = await api.query.assets.account(USDT_ASSET_ID, address);
    if ((balance as any).isNone) return BigInt(0);
    return BigInt((balance as any).unwrap().balance.toString());
  } catch {
    return BigInt(0);
  }
}

// ============================================================================
// Markets Pallet
// ============================================================================

/**
 * Get all markets
 */
export async function getMarkets(): Promise<Market[]> {
  const api = await getApi();
  const entries = await api.query.prmxMarkets.markets.entries();
  
  return entries.map(([key, value]) => {
    const marketId = (key.args[0] as any).toNumber();
    const data = (value as any).toJSON();
    
    // Strike value is stored in tenths of mm, convert to mm
    const strikeValue = Math.round((data.strikeValue || 0) / 10);
    
    return {
      id: marketId,
      name: hexToString(data.name),
      centerLatitude: data.centerLatitude,
      centerLongitude: data.centerLongitude,
      strikeValue,
      payoutPerShare: BigInt(data.payoutPerShare || '100000000'),
      status: normalizeStatus(data.status, 'Open'),
      riskParameters: {
        daoMarginBp: data.risk?.daoMarginBp || 2000,
      },
      windowRules: {
        minDurationSecs: data.windowRules?.minDurationSecs || 86400,
        maxDurationSecs: data.windowRules?.maxDurationSecs || 604800,
        minLeadTimeSecs: data.windowRules?.minLeadTimeSecs || 1814400,
      },
    };
  });
}

/**
 * Get a single market by ID
 */
export async function getMarket(marketId: number): Promise<Market | null> {
  const api = await getApi();
  const market = await api.query.prmxMarkets.markets(marketId);
  
  if ((market as any).isNone) return null;
  
  const data = (market as any).unwrap().toJSON();
  const strikeValue = Math.round((data.strikeValue || 0) / 10);
  
  return {
    id: marketId,
    name: hexToString(data.name),
    centerLatitude: data.centerLatitude,
    centerLongitude: data.centerLongitude,
    strikeValue,
    payoutPerShare: BigInt(data.payoutPerShare || '100000000'),
    status: normalizeStatus(data.status, 'Open'),
    riskParameters: {
      daoMarginBp: data.risk?.daoMarginBp || 2000,
    },
    windowRules: {
      minDurationSecs: data.windowRules?.minDurationSecs || 86400,
      maxDurationSecs: data.windowRules?.maxDurationSecs || 604800,
      minLeadTimeSecs: data.windowRules?.minLeadTimeSecs || 1814400,
    },
  };
}

/**
 * Create a new market (DAO only)
 */
export async function createMarket(
  signer: KeyringPair,
  params: {
    name: string;
    centerLatitude: number;
    centerLongitude: number;
    strikeValue: number;
    daoMarginBp: number;
    minDurationSecs: number;
    maxDurationSecs: number;
    minLeadTimeSecs: number;
  }
): Promise<string> {
  const api = await getApi();
  const strikeValueScaled = params.strikeValue * 10;
  
  return new Promise((resolve, reject) => {
    api.tx.prmxMarkets.daoCreateMarket(
      params.name,
      params.centerLatitude,
      params.centerLongitude,
      strikeValueScaled,
      { daoMarginBp: params.daoMarginBp },
      {
        minDurationSecs: params.minDurationSecs,
        maxDurationSecs: params.maxDurationSecs,
        minLeadTimeSecs: params.minLeadTimeSecs,
      }
    ).signAndSend(signer, ({ status, dispatchError }) => {
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
        resolve(status.asFinalized.toHex());
      }
    });
  });
}

// ============================================================================
// Quote Pallet
// ============================================================================

/**
 * Get all quote requests
 */
export async function getQuoteRequests(): Promise<QuoteRequest[]> {
  const api = await getApi();
  const entries = await api.query.prmxQuote.quoteRequests.entries();
  
  const quotes = await Promise.all(entries.map(async ([key, value]) => {
    const quoteId = (key.args[0] as any).toNumber();
    const data = (value as any).toJSON();
    
    // Try to get the quote result
    let result: QuoteResult | null = null;
    try {
      const resultData = await api.query.prmxQuote.quoteResults(quoteId);
      if (!(resultData as any).isNone) {
        const r = (resultData as any).unwrap().toJSON();
        const totalPremium = BigInt(r.totalPremium || '0');
        const probabilityPpm = r.probabilityPpm || 0;
        
        // Calculate fair premium (premium before DAO margin)
        // DAO margin is typically 20% (2000 bp), so fair = total / 1.2
        // For simplicity, estimate fair premium as total / 1.2
        const fairPremium = totalPremium * BigInt(10000) / BigInt(12000);
        
        result = {
          fairPremiumUsdt: fairPremium,
          premiumUsdt: totalPremium,
          breakEvenProbBp: probabilityPpm, // Keep as PPM for now, display will convert
        };
      }
    } catch {}
    
    return {
      id: quoteId,
      marketId: data.marketId,
      requester: data.requester,
      coverageStart: data.coverageStart,
      coverageEnd: data.coverageEnd,
      shares: Number(data.shares || '1'),
      requestedAt: data.requestedAt,
      result,
    };
  }));
  
  return quotes;
}

/**
 * Get the next quote ID (useful for determining the last created quote)
 */
export async function getNextQuoteId(): Promise<number> {
  const api = await getApi();
  const nextId = await api.query.prmxQuote.nextQuoteId();
  return (nextId as any).toNumber();
}

/**
 * Request a policy quote
 */
export async function requestQuote(
  signer: KeyringPair,
  params: {
    marketId: number;
    coverageStart: number;
    coverageEnd: number;
    latitude: number;
    longitude: number;
    shares: number;
  }
): Promise<number> {
  const api = await getApi();
  
  // Get the next quote ID before submitting (it will be assigned to our quote)
  const expectedQuoteId = await getNextQuoteId();
  
  return new Promise((resolve, reject) => {
    api.tx.prmxQuote.requestPolicyQuote(
      params.marketId,
      params.coverageStart,
      params.coverageEnd,
      params.latitude,
      params.longitude,
      params.shares
    ).signAndSend(signer, ({ status, events, dispatchError }) => {
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
        // Log all events for debugging
        console.log('Events:', events.map(({ event }) => `${event.section}.${event.method}`));
        
        const quoteEvent = events.find(({ event }) => 
          event.method === 'QuoteRequested'
        );
        if (quoteEvent) {
          // Try to get quote_id from named data or positional data
          const data = quoteEvent.event.data;
          const quoteId = (data as any).quoteId?.toNumber?.() 
            ?? (data as any).quote_id?.toNumber?.() 
            ?? (data[0] as any)?.toNumber?.()
            ?? expectedQuoteId; // Fallback to expected ID
          console.log('Quote ID from event:', quoteId);
          resolve(quoteId);
        } else {
          // Fallback: use the expected quote ID
          console.warn('QuoteRequested event not found, using expected ID:', expectedQuoteId);
          resolve(expectedQuoteId);
        }
      }
    });
  });
}

/**
 * Submit quote result (simulates off-chain worker)
 * In production, the off-chain worker would calculate this from rainfall data.
 * For testing, we submit a mock probability.
 */
export async function submitQuote(
  signer: KeyringPair,
  quoteId: number,
  probabilityPpm: number = 100000 // Default 10% probability
): Promise<string> {
  const api = await getApi();
  
  return new Promise((resolve, reject) => {
    api.tx.prmxQuote.submitQuote(quoteId, probabilityPpm)
      .signAndSend(signer, ({ status, dispatchError }) => {
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
          resolve(status.asFinalized.toHex());
        }
      });
  });
}

// ============================================================================
// Policy Pallet
// ============================================================================

/**
 * Get all policies
 */
export async function getPolicies(): Promise<Policy[]> {
  const api = await getApi();
  const entries = await api.query.prmxPolicy.policies.entries();
  
  return entries.map(([key, value]) => {
    const policyId = (key.args[0] as any).toNumber();
    const data = (value as any).toJSON();
    
    const shares = BigInt(data.shares || '1');
    // Capital pool = shares × payout per share (100 USDT per share = 100_000_000 smallest units)
    const PAYOUT_PER_SHARE = BigInt(100_000_000);
    const totalCapital = shares * PAYOUT_PER_SHARE;
    
    return {
      id: policyId,
      marketId: data.marketId,
      holder: data.holder,
      coverageStart: data.coverageStart,
      coverageEnd: data.coverageEnd,
      shares,
      status: normalizeStatus(data.status, 'Active'),
      premiumPaid: BigInt(data.premiumPaid || '0'),
      maxPayout: BigInt(data.maxPayout || '0') || totalCapital,
      capitalPool: {
        totalCapital,
        totalShares: Number(shares),
        lpHolders: data.capitalPool?.lpHolders || [],
      },
    };
  });
}

/**
 * Get policies for a specific holder
 */
export async function getPoliciesByHolder(holder: string): Promise<Policy[]> {
  const policies = await getPolicies();
  return policies.filter(p => p.holder === holder);
}

/**
 * Apply coverage using a quote
 */
export async function applyCoverage(
  signer: KeyringPair,
  quoteId: number
): Promise<number> {
  const api = await getApi();
  
  return new Promise((resolve, reject) => {
    api.tx.prmxPolicy.applyCoverageWithQuote(quoteId)
      .signAndSend(signer, ({ status, events, dispatchError }) => {
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
          const policyEvent = events.find(({ event }) => 
            event.section === 'prmxPolicy' && event.method === 'PolicyCreated'
          );
          if (policyEvent) {
            const policyId = (policyEvent.event.data[0] as any).toNumber();
            resolve(policyId);
          } else {
            resolve(-1);
          }
        }
      });
  });
}

/**
 * Settle a policy
 */
export async function settlePolicy(
  signer: KeyringPair,
  policyId: number,
  eventOccurred: boolean
): Promise<string> {
  const api = await getApi();
  
  return new Promise((resolve, reject) => {
    api.tx.prmxPolicy.settlePolicy(policyId, eventOccurred)
      .signAndSend(signer, ({ status, dispatchError }) => {
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
          resolve(status.asFinalized.toHex());
        }
      });
  });
}

// ============================================================================
// Holdings Pallet (LP Tokens)
// ============================================================================

/**
 * Get LP holdings for an account
 */
export async function getLpHoldings(holder: string): Promise<LpHolding[]> {
  const api = await getApi();
  const entries = await api.query.prmxHoldings.holdingsStorage.entries();
  
  const holdings: LpHolding[] = [];
  
  for (const [key, value] of entries) {
    const [policyId, accountId] = key.args;
    if (accountId.toString() === holder) {
      const data = (value as any).toJSON();
      holdings.push({
        policyId: (policyId as any).toNumber(),
        holder,
        shares: BigInt(data.lpShares || data.shares || '0'),
        lockedShares: BigInt(data.lockedShares || '0'),
      });
    }
  }
  
  return holdings;
}

// ============================================================================
// Orderbook Pallet
// ============================================================================

/**
 * Get all LP ask orders
 */
export async function getLpOrders(): Promise<LpAskOrder[]> {
  const api = await getApi();
  const entries = await api.query.prmxOrderbookLp.orders.entries();
  
  return entries.map(([key, value]) => {
    const orderId = (key.args[0] as any).toNumber();
    const data = (value as any).toJSON();
    
    return {
      orderId,
      policyId: data.policyId,
      seller: data.seller,
      priceUsdt: BigInt(data.price || data.priceUsdt || '0'),
      quantity: BigInt(data.quantity || '0'),
      remaining: BigInt(data.remaining || '0'),
      createdAt: data.createdAt,
    };
  });
}

/**
 * Place an LP ask order
 */
export async function placeLpAsk(
  signer: KeyringPair,
  policyId: number,
  quantity: bigint,
  price: bigint
): Promise<number> {
  const api = await getApi();
  
  return new Promise((resolve, reject) => {
    // Pallet expects: (policy_id, price, quantity)
    api.tx.prmxOrderbookLp.placeLpAsk(policyId, price, quantity)
      .signAndSend(signer, ({ status, events, dispatchError }) => {
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
          const orderEvent = events.find(({ event }) => 
            event.section === 'prmxOrderbookLp' && event.method === 'OrderPlaced'
          );
          if (orderEvent) {
            const orderId = (orderEvent.event.data[0] as any).toNumber();
            resolve(orderId);
          } else {
            resolve(-1);
          }
        }
      });
  });
}

/**
 * Buy LP tokens (fills ask orders at best price up to max_price)
 */
export async function fillLpAsk(
  signer: KeyringPair,
  orderId: number,
  quantity: bigint,
  policyId?: number,
  maxPrice?: bigint
): Promise<string> {
  const api = await getApi();
  
  // If policyId and maxPrice are provided, use buyLp
  // Otherwise, we need to get the order details first
  let targetPolicyId = policyId;
  let targetMaxPrice = maxPrice;
  
  if (targetPolicyId === undefined || targetMaxPrice === undefined) {
    // Get the order to find the policy and price
    const orderData = await api.query.prmxOrderbookLp.orders(orderId);
    const order = (orderData as any).toJSON();
    if (!order) {
      throw new Error('Order not found');
    }
    targetPolicyId = order.policyId;
    targetMaxPrice = BigInt(order.price || '0');
  }
  
  return new Promise((resolve, reject) => {
    api.tx.prmxOrderbookLp.buyLp(targetPolicyId, targetMaxPrice, quantity)
      .signAndSend(signer, ({ status, dispatchError }) => {
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
          resolve(status.asFinalized.toHex());
        }
      });
  });
}

/**
 * Cancel an LP ask order
 */
export async function cancelLpAsk(
  signer: KeyringPair,
  orderId: number
): Promise<string> {
  const api = await getApi();
  
  return new Promise((resolve, reject) => {
    let unsub: () => void;
    
    api.tx.prmxOrderbookLp.cancelLpAsk(orderId)
      .signAndSend(signer, ({ status, dispatchError, events }) => {
        if (dispatchError) {
          if (dispatchError.isModule) {
            const decoded = api.registry.findMetaError(dispatchError.asModule);
            reject(new Error(`${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`));
          } else {
            reject(new Error(dispatchError.toString()));
          }
          unsub?.();
          return;
        }
        
        // Check for ExtrinsicFailed event
        if (events) {
          const failedEvent = events.find(({ event }) => 
            event.section === 'system' && event.method === 'ExtrinsicFailed'
          );
          if (failedEvent) {
            reject(new Error('Transaction failed on-chain'));
            unsub?.();
            return;
          }
        }
        
        // Resolve on InBlock for faster response
        if (status.isInBlock) {
          resolve(status.asInBlock.toHex());
          unsub?.();
        }
      })
      .then(unsubFn => {
        unsub = unsubFn;
      })
      .catch(err => {
        reject(err);
      });
  });
}

// ============================================================================
// Oracle Pallet
// ============================================================================

/**
 * Get rolling rainfall sum for a market
 */
export async function getRollingRainfallSum(marketId: number): Promise<{
  lastBucketIndex: number;
  oldestBucketIndex: number;
  rollingSumMm: number;
} | null> {
  const api = await getApi();
  const state = await api.query.prmxOracle.rollingState(marketId);
  
  if ((state as any).isNone) return null;
  
  const data = (state as any).unwrap().toJSON();
  console.log(`[API] getRollingRainfallSum raw data for market ${marketId}:`, JSON.stringify(data));
  
  // Handle both camelCase and snake_case field names
  return {
    lastBucketIndex: data.lastBucketIndex ?? data.last_bucket_index,
    oldestBucketIndex: data.oldestBucketIndex ?? data.oldest_bucket_index,
    rollingSumMm: data.rollingSumMm ?? data.rolling_sum_mm,
  };
}

/**
 * Settlement result for a policy
 */
export interface SettlementResult {
  eventOccurred: boolean;
  payoutToHolder: bigint;
  returnedToLps: bigint;
  settledAt: number;
}

/**
 * Get settlement result for a policy
 */
export async function getSettlementResult(policyId: number): Promise<SettlementResult | null> {
  const api = await getApi();
  const result = await api.query.prmxPolicy.settlementResults(policyId);
  
  if ((result as any).isNone) return null;
  
  const data = (result as any).unwrap().toJSON();
  return {
    eventOccurred: data.eventOccurred,
    payoutToHolder: BigInt(data.payoutToHolder || '0'),
    returnedToLps: BigInt(data.returnedToLps || '0'),
    settledAt: data.settledAt,
  };
}

/**
 * Set test rainfall data for a market (DAO only)
 * Rainfall is in tenths of mm (e.g., 150 = 15.0mm)
 * NOTE: This requires sudo privileges - wraps call in sudo.sudo()
 */
export async function setTestRainfall(
  signer: KeyringPair,
  marketId: number,
  rainfallMm: number
): Promise<string> {
  const api = await getApi();
  
  console.log(`[API] setTestRainfall called: marketId=${marketId}, rainfallMm=${rainfallMm}`);
  
  // The extrinsic requires GovernanceOrigin (EnsureRoot), so we need to use sudo
  const innerCall = api.tx.prmxOracle.setTestRainfall(marketId, rainfallMm);
  const sudoCall = api.tx.sudo.sudo(innerCall);
  
  return new Promise((resolve, reject) => {
    let unsub: () => void;
    
    sudoCall
      .signAndSend(signer, ({ status, dispatchError, events }) => {
        console.log(`[API] Transaction status:`, status.type);
        
        if (dispatchError) {
          console.error(`[API] Dispatch error:`, dispatchError.toString());
          if (dispatchError.isModule) {
            const decoded = api.registry.findMetaError(dispatchError.asModule);
            reject(new Error(`${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`));
          } else {
            reject(new Error(dispatchError.toString()));
          }
          unsub?.();
          return;
        }
        
        // Check for ExtrinsicFailed or Sudo.SudoFailed event
        if (events) {
          const failedEvent = events.find(({ event }) => 
            (event.section === 'system' && event.method === 'ExtrinsicFailed') ||
            (event.section === 'sudo' && event.method === 'SudoFailed')
          );
          if (failedEvent) {
            console.error(`[API] Extrinsic failed event:`, failedEvent.event.data.toString());
            reject(new Error('Transaction failed on-chain (check if you are the sudo account)'));
            unsub?.();
            return;
          }
          
          // Log success events
          events.forEach(({ event }) => {
            console.log(`[API] Event: ${event.section}.${event.method}`);
          });
        }
        
        // Resolve on InBlock (don't wait for Finalized to be faster)
        if (status.isInBlock) {
          console.log(`[API] Transaction included in block:`, status.asInBlock.toHex());
          resolve(status.asInBlock.toHex());
          unsub?.();
        }
      })
      .then(unsubFn => {
        unsub = unsubFn;
      })
      .catch(err => {
        console.error(`[API] signAndSend error:`, err);
        reject(err);
      });
  });
}

/**
 * Set AccuWeather API key (DAO only)
 * The key is stored in offchain storage for use by the oracle worker
 */
export async function setAccuweatherApiKey(
  signer: KeyringPair,
  apiKey: string
): Promise<string> {
  const api = await getApi();
  
  return new Promise((resolve, reject) => {
    api.tx.prmxOracle.setAccuweatherApiKey(apiKey)
      .signAndSend(signer, ({ status, dispatchError }) => {
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
          resolve(status.asFinalized.toHex());
        }
      });
  });
}

// ============================================================================
// Block Subscriptions
// ============================================================================

/**
 * Subscribe to new blocks
 */
export async function subscribeToBlocks(callback: (blockNumber: number) => void): Promise<() => void> {
  const api = await getApi();
  const unsubscribe = await api.rpc.chain.subscribeNewHeads((header) => {
    callback(header.number.toNumber());
  });
  return unsubscribe;
}

/**
 * Get current block number
 */
export async function getCurrentBlock(): Promise<number> {
  const api = await getApi();
  const header = await api.rpc.chain.getHeader();
  return header.number.toNumber();
}
