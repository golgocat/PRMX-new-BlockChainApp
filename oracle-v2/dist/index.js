/**
 * PRMX V2 Oracle Service
 *
 * Off-chain oracle for monitoring V2 policies with cumulative rainfall tracking.
 *
 * Features:
 * - Listens for V2PolicyCreated events
 * - Fetches AccuWeather precipitation data
 * - Tracks cumulative rainfall per policy
 * - Submits V2 reports for early trigger or maturity
 */
import { config } from './config.js';
import { connect, disconnect } from './db/mongo.js';
import { connectToChain, subscribeToV2PolicyCreated, handleV2PolicyCreated, disconnectFromChain } from './chain/listener.js';
import { startScheduler, stopScheduler } from './scheduler/monitor.js';
import { startApiServer } from './api/server.js';
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║         PRMX V2 Oracle Service - Cumulative Rainfall      ║');
console.log('╚════════════════════════════════════════════════════════════╝');
async function main() {
    console.log('\n📋 Configuration:');
    console.log(`   WS URL: ${config.wsUrl}`);
    console.log(`   MongoDB: ${config.mongodbUri.replace(/\/\/[^@]+@/, '//***@')}`);
    console.log(`   Polling: ${config.pollingIntervalMs / 1000}s`);
    console.log(`   Manila Location Key: ${config.manilaLocationKey}`);
    console.log('');
    try {
        // Connect to MongoDB
        await connect();
        // Connect to PRMX chain
        await connectToChain();
        // Subscribe to V2PolicyCreated events
        await subscribeToV2PolicyCreated(handleV2PolicyCreated);
        // Start the scheduler
        await startScheduler();
        // Start REST API server
        await startApiServer(config.apiPort);
        console.log('\n✅ V2 Oracle Service is running');
        console.log('   Press Ctrl+C to stop\n');
        // Handle graceful shutdown
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    }
    catch (error) {
        console.error('❌ Failed to start V2 Oracle Service:', error);
        await shutdown();
        process.exit(1);
    }
}
async function shutdown() {
    console.log('\n🛑 Shutting down V2 Oracle Service...');
    stopScheduler();
    await disconnectFromChain();
    await disconnect();
    console.log('Goodbye!\n');
    process.exit(0);
}
main().catch(console.error);
