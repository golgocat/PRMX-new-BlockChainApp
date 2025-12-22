'use client';

import { useState, useEffect, useCallback, useRef, useTransition } from 'react';
import { useWalletStore } from '@/stores/walletStore';
import * as api from '@/lib/api';
import type { Market, Policy, QuoteRequest, LpAskOrder, LpHolding, LpTradeRecord, LpPositionOutcome } from '@/types';

// Default polling interval for real-time updates (15 seconds - smoother UX)
const DEFAULT_POLL_INTERVAL = 15000;
// Faster polling for critical real-time data (10 seconds)
const FAST_POLL_INTERVAL = 10000;

/**
 * Hook to fetch and refresh markets data with optional polling
 * @param pollInterval - Polling interval in ms (default 0 = no polling for static data)
 */
export function useMarkets(pollInterval: number = 0) {
  const { isChainConnected } = useWalletStore();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected) return;
    
    if (!silent) {
      setLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError(null);
    
    try {
      const data = await api.getMarkets();
      if (silent) {
        startTransition(() => {
          setMarkets(data);
        });
      } else {
        setMarkets(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch markets');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [isChainConnected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Optional auto-polling
  useEffect(() => {
    if (!isChainConnected || pollInterval <= 0) return;
    
    const interval = setInterval(() => {
      refresh(true);
    }, pollInterval);
    
    return () => clearInterval(interval);
  }, [isChainConnected, pollInterval, refresh]);

  return { markets, loading, isRefreshing: isRefreshing || isPending, error, refresh: () => refresh(false) };
}

/**
 * Hook to fetch a single market
 */
export function useMarket(marketId: number | null) {
  const { isChainConnected } = useWalletStore();
  const [market, setMarket] = useState<Market | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isChainConnected || marketId === null) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await api.getMarket(marketId);
      setMarket(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch market');
    } finally {
      setLoading(false);
    }
  }, [isChainConnected, marketId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { market, loading, error, refresh };
}

/**
 * Hook to fetch all policies with automatic polling for real-time updates
 * @param pollInterval - Polling interval in ms (default 15s, set to 0 to disable)
 */
export function usePolicies(pollInterval: number = DEFAULT_POLL_INTERVAL) {
  const { isChainConnected } = useWalletStore();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFirstLoad = useRef(true);
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected) return;
    
    // Only show loading on first load, not on polls
    if (!silent) {
      setLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError(null);
    
    try {
      const data = await api.getPolicies();
      // Use transition for smoother updates during polling
      if (silent) {
        startTransition(() => {
          setPolicies(data);
        });
      } else {
        setPolicies(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch policies');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
      isFirstLoad.current = false;
    }
  }, [isChainConnected]);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-polling for real-time updates
  useEffect(() => {
    if (!isChainConnected || pollInterval <= 0) return;
    
    const interval = setInterval(() => {
      refresh(true); // Silent refresh (no loading state)
    }, pollInterval);
    
    return () => clearInterval(interval);
  }, [isChainConnected, pollInterval, refresh]);

  return { policies, loading, isRefreshing: isRefreshing || isPending, error, refresh: () => refresh(false) };
}

/**
 * Hook to fetch policies for current user with automatic polling
 * @param pollInterval - Polling interval in ms (default 10s, set to 0 to disable)
 */
export function useMyPolicies(pollInterval: number = DEFAULT_POLL_INTERVAL) {
  const { isChainConnected, selectedAccount } = useWalletStore();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isFirstLoad = useRef(true);

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected || !selectedAccount) return;
    
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    
    try {
      const data = await api.getPoliciesByHolder(selectedAccount.address);
      setPolicies(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch policies');
    } finally {
      setLoading(false);
      isFirstLoad.current = false;
    }
  }, [isChainConnected, selectedAccount]);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-polling for real-time updates
  useEffect(() => {
    if (!isChainConnected || !selectedAccount || pollInterval <= 0) return;
    
    const interval = setInterval(() => {
      refresh(true);
    }, pollInterval);
    
    return () => clearInterval(interval);
  }, [isChainConnected, selectedAccount, pollInterval, refresh]);

  return { policies, loading, error, refresh: () => refresh(false) };
}

