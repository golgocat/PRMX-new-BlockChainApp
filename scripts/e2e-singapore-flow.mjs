#!/usr/bin/env node
/**
 * E2E functional flow with detailed balance tracking (dev mode, sudo):
 * - Create a new market (Singapore) post-genesis
 * - Request/submit quote, apply coverage (creates policy + DAO LP ask)
 * - Two LPs buy LP tokens before manual event
 * - Allocate funds to DeFi (mock)
 * - Manually settle policy (event occurred = true)
 * 
 * Shows USDT and LP token balance changes for all participants at each step.
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
const LP_BUY_QTY_EACH = 50n;                    // Charlie and Dave each buy 50 shares
const LP_MAX_PRICE = 200_000_000n;              // 200 USDT per share cap (very lenient)

// DeFi allocation
const DEFI_ALLOC = 1_000_000_000n; // 1,000 USDT

// ============================================================================
// Balance Tracking Helpers
// ============================================================================

function formatUsdt(balance) {
  if (balance === 0n) return '0.00 USDT';
  const sign = balance < 0n ? '-' : '';
  const abs = balance < 0n ? -balance : balance;
  const whole = abs / 1_000_000n;
  const frac = abs % 1_000_000n;
  return `${sign}${whole}.${frac.toString().padStart(6, '0').slice(0, 2)} USDT`;
}

async function getUsdtBalance(api, address) {
  const account = await api.query.assets.account(USDT_ASSET_ID, address);
  return account.isSome ? BigInt(account.unwrap().balance.toString()) : 0n;
}

async function getLpHoldings(api, policyId, address) {
  const holdings = await api.query.prmxHoldings.holdingsStorage(policyId, address);
  return {
    lpShares: BigInt(holdings.lpShares.toString()),
    lockedShares: BigInt(holdings.lockedShares.toString()),
  };
}

async function getPoolBalance(api, policyId) {
  const balance = await api.query.prmxPolicy.policyRiskPoolBalance(policyId);
  return BigInt(balance.toString());
}

async function getBalanceSnapshot(api, accounts, policyId) {
  const snapshot = {};
  for (const [name, address] of Object.entries(accounts)) {
    const usdt = await getUsdtBalance(api, address);
    let lp = { lpShares: 0n, lockedShares: 0n };
    if (policyId !== null) {
      lp = await getLpHoldings(api, policyId, address);
    }
    snapshot[name] = { usdt, ...lp };
  }
  if (policyId !== null) {
    snapshot._poolBalance = await getPoolBalance(api, policyId);
  }
  return snapshot;
}

function printBalanceSnapshot(snapshot, title) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`📊 ${title}`);
  console.log('─'.repeat(70));
  for (const [name, bal] of Object.entries(snapshot)) {
    if (name.startsWith('_')) continue;
    const lpInfo = bal.lpShares > 0n || bal.lockedShares > 0n
      ? ` | LP: ${bal.lpShares} (free) + ${bal.lockedShares} (locked)`
      : '';
    console.log(`   ${name.padEnd(12)} USDT: ${formatUsdt(bal.usdt).padStart(15)}${lpInfo}`);
  }
  if (snapshot._poolBalance !== undefined) {
    console.log(`   ${'Pool'.padEnd(12)} USDT: ${formatUsdt(snapshot._poolBalance).padStart(15)}`);
  }
}

function printBalanceChanges(before, after, title) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📈 ${title} - BALANCE CHANGES`);
  console.log('═'.repeat(70));
  
  let hasChanges = false;
  for (const [name, afterBal] of Object.entries(after)) {
    if (name.startsWith('_')) continue;
    const beforeBal = before[name] || { usdt: 0n, lpShares: 0n, lockedShares: 0n };
    
    const usdtDelta = afterBal.usdt - beforeBal.usdt;
    const lpDelta = afterBal.lpShares - beforeBal.lpShares;
    const lockedDelta = afterBal.lockedShares - beforeBal.lockedShares;
    
    if (usdtDelta !== 0n || lpDelta !== 0n || lockedDelta !== 0n) {
      hasChanges = true;
      console.log(`   ${name}:`);
      if (usdtDelta !== 0n) {
        const sign = usdtDelta > 0n ? '+' : '';
        console.log(`      USDT: ${sign}${formatUsdt(usdtDelta)} (${formatUsdt(beforeBal.usdt)} → ${formatUsdt(afterBal.usdt)})`);
      }
      if (lpDelta !== 0n) {
        const sign = lpDelta > 0n ? '+' : '';
        console.log(`      LP (free): ${sign}${lpDelta} (${beforeBal.lpShares} → ${afterBal.lpShares})`);
      }
      if (lockedDelta !== 0n) {
        const sign = lockedDelta > 0n ? '+' : '';
        console.log(`      LP (locked): ${sign}${lockedDelta} (${beforeBal.lockedShares} → ${afterBal.lockedShares})`);
      }
    }
  }
  
  // Pool balance change
  if (before._poolBalance !== undefined && after._poolBalance !== undefined) {
    const poolDelta = after._poolBalance - before._poolBalance;
    if (poolDelta !== 0n) {
      hasChanges = true;
      const sign = poolDelta > 0n ? '+' : '';
      console.log(`   Pool:`);
      console.log(`      USDT: ${sign}${formatUsdt(poolDelta)} (${formatUsdt(before._poolBalance)} → ${formatUsdt(after._poolBalance)})`);
    }
  }
  
  if (!hasChanges) {
    console.log('   (no changes)');
  }
}

// ============================================================================
// Main Test Flow
// ============================================================================

async function main() {
  console.log('╔' + '═'.repeat(68) + '╗');
  console.log('║  PRMX E2E: Singapore Market Flow with Balance Tracking            ║');
  console.log('╚' + '═'.repeat(68) + '╝');

  const api = await ApiPromise.create({ provider: new WsProvider(WS_URL) });
  const chain = await api.rpc.system.chain();
  console.log(`\n✅ Connected to: ${chain.toString()}`);

  const keyring = new Keyring({ type: 'sr25519' });
  const alice = keyring.addFromUri('//Alice');     // sudo / DAO
  const bob = keyring.addFromUri('//Bob');         // customer (buys policy)
  const charlie = keyring.addFromUri('//Charlie'); // LP buyer 1
  const dave = keyring.addFromUri('//Dave');       // LP buyer 2

  // Account addresses for balance tracking
  const accounts = {
    'Alice (DAO)': alice.address,
    'Bob (Customer)': bob.address,
    'Charlie (LP1)': charlie.address,
    'Dave (LP2)': dave.address,
  };

  let policyId = null;
  let poolAccount = null;

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 0: Initial Balances
  // ══════════════════════════════════════════════════════════════════════════
  let snap0 = await getBalanceSnapshot(api, accounts, null);
  printBalanceSnapshot(snap0, 'INITIAL BALANCES (before any transactions)');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1: Create Market (Singapore)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n\n🏗️  STEP 1: Create Market (Singapore)');
  console.log('─'.repeat(70));
  
  const nextMarketId = (await api.query.prmxMarkets.nextMarketId()).toNumber();
  console.log(`   Next market id: ${nextMarketId}`);
  
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
  
  let snap1 = await getBalanceSnapshot(api, accounts, null);
  printBalanceChanges(snap0, snap1, 'STEP 1: Create Market');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 2: Request Quote (Bob = Customer)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n\n📝 STEP 2: Request Quote (Bob = Customer)');
  console.log('─'.repeat(70));
  
  const nowSec = Math.floor(Date.now() / 1000);
  const coverageStart = nowSec + MIN_LEAD + 300;
  const coverageEnd = coverageStart + MIN_DURATION + 900;
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
    'requestQuote'
  );
  console.log(`   Quote requested: id=${expectedQuoteId}, shares=${SHARES}`);

  // Submit quote if pending
  const status = await api.query.prmxQuote.quoteStatuses(expectedQuoteId);
  if (status.toString() === 'Pending') {
    await signAndWait(api.tx.prmxQuote.submitQuote(expectedQuoteId, PROBABILITY_PPM), alice, 'submitQuote');
  } else {
    console.log(`   Quote status is ${status.toString()}, skipping submitQuote`);
  }

  let snap2 = await getBalanceSnapshot(api, accounts, null);
  printBalanceChanges(snap1, snap2, 'STEP 2: Request Quote');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3: Apply Coverage (Bob = Customer) → Creates Policy + DAO LP Ask
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n\n🛡️  STEP 3: Apply Coverage (Bob = Customer)');
  console.log('─'.repeat(70));
  
  const applyEvents = await signAndWait(
    api.tx.prmxPolicy.applyCoverageWithQuote(expectedQuoteId),
    bob,
    'applyCoverage'
  );
  policyId = extractPolicyId(applyEvents);
  console.log(`   Policy created: id=${policyId}`);
  console.log(`   Shares: ${SHARES}, Max payout: ${formatUsdt(BigInt(SHARES) * PAYOUT_PER_SHARE)}`);

  // Add pool account to tracking
  const PALLET_ID = 'py/prmxp'; // from pallet code
  poolAccount = await api.query.prmxPolicy.policyRiskPoolBalance(policyId);
  
  let snap3 = await getBalanceSnapshot(api, accounts, policyId);
  printBalanceChanges(snap2, snap3, 'STEP 3: Apply Coverage');
  printBalanceSnapshot(snap3, 'After Apply Coverage (Policy + LP minted to DAO)');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 4: Charlie Buys LP (LP Buyer 1)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n\n💰 STEP 4: Charlie Buys LP Tokens (LP Buyer 1)');
  console.log('─'.repeat(70));
  console.log(`   Buying ${LP_BUY_QTY_EACH} LP shares at max price ${formatUsdt(LP_MAX_PRICE)}`);
  
  await signAndWait(
    api.tx.prmxOrderbookLp.buyLp(policyId, LP_MAX_PRICE, LP_BUY_QTY_EACH),
    charlie,
    'charlieBuyLp'
  );

  let snap4 = await getBalanceSnapshot(api, accounts, policyId);
  printBalanceChanges(snap3, snap4, 'STEP 4: Charlie Buys LP');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 5: Dave Buys LP (LP Buyer 2)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n\n💰 STEP 5: Dave Buys LP Tokens (LP Buyer 2)');
  console.log('─'.repeat(70));
  console.log(`   Buying ${LP_BUY_QTY_EACH} LP shares at max price ${formatUsdt(LP_MAX_PRICE)}`);
  
  await signAndWait(
    api.tx.prmxOrderbookLp.buyLp(policyId, LP_MAX_PRICE, LP_BUY_QTY_EACH),
    dave,
    'daveBuyLp'
  );

  let snap5 = await getBalanceSnapshot(api, accounts, policyId);
  printBalanceChanges(snap4, snap5, 'STEP 5: Dave Buys LP');
  printBalanceSnapshot(snap5, 'After LP Buys (Before DeFi Allocation)');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 6: Allocate Funds to DeFi (Mock)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n\n🏦 STEP 6: Allocate Funds to DeFi (Mock XCM Strategy)');
  console.log('─'.repeat(70));
  console.log(`   Allocating ${formatUsdt(DEFI_ALLOC)} to DeFi pool`);
  
  await signAndWait(
    api.tx.sudo.sudo(api.tx.prmxXcmCapital.daoAllocateToDefi(policyId, DEFI_ALLOC)),
    alice,
    'allocateDeFi'
  );

  let snap6 = await getBalanceSnapshot(api, accounts, policyId);
  printBalanceChanges(snap5, snap6, 'STEP 6: DeFi Allocation');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 7: Manual Settlement (Event Occurred = TRUE → Payout to Customer)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n\n⚡ STEP 7: Manual Settlement (Event Occurred = TRUE)');
  console.log('─'.repeat(70));
  console.log('   Triggering immediate settlement (simulating rainfall event)');
  
  await signAndWait(
    api.tx.sudo.sudo(api.tx.prmxPolicy.triggerImmediateSettlement(policyId)),
    alice,
    'settlePolicyImmediate'
  );

  let snap7 = await getBalanceSnapshot(api, accounts, policyId);
  printBalanceChanges(snap6, snap7, 'STEP 7: Settlement (Event Occurred)');

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n\n');
  console.log('╔' + '═'.repeat(68) + '╗');
  console.log('║                        FINAL SUMMARY                              ║');
  console.log('╚' + '═'.repeat(68) + '╝');
  
  printBalanceSnapshot(snap7, 'FINAL BALANCES');
  printBalanceChanges(snap0, snap7, 'TOTAL CHANGES (Initial → Final)');

  // Verify policy status
  const policy = await api.query.prmxPolicy.policies(policyId);
  console.log(`\n   Policy ${policyId} status: ${policy.isSome ? policy.unwrap().status.toString() : 'not found'}`);

  await api.disconnect();
  console.log('\n✅ Test complete\n');
}

// ============================================================================
// Utility Functions
// ============================================================================

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
        console.log(`   📦 ${label} included at ${status.asInBlock.toString().slice(0, 18)}...`);
      }
      if (status.isFinalized) {
        console.log(`   ✅ ${label} finalized`);
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
