#!/usr/bin/env node
/**
 * PRMX DAO Solvency Block Test
 * 
 * This test verifies that allocation is BLOCKED when DAO cannot cover
 * the potential 100% loss from DeFi strategy.
 * 
 * Flow:
 * 1. Drain DAO to make it insolvent
 * 2. Create a policy (should succeed - policy creation doesn't require solvency)
 * 3. Verify that auto-allocation to DeFi FAILS due to insolvency
 * 4. Restore DAO funds
 * 5. Manually trigger allocation (should succeed now)
 * 
 * Usage: node test-solvency-block.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

// Configuration
const WS_ENDPOINT = 'ws://127.0.0.1:9944';
const USDT_ASSET_ID = 1;
const MARKET_ID = 0;

// Test parameters
const SHARES = 10;  // 10 shares = 1000 USDT max payout

// Helper to format USDT balance
function formatUsdt(balance) {
    return `${(Number(balance) / 1e6).toFixed(2)} USDT`;
}

// Helper to wait for a transaction
async function submitAndWait(api, tx, signer, description) {
    console.log(`   ⏳ ${description}...`);
    
    return new Promise((resolve, reject) => {
        tx.signAndSend(signer, { nonce: -1 }, (result) => {
            if (result.status.isInBlock) {
                const failed = result.events.find(({ event }) => 
                    api.events.system.ExtrinsicFailed.is(event)
                );
                
                if (failed) {
                    const error = failed.event.data[0];
                    if (error.isModule) {
                        const decoded = api.registry.findMetaError(error.asModule);
                        console.log(`   ❌ ${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`);
                        reject(new Error(`${decoded.section}.${decoded.name}`));
                    } else {
                        reject(new Error(error.toString()));
                    }
                } else {
                    console.log(`   ✅ Success`);
                    resolve(result);
                }
            }
        }).catch(reject);
    });
}

// Get USDT balance
async function getUsdtBalance(api, address) {
    const account = await api.query.assets.account(USDT_ASSET_ID, address);
    return account.isSome ? BigInt(account.unwrap().balance.toString()) : 0n;
}

async function main() {
    console.log('🚀 DAO Solvency Block Test');
    console.log('='.repeat(70));
    console.log('\n📖 Testing: Allocation is BLOCKED when DAO is insolvent\n');
    
    // Connect
    console.log(`📡 Connecting to ${WS_ENDPOINT}...`);
    const provider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider });
    console.log('   Connected!\n');
    
    // Setup accounts
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');   // DAO
    const bob = keyring.addFromUri('//Bob');       // Policy holder
    const dave = keyring.addFromUri('//Dave');     // Drain target
    
    console.log('👥 Participants:');
    console.log(`   DAO (Alice):      ${alice.address.slice(0, 20)}...`);
    console.log(`   Policy Holder:    ${bob.address.slice(0, 20)}...`);
    
    try {
        // =====================================================================
        // PHASE 1: Record Initial Balances
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 PHASE 1: Initial Balances');
        console.log('='.repeat(70));
        
        const daoInitial = await getUsdtBalance(api, alice.address);
        const bobInitial = await getUsdtBalance(api, bob.address);
        
        console.log(`   DAO (Alice):   ${formatUsdt(daoInitial)}`);
        console.log(`   Bob:           ${formatUsdt(bobInitial)}`);
        
        // =====================================================================
        // PHASE 2: Drain DAO to Make it Insolvent
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 PHASE 2: Drain DAO to Simulate Insolvency');
        console.log('='.repeat(70));
        
        // Leave 950 USDT - enough for policy capital (940 USDT) but not enough
        // for solvency check (needs 1000 USDT to cover potential 100% loss)
        // After policy creation: DAO has 950 - 940 = 10 USDT left
        const targetDaoBalance = 950_000_000n; // 950 USDT
        const drainAmount = daoInitial - targetDaoBalance;
        
        if (drainAmount > 0n) {
            console.log(`\n   Draining DAO to ${formatUsdt(targetDaoBalance)}...`);
            
            await new Promise((resolve, reject) => {
                api.tx.assets.transfer(USDT_ASSET_ID, dave.address, drainAmount.toString())
                    .signAndSend(alice, { nonce: -1 }, (result) => {
                        if (result.status.isInBlock) {
                            console.log(`   ✅ Drain complete`);
                            resolve(result);
                        }
                    }).catch(reject);
            });
        }
        
        const daoAfterDrain = await getUsdtBalance(api, alice.address);
        console.log(`   DAO balance after drain: ${formatUsdt(daoAfterDrain)}`);
        console.log(`   ℹ️  DAO has enough for policy capital (940 USDT)`);
        console.log(`   ⚠️  But after policy, DAO will have ~10 USDT (not enough for solvency check)`);
        
        // =====================================================================
        // PHASE 3: Create Policy (Auto-allocation should FAIL)
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 PHASE 3: Create Policy (Auto-allocation should FAIL)');
        console.log('='.repeat(70));
        
        const now = Math.floor(Date.now() / 1000);
        const coverageStart = now + 300;  // Start in 5 minutes
        const coverageEnd = coverageStart + 3600; // Last 1 hour
        
        // Request quote
        const quoteId = (await api.query.prmxQuote.nextQuoteId()).toNumber();
        console.log(`\n   Quote ID: ${quoteId}`);
        
        await submitAndWait(api, 
            api.tx.prmxQuote.requestPolicyQuote(
                MARKET_ID, coverageStart, coverageEnd, 
                14599500, 120984200, SHARES
            ),
            bob, 'Request quote (10 shares = 1000 USDT max payout)'
        );
        
        // Submit quote
        await submitAndWait(api,
            api.tx.prmxQuote.submitQuote(quoteId, 50000),
            alice, 'Submit quote'
        );
        
        // Apply coverage - this triggers auto-allocation which should FAIL
        console.log('\n   📢 Applying for coverage (auto-allocation to DeFi will be attempted)...');
        console.log('   🔍 After policy creation, DAO will have ~10 USDT but needs 1000 USDT for solvency');
        console.log('   🔍 Allocation should FAIL due to solvency check');
        
        await submitAndWait(api,
            api.tx.prmxPolicy.applyCoverageWithQuote(quoteId),
            bob, 'Apply coverage'
        );
        
        const policyId = (await api.query.prmxPolicy.nextPolicyId()).toNumber() - 1;
        console.log(`\n   ✅ Policy created: ID ${policyId}`);
        
        // Check if DeFi position exists
        const lpPos = await api.query.prmxXcmCapital.policyLpPositions(policyId);
        const investmentStatus = await api.query.prmxXcmCapital.policyInvestmentStatus(policyId);
        
        console.log(`\n   📊 DeFi Position Check:`);
        console.log(`      Position exists: ${lpPos.isSome}`);
        console.log(`      Investment status: ${investmentStatus.toHuman()}`);
        
        if (!lpPos.isSome) {
            console.log(`\n   ✅ EXPECTED: Auto-allocation was BLOCKED due to DAO insolvency!`);
            console.log(`      Policy was created but funds remain in local pool.`);
        } else {
            console.log(`\n   ❌ UNEXPECTED: Allocation succeeded despite insolvency!`);
        }
        
        // =====================================================================
        // PHASE 4: Restore DAO Funds
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 PHASE 4: Restore DAO Funds');
        console.log('='.repeat(70));
        
        const daveBalance = await getUsdtBalance(api, dave.address);
        if (daveBalance > 1_000_000n) {
            await submitAndWait(api,
                api.tx.assets.transfer(USDT_ASSET_ID, alice.address, (daveBalance - 1_000_000n).toString()),
                dave, 'Return funds to DAO'
            );
        }
        
        const daoAfterRestore = await getUsdtBalance(api, alice.address);
        console.log(`\n   DAO balance after restore: ${formatUsdt(daoAfterRestore)}`);
        
        // =====================================================================
        // PHASE 5: Manual Allocation (Should Succeed Now)
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 PHASE 5: Manual Allocation (Should Succeed Now)');
        console.log('='.repeat(70));
        
        const policy = (await api.query.prmxPolicy.policies(policyId)).unwrap();
        const maxPayout = BigInt(policy.maxPayout.toString());
        
        console.log(`\n   Policy max_payout: ${formatUsdt(maxPayout)}`);
        console.log(`   DAO balance: ${formatUsdt(daoAfterRestore)}`);
        console.log(`   DAO can cover: ${daoAfterRestore >= maxPayout ? '✅ YES' : '❌ NO'}`);
        
        await submitAndWait(api,
            api.tx.sudo.sudo(
                api.tx.prmxXcmCapital.daoAllocateToDefi(policyId, maxPayout.toString())
            ),
            alice, `Manually allocate ${formatUsdt(maxPayout)} to DeFi`
        );
        
        // Check DeFi position again
        const lpPosAfter = await api.query.prmxXcmCapital.policyLpPositions(policyId);
        const investmentStatusAfter = await api.query.prmxXcmCapital.policyInvestmentStatus(policyId);
        
        console.log(`\n   📊 DeFi Position Check (after restore):`);
        console.log(`      Position exists: ${lpPosAfter.isSome}`);
        console.log(`      Investment status: ${investmentStatusAfter.toHuman()}`);
        
        if (lpPosAfter.isSome) {
            const pos = lpPosAfter.unwrap();
            console.log(`      Principal: ${formatUsdt(pos.principalUsdt.toString())}`);
            console.log(`      Shares: ${pos.lpShares.toString()}`);
            console.log(`\n   ✅ Manual allocation SUCCEEDED after DAO became solvent!`);
        }
        
        // =====================================================================
        // SUMMARY
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('🎉 TEST COMPLETE!');
        console.log('='.repeat(70));
        
        console.log(`
📝 SUMMARY:
   1. DAO was drained to ${formatUsdt(targetDaoBalance)} (insolvent for 1000 USDT policy)
   2. Policy was created successfully (policy creation doesn't require solvency)
   3. Auto-allocation to DeFi was ${!lpPos.isSome ? '✅ BLOCKED' : '❌ NOT BLOCKED'}
   4. DAO funds were restored to ${formatUsdt(daoAfterRestore)}
   5. Manual allocation ${lpPosAfter.isSome ? '✅ SUCCEEDED' : '❌ FAILED'}

💡 KEY INSIGHT:
   The strict solvency check PREVENTS allocation when DAO cannot cover
   potential 100% loss. This protects LPs and policy holders from
   bearing losses that should be the DAO's responsibility.
   
   Policy creation still works - only the DeFi allocation is blocked
   until DAO has sufficient funds.
`);
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        
        // Cleanup on error
        try {
            const daveBalance = await getUsdtBalance(api, keyring.addFromUri('//Dave').address);
            if (daveBalance > 1000000n) {
                await api.tx.assets.transfer(USDT_ASSET_ID, alice.address, (daveBalance - 1000000n).toString())
                    .signAndSend(keyring.addFromUri('//Dave'));
            }
        } catch (e) {}
        
        throw error;
    } finally {
        await api.disconnect();
    }
}

main().catch(console.error);
