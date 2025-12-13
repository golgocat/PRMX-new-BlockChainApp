#!/usr/bin/env node
/**
 * Set AccuWeather API Key via Extrinsic
 * 
 * This script configures the AccuWeather API key for the oracle offchain worker
 * by calling the setAccuweatherApiKey extrinsic (via sudo).
 * 
 * Usage:
 *   node set-oracle-api-key.mjs [api-key] [ws-url]
 *   
 * Arguments:
 *   api-key   - The AccuWeather API key (defaults to ACCUWEATHER_API_KEY env var)
 *   ws-url    - WebSocket URL of the node (defaults to ws://127.0.0.1:9944)
 * 
 * Examples:
 *   # Use environment variable
 *   source .env && node scripts/set-oracle-api-key.mjs
 *   
 *   # Provide key directly
 *   node scripts/set-oracle-api-key.mjs "zpka_your_key_here"
 *   
 *   # Use custom node URL
 *   node scripts/set-oracle-api-key.mjs "" ws://localhost:9944
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

async function main() {
    // Get API key from argument or environment variable
    const apiKey = process.argv[2] || process.env.ACCUWEATHER_API_KEY;
    const wsUrl = process.argv[3] || 'ws://127.0.0.1:9944';
    
    if (!apiKey) {
        console.error('❌ Error: No API key provided');
        console.error('');
        console.error('Usage:');
        console.error('  node set-oracle-api-key.mjs <api-key> [ws-url]');
        console.error('');
        console.error('Or set the ACCUWEATHER_API_KEY environment variable:');
        console.error('  export ACCUWEATHER_API_KEY="your_key_here"');
        console.error('  node set-oracle-api-key.mjs');
        process.exit(1);
    }
    
    console.log('═'.repeat(60));
    console.log('PRMX Oracle API Key Configuration');
    console.log('═'.repeat(60));
    console.log(`API Key: ${apiKey.substring(0, 10)}...${apiKey.slice(-4)}`);
    console.log(`Node URL: ${wsUrl}`);
    console.log('');

    // Connect to node
    console.log('🔌 Connecting to PRMX node...');
    const wsProvider = new WsProvider(wsUrl);
    const api = await ApiPromise.create({ provider: wsProvider });

    const chain = await api.rpc.system.chain();
    console.log(`✅ Connected to: ${chain.toString()}`);
    console.log('');

    // Setup keyring with Alice (sudo account in dev mode)
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    console.log(`📝 Using account: ${alice.address}`);
    console.log('');

    // Send the extrinsic
    console.log('💉 Injecting AccuWeather API key via extrinsic...');
    
    try {
        await new Promise((resolve, reject) => {
            api.tx.sudo.sudo(
                api.tx.prmxOracle.setAccuweatherApiKey(apiKey)
            ).signAndSend(alice, { nonce: -1 }, ({ status, events, dispatchError }) => {
                if (dispatchError) {
                    if (dispatchError.isModule) {
                        const decoded = api.registry.findMetaError(dispatchError.asModule);
                        reject(new Error(`${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`));
                    } else {
                        reject(new Error(dispatchError.toString()));
                    }
                    return;
                }
                
                if (status.isInBlock) {
                    console.log(`📦 Included in block: ${status.asInBlock.toString().substring(0, 18)}...`);
                }
                
                if (status.isFinalized) {
                    console.log(`✅ Finalized in block: ${status.asFinalized.toString().substring(0, 18)}...`);
                    resolve();
                }
            });
        });
        
        console.log('');
        console.log('🎉 API key successfully configured!');
        console.log('');
        console.log('The offchain worker will now:');
        console.log('  1. Copy the key to its local storage');
        console.log('  2. Start fetching rainfall data from AccuWeather');
        console.log('  3. Submit rainfall updates on-chain');
        console.log('');
        
        // Check oracle status
        try {
            const locationConfig = await api.query.prmxOracle.marketLocationConfig(0);
            if (locationConfig.isSome) {
                const config = locationConfig.unwrap();
                const locationKey = Buffer.from(config.accuweatherLocationKey.toU8a()).toString().replace(/\0/g, '');
                console.log(`📍 Market 0 AccuWeather location: ${locationKey}`);
            }
            
            const rollingState = await api.query.prmxOracle.rollingState(0);
            if (rollingState.isSome) {
                const state = rollingState.unwrap();
                console.log(`🌧️ Market 0 rolling sum: ${state.rollingSumMm.toNumber() / 10} mm`);
            }
        } catch (e) {
            // Ignore query errors
        }
        
    } catch (error) {
        console.error('');
        console.error(`❌ Failed to set API key: ${error.message}`);
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
