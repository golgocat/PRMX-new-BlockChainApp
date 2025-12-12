#!/usr/bin/env node
/**
 * PRMX Event Listener for Load Test
 * 
 * Subscribes to all PRMX chain events and writes structured logs
 * organized by policy ID for easy verification of test results.
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const WS_ENDPOINT = process.env.WS_ENDPOINT || 'ws://127.0.0.1:9944';
const LOG_FILE = process.env.LOG_FILE || './test-results.log';

// Track events by policy ID
const policyEvents = new Map(); // policyId -> { scenario, events: [], result: null }
const globalEvents = []; // Events not tied to a specific policy

// Scenario names
const SCENARIOS = {
  0: 'A: DAO Hold',
  1: 'B: Full Buy',
  2: 'C: Partial Buy',
  3: 'D: Multi-Investor',
  4: 'E: Secondary Trade',
};

function formatTimestamp() {
  return new Date().toISOString();
}

function formatTime() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function formatBalance(balance) {
  return `${(Number(balance) / 1e6).toFixed(2)} USDT`;
}

// Initialize policy tracking
function initPolicy(policyId, scenario = null) {
  if (!policyEvents.has(policyId)) {
    policyEvents.set(policyId, {
      scenario: scenario !== null ? SCENARIOS[scenario % 5] : 'Unknown',
      createdAt: formatTimestamp(),
      events: [],
      result: null,
      lpDistribution: [],
    });
  }
  return policyEvents.get(policyId);
}

// Add event to policy
function addPolicyEvent(policyId, event) {
  const policy = initPolicy(policyId);
  policy.events.push({
    time: formatTime(),
    ...event,
  });
}

// Set policy result
function setPolicyResult(policyId, result, details = {}) {
  const policy = policyEvents.get(policyId);
  if (policy) {
    policy.result = { ...result, ...details };
  }
}

// Process PRMX pallet events
function processEvent(event, blockNumber) {
  const { section, method, data } = event;
  const eventStr = `${section}.${method}`;
  
  // Skip non-PRMX events
  if (!section.startsWith('prmx')) {
    return;
  }
  
  const parsedData = data.toHuman();
  
  console.log(`[Block #${blockNumber}] ${eventStr}:`, JSON.stringify(parsedData));
  
  // Handle policy-related events
  switch (section) {
    case 'prmxPolicy':
      handlePolicyEvent(method, parsedData);
      break;
    case 'prmxQuote':
      handleQuoteEvent(method, parsedData);
      break;
    case 'prmxHoldings':
      handleHoldingsEvent(method, parsedData);
      break;
    case 'prmxOrderbookLp':
      handleOrderbookEvent(method, parsedData);
      break;
    case 'prmxOracle':
      handleOracleEvent(method, parsedData);
      break;
    case 'prmxXcmCapital':
      handleXcmCapitalEvent(method, parsedData);
      break;
    case 'prmxMarkets':
      handleMarketsEvent(method, parsedData);
      break;
  }
}

function handlePolicyEvent(method, data) {
  switch (method) {
    case 'PolicyCreated': {
      const policyId = parseInt(data.policyId);
      // Scenario is passed via external tracking
      initPolicy(policyId);
      addPolicyEvent(policyId, {
        type: 'PolicyCreated',
        marketId: data.marketId,
        holder: data.holder,
        shares: data.shares,
      });
      break;
    }
    case 'CapitalLocked': {
      const policyId = parseInt(data.policyId);
      addPolicyEvent(policyId, {
        type: 'CapitalLocked',
        userPremium: data.userPremium,
        daoCapital: data.daoCapital,
      });
      break;
    }
    case 'LpTokensMinted': {
      const policyId = parseInt(data.policyId);
      addPolicyEvent(policyId, {
        type: 'LpTokensMinted',
        shares: data.shares,
      });
      break;
    }
    case 'DaoLpAskPlaced': {
      const policyId = parseInt(data.policyId);
      addPolicyEvent(policyId, {
        type: 'DaoLpAskPlaced',
        pricePerShare: data.pricePerShare,
        quantity: data.quantity,
      });
      break;
    }
    case 'PolicySettled': {
      const policyId = parseInt(data.policyId);
      addPolicyEvent(policyId, {
        type: 'PolicySettled',
        payoutToHolder: data.payoutToHolder,
      });
      setPolicyResult(policyId, {
        status: 'SETTLED',
        triggered: true,
        payout: data.payoutToHolder,
      });
      break;
    }
    case 'PolicyExpiredNoEvent': {
      const policyId = parseInt(data.policyId);
      addPolicyEvent(policyId, {
        type: 'PolicyExpiredNoEvent',
        residualToPool: data.residualToPool,
      });
      setPolicyResult(policyId, {
        status: 'EXPIRED',
        triggered: false,
        residual: data.residualToPool,
      });
      break;
    }
  }
}

function handleQuoteEvent(method, data) {
  if (method === 'QuoteRequested') {
    globalEvents.push({
      time: formatTime(),
      type: 'QuoteRequested',
      quoteId: data.quoteId,
      marketId: data.marketId,
      requester: data.requester,
    });
  } else if (method === 'QuoteReady') {
    globalEvents.push({
      time: formatTime(),
      type: 'QuoteReady',
      quoteId: data.quoteId,
      totalPremium: data.totalPremium,
    });
  }
}

function handleHoldingsEvent(method, data) {
  const policyId = parseInt(data.policyId);
  addPolicyEvent(policyId, {
    type: method,
    account: data.account,
    amount: data.amount,
  });
}

function handleOrderbookEvent(method, data) {
  if (method === 'TradeExecuted') {
    const policyId = parseInt(data.policyId);
    addPolicyEvent(policyId, {
      type: 'TradeExecuted',
      orderId: data.orderId,
      buyer: data.buyer,
      seller: data.seller,
      price: data.price,
      quantity: data.quantity,
    });
  } else if (method === 'AskPlaced' || method === 'AskCancelled' || method === 'OrderFilled') {
    const policyId = data.policyId ? parseInt(data.policyId) : null;
    if (policyId) {
      addPolicyEvent(policyId, {
        type: method,
        ...data,
      });
    }
  }
}

function handleOracleEvent(method, data) {
  if (method === 'ThresholdTriggered') {
    const policyId = parseInt(data.policyId);
    addPolicyEvent(policyId, {
      type: 'ThresholdTriggered',
      triggerId: data.triggerId,
      marketId: data.marketId,
      rollingSumMm: data.rollingSumMm,
      strikeThreshold: data.strikeThreshold,
      payoutAmount: data.payoutAmount,
    });
  } else {
    globalEvents.push({
      time: formatTime(),
      type: method,
      ...data,
    });
  }
}

function handleXcmCapitalEvent(method, data) {
  const policyId = data.policyId ? parseInt(data.policyId) : null;
  if (policyId) {
    addPolicyEvent(policyId, {
      type: method,
      ...data,
    });
  }
}

function handleMarketsEvent(method, data) {
  globalEvents.push({
    time: formatTime(),
    type: method,
    ...data,
  });
}

// Write structured log file
function writeLogFile() {
  let output = '';
  
  // Header
  output += '═'.repeat(80) + '\n';
  output += '  PRMX LOAD TEST RESULTS\n';
  output += `  Generated: ${formatTimestamp()}\n`;
  output += `  Total Policies: ${policyEvents.size}\n`;
  output += '═'.repeat(80) + '\n\n';
  
  // Summary statistics
  let triggered = 0;
  let expired = 0;
  let pending = 0;
  
  for (const [, policy] of policyEvents) {
    if (!policy.result) {
      pending++;
    } else if (policy.result.triggered) {
      triggered++;
    } else {
      expired++;
    }
  }
  
  output += '┌─────────────────────────────────────────────────────────────────────────────┐\n';
  output += '│  SUMMARY                                                                    │\n';
  output += '├─────────────────────────────────────────────────────────────────────────────┤\n';
  output += `│  Triggered (Payout):    ${String(triggered).padStart(4)}                                              │\n`;
  output += `│  Expired (No Event):    ${String(expired).padStart(4)}                                              │\n`;
  output += `│  Pending:               ${String(pending).padStart(4)}                                              │\n`;
  output += '└─────────────────────────────────────────────────────────────────────────────┘\n\n';
  
  // Per-policy details
  const sortedPolicies = [...policyEvents.entries()].sort((a, b) => a[0] - b[0]);
  
  for (const [policyId, policy] of sortedPolicies) {
    output += '═'.repeat(80) + '\n';
    output += `POLICY #${policyId} | Scenario: ${policy.scenario} | Created: ${policy.createdAt}\n`;
    output += '═'.repeat(80) + '\n';
    
    // Events
    for (const event of policy.events) {
      const eventLine = `[${event.time}] ${event.type}`;
      const eventData = Object.entries(event)
        .filter(([k]) => !['time', 'type'].includes(k))
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      output += `${eventLine} { ${eventData} }\n`;
    }
    
    // Result
    output += '\n';
    if (policy.result) {
      if (policy.result.triggered) {
        output += `RESULT: TRIGGERED (Payout: ${policy.result.payout})\n`;
      } else {
        output += `RESULT: EXPIRED (Residual to pool: ${policy.result.residual})\n`;
      }
    } else {
      output += 'RESULT: PENDING\n';
    }
    
    output += '─'.repeat(80) + '\n\n';
  }
  
  // Global events
  if (globalEvents.length > 0) {
    output += '═'.repeat(80) + '\n';
    output += 'GLOBAL EVENTS (not tied to specific policy)\n';
    output += '═'.repeat(80) + '\n';
    
    for (const event of globalEvents) {
      const eventLine = `[${event.time}] ${event.type}`;
      const eventData = Object.entries(event)
        .filter(([k]) => !['time', 'type'].includes(k))
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      output += `${eventLine} { ${eventData} }\n`;
    }
  }
  
  fs.writeFileSync(LOG_FILE, output);
  console.log(`\n📝 Log written to ${LOG_FILE}`);
}

// Set scenario for a policy (called from load test script via file)
export function setScenario(policyId, scenarioIndex) {
  const policy = initPolicy(policyId, scenarioIndex);
  policy.scenario = SCENARIOS[scenarioIndex % 5];
}

// Main event listener
async function main() {
  console.log('🎧 PRMX Event Listener');
  console.log(`   Connecting to: ${WS_ENDPOINT}`);
  console.log(`   Log file: ${LOG_FILE}`);
  console.log('');
  
  const wsProvider = new WsProvider(WS_ENDPOINT);
  const api = await ApiPromise.create({ provider: wsProvider });
  
  console.log('✅ Connected to node');
  console.log('📡 Subscribing to events...\n');
  
  // Subscribe to new blocks and their events
  await api.rpc.chain.subscribeNewHeads(async (header) => {
    const blockNumber = header.number.toNumber();
    const blockHash = await api.rpc.chain.getBlockHash(blockNumber);
    const events = await api.query.system.events.at(blockHash);
    
    for (const record of events) {
      processEvent(record.event, blockNumber);
    }
  });
  
  // Periodically write log file
  setInterval(() => {
    writeLogFile();
  }, 10000); // Every 10 seconds
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down...');
    writeLogFile();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.log('\n\n🛑 Shutting down...');
    writeLogFile();
    process.exit(0);
  });
  
  console.log('👂 Listening for events... (Ctrl+C to stop)\n');
}

// IPC communication - read scenario assignments from file
const SCENARIO_FILE = './policy-scenarios.json';

function loadScenarios() {
  try {
    if (fs.existsSync(SCENARIO_FILE)) {
      const data = JSON.parse(fs.readFileSync(SCENARIO_FILE, 'utf-8'));
      for (const [policyId, scenarioIndex] of Object.entries(data)) {
        setScenario(parseInt(policyId), scenarioIndex);
      }
    }
  } catch (e) {
    // Ignore errors
  }
}

// Poll for scenario updates
setInterval(loadScenarios, 1000);

main().catch(console.error);

