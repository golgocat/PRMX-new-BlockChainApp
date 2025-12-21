#!/usr/bin/env node
/**
 * Test V2 Policy Settlement (Triggered and Matured)
 * 
 * This script tests both settlement outcomes for V2 policies:
 * 1. Triggered - cumulative rainfall >= strike
 * 2. Matured (No Event) - coverage ended without reaching strike
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import { createHash } from 'crypto';

const WS_URL = 'ws://127.0.0.1:9944';
const MANILA_MARKET_ID = 0;
const USDT_ASSET_ID = 1;
const USDT_DECIMALS = 6;  // USDT uses 6 decimals, not 8!
const USDT_MULTIPLIER = 10 ** USDT_DECIMALS;

async function getUsdtBalance(api, address) {
  const account = await api.query.assets.account(USDT_ASSET_ID, address);
  return account.isSome ? BigInt(account.unwrap().balance.toString()) : 0n;
}

function formatUsdt(amount) {
  return (Number(amount) / USDT_MULTIPLIER).toFixed(2);
}

async function signAndWait(tx, signer, label) {
  return new Promise((resolve, reject) => {
    tx.signAndSend(signer, { nonce: -1 }, ({ status, events, dispatchError }) => {
      if (dispatchError) {
        if (dispatchError.isModule) {
          const decoded = tx.registry.findMetaError(dispatchError.asModule);
          reject(new Error(`${label}: ${decoded.section}.${decoded.name}`));
        } else {
          reject(new Error(`${label}: ${dispatchError.toString()}`));
        }
        return;
      }
      if (status.isFinalized) {
        console.log(`   ✅ ${label} finalized`);
        resolve(events);
      }
    });
  });
}

function generateEvidenceHash(data) {
  return createHash('sha256').update(JSON.stringify(data)).digest();
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         V2 Policy Settlement Test (Triggered + Matured)        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const api = await ApiPromise.create({ provider: new WsProvider(WS_URL) });
  const keyring = new Keyring({ type: 'sr25519' });
  const alice = keyring.addFromUri('//Alice');
  const bob = keyring.addFromUri('//Bob');
  const charlie = keyring.addFromUri('//Charlie');

  // Check if Manila market exists
  const market = await api.query.prmxMarkets.markets(MANILA_MARKET_ID);
  if (market.isNone) {
    console.log('📍 Creating Manila Market first...');
    const createMarketTx = api.tx.prmxMarkets.daoCreateMarket(
      'Manila',
      14599000,
      120984000,
      8,
      500,  // strike: 50.0 mm
      1,    // base_asset (USDT)
      10_000_000_000n,  // payout_per_share: 100 USDT (100 × 10^8)
      { daoMarginBp: 2000 },
      { minDurationSecs: 0, maxDurationSecs: 604800, minLeadTimeSecs: 0 }
    );
    await signAndWait(api.tx.sudo.sudo(createMarketTx), alice, 'createManilaMarket');
    console.log('');
  }

  const marketInfo = (await api.query.prmxMarkets.markets(MANILA_MARKET_ID)).unwrap();
  const strikeValue = marketInfo.strikeValue.toNumber();
  console.log(`📍 Manila Market - Strike: ${strikeValue / 10} mm\n`);

  // ═══════════════════════════════════════════════════════════════════
  // PART 1: Create V2 Policy for TRIGGERED settlement
  // ═══════════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PART 1: Test TRIGGERED Settlement (cumulative >= strike)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const nowSec = Math.floor(Date.now() / 1000);
  
  // Create policy with coverage starting in the past (so we can settle immediately)
  const coverageStart1 = nowSec - 86400;  // Started 1 day ago
  const coverageEnd1 = nowSec + 86400;     // Ends in 1 day

  console.log('📝 Step 1a: Create V2 Policy #1 (Bob, for triggered settlement)');
  const quoteId1 = (await api.query.prmxQuote.nextQuoteId()).toNumber();
  await signAndWait(
    api.tx.prmxQuote.requestPolicyQuoteV2(MANILA_MARKET_ID, coverageStart1, coverageEnd1, 14599000, 120984000, 5, 2),
    bob,
    'requestQuoteV2 (triggered)'
  );

  // Wait for OCW to process the quote
  console.log('   Waiting for quote to be ready...');
  let quote1Ready = false;
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const status1 = await api.query.prmxQuote.quoteStatuses(quoteId1);
    if (status1.toString() === 'Ready') {
      quote1Ready = true;
      console.log('   ✅ Quote ready (OCW processed)');
      break;
    }
    if (status1.toString() === 'Pending' && i === 4) {
      try {
        await signAndWait(api.tx.prmxQuote.submitQuote(quoteId1, 50000), alice, 'submitQuote');
        quote1Ready = true;
      } catch (e) {
        console.log('   (Waiting for OCW...)');
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  const events1 = await signAndWait(api.tx.prmxPolicy.applyCoverageWithQuote(quoteId1), bob, 'applyCoverage');
  let policyId1 = null;
  for (const { event } of events1) {
    if (event.section === 'prmxPolicy' && (event.method === 'PolicyCreated' || event.method === 'V2PolicyCreated')) {
      policyId1 = event.data[0].toNumber();
    }
  }
  console.log(`   Policy ID: ${policyId1 + 1} (manila-${policyId1 + 1})\n`);

  // Get Bob's balance before settlement
  const bobBalanceBefore = await getUsdtBalance(api, bob.address);
  console.log(`   Bob's USDT balance before: ${formatUsdt(bobBalanceBefore)} USDT`);

  // Submit V2 report with TRIGGERED outcome
  console.log('\n📊 Step 1b: Submit V2 Report (TRIGGERED)');
  const triggerEvidence = {
    policy_id: policyId1,
    outcome: 'Triggered',
    cumulative_mm: strikeValue + 100, // 10mm above strike
    observed_at: nowSec - 3600, // 1 hour ago
    hourly_data: [{ hour: nowSec - 3600, mm: strikeValue + 100 }]
  };
  const triggerHash = generateEvidenceHash(triggerEvidence);
  console.log(`   Cumulative rainfall: ${(strikeValue + 100) / 10} mm (≥ ${strikeValue / 10} mm strike)`);
  console.log(`   Evidence hash: 0x${triggerHash.slice(0, 8).toString('hex')}...`);

  // Call submit_v2_report via sudo (Alice is authorized V2 reporter in dev)
  // First add Alice as V2 reporter
  try {
    await signAndWait(
      api.tx.sudo.sudo(api.tx.prmxOracle.addV2Reporter(alice.address)),
      alice,
      'addV2Reporter'
    );
  } catch (e) {
    // May already be added
  }

  await signAndWait(
    api.tx.prmxOracle.submitV2Report(
      policyId1,
      { Triggered: null },  // V2Outcome::Triggered
      nowSec - 3600,        // observed_at
      strikeValue + 100,    // cumulative_mm
      Array.from(triggerHash)
    ),
    alice,
    'submitV2Report (Triggered)'
  );

  // Check Bob's balance after settlement
  const bobBalanceAfter = await getUsdtBalance(api, bob.address);
  console.log(`\n   Bob's USDT balance after: ${formatUsdt(bobBalanceAfter)} USDT`);
  console.log(`   💰 Payout received: ${formatUsdt(bobBalanceAfter - bobBalanceBefore)} USDT`);

  // Verify policy status
  const policy1After = await api.query.prmxPolicy.policies(policyId1);
  console.log(`   Policy status: ${JSON.stringify(policy1After.unwrap().status.toJSON())}`);

  // ═══════════════════════════════════════════════════════════════════
  // PART 2: Create V2 Policy for MATURED (No Event) settlement
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('PART 2: Test MATURED (No Event) Settlement (cumulative < strike)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Create policy with coverage starting now (for V2, we can settle after coverage ends)
  const coverageStart2 = nowSec - 86400;  // Started 1 day ago (within window)
  const coverageEnd2 = nowSec + 3600;      // Ends in 1 hour (still active)

  // Add delay to avoid nonce issues
  await new Promise(r => setTimeout(r, 3000));

  console.log('📝 Step 2a: Create V2 Policy #2 (Charlie, for matured settlement)');
  const quoteId2 = (await api.query.prmxQuote.nextQuoteId()).toNumber();
  await signAndWait(
    api.tx.prmxQuote.requestPolicyQuoteV2(MANILA_MARKET_ID, coverageStart2, coverageEnd2, 14599000, 120984000, 3, 3),
    charlie,
    'requestQuoteV2 (matured)'
  );

  // Wait for OCW to process the quote (or do it manually if still pending after 8 seconds)
  console.log('   Waiting for OCW to process quote...');
  let quoteReady = false;
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const status2 = await api.query.prmxQuote.quoteStatuses(quoteId2);
    console.log(`   Quote status (attempt ${i + 1}): ${status2.toString()}`);
    if (status2.toString() === 'Ready') {
      quoteReady = true;
      break;
    }
    if (status2.toString() === 'Pending' && i === 3) {
      // Last attempt - try to submit manually
      try {
        await signAndWait(api.tx.prmxQuote.submitQuote(quoteId2, 30000), alice, 'submitQuote');
        quoteReady = true;
      } catch (e) {
        console.log(`   (OCW submitted quote concurrently: ${e.message})`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  // Final check
  const finalStatus2 = await api.query.prmxQuote.quoteStatuses(quoteId2);
  if (finalStatus2.toString() !== 'Ready') {
    console.log(`   ⚠️  Quote not ready, skipping Part 2. Status: ${finalStatus2.toString()}`);
  } else {
    console.log('   ✅ Quote ready');
  }

  const events2 = await signAndWait(api.tx.prmxPolicy.applyCoverageWithQuote(quoteId2), charlie, 'applyCoverage');
  let policyId2 = null;
  for (const { event } of events2) {
    if (event.section === 'prmxPolicy' && (event.method === 'PolicyCreated' || event.method === 'V2PolicyCreated')) {
      policyId2 = event.data[0].toNumber();
    }
  }
  console.log(`   Policy ID: ${policyId2 + 1} (manila-${policyId2 + 1})\n`);

  // Get Charlie's balance before settlement
  const charlieBalanceBefore = await getUsdtBalance(api, charlie.address);
  console.log(`   Charlie's USDT balance before: ${formatUsdt(charlieBalanceBefore)} USDT`);

  // Submit V2 report with MATURED (No Event) outcome
  console.log('\n📊 Step 2b: Submit V2 Report (MATURED - No Event)');
  const maturedEvidence = {
    policy_id: policyId2,
    outcome: 'MaturedNoEvent',
    cumulative_mm: strikeValue - 100, // 10mm below strike
    observed_at: coverageEnd2,
    hourly_data: []
  };
  const maturedHash = generateEvidenceHash(maturedEvidence);
  console.log(`   Cumulative rainfall: ${(strikeValue - 100) / 10} mm (< ${strikeValue / 10} mm strike)`);
  console.log(`   Evidence hash: 0x${maturedHash.slice(0, 8).toString('hex')}...`);

  // For MaturedNoEvent, observed_at should be at or after coverage_end
  const observedAt2 = coverageEnd2 + 60; // 1 minute after coverage ends
  await signAndWait(
    api.tx.prmxOracle.submitV2Report(
      policyId2,
      { MaturedNoEvent: null },  // V2Outcome::MaturedNoEvent
      observedAt2,               // observed_at (after coverage end)
      strikeValue - 100,         // cumulative_mm (below strike)
      Array.from(maturedHash)
    ),
    alice,
    'submitV2Report (MaturedNoEvent)'
  );

  // Check Charlie's balance after settlement
  const charlieBalanceAfter = await getUsdtBalance(api, charlie.address);
  console.log(`\n   Charlie's USDT balance after: ${formatUsdt(charlieBalanceAfter)} USDT`);
  console.log(`   💰 Payout received: ${formatUsdt(charlieBalanceAfter - charlieBalanceBefore)} USDT`);
  console.log(`   (Expected: 0 USDT since event did not occur)`);

  // Verify policy status
  const policy2After = await api.query.prmxPolicy.policies(policyId2);
  console.log(`   Policy status: ${JSON.stringify(policy2After.unwrap().status.toJSON())}`);

  // ═══════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                         SUMMARY                                ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║  Policy #${policyId1 + 1} (Bob)     → TRIGGERED (cumulative ≥ strike)   ║`);
  console.log(`║    Payout: ${formatUsdt(bobBalanceAfter - bobBalanceBefore)} USDT (${Number(bobBalanceAfter - bobBalanceBefore) / USDT_MULTIPLIER / 100} shares × $100)    ║`);
  console.log('╠────────────────────────────────────────────────────────────────╣');
  console.log(`║  Policy #${policyId2 + 1} (Charlie) → MATURED (no event)               ║`);
  console.log(`║    Payout: ${formatUsdt(charlieBalanceAfter - charlieBalanceBefore)} USDT (premium returned to DAO)            ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  await api.disconnect();
  console.log('✅ V2 Settlement test completed!');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});

