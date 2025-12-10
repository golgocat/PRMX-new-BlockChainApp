#!/usr/bin/env node
/**
 * PRMX Event Occurs with DAO Insolvency Test
 * 
 * This test demonstrates the worst-case scenario:
 * - DeFi loses money (50% loss)
 * - An insured event occurs (policy holder should be paid)
 * - DAO is insolvent and can't cover the DeFi loss
 * - Policy holder receives partial payout
 * 
 * Flow:
 * 1. Create a policy (Bob is policy holder)
 * 2. System auto-allocates 100% to DeFi
 * 3. Drain DAO to simulate insolvency
 * 4. Set mock yield to -50% (large loss)
 * 5. Wait for coverage window to end
 * 6. Settle policy WITH event_occurred = true
 * 7. Verify policy holder receives partial payout
 * 
 * Usage: node test-event-with-dao-insolvency.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

// Configuration
const WS_ENDPOINT = 'ws://127.0.0.1:9944';
const USDT_ASSET_ID = 1;
const MARKET_ID = 0;

// Test parameters
const SHARES = 10;                     // 10 shares = 1000 USDT max payout
const DEFI_LOSS_PPM = -500_000;        // -50% loss

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
    console.log('🚀 Event Occurs with DAO Insolvency Test');
    console.log('='.repeat(70));
    console.log('\n📖 Testing: Policy holder receives partial payout when DAO is insolvent\n');
    console.log('⚠️  SCENARIO: Rain event occurs, but DeFi lost money and DAO is broke\n');
    
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
        // PHASE 2: Create Policy (Auto-allocates 100% to DeFi)
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 PHASE 2: Create Policy (Auto-allocates to DeFi)');
        console.log('='.repeat(70));
        
        const now = Math.floor(Date.now() / 1000);
        const coverageStart = now + 15;  // Start in 15 seconds
        const coverageEnd = coverageStart + 60; // Last 60 seconds
        
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
        
        // Submit quote (5% probability)
        await submitAndWait(api,
            api.tx.prmxQuote.submitQuote(quoteId, 50000),
            alice, 'Submit quote'
        );
        
        // Apply coverage (this auto-allocates to DeFi)
        await submitAndWait(api,
            api.tx.prmxPolicy.applyCoverageWithQuote(quoteId),
            bob, 'Apply coverage (triggers auto-allocation)'
        );
        
        const policyId = (await api.query.prmxPolicy.nextPolicyId()).toNumber() - 1;
        console.log(`\n   ✅ Policy created: ID ${policyId}`);
        
        const policy = (await api.query.prmxPolicy.policies(policyId)).unwrap();
        const premium = BigInt(policy.premiumPaid.toString());
        const maxPayout = BigInt(policy.maxPayout.toString());
        const daoCapital = maxPayout - premium;
        
        console.log(`   Max payout: ${formatUsdt(maxPayout)}`);
        console.log(`   Premium paid by Bob: ${formatUsdt(premium)}`);
        console.log(`   DAO capital: ${formatUsdt(daoCapital)}`);
        
        // Check DeFi position (should be auto-allocated)
        const position = await api.query.prmxXcmCapital.policyLpPositions(policyId);
        let principal = 0n;
        if (position.isSome) {
            const pos = position.unwrap();
            principal = BigInt(pos.principalUsdt.toString());
            console.log(`\n   📈 Auto-allocated to DeFi:`);
            console.log(`      Principal: ${formatUsdt(principal)}`);
            console.log(`      Shares: ${pos.lpShares.toString()}`);
        }
        
        // =====================================================================
        // PHASE 3: Drain DAO to Simulate Insolvency
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 PHASE 3: Simulate DAO Insolvency');
        console.log('='.repeat(70));
        
        const daoBalanceNow = await getUsdtBalance(api, alice.address);
        console.log(`\n   Current DAO balance: ${formatUsdt(daoBalanceNow)}`);
        
        // Leave only 100 USDT in DAO (not enough to cover 50% loss of 1000 = 500 USDT)
        const targetDaoBalance = 100_000_000n; // 100 USDT
        const drainAmount = daoBalanceNow - targetDaoBalance;
        
        if (drainAmount > 0n) {
            console.log(`   Draining ${formatUsdt(drainAmount)} from DAO...`);
            
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
        
        // =====================================================================
        // PHASE 4: Set Large DeFi Loss
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 PHASE 4: Set 50% DeFi Loss');
        console.log('='.repeat(70));
        
        await submitAndWait(api,
            api.tx.sudo.sudo(api.tx.prmxXcmCapital.setMockYieldRate(DEFI_LOSS_PPM)),
            alice, 'Set mock yield rate to -50%'
        );
        
        const expectedLoss = principal * 50n / 100n;
        const realisedFromDefi = principal - expectedLoss;
        
        console.log(`\n   Principal invested: ${formatUsdt(principal)}`);
        console.log(`   Expected 50% loss: ${formatUsdt(expectedLoss)}`);
        console.log(`   DeFi will return: ${formatUsdt(realisedFromDefi)}`);
        console.log(`   DAO can cover (of ${formatUsdt(expectedLoss)} shortfall): ${formatUsdt(daoAfterDrain)}`);
        
        // =====================================================================
        // PHASE 5: Wait for Coverage to End
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 PHASE 5: Wait for Coverage to End');
        console.log('='.repeat(70));
        
        const timeToWait = coverageEnd - Math.floor(Date.now() / 1000) + 5;
        if (timeToWait > 0) {
            console.log(`\n   Waiting ${timeToWait} seconds for coverage to end...`);
            await new Promise(r => setTimeout(r, timeToWait * 1000));
        }
        console.log('   ✅ Coverage window ended');
        
        // Record pre-settlement balances
        const daoPreSettle = await getUsdtBalance(api, alice.address);
        const bobPreSettle = await getUsdtBalance(api, bob.address);
        
        console.log('\n   Pre-Settlement Balances:');
        console.log(`   DAO:  ${formatUsdt(daoPreSettle)}`);
        console.log(`   Bob:  ${formatUsdt(bobPreSettle)}`);
        
        // =====================================================================
        // PHASE 6: Settle Policy WITH EVENT OCCURRED
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 PHASE 6: Settle Policy (⚡ EVENT OCCURRED!)');
        console.log('='.repeat(70));
        
        console.log('\n   🌧️  Simulating: Heavy rainfall exceeded threshold!');
        console.log('   📢  Policy holder Bob should receive payout...\n');
        
        await submitAndWait(api,
            api.tx.prmxPolicy.settlePolicy(policyId, true), // event_occurred = true
            bob, 'Settle policy (event occurred)'
        );
        
        // =====================================================================
        // PHASE 7: Post-Settlement Analysis
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 PHASE 7: Post-Settlement Analysis');
        console.log('='.repeat(70));
        
        const daoPostSettle = await getUsdtBalance(api, alice.address);
        const bobPostSettle = await getUsdtBalance(api, bob.address);
        
        const daoChange = daoPostSettle - daoPreSettle;
        const bobChange = bobPostSettle - bobPreSettle;
        
        console.log('\n   Balance Changes:');
        console.log(`   DAO: ${formatUsdt(daoPreSettle)} → ${formatUsdt(daoPostSettle)} (${daoChange >= 0n ? '+' : ''}${formatUsdt(daoChange)})`);
        console.log(`   Bob: ${formatUsdt(bobPreSettle)} → ${formatUsdt(bobPostSettle)} (${bobChange >= 0n ? '+' : ''}${formatUsdt(bobChange)})`);
        
        // Settlement result
        const settlement = (await api.query.prmxPolicy.settlementResults(policyId)).unwrap();
        console.log('\n   Settlement Result:');
        console.log(`   Event occurred: ${settlement.eventOccurred.toString()}`);
        console.log(`   To policy holder: ${formatUsdt(settlement.payoutToHolder.toString())}`);
        console.log(`   To LPs: ${formatUsdt(settlement.returnedToLps.toString())}`);
        
        // =====================================================================
        // DETAILED FUND FLOW
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 DETAILED FUND FLOW (Event + DAO Insolvency)');
        console.log('='.repeat(70));
        
        // Calculate expected values
        const poolAfterDefi = maxPayout - principal; // Pool remaining after DeFi allocation (0 if 100%)
        const shortfall = maxPayout - (poolAfterDefi + realisedFromDefi);
        const daoCoverage = daoPreSettle < shortfall ? daoPreSettle : shortfall;
        const actualPoolBalance = poolAfterDefi + realisedFromDefi + daoCoverage;
        const lossToHolder = maxPayout - actualPoolBalance;
        
        console.log(`
┌────────────────────────────────────────────────────────────────────┐
│ POLICY SETUP                                                       │
├────────────────────────────────────────────────────────────────────┤
│ 1. Max payout:                 ${formatUsdt(maxPayout).padStart(15)}                    │
│ 2. Premium paid by Bob:        ${formatUsdt(premium).padStart(15)}                    │
│ 3. DAO capital:                ${formatUsdt(daoCapital).padStart(15)}                    │
│ 4. Auto-allocated to DeFi:   ${formatUsdt(principal).padStart(15)} (100%)            │
├────────────────────────────────────────────────────────────────────┤
│ DAO INSOLVENCY SETUP                                               │
├────────────────────────────────────────────────────────────────────┤
│ 5. DAO balance drained to:     ${formatUsdt(daoAfterDrain).padStart(15)}                    │
├────────────────────────────────────────────────────────────────────┤
│ SETTLEMENT (EVENT OCCURRED + DeFi loss)                            │
├────────────────────────────────────────────────────────────────────┤
│ 6. DeFi exit (with -50% loss):                                   │
│    - Principal was:            ${formatUsdt(principal).padStart(15)}                    │
│    - 50% loss =                ${formatUsdt(expectedLoss).padStart(15)}                    │
│    - Realised (DAO has):       ${formatUsdt(daoPreSettle < realisedFromDefi ? daoPreSettle : realisedFromDefi).padStart(15)}                    │
│                                                                    │
│ 7. Pool balance after unwind:                                      │
│    - Pool remaining:           ${formatUsdt(poolAfterDefi).padStart(15)}                    │
│    - + From DeFi exit:       ${formatUsdt(daoPreSettle < realisedFromDefi ? daoPreSettle : realisedFromDefi).padStart(15)}                    │
│    - Required for payout:      ${formatUsdt(maxPayout).padStart(15)}                    │
│    - Shortfall:                ${formatUsdt(maxPayout - (poolAfterDefi + (daoPreSettle < realisedFromDefi ? daoPreSettle : realisedFromDefi))).padStart(15)}                    │
│                                                                    │
│ 8. DAO INSOLVENCY:                                                 │
│    - DAO balance:              ${formatUsdt(daoPreSettle).padStart(15)}                    │
│    - DAO covered what it could                                     │
│                                                                    │
│ 9. POLICY HOLDER PAYOUT:                                           │
│    - Expected payout:          ${formatUsdt(maxPayout).padStart(15)}                    │
│    - Actual payout:            ${formatUsdt(bobChange).padStart(15)}                    │
│    - Loss to policy holder:    ${formatUsdt(maxPayout - BigInt(bobChange)).padStart(15)}                    │
└────────────────────────────────────────────────────────────────────┘
`);
        
        // =====================================================================
        // INVARIANT VERIFICATION
        // =====================================================================
        console.log('='.repeat(70));
        console.log('✅ INVARIANT VERIFICATION');
        console.log('='.repeat(70));
        
        // Bob should receive less than max_payout
        console.log(`\n   1. Policy holder received partial payout:`);
        console.log(`      Expected (if DAO solvent): ${formatUsdt(maxPayout)}`);
        console.log(`      Actual received:           ${formatUsdt(bobChange)}`);
        console.log(`      Loss absorbed by Bob:      ${formatUsdt(maxPayout - BigInt(bobChange))}`);
        
        const payoutReduced = bobChange < maxPayout;
        console.log(`      ${payoutReduced ? '✓ PASS: Partial payout due to insolvency' : '✗ UNEXPECTED: Full payout despite insolvency'}`);
        
        // Event was recorded
        console.log(`\n   2. Event was correctly recorded:`);
        console.log(`      Event occurred: ${settlement.eventOccurred.toHuman()}`);
        console.log(`      ${settlement.eventOccurred.isTrue ? '✓ PASS: Event recorded' : '✗ FAIL: Event not recorded'}`);
        
        // DAO was drained
        console.log(`\n   3. DAO covered what it could:`);
        console.log(`      DAO balance before: ${formatUsdt(daoPreSettle)}`);
        console.log(`      DAO balance after:  ${formatUsdt(daoPostSettle)}`);
        console.log(`      DAO contributed:    ${formatUsdt(-daoChange)}`);
        
        // Settlement completed
        console.log(`\n   4. Settlement completed despite insolvency:`);
        console.log(`      ✓ PASS: No transaction failure`);
        
        // =====================================================================
        // CLEANUP
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 CLEANUP');
        console.log('='.repeat(70));
        
        // Restore DAO funds from Dave
        const daveBalance = await getUsdtBalance(api, dave.address);
        if (daveBalance > 1000000n) {
            await submitAndWait(api,
                api.tx.assets.transfer(USDT_ASSET_ID, alice.address, (daveBalance - 1000000n).toString()),
                dave, 'Return funds to DAO'
            );
        }
        
        await submitAndWait(api,
            api.tx.sudo.sudo(api.tx.prmxXcmCapital.setMockYieldRate(0)),
            alice, 'Reset mock yield rate to 0'
        );
        
        console.log('\n' + '='.repeat(70));
        console.log('🎉 TEST COMPLETE!');
        console.log('='.repeat(70));
        
        console.log(`
📝 SUMMARY:
   - Policy max payout:        ${formatUsdt(maxPayout)}
   - Premium paid by Bob:      ${formatUsdt(premium)}
   - DeFi invested:          ${formatUsdt(principal)} (100% auto-allocated)
   - DeFi loss (50%):          ${formatUsdt(expectedLoss)}
   - DAO could cover:          ${formatUsdt(daoPreSettle)}
   - Bob expected:             ${formatUsdt(maxPayout)}
   - Bob received:             ${formatUsdt(bobChange)}
   - Bob's loss:               ${formatUsdt(maxPayout - BigInt(bobChange))}

💡 KEY INSIGHT:
   Even when a covered event occurs (rain threshold exceeded), the policy
   holder may receive a partial payout if:
   1. DeFi strategy lost money, AND
   2. DAO is insolvent and can't cover the loss
   
   In this worst-case scenario:
   - Bob paid ${formatUsdt(premium)} premium
   - Bob expected ${formatUsdt(maxPayout)} payout when event occurred
   - Bob only received ${formatUsdt(bobChange)} due to DAO insolvency
   - Net result for Bob: ${bobChange > premium ? '✅ Still profitable (' + formatUsdt(bobChange - premium) + ' net gain)' : '❌ Net loss (' + formatUsdt(premium - bobChange) + ')'}
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
            await api.tx.sudo.sudo(api.tx.prmxXcmCapital.setMockYieldRate(0))
                .signAndSend(alice);
        } catch (e) {}
        
        throw error;
    } finally {
        await api.disconnect();
    }
}

main().catch(console.error);
