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
        minDurationSecs: data.windowRules?.minDurationSecs ?? 86400,
        maxDurationSecs: data.windowRules?.maxDurationSecs ?? 604800,
        minLeadTimeSecs: data.windowRules?.minLeadTimeSecs ?? 1814400,
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
      minDurationSecs: data.windowRules?.minDurationSecs ?? 86400,
      maxDurationSecs: data.windowRules?.maxDurationSecs ?? 604800,
      minLeadTimeSecs: data.windowRules?.minLeadTimeSecs ?? 1814400,
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
          probabilityPercent: probabilityPpm / 100, // Convert PPM to percent * 100 (e.g., 50000 PPM -> 500 -> 5.00%)
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
    
    // Parse policy label (stored as hex-encoded bytes)
    const policyLabel = hexToString(data.policyLabel) || `policy-${policyId}`;
    
    return {
      id: policyId,
      label: policyLabel,
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
      // createdAt may not exist for older policies, default to coverageStart
      createdAt: data.createdAt || data.coverageStart,
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
 * Derive the policy pool account address
 * Replicates Substrate's PalletId::into_sub_account_truncating
 * 
 * The derivation follows Substrate's logic:
 * 1. Start with "modl" prefix (4 bytes)
 * 2. Add PalletId (8 bytes): "prmxplcy"
 * 3. Add sub-account seed encoded as: "policy" string bytes + policy_id as u32 LE
 * 4. Pad to 32 bytes with zeros
 * 5. This becomes the AccountId directly (no hashing for truncating version)
 */
export function derivePolicyPoolAddress(policyId: number): string {
  const { encodeAddress } = require('@polkadot/util-crypto');
  const { stringToU8a, u8aConcat } = require('@polkadot/util');
  
  // "modl" prefix (4 bytes) - standard Substrate pallet account prefix
  const modlPrefix = stringToU8a('modl');
  
  // PALLET_ID = b"prmxplcy" (8 bytes)
  const palletId = stringToU8a('prmxplcy');
  
  // Sub-account seed: "policy" (6 bytes) + policy_id as u32 LE (4 bytes)
  const policyPrefix = stringToU8a('policy');
  const policyIdBytes = new Uint8Array(4);
  new DataView(policyIdBytes.buffer).setUint32(0, policyId, true); // little endian
  
  // Combine all parts
  const combined = u8aConcat(modlPrefix, palletId, policyPrefix, policyIdBytes);
  
  // Pad to 32 bytes (AccountId size) with zeros - this is "truncating" behavior
  const accountBytes = new Uint8Array(32);
  accountBytes.set(combined.slice(0, Math.min(combined.length, 32)));
  
  // Encode as SS58 address (prefix 42 for generic Substrate)
  return encodeAddress(accountBytes, 42);
}

/**
 * Get the policy risk pool balance
 */
export async function getPolicyPoolBalance(policyId: number): Promise<bigint> {
  const api = await getApi();
  const balance = await api.query.prmxPolicy.policyRiskPoolBalance(policyId);
  return BigInt(balance.toString());
}

/**
 * Get full policy pool info (address + balance)
 */
export async function getPolicyPoolInfo(policyId: number): Promise<{
  address: string;
  balance: bigint;
}> {
  const address = derivePolicyPoolAddress(policyId);
  const balance = await getPolicyPoolBalance(policyId);
  return { address, balance };
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
 * Individual rainfall bucket data
 */
export interface RainBucket {
  bucketIndex: number;
  timestamp: Date;
  rainfallMm: number;
  blockNumber: number;
  rawData: Record<string, unknown>; // Raw blockchain data for debugging
}

/**
 * Get individual rain bucket readings for a market (past 24 hours)
 */
export async function getRainBuckets(marketId: number): Promise<RainBucket[]> {
  const api = await getApi();
  
  // Get rolling state to know the bucket range
  const rollingState = await getRollingRainfallSum(marketId);
  if (!rollingState) return [];
  
  const { oldestBucketIndex, lastBucketIndex } = rollingState;
  const buckets: RainBucket[] = [];
  
  // Fetch each bucket in the range
  for (let idx = oldestBucketIndex; idx <= lastBucketIndex; idx++) {
    try {
      const bucket = await api.query.prmxOracle.rainBuckets(marketId, idx);
      
      if (!(bucket as any).isNone) {
        const data = (bucket as any).unwrap().toJSON();
        // Handle both camelCase and snake_case
        const timestampSecs = data.timestamp ?? data.timestamp;
        const rainfallMm = data.rainfallMm ?? data.rainfall_mm ?? 0;
        const blockNumber = data.blockNumber ?? data.block_number ?? 0;
        
        buckets.push({
          bucketIndex: idx,
          timestamp: new Date(timestampSecs * 1000),
          rainfallMm: rainfallMm / 10, // Convert from tenths of mm to mm
          blockNumber,
          rawData: {
            marketId,
            bucketIndex: idx,
            ...data,
            _note: 'rainfall_mm is in tenths of mm (e.g., 100 = 10.0mm)',
          },
        });
      }
    } catch (err) {
      console.error(`Failed to fetch bucket ${idx} for market ${marketId}:`, err);
    }
  }
  
  // Sort by timestamp descending (newest first)
  buckets.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  
  return buckets;
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
 * Threshold trigger log - records automatic settlement events
 */
export interface ThresholdTriggerLog {
  triggerId: number;
  marketId: number;
  policyId: number;
  triggeredAt: number; // Unix timestamp
  blockNumber: number;
  rollingSumMm: number; // Rainfall that triggered (in tenths of mm)
  strikeThreshold: number; // Threshold that was exceeded (in tenths of mm)
  holder: string;
  payoutAmount: string; // u128 as string
  centerLatitude: number;
  centerLongitude: number;
}

/**
 * Get all threshold trigger logs from the chain
 */
export async function getThresholdTriggerLogs(): Promise<ThresholdTriggerLog[]> {
  const api = await getApi();
  const logs: ThresholdTriggerLog[] = [];
  
  try {
    // Get the next trigger log ID to know how many logs exist
    const nextIdRaw = await api.query.prmxOracle.nextTriggerLogId();
    const nextId = (nextIdRaw as any).toNumber?.() ?? Number(nextIdRaw.toString());
    
    // Fetch all trigger logs from 0 to nextId-1
    for (let i = 0; i < nextId; i++) {
      try {
        const logData = await api.query.prmxOracle.thresholdTriggerLogs(i);
        
        if (!(logData as any).isNone && logData) {
          const data = (logData as any).unwrap?.()?.toJSON() ?? (logData as any).toJSON();
          
          if (data) {
            logs.push({
              triggerId: data.triggerId ?? data.trigger_id ?? i,
              marketId: data.marketId ?? data.market_id ?? 0,
              policyId: data.policyId ?? data.policy_id ?? 0,
              triggeredAt: data.triggeredAt ?? data.triggered_at ?? 0,
              blockNumber: data.blockNumber ?? data.block_number ?? 0,
              rollingSumMm: data.rollingSumMm ?? data.rolling_sum_mm ?? 0,
              strikeThreshold: data.strikeThreshold ?? data.strike_threshold ?? 0,
              holder: data.holder ?? '',
              payoutAmount: String(data.payoutAmount ?? data.payout_amount ?? '0'),
              centerLatitude: data.centerLatitude ?? data.center_latitude ?? 0,
              centerLongitude: data.centerLongitude ?? data.center_longitude ?? 0,
            });
          }
        }
      } catch (err) {
        console.warn(`Failed to fetch trigger log ${i}:`, err);
      }
    }
  } catch (err) {
    console.error('Failed to fetch threshold trigger logs:', err);
  }
  
  // Sort by trigger ID descending (newest first)
  logs.sort((a, b) => b.triggerId - a.triggerId);
  
  return logs;
}

/**
 * Get trigger logs for a specific market
 */
export async function getThresholdTriggerLogsByMarket(marketId: number): Promise<ThresholdTriggerLog[]> {
  const allLogs = await getThresholdTriggerLogs();
  return allLogs.filter(log => log.marketId === marketId);
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

/**
 * Request manual rainfall data fetch from AccuWeather (DAO only)
 * This triggers the offchain worker to fetch real data from the AccuWeather API
 * for the specified market
 */
export async function requestRainfallFetch(
  signer: KeyringPair,
  marketId: number
): Promise<string> {
  const api = await getApi();
  
  console.log(`[API] requestRainfallFetch called: marketId=${marketId}`);
  
  // The extrinsic requires GovernanceOrigin (EnsureRoot), so we need to use sudo
  const innerCall = api.tx.prmxOracle.requestRainfallFetch(marketId);
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
        
        // Check for failure events
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
          
          // Log events
          events.forEach(({ event }) => {
            console.log(`[API] Event: ${event.section}.${event.method}`);
          });
        }
        
        if (status.isInBlock) {
          console.log(`[API] Rainfall fetch request included in block:`, status.asInBlock.toHex());
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
 * Complete a manual rainfall fetch by submitting the data (DAO only)
 * This is called after the offchain worker has fetched data from AccuWeather
 * @param rainfallMm - 24h rolling sum in tenths of mm (e.g., 150 = 15.0mm)
 */
export async function completeRainfallFetch(
  signer: KeyringPair,
  marketId: number,
  rainfallMm: number
): Promise<string> {
  const api = await getApi();
  
  console.log(`[API] completeRainfallFetch called: marketId=${marketId}, rainfallMm=${rainfallMm}`);
  
  // The extrinsic requires GovernanceOrigin (EnsureRoot), so we need to use sudo
  const innerCall = api.tx.prmxOracle.completeRainfallFetch(marketId, rainfallMm);
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
        
        // Check for failure events
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
          
          // Log events
          events.forEach(({ event }) => {
            console.log(`[API] Event: ${event.section}.${event.method}`);
          });
        }
        
        if (status.isInBlock) {
          console.log(`[API] Rainfall fetch completed in block:`, status.asInBlock.toHex());
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
 * Check if there's a pending rainfall fetch request for a market
 */
export async function getPendingFetchRequest(marketId: number): Promise<number | null> {
  const api = await getApi();
  const result = await api.query.prmxOracle.pendingFetchRequests(marketId);
  
  if (result.isSome) {
    return (result as any).unwrap().toNumber();
  }
  return null;
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

// ============================================================================
// XCM Capital Strategy (prmxXcmCapital pallet) - Hydration Stableswap Pool 102
// ============================================================================

import type { LpPosition, InvestmentStatus, DaoSolvencyInfo, PolicyDefiInfo } from '@/types';

// DAO account address (Alice in test environment)
export const DAO_ACCOUNT_ADDRESS = TEST_ACCOUNTS.alice.address;

/**
 * Get LP position for a policy (Hydration Pool 102)
 */
export async function getLpPosition(policyId: number): Promise<LpPosition | null> {
  const api = await getApi();
  try {
    const position = await api.query.prmxXcmCapital.policyLpPositions(policyId);
    
    if ((position as any).isNone) return null;
    
    const data = (position as any).unwrap().toJSON();
    return {
      policyId,
      lpShares: BigInt(data.lpShares || data.lp_shares || '0'),
      principalUsdt: BigInt(data.principalUsdt || data.principal_usdt || '0'),
    };
  } catch (err) {
    console.error(`Failed to get LP position for policy ${policyId}:`, err);
    return null;
  }
}

/**
 * Get investment status for a policy
 */
export async function getInvestmentStatus(policyId: number): Promise<InvestmentStatus> {
  const api = await getApi();
  try {
    const status = await api.query.prmxXcmCapital.policyInvestmentStatus(policyId);
    const statusStr = normalizeStatus(status.toJSON(), 'NotInvested');
    
    // Map chain status to our InvestmentStatus type
    switch (statusStr) {
      case 'Invested':
        return 'Invested';
      case 'Unwinding':
        return 'Unwinding';
      case 'Settled':
        return 'Settled';
      case 'Failed':
        return 'Failed';
      default:
        return 'NotInvested';
    }
  } catch (err) {
    console.error(`Failed to get investment status for policy ${policyId}:`, err);
    return 'NotInvested';
  }
}

/**
 * Get total capital allocated to DeFi strategy (Hydration Pool 102)
 */
export async function getTotalAllocatedCapital(): Promise<bigint> {
  const api = await getApi();
  try {
    const total = await api.query.prmxXcmCapital.totalAllocatedCapital();
    return BigInt(total.toString());
  } catch (err) {
    console.error('Failed to get total allocated capital:', err);
    return BigInt(0);
  }
}

/**
 * Get current allocation percentage (in parts per million)
 */
export async function getAllocationPercentagePpm(): Promise<number> {
  const api = await getApi();
  try {
    const ppm = await api.query.prmxXcmCapital.allocationPercentagePpm();
    return (ppm as any).toNumber?.() ?? Number(ppm.toString());
  } catch (err) {
    console.error('Failed to get allocation percentage:', err);
    return 1_000_000; // Default to 100%
  }
}

/**
 * Get DAO's USDT balance
 */
export async function getDaoUsdtBalance(): Promise<bigint> {
  return getUsdtBalance(DAO_ACCOUNT_ADDRESS);
}

/**
 * Get full DeFi info for a policy (position + status)
 */
export async function getPolicyDefiInfo(policyId: number): Promise<PolicyDefiInfo> {
  const [position, investmentStatus] = await Promise.all([
    getLpPosition(policyId),
    getInvestmentStatus(policyId),
  ]);
  
  return {
    investmentStatus,
    position,
    isAllocatedToDefi: position !== null && investmentStatus === 'Invested',
  };
}

/**
 * Get DAO solvency information
 */
export async function getDaoSolvencyInfo(): Promise<DaoSolvencyInfo> {
  const api = await getApi();
  
  const [daoBalance, totalAllocated, allocationPpm, totalShares] = await Promise.all([
    getDaoUsdtBalance(),
    getTotalAllocatedCapital(),
    getAllocationPercentagePpm(),
    (async () => {
      try {
        const shares = await api.query.prmxXcmCapital.totalLpShares();
        return BigInt(shares.toString());
      } catch {
        return BigInt(0);
      }
    })(),
  ]);
  
  // Count active positions
  let activePositionsCount = 0;
  try {
    const entries = await api.query.prmxXcmCapital.policyLpPositions.entries();
    activePositionsCount = entries.length;
  } catch {
    activePositionsCount = 0;
  }
  
  // DAO is solvent if it can cover all allocated capital (potential 100% loss)
  const isSolvent = daoBalance >= totalAllocated;
  
  return {
    daoBalance,
    totalAllocatedCapital: totalAllocated,
    totalLpShares: totalShares,
    activePositionsCount,
    allocationPercentagePpm: allocationPpm,
    isSolvent,
  };
}

/**
 * Get all LP positions across all policies (Hydration Pool 102)
 */
export async function getAllLpPositions(): Promise<LpPosition[]> {
  const api = await getApi();
  const positions: LpPosition[] = [];
  
  try {
    const entries = await api.query.prmxXcmCapital.policyLpPositions.entries();
    
    for (const [key, value] of entries) {
      const policyId = (key.args[0] as any).toNumber();
      const data = (value as any).toJSON();
      
      positions.push({
        policyId,
        lpShares: BigInt(data.lpShares || data.lp_shares || '0'),
        principalUsdt: BigInt(data.principalUsdt || data.principal_usdt || '0'),
      });
    }
  } catch (err) {
    console.error('Failed to get all LP positions:', err);
  }
  
  return positions;
}
