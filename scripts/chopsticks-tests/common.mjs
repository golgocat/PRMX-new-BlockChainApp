/**
 * Common utilities for Chopsticks XCM testing
 * 
 * This module provides shared helpers for multi-chain XCM tests.
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import { u8aToHex, hexToU8a } from '@polkadot/util';

// =============================================================================
//                       Chain Configuration
// =============================================================================

export const CHAINS = {
    polkadot: {
        name: 'Polkadot',
        endpoint: 'ws://127.0.0.1:9000',
        paraId: 0, // Relay chain
    },
    assetHub: {
        name: 'Asset Hub',
        endpoint: 'ws://127.0.0.1:8002', // Chopsticks default when starting single chain
        paraId: 1000,
    },
    hydration: {
        name: 'Hydration',
        endpoint: 'ws://127.0.0.1:8000',
        paraId: 2034,
    },
    prmx: {
        name: 'PRMX',
        endpoint: 'ws://127.0.0.1:9944', // Dev node or Chopsticks
        paraId: 2000,
    },
};

// Asset IDs
export const ASSETS = {
    // Asset Hub
    USDT_ASSET_HUB: 1984,
    USDC_ASSET_HUB: 1337,
    
    // Hydration
    USDT_HYDRATION: 10,
    USDC_HYDRATION: 22,
    LP_POOL_102: 102,
    
    // PRMX
    USDT_PRMX: 1,
};

// Pool 102 configuration
export const POOL_102 = {
    id: 102,
    assets: [10, 22], // USDT, USDC on Hydration
};

// =============================================================================
//                       API Connection Helpers
// =============================================================================

/**
 * Connect to a chain and return the API instance
 */
export async function connectToChain(chainKey) {
    const chain = CHAINS[chainKey];
    if (!chain) {
        throw new Error(`Unknown chain: ${chainKey}`);
    }
    
    console.log(`📡 Connecting to ${chain.name} at ${chain.endpoint}...`);
    const provider = new WsProvider(chain.endpoint);
    const api = await ApiPromise.create({ provider });
    console.log(`   ✅ Connected to ${chain.name}`);
    
    return api;
}

/**
 * Connect to all chains for XCM testing
 */
export async function connectAllChains() {
    const apis = {};
    
    for (const chainKey of Object.keys(CHAINS)) {
        try {
            apis[chainKey] = await connectToChain(chainKey);
        } catch (error) {
            console.log(`   ⚠️  Could not connect to ${CHAINS[chainKey].name}: ${error.message}`);
            apis[chainKey] = null;
        }
    }
    
    return apis;
}

/**
 * Disconnect all APIs
 */
export async function disconnectAll(apis) {
    for (const [chainKey, api] of Object.entries(apis)) {
        if (api) {
            await api.disconnect();
            console.log(`   Disconnected from ${CHAINS[chainKey].name}`);
        }
    }
}

// =============================================================================
//                       Account Helpers
// =============================================================================

/**
 * Get keyring with test accounts
 */
export function getKeyring() {
    const keyring = new Keyring({ type: 'sr25519' });
    return {
        alice: keyring.addFromUri('//Alice'),
        bob: keyring.addFromUri('//Bob'),
        charlie: keyring.addFromUri('//Charlie'),
        dave: keyring.addFromUri('//Dave'),
    };
}

/**
 * Calculate sovereign account for a parachain on another chain
 * 
 * Sibling parachains use: b"sibl" + para_id_encoded
 */
export function calculateSovereignAccount(paraId) {
    // Substrate sovereign account derivation
    const prefix = new Uint8Array([0x73, 0x69, 0x62, 0x6c]); // "sibl"
    const paraIdBytes = new Uint8Array(4);
    new DataView(paraIdBytes.buffer).setUint32(0, paraId, true); // little endian
    
    // Combine and pad to 32 bytes
    const combined = new Uint8Array(32);
    combined.set(prefix, 0);
    combined.set(paraIdBytes, 4);
    
    return u8aToHex(combined);
}

/**
 * Get PRMX sovereign account on Asset Hub
 */
export function getPrmxSovereignOnAssetHub() {
    return calculateSovereignAccount(CHAINS.prmx.paraId);
}

/**
 * Get PRMX sovereign account on Hydration
 */
export function getPrmxSovereignOnHydration() {
    return calculateSovereignAccount(CHAINS.prmx.paraId);
}

// =============================================================================
//                       Balance Helpers
// =============================================================================

/**
 * Format USDT balance (6 decimals)
 */
export function formatUsdt(balance) {
    const num = typeof balance === 'bigint' ? balance : BigInt(balance.toString());
    return `${(Number(num) / 1e6).toFixed(2)} USDT`;
}

/**
 * Parse USDT to smallest units
 */
export function parseUsdt(amount) {
    return BigInt(Math.floor(amount * 1e6));
}

/**
 * Get USDT balance on Asset Hub
 */
export async function getUsdtBalanceAssetHub(api, account) {
    try {
        const result = await api.query.assets.account(ASSETS.USDT_ASSET_HUB, account);
        if (result.isSome) {
            return BigInt(result.unwrap().balance.toString());
        }
        return BigInt(0);
    } catch (error) {
        console.error(`   Error getting USDT balance: ${error.message}`);
        return BigInt(0);
    }
}

