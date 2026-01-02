'use client';

import { useState, useEffect, useCallback, useRef, useTransition } from 'react';
import { useWalletStore } from '@/stores/walletStore';
import * as api from '@/lib/api';
import * as apiV3 from '@/lib/api-v3';
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
      if (!silent) setLoading(false);
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

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected || marketId === null) return;
    
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    
    try {
      const data = await api.getMarket(marketId);
      setMarket(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch market');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [isChainConnected, marketId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { market, loading, error, refresh: (silent = false) => refresh(silent) };
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
      if (!silent) setLoading(false);
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
      if (!silent) setLoading(false);
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

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected) return;
    
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    
    try {
      // Fetch orders and both V1/V2 and V3 policies to filter expired ones
      const [orderData, v1v2Policies, v3Policies] = await Promise.all([
        api.getLpOrders(),
        api.getPolicies(),
        apiV3.getV3Policies(),
      ]);
      
      const now = Math.floor(Date.now() / 1000);
      
      // Create a unified map of policy ID to policy info for quick lookup
      // Include both V1/V2 and V3 policies
      const policyMap = new Map<number, { status: string; coverageEnd: number }>();
      
      // Add V1/V2 policies
      for (const p of v1v2Policies) {
        policyMap.set(p.id, { status: p.status, coverageEnd: p.coverageEnd });
      }
      
      // Add V3 policies (adapt to same format)
      for (const p of v3Policies) {
        policyMap.set(p.id, { status: p.status, coverageEnd: p.coverageEnd });
      }
      
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
      if (!silent) {
        setLoading(false);
      }
    }
  }, [isChainConnected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { orders, loading, error, refresh: (silent = false) => refresh(silent) };
}

/**
 * Hook to fetch LP holdings for current user
 * If user is DAO Admin, also includes DAO Treasury holdings
 */
export function useMyLpHoldings() {
  const { isChainConnected, selectedAccount } = useWalletStore();
  const [holdings, setHoldings] = useState<LpHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected || !selectedAccount) return;
    
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    
    try {
      // Fetch user's own holdings
      const userHoldings = await api.getLpHoldings(selectedAccount.address);
      
      // If user is DAO Admin, also fetch DAO Treasury holdings
      const isDaoAdmin = selectedAccount.role === 'DAO Admin';
      if (isDaoAdmin) {
        const daoAddress = api.TEST_ACCOUNTS.daoCapital.address;
        const daoHoldings = await api.getLpHoldings(daoAddress);
        
        // Mark DAO holdings with a flag and merge
        const markedDaoHoldings = daoHoldings.map(h => ({
          ...h,
          _isDaoHolding: true,
        }));
        
        // Merge holdings, avoiding duplicates (same policyId)
        const allHoldings = [...userHoldings];
        for (const daoHolding of markedDaoHoldings) {
          const existing = allHoldings.find(h => h.policyId === daoHolding.policyId);
          if (!existing) {
            allHoldings.push(daoHolding);
          }
        }
        
        setHoldings(allHoldings);
      } else {
        setHoldings(userHoldings);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch LP holdings');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [isChainConnected, selectedAccount]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { holdings, loading, error, refresh: (silent = false) => refresh(silent) };
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

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected || marketId === null) return;
    
    if (!silent) {
      setLoading(true);
    }
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
      if (!silent) {
        setLoading(false);
      }
    }
  }, [isChainConnected, marketId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { rainfallData, loading, error, refresh: (silent = false) => refresh(silent) };
}

