#!/usr/bin/env node
/**
 * Set R Pricing API Key via Extrinsic
 * 
 * This script configures the R Pricing API key for the quote pallet
 * by calling the setPricingApiKey extrinsic (via sudo).
 * 
 * Usage:
 *   node set-pricing-api-key.mjs [api-key] [ws-url]
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

async function main() {
    const apiKey = process.argv[2] || process.env.R_PRICING_API_KEY || 'test_api_key';
    const wsUrl = process.argv[3] || 'ws://127.0.0.1:9944';
    
    console.log('═'.repeat(60));
    console.log('PRMX R Pricing API Key Configuration');
    console.log('═'.repeat(60));
    console.log(`API Key: ${apiKey.substring(0, 10)}...${apiKey.slice(-4)}`);
    console.log(`Node URL: ${wsUrl}`);
    console.log('');

    const wsProvider = new WsProvider(wsUrl);
    const api = await ApiPromise.create({ provider: wsProvider });
    const chain = await api.rpc.system.chain();
    console.log(`✅ Connected to: ${chain.toString()}`);
    console.log('');

    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    console.log(`📝 Using account: ${alice.address}`);
    console.log('');

    console.log('💉 Injecting R Pricing API key via extrinsic...');
    
    try {
        await new Promise((resolve, reject) => {
            api.tx.sudo.sudo(
                api.tx.prmxQuote.setPricingApiKey(apiKey)
            ).signAndSend(alice, { nonce: -1 }, ({ status, dispatchError }) => {
                if (dispatchError) {
                    reject(new Error(dispatchError.toString()));
                    return;
                }
                if (status.isFinalized) {
                    console.log(`✅ Finalized in block: ${status.asFinalized.toString().substring(0, 18)}...`);
                    resolve();
                }
            });
        });
        
        console.log('');
        console.log('🎉 R Pricing API key successfully configured!');
        console.log('');
    } catch (error) {
        console.error('');
        console.error(`❌ Failed to set API key: ${error.message}`);
        process.exit(1);
    }

    await api.disconnect();
    console.log('Done!');
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});

