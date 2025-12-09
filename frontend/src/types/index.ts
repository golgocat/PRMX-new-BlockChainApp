// Market Types
export interface Market {
  id: number;
  name: string;
  centerLatitude: number;
  centerLongitude: number;
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
  id: number;
  marketId: number;
  holder: string;
  coverageStart: number; // unix timestamp
  coverageEnd: number;
  shares: bigint;
  status: PolicyStatus;
  premiumPaid: bigint;
  maxPayout: bigint;
  capitalPool: CapitalPool;
}

export interface CapitalPool {
  totalCapital: bigint;
  totalShares: number;
  lpHolders: string[];
}

export type PolicyStatus = 'Active' | 'Expired' | 'Settled' | 'Cancelled';

// Quote Types
export interface QuoteRequest {
  id: number;
  marketId: number;
  requester: string;
  coverageStart: number;
  coverageEnd: number;
  shares: number;
  requestedAt: number;
  result: QuoteResult | null;
}

export interface QuoteResult {
  fairPremiumUsdt: bigint;
  premiumUsdt: bigint;
  probabilityPercent: number; // Event probability in percent * 100 (e.g., 1000 = 10.00%)
}

// LP Token Types
export interface LpHolding {
  policyId: number;
  holder: string;
  shares: bigint;
  lockedShares: bigint;
}

// Orderbook Types
export interface LpAskOrder {
  orderId: number;
  policyId: number;
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
  policyId: number;
  marketName: string;
  shares: number;
  pricePerShare: number; // in USDT
  totalAmount: number; // in USDT
  timestamp: number;
  counterparty?: string;
  txHash?: string;
}

// LP Position Outcome
export interface LpPositionOutcome {
  policyId: number;
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
