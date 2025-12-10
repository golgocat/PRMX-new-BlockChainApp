#!/usr/bin/env node
/**
 * PRMX DeFi Unwind Test
 * 
 * This script tests the ensure_local_liquidity flow during settlement:
 * 1. Create a policy and allocate capital to DeFi (Hydration Pool 102)
 * 2. Wait for coverage window to end
 * 3. Settle the policy (which triggers ensure_local_liquidity)
 * 4. Verify the LP position is unwound
 * 5. Verify funds are properly distributed
 * 
 * Usage: node test-defi-unwind.mjs
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

// Wait for next block
async function waitBlocks(api, count = 1) {
    console.log(`   ⏳ Waiting for ${count} block(s)...`);
    for (let i = 0; i < count; i++) {
        await new Promise(resolve => {
            const unsub = api.rpc.chain.subscribeNewHeads(() => {
                unsub.then(u => u());
                resolve();
            });
        });
    }
}

async function main() {
    console.log('🚀 PRMX DeFi Unwind Test (Hydration Pool 102)');
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
        // Step 1: Find an invested policy
        console.log('\n📋 Step 1: Finding an invested policy...');
        
        const nextPolicyId = await api.query.prmxPolicy.nextPolicyId();
        let investedPolicyId = null;
        
        for (let i = 0; i < Number(nextPolicyId.toString()); i++) {
            const status = await api.query.prmxXcmCapital.policyInvestmentStatus(i);
            if (status.toString() === 'Invested') {
                const policyOpt = await api.query.prmxPolicy.policies(i);
                if (policyOpt.isSome) {
                    const policy = policyOpt.unwrap();
                    if (policy.status.toString() === 'Active') {
                        investedPolicyId = i;
                        break;
                    }
                }
            }
        }
        
        if (investedPolicyId === null) {
            console.log('   ⚠️  No invested active policy found.');
            console.log('   Please run test-defi-allocation.mjs first to create an invested policy.');
            await api.disconnect();
            return;
        }
        
        console.log(`   Found invested policy: ${investedPolicyId}`);
        
        // Get policy details
        const policy = (await api.query.prmxPolicy.policies(investedPolicyId)).unwrap();
        console.log(`   Policy holder: ${policy.holder.toString()}`);
        console.log(`   Coverage end: ${policy.coverageEnd.toString()}`);
        console.log(`   Max payout: ${formatUsdt(policy.maxPayout.toString())}`);
        
        // Get LP position details
        const positionOpt = await api.query.prmxXcmCapital.policyLpPositions(investedPolicyId);
        if (positionOpt.isSome) {
            const pos = positionOpt.unwrap();
            console.log(`   LP shares: ${pos.lpShares.toString()}`);
            console.log(`   Principal: ${formatUsdt(pos.principalUsdt.toString())}`);
        }
        
        // Step 2: Check if coverage window has ended
        console.log('\n📋 Step 2: Checking coverage window...');
        
        const currentTime = Math.floor(Date.now() / 1000);
        const coverageEnd = Number(policy.coverageEnd.toString());
        
        if (currentTime < coverageEnd) {
            const waitTime = coverageEnd - currentTime;
            console.log(`   Coverage ends in ${waitTime} seconds.`);
            console.log('   ⚠️  Please wait for coverage to end or use a policy with ended coverage.');
            console.log('   Alternatively, set a short coverage window in the test.');
            await api.disconnect();
            return;
        }
        
        console.log('   ✓ Coverage window has ended');
        
        // Step 3: Record balances before settlement
        console.log('\n📋 Step 3: Recording balances before settlement...');
        
        const daoBalanceBefore = await api.query.assets.account(USDT_ASSET_ID, alice.address);
        const holderBalanceBefore = await api.query.assets.account(USDT_ASSET_ID, policy.holder.toString());
        const totalSharesBefore = await api.query.prmxXcmCapital.totalLpShares();
        
        console.log(`   DAO USDT: ${formatUsdt(daoBalanceBefore.isSome ? daoBalanceBefore.unwrap().balance.toString() : '0')}`);
        console.log(`   Holder USDT: ${formatUsdt(holderBalanceBefore.isSome ? holderBalanceBefore.unwrap().balance.toString() : '0')}`);
        console.log(`   Total LP shares: ${totalSharesBefore.toString()}`);
        
        // Step 4: Settle the policy (no event = LP wins)
        console.log('\n📋 Step 4: Settling policy (no event scenario)...');
        
        const settleTx = api.tx.prmxPolicy.settlePolicy(investedPolicyId, false);
        await submitAndWait(api, settleTx, bob, 'settle_policy');
        
        // Step 5: Verify the unwind
        console.log('\n📋 Step 5: Verifying DeFi unwind...');
        
        // Check investment status
        const newStatus = await api.query.prmxXcmCapital.policyInvestmentStatus(investedPolicyId);
        console.log(`   Investment status: ${newStatus.toString()}`);
        
        // Check position is removed
        const newPositionOpt = await api.query.prmxXcmCapital.policyLpPositions(investedPolicyId);
        if (newPositionOpt.isNone) {
            console.log('   ✓ LP position removed');
        } else {
            console.log('   ✗ LP position still exists (unexpected)');
        }
        
        // Check total shares decreased
        const totalSharesAfter = await api.query.prmxXcmCapital.totalLpShares();
        console.log(`   Total LP shares: ${totalSharesBefore.toString()} → ${totalSharesAfter.toString()}`);
        
        // Step 6: Verify fund distribution
        console.log('\n📋 Step 6: Verifying fund distribution...');
        
        const daoBalanceAfter = await api.query.assets.account(USDT_ASSET_ID, alice.address);
        const holderBalanceAfter = await api.query.assets.account(USDT_ASSET_ID, policy.holder.toString());
        
        const daoBefore = BigInt(daoBalanceBefore.isSome ? daoBalanceBefore.unwrap().balance.toString() : '0');
        const daoAfter = BigInt(daoBalanceAfter.isSome ? daoBalanceAfter.unwrap().balance.toString() : '0');
        const daoChange = daoAfter - daoBefore;
        
        console.log(`   DAO USDT change: ${daoChange >= 0n ? '+' : ''}${formatUsdt(daoChange.toString())}`);
        console.log(`   Holder USDT: ${formatUsdt(holderBalanceAfter.isSome ? holderBalanceAfter.unwrap().balance.toString() : '0')}`);
        
        // Verify invariants
        console.log('\n✅ Verifying invariants...');
        
        if (newStatus.toString() === 'Settled') {
            console.log('   ✓ Investment status is Settled');
        } else {
            console.log(`   ✗ Expected Settled, got ${newStatus.toString()}`);
        }
        
        if (newPositionOpt.isNone) {
            console.log('   ✓ Full unwind at settlement (no lingering position)');
        } else {
            console.log('   ✗ Position should be removed after settlement');
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('🎉 DeFi Unwind Test Complete!');
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        throw error;
    } finally {
        await api.disconnect();
    }
}

main().catch(console.error);
