#!/usr/bin/env node
/**
 * PRMX Load Test Orchestrator
 * 
 * Creates 120 policies over ~1 hour with 1-minute durations,
 * executes various LP scenarios, and triggers random settlement events.
 * 
 * Usage:
 *   node load-test.mjs [options]
 * 
 * Options:
 *   --policies=N       Number of policies to create (default: 120)
 *   --interval=N       Seconds between policy creation (default: 30)
 *   --duration=N       Coverage duration in seconds (default: 60)
 *   --trigger-interval=N  Seconds between trigger checks (default: 180)
 *   --trigger-prob=N   Probability of trigger (0-100, default: 50)
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import * as fs from 'fs';
import { initAccounts, getAccounts, getDaoAddress, getInvestorByIndex, printAccountInfo } from './test-accounts.mjs';

// Configuration
const WS_ENDPOINT = process.env.WS_ENDPOINT || 'ws://127.0.0.1:9944';
const USDT_ASSET_ID = 1;
const MARKET_ID = 0; // Manila market
const MANILA_ACCUWEATHER_KEY = '3423441';

// Module-level accounts reference (set after init)
let accounts = null;

// Parse command line arguments
function parseArgs() {
  const args = {
    policies: 120,
    interval: 30,        // 30 seconds between policies
    duration: 60,        // 1 minute coverage duration
    triggerInterval: 180, // 3 minutes between trigger checks
    triggerProb: 50,     // 50% chance to trigger
  };
  
  for (const arg of process.argv.slice(2)) {
    const [key, value] = arg.replace('--', '').split('=');
    if (key === 'policies') args.policies = parseInt(value);
    if (key === 'interval') args.interval = parseInt(value);
    if (key === 'duration') args.duration = parseInt(value);
    if (key === 'trigger-interval') args.triggerInterval = parseInt(value);
    if (key === 'trigger-prob') args.triggerProb = parseInt(value);
  }
  
  return args;
}

// Scenario definitions
const SCENARIOS = {
  A_DAO_HOLD: 0,        // DAO holds LP tokens until settlement
  B_FULL_BUY: 1,        // Single investor buys 100% LP tokens
  C_PARTIAL_BUY: 2,     // Investor buys 50% LP tokens
  D_MULTI_INVESTOR: 3,  // 3 investors split LP tokens
  E_SECONDARY_TRADE: 4, // Investor buys, then sells to another
};

const SCENARIO_NAMES = {
  0: 'A: DAO Hold',
  1: 'B: Full Buy',
  2: 'C: Partial Buy',
  3: 'D: Multi-Investor',
  4: 'E: Secondary Trade',
};

// Track active policies
const activePolicies = new Map(); // policyId -> { coverageEnd, scenario, holder }
const policyScenarios = {};       // For event listener IPC

// Utility functions
function formatUsdt(balance) {
  return `${(Number(balance) / 1e6).toFixed(2)} USDT`;
}

function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

async function getChainTime(api) {
  const chainTimestamp = await api.query.timestamp.now();
  return Math.floor(chainTimestamp.toNumber() / 1000);
}

async function sendTx(api, tx, signer) {
  return new Promise((resolve, reject) => {
    tx.signAndSend(signer, ({ status, dispatchError, events }) => {
      if (status.isInBlock) {
        if (dispatchError) {
          let errorMessage = 'Transaction failed';
          if (dispatchError.isModule) {
            try {
              const decoded = api.registry.findMetaError(dispatchError.asModule);
              errorMessage = `${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`;
            } catch (e) {
              errorMessage = dispatchError.toString();
            }
          } else {
            errorMessage = dispatchError.toString();
          }
          reject(new Error(errorMessage));
        } else {
          resolve(events);
        }
      }
    });
  });
}

// Setup oracle for testing
async function setupOracle(api) {
  log('Setting up oracle...');
  
  // Note: In dev mode, the OCW is automatically submitting rainfall data
  // and the oracle/quote providers are registered at genesis.
  // We just need to verify the setup is complete.
  
  // Check if location is already bound (OCW does this automatically)
  const locationConfig = await api.query.prmxOracle.marketLocationConfig(MARKET_ID);
  if (locationConfig.isSome) {
    log('  ✓ Manila location already bound by OCW');
  } else {
    log('  ⚠ Location not bound yet, waiting for OCW...');
    // Wait a bit for OCW to bind it
    await new Promise(r => setTimeout(r, 10000));
  }
  
  // Verify oracle provider exists (should be set at genesis)
  log('  ✓ Oracle and quote providers registered at genesis');
}

// Request a quote
async function requestQuote(api, user, coverageStart, coverageEnd) {
  const market = await api.query.prmxMarkets.markets(MARKET_ID);
  const marketInfo = market.unwrap();
  const lat = marketInfo.centerLatitude.toNumber();
  const lon = marketInfo.centerLongitude.toNumber();
  
  const quoteTx = api.tx.prmxQuote.requestPolicyQuote(
    MARKET_ID, coverageStart, coverageEnd, lat, lon, 1 // 1 share
  );
  
  let quoteId = null;
  await new Promise((resolve) => {
    quoteTx.signAndSend(user, ({ status, events }) => {
      if (status.isInBlock) {
        for (const { event } of events) {
          if (event.section === 'prmxQuote' && event.method === 'QuoteRequested') {
            quoteId = event.data[0].toNumber();
          }
        }
        resolve();
      }
    });
  });
  
  return quoteId;
}

// Submit quote result (simulating off-chain worker)
async function submitQuote(api, quoteId, probabilityPpm = 100000) { // 10%
  const submitQuoteTx = api.tx.prmxQuote.submitQuote(quoteId, probabilityPpm);
  await sendTx(api, submitQuoteTx, accounts.alice);
}

// Create a policy from quote
async function createPolicy(api, user, quoteId) {
  const applyTx = api.tx.prmxPolicy.applyCoverageWithQuote(quoteId);
  
  let policyId = null;
  await new Promise((resolve) => {
    applyTx.signAndSend(user, ({ status, events }) => {
      if (status.isInBlock) {
        for (const { event } of events) {
          if (event.section === 'prmxPolicy' && event.method === 'PolicyCreated') {
            policyId = event.data[0].toNumber();
          }
        }
        resolve();
      }
    });
  });
  
  return policyId;
}

// Execute LP scenario
async function executeLpScenario(api, policyId, scenario) {
  log(`  Executing scenario: ${SCENARIO_NAMES[scenario]}`);
  
  switch (scenario) {
    case SCENARIOS.A_DAO_HOLD:
      // DAO holds - nothing to do
      log('    → DAO holding LP tokens');
      break;
      
    case SCENARIOS.B_FULL_BUY: {
      // Single investor buys 100%
      const buyer = getInvestorByIndex(0);
      await buyLpTokens(api, policyId, buyer, 100);
      log(`    → ${buyer.address.slice(0, 8)}... bought 100% LP tokens`);
      break;
    }
      
    case SCENARIOS.C_PARTIAL_BUY: {
      // Investor buys 50%
      const buyer = getInvestorByIndex(1);
      await buyLpTokens(api, policyId, buyer, 50);
      log(`    → ${buyer.address.slice(0, 8)}... bought 50% LP tokens`);
      break;
    }
      
    case SCENARIOS.D_MULTI_INVESTOR: {
      // 3 investors split (33%, 33%, 34%)
      const buyer1 = getInvestorByIndex(0);
      const buyer2 = getInvestorByIndex(1);
      const buyer3 = getInvestorByIndex(2);
      
      await buyLpTokens(api, policyId, buyer1, 33);
      await buyLpTokens(api, policyId, buyer2, 33);
      await buyLpTokens(api, policyId, buyer3, 34);
      
      log(`    → 3 investors bought LP tokens (33%, 33%, 34%)`);
      break;
    }
      
    case SCENARIOS.E_SECONDARY_TRADE: {
      // First investor buys, then sells to second
      const buyer1 = getInvestorByIndex(0);
      const buyer2 = getInvestorByIndex(3);
      
      await buyLpTokens(api, policyId, buyer1, 100);
      log(`    → ${buyer1.address.slice(0, 8)}... bought 100% LP tokens`);
      
      // Place ask order for secondary sale
      await placeSecondaryAsk(api, policyId, buyer1, 100);
      log(`    → ${buyer1.address.slice(0, 8)}... placed secondary ask`);
      
      // Second buyer purchases
      await buyLpTokens(api, policyId, buyer2, 100);
      log(`    → ${buyer2.address.slice(0, 8)}... bought in secondary market`);
      break;
    }
  }
}

// Buy LP tokens from DAO ask order
// buy_lp(policy_id, max_price, quantity)
async function buyLpTokens(api, policyId, buyer, percentage) {
  try {
    // Get the next order ID to find existing orders
    const nextOrderId = await api.query.prmxOrderbookLp.nextOrderId();
    const maxOrderId = nextOrderId.toNumber();
    
    // Search for orders for this policy
    for (let orderId = 0; orderId < maxOrderId; orderId++) {
      const order = await api.query.prmxOrderbookLp.orders(orderId);
      if (order.isSome) {
        const orderData = order.unwrap();
        const orderPolicyId = orderData.policyId.toNumber();
        const remaining = orderData.remaining.toNumber();
        const price = orderData.price.toString();
        
        if (orderPolicyId === policyId && remaining > 0) {
          const quantity = Math.floor(remaining * percentage / 100);
          
          if (quantity > 0) {
            // buy_lp takes: policy_id, max_price, quantity
            const buyTx = api.tx.prmxOrderbookLp.buyLp(policyId, price, quantity);
            await sendTx(api, buyTx, buyer);
            log(`    ✓ Bought ${quantity} LP tokens at price ${price}`);
            return; // Successfully bought
          }
          break;
        }
      }
    }
    log(`    ⚠ No LP orders found for policy #${policyId}`);
  } catch (e) {
    log(`    ⚠ LP buy failed: ${e.message}`);
  }
}

// Place secondary market ask order
async function placeSecondaryAsk(api, policyId, seller, quantity) {
  // Price at 90% of original (slight discount for quick sale)
  const askTx = api.tx.prmxOrderbookLp.placeLpAsk(policyId, 90000000, quantity);
  try {
    await sendTx(api, askTx, seller);
    log(`    ✓ Placed ask order for ${quantity} LP tokens`);
  } catch (e) {
    log(`    ⚠ Secondary ask failed: ${e.message}`);
  }
}

// Check and settle expired policies
async function settleExpiredPolicies(api) {
  const now = await getChainTime(api);
  const expiredPolicies = [];
  
  for (const [policyId, policy] of activePolicies) {
    if (now >= policy.coverageEnd) {
      expiredPolicies.push(policyId);
    }
  }
  
  if (expiredPolicies.length === 0) {
    return;
  }
  
  log(`📋 Found ${expiredPolicies.length} expired policies to settle`);
  
  for (const policyId of expiredPolicies) {
    try {
      log(`  Settling policy #${policyId} as no-event`);
      const settleTx = api.tx.prmxPolicy.settlePolicy(policyId, false);
      await sendTx(api, settleTx, accounts.alice);
      log(`  ✓ Policy #${policyId} settled`);
      activePolicies.delete(policyId);
    } catch (e) {
      log(`  ⚠ Failed to settle policy #${policyId}: ${e.message}`);
      // Remove from tracking anyway to avoid infinite retries
      activePolicies.delete(policyId);
    }
  }
}

// Random trigger check (triggers all active policies)
async function triggerCheck(api, config) {
  const now = await getChainTime(api);
  const activePolicyIds = [];
  
  // Find policies that are still in coverage window
  for (const [policyId, policy] of activePolicies) {
    if (now < policy.coverageEnd) {
      activePolicyIds.push(policyId);
    }
  }
  
  if (activePolicyIds.length === 0) {
    log('No active policies to trigger');
    return;
  }
  
  // Random trigger check
  const roll = Math.random() * 100;
  if (roll < config.triggerProb) {
    log(`🌧️ TRIGGER! (rolled ${roll.toFixed(1)} < ${config.triggerProb})`);
    log(`   Settling ${activePolicyIds.length} active policies as TRIGGERED`);
    
    // Submit high rainfall to trigger threshold
    const timestamp = now;
    const highRainfall = 600; // 60mm > 50mm threshold
    
    try {
      const rainTx = api.tx.prmxOracle.submitRainfall(MARKET_ID, timestamp, highRainfall);
      await sendTx(api, rainTx, accounts.alice);
      log('   Submitted high rainfall data');
    } catch (e) {
      log(`   ⚠ Failed to submit rainfall: ${e.message}`);
    }
    
    // Settle all active policies as triggered
    for (const policyId of activePolicyIds) {
      try {
        const settleTx = api.tx.prmxPolicy.settlePolicy(policyId, true);
        await sendTx(api, settleTx, accounts.alice);
        log(`   ✓ Policy #${policyId} settled as TRIGGERED`);
        activePolicies.delete(policyId);
      } catch (e) {
        log(`   ⚠ Failed to settle policy #${policyId}: ${e.message}`);
      }
    }
  } else {
    log(`☀️ No trigger (rolled ${roll.toFixed(1)} >= ${config.triggerProb})`);
  }
}

// Save scenario assignments for event listener
function saveScenarioAssignments() {
  fs.writeFileSync('./policy-scenarios.json', JSON.stringify(policyScenarios, null, 2));
}

// Main test orchestrator
async function main() {
  const config = parseArgs();
  
  console.log('═'.repeat(70));
  console.log('  PRMX LOAD TEST');
  console.log('═'.repeat(70));
  console.log('');
  console.log('Configuration:');
  console.log(`  Policies:          ${config.policies}`);
  console.log(`  Interval:          ${config.interval} seconds`);
  console.log(`  Duration:          ${config.duration} seconds (${config.duration / 60} min)`);
  console.log(`  Trigger interval:  ${config.triggerInterval} seconds`);
  console.log(`  Trigger probability: ${config.triggerProb}%`);
  console.log('');
  
  // Initialize crypto and accounts
  log('Initializing crypto...');
  await initAccounts();
  accounts = getAccounts();
  
  printAccountInfo();
  console.log('');
  
  // Connect to node
  log('Connecting to node...');
  const wsProvider = new WsProvider(WS_ENDPOINT);
  const api = await ApiPromise.create({ provider: wsProvider });
  log('✓ Connected');
  
  // Setup oracle
  await setupOracle(api);
  
  // Create policies
  log('');
  log('═'.repeat(50));
  log('Starting policy creation...');
  log('═'.repeat(50));
  
  let policyCount = 0;
  let lastTriggerCheck = Date.now();
  let lastSettlementCheck = Date.now();
  const SETTLEMENT_CHECK_INTERVAL = 15000; // Check for expired policies every 15 seconds
  
  for (let i = 0; i < config.policies; i++) {
    const scenario = i % 5; // Rotate through scenarios
    
    try {
      // First, settle any expired policies
      if (Date.now() - lastSettlementCheck >= SETTLEMENT_CHECK_INTERVAL) {
        await settleExpiredPolicies(api);
        lastSettlementCheck = Date.now();
      }
      
      log('');
      log(`Creating policy ${i + 1}/${config.policies} (Scenario: ${SCENARIO_NAMES[scenario]})`);
      
      // Get chain time and calculate coverage window
      const now = await getChainTime(api);
      const coverageStart = now + 5; // Start in 5 seconds
      const coverageEnd = coverageStart + config.duration;
      
      // Request quote
      log('  Requesting quote...');
      const quoteId = await requestQuote(api, accounts.bob, coverageStart, coverageEnd);
      log(`  ✓ Quote ID: ${quoteId}`);
      
      // Submit quote result
      await submitQuote(api, quoteId);
      log('  ✓ Quote submitted');
      
      // Create policy
      const policyId = await createPolicy(api, accounts.bob, quoteId);
      log(`  ✓ Policy ID: ${policyId}`);
      
      // Track policy
      activePolicies.set(policyId, {
        coverageEnd,
        scenario,
        holder: accounts.bob.address,
      });
      policyScenarios[policyId] = scenario;
      saveScenarioAssignments();
      
      // Execute LP scenario
      await executeLpScenario(api, policyId, scenario);
      
      policyCount++;
      
      // Check for trigger (weather event)
      if (Date.now() - lastTriggerCheck >= config.triggerInterval * 1000) {
        log('');
        log('─'.repeat(50));
        log('🌧️ TRIGGER CHECK');
        log('─'.repeat(50));
        await triggerCheck(api, config);
        lastTriggerCheck = Date.now();
      }
      
      // Wait before next policy
      if (i < config.policies - 1) {
        log(`  Waiting ${config.interval}s before next policy...`);
        
        // While waiting, periodically check for expired policies
        const waitUntil = Date.now() + config.interval * 1000;
        while (Date.now() < waitUntil) {
          await new Promise(r => setTimeout(r, Math.min(SETTLEMENT_CHECK_INTERVAL, waitUntil - Date.now())));
          if (Date.now() - lastSettlementCheck >= SETTLEMENT_CHECK_INTERVAL) {
            await settleExpiredPolicies(api);
            lastSettlementCheck = Date.now();
          }
        }
      }
      
    } catch (error) {
      log(`  ✗ Error creating policy: ${error.message}`);
    }
  }
  
  // Final settlement checks
  log('');
  log('═'.repeat(50));
  log('All policies created. Running final settlements...');
  log('═'.repeat(50));
  
  // Wait for remaining policies to expire/settle
  while (activePolicies.size > 0) {
    log(`\n${activePolicies.size} policies remaining...`);
    await settleExpiredPolicies(api);
    
    // If there are still active policies, wait and check again
    if (activePolicies.size > 0) {
      await new Promise(r => setTimeout(r, 10000)); // Check every 10 seconds
    }
  }
  
  log('');
  log('═'.repeat(50));
  log('LOAD TEST COMPLETE');
  log(`  Total policies created: ${policyCount}`);
  log('═'.repeat(50));
  
  // Give event listener time to write final log
  await new Promise(r => setTimeout(r, 5000));
  
  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

