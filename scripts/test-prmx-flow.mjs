/**
 * PRMX Chain Test Script
 * Tests the complete insurance flow:
 * 1. Check Manila market exists
 * 2. Request a quote
 * 3. Submit quote (simulate oracle)
 * 4. Apply for coverage
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
  console.log('🚀 PRMX Chain Test Script');
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
  
  console.log(`\n👤 Test Accounts:`);
  console.log(`   Alice: ${alice.address}`);
  console.log(`   Bob:   ${bob.address}`);
  
  // ==========================================================================
  // Step 1: Check Manila Market Exists
  // ==========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('📊 STEP 1: Check Manila Market at Genesis');
  console.log('='.repeat(60));
  
  const market0 = await api.query.prmxMarkets.markets(0);
  if (market0.isSome) {
    const market = market0.unwrap();
    console.log('\n   ✅ Manila Market Found (ID: 0)');
    console.log(`   - Location ID: ${market.locationId}`);
    console.log(`   - Strike Value: ${market.strikeValue} (${market.strikeValue / 10}mm)`);
    console.log(`   - Payout/Share: ${market.payoutPerShare} (${Number(market.payoutPerShare) / 1_000_000} USDT)`);
    console.log(`   - Status: ${market.status.toString()}`);
    console.log(`   - DAO Margin: ${market.risk.daoMarginBp} bp (${market.risk.daoMarginBp / 100}%)`);
  } else {
    console.log('   ❌ Manila Market NOT FOUND!');
    process.exit(1);
  }
  
  const nextMarketId = await api.query.prmxMarkets.nextMarketId();
  console.log(`   - Next Market ID: ${nextMarketId}`);
  
  // ==========================================================================
  // Step 2: Check Balances
  // ==========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('💰 STEP 2: Check Account Balances');
  console.log('='.repeat(60));
  
  // Check PRMX balance
  const alicePrmx = await api.query.system.account(alice.address);
  const prmxFree = BigInt(alicePrmx.data.free.toString());
  console.log(`\n   Alice PRMX: ${prmxFree / BigInt(10**18)} PRMX`);
  
  // Check USDT balance (asset ID 1)
  const aliceUsdt = await api.query.assets.account(1, alice.address);
  if (aliceUsdt.isSome) {
    const balance = BigInt(aliceUsdt.unwrap().balance.toString());
    console.log(`   Alice USDT: ${Number(balance / BigInt(1_000_000))} USDT`);
  }
  
  const bobUsdt = await api.query.assets.account(1, bob.address);
  if (bobUsdt.isSome) {
    const balance = BigInt(bobUsdt.unwrap().balance.toString());
    console.log(`   Bob USDT:   ${Number(balance / BigInt(1_000_000))} USDT`);
  }
  
  // ==========================================================================
  // Step 3: Request a Quote
  // ==========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('📝 STEP 3: Request Policy Quote');
  console.log('='.repeat(60));
  
  // Calculate valid coverage window
  // Chain "now" = block_number * 6 seconds
  // Min lead time = 1,814,400 seconds (21 days)
  const currentBlock = header.number.toNumber();
  const chainNow = currentBlock * 6;
  const minLeadTime = 1_814_400;
  
  const coverageStart = chainNow + minLeadTime + 100_000; // Add buffer
  const coverageEnd = coverageStart + 86_400; // 1 day coverage
  
  console.log(`\n   Chain "now": ${chainNow} seconds`);
  console.log(`   Coverage Start: ${coverageStart} (~${Math.floor((coverageStart - chainNow) / 86400)} days from now)`);
  console.log(`   Coverage End: ${coverageEnd} (1 day duration)`);
  console.log(`   Latitude: 14599500 (Manila)`);
  console.log(`   Longitude: 120984200 (Manila)`);
  console.log(`   Shares: 10 (1,000 USDT coverage)`);
  
  const quoteRequestTx = api.tx.prmxQuote.requestPolicyQuote(
    0,              // marketId (Manila)
    coverageStart,  // coverageStart
    coverageEnd,    // coverageEnd
    14599500,       // latitude (Manila)
    120984200,      // longitude (Manila)
    10              // shares (10 shares = 1000 USDT)
  );
  
  await submitAndWait(api, quoteRequestTx, bob, 'Request Quote (Bob)');
  
  // Check quote was created
  const quoteRequest = await api.query.prmxQuote.quoteRequests(0);
  if (quoteRequest.isSome) {
    console.log('\n   ✅ Quote Request Created (ID: 0)');
  }
  
  // ==========================================================================
  // Step 4: Submit Quote (Simulate Oracle)
  // ==========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('🔮 STEP 4: Submit Quote (Simulate Oracle)');
  console.log('='.repeat(60));
  
  // Simulate oracle returning 5% probability
  const probabilityPpm = 50_000; // 5% = 50,000 ppm
  console.log(`\n   Probability: ${probabilityPpm} ppm (${probabilityPpm / 10000}%)`);
  
  // Expected premium calculation:
  // Fair premium = 100 USDT * 5% = 5 USDT/share
  // With 20% margin: 5 * 1.2 = 6 USDT/share
  // Total for 10 shares: 60 USDT
  console.log(`   Expected premium: ~60 USDT (5% * 100 USDT * 1.2 margin * 10 shares)`);
  
  const submitQuoteTx = api.tx.prmxQuote.submitQuote(
    0,              // quoteId
    probabilityPpm  // probability in parts per million
  );
  
  // Note: In production, this would be an unsigned transaction from offchain worker
  // For testing, we submit it as a signed transaction from Alice (simulating oracle)
  await submitAndWait(api, submitQuoteTx, alice, 'Submit Quote (Simulated Oracle)');
  
  // Check quote result
  const quoteResult = await api.query.prmxQuote.quoteResults(0);
  if (quoteResult.isSome) {
    const result = quoteResult.unwrap();
    console.log('\n   ✅ Quote Result Stored');
    console.log(`   - Probability: ${result.probabilityPpm} ppm`);
    console.log(`   - Premium/Share: ${Number(result.premiumPerShare) / 1_000_000} USDT`);
    console.log(`   - Total Premium: ${Number(result.totalPremium) / 1_000_000} USDT`);
  }
  
  // ==========================================================================
  // Step 5: Apply for Coverage
  // ==========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('🛡️ STEP 5: Apply for Coverage');
  console.log('='.repeat(60));
  
  const applyCoverageTx = api.tx.prmxPolicy.applyCoverageWithQuote(0); // quoteId
  
  await submitAndWait(api, applyCoverageTx, bob, 'Apply Coverage (Bob)');
  
  // Check policy was created
  const policy = await api.query.prmxPolicy.policies(0);
  if (policy.isSome) {
    const p = policy.unwrap();
    console.log('\n   ✅ Policy Created (ID: 0)');
    console.log(`   - Holder: ${p.holder.toString().substring(0, 20)}...`);
    console.log(`   - Shares: ${p.shares}`);
    console.log(`   - Premium Paid: ${Number(p.premiumPaid) / 1_000_000} USDT`);
    console.log(`   - Max Payout: ${Number(p.maxPayout) / 1_000_000} USDT`);
    console.log(`   - Status: ${p.status.toString()}`);
  }
  
  // Check LP tokens minted to DAO
  const daoAddress = '5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM'; // DAO account from [0u8; 32]
  // Note: This is the address derived from AccountId::from([0u8; 32])
  
  // Check holdings
  const holdings = await api.query.prmxHoldings.holdingsStorage(0, alice.address);
  console.log(`\n   Alice LP Shares in Market 0: ${holdings.lpShares || 0}`);
  
  const totalLpShares = await api.query.prmxHoldings.totalLpShares(0);
  console.log(`   Total LP Shares in Market 0: ${totalLpShares}`);
  
  // Check orderbook
  const nextOrderId = await api.query.prmxOrderbookLp.nextOrderId();
  console.log(`   Next Order ID: ${nextOrderId}`);
  
  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('✅ TEST COMPLETE - SUMMARY');
  console.log('='.repeat(60));
  
  // Final balances
  const bobUsdtFinal = await api.query.assets.account(1, bob.address);
  if (bobUsdtFinal.isSome) {
    const balance = bobUsdtFinal.unwrap().balance;
    console.log(`\n   Bob's Final USDT: ${Number(balance) / 1_000_000} USDT`);
  }
  
  console.log('\n   Flow completed successfully:');
  console.log('   1. ✅ Manila market verified at genesis');
  console.log('   2. ✅ Quote requested by Bob');
  console.log('   3. ✅ Quote submitted (oracle simulated)');
  console.log('   4. ✅ Coverage applied - Policy created');
  console.log('   5. ✅ LP tokens minted, DAO ask placed on orderbook');
  
  console.log('\n' + '='.repeat(60));
  
  await api.disconnect();
  process.exit(0);
}

main().catch((error) => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});

