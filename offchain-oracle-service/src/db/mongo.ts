/**
 * MongoDB connection and setup for V2 Oracle Service
 */

import { MongoClient, Db, Collection, UpdateFilter } from 'mongodb';
import { config } from '../config.js';

let client: MongoClient | null = null;
let db: Db | null = null;

/**
 * Monitor document structure (policy tracking)
 */
export interface Monitor {
  _id: string;             // Composite UID: "0:42" (market_id:policy_id)
  market_id: number;
  policy_id: number;
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
  _id: string;             // "0:42:2025122100" (market:policy:hourUTC)
  monitor_id: string;
  hour_utc: string;        // ISO hour: "2025-12-21T00:00:00Z"
  mm: number;
  raw_data?: object;       // Raw AccuWeather API response for this reading
  fetched_at?: Date;       // When this bucket was last updated
  backfilled?: boolean;    // True if this bucket was backfilled (no actual data)
}

/**
 * Evidence document structure
 */
export interface Evidence {
  _id: string;             // evidence_hash (hex)
  monitor_id: string;
  json_blob: object;
  created_at: Date;
}

/**
 * Chain metadata document structure (for detecting chain restarts)
 */
export interface ChainMeta {
  _id: string;             // Always "chain_info"
  genesis_hash: string;
  last_block_number: number;
  last_seen_at: Date;
}

/**
 * Connect to MongoDB Atlas
 */
export async function connect(): Promise<Db> {
  if (db) return db;
  
  client = new MongoClient(config.mongodbUri);
  await client.connect();
  
  db = client.db();
  
  // Ensure indexes
  await ensureIndexes();
  
  console.log('✅ Connected to MongoDB');
  return db;
}

/**
 * Check if chain was restarted by comparing genesis hash and block height
 * For dev mode, also detect restart when current block < last seen block (chain reset)
 * If chain was restarted, clear all collections
 */
export async function checkChainRestart(currentGenesisHash: string, currentBlockNumber: number): Promise<boolean> {
  if (!db) throw new Error('Database not connected');
  
  const chainMeta = db.collection<ChainMeta>('chain_meta');
  const stored = await chainMeta.findOne({ _id: 'chain_info' });
  
  console.log('🔍 Chain restart check:');
  console.log('   Current genesis:', currentGenesisHash.slice(0, 18) + '...');
  console.log('   Current block:', currentBlockNumber);
  
  if (!stored) {
    // First run - store the genesis hash and block
    await chainMeta.insertOne({
      _id: 'chain_info',
      genesis_hash: currentGenesisHash,
      last_block_number: currentBlockNumber,
      last_seen_at: new Date(),
    });
    console.log('📝 First run - stored chain info');
    return false;
  }
  
  console.log('   Stored genesis:', stored.genesis_hash?.slice(0, 18) + '...');
  console.log('   Stored block:', stored.last_block_number ?? 'N/A');
  
  // Check for genesis hash change
  if (stored.genesis_hash !== currentGenesisHash) {
    console.log('🔄 Chain restart detected (genesis hash changed)!');
    
    await clearAllData();
    await updateChainMeta(chainMeta, currentGenesisHash, currentBlockNumber);
    return true;
  }
  
  // Check for block number reset (dev mode restart with same genesis)
  // If current block is significantly lower than last seen, chain was reset
  // Also trigger if last_block_number was not stored (old schema migration)
  const lastBlock = stored.last_block_number ?? 0;
  if (lastBlock > 0 && currentBlockNumber < lastBlock - 10) {
    console.log('🔄 Chain restart detected (block number reset)!');
    
    await clearAllData();
    await updateChainMeta(chainMeta, currentGenesisHash, currentBlockNumber);
    return true;
  }
  
  // Same chain, update last seen
  await chainMeta.updateOne(
    { _id: 'chain_info' },
    { $set: { last_block_number: currentBlockNumber, last_seen_at: new Date() } }
  );
  
  console.log('✅ Same chain session, no restart detected');
  return false;
}

/**
 * Update chain metadata after restart detection
 */
async function updateChainMeta(
  chainMeta: Collection<ChainMeta>,
  genesisHash: string,
  blockNumber: number
): Promise<void> {
  await chainMeta.updateOne(
    { _id: 'chain_info' },
    { 
      $set: { 
        genesis_hash: genesisHash, 
        last_block_number: blockNumber,
        last_seen_at: new Date() 
      } 
    }
  );
}

