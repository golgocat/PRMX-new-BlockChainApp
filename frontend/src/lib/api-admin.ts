/**
 * Admin API functions for OCW health monitoring
 */

import type { OcwHealthResponse, OcwHealthData } from '@/types/admin';

const ORACLE_SERVICE_URL = process.env.NEXT_PUBLIC_ORACLE_SERVICE_URL || 'http://localhost:3001';

/**
 * Fetch comprehensive OCW health status
 */
export async function getOcwHealthStatus(): Promise<OcwHealthData> {
  try {
    const response = await fetch(`${ORACLE_SERVICE_URL}/admin/health`, {
      // Add timeout to prevent hanging
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status} ${response.statusText}`);
    }

    const data: OcwHealthResponse = await response.json();
    
    if (!data.success) {
      throw new Error('Health check returned unsuccessful response');
    }

    return data.data;
  } catch (error) {
    console.error('Failed to fetch OCW health status:', error);
    
    // Return a degraded status if the service is unreachable
    const now = Math.floor(Date.now() / 1000);
    return {
      overall_status: 'down',
      timestamp: now,
      services: {
        oracle_v2: { status: 'offline', last_check: now },
        oracle_v3: { status: 'offline', last_check: now },
        database: { status: 'offline', last_check: now },
        chain: { status: 'offline', last_check: now },
      },
      metrics: {
        policies_monitored: 0,
        snapshots_last_24h: 0,
        observations_last_24h: 0,
        last_successful_operation: 0,
      },
    };
  }
}

