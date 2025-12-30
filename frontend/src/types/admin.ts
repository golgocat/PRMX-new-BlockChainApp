/**
 * Admin/DAO Dashboard Types
 */

export type HealthStatus = 'healthy' | 'degraded' | 'down';
export type ServiceStatus = 'online' | 'offline';

export interface ServiceHealth {
  status: ServiceStatus;
  last_check: number;
  [key: string]: any; // Additional service-specific fields
}

export interface OracleV2Health extends ServiceHealth {
  policies_monitored?: number;
}

export interface OracleV3Health extends ServiceHealth {
  observations_24h?: number;
  snapshots_24h?: number;
  policies_monitored?: number;
}

export interface OcwHealthData {
  overall_status: HealthStatus;
  timestamp: number;
  services: {
    oracle_v2: OracleV2Health;
    oracle_v3: OracleV3Health;
    database: ServiceHealth;
    chain: ServiceHealth;
  };
  metrics: {
    policies_monitored: number;
    snapshots_last_24h: number;
    observations_last_24h: number;
    last_successful_operation: number;
  };
}

export interface OcwHealthResponse {
  success: boolean;
  data: OcwHealthData;
}

