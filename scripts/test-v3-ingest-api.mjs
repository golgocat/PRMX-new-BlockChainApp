#!/usr/bin/env node
/**
 * Test script for V3 Ingest API endpoints
 * 
 * Usage:
 *   node scripts/test-v3-ingest-api.mjs [--ingest-url URL]
 * 
 * Environment:
 *   INGEST_URL - Ingest API base URL (default: http://localhost:3001)
 *   V3_INGEST_HMAC_SECRET - HMAC secret for signing requests
 */

import crypto from 'crypto';

// Parse arguments
const args = process.argv.slice(2);
let ingestUrl = process.env.INGEST_URL || 'http://localhost:3001';
const hmacSecret = process.env.V3_INGEST_HMAC_SECRET || 'default-dev-secret-change-in-production';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ingest-url' && args[i + 1]) {
    ingestUrl = args[i + 1];
    i++;
  }
}

console.log('🧪 V3 Ingest API Test Script');
console.log('============================');
console.log(`Ingest URL: ${ingestUrl}`);
console.log('');

// Test policy ID
const TEST_POLICY_ID = 9999;

/**
 * Compute Blake2-256 signature (matching Substrate's BlakeTwo256)
 */
function computeBlake2Signature(secret, payload, timestamp, nonce) {
  const signatureInput = secret + payload + timestamp + nonce;
  const blake2 = crypto.createHash('blake2b512');
  blake2.update(signatureInput);
  // Take first 32 bytes (256 bits) to match Blake2-256
  return blake2.digest('hex').slice(0, 64);
}

/**
 * Make authenticated request to Ingest API
 */
async function makeRequest(method, path, body = null) {
  const url = `${ingestUrl}${path}`;
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  
  const headers = {
    'Content-Type': 'application/json',
  };
  
  let options = { method, headers };
  
  if (body) {
    const bodyStr = JSON.stringify(body);
    const signature = computeBlake2Signature(hmacSecret, bodyStr, timestamp, nonce);
    
    headers['X-HMAC-Signature'] = signature;
    headers['X-Timestamp'] = timestamp;
    headers['X-Nonce'] = nonce;
    
    options.body = bodyStr;
  }
  
  const response = await fetch(url, options);
  const data = await response.json();
  
  return { status: response.status, data };
}

/**
 * Run all tests
 */
