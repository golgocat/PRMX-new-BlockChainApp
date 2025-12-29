/**
 * MongoDB connection and setup for V2 Oracle Service
 */
import { Db, Collection } from 'mongodb';
/**
 * Monitor document structure (policy tracking)
 */
export interface Monitor {
    _id: string;
    market_id: number;
    policy_id: string;
    coverage_start: number;
    coverage_end: number;
    strike_mm: number;
    lat: number;
    lon: number;
    state: 'monitoring' | 'triggered' | 'matured' | 'reported';
    cumulative_mm: number;
    trigger_time?: number;
    last_fetch_at: number;
    location_key: string;
    report_tx_hash?: string;
    evidence_hash?: string;
    created_at: Date;
    updated_at: Date;
}
/**
 * Bucket document structure (hourly precipitation)
 */
export interface Bucket {
    _id: string;
    monitor_id: string;
    hour_utc: string;
    mm: number;
    raw_data?: object;
    fetched_at?: Date;
    backfilled?: boolean;
}
/**
 * Evidence document structure
 */
export interface Evidence {
    _id: string;
    monitor_id: string;
    json_blob: object;
    created_at: Date;
}
/**
 * Chain metadata document structure (for detecting chain restarts)
 */
export interface ChainMeta {
    _id: string;
    genesis_hash: string;
    last_block_number: number;
    last_seen_at: Date;
}
/**
 * Connect to MongoDB Atlas
 */
export declare function connect(): Promise<Db>;
/**
 * Check if chain was restarted by comparing genesis hash and block height
 * For dev mode, also detect restart when current block < last seen block (chain reset)
 * If chain was restarted, clear all collections
 */
export declare function checkChainRestart(currentGenesisHash: string, currentBlockNumber: number): Promise<boolean>;
/**
 * Clear all oracle data (monitors, buckets, evidence)
 * Called when chain restart is detected
 */
export declare function clearAllData(): Promise<void>;
/**
 * Get monitors collection
 */
export declare function getMonitors(): Collection<Monitor>;
/**
 * Get buckets collection
 */
export declare function getBuckets(): Collection<Bucket>;
/**
 * Get evidence collection
 */
export declare function getEvidence(): Collection<Evidence>;
/**
 * Generate monitor ID (composite key)
 */
export declare function makeMonitorId(marketId: number, policyId: string): string;
/**
 * V3 Observation document structure
 */
export interface ObservationV3 {
    _id: string;
    policy_id: string;
    epoch_time: number;
    location_key: string;
    event_type: string;
    fields: Record<string, number>;
    sample_hash: string;
    commitment_after: string;
    inserted_at: Date;
}
/**
 * V3 Snapshot document structure
 */
export interface SnapshotV3 {
    _id: string;
    policy_id: string;
    observed_until: number;
    agg_state: object;
    commitment: string;
    inserted_at: Date;
}
/**
 * Get V3 observations collection
 */
export declare function getObservationsV3(): Collection<ObservationV3>;
/**
 * Get V3 snapshots collection
 */
export declare function getSnapshotsV3(): Collection<SnapshotV3>;
/**
 * Ensure V3 indexes with TTL
 */
export declare function ensureV3Indexes(): Promise<void>;
/**
 * Check database connection health
 */
export declare function checkDatabaseHealth(): Promise<boolean>;
/**
 * Disconnect from MongoDB
 */
export declare function disconnect(): Promise<void>;
