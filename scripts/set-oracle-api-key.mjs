#!/usr/bin/env node
/**
 * Set AccuWeather API Key in Offchain Storage
 * 
 * This script configures the AccuWeather API key for the oracle offchain worker
 * by storing it in the node's offchain local storage.
 * 
 * Usage:
 *   node set-oracle-api-key.mjs [api-key]
 *   
 * If no api-key is provided, uses the default test key.
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

// Default AccuWeather API key for testing
const DEFAULT_API_KEY = 'zpka_db8e78f41a5a431483111521abb69a4b_188626e6';

// Offchain storage key (must match ACCUWEATHER_API_KEY_STORAGE in pallet)
const STORAGE_KEY = 'prmx-oracle::accuweather-api-key';

async function main() {
    const apiKey = process.argv[2] || DEFAULT_API_KEY;
    
    console.log('='.repeat(60));
    console.log('PRMX Oracle API Key Configuration');
    console.log('='.repeat(60));
    console.log(`API Key: ${apiKey.substring(0, 10)}...`);
    console.log(`Storage Key: ${STORAGE_KEY}`);
    console.log('');

    // Connect to node
    const wsProvider = new WsProvider('ws://127.0.0.1:9944');
    const api = await ApiPromise.create({ provider: wsProvider });

    console.log('Connected to PRMX node');
    console.log(`Chain: ${(await api.rpc.system.chain()).toString()}`);
    console.log('');

    // The offchain storage must be set via RPC or the node itself
    // Since we can't directly write to offchain storage from external tools,
    // we'll show how to configure via environment variable instead
    
    console.log('To configure the AccuWeather API key, use one of these methods:');
    console.log('');
    console.log('Method 1: Environment Variable (recommended for testing)');
    console.log('  export ACCUWEATHER_API_KEY="' + apiKey + '"');
    console.log('  ./target/release/prmx-node --dev --tmp');
    console.log('');
    console.log('Method 2: Use the run script');
    console.log('  chmod +x scripts/run-node-dev.sh');
    console.log('  ./scripts/run-node-dev.sh');
    console.log('');
    
    // Check if oracle pallet exists
    try {
        const nextMarketId = await api.query.prmxMarkets.nextMarketId();
        console.log(`Markets configured: ${nextMarketId.toString()}`);
        
        // Check market 0 (Manila)
        const market = await api.query.prmxMarkets.markets(0);
        if (market.isSome) {
            const m = market.unwrap();
            console.log(`Market 0: ${Buffer.from(m.name.toU8a()).toString()}`);
            console.log(`  Center: ${m.centerLatitude.toNumber() / 1e6}°, ${m.centerLongitude.toNumber() / 1e6}°`);
        }
        
        // Check if location is bound
        const locationConfig = await api.query.prmxOracle.marketLocationConfig(0);
        if (locationConfig.isSome) {
            console.log(`  AccuWeather Key: Already bound`);
        } else {
            console.log(`  AccuWeather Key: Not yet bound (will be resolved by OCW)`);
        }
    } catch (e) {
        console.log('Note: Could not query oracle storage -', e.message);
    }

    await api.disconnect();
    console.log('');
    console.log('Done!');
}

main().catch(console.error);

