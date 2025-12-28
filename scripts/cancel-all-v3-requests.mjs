#!/usr/bin/env node
/**
 * Script to cancel all pending V3 underwrite requests
 * 
 * Usage: node scripts/cancel-all-v3-requests.mjs
 */

import { ApiPromise, WsProvider, Keyring } from '@polkadot/api';

const WS_ENDPOINT = process.env.WS_ENDPOINT || 'ws://127.0.0.1:9944';

async function main() {
  console.log('🔗 Connecting to chain...');
  const provider = new WsProvider(WS_ENDPOINT);
  const api = await ApiPromise.create({ provider });
  
  console.log('✅ Connected to', (await api.rpc.system.chain()).toString());
  
  // Setup keyring - using Alice as default (change as needed)
  const keyring = new Keyring({ type: 'sr25519' });
  const alice = keyring.addFromUri('//Alice');
  const bob = keyring.addFromUri('//Bob');
  
  console.log('📋 Fetching all V3 requests...');
  
  // Get all requests
  const allRequests = await api.query.prmxMarketV3.underwriteRequests.entries();
  
  console.log(`Found ${allRequests.length} total requests`);
  
  // Filter pending requests
  const pendingRequests = [];
  for (const [key, value] of allRequests) {
    const request = value.toHuman();
    const requestId = parseInt(key.args[0].toString());
    const status = typeof request.status === 'object' ? Object.keys(request.status)[0] : request.status;
    
    if (status === 'Pending' || status === 'PartiallyFilled') {
      pendingRequests.push({
        id: requestId,
        requester: request.requester,
        status,
        remainingShares: parseInt((request.remainingShares || '0').toString().replace(/,/g, ''))
      });
    }
  }
  
  console.log(`Found ${pendingRequests.length} pending/partially-filled requests to cancel`);
  
  if (pendingRequests.length === 0) {
    console.log('✅ No requests to cancel');
    await api.disconnect();
    return;
  }
  
  // Cancel each request
  for (const request of pendingRequests) {
    console.log(`\n🗑️ Cancelling request #${request.id} (${request.status}, ${request.remainingShares} remaining shares)`);
    console.log(`   Requester: ${request.requester}`);
    
    // Determine which account to use based on requester
    let signer;
    if (request.requester === alice.address) {
      signer = alice;
      console.log('   Using: Alice');
    } else if (request.requester === bob.address) {
      signer = bob;
      console.log('   Using: Bob');
    } else {
      console.log('   ⚠️ Unknown requester, skipping...');
      continue;
    }
    
    try {
      const tx = api.tx.prmxMarketV3.cancelUnderwriteRequest(request.id);
      
      await new Promise((resolve, reject) => {
        tx.signAndSend(signer, ({ status, dispatchError }) => {
          if (dispatchError) {
            if (dispatchError.isModule) {
              const decoded = api.registry.findMetaError(dispatchError.asModule);
              reject(new Error(`${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`));
            } else {
              reject(new Error(dispatchError.toString()));
            }
            return;
          }
          if (status.isFinalized) {
            console.log(`   ✅ Cancelled! Block: ${status.asFinalized.toString().slice(0, 10)}...`);
            resolve();
          }
        });
      });
    } catch (err) {
      console.log(`   ❌ Failed: ${err.message}`);
    }
  }
  
  console.log('\n✅ Done!');
  await api.disconnect();
}

main().catch(console.error);

