'use client';

import { useState, useEffect, useCallback } from 'react';
import { getOcwHealthStatus } from '@/lib/api-admin';
import type { OcwHealthData } from '@/types/admin';

const POLL_INTERVAL = 30000; // 30 seconds

/**
 * Hook to fetch and manage OCW health status with auto-refresh
 */
export function useOcwHealth() {
  const [healthData, setHealthData] = useState<OcwHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    
    try {
      const data = await getOcwHealthStatus();
      setHealthData(data);
      setLoading(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch health status';
      setError(errorMessage);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial load
    refresh();

    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      refresh();
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [refresh]);

  return { healthData, loading, error, refresh };
}