/**
 * Hook to fetch LP orders from orderbook
 * Filters out orders for expired/settled policies
 */
export function useLpOrders() {
  const { isChainConnected } = useWalletStore();
  const [orders, setOrders] = useState<LpAskOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isChainConnected) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // Fetch both orders and policies to filter expired ones
      const [orderData, policies] = await Promise.all([
        api.getLpOrders(),
        api.getPolicies(),
      ]);
      
      const now = Math.floor(Date.now() / 1000);
      
      // Create a map of policy ID to policy for quick lookup
      const policyMap = new Map(policies.map(p => [p.id, p]));
      
      // Filter orders:
      // 1. Must have remaining quantity > 0
      // 2. Policy must exist and be Active
      // 3. Policy coverage must not have ended
      const validOrders = orderData.filter(order => {
        if (order.remaining <= BigInt(0)) return false;
        
        const policy = policyMap.get(order.policyId);
        if (!policy) return false;
        
        // Filter out settled policies
        if (policy.status !== 'Active') return false;
        
        // Filter out expired policies (coverage ended)
        if (policy.coverageEnd <= now) return false;
        
        return true;
      });
      
      setOrders(validOrders);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch orders');
    } finally {
      setLoading(false);
    }
  }, [isChainConnected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { orders, loading, error, refresh };
}

/**
 * Hook to fetch LP holdings for current user
 */
export function useMyLpHoldings() {
  const { isChainConnected, selectedAccount } = useWalletStore();
  const [holdings, setHoldings] = useState<LpHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isChainConnected || !selectedAccount) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await api.getLpHoldings(selectedAccount.address);
      setHoldings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch LP holdings');
    } finally {
      setLoading(false);
    }
  }, [isChainConnected, selectedAccount]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { holdings, loading, error, refresh };
}

/**
 * Hook to fetch rainfall data for a market
 */
export function useRainfallData(marketId: number | null) {
  const { isChainConnected } = useWalletStore();
  const [rainfallData, setRainfallData] = useState<{
    rollingSumMm: number;
    lastUpdated: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isChainConnected || marketId === null) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await api.getRollingRainfallSum(marketId);
      if (data) {
        setRainfallData({
          rollingSumMm: data.rollingSumMm / 10, // Convert from scaled
          lastUpdated: data.lastBucketIndex * 3600,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch rainfall data');
    } finally {
      setLoading(false);
    }
  }, [isChainConnected, marketId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { rainfallData, loading, error, refresh };
}

/**
 * Hook to get dashboard stats with automatic polling
 * @param pollInterval - Polling interval in ms (default 15s, set to 0 to disable)
 */
export function useDashboardStats(pollInterval: number = DEFAULT_POLL_INTERVAL) {
  const { isChainConnected, selectedAccount } = useWalletStore();
  const [stats, setStats] = useState({
    totalMarkets: 0,
    totalPolicies: 0,
    activePolicies: 0,
    myPolicies: 0,
    myActivePolicies: 0,
    totalLpOrders: 0,
    myLpHoldings: 0,
  });
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isFirstLoad = useRef(true);
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected) return;
    
    if (!silent) {
      setLoading(true);
    } else {
      setIsRefreshing(true);
    }
    
    try {
      const [markets, policies, orders] = await Promise.all([
        api.getMarkets(),
        api.getPolicies(),
        api.getLpOrders(),
      ]);

      const now = Math.floor(Date.now() / 1000);
      const activePolicies = policies.filter(p => 
        p.status === 'Active' && p.coverageEnd > now
      );

      let myPolicies: Policy[] = [];
      let myHoldings: LpHolding[] = [];
      
      if (selectedAccount) {
        myPolicies = policies.filter(p => p.holder === selectedAccount.address);
        myHoldings = await api.getLpHoldings(selectedAccount.address);
      }

      const newStats = {
        totalMarkets: markets.length,
        totalPolicies: policies.length,
        activePolicies: activePolicies.length,
        myPolicies: myPolicies.length,
        myActivePolicies: myPolicies.filter(p => p.status === 'Active').length,
        totalLpOrders: orders.filter(o => o.remaining > BigInt(0)).length,
        myLpHoldings: myHoldings.length,
      };

      // Use transition for smoother updates during polling
      if (silent) {
        startTransition(() => {
          setStats(newStats);
        });
      } else {
        setStats(newStats);
      }
    } catch (err) {
      console.error('Failed to fetch dashboard stats:', err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
      isFirstLoad.current = false;
    }
  }, [isChainConnected, selectedAccount]);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-polling
  useEffect(() => {
    if (!isChainConnected || pollInterval <= 0) return;
    
    const interval = setInterval(() => {
      refresh(true);
    }, pollInterval);
    
    return () => clearInterval(interval);
  }, [isChainConnected, pollInterval, refresh]);

  return { stats, loading, isRefreshing: isRefreshing || isPending, refresh: () => refresh(false) };
}

