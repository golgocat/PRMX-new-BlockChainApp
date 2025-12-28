/**
 * MongoDB connection and setup for V2 Oracle Service
 */
import { MongoClient } from 'mongodb';
import { config } from '../config.js';
let client = null;
let db = null;
/**
 * Connect to MongoDB Atlas
 */
export async function connect() {
    if (db)
        return db;
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
export async function checkChainRestart(currentGenesisHash, currentBlockNumber) {
    if (!db)
        throw new Error('Database not connected');
    const chainMeta = db.collection('chain_meta');
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
    await chainMeta.updateOne({ _id: 'chain_info' }, { $set: { last_block_number: currentBlockNumber, last_seen_at: new Date() } });
    console.log('✅ Same chain session, no restart detected');
    return false;
}
/**
 * Update chain metadata after restart detection
 */
async function updateChainMeta(chainMeta, genesisHash, blockNumber) {
    await chainMeta.updateOne({ _id: 'chain_info' }, {
        $set: {
            genesis_hash: genesisHash,
            last_block_number: blockNumber,
            last_seen_at: new Date()
        }
    });
}
/**
 * Clear all oracle data (monitors, buckets, evidence)
 * Called when chain restart is detected
 */
export async function clearAllData() {
    if (!db)
        throw new Error('Database not connected');
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
async function ensureIndexes() {
    if (!db)
        throw new Error('Database not connected');
    const monitors = db.collection('monitors');
    const buckets = db.collection('buckets');
    await monitors.createIndex({ state: 1 });
    await monitors.createIndex({ market_id: 1 });
    await buckets.createIndex({ monitor_id: 1 });
    // Also create V3 indexes
    await ensureV3Indexes();
}
/**
 * Get monitors collection
 */
export function getMonitors() {
    if (!db)
        throw new Error('Database not connected');
    return db.collection('monitors');
}
/**
 * Get buckets collection
 */
export function getBuckets() {
    if (!db)
        throw new Error('Database not connected');
    return db.collection('buckets');
}
/**
 * Get evidence collection
 */
export function getEvidence() {
    if (!db)
        throw new Error('Database not connected');
    return db.collection('evidence');
}
/**
 * Generate monitor ID (composite key)
 */
export function makeMonitorId(marketId, policyId) {
    return `${marketId}:${policyId}`;
}
/**
 * Get V3 observations collection
 */
export function getObservationsV3() {
    if (!db)
        throw new Error('Database not connected');
    return db.collection('observations_v3');
}
/**
 * Get V3 snapshots collection
 */
export function getSnapshotsV3() {
    if (!db)
        throw new Error('Database not connected');
    return db.collection('snapshots_v3');
}
/**
 * Ensure V3 indexes with TTL
 */
export async function ensureV3Indexes() {
    if (!db)
        throw new Error('Database not connected');
    const observations = db.collection('observations_v3');
    const snapshots = db.collection('snapshots_v3');
    // Observations: unique compound index + TTL (30 days)
    await observations.createIndex({ policy_id: 1, epoch_time: 1 });
    await observations.createIndex({ inserted_at: 1 }, { expireAfterSeconds: 30 * 24 * 3600 } // 30 days
    );
    // Snapshots: unique compound index + TTL (90 days)
    await snapshots.createIndex({ policy_id: 1, observed_until: 1 });
    await snapshots.createIndex({ inserted_at: 1 }, { expireAfterSeconds: 90 * 24 * 3600 } // 90 days
    );
    console.log('✅ V3 indexes created with TTL');
}
/**
 * Disconnect from MongoDB
 */
export async function disconnect() {
    if (client) {
        await client.close();
        client = null;
        db = null;
        console.log('Disconnected from MongoDB');
    }
}
