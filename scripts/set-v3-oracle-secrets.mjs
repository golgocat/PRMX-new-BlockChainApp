#!/usr/bin/env node
/**
 * Set V3 Oracle Secrets for Offchain Worker
 * 
 * This script provisions HMAC secret, AccuWeather API key, and Ingest API URL
 * into the node's offchain persistent storage via RPC.
 * 
 * Usage:
 *   node set-v3-oracle-secrets.mjs [options]
 *   
 * Options:
 *   --hmac-secret <secret>     HMAC secret for Ingest API auth (or V3_INGEST_HMAC_SECRET env var)
 *   --accuweather-key <key>    AccuWeather API key (or ACCUWEATHER_API_KEY env var)
 *   --ingest-url <url>         Ingest API base URL (or V3_INGEST_API_URL env var)
 *   --ws-url <url>             WebSocket URL of the node (default: ws://127.0.0.1:9944)
 *   
 * Examples:
 *   # Use environment variables
 *   source .env && node scripts/set-v3-oracle-secrets.mjs
 *   
 *   # Provide values directly
 *   node scripts/set-v3-oracle-secrets.mjs \
 *     --hmac-secret "my-secret-key" \
 *     --accuweather-key "zpka_xxx" \
 *     --ingest-url "http://localhost:3001"
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { u8aToHex, stringToU8a, compactAddLength } from '@polkadot/util';

// Storage key prefixes (must match OCW constants)
const STORAGE_PREFIX = 'ocw:v3:';
const INGEST_HMAC_SECRET_KEY = STORAGE_PREFIX + 'ingest_hmac_secret';
const ACCUWEATHER_API_KEY = STORAGE_PREFIX + 'accuweather_api_key';
const INGEST_API_URL_KEY = STORAGE_PREFIX + 'ingest_api_url';

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        hmacSecret: process.env.V3_INGEST_HMAC_SECRET,
        accuweatherKey: process.env.ACCUWEATHER_API_KEY,
        ingestUrl: process.env.V3_INGEST_API_URL || 'http://localhost:3001',
        wsUrl: 'ws://127.0.0.1:9944',
    };
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--hmac-secret':
                config.hmacSecret = args[++i];
                break;
            case '--accuweather-key':
                config.accuweatherKey = args[++i];
                break;
            case '--ingest-url':
                config.ingestUrl = args[++i];
                break;
            case '--ws-url':
                config.wsUrl = args[++i];
                break;
            case '--help':
            case '-h':
                console.log(`
V3 Oracle Secrets Configuration

Usage:
  node set-v3-oracle-secrets.mjs [options]

Options:
  --hmac-secret <secret>     HMAC secret for Ingest API auth
  --accuweather-key <key>    AccuWeather API key  
  --ingest-url <url>         Ingest API base URL (default: http://localhost:3001)
  --ws-url <url>             WebSocket URL (default: ws://127.0.0.1:9944)

Environment Variables:
  V3_INGEST_HMAC_SECRET      HMAC secret
  ACCUWEATHER_API_KEY        AccuWeather API key
  V3_INGEST_API_URL          Ingest API URL
                `);
                process.exit(0);
        }
    }
    
    return config;
}

async function main() {
    const config = parseArgs();
    
    console.log('═'.repeat(60));
    console.log('PRMX V3 Oracle Secrets Configuration');
    console.log('═'.repeat(60));
    console.log(`Node URL: ${config.wsUrl}`);
    console.log(`Ingest URL: ${config.ingestUrl}`);
    console.log(`HMAC Secret: ${config.hmacSecret ? '***configured***' : '❌ NOT SET'}`);
    console.log(`AccuWeather Key: ${config.accuweatherKey ? config.accuweatherKey.substring(0, 10) + '...' : '❌ NOT SET'}`);
    console.log('');

    if (!config.hmacSecret || !config.accuweatherKey) {
        console.error('❌ Error: Missing required secrets');
        console.error('');
        console.error('Please provide either:');
        console.error('  1. Command line args: --hmac-secret <secret> --accuweather-key <key>');
        console.error('  2. Environment variables: V3_INGEST_HMAC_SECRET, ACCUWEATHER_API_KEY');
        process.exit(1);
    }

    // Connect to node
    console.log('🔌 Connecting to PRMX node...');
    const wsProvider = new WsProvider(config.wsUrl);
    const api = await ApiPromise.create({ provider: wsProvider });

    const chain = await api.rpc.system.chain();
    console.log(`✅ Connected to: ${chain.toString()}`);
    console.log('');

    // Set offchain storage values
    // Note: This uses the offchain storage RPC which requires --rpc-methods=Unsafe
    
    console.log('💉 Injecting V3 oracle secrets into offchain storage...');
    console.log('');

    try {
        // Helper to SCALE-encode Vec<u8> (compact length prefix + raw bytes)
        const scaleEncodeBytes = (value) => {
            const bytes = stringToU8a(value);
            // compactAddLength adds SCALE compact length prefix
            return u8aToHex(compactAddLength(bytes));
        };

        // HMAC Secret
        const hmacKey = u8aToHex(stringToU8a(INGEST_HMAC_SECRET_KEY));
        const hmacValue = scaleEncodeBytes(config.hmacSecret);
        await api.rpc.offchain.localStorageSet('PERSISTENT', hmacKey, hmacValue);
        console.log('  ✅ HMAC secret stored');

        // AccuWeather API Key
        const awKey = u8aToHex(stringToU8a(ACCUWEATHER_API_KEY));
        const awValue = scaleEncodeBytes(config.accuweatherKey);
        await api.rpc.offchain.localStorageSet('PERSISTENT', awKey, awValue);
        console.log('  ✅ AccuWeather API key stored');

        // Ingest API URL
        const urlKey = u8aToHex(stringToU8a(INGEST_API_URL_KEY));
        const urlValue = scaleEncodeBytes(config.ingestUrl);
        await api.rpc.offchain.localStorageSet('PERSISTENT', urlKey, urlValue);
        console.log('  ✅ Ingest API URL stored');

        console.log('');
        console.log('🎉 V3 oracle secrets successfully configured!');
        console.log('');
        console.log('The offchain worker will now:');
        console.log('  1. Use these secrets for AccuWeather data fetching');
        console.log('  2. Sign requests to the Ingest API with HMAC');
        console.log('  3. Submit snapshots and final reports on-chain');
        console.log('');
        console.log('Storage keys:');
        console.log(`  - ${INGEST_HMAC_SECRET_KEY}`);
        console.log(`  - ${ACCUWEATHER_API_KEY}`);
        console.log(`  - ${INGEST_API_URL_KEY}`);

    } catch (error) {
        if (error.message?.includes('Method not found') || error.message?.includes('RPC')) {
            console.error('');
            console.error('❌ Error: Offchain storage RPC not available');
            console.error('');
            console.error('Make sure your node is started with:');
            console.error('  --rpc-methods=Unsafe');
            console.error('');
            console.error('Example:');
            console.error('  ./target/release/prmx-node --dev --rpc-methods=Unsafe');
        } else {
            console.error(`❌ Failed to set secrets: ${error.message}`);
        }
        process.exit(1);
    }

    await api.disconnect();
    console.log('');
    console.log('Done!');
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});