/**
 * Get USDT balance on Hydration
 */
export async function getUsdtBalanceHydration(api, account) {
    try {
        const result = await api.query.tokens.accounts(account, ASSETS.USDT_HYDRATION);
        return BigInt(result.free?.toString() || '0');
    } catch (error) {
        console.error(`   Error getting USDT balance on Hydration: ${error.message}`);
        return BigInt(0);
    }
}

/**
 * Get LP token balance on Hydration (Pool 102)
 */
export async function getLpBalanceHydration(api, account) {
    try {
        const result = await api.query.tokens.accounts(account, ASSETS.LP_POOL_102);
        return BigInt(result.free?.toString() || '0');
    } catch (error) {
        console.error(`   Error getting LP balance: ${error.message}`);
        return BigInt(0);
    }
}

/**
 * Get USDT balance on PRMX
 */
export async function getUsdtBalancePrmx(api, account) {
    try {
        const result = await api.query.assets.account(ASSETS.USDT_PRMX, account);
        if (result.isSome) {
            return BigInt(result.unwrap().balance.toString());
        }
        return BigInt(0);
    } catch (error) {
        console.error(`   Error getting PRMX USDT balance: ${error.message}`);
        return BigInt(0);
    }
}

// =============================================================================
//                       Transaction Helpers
// =============================================================================

/**
 * Submit a transaction and wait for inclusion
 */
export async function submitAndWait(api, tx, signer, description) {
    console.log(`   ⏳ Submitting: ${description}`);
    
    return new Promise((resolve, reject) => {
        tx.signAndSend(signer, { nonce: -1 }, (result) => {
            if (result.status.isInBlock) {
                console.log(`   ✅ Included in block: ${result.status.asInBlock.toHex()}`);
                
                const failed = result.events.find(({ event }) => 
                    api.events.system.ExtrinsicFailed.is(event)
                );
                
                if (failed) {
                    const error = failed.event.data[0];
                    reject(new Error(`Transaction failed: ${error.toString()}`));
                } else {
                    resolve(result);
                }
            }
        }).catch(reject);
    });
}

/**
 * Wait for a specific number of blocks
 */
export async function waitBlocks(api, count = 1) {
    console.log(`   ⏳ Waiting for ${count} block(s)...`);
    
    for (let i = 0; i < count; i++) {
        await new Promise(resolve => {
            const unsub = api.rpc.chain.subscribeNewHeads(() => {
                unsub.then(u => u());
                resolve();
            });
        });
    }
}

// =============================================================================
//                       XCM Helpers
// =============================================================================

/**
 * Check if HRMP channel exists between two parachains
 */
export async function checkHrmpChannel(relayApi, sender, recipient) {
    try {
        const channel = await relayApi.query.hrmp.hrmpChannels([sender, recipient]);
        return !channel.isEmpty;
    } catch (error) {
        console.error(`   Error checking HRMP channel: ${error.message}`);
        return false;
    }
}

/**
 * Print HRMP channel status
 */
export async function printHrmpStatus(relayApi) {
    console.log('\n📊 HRMP Channel Status:');
    
    const channels = [
        [CHAINS.prmx.paraId, CHAINS.assetHub.paraId],
        [CHAINS.assetHub.paraId, CHAINS.prmx.paraId],
        [CHAINS.assetHub.paraId, CHAINS.hydration.paraId],
        [CHAINS.hydration.paraId, CHAINS.assetHub.paraId],
    ];
    
    for (const [sender, recipient] of channels) {
        const exists = await checkHrmpChannel(relayApi, sender, recipient);
        const senderName = Object.values(CHAINS).find(c => c.paraId === sender)?.name || sender;
        const recipientName = Object.values(CHAINS).find(c => c.paraId === recipient)?.name || recipient;
        console.log(`   ${senderName} -> ${recipientName}: ${exists ? '✅ Open' : '❌ Closed'}`);
    }
}

// =============================================================================
//                       Pool 102 Helpers
// =============================================================================

/**
 * Get Pool 102 state from Hydration
 */
export async function getPool102State(hydrationApi) {
    try {
        const pool = await hydrationApi.query.stableswap.pools(POOL_102.id);
        if (pool.isSome) {
            const poolData = pool.unwrap();
            return {
                exists: true,
                assets: poolData.assets.map(a => a.toString()),
                amplification: poolData.amplification?.toString(),
                fee: poolData.fee?.toString(),
            };
        }
        return { exists: false };
    } catch (error) {
        console.error(`   Error getting Pool 102 state: ${error.message}`);
        return { exists: false, error: error.message };
    }
}

/**
 * Print Pool 102 summary
 */
export async function printPool102Summary(hydrationApi) {
    console.log('\n📊 Pool 102 State:');
    const state = await getPool102State(hydrationApi);
    
    if (state.exists) {
        console.log(`   Pool exists: ✅`);
        console.log(`   Assets: ${state.assets?.join(', ')}`);
        console.log(`   Amplification: ${state.amplification}`);
        console.log(`   Fee: ${state.fee}`);
    } else {
        console.log(`   Pool exists: ❌ ${state.error || 'Not found'}`);
    }
}
