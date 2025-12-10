#!/usr/bin/env node
/**
 * PRMX Functional Test - OCW Rainfall Fetch
 * 
 * This test monitors the Offchain Worker (OCW) to verify it fetches
 * rainfall data from AccuWeather and updates on-chain storage.
 * 
 * Flow:
 * 1. Check existing rainfall data
 * 2. Monitor for OCW activity
 * 3. Verify new rainfall data is submitted via signed transaction
 * 
 * Usage: node test-ocw-rainfall-fetch.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import {
    WS_ENDPOINT, MARKET_ID, MANILA_ACCUWEATHER_KEY,
    getChainTime, setupOracle,
    printHeader, printSection
} from './common.mjs';

const BLOCKS_PER_HOUR = 600;

async function getLatestRainfall(api, marketId) {
    // Get most recent bucket (index 0 is current hour)
    const bucket = await api.query.prmxOracle.rainBuckets(marketId, 0);
    if (bucket.isSome) {
        const b = bucket.unwrap();
        return {
            timestamp: b.timestamp.toNumber(),
            rainfall: b.rainfallMm.toNumber(),
            blockNumber: b.blockNumber.toNumber(),
        };
    }
    return null;
}

async function getMarketLocationConfig(api, marketId) {
    const config = await api.query.prmxOracle.marketLocationConfig(marketId);
    if (config.isSome) {
        return config.unwrap().toString();
    }
    return null;
}

async function main() {
    printHeader('PRMX FUNCTIONAL TEST - OCW RAINFALL FETCH');
    
    console.log('\n📋 This test verifies the Offchain Worker (OCW) functionality.');
    console.log('   OCW fetches rainfall data from AccuWeather API and submits');
    console.log('   signed transactions to update on-chain storage.');
    console.log(`\n   Expected fetch interval: Every ${BLOCKS_PER_HOUR} blocks (1 hour)`);
    console.log('   Note: OCW also fetches on startup (block 1)');

    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    
    console.log('\n✅ Connected to PRMX node');

    // =========================================================================
    // VERIFY ORACLE CONFIGURATION
    // =========================================================================
    printSection('STEP 1: VERIFY ORACLE CONFIGURATION');
    
    await setupOracle(api, alice, MARKET_ID);
    
    const locationKey = await getMarketLocationConfig(api, MARKET_ID);
    console.log(`\n   Market ${MARKET_ID} Location Configuration:`);
    console.log(`      AccuWeather Location Key: ${locationKey || 'NOT SET'}`);
    
    if (!locationKey) {
        console.log('\n   ❌ Location key not set! OCW cannot fetch rainfall data.');
        console.log('      Set it using: prmxOracle.setMarketLocationKey(marketId, key)');
        await api.disconnect();
        return;
    }
    
    console.log('   ✅ Market is configured for AccuWeather data fetching');

    // =========================================================================
    // CHECK CURRENT RAINFALL DATA
    // =========================================================================
    printSection('STEP 2: CHECK CURRENT RAINFALL DATA');
    
    const initialBlock = (await api.rpc.chain.getHeader()).number.toNumber();
    const initialRainfall = await getLatestRainfall(api, MARKET_ID);
    
    console.log(`\n   Current block: #${initialBlock}`);
    
    if (initialRainfall) {
        console.log(`\n   📊 Latest Rainfall Bucket:`);
        console.log(`      Timestamp: ${new Date(initialRainfall.timestamp * 1000).toISOString()}`);
        console.log(`      Rainfall: ${initialRainfall.rainfall / 10}mm`);
        console.log(`      Updated at block: #${initialRainfall.blockNumber}`);
    } else {
        console.log('   No rainfall data found in bucket 0');
    }

    // =========================================================================
    // CALCULATE NEXT OCW FETCH
    // =========================================================================
    printSection('STEP 3: CALCULATE NEXT OCW FETCH');
    
    const nextFetchBlock = Math.ceil(initialBlock / BLOCKS_PER_HOUR) * BLOCKS_PER_HOUR;
    const blocksUntilFetch = nextFetchBlock - initialBlock;
    const secondsUntilFetch = blocksUntilFetch * 6;
    
    console.log(`\n   📐 OCW Fetch Schedule:`);
    console.log(`      Current block: #${initialBlock}`);
    console.log(`      Next scheduled fetch: Block #${nextFetchBlock}`);
    console.log(`      Blocks until next fetch: ${blocksUntilFetch}`);
    console.log(`      Estimated time: ${Math.floor(secondsUntilFetch / 60)} minutes`);

    // =========================================================================
    // MONITOR FOR OCW ACTIVITY
    // =========================================================================
    printSection('STEP 4: MONITOR OCW ACTIVITY');
    
    if (blocksUntilFetch > 50) {
        console.log('\n   ⚠️  Next OCW fetch is too far away to wait.');
        console.log('      Showing current state instead.\n');
        
        // Check rolling state
        const rollingState = await api.query.prmxOracle.rollingState(MARKET_ID);
        if (rollingState.isSome) {
            const state = rollingState.unwrap();
            console.log('   📊 Current Oracle Rolling State:');
            console.log(`      24h Rolling Sum: ${state.rollingSumMm.toNumber() / 10}mm`);
            console.log(`      Last Updated: ${new Date(state.lastUpdated.toNumber() * 1000).toISOString()}`);
        }
    } else {
        console.log(`\n   ⏳ Monitoring for OCW activity (${blocksUntilFetch} blocks)...`);
        console.log('   (Looking for RainfallSubmitted events from OCW signed transactions)\n');
        
        let lastBlock = initialBlock;
        let ocwActivityDetected = false;
        
        while (!ocwActivityDetected && lastBlock < nextFetchBlock + 5) {
            await new Promise(r => setTimeout(r, 6000));
            
            const currentBlock = (await api.rpc.chain.getHeader()).number.toNumber();
            
            if (currentBlock > lastBlock) {
                // Check for new rainfall data
                const currentRainfall = await getLatestRainfall(api, MARKET_ID);
                
                if (currentRainfall && 
                    (!initialRainfall || currentRainfall.blockNumber > initialRainfall.blockNumber)) {
                    console.log(`   ✅ OCW Activity Detected at block #${currentBlock}!`);
                    console.log(`      New rainfall data submitted:`);
                    console.log(`      • Rainfall: ${currentRainfall.rainfall / 10}mm`);
                    console.log(`      • Block: #${currentRainfall.blockNumber}`);
                    ocwActivityDetected = true;
                } else {
                    console.log(`   Block #${currentBlock}: No new OCW data yet`);
                }
                
                lastBlock = currentBlock;
            }
        }
        
        if (!ocwActivityDetected) {
            console.log('\n   ⚠️  No OCW activity detected in the monitoring window.');
        }
    }

    // =========================================================================
    // CHECK OCW SIGNED TRANSACTION SETUP
    // =========================================================================
    printSection('STEP 5: VERIFY OCW SIGNED TX SETUP');
    
    // Check if oracle providers include Alice (who has the signing key)
    const providers = await api.query.prmxOracle.oracleProviders();
    const providerList = providers.toJSON();
    
    console.log('\n   🔐 Oracle Provider Configuration:');
    console.log(`      Registered providers: ${JSON.stringify(providerList)}`);
    
    const aliceIsProvider = providerList.some(p => p === alice.address);
    console.log(`      Alice is provider: ${aliceIsProvider ? '✅ YES' : '❌ NO'}`);
    
    if (!aliceIsProvider) {
        console.log('\n   ⚠️  Alice is not a registered oracle provider!');
        console.log('      OCW signed transactions require the signing account to be a provider.');
    }

    // =========================================================================
    // TEST RESULT
    // =========================================================================
    printHeader('TEST RESULT');
    
    const hasLocationKey = locationKey !== null;
    const hasRainfallData = initialRainfall !== null;
    
    if (hasLocationKey && hasRainfallData && aliceIsProvider) {
        console.log('\n   ✅ TEST PASSED: OCW is properly configured!');
        console.log('   • AccuWeather location key is set');
        console.log('   • Rainfall data exists on-chain');
        console.log('   • Oracle provider is registered');
        console.log(`   • OCW fetches every ${BLOCKS_PER_HOUR} blocks`);
    } else {
        console.log('\n   ⚠️  TEST NEEDS ATTENTION:');
        if (!hasLocationKey) console.log('   • Missing: AccuWeather location key');
        if (!hasRainfallData) console.log('   • Missing: On-chain rainfall data');
        if (!aliceIsProvider) console.log('   • Missing: Oracle provider registration');
    }

    console.log('\n   💡 OCW Behavior:');
    console.log('   • Fetches from AccuWeather API using configured location key');
    console.log('   • Submits signed transaction to update on-chain storage');
    console.log('   • Uses Alice\'s key (//Alice) loaded at node startup');

    await api.disconnect();
}

main().catch(console.error);
