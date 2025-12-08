/**
 * Blockchain utilities for PRMX
 * 
 * This module provides utilities for interacting with the PRMX blockchain.
 * Currently contains mock implementations - replace with actual Polkadot.js
 * API calls when connecting to a live node.
 */

// Types for blockchain interactions
export interface BlockchainConfig {
  rpcUrl: string;
  networkName: string;
}

// Default configuration
export const DEFAULT_CONFIG: BlockchainConfig = {
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || 'ws://localhost:9944',
  networkName: 'PRMX Testnet',
};

/**
 * Format a balance from chain representation to human-readable
 */
export function formatChainBalance(balance: bigint, decimals: number = 6): string {
  const divisor = BigInt(10 ** decimals);
  const whole = balance / divisor;
  const fraction = balance % divisor;
  const fractionStr = fraction.toString().padStart(decimals, '0');
  return `${whole}.${fractionStr}`;
}

/**
 * Parse a human-readable amount to chain representation
 */
export function parseToChainBalance(amount: string, decimals: number = 6): bigint {
  const [whole, fraction = ''] = amount.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole + paddedFraction);
}

/**
 * Generate a derived account for policy pools
 * In production, this would use the same derivation as the chain
 */
export function derivePolicyPoolAccount(policyId: number): string {
  // Mock implementation - in production use proper derivation
  return `5PolicyPool${policyId.toString().padStart(40, '0')}`;
}

/**
 * Convert scaled coordinates to float
 * Coordinates on chain are scaled by 1e6
 */
export function coordinatesToFloat(scaled: number): number {
  return scaled / 1_000_000;
}

/**
 * Convert float coordinates to scaled representation
 */
export function floatToCoordinates(value: number): number {
  return Math.round(value * 1_000_000);
}

/**
 * Calculate bucket index for a timestamp
 * Buckets are 1 hour (3600 seconds)
 */
export function bucketIndexForTimestamp(timestamp: number): number {
  return Math.floor(timestamp / 3600);
}

/**
 * Get bucket start time from index
 */
export function bucketStartTime(index: number): number {
  return index * 3600;
}

/**
 * Calculate coverage duration in days
 */
export function calculateCoverageDays(startTimestamp: number, endTimestamp: number): number {
  return Math.ceil((endTimestamp - startTimestamp) / 86400);
}

/**
 * Check if a timestamp is within a coverage window
 */
export function isWithinCoverage(
  timestamp: number,
  coverageStart: number,
  coverageEnd: number
): boolean {
  return timestamp >= coverageStart && timestamp <= coverageEnd;
}

/**
 * Calculate premium from probability and parameters
 */
export function calculatePremium(
  probabilityPpm: number,
  payoutPerShare: bigint,
  daoMarginBp: number,
  shares: bigint
): bigint {
  const fairPremiumPerShare = (payoutPerShare * BigInt(probabilityPpm)) / BigInt(1_000_000);
  const marginMultiplier = BigInt(10_000 + daoMarginBp);
  const premiumPerShare = (fairPremiumPerShare * marginMultiplier) / BigInt(10_000);
  return premiumPerShare * shares;
}

/**
 * Calculate required capital per share
 */
export function calculateRequiredCapital(
  payoutPerShare: bigint,
  premiumPerShare: bigint
): bigint {
  return payoutPerShare > premiumPerShare 
    ? payoutPerShare - premiumPerShare 
    : BigInt(0);
}

/**
 * Format market status for display
 */
export function formatMarketStatus(status: string): { label: string; color: string } {
  switch (status.toLowerCase()) {
    case 'open':
      return { label: 'Open', color: 'success' };
    case 'closed':
      return { label: 'Closed', color: 'warning' };
    case 'settled':
      return { label: 'Settled', color: 'info' };
    default:
      return { label: status, color: 'default' };
  }
}

/**
 * Format policy status for display
 */
export function formatPolicyStatus(status: string): { label: string; color: string } {
  switch (status.toLowerCase()) {
    case 'active':
      return { label: 'Active', color: 'success' };
    case 'expired':
      return { label: 'Expired', color: 'warning' };
    case 'settled':
      return { label: 'Settled', color: 'info' };
    case 'cancelled':
      return { label: 'Cancelled', color: 'error' };
    default:
      return { label: status, color: 'default' };
  }
}

// Constants matching the chain
export const CHAIN_CONSTANTS = {
  USDT_DECIMALS: 6,
  PRMX_DECIMALS: 12,
  PAYOUT_PER_SHARE: BigInt('100000000'), // 100 USDT
  BUCKET_INTERVAL_SECS: 3600,
  ROLLING_WINDOW_SECS: 86400,
  MAX_RAINFALL_MM: 10000, // scaled by 10
  MIN_COVERAGE_DAYS: 1,
  MAX_COVERAGE_DAYS: 7,
  MIN_LEAD_TIME_DAYS: 21,
};

/**
 * Placeholder for API connection
 * Replace with actual Polkadot.js API initialization
 */
export async function connectToChain(config: BlockchainConfig = DEFAULT_CONFIG) {
  console.log(`Connecting to ${config.networkName} at ${config.rpcUrl}`);
  
  // In production:
  // const { ApiPromise, WsProvider } = await import('@polkadot/api');
  // const provider = new WsProvider(config.rpcUrl);
  // const api = await ApiPromise.create({ provider });
  // return api;
  
  return null;
}