async function runTests() {
  let passed = 0;
  let failed = 0;
  
  // Test 1: Health check
  console.log('📋 Test 1: Health check');
  try {
    const { status, data } = await makeRequest('GET', '/health');
    if (status === 200 && data.status === 'ok') {
      console.log('   ✅ PASSED: Health check returned ok');
      passed++;
    } else {
      console.log(`   ❌ FAILED: Unexpected response: ${JSON.stringify(data)}`);
      failed++;
    }
  } catch (err) {
    console.log(`   ❌ FAILED: ${err.message}`);
    console.log('   💡 Make sure the oracle-v2 service is running:');
    console.log('      cd oracle-v2 && V3_DEV_MODE=true node dist/index.js');
    failed++;
    return { passed, failed };
  }
  
  // Test 2: Post observations batch
  console.log('');
  console.log('📋 Test 2: Post observations batch');
  try {
    const now = Math.floor(Date.now() / 1000);
    const observations = {
      policy_id: TEST_POLICY_ID,
      location_key: '264885',
      samples: [
        {
          epoch_time: now - 3600,
          precip_1h_mm_x1000: 5000,  // 5mm
          temp_c_x1000: 25000,       // 25°C
          wind_gust_mps_x1000: 10000, // 10 m/s
          precip_type_mask: 1,       // Rain
          sample_hash: crypto.randomBytes(32).toString('hex'),
        },
        {
          epoch_time: now - 7200,
          precip_1h_mm_x1000: 10000, // 10mm
          temp_c_x1000: 23000,       // 23°C
          wind_gust_mps_x1000: 8000, // 8 m/s
          precip_type_mask: 1,       // Rain
          sample_hash: crypto.randomBytes(32).toString('hex'),
        },
      ],
      commitment_after: crypto.randomBytes(32).toString('hex'),
    };
    
    const { status, data } = await makeRequest('POST', '/v1/observations/batch', observations);
    if (status === 200 && data.success) {
      console.log(`   ✅ PASSED: Inserted ${data.inserted} observations`);
      passed++;
    } else {
      console.log(`   ❌ FAILED: ${JSON.stringify(data)}`);
      failed++;
    }
  } catch (err) {
    console.log(`   ❌ FAILED: ${err.message}`);
    failed++;
  }
  
  // Test 3: Post observations batch (duplicate check)
  console.log('');
  console.log('📋 Test 3: Post duplicate observations (should detect dupes)');
  try {
    const now = Math.floor(Date.now() / 1000);
    const observations = {
      policy_id: TEST_POLICY_ID,
      location_key: '264885',
      samples: [
        {
          epoch_time: now - 3600,  // Same as before
          precip_1h_mm_x1000: 5000,
          temp_c_x1000: 25000,
          wind_gust_mps_x1000: 10000,
          precip_type_mask: 1,
          sample_hash: crypto.randomBytes(32).toString('hex'),
        },
      ],
      commitment_after: crypto.randomBytes(32).toString('hex'),
    };
    
    const { status, data } = await makeRequest('POST', '/v1/observations/batch', observations);
    if (status === 200 && data.already_present >= 1) {
      console.log(`   ✅ PASSED: Detected ${data.already_present} duplicates`);
      passed++;
    } else {
      console.log(`   ❌ FAILED: Expected duplicates, got: ${JSON.stringify(data)}`);
      failed++;
    }
  } catch (err) {
    console.log(`   ❌ FAILED: ${err.message}`);
    failed++;
  }
  
  // Test 4: Post snapshot
  console.log('');
  console.log('📋 Test 4: Post snapshot');
  try {
    const now = Math.floor(Date.now() / 1000);
    const snapshot = {
      policy_id: TEST_POLICY_ID,
      observed_until: now,
      agg_state: '0102030405',  // Hex-encoded SCALE bytes
      commitment: crypto.randomBytes(32).toString('hex'),
    };
    
    const { status, data } = await makeRequest('POST', '/v1/snapshots', snapshot);
    if (status === 200 && data.success) {
      console.log(`   ✅ PASSED: Snapshot inserted, is_new=${data.is_new}`);
      passed++;
    } else {
      console.log(`   ❌ FAILED: ${JSON.stringify(data)}`);
      failed++;
    }
  } catch (err) {
    console.log(`   ❌ FAILED: ${err.message}`);
    failed++;
  }
  
  // Test 5: Get observations
  console.log('');
  console.log('📋 Test 5: Get observations for policy');
  try {
    const { status, data } = await makeRequest('GET', `/v1/observations/${TEST_POLICY_ID}`);
    if (status === 200 && data.success && data.count >= 2) {
      console.log(`   ✅ PASSED: Retrieved ${data.count} observations`);
      passed++;
    } else {
      console.log(`   ❌ FAILED: ${JSON.stringify(data)}`);
      failed++;
    }
  } catch (err) {
    console.log(`   ❌ FAILED: ${err.message}`);
    failed++;
  }
  
  // Test 6: Get snapshots
  console.log('');
  console.log('📋 Test 6: Get snapshots for policy');
  try {
    const { status, data } = await makeRequest('GET', `/v1/snapshots/${TEST_POLICY_ID}`);
    if (status === 200 && data.success && data.count >= 1) {
      console.log(`   ✅ PASSED: Retrieved ${data.count} snapshots`);
      passed++;
    } else {
      console.log(`   ❌ FAILED: ${JSON.stringify(data)}`);
      failed++;
    }
  } catch (err) {
    console.log(`   ❌ FAILED: ${err.message}`);
    failed++;
  }
  
  // Test 7: Get V3 stats
  console.log('');
  console.log('📋 Test 7: Get V3 stats');
  try {
    const { status, data } = await makeRequest('GET', '/v1/stats');
    if (status === 200 && data.success) {
      console.log(`   ✅ PASSED: Stats - observations: ${data.data.observations_count}, snapshots: ${data.data.snapshots_count}`);
      passed++;
    } else {
      console.log(`   ❌ FAILED: ${JSON.stringify(data)}`);
      failed++;
    }
  } catch (err) {
    console.log(`   ❌ FAILED: ${err.message}`);
    failed++;
  }
  
  // Test 8: Missing required fields
  console.log('');
  console.log('📋 Test 8: Validation - missing required fields');
  try {
    const { status, data } = await makeRequest('POST', '/v1/observations/batch', { samples: [] });
    if (status === 400) {
      console.log('   ✅ PASSED: Correctly rejected invalid request');
      passed++;
    } else {
      console.log(`   ❌ FAILED: Expected 400, got ${status}`);
      failed++;
    }
  } catch (err) {
    console.log(`   ❌ FAILED: ${err.message}`);
    failed++;
  }
  
  return { passed, failed };
}

// Run tests
console.log('Starting tests...');
console.log('');

runTests()
  .then(({ passed, failed }) => {
    console.log('');
    console.log('============================');
    console.log('📊 Test Results');
    console.log(`   ✅ Passed: ${passed}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log('');
    
    if (failed > 0) {
      process.exit(1);
    }
  })
  .catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
  });

