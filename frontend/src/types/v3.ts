/**
 * PRMX V3 P2P Climate Risk Market Types
 */

// =============================================================================
// Event Types
// =============================================================================

export type V3EventType = 
  | 'PrecipSumGte'      // Cumulative precipitation >= threshold
  | 'Precip1hGte'       // Any 1h reading >= threshold
  | 'TempMaxGte'        // Max temperature >= threshold
  | 'TempMinLte'        // Min temperature <= threshold
  | 'WindGustMaxGte'    // Max wind gust >= threshold
  | 'PrecipTypeOccurred'; // Specific precipitation type occurred

export type V3ThresholdUnit = 
  | 'MmX1000'      // Precipitation in mm * 1000
  | 'CelsiusX1000' // Temperature in Celsius * 1000
  | 'MpsX1000'     // Wind speed in m/s * 1000
  | 'PrecipTypeMask'; // Bitmask for precipitation types

export interface V3Threshold {
  value: number;
  unit: V3ThresholdUnit;
}

export interface V3EventSpec {
  eventType: V3EventType;
  threshold: V3Threshold;
  earlyTrigger: boolean;
}

// Event type metadata for UI
export interface V3EventTypeInfo {
  type: V3EventType;
  label: string;
  description: string;
  unit: string;
  unitLabel: string;
  defaultThreshold: number;
  minThreshold: number;
  maxThreshold: number;
  icon: string;
}

export const V3_EVENT_TYPES: V3EventTypeInfo[] = [
  {
    type: 'PrecipSumGte',
    label: 'Cumulative Rainfall',
    description: 'Triggers when total rainfall over coverage period exceeds threshold',
    unit: 'MmX1000',
    unitLabel: 'mm',
    defaultThreshold: 50000, // 50mm
    minThreshold: 1000,      // 1mm
    maxThreshold: 500000,    // 500mm
    icon: '🌧️',
  },
  {
    type: 'Precip1hGte',
    label: 'Hourly Rainfall',
    description: 'Triggers when any single hour exceeds threshold',
    unit: 'MmX1000',
    unitLabel: 'mm/hour',
    defaultThreshold: 20000, // 20mm
    minThreshold: 1000,
    maxThreshold: 200000,
    icon: '⛈️',
  },
  {
    type: 'TempMaxGte',
    label: 'Max Temperature',
    description: 'Triggers when maximum temperature exceeds threshold',
    unit: 'CelsiusX1000',
    unitLabel: '°C',
    defaultThreshold: 35000, // 35°C
    minThreshold: 20000,
    maxThreshold: 50000,
    icon: '🌡️',
  },
  {
    type: 'TempMinLte',
    label: 'Min Temperature',
    description: 'Triggers when minimum temperature falls below threshold',
    unit: 'CelsiusX1000',
    unitLabel: '°C',
    defaultThreshold: 5000, // 5°C
    minThreshold: -20000,
    maxThreshold: 20000,
    icon: '❄️',
  },
  {
    type: 'WindGustMaxGte',
    label: 'Wind Gust',
    description: 'Triggers when maximum wind gust exceeds threshold',
    unit: 'MpsX1000',
    unitLabel: 'm/s',
    defaultThreshold: 20000, // 20 m/s
    minThreshold: 5000,
    maxThreshold: 100000,
    icon: '💨',
  },
  {
    type: 'PrecipTypeOccurred',
    label: 'Precipitation Type',
    description: 'Triggers when specific precipitation type occurs (hail, snow, etc.)',
    unit: 'PrecipTypeMask',
    unitLabel: 'type mask',
    defaultThreshold: 1, // Any type
    minThreshold: 1,
    maxThreshold: 255,
    icon: '🌨️',
  },
];

// =============================================================================
// Location
// =============================================================================

export interface V3Location {
  id: number;
  name: string;
  accuweatherKey: string;
  latitude: number;  // Scaled by 1e6
  longitude: number; // Scaled by 1e6
  active: boolean;
}

// =============================================================================
// Request Status
// =============================================================================

export type V3RequestStatus = 
  | 'Pending'         // No acceptances yet
  | 'PartiallyFilled' // Some shares accepted
  | 'FullyFilled'     // All shares accepted
  | 'Cancelled'       // Requester cancelled
  | 'Expired';        // Request expired

// =============================================================================
// Underwrite Request
// =============================================================================

export interface V3Request {
  id: number;
  requester: string;
  locationId: number;
  location?: V3Location;
  eventSpec: V3EventSpec;
  totalShares: number;
  filledShares: number;
  premiumPerShare: bigint;  // USDT with 6 decimals
  payoutPerShare: bigint;   // Always $100 = 100_000_000
  coverageStart: number;    // Unix timestamp
  coverageEnd: number;      // Unix timestamp
  expiresAt: number;        // Unix timestamp
  status: V3RequestStatus;
  createdAt: number;        // Unix timestamp
}

