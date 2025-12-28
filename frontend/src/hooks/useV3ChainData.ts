'use client';

/**
 * React hooks for V3 P2P Climate Risk Market data
 */

import { useState, useEffect, useCallback, useTransition } from 'react';
import { useWalletStore } from '@/stores/walletStore';
import * as apiV3 from '@/lib/api-v3';
import type { 
  V3Location, 
  V3Request, 
  V3Policy, 
  V3OracleState, 
  V3LpHolding 
} from '@/types/v3';

// Polling intervals
const DEFAULT_POLL_INTERVAL = 15000; // 15 seconds
const FAST_POLL_INTERVAL = 5000;     // 5 seconds for time-sensitive data

// =============================================================================
// Locations Hook
// =============================================================================

/**
 * Hook to fetch V3 locations from the registry
 */
export function useV3Locations() {
  const { isChainConnected } = useWalletStore();
  const [locations, setLocations] = useState<V3Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected) return;
    
    if (!silent) setLoading(true);
    setError(null);
    
    try {
      const data = await apiV3.getV3Locations();
      setLocations(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch locations');
    } finally {
      setLoading(false);
    }
  }, [isChainConnected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { locations, loading, error, refresh: () => refresh(false) };
}

/**
 * Hook to fetch a single V3 location
 */
export function useV3Location(locationId: number | null) {
  const { isChainConnected } = useWalletStore();
  const [location, setLocation] = useState<V3Location | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isChainConnected || locationId === null) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await apiV3.getV3Location(locationId);
      setLocation(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch location');
    } finally {
      setLoading(false);
    }
  }, [isChainConnected, locationId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { location, loading, error, refresh };
}

// =============================================================================
// Requests Hooks
// =============================================================================

/**
 * Hook to fetch all V3 underwrite requests with optional polling
 */
