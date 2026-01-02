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
import type { V3Observation } from '@/lib/api-v3';

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
      if (!silent) setLoading(false);
    }
  }, [isChainConnected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { locations, loading, error, refresh: (silent = false) => refresh(silent) };
}

/**
 * Hook to fetch a single V3 location
 */
export function useV3Location(locationId: number | null) {
  const { isChainConnected } = useWalletStore();
  const [location, setLocation] = useState<V3Location | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected || locationId === null) return;
    
    if (!silent) setLoading(true);
    setError(null);
    
    try {
      const data = await apiV3.getV3Location(locationId);
      setLocation(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch location');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isChainConnected, locationId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { location, loading, error, refresh: (silent = false) => refresh(silent) };
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
      if (!silent) setLoading(false);
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
    refresh: (silent = false) => refresh(silent) 
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
      if (!silent) setLoading(false);
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
    refresh: (silent = false) => refresh(silent) 
  };
}

/**
 * Hook to fetch a single V3 request by ID (H128 hex string)
 */
export function useV3Request(requestId: string | null, pollInterval: number = FAST_POLL_INTERVAL) {
  const { isChainConnected } = useWalletStore();
  const [request, setRequest] = useState<V3Request | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected || !requestId) return;
    
    if (!silent) setLoading(true);
    setError(null);
    
    try {
      const data = await apiV3.getV3Request(requestId);
      setRequest(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch request');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isChainConnected, requestId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-polling for real-time updates
  useEffect(() => {
    if (!isChainConnected || !requestId || pollInterval <= 0) return;
    
    const interval = setInterval(() => refresh(true), pollInterval);
    return () => clearInterval(interval);
  }, [isChainConnected, requestId, pollInterval, refresh]);

  return { request, loading, error, refresh: (silent = false) => refresh(silent) };
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
    if (silent) setIsRefreshing(true);
    setError(null);
    
    try {
      const data = await apiV3.getV3RequestsByRequester(selectedAccount.address);
      startTransition(() => {
        setRequests(data);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch my requests');
    } finally {
      if (!silent) setLoading(false);
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
    refresh: (silent = false) => refresh(silent) 
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
      if (!silent) setLoading(false);
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
    refresh: (silent = false) => refresh(silent) 
  };
}

/**
 * Hook to fetch a single V3 policy by ID (H128 hex string)
 */
export function useV3Policy(policyId: string | null) {
  const { isChainConnected } = useWalletStore();
  const [policy, setPolicy] = useState<V3Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected || !policyId) return;
    
    if (!silent) setLoading(true);
    setError(null);
    
    try {
      const data = await apiV3.getV3Policy(policyId);
      setPolicy(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch policy');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isChainConnected, policyId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { policy, loading, error, refresh: (silent = false) => refresh(silent) };
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
      if (!silent) setLoading(false);
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

  return { policies, loading, error, refresh: (silent = false) => refresh(silent) };
}

// =============================================================================
// Oracle State Hook
// =============================================================================

/**
 * Hook to fetch oracle state for a V3 policy (H128 hex string)
 */
export function useV3OracleState(policyId: string | null, pollInterval: number = DEFAULT_POLL_INTERVAL) {
  const { isChainConnected } = useWalletStore();
  const [oracleState, setOracleState] = useState<V3OracleState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected || !policyId) return;
    
    if (!silent) setLoading(true);
    setError(null);
    
    try {
      const data = await apiV3.getV3OracleState(policyId);
      setOracleState(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch oracle state');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isChainConnected, policyId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-polling
  useEffect(() => {
    if (!isChainConnected || !policyId || pollInterval <= 0) return;
    
    const interval = setInterval(() => refresh(true), pollInterval);
    return () => clearInterval(interval);
  }, [isChainConnected, policyId, pollInterval, refresh]);

  return { oracleState, loading, error, refresh: (silent = false) => refresh(silent) };
}

// =============================================================================
// Historical Observations Hook
// =============================================================================

/**
 * Hook to fetch historical observations for a V3 policy (H128 hex string)
 */
export function useV3Observations(policyId: string | null) {
  const { isChainConnected } = useWalletStore();
  const [observations, setObservations] = useState<V3Observation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected || !policyId) {
      setObservations([]);
      if (!silent) setLoading(false);
      return;
    }
    
    if (!silent) setLoading(true);
    setError(null);
    
    try {
      const data = await apiV3.getV3Observations(policyId);
      setObservations(data);
      // Log for debugging
      if (data.length === 0) {
        console.log(`[V3 Observations] No observations found for policy ${policyId}`);
      } else {
        console.log(`[V3 Observations] Found ${data.length} observations for policy ${policyId}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch observations';
      setError(errorMessage);
      console.error(`[V3 Observations] Error fetching observations for policy ${policyId}:`, err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isChainConnected, policyId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { observations, loading, error, refresh: (silent = false) => refresh(silent) };
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
      if (!silent) setLoading(false);
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

  return { holdings, loading, error, refresh: (silent = false) => refresh(silent) };
}

/**
 * Hook to fetch all LP holders for a specific V3 policy (H128 hex string)
 */
export function useV3PolicyLpHolders(policyId: string | null) {
  const { isChainConnected } = useWalletStore();
  const [holders, setHolders] = useState<V3LpHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!isChainConnected || !policyId) return;
    
    if (!silent) setLoading(true);
    setError(null);
    
    try {
      const data = await apiV3.getV3PolicyLpHolders(policyId);
      setHolders(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch LP holders');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isChainConnected, policyId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { holders, loading, error, refresh: (silent = false) => refresh(silent) };
}