// Form data for creating a request
export interface V3CreateRequestParams {
  locationId: number;
  eventSpec: V3EventSpec;
  totalShares: number;
  premiumPerShare: bigint;
  coverageStart: number;
  coverageEnd: number;
  expiresAt: number;
}

// =============================================================================
// Policy Status
// =============================================================================

export type V3PolicyStatus = 
  | 'Active'    // Coverage active, monitoring
  | 'Triggered' // Event occurred
  | 'Matured'   // Coverage ended, no event
  | 'Settled';  // Payouts distributed

// =============================================================================
// V3 Policy
// =============================================================================

export interface V3Policy {
  id: number;
  holder: string;           // Requester (policyholder)
  locationId: number;
  location?: V3Location;
  eventSpec: V3EventSpec;
  totalShares: number;
  premiumPaid: bigint;
  maxPayout: bigint;
  coverageStart: number;
  coverageEnd: number;
  status: V3PolicyStatus;
  createdAt: number;
}

// =============================================================================
// Oracle State
// =============================================================================

export type V3AggState = 
  | { type: 'PrecipSum'; sumMmX1000: number }
  | { type: 'Precip1hMax'; max1hMmX1000: number }
  | { type: 'TempMax'; maxCX1000: number }
  | { type: 'TempMin'; minCX1000: number }
  | { type: 'WindGustMax'; maxMpsX1000: number }
  | { type: 'PrecipTypeOccurred'; mask: number };

export interface V3OracleState {
  policyId: number;
  eventSpec: V3EventSpec;
  aggState: V3AggState;
  observedUntil: number;
  commitment: string;
  status: V3PolicyStatus;
}

// =============================================================================
// LP Holdings
// =============================================================================

export interface V3LpHolding {
  policyId: number;
  policy?: V3Policy;
  holder: string;
  lpShares: number;
  percentageOwned: number;
}

// =============================================================================
// Acceptance Record
// =============================================================================

export interface V3Acceptance {
  requestId: number;
  underwriter: string;
  shares: number;
  collateralLocked: bigint;
  acceptedAt: number;
}

// =============================================================================
// Utility Functions
// =============================================================================

export function formatThresholdValue(value: number, unit: V3ThresholdUnit | string): string {
  // Normalize unit to handle different formats from chain
  const normalizedUnit = normalizeUnit(unit);
  
  switch (normalizedUnit) {
    case 'MmX1000':
      return `${(value / 1000).toFixed(1)} mm`;
    case 'CelsiusX1000':
      return `${(value / 1000).toFixed(1)}°C`;
    case 'MpsX1000':
      return `${(value / 1000).toFixed(1)} m/s`;
    case 'PrecipTypeMask':
      return `mask ${value}`;
    default:
      // Fallback: if unit contains mm, celsius, mps, format accordingly
      if (unit.toLowerCase().includes('mm')) {
        return `${(value / 1000).toFixed(1)} mm`;
      }
      if (unit.toLowerCase().includes('celsius')) {
        return `${(value / 1000).toFixed(1)}°C`;
      }
      if (unit.toLowerCase().includes('mps')) {
        return `${(value / 1000).toFixed(1)} m/s`;
      }
      return value.toString();
  }
}

// Helper to normalize unit strings from chain
function normalizeUnit(unit: string): string {
  const mapping: Record<string, string> = {
    'mm_x1000': 'MmX1000',
    'celsius_x1000': 'CelsiusX1000',
    'mps_x1000': 'MpsX1000',
    'precip_type_mask': 'PrecipTypeMask',
    'MmX1000': 'MmX1000',
    'CelsiusX1000': 'CelsiusX1000',
    'MpsX1000': 'MpsX1000',
    'PrecipTypeMask': 'PrecipTypeMask',
  };
  return mapping[unit] || unit;
}

export function getEventTypeInfo(type: V3EventType): V3EventTypeInfo | undefined {
  return V3_EVENT_TYPES.find(e => e.type === type);
}

export function getRemainingShares(request: V3Request): number {
  return request.totalShares - request.filledShares;
}

export function isRequestAcceptable(request: V3Request): boolean {
  return (
    (request.status === 'Pending' || request.status === 'PartiallyFilled') &&
    request.expiresAt > Math.floor(Date.now() / 1000)
  );
}

export function calculateTotalPremium(shares: number, premiumPerShare: bigint): bigint {
  return BigInt(shares) * premiumPerShare;
}

export function calculateCollateral(shares: number): bigint {
  // $100 per share = 100_000_000 (6 decimals)
  return BigInt(shares) * BigInt(100_000_000);
}