/**
 * Hook to get dashboard stats with automatic polling
 * Includes both V1/V2 and V3 policies and orders
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
      // Fetch V1/V2 data
      const [markets, policies, orders] = await Promise.all([
        api.getMarkets(),
        api.getPolicies(),
        api.getLpOrders(),
      ]);
      
      // Fetch V3 data (in parallel, with graceful error handling)
      let v3Policies: Awaited<ReturnType<typeof apiV3.getV3Policies>> = [];
      let v3OpenRequests: Awaited<ReturnType<typeof apiV3.getV3OpenRequests>> = [];
      let v3LpHoldings: Awaited<ReturnType<typeof apiV3.getV3LpHoldings>> = [];
      
      try {
        const [v3P, v3R] = await Promise.all([
          apiV3.getV3Policies(),
          apiV3.getV3OpenRequests(),
        ]);
        v3Policies = v3P;
        v3OpenRequests = v3R;
      } catch (err) {
        console.warn('Failed to fetch V3 data for dashboard:', err);
      }

      const now = Math.floor(Date.now() / 1000);
      
      // V1/V2 active policies
      const v1v2ActivePolicies = policies.filter(p => 
        p.status === 'Active' && p.coverageEnd > now
      );
      
      // V3 active policies
      const v3ActivePolicies = v3Policies.filter(p => 
        p.status === 'Active' && p.coverageEnd > now
      );

      let myPolicies: Policy[] = [];
      let myV3Policies: typeof v3Policies = [];
      let myHoldings: LpHolding[] = [];
      
      if (selectedAccount) {
        myPolicies = policies.filter(p => p.holder === selectedAccount.address);
        myV3Policies = v3Policies.filter(p => p.holder === selectedAccount.address);
        
        // Get V1/V2 LP holdings
        myHoldings = await api.getLpHoldings(selectedAccount.address);
        
        // Get V3 LP holdings
        try {
          v3LpHoldings = await apiV3.getV3LpHoldings(selectedAccount.address);
        } catch (err) {
          console.warn('Failed to fetch V3 LP holdings:', err);
        }
      }

      // Combined stats
      const totalPolicies = policies.length + v3Policies.length;
      const activePolicies = v1v2ActivePolicies.length + v3ActivePolicies.length;
      const myTotalPolicies = myPolicies.length + myV3Policies.length;
      const myActivePolicies = myPolicies.filter(p => p.status === 'Active' && p.coverageEnd > now).length +
                               myV3Policies.filter(p => p.status === 'Active' && p.coverageEnd > now).length;
      
      // LP Orders: V1/V2 orders with remaining > 0 + V3 open requests (pending underwriting)
      const v1v2OpenOrders = orders.filter(o => o.remaining > BigInt(0)).length;
      const v3OpenRequestCount = v3OpenRequests.length;
      const totalLpOrders = v1v2OpenOrders + v3OpenRequestCount;
      
      // LP Holdings: V1/V2 + V3
      const totalHoldings = myHoldings.length + v3LpHoldings.length;

      const newStats = {
        totalMarkets: markets.length,
        totalPolicies,
        activePolicies,
        myPolicies: myTotalPolicies,
        myActivePolicies,
        totalLpOrders,
        myLpHoldings: totalHoldings,
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
      if (!silent) setLoading(false);
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

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected) return;
    
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    
    try {
      const data = await api.getQuoteRequests();
      setQuotes(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch quotes');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [isChainConnected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { quotes, loading, error, refresh: (silent = false) => refresh(silent) };
}

// ============================================================================
// Trade History (localStorage-based with chain reset detection)
// ============================================================================

const TRADE_HISTORY_KEY = 'prmx_lp_trade_history';
const TRADE_HISTORY_GENESIS_KEY = 'prmx_lp_trade_history_genesis';

// Store for current genesis hash (set by validateTradeHistoryGenesis)
let cachedGenesisHash: string | null = null;

/**
 * Validate trade history against current chain genesis hash
 * Clears history if chain was reset (genesis hash changed)
 * @returns true if history was cleared (chain reset detected)
 */
export async function validateTradeHistoryGenesis(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  
  try {
    const api = await getApi();
    const currentGenesis = api.genesisHash.toHex();
    cachedGenesisHash = currentGenesis;
    
    const storedGenesis = localStorage.getItem(TRADE_HISTORY_GENESIS_KEY);
    
    let wasCleared = false;
    
    if (storedGenesis && storedGenesis !== currentGenesis) {
      console.log('[TradeHistory] Chain reset detected - clearing old trade history');
      console.log(`  Previous genesis: ${storedGenesis.slice(0, 18)}...`);
      console.log(`  Current genesis:  ${currentGenesis.slice(0, 18)}...`);
      localStorage.removeItem(TRADE_HISTORY_KEY);
      wasCleared = true;
    } else if (!storedGenesis) {
      // First time - also check if there's stale trade history
      const existingTrades = localStorage.getItem(TRADE_HISTORY_KEY);
      if (existingTrades) {
        console.log('[TradeHistory] No stored genesis but trades exist - clearing stale history');
        localStorage.removeItem(TRADE_HISTORY_KEY);
        wasCleared = true;
      }
    }
    
    // Store current genesis
    localStorage.setItem(TRADE_HISTORY_GENESIS_KEY, currentGenesis);
    return wasCleared;
  } catch (error) {
    console.warn('[TradeHistory] Failed to validate genesis:', error);
    return false;
  }
}

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
  
  // Also ensure genesis is stored
  if (cachedGenesisHash) {
    localStorage.setItem(TRADE_HISTORY_GENESIS_KEY, cachedGenesisHash);
  }
}

