#!/usr/bin/env node
/**
 * E2E functional flow (dev mode, sudo):
 * - Create a new market (Singapore) post-genesis
 * - Request/submit quote, apply coverage (creates policy + DAO LP ask)
 * - Two LPs buy LP tokens before manual event
 * - Allocate funds to DeFi (mock)
 * - Manually settle policy (event occurred = true)
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

const WS_URL = 'ws://127.0.0.1:9944';
const USDT_ASSET_ID = 1;
const USDT_DECIMALS = 6;
const PAYOUT_PER_SHARE = 100_000_000n; // 100 USDT (6 decimals)

// Market data (Singapore)
const MARKET_NAME = 'Singapore';
const LAT = Math.round(1.3521 * 1_000_000);   // i32 scaled by 1e6
const LON = Math.round(103.8198 * 1_000_000); // i32 scaled by 1e6
const TZ_OFFSET = 8; // UTC+8

// Coverage window parameters
const MIN_DURATION = 3_600;   // 1h
const MAX_DURATION = 86_400;  // 24h
const MIN_LEAD = 1_800;       // 30m

// Policy/quote parameters
const SHARES = 100n;          // number of shares (1 share = 100 USDT payout)
const PROBABILITY_PPM = 50_000; // 5%

// LP buy parameters
const LP_BUY_QTY_EACH = 50n;                    // Bob and Charlie each buy 50 shares
const LP_MAX_PRICE = 200_000_000n;              // 200 USDT per share cap (very lenient)

// DeFi allocation
const DEFI_ALLOC = 1_000_000_000n; // 1,000 USDT

async function main() {
  console.log('='.repeat(70));
  console.log('PRMX E2E: Singapore market → LP buys → DeFi alloc → settlement');
  console.log('='.repeat(70));

  const api = await ApiPromise.create({ provider: new WsProvider(WS_URL) });
  const chain = await api.rpc.system.chain();
  console.log(`Connected to chain: ${chain.toString()}`);

  const keyring = new Keyring({ type: 'sr25519' });
  const alice = keyring.addFromUri('//Alice');     // sudo / DAO
  const bob = keyring.addFromUri('//Bob');         // customer (buys policy)
  const charlie = keyring.addFromUri('//Charlie'); // LP buyer 1
  const dave = keyring.addFromUri('//Dave');       // LP buyer 2

  // 1) Create market (sudo)
  const nextMarketId = (await api.query.prmxMarkets.nextMarketId()).toNumber();
  console.log(`Next market id: ${nextMarketId}`);
  await signAndWait(
    api.tx.sudo.sudo(
      api.tx.prmxMarkets.daoCreateMarket(
        MARKET_NAME,
        LAT,
        LON,
        TZ_OFFSET,
        50 * 10, // strike value (frontend scales by 10); here 50 -> 500
        USDT_ASSET_ID,
        PAYOUT_PER_SHARE,
        { daoMarginBp: 500 }, // 5%
        { minDurationSecs: MIN_DURATION, maxDurationSecs: MAX_DURATION, minLeadTimeSecs: MIN_LEAD },
      )
    ),
    alice,
    'createMarket'
  );

  // 2) Request quote (customer)
  const nowSec = Math.floor(Date.now() / 1000);
  const coverageStart = nowSec + MIN_LEAD + 300;          // start ~5m after lead
  const coverageEnd = coverageStart + MIN_DURATION + 900; // ~1h15m duration
  const expectedQuoteId = (await api.query.prmxQuote.nextQuoteId()).toNumber();
  await signAndWait(
    api.tx.prmxQuote.requestPolicyQuote(
      nextMarketId,
      coverageStart,
      coverageEnd,
      LAT,
      LON,
      SHARES,
    ),
    bob,
    'requestQuote (Bob = customer)'
  );
  console.log(`Quote requested: id=${expectedQuoteId}`);

  // 3) Submit quote (simulate pricing oracle) only if still Pending
  const status = await api.query.prmxQuote.quoteStatuses(expectedQuoteId);
  if (status.toString() === 'Pending') {
    await signAndWait(api.tx.prmxQuote.submitQuote(expectedQuoteId, PROBABILITY_PPM), alice, 'submitQuote');
  } else {
    console.log(`Quote status is ${status.toString()}, skipping submitQuote`);
  }

  // 4) Apply coverage -> creates policy + DAO LP ask
  const applyEvents = await signAndWait(api.tx.prmxPolicy.applyCoverageWithQuote(expectedQuoteId), bob, 'applyCoverage (Bob = customer)');
  const policyId = extractPolicyId(applyEvents);
  console.log(`Policy created: id=${policyId}`);

  // 5) LPs buy LP tokens (taking DAO ask)
  await signAndWait(api.tx.prmxOrderbookLp.buyLp(policyId, LP_MAX_PRICE, LP_BUY_QTY_EACH), charlie, 'charlieBuyLp (LP1)');
  await signAndWait(api.tx.prmxOrderbookLp.buyLp(policyId, LP_MAX_PRICE, LP_BUY_QTY_EACH), dave, 'daveBuyLp (LP2)');

  // 6) Allocate funds to DeFi (mock) via sudo
  await signAndWait(api.tx.sudo.sudo(api.tx.prmxXcmCapital.daoAllocateToDefi(policyId, DEFI_ALLOC)), alice, 'allocateDeFi');

  // 7) Manual settlement (immediate, bypass coverage window) via sudo
  await signAndWait(api.tx.sudo.sudo(api.tx.prmxPolicy.triggerImmediateSettlement(policyId)), alice, 'settlePolicyImmediate');

  // 8) Assertions / final state
  const policy = await api.query.prmxPolicy.policies(policyId);
  console.log(`Policy status: ${policy.isSome ? policy.unwrap().status.toString() : 'not found'}`);

  await api.disconnect();
  console.log('✅ Test complete');
}

async function signAndWait(tx, signer, label) {
  return new Promise((resolve, reject) => {
    tx.signAndSend(signer, { nonce: -1 }, ({ status, events, dispatchError }) => {
      if (dispatchError) {
        if (dispatchError.isModule) {
          const decoded = tx.registry.findMetaError(dispatchError.asModule);
          reject(new Error(`${label}: ${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`));
        } else {
          reject(new Error(`${label}: ${dispatchError.toString()}`));
        }
        return;
      }
      if (status.isInBlock) {
        console.log(`📦 ${label} included at ${status.asInBlock.toString().slice(0, 18)}...`);
      }
      if (status.isFinalized) {
        console.log(`✅ ${label} finalized at ${status.asFinalized.toString().slice(0, 18)}...`);
        resolve(events);
      }
    });
  });
}

function extractPolicyId(events) {
  for (const { event } of events) {
    if (event.section === 'prmxPolicy' && event.method === 'PolicyCreated') {
      const [policyId] = event.data;
      return Number(policyId.toString());
    }
  }
  throw new Error('PolicyCreated event not found');
}

main().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