/**
 * Clear all oracle data (monitors, buckets, evidence)
 * Called when chain restart is detected
 */
export async function clearAllData(): Promise<void> {
  if (!db) throw new Error('Database not connected');
  
  console.log('🗑️  Clearing all MongoDB collections...');
  
  const monitors = await db.collection('monitors').deleteMany({});
  const buckets = await db.collection('buckets').deleteMany({});
  const evidence = await db.collection('evidence').deleteMany({});
  
  console.log(`   Deleted ${monitors.deletedCount} monitors`);
  console.log(`   Deleted ${buckets.deletedCount} buckets`);
  console.log(`   Deleted ${evidence.deletedCount} evidence records`);
  console.log('✅ Database cleared for fresh chain state');
}

/**
 * Create required indexes
 */
async function ensureIndexes(): Promise<void> {
  if (!db) throw new Error('Database not connected');
  
  const monitors = db.collection<Monitor>('monitors');
  const buckets = db.collection<Bucket>('buckets');
  
  await monitors.createIndex({ state: 1 });
  await monitors.createIndex({ market_id: 1 });
  await buckets.createIndex({ monitor_id: 1 });
  
  // Also create V3 indexes
  await ensureV3Indexes();
}

/**
 * Get monitors collection
 */
export function getMonitors(): Collection<Monitor> {
  if (!db) throw new Error('Database not connected');
  return db.collection<Monitor>('monitors');
}

/**
 * Get buckets collection
 */
export function getBuckets(): Collection<Bucket> {
  if (!db) throw new Error('Database not connected');
  return db.collection<Bucket>('buckets');
}

/**
 * Get evidence collection
 */
export function getEvidence(): Collection<Evidence> {
  if (!db) throw new Error('Database not connected');
  return db.collection<Evidence>('evidence');
}

/**
 * Generate monitor ID (composite key)
 */
export function makeMonitorId(marketId: number, policyId: number): string {
  return `${marketId}:${policyId}`;
}

// ============================================================================
// V3 Collections
// ============================================================================

/**
 * V3 Observation document structure
 */
export interface ObservationV3 {
  _id: string;             // policy_id:epoch_time
  policy_id: number;
  epoch_time: number;
  location_key: string;
  event_type: string;
  fields: Record<string, number>;
  sample_hash: string;
  commitment_after: string;
  inserted_at: Date;       // TTL index: 30 days
}

/**
 * V3 Snapshot document structure
 */
export interface SnapshotV3 {
  _id: string;             // policy_id:observed_until
  policy_id: number;
  observed_until: number;
  agg_state: object;
  commitment: string;
  inserted_at: Date;       // TTL index: 90 days
}

/**
 * Get V3 observations collection
 */
export function getObservationsV3(): Collection<ObservationV3> {
  if (!db) throw new Error('Database not connected');
  return db.collection<ObservationV3>('observations_v3');
}

/**
 * Get V3 snapshots collection
 */
export function getSnapshotsV3(): Collection<SnapshotV3> {
  if (!db) throw new Error('Database not connected');
  return db.collection<SnapshotV3>('snapshots_v3');
}

/**
 * Ensure V3 indexes with TTL
 */
export async function ensureV3Indexes(): Promise<void> {
  if (!db) throw new Error('Database not connected');
  
  const observations = db.collection<ObservationV3>('observations_v3');
  const snapshots = db.collection<SnapshotV3>('snapshots_v3');
  
  // Observations: unique compound index + TTL (30 days)
  await observations.createIndex({ policy_id: 1, epoch_time: 1 });
  await observations.createIndex(
    { inserted_at: 1 },
    { expireAfterSeconds: 30 * 24 * 3600 } // 30 days
  );
  
  // Snapshots: unique compound index + TTL (90 days)
  await snapshots.createIndex({ policy_id: 1, observed_until: 1 });
  await snapshots.createIndex(
    { inserted_at: 1 },
    { expireAfterSeconds: 90 * 24 * 3600 } // 90 days
  );
  
  console.log('✅ V3 indexes created with TTL');
}

/**
 * Check database connection health
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  if (!db) return false;
  
  try {
    // Use ping command to check connection
    await db.admin().ping();
    return true;
  } catch (error) {
    console.error('Database health check failed:', error);
    return false;
  }
}

/**
 * Disconnect from MongoDB
 */
export async function disconnect(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('Disconnected from MongoDB');
  }
}

