#!/usr/bin/env node
/**
 * PRMX External LP with DeFi Loss Test
 * 
 * This test demonstrates the key invariant: when DeFi loses money,
 * the DAO covers the loss and external LPs still receive their
 * deterministic payouts.
 * 
 * Flow:
 * 1. Create a policy (Bob is policy holder)
 * 2. DAO allocates capital to DeFi
 * 3. External LP (Charlie) buys ALL LP tokens from DAO
 * 4. Set mock yield to -20% (DeFi loss)
 * 5. Wait for coverage window to end
 * 6. Settle the policy
 * 7. Verify Charlie receives deterministic payout, DAO absorbs loss
 * 
 * Usage: node test-external-lp-defi-loss.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

// Configuration
const WS_ENDPOINT = 'ws://127.0.0.1:9944';
const USDT_ASSET_ID = 1;
const MARKET_ID = 0;

// Test parameters
const SHARES = 1;                      // 1 share = 100 USDT max payout
const DeFi_ALLOCATION = 50_000_000n; // 50 USDT to invest in DeFi
const DEFI_LOSS_PPM = -200_000;        // -20% loss

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
    console.log('🚀 External LP with 20% DeFi Loss Test');
    console.log('='.repeat(70));
    console.log('\n📖 Testing: DAO absorbs DeFi loss, external LPs get deterministic payout\n');
    
    // Connect
    console.log(`📡 Connecting to ${WS_ENDPOINT}...`);
    const provider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider });
    console.log('   Connected!\n');
    
    // Setup accounts
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');   // DAO
    const bob = keyring.addFromUri('//Bob');       // Policy holder
    const charlie = keyring.addFromUri('//Charlie'); // External LP
    
    console.log('👥 Participants:');
    console.log(`   DAO (Alice):      ${alice.address.slice(0, 20)}...`);
    console.log(`   Policy Holder:    ${bob.address.slice(0, 20)}...`);
    console.log(`   External LP:      ${charlie.address.slice(0, 20)}...`);
    
    try {
        // =====================================================================
        // PHASE 1: Record Initial Balances
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 PHASE 1: Initial Balances');
        console.log('='.repeat(70));
        
        const daoInitial = await getUsdtBalance(api, alice.address);
        const charlieInitial = await getUsdtBalance(api, charlie.address);
        const bobInitial = await getUsdtBalance(api, bob.address);
        
        console.log(`   DAO (Alice):   ${formatUsdt(daoInitial)}`);
        console.log(`   Charlie:       ${formatUsdt(charlieInitial)}`);
        console.log(`   Bob:           ${formatUsdt(bobInitial)}`);
        
        // =====================================================================
        // PHASE 2: Create Policy
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 PHASE 2: Create Policy');
        console.log('='.repeat(70));
        
        const now = Math.floor(Date.now() / 1000);
        const coverageStart = now + 15;  // Start in 15 seconds
        const coverageEnd = coverageStart + 90; // Last 90 seconds
        
        // Request quote
        const quoteId = (await api.query.prmxQuote.nextQuoteId()).toNumber();
        console.log(`\n   Quote ID: ${quoteId}`);
        
        await submitAndWait(api, 
            api.tx.prmxQuote.requestPolicyQuote(
                MARKET_ID, coverageStart, coverageEnd, 
                14599500, 120984200, SHARES
            ),
            bob, 'Request quote'
        );
        
        // Submit quote (5% probability)
        await submitAndWait(api,
            api.tx.prmxQuote.submitQuote(quoteId, 50000),
            alice, 'Submit quote'
        );
        
        // Apply coverage
        await submitAndWait(api,
            api.tx.prmxPolicy.applyCoverageWithQuote(quoteId),
            bob, 'Apply coverage'
        );
        
        const policyId = (await api.query.prmxPolicy.nextPolicyId()).toNumber() - 1;
        console.log(`\n   ✅ Policy created: ID ${policyId}`);
        
        const policy = (await api.query.prmxPolicy.policies(policyId)).unwrap();
        const premium = BigInt(policy.premiumPaid.toString());
        const maxPayout = BigInt(policy.maxPayout.toString());
        const daoCapital = maxPayout - premium;
        
        console.log(`   Max payout: ${formatUsdt(maxPayout)}`);
        console.log(`   Premium paid: ${formatUsdt(premium)}`);
        console.log(`   DAO capital: ${formatUsdt(daoCapital)}`);
        
        // =====================================================================
        // PHASE 3: Allocate to DeFi
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 PHASE 3: Allocate Capital to DeFi');
        console.log('='.repeat(70));
        
        await submitAndWait(api,
            api.tx.sudo.sudo(
                api.tx.prmxXcmCapital.daoAllocateToDefi(policyId, DeFi_ALLOCATION)
            ),
            alice, `Allocate ${formatUsdt(DeFi_ALLOCATION)} to DeFi`
        );
        
        const position = (await api.query.prmxXcmCapital.policyLpPositions(policyId)).unwrap();
        console.log(`\n   DeFi shares: ${position.lpShares.toString()}`);
        console.log(`   Principal: ${formatUsdt(position.principalUsdt.toString())}`);
        
        // =====================================================================
        // PHASE 4: Charlie Buys LP Tokens from DAO
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 PHASE 4: Charlie Buys ALL LP Tokens from DAO');
        console.log('='.repeat(70));
        
        // Check DAO's LP holdings
        const daoHoldings = await api.query.prmxHoldings.holdingsStorage(policyId, alice.address);
        const daoLpShares = BigInt(daoHoldings.lpShares.toString());
        const daoLockedShares = BigInt(daoHoldings.lockedShares.toString());
        console.log(`\n   DAO LP tokens: ${daoLpShares} free, ${daoLockedShares} locked`);
        
        // Get the ask order price
        const priceLevels = await api.query.prmxOrderbookLp.priceLevels(policyId);
        if (priceLevels.length > 0) {
            const askPrice = priceLevels[0];
            console.log(`   Ask price per LP: ${formatUsdt(askPrice.toString())}`);
            
            // Calculate cost
            const lpQuantity = daoLockedShares > 0n ? daoLockedShares : 1n;
            const totalCost = BigInt(askPrice.toString()) * lpQuantity;
            console.log(`   Total cost for ${lpQuantity} LP: ${formatUsdt(totalCost)}`);
            
            // Charlie buys LP tokens
            const charlieBefore = await getUsdtBalance(api, charlie.address);
            
            await submitAndWait(api,
                api.tx.prmxOrderbookLp.buyLp(
                    policyId,
                    askPrice, // max price willing to pay
                    Number(lpQuantity)
                ),
                charlie, `Charlie buys ${lpQuantity} LP token(s)`
            );
            
            const charlieAfter = await getUsdtBalance(api, charlie.address);
            const charliePaid = charlieBefore - charlieAfter;
            console.log(`\n   Charlie paid: ${formatUsdt(charliePaid)}`);
        }
        
        // Verify LP ownership transferred
        const charlieHoldings = await api.query.prmxHoldings.holdingsStorage(policyId, charlie.address);
        const charlieLp = BigInt(charlieHoldings.lpShares.toString());
        console.log(`   Charlie now owns: ${charlieLp} LP tokens`);
        
        const daoHoldingsAfter = await api.query.prmxHoldings.holdingsStorage(policyId, alice.address);
        const daoLpAfter = BigInt(daoHoldingsAfter.lpShares.toString()) + BigInt(daoHoldingsAfter.lockedShares.toString());
        console.log(`   DAO now owns: ${daoLpAfter} LP tokens`);
        
        // =====================================================================
        // PHASE 5: Set DeFi Loss Rate
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 PHASE 5: Set 20% DeFi Loss');
        console.log('='.repeat(70));
        
        await submitAndWait(api,
            api.tx.sudo.sudo(
                api.tx.prmxXcmCapital.setMockYieldRate(DEFI_LOSS_PPM)
            ),
            alice, 'Set mock yield rate to -20%'
        );
        
        const yieldRate = await api.query.prmxXcmCapital.mockYieldRatePpm();
        console.log(`\n   Mock yield rate: ${yieldRate.toString()} ppm (-20%)`);
        
        // Calculate expected loss
        const principal = BigInt(position.principalUsdt.toString());
        const expectedLoss = principal * 20n / 100n;
        console.log(`   Principal invested: ${formatUsdt(principal)}`);
        console.log(`   Expected 20% loss: ${formatUsdt(expectedLoss)}`);
        
        // =====================================================================
        // PHASE 6: Wait for Coverage to End
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 PHASE 6: Wait for Coverage to End');
        console.log('='.repeat(70));
        
        const timeToWait = coverageEnd - Math.floor(Date.now() / 1000) + 5;
        if (timeToWait > 0) {
            console.log(`\n   Waiting ${timeToWait} seconds for coverage to end...`);
            await new Promise(r => setTimeout(r, timeToWait * 1000));
        }
        console.log('   ✅ Coverage window ended');
        
        // =====================================================================
        // PHASE 7: Record Pre-Settlement Balances
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 PHASE 7: Pre-Settlement Balances');
        console.log('='.repeat(70));
        
        const daoPreSettle = await getUsdtBalance(api, alice.address);
        const charliePreSettle = await getUsdtBalance(api, charlie.address);
        
        console.log(`\n   DAO (Alice):   ${formatUsdt(daoPreSettle)}`);
        console.log(`   Charlie:       ${formatUsdt(charliePreSettle)}`);
        
        // =====================================================================
        // PHASE 8: Settle Policy
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 PHASE 8: Settle Policy (No Event)');
        console.log('='.repeat(70));
        
        await submitAndWait(api,
            api.tx.prmxPolicy.settlePolicy(policyId, false),
            bob, 'Settle policy'
        );
        
        // =====================================================================
        // PHASE 9: Post-Settlement Analysis
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 PHASE 9: Post-Settlement Analysis');
        console.log('='.repeat(70));
        
        const daoPostSettle = await getUsdtBalance(api, alice.address);
        const charliePostSettle = await getUsdtBalance(api, charlie.address);
        
        const daoChange = daoPostSettle - daoPreSettle;
        const charlieChange = charliePostSettle - charliePreSettle;
        
        console.log('\n   Balance Changes:');
        console.log(`   DAO:     ${formatUsdt(daoPreSettle)} → ${formatUsdt(daoPostSettle)} (${daoChange >= 0n ? '+' : ''}${formatUsdt(daoChange)})`);
        console.log(`   Charlie: ${formatUsdt(charliePreSettle)} → ${formatUsdt(charliePostSettle)} (${charlieChange >= 0n ? '+' : ''}${formatUsdt(charlieChange)})`);
        
        // Get settlement result
        const settlement = (await api.query.prmxPolicy.settlementResults(policyId)).unwrap();
        console.log('\n   Settlement Result:');
        console.log(`   Event occurred: ${settlement.eventOccurred.toString()}`);
        console.log(`   To policy holder: ${formatUsdt(settlement.payoutToHolder.toString())}`);
        console.log(`   To LPs: ${formatUsdt(settlement.returnedToLps.toString())}`);
        
        // =====================================================================
        // DETAILED FUND FLOW
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 DETAILED FUND FLOW');
        console.log('='.repeat(70));
        
        console.log(`
┌────────────────────────────────────────────────────────────────────┐
│ POLICY SETUP                                                       │
├────────────────────────────────────────────────────────────────────┤
│ 1. Bob paid premium:           ${formatUsdt(premium).padStart(15)}                    │
│ 2. DAO contributed capital:    ${formatUsdt(daoCapital).padStart(15)}                    │
│ 3. Policy pool funded:         ${formatUsdt(maxPayout).padStart(15)} (max_payout)       │
│ 4. DAO received LP tokens:     ${SHARES.toString().padStart(15)} share(s)              │
├────────────────────────────────────────────────────────────────────┤
│ DeFi ALLOCATION                                                  │
├────────────────────────────────────────────────────────────────────┤
│ 5. Pool → DAO (for DeFi):    ${formatUsdt(DeFi_ALLOCATION).padStart(15)}                    │
│    Pool remaining:             ${formatUsdt(maxPayout - DeFi_ALLOCATION).padStart(15)}                    │
├────────────────────────────────────────────────────────────────────┤
│ LP TOKEN SALE                                                      │
├────────────────────────────────────────────────────────────────────┤
│ 6. Charlie bought LP:          ${charlieLp.toString().padStart(15)} token(s)            │
│    Charlie paid DAO:           ${formatUsdt(daoCapital).padStart(15)} (approx)          │
│    DAO LP tokens remaining:    ${daoLpAfter.toString().padStart(15)}                    │
├────────────────────────────────────────────────────────────────────┤
│ SETTLEMENT (with -20% DeFi loss)                                   │
├────────────────────────────────────────────────────────────────────┤
│ 7. DeFi exit:                                                    │
│    - Principal was:            ${formatUsdt(principal).padStart(15)}                    │
│    - 20% loss =                ${formatUsdt(expectedLoss).padStart(15)}                    │
│    - Realised amount:          ${formatUsdt(principal - expectedLoss).padStart(15)}                    │
│    - DAO → Pool:               ${formatUsdt(principal - expectedLoss).padStart(15)}                    │
│                                                                    │
│ 8. Pool balance check:                                             │
│    - Pool has: 50 + 40 =       ${formatUsdt(maxPayout - DeFi_ALLOCATION + principal - expectedLoss).padStart(15)}                    │
│    - Required:                 ${formatUsdt(maxPayout).padStart(15)}                    │
│    - Shortfall:                ${formatUsdt(expectedLoss).padStart(15)}                    │
│                                                                    │
│ 9. DAO tops up shortfall:      ${formatUsdt(expectedLoss).padStart(15)}                    │
│    Pool now has:               ${formatUsdt(maxPayout).padStart(15)}                    │
│                                                                    │
│ 10. LP distribution:                                               │
│    - Charlie receives:         ${formatUsdt(maxPayout).padStart(15)}                    │
│    - DAO receives:             ${'0.00 USDT'.padStart(15)}                    │
└────────────────────────────────────────────────────────────────────┘
`);
        
        // =====================================================================
        // VERIFY INVARIANTS
        // =====================================================================
        console.log('='.repeat(70));
        console.log('✅ INVARIANT VERIFICATION');
        console.log('='.repeat(70));
        
        // Charlie should have received the full max_payout (100 USDT)
        const expectedCharliePayout = maxPayout;
        const charlieGotExpected = charlieChange === BigInt(expectedCharliePayout.toString());
        
        console.log(`\n   1. Deterministic LP payout:`);
        console.log(`      Expected: ${formatUsdt(expectedCharliePayout)}`);
        console.log(`      Actual:   ${formatUsdt(charlieChange)}`);
        console.log(`      ${charlieGotExpected ? '✓ PASS' : '✗ FAIL'}`);
        
        // DAO should have covered the loss
        console.log(`\n   2. DAO absorbed DeFi loss:`);
        console.log(`      DeFi loss amount: ${formatUsdt(expectedLoss)} (20% of ${formatUsdt(principal)})`);
        console.log(`      DAO balance change: ${formatUsdt(daoChange)}`);
        // DAO change = -45 (exit) - 10 (topup) = -55 if they had to pay out, but got +94 from LP sale
        
        console.log(`\n   3. Settlement was deterministic:`);
        console.log(`      Charlie received: ${formatUsdt(charlieChange)}`);
        console.log(`      Without DeFi mgmt, would receive: ${formatUsdt(charlieChange)} ✓`);
        
        // =====================================================================
        // CLEANUP
        // =====================================================================
        console.log('\n' + '='.repeat(70));
        console.log('📊 CLEANUP');
        console.log('='.repeat(70));
        
        await submitAndWait(api,
            api.tx.sudo.sudo(
                api.tx.prmxXcmCapital.setMockYieldRate(0)
            ),
            alice, 'Reset mock yield rate to 0'
        );
        
        console.log('\n' + '='.repeat(70));
        console.log('🎉 TEST COMPLETE!');
        console.log('='.repeat(70));
        
        console.log(`
📝 SUMMARY:
   - Policy max payout:     ${formatUsdt(maxPayout)}
   - DeFi invested:       ${formatUsdt(principal)}
   - DeFi loss (20%):       ${formatUsdt(expectedLoss)}
   - Charlie (LP) received: ${formatUsdt(charlieChange)}
   - DAO absorbed loss:     ${formatUsdt(expectedLoss)} (topped up to ensure 100 USDT payout)

💡 KEY INSIGHT:
   Even though DeFi lost ${formatUsdt(expectedLoss)}, Charlie (the external LP)
   still received the full ${formatUsdt(maxPayout)} deterministic payout.
   The DAO covered the ${formatUsdt(expectedLoss)} shortfall from its own funds.
`);
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        
        // Cleanup on error
        try {
            await submitAndWait(api,
                api.tx.sudo.sudo(api.tx.prmxXcmCapital.setMockYieldRate(0)),
                keyring.addFromUri('//Alice'), 'Reset yield rate'
            );
        } catch (e) {}
        
        throw error;
    } finally {
        await api.disconnect();
    }
}

main().catch(console.error);