/**
 * Hook to get quote requests
 */
export function useQuoteRequests() {
  const { isChainConnected } = useWalletStore();
  const [quotes, setQuotes] = useState<QuoteRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isChainConnected) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await api.getQuoteRequests();
      setQuotes(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch quotes');
    } finally {
      setLoading(false);
    }
  }, [isChainConnected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { quotes, loading, error, refresh };
}

// ============================================================================
// Trade History (localStorage-based)
// ============================================================================

const TRADE_HISTORY_KEY = 'prmx_lp_trade_history';

/**
 * Get all trade history from localStorage (unfiltered)
 */
export function getAllTradeHistory(): LpTradeRecord[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const stored = localStorage.getItem(TRADE_HISTORY_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

/**
 * Get trade history from localStorage filtered by trader address
 */
export function getTradeHistory(traderAddress?: string): LpTradeRecord[] {
  const allTrades = getAllTradeHistory();
  
  // Filter by trader address if provided
  if (traderAddress) {
    return allTrades.filter(trade => trade.trader === traderAddress);
  }
  
  return allTrades;
}

/**
 * Add a trade to history
 * @param trade - Trade record (must include trader address)
 */
export function addTradeToHistory(trade: Omit<LpTradeRecord, 'id'>): void {
  if (typeof window === 'undefined') return;
  if (!trade.trader) {
    console.warn('addTradeToHistory: trader address is required');
    return;
  }
  
  const trades = getAllTradeHistory();
  const newTrade: LpTradeRecord = {
    ...trade,
    id: `${trade.trader.slice(0, 10)}-${trade.timestamp}-${trade.policyId}-${Math.random().toString(36).slice(2, 8)}`,
  };
  
  trades.unshift(newTrade); // Add to beginning
  
  // Keep only last 100 trades per storage (global limit)
  const trimmed = trades.slice(0, 100);
  
  localStorage.setItem(TRADE_HISTORY_KEY, JSON.stringify(trimmed));
}

/**
 * Hook to manage trade history for the current signed-in account
 */
export function useTradeHistory() {
  const { selectedAccount } = useWalletStore();
  const [trades, setTrades] = useState<LpTradeRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    // Filter by signed-in account address
    const history = getTradeHistory(selectedAccount?.address);
    setTrades(history);
    setLoading(false);
  }, [selectedAccount?.address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addTrade = useCallback((trade: Omit<LpTradeRecord, 'id' | 'trader'>) => {
    if (!selectedAccount?.address) {
      console.warn('Cannot add trade: no account selected');
      return;
    }
    addTradeToHistory({
      ...trade,
      trader: selectedAccount.address,
    });
    refresh();
  }, [refresh, selectedAccount?.address]);

  const clearHistory = useCallback(() => {
    if (typeof window !== 'undefined' && selectedAccount?.address) {
      // Only clear trades for the current account
      const allTrades = getAllTradeHistory();
      const otherTrades = allTrades.filter(t => t.trader !== selectedAccount.address);
      localStorage.setItem(TRADE_HISTORY_KEY, JSON.stringify(otherTrades));
      setTrades([]);
    }
  }, [selectedAccount?.address]);

  return { trades, loading, refresh, addTrade, clearHistory };
}

/**
 * Hook to get LP position outcomes (settled positions)
 */
export function useLpPositionOutcomes() {
  const { isChainConnected, selectedAccount } = useWalletStore();
  const [outcomes, setOutcomes] = useState<LpPositionOutcome[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isChainConnected || !selectedAccount) {
      setOutcomes([]);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      // Get all policies and markets
      const [policies, markets, holdings] = await Promise.all([
        api.getPolicies(),
        api.getMarkets(),
        api.getLpHoldings(selectedAccount.address),
      ]);
      
      // Get trade history for cost basis (filtered by current account)
      const trades = getTradeHistory(selectedAccount.address);
      
      const marketMap = new Map(markets.map(m => [m.id, m]));
      const holdingsMap = new Map(holdings.map(h => [h.policyId, h]));
      
      const positionOutcomes: LpPositionOutcome[] = [];
      
      // Check all policies where user has/had holdings
      const relevantPolicyIds = new Set([
        ...holdings.map(h => h.policyId),
        ...trades.filter(t => t.type === 'buy').map(t => t.policyId),
      ]);
      
      for (const policyId of relevantPolicyIds) {
        const policy = policies.find(p => p.id === policyId);
        if (!policy) continue;
        
        const market = marketMap.get(policy.marketId);
        const holding = holdingsMap.get(policyId);
        const currentShares = holding ? Number(holding.shares) : 0;
        
        // Calculate investment cost from trade history
        const policyTrades = trades.filter(t => t.policyId === policyId);
        const totalBuyCost = policyTrades
          .filter(t => t.type === 'buy')
          .reduce((sum, t) => sum + t.totalAmount, 0);
        const totalSellRevenue = policyTrades
          .filter(t => t.type === 'sell')
          .reduce((sum, t) => sum + t.totalAmount, 0);
        const netCost = totalBuyCost - totalSellRevenue;
        
        // Check if policy is settled
        let outcome: LpPositionOutcome['outcome'] = 'active';
        let payoutReceived = 0;
        let settledAt: number | undefined;
        let eventOccurred: boolean | undefined;
        
        if (policy.status === 'Settled') {
          try {
            const settlement = await api.getSettlementResult(policyId);
            if (settlement) {
              eventOccurred = settlement.eventOccurred;
              settledAt = settlement.settledAt;
              
              if (settlement.eventOccurred) {
                // Event occurred - LPs lost their capital
                outcome = 'event_triggered';
                payoutReceived = 0;
              } else {
                // Policy matured - LPs get their capital back
                outcome = 'matured';
                // Calculate share of returned capital
                const shareRatio = currentShares / policy.capitalPool.totalShares;
                payoutReceived = Number(settlement.returnedToLps) / 1_000_000 * shareRatio;
              }
            }
          } catch (err) {
            console.error(`Failed to get settlement for policy ${policyId}:`, err);
          }
        } else if (policy.status === 'Expired') {
          outcome = 'matured';
          // If expired but not settled yet, estimate payout
          const payoutPerShare = market ? Number(market.payoutPerShare) / 1_000_000 : 100;
          payoutReceived = currentShares * payoutPerShare;
        }
        
        positionOutcomes.push({
          policyId,
          marketId: policy.marketId,
          marketName: market?.name || `Market ${policy.marketId}`,
          sharesHeld: currentShares,
          investmentCost: netCost,
          outcome,
          payoutReceived,
          profitLoss: payoutReceived - netCost,
          settledAt,
          eventOccurred,
        });
      }
      
      // Sort by settlement time (most recent first), then by policy ID
      positionOutcomes.sort((a, b) => {
        if (a.settledAt && b.settledAt) return b.settledAt - a.settledAt;
        if (a.settledAt) return -1;
        if (b.settledAt) return 1;
        return b.policyId - a.policyId;
      });
      
      setOutcomes(positionOutcomes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch position outcomes');
    } finally {
      setLoading(false);
    }
  }, [isChainConnected, selectedAccount]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { outcomes, loading, error, refresh };
}
