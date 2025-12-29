// Market Types
export interface Market {
  id: number;
  name: string;
  centerLatitude: number;
  centerLongitude: number;
  timezoneOffsetHours: number; // UTC offset in hours (e.g., 8 for Manila, 9 for Tokyo)
  strikeValue: number; // rainfall threshold in mm
  payoutPerShare: bigint;
  status: MarketStatus;
  riskParameters: RiskParameters;
  windowRules: WindowRules;
  accuWeatherLocationKey?: string;
}

export type MarketStatus = 'Open' | 'Closed' | 'Settled';

export interface RiskParameters {
  daoMarginBp: number; // basis points, e.g., 2000 = 20%
}

export interface WindowRules {
  minDurationSecs: number;
  maxDurationSecs: number;
  minLeadTimeSecs: number;
}

// Policy Types
export interface Policy {
  id: string; // H128 hash ID as hex string (e.g., "0x3a7f8b2c...")
  label: string; // Human-readable label like "manila-1", "tokyo-2"
  marketId: number;
  holder: string;
  coverageStart: number; // unix timestamp
  coverageEnd: number;
  shares: bigint;
  status: PolicyStatus;
  premiumPaid: bigint;
  maxPayout: bigint;
  capitalPool: CapitalPool;
  createdAt: number; // unix timestamp - when policy was created
  // V2 fields
  policyVersion: PolicyVersion;
  eventType: EventType;
  earlyTrigger: boolean;
  oracleStatusV2?: V2OracleStatus;
  strikeMm?: number;
}

// V2 Policy Types
export type PolicyVersion = 'V1' | 'V2';
export type EventType = 'Rainfall24hRolling' | 'CumulativeRainfallWindow';
export type V2OracleStatus = 'PendingMonitoring' | 'Monitoring' | 'TriggeredReported' | 'MaturedReported' | 'Settled';
export type V2Outcome = 'Triggered' | 'MaturedNoEvent';

export interface CapitalPool {
  totalCapital: bigint;
  totalShares: number;
  lpHolders: string[];
}

export type PolicyStatus = 'Active' | 'Expired' | 'Settled' | 'Cancelled';

// Quote Types
export interface QuoteRequest {
  id: string; // H128 hash ID as hex string
  marketId: number;
  requester: string;
  coverageStart: number;
  coverageEnd: number;
  shares: number;
  requestedAt: number;
  result: QuoteResult | null;
  // V2 fields
  policyVersion: PolicyVersion;
  eventType: EventType;
  earlyTrigger: boolean;
  durationDays: number;
}

export interface QuoteResult {
  fairPremiumUsdt: bigint;
  premiumUsdt: bigint;
  probabilityPercent: number; // Event probability in percent * 100 (e.g., 1000 = 10.00%)
}

// LP Token Types
export interface LpHolding {
  policyId: string; // H128 hash ID as hex string
  holder: string;
  shares: bigint;
  lockedShares: bigint;
}

// Orderbook Types
export interface LpAskOrder {
  orderId: string; // H128 hash ID as hex string
  policyId: string; // H128 hash ID as hex string
  seller: string;
  priceUsdt: bigint;
  quantity: bigint;
  remaining: bigint;
  createdAt: number;
}

// Trade History Types
export interface LpTradeRecord {
  id: string;
  type: 'buy' | 'sell';
  policyId: string; // H128 hash ID as hex string
  marketName: string;
  shares: number;
  pricePerShare: number; // in USDT
  totalAmount: number; // in USDT
  timestamp: number;
  trader: string; // The account that executed this trade
  counterparty?: string;
  txHash?: string;
}

// LP Position Outcome
export interface LpPositionOutcome {
  policyId: string; // H128 hash ID as hex string
  marketId: number;
  marketName: string;
  sharesHeld: number;
  investmentCost: number; // Total amount paid for LP tokens
  outcome: 'matured' | 'event_triggered' | 'active';
  payoutReceived: number; // Amount received (if matured) or 0 (if event triggered)
  profitLoss: number; // payoutReceived - investmentCost
  settledAt?: number;
  eventOccurred?: boolean;
}

// Oracle Types
export interface RainfallData {
  locationId: number;
  bucketIndex: number;
  timestamp: number;
  rainfallMm: number; // scaled by 10 (tenths of mm)
}

export interface RollingWindowState {
  lastBucketIndex: number;
  oldestBucketIndex: number;
  rollingSumMm: number; // scaled by 10 (tenths of mm)
}

// Wallet Types
export interface WalletAccount {
  address: string;
  name?: string;
  source: string;
}

export interface WalletState {
  isConnected: boolean;
  selectedAccount: WalletAccount | null;
  accounts: WalletAccount[];
  balance: {
    prmx: bigint;
    usdt: bigint;
  };
}

// UI Types
export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

export interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon?: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Notification Types
export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
}

// DeFi Strategy Types (Hydration Stableswap Pool 102)
export type InvestmentStatus = 'NotInvested' | 'Invested' | 'Unwinding' | 'Settled' | 'Failed';

export interface LpPosition {
  policyId: string; // H128 hash ID as hex string
  lpShares: bigint;
  principalUsdt: bigint;
}

export interface DaoSolvencyInfo {
  daoBalance: bigint;
  totalAllocatedCapital: bigint;
  totalLpShares: bigint;
  activePositionsCount: number;
  allocationPercentagePpm: number; // parts per million, 1_000_000 = 100%
  isSolvent: boolean; // true if DAO can cover all potential losses
}

export interface PolicyDefiInfo {
  investmentStatus: InvestmentStatus;
  position: LpPosition | null;
  isAllocatedToDefi: boolean;
  poolAccount?: string;
}

// V2 Oracle Monitor Types (from MongoDB)
export type V2MonitorState = 'monitoring' | 'triggered' | 'matured' | 'reported';

export interface V2Monitor {
  _id: string;              // Composite UID: "0:42" (market_id:policy_id)
  market_id: number;
  policy_id: number;
  coverage_start: number;   // Unix timestamp
  coverage_end: number;     // Unix timestamp
  strike_mm: number;        // Strike threshold in mm (scaled by 10)
  lat: number;
  lon: number;
  state: V2MonitorState;
  cumulative_mm: number;    // Current cumulative rainfall (scaled by 10)
  trigger_time?: number;    // Unix timestamp when triggered
  last_fetch_at: number;    // Unix timestamp of last AccuWeather fetch
  location_key: string;     // AccuWeather location key
  report_tx_hash?: string;  // On-chain report transaction hash
  evidence_hash?: string;   // Evidence JSON hash
  created_at: string;       // ISO date string
  updated_at: string;       // ISO date string
}

export interface V2MonitorStats {
  total: number;
  monitoring: number;
  triggered: number;
  matured: number;
  reported: number;
  active: number;
}
