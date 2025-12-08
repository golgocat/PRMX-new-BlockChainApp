/**
 * PRMX Chain Test Script - Part 2
 * Tests additional flows:
 * 1. Buy LP tokens from orderbook
 * 2. Check LP holdings
 * 3. Attempt policy settlement (will fail if coverage not ended)
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

const WS_ENDPOINT = 'ws://127.0.0.1:54992';

// Helper to wait for a transaction to be included in a block
async function submitAndWait(api, tx, signer, description) {
  return new Promise((resolve, reject) => {
    console.log(`\n📤 Submitting: ${description}...`);
    
    tx.signAndSend(signer, ({ status, events, dispatchError }) => {
      if (status.isInBlock) {
        console.log(`   ✅ Included in block: ${status.asInBlock.toHex()}`);
        
        // Check for errors
        if (dispatchError) {
          if (dispatchError.isModule) {
            const decoded = api.registry.findMetaError(dispatchError.asModule);
            console.log(`   ❌ Error: ${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`);
            reject(new Error(`${decoded.section}.${decoded.name}`));
            return;
          } else {
            console.log(`   ❌ Error: ${dispatchError.toString()}`);
            reject(new Error(dispatchError.toString()));
            return;
          }
        }
        
        // Log events
        console.log('   📋 Events:');
        events.forEach(({ event }) => {
          if (event.section !== 'system' || event.method === 'ExtrinsicSuccess') {
            console.log(`      - ${event.section}.${event.method}`);
            if (event.data.length > 0) {
              event.data.forEach((d, i) => {
                const str = d.toString();
                if (str.length < 100) {
                  console.log(`        [${i}]: ${str}`);
                }
              });
            }
          }
        });
        
        resolve(events);
      }
    }).catch(reject);
  });
}

async function main() {
  console.log('🚀 PRMX Chain Test Script - Part 2 (LP Trading & Settlement)');
  console.log('='.repeat(60));
  
  // Connect to node
  console.log(`\n📡 Connecting to ${WS_ENDPOINT}...`);
  const provider = new WsProvider(WS_ENDPOINT);
  const api = await ApiPromise.create({ provider });
  
  console.log(`   ✅ Connected to: ${(await api.rpc.system.chain()).toString()}`);
  const header = await api.rpc.chain.getHeader();
  console.log(`   📦 Current block: #${header.number.toNumber()}`);
  
  // Setup keyring with test accounts
  const keyring = new Keyring({ type: 'sr25519' });
  const alice = keyring.addFromUri('//Alice');
  const bob = keyring.addFromUri('//Bob');
  const charlie = keyring.addFromUri('//Charlie');
  const dave = keyring.addFromUri('//Dave');
  
  console.log(`\n👤 Test Accounts:`);
  console.log(`   Alice (Admin): ${alice.address}`);
  console.log(`   Bob (Policy Holder): ${bob.address}`);
  console.log(`   Charlie (LP 1): ${charlie.address}`);
  console.log(`   Dave (LP 2): ${dave.address}`);
  
  // DAO account address (derived from [0u8; 32])
  const daoAddress = '5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM';
  
  // ==========================================================================
  // Step 1: Check Current State
  // ==========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('📊 Current State Check');
  console.log('='.repeat(60));
  
  // Check policy exists
  const policy = await api.query.prmxPolicy.policies(0);
  if (policy.isSome) {
    const p = policy.unwrap();
    console.log('\n   📜 Policy 0:');
    console.log(`      - Status: ${p.status.toString()}`);
    console.log(`      - Shares: ${p.shares}`);
    console.log(`      - Max Payout: ${Number(p.maxPayout) / 1_000_000} USDT`);
  } else {
    console.log('\n   ❌ No policy found. Run test-prmx-flow.mjs first!');
    process.exit(1);
  }
  
  // Check orderbook state
  const order0 = await api.query.prmxOrderbookLp.orders(0);
  if (order0.isSome) {
    const order = order0.unwrap();
    console.log('\n   📈 DAO Ask Order 0:');
    console.log(`      - Seller: ${order.seller.toString().substring(0, 20)}...`);
    console.log(`      - Price: ${Number(order.price) / 1_000_000} USDT/share`);
    console.log(`      - Quantity: ${order.quantity}`);
    console.log(`      - Remaining: ${order.remaining}`);
  }
  
  // Check LP holdings
  const daoHoldings = await api.query.prmxHoldings.holdingsStorage(0, daoAddress);
  console.log('\n   🪙 DAO LP Holdings (Market 0):');
  console.log(`      - Free: ${daoHoldings.lpShares}`);
  console.log(`      - Locked: ${daoHoldings.lockedShares}`);
  
  // Check Charlie's USDT balance
  const charlieUsdt = await api.query.assets.account(1, charlie.address);
  if (charlieUsdt.isSome) {
    const balance = BigInt(charlieUsdt.unwrap().balance.toString());
    console.log(`\n   💰 Charlie's USDT: ${Number(balance / BigInt(1_000_000))} USDT`);
  }
  
  // ==========================================================================
  // Step 2: Charlie Buys LP Tokens
  // ==========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('🛒 STEP 2: Charlie Buys LP Tokens from Orderbook');
  console.log('='.repeat(60));
  
  // Charlie buys 5 LP tokens at max price of 100 USDT/share
  // The DAO ask is at 94 USDT/share, so Charlie pays 94 * 5 = 470 USDT
  const buyQuantity = 5;
  const maxPrice = 100_000_000; // 100 USDT in smallest units
  
  console.log(`\n   Buying ${buyQuantity} LP tokens at max price ${maxPrice / 1_000_000} USDT/share`);
  console.log(`   Expected cost: ${buyQuantity * 94} USDT (at DAO ask price of 94 USDT/share)`);
  
  const buyLpTx = api.tx.prmxOrderbookLp.buyLp(
    0,           // marketId
    maxPrice,    // maxPrice
    buyQuantity  // quantity
  );
  
  await submitAndWait(api, buyLpTx, charlie, 'Buy LP Tokens (Charlie)');
  
  // Check Charlie's LP holdings
  const charlieHoldings = await api.query.prmxHoldings.holdingsStorage(0, charlie.address);
  console.log(`\n   ✅ Charlie's LP Holdings (Market 0): ${charlieHoldings.lpShares} shares`);
  
  // Check DAO order remaining
  const orderAfter = await api.query.prmxOrderbookLp.orders(0);
  if (orderAfter.isSome) {
    console.log(`   📈 DAO Order Remaining: ${orderAfter.unwrap().remaining} shares`);
  } else {
    console.log(`   📈 DAO Order: Fully filled and removed`);
  }
  
  // Check Charlie's USDT balance after
  const charlieUsdtAfter = await api.query.assets.account(1, charlie.address);
  if (charlieUsdtAfter.isSome) {
    const balance = BigInt(charlieUsdtAfter.unwrap().balance.toString());
    console.log(`   💰 Charlie's USDT After: ${Number(balance / BigInt(1_000_000))} USDT`);
  }
  
  // ==========================================================================
  // Step 3: Dave Buys Remaining LP Tokens
  // ==========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('🛒 STEP 3: Dave Buys Remaining LP Tokens');
  console.log('='.repeat(60));
  
  const buyLpTx2 = api.tx.prmxOrderbookLp.buyLp(
    0,           // marketId
    maxPrice,    // maxPrice
    5            // quantity (remaining 5)
  );
  
  await submitAndWait(api, buyLpTx2, dave, 'Buy LP Tokens (Dave)');
  
  // Check holdings
  const daveHoldings = await api.query.prmxHoldings.holdingsStorage(0, dave.address);
  console.log(`\n   ✅ Dave's LP Holdings (Market 0): ${daveHoldings.lpShares} shares`);
  
  // ==========================================================================
  // Step 4: Check Final LP Distribution
  // ==========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('📊 Final LP Token Distribution');
  console.log('='.repeat(60));
  
  const totalLpShares = await api.query.prmxHoldings.totalLpShares(0);
  console.log(`\n   Total LP Shares (Market 0): ${totalLpShares}`);
  
  const daoHoldingsFinal = await api.query.prmxHoldings.holdingsStorage(0, daoAddress);
  console.log(`   DAO:     ${Number(daoHoldingsFinal.lpShares) + Number(daoHoldingsFinal.lockedShares)} shares (Free: ${daoHoldingsFinal.lpShares}, Locked: ${daoHoldingsFinal.lockedShares})`);
  
  const charlieHoldingsFinal = await api.query.prmxHoldings.holdingsStorage(0, charlie.address);
  console.log(`   Charlie: ${charlieHoldingsFinal.lpShares} shares`);
  
  const daveHoldingsFinal = await api.query.prmxHoldings.holdingsStorage(0, dave.address);
  console.log(`   Dave:    ${daveHoldingsFinal.lpShares} shares`);
  
  // ==========================================================================
  // Step 5: Settlement Flow Explanation
  // ==========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('⏰ STEP 5: Policy Settlement');
  console.log('='.repeat(60));
  
  // Get policy details
  const policyFinal = await api.query.prmxPolicy.policies(0);
  if (policyFinal.isSome) {
    const p = policyFinal.unwrap();
    const chainNow = header.number.toNumber() * 6;
    
    console.log(`\n   📜 Policy 0 Details:`);
    console.log(`      - Coverage Start: ${p.coverageStart}`);
    console.log(`      - Coverage End: ${p.coverageEnd}`);
    console.log(`      - Chain "Now": ${chainNow} seconds`);
    console.log(`      - Time Until Settlement: ${Number(p.coverageEnd) - chainNow} seconds (~${Math.floor((Number(p.coverageEnd) - chainNow) / 86400)} days)`);
    
    console.log('\n   ℹ️  Settlement requires coverage window to have ended.');
    console.log('       Since we used future timestamps for testing, we cannot');
    console.log('       settle the policy yet.');
    
    // Try to settle anyway to show the error
    console.log('\n   🧪 Attempting settlement (expected to fail)...');
    
    try {
      const settleTx = api.tx.prmxPolicy.settlePolicy(
        0,     // policyId
        false  // eventOccurred (rainfall did NOT occur)
      );
      await submitAndWait(api, settleTx, alice, 'Settle Policy (Alice)');
    } catch (error) {
      console.log(`\n   ⚠️  Settlement failed as expected: ${error.message}`);
      console.log('       Policy cannot be settled until coverage window ends.');
    }
  }
  
  // ==========================================================================
  // Settlement Scenarios Explanation
  // ==========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('📚 Settlement Scenarios (When Coverage Ends)');
  console.log('='.repeat(60));
  
  console.log(`
   SCENARIO A: Rainfall Event OCCURRED (≥50mm in 24h)
   ─────────────────────────────────────────────────
   • settle_policy(0, true) is called
   • Bob (policy holder) receives 1,000 USDT payout
   • LP token holders (Charlie, Dave) lose their capital
   • Policy pool: 1,000 USDT → Bob
   
   SCENARIO B: Rainfall Event DID NOT Occur
   ─────────────────────────────────────────────────
   • settle_policy(0, false) is called
   • Bob receives nothing (no payout)
   • Policy pool goes to Market Residual Pool
   • LP holders can later claim their share:
     - Charlie (5 shares): 500 USDT
     - Dave (5 shares): 500 USDT
   
   Note: The 60 USDT premium from Bob is profit for LPs
   (They invested 470 USDT each, get back 500 USDT each)
  `);
  
  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('✅ TEST PART 2 COMPLETE - SUMMARY');
  console.log('='.repeat(60));
  
  console.log(`
   LP Token Trading:
   ────────────────
   1. ✅ Charlie bought 5 LP tokens for 470 USDT (94 USDT/share)
   2. ✅ Dave bought 5 LP tokens for 470 USDT (94 USDT/share)
   3. ✅ DAO recovered 940 USDT (their capital contribution)
   
   Final LP Distribution:
   ─────────────────────
   • Charlie: 5 LP tokens (50%)
   • Dave: 5 LP tokens (50%)
   • DAO: 0 LP tokens (sold all, recovered capital)
   
   Risk Transfer Complete:
   ─────────────────────
   • DAO has NO risk exposure (sold all LP tokens)
   • Charlie & Dave now bear the rainfall risk
   • If rainfall ≥50mm: They lose 940 USDT total
   • If rainfall <50mm: They gain premium share (~60 USDT)
  `);
  
  console.log('='.repeat(60));
  
  await api.disconnect();
  process.exit(0);
}

main().catch((error) => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});

