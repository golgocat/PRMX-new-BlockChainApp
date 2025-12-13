import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatAddress(address: string, chars = 6): string {
  if (!address) return '';
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function formatBalance(balance: bigint, decimals = 6): string {
  const divisor = BigInt(10 ** decimals);
  const whole = balance / divisor;
  const fraction = balance % divisor;
  const fractionStr = fraction.toString().padStart(decimals, '0').slice(0, 2);
  return `${whole.toLocaleString()}.${fractionStr}`;
}

export function formatUSDT(amount: bigint): string {
  return `$${formatBalance(amount, 6)}`;
}

export function formatPRMX(amount: bigint): string {
  return `${formatBalance(amount, 12)} PRMX`;
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format timestamp to UTC date and time (hour:minute)
 * Returns format like "Dec 13, 2025 14:30 UTC"
 */
export function formatDateTimeUTC(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  };
  return date.toLocaleString('en-US', options) + ' UTC';
}

/**
 * Format timestamp to short UTC time (hour:minute only)
 * Returns format like "14:30 UTC"
 */
export function formatTimeUTC(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes} UTC`;
}

/**
 * Format timestamp to compact UTC format for tables
 * Returns format like "Dec 13, 14:30 UTC"
 */
export function formatDateTimeUTCCompact(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const month = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = date.getUTCDate();
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  return `${month} ${day}, ${hours}:${minutes} UTC`;
}

export function formatTimeRemaining(endTimestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const remaining = endTimestamp - now;

  if (remaining <= 0) return 'Expired';

  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatPercentage(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatBasisPoints(bp: number): string {
  return `${(bp / 100).toFixed(2)}%`;
}

export function formatRainfall(mm: number): string {
  // mm is scaled by 10
  return `${(mm / 10).toFixed(1)} mm`;
}

export function formatCoordinates(lat: number, lon: number): string {
  // Coordinates are scaled by 1e6
  const latVal = lat / 1_000_000;
  const lonVal = lon / 1_000_000;
  const latDir = latVal >= 0 ? 'N' : 'S';
  const lonDir = lonVal >= 0 ? 'E' : 'W';
  return `${Math.abs(latVal).toFixed(4)}°${latDir}, ${Math.abs(lonVal).toFixed(4)}°${lonDir}`;
}

export function daysToSeconds(days: number): number {
  return days * 86400;
}

export function secondsToDays(seconds: number): number {
  return Math.round(seconds / 86400);
}

export function calculatePremiumRate(probabilityPpm: number, daoMarginBp: number): number {
  const fairRate = probabilityPpm / 10000; // Convert PPM to percentage
  const marginMultiplier = 1 + daoMarginBp / 10000;
  return fairRate * marginMultiplier;
}

export function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'active':
    case 'open':
      return 'success';
    case 'expired':
    case 'closed':
      return 'warning';
    case 'settled':
      return 'info';
    case 'cancelled':
      return 'error';
    default:
      return 'info';
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
