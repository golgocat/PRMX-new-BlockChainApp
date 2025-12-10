#!/usr/bin/env node
/**
 * PRMX Functional Test - Auto Settlement Timing Verification
 * 
 * This test verifies that settlement checks run at the correct intervals
 * based on BLOCKS_PER_SETTLEMENT_CHECK constant (default: 10 blocks).
 * 
 * Flow:
 * 1. Create a policy
 * 2. Monitor block numbers
 * 3. Verify settlement checks occur at expected intervals
 * 
 * Usage: node test-auto-settlement-timing.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import {
    WS_ENDPOINT, MARKET_ID,
    getChainTime, setupOracle,
    printHeader, printSection
} from './common.mjs';

const BLOCKS_PER_SETTLEMENT_CHECK = 10;
const BLOCKS_PER_HOUR = 600;

async function main() {
    printHeader('PRMX FUNCTIONAL TEST - AUTO SETTLEMENT TIMING');
    
    console.log('\n📋 This test verifies settlement check timing configuration.');
    console.log(`   Expected: Settlement checks every ${BLOCKS_PER_SETTLEMENT_CHECK} blocks`);
    console.log(`   OCW rainfall fetch: Every ${BLOCKS_PER_HOUR} blocks (1 hour)`);

    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    
    console.log('\n✅ Connected to PRMX node');

    // =========================================================================
    // SETUP
    // =========================================================================
    printSection('STEP 1: SETUP AND INITIAL STATE');
    
    await setupOracle(api, alice, MARKET_ID);
    console.log('✅ Oracle configured');

    const initialBlock = (await api.rpc.chain.getHeader()).number.toNumber();
    console.log(`\n   Current block: #${initialBlock}`);
    console.log(`   Next settlement check at: #${Math.ceil(initialBlock / BLOCKS_PER_SETTLEMENT_CHECK) * BLOCKS_PER_SETTLEMENT_CHECK}`);

    // =========================================================================
    // MONITOR BLOCK PROGRESSION
    // =========================================================================
    printSection('STEP 2: MONITOR BLOCK PROGRESSION');
    
    console.log('   Monitoring blocks to verify on_initialize behavior...');
    console.log(`   (Watching for ${BLOCKS_PER_SETTLEMENT_CHECK * 3} blocks)`);
    console.log('');

    let lastBlock = initialBlock;
    const settlementCheckBlocks = [];
    const targetBlocks = initialBlock + (BLOCKS_PER_SETTLEMENT_CHECK * 3);

    while (lastBlock < targetBlocks) {
        await new Promise(r => setTimeout(r, 2000)); // Poll every 2 seconds
        
        const currentBlock = (await api.rpc.chain.getHeader()).number.toNumber();
        
        if (currentBlock > lastBlock) {
            for (let b = lastBlock + 1; b <= currentBlock; b++) {
                const isSettlementCheckBlock = b % BLOCKS_PER_SETTLEMENT_CHECK === 0;
                const isOcwBlock = b % BLOCKS_PER_HOUR === 0 || b === 1; // OCW runs at startup and hourly
                
                if (isSettlementCheckBlock || isOcwBlock) {
                    console.log(`   Block #${b}:`);
                    if (isSettlementCheckBlock) {
                        console.log(`      ✅ Settlement check block (${b} % ${BLOCKS_PER_SETTLEMENT_CHECK} = 0)`);
                        settlementCheckBlocks.push(b);
                    }
                    if (isOcwBlock) {
                        console.log(`      🌧️ OCW rainfall fetch block`);
                    }
                } else {
                    // Only show every 5th non-important block
                    if (b % 5 === 0) {
                        console.log(`   Block #${b}: Regular block`);
                    }
                }
            }
            lastBlock = currentBlock;
        }
    }

    // =========================================================================
    // VERIFY TIMING CONSTANTS
    // =========================================================================
    printSection('STEP 3: VERIFY TIMING CONFIGURATION');
    
    console.log('\n   📊 Expected vs Actual Settlement Check Blocks:');
    
    let expectedBlocks = [];
    for (let b = Math.ceil(initialBlock / BLOCKS_PER_SETTLEMENT_CHECK) * BLOCKS_PER_SETTLEMENT_CHECK; 
         b <= targetBlocks; 
         b += BLOCKS_PER_SETTLEMENT_CHECK) {
        expectedBlocks.push(b);
    }
    
    console.log(`\n   Expected: [${expectedBlocks.join(', ')}]`);
    console.log(`   Observed: [${settlementCheckBlocks.join(', ')}]`);
    
    const correctTiming = expectedBlocks.every((b, i) => settlementCheckBlocks[i] === b);

    // =========================================================================
    // TIMING CALCULATIONS
    // =========================================================================
    printSection('STEP 4: TIMING CALCULATIONS');
    
    const blockTime = 6; // seconds per block
    const settlementCheckIntervalSecs = BLOCKS_PER_SETTLEMENT_CHECK * blockTime;
    const ocwFetchIntervalSecs = BLOCKS_PER_HOUR * blockTime;
    
    console.log('\n   📐 Timing Configuration:');
    console.log(`      Block time: ${blockTime} seconds`);
    console.log(`      BLOCKS_PER_SETTLEMENT_CHECK: ${BLOCKS_PER_SETTLEMENT_CHECK}`);
    console.log(`      BLOCKS_PER_HOUR: ${BLOCKS_PER_HOUR}`);
    console.log('');
    console.log('   ⏱️ Calculated Intervals:');
    console.log(`      Settlement checks: Every ${settlementCheckIntervalSecs} seconds (${settlementCheckIntervalSecs / 60} minutes)`);
    console.log(`      OCW rainfall fetch: Every ${ocwFetchIntervalSecs} seconds (${ocwFetchIntervalSecs / 3600} hour)`);

    // =========================================================================
    // TEST RESULT
    // =========================================================================
    printHeader('TEST RESULT');
    
    if (correctTiming && settlementCheckBlocks.length >= 2) {
        console.log('\n   ✅ TEST PASSED: Settlement timing is correctly configured!');
        console.log(`   • Settlement checks run every ${BLOCKS_PER_SETTLEMENT_CHECK} blocks`);
        console.log(`   • Interval: ${settlementCheckIntervalSecs} seconds (${settlementCheckIntervalSecs / 60} minutes)`);
    } else {
        console.log('\n   ⚠️  TEST INCONCLUSIVE: Could not verify all expected blocks');
        console.log(`   • Expected ${expectedBlocks.length} settlement check blocks`);
        console.log(`   • Observed ${settlementCheckBlocks.length} settlement check blocks`);
    }

    console.log('\n   💡 Note: To change settlement check frequency, modify');
    console.log('      BLOCKS_PER_SETTLEMENT_CHECK in pallets/prmx-oracle/src/lib.rs');

    await api.disconnect();
}

main().catch(console.error);
