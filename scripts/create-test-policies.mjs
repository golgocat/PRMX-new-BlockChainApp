#!/usr/bin/env node
/**
 * Create test V1 and V2 policies for UI testing
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

const WS_ENDPOINT = 'ws://127.0.0.1:9944';
const MANILA_MARKET_ID = 0;
const MANILA_LAT = 14_599_500;
const MANILA_LON = 120_984_200;
const STRIKE_VALUE = 500;
const FALLBACK_PROBABILITY_PPM = 50_000;

async function sendTx(api, tx, signer, label) {
  return new Promise((resolve, reject) => {
    console.log(`   ⏳ ${label}...`);
    tx.signAndSend(signer, { nonce: -1 }, ({ status, dispatchError, events }) => {
      if (status.isInBlock || status.isFinalized) {
        if (dispatchError) {
          let msg = 'Error';
          if (dispatchError.isModule) {
            try {
              const decoded = api.registry.findMetaError(dispatchError.asModule);
              msg = `${decoded.section}.${decoded.name}`;
            } catch (e) {
              msg = dispatchError.toString();
            }
          }
          console.log(`   ❌ ${label} failed: ${msg}`);
          reject(new Error(msg));
        } else {
          console.log(`   ✅ ${label} succeeded`);
          resolve(events);
        }
      }
    }).catch(reject);
  });
}

async function getChainTime(api) {
  const timestamp = await api.query.timestamp.now();
  return Math.floor(timestamp.toNumber() / 1000);
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  Create Test V1/V2 Policies for UI Testing                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const api = await ApiPromise.create({ provider: new WsProvider(WS_ENDPOINT) });
  console.log('✅ Connected to PRMX node\n');

  const keyring = new Keyring({ type: 'sr25519' });
  const alice = keyring.addFromUri('//Alice');
  const bob = keyring.addFromUri('//Bob');
  
  const chainNow = await getChainTime(api);
  console.log(`📦 Chain time: ${new Date(chainNow * 1000).toISOString()}\n`);

  // Setup oracle
  console.log('━━━ Setting up oracle ━━━');
  try {
    await sendTx(api, api.tx.sudo.sudo(api.tx.prmxOracle.addOracleProvider(alice.address)), alice, 'Add oracle provider');
  } catch (e) { /* May already exist */ }
  
  try {
    await sendTx(api, api.tx.sudo.sudo(api.tx.prmxOracle.addV2Reporter(alice.address)), alice, 'Add V2 reporter');
  } catch (e) { /* May already exist */ }

  // Submit rainfall data
  console.log('\n━━━ Submitting rainfall data ━━━');
  const safeTimestamp = chainNow - 3600;
  try {
    await sendTx(api, api.tx.prmxOracle.submitRainfall(MANILA_MARKET_ID, safeTimestamp, 100), alice, 'Submit rainfall 10mm');
  } catch (e) { console.log('   (rainfall may already exist)'); }

  // Create V1 Policy
  console.log('\n━━━ Creating V1 Policy ━━━');
  const v1Start = chainNow + 60;
  const v1End = v1Start + 300; // 5 min coverage
  
  // Request quote
  let quoteId;
  const quoteTx = api.tx.prmxQuote.requestPolicyQuote(MANILA_MARKET_ID, v1Start, v1End, MANILA_LAT, MANILA_LON, 2);
  const quoteEvents = await sendTx(api, quoteTx, bob, 'Request V1 quote');
  
  for (const { event } of quoteEvents) {
    if (event.section === 'prmxQuote' && event.method === 'QuoteRequested') {
      // Handle both H128 (hex) and number formats
      const idData = event.data[0];
      quoteId = idData.toHex ? idData.toHex() : idData.toString();
      console.log(`   Quote ID: ${quoteId}`);
    }
  }
  
  if (!quoteId) {
    console.log('   ❌ Could not get quote ID from events');
    await api.disconnect();
    return;
  }

  // Submit quote (fallback probability)
  await sendTx(api, api.tx.prmxQuote.submitQuote(quoteId, FALLBACK_PROBABILITY_PPM), alice, 'Submit quote fallback');

  // Apply for coverage
  const policyEvents = await sendTx(api, api.tx.prmxPolicy.applyCoverageWithQuote(quoteId), bob, 'Apply for V1 coverage');
  
  let v1PolicyId;
  for (const { event } of policyEvents) {
    if (event.section === 'prmxPolicy' && event.method === 'PolicyCreated') {
      const idData = event.data[0];
      v1PolicyId = idData.toHex ? idData.toHex() : idData.toString();
      console.log(`   🎉 V1 Policy created: ${v1PolicyId}`);
    }
  }

  // Create V2 Policy
  console.log('\n━━━ Creating V2 Policy ━━━');
  const v2Start = chainNow - 86400; // Started 1 day ago
  const v2End = chainNow + 86400; // Ends in 1 day
  const durationDays = 2;
  
  const v2QuoteTx = api.tx.prmxQuote.requestPolicyQuoteV2(MANILA_MARKET_ID, v2Start, v2End, MANILA_LAT, MANILA_LON, 3, durationDays, STRIKE_VALUE);
  const v2QuoteEvents = await sendTx(api, v2QuoteTx, bob, 'Request V2 quote');
  
  let v2QuoteId;
  for (const { event } of v2QuoteEvents) {
    if (event.section === 'prmxQuote' && event.method === 'QuoteRequested') {
      const idData = event.data[0];
      v2QuoteId = idData.toHex ? idData.toHex() : idData.toString();
      console.log(`   Quote ID: ${v2QuoteId}`);
    }
  }
  
  if (!v2QuoteId) {
    console.log('   ❌ Could not get V2 quote ID');
    await api.disconnect();
    return;
  }

  await sendTx(api, api.tx.prmxQuote.submitQuote(v2QuoteId, FALLBACK_PROBABILITY_PPM), alice, 'Submit V2 quote fallback');

  const v2PolicyEvents = await sendTx(api, api.tx.prmxPolicy.applyCoverageWithQuote(v2QuoteId), bob, 'Apply for V2 coverage');
  
  for (const { event } of v2PolicyEvents) {
    if (event.section === 'prmxPolicy' && (event.method === 'PolicyCreated' || event.method === 'V2PolicyCreated')) {
      const idData = event.data[0];
      const v2PolicyId = idData.toHex ? idData.toHex() : idData.toString();
      console.log(`   🎉 V2 Policy created: ${v2PolicyId}`);
    }
  }

  // List all policies
  console.log('\n━━━ Verifying created policies ━━━');
  const policies = await api.query.prmxPolicy.policies.entries();
  console.log(`   Total policies: ${policies.length}`);
  for (const [key, value] of policies) {
    const id = key.args[0].toHex ? key.args[0].toHex() : key.args[0].toString();
    const data = value.toJSON();
    console.log(`   - ${id.slice(0, 20)}... | Version: ${data.policyVersion || 'V1'} | Status: ${JSON.stringify(data.status)}`);
  }

  console.log('\n✅ Done! Refresh the UI to see the new policies.');
  await api.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});

