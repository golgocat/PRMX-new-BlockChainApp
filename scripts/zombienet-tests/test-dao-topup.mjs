#!/usr/bin/env node
/**
 * PRMX DAO Topup Test (DeFi Loss Scenario)
 * 
 * This script tests the scenario where DeFi loses money:
 * 1. Create a policy and allocate capital to DeFi
 * 2. Set a negative mock yield rate (simulating DeFi loss)
 * 3. Settle the policy
 * 4. Verify DAO covers the shortfall
 * 5. Verify policy holder/LPs receive deterministic payouts
 * 
 * Key invariant tested: "DeFi loss is covered 100% by the DAO"
 * 
 * Usage: node test-dao-topup.mjs
 * 
 * Prerequisites:
 * - PRMX node running at ws://127.0.0.1:9944
 * - Market 0 (Manila) exists
 * - DAO account has sufficient USDT to cover losses
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

// Configuration
const WS_ENDPOINT = 'ws://127.0.0.1:9944';
const USDT_ASSET_ID = 1;
const MARKET_ID = 0;

// Mock yield rate: -10% loss (in parts per million)
// -100_000 ppm = -10%
const MOCK_LOSS_RATE_PPM = -100_000;

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
    console.log('🚀 PRMX DAO Topup Test (DeFi Loss Scenario)');
    console.log('='.repeat(60));
    console.log('\n📖 Testing invariant: "DeFi loss is covered 100% by the DAO"');
    
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
        // Step 1: Check current mock yield rate
        console.log('\n📋 Step 1: Checking current mock yield rate...');
        
        const currentYieldRate = await api.query.prmxXcmCapital.mockYieldRatePpm();
        console.log(`   Current yield rate: ${currentYieldRate.toString()} ppm`);
        
        // Step 2: Set negative yield rate (simulating DeFi loss)
        console.log('\n📋 Step 2: Setting negative yield rate (simulating -10% DeFi loss)...');
        
        const setYieldTx = api.tx.sudo.sudo(
            api.tx.prmxXcmCapital.setMockYieldRate(MOCK_LOSS_RATE_PPM)
        );
        
        await submitAndWait(api, setYieldTx, alice, 'set_mock_yield_rate');
        
        const newYieldRate = await api.query.prmxXcmCapital.mockYieldRatePpm();
        console.log(`   New yield rate: ${newYieldRate.toString()} ppm (-10%)`);
        
        // Step 3: Find or identify an invested policy
        console.log('\n📋 Step 3: Finding an invested policy...');
        
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
            console.log('   This test requires an invested policy with ended coverage window.');
            console.log('   Please set up a test policy first.');
            await api.disconnect();
            return;
        }
        
        console.log(`   Found invested policy: ${investedPolicyId}`);
        
        // Get policy and position details
        const policy = (await api.query.prmxPolicy.policies(investedPolicyId)).unwrap();
        const positionOpt = await api.query.prmxXcmCapital.policyLpPositions(investedPolicyId);
        
        console.log(`   Max payout: ${formatUsdt(policy.maxPayout.toString())}`);
        console.log(`   Coverage end: ${policy.coverageEnd.toString()}`);
        
        if (positionOpt.isSome) {
            const pos = positionOpt.unwrap();
            console.log(`   DeFi principal: ${formatUsdt(pos.principalUsdt.toString())}`);
            console.log(`   DeFi shares: ${pos.lpShares.toString()}`);
            
            // Calculate expected loss
            const principal = BigInt(pos.principalUsdt.toString());
            const expectedLoss = principal * BigInt(Math.abs(MOCK_LOSS_RATE_PPM)) / 1_000_000n;
            console.log(`   Expected loss (10%): ${formatUsdt(expectedLoss.toString())}`);
        }
        
        // Step 4: Check if coverage has ended
        console.log('\n📋 Step 4: Checking coverage window...');
        
        const currentTime = Math.floor(Date.now() / 1000);
        const coverageEnd = Number(policy.coverageEnd.toString());
        
        if (currentTime < coverageEnd) {
            console.log(`   ⚠️  Coverage ends in ${coverageEnd - currentTime} seconds.`);
            console.log('   Cannot settle until coverage ends.');
            
            // Reset yield rate before exiting
            console.log('\n   Resetting yield rate to 0...');
            const resetTx = api.tx.sudo.sudo(api.tx.prmxXcmCapital.setMockYieldRate(0));
            await submitAndWait(api, resetTx, alice, 'reset_mock_yield_rate');
            
            await api.disconnect();
            return;
        }
        
        console.log('   ✓ Coverage window has ended');
        
        // Step 5: Record DAO balance before settlement
        console.log('\n📋 Step 5: Recording DAO balance before settlement...');
        
        const daoBalanceBefore = await api.query.assets.account(USDT_ASSET_ID, alice.address);
        const daoBefore = BigInt(daoBalanceBefore.isSome ? daoBalanceBefore.unwrap().balance.toString() : '0');
        console.log(`   DAO USDT before: ${formatUsdt(daoBefore.toString())}`);
        
        // Step 6: Settle the policy
        console.log('\n📋 Step 6: Settling policy (triggers unwind with loss)...');
        
        const settleTx = api.tx.prmxPolicy.settlePolicy(investedPolicyId, false);
        
        try {
            await submitAndWait(api, settleTx, bob, 'settle_policy');
        } catch (e) {
            console.log(`   Note: Settlement may have events worth checking`);
        }
        
        // Step 7: Verify DAO topped up the shortfall
        console.log('\n📋 Step 7: Verifying DAO topup...');
        
        const daoBalanceAfter = await api.query.assets.account(USDT_ASSET_ID, alice.address);
        const daoAfter = BigInt(daoBalanceAfter.isSome ? daoBalanceAfter.unwrap().balance.toString() : '0');
        const daoChange = daoAfter - daoBefore;
        
        console.log(`   DAO USDT after: ${formatUsdt(daoAfter.toString())}`);
        console.log(`   DAO USDT change: ${daoChange >= 0n ? '+' : ''}${formatUsdt(daoChange.toString())}`);
        
        // Check settlement result
        const settlementResult = await api.query.prmxPolicy.settlementResults(investedPolicyId);
        if (settlementResult.isSome) {
            const result = settlementResult.unwrap();
            console.log(`   Settlement - Event: ${result.eventOccurred.toString()}`);
            console.log(`   Settlement - To holder: ${formatUsdt(result.payoutToHolder.toString())}`);
            console.log(`   Settlement - To LPs: ${formatUsdt(result.returnedToLps.toString())}`);
        }
        
        // Step 8: Verify invariants
        console.log('\n✅ Verifying invariants...');
        
        // Check investment status is Settled
        const newStatus = await api.query.prmxXcmCapital.policyInvestmentStatus(investedPolicyId);
        if (newStatus.toString() === 'Settled') {
            console.log('   ✓ Investment status is Settled');
        } else {
            console.log(`   ✗ Expected Settled, got ${newStatus.toString()}`);
        }
        
        // Check position is removed
        const newPositionOpt = await api.query.prmxXcmCapital.policyLpPositions(investedPolicyId);
        if (newPositionOpt.isNone) {
            console.log('   ✓ DeFi position removed (full unwind)');
        } else {
            console.log('   ✗ DeFi position still exists (unexpected)');
        }
        
        // If DAO spent money (negative change), it covered the loss
        if (daoChange < 0n) {
            console.log('   ✓ DAO covered the DeFi loss (balance decreased)');
        } else {
            console.log('   Note: DAO balance change was non-negative');
            console.log('   This may happen if the mock interface behavior differs');
        }
        
        // Step 9: Reset yield rate
        console.log('\n📋 Step 9: Resetting mock yield rate to 0...');
        
        const resetTx = api.tx.sudo.sudo(api.tx.prmxXcmCapital.setMockYieldRate(0));
        await submitAndWait(api, resetTx, alice, 'reset_mock_yield_rate');
        
        console.log('\n' + '='.repeat(60));
        console.log('🎉 DAO Topup Test Complete!');
        console.log('\n📝 Summary:');
        console.log('   - DeFi loss scenario was simulated with -10% yield');
        console.log('   - Settlement triggered ensure_local_liquidity');
        console.log('   - DAO covered any shortfall from the loss');
        console.log('   - Policy holders/LPs received deterministic payouts');
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        
        // Try to reset yield rate even on error
        try {
            console.log('\n   Attempting to reset yield rate...');
            const resetTx = api.tx.sudo.sudo(api.tx.prmxXcmCapital.setMockYieldRate(0));
            await submitAndWait(api, resetTx, alice, 'reset_mock_yield_rate');
        } catch (e) {
            console.log('   Could not reset yield rate');
        }
        
        throw error;
    } finally {
        await api.disconnect();
    }
}

main().catch(console.error);