/**
 * Hook to manage trade history for the current signed-in account
 */
export function useTradeHistory() {
  const { selectedAccount, isChainConnected } = useWalletStore();
  const [trades, setTrades] = useState<LpTradeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [genesisValidated, setGenesisValidated] = useState(false);

  // Validate genesis hash on chain connection
  useEffect(() => {
    if (isChainConnected && !genesisValidated) {
      validateTradeHistoryGenesis().then((wasCleared) => {
        if (wasCleared) {
          // History was cleared, ensure state is empty
          setTrades([]);
        }
        setGenesisValidated(true);
      });
    }
  }, [isChainConnected, genesisValidated]);

  const refresh = useCallback(() => {
    setLoading(true);
    // Filter by signed-in account address
    const history = getTradeHistory(selectedAccount?.address);
    setTrades(history);
    setLoading(false);
  }, [selectedAccount?.address]);

  useEffect(() => {
    // Only refresh after genesis is validated
    if (genesisValidated) {
      refresh();
    }
  }, [refresh, genesisValidated]);

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

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected || !selectedAccount) {
      setOutcomes([]);
      if (!silent) setLoading(false);
      return;
    }
    
    if (!silent) setLoading(true);
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
        
        // Calculate shares and investment cost from trade history
        const policyTrades = trades.filter(t => t.policyId === policyId);
        const totalSharesBought = policyTrades
          .filter(t => t.type === 'buy')
          .reduce((sum, t) => sum + t.shares, 0);
        const totalSharesSold = policyTrades
          .filter(t => t.type === 'sell')
          .reduce((sum, t) => sum + t.shares, 0);
        const netSharesFromTrades = totalSharesBought - totalSharesSold;
        
        const totalBuyCost = policyTrades
          .filter(t => t.type === 'buy')
          .reduce((sum, t) => sum + t.totalAmount, 0);
        const totalSellRevenue = policyTrades
          .filter(t => t.type === 'sell')
          .reduce((sum, t) => sum + t.totalAmount, 0);
        const netCost = totalBuyCost - totalSellRevenue;
        
        // Use trade history shares for settled policies (since on-chain shares are 0)
        // For active policies, prefer currentShares from chain
        const sharesForCalculation = policy.status === 'Settled' ? netSharesFromTrades : (currentShares || netSharesFromTrades);
        
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
                // Event occurred - LPs lost their capital (premium paid out to policyholder)
                outcome = 'event_triggered';
                payoutReceived = 0;
              } else {
                // Policy matured - LPs get their capital back PLUS their share of the premium
                outcome = 'matured';
                // The LP gets back:
                // 1. Their original investment (capital)
                // 2. Their proportional share of the collected premium
                // 
                // Since this is a "no event" scenario, LPs profit = their share of premium
                // returnedToLps = total capital pool + unspent premium
                // 
                // Calculate user's share based on their shares vs total shares at settlement
                // Use sharesForCalculation since currentShares is 0 after settlement
                const totalShares = policy.capitalPool.totalShares;
                if (totalShares > 0 && sharesForCalculation > 0) {
                  const shareRatio = sharesForCalculation / totalShares;
                  payoutReceived = Number(settlement.returnedToLps) / 1_000_000 * shareRatio;
                }
              }
            }
          } catch (err) {
            console.error(`Failed to get settlement for policy ${policyId}:`, err);
          }
        } else if (policy.status === 'Expired') {
          outcome = 'matured';
          // If expired but not settled yet, estimate payout based on max payout per share
          const payoutPerShare = market ? Number(market.payoutPerShare) / 1_000_000 : 100;
          payoutReceived = sharesForCalculation * payoutPerShare;
        }
        
        positionOutcomes.push({
          policyId,
          marketId: policy.marketId,
          marketName: market?.name || `Market ${policy.marketId}`,
          sharesHeld: sharesForCalculation,
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
      if (!silent) setLoading(false);
    }
  }, [isChainConnected, selectedAccount]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { outcomes, loading, error, refresh: (silent = false) => refresh(silent) };
}
