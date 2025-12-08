'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWalletStore } from '@/stores/walletStore';
import * as api from '@/lib/api';
import type { Market, Policy, QuoteRequest, LpAskOrder, LpHolding } from '@/types';

/**
 * Hook to fetch and refresh markets data
 */
export function useMarkets() {
  const { isChainConnected } = useWalletStore();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isChainConnected) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await api.getMarkets();
      setMarkets(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch markets');
    } finally {
      setLoading(false);
    }
  }, [isChainConnected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { markets, loading, error, refresh };
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
 * Hook to fetch all policies
 */
export function usePolicies() {
  const { isChainConnected } = useWalletStore();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isChainConnected) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await api.getPolicies();
      setPolicies(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch policies');
    } finally {
      setLoading(false);
    }
  }, [isChainConnected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { policies, loading, error, refresh };
}

/**
 * Hook to fetch policies for current user
 */
export function useMyPolicies() {
  const { isChainConnected, selectedAccount } = useWalletStore();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isChainConnected || !selectedAccount) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await api.getPoliciesByHolder(selectedAccount.address);
      setPolicies(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch policies');
    } finally {
      setLoading(false);
    }
  }, [isChainConnected, selectedAccount]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { policies, loading, error, refresh };
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
 * Hook to get dashboard stats
 */
export function useDashboardStats() {
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

  const refresh = useCallback(async () => {
    if (!isChainConnected) return;
    
    setLoading(true);
    
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

      setStats({
        totalMarkets: markets.length,
        totalPolicies: policies.length,
        activePolicies: activePolicies.length,
        myPolicies: myPolicies.length,
        myActivePolicies: myPolicies.filter(p => p.status === 'Active').length,
        totalLpOrders: orders.filter(o => o.remaining > BigInt(0)).length,
        myLpHoldings: myHoldings.length,
      });
    } catch (err) {
      console.error('Failed to fetch dashboard stats:', err);
    } finally {
      setLoading(false);
    }
  }, [isChainConnected, selectedAccount]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { stats, loading, refresh };
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
