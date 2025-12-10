#!/usr/bin/env node
/**
 * HRMP Channel Setup Script for Chopsticks XCM Testing
 * 
 * This script verifies and sets up HRMP channels needed for XCM testing:
 *   - PRMX (2000) <-> Asset Hub (1000)
 *   - Asset Hub (1000) <-> Hydration (2034)  [already exists on mainnet]
 * 
 * Usage:
 *   node scripts/chopsticks-tests/setup-hrmp-channels.mjs
 * 
 * Prerequisites:
 *   - Chopsticks running with xcm-test.yml config
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

import {
    CHAINS,
    connectToChain,
    checkHrmpChannel,
    printHrmpStatus,
    submitAndWait,
    getKeyring,
    getPrmxSovereignOnAssetHub,
    getPrmxSovereignOnHydration,
} from './common.mjs';

// =============================================================================
//                       HRMP Channel Configuration
// =============================================================================

const HRMP_CONFIG = {
    maxCapacity: 8,
    maxTotalSize: 8192,
    maxMessageSize: 1048576,
};

// =============================================================================
//                       Main Script
// =============================================================================

async function main() {
    console.log('🔗 PRMX XCM HRMP Channel Setup');
    console.log('='.repeat(60));
    
    let relayApi = null;
    
    try {
        // Connect to relay chain
        console.log('\n📡 Connecting to Polkadot relay chain...');
        relayApi = await connectToChain('polkadot');
        
        // Print current HRMP status
        await printHrmpStatus(relayApi);
        
        // Check required channels
        console.log('\n📋 Checking required channels...');
        
        const prmxToAssetHub = await checkHrmpChannel(
            relayApi, 
            CHAINS.prmx.paraId, 
            CHAINS.assetHub.paraId
        );
        const assetHubToPrmx = await checkHrmpChannel(
            relayApi, 
            CHAINS.assetHub.paraId, 
            CHAINS.prmx.paraId
        );
        const assetHubToHydration = await checkHrmpChannel(
            relayApi, 
            CHAINS.assetHub.paraId, 
            CHAINS.hydration.paraId
        );
        const hydrationToAssetHub = await checkHrmpChannel(
            relayApi, 
            CHAINS.hydration.paraId, 
            CHAINS.assetHub.paraId
        );
        
        // Summary
        console.log('\n📊 Channel Summary:');
        console.log(`   PRMX -> Asset Hub:     ${prmxToAssetHub ? '✅ Ready' : '❌ Needs setup'}`);
        console.log(`   Asset Hub -> PRMX:     ${assetHubToPrmx ? '✅ Ready' : '❌ Needs setup'}`);
        console.log(`   Asset Hub -> Hydration: ${assetHubToHydration ? '✅ Ready' : '⚠️  Should exist on mainnet'}`);
        console.log(`   Hydration -> Asset Hub: ${hydrationToAssetHub ? '✅ Ready' : '⚠️  Should exist on mainnet'}`);
        
        // Print sovereign accounts
        console.log('\n🔑 Sovereign Accounts:');
        console.log(`   PRMX on Asset Hub:  ${getPrmxSovereignOnAssetHub()}`);
        console.log(`   PRMX on Hydration:  ${getPrmxSovereignOnHydration()}`);
        
        // If using Chopsticks with storage overrides, channels should already be open
        if (prmxToAssetHub && assetHubToPrmx) {
            console.log('\n✅ All required PRMX <-> Asset Hub channels are open!');
            console.log('   XCM testing can proceed.');
        } else {
            console.log('\n⚠️  HRMP channels not configured.');
            console.log('   Make sure your Chopsticks config includes HRMP channel overrides.');
            console.log('   See chopsticks/xcm-test.yml for the required configuration.');
            
            // Print the required storage override format
            console.log('\n📝 Required Chopsticks HRMP configuration:');
            console.log(`
import-storage:
  Hrmp:
    HrmpChannels:
      # PRMX -> Asset Hub
      - - [${CHAINS.prmx.paraId}, ${CHAINS.assetHub.paraId}]
        - maxCapacity: ${HRMP_CONFIG.maxCapacity}
          maxTotalSize: ${HRMP_CONFIG.maxTotalSize}
          maxMessageSize: ${HRMP_CONFIG.maxMessageSize}
          msgCount: 0
          totalSize: 0
          mqcHead: null
          senderDeposit: 0
          recipientDeposit: 0
      # Asset Hub -> PRMX
      - - [${CHAINS.assetHub.paraId}, ${CHAINS.prmx.paraId}]
        - maxCapacity: ${HRMP_CONFIG.maxCapacity}
          maxTotalSize: ${HRMP_CONFIG.maxTotalSize}
          maxMessageSize: ${HRMP_CONFIG.maxMessageSize}
          msgCount: 0
          totalSize: 0
          mqcHead: null
          senderDeposit: 0
          recipientDeposit: 0
`);
        }
        
        // Check Asset Hub <-> Hydration (should be pre-existing on forked mainnet)
        if (!assetHubToHydration || !hydrationToAssetHub) {
            console.log('\n⚠️  Asset Hub <-> Hydration channels not found.');
            console.log('   This is unexpected if forking from mainnet.');
            console.log('   Verify Chopsticks is correctly forking the relay chain state.');
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('🎉 HRMP Channel Setup Complete!');
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        if (relayApi) {
            await relayApi.disconnect();
        }
    }
}

main().catch(console.error);