export function useV3Requests(pollInterval: number = DEFAULT_POLL_INTERVAL) {
  const { isChainConnected } = useWalletStore();
  const [requests, setRequests] = useState<V3Request[]>([]);
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
      const data = await apiV3.getV3Requests();
      if (silent) {
        startTransition(() => setRequests(data));
      } else {
        setRequests(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch requests');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [isChainConnected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-polling
  useEffect(() => {
    if (!isChainConnected || pollInterval <= 0) return;
    
    const interval = setInterval(() => refresh(true), pollInterval);
    return () => clearInterval(interval);
  }, [isChainConnected, pollInterval, refresh]);

  return { 
    requests, 
    loading, 
    isRefreshing: isRefreshing || isPending, 
    error, 
    refresh: () => refresh(false) 
  };
}

/**
 * Hook to fetch open V3 requests (Pending or PartiallyFilled)
 */
export function useV3OpenRequests(pollInterval: number = DEFAULT_POLL_INTERVAL) {
  const { isChainConnected } = useWalletStore();
  const [requests, setRequests] = useState<V3Request[]>([]);
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
      const data = await apiV3.getV3OpenRequests();
      if (silent) {
        startTransition(() => setRequests(data));
      } else {
        setRequests(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch open requests');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [isChainConnected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-polling
  useEffect(() => {
    if (!isChainConnected || pollInterval <= 0) return;
    
    const interval = setInterval(() => refresh(true), pollInterval);
    return () => clearInterval(interval);
  }, [isChainConnected, pollInterval, refresh]);

  return { 
    requests, 
    loading, 
    isRefreshing: isRefreshing || isPending, 
    error, 
    refresh: () => refresh(false) 
  };
}

/**
 * Hook to fetch a single V3 request by ID
 */
export function useV3Request(requestId: number | null, pollInterval: number = FAST_POLL_INTERVAL) {
  const { isChainConnected } = useWalletStore();
  const [request, setRequest] = useState<V3Request | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected || requestId === null) return;
    
    if (!silent) setLoading(true);
    setError(null);
    
    try {
      const data = await apiV3.getV3Request(requestId);
      setRequest(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch request');
    } finally {
      setLoading(false);
    }
  }, [isChainConnected, requestId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-polling for real-time updates
  useEffect(() => {
    if (!isChainConnected || requestId === null || pollInterval <= 0) return;
    
    const interval = setInterval(() => refresh(true), pollInterval);
    return () => clearInterval(interval);
  }, [isChainConnected, requestId, pollInterval, refresh]);

  return { request, loading, error, refresh: () => refresh(false) };
}

/**
 * Hook to fetch requests created by the connected user
 */
export function useV3MyRequests(pollInterval: number = DEFAULT_POLL_INTERVAL) {
  const { isChainConnected, selectedAccount } = useWalletStore();
  const [requests, setRequests] = useState<V3Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected || !selectedAccount) return;
    
    if (!silent) setLoading(true);
    setIsRefreshing(true);
    setError(null);
    
    try {
      const data = await apiV3.getV3RequestsByRequester(selectedAccount.address);
      startTransition(() => {
        setRequests(data);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch my requests');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [isChainConnected, selectedAccount]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-polling
  useEffect(() => {
    if (!isChainConnected || !selectedAccount || pollInterval <= 0) return;
    
    const interval = setInterval(() => refresh(true), pollInterval);
    return () => clearInterval(interval);
  }, [isChainConnected, selectedAccount, pollInterval, refresh]);

  return { 
    requests, 
    loading, 
    isRefreshing: isRefreshing || isPending, 
    error, 
    refresh: () => refresh(false) 
  };
}

// =============================================================================
// Policies Hooks
// =============================================================================

/**
 * Hook to fetch all V3 policies with optional polling
 */
export function useV3Policies(pollInterval: number = DEFAULT_POLL_INTERVAL) {
  const { isChainConnected } = useWalletStore();
  const [policies, setPolicies] = useState<V3Policy[]>([]);
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
      const data = await apiV3.getV3Policies();
      if (silent) {
        startTransition(() => setPolicies(data));
      } else {
        setPolicies(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch policies');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [isChainConnected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-polling
  useEffect(() => {
    if (!isChainConnected || pollInterval <= 0) return;
    
    const interval = setInterval(() => refresh(true), pollInterval);
    return () => clearInterval(interval);
  }, [isChainConnected, pollInterval, refresh]);

  return { 
    policies, 
    loading, 
    isRefreshing: isRefreshing || isPending, 
    error, 
    refresh: () => refresh(false) 
  };
}

/**
 * Hook to fetch a single V3 policy by ID
 */
export function useV3Policy(policyId: number | null) {
  const { isChainConnected } = useWalletStore();
  const [policy, setPolicy] = useState<V3Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isChainConnected || policyId === null) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await apiV3.getV3Policy(policyId);
      setPolicy(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch policy');
    } finally {
      setLoading(false);
    }
  }, [isChainConnected, policyId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { policy, loading, error, refresh };
}

/**
 * Hook to fetch V3 policies where connected user is the holder
 */
export function useV3MyPolicies(pollInterval: number = DEFAULT_POLL_INTERVAL) {
  const { isChainConnected, selectedAccount } = useWalletStore();
  const [policies, setPolicies] = useState<V3Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected || !selectedAccount) return;
    
    if (!silent) setLoading(true);
    setError(null);
    
    try {
      const data = await apiV3.getV3PoliciesByHolder(selectedAccount.address);
      setPolicies(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch my policies');
    } finally {
      setLoading(false);
    }
  }, [isChainConnected, selectedAccount]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-polling
  useEffect(() => {
    if (!isChainConnected || !selectedAccount || pollInterval <= 0) return;
    
    const interval = setInterval(() => refresh(true), pollInterval);
    return () => clearInterval(interval);
  }, [isChainConnected, selectedAccount, pollInterval, refresh]);

  return { policies, loading, error, refresh: () => refresh(false) };
}

// =============================================================================
// Oracle State Hook
// =============================================================================

/**
 * Hook to fetch oracle state for a V3 policy
 */
export function useV3OracleState(policyId: number | null, pollInterval: number = DEFAULT_POLL_INTERVAL) {
  const { isChainConnected } = useWalletStore();
  const [oracleState, setOracleState] = useState<V3OracleState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected || policyId === null) return;
    
    if (!silent) setLoading(true);
    setError(null);
    
    try {
      const data = await apiV3.getV3OracleState(policyId);
      setOracleState(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch oracle state');
    } finally {
      setLoading(false);
    }
  }, [isChainConnected, policyId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-polling
  useEffect(() => {
    if (!isChainConnected || policyId === null || pollInterval <= 0) return;
    
    const interval = setInterval(() => refresh(true), pollInterval);
    return () => clearInterval(interval);
  }, [isChainConnected, policyId, pollInterval, refresh]);

  return { oracleState, loading, error, refresh: () => refresh(false) };
}

// =============================================================================
// LP Holdings Hooks
// =============================================================================

/**
 * Hook to fetch V3 LP holdings for the connected user
 */
export function useV3MyLpHoldings(pollInterval: number = DEFAULT_POLL_INTERVAL) {
  const { isChainConnected, selectedAccount } = useWalletStore();
  const [holdings, setHoldings] = useState<V3LpHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected || !selectedAccount) return;
    
    if (!silent) setLoading(true);
    setError(null);
    
    try {
      const data = await apiV3.getV3LpHoldings(selectedAccount.address);
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

  // Auto-polling
  useEffect(() => {
    if (!isChainConnected || !selectedAccount || pollInterval <= 0) return;
    
    const interval = setInterval(() => refresh(true), pollInterval);
    return () => clearInterval(interval);
  }, [isChainConnected, selectedAccount, pollInterval, refresh]);

  return { holdings, loading, error, refresh: () => refresh(false) };
}

/**
 * Hook to fetch all LP holders for a specific V3 policy
 */
export function useV3PolicyLpHolders(policyId: number | null) {
  const { isChainConnected } = useWalletStore();
  const [holders, setHolders] = useState<V3LpHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isChainConnected || policyId === null) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await apiV3.getV3PolicyLpHolders(policyId);
      setHolders(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch LP holders');
    } finally {
      setLoading(false);
    }
  }, [isChainConnected, policyId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { holders, loading, error, refresh };
}

