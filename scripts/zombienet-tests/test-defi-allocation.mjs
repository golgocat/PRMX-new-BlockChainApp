#!/usr/bin/env node
/**
 * PRMX DeFi Allocation Test
 * 
 * This script tests the allocate_to_defi flow:
 * 1. Create a policy with capital locked in the pool
 * 2. DAO allocates part of the capital to DeFi strategy (Hydration Pool 102)
 * 3. Verify the position is tracked correctly
 * 4. Verify the investment status is updated
 * 
 * Usage: node test-defi-allocation.mjs
 * 
 * Prerequisites:
 * - PRMX node running at ws://127.0.0.1:9944
 * - Market 0 (Manila) exists
 * - DAO account has sufficient USDT
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

// Configuration
const WS_ENDPOINT = 'ws://127.0.0.1:9944';
const USDT_ASSET_ID = 1;
const MARKET_ID = 0;

// Test parameters
const SHARES = 1; // 1 share = 100 USDT coverage
const PAYOUT_PER_SHARE = 100_000_000n; // 100 USDT in smallest units

// Helper to format USDT balance
function formatUsdt(balance) {
    return `${(Number(balance) / 1e6).toFixed(2)} USDT`;
}

// Helper to wait for a transaction to be included
async function submitAndWait(api, tx, signer, description) {
    console.log(`   ⏳ Submitting: ${description}`);
    
    return new Promise((resolve, reject) => {
        tx.signAndSend(signer, { nonce: -1 }, (result) => {
            if (result.status.isInBlock) {
                console.log(`   ✅ Included in block: ${result.status.asInBlock.toHex()}`);
                
                // Check for errors
                const failed = result.events.find(({ event }) => 
                    api.events.system.ExtrinsicFailed.is(event)
                );
                
                if (failed) {
                    const error = failed.event.data[0];
                    console.log(`   ❌ Transaction failed:`, error.toString());
                    reject(new Error(`Transaction failed: ${error.toString()}`));
                } else {
                    resolve(result);
                }
            }
        }).catch(reject);
    });
}

async function main() {
    console.log('🚀 PRMX DeFi Allocation Test (Hydration Pool 102)');
    console.log('='.repeat(60));
    
    // Connect to the node
    console.log(`\n📡 Connecting to ${WS_ENDPOINT}...`);
    const provider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider });
    console.log('   Connected!');
    
    // Setup keyring
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice'); // DAO account
    const bob = keyring.addFromUri('//Bob'); // Policy holder
    
    console.log(`\n👤 DAO Account (Alice): ${alice.address}`);
    console.log(`👤 Policy Holder (Bob): ${bob.address}`);
    
    try {
        // Step 1: Check initial state
        console.log('\n📋 Step 1: Checking initial state...');
        
        const totalLpShares = await api.query.prmxXcmCapital.totalLpShares();
        console.log(`   Total LP shares: ${totalLpShares.toString()}`);
        
        // Step 2: Get or create a policy
        console.log('\n📋 Step 2: Getting policy info...');
        
        // Check existing policies
        const nextPolicyId = await api.query.prmxPolicy.nextPolicyId();
        console.log(`   Next policy ID: ${nextPolicyId.toString()}`);
        
        // If no policies exist, we need to create one first
        // This test assumes a policy already exists (policy_id = 0)
        const policyId = 0;
        const policyOpt = await api.query.prmxPolicy.policies(policyId);
        
        if (policyOpt.isNone) {
            console.log('   ⚠️  No policy found. Please create a policy first using test-full-insurance-cycle.mjs');
            console.log('   Exiting...');
            await api.disconnect();
            return;
        }
        
        const policy = policyOpt.unwrap();
        console.log(`   Policy ID: ${policyId}`);
        console.log(`   Policy holder: ${policy.holder.toString()}`);
        console.log(`   Max payout: ${formatUsdt(policy.maxPayout.toString())}`);
        console.log(`   Status: ${policy.status.toString()}`);
        
        // Step 3: Check current investment status
        console.log('\n📋 Step 3: Checking investment status...');
        
        const investmentStatus = await api.query.prmxXcmCapital.policyInvestmentStatus(policyId);
        console.log(`   Investment status: ${investmentStatus.toString()}`);
        
        const positionOpt = await api.query.prmxXcmCapital.policyLpPositions(policyId);
        if (positionOpt.isSome) {
            const pos = positionOpt.unwrap();
            console.log(`   LP shares: ${pos.lpShares.toString()}`);
            console.log(`   Principal USDT: ${formatUsdt(pos.principalUsdt.toString())}`);
        } else {
            console.log('   No LP position (not invested)');
        }
        
        // Step 4: Allocate to DeFi (only if not already invested)
        if (investmentStatus.isNotInvested || investmentStatus.toString() === 'NotInvested') {
            console.log('\n📋 Step 4: Allocating to DeFi strategy (Pool 102)...');
            
            // Allocate 50% of max_payout to DeFi
            const allocationAmount = BigInt(policy.maxPayout.toString()) / 2n;
            console.log(`   Allocating ${formatUsdt(allocationAmount.toString())} to DeFi`);
            
            // Create and submit the DAO allocation call
            const allocateTx = api.tx.sudo.sudo(
                api.tx.prmxXcmCapital.daoAllocateToDefi(policyId, allocationAmount)
            );
            
            await submitAndWait(api, allocateTx, alice, 'dao_allocate_to_defi');
            
            // Step 5: Verify the allocation
            console.log('\n📋 Step 5: Verifying allocation...');
            
            const newStatus = await api.query.prmxXcmCapital.policyInvestmentStatus(policyId);
            console.log(`   New investment status: ${newStatus.toString()}`);
            
            const newPositionOpt = await api.query.prmxXcmCapital.policyLpPositions(policyId);
            if (newPositionOpt.isSome) {
                const pos = newPositionOpt.unwrap();
                console.log(`   LP shares: ${pos.lpShares.toString()}`);
                console.log(`   Principal USDT: ${formatUsdt(pos.principalUsdt.toString())}`);
            }
            
            const newTotalShares = await api.query.prmxXcmCapital.totalLpShares();
            console.log(`   Total LP shares: ${newTotalShares.toString()}`);
            
            // Verify invariants
            console.log('\n✅ Verifying invariants...');
            
            if (newStatus.toString() === 'Invested') {
                console.log('   ✓ Investment status is Invested');
            } else {
                console.log(`   ✗ Expected Invested, got ${newStatus.toString()}`);
            }
            
            if (newPositionOpt.isSome) {
                const pos = newPositionOpt.unwrap();
                const principalMatch = BigInt(pos.principalUsdt.toString()) === allocationAmount;
                if (principalMatch) {
                    console.log('   ✓ Principal matches allocation amount');
                } else {
                    console.log(`   ✗ Principal mismatch: expected ${formatUsdt(allocationAmount.toString())}, got ${formatUsdt(pos.principalUsdt.toString())}`);
                }
            }
            
        } else {
            console.log('\n⚠️  Policy is already invested in DeFi. Skipping allocation test.');
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('🎉 DeFi Allocation Test Complete!');
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        throw error;
    } finally {
        await api.disconnect();
    }
}

main().catch(console.error);
